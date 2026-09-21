// TEST-00 bước 3: kịch bản chạy từ test qua window.__scenario.run('windowAt(col,row,n)') hoặc run('windowAt', col, row, n).
// Dùng MouseWindowSource (nguồn debug) để đặt cửa sổ theo ô, SyntheticCameraSource để đổi cảnh, probes để đặt trễ
// worker (FACE-02 đọc workerDelayMs). ROI-01: hands(spec) thay worker tay bằng HandFrame giả lập (fakeHands.ts) để
// kiểm cửa sổ theo tay. Chỉ cài khi ?debug=1; không có gì rời trình duyệt (I9).
import type { SyntheticCameraSource, SyntheticScene } from '../camera/syntheticCameraSource'
import type { HandPipeline } from '../hands/handPipeline'
import { normalizeFingers, type StageStore } from '../loop/store'
import type { MouseWindowSource } from '../reveal/mouseWindowSource'
import { fakeHandFrame, type FakeHandsSpec } from './fakeHands'
import type { Probes } from './probes'

export type ScenarioDeps = {
  mouse: MouseWindowSource
  store: StageStore
  synthetic: SyntheticCameraSource | null
  probes: Probes
  hands?: HandPipeline
  /** BRAND-01: công tắc ui.logo (setUi của StagePage). */
  setLogo?: (on: boolean) => void
}

export type ScenarioApi = {
  run(command: string, ...args: unknown[]): unknown
  /** Đổi cảnh tổng hợp; null khi không chạy nguồn tổng hợp. */
  scene(patch?: Partial<SyntheticScene>): SyntheticScene | null
  /**
   * ROI-01: hai bàn tay giả lập (px camera) cho hand pipeline thay worker; null để về worker thật. Trả về spec đang
   * dùng. Chỉ có tác dụng khi nguồn cửa sổ là tay (vòng lặp feed mỗi frame).
   */
  hands(spec: FakeHandsSpec | null): FakeHandsSpec | null
  list(): string[]
}

declare global {
  interface Window {
    __scenario?: ScenarioApi
  }
}

type Handler = (...args: number[]) => unknown

export function installScenarios(deps: ScenarioDeps): () => void {
  const { mouse, store, synthetic, probes, hands, setLogo } = deps
  let fakeSpec: FakeHandsSpec | null = null
  const ensureMouseSource = () => {
    if (store.getSnapshot().settings.windowSource !== 'mouse') {
      store.setSettings({ windowSource: 'mouse' })
    }
  }
  const handlers: Record<string, Handler> = {
    /** Đóng vùng mở: output phải trắng hoàn toàn. */
    coverAll: () => {
      mouse.close()
      return null
    },
    windowAt: (col, row, n) => {
      ensureMouseSource()
      mouse.setWindow({ col, row, n })
      return { col, row, n }
    },
    moveWindow: (col, row) => {
      ensureMouseSource()
      mouse.moveWindow(col, row)
      return { col, row }
    },
    resizeWindow: (n) => {
      ensureMouseSource()
      mouse.resizeWindow(n)
      return { n }
    },
    /** ROI-03: chọn đầu ngón dùng (chỉ số landmark 4, 8, 12, 16, 20); không tham số thì về mặc định. */
    fingers: (...tips) => {
      const next = normalizeFingers(tips)
      store.setSettings({ fingers: next })
      return { fingers: store.getSnapshot().settings.fingers }
    },
    /** ROI-04: bật (1) hay tắt (0) "Chỉ ngón đang giơ" (settings.raisedOnly, epoch++). */
    raisedOnly: (v) => {
      store.setSettings({ raisedOnly: v !== 0 })
      return { raisedOnly: store.getSnapshot().settings.raisedOnly }
    },
    /** BRAND-01: bật (1) hay tắt (0) công tắc "Logo trên màn che" (ui.logo). */
    logo: (v) => {
      setLogo?.(v !== 0)
      return { logo: v !== 0 }
    },
    /** FACE-02: worker mặt trễ thêm ms trước khi trả kết quả (kiểm kết quả về muộn). */
    delayWorker: (ms) => {
      probes.workerDelayMs = Math.max(0, ms)
      return { workerDelayMs: probes.workerDelayMs }
    },
    /** QA-01: tuổi tối đa của kết quả mặt (ms); 0 về mặc định freshness.faceResultMaxAgeMs. */
    faceMaxAge: (ms) => {
      probes.faceMaxAgeMs = Math.max(0, ms)
      return { faceMaxAgeMs: probes.faceMaxAgeMs }
    },
  }

  const api: ScenarioApi = {
    run(command, ...args) {
      const m = /^\s*(\w+)\s*(?:\((.*)\))?\s*$/.exec(command)
      if (!m) throw new Error(`kịch bản không hợp lệ: ${command}`)
      const name = m[1]
      const handler = handlers[name]
      if (!handler)
        throw new Error(`không có kịch bản ${name}; có: ${Object.keys(handlers).join(', ')}`)
      const inline = m[2]?.trim()
      const parsed = inline
        ? inline.split(',').map((s) => Number(s.trim()))
        : args.map((a) => Number(a))
      if (parsed.some((v) => Number.isNaN(v))) throw new Error(`tham số phải là số: ${command}`)
      return handler(...parsed)
    },
    scene(patch) {
      if (!synthetic) return null
      if (patch) synthetic.setScene(patch)
      return synthetic.scene
    },
    hands(spec) {
      if (!hands) return null
      fakeSpec = spec ? { ...spec } : null
      const snap = fakeSpec
      hands.setFake(snap ? (now, frameId) => fakeHandFrame(snap, now, frameId) : null)
      return fakeSpec
    },
    list: () => Object.keys(handlers),
  }
  window.__scenario = api
  return () => {
    if (fakeSpec) hands?.setFake(null)
    if (window.__scenario === api) delete window.__scenario
  }
}
