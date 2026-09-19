#!/usr/bin/env python3
"""CLS-02 bước 3: export checkpoint sang ONNX opset 17 với input cố định [1, 3, S, S] (D-013), tên vào "input", ra "logits".

  python tools/train/export_onnx.py data/train/run1/classifier.pt --out public/models/classifier.onnx

Sau đó chạy check_onnx.py để so đầu ra torch và onnxruntime rồi ghi sha256 vào public/models/models.json (mục
"classifier"), và đổi DEFAULTS.classifier.modelPath sang /models/classifier.onnx.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dataset"))
from common import utf8_console  # noqa: E402


def load_checkpoint(path: Path):
    import torch

    from train import build_model

    ck = torch.load(path, map_location="cpu")
    model = build_model(ck["backbone"], "none")
    model.load_state_dict(ck["state_dict"])
    model.eval()
    return model, ck


def main(argv: list[str] | None = None) -> int:
    utf8_console()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("checkpoint", type=Path)
    p.add_argument("--out", type=Path, default=Path("public/models/classifier.onnx"))
    p.add_argument("--opset", type=int, default=17)
    args = p.parse_args(argv)

    import torch

    model, ck = load_checkpoint(args.checkpoint)
    size = int(ck["inputSize"])
    dummy = torch.zeros(1, 3, size, size)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    torch.onnx.export(
        model,
        dummy,
        str(args.out),
        opset_version=args.opset,
        input_names=["input"],
        output_names=["logits"],
        dynamic_axes=None,
        do_constant_folding=True,
    )
    sha = hashlib.sha256(args.out.read_bytes()).hexdigest()
    info = {
        "file": args.out.name,
        "sha256": sha,
        "inputSize": size,
        "labels": ck["classes"],
        "norm": ck.get("norm", {"mean": 0.45, "std": 0.225}),
        "opset": args.opset,
        "backbone": ck["backbone"],
        "valAcc": ck.get("valAcc"),
    }
    (args.out.with_suffix(".json")).write_text(json.dumps(info, indent=2), encoding="utf-8")
    print(json.dumps(info, indent=2))
    print(f"đã ghi {args.out} ({args.out.stat().st_size} byte); cập nhật mục classifier của public/models/models.json với sha256 trên")
    return 0


if __name__ == "__main__":
    sys.exit(main())
