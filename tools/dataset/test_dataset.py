#!/usr/bin/env python3
"""Kiểm thử công cụ dataset (CLS-01, mục 7.22): python -m unittest discover -s tools/dataset -p "test_*.py".

Tạo dataset tạm đúng cấu trúc app ghi (PNG tối thiểu bằng zlib), rồi kiểm check (kể cả phát hiện frame gốc và thiếu
đồng ý), gán nhãn (set, from-dirs, csv), chia tập không rò rỉ và thống kê. CLS-03: nhập zip của app (import_zip.py) và
chia phân tầng theo lớp.
"""

from __future__ import annotations

import json
import shutil
import struct
import sys
import tempfile
import unittest
import zipfile
import zlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import import_zip as import_tool  # noqa: E402
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
        self.assertEqual(sum(result[sp]["samples"] for sp in ("train", "val", "test")), 20)
        # CLS-03: mỗi lớp chia riêng; lớp chỉ có một subject nằm trọn trong train, lớp chỉ dùng khi đánh giá
        # (background, unknown) không vào train.
        self.assertEqual(result["classes"], {"S-1": "person", "S-2": "mannequin", "S-3": "background", "S-4": "unknown"})
        self.assertIn("S-1", result["train"]["subjects"])
        self.assertIn("S-2", result["train"]["subjects"])
        self.assertIn("S-3", result["test"]["subjects"])
        self.assertIn("S-4", result["test"]["subjects"])
        self.assertEqual(result["train"]["byLabel"], {"person": 10, "mannequin": 5, "unknown": 0, "background": 0})
        self.assertEqual(len(result["warnings"]), 2)
        self.assertIn("person: 1 subject, không có ở val, test", result["warnings"][0])
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
        body = stats_tool.render(all_samples(sessions), len(sessions), json.loads((self.root / "splits.json").read_text(encoding="utf-8")))
        self.assertIn("| person | 10 | 1 | 2 |", body)
        self.assertIn("| mannequin | 5 | 1 | 1 |", body)
        self.assertIn("### By window size", body)
        self.assertIn("| total | 5 | 11 | 4 | 20 |", body)  # small, medium, large
        self.assertIn("### By split", body)
        doc = self.tmp / "dataset.md"
        doc.write_text("# x\n\n<!-- dataset:begin -->\ncũ\n<!-- dataset:end -->\n\nsau\n", encoding="utf-8")
        self.assertEqual(stats_tool.main([str(self.root), "--doc", str(doc)]), 0)
        text = doc.read_text(encoding="utf-8")
        self.assertNotIn("cũ", text)
        self.assertIn("| person | 10 | 1 | 2 |", text)
        self.assertTrue(text.endswith("<!-- dataset:end -->\n\nsau\n"))



def zip_sessions(root: Path, out: Path, sids: list[str], extra: dict[str, bytes] | None = None) -> Path:
    """Zip đúng dạng nút "Tải zip" của app: <sessionId>/<file>, không mục thư mục."""
    with zipfile.ZipFile(out, "w", zipfile.ZIP_STORED) as zf:
        for sid in sids:
            for f in sorted((root / sid).iterdir()):
                zf.writestr(f"{sid}/{f.name}", f.read_bytes())
        for name, data in (extra or {}).items():
            zf.writestr(zipfile.ZipInfo(name), data)
    return out


