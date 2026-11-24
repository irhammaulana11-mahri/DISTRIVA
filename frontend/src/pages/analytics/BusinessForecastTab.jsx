import { useEffect, useState } from 'react'
import { pengusahaanApi } from '../../services/api.js'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import {
  IconArrowUp,
  IconArrowDown,
  IconInfo,
  IconCheckCircle,
  IconAlertCircle,
  IconChart,
} from '../../components/icons.jsx'
import { fmtInt, fmtNum, fmtPct, monthLabel } from '../../components/TrendCharts.jsx'

/**
 * Visualisasi grafik riwayat 24 bulan + prakiraan 12 bulan dengan pita p10-p90 (SVG interaktif selebar kartu)
 */
function ForecastSeriesChart({ series, polarity = 'up' }) {
  const [hovered, setHovered] = useState(null)

  const history = series.history || []
  const forecast = series.forecast || []
  const allPoints = [...history.map((h) => ({ ...h, isForecast: false })), ...forecast.map((f) => ({ ...f, isForecast: true, value: f.p50 }))]

  if (allPoints.length === 0) return null

  // Cari min dan max untuk sumbu Y
  const vals = []
  history.forEach((h) => vals.push(h.value))
  forecast.forEach((f) => {
    vals.push(f.p10, f.p50, f.p90)
  })
  const minVal = Math.min(...vals.filter((v) => typeof v === 'number' && !Number.isNaN(v)))
  const maxVal = Math.max(...vals.filter((v) => typeof v === 'number' && !Number.isNaN(v)))
  const range = maxVal - minVal || 1
  const pad = range * 0.12
  const yMin = Math.max(0, minVal - pad)
  const yMax = maxVal + pad

  const width = 1000
  const height = 320
  const padLeft = 70
  const padRight = 30
  const padTop = 30
  const padBottom = 40
  const chartW = width - padLeft - padRight
  const chartH = height - padTop - padBottom

  const getX = (idx) => padLeft + (idx / Math.max(1, allPoints.length - 1)) * chartW
  const getY = (v) => padTop + chartH - ((v - yMin) / (yMax - yMin)) * chartH

  // Garis horizontal acuan Y (4 tingkat)
  const yTicks = [0, 0.33, 0.66, 1].map((pct) => yMin + pct * (yMax - yMin))

  // Path pita p10-p90
  const forecastStartIdx = history.length
  let bandPath = ''
  if (forecast.length > 0) {
    const topPoints = []
    const bottomPoints = []
    forecast.forEach((f, i) => {
      const idx = forecastStartIdx + i
      topPoints.push(`${getX(idx).toFixed(1)},${getY(f.p90).toFixed(1)}`)
      bottomPoints.unshift(`${getX(idx).toFixed(1)},${getY(f.p10).toFixed(1)}`)
    })
    bandPath = `M ${topPoints.join(' L ')} L ${bottomPoints.join(' L ')} Z`
  }

  // Path deret riwayat
  let histPath = ''
  history.forEach((h, i) => {
    const x = getX(i).toFixed(1)
    const y = getY(h.value).toFixed(1)
    histPath += i === 0 ? `M ${x},${y}` : ` L ${x},${y}`
  })

  // Path deret prakiraan p50 (disambungkan dari titik riwayat terakhir)
  let fcastPath = ''
  if (history.length > 0 && forecast.length > 0) {
    const lastHistX = getX(history.length - 1).toFixed(1)
    const lastHistY = getY(history[history.length - 1].value).toFixed(1)
    fcastPath = `M ${lastHistX},${lastHistY}`
    forecast.forEach((f, i) => {
      const x = getX(forecastStartIdx + i).toFixed(1)
      const y = getY(f.p50).toFixed(1)
      fcastPath += ` L ${x},${y}`
    })
  }

  return (
    <div className="relative w-full overflow-hidden">
      {/* Legend & Tooltip Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-2 text-xs">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-0.5 bg-blue-600 rounded-full" />
            <span className="text-slate-600 dark:text-slate-400 font-medium">Riwayat Aktual</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3.5 h-0.5 border-t-2 border-dashed border-indigo-500" />
            <span className="text-slate-600 dark:text-slate-400 font-medium">Prakiraan (P50)</span>
          </div>
          <div className="flex items-center gap-1.5">
            <span className="w-3 h-3 bg-indigo-100 dark:bg-indigo-950/60 border border-indigo-200 dark:border-indigo-800 rounded-xs" />
            <span className="text-slate-600 dark:text-slate-400 font-medium">Rentang Ketidakpastian (P10–P90)</span>
          </div>
        </div>

        {hovered && (
          <div className="px-3 py-1 bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 rounded-lg text-xs shadow-md font-mono">
            <span className="font-bold">{hovered.month}</span>: {fmtNum(hovered.value, 1)} {series.unit}
            {hovered.isForecast && (
              <span className="opacity-80 ml-2">
                (P10: {fmtNum(hovered.p10, 1)} · P90: {fmtNum(hovered.p90, 1)})
              </span>
            )}
          </div>
        )}
      </div>

      <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-auto overflow-visible select-none">
        {/* Grid Y & Labels */}
        {yTicks.map((yVal, i) => {
          const yPos = getY(yVal)
          return (
            <g key={i}>
              <line
                x1={padLeft}
                y1={yPos}
                x2={width - padRight}
                y2={yPos}
                stroke="currentColor"
                className="text-slate-200 dark:text-slate-800"
                strokeDasharray="4 4"
              />
              <text
                x={padLeft - 10}
                y={yPos + 4}
                textAnchor="end"
                className="text-[10px] fill-slate-400 dark:fill-slate-500 font-mono"
              >
                {fmtNum(yVal, 0)}
              </text>
            </g>
          )
        })}

        {/* Pemisah Riwayat vs Prakiraan */}
        {forecast.length > 0 && history.length > 0 && (
          <line
            x1={getX(history.length - 1)}
            y1={padTop}
            x2={getX(history.length - 1)}
            y2={padTop + chartH}
            stroke="currentColor"
            className="text-indigo-400 dark:text-indigo-600"
            strokeDasharray="2 2"
          />
        )}

        {/* Pita P10-P90 */}
        {bandPath && (
          <path
            d={bandPath}
            fill="currentColor"
            className="text-indigo-100 dark:text-indigo-950/40 opacity-70"
          />
        )}

        {/* Garis Riwayat */}
        {histPath && (
          <path
            d={histPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-blue-600 dark:text-blue-400"
          />
        )}

        {/* Garis Prakiraan */}
        {fcastPath && (
          <path
            d={fcastPath}
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeDasharray="6 4"
            className="text-indigo-600 dark:text-indigo-400"
          />
        )}

        {/* Titik Interaktif */}
        {allPoints.map((pt, idx) => {
          const x = getX(idx)
          const y = getY(pt.isForecast ? pt.p50 : pt.value)
          const isSelected = hovered?.month === pt.month

          return (
            <g key={pt.month} onMouseEnter={() => setHovered(pt)} onMouseLeave={() => setHovered(null)} className="cursor-pointer">
              <circle
                cx={x}
                cy={y}
                r={isSelected ? 6 : pt.isForecast ? 3.5 : 3}
                fill="currentColor"
                className={pt.isForecast ? 'text-indigo-600 dark:text-indigo-400' : 'text-blue-600 dark:text-blue-400'}
              />
              {/* Invisible touch/hover target */}
              <circle cx={x} cy={y} r={14} fill="transparent" />
            </g>
          )
        })}

        {/* Label Sumbu X dijarangkan (tiap 3 bulan) */}
        {allPoints.map((pt, idx) => {
          if (idx % 3 !== 0 && idx !== allPoints.length - 1) return null
          const x = getX(idx)
          return (
            <text
              key={pt.month}
              x={x}
              y={height - 12}
              textAnchor="middle"
              className={`text-[10px] font-mono ${pt.isForecast ? 'fill-indigo-600 dark:fill-indigo-400 font-semibold' : 'fill-slate-500'}`}
            >
              {monthLabel(pt.month)}
            </text>
          )
        })}
      </svg>
    </div>
  )
}

/**
 * Tab Prakiraan Terpadu (docs/91 §3c, Butir 14):
 * Model musiman bersama dan peredaman tren via uji mundur.
 */
export default function BusinessForecastTab({ metricCode, unitId }) {
  const [state, setState] = useState({ loading: true, error: '', data: null })
  const [selectedSeriesKey, setSelectedSeriesKey] = useState('')

  useEffect(() => {
    let alive = true
    setState({ loading: true, error: '', data: null })

    pengusahaanApi
      .forecast(metricCode, { unit_id: unitId || undefined })
      .then((res) => {
        if (!alive) return
        const d = res?.data || null
        setState({ loading: false, error: '', data: d })
        if (d?.series?.length > 0) {
          setSelectedSeriesKey(d.series[0].key)
        }
      })
      .catch((err) => {
        if (!alive) return
        setState({
          loading: false,
          error: err?.message || 'Gagal memuat data prakiraan pengusahaan.',
          data: null,
        })
      })

    return () => {
      alive = false
    }
  }, [metricCode, unitId])

  if (state.loading) {
    return (
      <div className="py-20 flex justify-center items-center">
        <Spinner />
      </div>
    )
  }

  if (state.error) {
    return <Alert type="error">{state.error}</Alert>
  }

  const d = state.data
  if (!d) return null

  // Kasus data riwayat belum cukup untuk prakiraan model
  if (d.status === 'INSUFFICIENT' || d.status === 'UNAVAILABLE') {
    return (
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-8 text-center space-y-3">
        <div className="w-12 h-12 rounded-xl bg-amber-50 dark:bg-amber-950/40 text-amber-600 flex items-center justify-center mx-auto">
          <IconAlertCircle size={24} />
        </div>
        <h3 className="text-base font-bold text-slate-800 dark:text-slate-100">
          Riwayat Data Belum Memenuhi Syarat Prakiraan
        </h3>
        <p className="max-w-xl mx-auto text-xs sm:text-sm text-slate-500 dark:text-slate-400">
          {d.message ||
            'Prakiraan model musiman memerlukan minimal 24 bulan data riwayat lengkap tanpa celah untuk semua unit di bawah cakupan.'}
        </p>
        {d.series?.length > 0 && (
          <div className="pt-2 text-xs text-slate-400">
            {d.series.map((s) => (
              <div key={s.key}>
                {s.name}: {s.message || `${s.history_months || 0} bulan data tersedia`}
              </div>
            ))}
          </div>
        )}
      </div>
    )
  }

  const activeSeries = d.series?.find((s) => s.key === selectedSeriesKey) || d.series?.[0]
  const target = activeSeries?.target
  const period = activeSeries?.period
  const quality = activeSeries?.quality
  const polarity = d.metric?.polarity || 'up'

  return (
    <div className="space-y-6">
      {/* Series Switcher jika ada lebih dari 1 seri */}
      {d.series?.length > 1 && (
        <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-3 overflow-x-auto">
          {d.series.map((s) => (
            <button
              key={s.key}
              type="button"
              onClick={() => setSelectedSeriesKey(s.key)}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                selectedSeriesKey === s.key
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-200'
              }`}
            >
              {s.name} ({s.unit})
            </button>
          ))}
        </div>
      )}

      {/* Kartu Ringkasan Target & Periode */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {target && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Prakiraan Bulan ke-12 ({monthLabel(target.month)})
            </span>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {fmtNum(target.p50, 1)}
              </span>
              <span className="text-xs text-slate-500">{activeSeries?.unit}</span>
            </div>
            <div className="mt-2 text-xs flex items-center gap-1.5">
              {target.change_pct !== null && (
                <span
                  className={`inline-flex items-center font-semibold ${
                    (target.change_pct >= 0 && polarity === 'up') || (target.change_pct <= 0 && polarity === 'down')
                      ? 'text-emerald-600'
                      : 'text-rose-600'
                  }`}
                >
                  {target.change_pct >= 0 ? '+' : ''}
                  {fmtPct(target.change_pct)}
                </span>
              )}
              <span className="text-slate-500">vs bulan sama th lalu ({fmtNum(target.same_month_last_year, 1)})</span>
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Rentang P10–P90: {fmtNum(target.p10, 1)} – {fmtNum(target.p90, 1)}
            </div>
          </div>
        )}

        {period && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              {period.label || 'Target Periode'}
            </span>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {fmtNum(period.p50, 1)}
              </span>
              <span className="text-xs text-slate-500">{activeSeries?.unit}</span>
            </div>
            {period.previous !== null && (
              <div className="mt-2 text-xs flex items-center gap-1.5">
                {period.change_pct !== null && (
                  <span
                    className={`inline-flex items-center font-semibold ${
                      (period.change_pct >= 0 && polarity === 'up') || (period.change_pct <= 0 && polarity === 'down')
                        ? 'text-emerald-600'
                        : 'text-rose-600'
                    }`}
                  >
                    {period.change_pct >= 0 ? '+' : ''}
                    {fmtPct(period.change_pct)}
                  </span>
                )}
                <span className="text-slate-500">vs periode lalu ({fmtNum(period.previous, 1)})</span>
              </div>
            )}
          </div>
        )}

        {quality && (
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
            <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
              Kualitas Model (Uji Mundur)
            </span>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
                {quality.gain_vs_naive_pct !== null ? `${fmtPct(quality.gain_vs_naive_pct)}` : '-'}
              </span>
              <span className="text-xs text-slate-500">akurasi vs naif</span>
            </div>
            <div className="mt-2 text-xs text-slate-500">
              Galat WAPE: {fmtPct(quality.wape)} (Naif: {fmtPct(quality.naive_wape)})
            </div>
            <div className="text-[11px] text-slate-400 mt-1">
              Dievaluasi atas {quality.backtest_points} titik uji mundur
            </div>
          </div>
        )}

        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 shadow-xs">
          <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider block">
            Basis Riwayat Data
          </span>
          <div className="mt-1.5 flex items-baseline gap-2">
            <span className="text-2xl font-bold text-slate-900 dark:text-slate-100">
              {activeSeries?.history_months || 0}
            </span>
            <span className="text-xs text-slate-500">bulan lengkap</span>
          </div>
          <div className="mt-2 text-xs text-slate-500">
            Bulan dasar: {d.last_month || '-'}
          </div>
          <div className="text-[11px] text-slate-400 mt-1">
            Peredaman tren: {activeSeries?.trend_damping ?? 1.0}
          </div>
        </div>
      </div>

      {/* Grafik Prakiraan Interaktif Selebar Kartu */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs">
        <div className="border-b border-slate-100 dark:border-slate-800 pb-3 mb-4">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <IconChart size={18} className="text-blue-600" />
            Grafik Riwayat 24 Bulan &amp; Prakiraan 12 Bulan ke Depan
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Menampilkan deret aktual 24 bulan terakhir dan proyeksi p10, p50 (median), p90 untuk 12 bulan mendatang.
          </p>
        </div>

        {activeSeries && <ForecastSeriesChart series={activeSeries} polarity={polarity} />}
      </div>

      {/* Wawasan & Temuan Otomatis (Insights) */}
      {activeSeries?.insights?.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <IconInfo size={18} className="text-blue-500" />
            Temuan &amp; Analisis Prakiraan
          </h3>
          <div className="grid gap-2.5 sm:grid-cols-2">
            {activeSeries.insights.map((ins, idx) => (
              <div
                key={idx}
                className={`p-3 rounded-xl border text-xs leading-relaxed flex items-start gap-2.5 ${
                  ins.level === 'baik'
                    ? 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200'
                    : ins.level === 'perhatian'
                    ? 'bg-amber-50/60 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
                    : 'bg-slate-50 dark:bg-slate-800/40 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300'
                }`}
              >
                {ins.level === 'baik' ? (
                  <IconCheckCircle size={16} className="text-emerald-600 shrink-0 mt-0.5" />
                ) : ins.level === 'perhatian' ? (
                  <IconAlertCircle size={16} className="text-amber-600 shrink-0 mt-0.5" />
                ) : (
                  <IconInfo size={16} className="text-slate-500 shrink-0 mt-0.5" />
                )}
                <span>{ins.text}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
