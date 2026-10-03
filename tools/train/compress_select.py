"""CLS-04 (D-066): cổng chất lượng và lựa chọn model nén, chỉ dùng thư viện chuẩn (CI chạy test_compress.py không cần
numpy, onnx hay torch). compress.py (phụ thuộc nặng) đổi mảng logits thành list rồi gọi các hàm ở đây, nên một nguồn
duy nhất quyết định model nào được ship.

Model nén chỉ đổi cách LƯU trọng số (int8 theo kênh hay fp16 + Cast/Mul); ONNX Runtime gập chúng về fp32 lúc tạo
session, nên phép tính giống fp32 và sai khác chỉ đến từ việc làm tròn trọng số. Cổng so logits của model nén với fp32
trên bộ đầu vào gồm mẫu thật, bản augment giữ lại (seed khác huấn luyện), ảnh spike ngoài dataset và ảnh trộn
person ↔ mannequin (để xác suất đi qua ngưỡng 0,7 thay vì bão hòa ở 0 hay 1):
- argmax khớp 100 %;
- không lật nhãn hiển thị (quy tắc unknown 0,7 của app) trừ khi p của fp32 nằm trong ±0,01 quanh ngưỡng;
- |Δp(person)| tối đa ≤ 0,02;
- |Δ(l0 − l1)| tối đa ≤ 0,25 trên đầu vào giữ lại (thật, spike, trộn) và ≤ 0,5 trên bản augment.
"""

from __future__ import annotations

import math
from collections.abc import Sequence

UNKNOWN_THRESHOLD = 0.7

GATES = {
    "argmax": 1.0,
    "flipBand": 0.01,
    "maxAbsDp": 0.02,
    "maxAbsDMarginHeld": 0.25,
    "maxAbsDMarginAug": 0.5,
    "sizeTie": 0.05,
}


def softmax(z: Sequence[float]) -> list[float]:
    m = max(z)
    e = [math.exp(v - m) for v in z]
    s = sum(e)
    return [v / s for v in e]


def shown(probs: Sequence[float], threshold: float = UNKNOWN_THRESHOLD) -> int:
    """Nhãn hiển thị như subjectRule của app (không xét cỡ ROI): -1 là unknown, không thì chỉ số lớp."""
    best = max(range(len(probs)), key=lambda i: probs[i])
    return -1 if probs[best] < threshold else best


def agreement(
    ref: Sequence[Sequence[float]],
    cand: Sequence[Sequence[float]],
    tags: Sequence[str],
    gates: dict | None = None,
) -> dict:
    """So logits của model nén (cand) với fp32 (ref) theo từng đầu vào; tag 'aug' là bản augment, còn lại là giữ lại."""
    g = {**GATES, **(gates or {})}
    if not (len(ref) == len(cand) == len(tags)):
        raise ValueError("ref, cand, tags phải cùng độ dài")
    argmax = flips = 0
    dp = dm_held = dm_aug = 0.0
    n_aug = n_border = 0
    for r, c, t in zip(ref, cand, tags):
        pr, pc = softmax(r), softmax(c)
        argmax += int(max(range(len(pr)), key=lambda i: pr[i]) == max(range(len(pc)), key=lambda i: pc[i]))
        in_band = abs(max(pr) - UNKNOWN_THRESHOLD) <= g["flipBand"]
        n_border += int(abs(max(pr) - UNKNOWN_THRESHOLD) <= 0.15)
        if shown(pr) != shown(pc) and not in_band:
            flips += 1
        dp = max(dp, abs(pc[0] - pr[0]))
        dm = abs((c[0] - c[1]) - (r[0] - r[1]))
        if t == "aug":
            n_aug += 1
            dm_aug = max(dm_aug, dm)
        else:
            dm_held = max(dm_held, dm)
    n = len(tags)
    return {
        "n": n,
        "nHeld": n - n_aug,
        "nAug": n_aug,
        "nBorderline": n_border,
        "argmax": argmax / n if n else 0.0,
        "decisionFlips": flips,
        "maxAbsDp": dp,
        "maxAbsDMarginHeld": dm_held,
        "maxAbsDMarginAug": dm_aug,
    }


