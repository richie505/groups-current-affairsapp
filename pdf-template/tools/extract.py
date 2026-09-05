"""Parse the PDFKit-generated APPSC compendium into structured JSON."""
import pymupdf, json, re, sys

doc = pymupdf.open("src.pdf")
W = doc[0].rect.width
COL_MID = W / 2
RUST = 10105874

def line_info(l):
    txt = ""
    bold_all = True
    ital_all = True
    size = 0
    color = None
    for s in l["spans"]:
        t = s["text"]
        if not t:
            continue
        b = "Bold" in s["font"]
        i = "Oblique" in s["font"]
        if not b: bold_all = False
        if not i: ital_all = False
        size = max(size, s["size"])
        color = s["color"] if color is None else color
        if b and t.strip() and s["size"] < 11:
            # mark bold keyword spans
            lead = len(t) - len(t.lstrip()); trail = len(t.rstrip())
            core = t.strip()
            t = t[:lead] + "**" + core + "**" + t[trail:]
        txt += t
    x0, y0, x1, y1 = l["bbox"]
    return dict(text=txt, x0=x0, y0=y0, x1=x1, y1=y1, bold=bold_all, ital=ital_all, size=round(size, 1), color=color)

def page_lines(p):
    lines = []
    for b in p.get_text("dict")["blocks"]:
        for l in b.get("lines", []):
            li = line_info(l)
            if li["text"].strip():
                lines.append(li)
    # drop footer
    lines = [l for l in lines if not re.search(r"APPSC Current Affairs · Sunday", l["text"]) and l["y0"] < 800]
    rules = []
    for d in p.get_drawings():
        r = d["rect"]
        if r.height < 1.5 and r.width > 150:
            rules.append((r.y0, r.x0, r.x1))
    return lines, rules

def build_stream():
    """Yield lines in reading order (left column then right column per page), tagging table rows."""
    stream = []
    for pn, p in enumerate(doc):
        if pn < 2:
            continue
        lines, rules = page_lines(p)
        for col in (0, 1):
            cl = [l for l in lines if (l["x0"] < COL_MID - 10) == (col == 0)]
            cr = sorted([r for r in rules if (r[1] < COL_MID - 10) == (col == 0)], key=lambda r: r[0])
            cl.sort(key=lambda l: (round(l["y0"]), l["x0"]))
            # group rules into tables: consecutive rules separated < 120pt
            groups = []
            for r in cr:
                if groups and r[0] - groups[-1][-1] < 140:
                    groups[-1].append(r[0])
                else:
                    groups.append([r[0]])
            col_left = min((l["x0"] for l in cl), default=52)
            used = set()
            table_items = []
            for g in groups:
                # header: bold lines contiguous upward from first rule
                above = sorted([ (i,l) for i,l in enumerate(cl) if l["y1"] <= g[0] + 2 and l["y0"] > g[0] - 60], key=lambda t: -t[1]["y0"])
                hdr_idx = []
                last_y = g[0]
                for i,l in above:
                    if l["bold"] and last_y - l["y1"] < 14 and l["color"] in (2042167, 988970):
                        hdr_idx.append(i); last_y = l["y0"]
                    else:
                        break
                top = min((cl[i]["y0"] for i in hdr_idx), default=g[0] - 45) - 1
                bounds = [top] + g
                rows = []
                for i in range(len(bounds) - 1):
                    a, b = bounds[i], bounds[i + 1]
                    cells = [[], []]
                    for idx, l in enumerate(cl):
                        if a <= l["y0"] + 2.5 < b and idx not in used:
                            c = 0 if l["x0"] < col_left + 60 else 1
                            cells[c].append(l)
                            used.add(idx)
                    rows.append(cells)
                has_header = bool(hdr_idx)
                valid = any(r[0] and r[1] for r in rows)
                if not valid:
                    for r in rows:
                        for l in r[0] + r[1]:
                            used.discard(cl.index(l))
                    continue
                def cell(ls):
                    return " ".join(l["text"].strip() for l in sorted(ls, key=lambda l: l["y0"])).replace("** **", " ").strip()
                trows = [[cell(r[0]), cell(r[1])] for r in rows if (r[0] or r[1])]
                table_items.append((top, {"kind": "table", "rows": trows, "has_header": has_header}))
            prev_y1 = None
            items = []
            for i, l in enumerate(cl):
                if i in used: continue
                d = dict(l); d["kind"] = "line"
                d["_gap"] = prev_y1 is not None and (l["y0"] - prev_y1) > 5
                prev_y1 = l["y1"]
                items.append((l["y0"], d))
            items += table_items
            items.sort(key=lambda t: t[0])
            for _, it in items:
                it["page"] = pn + 1
                stream.append(it)
    return stream

stream = build_stream()

# ---------------- structure ----------------
def clean(s):
    s = re.sub(r"\*\*\s*\*\*", " ", s)
    s = s.replace("**", "\x00")  # placeholder
    # merge adjacent bold: "\x00a\x00 \x00b\x00" -> "\x00a b\x00"
    s = re.sub(r"\x00 \x00", " ", s)
    s = s.replace("\x00", "**")
    s = re.sub(r"\s+", " ", s).strip()
    s = s.replace("\\n\\n", " ").replace("\\n", " ")
    return s

