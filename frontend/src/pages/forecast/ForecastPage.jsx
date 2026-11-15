import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { forecastApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { useDebounce } from '../../utils/useDebounce.js'
import { downloadCsv } from '../../utils/csvTemplates.js'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import Spinner from '../../components/Spinner.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import {
  IconChart,
  IconRefresh,
  IconZap,
  IconActivity,
  IconLayers,
  IconSearch,
  IconCheckCircle,
  IconAlertCircle,
  IconClock,
  IconBuilding,
  IconX,
  IconDownload,
  IconArrowRight,
} from '../../components/icons.jsx'

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

/** Standar kapasitas trafo distribusi PLN (kVA) untuk rekomendasi up-rating */
const PLN_TRAFO_SIZES = [25, 50, 100, 160, 200, 250, 315, 400, 630, 1000, 1250, 1600, 2000, 2500]
export function getNextTrafoKva(currentKva) {
  const current = Number(currentKva) || 0
  const next = PLN_TRAFO_SIZES.find((s) => s > current)
  return next || (current > 0 ? Math.round(current * 1.5) : 100)
}

/** Ekspor data hasil forecast gardu ke file CSV standar */
export function exportSubstationsCsv(filename, rows) {
  const headers = [
    'Kode Gardu',
    'Nama Gardu',
    'ULP',
    'Penyulang',
    'Kapasitas Trafo (kVA)',
    'Tingkat Risiko',
    'Beban Terakhir (%)',
    'Tgl Beban Terakhir',
    'Prakiraan 1 Thn (%)',
    'Rentang 1 Thn (p10-p90)',
    'Prakiraan 3 Thn (%)',
    'Rentang 3 Thn (p10-p90)',
    'Prakiraan 5 Thn (%)',
    'Rentang 5 Thn (p10-p90)',
    'Estimasi Lewat 80%',
    'Estimasi Lewat 100%',
    'Dasar Pembacaan',
  ]
  const lines = [headers.join(',')]
  rows.forEach((r) => {
    const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`
    lines.push([
      esc(r.code),
      esc(r.name || ''),
      esc(r.unit_name),
      esc(r.feeder_code || ''),
      esc(r.capacity_kva),
      esc(r.risk),
      esc(pct(r.last_ratio)),
      esc(fmtDate(r.last_reading_on)),
      esc(pct(r.horizons?.['1']?.p50)),
      esc(`${pct(r.horizons?.['1']?.p10)} - ${pct(r.horizons?.['1']?.p90)}`),
      esc(pct(r.horizons?.['3']?.p50)),
      esc(`${pct(r.horizons?.['3']?.p10)} - ${pct(r.horizons?.['3']?.p90)}`),
      esc(pct(r.horizons?.['5']?.p50)),
      esc(`${pct(r.horizons?.['5']?.p10)} - ${pct(r.horizons?.['5']?.p90)}`),
      esc(exceedText(r.exceed_80)),
      esc(exceedText(r.exceed_100)),
      esc(r.history_readings),
    ].join(','))
  })
  downloadCsv(filename, lines.join('\n'))
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
        <SchedulePanel />
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
            <article key={r.series_id} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-xs hover:border-blue-300 dark:hover:border-blue-700/60 transition-all">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight break-words">{r.item_code ? `${r.item_code} · ${r.item_label || ''}` : KIND_LABEL[r.kind]}</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{r.unit_name} · riwayat {r.history_months} bulan</p>
                </div>
                <div className="bg-slate-50 dark:bg-slate-850 p-2 rounded-xl border border-slate-200/80 dark:border-slate-800">
                  <MiniBars months={r.months} />
                </div>
              </div>
              <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
                <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60 p-3">
                  <dt className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">12 bulan terakhir (nyata)</dt>
                  <dd className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{num(r.last_12_months)} <span className="text-xs font-normal text-slate-500">{KIND_UNIT[r.kind]}</span></dd>
                </div>
                {['3', '6', '12'].map((n) => (
                  <div key={n} className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60 p-3">
                    <dt className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">{n} bulan ke depan</dt>
                    <dd className="mt-1 text-lg font-bold text-slate-900 dark:text-slate-100">{num(r.totals[n].p50)} <span className="text-xs font-normal text-slate-500">{KIND_UNIT[r.kind]}</span></dd>
                    <dd className="mt-0.5 text-[11px] text-slate-500 font-medium">rentang {num(r.totals[n].p10)}–{num(r.totals[n].p90)}</dd>
                  </div>
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

function LoadBar({ value }) {
  const ratio = value ?? 0
  const pctDisplay = Math.min(Math.max(ratio * 100, 0), 100)
  const isOver100 = ratio >= 1.0
  const isOver80 = ratio >= 0.8

  const barColor = isOver100
    ? 'bg-rose-500 dark:bg-rose-500'
    : isOver80
    ? 'bg-amber-500 dark:bg-amber-500'
    : 'bg-emerald-500 dark:bg-emerald-500'

  return (
    <div className="relative mt-2 h-1.5 w-full overflow-hidden rounded-full bg-slate-200/70 dark:bg-slate-750">
      <div
        className="absolute top-0 bottom-0 z-10 w-0.5 bg-amber-400 dark:bg-amber-300"
        style={{ left: '80%' }}
        title="Batas ambang 80%"
      />
      <div
        className={`h-full rounded-full transition-all duration-300 ${barColor}`}
        style={{ width: `${pctDisplay}%` }}
      />
    </div>
  )
}

function ExceedBadge({ title, exceed, is100 = false }) {
  const text = exceedText(exceed)
  const isAlready = exceed?.state === 'already'
  const isForecast = exceed?.state === 'forecast'

  let badgeCls = 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border-slate-200 dark:border-slate-700'
  if (isAlready) {
    badgeCls = is100
      ? 'bg-rose-50 text-rose-800 border-rose-200 dark:bg-rose-950/70 dark:text-rose-300 dark:border-rose-800'
      : 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/70 dark:text-amber-300 dark:border-amber-800'
  } else if (isForecast) {
    badgeCls = is100
      ? 'bg-orange-50 text-orange-800 border-orange-200 dark:bg-orange-950/70 dark:text-orange-300 dark:border-orange-800'
      : 'bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950/70 dark:text-yellow-300 dark:border-yellow-800'
  }

  return (
    <div className="inline-flex items-center gap-1.5 text-xs">
      <span className="text-slate-500 dark:text-slate-400 font-medium">{title}:</span>
      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-xs font-semibold ${badgeCls}`}>
        {text}
      </span>
    </div>
  )
}

