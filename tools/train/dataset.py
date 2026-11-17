#!/usr/bin/env python3
"""CLS-02 bước 1: Dataset PyTorch đọc dataset của CLS-01 (docs/dataset.md mục 3) theo splits.json.

Mẫu là crop vùng mở (PNG bất kỳ kích thước, thường vuông) với nhãn cuối `labelFinal` (hay nhãn tạm `label`). Chỉ hai
lớp person / mannequin được đưa vào huấn luyện; `unknown` và `background` bỏ qua (chúng do quy tắc unknown xử lý lúc
chạy, mục 7.3 tính vào recall của lớp thật khi đánh giá).

Augment mô phỏng đúng đường chạy của app (restrictedFrame → letterbox → resize về input):
- crop lệch biên: cắt ngẫu nhiên một phần mép (cửa sổ ở mép camera cắt đầu, cắt vai),
- letterbox xám 128 về hình vuông rồi resize về input_size (giống letterbox của app, pad xám `face.padGray`),
- giảm độ phân giải: thu nhỏ rồi phóng lại (cửa sổ nhỏ),
- lật ngang, jitter sáng và tương phản nhẹ,
- CLS-05: lệch cân bằng trắng, mờ, nén JPEG (webcam rẻ) và ô xám ở mép (ô lỗ của đa giác bao lồi cắt hộp bao).
Chuẩn hóa (x / 255 − 0,45) / 0,225 cho cả ba kênh, cùng giá trị với `DEFAULTS.classifier.norm` của app.

CLS-05 (D-070): app không còn đưa cả crop vùng mở cho classifier mà một crop vuông quanh khuôn mặt (faceCropRect của
src/classify/faceCrop.ts). Mẫu thu từ CLS-05 có `face` (bbox mặt theo gốc crop) trong metadata; `crop="face"` (mặc định)
cắt mẫu đúng như app bằng face_crop_box (cùng công thức, ca kiểm thử chung tests/unit/fixtures/face-crop-cases.json).
Mẫu cũ không có `face` thì giữ cả crop như trước. Lúc huấn luyện bbox mặt được lệch nhẹ (tâm ±8 %, scale 1,4 đến 1,8)
vì lúc chạy bbox là của kết quả mặt trước đó một nhịp.
"""

from __future__ import annotations

import io
import json
import math
import random
import sys
from pathlib import Path

CLASSES = ("person", "mannequin")
NORM_MEAN = 0.45
NORM_STD = 0.225
PAD_GRAY = 128
# CLS-05 (D-070): bằng DEFAULTS.classifier.faceCropScale của app (tests/unit/trainParity.test.ts kiểm hai bên khớp).
FACE_CROP_SCALE = 1.6
CROP_MODES = ("face", "region")

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


def js_round(v: float) -> int:
    """Math.round của JS (nửa làm tròn lên); round() của Python làm tròn nửa về số chẵn nên lệch app ở x,5."""
    return math.floor(v + 0.5)


def face_crop_box(face: dict | None, bounds: dict, scale: float = FACE_CROP_SCALE) -> dict | None:
    """CLS-05: cùng công thức faceCropRect của app: hình vuông cạnh scale × cạnh dài bbox mặt quanh tâm mặt, dời vào
    trong bounds, cạnh vượt bounds thì cắt theo bounds; rect nguyên {x, y, w, h}. None khi bbox hay bounds rỗng."""
    if not face or face["w"] <= 0 or face["h"] <= 0 or bounds["w"] <= 0 or bounds["h"] <= 0:
        return None
    side = max(1, js_round(max(face["w"], face["h"]) * scale))

    def axis(center: float, b0: int, blen: int) -> tuple[int, int]:
        ln = min(side, blen)
        return max(b0, min(b0 + blen - ln, js_round(center - ln / 2))), ln

    x, w = axis(face["x"] + face["w"] / 2, bounds["x"], bounds["w"])
    y, h = axis(face["y"] + face["h"] / 2, bounds["y"], bounds["h"])
    return {"x": x, "y": y, "w": w, "h": h}


