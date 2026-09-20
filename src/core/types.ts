// Kiểu dữ liệu cốt lõi dùng chung (docs/WORK-BREAKDOWN.md mục 4.3).
// Quy ước tọa độ: hậu tố Cam (px camera, chưa mirror), Stage (px thiết bị của canvas output), Cell (ô lưới).
// File này không được import gì từ camera/, hands/, mask/... để face/ và classify/ dùng được an toàn (bất biến I1).

export type Point = { x: number; y: number }
export type Rect = { x: number; y: number; w: number; h: number }
export type Size = { w: number; h: number }

/** Dấu frame từ CameraSource (requestVideoFrameCallback, fallback rAF). */
export type FrameStamp = { frameId: number; ts: number; mediaTime?: number }

/** Cửa sổ vuông theo ô lưới (nguồn chuột, debug): góc trên trái (col, row) và cạnh n ô. */
export type RevealWindow = { col: number; row: number; n: number }

/** Hộp theo ô: góc trên trái (col, row), rộng w ô, cao h ô. */
export type CellBox = { col: number; row: number; w: number; h: number }

/**
 * ROI-02 (D-038), ROI-03 (D-047): hình điều khiển vùng mở. Chuột: cửa sổ vuông. Tay: đa giác bao lồi của các đầu ngón
 * hợp lệ (px stage, đã lọc); mask là tập ô giao với đa giác, kể cả ô chỉ bị cạnh cắt qua.
 */
/** ROI-03 (D-047): tay cho đa giác bao lồi các đầu ngón (px stage, đã sắp đỉnh); chuột cho cửa sổ vuông. */
export type RevealShape =
  { kind: 'window'; window: RevealWindow } | { kind: 'polygon'; polygonStage: Point[] }

/**
 * Mask chuẩn, chỉ buildMask tạo (bất biến I2), nhiều nhất một lần mỗi frame; hình không đổi thì vòng lặp dùng lại
 * đối tượng của frame trước (PERF-02). Vùng mở là tập ô trong hộp bao `box`.
 */
export type RevealMask = {
  epoch: number
  shape: RevealShape
  /** hộp bao nhỏ nhất (theo ô) của các ô mở */
  box: CellBox
  /** box.w × box.h, hàng trước cột, 1 = ô mở */
  cells: Uint8Array
  cellCount: number
  /** rect nguyên px thiết bị của box */
  stageRect: Rect
  /** rect nguyên px camera của box, đã clip trong camera */
  cameraRect: Rect
  /** rect camera nguyên của từng ô trong box KHÔNG mở (lỗ): buffer suy luận phải tô đệm các rect này (I1) */
  holesCam: Rect[]
  /** cửa sổ chuột đang bị kẹp ở mép bảng; đa giác luôn false */
  limited: boolean
}

/** CLS-01: metadata kèm crop vùng mở (bản trước letterbox, đã tô đệm lỗ) cho dataset mode (I8). */
export type CropMeta = {
  epoch: number
  frameId: number
  ts: number
  taskId: number
  roiCam: Rect
  /** hộp bao theo ô và số ô mở của mask lúc cắt */
  box: Size
  cells: number
  holes: number
}

/**
 * CLS-01 (I8): nơi duy nhất dataset mode lấy ảnh là CropTap của restrictedFrame: crop 1:1 của cameraRect, không bao giờ
 * là frame gốc. `wants` hỏi trước khi tốn getImageData; `emit` nhận bản sao ImageData.
 */
export type CropTap = {
  wants(ts: number): boolean
  emit(img: ImageData, meta: CropMeta): void
}

export type CloseReason =
  | 'no-camera'
  /** ROI-03: chưa đủ đầu ngón hợp lệ của đủ số tay (chưa thấy tay, chọn ít ngón, nhãn tay chưa rõ). */
  | 'few-points'
  | 'stale-point'
  | 'out-of-board'
  | 'too-small'
  | 'ambiguous-hands'
  | 'tab-hidden'
  | 'config-changed'
  | 'user'

export type RevealState =
  { kind: 'closed'; reason: CloseReason } | { kind: 'open'; mask: RevealMask }

