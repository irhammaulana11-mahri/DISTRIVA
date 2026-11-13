import { describe, it, expect } from 'vitest'
import { phaseResult, recommendExtension, imbalance } from './kkoPhase.js'

// Angka dari formulir KKO kertas (HD200, 250 kVA).
const pd = {
  load: { r: 199, s: 200, t: 235 },
  added: { r: 0, s: 50, t: 0 },
  base_voltage: { r: 235, s: 236, t: 236 },
  existing_voltage: { r: 209, s: 209, t: 208 },
}

describe('KKO per fasa', () => {
  it('menghasilkan angka formulir kertas: 66,55 % → 70,80 % dan 7,47 % → 8,48 %', () => {
    const r = phaseResult(pd, 250)
    expect(r.before.loading_pct).toBe(66.55)
    expect(r.after.loading_pct).toBe(70.8)
    expect(r.before.imbalance_pct).toBe(7.47)
    expect(r.after.imbalance_pct).toBe(8.48)
    expect(imbalance({ r: 1, s: null, t: 2 })).toBeNull()
  })

  it('rekomendasi: dalam rentang normal dan jarak ≤ 40 m → tanpa perluasan', () => {
    expect(recommendExtension({ pd, capacity: 250, distanceM: 40 })).toEqual({ extension: false, reasons: [], missing: [] })
  })

  it('rekomendasi: satu saja di luar rentang → perlu perluasan, dengan alasan', () => {
    expect(recommendExtension({ pd, capacity: 250, distanceM: 41 }).extension).toBe(true)
    expect(recommendExtension({ pd: { ...pd, base_voltage: { r: 225, s: 236, t: 236 } }, capacity: 250, distanceM: 30 }).reasons[0]).toMatch(/tegangan pangkal 225/)
    expect(recommendExtension({ pd: { ...pd, added: { r: 0, s: 120, t: 0 } }, capacity: 250, distanceM: 30 }).extension).toBe(true)        // pembebanan sesudah > 80 %
    expect(recommendExtension({ pd: { ...pd, existing_voltage: { r: 197, s: 209, t: 208 } }, capacity: 250, distanceM: 30 }).extension).toBe(true)
    expect(recommendExtension({ pd: { ...pd, existing_voltage: { r: 199, s: 200, t: 200 } }, capacity: 250, distanceM: 30 }).extension).toBe(false)      // 199 V masih dalam toleransi −10 % (≥ 198 V)
  })

  it('data belum lengkap tidak menebak', () => {
    const r = recommendExtension({ pd: { ...pd, existing_voltage: {} }, capacity: 250, distanceM: '' })
    expect(r.extension).toBeNull()
    expect(r.missing).toEqual(['tegangan eksisting pelanggan', 'jarak bangunan dari tiang'])
  })
})
