import { useCallback, useEffect, useMemo, useState } from 'react'
import { reportsApi, triggerFileDownload } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import { ColumnChart, DivergingColumns, RankedBars, fmtInt, fmtNum, fmtPct, monthLabel, monthLong } from '../../components/TrendCharts.jsx'
import { DemandForecast } from '../forecast/ForecastPage.jsx'
import { buildInsights } from './insights.js'

const TABS = [
  { key: 'trend', label: 'Tren & analisis', hint: 'Realisasi penambahan pelanggan dan daya', cap: 'reports.view' },
  { key: 'forecast', label: 'Prakiraan pelanggan & daya', hint: 'Sambungan baru per ULP, 12 bulan ke depan', cap: 'forecast.view' },
]
const card = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs'
const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}` }

function Delta({ value, suffix = '' }) {
  if (value === null || value === undefined) return <span className="text-xs text-slate-400">-</span>
  const up = value >= 0
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold ${up ? 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'}`}>
      <span aria-hidden>{up ? '▲' : '▼'}</span>{fmtPct(value)}{suffix}<span className="sr-only">{up ? ' naik' : ' turun'}</span>
    </span>
  )
}

function Tile({ label, value, sub, delta }) {
  return (
    <div className={`${card} p-4`}>
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</p>
      <p className="mt-1 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 tabular-nums">{value}</p>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">{delta !== undefined && <Delta value={delta} />}{sub}</div>
    </div>
  )
}

function Section({ title, hint, children, actions = null }) {
  return (
    <section className={`${card} p-4 sm:p-5`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

export default function CustomerAnalysisPage() {
  const { can } = useAccess()
  const tabs = TABS.filter((t) => can[t.cap])
  const [tab, setTab] = useState(() => (can['reports.view'] ? 'trend' : 'forecast'))
  const [up3Id, setUp3Id] = useState('')
  const [unitId, setUnitId] = useState('')
  const [fromM, setFromM] = useState('')
  const [toM, setToM] = useState('')
  const [state, setState] = useState({ loading: true, error: '', data: null })
  const [exporting, setExporting] = useState(false)
  const params = useMemo(() => ({ from: fromM ? `${fromM}-01` : undefined, to: toM ? lastDay(toM) : undefined, up3_id: up3Id || undefined, unit_id: unitId || undefined }), [fromM, toM, up3Id, unitId])

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await reportsApi.customerGrowth(params)
      setState({ loading: false, error: '', data: res?.data || null })
    } catch (err) {
      setState({ loading: false, error: err?.message || 'Gagal memuat analisis pelanggan dan daya.', data: null })
    }
  }, [params])
  useEffect(() => { if (tab === 'trend' && can['reports.view']) load() }, [tab, load, can])

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
    <div className="space-y-5">
      <header className={`${card} p-4 sm:p-5`}>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Analisis Pelanggan &amp; Daya</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-slate-600 dark:text-slate-400">
          Realisasi penambahan pelanggan baru (PB) dan perubahan daya (PD) per bulan dan tahun, komposisi tarif, perbandingan antar ULP, pola musiman, serta prakiraan 12 bulan ke depan.
          Dasarnya permohonan yang sudah tersambung (status PEREMAJAAN di EIS).
        </p>
      </header>

      <nav aria-label="Bagian analisis" className="border-b border-slate-200 dark:border-slate-800">
        <div role="tablist" className="flex items-center gap-1 overflow-x-auto">
          {tabs.map((t) => (
            <button key={t.key} role="tab" aria-selected={tab === t.key} aria-label={t.label} type="button" onClick={() => setTab(t.key)}
              className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer whitespace-nowrap ${tab === t.key ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
              {t.label}
            </button>
          ))}
        </div>
      </nav>

      {tab === 'forecast' && can['forecast.view'] && <DemandForecast key="customers" kinds={['CUSTOMERS_ADDED', 'VA_ADDED']} onSelectMaterial={() => {}} />}
      {tab === 'trend' && can['reports.view'] && (
        <TrendTab state={state} filters={{ up3Id, setUp3Id, unitId, setUnitId, fromM, setFromM, toM, setToM }} onExport={exportXlsx} exporting={exporting} onRetry={load} />
      )}
    </div>
  )
}

