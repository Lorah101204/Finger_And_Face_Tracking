#!/usr/bin/env python3
"""CLS-01 bước 5: chia train/val/test theo subjectId (mọi phiên của một người hay hình nộm nằm trong cùng một tập).

  python tools/dataset/split.py <root> [--train 0.7 --val 0.15 --test 0.15] [--seed 1] [--out <root>/splits.json]

Ghi splits.json (danh sách subject, session và số mẫu mỗi tập) và splits.csv (id, split). Kiểm rò rỉ: không session hay
subject nào ở hai tập; thoát 1 nếu vi phạm. Tách theo subject đủ để không rò rỉ theo session; kiểm cả hai cho chắc.
"""

from __future__ import annotations

import argparse
import csv
import random
import sys
from collections import defaultdict
from pathlib import Path

from common import utf8_console, SPLITS, Session, all_samples, load_root, write_json


def assign_subjects(
    counts: dict[str, int], ratios: dict[str, float], seed: int
) -> dict[str, str]:
    """Tham lam: subject nhiều mẫu trước, vào tập đang thiếu nhiều nhất so với mục tiêu; thứ tự cùng cỡ xáo theo seed."""
    total = sum(counts.values())
    rng = random.Random(seed)
    subjects = sorted(counts)
    rng.shuffle(subjects)
    subjects.sort(key=lambda s: -counts[s])
    current = {k: 0 for k in SPLITS}
    out: dict[str, str] = {}
    for i, subj in enumerate(subjects):
        # Ba subject đầu chia đều để mỗi tập có ít nhất một người khi có đủ subject.
        if i < len(SPLITS) and len(subjects) >= len(SPLITS):
            best = SPLITS[i]
        else:
            best = max(SPLITS, key=lambda k: ratios[k] * total - current[k])
        out[subj] = best
        current[best] += counts[subj]
    return out


def verify_no_leak(sessions: list[Session], subject_split: dict[str, str]) -> list[str]:
    errors: list[str] = []
    session_splits: dict[str, set[str]] = defaultdict(set)
    subject_splits: dict[str, set[str]] = defaultdict(set)
    for ses in sessions:
        for s in ses.samples:
            sp = subject_split[s.subject_id]
            session_splits[s.session_id].add(sp)
            subject_splits[s.subject_id].add(sp)
    for sid, sps in session_splits.items():
        if len(sps) > 1:
            errors.append(f"phiên {sid} xuất hiện ở {', '.join(sorted(sps))}")
    for subj, sps in subject_splits.items():
        if len(sps) > 1:
            errors.append(f"subject {subj} xuất hiện ở {', '.join(sorted(sps))}")
    return errors


def make_splits(sessions: list[Session], ratios: dict[str, float], seed: int) -> dict:
    counts: dict[str, int] = defaultdict(int)
    for s in all_samples(sessions):
        counts[s.subject_id] += 1
    subject_split = assign_subjects(counts, ratios, seed)
    errors = verify_no_leak(sessions, subject_split)
    if errors:
        raise SystemExit("rò rỉ: " + "; ".join(errors))
    result: dict = {"seed": seed, "ratios": ratios, "bySample": {}}
    for k in SPLITS:
        result[k] = {"subjects": [], "sessions": [], "samples": 0}
    for subj in sorted(subject_split):
        result[subject_split[subj]]["subjects"].append(subj)
    for ses in sessions:
        if not ses.samples:
            continue
        sp = subject_split[ses.samples[0].subject_id]
        result[sp]["sessions"].append(ses.id)
        for s in ses.samples:
            result[sp]["samples"] += 1
            result["bySample"][s.id] = sp
    return result


def main(argv: list[str] | None = None) -> int:
    utf8_console()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("root", type=Path)
    p.add_argument("--train", type=float, default=0.7)
    p.add_argument("--val", type=float, default=0.15)
    p.add_argument("--test", type=float, default=0.15)
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--out", type=Path)
    args = p.parse_args(argv)
    ratios = {"train": args.train, "val": args.val, "test": args.test}
    if abs(sum(ratios.values()) - 1.0) > 1e-6:
        raise SystemExit("tỉ lệ train + val + test phải bằng 1")
    sessions = load_root(args.root)
    if not all_samples(sessions):
        raise SystemExit(f"{args.root}: không có mẫu")
    result = make_splits(sessions, ratios, args.seed)
    out = args.out or (args.root / "splits.json")
    write_json(out, result)
    with open(out.with_suffix(".csv"), "w", encoding="utf-8", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "split"])
        for sid, sp in sorted(result["bySample"].items()):
            w.writerow([sid, sp])
    for k in SPLITS:
        r = result[k]
        print(f"{k}: {len(r['subjects'])} subject, {len(r['sessions'])} phiên, {r['samples']} mẫu")
    print(f"đã ghi {out} và {out.with_suffix('.csv')}; không rò rỉ session hay subject giữa các tập")
    return 0


if __name__ == "__main__":
    sys.exit(main())
