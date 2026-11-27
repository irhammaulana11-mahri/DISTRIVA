import { useMemo, useState } from 'react'

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

function DeltaBadge({ pct }) {
  if (pct === null || pct === undefined || Number.isNaN(Number(pct))) {
    return <span className="text-xs text-slate-400 font-mono">-</span>
  }
  const num = Number(pct)
  const cls =
    Math.abs(num) < 0.05
      ? 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
      : num > 0
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
      : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'

  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[11px] font-mono font-semibold tabular-nums ${cls}`}>
      {num > 0 ? '+' : ''}{fmtFloat(num, 1)}%
    </span>
  )
}

export default function GrowthAnalysisSection({ d, activeCode, isUp3, onSelectUnit }) {
  const series0 = d?.series?.[0]
  const months = d?.months || []
  const values = series0?.values || []
  const prevYearValues = series0?.previous_year || []
  const unit = series0?.unit || d?.metric?.unit || ''
  const isPosition = d?.metric?.ytd_mode === 'last' || activeCode === 'pelanggan' || activeCode === 'daya'
  const target0 = d?.targets?.[0] || null

  // Hitung metrik pertumbuhan bulanan & YTD
  const growthStats = useMemo(() => {
    let lastIdx = -1
    for (let i = values.length - 1; i >= 0; i--) {
      if (values[i] !== null && values[i] !== undefined) {
        lastIdx = i
        break
      }
    }
    if (lastIdx < 0) {
      return { monthlyDeltas: [], momDelta: null, momPct: null, yoyDelta: null, yoyPct: null, ytdDelta: null, ytdPct: null, avgMonthlyDelta: null, latestMonth: null }
    }

    const latestVal = Number(values[lastIdx])
    const prevMoVal = lastIdx > 0 && values[lastIdx - 1] !== null && values[lastIdx - 1] !== undefined ? Number(values[lastIdx - 1]) : null
    const prevYrVal = prevYearValues[lastIdx] !== null && prevYearValues[lastIdx] !== undefined ? Number(prevYearValues[lastIdx]) : null

    const momDelta = prevMoVal !== null ? latestVal - prevMoVal : null
    const momPct = momDelta !== null && prevMoVal !== 0 ? (momDelta / Math.abs(prevMoVal)) * 100 : null

    const yoyDelta = prevYrVal !== null ? latestVal - prevYrVal : null
    const yoyPct = yoyDelta !== null && prevYrVal !== 0 ? (yoyDelta / Math.abs(prevYrVal)) * 100 : null

    // Hitung delta bulanan (MoM) tahun berjalan dan tahun sebelumnya untuk grafik garis
    const monthlyDeltas = months.map((m, idx) => {
      const v = values[idx]
      const pv = idx > 0 ? values[idx - 1] : null
      const py = prevYearValues[idx]
      const ppy = idx > 0 ? prevYearValues[idx - 1] : null
      return {
        month: m,
        delta: v !== null && v !== undefined && pv !== null && pv !== undefined ? Number(v) - Number(pv) : null,
        prevDelta: py !== null && py !== undefined && ppy !== null && ppy !== undefined ? Number(py) - Number(ppy) : null,
      }
    })

    // YTD untuk tahun berjalan (dari bulan pertama tahun terakhir)
    const latestYear = String(months[lastIdx] || '').slice(0, 4)
    let ytdCurr = 0
    let ytdPrev = 0
    let ytdMonths = 0
    months.forEach((m, idx) => {
      if (!String(m).startsWith(latestYear)) return
      const v = values[idx]
      const py = prevYearValues[idx]
      if (v !== null && v !== undefined) {
        ytdCurr += Number(v)
        ytdMonths += 1
      }
      if (py !== null && py !== undefined) {
        ytdPrev += Number(py)
      }
    })

    const ytdDelta = isPosition ? yoyDelta : (ytdMonths > 0 ? ytdCurr - ytdPrev : null)
    const ytdPct = isPosition ? yoyPct : (ytdDelta !== null && ytdPrev !== 0 ? (ytdDelta / Math.abs(ytdPrev)) * 100 : null)

    const validDeltas = monthlyDeltas.filter((x) => x.delta !== null && String(x.month).startsWith(latestYear)).map((x) => x.delta)
    const avgMonthlyDelta = validDeltas.length > 0 ? validDeltas.reduce((a, b) => a + b, 0) / validDeltas.length : null

    return {
      monthlyDeltas,
      momDelta,
      momPct,
      yoyDelta,
      yoyPct,
      ytdDelta,
      ytdPct,
      avgMonthlyDelta,
      latestMonth: months[lastIdx],
    }
  }, [months, values, prevYearValues, isPosition])

  // Kuadran ULP (Porsi Besar vs Laju Pertumbuhan YoY)
  const ulpQuadrants = useMemo(() => {
    if (!isUp3 || !d?.comparison?.length) return []
    const rows = d.comparison.filter((c) => c.latest !== null && c.latest !== undefined)
    if (rows.length === 0) return []
    const totalLatest = rows.reduce((acc, c) => acc + Math.abs(Number(c.latest || 0)), 0) || 1
    const sortedVals = [...rows].map((c) => Number(c.latest)).sort((a, b) => a - b)
    const medianVal = sortedVals[Math.floor(sortedVals.length / 2)]

    return rows.map((c) => {
      const val = Number(c.latest)
      const yoy = c.yoy_pct !== null && c.yoy_pct !== undefined ? Number(c.yoy_pct) : null
      const share = (Math.abs(val) / totalLatest) * 100
      let quadrant = 'Stabil'
      let qCls = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
      if (yoy !== null) {
        if (yoy < 0) {
          quadrant = 'Kontraksi'
          qCls = 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
        } else if (val >= medianVal && yoy >= 5) {
          quadrant = 'Tumbuh Cepat & Besar'
          qCls = 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
        } else if (val < medianVal && yoy >= 5) {
          quadrant = 'Tumbuh Cepat & Kecil'
          qCls = 'bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
        } else {
          quadrant = 'Besar / Melambat'
          qCls = 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
        }
      }
      return { ...c, share, quadrant, qCls }
    })
  }, [isUp3, d?.comparison])

  // Pertumbuhan per Segmen / Golongan (dari breakdown.rows)
  const segmentGrowth = useMemo(() => {
    const rows = d?.breakdown?.rows || []
    if (rows.length === 0) return []
    const withPrev = rows.filter((r) => r.same_month_last_year !== null && r.same_month_last_year !== undefined)
    const totalDelta = withPrev.reduce((acc, r) => acc + (Number(r.value || 0) - Number(r.same_month_last_year || 0)), 0)

    return rows.map((r) => {
      const curr = Number(r.value || 0)
      const prev = r.same_month_last_year !== null && r.same_month_last_year !== undefined ? Number(r.same_month_last_year) : null
      const delta = prev !== null ? curr - prev : null
      const contribToGrowth = delta !== null && totalDelta !== 0 ? (delta / Math.abs(totalDelta)) * 100 : null
      return { ...r, curr, prev, delta, contribToGrowth }
    })
  }, [d?.breakdown])

  // Khusus Pendapatan BP: Pemisahan Organik (Standar) vs Kasus Besar dari detail.monthly
  const bpOrganicSummary = useMemo(() => {
    if (activeCode !== 'hpl-bp' || d?.detail?.kind !== 'connection_fee') return null
    const monthly = d.detail.monthly || []
    if (monthly.length === 0) return null
    const latest = monthly[monthly.length - 1]
    const prev = monthly.length > 1 ? monthly[monthly.length - 2] : null
    const stdCurr = Number(latest?.standard_rp || 0)
    const bigCurr = Number(latest?.big_rp || 0)
    const stdPrev = prev ? Number(prev.standard_rp || 0) : null
    const stdMomPct = stdPrev && stdPrev !== 0 ? ((stdCurr - stdPrev) / stdPrev) * 100 : null
    return { month: latest.month, stdCurr, bigCurr, stdMomPct }
  }, [activeCode, d?.detail])

  const [hoverIdx, setHoverIdx] = useState(null)

  const chartData = useMemo(() => {
    const list = growthStats.monthlyDeltas.slice(-12)
    const nums = []
    list.forEach((dItem) => {
      if (dItem.delta !== null && dItem.delta !== undefined) nums.push(dItem.delta)
      if (dItem.prevDelta !== null && dItem.prevDelta !== undefined) nums.push(dItem.prevDelta)
    })
    let mn = nums.length ? Math.min(...nums) : 0
    let mx = nums.length ? Math.max(...nums) : 100
    if (mn === mx) {
      mn = mn < 0 ? mn * 1.1 : mn * 0.9
      mx = mx * 1.1 || 10
    } else {
      const pad = (mx - mn) * 0.12
      mn = mn < 0 ? mn - pad : Math.max(0, mn - pad)
      mx = mx + pad
    }
    return { list, minVal: mn, maxVal: mx }
  }, [growthStats.monthlyDeltas])

  return (
    <div className="space-y-6" data-testid="growth-analysis-section">
      {/* 1. Empat Kartu Ringkasan Laju Pertumbuhan */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className={`${CARD} p-4 space-y-1`}>
          <div className="text-xs font-medium text-slate-500">Pertumbuhan Bulanan (Δ MoM)</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {growthStats.momDelta !== null ? `${growthStats.momDelta > 0 ? '+' : ''}${fmtMetricValue(growthStats.momDelta, unit)} ${unit}` : '-'}
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-400">{fmtMonth(growthStats.latestMonth)}</span>
            <DeltaBadge pct={growthStats.momPct} />
          </div>
        </div>

        <div className={`${CARD} p-4 space-y-1`}>
          <div className="text-xs font-medium text-slate-500">Pertumbuhan Tahunan (Δ YoY)</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {growthStats.yoyDelta !== null ? `${growthStats.yoyDelta > 0 ? '+' : ''}${fmtMetricValue(growthStats.yoyDelta, unit)} ${unit}` : '-'}
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-400">Lawan bln sama thn lalu</span>
            <DeltaBadge pct={growthStats.yoyPct} />
          </div>
        </div>

        <div className={`${CARD} p-4 space-y-1`}>
          <div className="text-xs font-medium text-slate-500">Pertumbuhan YTD vs Thn Lalu</div>
          <div className="text-xl font-bold font-mono tabular-nums text-slate-900 dark:text-slate-100">
            {growthStats.ytdDelta !== null ? `${growthStats.ytdDelta > 0 ? '+' : ''}${fmtMetricValue(growthStats.ytdDelta, unit)} ${unit}` : '-'}
          </div>
          <div className="flex items-center justify-between pt-1">
            <span className="text-[11px] text-slate-400">Akumulasi tahun berjalan</span>
            <DeltaBadge pct={growthStats.ytdPct} />
          </div>
        </div>

        <div className={`${CARD} p-4 space-y-1`}>
          <div className="text-xs font-medium text-slate-500">Laju vs Kebutuhan Target</div>
          <div className="text-xl font-bold font-mono tabular-nums text-indigo-700 dark:text-indigo-300">
            {growthStats.avgMonthlyDelta !== null ? `${growthStats.avgMonthlyDelta > 0 ? '+' : ''}${fmtMetricValue(growthStats.avgMonthlyDelta, unit)}/bln` : '-'}
          </div>
          <div className="text-[11px] text-slate-500 pt-1">
            {target0?.needed_per_month !== null && target0?.needed_per_month !== undefined
              ? `Kebutuhan sisa: ${fmtMetricValue(target0.needed_per_month, target0.unit_label || unit)}/bln`
              : target0
              ? `Capaian target NKO: ${fmtFloat(target0.pencapaian_pct, 1)}%`
              : 'Rata-rata laju bulanan tahun ini'}
          </div>
        </div>
      </div>

      {/* Blok Khusus Pendapatan BP: Pertumbuhan Organik vs Kasus Besar */}
      {bpOrganicSummary && (
        <div className={`${CARD} p-4 flex flex-wrap items-center justify-between gap-4 bg-indigo-50/30 dark:bg-indigo-950/20`}>
          <div>
            <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
              Pertumbuhan Organik (Kasus Standar) vs Kasus Besar — {fmtMonth(bpOrganicSummary.month)}
            </h4>
            <p className="text-[11px] text-slate-500">
              Memisahkan BP permohonan standar (pertumbuhan berulang) dari lonjakan kasus besar TM/TT.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div>
              <span className="text-slate-500">BP Standar:</span>{' '}
              <strong className="font-mono text-slate-900 dark:text-slate-100">Rp {fmtFloat(bpOrganicSummary.stdCurr / 1e6, 1)} jt</strong>{' '}
              <DeltaBadge pct={bpOrganicSummary.stdMomPct} />
            </div>
            <div>
              <span className="text-slate-500">BP Kasus Besar:</span>{' '}
              <strong className="font-mono text-amber-700 dark:text-amber-300">Rp {fmtFloat(bpOrganicSummary.bigCurr / 1e6, 1)} jt</strong>
            </div>
          </div>
        </div>
      )}

      {/* 2. Grafik Garis Laju Pertumbuhan Bulanan vs Tahun Sebelumnya */}
      {chartData.list.some((x) => x.delta !== null) && (() => {
        const { list, minVal, maxVal } = chartData
        const width = 960
        const height = 240
        const padLeft = 65
        const padRight = 20
        const padTop = 20
        const padBottom = 35
        const chartW = width - padLeft - padRight
        const chartH = height - padTop - padBottom

        const getX = (idx) => (list.length <= 1 ? padLeft + chartW / 2 : padLeft + (idx / (list.length - 1)) * chartW)
        const getY = (val) => (val === null || val === undefined ? null : padTop + chartH - ((val - minVal) / (maxVal - minVal || 1)) * chartH)
        const zeroY = minVal < 0 && maxVal > 0 ? getY(0) : null
        const baseLineY = zeroY !== null ? zeroY : padTop + chartH

        const buildLine = (key) => {
          let dStr = ''
          let started = false
          list.forEach((item, idx) => {
            const y = getY(item[key])
            if (y === null) {
              started = false
              return
            }
            const x = getX(idx)
            dStr += started ? ` L ${x.toFixed(1)} ${y.toFixed(1)}` : `M ${x.toFixed(1)} ${y.toFixed(1)}`
            started = true
          })
          return dStr
        }

        const buildArea = (key) => {
          let dStr = ''
          let firstX = null
          let lastX = null
          list.forEach((item, idx) => {
            const y = getY(item[key])
            if (y === null) return
            const x = getX(idx)
            if (firstX === null) {
              firstX = x
              dStr += `M ${x.toFixed(1)} ${baseLineY.toFixed(1)} L ${x.toFixed(1)} ${y.toFixed(1)}`
            } else {
              dStr += ` L ${x.toFixed(1)} ${y.toFixed(1)}`
            }
            lastX = x
          })
          if (firstX !== null && lastX !== null) dStr += ` L ${lastX.toFixed(1)} ${baseLineY.toFixed(1)} Z`
          return dStr
        }

        const currPath = buildLine('delta')
        const prevPath = buildLine('prevDelta')
        const currArea = buildArea('delta')
        const hovered = hoverIdx !== null ? list[hoverIdx] : null
        const hoveredXPct = hoverIdx !== null ? (getX(hoverIdx) / width) * 100 : 50

        return (
          <div className={`${CARD} p-5 space-y-3 relative`} onMouseLeave={() => setHoverIdx(null)}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {`Tren Pertumbuhan Bulanan (Δ MoM ${unit}) vs Tahun Sebelumnya`}
                </h3>
                <p className="text-xs text-slate-500">
                  Garis solid: pertumbuhan tahun berjalan &bull; Garis putus-putus: periode sama tahun sebelumnya.
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="inline-flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                  <span className="w-4 h-1 rounded-full bg-indigo-600" />
                  <span>Tahun Berjalan</span>
                </span>
                <span className="inline-flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                  <span className="w-4 h-0.5 border-b-2 border-dashed border-slate-400" />
                  <span>Tahun Sebelumnya</span>
                </span>
              </div>
            </div>

            {hovered && (
              <div
                className="absolute z-20 pointer-events-none transition-all duration-150 ease-out"
                style={{
                  left: `${hoveredXPct}%`,
                  top: '65px',
                  transform: hoveredXPct > 70 ? 'translateX(-100%)' : hoveredXPct < 30 ? 'translateX(0%)' : 'translateX(-50%)',
                }}
              >
                <div className="rounded-xl border border-slate-200/90 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 shadow-xl p-3 min-w-[230px] backdrop-blur-xs text-xs space-y-1.5">
                  <div className="border-b border-slate-100 dark:border-slate-800 pb-1 font-bold text-slate-900 dark:text-slate-100">
                    Bulan {fmtMonth(hovered.month)}
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 font-medium">
                      <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 shrink-0" />
                      <span>Berjalan:</span>
                    </span>
                    <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                      {hovered.delta !== null ? `${hovered.delta > 0 ? '+' : ''}${fmtMetricValue(hovered.delta, unit)} ${unit}` : '-'}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                      <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />
                      <span>Thn Sebelumnya:</span>
                    </span>
                    <span className="font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                      {hovered.prevDelta !== null ? `${hovered.prevDelta > 0 ? '+' : ''}${fmtMetricValue(hovered.prevDelta, unit)} ${unit}` : '-'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            <div className="relative w-full">
              <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto select-none overflow-visible">
                <defs>
                  <linearGradient id="growthAreaGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.24" />
                    <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.0" />
                  </linearGradient>
                </defs>
                {[0, 0.25, 0.5, 0.75, 1].map((ratio, idx) => {
                  const val = minVal + ratio * (maxVal - minVal)
                  const y = padTop + chartH - ratio * chartH
                  return (
                    <g key={idx}>
                      <line x1={padLeft} y1={y} x2={width - padRight} y2={y} stroke="#e2e8f0" strokeDasharray={idx === 0 ? 'none' : '3 3'} className="dark:stroke-slate-800" />
                      <text x={padLeft - 8} y={y + 3.5} textAnchor="end" className="text-[10px] fill-slate-400 font-mono">
                        {fmtFloat(val, maxVal >= 1000 ? 0 : 1)}
                      </text>
                    </g>
                  )
                })}
                {zeroY !== null && <line x1={padLeft} y1={zeroY} x2={width - padRight} y2={zeroY} stroke="#64748b" strokeWidth="1.2" />}
                {currArea && <path d={currArea} fill="url(#growthAreaGrad)" />}
                {prevPath && <path d={prevPath} fill="none" stroke="#94a3b8" strokeWidth="2" strokeDasharray="4 4" strokeLinecap="round" />}
                {currPath && <path d={currPath} fill="none" stroke="#4f46e5" strokeWidth="2.5" strokeLinecap="round" />}
                {list.map((item, idx) => {
                  const x = getX(idx)
                  const yc = getY(item.delta)
                  const yp = getY(item.prevDelta)
                  const colW = chartW / Math.max(1, list.length - 1)
                  const isHovered = hoverIdx === idx
                  return (
                    <g key={item.month} onMouseEnter={() => setHoverIdx(idx)} className="cursor-pointer">
                      <rect x={x - colW / 2} y={padTop} width={colW} height={chartH + 20} fill="transparent" />
                      {isHovered && (
                        <line x1={x} y1={padTop} x2={x} y2={padTop + chartH} stroke="#818cf8" strokeWidth="1.5" strokeDasharray="3 3" />
                      )}
                      {yp !== null && <circle cx={x} cy={yp} r={isHovered ? 4.5 : 2.5} fill="#94a3b8" />}
                      {yc !== null && <circle cx={x} cy={yc} r={isHovered ? 6 : 3.5} fill={isHovered ? '#4338ca' : '#4f46e5'} stroke="#ffffff" strokeWidth="1.5" />}
                      <text
                        x={x}
                        y={padTop + chartH + 20}
                        textAnchor="middle"
                        className={`text-[10px] font-mono ${isHovered ? 'fill-indigo-600 dark:fill-indigo-400 font-bold' : 'fill-slate-500 dark:fill-slate-400'}`}
                      >
                        {fmtMonth(item.month)}
                      </text>
                    </g>
                  )
                })}
              </svg>
            </div>
          </div>
        )
      })()}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 3. Kuadran Pertumbuhan Antar ULP (khusus UP3) */}
        {ulpQuadrants.length > 0 && (
          <div className={`${CARD} p-5 space-y-3`}>
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Kuadran Pertumbuhan ULP (Porsi vs Laju YoY)
              </h3>
              <p className="text-xs text-slate-500">
                Pengelompokan ULP pendorong pertumbuhan dan ULP yang perlu perhatian; klik nama ULP untuk detail.
              </p>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2 px-3">Unit Layanan (ULP)</th>
                    <th className="py-2 px-3 text-right">Porsi</th>
                    <th className="py-2 px-3 text-right">YoY</th>
                    <th className="py-2 px-3">Kuadran</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {ulpQuadrants.map((u) => (
                    <tr key={u.unit_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-semibold">
                        <button
                          type="button"
                          onClick={() => onSelectUnit?.(u.unit_id)}
                          className="text-indigo-700 dark:text-indigo-300 hover:underline cursor-pointer text-left"
                        >
                          {u.unit_name}
                        </button>
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{fmtFloat(u.share, 1)}%</td>
                      <td className="py-2 px-3 text-right"><DeltaBadge pct={u.yoy_pct} /></td>
                      <td className="py-2 px-3">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${u.qCls}`}>{u.quadrant}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* 4. Pertumbuhan per Segmen / Golongan */}
        {segmentGrowth.length > 0 && (
          <div className={`${CARD} p-5 space-y-3`}>
            <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
              <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Pertumbuhan per {d.breakdown.dimension}
              </h3>
              <p className="text-xs text-slate-500">
                Sumbangan masing-masing segmen terhadap total pertumbuhan periode {fmtMonth(d.breakdown.period)}.
              </p>
            </div>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2 px-3">Kategori</th>
                    <th className="py-2 px-3 text-right">Δ Absolut</th>
                    <th className="py-2 px-3 text-right">YoY</th>
                    <th className="py-2 px-3 text-right">Sumbangan Tumbuh</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {segmentGrowth.map((sg) => (
                    <tr key={sg.key} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">{sg.key}</td>
                      <td className={`py-2 px-3 text-right font-mono ${sg.delta > 0 ? 'text-emerald-600' : sg.delta < 0 ? 'text-rose-600' : 'text-slate-500'}`}>
                        {sg.delta !== null ? `${sg.delta > 0 ? '+' : ''}${fmtFloat(sg.delta)}` : '-'}
                      </td>
                      <td className="py-2 px-3 text-right"><DeltaBadge pct={sg.yoy_pct} /></td>
                      <td className="py-2 px-3 text-right font-mono font-semibold">
                        {sg.contribToGrowth !== null ? `${fmtFloat(sg.contribToGrowth, 1)}%` : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
