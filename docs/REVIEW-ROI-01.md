# Ghi chú rà soát sau ROI-01 và việc cần theo dõi

| Mục | Giá trị |
|---|---|
| Ngày rà soát | 2026-09-18 (giờ Việt Nam, UTC+7) |
| Mốc project lúc rà soát | Xong ROI-01 (D-035, D-036); gói kế tiếp là INT-01 |
| Phạm vi | Tài liệu trong `docs/`, mã `src/`, test `tests/`, script `tools/`; không sửa gì trong project |
| Cập nhật gần nhất của file này | 2026-09-18 |

File này ghi lại các vấn đề phát sinh tìm thấy ở lần rà soát và dùng để theo dõi tới khi xử lý xong. Quyết định thiết kế vẫn ghi vào [decisions.md](./decisions.md) (D-037 trở đi); file này chỉ trỏ tới mã quyết định, không lặp lại nội dung.

## 1. Cách cập nhật

Mỗi việc có một mã `R-xx`. Khi làm, sửa ba chỗ:

1. Bảng ở mục 3: đổi cột Trạng thái (`Mở`, `Đang làm`, `Xong`, `Bỏ`), ghi ngày vào cột Cập nhật theo dạng `YYYY-MM-DD`; khi xong thì ghi thêm cột Xong.
2. Mục 4: tích ô `[x]` cho bước đã làm và ghi ngày ngay sau bước đó, ví dụ `[x] ... (2026-09-20)`; điền số đo vào chỗ để trống.
3. Mục 5: thêm một dòng nhật ký (ngày, mã, việc đã làm, kết quả, mã quyết định nếu có). Không sửa dòng nhật ký cũ.

Sửa xong thì đổi dòng "Cập nhật gần nhất của file này" ở bảng đầu file. Vấn đề mới phát sinh thì thêm mã kế tiếp (R-07, R-08, …) với ngày ghi nhận.

## 2. Kết quả kiểm tra ngày 2026-09-18

Chạy trên một bản sao mã nguồn (cài lại `node_modules` cho Linux), không đụng thư mục project.

| Hạng mục | Kết quả | Ghi chú |
|---|---|---|
| `vitest run` | Đạt: 27 file, 157 test | |
| `tsc -b` | Đạt | |
| `eslint .` | Đạt | |
| `lint:boundaries` | Đạt | I1 cho `src/face/**`, `src/classify/**` |
| `check:invariants` | Đạt: 59 file, I1, I2, I3, I4, I9, I10 | |
| `vite build` | Đạt | Hash file ra trùng `dist/` hiện có, nên `dist/` khớp mã hiện tại |
| `test:e2e` | Chưa chạy lại được | Môi trường rà soát thiếu Chromium và model. `test-results/.last-run.json` ghi `passed` lúc 2026-09-18 01:12 (UTC+7), sau lần sửa mã cuối 01:03, nhưng không cho biết là cả bộ hay một phần |
| Mô phỏng solver | Ổn với tham số mặc định | Xem dưới |

Mô phỏng solver (script tạm, không lưu trong repo): hai tay giữ yên 30 giây, kết quả tay 18 Hz, lưới 64 × 36 trên stage 1280 × 720 (ô 20 px), quét 100 vị trí quanh ranh giới ô và ranh giới n, gọi thẳng `solveSquare` với tham số mặc định.

| Nhiễu mỗi điểm (σ) | Run tay (biên độ) | Đổi ô trung bình mỗi 30 s | Xấu nhất | Đóng `too-small` |
|---|---|---|---|---|
| 1,5 px | 0 px | 0,0 | 1 | 0 |
| 1,5 px | 4 px | 0,2 | 2 | 0 |
| 3 px | 4 px | 1,0 | 6 | 0 |
| 3 px | 8 px | 20,9 | 36 | 0 |
| 5 px | 8 px | 29,4 | 49 | 0 |

Hai dòng cuối là chuyển động thật gần một ô (16 px đỉnh tới đỉnh trên ô 20 px), nên đổi ô là đúng. Lưới 128 × 72 (ô 10 px) sẽ nhạy gấp đôi với cùng mức run tay. Cạnh gần `nMin` (3,0 đến 3,9 ô) không lần nào đóng `too-small`.

