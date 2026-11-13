// KKO per fasa (docs/82 §12): rumus sama dengan KkoService::phaseResult di server.
// Beban trafo = 3 × V × Imax ÷ kVA (V = tegangan pangkal fasa dengan arus terbesar; 230 V bila tidak diketahui).
// Ketidakseimbangan = rata-rata selisih mutlak arus tiga fasa ÷ rata-rata arus.

export const PHASES = ['r', 's', 't']

const toNum = (v) => (v === null || v === undefined || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
export const phasesOf = (o) => ({ r: toNum(o?.r), s: toNum(o?.s), t: toNum(o?.t) })
const complete = (p) => PHASES.every((k) => p[k] !== null)

export function imbalance(p) {
  if (!complete(p)) return null
  const mean = (p.r + p.s + p.t) / 3
  if (mean <= 0) return null
  return Math.round(((Math.abs(p.r - mean) + Math.abs(p.s - mean) + Math.abs(p.t - mean)) / 3 / mean) * 10000) / 100
}

function at(loads, base, capacity) {
  if (!complete(loads)) return null
  const max = Math.max(loads.r, loads.s, loads.t)
  const phase = PHASES.find((k) => loads[k] === max)
  const known = PHASES.map((k) => base[k]).filter((x) => x !== null)
  const v = base[phase] ?? (known.length ? known.reduce((a, b) => a + b, 0) / known.length : 230)
  const kva = (3 * v * max) / 1000
  return {
    loads,
    max_a: max,
    voltage_ref_v: Math.round(v * 10) / 10,
    load_kva: Math.round(kva * 100) / 100,
    loading_pct: capacity ? Math.round((kva / capacity) * 10000) / 100 : null,
    imbalance_pct: imbalance(loads),
  }
}

/** @returns {{before: object|null, after: object|null}} */
export function phaseResult(pd, capacity) {
  const base = phasesOf(pd?.base_voltage)
  const before = phasesOf(pd?.load)
  const added = phasesOf(pd?.added)
  const after = complete(before) ? { r: before.r + (added.r ?? 0), s: before.s + (added.s ?? 0), t: before.t + (added.t ?? 0) } : { r: null, s: null, t: null }
  const cap = toNum(capacity)
  return { before: at(before, base, cap), after: at(after, base, cap) }
}

export const LIMITS = { normalMaxPct: 80, imbalanceMaxPct: 30, baseMinV: 231, existingMinV: 198, distanceMaxM: 40 }

/**
 * Rekomendasi otomatis "memerlukan perluasan jaringan?" (permintaan 16 Nov 2026): tidak perlu perluasan hanya bila SEMUA dalam rentang normal:
 * pembebanan trafo sesudah ≤ 80 %, ketidakseimbangan sesudah ≤ 30 %, tegangan pangkal ≥ 231 V, tegangan eksisting pelanggan ≥ 198 V (220 V − 10 %) dan jarak bangunan dari tiang eksisting ≤ 40 m.
 * Data yang belum lengkap tidak menghasilkan rekomendasi (null), supaya pilihan tidak ditebak.
 * @returns {{extension: boolean|null, reasons: string[], missing: string[]}}
 */
export function recommendExtension({ pd, capacity, distanceM }) {
  const res = phaseResult(pd, capacity)
  const reasons = []
  const missing = []
  const after = res.after
  if (!after || after.loading_pct === null) missing.push('beban trafo')
  else if (after.loading_pct > LIMITS.normalMaxPct) reasons.push(`pembebanan trafo sesudah ${after.loading_pct}% (> ${LIMITS.normalMaxPct}%)`)
  if (!after || after.imbalance_pct === null) missing.push('keseimbangan beban')
  else if (after.imbalance_pct > LIMITS.imbalanceMaxPct) reasons.push(`ketidakseimbangan beban ${after.imbalance_pct}% (> ${LIMITS.imbalanceMaxPct}%)`)
  const base = Object.values(phasesOf(pd?.base_voltage)).filter((x) => x !== null)
  if (!base.length) missing.push('tegangan pangkal')
  else if (Math.min(...base) < LIMITS.baseMinV) reasons.push(`tegangan pangkal ${Math.min(...base)} V (< ${LIMITS.baseMinV} V)`)
  const ex = Object.values(phasesOf(pd?.existing_voltage)).filter((x) => x !== null)
  if (!ex.length) missing.push('tegangan eksisting pelanggan')
  else if (Math.min(...ex) < LIMITS.existingMinV) reasons.push(`tegangan eksisting ${Math.min(...ex)} V (< ${LIMITS.existingMinV} V)`)
  const d = toNum(distanceM)
  if (d === null) missing.push('jarak bangunan dari tiang')
  else if (d > LIMITS.distanceMaxM) reasons.push(`jarak ${d} m dari tiang (> ${LIMITS.distanceMaxM} m)`)
  if (reasons.length) return { extension: true, reasons, missing }
  if (missing.length) return { extension: null, reasons, missing }
  return { extension: false, reasons, missing }
}