/** Đầu vào duy nhất của face.worker và classifier.worker (bất biến I1). */
export type RestrictedFrame = {
  taskId: number
  epoch: number
  frameId: number
  ts: number
  /** đúng bằng mask.cameraRect lúc gửi */
  roiCam: Rect
  /** ảnh letterbox: chỉ pixel trong roiCam cộng đệm màu đặc */
  input: ImageBitmap
  letterbox: { scale: number; dx: number; dy: number; size: number }
}

export type FaceResult = {
  taskId: number
  epoch: number
  frameId: number
  ts: number
  inferMs: number
  /** landmarks chuẩn hóa theo ảnh letterbox */
  faces: { landmarksNorm: [number, number, number][] }[]
}

export type ClassifyResult = {
  taskId: number
  epoch: number
  frameId: number
  ts: number
  inferMs: number
  /** xác suất theo thứ tự [person, mannequin] */
  probs: number[]
}

export type SubjectType = 'person' | 'mannequin' | 'unknown'

export type ValidatedFace = {
  status: 'full' | 'partial'
  bboxStage: Rect
  /** đã clip vào mask hiện tại */
  landmarksStage: Point[]
  /** CLS-02: tỉ lệ landmark còn trong vùng mở (0..1), đầu vào quy tắc unknown với mặt partial. */
  visible: number
  subjectType: SubjectType
  confidence?: number
}

export type Handedness = 'left' | 'right'

/** Chỉ số landmark đầu ngón theo MediaPipe: cái 4, trỏ 8, giữa 12, áp út 16, út 20. */
export type FingerTip = 4 | 8 | 12 | 16 | 20

/** HAND-01: kết quả thô của hand.worker cho một frame gốc (nhãn Left/Right của model, chưa chuẩn hóa). */
export type HandResult = {
  frameId: number
  ts: number
  epoch: number
  inferMs: number
  /** kích thước bitmap đã suy luận, px camera */
  width: number
  height: number
  hands: { label: string; score: number; landmarksNorm: [number, number, number][] }[]
}

/** HAND-01: một tay đang được theo dõi với id ổn định; tọa độ px camera, chưa mirror. */
export type HandTrack = {
  id: number
  handedness: Handedness
  /** điểm tin cậy của nhãn handedness theo tay đã gán (1 − score khi model gán nhãn ngược) */
  score: number
  palmCenterCam: Point
  bboxCam: Rect
  /** 21 landmark theo thứ tự MediaPipe */
  landmarksCam: Point[]
  lastSeenTs: number
  frameId: number
}

/** HAND-01 bước 4: đầu ra mỗi frame của HandTracker; uncertain khi có hai phương án ghép gần nhau (giữ track cũ). */
export type HandFrame = { frameId: number; ts: number; hands: HandTrack[]; uncertain: boolean }

/** ROI-03: lý do một đầu ngón không hợp lệ (mục 5.8); low-score khi nhãn tay của track không đủ tin cậy. */
export type FingerReason = 'stale-point' | 'out-of-board' | 'ambiguous-hands' | 'low-score'

/** ROI-03: trạng thái một đầu ngón (một track × một ngón đã chọn) tại thời điểm render. */
export type FingerStatus = {
  hand: Handedness
  trackId: number
  tip: FingerTip
  valid: boolean
  reason?: FingerReason
  pStage: Point
  pCam: Point
  /** lần thấy cuối của track (ts frame camera) */
  ts: number
  /** now − ts */
  ageMs: number
  score: number
}

export type FrameOutput = {
  epoch: number
  frameId: number
  ts: number
  status: 'covered' | 'searching' | 'too-small' | 'face-candidate' | 'partial-face'
  reveal: null | {
    shape: RevealShape
    box: CellBox
    /** danh sách ô mở (col, row); dùng chung qua các frame khi mask không đổi (PERF-02), không sửa tại chỗ */
    cells: readonly { col: number; row: number }[]
    stageRect: Rect
    cameraRect: Rect
    limited: boolean
  }
  /** ROI-03: một phần tử mỗi đầu ngón đã chọn của mỗi tay đang theo dõi khi nguồn cửa sổ là tay; rỗng với chuột. */
  points: Array<{
    hand: Handedness
    tip: FingerTip
    trackId: number
    valid: boolean
    reason?: FingerReason
    pStage: Point
  }>
  /** rỗng khi covered */
  faces: ValidatedFace[]
}