Đánh giá hướng đi: đúng hướng. Thứ tự làm khớp mục 2.4 của [WORK-BREAKDOWN.md](./WORK-BREAKDOWN.md) (màn che, nhánh face, rồi tay). Bất biến I1 đến I10 được giữ bằng ba lớp: lint boundaries, `check:invariants`, gate cứng e2e có đối chứng 1 px. Solver, One Euro, hysteresis, kẹp mép làm đúng mục 5.8 và D-035.

## 3. Bảng theo dõi

| Mã | Việc | Ưu tiên | Cần xong trước | Trạng thái | Ghi nhận | Cập nhật | Xong |
|---|---|---|---|---|---|---|---|
| R-01 | Commit git đầu tiên và nhánh `archive/backend` | Cao | Bắt đầu INT-01 | Mở | 2026-09-18 | 2026-09-18 | |
| R-02 | Buổi thử với webcam và tay thật | Cao | Viết thêm mã cho INT-01 | Mở | 2026-09-18 | 2026-09-18 | |
| R-03 | Ngưỡng tuổi điểm 150 ms sát độ trễ pipeline tay | Cao | Nghiệm thu INT-01 | Mở | 2026-09-18 | 2026-09-18 | |
| R-04 | Bắt đầu CLS-01 (dataset mode, thu dữ liệu) song song | Trung bình | QA-01 | Mở | 2026-09-18 | 2026-09-18 | |
| R-05 | One Euro lọc theo px stage nên phụ thuộc cỡ cửa sổ và DPR | Thấp | QA-02 | Mở | 2026-09-18 | 2026-09-18 | |
| R-06 | Việc vặt: `dist/`, README, comment, phần còn lại của INT-01 | Thấp | REL-01 (riêng mục d: INT-01) | Mở | 2026-09-18 | 2026-09-18 | |
| R-07 | Vùng mở là tứ giác bốn đầu ngón, mask là tập ô (chốt hình vuông là sai sót) | Cao | QA-01 | Xong | 2026-09-18 | 2026-09-18 | 2026-09-18 |

## 4. Chi tiết từng việc

### R-01 Commit git đầu tiên và nhánh `archive/backend`

Ghi nhận: 2026-09-18. Ưu tiên: cao. Liên quan: D-024, SETUP-00.

Hiện trạng: `git log` báo nhánh `main` chưa có commit nào; mọi file đều ở trạng thái untracked. 14 gói công việc (khoảng 11 nghìn dòng mã và test) chỉ tồn tại trên ổ E:, không có lịch sử, không quay lui được, không có bản sao. D-024 đã định lần commit đầu đưa `archive/backend/` vào nhánh riêng và giữ `main` sạch, nhưng chưa thực hiện.

Việc cần làm:

- [ ] Chạy đủ bộ lệnh kiểm trên máy phát triển và ghi kết quả vào nhật ký: `lint`, `lint:boundaries`, `check:invariants`, `test:unit`, `test:e2e` (cả bộ), `build`. Ngày chạy: ____
- [ ] Tạo nhánh `archive/backend` chứa `archive/backend/` theo D-024, rồi bỏ thư mục này khỏi `main`.
- [ ] Commit đầu trên `main`. Kiểm `git status` không còn model `.task`, wasm, `public/spike-assets/`, `dist/`, `test-results/` (đã có trong `.gitignore`).
- [ ] Đẩy lên remote hoặc sao lưu ra nơi khác ổ E:.
- [ ] Từ đây mỗi gói công việc một commit (hoặc một nhánh), mã gói trong thông điệp commit.

Tiêu chí đóng: `git log` trên `main` có commit chứa toàn bộ trạng thái sau ROI-01; nhánh `archive/backend` tồn tại; có bản sao ngoài máy.

### R-02 Buổi thử với webcam và tay thật

Ghi nhận: 2026-09-18. Ưu tiên: cao. Liên quan: D-010, D-011, D-033, D-036, S4 pha 2, INT-01 bước 4.

