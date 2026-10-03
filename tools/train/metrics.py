#!/usr/bin/env python3
"""CLS-02: metric phân loại theo mục 7.3 của WORK-BREAKDOWN, thuần Python (không numpy) để unittest chạy trong CI.

Đầu vào: danh sách bản ghi {label, pred, prob, sizeClass, position, mannequinType} với label là nhãn thật
(person, mannequin, unknown, background), pred là nhãn sau quy tắc unknown (person, mannequin, unknown) và prob là
max(prob). Precision và recall từng lớp: unknown và miss tính vào thiếu recall của lớp thật; precision tính trên các dự
đoán đã gán nhãn. CLS-03: lớp không có mẫu nào trong tập (support 0) có recall None, lớp không được dự đoán lần nào có
precision None; bảng in "n/a" và chỉ tiêu ghi "not measurable" thay vì 0.000 và "fail".
"""

from __future__ import annotations

from collections import Counter, defaultdict

CLASSES = ("person", "mannequin")
UNKNOWN_THRESHOLD = 0.7


def apply_unknown_rule(probs: list[float], threshold: float = UNKNOWN_THRESHOLD, roi_short_px: int | None = None,
                       min_roi_px: int = 96) -> tuple[str, float]:
    """Cùng quy tắc với src/classify/subjectRule.ts (không có phần mặt partial vì dataset không có landmark)."""
    best = max(range(len(probs)), key=lambda i: probs[i])
    conf = probs[best]
    if roi_short_px is not None and roi_short_px < min_roi_px:
        return "unknown", conf
    if conf < threshold:
        return "unknown", conf
    return CLASSES[best], conf


def precision_recall(records: list[dict]) -> dict[str, dict[str, float | int]]:
    tp: Counter = Counter()
    fp: Counter = Counter()
    fn: Counter = Counter()
    for r in records:
        y, p = r["label"], r["pred"]
        if y in CLASSES:
            if p == y:
                tp[y] += 1
            else:
                fn[y] += 1  # unknown hay nhãn sai đều là thiếu recall
                if p in CLASSES:
                    fp[p] += 1
        elif p in CLASSES:
            fp[p] += 1  # nền hay chưa rõ mà được gán nhãn
    out: dict[str, dict[str, float | int]] = {}
    for c in CLASSES:
        prec_den = tp[c] + fp[c]
        rec_den = tp[c] + fn[c]
        out[c] = {
            "tp": tp[c],
            "fp": fp[c],
            "fn": fn[c],
            "precision": tp[c] / prec_den if prec_den else None,
            "recall": tp[c] / rec_den if rec_den else None,
            "support": rec_den,
        }
    return out


def rates(records: list[dict]) -> dict[str, float | int | None]:
    mann = [r for r in records if r["label"] == "mannequin"]
    mann_as_person = sum(1 for r in mann if r["pred"] == "person")
    unknown = sum(1 for r in records if r["pred"] == "unknown")
    return {
        "n": len(records),
        "mannequinAsPersonRate": mann_as_person / len(mann) if mann else None,
        "unknownRate": unknown / len(records) if records else 0.0,
    }


def by_group(records: list[dict], key: str) -> dict[str, dict]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for r in records:
        groups[str(r.get(key, "?"))].append(r)
    return {g: {"pr": precision_recall(rs), **rates(rs)} for g, rs in sorted(groups.items())}


def measurable(pr: dict[str, dict]) -> list[str]:
    """Lớp không có mẫu thật trong tập: recall không đo được nên chỉ tiêu không kết luận được."""
    return [c for c in CLASSES if not pr[c]["support"]]


def meets_target(pr: dict[str, dict], target: float = 0.9) -> bool:
    """Đạt khi cả hai lớp có mẫu và precision, recall đều ≥ target (precision None: chưa dự đoán lần nào, không đạt)."""
    return all(
        pr[c]["precision"] is not None
        and pr[c]["recall"] is not None
        and pr[c]["precision"] >= target
        and pr[c]["recall"] >= target
        for c in CLASSES
    )


def fmt(v: float | None) -> str:
    return "n/a" if v is None else f"{v:.3f}"


def render_markdown(records: list[dict], title: str = "Test set") -> str:
    pr = precision_recall(records)
    rt = rates(records)
    lines = [f"### {title}: {rt['n']} samples", "", "| Class | Precision | Recall | TP | FP | FN | Support |", "|---|---|---|---|---|---|---|"]
    for c in CLASSES:
        m = pr[c]
        lines.append(f"| {c} | {fmt(m['precision'])} | {fmt(m['recall'])} | {m['tp']} | {m['fp']} | {m['fn']} | {m['support']} |")
    lines.append("")
    missing = measurable(pr)
    verdict = (
        f"not measurable (no {', '.join(missing)} samples in this split)" if missing else "pass" if meets_target(pr) else "fail"
    )
    lines.append(f"Target ≥ 0.90 for both precision and recall of both classes: {verdict}. "
                 f"Mannequins labelled as person: {fmt(rt['mannequinAsPersonRate'])}; unknown rate: {fmt(rt['unknownRate'])}.")
    for key, label in (("sizeClass", "By window size"), ("position", "By position (edge cropping)"), ("mannequinType", "By mannequin type (silicone reported separately)")):
        groups = by_group(records, key)
        if len(groups) <= 1 and "?" in groups:
            continue
        lines += ["", f"#### {label}", "", "| Group | Samples | P person | R person | P mannequin | R mannequin | Mannequin→person | Unknown |", "|---|---|---|---|---|---|---|---|"]
        for g, m in groups.items():
            p = m["pr"]
            lines.append(
                f"| {g} | {m['n']} | {fmt(p['person']['precision'])} | {fmt(p['person']['recall'])} | "
                f"{fmt(p['mannequin']['precision'])} | {fmt(p['mannequin']['recall'])} | {fmt(m['mannequinAsPersonRate'])} | {fmt(m['unknownRate'])} |"
            )
    return "\n".join(lines)
