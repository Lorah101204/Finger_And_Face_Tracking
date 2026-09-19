# Dataset người và hình nộm (CLS-01)

Tài liệu của gói CLS-01 (WORK-BREAKDOWN mục 6, quyết định D-043): giao thức thu, dataset mode trong app, ma trận thu, gán nhãn, chia tập và thống kê. Trạng thái: đường ống và công cụ đã có và được kiểm thử tự động; **chưa có dữ liệu thật** vì việc thu cần người tham gia và hình nộm (mục 8).

## 1. Nguyên tắc (I8, I9)

- Chỉ lưu **crop vùng mở**: ảnh mà worker mặt nhận, bản trước letterbox (crop 1:1 của `cameraRect`, các ô không mở đã tô đệm xám). Không bao giờ lưu frame gốc, không lưu video, không lưu landmark hay ảnh ngoài vùng mở. `tools/dataset/label.py check` xác nhận bằng kích thước ảnh so với khung camera của phiên.
- Lưu **cục bộ trên máy thu** (thư mục do người thu chọn, hoặc gói zip tải về). Không có đường mạng nào (I9); ứng dụng tĩnh không có backend (D-019).
- **Ẩn danh**: metadata chỉ có `subjectId` do người thu đặt (ví dụ `S-7k2m`), không tên, không liên hệ. Bảng đối chiếu tên với `subjectId` (nếu cần cho quyền xóa) người thu giữ riêng, ngoài dataset.
- Thu chỉ khi **có văn bản đồng ý** của người tham gia (mục 2); app không cho Bắt đầu thu nếu chưa tích xác nhận, và ghi `participantConsent: true` vào `session.json`.

## 2. Giao thức thu (bước 1)

1. Người thu giải thích và đưa văn bản đồng ý (phụ lục A) cho người tham gia ký trước khi bật dataset mode. Với hình nộm, người thu ghi loại hình nộm và không cần văn bản.
2. Mục đích: huấn luyện và đánh giá bộ phân loại người / hình nộm (CLS-02) chạy trên crop vùng mở của ứng dụng Web Camera Tracking.
3. Nơi lưu: máy thu, thư mục `data/dataset/` (nằm trong `.gitignore`), hoặc bản sao trên ổ lưu trữ cục bộ của nhóm. Không đưa lên dịch vụ đám mây, không commit vào git.
4. Quyền xóa: người tham gia có thể yêu cầu xóa bất kỳ lúc nào bằng cách nêu `subjectId` (ghi trên văn bản đồng ý). Xóa mọi thư mục phiên có `subjectId` đó rồi chạy lại `split.py` và `stats.py`.
5. Thời hạn: dữ liệu chỉ dùng cho dự án này; xóa khi dự án kết thúc hoặc theo yêu cầu.
6. Mỗi phiên thu (một người hoặc một hình nộm, một điều kiện) là một thư mục `ses-…`; đổi người, đổi điều kiện thì Dừng thu và Bắt đầu thu lại để phiên mới có metadata đúng.

## 3. Dataset mode trong app (bước 2)

Vào `#/app`, mở panel Cài đặt, tích **Thu dữ liệu**. Các trường: xác nhận *Người tham gia đã ký đồng ý bằng văn bản* (bắt buộc), *Mã* người tham gia (ẩn danh, tự sinh, sửa được), *Nhãn tạm* (Người, Hình nộm, Chưa rõ, Chỉ nền hoặc chỉ tay), *Ánh sáng*, *Hình nộm* (loại), *Ghi chú*, *Nhịp thu* (Hz, mặc định 2). Nút **Bắt đầu thu** chỉ bật khi đã tích đồng ý; đang thu thì có chỉ báo đỏ "Đang thu dữ liệu · n mẫu" ở góc trên phải canvas (cả khi toàn màn hình). Mẫu chỉ được lưu khi vùng mở hợp lệ (cửa sổ theo tay hoặc chuột); đóng vùng thì không lưu gì. Tối đa 300 mẫu mỗi phiên (`DEFAULTS.dataset.maxSamples`), tới ngưỡng thì tự dừng.

