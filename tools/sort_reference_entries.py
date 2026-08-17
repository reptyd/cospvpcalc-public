"""Alphabetical sort of entries inside referenceContent.ts draft arrays.

Sorts each `*_DRAFTS` array's entries by `name` (case-insensitive, leading
articles ignored). Preserves original line formatting; only reorders top-level
entries inside each array body.

Run: python tools/sort_reference_entries.py
"""
import re
import sys
from pathlib import Path

PATH = Path(__file__).resolve().parent.parent / "src" / "pages" / "referenceContent.ts"

ARRAY_HEADER = re.compile(r"^export const ([A-Z_]+_DRAFTS): [A-Za-z\[\]]+ = \[$")
NAME_LINE = re.compile(r'^\s*name:\s*"([^"]+)",\s*$')
FACTORY_CALL = re.compile(r'^\s{2}create\w+\("([^"]+)"\),\s*$')

LEADING_ARTICLES = ("the ", "a ", "an ")


def sort_key(name: str) -> str:
    n = name.lower()
    for art in LEADING_ARTICLES:
        if n.startswith(art):
            n = n[len(art):]
            break
    return n


def parse_array_body(lines: list[str], start: int, end: int) -> list[tuple[str, list[str]]]:
    """Return [(name, block_lines)] for entries between start (inclusive) and end (exclusive)."""
    entries: list[tuple[str, list[str]]] = []
    i = start
    while i < end:
        line = lines[i]
        if line == "":
            i += 1
            continue
        # Factory-call entry: single line.
        m = FACTORY_CALL.match(line)
        if m:
            entries.append((m.group(1), [line]))
            i += 1
            continue
        # Object literal: starts with `  {`, ends with `  },` or `  }`.
        if line == "  {":
            j = i + 1
            while j < end and lines[j] not in ("  },", "  }"):
                j += 1
            if j >= end:
                raise RuntimeError(f"unterminated object literal at line {i + 1}")
            block = lines[i:j + 1]
            name = None
            for bl in block:
                mm = NAME_LINE.match(bl)
                if mm:
                    name = mm.group(1)
                    break
            if name is None:
                raise RuntimeError(f"no name field in block starting at line {i + 1}")
            entries.append((name, block))
            i = j + 1
            continue
        raise RuntimeError(f"unexpected line {i + 1}: {line!r}")
    return entries


def main() -> int:
    text = PATH.read_text(encoding="utf-8")
    lines = text.split("\n")

    # Find array bounds: header line index and matching `];` line.
    bounds: list[tuple[str, int, int]] = []
    for idx, line in enumerate(lines):
        m = ARRAY_HEADER.match(line)
        if not m:
            continue
        for j in range(idx + 1, len(lines)):
            if lines[j] == "];":
                bounds.append((m.group(1), idx, j))
                break

    if not bounds:
        print("no draft arrays found", file=sys.stderr)
        return 1

    new_lines: list[str] = []
    cursor = 0
    total_before = 0
    total_after = 0
    for arr_name, header_idx, close_idx in bounds:
        new_lines.extend(lines[cursor:header_idx + 1])
        entries = parse_array_body(lines, header_idx + 1, close_idx)
        total_before += len(entries)
        sorted_entries = sorted(entries, key=lambda pair: sort_key(pair[0]))
        total_after += len(sorted_entries)
        for _, block in sorted_entries:
            new_lines.extend(block)
        new_lines.append(lines[close_idx])
        cursor = close_idx + 1
        print(f"{arr_name}: {len(entries)} entries sorted")
    new_lines.extend(lines[cursor:])

    if total_before != total_after:
        raise RuntimeError(
            f"entry count mismatch: before={total_before} after={total_after}"
        )

    out = "\n".join(new_lines)
    PATH.write_text(out, encoding="utf-8")
    print(f"wrote {PATH} ({total_after} entries total across {len(bounds)} arrays)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