function TrendTab({ state, filters, onExport, exporting, onRetry }) {
  const { up3Id, setUp3Id, unitId, setUnitId, fromM, setFromM, toM, setToM } = filters
  const d = state.data
  const insights = useMemo(() => buildInsights(d), [d])
  const monthly = d?.monthly || []
  const pbData = monthly.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.pb_count, partial: m.partial, lines: [`Daya: ${fmtNum(m.pb_kva)} kVA`, `MoM ${fmtPct(m.mom_pct)} · YoY ${fmtPct(m.yoy_pct)}`, `Permohonan PB masuk: ${fmtInt(m.requests_pb)}`] }))
  const kvaData = monthly.map((m) => ({ key: m.month, label: monthLabel(m.month), value: m.pb_kva, partial: m.partial, lines: [`${fmtInt(m.pb_count)} PB`, m.avg_kva_per_pb ? `Rata-rata ${fmtNum(m.avg_kva_per_pb, 2)} kVA/PB` : 'Tanpa PB'] }))
  const pdData = monthly.map((m) => ({ key: m.month, label: monthLabel(m.month), up: m.pd_up_kva, down: m.pd_down_kva, partial: m.partial, lines: [`Neto ${fmtNum(m.pd_net_kva)} kVA`, `${fmtInt(m.pd_up_count)} naik · ${fmtInt(m.pd_down_count)} turun · ${fmtInt(m.pd_same_count)} tarif saja`] }))
  const seasonal = (d?.seasonality?.months || []).map((s) => ({ key: s.month, label: monthLabel(`2000-${String(s.month).padStart(2, '0')}`, false), value: s.index, lines: [`Rata-rata ${fmtNum(s.avg_pb_count)} PB/bulan`] }))
  const k = d?.kpi
  const base = (d?.by_unit || []).reduce((s, u) => s + u.base_customers, 0)

  return (
    <div className="space-y-5">
      <div className={`${card} flex flex-wrap items-end gap-3 p-3.5`}>
        <HierarchicalUnitFilter permission="reports.view" up3Id={up3Id} onUp3Change={(v) => setUp3Id(v)} unitId={unitId} onUnitChange={(v) => setUnitId(v)} unitAriaLabel="Filter Unit ULP" />
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">Dari bulan
          <input type="month" aria-label="Dari bulan" value={fromM} onChange={(e) => setFromM(e.target.value)} className="h-10 rounded-xl border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600 dark:text-slate-400">Sampai bulan
          <input type="month" aria-label="Sampai bulan" value={toM} onChange={(e) => setToM(e.target.value)} className="h-10 rounded-xl border border-slate-300 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-800" />
        </label>
        {(fromM || toM) && <Button variant="ghost" size="sm" onClick={() => { setFromM(''); setToM('') }}>Semua periode</Button>}
        <div className="ml-auto"><Button variant="secondary" size="sm" loading={exporting} onClick={onExport} disabled={!d}>Ekspor Excel</Button></div>
      </div>

      {state.error && <Alert kind="error">{state.error} <button type="button" className="underline" onClick={onRetry}>Coba lagi</button></Alert>}
      {state.loading && !d && <div className="py-16 text-center"><Spinner label="Memuat analisis…" /></div>}

      {d && monthly.length === 0 && <Alert kind="info">Belum ada sambungan selesai pada rentang dan unit ini.</Alert>}
      {d && monthly.length > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5" aria-label="Ringkasan">
            <Tile label="Pelanggan baru, 12 bulan terakhir" value={fmtInt(k.l12m?.pb_count)} delta={k.l12m_growth_pct} sub={k.prev12m ? `sebelumnya ${fmtInt(k.prev12m.pb_count)}` : 'belum ada pembanding'} />
            <Tile label="Tambahan daya PB, 12 bulan" value={`${fmtInt(k.l12m?.pb_kva)} kVA`} delta={k.prev12m && k.prev12m.pb_kva > 0 ? ((k.l12m.pb_kva - k.prev12m.pb_kva) / k.prev12m.pb_kva) * 100 : undefined} sub={k.prev12m ? `sebelumnya ${fmtInt(k.prev12m.pb_kva)}` : ''} />
            <Tile label={`Tahun ${k.ytd?.year} sampai ${monthLabel(k.last_full_month, false)}`} value={fmtInt(k.ytd?.pb_count)} delta={k.ytd_growth_pct} sub={k.ytd_prev ? `${k.ytd_prev.year}: ${fmtInt(k.ytd_prev.pb_count)}` : ''} />
            <Tile label="Perubahan daya (PD) neto, 12 bulan" value={`${fmtInt(k.l12m?.pd_net_kva)} kVA`} sub={k.prev12m ? `sebelumnya ${fmtInt(k.prev12m.pd_net_kva)}` : ''} />
            <Tile label="Daya rata-rata per PB" value={`${fmtNum(k.avg_kva_per_pb, 2)} kVA`} sub={base > 0 ? `basis aktif DIL ${fmtInt(base)} pelanggan` : ''} />
          </div>
          {k.partial_month && <p className="text-xs text-slate-500 dark:text-slate-400">Bulan {monthLong(k.partial_month)} masih berjalan: digambar putus-putus dan tidak dihitung dalam pertumbuhan, pola musiman, maupun deteksi anomali.</p>}

          {insights.length > 0 && (
            <Section title="Temuan" hint="Disusun otomatis dari angka di bawah; hanya menyebut apa yang terukur.">
              <ul className="space-y-1.5 text-sm text-slate-700 dark:text-slate-300">
                {insights.map((i) => (
                  <li key={i.text} className="flex gap-2"><span aria-hidden className="mt-0.5 text-xs">{i.tone === 'up' ? '▲' : i.tone === 'down' ? '▼' : '•'}</span><span>{i.text}</span></li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Pelanggan baru (PB) per bulan" hint="Sambungan baru yang selesai tiap bulan. Sorot batang untuk rincian, pertumbuhan MoM dan YoY.">
            <ColumnChart data={pbData} ariaLabel="Grafik jumlah pelanggan baru per bulan" unit="PB" />
          </Section>
          <Section title="Tambahan daya dari PB per bulan (kVA)" hint="Daya sambungan baru; dibaca terpisah dari jumlah pelanggan karena daya per sambungan berubah dari tahun ke tahun.">
            <ColumnChart data={kvaData} color="var(--viz-s2)" format={fmtInt} ariaLabel="Grafik tambahan daya PB per bulan" unit="kVA" />
          </Section>

          <Section title="Ringkasan per tahun" hint="Pertumbuhan tahunan hanya dihitung untuk tahun yang lengkap 12 bulan dan berurutan.">
            <div className="overflow-x-auto">
              <table className="w-full min-w-176 text-left text-sm">
                <caption className="sr-only">Ringkasan penambahan pelanggan dan daya per tahun</caption>
                <thead className="text-xs uppercase tracking-wide text-slate-500"><tr>
                  <th className="py-2 pr-3">Tahun</th><th className="px-3 text-right">PB</th><th className="px-3 text-right">Pertumbuhan PB</th><th className="px-3 text-right">Daya PB (kVA)</th><th className="px-3 text-right">Pertumbuhan daya</th><th className="px-3 text-right">kVA/PB</th><th className="px-3 text-right">PD neto (kVA)</th><th className="px-3 text-right">Permohonan PB masuk</th><th className="px-3 text-right">Batal + restitusi</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {d.yearly.map((y) => (
                    <tr key={y.year}>
                      <td className="py-2 pr-3 font-semibold">{y.year}{y.partial ? <span className="ml-1.5 text-xs font-normal text-amber-700 dark:text-amber-400">({y.months} bulan)</span> : null}</td>
                      <td className="px-3 text-right tabular-nums">{fmtInt(y.pb_count)}</td><td className="px-3 text-right"><Delta value={y.yoy_pct} /></td>
                      <td className="px-3 text-right tabular-nums">{fmtInt(y.pb_kva)}</td><td className="px-3 text-right"><Delta value={y.yoy_kva_pct} /></td>
                      <td className="px-3 text-right tabular-nums">{fmtNum(y.avg_kva_per_pb, 2)}</td><td className="px-3 text-right tabular-nums">{fmtInt(y.pd_net_kva)}</td>
                      <td className="px-3 text-right tabular-nums">{fmtInt(y.requests_pb)}</td><td className="px-3 text-right tabular-nums">{fmtInt(y.cancelled + y.refunded)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          <Section title="Perubahan daya (PD) per bulan (kVA)" hint="Naik daya di atas garis nol, turun daya di bawahnya. Perubahan yang hanya mengganti tarif (selisih nol) tidak tergambar; jumlahnya ada di tooltip dan tabel.">
            <DivergingColumns data={pdData} upLabel="Naik daya" downLabel="Turun daya" ariaLabel="Grafik perubahan daya per bulan" unit="kVA" />
          </Section>

          <div className="grid gap-5 lg:grid-cols-2">
            <Section title="Komposisi tarif pelanggan baru" hint="Jumlah PB per kelompok tarif pada rentang terpilih.">
              <RankedBars ariaLabel="Komposisi PB per kelompok tarif" items={d.by_tariff.groups.map((g) => ({ key: g.group, label: g.group, value: g.count, text: `${fmtInt(g.count)} · ${fmtNum(g.share_pct)}%`, sub: `${fmtNum(g.kva, 0)} kVA, rata-rata ${fmtNum(g.avg_kva, 2)} kVA` }))} />
              <details className="mt-3 text-xs text-slate-600 dark:text-slate-400">
                <summary className="cursor-pointer font-medium">Tabel dan sepuluh tarif terbanyak</summary>
                <table className="mt-2 w-full text-left">
                  <thead className="uppercase tracking-wide text-slate-500"><tr><th className="py-1.5">Tarif</th><th>Kelompok</th><th className="text-right">PB</th><th className="text-right">Daya (kVA)</th><th className="text-right">kVA/PB</th></tr></thead>
                  <tbody>{d.by_tariff.top_codes.map((c) => <tr key={c.tariff} className="border-t border-slate-100 dark:border-slate-800"><td className="py-1.5 font-mono">{c.tariff}</td><td>{c.group}</td><td className="text-right tabular-nums">{fmtInt(c.count)}</td><td className="text-right tabular-nums">{fmtInt(c.kva)}</td><td className="text-right tabular-nums">{fmtNum(c.avg_kva, 2)}</td></tr>)}</tbody>
                </table>
              </details>
            </Section>
            <Section title="Pola musiman" hint="Indeks 1,0 = rata-rata bulanan; dihitung dari tahun yang lengkap saja.">
              {seasonal.length === 12
                ? <ColumnChart data={seasonal} height={200} format={(v) => fmtNum(v, 2)} refLine={{ value: 1, label: 'rata-rata = 1,0' }} ariaLabel="Indeks musiman pelanggan baru per bulan" unit="indeks" labelEvery={1} tickCount={3} />
                : <p className="py-6 text-center text-sm text-slate-500">{d.seasonality?.note || 'Pola musiman butuh minimal dua tahun penuh.'}</p>}
            </Section>
          </div>

          <Section title="Per ULP" hint="Batang = PB 12 bulan terakhir (laju per tahun). Tabel: total pada periode terpilih, rincian per tahun, rata-rata per tahun, dan 12 bulan terakhir dibandingkan basis pelanggan aktif DIL (September 2026).">
            <RankedBars ariaLabel="PB 12 bulan terakhir per ULP" items={d.by_unit.map((u) => ({ key: u.unit_id, label: u.unit_name, value: u.l12m_pb, text: fmtInt(u.l12m_pb), sub: `${u.up3_name || ''} · total periode ${fmtInt(u.pb_count)}` }))} />
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-240 text-left text-sm">
                <caption className="sr-only">Penambahan pelanggan baru per ULP, per tahun</caption>
                <thead className="text-xs uppercase tracking-wide text-slate-500"><tr>
                  <th className="py-2 pr-3">ULP</th>
                  {d.yearly.map((y) => <th key={y.year} className="px-3 text-right">PB {y.year}{y.partial ? ` (${y.months} bln)` : ''}</th>)}
                  <th className="px-3 text-right">Total periode</th><th className="px-3 text-right">Rata-rata/tahun</th><th className="px-3 text-right">12 bulan terakhir</th><th className="px-3 text-right">Daya 12 bln (kVA)</th><th className="px-3 text-right">kVA/PB</th><th className="px-3 text-right">PD neto (kVA)</th><th className="px-3 text-right">Basis aktif DIL</th><th className="px-3 text-right">12 bulan / basis</th>
                </tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {d.by_unit.map((u) => (
                    <tr key={u.unit_id}>
                      <td className="py-2 pr-3 font-medium" title={u.up3_name || undefined}>{u.unit_name}</td>
                      {d.yearly.map((y) => <td key={y.year} className="px-3 text-right tabular-nums">{fmtInt(u.by_year.find((x) => x.year === y.year)?.pb_count ?? 0)}</td>)}
                      <td className="px-3 text-right tabular-nums">{fmtInt(u.pb_count)}</td><td className="px-3 text-right tabular-nums">{fmtInt(u.avg_pb_per_year)}</td><td className="px-3 text-right font-semibold tabular-nums">{fmtInt(u.l12m_pb)}</td>
                      <td className="px-3 text-right tabular-nums">{fmtInt(u.l12m_kva)}</td><td className="px-3 text-right tabular-nums">{fmtNum(u.avg_kva_per_pb, 2)}</td><td className="px-3 text-right tabular-nums">{fmtInt(u.pd_net_kva)}</td>
                      <td className="px-3 text-right tabular-nums">{fmtInt(u.base_customers)}</td><td className="px-3 text-right tabular-nums">{u.l12m_vs_base_pct === null ? '-' : `${fmtNum(u.l12m_vs_base_pct, 2)}%`}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Section>

          {d.anomalies.length > 0 && (
            <Section title="Bulan yang menyimpang" hint="Jumlah PB menyimpang minimal 2 simpangan baku dari rata-rata 12 bulan sebelumnya. Penyebab tidak ditebak: periksa kegiatan atau kebijakan pada bulan itu.">
              <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
                {d.anomalies.slice(0, 8).map((a) => (
                  <li key={a.month} className="flex flex-wrap items-center gap-3 py-2">
                    <span className="w-24 font-semibold">{monthLong(a.month)}</span>
                    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold ${a.direction === 'NAIK' ? 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' : 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'}`}><span aria-hidden>{a.direction === 'NAIK' ? '▲' : '▼'}</span>{a.direction === 'NAIK' ? 'Lonjakan' : 'Penurunan'}</span>
                    <span className="tabular-nums">{fmtInt(a.pb_count)} PB</span><span className="text-slate-500">diperkirakan {fmtInt(a.expected)} (z = {fmtNum(a.z, 1)})</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}

          <Section title="Tabel bulanan" hint="Padanan tabel untuk semua grafik di atas (terbaru di atas).">
            <details>
              <summary className="cursor-pointer text-sm font-medium text-blue-700 dark:text-blue-300">Tampilkan tabel {monthly.length} bulan</summary>
              <div className="mt-3 max-h-96 overflow-auto">
                <table className="w-full min-w-208 text-left text-sm">
                  <caption className="sr-only">Penambahan pelanggan dan daya per bulan</caption>
                  <thead className="sticky top-0 bg-white text-xs uppercase tracking-wide text-slate-500 dark:bg-slate-900"><tr>
                    <th className="py-2 pr-3">Bulan</th><th className="px-3 text-right">PB</th><th className="px-3 text-right">Daya PB (kVA)</th><th className="px-3 text-right">kVA/PB</th><th className="px-3 text-right">MoM</th><th className="px-3 text-right">YoY</th><th className="px-3 text-right">PD naik</th><th className="px-3 text-right">PD turun</th><th className="px-3 text-right">PD neto (kVA)</th><th className="px-3 text-right">Mohon PB</th><th className="px-3 text-right">Batal</th><th className="px-3 text-right">Restitusi</th>
                  </tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {[...monthly].reverse().map((m) => (
                      <tr key={m.month}><td className="py-1.5 pr-3 font-medium">{monthLong(m.month)}{m.partial ? <span className="ml-1.5 text-xs font-normal text-amber-700 dark:text-amber-400">(berjalan)</span> : null}</td>
                        <td className="px-3 text-right tabular-nums">{fmtInt(m.pb_count)}</td><td className="px-3 text-right tabular-nums">{fmtNum(m.pb_kva)}</td><td className="px-3 text-right tabular-nums">{fmtNum(m.avg_kva_per_pb, 2)}</td>
                        <td className="px-3 text-right tabular-nums">{fmtPct(m.mom_pct)}</td><td className="px-3 text-right tabular-nums">{fmtPct(m.yoy_pct)}</td>
                        <td className="px-3 text-right tabular-nums">{fmtInt(m.pd_up_count)}</td><td className="px-3 text-right tabular-nums">{fmtInt(m.pd_down_count)}</td><td className="px-3 text-right tabular-nums">{fmtNum(m.pd_net_kva)}</td>
                        <td className="px-3 text-right tabular-nums">{fmtInt(m.requests_pb)}</td><td className="px-3 text-right tabular-nums">{fmtInt(m.cancelled)}</td><td className="px-3 text-right tabular-nums">{fmtInt(m.refunded)}</td></tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </Section>

          <Section title="Catatan data">
            <ul className="list-disc space-y-1 pl-5 text-xs text-slate-600 dark:text-slate-400">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul>
          </Section>
        </>
      )}
    </div>
  )
}
