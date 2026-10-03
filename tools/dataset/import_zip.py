#!/usr/bin/env python3
"""CLS-03 bước 1: nhập file zip mà dataset mode của app tải về (nút "Tải zip") vào thư mục dataset.

  python tools/dataset/import_zip.py <zip> [<zip> ...] [--root data/dataset] [--dry-run]

Zip của app có dạng <sessionId>/session.json, <sessionId>/<id>.png, <sessionId>/<id>.json (docs/dataset.md mục 3).
Chỉ nhận đúng dạng đó: tên thành viên là <sessionId>/<file> với sessionId bắt đầu bằng "ses-" và file .png hoặc .json,
không đường dẫn tuyệt đối, không "..", không thư mục lồng; mỗi phiên phải có session.json với sessionId trùng tên thư
mục. Mọi zip được kiểm hết trước khi ghi: một thành viên sai là không ghi gì.

Phiên đã có trong root: cùng tập PNG (tên và nội dung) thì bỏ qua, nên nhập lại cùng zip sau khi đã gán nhãn cuối
(labelFinal nằm trong JSON) không đụng tới nhãn; PNG khác thì dừng, không ghi đè. Phiên mới được giải nén vào
<root>/<sessionId>.partial rồi đổi tên, nên không bao giờ còn nửa phiên. Sau cùng chạy check() của common.py trên các
phiên vừa nhập (cỡ PNG so với metadata, frame gốc, thiếu đồng ý); có lỗi thì thoát 1. Chỉ dùng thư viện chuẩn.
"""

from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
import zipfile
from collections import Counter, defaultdict
from dataclasses import dataclass, field
from pathlib import Path

from common import all_samples, check, load_root, utf8_console

MEMBER_RE = re.compile(r"^(ses-[A-Za-z0-9_-]+)/([A-Za-z0-9_.-]+\.(?:png|json))$")
# Crop lớn nhất là khung camera 1920 × 1080 RGBA chưa nén (~8,3 MB); JSON vài trăm byte. Vượt mức này là zip lạ.
MAX_MEMBER_BYTES = 16 * 1024 * 1024


@dataclass
class ZipSession:
    session_id: str
    members: dict[str, str] = field(default_factory=dict)  # tên file → tên thành viên trong zip
    meta: dict = field(default_factory=dict)


@dataclass
class ZipPlan:
    path: Path
    sessions: dict[str, ZipSession]
    errors: list[str]


def read_zip(path: Path) -> ZipPlan:
    """Kiểm tên, cỡ và session.json của mọi thành viên; không ghi gì."""
    errors: list[str] = []
    sessions: dict[str, ZipSession] = {}
    try:
        zf = zipfile.ZipFile(path)
    except (OSError, zipfile.BadZipFile) as e:
        return ZipPlan(path, {}, [f"{path.name}: không đọc được zip ({e})"])
    with zf:
        for info in zf.infolist():
            name = info.filename
            if info.is_dir():
                if not re.fullmatch(r"ses-[A-Za-z0-9_-]+/", name):
                    errors.append(f"{path.name}: thư mục lạ {name!r}")
                continue
            m = MEMBER_RE.match(name)
            if not m:
                errors.append(f"{path.name}: thành viên không đúng dạng <ses-…>/<file>.png|json: {name!r}")
                continue
            if info.file_size > MAX_MEMBER_BYTES:
                errors.append(f"{path.name}: {name} {info.file_size} byte, vượt {MAX_MEMBER_BYTES}")
                continue
            sid, fname = m.group(1), m.group(2)
            ses = sessions.setdefault(sid, ZipSession(sid))
            ses.members[fname] = name
        for sid, ses in sessions.items():
            sj = ses.members.get("session.json")
            if not sj:
                errors.append(f"{path.name}: phiên {sid} thiếu session.json")
                continue
            try:
                ses.meta = json.loads(zf.read(sj).decode("utf-8"))
            except (UnicodeDecodeError, json.JSONDecodeError) as e:
                errors.append(f"{path.name}: {sj} không phải JSON ({e})")
                continue
            if ses.meta.get("sessionId") != sid:
                errors.append(f"{path.name}: {sj} có sessionId {ses.meta.get('sessionId')!r}")
    return ZipPlan(path, sessions, errors)


