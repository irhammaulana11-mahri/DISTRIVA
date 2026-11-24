import { useCallback, useEffect, useMemo, useState } from 'react'
import { reportsApi, pengusahaanApi, triggerFileDownload } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useScopedUnits, useUnitScope } from '../../utils/unitScope.js'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import {
  IconChart,
  IconRefresh,
  IconDownload,
  IconUsers,
  IconZap,
  IconCalendar,
  IconActivity,
  IconChevronDown,
} from '../../components/icons.jsx'
import {
  ColumnChart,
  DivergingColumns,
  RankedBars,
  YearlyComparisonChart,
  fmtInt,
  fmtNum,
  fmtPct,
  monthLabel,
  monthLong,
} from '../../components/TrendCharts.jsx'
import { DemandForecast } from '../forecast/ForecastPage.jsx'
import { buildInsights } from './insights.js'

const TABS = [
  { key: 'trend', label: 'Tren & analisis', hint: 'Realisasi penambahan pelanggan baru', cap: 'reports.view' },
  { key: 'forecast', label: 'Prakiraan pelanggan', hint: 'Sambungan baru per ULP, 12 bulan ke depan', cap: 'forecast.view' },
]

const card = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs'

const lastDay = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

function Delta({ value, suffix = '' }) {
  if (value === null || value === undefined) return <span className="text-xs text-slate-400">-</span>
  const up = value >= 0
  return (
    <span
      className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold ${
        up
          ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'
          : 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
      }`}
    >
      <span aria-hidden>{up ? '▲' : '▼'}</span>
      {fmtPct(value)}
      {suffix}
      <span className="sr-only">{up ? ' naik' : ' turun'}</span>
    </span>
  )
}

function Tile({ label, value, sub, delta, icon: IconComponent = IconUsers, colorClass = 'text-blue-500' }) {
  return (
    <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
      <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
        <span className="text-xs font-medium truncate">{label}</span>
        {IconComponent && <IconComponent size={16} className={colorClass} />}
      </div>
      <div className="mt-2 text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">
        {value}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        {delta !== undefined && <Delta value={delta} />}
        {sub && <span className="truncate">{sub}</span>}
      </div>
    </div>
  )
}

function Section({ title, hint, children, actions = null }) {
  return (
    <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-5 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export function CustomerAnalysisContent({
  hideHeader = false,
  hideTabs = false,
  defaultTab = 'trend',
  forcedTab = null,
  permission = 'reports.view',
}) {
  const { can } = useAccess()
  const scopedUnitsInfo = useScopedUnits(permission)
  const canTrend = Boolean(can[permission] || can['reports.view'])
  const tabs = TABS.filter((t) => (t.key === 'trend' ? canTrend : can[t.cap]))
  const [tab, setTab] = useState(() => (forcedTab || (canTrend ? defaultTab : 'forecast')))
  const activeTab = forcedTab || (tabs.some((t) => t.key === tab) ? tab : (tabs[0]?.key || 'trend'))
  const [up3Id, setUp3Id] = useState('')
  const [unitId, setUnitId] = useState('')
  const [fromM, setFromM] = useState('')
  const [toM, setToM] = useState('')
  const [state, setState] = useState({ loading: true, error: '', data: null, metric309: null })
  const [exporting, setExporting] = useState(false)

  // Selesaikan unit default berdasarkan peran pengguna (sysadmin: semua, UP3/ULP terkunci/default ke unitnya)
  const scopeResolution = useUnitScope(scopedUnitsInfo, up3Id, unitId)
  const effectiveUp3Id = scopeResolution.up3Value || up3Id
  const effectiveUnitId = scopeResolution.ulpValue || unitId

  const params = useMemo(
    () => ({
      from: fromM ? `${fromM}-01` : undefined,
      to: toM ? lastDay(toM) : undefined,
      up3_id: effectiveUp3Id || undefined,
      unit_id: effectiveUnitId || undefined,
    }),
    [fromM, toM, effectiveUp3Id, effectiveUnitId]
  )

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const targetUnitId = effectiveUnitId || effectiveUp3Id || scopedUnitsInfo?.up3_units?.[0]?.id || scopedUnitsInfo?.ulp_units?.[0]?.id
      const growthPromise = reportsApi.customerGrowth(params)
      const metric309Promise = targetUnitId && pengusahaanApi?.metric
        ? pengusahaanApi.metric('pelanggan', {
            unit_id: targetUnitId,
            from: fromM || undefined,
            to: toM || undefined,
          }).catch(() => null)
        : Promise.resolve(null)

      const [resGrowth, res309] = await Promise.all([growthPromise, metric309Promise])
      setState({
        loading: false,
        error: '',
        data: resGrowth?.data || null,
        metric309: res309?.data || null,
      })
    } catch (err) {
      setState((s) => ({
        ...s,
        loading: false,
        error: err?.message || 'Gagal memuat analisis pelanggan.',
        data: null,
      }))
    }
  }, [params, effectiveUnitId, effectiveUp3Id, scopedUnitsInfo, fromM, toM])

  useEffect(() => {
    if (activeTab === 'trend' && (can[permission] || can['reports.view'] || can['pengusahaan.view'])) load()
  }, [activeTab, load, can, permission])

  const exportXlsx = async () => {
    setExporting(true)
    try {
      const { blob, filename } = await reportsApi.downloadCustomerGrowthXlsx(params)
      triggerFileDownload(blob, filename || 'ANALISIS-PELANGGAN-DAYA.xlsx')
    } catch (err) {
      setState((s) => ({ ...s, error: err?.message || 'Gagal mengekspor.' }))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="space-y-5 w-full">
      {/* 1. Hero Header Card Standar DISTRIVA */}
      {!hideHeader && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-5 sm:p-6">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
            <div className="flex items-start gap-4">
              <div className="w-12 h-12 rounded-xl bg-blue-600 flex items-center justify-center text-white shadow-xs shrink-0">
                <IconChart size={26} />
              </div>
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    Analisa &amp; Tren Pelanggan
                  </h1>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                    Laporan &amp; Monitoring
                  </span>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                    Laporan 309 &amp; Permohonan EIS
                  </span>
                </div>
                <p className="mt-1 max-w-3xl text-xs sm:text-sm leading-relaxed text-slate-500 dark:text-slate-400">
                  Realisasi jumlah pelanggan dari Laporan 309 dan penambahan pelanggan baru (PB) dari Permohonan EIS per bulan dan tahun, komposisi tarif, perbandingan antar ULP, pola musiman, serta prakiraan 12 bulan ke depan.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
              {activeTab === 'trend' && (
                <Button
                  variant="secondary"
                  onClick={load}
                  loading={state.loading && Boolean(state.data)}
                  icon={IconRefresh}
                >
                  Segarkan
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* 2. Navigasi Tab Underline Standar */}
      {!hideTabs && (
        <nav aria-label="Bagian analisis" className="border-b border-slate-200 dark:border-slate-800">
          <div role="tablist" className="flex items-center gap-6 overflow-x-auto">
            {tabs.map((t) => (
              <button
                key={t.key}
                role="tab"
                aria-selected={activeTab === t.key}
                aria-label={t.label}
                type="button"
                onClick={() => setTab(t.key)}
                className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
                  activeTab === t.key
                    ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                    : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* 3. Konten Tab */}
      {activeTab === 'forecast' && can['forecast.view'] && (
        <DemandForecast key="customers" kinds={['CUSTOMERS_ADDED']} onSelectMaterial={() => {}} />
      )}
      {activeTab === 'trend' && (can[permission] || can['reports.view'] || can['pengusahaan.view']) && (
        <TrendTab
          state={state}
          filters={{ up3Id, setUp3Id, unitId, setUnitId, fromM, setFromM, toM, setToM }}
          onExport={exportXlsx}
          exporting={exporting}
          onRetry={load}
          permission={permission}
        />
      )}
    </div>
  )
}

export default function CustomerAnalysisPage() {
  return <CustomerAnalysisContent />
}

function TrendTab({ state, filters, onExport, exporting, onRetry, permission = 'reports.view' }) {
  const { up3Id, setUp3Id, unitId, setUnitId, fromM, setFromM, toM, setToM } = filters
  const d = state.data
  const metric309 = state.metric309
  const insights = useMemo(() => buildInsights(d), [d])
  const monthly = d?.monthly || []

  const deltaMonthly = monthly.map((m, idx) => {
    const prev = monthly[idx - 1]
    const deltaVal = prev ? m.pb_count - prev.pb_count : 0
    return {
      key: m.month,
      label: monthLabel(m.month),
      up: deltaVal > 0 ? deltaVal : 0,
      down: deltaVal < 0 ? Math.abs(deltaVal) : 0,
      partial: m.partial,
      lines: [
        `Realisasi PB: ${fmtInt(m.pb_count)} PB`,
        `Delta MoM: ${deltaVal >= 0 ? '+' : ''}${fmtInt(deltaVal)} PB (${fmtPct(m.mom_pct)})`,
        `YoY: ${fmtPct(m.yoy_pct)}`,
      ],
    }
  })

  const seasonal = (d?.seasonality?.months || []).map((s) => ({
    key: s.month,
    label: monthLabel(`2000-${String(s.month).padStart(2, '0')}`, false),
    value: s.index,
    lines: [`Rata-rata ${fmtNum(s.avg_pb_count)} PB/bulan`],
  }))

  const k = d?.kpi
  const base = (d?.by_unit || []).reduce((s, u) => s + u.base_customers, 0)

  return (
    <div className="space-y-5">
      {/* Filter Bar Terstandarisasi */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs flex flex-wrap items-center gap-3">
        <HierarchicalUnitFilter
          permission={permission}
          up3Id={up3Id}
          onUp3Change={(v) => setUp3Id(v)}
          unitId={unitId}
          onUnitChange={(v) => setUnitId(v)}
          unitAriaLabel="Filter Unit ULP"
        />

        <div className="flex items-center gap-2">
          <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
            Dari bulan
          </label>
          <input
            type="month"
            aria-label="Dari bulan"
            value={fromM}
            onChange={(e) => setFromM(e.target.value)}
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
            value={toM}
            onChange={(e) => setToM(e.target.value)}
            className="h-9 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 text-xs sm:text-sm text-slate-900 dark:text-slate-100 focus:outline-hidden focus:ring-1 focus:ring-blue-500 shadow-2xs"
          />
        </div>

        {(fromM || toM) && (
          <Button
            variant="ghost"
            onClick={() => {
              setFromM('')
              setToM('')
            }}
          >
            Semua periode
          </Button>
        )}

        <div className="ml-auto">
          <Button
            variant="secondary"
            loading={exporting}
            onClick={onExport}
            disabled={!d}
            icon={IconDownload}
          >
            Ekspor Excel
          </Button>
        </div>
      </div>

      {state.error && (
        <Alert kind="error">
          {state.error}{' '}
          <button type="button" className="underline font-semibold cursor-pointer" onClick={onRetry}>
            Coba lagi
          </button>
        </Alert>
      )}

      {state.loading && !d && (
        <div className="py-16 text-center">
          <Spinner label="Memuat analisis pelanggan dan daya…" />
        </div>
      )}

      {d && monthly.length === 0 && (
        <Alert kind="info">Belum ada sambungan selesai pada rentang dan unit ini.</Alert>
      )}

      {d && monthly.length > 0 && (
        <>
          {/* KPI Metric Cards: 4 Card Statistik */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4" aria-label="Ringkasan">
            <Tile
              label="Jumlah pelanggan (Laporan 309)"
              value={metric309?.summary?.[0]?.formatted ? `${metric309.summary[0].formatted} plg` : (base > 0 ? `${fmtInt(base)} plg` : `${fmtInt(k.pb_total || 0)} PB`)}
              delta={metric309?.summary?.[0]?.yoy_pct ?? undefined}
              sub={metric309?.summary?.[0]?.month ? `Laporan 309 (${monthLabel(metric309.summary[0].month)})` : (base > 0 ? `Basis aktif DIL ${fmtInt(base)} plg` : 'Data 309')}
              icon={IconUsers}
              colorClass="text-blue-500"
            />
            <Tile
              label="Pelanggan baru, 12 bulan terakhir"
              value={fmtInt(k.l12m?.pb_count)}
              delta={k.l12m_growth_pct}
              sub={k.prev12m ? `sebelumnya ${fmtInt(k.prev12m.pb_count)}` : 'permohonan tersambung'}
              icon={IconZap}
              colorClass="text-emerald-500"
            />
            <Tile
              label={`Tahun ${k.ytd?.year || ''} sampai ${k.last_full_month ? monthLabel(k.last_full_month, false) : ''}`}
              value={`${fmtInt(k.ytd?.pb_count)} PB`}
              delta={k.ytd_growth_pct}
              sub={k.ytd_prev ? `Th ${k.ytd_prev.year}: ${fmtInt(k.ytd_prev.pb_count)}` : 'YTD vs tahun lalu'}
              icon={IconCalendar}
              colorClass="text-indigo-500"
            />
            <Tile
              label="Rata-rata pasang baru bulanan"
              value={k.l12m?.pb_count ? `${fmtInt(Math.round(k.l12m.pb_count / 12))} PB/bln` : '-'}
              delta={k.l12m_growth_pct}
              sub={k.prev12m ? `12 bln lalu ${fmtInt(Math.round(k.prev12m.pb_count / 12))} PB/bln` : '12 bulan terakhir'}
              icon={IconActivity}
              colorClass="text-purple-500"
            />
          </div>

          {k.partial_month && (
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Bulan {monthLong(k.partial_month)} masih berjalan: digambar putus-putus dan tidak dihitung dalam pertumbuhan, pola musiman, maupun deteksi anomali.
            </p>
          )}

          {/* 1. Pelanggan baru (PB) per bulan (Perbandingan Tahunan 12 Bulan) */}
          <Section
            title="Pelanggan baru (PB) per bulan"
            hint="Perbandingan sambungan baru tiap bulan (Jan–Des) antar tahun dari Permohonan EIS. Memuat seluruh data historis, bawaan menampilkan tahun berjalan dibandingkan tahun sebelumnya (YoY). Sorot bulan atau titik data untuk melihat rincian angka."
          >
            <YearlyComparisonChart
              data={monthly}
              valueKey="pb_count"
              unit="PB"
              ariaLabel="Grafik perbandingan tahunan pelanggan baru 12 bulan"
              defaultCompareTwoYears={true}
            />
          </Section>

          {/* 2. Delta pelanggan bulanan */}
          <Section
            title="Delta pelanggan bulanan"
            hint="Perubahan penambahan pelanggan baru (PB) dibandingkan bulan sebelumnya (MoM). Hijau di atas nol menandakan kenaikan PB dibanding bulan lalu."
          >
            <DivergingColumns
              data={deltaMonthly}
              upLabel="Kenaikan PB (MoM)"
              downLabel="Penurunan PB (MoM)"
              ariaLabel="Grafik delta penambahan pelanggan bulanan"
              unit="PB"
            />
          </Section>

          {/* 3. Ringkasan per tahun */}
          <Section
            title="Ringkasan per tahun"
            hint="Pertumbuhan tahunan hanya dihitung untuk tahun yang lengkap 12 bulan dan berurutan."
          >
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-140 text-left text-sm">
                <caption className="sr-only">Ringkasan penambahan pelanggan per tahun</caption>
                <thead className="bg-slate-50/80 dark:bg-slate-800/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700/80">
                  <tr>
                    <th className="py-2.5 px-3">Tahun</th>
                    <th className="px-3 text-right">PB</th>
                    <th className="px-3 text-right">Pertumbuhan PB</th>
                    <th className="px-3 text-right">Permohonan PB masuk</th>
                    <th className="px-3 text-right">Batal + restitusi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {d.yearly.map((y) => (
                    <tr key={y.year} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 px-3 font-semibold">
                        {y.year}
                        {y.partial ? (
                          <span className="ml-1.5 text-xs font-normal text-amber-700 dark:text-amber-400">
                            ({y.months} bulan)
                          </span>
                        ) : null}
                      </td>
                      <td className="px-3 text-right tabular-nums">{fmtInt(y.pb_count)}</td>
                      <td className="px-3 text-right">
                        <Delta value={y.yoy_pct} />
                      </td>
                      <td className="px-3 text-right tabular-nums">{fmtInt(y.requests_pb)}</td>
                      <td className="px-3 text-right tabular-nums">{fmtInt(y.cancelled + y.refunded)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 4 & 5. Komposisi tarif pelanggan baru & Pola musiman */}
          <div className="grid gap-5 lg:grid-cols-2">
            <Section
              title="Komposisi tarif pelanggan baru"
              hint="Jumlah PB per kelompok tarif pada rentang terpilih."
            >
              <RankedBars
                ariaLabel="Komposisi PB per kelompok tarif"
                items={d.by_tariff.groups.map((g) => ({
                  key: g.group,
                  label: g.group,
                  value: g.count,
                  text: `${fmtInt(g.count)} · ${fmtNum(g.share_pct)}%`,
                }))}
              />
            </Section>

            <Section
              title="Pola musiman"
              hint="Indeks 1,0 = rata-rata bulanan; dihitung dari tahun yang lengkap saja."
            >
              {seasonal.length === 12 ? (
                <ColumnChart
                  data={seasonal}
                  height={200}
                  format={(v) => fmtNum(v, 2)}
                  refLine={{ value: 1, label: 'rata-rata = 1,0' }}
                  ariaLabel="Indeks musiman pelanggan baru per bulan"
                  unit="indeks"
                  labelEvery={1}
                  tickCount={3}
                />
              ) : (
                <p className="py-6 text-center text-sm text-slate-500">
                  {d.seasonality?.note || 'Pola musiman butuh minimal dua tahun penuh.'}
                </p>
              )}
            </Section>
          </div>

          {/* 6. Rincian: Kelompok tarif */}
          <Section
            title="Rincian: Kelompok tarif"
            hint="Rincian kode tarif dan sepuluh tarif terbanyak dari penambahan pelanggan baru (Permohonan EIS) serta komposisi kelompok tarif Laporan 309."
          >
            <div className="space-y-4">
              <details open className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-xs text-slate-600 dark:text-slate-400">
                <summary className="cursor-pointer font-semibold text-slate-800 dark:text-slate-200 text-sm">
                  Tarif pelanggan baru terbanyak (Permohonan EIS)
                </summary>
                <div className="mt-3 overflow-x-auto">
                  <table className="w-full text-left">
                    <thead className="bg-slate-50 dark:bg-slate-800/50 uppercase tracking-wider text-[10px] text-slate-500">
                      <tr>
                        <th className="py-1.5 px-2">Tarif</th>
                        <th className="px-2">Kelompok</th>
                        <th className="px-2 text-right">PB</th>
                        <th className="px-2 text-right">Porsi (%)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {d.by_tariff.top_codes.map((c) => (
                        <tr key={c.tariff}>
                          <td className="py-1.5 px-2 font-mono font-semibold">{c.tariff}</td>
                          <td className="px-2">{c.group}</td>
                          <td className="px-2 text-right tabular-nums">{fmtInt(c.count)}</td>
                          <td className="px-2 text-right tabular-nums">{fmtNum(c.share_pct, 1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </details>

              {metric309?.breakdown && metric309.breakdown.length > 0 && (
                <details className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5 text-xs text-slate-600 dark:text-slate-400">
                  <summary className="cursor-pointer font-semibold text-slate-800 dark:text-slate-200 text-sm">
                    Komposisi kelompok tarif total pelanggan (Laporan 309)
                  </summary>
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left">
                      <thead className="bg-slate-50 dark:bg-slate-800/50 uppercase tracking-wider text-[10px] text-slate-500">
                        <tr>
                          <th className="py-1.5 px-2">Kelompok Tarif</th>
                          <th className="px-2 text-right">Jumlah Pelanggan</th>
                          <th className="px-2 text-right">Porsi (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {metric309.breakdown.map((b) => (
                          <tr key={b.key || b.name}>
                            <td className="py-1.5 px-2 font-medium">{b.name || b.key}</td>
                            <td className="px-2 text-right tabular-nums">{fmtInt(b.value)}</td>
                            <td className="px-2 text-right tabular-nums">{b.share_pct !== undefined ? `${fmtNum(b.share_pct, 1)}%` : '-'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </details>
              )}
            </div>
          </Section>

          {/* 7. Perbandingan Antar ULP */}
          <Section
            title="Perbandingan Antar ULP"
            hint="Batang = PB 12 bulan terakhir (laju per tahun). Tabel: total pada periode terpilih, rincian per tahun, rata-rata per tahun, dan 12 bulan terakhir dibandingkan basis pelanggan aktif DIL (September 2026)."
          >
            <RankedBars
              ariaLabel="PB 12 bulan terakhir per ULP"
              items={d.by_unit.map((u) => ({
                key: u.unit_id,
                label: u.unit_name,
                value: u.l12m_pb,
                text: fmtInt(u.l12m_pb),
                sub: `${u.up3_name || ''} · total periode ${fmtInt(u.pb_count)}`,
              }))}
            />
            <div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full min-w-200 text-left text-sm">
                <caption className="sr-only">Penambahan pelanggan baru per ULP, per tahun</caption>
                <thead className="bg-slate-50/80 dark:bg-slate-800/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700/80">
                  <tr>
                    <th className="py-2.5 px-3">ULP</th>
                    {d.yearly.map((y) => (
                      <th key={y.year} className="px-3 text-right">
                        PB {y.year}
                        {y.partial ? ` (${y.months} bln)` : ''}
                      </th>
                    ))}
                    <th className="px-3 text-right">Total periode</th>
                    <th className="px-3 text-right">Rata-rata/tahun</th>
                    <th className="px-3 text-right">12 bulan terakhir</th>
                    <th className="px-3 text-right">Basis aktif DIL</th>
                    <th className="px-3 text-right">12 bulan / basis</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {d.by_unit.map((u) => (
                    <tr key={u.unit_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 px-3 font-medium" title={u.up3_name || undefined}>
                        {u.unit_name}
                      </td>
                      {d.yearly.map((y) => (
                        <td key={y.year} className="px-3 text-right tabular-nums">
                          {fmtInt(u.by_year.find((x) => x.year === y.year)?.pb_count ?? 0)}
                        </td>
                      ))}
                      <td className="px-3 text-right tabular-nums">{fmtInt(u.pb_count)}</td>
                      <td className="px-3 text-right tabular-nums">{fmtInt(u.avg_pb_per_year)}</td>
                      <td className="px-3 text-right font-semibold tabular-nums">{fmtInt(u.l12m_pb)}</td>
                      <td className="px-3 text-right tabular-nums">{fmtInt(u.base_customers)}</td>
                      <td className="px-3 text-right tabular-nums">
                        {u.l12m_vs_base_pct === null ? '-' : `${fmtNum(u.l12m_vs_base_pct, 2)}%`}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {/* 8. Anomali / Bulan Menyimpang */}
          {d.anomalies.length > 0 && (
            <Section
              title="Bulan yang menyimpang"
              hint="Jumlah PB menyimpang minimal 2 simpangan baku dari rata-rata 12 bulan sebelumnya. Penyebab tidak ditebak: periksa kegiatan atau kebijakan pada bulan itu."
            >
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {d.anomalies.slice(0, 8).map((a) => (
                  <li key={a.month} className="flex flex-wrap items-center gap-3 py-2.5">
                    <span className="w-24 font-semibold">{monthLong(a.month)}</span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold ${
                        a.direction === 'NAIK'
                          ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300'
                          : 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
                      }`}
                    >
                      <span aria-hidden>{a.direction === 'NAIK' ? '▲' : '▼'}</span>
                      {a.direction === 'NAIK' ? 'Lonjakan' : 'Penurunan'}
                    </span>
                    <span className="tabular-nums font-medium">{fmtInt(a.pb_count)} PB</span>
                    <span className="text-slate-500">
                      diperkirakan {fmtInt(a.expected)} (z = {fmtNum(a.z, 1)})
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* 9. Tabel Bulanan Lengkap */}
          <Section
            title="Tabel bulanan"
            hint="Padanan tabel untuk semua grafik di atas (terbaru di atas)."
          >
            <details className="rounded-xl border border-slate-200 dark:border-slate-800 p-3.5">
              <summary className="cursor-pointer text-sm font-semibold text-blue-600 dark:text-blue-400">
                Tampilkan tabel {monthly.length} bulan
              </summary>
              <div className="mt-3.5 max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-800">
                <table className="w-full min-w-160 text-left text-sm">
                  <caption className="sr-only">Penambahan pelanggan per bulan</caption>
                  <thead className="sticky top-0 bg-slate-50/95 dark:bg-slate-800/95 backdrop-blur-xs text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700/80">
                    <tr>
                      <th className="py-2 px-3">Bulan</th>
                      <th className="px-3 text-right">PB</th>
                      <th className="px-3 text-right">MoM</th>
                      <th className="px-3 text-right">YoY</th>
                      <th className="px-3 text-right">Mohon PB</th>
                      <th className="px-3 text-right">Batal</th>
                      <th className="px-3 text-right">Restitusi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {[...monthly].reverse().map((m) => (
                      <tr key={m.month} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="py-2 px-3 font-medium">
                          {monthLong(m.month)}
                          {m.partial ? (
                            <span className="ml-1.5 text-xs font-normal text-amber-700 dark:text-amber-400">
                              (berjalan)
                            </span>
                          ) : null}
                        </td>
                        <td className="px-3 text-right tabular-nums">{fmtInt(m.pb_count)}</td>
                        <td className="px-3 text-right tabular-nums">{fmtPct(m.mom_pct)}</td>
                        <td className="px-3 text-right tabular-nums">{fmtPct(m.yoy_pct)}</td>
                        <td className="px-3 text-right tabular-nums">{fmtInt(m.requests_pb)}</td>
                        <td className="px-3 text-right tabular-nums">{fmtInt(m.cancelled)}</td>
                        <td className="px-3 text-right tabular-nums">{fmtInt(m.refunded)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Section>

          {/* 10. Hasil Analisa / Temuan Otomatis diletakkan di Bagian Bawah */}
          {insights.length > 0 && (
            <Section title="Temuan" hint="Disusun otomatis dari angka di atas; hanya menyebut apa yang terukur.">
              <ul className="space-y-2 text-sm text-slate-700 dark:text-slate-300">
                {insights.map((i) => (
                  <li key={i.text} className="flex items-start gap-2.5">
                    <span
                      aria-hidden
                      className={`mt-0.5 inline-flex items-center justify-center w-4 h-4 rounded-full text-[10px] font-bold shrink-0 ${
                        i.tone === 'up'
                          ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300'
                          : i.tone === 'down'
                          ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                      }`}
                    >
                      {i.tone === 'up' ? '▲' : i.tone === 'down' ? '▼' : '•'}
                    </span>
                    <span className="leading-relaxed">{i.text}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {/* 11. Catatan Data */}
          <Section title="Catatan data">
            <ul className="list-disc space-y-1.5 pl-5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
              <li>Data pelanggan mencakup akumulasi jumlah pelanggan dari Laporan 309 dan realisasi penambahan pelanggan baru (PB) dari Permohonan EIS (status PEREMAJAAN).</li>
              {d.notes.map((n) => (
                <li key={n}>{n}</li>
              ))}
            </ul>
          </Section>
        </>
      )}
    </div>
  )
}
