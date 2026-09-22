import { useSyncExternalStore } from 'react'
import { GRID_LIMITS, GRID_PRESETS, gridLabel, presetIndex } from '../core/grid'
import type { StageStore } from '../loop/store'
import type { WindowSourceKind } from '../reveal/windowSource'
import { HelpTip } from './HelpTip'
import { useStrings } from './useLang'

// GRID-01 bước 4: preset lưới, custom cột × hàng có giới hạn, bật/tắt vạch lưới, bật/tắt mirror.
// Mọi thay đổi đi qua store: cols, rows, mirror làm epoch++ (cửa sổ đang mở sẽ đóng với config-changed).
// HAND-01: nguồn cửa sổ "Tay" chạy hand pipeline (cửa sổ theo tay từ ROI-01, INT-01); cờ đảo trái/phải theo D-010 cho
// bước kiểm 10 giây với tay phải thật, chỉ hiện khi nguồn là tay. UX-03 (D-049): hai mục dọc của cột cài đặt (Lưới,
// Cửa sổ): nhãn trên control, checkbox vẽ thành công tắc; nguồn cửa sổ vẫn là <select> có aria-label "Nguồn cửa sổ".
// UX-05: mỗi mục có nút "?" (HelpTip) mang chú thích; các dòng hint và title tĩnh cũ chuyển vào đó.
export function GridControls({ store }: { store: StageStore }) {
  const { settings, layout } = useSyncExternalStore(store.subscribe, store.getSnapshot)
  const preset = presetIndex(settings)
  const hands = settings.windowSource === 'hands'
  const s = useStrings()
  const g = s.settings.grid
  const w = s.settings.window
  const h = s.settings.help

  return (
    <>
      <section className="sec" data-testid="grid-section">
        <h3>
          {g.title}
          <span className="hint">{g.hint(settings.cols, settings.rows, layout.c)}</span>
        </h3>
        <div className="lbl">
          <span>
            {g.preset}
            <HelpTip id="preset" text={h.grid.preset} />
          </span>
          <select
            aria-label={g.presetAria}
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
            <option value="custom">{g.custom}</option>
          </select>
        </div>
        <div className="cols2">
          <div className="lbl">
            <span>
              {g.cols}
              <HelpTip id="cols" text={h.grid.cols} />
            </span>
            <input
              type="number"
              aria-label={g.colsAria}
              min={GRID_LIMITS.minCols}
              max={GRID_LIMITS.maxCols}
              value={settings.cols}
              onChange={(e) => store.setSettings({ cols: e.target.valueAsNumber })}
            />
          </div>
          <div className="lbl">
            <span>
              {g.rows}
              <HelpTip id="rows" text={h.grid.rows} />
            </span>
            <input
              type="number"
              aria-label={g.rowsAria}
              min={GRID_LIMITS.minRows}
              max={GRID_LIMITS.maxRows}
              value={settings.rows}
              onChange={(e) => store.setSettings({ rows: e.target.valueAsNumber })}
            />
          </div>
        </div>
        <div className="acts">
          <span className="with-help">
            <label className="check">
              <input
                type="checkbox"
                checked={settings.showLines}
                onChange={(e) => store.setSettings({ showLines: e.target.checked })}
              />
              {g.lines}
            </label>
            <HelpTip id="lines" text={h.grid.lines} />
          </span>
          <span className="with-help">
            <label className="check">
              <input
                type="checkbox"
                checked={settings.mirror}
                onChange={(e) => store.setSettings({ mirror: e.target.checked })}
              />
              {g.mirror}
            </label>
            <HelpTip id="mirror" text={h.grid.mirror} />
          </span>
        </div>
      </section>
      <section className="sec" data-testid="window-section">
        <h3>{w.title}</h3>
        <div className="lbl">
          <span>
            {w.source}
            <HelpTip id="source" text={h.window.source} />
          </span>
          <select
            aria-label={w.sourceAria}
            value={settings.windowSource}
            onChange={(e) =>
              store.setSettings({ windowSource: e.target.value as WindowSourceKind })
            }
          >
            <option value="mouse">{w.mouse}</option>
            <option value="hands">{w.hands}</option>
          </select>
        </div>
        {hands && (
          <div className="acts">
            <span className="with-help">
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.handednessSwap}
                  onChange={(e) => store.setSettings({ handednessSwap: e.target.checked })}
                />
                {w.swap}
              </label>
              <HelpTip id="swap" text={h.window.swap} />
            </span>
          </div>
        )}
        {hands && (
          <div className="acts">
            <span className="with-help">
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.raisedOnly}
                  onChange={(e) => store.setSettings({ raisedOnly: e.target.checked })}
                />
                {w.raisedOnly}
              </label>
              <HelpTip id="raisedOnly" text={h.window.raisedOnly} />
            </span>
          </div>
        )}
      </section>
    </>
  )
}
