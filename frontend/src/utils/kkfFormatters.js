/**
 * Formatting and conversion utilities for KKF (Kelayakan Keuangan) parameters.
 * Rates in backend are stored and transmitted as decimal fractions (e.g. 0.0778 = 7.78 %).
 * In frontend, rates are presented and entered as percentages (e.g. 7,78 % or 7.78).
 */

export function fractionToPercent(frac) {
  if (frac === null || frac === undefined || frac === '') return ''
  const num = Number(frac)
  if (isNaN(num)) return ''
  const pct = Math.round(num * 100 * 10000) / 10000
  return pct.toString()
}

export function percentToFraction(pctStr) {
  if (pctStr === null || pctStr === undefined || pctStr === '') return null
  const cleaned = String(pctStr).trim().replace(',', '.')
  const num = parseFloat(cleaned)
  if (isNaN(num)) return null
  return Math.round((num / 100) * 1000000) / 1000000
}

export function formatPercentDisplay(frac, decimals = 2) {
  if (frac === null || frac === undefined || isNaN(Number(frac))) return '-'
  const pct = Number(frac) * 100
  return `${pct.toLocaleString('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: 4,
  })} %`
}

export function formatRupiahPerKwh(bpp) {
  if (bpp === null || bpp === undefined || isNaN(Number(bpp))) return '-'
  return `Rp ${Number(bpp).toLocaleString('id-ID')} / kWh`
}

export function formatRupiah(val, withCents = false) {
  if (val === null || val === undefined || isNaN(Number(val))) return '-'
  const num = Number(val)
  return `Rp ${num.toLocaleString('id-ID', {
    minimumFractionDigits: withCents ? 2 : 0,
    maximumFractionDigits: 2,
  })}`
}

export function formatNumber(val, decimals = 2) {
  if (val === null || val === undefined || isNaN(Number(val))) return '-'
  return Number(val).toLocaleString('id-ID', {
    minimumFractionDigits: 0,
    maximumFractionDigits: decimals,
  })
}

export function formatPercentNumber(pct, decimals = 2) {
  if (pct === null || pct === undefined || isNaN(Number(pct))) return '-'
  return `${Number(pct).toLocaleString('id-ID', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: 4,
  })} %`
}

export const KKF_DEFAULT_FALLBACKS = {
  discount_rate: 0.0778,
  bpp: 552,
  om_rate: 0.02,
  load_factor: 1,
  roe: 0.0047,
  interest_rate: 0.0778,
  tax_rate: 0.25,
  horizon_years: 25,
  payback_limit_months: 60,
}

export const KKF_FIELDS = [
  {
    key: 'discount_rate',
    label: 'Tingkat Diskonto (Discount Rate)',
    type: 'percent',
    help: 'Standar diskonto arus kas finansial (docs/62 §25)',
    min: 0.01,
    max: 99.99,
  },
  {
    key: 'bpp',
    label: 'Biaya Pokok Penyediaan (BPP)',
    type: 'number',
    unit: 'Rp/kWh',
    help: 'Tarif dasar biaya penyediaan tenaga listrik',
    min: 1,
    max: 100000,
  },
  {
    key: 'om_rate',
    label: 'Biaya Operasi & Pemeliharaan (O&M)',
    type: 'percent',
    help: 'Estimasi biaya O&M tahunan terhadap total investasi',
    min: 0,
    max: 99,
  },
  {
    key: 'load_factor',
    label: 'Faktor Beban (Load Factor)',
    type: 'percent',
    help: 'Rasio pemanfaatan kapasitas beban operasional (maks. 100%)',
    min: 0.01,
    max: 100,
  },
  {
    key: 'roe',
    label: 'Return on Equity (ROE)',
    type: 'percent',
    help: 'Tingkat pengembalian ekuitas yang dipersyaratkan',
    min: 0,
    max: 99,
  },
  {
    key: 'interest_rate',
    label: 'Tingkat Bunga Pinjaman (Interest Rate)',
    type: 'percent',
    help: 'Suku bunga pinjaman modal investasi',
    min: 0,
    max: 99,
  },
  {
    key: 'tax_rate',
    label: 'Tarif Pajak Penghasilan (Tax Rate)',
    type: 'percent',
    help: 'Tarif pajak penghasilan badan',
    min: 0,
    max: 99,
  },
  {
    key: 'horizon_years',
    label: 'Horizon Evaluasi Investasi',
    type: 'integer',
    unit: 'Tahun',
    help: 'Periode waktu analisis kelayakan proyek (1–50 tahun)',
    min: 1,
    max: 50,
  },
  {
    key: 'payback_limit_months',
    label: 'Batas Payback Period (PBP)',
    type: 'integer',
    unit: 'Bulan',
    help: 'Batas toleransi periode pengembalian modal (1–600 bulan)',
    min: 1,
    max: 600,
  },
]