/** Pilihan A: Mini Sparkline kurva trajektori beban 5 tahun (SVG) */
function SparklineTrajectory({ row }) {
  const pts = [
    { label: 'Skrg', x: 22, p50: row.last_ratio || 0, p10: row.last_ratio || 0, p90: row.last_ratio || 0 },
    { label: '+1th', x: 70, p50: row.horizons?.['1']?.p50 || 0, p10: row.horizons?.['1']?.p10 || 0, p90: row.horizons?.['1']?.p90 || 0 },
    { label: '+3th', x: 122, p50: row.horizons?.['3']?.p50 || 0, p10: row.horizons?.['3']?.p10 || 0, p90: row.horizons?.['3']?.p90 || 0 },
    { label: '+5th', x: 174, p50: row.horizons?.['5']?.p50 || 0, p10: row.horizons?.['5']?.p10 || 0, p90: row.horizons?.['5']?.p90 || 0 },
  ]

  const maxVal = Math.max(1.35, ...pts.map((p) => p.p90))
  const svgH = 80
  const topPad = 8
  const bottomPad = 20
  const chartH = svgH - topPad - bottomPad

  const getY = (val) => svgH - bottomPad - Math.min(Math.max((val / maxVal) * chartH, 0), chartH)

  const y100 = getY(1.0)
  const y80 = getY(0.8)

  const upperPath = pts.map((p) => `${p.x},${getY(p.p90)}`).join(' ')
  const lowerPath = [...pts].reverse().map((p) => `${p.x},${getY(p.p10)}`).join(' ')
  const polygonPoints = `${upperPath} ${lowerPath}`
  const linePoints = pts.map((p) => `${p.x},${getY(p.p50)}`).join(' ')

  const strokeColor =
    row.risk === 'KRITIS'
      ? '#e11d48'
      : row.risk === 'TINGGI'
      ? '#ea580c'
      : row.risk === 'WASPADA'
      ? '#d97706'
      : '#059669'

  const fillColor =
    row.risk === 'KRITIS'
      ? 'rgba(244, 63, 94, 0.18)'
      : row.risk === 'TINGGI'
      ? 'rgba(249, 115, 22, 0.18)'
      : row.risk === 'WASPADA'
      ? 'rgba(245, 158, 11, 0.18)'
      : 'rgba(16, 185, 129, 0.18)'

  return (
    <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60 p-2.5 flex flex-col justify-between">
      <div className="flex items-center justify-between text-[11px] font-semibold text-slate-500 dark:text-slate-400">
        <span className="uppercase tracking-wider">Tren Beban</span>
        <span className="text-[10px] text-slate-400">Batas 80% &amp; 100%</span>
      </div>
      <svg viewBox="0 0 196 80" className="w-full h-18 mt-0.5 overflow-visible" role="img" aria-label="Grafik trajektori beban">
        {/* Garis batas 100% */}
        <line x1="16" y1={y100} x2="184" y2={y100} stroke="#f43f5e" strokeWidth="1" strokeDasharray="3 3" opacity="0.8" />
        <text x="2" y={y100 + 3} fontSize="7.5" fill="#f43f5e" fontWeight="bold">100% Kap.</text>

        {/* Garis batas 80% */}
        <line x1="16" y1={y80} x2="184" y2={y80} stroke="#f59e0b" strokeWidth="1" strokeDasharray="2 2" opacity="0.8" />
        <text x="5" y={y80 + 3} fontSize="7.5" fill="#f59e0b" fontWeight="600">80% Kap.</text>

        {/* Area rentang p10 - p90 */}
        <polygon points={polygonPoints} fill={fillColor} />

        {/* Garis tengah p50 */}
        <polyline points={linePoints} fill="none" stroke={strokeColor} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />

        {/* Titik data p50 */}
        {pts.map((p, idx) => (
          <g key={idx}>
            <circle cx={p.x} cy={getY(p.p50)} r="3" fill={strokeColor} stroke="#ffffff" strokeWidth="1.2" />
            <text x={p.x} y={svgH - 4} fontSize="8" fill="#64748b" textAnchor="middle" fontWeight="500">
              {p.label}
            </text>
          </g>
        ))}
      </svg>
    </div>
  )
}

