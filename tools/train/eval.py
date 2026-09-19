#!/usr/bin/env python3
"""CLS-02: metric mục 7.3 trên tập test bằng model ONNX (onnxruntime Python) và quy tắc unknown của app; ghi
docs/classifier-report.md giữa hai mốc <!-- classifier:begin --> và <!-- classifier:end -->.

  python tools/train/eval.py public/models/classifier.onnx data/dataset [--split test] [--doc docs/classifier-report.md]

Precision và recall từng lớp (unknown và miss tính vào thiếu recall), tỉ lệ hình nộm bị gán người, tỉ lệ unknown, theo
cỡ cửa sổ, theo vị trí cắt biên, hình nộm silicone báo riêng (metrics.py). Mẫu background và unknown của tập test cũng
được đưa qua model để đo nhãn sai trên nền (tính vào FP).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dataset"))
from common import utf8_console  # noqa: E402
from metrics import apply_unknown_rule, precision_recall, rates, render_markdown  # noqa: E402

BEGIN = "<!-- classifier:begin -->"
END = "<!-- classifier:end -->"


def main(argv: list[str] | None = None) -> int:
    utf8_console()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("onnx", type=Path)
    p.add_argument("root", type=Path)
    p.add_argument("--split", default="test")
    p.add_argument("--doc", type=Path)
    p.add_argument("--threshold", type=float, default=0.7)
    p.add_argument("--min-roi", type=int, default=96)
    args = p.parse_args(argv)

    import numpy as np
    import onnxruntime as ort

    from common import all_samples, load_root, read_json
    from dataset import CropAugment, to_tensor

    sess = ort.InferenceSession(str(args.onnx), providers=["CPUExecutionProvider"])
    size = int(sess.get_inputs()[0].shape[-1])
    aug = CropAugment(size, train=False)
    splits = read_json(args.root / "splits.json")
    by_sample = splits.get("bySample", {})
    records = []
    from PIL import Image

    for s in all_samples(load_root(args.root)):
        if by_sample.get(s.id) != args.split:
            continue
        with Image.open(s.png) as img:
            x = to_tensor(aug(img)).numpy()[None].astype(np.float32)
        logits = sess.run(["logits"], {"input": x})[0][0]
        e = np.exp(logits - logits.max())
        probs = (e / e.sum()).tolist()
        crop = s.meta.get("crop") or {}
        roi_short = min(int(crop.get("w", 0)), int(crop.get("h", 0)))
        pred, conf = apply_unknown_rule(probs, args.threshold, roi_short, args.min_roi)
        records.append(
            {
                "id": s.id,
                "label": s.label,
                "pred": pred,
                "prob": conf,
                "sizeClass": s.field("sizeClass"),
                "position": s.field("position"),
                "mannequinType": s.field("mannequinType"),
            }
        )
    if not records:
        raise SystemExit(f"split {args.split} is empty")
    body = render_markdown(records, f"Split {args.split} ({args.onnx.name})")
    summary = {"pr": precision_recall(records), **rates(records)}
    print(body)
    print(json.dumps(summary, indent=2, ensure_ascii=False))
    if args.doc:
        text = args.doc.read_text(encoding="utf-8")
        i, j = text.find(BEGIN), text.find(END)
        if i < 0 or j < 0 or j < i:
            raise SystemExit(f"{args.doc} is missing the markers {BEGIN} … {END}")
        args.doc.write_text(text[:i] + BEGIN + "\n" + body + "\n" + text[j:], encoding="utf-8", newline="\n")
        print(f"wrote {args.doc}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
