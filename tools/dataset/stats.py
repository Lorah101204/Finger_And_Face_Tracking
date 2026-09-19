#!/usr/bin/env python3
"""CLS-01 bước 6: thống kê dataset theo lớp, cỡ cửa sổ, điều kiện sáng, loại hình nộm, vị trí và tập.

  python tools/dataset/stats.py <root> [--splits <root>/splits.json] [--doc docs/dataset.md]

In Markdown; với --doc ghi đè phần giữa hai mốc <!-- dataset:begin --> và <!-- dataset:end --> của tài liệu.
"""

from __future__ import annotations

import argparse
import sys
from collections import Counter, defaultdict
from pathlib import Path

from common import utf8_console, LABELS, SPLITS, Sample, all_samples, load_root, read_json

BEGIN = "<!-- dataset:begin -->"
END = "<!-- dataset:end -->"

DIMENSIONS: list[tuple[str, str, tuple[str, ...]]] = [
    ("Cỡ cửa sổ (cạnh ngắn px)", "sizeClass", ("small", "medium", "large")),
    ("Điều kiện sáng", "lighting", ("normal", "bright", "dim", "backlit")),
    ("Loại hình nộm", "mannequinType", ("none", "plastic", "fabric", "silicone")),
    ("Vị trí cửa sổ", "position", ("center", "edge")),
]


def table(header: list[str], rows: list[list[object]]) -> str:
    lines = ["| " + " | ".join(header) + " |", "|" + "|".join("---" for _ in header) + "|"]
    for r in rows:
        lines.append("| " + " | ".join(str(c) for c in r) + " |")
    return "\n".join(lines)


def cross(samples: list[Sample], key: str, values: tuple[str, ...]) -> str:
    counts: dict[str, Counter] = defaultdict(Counter)
    extra: set[str] = set()
    for s in samples:
        v = s.field(key)
        counts[s.label][v] += 1
        if v not in values:
            extra.add(v)
    cols = list(values) + sorted(extra)
    rows: list[list[object]] = []
    for label in LABELS:
        c = counts.get(label, Counter())
        rows.append([label] + [c[v] for v in cols] + [sum(c.values())])
    rows.append(["tổng"] + [sum(counts[l][v] for l in counts) for v in cols] + [len(samples)])
    return table(["Nhãn"] + cols + ["tổng"], rows)


def render(samples: list[Sample], sessions_count: int, splits: dict | None) -> str:
    subjects = {s.subject_id for s in samples}
    parts = [
        f"Sinh bởi `python tools/dataset/stats.py` từ {sessions_count} phiên, {len(subjects)} subject, {len(samples)} mẫu. Không sửa tay phần này.",
        "",
        "### Theo nhãn",
        "",
    ]
    by_label = Counter(s.label for s in samples)
    labeled = sum(1 for s in samples if s.meta.get("labelFinal"))
    parts.append(
        table(
            ["Nhãn", "Mẫu", "Subject", "Phiên"],
            [
                [
                    label,
                    by_label[label],
                    len({s.subject_id for s in samples if s.label == label}),
                    len({s.session_id for s in samples if s.label == label}),
                ]
                for label in LABELS
            ]
            + [["tổng", len(samples), len(subjects), len({s.session_id for s in samples})]],
        )
    )
    parts.append("")
    parts.append(f"Đã gán nhãn cuối (labelFinal): {labeled}/{len(samples)}; còn lại dùng nhãn tạm của app.")
    for title, key, values in DIMENSIONS:
        parts += ["", f"### {title}", "", cross(samples, key, values)]
    if splits:
        parts += ["", "### Theo tập (splits.json)", ""]
        by_sample = splits.get("bySample", {})
        rows: list[list[object]] = []
        for label in LABELS:
            row: list[object] = [label]
            for sp in SPLITS:
                row.append(sum(1 for s in samples if s.label == label and by_sample.get(s.id) == sp))
            rows.append(row)
        rows.append(["tổng"] + [splits.get(sp, {}).get("samples", 0) for sp in SPLITS])
        rows.append(["subject"] + [len(splits.get(sp, {}).get("subjects", [])) for sp in SPLITS])
        rows.append(["phiên"] + [len(splits.get(sp, {}).get("sessions", [])) for sp in SPLITS])
        parts.append(table(["Nhãn", *SPLITS], rows))
    return "\n".join(parts)


def write_doc(doc: Path, body: str) -> None:
    text = doc.read_text(encoding="utf-8")
    i = text.find(BEGIN)
    j = text.find(END)
    if i < 0 or j < 0 or j < i:
        raise SystemExit(f"{doc} thiếu mốc {BEGIN} … {END}")
    doc.write_text(text[:i] + BEGIN + "\n" + body + "\n" + text[j:], encoding="utf-8", newline="\n")


def main(argv: list[str] | None = None) -> int:
    utf8_console()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("root", type=Path)
    p.add_argument("--splits", type=Path)
    p.add_argument("--doc", type=Path)
    args = p.parse_args(argv)
    sessions = load_root(args.root)
    samples = all_samples(sessions)
    splits_path = args.splits or (args.root / "splits.json")
    splits = read_json(splits_path) if splits_path.exists() else None
    body = render(samples, len(sessions), splits)
    if args.doc:
        write_doc(args.doc, body)
        print(f"đã ghi {args.doc}: {len(samples)} mẫu")
    else:
        print(body)
    return 0


if __name__ == "__main__":
    sys.exit(main())
