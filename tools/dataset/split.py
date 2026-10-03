#!/usr/bin/env python3
"""CLS-01 bước 5, CLS-03: chia train/val/test theo subjectId (mọi phiên của một người hay hình nộm nằm trong cùng một
tập), phân tầng theo lớp.

  python tools/dataset/split.py <root> [--train 0.7 --val 0.15 --test 0.15] [--seed 1] [--out <root>/splits.json]

Lớp của subject là nhãn chiếm đa số trong các mẫu của nó. Mỗi lớp chia riêng (CLS-03, D-061), để val và test có cả
người lẫn hình nộm khi đủ subject:
- lớp model học (person, mannequin): subject nhiều mẫu nhất vào train, rồi test, rồi val; sau đó tham lam vào tập thiếu
  nhiều nhất so với tỉ lệ. Lớp chỉ có một subject nằm trọn trong train (không có nó thì model không học được lớp đó).
- lớp chỉ dùng khi đánh giá (unknown, background; tools/train bỏ qua khi huấn luyện): chỉ vào test rồi val, theo tỉ lệ
  val : test, vì mẫu của chúng trong train không được dùng.
Lớp model học mà vắng ở val hay test thì in cảnh báo và ghi vào splits.json (`warnings`): recall của lớp đó trên tập
ấy không đo được, và train.py chọn checkpoint cuối thay vì theo val.

Ghi splits.json (subject, session, số mẫu và số mẫu theo nhãn mỗi tập, lớp của từng subject) và splits.csv (id, split).
Kiểm rò rỉ: không session hay subject nào ở hai tập; thoát 1 nếu vi phạm. Tách theo subject đủ để không rò rỉ theo
session; kiểm cả hai cho chắc.
"""

from __future__ import annotations

import argparse
import csv
import random
import sys
from collections import Counter, defaultdict
from pathlib import Path

from common import utf8_console, LABELS, SPLITS, Session, all_samples, load_root, write_json

# Lớp mà tools/train/dataset.py đưa vào huấn luyện (CLASSES); các nhãn khác chỉ dùng khi đánh giá.
TRAIN_CLASSES = ("person", "mannequin")
TRAIN_ORDER = ("train", "test", "val")
EVAL_ORDER = ("test", "val")


def subject_classes(sessions: list[Session]) -> dict[str, str]:
    """Nhãn đa số của mỗi subject; hòa thì theo thứ tự LABELS (person, mannequin, unknown, background)."""
    votes: dict[str, Counter] = defaultdict(Counter)
    for s in all_samples(sessions):
        votes[s.subject_id][s.label] += 1
    rank = {label: i for i, label in enumerate(LABELS)}
    return {
        subj: max(c, key=lambda label: (c[label], -rank.get(label, len(LABELS))))
        for subj, c in votes.items()
    }


def assign_group(
    subjects: list[str], counts: dict[str, int], ratios: dict[str, float], order: tuple[str, ...], rng: random.Random
) -> dict[str, str]:
    """Tham lam trong một lớp: subject nhiều mẫu trước; mỗi tập trong `order` nhận một subject đầu, sau đó subject vào
    tập thiếu nhiều nhất so với mục tiêu (tỉ lệ chuẩn hóa trên các tập của `order`); cùng cỡ thì xáo theo seed."""
    splits = [k for k in order if ratios.get(k, 0) > 0]
    ordered = sorted(subjects)
    rng.shuffle(ordered)
    ordered.sort(key=lambda s: -counts[s])
    total = sum(counts[s] for s in ordered)
    weight = sum(ratios[k] for k in splits)
    current = {k: 0 for k in splits}
    out: dict[str, str] = {}
    for i, subj in enumerate(ordered):
        if i < len(splits):
            best = splits[i]
        else:
            best = max(splits, key=lambda k: ratios[k] / weight * total - current[k])
        out[subj] = best
        current[best] += counts[subj]
    return out


def assign_subjects(
    counts: dict[str, int], ratios: dict[str, float], seed: int, classes: dict[str, str]
) -> dict[str, str]:
    """Chia từng lớp riêng (thứ tự lớp cố định theo LABELS để kết quả tất định theo seed)."""
    rng = random.Random(seed)
    groups: dict[str, list[str]] = defaultdict(list)
    for subj in counts:
        groups[classes[subj]].append(subj)
    rank = {label: i for i, label in enumerate(LABELS)}
    out: dict[str, str] = {}
    for cls in sorted(groups, key=lambda c: (rank.get(c, len(LABELS)), c)):
        order = TRAIN_ORDER if cls in TRAIN_CLASSES else EVAL_ORDER
        out.update(assign_group(groups[cls], counts, ratios, order, rng))
    return out


def coverage_warnings(subject_split: dict[str, str], classes: dict[str, str], ratios: dict[str, float]) -> list[str]:
    """Lớp model học mà vắng ở một tập có tỉ lệ > 0."""
    warnings: list[str] = []
    for cls in TRAIN_CLASSES:
        subjects = [s for s in subject_split if classes[s] == cls]
        if not subjects:
            warnings.append(f"không có subject {cls}: model không học được lớp này")
            continue
        present = {subject_split[s] for s in subjects}
        missing = [sp for sp in SPLITS if ratios.get(sp, 0) > 0 and sp not in present]
        if missing:
            warnings.append(
                f"{cls}: {len(subjects)} subject, không có ở {', '.join(missing)}: recall của {cls} trên "
                f"{', '.join(missing)} không đo được; cần thêm subject {cls} (ít nhất 3 để mỗi tập có một)"
            )
    return warnings


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
    classes = subject_classes(sessions)
    subject_split = assign_subjects(counts, ratios, seed, classes)
    errors = verify_no_leak(sessions, subject_split)
    if errors:
        raise SystemExit("rò rỉ: " + "; ".join(errors))
    result: dict = {
        "seed": seed,
        "ratios": ratios,
        "stratified": True,
        "classes": dict(sorted(classes.items())),
        "warnings": coverage_warnings(subject_split, classes, ratios),
        "bySample": {},
    }
    for k in SPLITS:
        result[k] = {"subjects": [], "sessions": [], "samples": 0, "byLabel": {label: 0 for label in LABELS}}
    for subj in sorted(subject_split):
        result[subject_split[subj]]["subjects"].append(subj)
    for ses in sessions:
        if not ses.samples:
            continue
        sp = subject_split[ses.samples[0].subject_id]
        result[sp]["sessions"].append(ses.id)
        for s in ses.samples:
            result[sp]["samples"] += 1
            result[sp]["byLabel"][s.label] = result[sp]["byLabel"].get(s.label, 0) + 1
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
        labels = ", ".join(f"{label} {n}" for label, n in r["byLabel"].items() if n)
        print(f"{k}: {len(r['subjects'])} subject, {len(r['sessions'])} phiên, {r['samples']} mẫu ({labels or '-'})")
    for w in result["warnings"]:
        print(f"CẢNH BÁO {w}", file=sys.stderr)
    print(f"đã ghi {out} và {out.with_suffix('.csv')}; không rò rỉ session hay subject giữa các tập")
    return 0


if __name__ == "__main__":
    sys.exit(main())
