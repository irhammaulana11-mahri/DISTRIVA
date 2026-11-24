import { fmtInt, fmtNum, fmtPct, monthLong } from '../../components/TrendCharts.jsx'

const MONTH_NAMES = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']

/** Kalimat temuan otomatis dari hasil /reports/customer-growth; hanya menyebut yang didukung data (tidak ada klaim sebab). */
export function buildInsights(d) {
  if (!d?.kpi || !d.kpi.last_full_month) return []
  const out = []
  const k = d.kpi
  if (k.l12m_growth_pct !== null && k.prev12m) {
    const up = k.l12m_growth_pct >= 0
    out.push({ tone: up ? 'up' : 'down', text: `12 bulan terakhir (sampai ${monthLong(k.last_full_month)}): ${fmtInt(k.l12m.pb_count)} pelanggan baru, ${fmtPct(k.l12m_growth_pct)} dibanding 12 bulan sebelumnya (${fmtInt(k.prev12m.pb_count)}).` })
  }
  if (k.ytd_growth_pct !== null && k.ytd_prev) {
    out.push({ tone: k.ytd_growth_pct >= 0 ? 'up' : 'down', text: `Tahun ${k.ytd.year} sampai ${monthLong(k.last_full_month)}: ${fmtInt(k.ytd.pb_count)} pelanggan baru, ${fmtPct(k.ytd_growth_pct)} dibanding periode yang sama ${k.ytd_prev.year} (${fmtInt(k.ytd_prev.pb_count)}).` })
  }
  const months = d.seasonality?.months || []
  if (months.length === 12) {
    const hi = months.reduce((x, y) => (y.index > x.index ? y : x))
    const lo = months.reduce((x, y) => (y.index < x.index ? y : x))
    out.push({ tone: 'info', text: `Pola musiman (${d.seasonality.years.join(', ')}): puncak ${MONTH_NAMES[hi.month - 1]} (indeks ${fmtNum(hi.index, 2)}), terendah ${MONTH_NAMES[lo.month - 1]} (indeks ${fmtNum(lo.index, 2)}).` })
  }
  const top = (d.by_unit || [])[0]
  if (top && top.l12m_pb > 0) out.push({ tone: 'info', text: `${top.unit_name} paling banyak menambah pelanggan baru dalam 12 bulan terakhir (${fmtInt(top.l12m_pb)} PB).` })
  const spike = (d.anomalies || [])[0]
  if (spike) out.push({ tone: spike.direction === 'NAIK' ? 'up' : 'down', text: `Bulan menyimpang terbaru: ${monthLong(spike.month)}, ${fmtInt(spike.pb_count)} PB ${spike.direction === 'NAIK' ? 'di atas' : 'di bawah'} kebiasaan 12 bulan sebelumnya (sekitar ${fmtInt(spike.expected)}).` })
  const last12 = (d.monthly || []).filter((m) => !m.partial).slice(-12)
  const req = last12.reduce((s, m) => s + m.requests_pb, 0)
  const cancelled = last12.reduce((s, m) => s + m.cancelled + m.refunded, 0)
  if (req > 0) out.push({ tone: 'info', text: `12 bulan terakhir: ${fmtInt(req)} permohonan PB masuk, ${fmtInt(last12.reduce((s, m) => s + m.pb_count, 0))} tersambung; ${fmtInt(cancelled)} permohonan dibatalkan atau direstitusi.` })
  return out
}
