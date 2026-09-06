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

# `pymupdf` FIRST, and the reason is that this script's stdout is a JSON
# contract.
#
# PyMuPDF 1.28 prints "warning: The `fitz` API is deprecated" on IMPORT, and it
# goes to stdout rather than stderr. The Node caller runs JSON.parse over
# stdout, so on any machine with a current PyMuPDF every extraction failed with
# `Unexpected token 'w'` — a message that says nothing whatever about the cause.
#
# The package has been importable as `pymupdf` since 1.24.3. `fitz` stays as the
# fallback so an older install still works.
try:
    import pymupdf as fitz
except ImportError:
    try:
        import fitz  # PyMuPDF < 1.24.3
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
# ligatures the file's own font map threw away
# ---------------------------------------------------------------------------
#
# The Hindu's ePaper embeds Publico with a ToUnicode map that sends every
# ff/fi/fl/ffi/ffl ligature back to a bare "f", so the text layer reads "Staf",
# "beneft", "ofce", "coal gasifcation" — 142 mangled words in one edition.
#
# It reads like a fault in one file and is not. The four August editions stored
# in this database are clean, but re-extracting their PDFs here produces the
# same damage: they were processed on the previous workstation, and it is that
# machine's PyMuPDF, not those files, that got the ligatures out intact. Every
# edition read on THIS machine needs the repair.
#
# The glyph itself is not lost, only its name — and a ligature glyph is far
# wider than a plain "f". So the width is measured against the plain "f" of the
# SAME font at the SAME size, which puts each one in a cluster:
#
#   1.00  plain f        1.81  fi or fl        1.93  ff        2.75  ffi or ffl
#
# Two of those are certain and are written out here. The other two are decided
# in content-pipeline/np-daily/ligatures.js, from the letters that follow,
# after the segmenter has rejoined words broken across lines — "notifca-tion"
# has to become one word before anything can judge it.
#
# A file whose ligatures came through correctly is left alone: the check is per
# span, and a map that expanded a ligature makes the text longer than the glyph
# count, which span_text_with_ligatures treats as "nothing to do here".

MARK_LIG2 = chr(0xE000)  # fi or fl — resolved downstream
MARK_LIG3 = chr(0xE002)  # ffi or ffl — resolved downstream

# Below this, treat the width as a plain "f". Well clear of both clusters: the
# nearest measured values are 1.00 and 1.81.
LIG2_MIN = 1.35
LIG2_MAX = 1.87   # above this and it is ff, which needs no guess
LIG3_MIN = 2.25

# A font+size needs this many "f" glyphs before its narrowest one is trusted as
# the plain-f reference. With three samples that all happen to be ligatures the
# reference would BE a ligature, every ratio would come out at 1.0, and nothing
# would be repaired — safe, but silent. The floor makes that explicit.
LIG_MIN_SAMPLES = 12


def plain_f_widths(doc, pages):
    """The width of a plain "f", per (font, size), as a fraction of the size.

    A first pass of its own because the reference has to come from the whole
    document: a font that appears twice on page 3 and forty times on page 11
    cannot calibrate itself from page 3.

    The 5th percentile rather than the minimum — one clipped bounding box would
    otherwise set the reference for every glyph in the font.
    """
    by_size = {}
    by_font = {}
    for pno in pages:
        for block in doc[pno].get_text("rawdict").get("blocks", []):
            if block.get("type") != 0:
                continue
            for line in block.get("lines", []):
                for span in line.get("spans", []):
                    size = float(span.get("size", 0)) or 1.0
                    font = span.get("font", "")
                    for ch in span.get("chars", []):
                        if ch.get("c") != "f":
                            continue
                        bb = ch.get("bbox") or (0, 0, 0, 0)
                        w = (bb[2] - bb[0]) / size
                        by_size.setdefault((font, round(size, 1)), []).append(w)
                        by_font.setdefault(font, []).append(w)

    def reference(vals):
        """The plain-f width, or None when the sample cannot support one."""
        if len(vals) < LIG_MIN_SAMPLES:
            return None
        vals = sorted(vals)
        # The 5th percentile rather than the minimum: one clipped bounding box
        # would otherwise set the reference for every glyph in the font.
        base = vals[int(len(vals) * 0.05)]
        if base <= 0:
            return None
        # Only where the fault is actually PRESENT. A file whose ligatures came
        # through correctly has nothing wider than a plain "f", and an empty
        # answer is what lets the caller skip the per-character pass entirely.
        if vals[-1] / base < LIG2_MIN:
            return None
        return base

    # TWO REFERENCES, AND THE SECOND ONE IS NOT A REFINEMENT.
    #
    # Keyed on (font, size) the body text calibrates beautifully — 2,461 "f"
    # glyphs in one bucket. Headlines do not: a masthead font is used at nine
    # different sizes, a dozen glyphs at each, so every bucket falls under the
    # sample floor and the headline is left broken while the story under it is
    # repaired. That is the worst of both — "Staf to get PRC" above a paragraph
    # that reads "staff" correctly.
    #
    # Pooling by font fixes it because the measurement is already scale-free:
    # every width here is divided by its own point size, so a 25pt "f" and an
    # 8.9pt "f" from the same family land on the same number.
    ref = {}
    for key, vals in by_size.items():
        base = reference(vals)
        if base:
            ref[key] = base
    for font, vals in by_font.items():
        base = reference(vals)
        if base:
            ref[font] = base
    return ref


