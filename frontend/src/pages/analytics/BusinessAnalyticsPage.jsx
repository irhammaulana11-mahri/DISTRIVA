import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { pengusahaanApi, triggerFileDownload } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Pagination from '../../components/Pagination.jsx'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import EisSyncDrawer from '../applications/EisSyncDrawer.jsx'
import OutageSyncDrawer from '../outages/OutageSyncDrawer.jsx'
import BusinessForecastTab from './BusinessForecastTab.jsx'
import BusinessHistoryTab from './BusinessHistoryTab.jsx'
import ReliabilityFeederTab from './ReliabilityFeederTab.jsx'
import { BreakdownCard, ComparisonCard } from './AnalyticsDetailsSection.jsx'
import ReceivableAgingTab from './ReceivableAgingTab.jsx'
import SalesDecompositionTab from './SalesDecompositionTab.jsx'
import LossAnalysisTab from './LossAnalysisTab.jsx'
import ResponseComparisonTab from './ResponseComparisonTab.jsx'
import AnomalyAnalysisTab from './AnomalyAnalysisTab.jsx'
import P2tlFunnelTab from './P2tlFunnelTab.jsx'
import ConnectionFeeQueueTab from './ConnectionFeeQueueTab.jsx'
import CustomerGrowthTab from './CustomerGrowthTab.jsx'
import GrowthAnalysisSection from './GrowthAnalysisSection.jsx'
import PrepaidReceivableTab from './PrepaidReceivableTab.jsx'
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
  return Number(v).toLocaleString('id-ID', { maximumFractionDigits: 0 })
}

