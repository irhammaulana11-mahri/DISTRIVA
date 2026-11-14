import { useCallback, useEffect, useState } from 'react'
import { forecastApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { useDebounce } from '../../utils/useDebounce.js'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import Spinner from '../../components/Spinner.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import { IconChart, IconRefresh, IconZap, IconActivity, IconLayers } from '../../components/icons.jsx'

/**
 * Forecast beban gardu (docs/11; deep learning, keputusan pemilik Nov 2026): satu jaringan saraf bersama memprakirakan beban kVA gardu terhadap kapasitas trafo pada 1, 3, dan 5 tahun ke depan,
 * dengan rentang p10-p90, dan kapan gardu diperkirakan melewati 80% dan 100% kapasitas. Hasilnya rekomendasi: ditelaah perencana sebelum dipakai.
 */
const RISK = {
  KRITIS: { label: 'Kritis', hint: 'Sudah lewat 100% atau diperkirakan lewat dalam 1 tahun', cls: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800/60' },
  TINGGI: { label: 'Tinggi', hint: 'Diperkirakan lewat 100% dalam 3 tahun', cls: 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/50 dark:text-orange-300 dark:border-orange-800/60' },
  WASPADA: { label: 'Waspada', hint: 'Diperkirakan lewat 100% dalam 5 tahun, atau batas atas rentang melewatinya dalam 3 tahun', cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60' },
  AMAN: { label: 'Aman', hint: 'Tidak diperkirakan lewat 100% dalam 5 tahun', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60' },
}
const pill = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium'

export const pct = (ratio) => (ratio == null ? '-' : `${Math.round(ratio * 100)}%`)
export const fmtDate = (iso) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
}
export function exceedText(e) {
  if (!e) return '-'
  if (e.state === 'already') return 'sudah'
  if (e.state === 'forecast') return `sekitar ${fmtDate(e.date)}`
  return 'tidak dalam 5 tahun'
}

/** Daftar run satu jenis forecast: dipilih otomatis, disegarkan tiap 8 detik selama ada yang berjalan. */
function useRuns(kind) {
  const { notify } = useNotifications()
  const [runs, setRuns] = useState({ loading: true, error: '', rows: [], can: {} })
  const [runId, setRunId] = useState('')
  const [starting, setStarting] = useState(false)

  const loadRuns = useCallback(async () => {
    try {
      const r = await forecastApi.runs(kind)
      setRuns({ loading: false, error: '', rows: r?.data || [], can: r?.can || {} })
      return r?.data || []
    } catch (err) {
      setRuns({ loading: false, error: err?.message || 'Gagal memuat daftar forecast.', rows: [], can: {} })
      return []
    }
  }, [kind])

  useEffect(() => { loadRuns().then((rows) => setRunId((cur) => cur || rows.find((x) => x.status === 'SUCCEEDED')?.id || rows[0]?.id || '')) }, [loadRuns])

  const running = runs.rows.some((r) => r.status === 'RUNNING')
  useEffect(() => {
    if (!running) return undefined
    const t = setInterval(async () => {
      const rows = await loadRuns()
      const done = rows.find((x) => x.status === 'SUCCEEDED' || x.status === 'INSUFFICIENT')
      if (!rows.some((x) => x.status === 'RUNNING') && done) setRunId(rows[0]?.id || done.id)
    }, 8000)
    return () => clearInterval(t)
  }, [running, loadRuns])

  const start = async () => {
    setStarting(true)
    try {
      const r = await forecastApi.start(kind === 'DEMAND' ? 'DEMAND' : undefined)
      notify({ type: 'success', title: 'Forecast dimulai', desc: r?.message || 'Berjalan di latar belakang.', tag: 'Forecast' })
      const rows = await loadRuns()
      setRunId(rows[0]?.id || '')
    } catch (err) {
      notify({ type: 'error', title: 'Forecast tidak dapat dimulai', desc: err?.message || 'Terjadi kesalahan.', tag: 'Forecast' })
    } finally {
      setStarting(false)
    }
  }

  return { runs, runId, setRunId, loadRuns, running, starting, start, selected: runs.rows.find((r) => r.id === runId) }
}

const TABS = [
  { key: 'gardu', label: 'Beban gardu' },
  { key: 'customers', label: 'Pelanggan & daya (VA)' },
  { key: 'material', label: 'Material' },
  { key: 'derived', label: 'Kebutuhan material PLN' },
]

export default function ForecastPage() {
  const [tab, setTab] = useState('gardu')
  return (
    <div className="space-y-6">
      {/* Header Modul Forecast Beban Gardu & Kebutuhan */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
              <IconChart className="h-6 w-6" />
            </div>
            <div>
              <nav className="text-xs text-slate-500 mb-1">
                <span>DISTRIVA</span>
                <span className="mx-1.5">/</span>
                <span>Perencanaan</span>
                <span className="mx-1.5">/</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">Forecast Beban Gardu &amp; Kebutuhan</span>
              </nav>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Forecast Beban Gardu &amp; Kebutuhan
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Model Ansambel GRU
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                Prakiraan berbasis deep learning (ansambel kuantil GRU 1–5 tahun): evaluasi beban gardu, pertumbuhan pelanggan &amp; daya (VA), serta proyeksi kebutuhan material PLN.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 shadow-2xs">
              <IconZap size={14} className="text-amber-500" />
              <span>Model: <strong className="font-semibold text-slate-900 dark:text-slate-100">Ansambel GRU</strong></span>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-xs text-slate-700 dark:text-slate-300 shadow-2xs">
              <IconActivity size={14} className="text-emerald-500" />
              <span>Horizon: <strong className="font-semibold text-slate-900 dark:text-slate-100">1 – 5 Tahun</strong></span>
            </div>
          </div>
        </div>
      </div>

      {/* Navigasi Tab */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <div role="tablist" aria-label="Jenis forecast" className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {TABS.map((t) => {
            const isActive = tab === t.key
            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => setTab(t.key)}
                className={`flex items-center gap-2 whitespace-nowrap rounded-t-xl px-4 py-3 text-sm font-semibold border-b-2 -mb-px transition-all cursor-pointer ${
                  isActive
                    ? 'border-blue-600 bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100/50 dark:hover:bg-slate-800/50'
                }`}
              >
                <span>{t.label}</span>
              </button>
            )
          })}
        </div>
      </div>

      {tab === 'gardu' ? <GarduForecast /> : tab === 'derived' ? <DerivedNeed /> : <DemandForecast key={tab} kinds={tab === 'customers' ? ['CUSTOMERS_ADDED', 'VA_ADDED'] : ['MATERIAL_ISSUE']} />}
    </div>
  )
}

function RunHeader({ title, hook, canRun, disabledReason }) {
  const { runs, runId, setRunId, loadRuns, running, starting, start } = hook
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
        {disabledReason && <p className="text-xs text-slate-500">{disabledReason}</p>}
      </div>
      <div className="flex flex-wrap items-end gap-2">
        {runs.rows.length > 0 && (
          <div>
            <label htmlFor={`fc-run-${title}`} className="block text-xs text-slate-500">Hasil forecast</label>
            <select id={`fc-run-${title}`} value={runId} onChange={(e) => setRunId(e.target.value)} className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-2 text-base sm:text-sm">
              {runs.rows.map((r) => <option key={r.id} value={r.id}>{fmtDate(r.started_at)} · {{ SUCCEEDED: 'selesai', RUNNING: 'berjalan', INSUFFICIENT: 'data kurang' }[r.status] || 'gagal'}</option>)}
            </select>
          </div>
        )}
        <Button variant="secondary" icon={IconRefresh} onClick={loadRuns} aria-label="Muat ulang">Muat ulang</Button>
        {canRun && <Button onClick={start} loading={starting} disabled={running}>Jalankan forecast</Button>}
      </div>
    </div>
  )
}

function GarduForecast() {
  const { can, isSysAdmin } = useAccess()
  const { notify } = useNotifications()
  const hook = useRuns('GARDU_LOAD')
  const { runs, runId, loadRuns, running, selected } = hook
  const [run, setRun] = useState(null)
  const [reviewing, setReviewing] = useState(false)
  const canRun = Boolean(runs.can.run || can['forecast.run'] || isSysAdmin)
  const canReview = Boolean(runs.can.review || can['forecast.review'] || isSysAdmin)

  const loadRun = useCallback(async () => {
    if (!runId) { setRun(null); return }
    try {
      const r = await forecastApi.run(runId)
      setRun(r?.data || null)
    } catch (err) {
      setRun(null)
      notify({ type: 'error', title: 'Gagal memuat forecast', desc: err?.message || 'Terjadi kesalahan.', tag: 'Forecast' })
    }
  }, [runId, notify])
  useEffect(() => { loadRun() }, [loadRun, selected?.status])

  return (
    <div className="space-y-5">
      <RunHeader title="Beban gardu" hook={hook} canRun={canRun} disabledReason="Prakiraan beban trafo 1, 3, dan 5 tahun ke depan, dan kapan melewati 80% dan 100% kapasitas." />
      {runs.error && <Alert variant="error">{runs.error}</Alert>}
      {runs.loading ? <div className="flex justify-center py-12"><Spinner /></div> : runs.rows.length === 0 ? (
        <EmptyState icon={IconChart} title="Belum ada forecast" description={canRun ? 'Klik "Jalankan forecast" untuk melatih model dari data pembacaan gardu. Prosesnya memerlukan beberapa menit.' : 'Forecast dijalankan oleh tim perencanaan.'} />
      ) : (
        <>
          {running && <Alert variant="info">Forecast sedang berjalan di latar belakang (beberapa menit). Halaman ini menyegarkan diri sendiri.</Alert>}
          {selected?.status === 'FAILED' && <Alert variant="error">{selected.error || 'Forecast gagal.'}</Alert>}
          {run && run.status === 'SUCCEEDED' && <RunView run={run} canReview={canReview} onReview={() => setReviewing(true)} />}
        </>
      )}

      {reviewing && run && (
        <ReasonDialog open title="Tandai forecast sudah ditelaah" description="Catatan telaah (mis. kesesuaian dengan kondisi lapangan) disimpan bersama hasil forecast." confirmLabel="Tandai ditelaah"
          onClose={() => setReviewing(false)}
          onConfirm={async (note) => { await forecastApi.review(run.id, note); setReviewing(false); notify({ type: 'success', title: 'Forecast ditelaah', desc: 'Tercatat.', tag: 'Forecast' }); await loadRuns(); await loadRun() }} />
      )}
    </div>
  )
}

const KIND_LABEL = { CUSTOMERS_ADDED: 'Pelanggan baru (permohonan PB)', VA_ADDED: 'Tambahan daya tersambung (kVA)', MATERIAL_ISSUE: 'Pemakaian material' }
const KIND_UNIT = { CUSTOMERS_ADDED: 'pelanggan', VA_ADDED: 'kVA', MATERIAL_ISSUE: '' }
const num = (v) => (v == null ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: v >= 100 ? 0 : 1 }))

function DemandForecast({ kinds }) {
  const { can, isSysAdmin } = useAccess()
  const hook = useRuns('DEMAND')
  const { runs, runId, running, selected } = hook
  const canRun = Boolean(runs.can.run || can['forecast.run'] || isSysAdmin)
  const [run, setRun] = useState(null)
  const material = kinds.includes('MATERIAL_ISSUE')

  useEffect(() => {
    let live = true
    setRun(null)
    if (runId) forecastApi.run(runId).then((r) => { if (live) setRun(r?.data || null) }).catch(() => { if (live) setRun(null) })
    return () => { live = false }
  }, [runId, selected?.status])

  return (
    <div className="space-y-5">
      <RunHeader title={material ? 'Pemakaian material' : 'Pelanggan baru dan daya (VA)'} hook={hook} canRun={canRun}
        disabledReason={material ? 'Prakiraan 12 bulan ke depan dari pengeluaran material MIMS per ULP dan material.' : 'Prakiraan 12 bulan ke depan dari permohonan yang tercatat: pelanggan baru dan tambahan daya tersambung per ULP.'} />
      {runs.error && <Alert variant="error">{runs.error}</Alert>}
      {runs.loading ? <div className="flex justify-center py-12"><Spinner /></div> : runs.rows.length === 0 ? (
        <EmptyState icon={IconChart} title="Belum ada forecast" description={canRun ? 'Klik "Jalankan forecast". Bila riwayat data belum cukup (minimal 24 bulan), sistem akan menjelaskan apa yang kurang.' : 'Forecast dijalankan oleh tim perencanaan.'} />
      ) : (
        <>
          {running && <Alert variant="info">Forecast sedang berjalan di latar belakang. Halaman ini menyegarkan diri sendiri.</Alert>}
          {selected?.status === 'FAILED' && <Alert variant="error">{selected.error || 'Forecast gagal.'}</Alert>}
          {run?.status === 'INSUFFICIENT' && <InsufficientNotice run={run} kinds={kinds} />}
          {run?.status === 'SUCCEEDED' && <DemandView run={run} kinds={kinds} />}
        </>
      )}
    </div>
  )
}

function InsufficientNotice({ run, kinds }) {
  const cov = run.data_window?.coverage || {}
  return (
    <div className="space-y-3">
      <Alert variant="warning">{run.error || 'Riwayat data belum cukup untuk melatih model.'}</Alert>
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
        <table className="w-full text-left text-sm">
          <thead><tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700"><th className="px-3 py-2">Data</th><th className="px-3 py-2 text-right">Riwayat (bulan)</th><th className="px-3 py-2 text-right">Seri</th><th className="px-3 py-2 text-right">Memenuhi syarat</th><th className="px-3 py-2">Mulai</th></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {Object.entries(cov).filter(([k]) => kinds.includes(k)).map(([k, v]) => (
              <tr key={k}><td className="px-3 py-2">{KIND_LABEL[k]}</td><td className="px-3 py-2 text-right">{v.months}</td><td className="px-3 py-2 text-right">{v.series}</td><td className="px-3 py-2 text-right">{v.sufficient_series}</td><td className="px-3 py-2">{v.first_month || '-'}</td></tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-slate-500 dark:text-slate-400">Cara menambah riwayat: permohonan lewat Sinkronisasi EIS dengan "lookback" lebih panjang; pengeluaran material lewat Tarik MIMS dengan rentang tanggal bertahap (maks. 366 hari per tarikan).</p>
    </div>
  )
}

function MiniBars({ months }) {
  const max = Math.max(...months.map((m) => m.p90), 1e-9)
  return (
    <svg viewBox="0 0 120 32" className="h-8 w-full max-w-40" role="img" aria-label="Prakiraan 12 bulan: nilai tengah dan rentang">
      {months.map((m, i) => (
        <g key={m.month}>
          <rect x={i * 10 + 1} y={32 - (m.p90 / max) * 30} width="8" height={Math.max(((m.p90 - m.p10) / max) * 30, 1)} className="fill-slate-300 dark:fill-slate-600" />
          <rect x={i * 10 + 1} y={32 - (m.p50 / max) * 30} width="8" height="2" className="fill-brand-600" />
        </g>
      ))}
    </svg>
  )
}

function DemandView({ run, kinds }) {
  const m = run.metrics?.all || {}
  const [kind, setKind] = useState(kinds[0])
  const [unit, setUnit] = useState('')
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 350)
  const [page, setPage] = useState(1)
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })
  const material = kinds.includes('MATERIAL_ISSUE')

  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, loading: true, error: '' }))
    forecastApi.series(run.id, { kind, unit_id: unit, search: debounced.trim(), page, per_page: 25 })
      .then((r) => { if (live) setState({ loading: false, error: '', rows: r?.data || [], meta: r?.meta || null }) })
      .catch((err) => { if (live) setState({ loading: false, error: err?.message || 'Gagal memuat prakiraan.', rows: [], meta: null }) })
    return () => { live = false }
  }, [run.id, kind, unit, debounced, page])

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Selisih relatif (WAPE)" value={`${Math.round((m.wape ?? 0) * 100)}%`} hint="jumlah selisih prakiraan dan kenyataan dibanding jumlah kenyataan (diuji pada bulan yang tidak dipakai melatih)" />
        <Stat label="Rentang p10–p90 tepat" value={`${Math.round((m.coverage_p10_p90 ?? 0) * 100)}%`} hint="idealnya sekitar 80%" />
        <Stat label="Dibanding rata-rata 12 bulan" value={m.wape_gain_vs_persistence_pct == null ? '-' : `${m.wape_gain_vs_persistence_pct > 0 ? 'lebih baik ' : 'lebih buruk '}${Math.abs(m.wape_gain_vs_persistence_pct).toString().replace('.', ',')}%`} hint="dibanding menganggap tiap bulan sama dengan rata-rata 12 bulan terakhir" />
        <Stat label="Deret diprakirakan" value={`${run.counts?.sufficient_series ?? 0} dari ${run.counts?.series ?? 0}`} hint="deret dengan riwayat < 24 bulan tidak diprakirakan" />
      </dl>
      <p className="text-xs text-slate-500 dark:text-slate-400">Data s.d. {fmtDate(run.data_cutoff)} · dijalankan oleh {run.started_by_name}. {run.assumptions}</p>
      <div className="flex flex-wrap items-end gap-3">
        {kinds.length > 1 && (
          <div>
            <label htmlFor="dm-kind" className="block text-xs text-slate-500">Yang diprakirakan</label>
            <select id="dm-kind" value={kind} onChange={(e) => { setKind(e.target.value); setPage(1) }} className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-2 text-base sm:text-sm">
              {kinds.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
            </select>
          </div>
        )}
        {material && (
          <div className="flex-1 min-w-48">
            <label htmlFor="dm-search" className="block text-xs text-slate-500">Cari material</label>
            <input id="dm-search" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Nomor atau nama material" className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-base sm:text-sm" />
          </div>
        )}
      </div>
      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.loading ? <div className="flex justify-center py-10"><Spinner /></div> : state.rows.length === 0 ? (
        <EmptyState icon={IconChart} title="Tidak ada prakiraan" description="Tidak ada deret yang memenuhi syarat riwayat untuk filter ini." />
      ) : (
        <div className="space-y-3">
          {state.rows.map((r) => (
            <article key={r.series_id} className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 break-words">{r.item_code ? `${r.item_code} · ${r.item_label || ''}` : KIND_LABEL[r.kind]}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400">{r.unit_name} · riwayat {r.history_months} bulan</p>
                </div>
                <MiniBars months={r.months} />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                <div><dt className="text-slate-400">12 bulan terakhir (nyata)</dt><dd className="text-base font-semibold text-slate-900 dark:text-slate-100">{num(r.last_12_months)} {KIND_UNIT[r.kind]}</dd></div>
                {['3', '6', '12'].map((n) => (
                  <div key={n}><dt className="text-slate-400">{n} bulan ke depan</dt><dd className="text-base font-semibold text-slate-900 dark:text-slate-100">{num(r.totals[n].p50)} {KIND_UNIT[r.kind]}</dd><dd className="text-slate-500">rentang {num(r.totals[n].p10)}–{num(r.totals[n].p90)}</dd></div>
                ))}
              </dl>
            </article>
          ))}
          {state.meta && <TableFooter itemCount={state.rows.length} total={state.meta.total} entityLabel="deret" page={state.meta.current_page} perPage={25} onPage={setPage} onPerPage={() => {}} perPageOptions={[25]} />}
        </div>
      )}
    </div>
  )
}

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
      <dt className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="mt-1 text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100">{value}</dd>
      {hint && <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">{hint}</p>}
    </div>
  )
}

