#!/usr/bin/env python3
"""CLS-02 bước 1: huấn luyện bộ phân loại person / mannequin trên crop vùng mở (dataset CLS-01).

  python tools/train/train.py data/dataset --out data/train/run1 [--epochs 20] [--input-size 128] [--batch 64]
      [--lr 1e-3] [--backbone mobilenet_v3_small|efficientnet_b0] [--weights default|none] [--seed 1] [--device cpu]

Backbone nhỏ của torchvision, đầu ra 2 lớp; tập chia theo subjectId (tools/dataset/split.py); augment mô phỏng đường
chạy (dataset.py). Lưu checkpoint tốt nhất theo val (data/train/run1/classifier.pt), nhật ký JSON và cấu hình để
export_onnx.py và eval.py dùng lại. Cần torch, torchvision, Pillow, numpy (tools/train/requirements.txt); các script
này chưa chạy được trên máy phát triển hiện tại (không có torch) và cần dataset thật.
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dataset"))
from common import utf8_console  # noqa: E402
from dataset import CLASSES, CropDataset, class_counts, load_split  # noqa: E402

BACKBONES = ("mobilenet_v3_small", "efficientnet_b0")


def build_model(backbone: str, weights: str):
    import torch.nn as nn
    from torchvision import models

    if backbone == "mobilenet_v3_small":
        w = models.MobileNet_V3_Small_Weights.DEFAULT if weights == "default" else None
        m = models.mobilenet_v3_small(weights=w)
        m.classifier[-1] = nn.Linear(m.classifier[-1].in_features, len(CLASSES))
    elif backbone == "efficientnet_b0":
        w = models.EfficientNet_B0_Weights.DEFAULT if weights == "default" else None
        m = models.efficientnet_b0(weights=w)
        m.classifier[-1] = nn.Linear(m.classifier[-1].in_features, len(CLASSES))
    else:
        raise SystemExit(f"backbone không hỗ trợ: {backbone}")
    return m


def evaluate(model, loader, device) -> dict:
    import torch

    model.eval()
    correct = 0
    total = 0
    loss_sum = 0.0
    crit = torch.nn.CrossEntropyLoss()
    with torch.no_grad():
        for x, y in loader:
            x, y = x.to(device), y.to(device)
            out = model(x)
            loss_sum += crit(out, y).item() * len(y)
            correct += (out.argmax(1) == y).sum().item()
            total += len(y)
    return {"loss": loss_sum / max(total, 1), "acc": correct / max(total, 1), "n": total}


def main(argv: list[str] | None = None) -> int:
    utf8_console()
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("root", type=Path)
    p.add_argument("--out", type=Path, default=Path("data/train/run1"))
    p.add_argument("--epochs", type=int, default=20)
    p.add_argument("--input-size", type=int, default=128, choices=(128, 160))
    p.add_argument("--batch", type=int, default=64)
    p.add_argument("--lr", type=float, default=1e-3)
    p.add_argument("--backbone", default="mobilenet_v3_small", choices=BACKBONES)
    p.add_argument("--weights", default="default", choices=("default", "none"))
    p.add_argument("--seed", type=int, default=1)
    p.add_argument("--device", default="auto")
    p.add_argument("--workers", type=int, default=2)
    args = p.parse_args(argv)

    import torch
    from torch.utils.data import DataLoader

    torch.manual_seed(args.seed)
    device = torch.device("cuda" if args.device == "auto" and torch.cuda.is_available() else args.device if args.device != "auto" else "cpu")
    train_s = load_split(args.root, "train")
    val_s = load_split(args.root, "val")
    if not train_s or not val_s:
        raise SystemExit("tập train hay val rỗng: cần dataset thật đã chia (tools/dataset/split.py)")
    print(f"train {len(train_s)} {class_counts(train_s)}; val {len(val_s)} {class_counts(val_s)}; device {device}")
    train_ds = CropDataset(train_s, args.input_size, train=True, seed=args.seed)
    val_ds = CropDataset(val_s, args.input_size, train=False)
    train_dl = DataLoader(train_ds, batch_size=args.batch, shuffle=True, num_workers=args.workers, drop_last=False)
    val_dl = DataLoader(val_ds, batch_size=args.batch, shuffle=False, num_workers=args.workers)

    model = build_model(args.backbone, args.weights).to(device)
    # Cân bằng lớp bằng trọng số nghịch đảo tần suất (hình nộm thường ít mẫu hơn người).
    counts = class_counts(train_s)
    weight = torch.tensor([sum(counts.values()) / max(counts[c], 1) for c in CLASSES], dtype=torch.float32)
    crit = torch.nn.CrossEntropyLoss(weight=(weight / weight.sum() * len(CLASSES)).to(device))
    opt = torch.optim.AdamW(model.parameters(), lr=args.lr, weight_decay=1e-4)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=args.epochs)

    args.out.mkdir(parents=True, exist_ok=True)
    log: list[dict] = []
    best = {"acc": -1.0, "epoch": -1}
    for epoch in range(1, args.epochs + 1):
        model.train()
        t0 = time.time()
        loss_sum = 0.0
        n = 0
        for x, y in train_dl:
            x, y = x.to(device), y.to(device)
            opt.zero_grad()
            loss = crit(model(x), y)
            loss.backward()
            opt.step()
            loss_sum += loss.item() * len(y)
            n += len(y)
        sched.step()
        val = evaluate(model, val_dl, device)
        entry = {"epoch": epoch, "trainLoss": loss_sum / max(n, 1), "val": val, "seconds": time.time() - t0}
        log.append(entry)
        print(json.dumps(entry))
        if val["acc"] > best["acc"]:
            best = {"acc": val["acc"], "epoch": epoch}
            torch.save(
                {
                    "state_dict": model.state_dict(),
                    "backbone": args.backbone,
                    "inputSize": args.input_size,
                    "classes": list(CLASSES),
                    "norm": {"mean": 0.45, "std": 0.225},
                    "epoch": epoch,
                    "valAcc": val["acc"],
                },
                args.out / "classifier.pt",
            )
    (args.out / "train-log.json").write_text(
        json.dumps({"args": {k: str(v) for k, v in vars(args).items()}, "best": best, "log": log}, indent=2),
        encoding="utf-8",
    )
    print(f"tốt nhất: epoch {best['epoch']} val acc {best['acc']:.4f}; checkpoint {args.out / 'classifier.pt'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
