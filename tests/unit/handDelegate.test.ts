import { describe, expect, it } from 'vitest'
import { DEFAULTS } from '../../src/core/config'
import { isSoftwareRenderer, resolveHandDelegate } from '../../src/hands/handDelegate'

// QA-02 (D-045, mục 7.24): delegate tay theo renderer WebGL.
const NVIDIA =
  'ANGLE (NVIDIA, NVIDIA GeForce RTX 3050 Laptop GPU (0x000025A2) Direct3D11 vs_5_0 ps_5_0, D3D11)'
const SWIFTSHADER =
  'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero) (0x0000C0DE)), SwiftShader driver)'

describe('isSoftwareRenderer', () => {
  it('SwiftShader, llvmpipe, Microsoft Basic Render và thiếu WebGL là phần mềm; NVIDIA, Intel, Apple là phần cứng', () => {
    expect(isSoftwareRenderer(SWIFTSHADER)).toBe(true)
    expect(isSoftwareRenderer('llvmpipe (LLVM 15.0.7, 256 bits)')).toBe(true)
    expect(
      isSoftwareRenderer(
        'ANGLE (Microsoft, Microsoft Basic Render Driver Direct3D11 vs_5_0 ps_5_0)',
      ),
    ).toBe(true)
    expect(isSoftwareRenderer(null)).toBe(true)
    expect(isSoftwareRenderer(NVIDIA)).toBe(false)
    expect(
      isSoftwareRenderer(
        'ANGLE (Intel, Intel(R) Iris(R) Xe Graphics (0x000046A6) Direct3D11 vs_5_0 ps_5_0, D3D11)',
      ),
    ).toBe(false)
    expect(
      isSoftwareRenderer('ANGLE (Apple, ANGLE Metal Renderer: Apple M2, Unspecified Version)'),
    ).toBe(false)
  })
})

describe('resolveHandDelegate', () => {
  it('auto → GPU trên phần cứng, CPU trên giả lập hay thiếu WebGL; pref rõ ràng thắng', () => {
    expect(resolveHandDelegate('auto', NVIDIA)).toBe('GPU')
    expect(resolveHandDelegate('auto', SWIFTSHADER)).toBe('CPU')
    expect(resolveHandDelegate('auto', null)).toBe('CPU')
    expect(resolveHandDelegate('CPU', NVIDIA)).toBe('CPU')
    expect(resolveHandDelegate('GPU', SWIFTSHADER)).toBe('GPU')
  })

  it('cấu hình mặc định là auto (D-045) và tuổi điểm cho CPU lớn hơn cho GPU', () => {
    expect(DEFAULTS.hands.delegate).toBe('auto')
    expect(DEFAULTS.freshness.pointMaxAgeMsCpu).toBeGreaterThan(DEFAULTS.freshness.pointMaxAgeMs)
  })
})
