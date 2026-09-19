#!/usr/bin/env python3
"""Kiểm thử công cụ dataset (CLS-01, mục 7.22): python -m unittest discover -s tools/dataset -p "test_*.py".

Tạo dataset tạm đúng cấu trúc app ghi (PNG tối thiểu bằng zlib), rồi kiểm check (kể cả phát hiện frame gốc và thiếu
đồng ý), gán nhãn (set, from-dirs, csv), chia tập không rò rỉ và thống kê.
"""

from __future__ import annotations

import json
import shutil
import struct
import sys
import tempfile
import unittest
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import label as label_tool  # noqa: E402
import split as split_tool  # noqa: E402
import stats as stats_tool  # noqa: E402
from common import all_samples, check, load_root, png_size  # noqa: E402


def png_bytes(w: int, h: int) -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)

    raw = b"".join(b"\x00" + bytes([200, 100, 50]) * w for _ in range(h))
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


def make_session(root: Path, sid: str, subject: str, label: str, n: int, size: int = 200, **fields) -> None:
    d = root / sid
    d.mkdir(parents=True)
    session = {
        "sessionId": sid,
        "subjectId": subject,
        "label": label,
        "lighting": fields.get("lighting", "normal"),
        "mannequinType": fields.get("mannequinType", "none"),
        "note": "",
        "participantConsent": fields.get("consent", True),
        "startedAt": "2026-09-18T10:00:00.000Z",
        "stoppedAt": "2026-09-18T10:01:00.000Z",
        "samples": n,
        "app": {"consentVersion": "2026-09-17", "rateHz": 2, "grid": {"w": 64, "h": 36}, "camera": {"w": 1280, "h": 720}},
    }
    (d / "session.json").write_text(json.dumps(session), encoding="utf-8")
    for i in range(1, n + 1):
        sample_id = f"{sid}-{i:04d}"
        w = h = size
        if fields.get("full_frame") and i == 1:
            w, h = 1280, 720
        (d / f"{sample_id}.png").write_bytes(png_bytes(w, h))
        meta = {
            "id": sample_id,
            "sessionId": sid,
            "subjectId": subject,
            "label": label,
            "lighting": session["lighting"],
            "mannequinType": session["mannequinType"],
            "ts": 1000 + i,
            "capturedAt": "2026-09-18T10:00:01.000Z",
            "epoch": 1,
            "frameId": i,
            "taskId": i,
            "cameraRect": {"x": 100, "y": 100, "w": w, "h": h},
            "crop": {"w": w, "h": h},
            "cellsBox": {"w": 10, "h": 10},
            "cellCount": 100,
            "holes": 0,
            "n": 10,
            "sizeClass": "small" if size < 160 else "medium" if size < 320 else "large",
            "position": fields.get("position", "center"),
            "edges": [],
            "grid": {"w": 64, "h": 36},
            "mirror": True,
        }
        (d / f"{sample_id}.json").write_text(json.dumps(meta), encoding="utf-8")


class DatasetToolsTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="wct-dataset-"))
        self.root = self.tmp / "dataset"
        self.root.mkdir()
        make_session(self.root, "ses-a1", "S-1", "person", 6, size=200)
        make_session(self.root, "ses-a2", "S-1", "person", 4, size=340, lighting="dim")
        make_session(self.root, "ses-b1", "S-2", "mannequin", 5, size=120, mannequinType="plastic")
        make_session(self.root, "ses-c1", "S-3", "background", 3, size=200, position="edge")
        make_session(self.root, "ses-d1", "S-4", "unknown", 2, size=200)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_png_size_and_load(self) -> None:
        self.assertEqual(png_size(self.root / "ses-a1" / "ses-a1-0001.png"), (200, 200))
        sessions = load_root(self.root)
        self.assertEqual([s.id for s in sessions], ["ses-a1", "ses-a2", "ses-b1", "ses-c1", "ses-d1"])
        self.assertEqual(len(all_samples(sessions)), 20)
        self.assertEqual(check(sessions), [])

    def test_check_detects_full_frame_missing_consent_and_orphans(self) -> None:
        make_session(self.root, "ses-x1", "S-9", "person", 2, full_frame=True, consent=False)
        (self.root / "ses-x1" / "ses-x1-0002.png").unlink()
        (self.root / "ses-x1" / "orphan.png").write_bytes(png_bytes(50, 50))
        errors = check(load_root(self.root))
        joined = "\n".join(errors)
        self.assertIn("thiếu participantConsent", joined)
        self.assertIn("frame gốc?", joined)
        self.assertIn("thiếu ses-x1-0002.png", joined)
        self.assertIn("orphan.png: PNG không có JSON", joined)
        self.assertEqual(label_tool.main(["check", str(self.root)]), 1)

    def test_label_set_from_dirs_csv(self) -> None:
        self.assertEqual(label_tool.main(["set", str(self.root), "--label", "mannequin", "ses-d1-0001"]), 0)
        meta = json.loads((self.root / "ses-d1" / "ses-d1-0001.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["labelFinal"], "mannequin")
        self.assertEqual(meta["label"], "unknown")
        labels = self.root / "_labels" / "background"
        labels.mkdir(parents=True)
        shutil.copy(self.root / "ses-d1" / "ses-d1-0002.png", labels / "ses-d1-0002.png")
        (labels / "khong-co.png").write_bytes(png_bytes(8, 8))
        self.assertEqual(label_tool.main(["from-dirs", str(self.root)]), 0)
        meta2 = json.loads((self.root / "ses-d1" / "ses-d1-0002.json").read_text(encoding="utf-8"))
        self.assertEqual(meta2["labelFinal"], "background")
        # _labels/ không có session.json nên không bị đọc như phiên.
        self.assertEqual(len(load_root(self.root)), 5)
        self.assertEqual(label_tool.main(["csv", str(self.root)]), 0)
        rows = (self.root / "labels.csv").read_text(encoding="utf-8").splitlines()
        self.assertEqual(rows[0], "id,sessionId,subjectId,label,labelFinal,sizeClass,lighting,mannequinType,position,n,w,h")
        self.assertEqual(len(rows), 21)
        self.assertIn("ses-d1-0001,ses-d1,S-4,unknown,mannequin,medium,normal,none,center,10,200,200", rows)
        with self.assertRaises(SystemExit):
            label_tool.main(["set", str(self.root), "--label", "person", "khong-co"])

    def test_split_no_leak_and_all_assigned(self) -> None:
        sessions = load_root(self.root)
        result = split_tool.make_splits(sessions, {"train": 0.7, "val": 0.15, "test": 0.15}, seed=1)
        assigned = result["bySample"]
        self.assertEqual(len(assigned), 20)
        # Hai phiên của S-1 ở cùng tập; mỗi tập có ít nhất một subject.
        self.assertEqual(assigned["ses-a1-0001"], assigned["ses-a2-0001"])
        for sp in ("train", "val", "test"):
            self.assertGreaterEqual(len(result[sp]["subjects"]), 1)
        self.assertEqual(sum(result[sp]["samples"] for sp in ("train", "val", "test")), 20)
        # Subject nhiều mẫu nhất (S-1, 10 mẫu) vào train.
        self.assertIn("S-1", result["train"]["subjects"])
        # Rò rỉ giả: cùng subject ở hai tập phải bị phát hiện.
        leak = {"S-1": "train", "S-2": "val", "S-3": "test", "S-4": "train"}
        self.assertEqual(split_tool.verify_no_leak(sessions, leak), [])
        sessions[1].samples[0].meta["subjectId"] = "S-2"
        errors = split_tool.verify_no_leak(sessions, leak)
        self.assertTrue(any("phiên ses-a2" in e for e in errors))
        # Lệnh đầy đủ ghi splits.json và splits.csv.
        self.assertEqual(split_tool.main([str(self.root), "--seed", "3"]), 0)
        self.assertTrue((self.root / "splits.json").exists())
        self.assertEqual(len((self.root / "splits.csv").read_text(encoding="utf-8").splitlines()), 21)

    def test_stats_markdown_and_doc(self) -> None:
        split_tool.main([str(self.root)])
        sessions = load_root(self.root)
        body = stats_tool.render(all_samples(sessions), len(sessions), json.loads((self.root / "splits.json").read_text()))
        self.assertIn("| person | 10 | 1 | 2 |", body)
        self.assertIn("| mannequin | 5 | 1 | 1 |", body)
        self.assertIn("### Cỡ cửa sổ", body)
        self.assertIn("| tổng | 5 | 11 | 4 | 20 |", body)  # small, medium, large
        self.assertIn("### Theo tập", body)
        doc = self.tmp / "dataset.md"
        doc.write_text("# x\n\n<!-- dataset:begin -->\ncũ\n<!-- dataset:end -->\n\nsau\n", encoding="utf-8")
        self.assertEqual(stats_tool.main([str(self.root), "--doc", str(doc)]), 0)
        text = doc.read_text(encoding="utf-8")
        self.assertNotIn("cũ", text)
        self.assertIn("| person | 10 | 1 | 2 |", text)
        self.assertTrue(text.endswith("<!-- dataset:end -->\n\nsau\n"))


if __name__ == "__main__":
    unittest.main()