def passes(a: dict, gates: dict | None = None) -> tuple[bool, list[str]]:
    """(đạt, lý do trượt). fp32 so với chính nó luôn đạt."""
    g = {**GATES, **(gates or {})}
    why = []
    if a["argmax"] < g["argmax"]:
        why.append(f"argmax {a['argmax']:.4f} < {g['argmax']}")
    if a["decisionFlips"] > 0:
        why.append(f"{a['decisionFlips']} lần lật nhãn hiển thị ngoài ±{g['flipBand']} quanh {UNKNOWN_THRESHOLD}")
    if a["maxAbsDp"] > g["maxAbsDp"]:
        why.append(f"max|Δp| {a['maxAbsDp']:.4f} > {g['maxAbsDp']}")
    if a["maxAbsDMarginHeld"] > g["maxAbsDMarginHeld"]:
        why.append(f"max|Δmargin| giữ lại {a['maxAbsDMarginHeld']:.4f} > {g['maxAbsDMarginHeld']}")
    if a["maxAbsDMarginAug"] > g["maxAbsDMarginAug"]:
        why.append(f"max|Δmargin| augment {a['maxAbsDMarginAug']:.4f} > {g['maxAbsDMarginAug']}")
    return (not why, why)


def choose(candidates: Sequence[dict], gates: dict | None = None) -> dict:
    """Ứng viên đạt cổng có ít byte nhất; cỡ chênh dưới sizeTie thì chọn max|Δmargin| nhỏ hơn. Mỗi ứng viên là
    {'mode', 'bytes', 'agreement'}; phải có mode 'none' (fp32) làm dự phòng."""
    g = {**GATES, **(gates or {})}
    ok = [c for c in candidates if c["mode"] == "none" or passes(c["agreement"], g)[0]]
    if not any(c["mode"] == "none" for c in ok):
        raise ValueError("thiếu ứng viên fp32 (mode 'none') làm dự phòng")
    ok.sort(key=lambda c: c["bytes"])
    best = ok[0]
    for c in ok[1:]:
        if c["bytes"] > best["bytes"] * (1 + g["sizeTie"]):
            break
        if c["agreement"]["maxAbsDMarginHeld"] < best["agreement"]["maxAbsDMarginHeld"]:
            best = c
    return best


def speed_ok(c: dict, fp32: dict) -> tuple[bool, str]:
    """Model nén gập về đồ thị fp32 nên tốc độ phải ngang fp32 (đo trên wasm, check_wasm.mjs): trượt chỉ khi CẢ p50 >
    1,25× VÀ p95 > 1,5× của fp32 (một chỉ số lệch là nhiễu của máy), hay khởi tạo chậm hơn fp32 quá 150 ms."""
    p50 = c["p50Ms"] > 1.25 * fp32["p50Ms"]
    p95 = c["p95Ms"] > 1.5 * fp32["p95Ms"]
    init = c["initMs"] > fp32["initMs"] + 150
    if (p50 and p95) or init:
        return False, (
            f"p50 {c['p50Ms']:.2f} / p95 {c['p95Ms']:.2f} ms, init {c['initMs']:.0f} ms so với fp32 "
            f"{fp32['p50Ms']:.2f} / {fp32['p95Ms']:.2f} ms, {fp32['initMs']:.0f} ms"
        )
    return True, ""


def _r(v: float) -> float | int:
    """Làm tròn 4 chữ số; số nguyên ghi là int và không có -0.0: JSON giống hệt khi fetch-models.mjs ghi lại models.json
    bằng JSON.stringify (1.0 thành 1), nên khóa cache model của service worker không đổi oan."""
    x = round(float(v), 4)
    return int(x) if x == int(x) else x


def manifest_block(mode: str, fp32_sha256: str, fp32_bytes: int, layers: dict, a: dict) -> dict:
    """Mục `compression` của models.json: chỉ trường tất định (không thời gian, không tên máy, không id mẫu)."""
    return {
        "mode": mode,
        "fp32Sha256": fp32_sha256,
        "fp32Bytes": int(fp32_bytes),
        "layers": {k: int(v) for k, v in layers.items()},
        "agreement": {
            "n": int(a["n"]),
            "nHeld": int(a["nHeld"]),
            "nAug": int(a["nAug"]),
            "nBorderline": int(a["nBorderline"]),
            "argmax": _r(a["argmax"]),
            "decisionFlips": int(a["decisionFlips"]),
            "maxAbsDp": _r(a["maxAbsDp"]),
            "maxAbsDMarginHeld": _r(a["maxAbsDMarginHeld"]),
            "maxAbsDMarginAug": _r(a["maxAbsDMarginAug"]),
        },
    }
