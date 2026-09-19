# Person and mannequin dataset (CLS-01)

Document of work package CLS-01 (WORK-BREAKDOWN section 6, decision D-043): capture protocol, dataset mode in the app, capture matrix, labeling, split and statistics. Status: the pipeline and tools exist and are tested automatically; **no real data yet** because capture needs participants and mannequins (section 8).

## 1. Principles (I8, I9)

- Only the **reveal-region crop** is stored: the image the face worker receives, the version before letterboxing (a 1:1 crop of `cameraRect`, with unrevealed cells filled with gray padding). Never the raw frame, no video, no landmarks or pixels outside the reveal region. `tools/dataset/label.py check` verifies this by comparing the image size with the session's camera frame.
- Stored **locally on the capture machine** (a folder chosen by the collector, or a downloaded zip). No network path at all (I9); the static app has no backend (D-019).
- **Anonymous**: the metadata holds only a `subjectId` set by the collector (for example `S-7k2m`), no name, no contact. The table mapping names to `subjectId` (if needed for the right to deletion) is kept separately by the collector, outside the dataset.
- Capture only with a **signed consent form** from the participant (section 2); the app does not allow Bắt đầu thu (Start capture) until the confirmation is ticked, and writes `participantConsent: true` to `session.json`.

## 2. Capture protocol (step 1)

1. The collector explains and hands the consent form (appendix A) to the participant to sign before enabling dataset mode. For a mannequin, the collector records the mannequin type and no form is needed.
2. Purpose: training and evaluating the person / mannequin classifier (CLS-02) that runs on the reveal-region crop of the Web Camera Tracking app.
3. Storage: the capture machine, folder `data/dataset/` (listed in `.gitignore`), or a copy on the team's local storage drive. Never uploaded to a cloud service, never committed to git.
4. Right to deletion: the participant can request deletion at any time by giving the `subjectId` (written on the consent form). Delete every session folder with that `subjectId`, then rerun `split.py` and `stats.py`.
5. Retention: the data is used only for this project; deleted when the project ends or on request.
6. Each capture session (one person or one mannequin, one condition) is a `ses-…` folder; when the person or the condition changes, Dừng thu (Stop capture) and Bắt đầu thu (Start capture) again so the new session has the correct metadata.

## 3. Dataset mode in the app (step 2)

Go to `#/app`, open the settings panel, tick **Thu dữ liệu** (Data capture). Fields: the confirmation *Người tham gia đã ký đồng ý bằng văn bản* (The participant has signed a written consent) (required), the participant *Mã* (ID) (anonymous, auto-generated, editable), *Nhãn tạm* (Provisional label) (Người, Hình nộm, Chưa rõ, Chỉ nền hoặc chỉ tay: Person, Mannequin, Unclear, Background or hands only), *Ánh sáng* (Lighting), *Hình nộm* (Mannequin type), *Ghi chú* (Notes), *Nhịp thu* (Capture rate) (Hz, default 2). The **Bắt đầu thu** (Start capture) button is enabled only once consent is ticked; while capturing, a red indicator "Đang thu dữ liệu · n mẫu" (Capturing data · n samples) is shown in the top-right corner of the canvas (also in fullscreen). Samples are stored only while the reveal region is valid (hand or mouse window); nothing is stored when the region is closed. At most 300 samples per session (`DEFAULTS.dataset.maxSamples`); capture stops by itself at the limit.

Storage: **Chọn thư mục…** (Choose folder…) (Chromium, File System Access API) writes each sample directly to `<folder>/<sessionId>/`; without a folder, samples stay in memory and **Tải zip** (Download zip) gives a package with the same structure. The **Xóa mẫu trong bộ nhớ** (Clear samples in memory) button discards samples not yet downloaded.

Structure and schema:

```
data/dataset/
  ses-<timestamp>-<random>/
    session.json          # SessionMeta
    ses-…-0001.png        # reveal-region crop, PNG, size = cameraRect (before letterbox)
    ses-…-0001.json       # SampleMeta
  _labels/<label>/*.png    # (optional) copies for final labeling by folder, section 5
  splits.json, splits.csv # section 6
  labels.csv              # label.py csv
```

| `SampleMeta` field | Meaning |
|---|---|
| `id`, `sessionId`, `subjectId` | sample ID (`<sessionId>-<seq>`), session, anonymous person or mannequin |
| `label`, `lighting`, `mannequinType` | provisional label and conditions chosen by the collector at capture time (`person`, `mannequin`, `unknown`, `background`; `normal`, `bright`, `dim`, `backlit`; `none`, `plastic`, `fabric`, `silicone`) |
| `labelFinal` | final label written by `label.py` (section 5); falls back to `label` when missing |
| `ts`, `capturedAt`, `epoch`, `frameId`, `taskId` | camera frame timestamp and time of storage; epoch, frame and task of the loop |
| `cameraRect`, `crop` | camera rect of the reveal region and PNG size (equal) |
| `cellsBox`, `cellCount`, `holes`, `n` | bounding box in cells, number of open cells, number of padded holes, short side in cells |
| `sizeClass` | `small` < 160 px, `medium` < 320 px, `large` (short side of the crop, `DEFAULTS.dataset`) |
| `position`, `edges` | `edge` when `cameraRect` touches the camera border (head cut off: `top`; shoulders cut off: `bottom`; side cut off: `left`, `right`), otherwise `center` |
| `grid`, `mirror` | grid at capture time and the mirror flag (the crop is not mirrored) |

