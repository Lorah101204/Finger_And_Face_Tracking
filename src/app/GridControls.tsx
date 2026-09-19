import { useSyncExternalStore } from 'react'
import { GRID_LIMITS, GRID_PRESETS, gridLabel, presetIndex } from '../core/grid'
import type { StageStore } from '../loop/store'
import type { WindowSourceKind } from '../reveal/windowSource'

// GRID-01 bước 4: preset lưới, custom cột × hàng có giới hạn, bật/tắt vạch lưới, bật/tắt mirror.
// Mọi thay đổi đi qua store: cols, rows, mirror làm epoch++ (cửa sổ đang mở sẽ đóng với config-changed).
// HAND-01: nguồn cửa sổ "Tay" chạy hand pipeline (cửa sổ theo tay từ ROI-01, INT-01); cờ đảo trái/phải theo D-010 cho
// bước kiểm 10 giây với tay phải thật, chỉ hiện khi nguồn là tay. UX-03 (D-049): hai mục dọc của cột cài đặt (Lưới,
// Cửa sổ): nhãn trên control, checkbox vẽ thành công tắc; nguồn cửa sổ vẫn là <select> có aria-label "Nguồn cửa sổ".
export function GridControls({ store }: { store: StageStore }) {
  const { settings, layout } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const preset = presetIndex(settings)
  const hands = settings.windowSource === 'hands'

  return (
    <>
      <section className="sec" data-testid="grid-section">
        <h3>
          Lưới
          <span className="hint">
            {settings.cols} × {settings.rows} · ô {layout.c} px
          </span>
        </h3>
        <div className="lbl">
          <span>Preset</span>
          <select
            aria-label="Lưới"
            value={preset < 0 ? 'custom' : String(preset)}
            onChange={(e) => {
              const p = GRID_PRESETS[Number(e.target.value)]
              if (p) store.setSettings({ cols: p.cols, rows: p.rows })
            }}
          >
            {GRID_PRESETS.map((p, i) => (
              <option key={i} value={String(i)}>
                {gridLabel(p)}
              </option>
            ))}
            <option value="custom">Tùy chỉnh</option>
          </select>
        </div>
        <div className="cols2">
          <div className="lbl">
            <span>Cột</span>
            <input
              type="number"
              aria-label="Số cột"
              min={GRID_LIMITS.minCols}
              max={GRID_LIMITS.maxCols}
              value={settings.cols}
              onChange={(e) => store.setSettings({ cols: e.target.valueAsNumber })}
            />
          </div>
          <div className="lbl">
            <span>Hàng</span>
            <input
              type="number"
              aria-label="Số hàng"
              min={GRID_LIMITS.minRows}
              max={GRID_LIMITS.maxRows}
              value={settings.rows}
              onChange={(e) => store.setSettings({ rows: e.target.valueAsNumber })}
            />
          </div>
        </div>
        <div className="acts">
          <label className="check">
            <input
              type="checkbox"
              checked={settings.showLines}
              onChange={(e) => store.setSettings({ showLines: e.target.checked })}
            />
            Vạch lưới
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={settings.mirror}
              onChange={(e) => store.setSettings({ mirror: e.target.checked })}
            />
            Mirror
          </label>
        </div>
      </section>
      <section className="sec" data-testid="window-section">
        <h3>Cửa sổ</h3>
        <div className="lbl">
          <span>Nguồn</span>
          <select
            aria-label="Nguồn cửa sổ"
            value={settings.windowSource}
            onChange={(e) =>
              store.setSettings({ windowSource: e.target.value as WindowSourceKind })
            }
          >
            <option value="mouse">Chuột</option>
            <option value="hands">Tay</option>
          </select>
        </div>
        <span className="hint">
          {hands
            ? 'Cửa sổ là vùng bao các đầu ngón của hai tay; đổi nguồn thì cửa sổ đang mở đóng lại.'
            : 'Bấm hoặc kéo trên bảng để mở; lăn chuột đổi cỡ; Esc đóng; Space mở lại.'}
        </span>
        {hands && (
          <div className="acts">
            <label className="check" title="D-010: bật nếu webcam thật gán nhãn tay ngược">
              <input
                type="checkbox"
                checked={settings.handednessSwap}
                onChange={(e) => store.setSettings({ handednessSwap: e.target.checked })}
              />
              Đảo trái/phải
            </label>
            <span className="hint">khi webcam gán nhãn tay ngược</span>
          </div>
        )}
      </section>
    </>
  )
}
