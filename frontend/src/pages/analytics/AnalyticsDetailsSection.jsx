import { useMemo, useState } from 'react'
import Pagination from '../../components/Pagination.jsx'

const CARD = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs'

const fmtFloat = (v, digits = 2) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '-'
  return Number(v).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

const fmtMetricValue = (v, unit) => {
  if (v === null || v === undefined || Number.isNaN(Number(v))) return '-'
  const u = String(unit || '').toLowerCase()
  const digits = u === 'plg' || u === 'pelanggan' || u === 'kali' || u === 'wo' || u === 'kejadian' ? 0 : 2
  return fmtFloat(v, digits)
}

const fmtMonth = (m) => {
  if (!m) return '-'
  const [yr, mo] = String(m).split('-')
  const names = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  const idx = Number(mo) - 1
  if (idx >= 0 && idx < 12) return `${names[idx]} ${yr.slice(2)}`
  return m
}

function PolarityPctBadge({ pct, polarity = 'up' }) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) {
    return <span className="text-slate-400 font-mono">-</span>
  }
  const num = Number(pct)
  const isZero = Math.abs(num) < 0.05
  const isPositiveGood = polarity === 'up'
  const isGood = isZero ? null : isPositiveGood ? num > 0 : num < 0

  const cls = isZero
    ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
    : isGood
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold tabular-nums ${cls}`}>
      {num > 0 ? '+' : ''}{fmtFloat(num, 1)}%
    </span>
  )
}

/** Grafik Horizontal Bar / Diverging Bar untuk Breakdown */
function BreakdownBarChart({ rows }) {
  const hasNegative = rows.some((r) => Number(r.value) < 0)

  const chartRows = useMemo(() => {
    const sorted = [...rows].sort((a, b) => Math.abs(Number(b.value || 0)) - Math.abs(Number(a.value || 0)))
    if (sorted.length <= 7 || hasNegative) return sorted.slice(0, 8)
    const top = sorted.slice(0, 6)
    const rest = sorted.slice(6)
    const restVal = rest.reduce((acc, r) => acc + Number(r.value || 0), 0)
    const restShare = rest.reduce((acc, r) => acc + Number(r.share_pct || 0), 0)
    return [...top, { key: `Lainnya (${rest.length})`, value: restVal, share_pct: restShare, isOther: true }]
  }, [rows, hasNegative])

  const maxAbs = useMemo(
    () => Math.max(1, ...chartRows.map((r) => Math.abs(Number(r.value || 0)))),
    [chartRows],
  )

  if (chartRows.length === 0) return null

  if (hasNegative) {
    return (
      <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 space-y-2">
        <div className="flex items-center justify-between text-[11px] text-slate-500">
          <span className="font-semibold">Diverging Bar (Penambah vs Pengurang)</span>
          <span>Positif ke kanan &bull; Negatif ke kiri</span>
        </div>
        <div className="space-y-1.5">
          {chartRows.map((r) => {
            const val = Number(r.value || 0)
            const widthPct = Math.min(100, (Math.abs(val) / maxAbs) * 100)
            const isNeg = val < 0
            return (
              <div key={r.key} className="grid grid-cols-12 items-center gap-2 text-[11px]">
                <div className="col-span-4 truncate font-medium text-slate-700 dark:text-slate-300" title={r.key}>
                  {r.key}
                </div>
                <div className="col-span-5 grid grid-cols-2 items-center">
                  <div className="flex justify-end pr-0.5 border-r border-slate-300 dark:border-slate-600 h-3 items-center">
                    {isNeg && (
                      <div
                        className="h-2.5 rounded-l bg-rose-500"
                        style={{ width: `${widthPct}%` }}
                      />
                    )}
                  </div>
                  <div className="flex justify-start pl-0.5 h-3 items-center">
                    {!isNeg && (
                      <div
                        className="h-2.5 rounded-r bg-indigo-600"
                        style={{ width: `${widthPct}%` }}
                      />
                    )}
                  </div>
                </div>
                <div className={`col-span-3 text-right font-mono tabular-nums ${isNeg ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-300'}`}>
                  {fmtFloat(val)}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 space-y-2">
      <div className="text-[11px] font-semibold text-slate-500">
        Komposisi Terbesar
      </div>
      <div className="space-y-1.5">
        {chartRows.map((r) => {
          const val = Number(r.value || 0)
          const widthPct = Math.min(100, (Math.abs(val) / maxAbs) * 100)
          return (
            <div key={r.key} className="grid grid-cols-12 items-center gap-2 text-[11px]">
              <div className="col-span-4 truncate font-medium text-slate-700 dark:text-slate-300" title={r.key}>
                {r.key}
              </div>
              <div className="col-span-5">
                <div className="w-full h-2.5 rounded-full bg-slate-200/70 dark:bg-slate-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full ${r.isOther ? 'bg-slate-400' : 'bg-indigo-600'}`}
                    style={{ width: `${widthPct}%` }}
                  />
                </div>
              </div>
              <div className="col-span-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                {fmtFloat(r.share_pct, 1)}%
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

export function BreakdownCard({
  breakdown,
  polarity = 'up',
  page,
  perPage,
  onPage,
  onPerPage,
  subtitle,
}) {
  const rows = breakdown?.rows || []

  const summary = useMemo(() => {
    const totalVal = rows.reduce((acc, r) => acc + Number(r.value || 0), 0)
    const hasAllPrev = rows.length > 0 && rows.every((r) => r.same_month_last_year !== null && r.same_month_last_year !== undefined)
    const totalPrev = hasAllPrev ? rows.reduce((acc, r) => acc + Number(r.same_month_last_year || 0), 0) : null
    const totalYoy = totalPrev !== null && totalPrev !== 0 ? ((totalVal - totalPrev) / Math.abs(totalPrev)) * 100 : null
    const totalShare = rows.reduce((acc, r) => acc + Number(r.share_pct || 0), 0)

    const hasNeg = rows.some((r) => Number(r.value || 0) < 0)
    let concentrationText = ''
    if (rows.length > 1 && !hasNeg) {
      const top3 = [...rows].sort((a, b) => Number(b.share_pct || 0) - Number(a.share_pct || 0)).slice(0, Math.min(3, rows.length))
      const top3Sum = top3.reduce((acc, r) => acc + Number(r.share_pct || 0), 0)
      concentrationText = `${top3.length} kategori terbesar menyumbang ${fmtFloat(top3Sum, 1)}% dari total`
    } else if (hasNeg) {
      const posSum = rows.filter((r) => Number(r.value || 0) > 0).reduce((acc, r) => acc + Number(r.value || 0), 0)
      const negSum = rows.filter((r) => Number(r.value || 0) < 0).reduce((acc, r) => acc + Number(r.value || 0), 0)
      concentrationText = `Pos penambah: ${fmtFloat(posSum)} • Pos pengurang: ${fmtFloat(negSum)}`
    }

    return { totalVal, totalPrev, totalYoy, totalShare, concentrationText }
  }, [rows])

  return (
    <div className={`${CARD} p-5 space-y-4`}>
      <div className="flex flex-wrap items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {`Rincian: ${breakdown.dimension}`}
          </h3>
          <p className="text-xs text-slate-500">
            {subtitle || `Komposisi pada periode ${fmtMonth(breakdown.period)}`}
          </p>
        </div>
        {summary.concentrationText && (
          <span className="px-2.5 py-1 rounded-lg bg-indigo-50/70 dark:bg-indigo-950/40 text-indigo-700 dark:text-indigo-300 text-[11px] font-semibold">
            {summary.concentrationText}
          </span>
        )}
      </div>

      <BreakdownBarChart rows={rows} />

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-2.5 px-3">Kategori</th>
              <th className="py-2.5 px-3 text-right">Nilai</th>
              <th className="py-2.5 px-3 text-right">Porsi</th>
              {summary.totalPrev !== null && (
                <th className="py-2.5 px-3 text-right" title="Perubahan porsi dibanding tahun lalu (poin persentase)">Δ Porsi</th>
              )}
              <th className="py-2.5 px-3 text-right">Thn Lalu</th>
              <th className="py-2.5 px-3 text-right">YoY</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {rows
              .slice((page - 1) * perPage, page * perPage)
              .map((r) => {
                let deltaPp = null
                if (summary.totalPrev && summary.totalPrev !== 0 && r.same_month_last_year !== null && r.same_month_last_year !== undefined && r.share_pct !== null && r.share_pct !== undefined) {
                  const prevShare = (Number(r.same_month_last_year) / Math.abs(summary.totalPrev)) * 100
                  deltaPp = Number(r.share_pct) - prevShare
                }

                return (
                  <tr key={r.key} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                      {r.key}
                    </td>
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                      {fmtFloat(r.value)}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 h-1.5 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full ${r.value < 0 || r.share_pct < 0 ? 'bg-rose-500' : 'bg-indigo-600'}`}
                            style={{ width: `${Math.min(100, Math.max(0, Math.abs(r.share_pct || 0)))}%` }}
                          />
                        </div>
                        <span className={`font-mono tabular-nums text-[11px] ${r.share_pct < 0 ? 'text-rose-600 dark:text-rose-400' : ''}`}>
                          {fmtFloat(r.share_pct, 1)}%
                        </span>
                      </div>
                    </td>
                    {summary.totalPrev !== null && (
                      <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[11px]">
                        {deltaPp !== null ? (
                          <span className={Math.abs(deltaPp) < 0.05 ? 'text-slate-400' : deltaPp > 0 ? 'text-blue-600 dark:text-blue-400' : 'text-amber-600 dark:text-amber-400'}>
                            {deltaPp > 0 ? '+' : ''}{fmtFloat(deltaPp, 1)} pp
                          </span>
                        ) : '-'}
                      </td>
                    )}
                    <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-400">
                      {r.same_month_last_year !== null ? fmtFloat(r.same_month_last_year) : '-'}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <PolarityPctBadge pct={r.yoy_pct} polarity={polarity} />
                    </td>
                  </tr>
                )
              })}
          </tbody>
          {rows.length > 0 && (
            <tfoot className="bg-slate-50/90 dark:bg-slate-800/70 border-t border-slate-200 dark:border-slate-700 font-bold text-slate-900 dark:text-slate-100">
              <tr>
                <td className="py-2.5 px-3">Total ({rows.length})</td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums">{fmtFloat(summary.totalVal)}</td>
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-[11px]">{fmtFloat(summary.totalShare, 1)}%</td>
                {summary.totalPrev !== null && <td className="py-2.5 px-3 text-right font-mono text-[11px] text-slate-400">-</td>}
                <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-500">
                  {summary.totalPrev !== null ? fmtFloat(summary.totalPrev) : '-'}
                </td>
                <td className="py-2.5 px-3 text-right">
                  <PolarityPctBadge pct={summary.totalYoy} polarity={polarity} />
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {rows.length > 5 && (
        <div className="pt-2">
          <Pagination
            page={page}
            total={rows.length}
            perPage={perPage}
            onPage={onPage}
            onPerPage={(pp) => {
              onPerPage(pp)
              onPage(1)
            }}
            perPageOptions={[5, 10, 25]}
          />
        </div>
      )}
    </div>
  )
}

export function ComparisonCard({
  d,
  activeCode,
  contributionBase,
  onContributionBaseChange,
  page,
  perPage,
  onPage,
  onPerPage,
  onSelectUnit,
}) {
  const [sortBy, setSortBy] = useState('default') // 'default' | 'value_desc' | 'value_asc' | 'share_desc'
  const contribBases = d.contribution?.bases || {}
  const activeContrib = contribBases[contributionBase] || contribBases['yoy']
  const contribMap = useMemo(
    () =>
      (activeContrib?.units || []).reduce((acc, u) => {
        acc[u.unit_id] = u
        return acc
      }, {}),
    [activeContrib],
  )

  const sortedComparison = useMemo(() => {
    const list = [...(d.comparison || [])]
    if (sortBy === 'value_desc') {
      list.sort((a, b) => Number(b.latest ?? -Infinity) - Number(a.latest ?? -Infinity))
    } else if (sortBy === 'value_asc') {
      list.sort((a, b) => Number(a.latest ?? Infinity) - Number(b.latest ?? Infinity))
    } else if (sortBy === 'share_desc') {
      list.sort((a, b) => Math.abs(Number(contribMap[b.unit_id]?.share_pct ?? 0)) - Math.abs(Number(contribMap[a.unit_id]?.share_pct ?? 0)))
    }
    return list
  }, [d.comparison, sortBy, contribMap])

  const barStats = useMemo(() => {
    const vals = sortedComparison.map((c) => c.latest).filter((v) => v !== null && v !== undefined).map(Number)
    if (vals.length === 0) return { max: 1, avg: null }
    const max = Math.max(1, ...vals.map((v) => Math.abs(v)))
    const avg = vals.reduce((a, b) => a + b, 0) / vals.length
    return { max, avg }
  }, [sortedComparison])

  const isPartialMonth = (d.warnings || []).some(
    (w) => w.month === d.to && (w.code === 'apkt_current_month_partial' || w.code === 'ap2t_current_month_partial'),
  )

  return (
    <div className={`${CARD} p-5 space-y-4`}>
      <div className="flex flex-col sm:flex-row sm:items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 gap-2">
        <div>
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {activeCode === 'rpt-rct-gangguan'
              ? 'Perbandingan Antar ULP (Semua Laporan vs Tanpa Clear Temper)'
              : 'Perbandingan Antar ULP'}
          </h3>
          <p className="text-xs text-slate-500">
            Capaian bulan {fmtMonth(d.to)}
            {isPartialMonth && (
              <span className="ml-1.5 px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
                Bulan berjalan, belum final
              </span>
            )}
            {' '}&bull; klik nama ULP untuk lihat detail unit
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
          <div className="inline-flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs">
            <span className="text-[10px] text-slate-400 font-medium px-1">Urut:</span>
            {[
              ['default', 'Bawaan'],
              ['value_desc', 'Tertinggi'],
              ['value_asc', 'Terendah'],
              ...(d.contribution ? [['share_desc', 'Sumbangan']] : []),
            ].map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => {
                  setSortBy(id)
                  onPage(1)
                }}
                className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors cursor-pointer ${
                  sortBy === id
                    ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {d.contribution && (
            <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs">
              <span className="text-[10px] text-slate-400 font-medium px-1.5">Sumbangan:</span>
              {['yoy', 'mom', 'ytd'].map((bKey) => {
                const bData = contribBases[bKey]
                if (!bData) return null
                const isSelected = (contributionBase || 'yoy') === bKey
                return (
                  <button
                    key={bKey}
                    type="button"
                    onClick={() => onContributionBaseChange(bKey)}
                    className={`px-2 py-0.5 rounded text-[11px] font-semibold transition-colors uppercase cursor-pointer ${
                      isSelected
                        ? 'bg-white dark:bg-slate-700 text-blue-600 dark:text-blue-400 shadow-xs'
                        : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                    }`}
                    title={bData.label}
                  >
                    {bKey}
                  </button>
                )
              })}
            </div>
          )}
        </div>
      </div>

      {d.contribution && activeContrib && (
        <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50/50 dark:bg-slate-800/30 px-3 py-1.5 rounded-lg border border-slate-100 dark:border-slate-800/60 flex items-center justify-between flex-wrap gap-2">
          <span>
            Dasar sumbangan: <strong className="text-slate-700 dark:text-slate-300">{activeContrib.label}</strong> ({activeContrib.units_compared} ULP setara)
          </span>
          {activeContrib.total !== null && activeContrib.total !== undefined && (
            <span className="font-mono">
              Total perubahan: <strong>{activeContrib.total > 0 ? '+' : ''}{fmtMetricValue(activeContrib.total, d.contribution.unit)} {d.contribution.unit}</strong>
            </span>
          )}
        </div>
      )}

      {/* Horizontal Bar Chart + Garis Rata-rata UP3 */}
      {barStats.avg !== null && sortedComparison.length > 0 && (
        <div className="p-3 rounded-xl bg-slate-50/70 dark:bg-slate-800/30 border border-slate-100 dark:border-slate-800 space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-500">
            <span className="font-semibold">Sebaran Capaian ULP</span>
            <span className="text-emerald-700 dark:text-emerald-400 font-mono">
              Garis putus-putus: Rata-rata ULP ({fmtFloat(barStats.avg)})
            </span>
          </div>
          <div className="space-y-1.5 relative">
            {sortedComparison.slice(0, 10).map((c) => {
              const val = c.latest !== null && c.latest !== undefined ? Number(c.latest) : null
              const widthPct = val !== null ? Math.min(100, (Math.abs(val) / barStats.max) * 100) : 0
              const avgPct = Math.min(100, (Math.abs(barStats.avg) / barStats.max) * 100)
              return (
                <div key={c.unit_id} className="grid grid-cols-12 items-center gap-2 text-[11px]">
                  <button
                    type="button"
                    onClick={() => onSelectUnit?.(c.unit_id)}
                    className="col-span-4 truncate text-left font-medium text-indigo-700 dark:text-indigo-300 hover:underline cursor-pointer"
                    title={`Buka detail ${c.unit_name}`}
                  >
                    {c.unit_name}
                  </button>
                  <div className="col-span-6 relative h-3 bg-slate-200/70 dark:bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full bg-indigo-600/85"
                      style={{ width: `${widthPct}%` }}
                    />
                    <div
                      className="absolute top-0 bottom-0 border-l-2 border-dashed border-emerald-600 dark:border-emerald-400"
                      style={{ left: `${avgPct}%` }}
                      title={`Rata-rata: ${fmtFloat(barStats.avg)}`}
                    />
                  </div>
                  <div className="col-span-2 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                    {val !== null ? fmtFloat(val) : '-'}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
            {activeCode === 'rpt-rct-gangguan' ? (
              <>
                <tr>
                  <th rowSpan={2} className="py-2.5 px-3 w-10 text-center border-r border-slate-200 dark:border-slate-700">#</th>
                  <th rowSpan={2} className="py-2.5 px-3 border-r border-slate-200 dark:border-slate-700">Unit Layanan (ULP)</th>
                  <th colSpan={3} className="py-1.5 px-3 text-center border-r border-slate-200 dark:border-slate-700 bg-purple-50/50 dark:bg-purple-950/20 text-purple-800 dark:text-purple-300 font-semibold">
                    Semua Laporan (Utama)
                  </th>
                  <th colSpan={3} className="py-1.5 px-3 text-center border-r border-slate-200 dark:border-slate-700 bg-slate-100/50 dark:bg-slate-800/50 font-semibold">
                    Tanpa Clear Temper (Pembanding)
                  </th>
                  <th rowSpan={2} className="py-2.5 px-3 text-right bg-amber-50/40 dark:bg-amber-950/20 text-amber-800 dark:text-amber-300 font-semibold">
                    Porsi CT
                  </th>
                </tr>
                <tr className="border-t border-slate-200 dark:border-slate-700">
                  <th className="py-1.5 px-2.5 text-right font-medium">WO</th>
                  <th className="py-1.5 px-2.5 text-right font-medium">RPT</th>
                  <th className="py-1.5 px-2.5 text-right font-medium border-r border-slate-200 dark:border-slate-700">RCT</th>
                  <th className="py-1.5 px-2.5 text-right font-medium">WO</th>
                  <th className="py-1.5 px-2.5 text-right font-medium">RPT</th>
                  <th className="py-1.5 px-2.5 text-right font-medium border-r border-slate-200 dark:border-slate-700">RCT</th>
                </tr>
              </>
            ) : (
              <tr>
                <th className="py-2.5 px-3 w-10 text-center">#</th>
                <th className="py-2.5 px-3">Unit Layanan (ULP)</th>
                <th className="py-2.5 px-3 text-right">Bulan Ini</th>
                <th className="py-2.5 px-3 text-right">YoY</th>
                <th className="py-2.5 px-3 text-right">Kumulatif YTD</th>
                {d.contribution && (
                  <>
                    <th className="py-2.5 px-3 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Perubahan ({contributionBase.toUpperCase()})
                    </th>
                    <th className="py-2.5 px-3 text-right font-semibold text-slate-700 dark:text-slate-300">
                      Sumbangan
                    </th>
                  </>
                )}
              </tr>
            )}
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {sortedComparison
              .slice((page - 1) * perPage, page * perPage)
              .map((c, idx) => {
                const cu = contribMap[c.unit_id]

                return (
                  <tr key={c.unit_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 text-center font-mono text-slate-400 text-[11px]">
                      {(page - 1) * perPage + idx + 1}
                    </td>
                    <td className="py-2.5 px-3 font-semibold">
                      <button
                        type="button"
                        onClick={() => onSelectUnit?.(c.unit_id)}
                        className="text-left text-indigo-700 dark:text-indigo-300 hover:underline cursor-pointer"
                        title={`Klik untuk membuka detail ${c.unit_name}`}
                      >
                        {c.unit_name}
                      </button>
                    </td>
                    {activeCode === 'rpt-rct-gangguan' ? (
                      <>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {c.jumlah !== undefined && c.jumlah !== null ? fmtFloat(c.jumlah, 0) : '-'}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                          {c.latest !== null ? fmtFloat(c.latest, 1) : '-'}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300 border-r border-slate-100 dark:border-slate-800">
                          {c.rct !== undefined && c.rct !== null ? fmtFloat(c.rct, 1) : '-'}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400">
                          {c.jumlah_tanpa_ct !== undefined && c.jumlah_tanpa_ct !== null ? fmtFloat(c.jumlah_tanpa_ct, 0) : '-'}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                          {c.rpt_tanpa_ct !== undefined && c.rpt_tanpa_ct !== null ? fmtFloat(c.rpt_tanpa_ct, 1) : '-'}
                        </td>
                        <td className="py-2.5 px-2.5 text-right font-mono tabular-nums text-slate-600 dark:text-slate-400 border-r border-slate-100 dark:border-slate-800">
                          {c.rct_tanpa_ct !== undefined && c.rct_tanpa_ct !== null ? fmtFloat(c.rct_tanpa_ct, 1) : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-amber-700 dark:text-amber-400">
                          {c.porsi_clear_temper !== undefined && c.porsi_clear_temper !== null ? `${fmtFloat(c.porsi_clear_temper, 1)}%` : '-'}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                          {c.latest !== null ? fmtFloat(c.latest) : '-'}
                        </td>
                        <td className="py-2.5 px-3 text-right">
                          <PolarityPctBadge pct={c.yoy_pct} polarity={d.metric?.polarity || 'up'} />
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                          {c.ytd !== null ? fmtFloat(c.ytd) : '-'}
                        </td>
                        {d.contribution && (
                          <>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums">
                              {cu?.change !== undefined && cu?.change !== null ? (
                                <span className={cu.change > 0 ? 'text-emerald-600 dark:text-emerald-400' : cu.change < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-500'}>
                                  {cu.change > 0 ? '+' : ''}{fmtMetricValue(cu.change, d.contribution.unit)}
                                </span>
                              ) : '-'}
                            </td>
                            <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold">
                              {cu?.share_pct !== undefined && cu?.share_pct !== null ? (
                                <span>{fmtFloat(cu.share_pct, 1)}%</span>
                              ) : '-'}
                            </td>
                          </>
                        )}
                      </>
                    )}
                  </tr>
                )
              })}
          </tbody>
        </table>
      </div>

      {sortedComparison.length > 5 && (
        <div className="pt-2">
          <Pagination
            page={page}
            total={sortedComparison.length}
            perPage={perPage}
            onPage={onPage}
            onPerPage={(pp) => {
              onPerPage(pp)
              onPage(1)
            }}
            perPageOptions={[5, 10, 20]}
          />
        </div>
      )}
    </div>
  )
}
