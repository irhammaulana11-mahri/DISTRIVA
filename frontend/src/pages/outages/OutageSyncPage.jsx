import { useCallback, useEffect, useRef, useState } from 'react'
import { outageApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import SearchSelect from '../../components/SearchSelect.jsx'
import Modal from '../../components/Modal.jsx'
import { SyncUp3Selector, SyncRunMetaBadges, SyncConflictAlert } from '../sync/SyncRunStatusHelpers.jsx'
import SyncTabLayout from '../sync/SyncTabLayout.jsx'
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
export default function OutageSyncPage({ embedded = false, selectedUp3Id = '', onUp3Context }) {
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
  const [activeRunData, setActiveRunData] = useState(null)
  const [up3Id, setUp3Id] = useState(selectedUp3Id || '')
  const [up3s, setUp3s] = useState([])
  const [conflict, setConflict] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
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

  const load = useCallback(async (overrideUp3Id) => {
    try {
      const targetUp3 = overrideUp3Id !== undefined ? overrideUp3Id : up3Id
      const r = await outageApi.sync(targetUp3 ? { up3_id: targetUp3 } : {})
      setState({ loading: false, error: '', data: r.data })
      if (r.data?.up3s) setUp3s(r.data.up3s)
      const resolvedUp3Id = r.data?.up3_id || targetUp3 || ''
      if (r.data?.up3_id) setUp3Id(r.data.up3_id)
      onUp3Context?.({ up3Id: resolvedUp3Id, up3s: r.data?.up3s || [] })
      return r.data
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Gagal memuat data sinkronisasi gangguan.', data: null })
      return null
    }
  }, [up3Id])

  useEffect(() => {
    if (selectedUp3Id && selectedUp3Id !== up3Id) {
      setUp3Id(selectedUp3Id)
      setActiveRun(null)
      setActiveRunData(null)
      setConflict(null)
      load(selectedUp3Id).then((d) => {
        if (d?.settings) apply(d.settings)
      })
    }
  }, [selectedUp3Id]) // eslint-disable-line react-hooks/exhaustive-deps

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
        if (r?.data) setActiveRunData(r.data)
        if (!ACTIVE.includes(r.data.status)) {
          setActiveRun(null)
          setActiveRunData(null)
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
  const canSettings = Boolean(data?.can?.settings ?? data?.can?.sync)
  const running = !!activeRun

  const start = async () => {
    setStarting(true)
    setFormError('')
    setConflict(null)
    try {
      const r = await outageApi.start(up3Id ? { up3_id: up3Id } : {})
      setActiveRun(r.data.id)
      setActiveRunData(r.data)
      await load()
    } catch (e) {
      if (e?.status === 409 && e?.data) {
        setConflict(e.data)
        if (e.data.active_run_id) {
          setActiveRun(e.data.active_run_id)
        }
      }
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
        ...(up3Id ? { up3_id: up3Id } : {}),
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

  const settingsFormBody = canSettings && form && (
    <form onSubmit={save} className={embedded ? 'space-y-4 text-xs' : `${CARD} p-5 sm:p-6 space-y-4`}>
      {!embedded && (
        <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Pengaturan sumber &amp; jadwal</h2>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Sheet harus dibagikan "siapa saja dengan tautan dapat melihat". Alamat sheet tidak ditampilkan kembali setelah disimpan.</p>
        </div>
      )}
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
  )

  if (embedded) {
    return (
      <SyncTabLayout
        stats={[
          { label: 'Sumber Sheet', value: s.sheet_id_set ? 'Terhubung' : 'Belum diatur', sub: `${(s.gids || []).length || 1} Tab GID` },
          { label: 'Otomasi Harian', value: s.auto_enabled ? `Pukul ${s.auto_time} WIB` : 'Nonaktif', sub: s.auto_enabled ? 'Jadwal harian aktif' : 'Manual saja' },
          { label: 'Peristiwa Gangguan', value: fmtInt(data.stats.events), sub: `${fmtInt(data.stats.feeders)} penyulang terpetakan` },
          { label: 'Sesi Terakhir', value: last ? <StatusBadge status={last.status} /> : 'Belum ada', sub: last ? `${TRIGGER[last.trigger] || last.trigger} · ${fmtDate(last.finished_at || last.created_at)}` : '-' },
        ]}
        banner={{
          title: 'Google Sheet Data Gangguan per UP3',
          badge: s.sheet_id_set ? `Terhubung (${s.sheet_id_hint || 'Sheet'})` : 'Sheet Belum Diatur',
          badgeTone: s.sheet_id_set ? 'ok' : 'warn',
          desc: 'Gangguan penyulang dan recloser dibaca dari Google Sheet per UP3, harian otomatis atau manual.',
          actionLabel: canSettings ? 'Pengaturan' : undefined,
          onAction: canSettings ? () => setSettingsOpen(true) : undefined,
        }}
        alerts={
          <>
            <SyncConflictAlert conflict={conflict} onDismiss={() => setConflict(null)} />
            {activeRunData && <SyncRunMetaBadges run={activeRunData} />}
            {formError && <Alert type="error">{formError}</Alert>}
          </>
        }
      >
        <section className="p-5 rounded-2xl border border-blue-200 dark:border-blue-900/80 bg-white dark:bg-slate-900 shadow-xs space-y-4">
          <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">Tarik Data Gangguan dari Google Sheet</h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {s.sheet_id_set ? 'Eksekusi penarikan peristiwa gangguan penyulang dan recloser per UP3 secara online.' : 'Isi tautan Google Sheet pada tombol Pengaturan di atas terlebih dulu.'}
              </p>
            </div>
            <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
              Google Sheet
            </span>
          </div>
          <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
            <div className="font-semibold text-slate-800 dark:text-slate-200">Cakupan Data yang Ditarik:</div>
            <p>
              Membaca seluruh tab GID terdaftar ({(s.gids || []).length || 1} tab) untuk UP3 terpilih, menghitung SAIDI/SAIFI sesuai ambang ({s.saidi_min_minutes ?? 5} menit), dan menandai penyulang yang belum terpetakan.
            </p>
          </div>
          {canSync && (
            <div className="pt-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <Button icon={IconRefresh} onClick={start} loading={starting || running} disabled={!s.sheet_id_set || running} variant="primary" size="md" className="w-full sm:w-auto">
                {running ? 'Menyinkronkan…' : 'Sinkronkan Sekarang'}
              </Button>
              {!s.sheet_id_set && (
                <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                  Simpan tautan Google Sheet pada Pengaturan terlebih dulu.
                </span>
              )}
            </div>
          )}
        </section>

        {data.unmatched.length > 0 && (
          <section className={`${CARD} p-5 space-y-3`}>
            <div className="flex items-start gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <IconAlertCircle size={18} className="mt-0.5 text-amber-500" />
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Nama penyulang belum terpetakan ({data.unmatched.length})</h3>
                <p className="text-[11px] text-slate-500 dark:text-slate-400">Petakan ke penyulang master agar masuk perhitungan SAIDI/SAIFI.</p>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-left text-slate-500 border-b border-slate-100 dark:border-slate-800">
                    <th className="py-2 pr-3 font-semibold">GI</th>
                    <th className="py-2 pr-3 font-semibold">Penyulang di sheet</th>
                    <th className="py-2 pr-3 font-semibold text-right">Peristiwa</th>
                    <th className="py-2 pr-3 font-semibold">Petakan ke master</th>
                    <th className="py-2 font-semibold"></th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {data.unmatched.map((row) => {
                    const key = `${row.gi_name}|${row.feeder_name}`
                    return (
                      <tr key={key}>
                        <td className="py-2 pr-3">{row.gi_name || '-'}</td>
                        <td className="py-2 pr-3 font-semibold">{row.feeder_name}</td>
                        <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(row.events)}</td>
                        <td className="py-2 pr-3 min-w-[220px]">
                          <SearchSelect options={feederOptions} value={mapping[key] || ''} onChange={(val) => setMapping((m) => ({ ...m, [key]: val }))} placeholder="Pilih penyulang…" />
                        </td>
                        <td className="py-2 text-right">
                          <Button size="xs" variant="secondary" disabled={!mapping[key] || mapBusy === key} loading={mapBusy === key} onClick={() => mapFeeder(row)}>Simpan</Button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section className={`${CARD} overflow-hidden`}>
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center gap-2">
            <IconDatabase size={16} className="text-slate-500" />
            <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">Riwayat Sinkronisasi Data Gangguan</h4>
          </div>
          {data.runs.length === 0 ? (
            <p className="p-6 text-center text-slate-500">Belum ada sesi sinkronisasi.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                    <th className="py-3 px-4">Waktu</th>
                    <th className="py-3 px-4">Pemicu</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-4">Hasil</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                  {data.runs.map((r) => (
                    <tr key={r.id}>
                      <td className="py-3 px-4 font-mono font-medium text-slate-800 dark:text-slate-200 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                      <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">{TRIGGER[r.trigger] || r.trigger}</td>
                      <td className="py-3 px-4"><StatusBadge status={r.status} /></td>
                      <td className="py-3 px-4 text-slate-600 dark:text-slate-300">{r.status === 'FAILED' ? r.message || 'Gagal' : countsText(r.counts)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Pengaturan Sumber & Jadwal Gangguan" subtitle="Tautan Google Sheet, tab GID, jadwal otomatis, dan ambang SAIDI/SAIFI" size="max-w-3xl" width="max-w-3xl">
          {settingsFormBody}
        </Modal>
      </SyncTabLayout>
    )
  }

  return (
    <div className="space-y-5 w-full">
      {!embedded && (
        <SyncUp3Selector
          up3Id={up3Id}
          up3s={up3s}
          onChange={(nextId) => {
            setUp3Id(nextId)
            setActiveRun(null)
            setActiveRunData(null)
            setConflict(null)
            load(nextId).then((d) => {
              if (d?.settings) apply(d.settings)
            })
          }}
        />
      )}
      <SyncConflictAlert conflict={conflict} onDismiss={() => setConflict(null)} />
      {activeRunData && <SyncRunMetaBadges run={activeRunData} />}
      <div className={`${CARD} p-5 sm:p-6`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-2.5 text-amber-600"><IconZap size={22} /></span>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                {embedded ? (
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Data Gangguan (Google Sheet)</h2>
                ) : (
                  <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Data Gangguan (Sinkron)</h1>
                )}
                <span className={`rounded-full px-2.5 py-0.5 text-[10px] font-bold ${s.sheet_id_set ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'}`}>
                  {s.sheet_id_set ? `Sheet Terhubung · ${(s.gids || []).length || 1} Tab GID` : 'Sheet Belum Diatur'}
                </span>
              </div>
              <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400">
                Gangguan penyulang dan recloser dibaca dari Google Sheet per UP3, harian otomatis atau manual. Analisis ada di Analisa &amp; Tren Pengusahaan &rsaquo; Gangguan Penyulang.
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
