"""CLS-04 (D-066): nén model phân loại bằng cách chỉ đổi cách LƯU trọng số, phép tính giữ fp32.

- int8 theo kênh ra (đối xứng, scale = max|W_c| / 127): initializer int8 + Cast(int8 → float) + Mul(scale).
- fp16: initializer fp16 + Cast(→ float).
ONNX Runtime gập Cast/Mul trên initializer (constant folding, có trong bản wasm của onnxruntime-web) lúc tạo session,
nên đồ thị chạy giống hệt fp32 (kiểm bằng `folded_ops`) và tốc độ không đổi; chỉ cỡ file và sai số làm tròn trọng số
thay đổi. Lượng tử hóa cả activation (int8 động hay QDQ tĩnh) đã thử và loại: MobileNetV3-Small chỉ giữ được nhãn
hiển thị ở 5/33 mẫu (động) và argmax ở 27/33 mẫu (QDQ theo kênh), xem docs/classifier-report.md mục 5.2.

`search` đo độ nhạy từng lớp (chỉ lớp đó int8, còn lại fp32: max|Δmargin| trên bộ đầu vào), rồi bắt đầu với mọi lớp
lớn ở int8 và chuyển lớp nhạy nhất sang fp16 từng lớp một cho tới khi đạt cổng của compress_select. Lớp conv đầu tiên
và Gemm cuối (vài nghìn tham số) luôn giữ fp32; bias (input thứ ba của Conv/Gemm) và tensor nhỏ (< 1024 phần tử)
cũng vậy.

Bộ đầu vào của cổng phải có điểm sát ngưỡng 0,7 của quy tắc unknown, không thì cổng "lật nhãn" không kiểm được gì: model
nhảy từ person sang mannequin trong một bước α rất hẹp khi trộn ảnh, nên α của ảnh trộn được tìm bằng chia đôi trên chính
model fp32 để p(person) rơi vào BLEND_TARGETS.

Phụ thuộc nặng (numpy, onnx, onnxruntime, Pillow) chỉ import trong hàm; compress_select.py giữ phần quyết định.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dataset"))

from compress_select import agreement, passes  # noqa: E402

INT8_MIN_ELEMS = 4096
FP16_MIN_ELEMS = 1024
AUG_SEEDS = (2000, 2001, 2002)
SPIKE_FILES = ("face.png", "hands.jpg", "thumbs_up.jpg", "pointing_up.jpg")
SPIKE_SIDES = (300, 450, 700)
BLEND_TARGETS = (0.8, 0.75, 0.7, 0.65, 0.6)


def build_pack(root: Path, spike_dir: Path | None, input_size: int, fp32: Path | None = None):
    """Bộ đầu vào và tag: 'real:<tập>' (mọi mẫu person/mannequin), 'aug' (augment với seed khác huấn luyện), 'spike:…'
    (ảnh ngoài dataset, cả ảnh và crop giữa, không lặp crop khi ảnh nhỏ hơn cạnh crop), 'blend:α' (trộn một ảnh person
    với một ảnh mannequin: lưới α 0,1 và, khi có `fp32`, các α chia đôi cho p(person) ≈ BLEND_TARGETS)."""
    import numpy as np
    from PIL import Image

    from dataset import CropAugment, CropDataset, load_split, to_tensor

    xs, tags, people, others = [], [], [], []
    for split in ("train", "val", "test"):
        samples = load_split(root, split)
        ds = CropDataset(samples, input_size, train=False)
        for i, s in enumerate(samples):
            xs.append(ds[i][0].numpy())
            tags.append(f"real:{split}")
            (people if s.label == "person" else others).append(s.png)
    reals = people + others
    for seed in AUG_SEEDS:
        aug = CropAugment(input_size, train=True, seed=seed)
        for p in reals:
            with Image.open(p) as img:
                xs.append(to_tensor(aug(img.convert("RGB"))).numpy())
                tags.append("aug")
    plain = CropAugment(input_size, train=False)
    if spike_dir and spike_dir.is_dir():
        for name in SPIKE_FILES:
            p = spike_dir / name
            if not p.exists():
                continue
            with Image.open(p) as img:
                img = img.convert("RGB")
                xs.append(to_tensor(plain(img)).numpy())
                tags.append(f"spike:{name}:full")
                w, h = img.size
                seen_sides: set[int] = set()
                for side in SPIKE_SIDES:
                    s = min(side, w, h)
                    if s in seen_sides:
                        continue  # ảnh nhỏ: crop lớn hơn ảnh trùng với crop trước, không nhân đôi đầu vào
                    seen_sides.add(s)
                    box = ((w - s) // 2, (h - s) // 2, (w + s) // 2, (h + s) // 2)
                    xs.append(to_tensor(plain(img.crop(box))).numpy())
                    tags.append(f"spike:{name}:{side}")
    session = None
    if fp32 is not None:
        import onnxruntime as ort

        so = ort.SessionOptions()
        so.intra_op_num_threads = 1
        session = ort.InferenceSession(str(fp32), so, providers=["CPUExecutionProvider"])

    def p_person(t):
        z = session.run(["logits"], {"input": t[None]})[0][0]
        e = np.exp(z - z.max())
        return float(e[0] / e.sum())

    for a, b in list(zip(people, others))[:3]:
        with Image.open(a) as ia, Image.open(b) as ib:
            ia = ia.convert("RGB")
            ib = ib.convert("RGB").resize(ia.size)

            def blend(al: float):
                return to_tensor(plain(Image.blend(ia, ib, al))).numpy()

            for k in range(11):
                xs.append(blend(k / 10))
                tags.append(f"blend:{k / 10:.1f}")
            if session is None:
                continue
            # p(person) giảm khi α tăng (ảnh person → mannequin); chia đôi trên [0, 1] cho từng mức đích.
            p0, p1 = p_person(blend(0.0)), p_person(blend(1.0))
            for target in BLEND_TARGETS:
                if not (p0 > target > p1):
                    continue
                lo, hi = 0.0, 1.0
                for _ in range(20):
                    mid = (lo + hi) / 2
                    if p_person(blend(mid)) > target:
                        lo = mid
                    else:
                        hi = mid
                xs.append(blend((lo + hi) / 2))
                tags.append(f"blend:{(lo + hi) / 2:.4f}")
    return np.stack(xs).astype(np.float32), tags


def logits(path: Path, x):
    """Logits theo onnxruntime Python (CPU, một luồng) cho từng đầu vào [3, S, S]."""
    import numpy as np
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.intra_op_num_threads = 1
    s = ort.InferenceSession(str(path), so, providers=["CPUExecutionProvider"])
    return np.stack([s.run(["logits"], {"input": v[None]})[0][0] for v in x])


def weight_layers(model) -> tuple[list[str], set[str], dict[str, int]]:
    """(tên weight Conv/Gemm đủ lớn để int8, tên luôn giữ fp32, số phần tử theo tên initializer)."""
    sizes = {i.name: 1 for i in model.graph.initializer}
    for i in model.graph.initializer:
        for d in i.dims:
            sizes[i.name] *= int(d)
    convs = [n for n in model.graph.node if n.op_type == "Conv"]
    gemms = [n for n in model.graph.node if n.op_type == "Gemm"]
    keep = set()
    if convs:
        keep.add(convs[0].input[1])
    if gemms:
        keep.add(gemms[-1].input[1])
    cands = [
        n.input[1]
        for n in model.graph.node
        if n.op_type in ("Conv", "Gemm") and len(n.input) > 1 and n.input[1] not in keep
        and sizes.get(n.input[1], 0) >= INT8_MIN_ELEMS
    ]
    return cands, keep, sizes


def store(src: Path, dst: Path, int8_names: set[str], fp16: bool = True) -> dict[str, int]:
    """Ghi model với weight trong int8_names ở int8 theo kênh, các FLOAT initializer lớn khác ở fp16 (nếu fp16), phần
    còn lại fp32. Sửa ModelProto tại chỗ để giữ ir_version và opset. Trả số lớp theo kiểu lưu."""
    import numpy as np
    import onnx
    from onnx import TensorProto, helper, numpy_helper

    m = onnx.load(str(src))
    cands, keep, _ = weight_layers(m)
    unknown = int8_names - set(cands)
    if unknown:
        raise ValueError(f"không phải weight int8 hợp lệ: {sorted(unknown)}")
    # Bias (input thứ ba của Conv/Gemm) giữ fp32: nhỏ, và cộng thẳng vào đầu ra.
    biases = {n.input[2] for n in m.graph.node if n.op_type in ("Conv", "Gemm") and len(n.input) > 2}
    consumer = {n.input[1]: n for n in m.graph.node if n.op_type in ("Conv", "Gemm") and len(n.input) > 1}
    nodes, inits = [], []
    counts = {"int8": 0, "fp16": 0, "fp32": 0}
    for init in list(m.graph.initializer):
        if init.data_type != TensorProto.FLOAT:
            continue
        w = numpy_helper.to_array(init).astype(np.float32)
        if init.name in int8_names:
            node = consumer[init.name]
            trans_b = next((a.i for a in node.attribute if a.name == "transB"), 0)
            axis = (0 if trans_b else 1) if node.op_type == "Gemm" else 0
            red = tuple(i for i in range(w.ndim) if i != axis)
            mx = np.abs(w).max(axis=red, keepdims=True)
            scale = np.where(mx > 0, mx / 127.0, 1.0).astype(np.float32)
            q = np.clip(np.round(w / scale), -127, 127).astype(np.int8)
            qn, sn, fn = f"{init.name}_q8", f"{init.name}_scale", f"{init.name}_f32"
            m.graph.initializer.remove(init)
            inits += [numpy_helper.from_array(q, qn), numpy_helper.from_array(scale, sn)]
            nodes += [
                helper.make_node("Cast", [qn], [fn], to=TensorProto.FLOAT, name=f"{fn}_cast"),
                helper.make_node("Mul", [fn, sn], [init.name], name=f"{init.name}_dq"),
            ]
            counts["int8"] += 1
        elif fp16 and w.size >= FP16_MIN_ELEMS and init.name not in keep and init.name not in biases:
            hn = f"{init.name}_f16"
            m.graph.initializer.remove(init)
            inits.append(numpy_helper.from_array(w.astype(np.float16), hn))
            nodes.append(helper.make_node("Cast", [hn], [init.name], to=TensorProto.FLOAT, name=f"{hn}_cast"))
            counts["fp16"] += 1
        else:
            counts["fp32"] += 1
    m.graph.initializer.extend(inits)
    for i, n in enumerate(nodes):
        m.graph.node.insert(i, n)
    onnx.checker.check_model(m)
    dst.parent.mkdir(parents=True, exist_ok=True)
    onnx.save(m, str(dst))
    return counts


def folded_ops(path: Path, work: Path) -> dict[str, int]:
    """Biểu đồ op sau tối ưu BASIC của onnxruntime (cùng bản 1.30 với onnxruntime-web): model nén phải gập về đúng
    biểu đồ của fp32 (không còn Cast/Mul của weight lúc chạy)."""
    import onnx
    import onnxruntime as ort

    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    opt = work / f"{path.stem}.basic.onnx"
    so.optimized_model_filepath = str(opt)
    ort.InferenceSession(str(path), so, providers=["CPUExecutionProvider"])
    out: dict[str, int] = {}
    for n in onnx.load(str(opt)).graph.node:
        out[n.op_type] = out.get(n.op_type, 0) + 1
    opt.unlink()
    return dict(sorted(out.items()))


def _rows(a) -> list[list[float]]:
    return [[float(v) for v in r] for r in a]


def search(fp32: Path, x, tags: list[str], work: Path, mode: str = "auto", log=print) -> list[dict]:
    """Ứng viên (fp32, fp16w, và với 'auto' bản int8 + fp16 ít byte nhất đạt cổng) cùng agreement theo onnxruntime
    Python. Ứng viên không gập được về đồ thị fp32 bị loại."""
    import numpy as np
    import onnx

    ref = logits(fp32, x)
    ref_rows = _rows(ref)
    base_ops = folded_ops(fp32, work)
    out = [{"mode": "none", "path": fp32, "bytes": fp32.stat().st_size, "layers": {"int8": 0, "fp16": 0},
            "agreement": agreement(ref_rows, ref_rows, tags)}]

    def candidate(name: str, int8: set[str]) -> dict | None:
        path = work / f"classifier.{name}.onnx"
        counts = store(fp32, path, int8)
        ops = folded_ops(path, work)
        if ops != base_ops:
            log(f"{name}: không gập về đồ thị fp32 ({ops}), loại")
            return None
        a = agreement(ref_rows, _rows(logits(path, x)), tags)
        return {"mode": name, "path": path, "bytes": path.stat().st_size,
                "layers": {"int8": counts["int8"], "fp16": counts["fp16"]}, "agreement": a}

    c = candidate("fp16w", set())
    if c:
        out.append(c)
    if mode != "auto":
        return out

    cands, _, _ = weight_layers(onnx.load(str(fp32)))
    probe = work / "classifier.probe.onnx"
    sens = []
    for name in cands:
        store(fp32, probe, {name}, fp16=False)
        lg = logits(probe, x)
        sens.append((float(np.abs((lg[:, 0] - lg[:, 1]) - (ref[:, 0] - ref[:, 1])).max()), name))
    probe.unlink(missing_ok=True)
    sens.sort(reverse=True)
    order = [n for _, n in sens]
    log("độ nhạy (max|Δmargin| khi chỉ lớp đó ở int8), 5 lớp đầu: "
        + ", ".join(f"{n} {d:.3f}" for d, n in sens[:5]))
    for k in range(len(order) + 1):
        trial = candidate("int8+fp16w", set(order[k:]))
        if trial is None:
            break
        ok, why = passes(trial["agreement"])
        log(f"int8 {len(order) - k} lớp, fp16 {k} lớp nhạy nhất: {trial['bytes'] / 1e6:.2f} MB, "
            + ("đạt cổng" if ok else "trượt: " + "; ".join(why)))
        if ok:
            out.append(trial)
            break
    (work / "sensitivity.json").write_text(
        json.dumps([{"layer": n, "maxAbsDMargin": round(d, 4)} for d, n in sens], indent=1), encoding="utf-8"
    )
    return out


def write_pack(work: Path, x, tags: list[str], ref) -> None:
    """Bộ đầu vào cho tools/train/check_wasm.mjs: float32 liền [N, 3, S, S], tag, logits fp32 của Python."""
    import numpy as np

    work.mkdir(parents=True, exist_ok=True)
    np.ascontiguousarray(x, dtype=np.float32).tofile(str(work / "pack.f32"))
    np.ascontiguousarray(ref, dtype=np.float32).tofile(str(work / "pack.ref.f32"))
    shape = list(x.shape[1:])
    (work / "pack.json").write_text(json.dumps({"n": len(tags), "shape": shape, "tags": tags}), encoding="utf-8")


def read_wasm_logits(path: Path, n: int) -> list[list[float]]:
    import numpy as np

    a = np.fromfile(str(path), dtype=np.float32).reshape(n, -1)
    return _rows(a)
