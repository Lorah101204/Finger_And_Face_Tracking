#!/usr/bin/env python3
"""CLS-02 bước 1: Dataset PyTorch đọc dataset của CLS-01 (docs/dataset.md mục 3) theo splits.json.

Mẫu là crop vùng mở (PNG bất kỳ kích thước, thường vuông) với nhãn cuối `labelFinal` (hay nhãn tạm `label`). Chỉ hai
lớp person / mannequin được đưa vào huấn luyện; `unknown` và `background` bỏ qua (chúng do quy tắc unknown xử lý lúc
chạy, mục 7.3 tính vào recall của lớp thật khi đánh giá).

Augment mô phỏng đúng đường chạy của app (restrictedFrame → letterbox → resize về input):
- crop lệch biên: cắt ngẫu nhiên một phần mép (cửa sổ ở mép camera cắt đầu, cắt vai),
- letterbox xám 128 về hình vuông rồi resize về input_size (giống letterbox của app, pad xám `face.padGray`),
- giảm độ phân giải: thu nhỏ rồi phóng lại (cửa sổ nhỏ),
- lật ngang, jitter sáng và tương phản nhẹ.
Chuẩn hóa (x / 255 − 0,45) / 0,225 cho cả ba kênh, cùng giá trị với `DEFAULTS.classifier.norm` của app.
"""

from __future__ import annotations

import json
import random
import sys
from pathlib import Path

CLASSES = ("person", "mannequin")
NORM_MEAN = 0.45
NORM_STD = 0.225
PAD_GRAY = 128

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dataset"))
from common import Sample, all_samples, load_root, read_json, utf8_console  # noqa: E402


def load_split(root: Path, split: str, splits_path: Path | None = None) -> list[Sample]:
    """Mẫu của một tập (train, val, test) chỉ với nhãn person hoặc mannequin."""
    splits = read_json(splits_path or (root / "splits.json"))
    by_sample = splits.get("bySample", {})
    out = []
    for s in all_samples(load_root(root)):
        if by_sample.get(s.id) != split:
            continue
        if s.label in CLASSES:
            out.append(s)
    return out


def letterbox_square(img, pad=(PAD_GRAY, PAD_GRAY, PAD_GRAY)):
    """PIL: đệm xám thành hình vuông (giữ tỉ lệ), như restrictedFrame → letterbox của app."""
    from PIL import Image

    w, h = img.size
    side = max(w, h)
    canvas = Image.new("RGB", (side, side), pad)
    canvas.paste(img, ((side - w) // 2, (side - h) // 2))
    return canvas


class CropAugment:
    """Augment cho train; val/test chỉ letterbox + resize."""

    def __init__(self, input_size: int, train: bool, seed: int | None = None):
        self.input_size = input_size
        self.train = train
        self.rng = random.Random(seed)

    def __call__(self, img):
        from PIL import Image, ImageEnhance

        img = img.convert("RGB")
        if self.train:
            w, h = img.size
            r = self.rng
            # Crop lệch biên: cắt tới 30 % một hay hai mép ngẫu nhiên.
            left = int(w * r.uniform(0, 0.3)) if r.random() < 0.5 else 0
            top = int(h * r.uniform(0, 0.3)) if r.random() < 0.5 else 0
            right = w - (int(w * r.uniform(0, 0.3)) if r.random() < 0.5 else 0)
            bottom = h - (int(h * r.uniform(0, 0.3)) if r.random() < 0.5 else 0)
            if right - left >= 16 and bottom - top >= 16:
                img = img.crop((left, top, right, bottom))
            # Giảm độ phân giải: thu nhỏ về 48..input_size rồi để resize phóng lại.
            if r.random() < 0.5:
                small = r.randint(48, self.input_size)
                img = img.resize((small, small), Image.BILINEAR)
            if r.random() < 0.5:
                img = img.transpose(Image.FLIP_LEFT_RIGHT)
            img = ImageEnhance.Brightness(img).enhance(r.uniform(0.7, 1.3))
            img = ImageEnhance.Contrast(img).enhance(r.uniform(0.7, 1.3))
        img = letterbox_square(img)
        return img.resize((self.input_size, self.input_size), Image.BILINEAR)


def to_tensor(img):
    """PIL RGB → tensor float32 CHW đã chuẩn hóa (không dùng torchvision.transforms để giữ đúng công thức của app)."""
    import numpy as np
    import torch

    arr = np.asarray(img, dtype=np.float32) / 255.0
    arr = (arr - NORM_MEAN) / NORM_STD
    return torch.from_numpy(arr.transpose(2, 0, 1).copy())


class CropDataset:
    """torch.utils.data.Dataset không kế thừa tường minh để import được khi chưa có torch (--help)."""

    def __init__(self, samples: list[Sample], input_size: int, train: bool, seed: int | None = None):
        self.samples = samples
        self.aug = CropAugment(input_size, train, seed)

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, i: int):
        from PIL import Image

        s = self.samples[i]
        with Image.open(s.png) as img:
            x = to_tensor(self.aug(img))
        return x, CLASSES.index(s.label)

    def meta(self, i: int) -> dict:
        return self.samples[i].meta


def class_counts(samples: list[Sample]) -> dict[str, int]:
    out = {c: 0 for c in CLASSES}
    for s in samples:
        out[s.label] += 1
    return out


def describe(root: Path) -> str:
    parts = []
    for split in ("train", "val", "test"):
        try:
            ss = load_split(root, split)
        except FileNotFoundError:
            return f"{root}: thiếu splits.json (chạy tools/dataset/split.py trước)"
        parts.append(f"{split}: {len(ss)} mẫu {json.dumps(class_counts(ss))}")
    return "\n".join(parts)


if __name__ == "__main__":
    utf8_console()
    print(describe(Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/dataset")))
