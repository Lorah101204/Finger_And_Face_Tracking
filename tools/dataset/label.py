#!/usr/bin/env python3
"""CLS-01 bước 4: gán nhãn cuối (labelFinal) cho mẫu trong dataset và kiểm cấu trúc.

Nhãn: person, mannequin, unknown (không đủ thông tin), background (chỉ nền hoặc chỉ tay). Nhãn tạm do app ghi lúc thu
(`label`) giữ nguyên; nhãn cuối ghi vào `labelFinal` của <id>.json. Ba cách gán:

  python tools/dataset/label.py list <root> [--unlabeled]
  python tools/dataset/label.py set <root> --label mannequin <id> [<id> ...]
  python tools/dataset/label.py from-dirs <root>      # người gán nhãn copy <id>.png vào <root>/_labels/<nhãn>/
  python tools/dataset/label.py check <root>          # thoát 1 khi có lỗi (thiếu file, sai cỡ, frame gốc, thiếu đồng ý)
  python tools/dataset/label.py csv <root> [--out labels.csv]
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

from common import utf8_console, LABELS, Sample, all_samples, check, load_root, write_json


def set_label(sample: Sample, label: str) -> None:
    if label not in LABELS:
        raise SystemExit(f"nhãn không hợp lệ: {label} (chọn {', '.join(LABELS)})")
    sample.meta["labelFinal"] = label
    write_json(sample.json_path, sample.meta)


def cmd_list(args: argparse.Namespace) -> int:
    samples = all_samples(load_root(args.root))
    for s in samples:
        if args.unlabeled and s.meta.get("labelFinal"):
            continue
        print(
            f"{s.id}\t{s.session_id}\t{s.subject_id}\ttạm={s.field('label')}\tcuối={s.field('labelFinal', '-')}"
            f"\t{s.field('sizeClass')}\t{s.field('lighting')}\t{s.field('position')}"
        )
    return 0


def cmd_set(args: argparse.Namespace) -> int:
    by_id = {s.id: s for s in all_samples(load_root(args.root))}
    missing = [i for i in args.ids if i not in by_id]
    if missing:
        raise SystemExit(f"không có mẫu: {', '.join(missing)}")
    for i in args.ids:
        set_label(by_id[i], args.label)
    print(f"đã gán {args.label} cho {len(args.ids)} mẫu")
    return 0


def cmd_from_dirs(args: argparse.Namespace) -> int:
    by_id = {s.id: s for s in all_samples(load_root(args.root))}
    labels_dir = args.root / "_labels"
    if not labels_dir.is_dir():
        raise SystemExit(f"thiếu {labels_dir}: tạo thư mục con theo nhãn ({', '.join(LABELS)}) và copy PNG vào")
    n = 0
    unknown_ids: list[str] = []
    for label in LABELS:
        d = labels_dir / label
        if not d.is_dir():
            continue
        for png in sorted(d.glob("*.png")):
            s = by_id.get(png.stem)
            if not s:
                unknown_ids.append(png.name)
                continue
            set_label(s, label)
            n += 1
    if unknown_ids:
        print(f"bỏ qua {len(unknown_ids)} file không khớp id: {', '.join(unknown_ids[:5])}", file=sys.stderr)
    print(f"đã gán nhãn cuối cho {n} mẫu từ {labels_dir}")
    return 0


def cmd_check(args: argparse.Namespace) -> int:
    sessions = load_root(args.root)
    errors = check(sessions)
    n = len(all_samples(sessions))
    for e in errors:
        print(f"LỖI {e}")
    print(f"{len(sessions)} phiên, {n} mẫu, {len(errors)} lỗi")
    return 1 if errors else 0


def cmd_csv(args: argparse.Namespace) -> int:
    out = args.out or (args.root / "labels.csv")
    fields = [
        "id", "sessionId", "subjectId", "label", "labelFinal", "sizeClass", "lighting",
        "mannequinType", "position", "n", "w", "h",
    ]
    with open(out, "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(fields)
        for s in all_samples(load_root(args.root)):
            crop = s.meta.get("crop") or {}
            w.writerow(
                [
                    s.id, s.session_id, s.subject_id, s.field("label"), s.field("labelFinal", ""),
                    s.field("sizeClass"), s.field("lighting"), s.field("mannequinType"), s.field("position"),
                    s.field("n"), crop.get("w", ""), crop.get("h", ""),
                ]
            )
    print(f"đã ghi {out}")
    return 0


def main(argv: list[str] | None = None) -> int:
    utf8_console()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = p.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("list")
    a.add_argument("root", type=Path)
    a.add_argument("--unlabeled", action="store_true")
    a.set_defaults(fn=cmd_list)
    a = sub.add_parser("set")
    a.add_argument("root", type=Path)
    a.add_argument("--label", required=True, choices=LABELS)
    a.add_argument("ids", nargs="+")
    a.set_defaults(fn=cmd_set)
    a = sub.add_parser("from-dirs")
    a.add_argument("root", type=Path)
    a.set_defaults(fn=cmd_from_dirs)
    a = sub.add_parser("check")
    a.add_argument("root", type=Path)
    a.set_defaults(fn=cmd_check)
    a = sub.add_parser("csv")
    a.add_argument("root", type=Path)
    a.add_argument("--out", type=Path)
    a.set_defaults(fn=cmd_csv)
    args = p.parse_args(argv)
    return int(args.fn(args))


if __name__ == "__main__":
    sys.exit(main())
