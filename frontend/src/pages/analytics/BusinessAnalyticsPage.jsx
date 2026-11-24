import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { pengusahaanApi, triggerFileDownload } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import EisSyncDrawer from '../applications/EisSyncDrawer.jsx'
import { DemandForecast } from '../forecast/ForecastPage.jsx'
import { CustomerAnalysisContent } from '../customer-analysis/CustomerAnalysisPage.jsx'
import { OutageAnalysisContent, ForecastTab as OutageForecastTab } from '../outages/OutageAnalysisPage.jsx'
import { filterControlCls, filterSelectCls } from '../../components/filterStyles.js'
import {
  IconChart,
  IconRefresh,
  IconCalendar,
  IconBuilding,
  IconAlertCircle,
  IconCheckCircle,
  IconInfo,
  IconArrowUp,
  IconArrowDown,
  IconActivity,
  IconUsers,
  IconZap,
  IconClock,
  IconDownload,
  IconUpload,
} from '../../components/icons.jsx'

const CARD = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs'

const fmtInt = (v) => {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('id-ID')
}

const fmtFloat = (v, digits = 2) => {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

const fmtPct = (v) => {
  if (v === null || v === undefined) return '-'
  const sign = v > 0 ? '+' : ''
  return `${sign}${fmtFloat(v, 1)}%`
}

const fmtMonth = (m) => {
  if (!m) return '-'
  const [y, mon] = m.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  const idx = parseInt(mon, 10) - 1
  return `${months[idx] || mon} ${y?.slice(-2) || ''}`
}

/** Tampilan badge persentase perubahan dengan polaritas metrik */
function PolarityPctBadge({ pct, polarity = 'up', label = '' }) {
  if (pct === null || pct === undefined) {
    return <span className="text-slate-400 font-mono text-xs">-</span>
  }

  // polarity: 'up' (makin besar makin baik), 'down' (makin kecil makin baik)
  const isPositive = pct > 0
  const isZero = pct === 0
  const isGood = polarity === 'up' ? isPositive : !isPositive

  const badgeCls = isZero
    ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
    : isGood
    ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-800'

  return (
    <span
      className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-semibold tabular-nums ${badgeCls}`}
      title={`${label}: ${pct > 0 ? '+' : ''}${fmtFloat(pct, 2)}%`}
    >
      {!isZero && (
        isPositive ? <IconArrowUp size={12} className="shrink-0" /> : <IconArrowDown size={12} className="shrink-0" />
      )}
      <span>{fmtPct(pct)}</span>
      {label && <span className="text-[10px] opacity-75 font-normal">{label}</span>}
    </span>
  )
}

/** Komponen grafik tren SVG interaktif (values vs previous_year) */
function MetricTrendChart({
  months = [],
  series = [],
  activeSeriesKey,
  onSelectSeries,
  unitsExpected = 1,
  unitsReporting = [],
  polarity = 'up',
}) {
  const [hoverIndex, setHoverIndex] = useState(null)

  const activeSeries = useMemo(() => {
    return series.find((s) => s.key === activeSeriesKey) || series[0]
  }, [series, activeSeriesKey])

  const values = activeSeries?.values || []
  const previousYear = activeSeries?.previous_year || []

  // Hitung rentang nilai min & max
  const allNums = useMemo(() => {
    const list = []
    values.forEach((v) => v !== null && list.push(v))
    previousYear.forEach((v) => v !== null && list.push(v))
    return list
  }, [values, previousYear])

  const { minVal, maxVal } = useMemo(() => {
    if (allNums.length === 0) return { minVal: 0, maxVal: 100 }
    let mn = Math.min(...allNums)
    let mx = Math.max(...allNums)
    if (mn === mx) {
      mn = mn * 0.9
      mx = mx * 1.1 || 10
    } else {
      const padding = (mx - mn) * 0.1
      mn = Math.max(0, mn - padding)
      mx = mx + padding
    }
    return { minVal: mn, maxVal: mx }
  }, [allNums])

  const width = 800
  const height = 280
  const padLeft = 65
  const padRight = 30
  const padTop = 30
  const padBottom = 45

  const chartW = width - padLeft - padRight
  const chartH = height - padTop - padBottom

  const getX = (idx) => {
    if (months.length <= 1) return padLeft + chartW / 2
    return padLeft + (idx / (months.length - 1)) * chartW
  }

  const getY = (val) => {
    if (val === null || val === undefined) return null
    const norm = (val - minVal) / (maxVal - minVal || 1)
    return padTop + chartH - norm * chartH
  }

  // Buat path garis
  const buildPath = (data) => {
    let d = ''
    let started = false
    data.forEach((val, idx) => {
      const y = getY(val)
      if (y === null) {
        started = false
        return
      }
      const x = getX(idx)
      if (!started) {
        d += `M ${x.toFixed(1)} ${y.toFixed(1)}`
        started = true
      } else {
        d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`
      }
    })
    return d
  }

  // Buat path area untuk values
  const buildAreaPath = (data) => {
    let d = ''
    let firstX = null
    let lastX = null
    const baseY = padTop + chartH

    data.forEach((val, idx) => {
      const y = getY(val)
      if (y === null) return
      const x = getX(idx)
      if (firstX === null) {
        firstX = x
        d += `M ${x.toFixed(1)} ${baseY} L ${x.toFixed(1)} ${y.toFixed(1)}`
      } else {
        d += ` L ${x.toFixed(1)} ${y.toFixed(1)}`
      }
      lastX = x
    })

    if (firstX !== null && lastX !== null) {
      d += ` L ${lastX.toFixed(1)} ${baseY} Z`
    }
    return d
  }

  const currentPath = useMemo(() => buildPath(values), [values, minVal, maxVal])
  const prevPath = useMemo(() => buildPath(previousYear), [previousYear, minVal, maxVal])
  const currentArea = useMemo(() => buildAreaPath(values), [values, minVal, maxVal])

  // Sumbu Y ticks
  const yTicks = useMemo(() => {
    const ticks = []
    const count = 5
    for (let i = 0; i <= count; i++) {
      const val = minVal + (i / count) * (maxVal - minVal)
      const y = padTop + chartH - (i / count) * chartH
      ticks.push({ val, y })
    }
    return ticks
  }, [minVal, maxVal])

  return (
    <div className="space-y-3">
      {/* Series Selector Buttons (bila lebih dari 1 seri) */}
      {series.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <span className="text-xs font-semibold text-slate-500">Pilih Seri:</span>
          {series.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => onSelectSeries?.(s.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                activeSeries?.key === s.key
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              {s.name} ({s.unit})
            </button>
          ))}
        </div>
      )}

      {/* Legend & Summary Info */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-1 rounded-full bg-indigo-600" />
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              Tahun Berjalan ({activeSeries?.unit})
            </span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-1 rounded-full border-b border-dashed border-slate-400 bg-slate-300 dark:bg-slate-600" />
            <span className="text-slate-500 dark:text-slate-400">
              Bulan Sama Tahun Lalu
            </span>
          </div>
        </div>

        {hoverIndex !== null && (
          <div className="text-xs font-mono bg-slate-50 dark:bg-slate-800 px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-700">
            <span className="font-bold text-slate-800 dark:text-slate-200">{months[hoverIndex]}:</span>{' '}
            <span className="text-indigo-600 font-bold">
              {values[hoverIndex] !== null ? fmtFloat(values[hoverIndex]) : '-'} {activeSeries?.unit}
            </span>
            {previousYear[hoverIndex] !== null && (
              <span className="text-slate-500 ml-2">
                (Thn lalu: {fmtFloat(previousYear[hoverIndex])})
              </span>
            )}
            {unitsExpected > 1 && unitsReporting[hoverIndex] !== undefined && (
              <span className={`ml-2 text-[11px] ${unitsReporting[hoverIndex] < unitsExpected ? 'text-amber-600 font-bold' : 'text-slate-400'}`}>
                [{unitsReporting[hoverIndex]}/{unitsExpected} ULP]
              </span>
            )}
          </div>
        )}
      </div>

      {/* SVG Chart Container */}
      <div className="relative w-full overflow-x-auto">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto max-h-[340px] select-none"
          style={{ minWidth: '600px' }}
        >
          <defs>
            <linearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.25" />
              <stop offset="100%" stopColor="#4f46e5" stopOpacity="0.0" />
            </linearGradient>
          </defs>

          {/* Grid lines horizontal */}
          {yTicks.map((t, idx) => (
            <g key={idx}>
              <line
                x1={padLeft}
                y1={t.y}
                x2={width - padRight}
                y2={t.y}
                stroke="#e2e8f0"
                strokeDasharray={idx === 0 ? 'none' : '3 3'}
                className="dark:stroke-slate-800"
              />
              <text
                x={padLeft - 8}
                y={t.y + 3.5}
                textAnchor="end"
                className="text-[10px] fill-slate-400 font-mono"
              >
                {fmtFloat(t.val, maxVal >= 1000 ? 0 : 1)}
              </text>
            </g>
          ))}

          {/* Area fill tahun berjalan */}
          {currentArea && <path d={currentArea} fill="url(#areaGradient)" />}

          {/* Garis Tahun Lalu (Dashed) */}
          {prevPath && (
            <path
              d={prevPath}
              fill="none"
              stroke="#94a3b8"
              strokeWidth="2"
              strokeDasharray="4 4"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Garis Tahun Berjalan (Solid) */}
          {currentPath && (
            <path
              d={currentPath}
              fill="none"
              stroke="#4f46e5"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          )}

          {/* Sumbu X labels & markers */}
          {months.map((m, idx) => {
            const x = getX(idx)
            const isHovered = hoverIndex === idx
            const yCurrent = getY(values[idx])
            const yPrev = getY(previousYear[idx])
            const isIncomplete = unitsExpected > 1 && (unitsReporting[idx] || 0) < unitsExpected

            return (
              <g
                key={m}
                onMouseEnter={() => setHoverIndex(idx)}
                onMouseLeave={() => setHoverIndex(null)}
                className="cursor-pointer"
              >
                {/* Hit area vertical */}
                <rect
                  x={x - (chartW / (months.length || 1)) / 2}
                  y={padTop}
                  width={chartW / (months.length || 1)}
                  height={chartH}
                  fill="transparent"
                />

                {/* Hover line */}
                {isHovered && (
                  <line
                    x1={x}
                    y1={padTop}
                    x2={x}
                    y2={padTop + chartH}
                    stroke="#818cf8"
                    strokeWidth="1.5"
                    strokeDasharray="2 2"
                  />
                )}

                {/* Titik Tahun Lalu */}
                {yPrev !== null && (
                  <circle
                    cx={x}
                    cy={yPrev}
                    r={isHovered ? 4 : 2.5}
                    fill="#94a3b8"
                  />
                )}

                {/* Titik Tahun Berjalan */}
                {yCurrent !== null && (
                  <circle
                    cx={x}
                    cy={yCurrent}
                    r={isHovered ? 5.5 : 3.5}
                    fill={isHovered ? '#4338ca' : '#4f46e5'}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                )}

                {/* Indikator data belum utuh */}
                {isIncomplete && (
                  <circle
                    cx={x}
                    cy={padTop + chartH + 18}
                    r={3}
                    fill="#f59e0b"
                  />
                )}

                {/* Label Bulan (tampilkan setiap 1 atau 2 bulan agar tidak tumpang tindih) */}
                {(months.length <= 16 || idx % 2 === 0 || isHovered) && (
                  <text
                    x={x}
                    y={padTop + chartH + (isIncomplete ? 32 : 20)}
                    textAnchor="middle"
                    className={`text-[10px] font-mono ${
                      isHovered
                        ? 'fill-indigo-600 dark:fill-indigo-400 font-bold'
                        : 'fill-slate-500 dark:fill-slate-400'
                    }`}
                  >
                    {fmtMonth(m)}
                  </text>
                )}
              </g>
            )
          })}
        </svg>
      </div>
    </div>
  )
}