Hiện trạng: tới ROI-01 chưa có phép kiểm nào chạy với webcam và tay thật; mọi số đo dùng ảnh tĩnh, nguồn tổng hợp hoặc tay giả lập. Bốn việc kiểm thủ công đang dồn lại, và tiêu chí hoàn thành của HAND-01 và ROI-01 về bản chất là tiêu chí với tay thật.

Việc cần làm (mở `/#/app?debug=1`, nguồn cửa sổ "Tay", ghi số đọc được từ thanh debug):

- [ ] Tab nền (S4 pha 2, D-011): bật camera, chuyển tab 10 giây, quay lại. Ghi: rVFC có dừng không ____; vùng có đóng `tab-hidden` không ____. Ngày: ____
- [ ] Nhãn tay (D-010): giơ tay phải 10 giây, nhãn phải là "Phải". Kết quả: ____. Nếu ngược: bật "Đảo trái/phải" và ghi quyết định mới. Ngày: ____
- [ ] Id tay ổn định (HAND-01): hai tay di chuyển bình thường 30 giây, id không đổi; chéo hai tay cho `uncertain` thay vì hoán đổi id. Kết quả: ____. Ngày: ____
- [ ] Cửa sổ theo tay (ROI-01): giữ yên 30 giây, đếm số lần đổi ô ____; tách và chụm tay, n đổi có mượt không ____; đưa sát mép, cửa sổ vẫn vuông và có `limited` ____. Ngày: ____
- [ ] Cử chỉ: thử kiểu "khung hình" (hai tay chữ L) và kiểu mở ngón cái với ngón trỏ. Vì cạnh = min(bboxW, bboxH), ghi n lớn nhất đạt được ở khoảng cách ngồi bình thường: ____ ô. Có đủ rộng để khung trọn một khuôn mặt không: ____
- [ ] Ghi tuổi điểm nhỏ nhất và lớn nhất thấy trên dòng slot (đầu vào cho R-03): ____ đến ____ ms; hand Hz: ____; delegate CPU so với GPU: ____

Tiêu chí đóng: mọi ô trên có kết quả và ngày; sai lệch so với giả định (nhãn tay ngược, cửa sổ nhấp nháy, n tối đa quá nhỏ) có mã R mới hoặc quyết định D mới.

### R-03 Ngưỡng tuổi điểm 150 ms sát độ trễ pipeline tay

Ghi nhận: 2026-09-18. Ưu tiên: cao. Liên quan: `freshness.pointMaxAgeMs` trong `src/core/config.ts`, `src/hands/slots.ts`, `src/reveal/handWindowSource.ts`, `src/core/revealState.ts`, D-034, D-036, S2.

Hiện trạng: tuổi điểm = `now` (rAF) trừ `lastSeenTs` (mốc `performance.now()` lúc rVFC của frame đã gửi cho worker tay). S2 đo detect hai tay trong worker 48,9 ms (p95 56,7) với CPU và 62,2 ms (p95 69,5) với GPU. Mỗi kết quả về đã cũ khoảng một chu kỳ suy luận cộng thời gian chờ rAF, và còn được dùng tới khi kết quả kế về. Ước tính (chưa đo) tuổi điểm lúc render dao động khoảng 70 đến 140 ms ở p50, nên p95 vượt 150 ms.

Hậu quả khi vượt: `stale-point` trong một vài frame render, vùng đóng rồi mở lại. Đóng do tay không tăng epoch, nhưng closed → open luôn tăng epoch, reset One Euro và `rejectAll` tác vụ mặt (mục 4.6). Kết quả nhìn thấy: cửa sổ chớp và mặt biến mất rồi hiện lại theo chu kỳ.

Dấu hiệu đã có: `tests/e2e/hands.spec.ts` chấp nhận `stale-point` xen kẽ và phải nâng "Tuổi điểm" lên 1000 ms để cửa sổ mở ổn định; D-034 và D-036 coi đây là do headless chậm. Trên máy thật con số cũng sát ngưỡng.

Việc cần làm:

