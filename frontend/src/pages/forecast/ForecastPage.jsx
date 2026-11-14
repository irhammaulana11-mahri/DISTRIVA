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
import { IconChart, IconRefresh } from '../../components/icons.jsx'

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

export default function ForecastPage() {
  const { can, isSysAdmin } = useAccess()
  const { notify } = useNotifications()
  const [runs, setRuns] = useState({ loading: true, error: '', rows: [], can: {} })
  const [runId, setRunId] = useState('')
  const [run, setRun] = useState(null)
  const [starting, setStarting] = useState(false)
  const [reviewing, setReviewing] = useState(false)
  const canRun = Boolean(runs.can.run || can['forecast.run'] || isSysAdmin)
  const canReview = Boolean(runs.can.review || can['forecast.review'] || isSysAdmin)

  const loadRuns = useCallback(async () => {
    try {
      const r = await forecastApi.runs()
      setRuns({ loading: false, error: '', rows: r?.data || [], can: r?.can || {} })
      return r?.data || []
    } catch (err) {
      setRuns({ loading: false, error: err?.message || 'Gagal memuat daftar forecast.', rows: [], can: {} })
      return []
    }
  }, [])

  useEffect(() => { loadRuns().then((rows) => setRunId((cur) => cur || rows.find((x) => x.status === 'SUCCEEDED')?.id || rows[0]?.id || '')) }, [loadRuns])

  const selected = runs.rows.find((r) => r.id === runId)
  const running = runs.rows.some((r) => r.status === 'RUNNING')

  // selama ada forecast berjalan, daftar disegarkan tiap 8 detik dan berhenti sendiri saat selesai atau halaman ditutup
  useEffect(() => {
    if (!running) return undefined
    const t = setInterval(async () => {
      const rows = await loadRuns()
      const done = rows.find((x) => x.status === 'SUCCEEDED')
      if (!rows.some((x) => x.status === 'RUNNING') && done) setRunId(done.id)
    }, 8000)
    return () => clearInterval(t)
  }, [running, loadRuns])

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

  const start = async () => {
    setStarting(true)
    try {
      const r = await forecastApi.start()
      notify({ type: 'success', title: 'Forecast dimulai', desc: r?.message || 'Berjalan di latar belakang.', tag: 'Forecast' })
      const rows = await loadRuns()
      setRunId(rows[0]?.id || '')
    } catch (err) {
      notify({ type: 'error', title: 'Forecast tidak dapat dimulai', desc: err?.message || 'Terjadi kesalahan.', tag: 'Forecast' })
    } finally {
      setStarting(false)
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Forecast Beban Gardu</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Prakiraan beban trafo 1, 3, dan 5 tahun ke depan dengan deep learning. Rekomendasi untuk perencana, bukan keputusan.</p>
        </div>
        <div className="flex flex-wrap items-end gap-2">
          {runs.rows.length > 0 && (
            <div>
              <label htmlFor="fc-run" className="block text-xs text-slate-500">Hasil forecast</label>
              <select id="fc-run" value={runId} onChange={(e) => setRunId(e.target.value)} className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-2 text-base sm:text-sm">
                {runs.rows.map((r) => <option key={r.id} value={r.id}>{fmtDate(r.started_at)} · {r.status === 'SUCCEEDED' ? 'selesai' : r.status === 'RUNNING' ? 'berjalan' : 'gagal'}</option>)}
              </select>
            </div>
          )}
          <Button variant="secondary" icon={IconRefresh} onClick={loadRuns} aria-label="Muat ulang">Muat ulang</Button>
          {canRun && <Button onClick={start} loading={starting} disabled={running}>Jalankan forecast</Button>}
        </div>
      </div>

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

function Stat({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className="text-xl font-bold text-slate-900 dark:text-slate-100">{value}</dd>
      {hint && <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">{hint}</p>}
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
