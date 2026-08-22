#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
Newspaper page -> layout IR (intermediate representation), as JSON on stdout.

WHY PYTHON FOR THIS ONE STAGE
-----------------------------
The rest of the pipeline is Node, and this script is the one deliberate
exception. Article segmentation is a *geometry* problem: which body column
belongs to which headline. Solving it needs per-block bounding boxes and font
identity, and PyMuPDF hands both over directly while the Node PDF ecosystem
does not. So Python owns page geometry, Node owns the pipeline, and the seam
between them is this file's JSON.

TWO PATHS, ONE OUTPUT SHAPE
---------------------------
An ePaper is a mix of pages: most carry a real text layer, but the front page
and the ad pages are flattened images. Both paths must emit the same shape or
segment.js would need two code paths for what is conceptually one thing:

  text layer  ->  PyMuPDF get_text("dict")     ->  blocks
  image page  ->  rasterise -> tesseract TSV   ->  blocks

Everything downstream is therefore DPI-agnostic and OCR-agnostic. OCR
coordinates are scaled back into PDF points (72/dpi) for exactly that reason:
a segmentation rule expressed in points must not silently mean something
different on an OCR'd page.

USAGE
  python layout.py <pdf> [--pages 1-28] [--dpi 300] [--lang eng]
                         [--ocr-threshold 1200] [--force-ocr] [--no-ocr]
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
from collections import Counter

try:
    import fitz  # PyMuPDF
except ImportError:
    sys.stderr.write("PyMuPDF is required: pip install pymupdf\n")
    raise SystemExit(2)


# ---------------------------------------------------------------------------
# tesseract discovery
# ---------------------------------------------------------------------------

# The Windows installer does not put tesseract on PATH, and the failure mode if
# we ignore that is an OCR stage that silently produces nothing on the one page
# that matters most (a front page is always flattened artwork). So look in the
# known install locations before giving up.
TESSERACT_CANDIDATES = [
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
    "/usr/bin/tesseract",
    "/usr/local/bin/tesseract",
    "/opt/homebrew/bin/tesseract",
]


def find_tesseract():
    found = shutil.which("tesseract")
    if found:
        return found
    for path in TESSERACT_CANDIDATES:
        if path and os.path.isfile(path):
            return path
    return None


def tesseract_langs(binary):
    try:
        out = subprocess.run(
            [binary, "--list-langs"], capture_output=True, text=True, timeout=30
        )
        lines = (out.stdout or "").splitlines() + (out.stderr or "").splitlines()
        return sorted({ln.strip() for ln in lines if re.fullmatch(r"[a-z_]{3,}", ln.strip())})
    except Exception:
        return []


# ---------------------------------------------------------------------------
# path A: the text layer
# ---------------------------------------------------------------------------

def blocks_from_text_layer(page):
    """PyMuPDF blocks, each reduced to a dominant (font, size) plus its text.

    Block-level rather than span-level is a deliberate trade. The Hindu's
    engine already emits a headline, its standfirst, its drop cap and its body
    as separate blocks, so span-level detail buys nothing here and triples the
    JSON. Where a publication *does* merge a headline into its body block, the
    `fonts` summary is kept so the loss is visible rather than silent.
    """
    out = []
    data = page.get_text("dict")
    for b in data.get("blocks", []):
        if b.get("type") != 0:
            continue  # image block: geometry only, no text to route
        weights = Counter()
        pieces = []
        for line in b.get("lines", []):
            for span in line.get("spans", []):
                text = span.get("text", "")
                if not text:
                    continue
                weights[(span.get("font", ""), round(float(span.get("size", 0)), 1))] += len(text)
                pieces.append(text)
        if not weights:
            continue
        text = re.sub(r"\s+", " ", " ".join(pieces)).strip()
        if not text:
            continue
        (font, size), _ = weights.most_common(1)[0]
        out.append(
            {
                "bbox": [round(v, 1) for v in b["bbox"]],
                "font": font,
                "size": size,
                "text": text,
                "conf": None,
                # Present only when a block mixes roles, which is the case worth
                # being able to see from the outside.
                "fonts": (
                    [{"font": f, "size": s, "chars": n} for (f, s), n in weights.most_common(4)]
                    if len(weights) > 1
                    else None
                ),
            }
        )
    return out


