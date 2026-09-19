#!/usr/bin/env python3
"""Kiểm thử metric CLS-02 (mục 7.3, 7.23): python -m unittest discover -s tools/train -p "test_*.py"."""

from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from metrics import apply_unknown_rule, by_group, meets_target, precision_recall, rates, render_markdown  # noqa: E402


def rec(label: str, pred: str, prob: float = 0.9, **extra) -> dict:
    return {"label": label, "pred": pred, "prob": prob, **extra}


class MetricsTest(unittest.TestCase):
    def test_unknown_rule_matches_app(self) -> None:
        self.assertEqual(apply_unknown_rule([0.93, 0.07]), ("person", 0.93))
        self.assertEqual(apply_unknown_rule([0.2, 0.8]), ("mannequin", 0.8))
        self.assertEqual(apply_unknown_rule([0.69, 0.31]), ("unknown", 0.69))
        self.assertEqual(apply_unknown_rule([0.99, 0.01], roi_short_px=95), ("unknown", 0.99))
        self.assertEqual(apply_unknown_rule([0.99, 0.01], roi_short_px=96), ("person", 0.99))

    def test_precision_recall_unknown_counts_as_missed_recall(self) -> None:
        records = [
            rec("person", "person"), rec("person", "person"), rec("person", "unknown"), rec("person", "mannequin"),
            rec("mannequin", "mannequin"), rec("mannequin", "person"), rec("mannequin", "mannequin"),
            rec("background", "unknown"), rec("background", "person"),
        ]
        pr = precision_recall(records)
        self.assertEqual(pr["person"]["tp"], 2)
        self.assertEqual(pr["person"]["fn"], 2)  # unknown và gán sai
        self.assertEqual(pr["person"]["fp"], 2)  # hình nộm→người và nền→người
        self.assertAlmostEqual(pr["person"]["precision"], 0.5)
        self.assertAlmostEqual(pr["person"]["recall"], 0.5)
        self.assertEqual(pr["mannequin"]["tp"], 2)
        self.assertEqual(pr["mannequin"]["fn"], 1)
        self.assertEqual(pr["mannequin"]["fp"], 1)
        self.assertAlmostEqual(pr["mannequin"]["recall"], 2 / 3)
        self.assertFalse(meets_target(pr))
        r = rates(records)
        self.assertEqual(r["n"], 9)
        self.assertAlmostEqual(r["mannequinAsPersonRate"], 1 / 3)
        self.assertAlmostEqual(r["unknownRate"], 2 / 9)

    def test_target_and_groups_and_markdown(self) -> None:
        records = [rec("person", "person", sizeClass="small", position="center")] * 10 + [
            rec("mannequin", "mannequin", sizeClass="large", position="edge", mannequinType="silicone")
        ] * 10 + [rec("mannequin", "person", sizeClass="large", position="edge", mannequinType="silicone")]
        pr = precision_recall(records)
        self.assertTrue(meets_target(pr))
        groups = by_group(records, "sizeClass")
        self.assertEqual(set(groups), {"small", "large"})
        self.assertEqual(groups["small"]["n"], 10)
        self.assertAlmostEqual(groups["large"]["mannequinAsPersonRate"], 1 / 11)
        md = render_markdown(records, "Thử")
        self.assertIn("### Thử: 21 mẫu", md)
        self.assertIn("| person | 0.909 | 1.000 | 10 | 1 | 0 | 10 |", md)
        self.assertIn("đạt", md)
        self.assertIn("#### Theo loại hình nộm", md)
        self.assertIn("| silicone |", md)


if __name__ == "__main__":
    unittest.main()