def span_text_with_ligatures(text, span, ref):
    """`text` (from get_text("dict")) with lost ligatures marked.

    THE TEXT COMES FROM "dict", NOT FROM THE CHARACTERS.
    -----------------------------------------------------
    This is the whole correctness argument and it cost a wrong turn to find.
    "rawdict" reports one entry per GLYPH and gives only the FIRST character of
    a glyph that maps to several — so on a healthy file, where the ligature maps
    correctly to "ffi", "dict" says `Officer` and "rawdict" says `Ofcer`.
    Building the text from the characters therefore BREAKS the files that were
    never broken, which is the opposite of the job.

    So "dict" stays the source of the text, and the characters are used only for
    their geometry. The two are compared by length: where the glyph map expanded
    a ligature correctly the strings differ in length and nothing is touched;
    where they are the same length the map produced one character per glyph,
    which is exactly the fault, and the widths can say which ones.
    """
    chars = span.get("chars", [])
    # The map expanded something — this span is fine as it stands.
    if len(chars) != len(text):
        return text, 0

    size = float(span.get("size", 0)) or 1.0
    font = span.get("font", "")
    # The size-specific reference first, the family-wide one second. See
    # plain_f_widths for why both exist.
    base = ref.get((font, round(size, 1))) or ref.get(font)
    if not base:
        return text, 0

    # One character of `text` per glyph, checked above, so the two index
    # together. The text is what is emitted; the glyph only says how wide it is.
    out = []
    repairs = 0
    for i, c in enumerate(text):
        if c != "f":
            out.append(c)
            continue
        bb = chars[i].get("bbox") or (0, 0, 0, 0)
        ratio = ((bb[2] - bb[0]) / size) / base
        if ratio >= LIG3_MIN:
            out.append(MARK_LIG3)
            repairs += 1
        elif ratio > LIG2_MAX:
            out.append("ff")
            repairs += 1
        elif ratio >= LIG2_MIN:
            out.append(MARK_LIG2)
            repairs += 1
        else:
            out.append(c)
    return "".join(out), repairs


# ---------------------------------------------------------------------------
# path A: the text layer
# ---------------------------------------------------------------------------

def blocks_from_text_layer(page, ligature_ref=None):
    """PyMuPDF blocks, each reduced to a dominant (font, size) plus its text.

    Block-level rather than span-level is a deliberate trade. The Hindu's
    engine already emits a headline, its standfirst, its drop cap and its body
    as separate blocks, so span-level detail buys nothing here and triples the
    JSON. Where a publication *does* merge a headline into its body block, the
    `fonts` summary is kept so the loss is visible rather than silent.
    """
    out = []
    repairs = 0
    data = page.get_text("dict")
    # "rawdict" alongside it, never instead of it — see span_text_with_ligatures
    # for why the text has to come from "dict". Fetched only when there is a
    # reference to measure against, because it carries a dict per CHARACTER and
    # is several times the size.
    raw = page.get_text("rawdict") if ligature_ref else None
    raw_blocks = raw.get("blocks", []) if raw else []

    for bi, b in enumerate(data.get("blocks", [])):
        if b.get("type") != 0:
            continue  # image block: geometry only, no text to route
        # The two structures come from one layout analysis, so they agree block
        # for block and span for span. Indexed defensively anyway: a mismatch
        # must skip the repair, not raise, because an edition that fails to
        # extract is worse than one with a broken word in it.
        rb = raw_blocks[bi] if bi < len(raw_blocks) else None
        rb_lines = rb.get("lines", []) if rb else []
        weights = Counter()
        pieces = []
        for li, line in enumerate(b.get("lines", [])):
            rl = rb_lines[li] if li < len(rb_lines) else None
            rl_spans = rl.get("spans", []) if rl else []
            for si, span in enumerate(line.get("spans", [])):
                text = span.get("text", "")
                rs = rl_spans[si] if si < len(rl_spans) else None
                if rs is not None and text:
                    text, n = span_text_with_ligatures(text, rs, ligature_ref)
                    repairs += n
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
    return out, repairs


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

    pages = parse_pages(args.pages, len(doc))

    # Does this file carry ligature glyphs at all? One extra pass to find out.
    # A `None` answer skips the per-character work for the whole run, and even a
    # positive answer only means the glyphs EXIST — whether any of them lost
    # their letters is settled per span, by comparing the two extractions.
    ligature_ref = plain_f_widths(doc, pages) or None
    ligature_repairs = 0

    for pno in pages:
        page = doc[pno]
        native, repairs = blocks_from_text_layer(page, ligature_ref)
        ligature_repairs += repairs
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

    # Said out loud, with a count, because a silent repair is indistinguishable
    # from no repair — and because the number is the thing worth watching. A
    # file that suddenly needs 400 of these has changed how it is produced, and
    # that is worth knowing before the drafting bill arrives.
    if ligature_repairs:
        result["warnings"].append(
            "this file's font map returns ligatures as a bare 'f'; %d were measured "
            "and restored from their glyph widths" % ligature_repairs
        )

    json.dump(result, sys.stdout, ensure_ascii=False)
    sys.stdout.write("\n")


if __name__ == "__main__":
    main()