# ---------------------------------------------------------------------------
# path B: OCR
# ---------------------------------------------------------------------------

def blocks_from_ocr(page, binary, lang, dpi):
    """Rasterise the page, OCR it, and rebuild blocks from tesseract's TSV.

    Tesseract runs its own page-layout analysis and reports block and paragraph
    numbers, so its blocks are used directly rather than re-clustering words
    ourselves: on newspaper columns its analysis is good, and a second
    clustering pass on top of it mostly fights it.
    """
    scale = dpi / 72.0
    pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), colorspace=fitz.csGRAY)

    tmpdir = tempfile.mkdtemp(prefix="np-ocr-")
    img_path = os.path.join(tmpdir, "page.png")
    out_base = os.path.join(tmpdir, "out")
    try:
        pix.save(img_path)
        cmd = [
            binary, img_path, out_base,
            "-l", lang,
            "--psm", "3",   # full automatic page segmentation: it is a page, not a line
            "--oem", "1",   # LSTM
            "tsv",
        ]
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=900)
        tsv_path = out_base + ".tsv"
        if not os.path.isfile(tsv_path):
            raise RuntimeError(
                "tesseract produced no TSV: " + (proc.stderr or proc.stdout or "no output")
            )
        with open(tsv_path, "r", encoding="utf-8", errors="replace") as fh:
            rows = [ln.rstrip("\n").split("\t") for ln in fh]
    finally:
        shutil.rmtree(tmpdir, ignore_errors=True)

    if not rows:
        return []
    idx = {name: i for i, name in enumerate(rows[0])}
    need = ["block_num", "par_num", "left", "top", "width", "height", "conf", "text"]
    missing = [n for n in need if n not in idx]
    if missing:
        raise RuntimeError("unexpected tesseract TSV header, missing %s" % (missing,))

    groups = {}
    for row in rows[1:]:
        if len(row) <= idx["text"]:
            continue
        text = row[idx["text"]].strip()
        if not text:
            continue
        try:
            conf = float(row[idx["conf"]])
        except ValueError:
            continue
        # -1 marks a structural row rather than a word. Below ~30 is generally
        # noise picked off a rule line or a halftone photograph.
        if conf < 30:
            continue
        try:
            left, top = float(row[idx["left"]]), float(row[idx["top"]])
            width, height = float(row[idx["width"]]), float(row[idx["height"]])
        except ValueError:
            continue
        key = (row[idx["block_num"]], row[idx["par_num"]])
        g = groups.setdefault(
            key,
            {"words": [], "x0": 1e9, "y0": 1e9, "x1": -1e9, "y1": -1e9, "heights": [], "confs": []},
        )
        g["words"].append(text)
        g["x0"] = min(g["x0"], left)
        g["y0"] = min(g["y0"], top)
        g["x1"] = max(g["x1"], left + width)
        g["y1"] = max(g["y1"], top + height)
        g["heights"].append(height)
        g["confs"].append(conf)

    out = []
    for g in groups.values():
        if not g["words"]:
            continue
        heights = sorted(g["heights"])
        median_h = heights[len(heights) // 2]
        # Cap height maps to point size closely enough to rank headline against
        # body, which is all the segmenter asks of `size`. It is an estimate and
        # is not comparable with sizes from the text-layer path.
        size = round(median_h / scale, 1)
        out.append(
            {
                "bbox": [
                    round(g["x0"] / scale, 1), round(g["y0"] / scale, 1),
                    round(g["x1"] / scale, 1), round(g["y1"] / scale, 1),
                ],
                "font": None,   # OCR cannot report font identity
                "size": size,
                "text": re.sub(r"\s+", " ", " ".join(g["words"])).strip(),
                "conf": round(sum(g["confs"]) / len(g["confs"]), 1),
                "fonts": None,
            }
        )
    out.sort(key=lambda b: (b["bbox"][1], b["bbox"][0]))
    return out


# ---------------------------------------------------------------------------
# driver
# ---------------------------------------------------------------------------

def parse_pages(spec, n):
    if not spec:
        return list(range(n))
    wanted = []
    for part in str(spec).split(","):
        part = part.strip()
        if not part:
            continue
        if "-" in part:
            a, b = part.split("-", 1)
            wanted.extend(range(int(a) - 1, int(b)))
        else:
            wanted.append(int(part) - 1)
    seen, out = set(), []
    for p in wanted:
        if 0 <= p < n and p not in seen:
            seen.add(p)
            out.append(p)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("pdf")
    ap.add_argument("--pages", default=None, help="1-based, e.g. 1-6,23")
    ap.add_argument("--dpi", type=int, default=300)
    ap.add_argument("--lang", default="eng", help="tesseract lang code, e.g. eng or tel")
    # Below this many characters a page is treated as flattened artwork. The
    # Hindu's image pages come back with 72-486 characters of masthead and
    # registration marks, while a real text page carries 6,000-22,000 - so the
    # gap this threshold sits in is two orders of magnitude wide.
    ap.add_argument("--ocr-threshold", type=int, default=1200)
    ap.add_argument("--force-ocr", action="store_true")
    ap.add_argument("--no-ocr", action="store_true")
    args = ap.parse_args()

    doc = fitz.open(args.pdf)
    binary = find_tesseract()
    langs = tesseract_langs(binary) if binary else []

    result = {
        "file": os.path.abspath(args.pdf),
        "page_count": len(doc),
        "dpi": args.dpi,
        "ocr": {
            "binary": binary,
            "langs": langs,
            "requested_lang": args.lang,
            "available": bool(binary) and (args.lang in langs if langs else False),
        },
        "pages": [],
        "warnings": [],
    }

    if binary and langs and args.lang not in langs:
        result["warnings"].append(
            "tesseract has no '%s' traineddata (has: %s); image pages in that "
            "language cannot be read" % (args.lang, ", ".join(langs) or "none")
        )

    for pno in parse_pages(args.pages, len(doc)):
        page = doc[pno]
        native = blocks_from_text_layer(page)
        native_chars = sum(len(b["text"]) for b in native)

        thin = native_chars < args.ocr_threshold
        use_ocr = args.force_ocr or thin
        source, blocks = "text", native

        if use_ocr and not args.no_ocr:
            if not binary:
                result["warnings"].append(
                    "page %d needs OCR (%d chars in text layer) but tesseract was not found"
                    % (pno + 1, native_chars)
                )
            elif langs and args.lang not in langs:
                result["warnings"].append(
                    "page %d needs OCR but '%s' traineddata is missing" % (pno + 1, args.lang)
                )
            else:
                try:
                    ocr_blocks = blocks_from_ocr(page, binary, args.lang, args.dpi)
                    # Keep whichever path produced more readable text - EXCEPT
                    # when OCR was explicitly asked for. --force-ocr exists for
                    # the case where a text layer is present but bad (a PDF
                    # carrying somebody else's poor OCR, which is common in
                    # scanned exam papers), and there "more characters" is
                    # precisely the wrong test: the corrupt layer often has more.
                    # A flag named force that silently declines to force is worse
                    # than no flag.
                    if args.force_ocr or sum(len(b["text"]) for b in ocr_blocks) > native_chars:
                        blocks, source = ocr_blocks, "ocr"
                except Exception as exc:
                    result["warnings"].append("page %d OCR failed: %s" % (pno + 1, exc))
        elif use_ocr and args.no_ocr:
            result["warnings"].append(
                "page %d has only %d chars and --no-ocr was set; it will yield little"
                % (pno + 1, native_chars)
            )

        result["pages"].append(
            {
                "page": pno + 1,
                "width": round(page.rect.width, 1),
                "height": round(page.rect.height, 1),
                "source": source,
                "lang": args.lang if source == "ocr" else None,
                "native_chars": native_chars,
                "image_count": len(page.get_images(full=True)),
                "blocks": blocks,
            }
        )

    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