Nơi lưu: **Chọn thư mục…** (Chromium, File System Access API) ghi thẳng từng mẫu vào `<thư mục>/<sessionId>/`; không chọn thì mẫu giữ trong bộ nhớ và **Tải zip** cho gói cùng cấu trúc. Nút **Xóa mẫu trong bộ nhớ** bỏ mẫu chưa tải.

Cấu trúc và schema:

```
data/dataset/
  ses-<thời gian>-<ngẫu nhiên>/
    session.json          # SessionMeta
    ses-…-0001.png        # crop vùng mở, PNG, kích thước = cameraRect (bản trước letterbox)
    ses-…-0001.json       # SampleMeta
  _labels/<nhãn>/*.png    # (tùy chọn) bản copy để gán nhãn cuối bằng thư mục, mục 5
  splits.json, splits.csv # mục 6
  labels.csv              # label.py csv
```

| Trường của `SampleMeta` | Ý nghĩa |
|---|---|
| `id`, `sessionId`, `subjectId` | mã mẫu (`<sessionId>-<số thứ tự>`), phiên, người hoặc hình nộm ẩn danh |
| `label`, `lighting`, `mannequinType` | nhãn tạm và điều kiện người thu chọn lúc thu (`person`, `mannequin`, `unknown`, `background`; `normal`, `bright`, `dim`, `backlit`; `none`, `plastic`, `fabric`, `silicone`) |
| `labelFinal` | nhãn cuối do `label.py` ghi (mục 5); thiếu thì dùng `label` |
| `ts`, `capturedAt`, `epoch`, `frameId`, `taskId` | mốc frame camera và thời điểm lưu; epoch, frame và tác vụ của vòng lặp |
| `cameraRect`, `crop` | rect camera của vùng mở và kích thước PNG (bằng nhau) |
| `cellsBox`, `cellCount`, `holes`, `n` | hộp bao theo ô, số ô mở, số lỗ được tô đệm, cạnh ngắn theo ô |
| `sizeClass` | `small` < 160 px, `medium` < 320 px, `large` (cạnh ngắn của crop, `DEFAULTS.dataset`) |
| `position`, `edges` | `edge` khi `cameraRect` chạm mép camera (cắt đầu: `top`; cắt vai: `bottom`; cắt bên: `left`, `right`), ngược lại `center` |
| `grid`, `mirror` | lưới lúc thu và cờ mirror (crop không mirror) |

`session.json` có các trường người thu nhập, `participantConsent`, `startedAt`, `stoppedAt`, `samples` và `app` (`consentVersion`, `rateHz`, `grid`, `camera`).

## 4. Ma trận thu (bước 3)

Mục tiêu tối thiểu cho tập đầu tiên; mỗi ô là một hoặc nhiều phiên. Cột "phiên" ghi số phiên đã thu (cập nhật tay khi thu).

| Đối tượng | Điều kiện | Cửa sổ | Mục tiêu | Phiên |
|---|---|---|---|---|
| Người, ≥ 5 người, mỗi người ≥ 2 trang phục | sáng bình thường | nhỏ, vừa, lớn; giữa và mép (cắt đầu, cắt vai) | ≥ 200 mẫu mỗi người | 0 |
| Người | ánh sáng mạnh, yếu, ngược sáng | vừa | ≥ 60 mẫu mỗi điều kiện mỗi người | 0 |
| Người | góc nghiêng, che khuất một phần (tay, tóc, khẩu trang) | vừa, lớn | ≥ 60 mẫu mỗi kiểu | 0 |
| Người đứng im (ca đặc biệt) | bình thường | vừa | ≥ 60 mẫu | 0 |
| Hình nộm nhựa, vải, silicone giống người | như người: ba mức sáng, ba cỡ, giữa và mép | | ≥ 200 mẫu mỗi hình nộm | 0 |
| Hình nộm được di chuyển (ca đặc biệt) | bình thường | vừa | ≥ 60 mẫu | 0 |
| Chỉ nền (`background`) | ba mức sáng | nhỏ, vừa, lớn | ≥ 100 mẫu | 0 |
| Chỉ tay (`background`) | bình thường | vừa | ≥ 60 mẫu | 0 |
| Chưa rõ (`unknown`): cửa sổ quá nhỏ, cắt gần hết mặt | | nhỏ, mép | ≥ 100 mẫu | 0 |