- [ ] Lấy số đo tuổi điểm thật từ R-02. Tuổi điểm p50 ____ ms, lớn nhất ____ ms; số lần đóng `stale-point` trong 60 giây giữ tay yên: ____. Ngày: ____
- [ ] Chọn cách đặt ngưỡng: hằng số mới (ví dụ 250 ms) hoặc suy từ chu kỳ kết quả tay đo được (ví dụ 2 lần chu kỳ cộng phần dư, có sàn 150 ms). Kế hoạch gốc cho phép chỉnh: "150 ms để bắt đầu thử và điều chỉnh bằng benchmark".
- [ ] Ghi quyết định vào `decisions.md` (D-____), sửa `config.ts` và bảng mục 3 của WORK-BREAKDOWN.
- [ ] Kiểm lại tiêu chí HAND-02 với ngưỡng mới: mất một ngón thì slot không hợp lệ trong tối đa ngưỡng cộng một frame render.
- [ ] Xem lại `hands.spec.ts`: bỏ mức 1000 ms nếu ngưỡng mới đủ để cửa sổ mở ổn định trong headless, hoặc ghi rõ lý do giữ.

Tiêu chí đóng: giữ tay yên 60 giây với webcam thật không có lần đóng `stale-point` nào; mặt trong vùng mở không chớp; quyết định đã ghi.

### R-04 Bắt đầu CLS-01 song song

Ghi nhận: 2026-09-18. Ưu tiên: trung bình. Liên quan: CLS-01, CLS-02, D-012, rủi ro "thiếu dữ liệu hình nộm" ở mục 2.3.

Hiện trạng: WORK-BREAKDOWN ghi CLS-01 "bắt đầu ngay khi MASK-02 xong, song song với các gói khác". MASK-02 đã xong nhưng `src/` chưa có dòng nào về dataset mode, `src/classify/` vẫn là placeholder, chưa có văn bản đồng ý thu dữ liệu. Giai đoạn 5 là đường găng dài nhất của kế hoạch (2 đến 4 tuần, phụ thuộc dữ liệu), trong khi giai đoạn 0 đến 3 đã xong trong hai ngày.

Việc cần làm:

- [ ] Chốt nguồn hình nộm (nhựa, vải, silicone) và người tham gia; ai thu, thu ở đâu. Ngày: ____
- [ ] Viết văn bản đồng ý của người tham gia (CLS-01 bước 1).
- [ ] Làm dataset mode tối thiểu (CLS-01 bước 2): công tắc có chỉ báo, lưu crop trước letterbox từ `RestrictedFrame` kèm metadata JSON, lưu cục bộ, không upload; lấy bản sao theo nhịp thưa (D-012).
- [ ] Thu lô đầu theo ma trận ở CLS-01 bước 3. Số mẫu: người ____, hình nộm ____. Ngày: ____

Tiêu chí đóng: CLS-01 được đánh dấu đang làm trong README, có lô dữ liệu đầu tiên và `docs/dataset.md`.

### R-05 One Euro lọc theo px stage

Ghi nhận: 2026-09-18. Ưu tiên: thấp. Liên quan: `src/reveal/squareSolver.ts`, `src/reveal/oneEuro.ts`, D-035, QA-02.

Hiện trạng: bộ lọc chạy trên tâm và cạnh tính bằng px stage (px thiết bị). Tần số cắt = `minCutoff + beta × |tốc độ|` với tốc độ tính bằng px stage mỗi giây, nên cùng một chuyển động tay cho tần số cắt khác nhau khi cửa sổ trình duyệt to hay nhỏ, hoặc khi DPR khác. Mô phỏng ở mục 2 với stage gấp 2,5 lần (3200 × 1800), nhiễu 3 px và run tay 4 px: đổi ô trung bình 2,6 lần mỗi 30 giây so với 1,0 lần ở stage 1280 × 720. Hysteresis tính theo ô nên không bị ảnh hưởng.

Việc cần làm:

- [ ] Ở QA-02, thử lọc theo đơn vị không phụ thuộc cỡ hiển thị (px camera, hoặc chia cho bề rộng camera) rồi mới đổi sang stage. Đổi layout đã reset solver nên không cần giữ trạng thái qua thay đổi.
- [ ] Nếu đổi đơn vị: chỉnh lại `beta` mặc định và giới hạn trong `SENSITIVITY_LIMITS`, ghi quyết định D-____.

