#!/usr/bin/env python3
"""CLS-02 bước 3: export checkpoint sang ONNX opset 17 với input cố định [1, 3, S, S] (D-013), tên vào "input", ra "logits".

  python tools/train/export_onnx.py data/train/run1/classifier.pt --out public/models/classifier.onnx
      [--manifest public/models/models.json] [--compress auto|fp16w|none] [--root data/dataset]

CLS-04 (D-066): `--compress auto` (mặc định) export fp32 vào thư mục làm việc (<thư mục checkpoint>/compress/), dựng bộ
đầu vào (mẫu thật của --root, augment giữ lại, ảnh public/spike-assets nếu có, ảnh trộn person ↔ mannequin), tạo ứng
viên chỉ đổi cách lưu trọng số (fp16w; int8 theo kênh cho các lớp ít nhạy + fp16 cho lớp nhạy, compress.py), kiểm
chúng trên onnxruntime Python và trên onnxruntime-web wasm (tools/train/check_wasm.mjs, cần node), rồi copy ứng viên ít
byte nhất qua cổng của compress_select.py ra --out (fp32 là dự phòng). Báo cáo đầy đủ ở <work>/report.json; models.json
chỉ nhận trường tất định (mục `compression`). `--compress none` giữ đúng đường cũ: export thẳng ra --out.

Sau đó chạy check_onnx.py trên bản fp32 (<work>/classifier.fp32.onnx, hay --out khi --compress none) để so đầu ra torch
và onnxruntime: sai số 1e-3 của nó dành cho fp32, model nén được so với fp32 bằng cổng của compress_select. CLS-03 (D-061): `--manifest` ghi sha256, cỡ file và thông
tin huấn luyện vào mục "classifier" của models.json; build và dev server chỉ dùng classifier.onnx khi sha256 của file
khớp manifest (vite.config.ts resolveClassifier), nên mỗi lần train lại phải ghi lại. sha256 đổi cũng đổi khóa cache
model của service worker (D-050), máy người dùng cũ tải model mới. Exporter TorchScript (dynamo=False) giữ opset 17 mà
không cần onnxscript; torch ≥ 2.9 mặc định dynamo.
"""

from __future__ import annotations

import argparse
import hashlib
import inspect
import json
import shutil
import subprocess
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dataset"))
from common import read_json, utf8_console  # noqa: E402


def load_checkpoint(path: Path):
    import torch

    from train import build_model

    ck = torch.load(path, map_location="cpu")
    model = build_model(ck["backbone"], "none")
    model.load_state_dict(ck["state_dict"])
    model.eval()
    return model, ck


def js_stable(v):
    """Số thực có giá trị nguyên thành int (đệ quy): JSON giống hệt khi fetch-models.mjs ghi lại models.json bằng
    JSON.stringify (1.0 thành 1), nên khóa cache model của service worker (sha của models.json) không đổi oan."""
    if isinstance(v, float) and v.is_integer():
        return int(v)
    if isinstance(v, dict):
        return {k: js_stable(x) for k, x in v.items()}
    if isinstance(v, list):
        return [js_stable(x) for x in v]
    return v


def update_manifest(manifest: Path, info: dict) -> str | None:
    """Ghi thông tin model vào mục classifier, giữ nguyên các khóa khác (stub, source, note…) và thứ tự khóa. CLS-04:
    `compression` chỉ ghi khi model nén được chọn; export fp32 xóa mục cũ để không mô tả sai file. REL-02 (D-068): trả
    lời nhắc khi sha256 đổi mà `source` còn trỏ model đã publish trước; `source` được giữ nguyên để models:fetch trên CI
    dừng (tên file trong URL không mang sha256 mới) thay vì lặng lẽ build trang public với stub."""
    data = read_json(manifest)
    c = data.setdefault("classifier", {})
    old_sha = c.get("sha256")
    for k in ("file", "sha256", "bytes", "inputSize", "labels", "norm", "opset", "train"):
        c[k] = js_stable(info[k])
    if info.get("compression"):
        c["compression"] = js_stable(info["compression"])
    else:
        c.pop("compression", None)
    c.setdefault("source", "")
    manifest.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")
    if c["source"] and old_sha != c["sha256"]:
        return (f"classifier.source vẫn trỏ model đã publish trước ({c['source']}); chạy `npm run models:publish` rồi"
                " mới push models.json, không thì models:fetch trên CI dừng (REL-02, D-068)")
    return None


