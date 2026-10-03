#!/usr/bin/env python3
"""Kiểm thử cổng và lựa chọn model nén CLS-04 (mục 7.38): python -m unittest discover -s tools/train -p "test_*.py".
Chỉ thư viện chuẩn (CI không có numpy, onnx hay torch)."""

from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from compress_select import agreement, choose, manifest_block, passes, shown, speed_ok  # noqa: E402
from export_onnx import js_stable, update_manifest  # noqa: E402


def logit_for(p_person: float) -> list[float]:
    """Logits [l0, l1] có softmax p(person) = p_person (l1 = 0)."""
    import math

    return [math.log(p_person / (1 - p_person)), 0.0]


class AgreementTest(unittest.TestCase):
    def test_identical_is_perfect(self) -> None:
        ref = [logit_for(0.9), logit_for(0.2), logit_for(0.5)]
        a = agreement(ref, ref, ["real:train", "aug", "blend:0.5"])
        self.assertEqual((a["n"], a["nHeld"], a["nAug"]), (3, 2, 1))
        self.assertEqual(a["argmax"], 1.0)
        self.assertEqual(a["decisionFlips"], 0)
        self.assertEqual((a["maxAbsDp"], a["maxAbsDMarginHeld"], a["maxAbsDMarginAug"]), (0.0, 0.0, 0.0))
        self.assertTrue(passes(a)[0])

    def test_flip_across_threshold_counts_outside_the_band(self) -> None:
        # 0,72 → 0,68: cùng argmax nhưng nhãn hiển thị đổi person → unknown; p của fp32 cách 0,7 hơn 0,01 → lật.
        a = agreement([logit_for(0.72)], [logit_for(0.68)], ["spike:x"])
        self.assertEqual(a["argmax"], 1.0)
        self.assertEqual(a["decisionFlips"], 1)
        ok, why = passes(a)
        self.assertFalse(ok)
        self.assertTrue(any("lật" in w for w in why))

    def test_flip_inside_the_band_is_tolerated(self) -> None:
        # p fp32 0,705 nằm trong ±0,01 quanh 0,7: lật sang 0,695 không tính.
        a = agreement([logit_for(0.705)], [logit_for(0.695)], ["blend:0.4"])
        self.assertEqual(a["decisionFlips"], 0)

    def test_margin_gate_is_stricter_on_held_out_than_on_augment(self) -> None:
        ref = [[6.0, 0.0], [6.0, 0.0]]  # p bão hòa: Δp nhỏ, chỉ cổng margin quyết định
        cand = [[6.0, 0.0], [6.4, 0.0]]  # Δmargin 0,4 trên mẫu thứ hai
        self.assertTrue(passes(agreement(ref, cand, ["real:val", "aug"]))[0])
        ok, why = passes(agreement(ref, cand, ["real:val", "spike:y"]))
        self.assertFalse(ok)
        self.assertTrue(any("giữ lại" in w for w in why))

    def test_argmax_change_fails_on_its_own(self) -> None:
        # p 0,501 → 0,499: cả hai đều unknown (không lật nhãn), Δp 0,002, Δmargin 0,008: chỉ cổng argmax bắt được.
        a = agreement([[0.004, 0.0]], [[-0.004, 0.0]], ["blend:0.5"])
        self.assertEqual(a["argmax"], 0.0)
        self.assertEqual(a["decisionFlips"], 0)
        ok, why = passes(a)
        self.assertFalse(ok)
        self.assertEqual(len(why), 1)
        self.assertTrue(why[0].startswith("argmax"))

    def test_lengths_must_match(self) -> None:
        with self.assertRaises(ValueError):
            agreement([[1.0, 0.0]], [], ["real:train"])

    def test_shown_matches_the_unknown_rule(self) -> None:
        self.assertEqual(shown([0.93, 0.07]), 0)
        self.assertEqual(shown([0.2, 0.8]), 1)
        self.assertEqual(shown([0.69, 0.31]), -1)


