#!/usr/bin/env python3
"""CLS-01: đọc và kiểm dataset do dataset mode của app ghi (docs/dataset.md mục 3).

Cấu trúc: <root>/<sessionId>/session.json, <id>.png, <id>.json (thư mục hay zip đã giải nén). Mỗi PNG là crop vùng
mở (bản trước letterbox), không bao giờ là frame gốc; `check()` xác nhận điều đó bằng kích thước IHDR so với metadata và
kích thước camera của phiên. Chỉ dùng thư viện chuẩn (không PIL, không numpy).
"""

from __future__ import annotations

import json
import struct
import sys
from dataclasses import dataclass
from pathlib import Path

LABELS = ("person", "mannequin", "unknown", "background")
SPLITS = ("train", "val", "test")
PNG_SIG = b"\x89PNG\r\n\x1a\n"


@dataclass
class Sample:
    png: Path
    json_path: Path
    meta: dict

    @property
    def id(self) -> str:
        return str(self.meta.get("id", self.json_path.stem))

    @property
    def session_id(self) -> str:
        return str(self.meta.get("sessionId", self.json_path.parent.name))

    @property
    def subject_id(self) -> str:
        return str(self.meta.get("subjectId", ""))

    @property
    def label(self) -> str:
        """Nhãn cuối (labelFinal, bước 4) nếu có, không thì nhãn tạm của app."""
        return str(self.meta.get("labelFinal") or self.meta.get("label") or "unknown")

    def field(self, key: str, default: str = "?") -> str:
        v = self.meta.get(key)
        return default if v is None else str(v)


@dataclass
class Session:
    path: Path
    meta: dict
    samples: list[Sample]

    @property
    def id(self) -> str:
        return str(self.meta.get("sessionId", self.path.name))

    @property
    def subject_id(self) -> str:
        return str(self.meta.get("subjectId", ""))


def utf8_console() -> None:
    """Windows mặc định mã hóa console theo codepage (cp932, cp1252…) nên chữ tiếng Việt in ra sẽ lỗi; ép UTF-8."""
    for stream in (sys.stdout, sys.stderr):
        if hasattr(stream, "reconfigure"):
            try:
                stream.reconfigure(encoding="utf-8", errors="replace")
            except (ValueError, OSError):
                pass


def png_size(path: Path) -> tuple[int, int]:
    """Kích thước từ IHDR (8 byte chữ ký + chunk đầu tiên phải là IHDR)."""
    with open(path, "rb") as f:
        head = f.read(24)
    if len(head) < 24 or head[:8] != PNG_SIG or head[12:16] != b"IHDR":
        raise ValueError(f"{path}: không phải PNG")
    w, h = struct.unpack(">II", head[16:24])
    return w, h


def read_json(path: Path) -> dict:
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def write_json(path: Path, obj: object) -> None:
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)
        f.write("\n")


def load_root(root: Path) -> list[Session]:
    """Mọi thư mục con có session.json; thư mục khác (ví dụ _labels/) bỏ qua."""
    sessions: list[Session] = []
    for d in sorted(p for p in root.iterdir() if p.is_dir()):
        sj = d / "session.json"
        if not sj.exists():
            continue
        meta = read_json(sj)
        samples: list[Sample] = []
        for j in sorted(d.glob("*.json")):
            if j.name == "session.json":
                continue
            samples.append(Sample(png=j.with_suffix(".png"), json_path=j, meta=read_json(j)))
        sessions.append(Session(path=d, meta=meta, samples=samples))
    return sessions


def all_samples(sessions: list[Session]) -> list[Sample]:
    return [s for ses in sessions for s in ses.samples]


def check(sessions: list[Session]) -> list[str]:
    """Lỗi cấu trúc và lỗi 'frame gốc' (tiêu chí hoàn thành CLS-01). Rỗng là đạt."""
    errors: list[str] = []
    for ses in sessions:
        sid = ses.id
        if ses.meta.get("participantConsent") is not True:
            errors.append(f"{sid}: session.json thiếu participantConsent = true (bước 1)")
        if ses.path.name != sid:
            errors.append(f"{ses.path.name}: sessionId trong session.json là {sid}")
        camera = (ses.meta.get("app") or {}).get("camera")
        pngs = {p.name for p in ses.path.glob("*.png")}
        for s in ses.samples:
            pngs.discard(s.png.name)
            if not s.png.exists():
                errors.append(f"{s.id}: thiếu {s.png.name}")
                continue
            try:
                w, h = png_size(s.png)
            except ValueError as e:
                errors.append(str(e))
                continue
            crop = s.meta.get("crop") or {}
            if (w, h) != (crop.get("w"), crop.get("h")):
                errors.append(f"{s.id}: PNG {w}×{h} khác metadata crop {crop.get('w')}×{crop.get('h')}")
            if camera:
                cw, ch = camera.get("w", 0), camera.get("h", 0)
                if w >= cw and h >= ch:
                    errors.append(f"{s.id}: PNG {w}×{h} bằng hoặc lớn hơn khung camera {cw}×{ch}: frame gốc?")
                elif w > cw or h > ch:
                    errors.append(f"{s.id}: PNG {w}×{h} vượt khung camera {cw}×{ch}")
            if s.meta.get("sessionId") != sid:
                errors.append(f"{s.id}: sessionId {s.meta.get('sessionId')} khác phiên {sid}")
            if s.meta.get("label") not in LABELS:
                errors.append(f"{s.id}: nhãn tạm không hợp lệ: {s.meta.get('label')}")
            lf = s.meta.get("labelFinal")
            if lf is not None and lf not in LABELS:
                errors.append(f"{s.id}: labelFinal không hợp lệ: {lf}")
        for orphan in sorted(pngs):
            errors.append(f"{sid}/{orphan}: PNG không có JSON đi kèm")
    return errors