function RunView({ run, canReview, onReview }) {
  const m = run.metrics?.all || {}
  const [unit, setUnit] = useState('')
  const [risk, setRisk] = useState('')
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 350)
  const [stale, setStale] = useState(false)
  const [page, setPage] = useState(1)
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })

  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, loading: true, error: '' }))
    forecastApi.substations(run.id, { unit_id: unit, risk, search: debounced.trim(), stale: stale ? 1 : '', page, per_page: 25 })
      .then((r) => { if (live) setState({ loading: false, error: '', rows: r?.data || [], meta: r?.meta || null }) })
      .catch((err) => { if (live) setState({ loading: false, error: err?.message || 'Gagal memuat daftar gardu.', rows: [], meta: null }) })
    return () => { live = false }
  }, [run.id, unit, risk, debounced, stale, page])

  const totals = run.summary.reduce((a, s) => ({ total: a.total + s.total, kritis: a.kritis + s.kritis, tinggi: a.tinggi + s.tinggi, waspada: a.waspada + s.waspada }), { total: 0, kritis: 0, tinggi: 0, waspada: 0 })

  return (
    <div className="space-y-5">
      <section aria-labelledby="fc-q" className="space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="fc-q" className="text-base font-semibold text-slate-900 dark:text-slate-100">Seberapa dapat dipercaya</h2>
          <div className="flex items-center gap-2">
            <span className={`${pill} ${run.review_status === 'REVIEWED' ? RISK.AMAN.cls : RISK.WASPADA.cls}`}>{run.review_status === 'REVIEWED' ? 'Sudah ditelaah' : 'Belum ditelaah'}</span>
            {canReview && run.review_status !== 'REVIEWED' && <Button size="sm" variant="outline" onClick={onReview}>Tandai ditelaah</Button>}
          </div>
        </div>
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Selisih rata-rata" value={`${(m.mae_pp ?? 0).toString().replace('.', ',')} poin`} hint="antara prakiraan dan pengukuran nyata, dalam % kapasitas trafo (diuji pada data yang tidak dipakai melatih)" />
          <Stat label="Rentang p10–p90 tepat" value={`${Math.round((m.coverage_p10_p90 ?? 0) * 100)}%`} hint="hasil nyata yang jatuh di dalam rentang prakiraan (idealnya sekitar 80%)" />
          <Stat label="Gardu overload terdeteksi" value={`${Math.round((m.overload_recall_p90 ?? 0) * 100)}%`} hint={`bila memakai batas atas rentang (p90); dengan nilai tengah saja ${Math.round((m.overload_recall_p50 ?? 0) * 100)}%`} />
          <Stat label="Dibanding pembacaan terakhir" value={m.mae_gain_vs_persistence_pct == null ? '-' : `${m.mae_gain_vs_persistence_pct > 0 ? 'lebih baik ' : 'lebih buruk '}${Math.abs(m.mae_gain_vs_persistence_pct).toString().replace('.', ',')}%`} hint="dibanding menganggap beban sama dengan pembacaan terakhir" />
        </dl>
        <p className="text-xs text-slate-500 dark:text-slate-400">
          Model: {run.model?.name} v{run.model?.version} · {run.counts?.forecast_substations?.toLocaleString('id-ID')} gardu · data pembacaan s.d. {fmtDate(run.data_cutoff)} · dijalankan oleh {run.started_by_name}. Prakiraan per gardu bersifat indikatif (kebanyakan gardu hanya diukur sekitar setahun sekali); gunakan bersama survei lapangan.
        </p>
        {run.assumptions && <details className="text-xs text-slate-600 dark:text-slate-300"><summary className="cursor-pointer font-medium">Asumsi</summary><p className="mt-1">{run.assumptions}</p></details>}
        {run.review_note && <p className="text-xs text-slate-600 dark:text-slate-300">Catatan telaah ({run.reviewed_by_name}): {run.review_note}</p>}
      </section>

      <section aria-labelledby="fc-s" className="space-y-2">
        <h2 id="fc-s" className="text-base font-semibold text-slate-900 dark:text-slate-100">Ringkasan per ULP</h2>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700">
              <th className="px-3 py-2">ULP</th><th className="px-3 py-2 text-right">Gardu</th><th className="px-3 py-2 text-right">Kritis</th><th className="px-3 py-2 text-right">Tinggi</th><th className="px-3 py-2 text-right">Waspada</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {run.summary.map((s) => (
                <tr key={s.unit_id}><td className="px-3 py-2">{s.unit_code} · {s.unit_name}</td><td className="px-3 py-2 text-right">{s.total}</td>
                  <td className="px-3 py-2 text-right font-semibold text-red-700 dark:text-red-300">{s.kritis}</td><td className="px-3 py-2 text-right">{s.tinggi}</td><td className="px-3 py-2 text-right">{s.waspada}</td></tr>
              ))}
              <tr className="font-semibold"><td className="px-3 py-2">Jumlah</td><td className="px-3 py-2 text-right">{totals.total}</td><td className="px-3 py-2 text-right">{totals.kritis}</td><td className="px-3 py-2 text-right">{totals.tinggi}</td><td className="px-3 py-2 text-right">{totals.waspada}</td></tr>
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="fc-l" className="space-y-3">
        <h2 id="fc-l" className="text-base font-semibold text-slate-900 dark:text-slate-100">Daftar gardu</h2>
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label htmlFor="fc-risk" className="block text-xs text-slate-500">Tingkat risiko</label>
            <select id="fc-risk" value={risk} onChange={(e) => { setRisk(e.target.value); setPage(1) }} className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-2 text-base sm:text-sm">
              <option value="">Semua</option>
              {Object.entries(RISK).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          {run.summary.length > 1 && (
            <div>
              <label htmlFor="fc-unit" className="block text-xs text-slate-500">ULP</label>
              <select id="fc-unit" value={unit} onChange={(e) => { setUnit(e.target.value); setPage(1) }} className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-2 text-base sm:text-sm">
                <option value="">Semua</option>
                {run.summary.map((s) => <option key={s.unit_id} value={s.unit_id}>{s.unit_code} · {s.unit_name}</option>)}
              </select>
            </div>
          )}
          <div className="flex-1 min-w-48">
            <label htmlFor="fc-search" className="block text-xs text-slate-500">Cari</label>
            <input id="fc-search" type="search" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Kode, nama gardu, atau penyulang" className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-base sm:text-sm" />
          </div>
          <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 pb-2"><input type="checkbox" checked={stale} onChange={(e) => { setStale(e.target.checked); setPage(1) }} /> Pembacaan terakhir &gt; 3 tahun</label>
        </div>
        {state.error && <Alert variant="error">{state.error}</Alert>}
        {state.loading ? <div className="flex justify-center py-10"><Spinner /></div> : state.rows.length === 0 ? (
          <EmptyState icon={IconChart} title="Tidak ada gardu" description="Tidak ada gardu yang sesuai filter." />
        ) : (
          <div className="space-y-3">
            {state.rows.map((r) => <SubstationRow key={r.substation_id} row={r} />)}
            {state.meta && <TableFooter itemCount={state.rows.length} total={state.meta.total} entityLabel="gardu" page={state.meta.current_page} perPage={25} onPage={setPage} onPerPage={() => {}} perPageOptions={[25]} />}
          </div>
        )}
      </section>
    </div>
  )
}

