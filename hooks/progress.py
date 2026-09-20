"""Build-time hook: generates application progress data consumed by the client.

Runs once on_post_build and writes ``<site_dir>/assets/data/app-data.json``.
The data is derived exclusively from the Markdown sources (task-list checkboxes
and "Calendrier" sections), never hardcoded here.
"""

import json
import re
import unicodedata
from pathlib import Path

MONTHS = (
    "janvier|février|mars|avril|mai|juin|juillet|août|septembre|octobre|"
    "novembre|décembre|janv|fevr|mars|avr|juin|juil|sept|oct|nov|déc"
)
DATE_TOKEN = re.compile(
    r"(20\d{2}|d[ée]adline|\d{1,2}(er|e|è)?\s*[.-]?\s*(?:%s))" % MONTHS,
    re.IGNORECASE,
)


def _normalize(text: str) -> str:
    """Canonical form used to build stable task identifiers."""
    text = unicodedata.normalize("NFKC", text)
    return " ".join(text.split()).lower()


def _hash8(text: str) -> str:
    """FNV-1a 32-bit hash -> 8 hex chars, identical to the JS implementation."""
    h = 2166136261
    for ch in text.encode("utf-8"):
        h ^= ch
        h = (h * 16777619) & 0xFFFFFFFF
    return format(h, "08x")


def _strip_markdown(raw: str) -> str:
    """Remove the small subset of Markdown used inside checklist items."""
    text = raw
    text = re.sub(r"\[([^\]\[]*)\]\([^)]*\)", r"\1", text)  # links
    text = re.sub(r"`([^`]*)`", r"\1", text)                 # inline code
    text = re.sub(r"\*\*([^*]+)\*\*", r"\1", text)           # bold
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"\1", text)  # emphasis
    text = re.sub(r"__([^_]+)__", r"\1", text)               # bold (alt)
    text = text.replace("\\[", "[").replace("\\]", "]")
    return text


def _task_items(stem: str, text: str):
    """Yield {key, norm, label} for every Markdown task-list item."""
    seen = {}
    for line in text.splitlines():
        m = re.match(r"^\s*(?:[-*+]|\d{1,3}[).])\s+\[( |x|X)\]\s+(.*)$", line)
        if not m:
            continue
        label = _strip_markdown(m.group(2)).strip()
        if not label:
            continue
        norm = _normalize(label)
        if norm.startswith("retour ") or norm in ("", "-"):
            continue
        slug = norm.replace(" ", "-")
        base = _hash8(slug)
        count = seen.get(base, 0)
        seen[base] = count + 1
        key = f"{stem}::{base}" if count == 0 else f"{stem}::{base}#{count + 1}"
        yield {"key": key, "norm": norm, "label": label}


def _calendar_section(text: str):
    """Yield (heading, [lines]) for 'Calendrier' sections."""
    lines = text.splitlines()
    in_section = False
    heading_level = 0
    section_lines = []
    for line in lines:
        hm = re.match(r"^(#{1,6})\s+", line)
        if hm:
            level = len(hm.group(1))
            if re.search(r"calendrier", line, re.IGNORECASE):
                if in_section:
                    yield section_lines
                heading_level = level
                section_lines = [line]
                in_section = True
                continue
            if in_section and level <= heading_level:
                yield section_lines
                in_section = False
                heading_level = 0
                section_lines = []
            continue
        if in_section:
            section_lines.append(line)
    if in_section:
        yield section_lines


def _deadlines(text: str):
    out = []
    for section in _calendar_section(text):
        for line in section:
            if not line.lstrip().startswith("|"):
                continue
            cells = [c.strip() for c in line.strip().strip("|").split("|")]
            meaningful = [
                _strip_markdown(c).replace("idem", "").replace("ibid.", "").strip()
                for c in cells
                if _strip_markdown(c).strip()
            ]
            if not meaningful:
                continue
            joined = " — ".join(meaningful[:2])
            if DATE_TOKEN.search(joined) and joined not in out:
                out.append(joined)
    return out[:10]


def _walk_nav(items, category=None):
    """Traverse ``config['nav']`` -> (category, title, filename)."""
    for item in items:
        if isinstance(item, dict):
            for title, sub in item.items():
                if isinstance(sub, str):
                    yield category, title, sub
                elif isinstance(sub, list) or isinstance(sub, tuple):
                    yield from _walk_nav(sub, title)


def on_post_build(config, **kwargs):
    docs_dir = Path(config["docs_dir"])
    site_dir = Path(config["site_dir"])
    nav = config.get("nav") or []

    categories = []
    by_category = {}
    pages = {}
    for category, title, filename in _walk_nav(nav):
        if not filename or filename in ("index.md", "dashboard.md"):
            continue
        src = docs_dir / filename
        if not src.exists():
            continue
        text = src.read_text(encoding="utf-8")
        stem = Path(filename).stem
        tasks = list(_task_items(stem, text))
        deadlines = _deadlines(text)
        pages[stem] = {
            "title": title,
            "category": category,
            "url": f"{stem}/",
            "tasks": tasks,
            "deadlines": deadlines,
        }
        by_category.setdefault(category, []).append(pages[stem])

    for name, page_list in by_category.items():
        categories.append({"name": name, "pages": page_list})

    from datetime import date

    payload = {"generated": date.today().isoformat(), "categories": categories, "pages": pages}

    data_dir = site_dir / "assets" / "data"
    data_dir.mkdir(parents=True, exist_ok=True)
    (data_dir / "app-data.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=1), encoding="utf-8"
    )
    return config