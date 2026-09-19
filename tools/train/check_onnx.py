#!/usr/bin/env python3
"""CLS-02 bước 3: kiểm model ONNX bằng onnxruntime (Python) với cùng đầu vào như torch: lệch tối đa của logits và
độ khớp argmax trên N ảnh của tập val (hoặc ngẫu nhiên khi không có dataset).

  python tools/train/check_onnx.py data/train/run1/classifier.pt public/models/classifier.onnx [--root data/dataset] [--n 64]
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dataset"))
from common import utf8_console  # noqa: E402


def main(argv: list[str] | None = None) -> int:
    utf8_console()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("checkpoint", type=Path)
    p.add_argument("onnx", type=Path)
    p.add_argument("--root", type=Path)
    p.add_argument("--n", type=int, default=64)
    p.add_argument("--tol", type=float, default=1e-3)
    args = p.parse_args(argv)

    import numpy as np
    import onnxruntime as ort
    import torch

    from dataset import CropDataset, load_split
    from export_onnx import load_checkpoint

    model, ck = load_checkpoint(args.checkpoint)
    size = int(ck["inputSize"])
    sess = ort.InferenceSession(str(args.onnx), providers=["CPUExecutionProvider"])
    assert [i.name for i in sess.get_inputs()] == ["input"], "tên input phải là 'input'"
    assert [o.name for o in sess.get_outputs()] == ["logits"], "tên output phải là 'logits'"
    assert list(sess.get_inputs()[0].shape) == [1, 3, size, size], f"input phải cố định [1,3,{size},{size}]"

    if args.root:
        ds = CropDataset(load_split(args.root, "val")[: args.n], size, train=False)
        xs = [ds[i][0] for i in range(len(ds))]
    else:
        g = torch.Generator().manual_seed(1)
        xs = [torch.randn(3, size, size, generator=g) for _ in range(args.n)]
    max_diff = 0.0
    agree = 0
    with torch.no_grad():
        for x in xs:
            t = model(x.unsqueeze(0)).numpy()
            o = sess.run(["logits"], {"input": x.unsqueeze(0).numpy().astype(np.float32)})[0]
            max_diff = max(max_diff, float(np.abs(t - o).max()))
            agree += int(t.argmax() == o.argmax())
    print(f"{len(xs)} ảnh: lệch logits tối đa {max_diff:.2e}, argmax khớp {agree}/{len(xs)}")
    if max_diff > args.tol or agree != len(xs):
        print("KHÔNG ĐẠT: export lệch so với torch")
        return 1
    print("đạt")
    return 0


if __name__ == "__main__":
    sys.exit(main())