class ChooseTest(unittest.TestCase):
    def cand(self, mode: str, size: int, dm: float = 0.0, ok: bool = True) -> dict:
        a = {"n": 1, "nHeld": 1, "nAug": 0, "nBorderline": 0, "argmax": 1.0 if ok else 0.5, "decisionFlips": 0,
             "maxAbsDp": 0.0, "maxAbsDMarginHeld": dm, "maxAbsDMarginAug": 0.0}
        return {"mode": mode, "bytes": size, "agreement": a}

    def test_smallest_passing_wins(self) -> None:
        best = choose([self.cand("none", 6000), self.cand("fp16w", 3000), self.cand("int8+fp16w", 2000)])
        self.assertEqual(best["mode"], "int8+fp16w")

    def test_failing_candidates_are_skipped_and_fp32_is_the_fallback(self) -> None:
        self.assertEqual(choose([self.cand("none", 6000), self.cand("int8+fp16w", 2000, ok=False)])["mode"], "none")

    def test_size_tie_prefers_smaller_margin_error(self) -> None:
        best = choose([self.cand("none", 6000), self.cand("a", 2000, dm=0.2), self.cand("b", 2050, dm=0.05)])
        self.assertEqual(best["mode"], "b")

    def test_requires_fp32(self) -> None:
        with self.assertRaises(ValueError):
            choose([self.cand("fp16w", 3000)])

    def test_speed_gate_needs_both_quantiles_or_a_slow_init(self) -> None:
        fp32 = {"p50Ms": 4.0, "p95Ms": 8.0, "initMs": 20.0}
        self.assertTrue(speed_ok({"p50Ms": 5.5, "p95Ms": 8.0, "initMs": 25.0}, fp32)[0])  # chỉ p50 lệch: nhiễu
        self.assertFalse(speed_ok({"p50Ms": 5.5, "p95Ms": 13.0, "initMs": 25.0}, fp32)[0])
        self.assertFalse(speed_ok({"p50Ms": 4.0, "p95Ms": 8.0, "initMs": 200.0}, fp32)[0])


class ManifestTest(unittest.TestCase):
    def test_block_is_deterministic_and_json_stable(self) -> None:
        a = {"n": 3, "nHeld": 2, "nAug": 1, "nBorderline": 1, "argmax": 1.0, "decisionFlips": 0,
             "maxAbsDp": 0.0170000001, "maxAbsDMarginHeld": 0.21983, "maxAbsDMarginAug": -0.0}
        b = manifest_block("int8+fp16w", "a" * 64, 6089235, {"int8": 15, "fp16": 32}, a)
        self.assertEqual(b["agreement"]["argmax"], 1)
        self.assertIsInstance(b["agreement"]["argmax"], int)
        self.assertEqual(b["agreement"]["maxAbsDp"], 0.017)
        self.assertEqual(b["agreement"]["maxAbsDMarginHeld"], 0.2198)
        self.assertEqual(b["agreement"]["maxAbsDMarginAug"], 0)
        self.assertNotIn("e-", json.dumps(b))
        self.assertEqual(set(b), {"mode", "fp32Sha256", "fp32Bytes", "layers", "agreement"})

    def test_js_stable_turns_integral_floats_into_ints(self) -> None:
        self.assertEqual(js_stable({"a": 1.0, "b": [2.0, 0.5], "c": {"d": 3.0}}), {"a": 1, "b": [2, 0.5], "c": {"d": 3}})

    def test_update_manifest_writes_and_pops_compression(self) -> None:
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / "models.json"
            p.write_text(json.dumps({"classifier": {"note": "n", "stub": "s.onnx", "source": "",
                                                    "compression": {"mode": "fp16w"}}}), encoding="utf-8")
            info = {"file": "classifier.onnx", "sha256": "b" * 64, "bytes": 10, "inputSize": 128,
                    "labels": ["person", "mannequin"], "norm": {"mean": 0.45, "std": 0.225}, "opset": 17,
                    "train": {"valAcc": 1.0}}
            update_manifest(p, info)
            c = json.loads(p.read_text(encoding="utf-8"))["classifier"]
            self.assertNotIn("compression", c)  # export fp32 xóa mục cũ
            self.assertEqual(c["train"]["valAcc"], 1)
            self.assertEqual(list(c)[:3], ["note", "stub", "source"])  # giữ thứ tự khóa cũ
            update_manifest(p, {**info, "compression": {"mode": "int8+fp16w", "agreement": {"argmax": 1.0}}})
            c = json.loads(p.read_text(encoding="utf-8"))["classifier"]
            self.assertEqual(c["compression"]["mode"], "int8+fp16w")
            self.assertEqual(c["compression"]["agreement"]["argmax"], 1)


if __name__ == "__main__":
    unittest.main()
