import { useSyncExternalStore } from 'react'
import {
  DATASET_LABELS,
  LIGHTINGS,
  MANNEQUIN_TYPES,
  type DatasetLabel,
  type Lighting,
  type MannequinType,
  type Recorder,
  type DatasetSink,
} from '../dataset/recorder'
import { LABEL_TEXT, LIGHTING_TEXT, MANNEQUIN_TEXT, describeRecorder } from './datasetText'

// CLS-01 bước 2 (UC-13, mục 5.12): mục dataset mode trong cột cài đặt. Công tắc "Thu dữ liệu" mở các trường; chỉ khi
// tích "người tham gia đã ký đồng ý" mới Bắt đầu thu được; đang thu thì StagePage hiện chỉ báo đỏ trên canvas.
// Nơi lưu: thư mục (File System Access API) hoặc zip tải về; không upload (I9). Mọi trạng thái đọc từ recorder.
// UX-03: trường xếp dọc với nhãn trên, hai cột cho các select ngắn; Bắt đầu thu là nút chính, Xóa mẫu là nút danger.
export type DatasetControlsProps = {
  recorder: Recorder
  /** Thư mục qua File System Access API (Chromium); null khi trình duyệt không hỗ trợ. */
  pickDirectory: (() => Promise<DatasetSink | null>) | null
  download: (bytes: Uint8Array, name: string) => void
}

export function DatasetControls({ recorder, pickDirectory, download }: DatasetControlsProps) {
  const s = useSyncExternalStore(recorder.subscribe, recorder.snapshot)
  const f = s.fields

  async function onPick() {
    if (!pickDirectory) return
    const sink = await pickDirectory()
    if (sink) recorder.setSink(sink)
  }

  async function onDownload() {
    const bytes = await recorder.zip()
    download(
      bytes,
      `wct-dataset-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.zip`,
    )
  }

  return (
    <section className="sec" data-testid="dataset-bar">
      <h3>
        Thu dữ liệu <span className="hint">CLS-01</span>
      </h3>
      <div className="acts">
        <label className="check">
          <input
            type="checkbox"
            checked={s.enabled}
            onChange={(e) => recorder.setEnabled(e.target.checked)}
          />
          Thu dữ liệu
        </label>
        {!s.enabled && <span className="hint">chỉ crop vùng mở, lưu tại máy</span>}
      </div>
      {s.enabled && (
        <>
          <label className="check" title="Bước 1 của CLS-01: không có văn bản đồng ý thì không thu">
            <input
              type="checkbox"
              aria-label="Người tham gia đã ký đồng ý"
              checked={f.participantConsent}
              disabled={s.recording}
              onChange={(e) => recorder.setFields({ participantConsent: e.target.checked })}
            />
            Người tham gia đã ký đồng ý bằng văn bản
          </label>
          <div className="cols2">
            <div className="lbl">
              <span>Mã người tham gia</span>
              <input
                type="text"
                aria-label="Mã người tham gia"
                value={f.subjectId}
                disabled={s.recording}
                onChange={(e) => recorder.setFields({ subjectId: e.target.value })}
              />
            </div>
            <div className="lbl">
              <span>Nhãn tạm</span>
              <select
                aria-label="Nhãn tạm"
                value={f.label}
                onChange={(e) => recorder.setFields({ label: e.target.value as DatasetLabel })}
              >
                {DATASET_LABELS.map((l) => (
                  <option key={l} value={l}>
                    {LABEL_TEXT[l]}
                  </option>
                ))}
              </select>
            </div>
            <div className="lbl">
              <span>Ánh sáng</span>
              <select
                aria-label="Ánh sáng"
                value={f.lighting}
                onChange={(e) => recorder.setFields({ lighting: e.target.value as Lighting })}
              >
                {LIGHTINGS.map((l) => (
                  <option key={l} value={l}>
                    {LIGHTING_TEXT[l]}
                  </option>
                ))}
              </select>
            </div>
            <div className="lbl">
              <span>Hình nộm</span>
              <select
                aria-label="Loại hình nộm"
                value={f.mannequinType}
                onChange={(e) =>
                  recorder.setFields({ mannequinType: e.target.value as MannequinType })
                }
              >
                {MANNEQUIN_TYPES.map((m) => (
                  <option key={m} value={m}>
                    {MANNEQUIN_TEXT[m]}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="lbl">
            <span>Ghi chú</span>
            <input
              type="text"
              aria-label="Ghi chú"
              value={f.note}
              onChange={(e) => recorder.setFields({ note: e.target.value })}
            />
          </div>
          <div className="acts">
            <div className="lbl">
              <span>Nhịp (Hz)</span>
              <input
                type="number"
                aria-label="Nhịp thu"
                min={0.2}
                max={30}
                step={0.5}
                value={s.rateHz}
                onChange={(e) => recorder.setRate(e.target.valueAsNumber)}
              />
            </div>
            {s.recording ? (
              <button type="button" onClick={() => recorder.stop()}>
                Dừng thu
              </button>
            ) : (
              <button
                type="button"
                className="primary"
                disabled={!f.participantConsent}
                onClick={() => recorder.start()}
              >
                Bắt đầu thu
              </button>
            )}
          </div>
          <div className="acts">
            {pickDirectory && (
              <button type="button" className="sm" onClick={() => void onPick()}>
                {s.sink ? `Thư mục: ${s.sink}` : 'Chọn thư mục…'}
              </button>
            )}
            {s.inMemory > 0 && (
              <button type="button" className="sm" onClick={() => void onDownload()}>
                Tải zip ({s.inMemory} mẫu)
              </button>
            )}
            {s.inMemory > 0 && !s.recording && (
              <button type="button" className="sm danger" onClick={() => recorder.clear()}>
                Xóa mẫu trong bộ nhớ
              </button>
            )}
          </div>
          <span className="hint" data-testid="dataset-stat">
            {describeRecorder(s)}
          </span>
        </>
      )}
    </section>
  )
}