function RunView({ run, canReview, onReview }) {
  const { notify } = useNotifications()
  const m = run.metrics?.all || {}
  const [unit, setUnit] = useState('')
  const [risk, setRisk] = useState('')
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 350)
  const [stale, setStale] = useState(false)
  const [page, setPage] = useState(1)
  const [viewMode, setViewMode] = useState('cards') // 'cards' | 'table'
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })

  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, loading: true, error: '' }))
    forecastApi.substations(run.id, { unit_id: unit, risk, search: debounced.trim(), stale: stale ? 1 : '', page, per_page: 25 })
      .then((r) => { if (live) setState({ loading: false, error: '', rows: r?.data || [], meta: r?.meta || null }) })
      .catch((err) => { if (live) setState({ loading: false, error: err?.message || 'Gagal memuat daftar gardu.', rows: [], meta: null }) })
    return () => { live = false }
  }, [run.id, unit, risk, debounced, stale, page])

  const totals = run.summary.reduce(
    (a, s) => ({ total: a.total + s.total, kritis: a.kritis + s.kritis, tinggi: a.tinggi + s.tinggi, waspada: a.waspada + s.waspada }),
    { total: 0, kritis: 0, tinggi: 0, waspada: 0 }
  )

  const isFiltered = Boolean(unit || risk || search || stale)
  const resetFilters = () => {
    setUnit('')
    setRisk('')
    setSearch('')
    setStale(false)
    setPage(1)
  }

  // Pilihan B: Ekspor CSV Hasil Filter
  const handleExportCsv = () => {
    if (!state.rows.length) return
    const dateStr = new Date().toISOString().slice(0, 10)
    const filename = `forecast-gardu-${run?.id?.slice(0, 8) || 'run'}-${dateStr}.csv`
    exportSubstationsCsv(filename, state.rows)
    notify({
      type: 'success',
      title: 'Ekspor Berhasil',
      desc: `${state.rows.length} baris data gardu berhasil diunduh dalam file CSV.`,
      tag: 'Forecast',
    })
  }

  // Helper persentase keparahan untuk Pilihan D (Stacked Bar)
  const totalAgregat = totals.total || 1
  const totKritisPct = Math.round((totals.kritis / totalAgregat) * 100)
  const totTinggiPct = Math.round((totals.tinggi / totalAgregat) * 100)
  const totWaspadaPct = Math.round((totals.waspada / totalAgregat) * 100)
  const totAmanPct = Math.max(0, 100 - totKritisPct - totTinggiPct - totWaspadaPct)

  return (
    <div className="space-y-6">
      {/* 1. Evaluasi Keandalan & Metrik Keterpercayaan Model */}
      <section aria-labelledby="fc-q" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="fc-q" className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <span>Seberapa dapat dipercaya</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Evaluasi kinerja model prakiraan pada data uji independen.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className={`${pill} ${run.review_status === 'REVIEWED' ? RISK.AMAN.cls : RISK.WASPADA.cls}`}>
              {run.review_status === 'REVIEWED' ? 'Sudah ditelaah' : 'Belum ditelaah'}
            </span>
            {canReview && run.review_status !== 'REVIEWED' && (
              <Button size="sm" variant="outline" onClick={onReview}>Tandai ditelaah</Button>
            )}
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Selisih rata-rata" value={`${(m.mae_pp ?? 0).toString().replace('.', ',')} poin`} hint="antara prakiraan dan pengukuran nyata, dalam % kapasitas trafo (diuji pada data yang tidak dipakai melatih)" />
          <Stat label="Rentang p10–p90 tepat" value={`${Math.round((m.coverage_p10_p90 ?? 0) * 100)}%`} hint="hasil nyata yang jatuh di dalam rentang prakiraan (idealnya sekitar 80%)" />
          <Stat label="Gardu overload terdeteksi" value={`${Math.round((m.overload_recall_p90 ?? 0) * 100)}%`} hint={`bila memakai batas atas rentang (p90); dengan nilai tengah saja ${Math.round((m.overload_recall_p50 ?? 0) * 100)}%`} />
          <Stat label="Dibanding pembacaan terakhir" value={m.mae_gain_vs_persistence_pct == null ? '-' : `${m.mae_gain_vs_persistence_pct > 0 ? 'lebih baik ' : 'lebih buruk '}${Math.abs(m.mae_gain_vs_persistence_pct).toString().replace('.', ',')}%`} hint="dibanding menganggap beban sama dengan pembacaan terakhir" />
        </dl>

        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
          Model: <span className="font-medium text-slate-700 dark:text-slate-300">{run.model?.name} v{run.model?.version}</span> · <span className="font-medium text-slate-700 dark:text-slate-300">{run.counts?.forecast_substations?.toLocaleString('id-ID')} gardu</span> · data pembacaan s.d. {fmtDate(run.data_cutoff)} · dijalankan oleh {run.started_by_name}. Prakiraan per gardu bersifat indikatif (kebanyakan gardu hanya diukur sekitar setahun sekali); gunakan bersama survei lapangan.
        </p>
        {run.model?.candidates && (
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed" data-testid="model-candidates">
            Model dipilih otomatis dari galat terkecil pada data validasi:{' '}
            {Object.entries(run.model.candidates).map(([key, c], i) => (
              <span key={key}>
                {i > 0 && ' · '}
                <span className={key === run.model.chosen ? 'font-semibold text-slate-700 dark:text-slate-200' : ''}>
                  {{ gru: 'GRU', gbm: 'LightGBM', ensemble: 'Gabungan' }[key] || key} {String(c.val_mae_pp).replace('.', ',')} poin{key === run.model.chosen ? ' (dipakai)' : ''}
                </span>
              </span>
            ))}.
          </p>
        )}
        {run.assumptions && (
          <details className="text-xs text-slate-600 dark:text-slate-300 rounded-xl bg-slate-50 dark:bg-slate-850 p-3 border border-slate-200/80 dark:border-slate-800">
            <summary className="cursor-pointer font-semibold text-slate-800 dark:text-slate-200">Asumsi Model &amp; Parameter Pembelajaran</summary>
            <p className="mt-1.5 leading-relaxed">{run.assumptions}</p>
          </details>
        )}
        {run.review_note && (
          <div className="rounded-xl bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/60 p-3 text-xs text-blue-900 dark:text-blue-200">
            <span className="font-semibold">Catatan telaah ({run.reviewed_by_name}):</span> {run.review_note}
          </div>
        )}
      </section>

      {/* 2. Ringkasan per ULP dengan Pilihan D (Stacked Bar Proporsi Keparahan) */}
      <section aria-labelledby="fc-s" className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 id="fc-s" className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <IconBuilding className="h-4 w-4 text-blue-600 dark:text-blue-400" />
              <span>Ringkasan per ULP</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Distribusi status risiko trafo per unit layanan. Klik baris ULP untuk langsung memfilter daftar gardu di bawahnya.
            </p>
          </div>
          {unit && (
            <button
              type="button"
              onClick={() => { setUnit(''); setPage(1) }}
              className="inline-flex items-center gap-1 text-xs text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              <IconX className="h-3.5 w-3.5" />
              <span>Reset filter ULP</span>
            </button>
          )}
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50/90 dark:bg-slate-850 text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="px-4 py-3">ULP</th>
                <th className="px-3 py-3 text-right">Total Gardu</th>
                <th className="px-3 py-3 text-right">Kritis (&gt;100% / 1 th)</th>
                <th className="px-3 py-3 text-right">Tinggi (&lt;3 th)</th>
                <th className="px-3 py-3 text-right">Waspada (&lt;5 th)</th>
                <th className="px-4 py-3">Proporsi Risiko</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs sm:text-sm">
              {run.summary.map((s) => {
                const isSelected = unit === s.unit_id
                const totU = s.total || 1
                const kPct = Math.round((s.kritis / totU) * 100)
                const tPct = Math.round((s.tinggi / totU) * 100)
                const wPct = Math.round((s.waspada / totU) * 100)
                const aPct = Math.max(0, 100 - kPct - tPct - wPct)

                return (
                  <tr
                    key={s.unit_id}
                    onClick={() => { setUnit(isSelected ? '' : s.unit_id); setPage(1) }}
                    className={`cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-50/80 dark:bg-blue-950/50 font-medium'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                    }`}
                    title="Klik untuk menyaring gardu ULP ini"
                  >
                    <td className="px-4 py-3 flex items-center gap-2">
                      <span className={`inline-block w-2 h-2 rounded-full ${isSelected ? 'bg-blue-600' : 'bg-transparent'}`} />
                      <span className="font-semibold text-slate-900 dark:text-slate-100">{s.unit_code} · {s.unit_name}</span>
                    </td>
                    <td className="px-3 py-3 text-right font-medium text-slate-700 dark:text-slate-300">
                      {s.total?.toLocaleString('id-ID')}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {s.kritis > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60">
                          {s.kritis}
                        </span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {s.tinggi > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-orange-50 text-orange-700 dark:bg-orange-950/70 dark:text-orange-300 border border-orange-200 dark:border-orange-800/60">
                          {s.tinggi}
                        </span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      {s.waspada > 0 ? (
                        <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/70 dark:text-amber-300 border border-amber-200 dark:border-amber-800/60">
                          {s.waspada}
                        </span>
                      ) : (
                        <span className="text-slate-400">0</span>
                      )}
                    </td>
                    {/* Pilihan D: Stacked Horizontal Bar */}
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-28 sm:w-36 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-750 flex">
                          {kPct > 0 && <div style={{ width: `${kPct}%` }} className="bg-rose-500 h-full" title={`Kritis: ${s.kritis} (${kPct}%)`} />}
                          {tPct > 0 && <div style={{ width: `${tPct}%` }} className="bg-orange-500 h-full" title={`Tinggi: ${s.tinggi} (${tPct}%)`} />}
                          {wPct > 0 && <div style={{ width: `${wPct}%` }} className="bg-amber-400 h-full" title={`Waspada: ${s.waspada} (${wPct}%)`} />}
                          {aPct > 0 && <div style={{ width: `${aPct}%` }} className="bg-emerald-500 h-full" title={`Aman: ${aPct}%`} />}
                        </div>
                        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {kPct}% kritis
                        </span>
                      </div>
                    </td>
                  </tr>
                )
              })}
              <tr className="bg-slate-50/90 dark:bg-slate-850 font-bold border-t-2 border-slate-300 dark:border-slate-700 text-slate-900 dark:text-slate-100">
                <td className="px-4 py-3">Jumlah Keseluruhan</td>
                <td className="px-3 py-3 text-right">{totals.total?.toLocaleString('id-ID')}</td>
                <td className="px-3 py-3 text-right text-rose-700 dark:text-rose-300">{totals.kritis}</td>
                <td className="px-3 py-3 text-right text-orange-700 dark:text-orange-300">{totals.tinggi}</td>
                <td className="px-3 py-3 text-right text-amber-700 dark:text-amber-300">{totals.waspada}</td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <div className="h-2.5 w-28 sm:w-36 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-750 flex">
                      {totKritisPct > 0 && <div style={{ width: `${totKritisPct}%` }} className="bg-rose-500 h-full" title={`Kritis: ${totals.kritis} (${totKritisPct}%)`} />}
                      {totTinggiPct > 0 && <div style={{ width: `${totTinggiPct}%` }} className="bg-orange-500 h-full" title={`Tinggi: ${totals.tinggi} (${totTinggiPct}%)`} />}
                      {totWaspadaPct > 0 && <div style={{ width: `${totWaspadaPct}%` }} className="bg-amber-400 h-full" title={`Waspada: ${totals.waspada} (${totWaspadaPct}%)`} />}
                      {totAmanPct > 0 && <div style={{ width: `${totAmanPct}%` }} className="bg-emerald-500 h-full" title={`Aman: ${totAmanPct}%`} />}
                    </div>
                    <span className="text-[11px] font-bold text-rose-600 dark:text-rose-400 whitespace-nowrap">
                      {totKritisPct}% kritis
                    </span>
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      </section>

      {/* 3. Daftar Gardu Hasil Prediksi (Filter Panel, Ekspor CSV & Tampilan) */}
      <section aria-labelledby="fc-l" className="space-y-4">
        {/* Section Header with Ekspor CSV & View Mode Switch */}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h2 id="fc-l" className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <IconZap className="h-4 w-4 text-amber-500" />
              <span>Daftar gardu</span>
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Evaluasi beban trafo real-time dan prakiraan horizon 1, 3, dan 5 tahun berdasarkan model terpilih pada run ini.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Pilihan B: Tombol Ekspor CSV */}
            <Button
              type="button"
              variant="secondary"
              size="sm"
              icon={IconDownload}
              onClick={handleExportCsv}
              disabled={state.rows.length === 0}
              aria-label="Ekspor CSV"
              title="Unduh data gardu sesuai filter saat ini ke CSV"
            >
              Ekspor CSV
            </Button>

            {/* Mode Switcher */}
            <div className="inline-flex rounded-xl p-1 bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <button
                type="button"
                onClick={() => setViewMode('cards')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  viewMode === 'cards'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Kartu Detail
              </button>
              <button
                type="button"
                onClick={() => setViewMode('table')}
                className={`px-3 py-1 text-xs font-semibold rounded-lg transition-all cursor-pointer ${
                  viewMode === 'table'
                    ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
                }`}
              >
                Tabel Ringkas
              </button>
            </div>
          </div>
        </div>

        {/* Filter Panel Card */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-slate-50/80 via-white to-blue-50/30 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-4 sm:p-5 shadow-xs space-y-3.5">
          {/* Baris 1: Filter Form Inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-3 items-end">
            {/* Search Input */}
            <div className="lg:col-span-5">
              <label htmlFor="fc-search" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Cari Gardu
              </label>
              <div className="relative">
                <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400">
                  <IconSearch className="h-4 w-4" />
                </div>
                <input
                  id="fc-search"
                  type="search"
                  value={search}
                  onChange={(e) => { setSearch(e.target.value); setPage(1) }}
                  placeholder="Kode, nama gardu, atau penyulang"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-9 pr-3 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus-ring"
                />
              </div>
            </div>

            {/* Select Tingkat Risiko */}
            <div className="lg:col-span-3">
              <label htmlFor="fc-risk" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Tingkat risiko
              </label>
              <select
                id="fc-risk"
                value={risk}
                onChange={(e) => { setRisk(e.target.value); setPage(1) }}
                className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-ring"
              >
                <option value="">Semua Tingkat Risiko</option>
                {Object.entries(RISK).map(([k, v]) => (
                  <option key={k} value={k}>{v.label}</option>
                ))}
              </select>
            </div>

            {/* Select ULP */}
            {run.summary.length > 1 && (
              <div className="lg:col-span-4">
                <label htmlFor="fc-unit" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  ULP
                </label>
                <select
                  id="fc-unit"
                  value={unit}
                  onChange={(e) => { setUnit(e.target.value); setPage(1) }}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm text-slate-900 dark:text-slate-100 focus-ring"
                >
                  <option value="">Semua Unit Layanan (ULP)</option>
                  {run.summary.map((s) => (
                    <option key={s.unit_id} value={s.unit_id}>{s.unit_code} · {s.unit_name}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Baris 2: Quick Filter Chips & Stale Toggle */}
          <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-slate-200/80 dark:border-slate-800 text-xs">
            {/* Quick Chips */}
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-slate-500 dark:text-slate-400 font-medium mr-1">Filter Cepat:</span>
              <button
                type="button"
                onClick={() => { setRisk(''); setPage(1) }}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  risk === ''
                    ? 'bg-blue-600 text-white shadow-2xs'
                    : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-750'
                }`}
              >
                Semua ({totals.total})
              </button>
              <button
                type="button"
                onClick={() => { setRisk('KRITIS'); setPage(1) }}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  risk === 'KRITIS'
                    ? 'bg-rose-600 text-white shadow-2xs'
                    : 'bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800 hover:bg-rose-100'
                }`}
              >
                Kritis ({totals.kritis})
              </button>
              <button
                type="button"
                onClick={() => { setRisk('TINGGI'); setPage(1) }}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  risk === 'TINGGI'
                    ? 'bg-orange-600 text-white shadow-2xs'
                    : 'bg-orange-50 text-orange-700 dark:bg-orange-950/60 dark:text-orange-300 border border-orange-200 dark:border-orange-800 hover:bg-orange-100'
                }`}
              >
                Tinggi ({totals.tinggi})
              </button>
              <button
                type="button"
                onClick={() => { setRisk('WASPADA'); setPage(1) }}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  risk === 'WASPADA'
                    ? 'bg-amber-600 text-white shadow-2xs'
                    : 'bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-800 hover:bg-amber-100'
                }`}
              >
                Waspada ({totals.waspada})
              </button>
              <button
                type="button"
                onClick={() => { setRisk('AMAN'); setPage(1) }}
                className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  risk === 'AMAN'
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 hover:bg-emerald-100'
                }`}
              >
                Aman
              </button>
            </div>

            {/* Checkbox Pembacaan Lama & Reset Button */}
            <div className="flex items-center gap-3">
              <label className="flex items-center gap-2 text-xs font-medium text-slate-700 dark:text-slate-300 cursor-pointer">
                <input
                  type="checkbox"
                  checked={stale}
                  onChange={(e) => { setStale(e.target.checked); setPage(1) }}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                />
                <span>Pembacaan terakhir &gt; 3 tahun</span>
              </label>

              {isFiltered && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline cursor-pointer"
                >
                  <IconX className="h-3.5 w-3.5" />
                  <span>Reset Filter</span>
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Alerts & Data Results */}
        {state.error && <Alert variant="error">{state.error}</Alert>}
        {state.loading ? (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <Spinner />
            <p className="text-xs text-slate-500 dark:text-slate-400">Memuat data prakiraan gardu...</p>
          </div>
        ) : state.rows.length === 0 ? (
          <EmptyState
            icon={IconChart}
            title="Tidak ada gardu ditemukan"
            description="Tidak ada data gardu yang cocok dengan kriteria pencarian dan filter yang dipilih."
            action={isFiltered ? <Button size="sm" variant="secondary" onClick={resetFilters}>Bersihkan Filter</Button> : null}
          />
        ) : (
          <div className="space-y-3.5">
            {/* View Mode Switching: Cards vs Table */}
            {viewMode === 'cards' ? (
              <div className="grid grid-cols-1 gap-3.5">
                {state.rows.map((r) => (
                  <SubstationRow key={r.substation_id} row={r} />
                ))}
              </div>
            ) : (
              <SubstationTable rows={state.rows} />
            )}

            {/* Footer Pagination */}
            {state.meta && (
              <TableFooter
                itemCount={state.rows.length}
                total={state.meta.total}
                entityLabel="gardu"
                page={state.meta.current_page}
                perPage={25}
                onPage={setPage}
                onPerPage={() => {}}
                perPageOptions={[25]}
              />
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function SubstationRow({ row }) {
  const navigate = useNavigate()
  const rk = RISK[row.risk] || RISK.AMAN
  const isHighRisk = row.risk === 'KRITIS' || row.risk === 'TINGGI'
  const recommendedKva = getNextTrafoKva(row.capacity_kva)

  return (
    <article className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-xs hover:border-blue-300 dark:hover:border-blue-700/60 transition-all">
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-3 min-w-0">
          <div className={`rounded-xl p-2.5 shrink-0 shadow-2xs ${
            row.risk === 'KRITIS' ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300' :
            row.risk === 'TINGGI' ? 'bg-orange-100 text-orange-700 dark:bg-orange-950 dark:text-orange-300' :
            row.risk === 'WASPADA' ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300' :
            'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300'
          }`}>
            <IconZap className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 tracking-tight break-words">
              {row.code} · {row.name || ''}
            </h3>
            <div className="flex flex-wrap items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-semibold text-slate-700 dark:text-slate-300">{row.unit_name}</span>
              {row.feeder_code && (
                <>
                  <span>•</span>
                  <span className="inline-flex items-center gap-1 rounded-md bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200/60 dark:border-indigo-800/60 px-2 py-0.5 font-medium">
                    Penyulang {row.feeder_code}
                  </span>
                </>
              )}
              <span>•</span>
              <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200/80 dark:border-slate-700/80 px-2 py-0.5 font-semibold">
                {row.capacity_kva} kVA
              </span>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5 self-start shrink-0">
          <span className={`${pill} ${rk.cls} font-semibold shadow-2xs`} title={rk.hint}>
            {row.risk === 'KRITIS' && <IconAlertCircle className="h-3.5 w-3.5 mr-1 text-rose-600 dark:text-rose-400 inline" />}
            {row.risk === 'TINGGI' && <IconClock className="h-3.5 w-3.5 mr-1 text-orange-600 dark:text-orange-400 inline" />}
            {row.risk === 'WASPADA' && <IconActivity className="h-3.5 w-3.5 mr-1 text-amber-600 dark:text-amber-400 inline" />}
            {row.risk === 'AMAN' && <IconCheckCircle className="h-3.5 w-3.5 mr-1 text-emerald-600 dark:text-emerald-400 inline" />}
            {rk.label}
          </span>
          {row.stale && (
            <span className={`${pill} bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700 font-medium`}>
              Pembacaan lama
            </span>
          )}
        </div>
      </div>

      {/* Grid 5 Kolom: Beban Nyata + Horizon 1, 3, 5 + Pilihan A: Sparkline Kurva Trajektori */}
      <dl className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-2 lg:grid-cols-5 text-xs">
        {/* Beban Terakhir */}
        <div className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60 p-3 flex flex-col justify-between">
          <div>
            <dt className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Beban terakhir ({fmtDate(row.last_reading_on)})
            </dt>
            <dd className={`mt-1 text-xl font-bold ${
              row.last_ratio >= 1.0 ? 'text-rose-600 dark:text-rose-400' :
              row.last_ratio >= 0.8 ? 'text-amber-600 dark:text-amber-400' :
              'text-slate-900 dark:text-slate-100'
            }`}>
              {pct(row.last_ratio)}
            </dd>
          </div>
          <LoadBar value={row.last_ratio} />
        </div>

        {/* 1, 3, 5 Tahun */}
        {['1', '3', '5'].map((y) => {
          const h = row.horizons?.[y] || { p10: 0, p50: 0, p90: 0 }
          const isOver100 = h.p50 >= 1.0
          const isOver80 = h.p50 >= 0.8
          return (
            <div key={y} className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60 p-3 flex flex-col justify-between">
              <div>
                <dt className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                  {y} tahun lagi
                </dt>
                <div className="mt-1 flex items-baseline gap-1.5 flex-wrap">
                  <dd className={`text-xl font-bold ${
                    isOver100 ? 'text-rose-600 dark:text-rose-400' :
                    isOver80 ? 'text-amber-600 dark:text-amber-400' :
                    'text-slate-900 dark:text-slate-100'
                  }`}>
                    {pct(h.p50)}
                  </dd>
                  <span className="text-[11px] text-slate-500 dark:text-slate-400 font-medium">
                    rentang {pct(h.p10)}–{pct(h.p90)}
                  </span>
                </div>
              </div>
              <LoadBar value={h.p50} />
            </div>
          )
        })}

        {/* Pilihan A: Mini Sparkline Kurva Trajektori (SVG) */}
        <div className="col-span-2 sm:col-span-2 lg:col-span-1">
          <SparklineTrajectory row={row} />
        </div>
      </dl>

      {/* Pilihan C: Rekomendasi Tindakan Cepat (Up-rating / Sisip Gardu) */}
      {isHighRisk && (
        <div className="mt-3.5 rounded-xl border border-rose-200/90 dark:border-rose-900/50 bg-linear-to-r from-rose-50/80 via-rose-50/40 to-amber-50/40 dark:from-rose-950/40 dark:via-rose-950/20 dark:to-amber-950/20 p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs">
          <div className="flex items-start gap-2.5">
            <div className="rounded-lg p-1.5 bg-rose-600 text-white shrink-0 mt-0.5 shadow-2xs">
              <IconZap className="h-4 w-4" />
            </div>
            <div>
              <span className="font-bold text-rose-900 dark:text-rose-200">
                Rekomendasi Tindakan:
              </span>{' '}
              <span className="text-rose-800 dark:text-rose-300">
                Up-rating trafo dari <strong className="font-semibold">{row.capacity_kva} kVA</strong> ke <strong className="font-semibold">{recommendedKva} kVA</strong>
                {row.feeder_code ? ` atau sisip gardu pada penyulang ${row.feeder_code}` : ''}.
              </span>
            </div>
          </div>
          <button
            type="button"
            onClick={() => navigate('/survei', { state: { substation_code: row.code, feeder_code: row.feeder_code, recommended_kva: recommendedKva } })}
            className="inline-flex items-center justify-center gap-1.5 shrink-0 rounded-xl bg-rose-600 hover:bg-rose-700 active:bg-rose-800 text-white font-semibold px-3 py-1.5 text-xs shadow-2xs transition focus-ring cursor-pointer"
            title={`Buat usulan survei up-rating untuk gardu ${row.code}`}
          >
            <span>Buat Usulan Survei</span>
            <IconArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Footer Kartu: Ambang Batas & Dasar Data */}
      <div className="mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-2.5 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
          <ExceedBadge title="Melewati 80%" exceed={row.exceed_80} is100={false} />
          <ExceedBadge title="Melewati 100%" exceed={row.exceed_100} is100={true} />
          {/* Format teks pendukung aksesibilitas */}
          <span className="sr-only">
            Melewati 80%: {exceedText(row.exceed_80)} · melewati 100%: {exceedText(row.exceed_100)} · dasar prakiraan {row.history_readings} pembacaan
          </span>
        </div>
        <div className="text-slate-500 dark:text-slate-400 text-xs flex items-center gap-1.5">
          <span>Dasar prakiraan:</span>
          <span className="font-semibold text-slate-700 dark:text-slate-300">{row.history_readings} pembacaan</span>
        </div>
      </div>
    </article>
  )
}

function SubstationTable({ rows }) {
  const navigate = useNavigate()
  return (
    <div className="overflow-x-auto rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
      <table className="w-full text-left text-xs">
        <thead className="bg-slate-50/90 dark:bg-slate-850 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
          <tr>
            <th className="px-4 py-3">Gardu &amp; Lokasi</th>
            <th className="px-3 py-3 text-right">Trafo</th>
            <th className="px-3 py-3">Risiko</th>
            <th className="px-3 py-3 text-right">Beban Terakhir</th>
            <th className="px-3 py-3 text-center">1 Thn Lagi (p50)</th>
            <th className="px-3 py-3 text-center">3 Thn Lagi (p50)</th>
            <th className="px-3 py-3 text-center">5 Thn Lagi (p50)</th>
            <th className="px-4 py-3">Ambang 80% / 100%</th>
            <th className="px-4 py-3 text-right">Aksi Tindakan</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((row) => {
            const rk = RISK[row.risk] || RISK.AMAN
            const isHighRisk = row.risk === 'KRITIS' || row.risk === 'TINGGI'
            const nextKva = getNextTrafoKva(row.capacity_kva)

            return (
              <tr key={row.substation_id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition">
                <td className="px-4 py-3">
                  <div className="font-bold text-slate-900 dark:text-slate-100">{row.code} · {row.name || ''}</div>
                  <div className="text-slate-500 dark:text-slate-400 mt-0.5">
                    {row.unit_name} {row.feeder_code ? `· Penyulang ${row.feeder_code}` : ''}
                  </div>
                </td>
                <td className="px-3 py-3 text-right font-semibold text-slate-700 dark:text-slate-300 whitespace-nowrap">
                  {row.capacity_kva} kVA
                </td>
                <td className="px-3 py-3 whitespace-nowrap">
                  <span className={`${pill} ${rk.cls}`} title={rk.hint}>{rk.label}</span>
                  {row.stale && <span className={`${pill} ml-1 bg-slate-100 text-slate-600 dark:bg-slate-800`}>Lama</span>}
                </td>
                <td className="px-3 py-3 text-right whitespace-nowrap">
                  <span className={`font-bold ${
                    row.last_ratio >= 1.0 ? 'text-rose-600 dark:text-rose-400' :
                    row.last_ratio >= 0.8 ? 'text-amber-600 dark:text-amber-400' :
                    'text-slate-900 dark:text-slate-100'
                  }`}>
                    {pct(row.last_ratio)}
                  </span>
                  <div className="text-[10px] text-slate-400">{fmtDate(row.last_reading_on)}</div>
                </td>
                <td className="px-3 py-3 text-center whitespace-nowrap">
                  <div className={`font-bold ${row.horizons?.['1']?.p50 >= 1.0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>
                    {pct(row.horizons?.['1']?.p50)}
                  </div>
                  <div className="text-[10px] text-slate-400">rentang {pct(row.horizons?.['1']?.p10)}–{pct(row.horizons?.['1']?.p90)}</div>
                </td>
                <td className="px-3 py-3 text-center whitespace-nowrap">
                  <div className={`font-bold ${row.horizons?.['3']?.p50 >= 1.0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>
                    {pct(row.horizons?.['3']?.p50)}
                  </div>
                  <div className="text-[10px] text-slate-400">rentang {pct(row.horizons?.['3']?.p10)}–{pct(row.horizons?.['3']?.p90)}</div>
                </td>
                <td className="px-3 py-3 text-center whitespace-nowrap">
                  <div className={`font-bold ${row.horizons?.['5']?.p50 >= 1.0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'}`}>
                    {pct(row.horizons?.['5']?.p50)}
                  </div>
                  <div className="text-[10px] text-slate-400">rentang {pct(row.horizons?.['5']?.p10)}–{pct(row.horizons?.['5']?.p90)}</div>
                </td>
                <td className="px-4 py-3 whitespace-nowrap">
                  <div className="space-y-1">
                    <ExceedBadge title="80%" exceed={row.exceed_80} is100={false} />
                    <ExceedBadge title="100%" exceed={row.exceed_100} is100={true} />
                  </div>
                </td>
                {/* Pilihan C di tabel: Pintasan Up-rating */}
                <td className="px-4 py-3 text-right whitespace-nowrap">
                  {isHighRisk ? (
                    <button
                      type="button"
                      onClick={() => navigate('/survei', { state: { substation_code: row.code, feeder_code: row.feeder_code, recommended_kva: nextKva } })}
                      className="inline-flex items-center gap-1 rounded-lg bg-rose-50 dark:bg-rose-950/70 border border-rose-200 dark:border-rose-800 text-rose-700 dark:text-rose-300 hover:bg-rose-100 px-2.5 py-1 font-semibold transition cursor-pointer"
                      title={`Buat usulan up-rating ke ${nextKva} kVA`}
                    >
                      <span>Up-rating ({nextKva} kVA)</span>
                      <IconArrowRight className="h-3 w-3" />
                    </button>
                  ) : (
                    <span className="text-slate-400 text-[11px]">-</span>
                  )}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
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

/** Jadwal forecast bulanan otomatis: beban gardu lalu prakiraan permintaan, sekali sebulan pada tanggal dan jam yang dipilih. */
function SchedulePanel() {
  const { can, isSysAdmin } = useAccess()
  const canRun = Boolean(can['forecast.run'] || isSysAdmin)
  const [sched, setSched] = useState(null)
  const [editing, setEditing] = useState(false)
  const [form, setForm] = useState({ auto_enabled: false, day_of_month: 1, run_time: '03:00' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let live = true
    Promise.resolve(forecastApi.schedule?.()).then((r) => { if (live && r?.data) { setSched(r.data); setForm({ auto_enabled: r.data.auto_enabled, day_of_month: r.data.day_of_month, run_time: r.data.run_time }) } }).catch(() => {})
    return () => { live = false }
  }, [])
  if (!sched) return null

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const r = await forecastApi.saveSchedule({ ...form, day_of_month: Number(form.day_of_month) })
      setSched(r.data)
      setEditing(false)
    } catch (e) {
      setError(e.message || 'Gagal menyimpan jadwal.')
    } finally {
      setSaving(false)
    }
  }
  const last = sched.last_auto?.GARDU_LOAD || sched.last_auto?.DEMAND
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-slate-700 dark:text-slate-300">
          <span className="font-semibold">Jadwal otomatis:</span>{' '}
          {sched.auto_enabled ? `aktif, tiap tanggal ${sched.day_of_month} pukul ${sched.run_time}` : 'nonaktif'}
          {sched.auto_enabled && sched.updated_by_name ? ` (dijalankan atas nama ${sched.updated_by_name})` : ''}
          {last ? ` · terakhir otomatis ${fmtDate(last)}` : ''}
        </p>
        {canRun && !editing && <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>Atur jadwal</Button>}
      </div>
      {editing && (
        <div className="mt-3 flex flex-wrap items-end gap-4">
          <label className="flex items-center gap-2"><input type="checkbox" checked={form.auto_enabled} onChange={(e) => setForm({ ...form, auto_enabled: e.target.checked })} /> Jalankan otomatis tiap bulan</label>
          <label className="flex flex-col text-xs text-slate-500">Tanggal (1-28)
            <input type="number" min={1} max={28} value={form.day_of_month} onChange={(e) => setForm({ ...form, day_of_month: e.target.value })} className="mt-1 w-20 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1 text-sm text-slate-900 dark:text-slate-100" />
          </label>
          <label className="flex flex-col text-xs text-slate-500">Jam
            <input type="time" value={form.run_time} onChange={(e) => setForm({ ...form, run_time: e.target.value })} className="mt-1 rounded-lg border border-slate-300 dark:border-slate-600 bg-transparent px-2 py-1 text-sm text-slate-900 dark:text-slate-100" />
          </label>
          <Button size="sm" loading={saving} onClick={save}>Simpan</Button>
          <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>Batal</Button>
        </div>
      )}
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
      {editing && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Beban gardu dijalankan lebih dulu, lalu prakiraan permintaan, tidak pernah bersamaan. Run yang gagal atau datanya kurang tidak diulang pada bulan yang sama.</p>}
    </div>
  )
}