topics = []
answers = []
cur = None
section = None
mode = None
sub = None
buf = []
qbuf = None

def flush_para():
    global buf
    if not buf: return
    text = clean(" ".join(buf))
    buf = []
    if not text: return
    if mode == "why": cur["why_in_news"].append(text)
    elif mode == "key": cur["key_details"].append({"type": "p", "text": text})
    elif mode == "static":
        if sub is None: cur["static_linkage"]["summary"] += (" " if cur["static_linkage"]["summary"] else "") + text
        else: cur["static_linkage"]["blocks"][-1]["items"].append(text)
    elif mode == "facts": cur["prelims_facts"].append(text.lstrip("• ").strip())
    elif mode == "q":
        qbuf["lines"].append(text)

TAGRE = re.compile(r"^\**(GROUP-I{1,2} .*)")
in_answer_key = False
ans_cur = None
allq = []
for it in stream:
    if it["kind"] == "table":
        if in_answer_key: continue
        flush_para()
        hdr = it["rows"][0] if it["has_header"] else None
        body = it["rows"][1:] if it["has_header"] else it["rows"]
        if mode == "key":
            prev = cur["key_details"][-1] if cur["key_details"] else None
            if prev and prev["type"] == "table" and not it["has_header"]:
                prev["rows"] += body
            else:
                cur["key_details"].append({"type": "table", "header": hdr, "rows": body})
        elif mode == "static":
            blocks = cur["static_linkage"]["blocks"]
            prev = blocks[-1] if blocks else None
            if prev and prev["type"] == "table" and not it["has_header"]:
                prev["rows"] += body
            else:
                blocks.append({"title": "Key facts", "type": "table", "header": hdr, "rows": body})
            sub = "table"
        continue
    t = it["text"].strip(); raw = re.sub(r"\*\*", "", t).strip()
    if raw == "ANSWER KEY":
        flush_para(); in_answer_key = True; continue
    if in_answer_key:
        m = re.match(r"^Q(\d+) · ([A-D])$", raw)
        if m:
            moved = []
            if ans_cur and ans_cur.get("_last") and ans_cur["_last"][1] == it["page"] and ans_cur["_last"][0] >= it["y0"] - 6 and ans_cur["explanation"]:
                moved = [ans_cur["explanation"].pop()]
            ans_cur = {"q": int(m.group(1)), "answer": m.group(2), "explanation": moved, "as_of": None}
            answers.append(ans_cur); continue
        if it["ital"] and raw.startswith("Correct as of"):
            if ans_cur: ans_cur["as_of"] = raw.replace("Correct as of", "").strip(" ."); continue
        if it["color"] == RUST: continue  # topic heading in answer key
        if ans_cur: ans_cur["explanation"].append(raw); ans_cur["_last"] = (it["y0"], it["page"])
        continue
    if it["bold"] and raw.startswith("SECTION ") and it["size"] >= 9.5:  # section banner
        flush_para(); section = raw; continue
    mnum = re.match(r"^(\d\d)\s*(.*)$", raw)
    if it["size"] == 16.0 and mnum:
        flush_para()
        cur = {"n": int(mnum.group(1)), "section": section, "title": "", "tags": [], "why_in_news": [], "key_details": [],
               "static_linkage": {"summary": "", "blocks": []}, "prelims_facts": [], "questions": []}
        cur["title"] = mnum.group(2).strip()
        topics.append(cur); mode = "title"; sub = None; continue
    if mode == "title":
        if it["size"] == 11.5:
            cur["title"] += (" " if cur["title"] else "") + raw; continue
        if it["size"] == 7.0:
            mode = "tags"
    if mode == "tags":
        if it["size"] == 7.0:
            cur["_tagtext"] = cur.get("_tagtext", "") + " " + raw; continue
        cur["tags"] = [x.strip() for x in re.split(r"\s+·\s+", cur.pop("_tagtext", "").strip()) if x.strip()]
        mode = None
    if it["ital"] and it["size"] == 8.5 and cur is not None and mode not in ("static",):
        cur["static_linkage"]["summary"] += " " + raw; continue
    if it["color"] == RUST and it["bold"] and it["size"] == 9.0:
        flush_para()
        h = raw.replace(" ", "")
        mode = {"WHYINNEWS": "why", "KEYDETAILS": "key", "STATICLINKAGE": "static", "PRELIMSFACTS": "facts", "PRACTICEQUESTIONS": "q"}.get(h, mode)
        sub = None
        continue
    if mode == "static" and it["bold"] and it["size"] == 9.0 and it["x0"] > 55 and raw in ("What it is", "Key facts", "The provisions that get asked", "Easily confused with", "Andhra Pradesh") :
        flush_para()
        if raw == "Key facts":
            sub = "table"; continue
        cur["static_linkage"]["blocks"].append({"title": raw, "type": "list" if raw != "What it is" else "p", "items": []})
        sub = raw; continue
    mq = re.match(r"^\**Q(\d+)\.\**\s*(.*)", t)
    if mq and mode != "title":
        mode = "q"
    if mode == "q":
        m = mq
        if m:
            flush_para()
            qbuf = {"q": int(m.group(1)), "lines": [m.group(2).strip()]}
            allq.append(qbuf); continue
        if qbuf is None: continue
        buf.append(t); flush_para(); continue
    if mode == "facts":
        if raw.startswith("•"):
            flush_para(); buf.append(raw.lstrip("• ").strip())
        else:
            buf.append(raw)
        continue
    if mode in ("why", "key", "static"):
        if mode == "static" and sub in ("The provisions that get asked", "Easily confused with", "Andhra Pradesh") and it["size"] >= 10 and not raw.startswith("•") and (it["x0"] < 55 or 300 < it["x0"] < 312):
            wb = [b for b in cur["static_linkage"]["blocks"] if b["title"] == "What it is"]
            if wb:
                wb[0]["items"][-1] = clean(wb[0]["items"][-1] + " " + t); continue
        if mode == "static" and sub in ("The provisions that get asked", "Easily confused with", "Andhra Pradesh"):
            if raw.startswith("•"):
                flush_para(); buf.append(t.replace("•", "", 1).strip())
            else:
                buf.append(t)
            continue
        if mode == "static" and sub == "table":
            sub = None
        # paragraph break heuristic: line begins new paragraph when previous line ended with '.' and this line's x is column start? We keep single paragraph per block, split on sentence end + gap
        if buf and it.get("_gap"):
            flush_para()
        buf.append(t)
        continue
