import { describe, expect, it } from 'vitest'
import {
  browserFromUa,
  describeEnv,
  missingFeatures,
  REQUIRED_FEATURES,
  shortGpu,
  type EnvFeatures,
  type EnvSnapshot,
} from '../../src/debug/envText'

// QA-02 (mục 7.24): phần thuần của probe môi trường.
const ALL: EnvFeatures = {
  rvfc: true,
  offscreenCanvas: true,
  moduleWorker: true,
  imageBitmap: true,
  webgpu: true,
  wasmSimd: true,
  sharedArrayBuffer: true,
  fullscreen: true,
  directoryPicker: true,
  getUserMedia: true,
}

const CHROME =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/153.0.0.0 Safari/537.36'

describe('browserFromUa', () => {
  it('nhận Edge trước Chrome, Chrome headless, Firefox, Safari, khác', () => {
    expect(browserFromUa(`${CHROME} Edg/153.0.0.0`)).toEqual({ name: 'Edge', version: '153' })
    expect(browserFromUa(CHROME)).toEqual({ name: 'Chrome', version: '153' })
    expect(browserFromUa(CHROME.replace('Chrome/', 'HeadlessChrome/'))).toEqual({
      name: 'Chrome headless',
      version: '153',
    })
    expect(
      browserFromUa(
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:143.0) Gecko/20100101 Firefox/143.0',
      ),
    ).toEqual({ name: 'Firefox', version: '143' })
    expect(
      browserFromUa(
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15',
      ),
    ).toEqual({ name: 'Safari', version: '26' })
    expect(browserFromUa('curl/8')).toEqual({ name: 'khác', version: '' })
  })
})

describe('shortGpu', () => {
  it('rút tên GPU khỏi chuỗi ANGLE D3D11, SwiftShader là CPU, giữ chuỗi lạ, null → không có WebGL', () => {
    expect(
      shortGpu(
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU (0x000025A2) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      ),
    ).toBe('NVIDIA GeForce RTX 3050 Laptop GPU')
    expect(
      shortGpu(
        'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)',
      ),
    ).toBe('SwiftShader (CPU)')
    expect(shortGpu('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)')).toBe(
      'ANGLE Metal Renderer: Apple M2, Unspecified Version',
    )
    expect(shortGpu('Mesa Intel(R) Xe Graphics (TGL GT2)')).toBe(
      'Mesa Intel(R) Xe Graphics (TGL GT2)',
    )
    expect(shortGpu(null)).toBe('không có WebGL')
    expect(shortGpu('x'.repeat(80))).toHaveLength(58)
  })
})

describe('missingFeatures và describeEnv', () => {
  it('liệt kê tính năng thiếu theo thứ tự khai báo; bốn tính năng bắt buộc nằm trong danh sách', () => {
    expect(missingFeatures(ALL)).toEqual([])
    expect(missingFeatures({ ...ALL, webgpu: false, directoryPicker: false, rvfc: false })).toEqual(
      ['rVFC', 'WebGPU', 'chọn thư mục'],
    )
    for (const k of REQUIRED_FEATURES) expect(ALL[k]).toBe(true)
    expect(REQUIRED_FEATURES).toEqual([
      'moduleWorker',
      'offscreenCanvas',
      'imageBitmap',
      'wasmSimd',
    ])
  })

  it('dòng mô tả nêu trình duyệt, nền tảng, luồng, GPU và thiếu gì', () => {
    const s: EnvSnapshot = {
      ua: CHROME,
      browser: { name: 'Chrome', version: '153' },
      platform: 'Win32',
      threads: 16,
      deviceMemoryGB: 8,
      dpr: 1,
      secureContext: true,
      crossOriginIsolated: false,
      webgl:
        'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU (0x000025A2) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      features: { ...ALL, webgpu: false },
    }
    expect(describeEnv(s)).toBe(
      'môi trường: Chrome 153 · Win32 · 16 luồng · WebGL NVIDIA GeForce RTX 3050 Laptop GPU · thiếu: WebGPU',
    )
    expect(describeEnv({ ...s, features: ALL, platform: '', webgl: null })).toBe(
      'môi trường: Chrome 153 · ? · 16 luồng · WebGL không có WebGL · đủ API',
    )
  })
})