def png_members(ses: ZipSession) -> dict[str, str]:
    return {f: n for f, n in ses.members.items() if f.endswith(".png")}


def same_pngs(zf: zipfile.ZipFile, ses: ZipSession, folder: Path) -> bool:
    """Phiên đã có: cùng tập PNG theo tên và nội dung (JSON có thể đã thêm labelFinal nên không so)."""
    have = {p.name for p in folder.glob("*.png")}
    want = png_members(ses)
    if have != set(want):
        return False
    return all((folder / f).read_bytes() == zf.read(n) for f, n in want.items())


def import_zips(paths: list[Path], root: Path, dry_run: bool = False) -> tuple[list[str], list[str], list[str]]:
    """Trả (đã nhập, bỏ qua vì đã có, lỗi). Có lỗi kiểm tra thì không ghi gì."""
    plans = [read_zip(p) for p in paths]
    errors = [e for plan in plans for e in plan.errors]
    seen: dict[str, Path] = {}
    for plan in plans:
        for sid in plan.sessions:
            if sid in seen:
                errors.append(f"phiên {sid} có trong cả {seen[sid].name} và {plan.path.name}")
            seen[sid] = plan.path
    imported: list[str] = []
    skipped: list[str] = []
    todo: list[tuple[ZipPlan, ZipSession]] = []
    for plan in plans:
        if plan.errors:
            continue
        with zipfile.ZipFile(plan.path) as zf:
            for sid, ses in sorted(plan.sessions.items()):
                folder = root / sid
                if folder.exists():
                    if same_pngs(zf, ses, folder):
                        skipped.append(sid)
                    else:
                        errors.append(f"{sid}: đã có trong {root} với PNG khác; không ghi đè (đổi tên hoặc xóa phiên cũ)")
                    continue
                todo.append((plan, ses))
    if errors:
        return [], skipped, errors
    if dry_run:
        return [ses.session_id for _, ses in todo], skipped, errors
    root.mkdir(parents=True, exist_ok=True)
    for plan, ses in todo:
        tmp = root / f"{ses.session_id}.partial"
        shutil.rmtree(tmp, ignore_errors=True)
        tmp.mkdir()
        with zipfile.ZipFile(plan.path) as zf:
            for fname, member in ses.members.items():
                (tmp / fname).write_bytes(zf.read(member))
        tmp.rename(root / ses.session_id)
        imported.append(ses.session_id)
    return imported, skipped, errors


def main(argv: list[str] | None = None) -> int:
    utf8_console()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("zips", type=Path, nargs="+")
    p.add_argument("--root", type=Path, default=Path("data/dataset"))
    p.add_argument("--dry-run", action="store_true", help="chỉ kiểm tra và in kế hoạch, không ghi")
    args = p.parse_args(argv)
    imported, skipped, errors = import_zips(args.zips, args.root, args.dry_run)
    for e in errors:
        print(f"LỖI {e}", file=sys.stderr)
    if errors:
        print(f"không nhập gì: {len(errors)} lỗi")
        return 1
    verb = "sẽ nhập" if args.dry_run else "đã nhập"
    print(f"{verb} {len(imported)} phiên, bỏ qua {len(skipped)} phiên đã có ({', '.join(skipped) or '-'})")
    if args.dry_run or not imported:
        return 0
    sessions = [s for s in load_root(args.root) if s.id in set(imported)]
    by_label: Counter = Counter()
    by_subject: dict[str, set[str]] = defaultdict(set)
    for s in all_samples(sessions):
        by_label[s.label] += 1
        by_subject[s.label].add(s.subject_id)
    for label, n in sorted(by_label.items()):
        print(f"  {label}: {n} mẫu, {len(by_subject[label])} subject")
    problems = check(sessions)
    for e in problems:
        print(f"LỖI {e}", file=sys.stderr)
    print(f"check: {len(sessions)} phiên, {len(all_samples(sessions))} mẫu, {len(problems)} lỗi")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