function SubstationRow({ row }) {
  const rk = RISK[row.risk] || RISK.AMAN
  return (
    <article className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100 break-words">{row.code} {row.name ? `· ${row.name}` : ''}</h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">{row.unit_name}{row.feeder_code ? ` · penyulang ${row.feeder_code}` : ''} · {row.capacity_kva} kVA</p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className={`${pill} ${rk.cls}`} title={rk.hint}>{rk.label}</span>
          {row.stale && <span className={`${pill} bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700`}>Pembacaan lama</span>}
        </div>
      </div>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
        <div><dt className="text-slate-400">Beban terakhir ({fmtDate(row.last_reading_on)})</dt><dd className="text-base font-semibold text-slate-900 dark:text-slate-100">{pct(row.last_ratio)}</dd></div>
        {['1', '3', '5'].map((y) => (
          <div key={y}><dt className="text-slate-400">{y} tahun lagi</dt>
            <dd className={`text-base font-semibold ${row.horizons[y].p50 >= 1 ? 'text-red-700 dark:text-red-300' : 'text-slate-900 dark:text-slate-100'}`}>{pct(row.horizons[y].p50)}</dd>
            <dd className="text-slate-500">rentang {pct(row.horizons[y].p10)}–{pct(row.horizons[y].p90)}</dd></div>
        ))}
      </dl>
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">Melewati 80%: {exceedText(row.exceed_80)} · melewati 100%: {exceedText(row.exceed_100)} · dasar prakiraan {row.history_readings} pembacaan</p>
    </article>
  )
}

