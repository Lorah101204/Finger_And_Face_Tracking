#!/usr/bin/env python3
"""CLS-05 (D-070, mục 7.42): face_crop_box của dataset.py cho đúng rect của faceCropRect trong app, trên cùng các ca của
tests/unit/fixtures/face-crop-cases.json; classifier_view giữ cả crop khi mẫu không có bbox mặt hay crop="region".
Chỉ thư viện chuẩn: python -m unittest discover -s tools/train -p "test_*.py".
"""

from __future__ import annotations

import json
import random
import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dataset import FACE_CROP_SCALE, classifier_view, face_counts, face_crop_box, js_round  # noqa: E402

CASES = Path(__file__).resolve().parents[2] / "tests" / "unit" / "fixtures" / "face-crop-cases.json"


class FakeImage:
    """Đủ cho classifier_view: size và crop (không cần Pillow)."""

    def __init__(self, w: int, h: int):
        self.size = (w, h)
        self.cropped: tuple[int, int, int, int] | None = None

    def crop(self, box: tuple[int, int, int, int]) -> "FakeImage":
        out = FakeImage(box[2] - box[0], box[3] - box[1])
        out.cropped = box
        return out


class FaceCropTest(unittest.TestCase):
    def test_same_rects_as_the_app(self) -> None:
        cases = json.loads(CASES.read_text(encoding="utf-8"))["cases"]
        self.assertGreaterEqual(len(cases), 5)
        for c in cases:
            with self.subTest(c["name"]):
                self.assertEqual(face_crop_box(c["face"], c["bounds"], c["scale"]), c["want"])

    def test_js_round_differs_from_python_round_at_half(self) -> None:
        self.assertEqual(js_round(4.5), 5)
        self.assertEqual(round(4.5), 4)
        self.assertEqual(js_round(-2.5), -2)
        self.assertEqual(js_round(2.49), 2)

    def test_always_inside_bounds(self) -> None:
        bounds = {"x": 0, "y": 0, "w": 333, "h": 271}
        for x in range(-100, 400, 37):
            for y in range(-100, 300, 41):
                for s in (20, 90, 250, 500):
                    r = face_crop_box({"x": x, "y": y, "w": s, "h": s * 1.2}, bounds)
                    self.assertGreaterEqual(r["x"], 0)
                    self.assertGreaterEqual(r["y"], 0)
                    self.assertLessEqual(r["x"] + r["w"], 333)
                    self.assertLessEqual(r["y"] + r["h"], 271)
                    self.assertTrue(r["w"] > 0 and r["h"] > 0)

    def test_empty_inputs(self) -> None:
        self.assertIsNone(face_crop_box(None, {"x": 0, "y": 0, "w": 10, "h": 10}))
        self.assertIsNone(face_crop_box({"x": 0, "y": 0, "w": 0, "h": 5}, {"x": 0, "y": 0, "w": 10, "h": 10}))

    def test_classifier_view(self) -> None:
        self.assertEqual(FACE_CROP_SCALE, 1.6)
        img = FakeImage(400, 300)
        meta = {"face": {"x": 150, "y": 80, "w": 100, "h": 120}}
        view, box = classifier_view(img, meta, "face")
        self.assertEqual(box, {"x": 104, "y": 44, "w": 192, "h": 192})
        self.assertEqual(view.cropped, (104, 44, 296, 236))
        # Mẫu cũ (không có bbox mặt) hay crop="region": giữ cả crop.
        self.assertEqual(classifier_view(img, {}, "face"), (img, None))
        self.assertEqual(classifier_view(img, meta, "region"), (img, None))
        with self.assertRaises(ValueError):
            classifier_view(img, meta, "other")
        # Huấn luyện: bbox lệch nhẹ nhưng crop vẫn nằm trong ảnh và vẫn chứa phần lớn mặt.
        rng = random.Random(1)
        for _ in range(50):
            _, b = classifier_view(img, meta, "face", rng)
            self.assertTrue(0 <= b["x"] and b["x"] + b["w"] <= 400 and 0 <= b["y"] and b["y"] + b["h"] <= 300)
            self.assertTrue(b["x"] <= 200 <= b["x"] + b["w"] and b["y"] <= 140 <= b["y"] + b["h"])

    def test_face_counts(self) -> None:
        class S:
            def __init__(self, meta: dict):
                self.meta = meta

        self.assertEqual(face_counts([S({"face": {"x": 0}}), S({}), S({"face": None})]), {"face": 1, "regionOnly": 2})


if __name__ == "__main__":
    unittest.main()
