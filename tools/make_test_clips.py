#!/usr/bin/env python3
"""TEST-00 bước 4: tạo clip y4m tổng hợp cho camera giả của Playwright.

Chromium nhận --use-file-for-fake-video-capture=<clip.y4m>; playwright.config.ts tự thêm cờ này khi
tests/e2e/fixtures/camera.y4m tồn tại. Clip không có người thật: nền magenta, vùng "người" xanh lá (lime) di chuyển
theo trục x, tùy chọn một ảnh mặt được phép (không commit). Cần ffmpeg trên PATH; --dry-run chỉ in lệnh.

Ví dụ:
  python tools/make_test_clips.py                      # 640x480, 20 fps, 4 s, người nửa trái đứng yên
  python tools/make_test_clips.py --speed 120          # người chạy 120 px/s, vòng quanh khung
  python tools/make_test_clips.py --face data/face.png --face-at 220:120:200:200
Kích thước y4m = W x H x 1.5 x fps x giây (640x480, 20 fps, 4 s ~ 37 MB); *.y4m nằm trong .gitignore.
"""

from __future__ import annotations

import argparse
import pathlib
import shutil
import subprocess
import sys


def parse_rect(text: str) -> tuple[int, int, int, int]:
    parts = [int(p) for p in text.split(":")]
    if len(parts) != 4:
        raise argparse.ArgumentTypeError("định dạng x:y:w:h")
    return parts[0], parts[1], parts[2], parts[3]


def build_command(args: argparse.Namespace) -> list[str]:
    w, h = (int(v) for v in args.size.lower().split("x"))
    px, py, pw, ph = args.person
    dur = f"{args.duration:g}"
    cmd = [
        args.ffmpeg,
        "-y",
        "-f", "lavfi", "-i", f"color=c={args.background}:s={w}x{h}:r={args.fps}:d={dur}",
        "-f", "lavfi", "-i", f"color=c={args.person_color}:s={pw}x{ph}:r={args.fps}:d={dur}",
    ]
    # Vùng người chạy vòng: ra khỏi mép phải thì vào lại từ mép trái (overlay hỗ trợ biến t).
    x_expr = f"mod({px}+{pw}+{args.speed:g}*t\\,{w}+{pw})-{pw}" if args.speed else str(px)
    chain = f"[0][1]overlay=x='{x_expr}':y={py}:shortest=1[bg]"
    last = "[bg]"
    if args.face:
        fx, fy, fw, fh = args.face_at
        cmd += ["-loop", "1", "-t", dur, "-i", str(args.face)]
        chain += f";[2]scale={fw}:{fh}[face];[bg][face]overlay=x={fx}:y={fy}:shortest=1[out]"
        last = "[out]"
    cmd += [
        "-filter_complex", chain,
        "-map", last,
        "-t", dur,
        "-pix_fmt", "yuv420p",
        "-f", "yuv4mpegpipe",
        str(args.out),
    ]
    return cmd


def main() -> int:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--out", type=pathlib.Path, default=pathlib.Path("tests/e2e/fixtures/camera.y4m"))
    p.add_argument("--size", default="640x480", help="WxH (mặc định 640x480 để clip nhỏ)")
    p.add_argument("--fps", type=int, default=20)
    p.add_argument("--duration", type=float, default=4.0, help="giây; Chromium phát lặp")
    p.add_argument("--background", default="magenta")
    p.add_argument("--person", type=parse_rect, default=(0, 0, 320, 480), help="x:y:w:h của vùng người")
    p.add_argument("--person-color", default="lime")
    p.add_argument("--speed", type=float, default=0.0, help="px/s theo trục x, 0 là đứng yên")
    p.add_argument("--face", type=pathlib.Path, default=None, help="ảnh mặt được phép, không commit")
    p.add_argument("--face-at", type=parse_rect, default=(220, 120, 200, 200))
    p.add_argument("--ffmpeg", default="ffmpeg")
    p.add_argument("--dry-run", action="store_true", help="chỉ in lệnh ffmpeg")
    args = p.parse_args()

    cmd = build_command(args)
    print(" ".join(f'"{c}"' if " " in c or "'" in c else c for c in cmd))
    if args.dry_run:
        return 0
    if shutil.which(args.ffmpeg) is None:
        print(f"không tìm thấy {args.ffmpeg} trên PATH; cài ffmpeg hoặc dùng --ffmpeg <đường dẫn>", file=sys.stderr)
        return 2
    args.out.parent.mkdir(parents=True, exist_ok=True)
    result = subprocess.run(cmd)
    if result.returncode != 0:
        return result.returncode
    size = args.out.stat().st_size
    print(f"đã ghi {args.out} ({size / 1e6:.1f} MB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