const range = (r) => (r ? `${num(r.p50)} (${num(r.p10)}-${num(r.p90)})` : '-')

/** Kebutuhan material yang disediakan PLN, diturunkan dari forecast beban gardu dan pelanggan baru lewat BOM yang berlaku (keputusan pemilik Nov 2026). */
function DerivedNeed() {
  const [data, setData] = useState(null)
  const [error, setError] = useState('')
  useEffect(() => {
    let live = true
    forecastApi.derived().then((r) => { if (live) setData(r?.data || null) }).catch((e) => { if (live) setError(e.message || 'Gagal memuat.') })
    return () => { live = false }
  }, [])
  if (error) return <Alert variant="error">{error}</Alert>
  if (!data) return <div className="flex justify-center py-12"><Spinner /></div>
  const { gardu, customers, materials, poles } = data
  return (
    <div className="space-y-5">
      <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label={`Gardu di atas ${Math.round(data.threshold * 100)}%`} value={num(gardu.trigger_count)} hint="Trafo PLN aktif; diganti satu tingkat kapasitas di atasnya" />
        <Stat label="Pelanggan baru, 12 bulan" value={customers.new_customers ? range(customers.new_customers) : '-'} hint="Median (rentang p10-p90)" />
        <Stat label="Jenis material PLN" value={num(materials.length)} />
        <Stat label="Jenis tiang diprakirakan" value={num(new Set(poles.map((p) => p.item_code)).size)} />
      </dl>
      {!gardu.run_id && <Alert variant="warning">Forecast beban gardu belum pernah dijalankan, jadi kebutuhan trafo pengganti belum bisa dihitung.</Alert>}
      {customers.status !== 'SUCCEEDED' && <Alert variant="warning">Kebutuhan material untuk pelanggan baru belum bisa dihitung: forecast pelanggan belum berhasil (riwayat data belum cukup). Lihat tab Pelanggan & daya (VA).</Alert>}
      {gardu.without_bom?.length > 0 && <Alert variant="info">{`Ukuran trafo pengganti tanpa baris konstruksi di BOM (hanya trafo yang dihitung, bila ada di KHS): ${gardu.without_bom.map((x) => `${x.kva} kVA (${x.count} gardu)`).join(', ')}.`}</Alert>}
      {materials.length === 0 ? <EmptyState icon={IconChart} title="Belum ada kebutuhan turunan" description="Belum ada gardu di atas ambang atau forecast pelanggan yang berhasil." /> : (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          <table className="w-full text-left text-sm">
            <thead><tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700"><th className="px-3 py-2">Kode</th><th className="px-3 py-2">Material (disediakan PLN)</th><th className="px-3 py-2 text-right">Dari gardu</th><th className="px-3 py-2 text-right">Dari pelanggan baru</th><th className="px-3 py-2 text-right">Total 12 bulan</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {materials.map((m) => (
                <tr key={m.code}><td className="px-3 py-2 font-mono text-xs">{m.code}</td><td className="px-3 py-2">{m.name}</td><td className="px-3 py-2 text-right">{num(m.gardu)}</td><td className="px-3 py-2 text-right">{customers.new_customers ? range(m.customers) : '-'}</td><td className="px-3 py-2 text-right font-medium">{range(m.total)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <section aria-label="Kebutuhan tiang" className="space-y-2">
        <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Kebutuhan tiang</h2>
        {poles.length === 0 ? <p className="text-sm text-slate-500 dark:text-slate-400">Prakiraan tiang belum ada: dihitung dari pemakaian tiang di MIMS dan butuh riwayat minimal 24 bulan (lihat tab Material).</p> : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            <table className="w-full text-left text-sm">
              <thead><tr className="text-xs text-slate-500 border-b border-slate-200 dark:border-slate-700"><th className="px-3 py-2">ULP</th><th className="px-3 py-2">Tiang</th><th className="px-3 py-2 text-right">12 bulan terakhir</th><th className="px-3 py-2 text-right">12 bulan ke depan</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {poles.map((p) => (
                  <tr key={`${p.unit_code}-${p.item_code}`}><td className="px-3 py-2">{p.unit_name}</td><td className="px-3 py-2">{p.item_label}</td><td className="px-3 py-2 text-right">{num(p.last_12_months)}</td><td className="px-3 py-2 text-right font-medium">{range(p.next_12_months)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500 dark:text-slate-400">{data.assumptions.map((a) => <li key={a}>{a}</li>)}</ul>
    </div>
  )
}