const fmtFloat = (v, digits = 2) => {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

/** Format nilai cerdas sesuai satuan metrik (docs/91 §4):
 * - plg, pelanggan, kali, lbr, permohonan -> bulat tanpa desimal
 * - MVA -> dua desimal
 * - Rp -> singkatan cerdas (Miliar/Juta) atau tanpa desimal
 */
const fmtMetricValue = (v, unit = '') => {
  if (v === null || v === undefined) return '-'
  const u = (unit || '').toLowerCase()
  if (u.includes('plg') || u.includes('pelanggan') || u.includes('kali') || u.includes('lbr') || u.includes('permohonan')) {
    return fmtInt(v)
  }
  if (u.includes('mva')) {
    return fmtFloat(v, 2)
  }
  if (u.includes('rp')) {
    const num = Number(v)
    if (Math.abs(num) >= 1e9) {
      return `Rp ${fmtFloat(num / 1e9, 2)} M`
    }
    if (Math.abs(num) >= 1e6) {
      return `Rp ${fmtFloat(num / 1e6, 2)} jt`
    }
    return `Rp ${fmtInt(num)}`
  }
  if (u.includes('%')) {
    return `${fmtFloat(v, 2)}%`
  }
  return fmtFloat(v, 2)
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

/** Komponen grafik tren SVG interaktif (values vs previous_year)
 * Didesain full-width (kiri s/d kanan), legenda di atas kiri, dan kartu tooltip mengambang persis di atas chart saat hover.
 */
const FLOW_METRICS = new Set([
  'kwh-jual',
  'pendapatan',
  'hpl-bp',
  'pelunasan-prr',
  'pelunasan-ex-prr',
  'kwh-p2tl',
  'gangguan',
  'saidi-saifi',
  'ens',
])

const POSITION_DELTA_METRICS = new Set(['pelanggan', 'daya'])

function buildYtdSeries(months, vals) {
  let acc = 0
  let currentYear = null
  return vals.map((v, idx) => {
    const yr = String(months[idx] || '').slice(0, 4)
    if (yr !== currentYear) {
      currentYear = yr
      acc = 0
    }
    if (v === null || v === undefined) return null
    acc += Number(v)
    return acc
  })
}

function buildPositionDeltaSeries(months, vals, prevYearVals) {
  // Cari nilai posisi Desember tahun sebelumnya sebagai baseline penambahan YTD
  const decByYear = {}
  months.forEach((m, idx) => {
    const s = String(m || '')
    if (s.endsWith('-12') && vals[idx] !== null && vals[idx] !== undefined) {
      decByYear[s.slice(0, 4)] = Number(vals[idx])
    }
    if (s.endsWith('-12') && prevYearVals[idx] !== null && prevYearVals[idx] !== undefined) {
      const prevYr = String(Number(s.slice(0, 4)) - 1)
      if (decByYear[prevYr] === undefined) {
        decByYear[prevYr] = Number(prevYearVals[idx])
      }
    }
  })

  return vals.map((v, idx) => {
    if (v === null || v === undefined) return null
    const yr = String(months[idx] || '').slice(0, 4)
    const prevYr = String(Number(yr) - 1)
    const base = decByYear[prevYr]
    if (base !== undefined) {
      return Number(v) - base
    }
    const prevSameMonth = prevYearVals[idx]
    if (prevSameMonth !== null && prevSameMonth !== undefined) {
      return Number(v) - Number(prevSameMonth)
    }
    return null
  })
}

function MetricTrendChart({
  months = [],
  series = [],
  activeSeriesKey,
  onSelectSeries,
  unitsExpected = 1,
  unitsReporting = [],
  polarity = 'up',
  incompleteMonths = [],
  metricCode,
  events = [],
  ytdMode,
  targets = [],
}) {
  const [hoverData, setHoverData] = useState(null)
  const containerRef = useRef(null)

  // Khusus rpt-rct-gangguan: kita tampilkan tab ukuran: RPT, RCT, Jumlah WO
  const isRptRctGangguan = metricCode === 'rpt-rct-gangguan'
  const isApktMetric = metricCode === 'rpt-rct-gangguan' || metricCode === 'rpt-rct-keluhan' || metricCode === 'anomali-gangguan' || metricCode === 'anomali-keluhan'
  const isFlowMetric = FLOW_METRICS.has(metricCode)
  const isPositionDeltaMetric = POSITION_DELTA_METRICS.has(metricCode) || ytdMode === 'last'

  const hasDeltaTarget = useMemo(
    () => isPositionDeltaMetric && (targets || []).some((t) => typeof t.target === 'number'),
    [isPositionDeltaMetric, targets],
  )

  const [rptRctTab, setRptRctTab] = useState('rpt') // 'rpt' | 'rct' | 'jumlah'
  const [viewMode, setViewMode] = useState(() => (hasDeltaTarget ? 'delta' : 'monthly')) // 'monthly' | 'ytd' | 'delta'

  // Reset viewMode saat berganti metrik
  useEffect(() => {
    setViewMode(hasDeltaTarget ? 'delta' : 'monthly')
  }, [metricCode, hasDeltaTarget])

  const supportsYtdToggle = isFlowMetric && ytdMode !== 'last'

  const activeSeries = useMemo(() => {
    if (isRptRctGangguan) {
      const key = rptRctTab // 'rpt' | 'rct' | 'jumlah'
      return series.find((s) => s.key === key) || series[0]
    }
    return series.find((s) => s.key === activeSeriesKey) || series[0]
  }, [series, activeSeriesKey, isRptRctGangguan, rptRctTab])

  // Seri sekunder untuk rpt-rct-gangguan: varian Tanpa Clear Temper
  const companionSeries = useMemo(() => {
    if (isRptRctGangguan) {
      const nctKey = `${rptRctTab}_tanpa_ct`
      return series.find((s) => s.key === nctKey) || null
    }
    return null
  }, [series, isRptRctGangguan, rptRctTab])

  const rawValues = activeSeries?.values || []
  const rawPreviousYear = isRptRctGangguan ? (companionSeries?.values || []) : (activeSeries?.previous_year || [])

  const isYtdView = supportsYtdToggle && viewMode === 'ytd'
  const isDeltaView = isPositionDeltaMetric && viewMode === 'delta'

  const values = useMemo(() => {
    if (isYtdView) return buildYtdSeries(months, rawValues)
    if (isDeltaView) return buildPositionDeltaSeries(months, rawValues, rawPreviousYear)
    return rawValues
  }, [isYtdView, isDeltaView, months, rawValues, rawPreviousYear])

  const previousYear = useMemo(() => {
    if (isYtdView) return buildYtdSeries(months, rawPreviousYear)
    if (isDeltaView) return [] // Mode delta YTD berfokus pada penambahan terhadap target
    return rawPreviousYear
  }, [isYtdView, isDeltaView, months, rawPreviousYear])

  // Garis acuan Target NKO hanya tampil bila skala datanya sebanding:
  // - Metrik aliran: hanya di mode Kumulatif (YTD)
  // - Metrik posisi (Pelanggan/Daya): hanya di mode Penambahan (Δ YTD) karena targetnya adalah penambahan
  // - Metrik rasio/laju (RPT-RCT, Susut): langsung tampil
  const matchingTarget = useMemo(() => {
    if (!targets || targets.length === 0 || !activeSeries) return null
    if (isFlowMetric && !isYtdView) return null
    if (isPositionDeltaMetric && !isDeltaView) return null
    const unitNorm = String(activeSeries.unit || '').trim().toLowerCase()
    const found = targets.find((t) => {
      if (t.target === null || t.target === undefined || typeof t.target !== 'number') return false
      const tUnit = String(t.unit_label || '').trim().toLowerCase()
      return !tUnit || !unitNorm || tUnit === unitNorm
    })
    return found || null
  }, [targets, activeSeries, isFlowMetric, isYtdView, isPositionDeltaMetric, isDeltaView])

  // Hitung rentang nilai min & max
  const allNums = useMemo(() => {
    const list = []
    values.forEach((v) => v !== null && v !== undefined && list.push(v))
    previousYear.forEach((v) => v !== null && v !== undefined && list.push(v))
    if (matchingTarget && typeof matchingTarget.target === 'number') {
      list.push(matchingTarget.target)
    }
    return list
  }, [values, previousYear, matchingTarget])

  const { minVal, maxVal } = useMemo(() => {
    if (allNums.length === 0) return { minVal: 0, maxVal: 100 }
    let mn = Math.min(...allNums)
    let mx = Math.max(...allNums)
    if (mn === mx) {
      mn = mn < 0 ? mn * 1.1 : mn * 0.9
      mx = mx * 1.1 || 10
    } else {
      const padding = (mx - mn) * 0.12
      mn = mn < 0 ? mn - padding : Math.max(0, mn - padding)
      mx = mx + padding
    }
    return { minVal: mn, maxVal: mx }
  }, [allNums])

  // Desain SVG dengan viewBox proporsional full width
  const width = 1000
  const height = 300
  const padLeft = 70
  const padRight = 24
  const padTop = 25
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

  const zeroY = minVal < 0 && maxVal > 0 ? getY(0) : null
  const baselineY = zeroY !== null ? zeroY : padTop + chartH

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
    const baseY = baselineY

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

  const currentPath = useMemo(() => buildPath(values), [values, minVal, maxVal, months.length])
  const prevPath = useMemo(() => buildPath(previousYear), [previousYear, minVal, maxVal, months.length])
  const currentArea = useMemo(() => buildAreaPath(values), [values, minVal, maxVal, months.length])

  // Sumbu Y ticks
  const yTicks = useMemo(() => {
    const ticks = []
    const count = 4
    for (let i = 0; i <= count; i++) {
      const val = minVal + (i / count) * (maxVal - minVal)
      const y = padTop + chartH - (i / count) * chartH
      ticks.push({ val, y })
    }
    return ticks
  }, [minVal, maxVal, chartH])

  const handlePointerMove = (idx) => {
    const currentVal = values[idx]
    const prevVal = previousYear[idx] ?? null
    const prevMonthVal = idx > 0 ? values[idx - 1] : null
    const yoyDiff = currentVal !== null && currentVal !== undefined && prevVal !== null && prevVal !== undefined
      ? currentVal - prevVal
      : null
    let yoyPct = null
    if (yoyDiff !== null && prevVal !== 0) {
      yoyPct = (yoyDiff / Math.abs(prevVal)) * 100
    }
    const momDiff = currentVal !== null && currentVal !== undefined && prevMonthVal !== null && prevMonthVal !== undefined
      ? currentVal - prevMonthVal
      : null
    let momPct = null
    if (momDiff !== null && prevMonthVal !== 0) {
      momPct = (momDiff / Math.abs(prevMonthVal)) * 100
    }
    const matchedEvent = (events || []).find((ev) => ev.month === months[idx]) || null

    setHoverData({
      idx,
      month: months[idx],
      currentVal,
      prevVal,
      yoyDiff,
      yoyPct,
      momDiff,
      momPct,
      matchedEvent,
      unitsReporting: unitsReporting[idx],
      xPct: (getX(idx) / width) * 100,
    })
  }

  return (
    <div className="space-y-3 relative" ref={containerRef} onMouseLeave={() => setHoverData(null)}>
      {/* Selector Tab Ukuran / Series + Mode Bulanan/YTD/Delta */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
        {isRptRctGangguan ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs font-semibold text-slate-500">Pilih Ukuran:</span>
            {[
              { id: 'rpt', label: 'RPT (Response Time)', unit: 'menit' },
              { id: 'rct', label: 'RCT (Recovery Time)', unit: 'menit' },
              { id: 'jumlah', label: 'Jumlah WO Gangguan', unit: 'kali' },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setRptRctTab(tab.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  rptRctTab === tab.id
                    ? 'bg-indigo-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
                }`}
              >
                {tab.label} ({tab.unit})
              </button>
            ))}
          </div>
        ) : series.length > 1 ? (
          <div className="flex flex-wrap items-center gap-2">
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
        ) : (
          <span className="text-xs font-semibold text-slate-500">
            {activeSeries?.name} ({activeSeries?.unit})
          </span>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {supportsYtdToggle && (
            <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs" role="group" aria-label="Mode tampilan tren">
              <button
                type="button"
                onClick={() => setViewMode('monthly')}
                className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                  viewMode === 'monthly'
                    ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Bulanan
              </button>
              <button
                type="button"
                onClick={() => setViewMode('ytd')}
                className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                  viewMode === 'ytd'
                    ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Kumulatif (YTD)
              </button>
            </div>
          )}

          {isPositionDeltaMetric && (
            <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5 text-xs" role="group" aria-label="Mode tampilan posisi atau delta">
              <button
                type="button"
                onClick={() => setViewMode('monthly')}
                className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                  viewMode !== 'delta'
                    ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Posisi Total
              </button>
              <button
                type="button"
                onClick={() => setViewMode('delta')}
                className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                  viewMode === 'delta'
                    ? 'bg-white dark:bg-slate-700 text-indigo-700 dark:text-indigo-300 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                }`}
              >
                Penambahan (Δ YTD)
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Baris Atas: Legend */}
      <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-4">
          <div className="flex items-center gap-2">
            <span className="w-4 h-1.5 rounded-full bg-indigo-600 shrink-0" />
            <span className="font-semibold text-slate-700 dark:text-slate-300">
              {isRptRctGangguan
                ? 'Semua Laporan (Utama)'
                : isDeltaView
                ? `Penambahan Δ YTD (${activeSeries?.unit})`
                : isYtdView
                ? `Kumulatif YTD (${activeSeries?.unit})`
                : `Tahun Berjalan (${activeSeries?.unit})`}
            </span>
          </div>
          {previousYear.some((v) => v !== null && v !== undefined) && (
            <div className="flex items-center gap-2">
              <span className="w-4 h-1 rounded-full border-b-2 border-dashed border-slate-400 bg-slate-300 dark:bg-slate-600 shrink-0" />
              <span className="text-slate-500 dark:text-slate-400">
                {isRptRctGangguan
                  ? 'Laporan Tanpa Clear Temper (Pembanding)'
                  : isYtdView
                  ? 'Kumulatif YTD Tahun Lalu'
                  : 'Bulan Sama Tahun Lalu'}
              </span>
            </div>
          )}
          {matchingTarget && (
            <div className="flex items-center gap-2">
              <span className="w-4 h-0.5 border-b-2 border-dashed border-emerald-600 shrink-0" />
              <span className="text-emerald-700 dark:text-emerald-400 font-medium">
                Target NKO ({fmtMetricValue(matchingTarget.target, activeSeries?.unit)} {activeSeries?.unit})
              </span>
            </div>
          )}
        </div>
        <span className="text-[11px] text-slate-400">
          {isDeltaView
            ? 'Penambahan kumulatif sejak akhir tahun lalu'
            : isYtdView
            ? 'Akumulasi Kumulatif Tahun Berjalan'
            : 'Grafik Garis Tren'}
        </span>
      </div>

      {/* Tooltip Melayang Interaktif */}
      {hoverData && (
        <div
          className="absolute z-20 pointer-events-none transition-all duration-150 ease-out"
          style={{
            left: `${hoverData.xPct}%`,
            top: '65px',
            transform: hoverData.xPct > 70 ? 'translateX(-100%)' : hoverData.xPct < 30 ? 'translateX(0%)' : 'translateX(-50%)',
          }}
        >
          <div className="rounded-xl border border-slate-200/90 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 shadow-xl p-3 min-w-[240px] backdrop-blur-xs text-xs space-y-1.5">
            <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-1.5 font-bold text-slate-900 dark:text-slate-100">
              <span>{isYtdView || isDeltaView ? `YTD s/d ${fmtMonth(hoverData.month)}` : `Bulan ${fmtMonth(hoverData.month)}`}</span>
              {unitsExpected > 1 && hoverData.unitsReporting !== undefined && (
                <span className={`text-[10px] font-mono px-1.5 py-0.2 rounded ${
                  hoverData.unitsReporting < unitsExpected ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300' : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                }`}>
                  {hoverData.unitsReporting}/{unitsExpected} ULP
                </span>
              )}
            </div>

            <div className="space-y-1 pt-0.5">
              <div className="flex items-center justify-between gap-3">
                <span className="flex items-center gap-1.5 text-slate-600 dark:text-slate-300 font-medium">
                  <span className="w-2.5 h-2.5 rounded-full bg-indigo-600 shrink-0" />
                  <span>{isRptRctGangguan ? 'Semua Laporan:' : isDeltaView ? 'Penambahan Δ:' : isYtdView ? 'YTD Berjalan:' : 'Berjalan:'}</span>
                </span>
                <span className="font-mono font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                  {hoverData.currentVal !== null && hoverData.currentVal !== undefined
                    ? `${fmtMetricValue(hoverData.currentVal, activeSeries?.unit)} ${activeSeries?.unit}`
                    : '-'}
                </span>
              </div>

              {hoverData.prevVal !== null && hoverData.prevVal !== undefined && (
                <div className="flex items-center justify-between gap-3">
                  <span className="flex items-center gap-1.5 text-slate-500 font-medium">
                    <span className="w-2.5 h-2.5 rounded-full bg-slate-400 shrink-0" />
                    <span>{isRptRctGangguan ? 'Tanpa CT:' : isYtdView ? 'YTD Thn Lalu:' : 'Thn Lalu:'}</span>
                  </span>
                  <span className="font-mono text-slate-600 dark:text-slate-300 tabular-nums">
                    {fmtMetricValue(hoverData.prevVal, activeSeries?.unit)} {activeSeries?.unit}
                  </span>
                </div>
              )}

              {hoverData.yoyDiff !== null && (
                <div className="flex items-center justify-between gap-3 pt-1 border-t border-slate-100 dark:border-slate-800/80 text-[11px]">
                  <span className="text-slate-500">{isRptRctGangguan ? 'Selisih Varian:' : 'YoY (Selisih):'}</span>
                  <span className="flex items-center gap-1.5 font-mono">
                    <span className="text-slate-600 dark:text-slate-300">
                      {hoverData.yoyDiff > 0 ? '+' : ''}{fmtMetricValue(hoverData.yoyDiff, activeSeries?.unit)}
                    </span>
                    {hoverData.yoyPct !== null && <PolarityPctBadge pct={hoverData.yoyPct} polarity={polarity} />}
                  </span>
                </div>
              )}

              {hoverData.momDiff !== null && !isYtdView && (
                <div className="flex items-center justify-between gap-3 text-[11px]">
                  <span className="text-slate-500">MoM (Bln Lalu):</span>
                  <span className="flex items-center gap-1.5 font-mono">
                    <span className="text-slate-600 dark:text-slate-300">
                      {hoverData.momDiff > 0 ? '+' : ''}{fmtMetricValue(hoverData.momDiff, activeSeries?.unit)}
                    </span>
                    {hoverData.momPct !== null && <PolarityPctBadge pct={hoverData.momPct} polarity={polarity} />}
                  </span>
                </div>
              )}

              {hoverData.matchedEvent && (
                <div className="pt-1 border-t border-slate-100 dark:border-slate-800/80 text-[11px] text-emerald-700 dark:text-emerald-300 font-medium">
                  Catatan: {hoverData.matchedEvent.label}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* SVG Chart Container Full Width */}
      <div className="relative w-full">
        <svg
          viewBox={`0 0 ${width} ${height}`}
          className="w-full h-auto select-none overflow-visible"
        >
          <defs>
            <linearGradient id="areaGradientFull" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#4f46e5" stopOpacity="0.28" />
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

          {/* Garis Nol (y = 0) yang tegas bila ada nilai negatif */}
          {zeroY !== null && (
            <line
              x1={padLeft}
              y1={zeroY}
              x2={width - padRight}
              y2={zeroY}
              stroke="#64748b"
              strokeWidth="1.25"
            />
          )}

          {/* Area fill tahun berjalan */}
          {currentArea && <path d={currentArea} fill="url(#areaGradientFull)" />}

          {/* Garis Acuan Target NKO */}
          {matchingTarget && (() => {
            const ty = getY(matchingTarget.target)
            if (ty === null) return null
            return (
              <g className="pointer-events-none">
                <line
                  x1={padLeft}
                  y1={ty}
                  x2={width - padRight}
                  y2={ty}
                  stroke="#059669"
                  strokeWidth="1.5"
                  strokeDasharray="6 4"
                />
                <rect
                  x={width - padRight - 142}
                  y={Math.max(padTop, ty - 18)}
                  width={140}
                  height={16}
                  rx={4}
                  fill="#ecfdf5"
                  stroke="#6ee7b7"
                  strokeWidth="1"
                  className="dark:fill-emerald-950 dark:stroke-emerald-800"
                />
                <text
                  x={width - padRight - 72}
                  y={Math.max(padTop, ty - 18) + 11}
                  textAnchor="middle"
                  className="text-[9px] font-bold fill-emerald-800 dark:fill-emerald-200 font-mono"
                >
                  Target: {fmtMetricValue(matchingTarget.target, activeSeries?.unit)}
                </text>
              </g>
            )
          })()}

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

          {/* Kolom Interaktif & Titik-titik Marker */}
          {months.map((m, idx) => {
            const x = getX(idx)
            const isHovered = hoverData?.idx === idx
            const yCurrent = getY(values[idx])
            const yPrev = getY(previousYear[idx])
            const isIncomplete = unitsExpected > 1 && (unitsReporting[idx] || 0) < unitsExpected
            const colWidth = chartW / Math.max(1, months.length - 1)
            const matchedEvent = (events || []).find((ev) => ev.month === m)

            return (
              <g
                key={m}
                onMouseEnter={() => handlePointerMove(idx)}
                className="cursor-pointer"
              >
                {/* Garis Vertikal Penanda Event (mis. Idul Fitri Butir 40 docs/92 §7) */}
                {matchedEvent && (
                  <g className="pointer-events-none">
                    <line
                      x1={x}
                      y1={padTop}
                      x2={x}
                      y2={padTop + chartH}
                      stroke="#10b981"
                      strokeWidth="1.5"
                      strokeDasharray="4 2"
                      className="opacity-70 dark:opacity-60"
                    />
                    <rect
                      x={x - 28}
                      y={padTop + 2}
                      width={56}
                      height={16}
                      rx={3}
                      fill="#ecfdf5"
                      stroke="#a7f3d0"
                      strokeWidth="1"
                      className="dark:fill-emerald-950 dark:stroke-emerald-800"
                    />
                    <text
                      x={x}
                      y={padTop + 13}
                      textAnchor="middle"
                      className="text-[9px] font-bold fill-emerald-800 dark:fill-emerald-200 select-none"
                    >
                      {matchedEvent.label || 'Event'}
                    </text>
                  </g>
                )}

                {/* Kolom Tangkapan Mouse Transparan */}
                <rect
                  x={x - colWidth / 2}
                  y={padTop}
                  width={colWidth}
                  height={chartH + 20}
                  fill="transparent"
                />

                {/* Garis Bantu Vertikal saat Hover */}
                {isHovered && (
                  <line
                    x1={x}
                    y1={padTop}
                    x2={x}
                    y2={padTop + chartH}
                    stroke="#818cf8"
                    strokeWidth="1.5"
                    strokeDasharray="3 3"
                  />
                )}

                {/* Titik Tahun Lalu */}
                {yPrev !== null && (
                  <circle
                    cx={x}
                    cy={yPrev}
                    r={isHovered ? 4.5 : 2.5}
                    fill="#94a3b8"
                  />
                )}

                {/* Titik Tahun Berjalan */}
                {yCurrent !== null && (
                  <circle
                    cx={x}
                    cy={yCurrent}
                    r={isHovered ? 6 : 3.5}
                    fill={isHovered ? '#4338ca' : '#4f46e5'}
                    stroke="#ffffff"
                    strokeWidth="1.5"
                  />
                )}

                {/* Indikator data belum utuh, belum lengkap DIFI, atau bulan berjalan APKT belum final */}
                {(isIncomplete || incompleteMonths.includes(m)) && (
                  <circle
                    cx={x}
                    cy={padTop + chartH + 18}
                    r={3.5}
                    fill={incompleteMonths.includes(m) && (isRptRctGangguan || isApktMetric) ? '#eab308' : incompleteMonths.includes(m) ? '#ef4444' : '#f59e0b'}
                  >
                    <title>
                      {incompleteMonths.includes(m) && (isRptRctGangguan || isApktMetric)
                        ? `Bulan ${fmtMonth(m)}: Bulan berjalan, data APKT belum final`
                        : incompleteMonths.includes(m)
                        ? `Bulan ${fmtMonth(m)}: Data DIFI kemungkinan belum lengkap`
                        : `Bulan ${fmtMonth(m)}: ${unitsReporting[idx] || 0} dari ${unitsExpected} ULP`}
                    </title>
                  </circle>
                )}

                {/* Label Bulan pada Sumbu X */}
                {(months.length <= 12 || (months.length <= 24 ? idx % 2 === 0 : idx % 3 === 0) || idx === months.length - 1 || isHovered) && (
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
function CompanionSection({ companions, toMonth, metricCode }) {
  if (!companions || !companions.series || companions.series.length === 0) return null

  const isKwhP2tl = metricCode === 'kwh-p2tl' || String(companions.source || '').toLowerCase().includes('potret')
  const isAp2t = String(companions.source || '').toUpperCase().includes('AP2T')

  return (
    <div className={`${CARD} p-5 space-y-4`}>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Data Penjelas Operasional
            </h3>
            <span className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${
              isAp2t
                ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                : 'bg-sky-50 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300 border border-sky-200 dark:border-sky-800'
            }`}>
              {isAp2t ? 'AP2T' : companions.source || 'Operasional DISTRIVA'}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {isKwhP2tl
              ? companions.source || 'Penetapan tagihan susulan yang belum realisasi dari AP2T dan kontrol 309 EIS.'
              : 'Data operasional lapangan sebagai pembanding dan penjelas pergerakan angka resmi laporan PLN.'}
          </p>
        </div>
        {toMonth && (
          <span className="text-[11px] font-mono text-slate-500 bg-slate-50 dark:bg-slate-800 px-2.5 py-1 rounded-md self-start sm:self-auto">
            Posisi s/d {fmtMonth(toMonth)}
          </span>
        )}
      </div>

      {isKwhP2tl && (
        <div className="p-3 bg-amber-50/80 dark:bg-amber-950/40 border border-amber-200/80 dark:border-amber-800 rounded-xl text-xs text-amber-900 dark:text-amber-200 flex items-start gap-2.5">
          <span className="font-bold text-amber-600 dark:text-amber-400 shrink-0">ℹ</span>
          <p className="leading-relaxed">
            Potret per tanggal tarik: bulan lama hanya memuat sisa yang belum terealisasi; bukan angka bulan penuh dan tidak dibandingkan dengan tahun lalu.
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {companions.series.map((s) => {
          const isPotret = s.key.includes('belum')
          return (
            <div
              key={s.key}
              className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 flex flex-col justify-between"
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600 dark:text-slate-400">
                    {s.name}
                  </span>
                  {isPotret && (
                    <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 font-semibold shrink-0">
                      Potret
                    </span>
                  )}
                </div>
                <div className="mt-2 text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
                  {s.latest !== null && s.latest !== undefined ? fmtFloat(s.latest) : 'Belum ditarik'}{' '}
                  {s.latest !== null && s.latest !== undefined && (
                    <span className="text-xs font-normal text-slate-500">{s.unit}</span>
                  )}
                </div>
              </div>

              <div className="mt-3 pt-2.5 border-t border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-xs text-slate-500">
                <span className="text-[11px] text-slate-400">Kumulatif YTD</span>
                <span className="font-semibold text-slate-700 dark:text-slate-300 tabular-nums">
                  {s.unit === 'menit' || s.key?.startsWith('rpt_') || s.key?.startsWith('rct_')
                    ? '-'
                    : s.ytd !== null && s.ytd !== undefined ? fmtFloat(s.ytd) : '-'}{' '}
                  <span className="text-[10px] font-normal text-slate-400">
                    {s.unit === 'menit' || s.key?.startsWith('rpt_') || s.key?.startsWith('rct_') || s.ytd === null || s.ytd === undefined ? '' : s.unit}
                  </span>
                </span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/** Komponen Rekonsiliasi Angka Resmi vs Data Operasional */
function ReconciliationSection({ reconciliations, unitsExpected = 1, metricCode = '', incompleteMonths = [] }) {
  const [recPages, setRecPages] = useState({})
  const [recPerPages, setRecPerPages] = useState({})

  const list = reconciliations || []
  if (list.length === 0) return null

  return (
    <div className="space-y-4">
      {list.map((rec) => {
        const isNet = rec.mode === 'net'
        const isYoy = rec.mode === 'yoy'
        const isAvg = rec.mode === 'avg'
        const ytd = rec.ytd
        const monthly = rec.monthly || []

        const pageKey = rec.key || 'default'
        const currentPage = recPages[pageKey] || 1
        const perPage = recPerPages[pageKey] || 12
        const start = (currentPage - 1) * perPage
        const paginatedMonthly = monthly.slice(start, start + perPage)

        // Judul & Badge mode
        const modeBadge = isNet ? (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
            Mode Saldo Bersih (Net)
          </span>
        ) : isYoy ? (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
            Mode Kenaikan Tahunan (YoY)
          </span>
        ) : isAvg ? (
          <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-violet-50 text-violet-700 dark:bg-violet-950/60 dark:text-violet-300 border border-violet-200 dark:border-violet-800">
            Mode Rata-rata Tertimbang (Avg)
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

            {/* Catatan Keterangan Seri Khusus (misal SAIDI/SAIFI dan ENS DIFI vs Bagian Penyulang) */}
            {metricCode === 'saidi-saifi' && (
              <div className="p-3 bg-blue-50/70 dark:bg-blue-950/40 rounded-xl border border-blue-200/80 dark:border-blue-900/60 text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2">
                <IconInfo size={16} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
                <span className="leading-relaxed">
                  Angka utama <strong>SAIDI &amp; SAIFI</strong> merupakan capaian total Laporan DIFI (memuat padam JTR, sambungan rumah, dan pemeliharaan untuk ukuran NKO). Seri <strong>SAIDI/SAIFI karena gangguan penyulang</strong> dan perbandingan rekonsiliasi DISTRIVA berfokus spesifik pada gangguan fasilitas Gardu Induk 20 kV &amp; Penyulang.
                </span>
              </div>
            )}
            {metricCode === 'ens' && (
              <div className="p-3 bg-blue-50/70 dark:bg-blue-950/40 rounded-xl border border-blue-200/80 dark:border-blue-900/60 text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2">
                <IconInfo size={16} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
                <span className="leading-relaxed">
                  Angka utama <strong>ENS</strong> mencakup TOTAL KELOMPOK Distribusi Laporan DIFI. Seri <strong>ENS gangguan penyulang</strong> dan rekonsiliasinya disandingkan dengan kalkulasi energi tak tersalurkan dari spreadsheet gangguan penyulang.
                </span>
              </div>
            )}
            {metricCode === 'gangguan' && (
              <div className="p-3 bg-blue-50/70 dark:bg-blue-950/40 rounded-xl border border-blue-200/80 dark:border-blue-900/60 text-xs text-blue-800 dark:text-blue-300 flex items-start gap-2">
                <IconInfo size={16} className="mt-0.5 shrink-0 text-blue-600 dark:text-blue-400" />
                <span className="leading-relaxed">
                  Sumber utama adalah <strong>spreadsheet gangguan penyulang</strong> (kejadian PMT &amp; recloser). Seri <strong>dihitung</strong> memuat gangguan di atas ambang menit (standar SAIDI/SAIFI). Data pembanding DIFI tingkat penyulang menampilkan gangguan dan pemeliharaan beserta jumlah pelanggan padam yang terlaporkan pada fasilitas Gardu Induk &amp; Penyulang.
                </span>
              </div>
            )}

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
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-500 block">
                      {isYoy ? 'Kenaikan Resmi YoY (YTD)' : isNet ? 'Tambahan Bersih Resmi (YTD)' : isAvg ? 'Nilai Rata-rata Resmi (YTD)' : 'Nilai Resmi YTD'}
                    </span>
                    {ytd.official_change_pct !== null && ytd.official_change_pct !== undefined && (
                      <span className={`text-[10px] font-semibold tabular-nums px-1.5 py-0.2 rounded ${
                        ytd.official_change_pct > 0 ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}>
                        {ytd.official_change_pct > 0 ? '+' : ''}{fmtFloat(ytd.official_change_pct, 1)}% YoY
                      </span>
                    )}
                  </div>
                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                    {ytd.official_net !== null ? fmtMetricValue(ytd.official_net, rec.unit) : '-'}{' '}
                    <span className="text-xs font-normal text-slate-500">{rec.unit}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {ytd.previous_year?.official_net !== null && ytd.previous_year?.official_net !== undefined
                      ? `Th lalu: ${fmtMetricValue(ytd.previous_year.official_net, rec.unit)} (${ytd.previous_year.units_compared} ULP)`
                      : ytd.base_month ? `${fmtMonth(ytd.base_month)} s/d ${fmtMonth(ytd.to_month)}` : ytd.year}
                  </span>
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] font-medium text-slate-500 block">
                      {isYoy ? 'Perkiraan Sumbangan PB (YTD)' : isAvg ? 'Data Pendamping Rata-rata (YTD)' : 'Data Pendamping YTD'}
                    </span>
                    {ytd.companion_change_pct !== null && ytd.companion_change_pct !== undefined && (
                      <span className={`text-[10px] font-semibold tabular-nums px-1.5 py-0.2 rounded ${
                        ytd.companion_change_pct > 0 ? 'bg-sky-50 text-sky-700 dark:bg-sky-950/50 dark:text-sky-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                      }`}>
                        {ytd.companion_change_pct > 0 ? '+' : ''}{fmtFloat(ytd.companion_change_pct, 1)}% YoY
                      </span>
                    )}
                  </div>
                  <div className="text-lg font-bold text-slate-900 dark:text-slate-100 tabular-nums mt-0.5">
                    {ytd.companion !== null ? fmtMetricValue(ytd.companion, rec.unit) : '-'}{' '}
                    <span className="text-xs font-normal text-slate-500">{rec.unit}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {ytd.previous_year?.companion !== null && ytd.previous_year?.companion !== undefined
                      ? `Th lalu: ${fmtMetricValue(ytd.previous_year.companion, rec.unit)}`
                      : `Dari ${ytd.units_compared} ULP setara`}
                  </span>
                </div>

                <div>
                  <span className="text-[11px] font-medium text-slate-500 block">
                    Selisih (Pendamping &minus; Resmi)
                  </span>
                  <div className={`text-lg font-bold tabular-nums mt-0.5 ${
                    ytd.difference > 0 ? 'text-indigo-600 dark:text-indigo-400' : ytd.difference < 0 ? 'text-amber-600 dark:text-amber-400' : 'text-slate-700'
                  }`}>
                    {ytd.difference !== null ? `${ytd.difference > 0 ? '+' : ''}${fmtMetricValue(ytd.difference, rec.unit)}` : '-'}{' '}
                    <span className="text-xs font-normal text-slate-500">{rec.unit}</span>
                  </div>
                  <span className="text-[10px] text-slate-400">
                    {ytd.previous_year?.difference !== null && ytd.previous_year?.difference !== undefined
                      ? `Th lalu: ${ytd.previous_year.difference > 0 ? '+' : ''}${fmtMetricValue(ytd.previous_year.difference, rec.unit)}`
                      : 'Evaluasi kumulatif tahun berjalan'}
                  </span>
                </div>
              </div>
            )}

            {/* Tabel Rincian Rekonsiliasi Bulanan */}
            {monthly.length > 0 && (
              <div className="space-y-3">
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
                      {paginatedMonthly.map((m) => {
                        const diff = m.difference
                        const diffCls = diff > 0
                          ? 'text-indigo-600 dark:text-indigo-400 font-semibold'
                          : diff < 0
                          ? 'text-amber-600 dark:text-amber-400 font-semibold'
                          : 'text-slate-500'

                        return (
                          <tr key={m.month} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                            <td className="py-2 px-3 font-sans font-medium text-slate-800 dark:text-slate-200">
                              <div className="flex items-center gap-1.5">
                                <span>{fmtMonth(m.month)}</span>
                                {incompleteMonths.includes(m.month) && (
                                  <span
                                    title="Data Laporan DIFI bulan ini kemungkinan belum lengkap diisi di APKT"
                                    className="px-1.5 py-0.2 rounded text-[10px] font-semibold bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800 shrink-0"
                                  >
                                    belum lengkap
                                  </span>
                                )}
                              </div>
                            </td>
                            <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300">
                              {m.official_net !== null ? (
                                fmtFloat(m.official_net)
                              ) : (
                                <span className="text-slate-400 font-sans italic text-[11px]" title="Laporan belum tersedia">
                                  Belum ada laporan
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300">
                              {m.companion !== null ? (
                                fmtFloat(m.companion)
                              ) : (
                                <span className="text-slate-400 font-sans italic text-[11px]" title="Data pembanding belum tersedia">
                                  Belum ada
                                </span>
                              )}
                            </td>
                            <td className={`py-2 px-3 text-right ${diffCls}`}>
                              {diff !== null ? (
                                `${diff > 0 ? '+' : ''}${fmtFloat(diff)}`
                              ) : (
                                <span className="text-slate-400 font-sans text-[11px]">-</span>
                              )}
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

                {monthly.length > 6 && (
                  <div className="pt-1">
                    <Pagination
                      page={currentPage}
                      total={monthly.length}
                      perPage={perPage}
                      onPage={(p) => setRecPages((prev) => ({ ...prev, [pageKey]: p }))}
                      onPerPage={(pp) => {
                        setRecPerPages((prev) => ({ ...prev, [pageKey]: pp }))
                        setRecPages((prev) => ({ ...prev, [pageKey]: 1 }))
                      }}
                      perPageOptions={[6, 12, 24, 36]}
                    />
                  </div>
                )}
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

  // State tab utama standar (docs/91 §3c, Butir 14): 'trend' | 'details' | 'reconciliation' | 'forecast' | 'history'
  // Metrik pelanggan mempertahankan sub-tab permohonan 'customer_details'
  const [mainTab, setMainTab] = useState('trend')
  const [exportingExcel, setExportingExcel] = useState(false)

  // State mode tampilan untuk Susut ('trend' | 'inputs')
  const [susutViewMode, setSusutViewMode] = useState('trend')
  // State sub-tab untuk metrik pelanggan & daya ('trend' | 'forecast')
  const [customerTab, setCustomerTab] = useState('trend')
  // State sub-tab untuk metrik gangguan & keandalan ('eis' | 'trend' | 'feeders' | 'forecast')
  const [outageTab, setOutageTab] = useState('eis')
  const [syncDrawerOpen, setSyncDrawerOpen] = useState(false)
  const [outageSyncDrawerOpen, setOutageSyncDrawerOpen] = useState(false)

  // State katalog metrik & unit
  const [catalogState, setCatalogState] = useState({ loading: true, error: '', data: null })

  // State filter & metrik aktif
  const [activeCode, setActiveCode] = useState(metricCode || 'pelanggan')
  const [up3Id, setUp3Id] = useState('')
  const [selectedUnitId, setSelectedUnitId] = useState('')
  const [fromMonth, setFromMonth] = useState('')
  const [toMonth, setToMonth] = useState('')

  // State pagination untuk tabel Rincian Komposisi
  const [breakdownPage, setBreakdownPage] = useState(1)
  const [breakdownPerPage, setBreakdownPerPage] = useState(10)

  // State pagination untuk tabel Rincian Kedua (Secondary)
  const [breakdownSecondaryPage, setBreakdownSecondaryPage] = useState(1)
  const [breakdownSecondaryPerPage, setBreakdownSecondaryPerPage] = useState(10)

  // State pagination untuk tabel Perbandingan ULP
  const [comparisonPage, setComparisonPage] = useState(1)
  const [comparisonPerPage, setComparisonPerPage] = useState(10)
  // State dasar kontribusi sumbangan ULP ('yoy' | 'mom' | 'ytd')
  const [contributionBase, setContributionBase] = useState('yoy')

  // Metrik klasifikasi untuk aksi sinkronisasi spesifik
  const isOutageMetric = activeCode === 'gangguan' || activeCode === 'saidi-saifi' || activeCode === 'ens' || activeCode === 'rpt-rct-gangguan'
  const isKeluhanMetric = activeCode === 'rpt-rct-keluhan'
  const isAnomaliGangguanMetric = activeCode === 'anomali-gangguan'
  const isAnomaliKeluhanMetric = activeCode === 'anomali-keluhan'
  const isKwhP2tlMetric = activeCode === 'kwh-p2tl'
  const isPelunasanPrrMetric = activeCode === 'pelunasan-prr' || activeCode === 'pelunasan-ex-prr'
  const isKontrol309Metric = activeCode === 'kwh-jual' || activeCode === 'pendapatan'
  const isPiutangMetric = activeCode.startsWith('piutang')
  const isEisMetric = isPiutangMetric || activeCode === 'pelanggan' || activeCode === 'daya' || isKontrol309Metric

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
      setMainTab('trend')
    }
  }, [metricCode])

  // Unduh Excel metrik dari /api/pengusahaan/metrics/{code}/export
  const handleExportExcel = async () => {
    if (!effectiveUnitId || !activeCode) return
    setExportingExcel(true)
    try {
      const params = { unit_id: effectiveUnitId }
      if (fromMonth) params.from = fromMonth
      if (toMonth) params.to = toMonth
      const blob = await pengusahaanApi.export(activeCode, params)
      const filename = `PENGUSAHAAN-${activeCode.toUpperCase()}-${fromMonth || d?.from || ''}-${toMonth || d?.to || ''}.xlsx`
      triggerFileDownload(blob, filename)
      notify?.({ message: 'Berkas Excel berhasil diunduh.', type: 'success' })
    } catch (err) {
      notify?.({ message: err?.message || 'Gagal mengunduh berkas Excel.', type: 'error' })
    } finally {
      setExportingExcel(false)
    }
  }

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

  // Helper tombol cepat rentang waktu (docs/91 §4)
  const handleRangePreset = (preset) => {
    const baseTo = toMonth || d?.to || new Date().toISOString().slice(0, 7)
    const [y, m] = baseTo.split('-').map(Number)

    if (preset === 'ytd') {
      // Tahun berjalan: Januari tahun ini sampai bulan laporan
      setFromMonth(`${y}-01`)
      setToMonth(baseTo)
    } else if (preset === '12m') {
      // 12 bulan terakhir: (baseTo - 11 bulan) sampai baseTo
      const dFrom = new Date(y, m - 1 - 11, 1)
      const fromYm = `${dFrom.getFullYear()}-${String(dFrom.getMonth() + 1).padStart(2, '0')}`
      setFromMonth(fromYm)
      setToMonth(baseTo)
    } else if (preset === '24m') {
      // 24 bulan: (baseTo - 23 bulan) sampai baseTo
      const dFrom = new Date(y, m - 1 - 23, 1)
      const fromYm = `${dFrom.getFullYear()}-${String(dFrom.getMonth() + 1).padStart(2, '0')}`
      setFromMonth(fromYm)
      setToMonth(baseTo)
    } else if (preset === 'default') {
      // Reset ke bawaan backend (kosongkan from/to)
      setFromMonth('')
      setToMonth('')
    }
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
    if (activeCode === 'susut' && (mainTab === 'susut_inputs' || susutViewMode === 'inputs') && effectiveUlpId && inputsYear) {
      loadInputsData(effectiveUlpId, inputsYear)
    }
  }, [activeCode, mainTab, susutViewMode, inputsUlpId, ulpUnitsList, inputsYear, loadInputsData])

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
                  {metricCode === 'pelanggan'
                    ? 'Analisa & Tren Pelanggan'
                    : d?.metric?.name
                    ? `Analisa & Tren ${d.metric.name}`
                    : 'Analisa & Tren Pengusahaan'}
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  Laporan &amp; Monitoring
                </span>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  {metricCode === 'pelanggan'
                    ? 'Laporan 309 & Permohonan EIS'
                    : metricCode === 'gangguan'
                    ? 'Spreadsheet Gangguan Penyulang & DIFI'
                    : metricCode === 'saidi-saifi' || metricCode === 'ens'
                    ? 'Laporan DIFI & Data Gangguan'
                    : 'Realisasi EIS'}
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
                  : metricCode === 'gangguan'
                  ? 'Analisa kejadian gangguan penyulang dari spreadsheet gangguan (PMT & recloser, permanen/temporer, serta kejadian yang dihitung) disandingkan dengan laporan DIFI tingkat penyulang (Gardu Induk 20 kV & Penyulang).'
                  : metricCode === 'saidi-saifi'
                  ? 'Realisasi SAIDI (menit/plg) dan SAIFI (kali/plg) dari Laporan DIFI (total ringkasan & bagian gangguan penyulang) serta rekonsiliasi hitungan dari spreadsheet gangguan penyulang.'
                  : metricCode === 'ens'
                  ? 'Energi tidak tersalurkan (MWh) dari Laporan DIFI (total distribusi & gangguan penyulang) disandingkan dengan kalkulasi dari spreadsheet data gangguan.'
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
            {isOutageMetric ? (
              <div className="flex items-center gap-2">
                {activeCode !== 'rpt-rct-gangguan' && (
                  <Button
                    variant="primary"
                    onClick={() => setOutageSyncDrawerOpen(true)}
                    icon={IconRefresh}
                    aria-label="Sinkronisasi Gangguan"
                  >
                    Sinkronisasi Gangguan
                  </Button>
                )}
                <Button
                  variant={activeCode === 'rpt-rct-gangguan' ? 'primary' : 'secondary'}
                  onClick={() => setSyncDrawerOpen(true)}
                  icon={IconRefresh}
                  aria-label={activeCode === 'rpt-rct-gangguan' ? 'Tarik APKT (RPT/RCT)' : 'Tarik SAIDI/SAIFI APKT'}
                >
                  {activeCode === 'rpt-rct-gangguan' ? 'Tarik APKT (RPT/RCT)' : 'Tarik SAIDI/SAIFI APKT'}
                </Button>
              </div>
            ) : isKeluhanMetric ? (
              <Button
                variant="primary"
                onClick={() => setSyncDrawerOpen(true)}
                icon={IconRefresh}
                aria-label="Tarik APKT (RPT/RCT Keluhan)"
              >
                Tarik APKT (RPT/RCT Keluhan)
              </Button>
            ) : isAnomaliGangguanMetric ? (
              <Button
                variant="primary"
                onClick={() => setSyncDrawerOpen(true)}
                icon={IconRefresh}
                aria-label="Tarik APKT (Anomali Gangguan)"
              >
                Tarik APKT (Anomali Gangguan)
              </Button>
            ) : isAnomaliKeluhanMetric ? (
              <Button
                variant="primary"
                onClick={() => setSyncDrawerOpen(true)}
                icon={IconRefresh}
                aria-label="Tarik APKT (Anomali Keluhan)"
              >
                Tarik APKT (Anomali Keluhan)
              </Button>
            ) : isPelunasanPrrMetric ? (
              <Button
                variant="primary"
                onClick={() => setSyncDrawerOpen(true)}
                icon={IconRefresh}
                aria-label="Tarik AP2T (PRR dan Ex PRR)"
              >
                Tarik AP2T (PRR dan Ex PRR)
              </Button>
            ) : isKwhP2tlMetric ? (
              <Button
                variant="primary"
                onClick={() => setSyncDrawerOpen(true)}
                icon={IconRefresh}
                aria-label="Tarik AP2T (kWh P2TL)"
              >
                Tarik AP2T (kWh P2TL)
              </Button>
            ) : isKontrol309Metric ? (
              <Button
                variant="primary"
                onClick={() => setSyncDrawerOpen(true)}
                icon={IconRefresh}
                aria-label="Tarik Kontrol 309 (EIS)"
              >
                Tarik Kontrol 309 (EIS)
              </Button>
            ) : isEisMetric ? (
              <Button
                variant="primary"
                onClick={() => setSyncDrawerOpen(true)}
                icon={IconRefresh}
                aria-label={
                  isPiutangMetric
                    ? 'Sinkronisasi Piutang EIS'
                    : 'Sinkronisasi Permohonan EIS'
                }
              >
                {isPiutangMetric ? 'Sinkronisasi Piutang EIS' : 'Sinkronisasi Permohonan EIS'}
              </Button>
            ) : (
              <Button
                variant="primary"
                onClick={() => setSyncDrawerOpen(true)}
                icon={IconRefresh}
                aria-label="Sinkronisasi Data"
              >
                Sinkronisasi Data
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={handleExportExcel}
              loading={exportingExcel}
              icon={IconDownload}
              aria-label="Unduh Excel"
            >
              Unduh Excel
            </Button>
          </div>
        </div>
      </div>

      {/* Susunan Tab Terstandarisasi di Setiap Menu (docs/91 §3c, Butir 14):
          Tren · Rincian · Rekonsiliasi · Prakiraan · Histori Sinkronisasi
          (Metrik Pelanggan mempertahankan tab "Rincian Permohonan (EIS)" sebagai tab tambahan)
      */}
      <div className="flex items-center gap-6 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        <button
          type="button"
          onClick={() => setMainTab('trend')}
          className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            mainTab === 'trend'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          Tren
        </button>

        {/* Tab Rincian: komposisi kelompok/kogol/umur, matriks, atau perbandingan ULP */}
        {(d?.breakdown || d?.breakdown_secondary || d?.matrix || (isUp3 && d?.comparison?.length > 0)) && (
          <button
            type="button"
            onClick={() => setMainTab('details')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              mainTab === 'details'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Rincian
          </button>
        )}

        {/* Tab Rekonsiliasi: angka resmi vs data pendamping lapangan */}
        {(d?.reconciliations?.length > 0 || d?.reconciliation || d?.companions) && (
          <button
            type="button"
            onClick={() => setMainTab('reconciliation')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              mainTab === 'reconciliation'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Rekonsiliasi
          </button>
        )}

        {/* Tab Rincian Permohonan (EIS) khusus Pelanggan */}
        {activeCode === 'pelanggan' && (
          <button
            type="button"
            onClick={() => setMainTab('customer_details')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              mainTab === 'customer_details'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Rincian Permohonan (EIS)
          </button>
        )}

        {/* Tab Rincian APKT / Penyulang khusus metrik Gangguan */}
        {(activeCode === 'gangguan' || activeCode === 'saidi-saifi' || activeCode === 'ens') && (
          <>
            {d?.detail?.kind === 'reliability' ? (
              <button
                type="button"
                onClick={() => setMainTab('feeder_detail')}
                className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                  mainTab === 'feeder_detail'
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                Penyulang &amp; Risiko
              </button>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setMainTab('outage_apkt')}
                  className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                    mainTab === 'outage_apkt'
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
                  onClick={() => setMainTab('outage_feeders')}
                  className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                    mainTab === 'outage_feeders'
                      ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                      : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  Penyulang &amp; Gardu
                </button>
              </>
            )}
          </>
        )}

        {/* Tab Masukan kWh Beli & Analisis Susut (Butir 46, 49, 53 docs/92 §6.10) */}
        {activeCode === 'susut' && (
          <>
            <button
              type="button"
              onClick={() => setMainTab('susut_analysis')}
              className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                mainTab === 'susut_analysis'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              Estimasi &amp; Susut Teknis
            </button>
            <button
              type="button"
              onClick={() => setMainTab('susut_inputs')}
              className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer flex items-center gap-1.5 ${
                mainTab === 'susut_inputs'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
              }`}
            >
              <span>Masukan kWh Beli</span>
              {canInput && (
                <span className="px-1.5 py-0.2 rounded bg-blue-100 text-[10px] uppercase font-bold text-blue-700 dark:bg-blue-950/60 dark:text-blue-300">
                  Input
                </span>
              )}
            </button>
          </>
        )}

        {/* Tab Umur & Calon PRR / Pelunasan menurut Umur BLTH (Butir 39 docs/92 §6.4 & §6.5) */}
        {(d?.detail?.kind === 'receivable_aging' || d?.detail?.kind === 'repayment_age' || activeCode === 'piutang-pascabayar-umur' || activeCode === 'piutang-pascabayar' || activeCode === 'pelunasan-prr' || activeCode === 'pelunasan-ex-prr') && (
          <button
            type="button"
            onClick={() => setMainTab('receivable_aging')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              mainTab === 'receivable_aging'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            {d?.detail?.kind === 'repayment_age' || activeCode === 'pelunasan-prr' || activeCode === 'pelunasan-ex-prr'
              ? 'Umur BLTH Pelunasan'
              : 'Umur & Calon PRR'}
          </button>
        )}

        {/* Tab Pemecahan Penjualan (Butir 40 docs/92 §6.2 & §6.3) */}
        {(d?.detail?.kind === 'sales_decomposition' || activeCode === 'kwh-jual' || activeCode === 'pendapatan') && (
          <button
            type="button"
            onClick={() => setMainTab('sales_decomposition')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              mainTab === 'sales_decomposition'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Pemecahan
          </button>
        )}

        {/* Tab Perbandingan ULP untuk RPT-RCT (Butir 42 docs/92 §6.7) */}
        {(d?.detail?.kind === 'response' || activeCode === 'rpt-rct-gangguan' || activeCode === 'rpt-rct-keluhan') && (
          <button
            type="button"
            onClick={() => setMainTab('response_comparison')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              mainTab === 'response_comparison'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Perbandingan ULP
          </button>
        )}

        {/* Tab Per ULP untuk Anomali Gangguan & Keluhan (Butir 43 docs/92 §6.8) */}
        {(d?.detail?.kind === 'anomaly' || activeCode === 'anomali-gangguan' || activeCode === 'anomali-keluhan') && (
          <button
            type="button"
            onClick={() => setMainTab('anomaly_ulp')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              mainTab === 'anomaly_ulp'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Per ULP
          </button>
        )}

        {/* Tab Penetapan & Realisasi untuk kWh P2TL (Butir 44 docs/92 §6.9) */}
        {(d?.detail?.kind === 'p2tl' || activeCode === 'kwh-p2tl') && (
          <button
            type="button"
            onClick={() => setMainTab('p2tl_funnel')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              mainTab === 'p2tl_funnel'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Penetapan &amp; Realisasi
          </button>
        )}

        {/* Tab Kasus Besar & Antrean untuk HPL Biaya BP (Butir 45 docs/92 §6.11) */}
        {(d?.detail?.kind === 'connection_fee' || activeCode === 'hpl-bp') && (
          <button
            type="button"
            onClick={() => setMainTab('bp_queue')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              mainTab === 'bp_queue'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Kasus Besar &amp; Antrean
          </button>
        )}

        {/* Tab Pertumbuhan untuk Pelanggan & Daya (Butir 51 docs/92 §6.1) */}
        {(d?.detail?.kind === 'customer_growth' || activeCode === 'pelanggan' || activeCode === 'daya') && (
          <button
            type="button"
            onClick={() => setMainTab('customer_growth')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              mainTab === 'customer_growth'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Pertumbuhan
          </button>
        )}

        {/* Tab Pertumbuhan untuk kWh Jual, Pendapatan, dan Pendapatan BP */}
        {(activeCode === 'kwh-jual' || activeCode === 'pendapatan' || activeCode === 'hpl-bp') && (
          <button
            type="button"
            onClick={() => setMainTab('growth_analysis')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              mainTab === 'growth_analysis'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Pertumbuhan
          </button>
        )}

        {/* Tab Tunggakan & Pelunasan untuk Piutang Prabayar (Butir 52 docs/92 §6.4) */}
        {(d?.detail?.kind === 'prepaid_receivable' || activeCode === 'piutang-prabayar') && (
          <button
            type="button"
            onClick={() => setMainTab('prepaid_receivable')}
            className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
              mainTab === 'prepaid_receivable'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            Tunggakan &amp; Pelunasan
          </button>
        )}

        {/* Tab Prakiraan Terpadu */}
        <button
          type="button"
          onClick={() => setMainTab('forecast')}
          className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            mainTab === 'forecast'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          Prakiraan
        </button>

        {/* Tab Histori Sinkronisasi */}
        <button
          type="button"
          onClick={() => setMainTab('history')}
          className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            mainTab === 'history'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          Histori Sinkronisasi
        </button>
      </div>

      {/* Tampilan Khusus Tab Rincian Permohonan EIS Pelanggan */}
      {activeCode === 'pelanggan' && mainTab === 'customer_details' ? (
        <div className="pt-2">
          <CustomerAnalysisContent
            hideHeader={true}
            hideTabs={true}
            forcedTab="trend"
            permission="pengusahaan.view"
          />
        </div>
      ) : (activeCode === 'gangguan' || activeCode === 'saidi-saifi' || activeCode === 'ens') && mainTab === 'outage_apkt' ? (
        <div className="pt-2">
          <OutageAnalysisContent
            hideHeader={true}
            hideTabs={true}
            defaultTab="trend"
            forcedMetric={activeCode}
          />
        </div>
      ) : (activeCode === 'gangguan' || activeCode === 'saidi-saifi' || activeCode === 'ens') && mainTab === 'outage_feeders' ? (
        <div className="pt-2">
          <OutageAnalysisContent
            hideHeader={true}
            hideTabs={true}
            defaultTab="feeders"
            forcedMetric={activeCode}
          />
        </div>
      ) : mainTab === 'forecast' ? (
        <div className="pt-2 space-y-6">
          <BusinessForecastTab
            metricCode={activeCode}
            unitId={effectiveUnitId}
          />
        </div>
      ) : mainTab === 'history' ? (
        <div className="pt-2 space-y-6">
          <BusinessHistoryTab
            metricCode={activeCode}
            unitId={effectiveUnitId}
          />
        </div>
      ) : (
      <>
      {/* Filter Bar Terstandarisasi (UP3, ULP, Dari bulan, Sampai bulan) - Auto-reload tanpa tombol cepat & terapkan (docs/91 §3c, Butir 14) */}
      {!(activeCode === 'susut' && mainTab === 'susut_inputs') && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-3">
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
              <button
                type="button"
                onClick={() => {
                  setFromMonth('')
                  setToMonth('')
                }}
                className="text-xs text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
              >
                Reset Bawaan
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {d?.from && d?.to && (
              <span className="text-xs font-mono text-slate-500 dark:text-slate-400">
                Periode: {fmtMonth(d.from)} &ndash; {fmtMonth(d.to)}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Tampilan Tab 2: Masukan kWh Beli (Hanya saat activeCode === 'susut' && (mainTab === 'susut_inputs' || susutViewMode === 'inputs')) */}
      {activeCode === 'susut' && (mainTab === 'susut_inputs' || susutViewMode === 'inputs') ? (
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
          {/* Warnings List (Pita Peringatan Kelengkapan Data DIFI dll, docs/91 §3 & Butir 19) */}
          {Array.isArray(d.warnings) && d.warnings.length > 0 && (
            <div className="space-y-2.5">
              {d.warnings.map((w, idx) => {
                const isWarn = w.severity === 'warning'
                const borderCls = isWarn
                  ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-300 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                  : 'bg-blue-50 dark:bg-blue-950/40 border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200'

                return (
                  <div
                    key={idx}
                    className={`p-4 rounded-xl border text-xs flex items-start gap-3 shadow-xs ${borderCls}`}
                  >
                    <IconAlertCircle
                      size={18}
                      className={`mt-0.5 shrink-0 ${isWarn ? 'text-amber-600 dark:text-amber-400' : 'text-blue-600 dark:text-blue-400'}`}
                    />
                    <div className="space-y-1">
                      <div className="font-bold flex items-center gap-2 flex-wrap">
                        <span>Peringatan Data Laporan:</span>
                        {w.month && (
                          <span className="px-2 py-0.2 rounded text-[10px] font-mono font-semibold bg-amber-200/60 dark:bg-amber-900/60 text-amber-900 dark:text-amber-200">
                            Bulan {fmtMonth(w.month)}
                          </span>
                        )}
                      </div>
                      <p className="leading-relaxed font-sans">{w.message}</p>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

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

          {/* Empat Kartu KPI Standar DISTRIVA (docs/91 §4, docs/92 §3):
              1. Nilai resmi terakhir (summary[0]) dengan MoM & YoY
              2. Kumulatif lawan target NKO (targets[0], capaian %, status aman/waspada/tertinggal)
              3. Lawan tahun lalu dari summary[0] (YTD vs ytd_previous_year / YoY YTD)
              4. Laju yang dibutuhkan: remaining_per_month vs current_per_month (disembunyikan bila null, fallback ke pendamping/rekonsiliasi)
              Khusus rpt-rct-gangguan (butir 25): dua varian berdampingan bila belum ada targets
          */}
          {(() => {
            if (activeCode === 'rpt-rct-gangguan' && (!d.targets || d.targets.length === 0)) {
              const sMap = (d.summary || []).reduce((acc, s) => {
                acc[s.key] = s
                return acc
              }, {})

              const rptAll = sMap['rpt']
              const rctAll = sMap['rct']
              const woAll = sMap['jumlah']
              const rptNct = sMap['rpt_tanpa_ct']
              const rctNct = sMap['rct_tanpa_ct']
              const woNct = sMap['jumlah_tanpa_ct']
              const pctCt = sMap['porsi_clear_temper']

              return (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Kartu 1: RPT (Semua Laporan vs Tanpa Clear Temper) */}
                  <div className={`${CARD} p-4 flex flex-col justify-between`}>
                    <div>
                      <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span className="truncate pr-2 font-bold text-slate-700 dark:text-slate-300">RPT (Response Time)</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 shrink-0 font-semibold">
                          Semua Laporan
                        </span>
                      </div>

                      <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                        {fmtMetricValue(rptAll?.latest, 'menit')}{' '}
                        <span className="text-sm font-normal text-slate-500">menit</span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <PolarityPctBadge pct={rptAll?.mom_pct} polarity="down" label="MoM" />
                        <PolarityPctBadge pct={rptAll?.yoy_pct} polarity="down" label="YoY" />
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">Tanpa Clear Temper:</span>
                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                          {fmtMetricValue(rptNct?.latest, 'menit')} menit
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Kartu 2: RCT (Semua Laporan vs Tanpa Clear Temper) */}
                  <div className={`${CARD} p-4 flex flex-col justify-between`}>
                    <div>
                      <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span className="truncate pr-2 font-bold text-slate-700 dark:text-slate-300">RCT (Recovery Time)</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 shrink-0 font-semibold">
                          Semua Laporan
                        </span>
                      </div>

                      <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                        {fmtMetricValue(rctAll?.latest, 'menit')}{' '}
                        <span className="text-sm font-normal text-slate-500">menit</span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <PolarityPctBadge pct={rctAll?.mom_pct} polarity="down" label="MoM" />
                        <PolarityPctBadge pct={rctAll?.yoy_pct} polarity="down" label="YoY" />
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">Tanpa Clear Temper:</span>
                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                          {fmtMetricValue(rctNct?.latest, 'menit')} menit
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Kartu 3: Jumlah WO Gangguan */}
                  <div className={`${CARD} p-4 flex flex-col justify-between`}>
                    <div>
                      <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span className="truncate pr-2 font-bold text-slate-700 dark:text-slate-300">Jumlah WO Gangguan</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 shrink-0">
                          {fmtMonth(d.to)}
                        </span>
                      </div>

                      <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                        {fmtMetricValue(woAll?.latest, 'kali')}{' '}
                        <span className="text-sm font-normal text-slate-500">kali</span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        <PolarityPctBadge pct={woAll?.mom_pct} polarity="down" label="MoM" />
                        <PolarityPctBadge pct={woAll?.yoy_pct} polarity="down" label="YoY" />
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] text-slate-500">Tanpa Clear Temper:</span>
                        <span className="font-mono font-semibold text-slate-700 dark:text-slate-200">
                          {fmtMetricValue(woNct?.latest, 'kali')} kali
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Kartu 4: Porsi WO Clear Temper */}
                  <div className={`${CARD} p-4 flex flex-col justify-between`}>
                    <div>
                      <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span className="truncate pr-2 font-bold text-slate-700 dark:text-slate-300">Porsi Clear Temper</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 shrink-0 border border-amber-200 dark:border-amber-800 font-semibold">
                          Selisih Varian
                        </span>
                      </div>

                      <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                        {pctCt?.latest !== null && pctCt?.latest !== undefined ? `${fmtFloat(pctCt.latest, 1)}%` : '-'}{' '}
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                        <span>Porsi kejadian dengan clear temper</span>
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">Sumber Data</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200">
                        APKT (2 Varian)
                      </span>
                    </div>
                  </div>
                </div>
              )
            }

            const t0 = d.targets?.[0]
            const s0 = d.summary?.[0]
            const meta0 = d.series?.[0]
            const polarity = d.metric?.polarity || 'up'
            const isPositionMetric = d.metric?.ytd_mode === 'last'

            // Kartu 1: Nilai Resmi Terakhir
            const card1 = {
              title: meta0?.name || d.metric?.name || 'Realisasi Terakhir',
              badge: fmtMonth(d.to),
              value: fmtMetricValue(s0?.latest, meta0?.unit),
              unit: meta0?.unit,
              mom: s0?.mom_pct,
              yoy: s0?.yoy_pct,
              footerLabel: isPositionMetric ? 'Posisi Saldo Akhir' : 'Arus Bulan Berjalan',
            }

            // Kartu 2: Kumulatif Lawan Target NKO
            // docs/92: target kumulatif bulan to, realisasi, pencapaian_pct, status, keterangan realisasi_source, validated, combined
            let card2 = null
            if (t0) {
              const statusColor = t0.status === 'aman'
                ? 'text-emerald-700 bg-emerald-50 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : t0.status === 'waspada'
                ? 'text-amber-700 bg-amber-50 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800'
                : t0.status === 'tertinggal'
                ? 'text-rose-700 bg-rose-50 dark:bg-rose-950/60 dark:text-rose-300 border-rose-200 dark:border-rose-800'
                : 'text-slate-600 bg-slate-100 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700'

              card2 = {
                title: t0.name ? `Target NKO: ${t0.name}` : 'Target NKO',
                badge: `Target ${fmtMonth(t0.month || d.to)}`,
                value: t0.realisasi !== null && t0.realisasi !== undefined ? fmtMetricValue(t0.realisasi, t0.unit_label) : '-',
                targetVal: t0.target !== null && t0.target !== undefined ? fmtMetricValue(t0.target, t0.unit_label) : (t0.target_text || '-'),
                unit: t0.unit_label || meta0?.unit,
                pencapaian: t0.pencapaian_pct,
                status: t0.status,
                statusColor,
                source: t0.realisasi_source,
                validated: t0.validated,
                combined: t0.combined,
              }
            } else {
              // Fallback jika tidak ada targets: gunakan akumulasi YTD standar
              const rec0 = d.reconciliations?.[0] || d.reconciliation
              let card2Value = null
              let card2Unit = meta0?.unit
              let card2Pct = null
              let card2Label = 'Pertumbuhan YTD'
              let card2Prev = null

              if (isPositionMetric && rec0?.ytd) {
                card2Label = 'Tambahan Bersih YTD'
                card2Value = fmtMetricValue(rec0.ytd.official_net, rec0.unit)
                card2Unit = rec0.unit
                card2Pct = rec0.ytd.official_change_pct
                card2Prev = rec0.ytd.previous_year?.official_net !== null && rec0.ytd.previous_year?.official_net !== undefined
                  ? fmtMetricValue(rec0.ytd.previous_year.official_net, rec0.unit)
                  : null
              } else if (s0) {
                card2Label = `Kumulatif ${d.metric?.ytd_mode === 'sum' ? 'YTD' : 'Tertimbang'}`
                card2Value = fmtMetricValue(s0.ytd, meta0?.unit)
                card2Pct = s0.ytd_pct
                card2Prev = s0.ytd_previous_year !== null && s0.ytd_previous_year !== undefined
                  ? fmtMetricValue(s0.ytd_previous_year, meta0?.unit)
                  : null
              }
              card2 = {
                title: card2Label,
                badge: `YTD ${d.to?.slice(0, 4)}`,
                value: card2Value,
                unit: card2Unit,
                pencapaian: null,
                card2Pct,
                card2Prev,
                footerLabel: isPositionMetric ? 'Selisih vs Des Th Lalu' : 'Akumulasi Jan s/d Saat Ini',
              }
            }

            // Kartu 3: Lawan Tahun Lalu (dari summary[0])
            const card3 = {
              title: isPositionMetric ? 'Perubahan vs Th Lalu' : `Kumulatif Th Lalu (${d.to?.slice(0, 4) - 1 || 'Prev'})`,
              badge: `YoY ${fmtMonth(d.to)}`,
              value: s0?.ytd !== null && s0?.ytd !== undefined ? fmtMetricValue(s0.ytd, meta0?.unit) : '-',
              prevValue: s0?.ytd_previous_year !== null && s0?.ytd_previous_year !== undefined ? fmtMetricValue(s0.ytd_previous_year, meta0?.unit) : '-',
              unit: meta0?.unit,
              pct: s0?.ytd_pct,
              footerLabel: 'Perbandingan Kumulatif',
              footerValue: s0?.ytd_previous_year !== null && s0?.ytd_previous_year !== undefined ? `Th lalu: ${fmtMetricValue(s0.ytd_previous_year, meta0?.unit)}` : 'Hanya ULP setara',
            }

            // Kartu 4: Laju yang dibutuhkan (remaining_per_month vs current_per_month)
            // Sembunyikan bila remaining_per_month null, fallback ke pendamping/rekonsiliasi bila ada
            let card4 = null
            if (t0 && t0.remaining_per_month !== null && t0.remaining_per_month !== undefined) {
              const req = t0.remaining_per_month
              const cur = t0.current_per_month
              const unit = t0.unit_label || meta0?.unit
              const isUpGood = (t0.polarity || polarity) === 'up'
              const paceOk = isUpGood ? (cur !== null && cur >= req) : (cur !== null && cur <= req)
              const paceBadgeColor = paceOk
                ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800'
                : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border-amber-200 dark:border-amber-800'

              card4 = {
                title: isUpGood ? 'Kebutuhan Sisa Bulan' : 'Sisa Anggaran per Bulan',
                badge: paceOk ? 'Laju Sesuai' : 'Perlu Dikejar',
                badgeColor: paceBadgeColor,
                value: fmtMetricValue(req, unit),
                unit,
                curValue: cur !== null ? fmtMetricValue(cur, unit) : '-',
                targetYearEnd: t0.target_year_end !== null ? fmtMetricValue(t0.target_year_end, unit) : null,
                footerLabel: 'Laju Saat Ini',
                footerValue: `Rata-rata: ${fmtMetricValue(cur, unit)}/bln`,
              }
            } else {
              // Fallback ke Pendamping Utama atau Rekonsiliasi
              const rec0 = d.reconciliations?.[0] || d.reconciliation
              const comp0 = d.companions?.series?.[0]
              const s1 = d.summary?.[1]
              const meta1 = d.series?.[1]

              if (comp0) {
                const comp0Source = isKwhP2tlMetric ? 'AP2T (Potret)' : (d.companions.source || 'Operasional')
                card4 = {
                  title: comp0.name,
                  badge: comp0Source,
                  value: comp0.latest !== null && comp0.latest !== undefined ? fmtMetricValue(comp0.latest, comp0.unit) : 'Belum ditarik',
                  unit: comp0.latest !== null && comp0.latest !== undefined ? comp0.unit : '',
                  footerLabel: 'Kumulatif YTD',
                  footerValue: comp0.ytd !== null && comp0.ytd !== undefined ? `${fmtMetricValue(comp0.ytd, comp0.unit)} ${comp0.unit}` : '-',
                }
              } else if (rec0?.ytd) {
                const diff = rec0.ytd.difference
                const diffSign = diff > 0 ? '+' : ''
                card4 = {
                  title: 'Selisih Rekonsiliasi YTD',
                  badge: rec0.mode === 'yoy' ? 'Perkiraan' : rec0.mode === 'net' ? 'Net' : 'Flow',
                  value: diff !== null && diff !== undefined ? `${diffSign}${fmtMetricValue(diff, rec0.unit)}` : '-',
                  unit: rec0.unit,
                  footerLabel: `Cakupan ${rec0.ytd.units_compared} ULP`,
                  footerValue: rec0.note || 'Data resmi vs lapangan',
                }
              } else if (s1 && meta1) {
                card4 = {
                  title: meta1.name,
                  badge: 'Seri Resmi 2',
                  value: fmtMetricValue(s1.latest, meta1.unit),
                  unit: meta1.unit,
                  footerLabel: 'Kumulatif YTD',
                  footerValue: `${fmtMetricValue(s1.ytd, meta1.unit)} ${meta1.unit}`,
                }
              }
            }

            return (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {/* Kartu 1: Nilai Resmi Terakhir */}
                <div className={`${CARD} p-4 flex flex-col justify-between`}>
                  <div>
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                      <span className="truncate pr-2 font-semibold text-slate-700 dark:text-slate-300">{card1.title}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 shrink-0">
                        {card1.badge}
                      </span>
                    </div>

                    <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                      {card1.value}{' '}
                      <span className="text-sm font-normal text-slate-500">
                        {card1.unit}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <PolarityPctBadge pct={card1.mom} polarity={polarity} label="MoM" />
                      <PolarityPctBadge pct={card1.yoy} polarity={polarity} label="YoY" />
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">{card1.footerLabel}</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200">
                      Resmi ({d.metric?.source?.split('(')[0]?.trim() || 'PLN'})
                    </span>
                  </div>
                </div>

                {/* Kartu 2: Kumulatif Lawan Target NKO */}
                <div className={`${CARD} p-4 flex flex-col justify-between`}>
                  <div>
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                      <span className="truncate pr-2 font-semibold text-slate-700 dark:text-slate-300" title={card2.title}>{card2.title}</span>
                      {card2.status ? (
                        <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold shrink-0 uppercase border ${card2.statusColor}`}>
                          {card2.status}
                        </span>
                      ) : (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 shrink-0">
                          {card2.badge}
                        </span>
                      )}
                    </div>

                    <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                      {card2.value}{' '}
                      <span className="text-sm font-normal text-slate-500">
                        {card2.unit}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {card2.pencapaian !== null && card2.pencapaian !== undefined ? (
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-xs font-bold tabular-nums border ${card2.statusColor}`}>
                          {fmtFloat(card2.pencapaian, 1)}% capaian
                          {card2.status && (
                            <span className="ml-1 text-[10px] uppercase font-semibold">
                              ({card2.status})
                            </span>
                          )}
                        </span>
                      ) : card2.card2Pct !== undefined && card2.card2Pct !== null ? (
                        <PolarityPctBadge pct={card2.card2Pct} polarity={polarity} label="YoY YTD" />
                      ) : (
                        <span className="text-xs text-slate-400">Realisasi belum tersedia</span>
                      )}

                      {card2.targetVal && (
                        <span className="text-[11px] text-slate-500 dark:text-slate-400">
                          Target: {card2.targetVal}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between flex-wrap gap-1">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {card2.source && (
                        <span className="text-[10px] px-1 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 font-mono">
                          {card2.source}
                        </span>
                      )}
                      {card2.validated === false && (
                        <span className="text-[10px] text-amber-600 dark:text-amber-400 font-medium" title="Realisasi sistem belum tervalidasi terhadap workbook">
                          &bull; Belum tervalidasi
                        </span>
                      )}
                      {card2.combined && (
                        <span className="text-[10px] text-purple-600 dark:text-purple-400 font-medium" title="Realisasi gabungan beberapa menu">
                          &bull; Gabungan beberapa menu
                        </span>
                      )}
                    </div>
                    <span className="text-[11px] text-slate-400">
                      {card2.footerLabel || `Target s.d. ${fmtMonth(d.to)}`}
                    </span>
                  </div>
                </div>

                {/* Kartu 3: Lawan Tahun Lalu */}
                <div className={`${CARD} p-4 flex flex-col justify-between`}>
                  <div>
                    <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                      <span className="truncate pr-2 font-semibold text-slate-700 dark:text-slate-300">{card3.title}</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 shrink-0">
                        {card3.badge}
                      </span>
                    </div>

                    <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                      {card3.value}{' '}
                      <span className="text-sm font-normal text-slate-500">
                        {card3.unit}
                      </span>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      {card3.pct !== null && card3.pct !== undefined ? (
                        <PolarityPctBadge pct={card3.pct} polarity={polarity} label="YoY YTD" />
                      ) : (
                        <span className="text-xs text-slate-400">-</span>
                      )}
                      {card3.prevValue && card3.prevValue !== '-' && (
                        <span className="text-[11px] text-slate-400">
                          Th lalu: {card3.prevValue}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                    <span className="text-[11px] text-slate-400">{card3.footerLabel}</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-200 text-[11px]">
                      {card3.footerValue}
                    </span>
                  </div>
                </div>

                {/* Kartu 4: Laju yang Dibutuhkan / Pendamping */}
                {card4 ? (
                  <div className={`${CARD} p-4 flex flex-col justify-between`}>
                    <div>
                      <div className="flex items-center justify-between text-xs font-medium text-slate-500 dark:text-slate-400">
                        <span className="truncate pr-2 font-semibold text-slate-700 dark:text-slate-300" title={card4.title}>{card4.title}</span>
                        {card4.badge && (
                          <span className={`text-[10px] px-1.5 py-0.2 rounded font-semibold shrink-0 border ${card4.badgeColor || 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}>
                            {card4.badge}
                          </span>
                        )}
                      </div>

                      <div className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
                        {card4.value}{' '}
                        <span className="text-sm font-normal text-slate-500">
                          {card4.unit}
                        </span>
                      </div>

                      <div className="mt-3 flex flex-wrap items-center gap-2">
                        {card4.curValue && (
                          <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                            Laju saat ini: {card4.curValue}/bln
                          </span>
                        )}
                        {card4.targetYearEnd && (
                          <span className="text-[11px] text-slate-400">
                            (Target akhir th: {card4.targetYearEnd})
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-xs text-slate-500 dark:text-slate-400 flex items-center justify-between">
                      <span className="text-[11px] text-slate-400">{card4.footerLabel || 'Target NKO'}</span>
                      <span className="font-semibold text-slate-700 dark:text-slate-200 text-[11px] truncate max-w-[150px]" title={card4.footerValue}>
                        {card4.footerValue || '-'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className={`${CARD} p-4 flex flex-col justify-between opacity-60`}>
                    <span className="text-xs text-slate-400 font-semibold">Laju Kebutuhan</span>
                    <p className="text-xs text-slate-400 mt-2">Target NKO tahunan tidak memerlukan laju bulanan khusus.</p>
                    <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-400">-</div>
                  </div>
                )}
              </div>
            )
          })()}

          {/* Bagian Diagnosis Otomatis (docs/92 §3 butir 3, Butir 36) */}
          {d.diagnosis && d.diagnosis.length > 0 && (
            <div className={`${CARD} p-4 space-y-2.5`}>
              <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                <IconActivity size={16} className="text-indigo-600 dark:text-indigo-400" />
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Diagnosis &amp; Akar Penyebab Otomatis
                </h4>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                {d.diagnosis.map((diag, idx) => {
                  const isKritis = diag.level === 'kritis'
                  const isPerhatian = diag.level === 'perhatian'
                  const boxCls = isKritis
                    ? 'border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/20 text-rose-900 dark:text-rose-200'
                    : isPerhatian
                    ? 'border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/20 text-amber-900 dark:text-amber-200'
                    : 'border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 text-slate-800 dark:text-slate-200'

                  return (
                    <div
                      key={idx}
                      className={`p-3 rounded-xl border text-xs flex items-start gap-2.5 leading-relaxed ${boxCls}`}
                    >
                      {isKritis ? (
                        <IconAlertCircle size={16} className="text-rose-600 dark:text-rose-400 shrink-0 mt-0.5" />
                      ) : isPerhatian ? (
                        <IconAlertCircle size={16} className="text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                      ) : (
                        <IconInfo size={16} className="text-slate-500 dark:text-slate-400 shrink-0 mt-0.5" />
                      )}
                      <span>{diag.text}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Tab Konten: Sesuai mainTab ('trend' | 'details' | 'reconciliation') */}
          {mainTab === 'trend' && (
            <>
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
                  incompleteMonths={(d.warnings || []).map((w) => w.month).filter(Boolean)}
                  metricCode={activeCode}
                  events={d.events || []}
                  ytdMode={d.metric?.ytd_mode}
                  targets={d.targets || []}
                />
              </div>

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
            </>
          )}

          {/* Tab Rincian & Komposisi */}
          {mainTab === 'details' && (
            <div className="space-y-6">
              {/* Grid: Rincian (Breakdown) & Perbandingan Antar ULP (Comparison) */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {d.breakdown && (
                  <BreakdownCard
                    breakdown={d.breakdown}
                    polarity={d.metric?.polarity || 'up'}
                    page={breakdownPage}
                    perPage={breakdownPerPage}
                    onPage={setBreakdownPage}
                    onPerPage={setBreakdownPerPage}
                  />
                )}

                {d.breakdown_secondary && (
                  <BreakdownCard
                    breakdown={d.breakdown_secondary}
                    polarity={d.metric?.polarity || 'up'}
                    page={breakdownSecondaryPage}
                    perPage={breakdownSecondaryPerPage}
                    onPage={setBreakdownSecondaryPage}
                    onPerPage={setBreakdownSecondaryPerPage}
                    subtitle={
                      d.breakdown_secondary.dimension === 'Komponen penjualan'
                        ? `Komponen penjualan pada periode ${fmtMonth(d.breakdown_secondary.period || d.to)} (nilai negatif menunjukkan pos pengurangan)`
                        : undefined
                    }
                  />
                )}

                {isUp3 && d.comparison && d.comparison.length > 0 && (
                  <ComparisonCard
                    d={d}
                    activeCode={activeCode}
                    contributionBase={contributionBase}
                    onContributionBaseChange={setContributionBase}
                    page={comparisonPage}
                    perPage={comparisonPerPage}
                    onPage={setComparisonPage}
                    onPerPage={setComparisonPerPage}
                    onSelectUnit={(uid) => setSelectedUnitId(uid)}
                  />
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
            </div>
          )}

          {/* Tab Rekonsiliasi: Data Penjelas & Rekonsiliasi Bulanan + Kumulatif + Note */}
          {mainTab === 'reconciliation' && (
            <div className="space-y-6">
              {/* Data Penjelas Operasional (Companions) */}
              {d.companions && (
                <CompanionSection companions={d.companions} toMonth={d.to} metricCode={activeCode} />
              )}

              {/* Rekonsiliasi Angka Resmi vs Operasional */}
              {(d.reconciliations?.length > 0 || d.reconciliation) && (
                <ReconciliationSection
                  reconciliations={d.reconciliations || (d.reconciliation ? [d.reconciliation] : [])}
                  unitsExpected={unitsExpected}
                  metricCode={activeCode}
                  incompleteMonths={(d.warnings || []).map((w) => w.month).filter(Boolean)}
                />
              )}
            </div>
          )}

          {/* Tab Penyulang & Risiko Keandalan (Butir 38 docs/92 §6.6) */}
          {mainTab === 'feeder_detail' && (
            <ReliabilityFeederTab detail={d.detail} metricCode={activeCode} />
          )}

          {/* Tab Umur & Calon PRR / Pelunasan BLTH (Butir 39 docs/92 §6.4 & §6.5) */}
          {mainTab === 'receivable_aging' && (
            <ReceivableAgingTab detail={d.detail} metricCode={activeCode} />
          )}

          {/* Tab Pemecahan Penjualan (Butir 40 docs/92 §6.2 & §6.3) */}
          {mainTab === 'sales_decomposition' && (
            <SalesDecompositionTab detail={d.detail} metricCode={activeCode} />
          )}

          {/* Tab Estimasi & Susut Teknis (Butir 46, 49, 53 docs/92 §6.10) */}
          {mainTab === 'susut_analysis' && (
            <LossAnalysisTab detail={d.detail} metricCode={activeCode} />
          )}

          {/* Tab Perbandingan ULP (Butir 42 docs/92 §6.7) */}
          {mainTab === 'response_comparison' && (
            <ResponseComparisonTab detail={d.detail} metricCode={activeCode} />
          )}

          {/* Tab Per ULP Anomali (Butir 43 docs/92 §6.8) */}
          {mainTab === 'anomaly_ulp' && (
            <AnomalyAnalysisTab detail={d.detail} metricCode={activeCode} />
          )}

          {/* Tab Penetapan & Realisasi P2TL (Butir 44 docs/92 §6.9) */}
          {mainTab === 'p2tl_funnel' && (
            <P2tlFunnelTab detail={d.detail} metricCode={activeCode} />
          )}

          {/* Tab Kasus Besar & Antrean BP (Butir 45 docs/92 §6.11) */}
          {mainTab === 'bp_queue' && (
            <ConnectionFeeQueueTab detail={d.detail} metricCode={activeCode} />
          )}

          {/* Tab Pertumbuhan Pelanggan/Daya (Butir 51 docs/92 §6.1) */}
          {mainTab === 'customer_growth' && (
            <div className="space-y-6">
              <GrowthAnalysisSection d={d} activeCode={activeCode} isUp3={isUp3} onSelectUnit={(uid) => setSelectedUnitId(uid)} />
              <CustomerGrowthTab detail={d.detail} metricCode={activeCode} />
            </div>
          )}

          {/* Tab Pertumbuhan kWh Jual & Pendapatan BP */}
          {mainTab === 'growth_analysis' && (
            <GrowthAnalysisSection d={d} activeCode={activeCode} isUp3={isUp3} onSelectUnit={(uid) => setSelectedUnitId(uid)} />
          )}

          {/* Tab Tunggakan & Pelunasan Piutang Prabayar (Butir 52 docs/92 §6.4) */}
          {mainTab === 'prepaid_receivable' && (
            <PrepaidReceivableTab detail={d.detail} metricCode={activeCode} />
          )}
        </div>
        )}
      </div>
      )}
      </>
      )}

      {/* Drawer Sinkronisasi Data Gangguan */}
      <OutageSyncDrawer
        open={outageSyncDrawerOpen}
        onClose={() => setOutageSyncDrawerOpen(false)}
        onSynced={() => {
          loadCatalog()
          loadMetricData()
        }}
      />

      {/* Drawer Sinkronisasi Data EIS / APKT / AP2T */}
      <EisSyncDrawer
        open={syncDrawerOpen}
        mode={
          isKontrol309Metric
            ? 'piutang'
            : isPelunasanPrrMetric
            ? 'ap2t'
            : activeCode.startsWith('piutang')
            ? 'piutang'
            : activeCode === 'pelanggan' || activeCode === 'daya'
            ? 'permohonan'
            : activeCode === 'kwh-p2tl'
            ? 'ap2t'
            : activeCode === 'saidi-saifi' || activeCode === 'ens' || activeCode === 'gangguan' || activeCode === 'rpt-rct-gangguan' || activeCode === 'rpt-rct-keluhan' || activeCode === 'anomali-gangguan' || activeCode === 'anomali-keluhan'
            ? 'apkt'
            : null
        }
        initialReports={
          isKontrol309Metric
            ? ['KONTROL309']
            : isPelunasanPrrMetric
            ? (activeCode === 'pelunasan-prr' ? ['pelunasan_prr', 'saldo_prr'] : ['pelunasan_ex_prr', 'hapus_prr'])
            : null
        }
        initialDataset={
          activeCode === 'rpt-rct-gangguan'
            ? 'rpt-rct-gangguan'
            : activeCode === 'rpt-rct-keluhan'
            ? 'rpt-rct-keluhan'
            : activeCode === 'anomali-gangguan'
            ? 'anomali-gangguan'
            : activeCode === 'anomali-keluhan'
            ? 'anomali-keluhan'
            : 'saidi-saifi'
        }
        onClose={() => setSyncDrawerOpen(false)}
        onSynced={() => {
          loadCatalog()
          loadMetricData()
        }}
      />
    </div>
  )
}