def classifier_view(img, meta: dict, crop: str = "face", rng: random.Random | None = None):
    """Ảnh mà classifier của app thấy từ một mẫu: (ảnh, rect đã cắt hay None khi giữ cả crop vùng).

    crop="face" và metadata có `face` → cắt quanh mặt bằng face_crop_box; `rng` (chỉ khi huấn luyện) lệch nhẹ tâm và
    scale. crop="region" hay mẫu cũ không có `face` → cả crop vùng như CLS-02.
    """
    if crop not in CROP_MODES:
        raise ValueError(f"crop phải là một trong {CROP_MODES}")
    face = meta.get("face") if crop == "face" else None
    if not face:
        return img, None
    w, h = img.size
    scale = FACE_CROP_SCALE
    if rng is not None:
        s = max(face["w"], face["h"])
        face = {**face, "x": face["x"] + rng.uniform(-0.08, 0.08) * s, "y": face["y"] + rng.uniform(-0.08, 0.08) * s}
        scale = rng.uniform(1.4, 1.8)
    box = face_crop_box(face, {"x": 0, "y": 0, "w": w, "h": h}, scale)
    if box is None:
        return img, None
    return img.crop((box["x"], box["y"], box["x"] + box["w"], box["y"] + box["h"])), box


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
        from PIL import Image, ImageDraw, ImageEnhance, ImageFilter

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
            # CLS-05: cân bằng trắng lệch theo kênh (webcam, đèn ấm hay lạnh).
            if r.random() < 0.5:
                gains = [r.uniform(0.9, 1.1) for _ in range(3)]
                img = Image.merge("RGB", [ch.point(lambda v, g=g: min(255, int(v * g))) for ch, g in zip(img.split(), gains)])
            # CLS-05: mờ (lấy nét kém, chuyển động) và nén JPEG (luồng webcam nén).
            if r.random() < 0.25:
                img = img.filter(ImageFilter.GaussianBlur(r.uniform(0.3, 1.2)))
            if r.random() < 0.3:
                buf = io.BytesIO()
                img.save(buf, format="JPEG", quality=r.randint(35, 90))
                buf.seek(0)
                with Image.open(buf) as j:
                    img = j.convert("RGB")
            # CLS-05: ô lỗ xám ở góc hay mép (đa giác bao lồi của các đầu ngón cắt hộp bao), như restrictedFrame tô.
            if r.random() < 0.25:
                w, h = img.size
                draw = ImageDraw.Draw(img)
                for _ in range(r.randint(1, 3)):
                    cw = max(1, int(w * r.uniform(0.08, 0.25)))
                    ch = max(1, int(h * r.uniform(0.08, 0.25)))
                    x0 = 0 if r.random() < 0.5 else w - cw
                    y0 = 0 if r.random() < 0.5 else h - ch
                    draw.rectangle((x0, y0, x0 + cw - 1, y0 + ch - 1), fill=(PAD_GRAY, PAD_GRAY, PAD_GRAY))
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

    def __init__(self, samples: list[Sample], input_size: int, train: bool, seed: int | None = None,
                 crop: str = "face"):
        if crop not in CROP_MODES:
            raise ValueError(f"crop phải là một trong {CROP_MODES}")
        self.samples = samples
        self.train = train
        self.crop = crop
        self.aug = CropAugment(input_size, train, seed)

    def __len__(self) -> int:
        return len(self.samples)

    def __getitem__(self, i: int):
        from PIL import Image

        s = self.samples[i]
        with Image.open(s.png) as img:
            view, _ = classifier_view(img.convert("RGB"), s.meta, self.crop, self.aug.rng if self.train else None)
            x = to_tensor(self.aug(view))
        return x, CLASSES.index(s.label)

    def meta(self, i: int) -> dict:
        return self.samples[i].meta


def face_counts(samples: list[Sample]) -> dict[str, int]:
    """CLS-05: số mẫu có bbox mặt trong metadata (cắt được quanh mặt như app) và số mẫu cũ chỉ có crop vùng."""
    with_face = sum(1 for s in samples if s.meta.get("face"))
    return {"face": with_face, "regionOnly": len(samples) - with_face}


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