def compress_and_copy(fp32: Path, out: Path, work: Path, size: int, args) -> dict | None:
    """CLS-04 (D-066): tạo ứng viên nén, kiểm trên Python và wasm, copy ứng viên được chọn ra `out`; trả mục
    `compression` cho manifest (None khi fp32 thắng). Báo cáo đầy đủ (thời gian, mọi ứng viên) ở work/report.json."""
    import compress
    from compress_select import agreement, choose, manifest_block, passes, speed_ok

    if not args.root.is_dir():
        raise SystemExit(f"--compress {args.compress} cần dataset ở {args.root} (hay --compress none)")
    node = shutil.which("node")
    if not node:
        raise SystemExit("--compress cần node để kiểm model trên onnxruntime-web (tools/train/check_wasm.mjs)")
    x, tags = compress.build_pack(args.root, args.spike_dir, size, fp32)
    print(f"bộ đầu vào: {len(tags)} ({sum(t.startswith('real') for t in tags)} thật, {tags.count('aug')} augment,"
          f" {sum(t.startswith('spike') for t in tags)} spike, {sum(t.startswith('blend') for t in tags)} trộn, trong đó"
          f" {sum(t.startswith('blend') and len(t) > 9 for t in tags)} α chia đôi sát ngưỡng)")
    cands = compress.search(fp32, x, tags, work, mode=args.compress)
    compress.write_pack(work, x, tags, compress.logits(fp32, x))
    script = Path(__file__).resolve().parent / "check_wasm.mjs"
    subprocess.run([node, str(script), str(work), *[str(c["path"]) for c in cands]], check=True)
    wasm = {Path(m["model"]).name: m for m in json.loads((work / "wasm.json").read_text(encoding="utf-8"))["models"]}
    fp32_w = wasm[fp32.name]
    ref_w = compress.read_wasm_logits(Path(fp32_w["logits"]), len(tags))
    ok = []
    for c in cands:
        w = wasm[c["path"].name]
        c["wasm"] = {**agreement(ref_w, compress.read_wasm_logits(Path(w["logits"]), len(tags)), tags),
                     "initMs": w["initMs"], "p50Ms": w["p50Ms"], "p95Ms": w["p95Ms"]}
        if c["mode"] != "none":
            good_py, why_py = passes(c["agreement"])
            good_w, why_w = passes(c["wasm"])
            fast, why_s = speed_ok(w, fp32_w)
            c["pass"] = good_py and good_w and fast
            c["why"] = why_py + why_w + ([why_s] if why_s else [])
            if not c["pass"]:
                print(f"{c['mode']}: loại ({'; '.join(c['why'])})")
                continue
        ok.append({**c, "agreement": c["wasm"]})
    best = choose(ok)
    shutil.copyfile(best["path"], out)
    report = {"chosen": best["mode"], "candidates": [
        {k: (str(v) if isinstance(v, Path) else v) for k, v in c.items()} for c in cands]}
    (work / "report.json").write_text(json.dumps(report, indent=1, ensure_ascii=False), encoding="utf-8")
    print(f"chọn {best['mode']}: {best['bytes'] / 1e6:.2f} MB (fp32 {fp32.stat().st_size / 1e6:.2f} MB),"
          f" wasm p50 {best['wasm']['p50Ms']:.2f} ms (fp32 {fp32_w['p50Ms']:.2f} ms); báo cáo {work / 'report.json'}")
    if best["mode"] == "none":
        return None
    fp32_blob = fp32.read_bytes()
    return manifest_block(best["mode"], hashlib.sha256(fp32_blob).hexdigest(), len(fp32_blob), best["layers"],
                          best["wasm"])


def main(argv: list[str] | None = None) -> int:
    utf8_console()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("checkpoint", type=Path)
    p.add_argument("--out", type=Path, default=Path("public/models/classifier.onnx"))
    p.add_argument("--opset", type=int, default=17)
    p.add_argument("--manifest", type=Path, help="models.json cần ghi sha256 (mục classifier)")
    p.add_argument("--compress", default="auto", choices=("auto", "fp16w", "none"),
                   help="CLS-04: nén cách lưu trọng số (mặc định auto); none = export fp32 thẳng ra --out")
    p.add_argument("--root", type=Path, default=Path("data/dataset"), help="dataset cho bộ đầu vào kiểm nén")
    p.add_argument("--spike-dir", type=Path, default=Path("public/spike-assets"))
    p.add_argument("--work", type=Path, help="thư mục làm việc (mặc định <thư mục checkpoint>/compress)")
    args = p.parse_args(argv)

    import torch

    model, ck = load_checkpoint(args.checkpoint)
    size = int(ck["inputSize"])
    dummy = torch.zeros(1, 3, size, size)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    work = args.work or args.checkpoint.parent / "compress"
    fp32_out = args.out if args.compress == "none" else work / "classifier.fp32.onnx"
    fp32_out.parent.mkdir(parents=True, exist_ok=True)
    extra = {"dynamo": False} if "dynamo" in inspect.signature(torch.onnx.export).parameters else {}
    torch.onnx.export(
        model,
        dummy,
        str(fp32_out),
        opset_version=args.opset,
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes=None,
        do_constant_folding=True,
        **extra,
    )
    compression = None
    if args.compress != "none":
        compression = compress_and_copy(fp32_out, args.out, work, size, args)
    blob = args.out.read_bytes()
    info = {
        "file": args.out.name,
        "sha256": hashlib.sha256(blob).hexdigest(),
        "bytes": len(blob),
        "inputSize": size,
        "labels": ck["classes"],
        "norm": ck.get("norm", {"mean": 0.45, "std": 0.225}),
        "opset": args.opset,
        "train": {
            "backbone": ck["backbone"],
            "epoch": ck.get("epoch"),
            "freeze": ck.get("freeze", False),
            "select": ck.get("select", "val"),
            "valAcc": ck.get("valAcc"),
            "valBalancedAcc": ck.get("valBalancedAcc"),
            "samples": ck.get("samples"),
            "torch": torch.__version__,
        },
    }
    if compression:
        info["compression"] = compression
    print(json.dumps(info, indent=2, ensure_ascii=False))
    print(f"đã ghi {args.out} ({len(blob)} byte)")
    if args.manifest:
        reminder = update_manifest(args.manifest, info)
        print(f"đã ghi sha256 vào mục classifier của {args.manifest}")
        if reminder:
            print(reminder)
    else:
        print("chưa ghi manifest: chạy lại với --manifest public/models/models.json để app dùng model này")
    return 0


if __name__ == "__main__":
    sys.exit(main())
