import { useCallback, useEffect, useRef, useState } from 'react'
import { outageApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import SearchSelect from '../../components/SearchSelect.jsx'
import { IconRefresh, IconZap, IconDatabase, IconAlertCircle } from '../../components/icons.jsx'
import { fmtInt } from '../../components/TrendCharts.jsx'

const INPUT = 'mt-1 block w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 transition shadow-2xs disabled:opacity-60'
const CARD = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs'

const STATUS = {
  QUEUED: ['Menunggu', 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'],
  RUNNING: ['Berjalan', 'bg-blue-50 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'],
  OK: ['Berhasil', 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'],
  FAILED: ['Gagal', 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'],
}
const TRIGGER = { MANUAL: 'Manual', AUTO: 'Harian' }
const ACTIVE = ['QUEUED', 'RUNNING']

const fmtDate = (v) => {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

function StatusBadge({ status }) {
  const [label, cls] = STATUS[status] || [status, STATUS.QUEUED[1]]
  return <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${cls}`}>{label}</span>
}

function Stat({ label, value, sub }) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</div>
      <div className="mt-1.5 text-xl sm:text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500 dark:text-slate-400">{sub}</div>}
    </div>
  )
}

function countsText(c) {
  if (!c) return '-'
  const parts = [`${fmtInt(c.read ?? 0)} baris`]
  if (c.inserted) parts.push(`${fmtInt(c.inserted)} baru`)
  if (c.updated) parts.push(`${fmtInt(c.updated)} diubah`)
  if (c.removed) parts.push(`${fmtInt(c.removed)} ditandai hilang`)
  if (c.invalid) parts.push(`${fmtInt(c.invalid)} ditolak`)
  if (c.unmatched_feeders) parts.push(`${fmtInt(c.unmatched_feeders)} penyulang belum terpetakan`)
  return parts.join(' · ')
}

/** Menu Master Data > Data Gangguan (Sinkron): sumber sheet, sinkron harian/manual, riwayat, dan pemetaan nama penyulang. */
export default function OutageSyncPage() {
  const { notify } = useNotifications()
  const [state, setState] = useState({ loading: true, error: '', data: null })
  const [form, setForm] = useState(null)
  const [gidText, setGidText] = useState('')
  const [sheetUrl, setSheetUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})
  const [formError, setFormError] = useState('')
  const [starting, setStarting] = useState(false)
  const [activeRun, setActiveRun] = useState(null)
  const [mapping, setMapping] = useState({})
  const [mapBusy, setMapBusy] = useState('')
  const timer = useRef(null)

  const apply = useCallback((settings) => {
    setForm({
      auto_enabled: !!settings.auto_enabled,
      auto_time: settings.auto_time || '02:00',
      saidi_min_minutes: settings.saidi_min_minutes ?? 5,
      saidi_only_permanent: !!settings.saidi_only_permanent,
    })
    setGidText((settings.gids || []).join(', '))
    setSheetUrl('')
  }, [])

  const load = useCallback(async () => {
    try {
      const r = await outageApi.sync()
      setState({ loading: false, error: '', data: r.data })
      return r.data
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Gagal memuat data sinkronisasi gangguan.', data: null })
      return null
    }
  }, [])

  useEffect(() => {
    let alive = true
    load().then((d) => {
      if (!alive || !d) return
      apply(d.settings)
      if (d.settings.last_run && ACTIVE.includes(d.settings.last_run.status)) setActiveRun(d.settings.last_run.id)
    })
    return () => { alive = false }
  }, [load, apply])

  useEffect(() => {
    if (!activeRun) return undefined
    let stop = false
    const tick = async () => {
      try {
        const r = await outageApi.run(activeRun)
        if (stop) return
        if (!ACTIVE.includes(r.data.status)) {
          setActiveRun(null)
          const d = await load()
          if (d) setState((s) => ({ ...s, data: d }))
          notify({
            type: r.data.status === 'OK' ? 'success' : 'error',
            title: r.data.status === 'OK' ? 'Sinkronisasi gangguan selesai' : 'Sinkronisasi gangguan gagal',
            desc: r.data.message || countsText(r.data.counts),
            tag: 'Data Gangguan',
          })
          return
        }
      } catch { /* coba lagi pada putaran berikutnya */ }
      timer.current = setTimeout(tick, 2500)
    }
    timer.current = setTimeout(tick, 1200)
    return () => { stop = true; clearTimeout(timer.current) }
  }, [activeRun, load, notify])

  const data = state.data
  const canSync = !!data?.can?.sync
  const running = !!activeRun

  const start = async () => {
    setStarting(true)
    setFormError('')
    try {
      const r = await outageApi.start()
      setActiveRun(r.data.id)
      await load()
    } catch (e) {
      setFormError(e?.message || 'Gagal memulai sinkronisasi.')
    } finally {
      setStarting(false)
    }
  }

  const save = async (e) => {
    e.preventDefault()
    setSaving(true)
    setFormError('')
    setFieldErrors({})
    const gids = gidText.split(/[\s,;]+/).filter(Boolean).map(Number)
    if (gids.some((g) => !Number.isInteger(g) || g < 0)) {
      setFieldErrors({ gids: ['Isi GID dengan angka, pisahkan dengan koma.'] })
      setSaving(false)
      return
    }
    try {
      const r = await outageApi.saveSettings({
        sheet_url: sheetUrl.trim() || undefined,
        gids: gids.length ? gids : undefined,
        auto_enabled: form.auto_enabled,
        auto_time: form.auto_time,
        saidi_min_minutes: Number(form.saidi_min_minutes),
        saidi_only_permanent: form.saidi_only_permanent,
      })
      setState((s) => ({ ...s, data: { ...s.data, settings: r.data } }))
      apply(r.data)
      notify({ type: 'success', title: 'Pengaturan gangguan disimpan', desc: 'Berlaku untuk sinkronisasi dan analisis berikutnya.', tag: 'Data Gangguan' })
    } catch (err) {
      if (err?.data?.errors) setFieldErrors(err.data.errors)
      else setFormError(err?.message || 'Gagal menyimpan pengaturan.')
    } finally {
      setSaving(false)
    }
  }

  const mapFeeder = async (row) => {
    const key = `${row.gi_name}|${row.feeder_name}`
    const feederId = mapping[key]
    if (!feederId) return
    setMapBusy(key)
    try {
      const r = await outageApi.alias({ gi_name: row.gi_name, feeder_name: row.feeder_name, feeder_id: feederId })
      setState((s) => ({ ...s, data: { ...s.data, unmatched: r.data.unmatched } }))
      notify({ type: 'success', title: 'Penyulang dipetakan', desc: r.message, tag: 'Data Gangguan' })
      load()
    } catch (err) {
      setFormError(err?.message || 'Gagal memetakan penyulang.')
    } finally {
      setMapBusy('')
    }
  }

  if (state.loading) return <div className="flex justify-center py-16"><Spinner /></div>
  if (state.error) return <Alert type="error">{state.error}</Alert>
  if (!data) return null

  const s = data.settings
  const feederOptions = (data.feeders || []).map((f) => ({ value: f.id, label: `${f.name}${f.gi_name ? ` · ${f.gi_name}` : ''}${f.code ? ` (${f.code})` : ''}` }))
  const last = s.last_run

  return (
    <div className="space-y-5 w-full">
      <div className={`${CARD} p-5 sm:p-6`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-2.5 text-amber-600"><IconZap size={22} /></span>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Data Gangguan (Sinkron)</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Gangguan penyulang dan recloser dibaca dari Google Sheet, harian otomatis atau manual. Analisis ada di Laporan &amp; Monitoring &rsaquo; Analisis Gangguan.
              </p>
            </div>
          </div>
          {canSync && (
            <Button icon={IconRefresh} onClick={start} loading={starting || running} disabled={!s.sheet_id_set || running}>
              {running ? 'Menyinkronkan…' : 'Sinkron sekarang'}
            </Button>
          )}
        </div>
        {!s.sheet_id_set && (
          <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">Sumber sheet belum diisi{canSync ? '; isi tautan sheet pada pengaturan di bawah.' : '. Hubungi pengelola.'}</p>
        )}
      </div>

      {formError && <Alert type="error">{formError}</Alert>}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Stat label="Peristiwa gangguan" value={fmtInt(data.stats.events)} sub={data.stats.first_at ? `${fmtDate(data.stats.first_at).split(',')[0]} – ${fmtDate(data.stats.last_at).split(',')[0]}` : 'Belum ada data'} />
        <Stat label="Penyulang terpetakan" value={fmtInt(data.stats.feeders)} />
        <Stat label="Peristiwa tanpa penyulang" value={fmtInt(data.stats.unmatched_events)} sub={data.stats.unmatched_events > 0 ? 'Petakan di bawah' : 'Semua terpetakan'} />
        <Stat label="Sinkron terakhir" value={last ? <StatusBadge status={last.status} /> : '-'} sub={last ? `${TRIGGER[last.trigger] || last.trigger} · ${fmtDate(last.finished_at || last.created_at)}` : 'Belum pernah'} />
      </div>

      {canSync && form && (
        <form onSubmit={save} className={`${CARD} p-5 sm:p-6 space-y-4`}>
          <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Pengaturan sumber &amp; jadwal</h2>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Sheet harus dibagikan "siapa saja dengan tautan dapat melihat". Alamat sheet tidak ditampilkan kembali setelah disimpan.</p>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <label htmlFor="outage-url" className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Tautan Google Sheet</label>
              <input id="outage-url" className={INPUT} value={sheetUrl} onChange={(e) => setSheetUrl(e.target.value)} autoComplete="off" placeholder={s.sheet_id_set ? `Tersimpan (${s.sheet_id_hint}); isi hanya untuk mengganti` : 'Tempel tautan sheet'} />
              {fieldErrors.sheet_url && <p className="mt-1 text-xs font-medium text-red-600">{fieldErrors.sheet_url[0]}</p>}
            </div>
            <div>
              <label htmlFor="outage-gids" className="block text-sm font-semibold text-slate-700 dark:text-slate-200">GID tab yang dibaca</label>
              <input id="outage-gids" className={INPUT} value={gidText} onChange={(e) => setGidText(e.target.value)} placeholder="Contoh: 0, 123456" />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Angka setelah gid= pada alamat tab; pisahkan dengan koma.</p>
              {(fieldErrors.gids || fieldErrors['gids.0']) && <p className="mt-1 text-xs font-medium text-red-600">{(fieldErrors.gids || fieldErrors['gids.0'])[0]}</p>}
            </div>
            <div className="flex items-end gap-4">
              <label className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-200">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={form.auto_enabled} onChange={(e) => setForm((f) => ({ ...f, auto_enabled: e.target.checked }))} />
                Sinkron harian otomatis
              </label>
              <div>
                <label htmlFor="outage-time" className="block text-xs font-semibold text-slate-600 dark:text-slate-400">Jam</label>
                <input id="outage-time" type="time" className={`${INPUT} w-32`} value={form.auto_time} onChange={(e) => setForm((f) => ({ ...f, auto_time: e.target.value }))} />
                {fieldErrors.auto_time && <p className="mt-1 text-xs font-medium text-red-600">{fieldErrors.auto_time[0]}</p>}
              </div>
            </div>
            <div>
              <label htmlFor="outage-min" className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Ambang SAIDI/SAIFI (menit)</label>
              <input id="outage-min" type="number" min="0" max="120" className={`${INPUT} w-32`} value={form.saidi_min_minutes} onChange={(e) => setForm((f) => ({ ...f, saidi_min_minutes: e.target.value }))} />
              <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Gangguan lebih singkat dari ambang tidak dihitung dalam SAIDI/SAIFI.</p>
              {fieldErrors.saidi_min_minutes && <p className="mt-1 text-xs font-medium text-red-600">{fieldErrors.saidi_min_minutes[0]}</p>}
              <label className="mt-2 inline-flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200">
                <input type="checkbox" className="h-4 w-4 rounded border-slate-300" checked={form.saidi_only_permanent} onChange={(e) => setForm((f) => ({ ...f, saidi_only_permanent: e.target.checked }))} />
                Hitung hanya gangguan permanen
              </label>
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" loading={saving}>Simpan pengaturan</Button>
          </div>
        </form>
      )}

      {data.unmatched.length > 0 && (
        <section className={`${CARD} p-5 sm:p-6`}>
          <div className="mb-3 flex items-start gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <IconAlertCircle size={18} className="mt-0.5 text-amber-500" />
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Nama penyulang belum terpetakan</h2>
              <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Peristiwa ini belum masuk perhitungan SAIDI/SAIFI. Petakan ke penyulang di master; pemetaan dipakai juga pada sinkron berikutnya.</p>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100 dark:border-slate-800">
                  <th className="py-2 pr-3 font-semibold">GI</th>
                  <th className="py-2 pr-3 font-semibold">Penyulang di sheet</th>
                  <th className="py-2 pr-3 font-semibold text-right">Peristiwa</th>
                  {canSync && <th className="py-2 font-semibold">Petakan ke</th>}
                </tr>
              </thead>
              <tbody>
                {data.unmatched.map((row) => {
                  const key = `${row.gi_name}|${row.feeder_name}`
                  return (
                    <tr key={key} className="border-b border-slate-50 dark:border-slate-800/60 align-middle">
                      <td className="py-2 pr-3">{row.gi_name || '-'}</td>
                      <td className="py-2 pr-3 font-medium">{row.feeder_name}</td>
                      <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(row.events)}</td>
                      {canSync && (
                        <td className="py-2">
                          <div className="flex items-center gap-2">
                            <div className="w-64">
                              <SearchSelect options={feederOptions} value={mapping[key] || ''} onChange={(v) => setMapping((m) => ({ ...m, [key]: v }))} placeholder="Cari penyulang…" ariaLabel={`Petakan ${row.feeder_name}`} />
                            </div>
                            <Button size="sm" onClick={() => mapFeeder(row)} disabled={!mapping[key]} loading={mapBusy === key}>Petakan</Button>
                          </div>
                        </td>
                      )}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section className={`${CARD} p-5 sm:p-6`}>
        <div className="mb-3 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
          <IconDatabase size={18} className="text-slate-500" />
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Riwayat sinkronisasi</h2>
        </div>
        {data.runs.length === 0 ? (
          <p className="py-6 text-center text-sm text-slate-500">Belum ada sinkronisasi.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-slate-500 border-b border-slate-100 dark:border-slate-800">
                  <th className="py-2 pr-3 font-semibold">Waktu</th>
                  <th className="py-2 pr-3 font-semibold">Pemicu</th>
                  <th className="py-2 pr-3 font-semibold">Status</th>
                  <th className="py-2 font-semibold">Hasil</th>
                </tr>
              </thead>
              <tbody>
                {data.runs.map((r) => (
                  <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/60">
                    <td className="py-2 pr-3 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                    <td className="py-2 pr-3">{TRIGGER[r.trigger] || r.trigger}</td>
                    <td className="py-2 pr-3"><StatusBadge status={r.status} /></td>
                    <td className="py-2 text-slate-600 dark:text-slate-300">{r.status === 'FAILED' ? r.message || 'Gagal' : countsText(r.counts)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}