class StratifiedSplitTest(unittest.TestCase):
    """CLS-03 (D-061): val và test có cả người lẫn hình nộm khi mỗi lớp có ít nhất ba subject."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="wct-split-"))
        self.root = self.tmp / "dataset"
        self.root.mkdir()
        for subj, n in (("P1", 8), ("P2", 6), ("P3", 5), ("P4", 4)):
            make_session(self.root, f"ses-{subj.lower()}", subj, "person", n)
        for subj, n in (("M1", 5), ("M2", 4), ("M3", 3)):
            make_session(self.root, f"ses-{subj.lower()}", subj, "mannequin", n, mannequinType="plastic")
        for subj, n in (("B1", 3), ("B2", 2)):
            make_session(self.root, f"ses-{subj.lower()}", subj, "background", n)

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_each_split_has_both_classes(self) -> None:
        ratios = {"train": 0.7, "val": 0.15, "test": 0.15}
        result = split_tool.make_splits(load_root(self.root), ratios, seed=1)
        self.assertEqual(result["warnings"], [])
        for sp in ("train", "val", "test"):
            self.assertGreater(result[sp]["byLabel"]["person"], 0, sp)
            self.assertGreater(result[sp]["byLabel"]["mannequin"], 0, sp)
        # Nhiều mẫu nhất vào train, rồi test, rồi val; P4 theo tỉ lệ vào train.
        self.assertEqual(result["train"]["subjects"], ["M1", "P1", "P4"])
        self.assertEqual(result["test"]["subjects"], ["B1", "M2", "P2"])
        self.assertEqual(result["val"]["subjects"], ["B2", "M3", "P3"])
        self.assertEqual(result["train"]["byLabel"]["background"], 0)
        # Tất định theo seed.
        again = split_tool.make_splits(load_root(self.root), ratios, seed=1)
        self.assertEqual(again["bySample"], result["bySample"])

    def test_majority_label_decides_subject_class(self) -> None:
        make_session(self.root, "ses-p1b", "P1", "unknown", 2)
        classes = split_tool.subject_classes(load_root(self.root))
        self.assertEqual(classes["P1"], "person")
        make_session(self.root, "ses-x1", "X", "unknown", 2)
        make_session(self.root, "ses-x2", "X", "mannequin", 2)
        # Hòa thì theo thứ tự LABELS: mannequin trước unknown.
        self.assertEqual(split_tool.subject_classes(load_root(self.root))["X"], "mannequin")


class ImportZipTest(unittest.TestCase):
    """CLS-03 (D-061): nhập zip của dataset mode; zip sai dạng không ghi gì, nhập lại không đụng nhãn cuối."""

    def setUp(self) -> None:
        self.tmp = Path(tempfile.mkdtemp(prefix="wct-import-"))
        self.src = self.tmp / "src"
        self.src.mkdir()
        make_session(self.src, "ses-a1", "S-1", "person", 3)
        make_session(self.src, "ses-b1", "S-2", "mannequin", 2, mannequinType="plastic")
        self.zip = zip_sessions(self.src, self.tmp / "capture.zip", ["ses-a1", "ses-b1"])
        self.root = self.tmp / "dataset"

    def tearDown(self) -> None:
        shutil.rmtree(self.tmp, ignore_errors=True)

    def test_import_then_reimport_keeps_final_labels(self) -> None:
        self.assertEqual(import_tool.main([str(self.zip), "--root", str(self.root)]), 0)
        sessions = load_root(self.root)
        self.assertEqual([s.id for s in sessions], ["ses-a1", "ses-b1"])
        self.assertEqual(len(all_samples(sessions)), 5)
        self.assertEqual(check(sessions), [])
        self.assertFalse(any(p.name.endswith(".partial") for p in self.root.iterdir()))
        label_tool.main(["set", str(self.root), "--label", "unknown", "ses-a1-0001"])
        imported, skipped, errors = import_tool.import_zips([self.zip], self.root)
        self.assertEqual((imported, skipped, errors), ([], ["ses-a1", "ses-b1"], []))
        meta = json.loads((self.root / "ses-a1" / "ses-a1-0001.json").read_text(encoding="utf-8"))
        self.assertEqual(meta["labelFinal"], "unknown")

    def test_conflicting_session_is_not_overwritten(self) -> None:
        import_tool.import_zips([self.zip], self.root)
        before = (self.root / "ses-a1" / "ses-a1-0001.png").read_bytes()
        other = self.tmp / "other"
        other.mkdir()
        make_session(other, "ses-a1", "S-1", "person", 3, size=120)
        make_session(other, "ses-c1", "S-3", "person", 1)
        z2 = zip_sessions(other, self.tmp / "other.zip", ["ses-a1", "ses-c1"])
        imported, _, errors = import_tool.import_zips([z2], self.root)
        self.assertEqual(imported, [])
        self.assertTrue(any("PNG khác" in e for e in errors))
        self.assertEqual((self.root / "ses-a1" / "ses-a1-0001.png").read_bytes(), before)
        self.assertFalse((self.root / "ses-c1").exists())
        self.assertEqual(import_tool.main([str(z2), "--root", str(self.root)]), 1)

    def test_rejects_unexpected_members_without_writing(self) -> None:
        cases = {
            "../evil.png": b"x",
            "ses-a1/sub/x.png": b"x",
            "/abs.json": b"{}",
            "notes.txt": b"x",
            "ses-z9/ses-z9-0001.png": png_bytes(8, 8),  # phiên thiếu session.json
        }
        for name, data in cases.items():
            with self.subTest(name=name):
                z = zip_sessions(self.src, self.tmp / "bad.zip", ["ses-a1"], {name: data})
                imported, _, errors = import_tool.import_zips([z], self.root)
                self.assertEqual(imported, [])
                self.assertTrue(errors, name)
                self.assertFalse(self.root.exists())
        mismatch = self.tmp / "mismatch.zip"
        with zipfile.ZipFile(mismatch, "w") as zf:
            zf.writestr("ses-q1/session.json", json.dumps({"sessionId": "ses-other"}))
        self.assertTrue(any("sessionId" in e for e in import_tool.import_zips([mismatch], self.root)[2]))
        # Cùng phiên trong hai zip.
        self.assertTrue(any("cả" in e for e in import_tool.import_zips([self.zip, self.zip], self.root)[2]))

    def test_dry_run_writes_nothing(self) -> None:
        imported, skipped, errors = import_tool.import_zips([self.zip], self.root, dry_run=True)
        self.assertEqual((imported, skipped, errors), (["ses-a1", "ses-b1"], [], []))
        self.assertFalse(self.root.exists())
        self.assertEqual(import_tool.main([str(self.zip), "--root", str(self.root), "--dry-run"]), 0)
        self.assertFalse(self.root.exists())


if __name__ == "__main__":
    unittest.main()
