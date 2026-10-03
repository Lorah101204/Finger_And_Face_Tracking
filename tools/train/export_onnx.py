#!/usr/bin/env python3
"""CLS-02 bước 3: export checkpoint sang ONNX opset 17 với input cố định [1, 3, S, S] (D-013), tên vào "input", ra "logits".

  python tools/train/export_onnx.py data/train/run1/classifier.pt --out public/models/classifier.onnx
      [--manifest public/models/models.json]

Sau đó chạy check_onnx.py để so đầu ra torch và onnxruntime. CLS-03 (D-061): `--manifest` ghi sha256, cỡ file và thông
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


def update_manifest(manifest: Path, info: dict) -> None:
    """Ghi thông tin model vào mục classifier, giữ nguyên các khóa khác (stub, source, note…) và thứ tự khóa."""
    data = read_json(manifest)
    c = data.setdefault("classifier", {})
    for k in ("file", "sha256", "bytes", "inputSize", "labels", "norm", "opset", "train"):
        c[k] = info[k]
    c.setdefault("source", "")
    manifest.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8", newline="\n")


def main(argv: list[str] | None = None) -> int:
    utf8_console()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("checkpoint", type=Path)
    p.add_argument("--out", type=Path, default=Path("public/models/classifier.onnx"))
    p.add_argument("--opset", type=int, default=17)
    p.add_argument("--manifest", type=Path, help="models.json cần ghi sha256 (mục classifier)")
    args = p.parse_args(argv)

    import torch

    model, ck = load_checkpoint(args.checkpoint)
    size = int(ck["inputSize"])
    dummy = torch.zeros(1, 3, size, size)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    extra = {"dynamo": False} if "dynamo" in inspect.signature(torch.onnx.export).parameters else {}
    torch.onnx.export(
        model,
        dummy,
        str(args.out),
        opset_version=args.opset,
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes=None,
        do_constant_folding=True,
        **extra,
    )
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
    print(json.dumps(info, indent=2, ensure_ascii=False))
    print(f"đã ghi {args.out} ({len(blob)} byte)")
    if args.manifest:
        update_manifest(args.manifest, info)
        print(f"đã ghi sha256 vào mục classifier của {args.manifest}")
    else:
        print("chưa ghi manifest: chạy lại với --manifest public/models/models.json để app dùng model này")
    return 0


if __name__ == "__main__":
    sys.exit(main())