Ghi chú: cửa sổ nhỏ, vừa, lớn theo `sizeClass`; mép theo `position`. Người đứng im và hình nộm được di chuyển dùng để bảo đảm bộ phân loại không dựa vào chuyển động (CLS-02 bước 2 không dùng chuyển động).

## 5. Gán nhãn (bước 4)

Nhãn cuối: `person`, `mannequin`, `unknown` (không đủ thông tin để quyết, ví dụ cửa sổ chỉ có một phần nhỏ của mặt), `background` (chỉ nền hoặc chỉ tay). Công cụ `tools/dataset/label.py` (chỉ thư viện chuẩn Python 3):

```bash
python tools/dataset/label.py list data/dataset --unlabeled
python tools/dataset/label.py set data/dataset --label mannequin ses-…-0001 ses-…-0002
python tools/dataset/label.py from-dirs data/dataset      # copy PNG vào data/dataset/_labels/<nhãn>/ rồi chạy
python tools/dataset/label.py check data/dataset          # thoát 1 khi lỗi cấu trúc hay có ảnh bằng khung camera
python tools/dataset/label.py csv data/dataset
```

`check` báo: PNG thiếu JSON hay ngược lại, kích thước PNG khác `crop`, ảnh bằng hoặc vượt khung camera của phiên (frame gốc), `sessionId` lệch thư mục, nhãn không hợp lệ, phiên thiếu `participantConsent`.

## 6. Chia tập (bước 5)

```bash
python tools/dataset/split.py data/dataset --train 0.7 --val 0.15 --test 0.15 --seed 1
```

Chia theo `subjectId` (mọi phiên của một người hay hình nộm vào cùng tập), tham lam theo số mẫu để gần tỉ lệ; ba subject đầu chia đều để mỗi tập có ít nhất một subject. Ghi `splits.json` và `splits.csv`; kiểm không có `sessionId` hay `subjectId` nào ở hai tập, có thì thoát 1.

## 7. Thống kê (bước 6)

```bash
python tools/dataset/stats.py data/dataset --doc docs/dataset.md
```

<!-- dataset:begin -->
Chưa có dữ liệu thật: bảng sinh sau lần thu đầu tiên (`python tools/dataset/stats.py data/dataset --doc docs/dataset.md`).
<!-- dataset:end -->

## 8. Trạng thái và việc còn lại

- Đã có: dataset mode trong app (chỉ crop vùng mở, thư mục hoặc zip, chỉ báo, đồng ý bắt buộc), công cụ gán nhãn, chia tập, thống kê, kiểm rò rỉ và kiểm frame gốc; kiểm thử tự động ở WORK-BREAKDOWN mục 7.22.
- Còn chờ: thu thật theo ma trận mục 4 với người tham gia đã ký phụ lục A và các hình nộm; sau lần thu đầu chạy `check`, `split.py`, `stats.py --doc` và cập nhật cột "phiên" của mục 4.

## Phụ lục A. Mẫu văn bản đồng ý của người tham gia

> **Đồng ý tham gia thu dữ liệu cho dự án Web Camera Tracking**
>
> Tôi được giải thích rằng ứng dụng chỉ lưu ảnh cắt của **vùng cửa sổ đang mở** trên màn hình (không lưu toàn khung camera, không lưu video), kèm các thông tin kỹ thuật (kích thước cửa sổ, điều kiện sáng, thời điểm) và một mã ẩn danh. Dữ liệu được lưu trên máy thu, không đưa lên mạng, chỉ dùng để huấn luyện và đánh giá bộ phân loại người / hình nộm của dự án.
>
> Tôi có thể yêu cầu xóa dữ liệu của mình bất kỳ lúc nào bằng cách nêu mã dưới đây; dữ liệu sẽ bị xóa khỏi mọi bản sao của dự án.
>
> Mã ẩn danh (subjectId): ______________  Ngày thu: ____________
>
> Người tham gia (ký, ghi họ tên): ______________________
>
> Người thu dữ liệu (ký, ghi họ tên): ______________________