/** Komponen Data Penjelas Operasional (Companions) */
function CompanionSection({ companions, toMonth }) {
  if (!companions || !companions.series || companions.series.length === 0) return null

  return (
    <div className={`${CARD} p-5 space-y-4`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Data Penjelas Operasional
            </h3>
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800">
              {companions.source || 'Operasional DISTRIVA'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            Data operasional lapangan sebagai pembanding dan penjelas pergerakan angka resmi laporan PLN.
          </p>
        </div>
        {toMonth && (
          <span className="text-[11px] font-mono text-slate-500 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 rounded-md self-start sm:self-auto">
            Posisi s/d {fmtMonth(toMonth)}
          </span>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {companions.series.map((s) => (
          <div
            key={s.key}
            className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col justify-between"
          >
            <div>
              <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                {s.name}
              </span>
              <div className="mt-2 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
                {s.latest !== null && s.latest !== undefined ? fmtFloat(s.latest) : '-'}{' '}
                <span className="text-xs font-normal text-slate-500">{s.unit}</span>
              </div>
            </div>

            <div className="mt-3 pt-2.5 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs text-slate-500">
              <span className="text-[11px] text-slate-400">Kumulatif YTD</span>
              <span className="font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                {s.ytd !== null && s.ytd !== undefined ? fmtFloat(s.ytd) : '-'}{' '}
                <span className="text-[10px] font-normal text-slate-400">{s.unit}</span>
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Komponen Rekonsiliasi Angka Resmi vs Data Operasional */
function ReconciliationSection({ reconciliations, unitsExpected = 1 }) {
  const list = reconciliations || []
  if (list.length === 0) return null

  return (
    <div className="space-y-4">
      {list.map((rec) => {
        const isNet = rec.mode === 'net'
        const isYoy = rec.mode === 'yoy'
        const ytd = rec.ytd
        const monthly = rec.monthly || []

        // Judul & Badge mode
        const modeBadge = isNet ? (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            Mode Saldo Bersih (Net)
          </span>
        ) : isYoy ? (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
            Mode Kenaikan Tahunan (YoY)
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
            Mode Arus Bulanan (Flow)
          </span>
        )

        return (
          <div key={rec.key} className={`${CARD} p-5 space-y-4`}>
            {/* Header Rekonsiliasi */}
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Rekonsiliasi: {rec.official_name} vs {rec.companion_name}
                  </h3>
                  {modeBadge}
                  {isYoy && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-300 dark:border-amber-800">
                      Perkiraan (Bukan Resmi)
                    </span>
                  )}
                </div>
                <p className="text-xs text-slate-500 mt-0.5">
                  Perbandingan angka resmi dengan data penjelas operasional per bulan dan akumulasi tahun berjalan (YTD).
                </p>
              </div>

              {ytd && (
                <div className="flex items-center gap-2 self-start sm:self-auto text-xs bg-slate-50 dark:bg-slate-800 px-3 py-1.5 rounded-lg border border-slate-200/80 dark:border-slate-700">
                  <span className="text-slate-500">Cakupan Rekonsiliasi YTD:</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {ytd.units_compared} / {ytd.units_expected || unitsExpected} ULP
                  </span>
                </div>
              )}
            </div>

            {/* Note Penjelasan Rekonsiliasi dari Backend */}
            {rec.note && (
              <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/70 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2">
                <IconInfo size={16} className="mt-0.5 shrink-0 text-slate-500" />
                <span className="leading-relaxed">{rec.note}</span>
              </div>
            )}

            {/* Kartu Ringkasan YTD Rekonsiliasi */}
            {ytd && (
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 p-3.5 rounded-xl bg-slate-50/70 dark:bg-slate-800/40 border border-slate-200/60 dark:border-slate-700/60">
                <div>
                  <span className="text-[11px] font-medium text-slate-500 block">
                    {isYoy ? 'Kenaikan Resmi YoY (YTD)' : isNet ? 'Tambahan Bersih Resmi (YTD)' : 'Nilai Resmi YTD'}
                  </span>
                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                    {ytd.official_net !== null ? fmtFloat(ytd.official_net) : '-'}{' '}
                    <span className="text-xs font-normal text-slate-500">{rec.unit}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {ytd.base_month ? `${fmtMonth(ytd.base_month)} s/d ${fmtMonth(ytd.to_month)}` : ytd.year}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] font-medium text-slate-500 block">
                    {isYoy ? 'Perkiraan Sumbangan PB (YTD)' : 'Data Pendamping YTD'}
                  </span>
                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                    {ytd.companion !== null ? fmtFloat(ytd.companion) : '-'}{' '}
                    <span className="text-xs font-normal text-slate-500">{rec.unit}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    Dari {ytd.units_compared} ULP setara
                  </span>
                </div>

                <div>
                  <span className="text-[11px] font-medium text-slate-500 block">
                    Selisih (Pendamping &minus; Resmi)
                  </span>
                  <div className={`text-lg font-bold tabular-nums mt-0.5 ${
                    ytd.difference > 0 ? 'text-indigo-600 dark:text-indigo-400' : ytd.difference < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700'
                  }`}>
                    {ytd.difference !== null ? `${ytd.difference > 0 ? '+' : ''}${fmtFloat(ytd.difference)}` : '-'}{' '}
                    <span className="text-xs font-normal text-slate-500">{rec.unit}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    Evaluasi kumulatif tahun berjalan
                  </span>
                </div>
              </div>
            )}

            {/* Tabel Rincian Rekonsiliasi Bulanan */}
            {monthly.length > 0 && (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Bulan</th>
                      <th className="py-2.5 px-3 text-right">
                        {isYoy ? 'Kenaikan Resmi YoY' : isNet ? 'Tambahan Bersih (Resmi)' : rec.official_name}
                      </th>
                      <th className="py-2.5 px-3 text-right">
                        {isYoy ? 'Perkiraan PB' : rec.companion_name}
                      </th>
                      <th className="py-2.5 px-3 text-right">Selisih</th>
                      <th className="py-2.5 px-3 text-center">Unit Terbanding</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono tabular-nums">
                    {monthly.map((m) => {
                      const diff = m.difference
                      const diffCls = diff > 0
                        ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                        : diff < 0
                        ? 'text-amber-600 dark:text-amber-400 font-semibold'
                        : 'text-slate-500'

                      return (
                        <tr key={m.month} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <td className="py-2 px-3 font-sans font-medium text-slate-800 dark:text-slate-200">
                            {fmtMonth(m.month)}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300">
                            {m.official_net !== null ? fmtFloat(m.official_net) : '-'}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300">
                            {m.companion !== null ? fmtFloat(m.companion) : '-'}
                          </td>
                          <td className={`py-2 px-3 text-right ${diffCls}`}>
                            {diff !== null ? `${diff > 0 ? '+' : ''}${fmtFloat(diff)}` : '-'}
                          </td>
                          <td className="py-2 px-3 text-center text-slate-400 text-[11px]">
                            {m.units_compared}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

export default function BusinessAnalyticsPage() {
  const { metricCode } = useParams()
  const navigate = useNavigate()
  const { can } = useAccess()
  const { notify } = useNotifications()

  const canInput = Boolean(can?.['pengusahaan.input'])

  // State mode tampilan untuk Susut ('trend' | 'inputs')
  const [susutViewMode, setSusutViewMode] = useState('trend')
  // State sub-tab untuk metrik pelanggan & daya ('trend' | 'forecast')
  const [customerTab, setCustomerTab] = useState('trend')
  // State sub-tab untuk metrik gangguan & keandalan ('eis' | 'trend' | 'feeders' | 'forecast')
  const [outageTab, setOutageTab] = useState('eis')
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false)

  // State katalog metrik & unit
  const [catalogState, setCatalogState] = useState({ loading: true, error: '', data: null })

  // State filter & metrik aktif
  const [activeCode, setActiveCode] = useState(metricCode || 'pelanggan')
  const [up3Id, setUp3Id] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState('')
  const [fromMonth, setFromMonth] = useState('')
  const [toMonth, setToMonth] = useState('')

  // Efektif unit_id: jika ada selectedUnitId (ULP) pakai itu, jika tidak gunakan up3Id
  const effectiveUnitId = selectedUnitId || up3Id

  // State data analisis metrik terpilih
  const [metricState, setMetricState] = useState({ loading: false, error: '', data: null })
  const [activeSeriesKey, setActiveSeriesKey] = useState('')

  // State form masukan kWh beli (untuk metrik susut)
  const [inputsYear, setInputsYear] = useState(new Date().getFullYear())
  const [inputsUlpId, setInputsUlpId] = useState('')
  const [inputsState, setInputsState] = useState({ loading: false, saving: false, error: '', data: null })
  const [inputsDraft, setInputsDraft] = useState({})
  const [downloadingTemplate, setDownloadingTemplate] = useState(false)
  const [importingFile, setImportingFile] = useState(false)
  const [importError, setImportError] = useState('')

  // 1. Muat katalog metrik dan daftar unit
  const loadCatalog = useCallback(async () => {
    setCatalogState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await pengusahaanApi.metrics()
      const data = res?.data || {}
      setCatalogState({ loading: false, error: '', data })

      // Set default unit bila belum terpilih
      if (data.units?.length > 0 && !selectedUnitId && !up3Id) {
        // Cari UP3 terlebih dahulu, bila tidak ada pilih unit pertama
        const defaultUnit = data.units.find((u) => u.unit_type === 'UP3') || data.units[0]
        if (defaultUnit.unit_type === 'UP3') {
          setUp3Id(defaultUnit.id)
        } else {
          setSelectedUnitId(defaultUnit.id)
        }
      }
    } catch (err) {
      setCatalogState({
        loading: false,
        error: err?.message || 'Gagal memuat katalog metrik pengusahaan.',
        data: null,
      })
    }
  }, [selectedUnitId, up3Id])

  useEffect(() => {
    loadCatalog()
  }, [loadCatalog])

  // Sinkronkan activeCode dengan URL param
  useEffect(() => {
    if (metricCode) {
      setActiveCode(metricCode)
      setOutageTab('eis')
    }
  }, [metricCode])

  // 2. Muat data metrik yang sedang aktif
  const loadMetricData = useCallback(async () => {
    const targetUnit = effectiveUnitId
    if (!targetUnit || !activeCode) return
    setMetricState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const params = {
        unit_id: targetUnit,
      }
      if (fromMonth) params.from = fromMonth
      if (toMonth) params.to = toMonth

      const res = await pengusahaanApi.metric(activeCode, params)
      const data = res?.data || null
      setMetricState({ loading: false, error: '', data })

      // Set initial active series
      if (data?.series?.length > 0) {
        setActiveSeriesKey(data.series[0].key)
      }
      // Update from & to di filter bila belum diset
      if (data?.from && !fromMonth) setFromMonth(data.from)
      if (data?.to && !toMonth) setToMonth(data.to)
    } catch (err) {
      setMetricState({
        loading: false,
        error: err?.message || 'Gagal memuat tren metrik pengusahaan.',
        data: null,
      })
    }
  }, [effectiveUnitId, activeCode, fromMonth, toMonth])

  useEffect(() => {
    if (effectiveUnitId && activeCode) {
      loadMetricData()
    }
  }, [effectiveUnitId, activeCode, loadMetricData])

  const handleSelectMetric = (code, available = true) => {
    if (!available) return
    setActiveCode(code)
    navigate(`/pengusahaan/${code}`)
  }

  const d = metricState.data
  const metricsList = catalogState.data?.metrics || []
  const unitsList = catalogState.data?.units || []
  const ulpUnitsList = useMemo(() => {
    return unitsList.filter((u) => u.unit_type === 'ULP')
  }, [unitsList])

  // Inisialisasi inputsUlpId bila belum diset
  useEffect(() => {
    if (!inputsUlpId && ulpUnitsList.length > 0) {
      // Jika unit terpilih adalah ULP, pakai unit tersebut
      const currentIsUlp = ulpUnitsList.some((u) => u.id === selectedUnitId)
      if (currentIsUlp) {
        setInputsUlpId(selectedUnitId)
      } else {
        setInputsUlpId(ulpUnitsList[0].id)
      }
    }
  }, [inputsUlpId, ulpUnitsList, selectedUnitId])

  // Muat data masukan kWh beli
  const loadInputsData = useCallback(async (targetUlpId, targetYear) => {
    const ulpId = targetUlpId || inputsUlpId || (ulpUnitsList.length > 0 ? ulpUnitsList[0].id : '')
    const yr = targetYear || inputsYear
    if (!ulpId || !yr) return

    setInputsState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await pengusahaanApi.inputs({ unit_id: ulpId, year: yr })
      const data = res?.data || null
      setInputsState({ loading: false, saving: false, error: '', data })

      // Bangun initial draft dari data bulan
      const draft = {}
      data?.months?.forEach((m) => {
        draft[m.period] = {
          'kwh-beli': m.inputs?.['kwh-beli']?.value !== undefined && m.inputs?.['kwh-beli']?.value !== null ? Number(m.inputs['kwh-beli'].value) : '',
          'e-min': m.inputs?.['e-min']?.value !== undefined && m.inputs?.['e-min']?.value !== null ? Number(m.inputs['e-min'].value) : '',
          'pssd': m.inputs?.['pssd']?.value !== undefined && m.inputs?.['pssd']?.value !== null ? Number(m.inputs['pssd'].value) : '',
          'note': m.inputs?.['kwh-beli']?.note || m.inputs?.['e-min']?.note || m.inputs?.['pssd']?.note || '',
        }
      })
      setInputsDraft(draft)
    } catch (err) {
      setInputsState({
        loading: false,
        saving: false,
        error: err?.message || 'Gagal memuat masukan bulanan susut.',
        data: null,
      })
    }
  }, [inputsUlpId, inputsYear, ulpUnitsList])

  // Muat data inputs ketika beralih ke mode inputs pada metrik susut
  useEffect(() => {
    const effectiveUlpId = inputsUlpId || (ulpUnitsList.length > 0 ? ulpUnitsList[0].id : '')
    if (activeCode === 'susut' && susutViewMode === 'inputs' && effectiveUlpId && inputsYear) {
      loadInputsData(effectiveUlpId, inputsYear)
    }
  }, [activeCode, susutViewMode, inputsUlpId, ulpUnitsList, inputsYear, loadInputsData])

  const handleInputChange = (period, field, val) => {
    setInputsDraft((prev) => ({
      ...prev,
      [period]: {
        ...(prev[period] || { 'kwh-beli': '', 'e-min': '', 'pssd': '', 'note': '' }),
        [field]: val,
      },
    }))
  }

  const handleSaveInputs = async () => {
    if (!inputsUlpId) return
    setInputsState((s) => ({ ...s, saving: true, error: '' }))
    try {
      const items = []
      const currentMonths = inputsState.data?.months || []

      currentMonths.forEach((m) => {
        const dItem = inputsDraft[m.period] || {}
        const codes = ['kwh-beli', 'e-min', 'pssd']
        codes.forEach((code) => {
          const rawVal = dItem[code]
          const origVal = m.inputs?.[code]?.value
          const parsedVal = rawVal !== undefined && rawVal !== '' && rawVal !== null ? Number(rawVal) : null

          // Masukkan item ke daftar simpan
          items.push({
            period: m.period,
            code,
            value: parsedVal,
            note: dItem.note || null,
          })
        })
      })

      const res = await pengusahaanApi.saveInputs({
        unit_id: inputsUlpId,
        items,
      })

      const msg = res?.message || (res?.changed ? `${res.changed} masukan berhasil disimpan.` : 'Masukan berhasil disimpan.')
      notify?.({ message: msg, type: 'success' })

      // Segarkan data masukan dan data tren
      await loadInputsData(inputsUlpId, inputsYear)
      if (selectedUnitId) {
        loadMetricData()
      }
    } catch (err) {
      const errMsg = err?.message || 'Gagal menyimpan masukan bulanan.'
      setInputsState((s) => ({ ...s, saving: false, error: errMsg }))
      notify?.({ message: errMsg, type: 'error' })
    }
  }

  const handleDownloadTemplate = async () => {
    setDownloadingTemplate(true)
    try {
      const blob = await pengusahaanApi.template({
        year: inputsYear,
        unit_id: inputsUlpId || selectedUnitId || undefined,
      })
      triggerFileDownload(blob, `KWH-BELI-${inputsYear}.xlsx`)
      notify?.({ message: `Templat KWH-BELI-${inputsYear}.xlsx berhasil diunduh.`, type: 'success' })
    } catch (err) {
      notify?.({ message: err?.message || 'Gagal mengunduh templat Excel.', type: 'error' })
    } finally {
      setDownloadingTemplate(false)
    }
  }

  const handleImportExcel = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setImportError('')
    setImportingFile(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const res = await pengusahaanApi.importInputs(formData)
      const successMsg = res?.message || 'Berkas Excel berhasil diimpor.'
      notify?.({ message: successMsg, type: 'success' })
      await loadInputsData(inputsUlpId, inputsYear)
      if (selectedUnitId) {
        loadMetricData()
      }
    } catch (err) {
      const errMsg = err?.message || 'Gagal mengimpor berkas Excel.'
      setImportError(errMsg)
      notify?.({ message: errMsg, type: 'error' })
    } finally {
      setImportingFile(false)
      e.target.value = ''
    }
  }

  // Hitung apakah angka UP3 pada bulan terakhir belum utuh
  const latestMonthIdx = d?.months?.length ? d.months.length - 1 : -1
  const isUp3 = d?.unit?.unit_type === 'UP3'
  const unitsExpected = d?.units_expected || 1
  const unitsReportingLatest = latestMonthIdx >= 0 ? d?.units_reporting?.[latestMonthIdx] ?? 1 : 1
  const isLatestIncomplete = isUp3 && unitsReportingLatest < unitsExpected

  return (
    <div className="space-y-6 w-full">
      {/* Hero Header Card Standar DISTRIVA (Selaras dengan Analisis Pelanggan & Daya) */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs shrink-0">
              <IconChart size={26} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {metricCode === 'pelanggan' ? 'Analisa & Tren Pelanggan' : 'Analisa & Tren Pengusahaan'}
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  Laporan &amp; Monitoring
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  {metricCode === 'pelanggan' ? 'Laporan 309 & Permohonan EIS' : 'Realisasi EIS'}
                </span>
                {metricCode !== 'pelanggan' && d?.metric?.name && (
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                    {d.metric.name}
                  </span>
                )}
              </div>
              <p className="mt-1 max-w-3xl text-xs sm:text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                {metricCode === 'pelanggan'
                  ? 'Realisasi jumlah pelanggan dari Laporan 309 dan penambahan pelanggan baru (PB) serta perubahan daya (PD) dari Permohonan EIS per bulan dan tahun, komposisi tarif, perbandingan antar ULP, pola musiman, serta prakiraan 12 bulan ke depan.'
                  : 'Analisis tren bulanan, posisi kumulatif YTD, evaluasi Year-over-Year (YoY), dan perbandingan kinerja antar ULP berbasis laporan resmi PLN dan rekonsiliasi data operasional.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start md:self-auto shrink-0 flex-wrap">
            <Button
              variant="secondary"
              onClick={() => {
                loadCatalog()
                loadMetricData()
              }}
              loading={metricState.loading}
              icon={IconRefresh}
              aria-label="Segarkan"
            >
              Segarkan
            </Button>
            <Button
              variant="primary"
              onClick={() => setSyncDrawerOpen(true)}
              icon={IconRefresh}
              aria-label="Sinkronisasi Data"
            >
              Sinkronisasi Data
            </Button>
          </div>
        </div>
      </div>

      {/* Tab Switcher Khusus Metrik Pelanggan & Daya (Tren & Analisis vs Rincian vs Prakiraan) */}
      {(activeCode === 'pelanggan' || activeCode === 'daya') && (
        <div className="flex items-center gap-6 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setCustomerTab('trend')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              customerTab === 'trend'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Tren &amp; Analisis
          </button>
          {activeCode === 'pelanggan' && (
            <button
              type="button"
              onClick={() => setCustomerTab('details')}
              className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                customerTab === 'details'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Rincian Permohonan (EIS)
            </button>
          )}
          <button
            type="button"
            onClick={() => setCustomerTab('forecast')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              customerTab === 'forecast'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {activeCode === 'daya' ? 'Prakiraan Daya Tersambung' : 'Prakiraan Pelanggan'}
          </button>
        </div>
      )}

      {/* Tab Switcher Khusus Metrik Keandalan & Gangguan (Realisasi Laporan EIS vs Rincian APKT / Penyulang / Prakiraan) */}
      {(activeCode === 'gangguan' || activeCode === 'saidi-saifi' || activeCode === 'ens') && (
        <div className="flex items-center gap-6 border-b border-slate-200 dark:border-slate-800">
          <button
            type="button"
            onClick={() => setOutageTab('eis')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              outageTab === 'eis'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Tren &amp; Analisis (Laporan DIFI/EIS)
          </button>
          <button
            type="button"
            onClick={() => setOutageTab('trend')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              outageTab === 'trend'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {activeCode === 'saidi-saifi'
              ? 'Rincian SAIDI & SAIFI (APKT)'
              : activeCode === 'ens'
              ? 'Rincian ENS (APKT)'
              : 'Rincian Gangguan (APKT)'}
          </button>
          <button
            type="button"
            onClick={() => setOutageTab('feeders')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              outageTab === 'feeders'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Penyulang &amp; Gardu
          </button>
          <button
            type="button"
            onClick={() => setOutageTab('forecast')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              outageTab === 'forecast'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Prakiraan Keandalan
          </button>
        </div>
      )}

      {/* Tab Switcher Khusus Metrik Susut (Tren & Analisis vs Masukan kWh Beli) */}
      {activeCode === 'susut' && (
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-1">
          <button
            type="button"
            onClick={() => setSusutViewMode('trend')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition cursor-pointer ${
              susutViewMode === 'trend'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Tren & Analisis Susut
          </button>
          <button
            type="button"
            onClick={() => setSusutViewMode('inputs')}
            className={`px-4 py-2 text-xs font-semibold rounded-t-xl transition cursor-pointer flex items-center gap-1.5 ${
              susutViewMode === 'inputs'
                ? 'bg-indigo-600 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            <span>Masukan kWh Beli</span>
            {canInput && (
              <span className="px-1.5 py-0.2 rounded bg-indigo-500/30 text-[10px] uppercase font-bold text-indigo-100">
                Input
              </span>
            )}
          </button>
        </div>
      )}

      {/* Tampilan Khusus Analitika Gangguan APKT saat sub-tab APKT/penyulang/prakiraan aktif */}
      {(activeCode === 'gangguan' || activeCode === 'saidi-saifi' || activeCode === 'ens') && outageTab === 'forecast' ? (
        <div className="pt-2">
          <OutageForecastTab
            params={{
              up3_id: up3Id || undefined,
              unit_id: selectedUnitId || undefined,
            }}
          />
        </div>
      ) : (activeCode === 'gangguan' || activeCode === 'saidi-saifi' || activeCode === 'ens') && outageTab !== 'eis' ? (
        <div className="pt-2">
          <OutageAnalysisContent
            hideHeader={true}
            hideTabs={true}
            defaultTab={outageTab}
            forcedMetric={activeCode}
          />
        </div>
      ) : (activeCode === 'pelanggan' || activeCode === 'daya') && customerTab === 'forecast' ? (
        <div className="pt-2">
          <DemandForecast
            key={activeCode}
            kinds={activeCode === 'daya' ? ['VA_ADDED'] : ['CUSTOMERS_ADDED']}
            onSelectMaterial={() => {}}
          />
        </div>
      ) : activeCode === 'pelanggan' && customerTab === 'details' ? (
        <div className="pt-2">
          <CustomerAnalysisContent
            hideHeader={true}
            hideTabs={true}
            forcedTab="trend"
            permission="pengusahaan.view"
          />
        </div>
      ) : (
      <>
      {/* Filter Bar (HierarchicalUnitFilter, Dari bulan, Sampai bulan) - Tampilan Seragam Persis Referensi */}
      {!(activeCode === 'susut' && susutViewMode === 'inputs') && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs flex flex-wrap items-center gap-3">
          <HierarchicalUnitFilter
            permission="pengusahaan.view"
            up3Id={up3Id}
            onUp3Change={(v) => setUp3Id(v)}
            unitId={selectedUnitId}
            onUnitChange={(v) => setSelectedUnitId(v)}
            up3AriaLabel="Pilih Unit UP3"
            unitAriaLabel="Pilih Unit ULP"
          />

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              Dari bulan
            </label>
            <input
              type="month"
              aria-label="Dari bulan"
              value={fromMonth}
              onChange={(e) => setFromMonth(e.target.value)}
              className="h-9 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-1 focus:ring-blue-500 shadow-2xs"
            />
          </div>

          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
              Sampai bulan
            </label>
            <input
              type="month"
              aria-label="Sampai bulan"
              value={toMonth}
              onChange={(e) => setToMonth(e.target.value)}
              className="h-9 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-1 focus:ring-blue-500 shadow-2xs"
            />
          </div>

          {(fromMonth || toMonth) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFromMonth('')
                setToMonth('')
              }}
            >
              Semua periode
            </Button>
          )}

          <div className="ml-auto">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={loadMetricData}
              loading={metricState.loading}
              icon={IconRefresh}
            >
              Terapkan
            </Button>
          </div>
        </div>
      )}

      {/* Tampilan Tab 2: Masukan kWh Beli (Hanya saat activeCode === 'susut' && susutViewMode === 'inputs') */}
      {activeCode === 'susut' && susutViewMode === 'inputs' ? (
        <div className="space-y-6">
          {/* Filter Bar Khusus Masukan Susut: ULP dan Tahun */}
          <div className={`${CARD} p-4`}>
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Unit Layanan (ULP):</span>
                  <select
                    value={inputsUlpId}
                    onChange={(e) => {
                      const nextId = e.target.value
                      setInputsUlpId(nextId)
                      loadInputsData(nextId, inputsYear)
                    }}
                    aria-label="Pilih ULP Masukan Susut"
                    className={filterSelectCls}
                  >
                    {ulpUnitsList.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">Tahun:</span>
                  <input
                    type="number"
                    min={2000}
                    max={2100}
                    value={inputsYear}
                    onChange={(e) => setInputsYear(Number(e.target.value))}
                    aria-label="Tahun Masukan Susut"
                    className={`${filterControlCls} w-24`}
                  />
                </label>

                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => loadInputsData(inputsUlpId, inputsYear)}
                  loading={inputsState.loading}
                >
                  Muat Ulang
                </Button>
              </div>

              {/* Aksi Tambahan: Unduh Templat, Impor Excel, dan Simpan */}
              {inputsState.data?.can_edit && (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    icon={IconDownload}
                    loading={downloadingTemplate}
                    onClick={handleDownloadTemplate}
                    title="Unduh templat Excel (XLSX) untuk tahun dan unit terpilih"
                  >
                    Unduh Templat
                  </Button>

                  <label className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer shadow-2xs transition">
                    <IconUpload size={14} className="shrink-0 text-slate-500" />
                    <span>{importingFile ? 'Mengimpor...' : 'Impor Excel'}</span>
                    <input
                      type="file"
                      accept=".xlsx,.xls"
                      disabled={importingFile}
                      onChange={handleImportExcel}
                      className="hidden"
                      aria-label="Unggah Berkas Excel kWh Beli"
                    />
                  </label>

                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    loading={inputsState.saving}
                    onClick={handleSaveInputs}
                  >
                    Simpan Masukan Bulanan
                  </Button>
                </div>
              )}
            </div>
          </div>

          {/* Alert Galat Impor Excel bila ada baris yang salah (422) */}
          {importError && (
            <div className="p-4 bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-800 dark:text-rose-300 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5">
                <IconAlertCircle size={18} className="mt-0.5 shrink-0 text-rose-600 dark:text-rose-400" />
                <div className="space-y-1">
                  <span className="font-bold">Gagal Mengimpor Berkas Excel:</span>
                  <p className="whitespace-pre-line text-rose-700 dark:text-rose-300 font-mono text-[11px]">
                    {importError}
                  </p>
                  <p className="text-[10px] text-rose-600 dark:text-rose-400 italic">
                    Perhatian: Seluruh berkas ditolak dan tidak ada baris yang tersimpan bila terdapat kesalahan baris.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setImportError('')}
                className="text-rose-500 hover:text-rose-700 p-1"
                aria-label="Tutup pesan kesalahan impor"
              >
                &times;
              </button>
            </div>
          )}

          {/* Area Tabel 12 Bulan Masukan Susut */}
          {inputsState.loading ? (
            <div className={`${CARD} py-24 flex justify-center`}>
              <Spinner size="lg" label="Memuat masukan bulanan susut..." />
            </div>
          ) : inputsState.error ? (
            <Alert kind="error">{inputsState.error}</Alert>
          ) : !inputsState.data ? (
            <EmptyState
              title="Belum Ada Data Masukan"
              desc="Silakan pilih ULP dan tahun masukan kWh beli."
            />
          ) : (
            <div className={`${CARD} p-5 space-y-4`}>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    Masukan Bulanan kWh Beli &mdash; {inputsState.data.unit?.name} ({inputsState.data.year})
                  </h3>
                  <p className="text-xs text-slate-500">
                    Nilai diisi <strong>bulanan</strong> (bukan kumulatif). Susut bulanan dan kumulatif dihitung otomatis bersama laporan penjualan (309).
                    Isian biasa hanya kWh beli dan PSSD, E-Min boleh kosong. Sel kosong pada templat Excel tidak menghapus nilai tersimpan.
                  </p>
                </div>
                {!inputsState.data.can_edit && (
                  <span className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2 py-1 rounded-md border border-amber-200 dark:border-amber-900/50">
                    Hanya baca (memerlukan izin <code>pengusahaan.input</code> untuk mengedit)
                  </span>
                )}
              </div>

              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3 w-24">Bulan</th>
                      <th className="py-2.5 px-3 min-w-[130px]">kWh Beli (Wajib)</th>
                      <th className="py-2.5 px-3 min-w-[110px]">E-Min (kWh)</th>
                      <th className="py-2.5 px-3 min-w-[110px]">PSSD (kWh)</th>
                      <th className="py-2.5 px-3 text-right">kWh Jual (309)</th>
                      <th className="py-2.5 px-3 text-right">Susut Bulan</th>
                      <th className="py-2.5 px-3 text-right">Susut Kumulatif</th>
                      <th className="py-2.5 px-3 min-w-[160px]">Catatan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {inputsState.data.months?.map((m) => { 
                      const dItem = inputsDraft[m.period] || {}
                      const canEdit = Boolean(inputsState.data.can_edit)
                      const kwhBeliVal = dItem['kwh-beli'] !== undefined ? dItem['kwh-beli'] : (m.inputs?.['kwh-beli']?.value ?? '')
                      const eMinVal = dItem['e-min'] !== undefined ? dItem['e-min'] : (m.inputs?.['e-min']?.value ?? '')
                      const pssdVal = dItem['pssd'] !== undefined ? dItem['pssd'] : (m.inputs?.['pssd']?.value ?? '')
                      const noteVal = dItem.note !== undefined ? dItem.note : (m.inputs?.['kwh-beli']?.note || m.inputs?.['e-min']?.note || m.inputs?.['pssd']?.note || '')

                      return (
                        <tr key={m.period} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                            {fmtMonth(m.period)}
                          </td>

                          {/* Input kWh Beli */}
                          <td className="py-1.5 px-2">
                            <input
                              type="number"
                              step="any"
                              disabled={!canEdit}
                              placeholder="Wajib isi"
                              value={kwhBeliVal ?? ''}
                              onChange={(e) => handleInputChange(m.period, 'kwh-beli', e.target.value)}
                              aria-label={`kWh Beli ${m.period}`}
                              className="w-full text-xs font-mono px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-60 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                            />
                          </td>

                          {/* Input E-Min */}
                          <td className="py-1.5 px-2">
                            <input
                              type="number"
                              step="any"
                              disabled={!canEdit}
                              placeholder="Opsional"
                              value={eMinVal ?? ''}
                              onChange={(e) => handleInputChange(m.period, 'e-min', e.target.value)}
                              aria-label={`E-Min ${m.period}`}
                              className="w-full text-xs font-mono px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-60 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                            />
                          </td>

                          {/* Input PSSD */}
                          <td className="py-1.5 px-2">
                            <input
                              type="number"
                              step="any"
                              disabled={!canEdit}
                              placeholder="Opsional"
                              value={pssdVal ?? ''}
                              onChange={(e) => handleInputChange(m.period, 'pssd', e.target.value)}
                              aria-label={`PSSD ${m.period}`}
                              className="w-full text-xs font-mono px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-60 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                            />
                          </td>

                          {/* kWh Jual (309) - Readonly */}
                          <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 dark:text-slate-300">
                            {m.kwh_jual !== null && m.kwh_jual !== undefined ? fmtFloat(m.kwh_jual, 0) : '-'}
                          </td>

                          {/* Susut Bulanan % - Readonly */}
                          <td className="py-2 px-3 text-right font-mono tabular-nums font-semibold">
                            {m.susut_pct !== null && m.susut_pct !== undefined ? (
                              <span className={m.susut_pct < 0 ? 'text-rose-600' : 'text-slate-800 dark:text-slate-200'}>
                                {fmtFloat(m.susut_pct, 2)}%
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>

                          {/* Susut Kumulatif YTD % - Readonly */}
                          <td className="py-2 px-3 text-right font-mono tabular-nums font-bold">
                            {m.susut_kumulatif_pct !== null && m.susut_kumulatif_pct !== undefined ? (
                              <span className={m.susut_kumulatif_pct < 0 ? 'text-rose-600' : 'text-indigo-600 dark:text-indigo-400'}>
                                {fmtFloat(m.susut_kumulatif_pct, 2)}%
                              </span>
                            ) : (
                              <span className="text-slate-400">-</span>
                            )}
                          </td>

                          {/* Input Catatan */}
                          <td className="py-1.5 px-2">
                            <input
                              type="text"
                              disabled={!canEdit}
                              placeholder="Catatan..."
                              value={noteVal ?? ''}
                              onChange={(e) => handleInputChange(m.period, 'note', e.target.value)}
                              aria-label={`Catatan ${m.period}`}
                              className="w-full text-xs px-2 py-1 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 disabled:opacity-60 focus:ring-1 focus:ring-indigo-500 focus:outline-hidden"
                            />
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>

              {inputsState.data?.can_edit && (
                <div className="flex justify-end pt-2">
                  <Button
                    type="button"
                    variant="primary"
                    size="md"
                    loading={inputsState.saving}
                    onClick={handleSaveInputs}
                  >
                    Simpan Masukan Bulanan
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      ) : (
        /* Tampilan Mode Tren Metrik Biasa */
        <div className="space-y-6">
          {activeCode === 'susut' && (!d || d.series?.every((s) => s.values?.every((v) => v === null))) && (
            <div className={`${CARD} p-6 text-center space-y-3`}>
              <IconZap size={32} className="mx-auto text-indigo-500" />
              <h3 className="text-base font-bold text-slate-800 dark:text-slate-200">
                Data Susut Belum Terisi
              </h3>
              <p className="text-xs text-slate-500 max-w-md mx-auto">
                Metrik susut dihitung dari data kWh Beli bulanan yang disandingkan dengan laporan penjualan kWh (309).
                {canInput ? ' Anda dapat mengisi masukan kWh beli untuk ULP di bawah ini.' : ' Hubungi staf perencanaan untuk pengisian data kWh beli.'}
              </p>
              {canInput && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setSusutViewMode('inputs')}
                >
                  Buka Masukan kWh Beli
                </Button>
              )}
            </div>
          )}

          {/* Main Content Area */}
          {metricState.loading ? (
        <div className={`${CARD} py-24 flex justify-center`}>
          <Spinner size="lg" label="Memuat tren dan analisis pengusahaan..." />
        </div>
      ) : metricState.error ? (
        <Alert kind="error">{metricState.error}</Alert>
      ) : !d ? (
        <EmptyState
          title="Data Tidak Ditemukan"
          desc="Silakan pilih unit dan periode laporan yang tersedia."
        />
      ) : (
        <div className="space-y-6">
          {/* Warning Banner: Angka UP3 belum utuh */}
          {isLatestIncomplete && (
            <div className="p-4 bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900/40 rounded-xl text-xs text-amber-800 dark:text-amber-300 flex items-start justify-between gap-3 flex-wrap">
              <div className="flex items-start gap-2.5">
                <IconAlertCircle size={18} className="mt-0.5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <span className="font-bold">
                    Perhatian: Angka UP3 pada bulan {fmtMonth(d.to)} belum utuh
                  </span>
                  <p className="mt-0.5 text-amber-700 dark:text-amber-400">
                    Data bulan ini baru mencakup <strong>{unitsReportingLatest} dari {unitsExpected} ULP</strong>.
                    Persentase perubahan dihitung setara hanya dari unit yang memiliki laporan lengkap di kedua periode.
                  </p>
                </div>
              </div>
              <Link
                to={`/master-data/laporan-eis?tab=coverage&up3_id=${up3Id || d?.unit?.id || ''}&year=${d?.to ? d.to.slice(0, 4) : new Date().getFullYear()}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-amber-600 hover:bg-amber-700 text-white rounded-lg text-xs font-semibold shadow-xs shrink-0 self-center"
              >
                Lihat Matriks Kelengkapan UP3 &rarr;
              </Link>
            </div>
          )}

          {/* Missing Coverage Alert */}
          {d.coverage?.missing && d.coverage.missing.length > 0 && (
            <div className="p-3 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 flex items-start gap-2">
              <IconInfo size={16} className="mt-0.5 shrink-0 text-slate-500" />
              <div>
                <span className="font-semibold text-slate-700 dark:text-slate-200">
                  Catatan Kelengkapan Laporan EIS:
                </span>{' '}
                Terdapat bulan laporan yang belum diunggah:{' '}
                {d.coverage.missing.map((m, idx) => (
                  <span key={m.unit_id}>
                    {idx > 0 && ', '}
                    <strong>{m.unit_name}</strong> ({m.months.map(fmtMonth).join(', ')})
                  </span>
                ))}
                .{' '}
                <Link
                  to={`/master-data/laporan-eis?tab=coverage&up3_id=${up3Id || d?.unit?.id || ''}&year=${d?.to ? d.to.slice(0, 4) : new Date().getFullYear()}`}
                  className="text-indigo-600 dark:text-indigo-400 font-semibold hover:underline ml-1"
                >
                  Buka Matriks Kelengkapan &rarr;
                </Link>
              </div>
            </div>
          )}

          {/* KPI Summary Cards per Seri */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {d.summary?.map((s) => {
              const metaSeries = d.series?.find((x) => x.key === s.key)
              const polarity = d.metric?.polarity || 'up'

              return (
                <div key={s.key} className={`${CARD} p-4 flex flex-col justify-between`}>
                  <div>
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                      <span>{metaSeries?.name || s.key}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800">
                        {fmtMonth(d.to)}
                      </span>
                    </div>

                    <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                      {s.latest !== null ? fmtFloat(s.latest) : '-'}{' '}
                      <span className="text-sm font-normal text-slate-500">
                        {metaSeries?.unit}
                      </span>
                    </div>

                    {/* Perubahan MoM & YoY */}
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <PolarityPctBadge pct={s.mom_pct} polarity={polarity} label="MoM" />
                      <PolarityPctBadge pct={s.yoy_pct} polarity={polarity} label="YoY" />
                    </div>
                  </div>

                  {/* Bagian Kumulatif YTD */}
                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                    <div>
                      <span className="block text-[10px] text-slate-400">
                        Kumulatif YTD ({d.metric?.ytd_mode === 'last' ? 'Posisi' : d.metric?.ytd_mode === 'sum' ? 'Akumulasi' : 'Rata-rata'})
                      </span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200 tabular-nums">
                        {s.ytd !== null ? fmtFloat(s.ytd) : '-'} {metaSeries?.unit}
                      </span>
                    </div>
                    {s.ytd_pct !== null && (
                      <PolarityPctBadge pct={s.ytd_pct} polarity={polarity} label="YTD YoY" />
                    )}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Tren Grafik Line / Comparison */}
          <div className={`${CARD} p-5 space-y-4`}>
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  {`Tren Bulanan: ${d.metric?.name}`}
                </h3>
                <p className="text-xs text-slate-500">
                  Periode {fmtMonth(d.from)} s/d {fmtMonth(d.to)} &bull; Sumber: {d.metric?.source}
                </p>
              </div>
            </div>

            <MetricTrendChart
              months={d.months || []}
              series={d.series || []}
              activeSeriesKey={activeSeriesKey}
              onSelectSeries={setActiveSeriesKey}
              unitsExpected={d.units_expected || 1}
              unitsReporting={d.units_reporting || []}
              polarity={d.metric?.polarity || 'up'}
            />
          </div>

          {/* Grid: Rincian (Breakdown) & Perbandingan Antar ULP (Comparison) */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            {/* Rincian Komposisi Utama (Breakdown) */}
            {d.breakdown && (
              <div className={`${CARD} p-5 space-y-4`}>
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {`Rincian: ${d.breakdown.dimension}`}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Komposisi pada periode {fmtMonth(d.breakdown.period)}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Kategori</th>
                        <th className="py-2.5 px-3 text-right">Nilai</th>
                        <th className="py-2.5 px-3 text-right">Porsi</th>
                        <th className="py-2.5 px-3 text-right">Thn Lalu</th>
                        <th className="py-2.5 px-3 text-right">YoY</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {d.breakdown.rows?.map((r) => (
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
                                  className="h-full bg-indigo-600 rounded-full"
                                  style={{ width: `${Math.min(100, Math.max(0, r.share_pct || 0))}%` }}
                                />
                              </div>
                              <span className="font-mono tabular-nums text-[11px]">
                                {fmtFloat(r.share_pct, 1)}%
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-400">
                            {r.same_month_last_year !== null ? fmtFloat(r.same_month_last_year) : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <PolarityPctBadge pct={r.yoy_pct} polarity={d.metric?.polarity || 'up'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Rincian Komposisi Kedua (Breakdown Secondary, misal: Kogol pada Umur Piutang) */}
            {d.breakdown_secondary && (
              <div className={`${CARD} p-5 space-y-4`}>
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {`Rincian: ${d.breakdown_secondary.dimension}`}
                    </h3>
                    <p className="text-xs text-slate-500">
                      Komposisi pada periode {fmtMonth(d.breakdown_secondary.period)}
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3">Kategori</th>
                        <th className="py-2.5 px-3 text-right">Nilai</th>
                        <th className="py-2.5 px-3 text-right">Porsi</th>
                        <th className="py-2.5 px-3 text-right">Thn Lalu</th>
                        <th className="py-2.5 px-3 text-right">YoY</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {d.breakdown_secondary.rows?.map((r) => (
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
                                  className="h-full bg-indigo-600 rounded-full"
                                  style={{ width: `${Math.min(100, Math.max(0, r.share_pct || 0))}%` }}
                                />
                              </div>
                              <span className="font-mono tabular-nums text-[11px]">
                                {fmtFloat(r.share_pct, 1)}%
                              </span>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-400">
                            {r.same_month_last_year !== null ? fmtFloat(r.same_month_last_year) : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <PolarityPctBadge pct={r.yoy_pct} polarity={d.metric?.polarity || 'up'} />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* Perbandingan Antar ULP (Hanya untuk unit UP3) */}
            {isUp3 && d.comparison && d.comparison.length > 0 && (
              <div className={`${CARD} p-5 space-y-4`}>
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      Perbandingan Antar ULP
                    </h3>
                    <p className="text-xs text-slate-500">
                      Capaian bulan {fmtMonth(d.to)} diurutkan dari nilai terbesar
                    </p>
                  </div>
                </div>

                <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3 w-10 text-center">#</th>
                        <th className="py-2.5 px-3">Unit Layanan (ULP)</th>
                        <th className="py-2.5 px-3 text-right">Bulan Ini</th>
                        <th className="py-2.5 px-3 text-right">YoY</th>
                        <th className="py-2.5 px-3 text-right">Kumulatif YTD</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {d.comparison.map((c, idx) => (
                        <tr key={c.unit_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 text-center font-mono text-slate-400 text-[11px]">
                            {idx + 1}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                            {c.unit_name}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                            {c.latest !== null ? fmtFloat(c.latest) : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right">
                            <PolarityPctBadge pct={c.yoy_pct} polarity={d.metric?.polarity || 'up'} />
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-600 dark:text-slate-300">
                            {c.ytd !== null ? fmtFloat(c.ytd) : '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>

          {/* Matriks Silang (Matrix Heatmap, misal: Kogol x Umur Tunggakan) */}
          {d.matrix && (
            <div className={`${CARD} p-5 space-y-4`}>
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                    {`Matriks Silang: ${d.matrix.rows_dimension} × ${d.matrix.columns_dimension}`}
                  </h3>
                  <p className="text-xs text-slate-500">
                    Distribusi saldo nilai pada periode {fmtMonth(d.matrix.period)}
                  </p>
                </div>
              </div>

              {/* Tabel Matriks dengan Heatmap */}
              {(() => {
                const matrixValues = d.matrix.values || []
                let maxMatrixVal = 0
                matrixValues.forEach((row) => {
                  row?.forEach((v) => {
                    if (v > maxMatrixVal) maxMatrixVal = v
                  })
                })

                return (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="py-2.5 px-3 font-semibold text-slate-700 dark:text-slate-300">
                            {d.matrix.rows_dimension} \ {d.matrix.columns_dimension}
                          </th>
                          {d.matrix.columns?.map((col) => (
                            <th key={col} className="py-2.5 px-3 text-right font-semibold whitespace-nowrap">
                              {col}
                            </th>
                          ))}
                          <th className="py-2.5 px-3 text-right font-bold text-slate-800 dark:text-slate-200 bg-slate-100/60 dark:bg-slate-800">
                            Total
                          </th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {d.matrix.rows?.map((rowLabel, rIdx) => {
                          const rowVals = matrixValues[rIdx] || []
                          const rowTotal = rowVals.reduce((acc, v) => acc + (v || 0), 0)

                          return (
                            <tr key={rowLabel} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                              <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                                {rowLabel}
                              </td>
                              {d.matrix.columns?.map((colLabel, cIdx) => {
                                const val = rowVals[cIdx] || 0
                                const intensity = maxMatrixVal > 0 ? val / maxMatrixVal : 0

                                // Warna heatmap lembut berdasarkan porsi terhadap nilai maksimum
                                const heatBg = val > 0
                                  ? `rgba(99, 102, 241, ${Math.min(0.7, Math.max(0.08, intensity * 0.65))})`
                                  : undefined

                                return (
                                  <td
                                    key={colLabel}
                                    style={{ backgroundColor: heatBg }}
                                    className="py-2.5 px-3 text-right font-mono tabular-nums transition"
                                  >
                                    <span className={val > 0 ? 'font-semibold text-slate-900 dark:text-slate-100' : 'text-slate-400'}>
                                      {val !== 0 ? fmtFloat(val) : '-'}
                                    </span>
                                  </td>
                                )
                              })}
                              <td className="py-2.5 px-3 text-right font-mono tabular-nums font-bold text-slate-900 dark:text-slate-100 bg-slate-50/50 dark:bg-slate-800/40">
                                {fmtFloat(rowTotal)}
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                      {/* Baris Total Kolom */}
                      <tfoot className="bg-slate-50 dark:bg-slate-800/80 border-t-2 border-slate-200 dark:border-slate-700 text-[11px] font-bold">
                        <tr>
                          <td className="py-2.5 px-3 text-slate-800 dark:text-slate-200">
                            Total
                          </td>
                          {d.matrix.columns?.map((colLabel, cIdx) => {
                            const colTotal = d.matrix.rows?.reduce((acc, _, rIdx) => {
                              return acc + (matrixValues[rIdx]?.[cIdx] || 0)
                            }, 0) || 0

                            return (
                              <td key={colLabel} className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-900 dark:text-slate-100">
                                {fmtFloat(colTotal)}
                              </td>
                            )
                          })}
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-indigo-700 dark:text-indigo-300 font-extrabold bg-slate-100 dark:bg-slate-800">
                            {fmtFloat(
                              matrixValues.reduce((tot, row) => tot + row.reduce((rTot, v) => rTot + (v || 0), 0), 0)
                            )}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )
              })()}
            </div>
          )}

          {/* Data Penjelas Operasional (Companions) */}
          {d.companions && (
            <CompanionSection companions={d.companions} toMonth={d.to} />
          )}

          {/* Rekonsiliasi Angka Resmi vs Operasional */}
          {(d.reconciliations?.length > 0 || d.reconciliation) && (
            <ReconciliationSection
              reconciliations={d.reconciliations || (d.reconciliation ? [d.reconciliation] : [])}
              unitsExpected={unitsExpected}
            />
          )}

          {/* Catatan Wawasan & Analisa Otomatis (Insights) */}
          {d.insights && d.insights.length > 0 && (
            <div className={`${CARD} p-5 space-y-3`}>
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <IconCheckCircle size={18} className="text-indigo-600" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Wawasan & Catatan Analisa Otomatis ({d.insights.length})
                </h3>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {d.insights.map((ins, idx) => {
                  const isGood = ins.level === 'baik'
                  const isWarn = ins.level === 'perhatian'
                  const borderCls = isGood
                    ? 'border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-950/20'
                    : isWarn
                    ? 'border-amber-200 dark:border-amber-900/50 bg-amber-50/30 dark:bg-amber-950/20'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40'

                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 ${borderCls}`}
                    >
                      {isGood ? (
                        <IconCheckCircle size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                      ) : isWarn ? (
                        <IconAlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                      ) : (
                        <IconInfo size={16} className="text-blue-600 shrink-0 mt-0.5" />
                      )}
                      <span className="text-slate-700 dark:text-slate-300 leading-relaxed">
                        {ins.text}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        )}
      </div>
      )}
      </>
      )}

      {/* Drawer Sinkronisasi Data EIS */}
      <EisSyncDrawer
        open={syncDrawerOpen}
        mode={activeCode.startsWith('piutang') ? 'piutang' : (activeCode === 'pelanggan' || activeCode === 'daya' ? 'permohonan' : null)}
        onClose={() => setSyncDrawerOpen(false)}
        onSynced={() => {
          loadCatalog()
          loadMetricData()
        }}
      />
    </div>
  )
}