flush_para()

# ---- post-process questions into structured MCQs ----
def parse_q(q):
    lines = q["lines"]
    text = " ".join(lines)
    text = re.sub(r"\*\*", "", text)
    # split options
    parts = re.split(r"\s(?=\([a-d]\)\s)", " " + text)
    stem = parts[0].strip()
    opts = []
    for p in parts[1:]:
        m = re.match(r"\(([a-d])\)\s*(.*)", p.strip())
        if m: opts.append(m.group(2).strip())
    # break stem into logical lines: statements I., II., List-I etc.
    stem = re.sub(r"\s(?=(?:I|II|III|IV|V)\.\s)", "\n", stem)
    stem = re.sub(r"\s(?=[A-D]\.\s)", "\n", stem)
    stem = re.sub(r"\s(?=[1-4]\.\s)", "\n", stem)
    stem = re.sub(r"\s(?=\((?:i|ii|iii|iv|a|b|c|d)\)\s)", "\n", stem)
    stem = re.sub(r"\s(?=List-I\b|List-II\b|Codes:|Which of the|Which one of|Select the correct|Choose the correct|Statement [AB]:|Reason \(R\):)", "\n", stem)
    return {"q": q["q"], "stem": stem.strip(), "options": opts, "raw": re.sub(r"\s+", " ", text)}

allq.sort(key=lambda q: q["q"])
for tp in topics:
    tp["questions"] = [parse_q(q) for q in allq if (tp["n"]-1)*4 < q["q"] <= tp["n"]*4]
    tp.pop("_tagtext", None)

# answers -> attach
amap = {a["q"]: a for a in answers}
for tp in topics:
    for q in tp["questions"]:
        a = amap.get(q["q"])
        if a:
            q["answer"] = a["answer"]; q["explanation"] = " ".join(a["explanation"]); q["as_of"] = a["as_of"]

def fix_rows(tbl):
    out = []
    for r in tbl["rows"]:
        if out and (r[0] == "" or (r[0] and r[0][0].islower())):
            out[-1] = [clean(out[-1][0] + " " + r[0]), clean(out[-1][1] + " " + r[1])]
        else:
            out.append([clean(r[0]), clean(r[1])])
    tbl["rows"] = out
    if tbl["header"]: tbl["header"] = [clean(re.sub(r"\*\*", "", h)).replace("Key facts ", "") for h in tbl["header"]]
for tp in topics:
    merged = []
    for k in tp["key_details"]:
        if k["type"] == "table" and k["header"] is None and merged and merged[-1]["type"] == "table":
            merged[-1]["rows"] += k["rows"]; continue
        merged.append(k)
    tp["key_details"] = merged
    for k in tp["key_details"]:
        if k["type"] == "table": fix_rows(k)
    for b in tp["static_linkage"]["blocks"]:
        if b["type"] == "table": fix_rows(b)
    tp["static_linkage"]["summary"] = clean(tp["static_linkage"]["summary"])
for a in answers: a.pop("_last", None)
json.dump(topics, open("topics_raw.json", "w"), indent=1, ensure_ascii=False)
print(len(topics), "topics;", sum(len(t["questions"]) for t in topics), "questions;", len(answers), "answers")
for t in topics:
    print(t["n"], t["title"][:50], "| tags", len(t["tags"]), "| why", len(t["why_in_news"]), "| kd", [k["type"] for k in t["key_details"]], "| static", [b["title"] for b in t["static_linkage"]["blocks"]], "| facts", len(t["prelims_facts"]), "| q", len(t["questions"]))