`session.json` holds the fields entered by the collector, `participantConsent`, `startedAt`, `stoppedAt`, `samples` and `app` (`consentVersion`, `rateHz`, `grid`, `camera`).

## 4. Capture matrix (step 3)

Minimum targets for the first set; each cell is one or more sessions. The "Sessions" column records the number of sessions captured (updated by hand during capture).

| Subject | Condition | Window | Target | Sessions |
|---|---|---|---|---|
| Person, ≥ 5 people, ≥ 2 outfits each | normal lighting | small, medium, large; center and edge (head cut off, shoulders cut off) | ≥ 200 samples per person | 0 |
| Person | bright, dim, backlit | medium | ≥ 60 samples per condition per person | 0 |
| Person | tilted angle, partial occlusion (hand, hair, face mask) | medium, large | ≥ 60 samples per kind | 0 |
| Person standing still (special case) | normal | medium | ≥ 60 samples | 0 |
| Plastic, fabric and lifelike silicone mannequins | as for people: three lighting levels, three sizes, center and edge | | ≥ 200 samples per mannequin | 0 |
| Mannequin being moved (special case) | normal | medium | ≥ 60 samples | 0 |
| Background only (`background`) | three lighting levels | small, medium, large | ≥ 100 samples | 0 |
| Hands only (`background`) | normal | medium | ≥ 60 samples | 0 |
| Unclear (`unknown`): window too small, most of the face cut off | | small, edge | ≥ 100 samples | 0 |

Note: small, medium and large windows follow `sizeClass`; edge follows `position`. The person standing still and the mannequin being moved make sure the classifier does not rely on motion (CLS-02 step 2 uses no motion).

## 5. Labeling (step 4)

Final labels: `person`, `mannequin`, `unknown` (not enough information to decide, for example the window holds only a small part of the face), `background` (background only or hands only). Tool `tools/dataset/label.py` (Python 3 standard library only):

```bash
python tools/dataset/label.py list data/dataset --unlabeled
python tools/dataset/label.py set data/dataset --label mannequin ses-…-0001 ses-…-0002
python tools/dataset/label.py from-dirs data/dataset      # copy PNGs into data/dataset/_labels/<label>/ then run
python tools/dataset/label.py check data/dataset          # exits 1 on structure errors or an image equal to the camera frame
python tools/dataset/label.py csv data/dataset
```

`check` reports: a PNG without JSON or vice versa, PNG size different from `crop`, an image equal to or larger than the session's camera frame (raw frame), `sessionId` not matching the folder, invalid labels, sessions missing `participantConsent`.

## 6. Split (step 5)

```bash
python tools/dataset/split.py data/dataset --train 0.7 --val 0.15 --test 0.15 --seed 1
```

Split by `subjectId` (every session of one person or mannequin goes into the same split), greedy by sample count to approach the ratios; the first three subjects are spread so every split has at least one subject. Writes `splits.json` and `splits.csv`; checks that no `sessionId` or `subjectId` appears in two splits, and exits 1 if one does.

## 7. Statistics (step 6)

```bash
python tools/dataset/stats.py data/dataset --doc docs/dataset.md
```

<!-- dataset:begin -->
No real data yet: the table is generated after the first capture (`python tools/dataset/stats.py data/dataset --doc docs/dataset.md`).
<!-- dataset:end -->

## 8. Status and remaining work

- Done: dataset mode in the app (reveal-region crop only, folder or zip, indicator, mandatory consent), labeling, split and statistics tools, leakage check and raw-frame check; automated tests in WORK-BREAKDOWN section 7.22.
- Pending: real capture per the matrix in section 4 with participants who have signed appendix A and the mannequins; after the first capture run `check`, `split.py`, `stats.py --doc` and update the "Sessions" column of section 4.

## Appendix A. Participant consent form template

> **Consent to take part in data capture for the Web Camera Tracking project**
>
> I have been informed that the app stores only the cropped image of the **open window region** on the screen (not the full camera frame, no video), together with technical information (window size, lighting condition, time) and an anonymous ID. The data is stored on the capture machine, is never uploaded to the internet, and is used only to train and evaluate the project's person / mannequin classifier.
>
> I can request deletion of my data at any time by giving the ID below; the data will be deleted from every copy held by the project.
>
> Anonymous ID (subjectId): ______________  Capture date: ____________
>
> Participant (signature, full name): ______________________
>
> Data collector (signature, full name): ______________________