Tiêu chí đóng: số lần đổi ô khi giữ tay yên không phụ thuộc kích thước cửa sổ trình duyệt (chênh dưới 20% giữa hai cỡ), hoặc có quyết định ghi rõ chấp nhận hiện trạng.

### R-06 Việc vặt

Ghi nhận: 2026-09-18. Ưu tiên: thấp.

- [x] a. `dist/` chứa `spike-assets/` (ảnh mẫu người, `mobilenetv2-12.onnx`, WebM) vì chúng nằm trong `public/`. Trước REL-01: chuyển asset spike ra ngoài `public/` hoặc loại khỏi build. Xong: 2026-09-20 (REL-01, D-050: plugin `wctBuild` xóa `dist/spike-assets` ở `closeBundle`, CI kiểm `test ! -e dist/spike-assets`)
- [ ] b. README, mục Cấu trúc: danh sách e2e thiếu `solver`. Xong: ____
- [ ] c. Comment đầu `src/loop/frameLoop.ts` còn câu "chưa có HandWindowSource nên cửa sổ vẫn đóng tới ROI-01" (đã lỗi thời sau ROI-01). WORK-BREAKDOWN phần "Cách đọc" lặp hai lần dòng "Mục 6". Xong: ____
- [ ] d. Phần còn lại của INT-01: `HandWindowSource` đã nối vào vòng lặp và UI đã chuyển được nguồn cửa sổ ngay trong ROI-01. Còn thiếu: nối `cameraCloseReason()` vào `frameLoop` để đóng vùng với `no-camera` và `tab-hidden` (hiện mới hiển thị ở thanh debug của `StagePage`), và chạy các kịch bản mục 7 bằng tay thật (gộp với R-02). Xong: ____

### R-07 Vùng mở là tứ giác bốn đầu ngón, mask là tập ô

Ghi nhận: 2026-09-18 (yêu cầu của người dùng). Ưu tiên: cao. Liên quan: D-038, ROI-02.

Hiện trạng lúc ghi nhận: kế hoạch 14/09 và D-035 chốt vùng mở là hình vuông N × N ô suy ra từ bốn điểm (tâm là trung bình, cạnh là min của hộp bao); toàn bộ mask, compositor, buffer suy luận và validate mặt giả định một rect. Yêu cầu đúng: bốn đầu ngón là bốn đỉnh của một tứ giác bất kỳ; ô trắng nằm trong hoặc bị cạnh cắt qua đều mở.

Việc đã làm:

- [x] Sửa kế hoạch gốc, WORK-BREAKDOWN (mục 2.1, 3, 4.3, 4.4, 5.6, 5.8, gói ROI-02, bảng 7.17), README; ghi D-038 (2026-09-18)
- [x] `core/cells.ts` (tứ giác → tập ô với hysteresis theo ô), `reveal/quadSolver.ts` thay `squareSolver.ts`, mask mang `box`, `cells`, `holesCam`; compositor clip theo ô, buffer tô đệm lỗ, validate mặt theo ô (2026-09-18)
- [x] Unit 170 ca, e2e 40 ca (hai lần), lint, boundaries, invariants, tsc, build đạt (2026-09-18)

Tiêu chí đóng: hình thang lệch mở đúng ô bị cạnh cắt qua, lỗ trắng trên output và xám trong buffer (gate cứng e2e); đã đạt.

## 5. Nhật ký cập nhật

Thêm dòng mới ở cuối; không sửa dòng cũ.

| Ngày | Mã | Nội dung | Kết quả, quyết định |
|---|---|---|---|
| 2026-09-18 | R-01 đến R-06 | Rà soát sau ROI-01, tạo file này | 6 việc mở; unit, tsc, lint, invariants, build đạt; e2e chưa chạy lại |
| 2026-09-18 | R-07 | Chuyển vùng mở sang tứ giác bốn đầu ngón và mask tập ô, sửa kế hoạch và mã, thêm test | Xong; D-038 |

Mẫu dòng để sao chép:

```
| YYYY-MM-DD | R-0x | Đã làm gì, đo được gì | Trạng thái mới; D-0xx nếu có |
```
