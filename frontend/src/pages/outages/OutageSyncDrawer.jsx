import { useCallback, useEffect, useRef, useState } from 'react'
import { outageApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import SearchSelect from '../../components/SearchSelect.jsx'
import {
  IconRefresh,
  IconZap,
  IconDatabase,
  IconAlertCircle,
  IconSettings,
  IconCheck,
} from '../../components/icons.jsx'
import { fmtInt } from '../../components/TrendCharts.jsx'

const INPUT =
  'mt-1 block w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-blue-600 focus:outline-hidden focus:ring-1 focus:ring-blue-600 transition shadow-2xs disabled:opacity-60'

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
  return Number.isNaN(d.getTime())
    ? '-'
    : d.toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
}

function StatusBadge({ status }) {
  const [label, cls] = STATUS[status] || [status, STATUS.QUEUED[1]]
  return (
    <span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${cls}`}>
      {label}
    </span>
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

/**
 * OutageSyncDrawer
 * Drawer mandiri untuk sinkronisasi data gangguan (Google Sheet / APKT),
 * monitoring status sinkronisasi, pemetaan penyulang tak dikenal, serta pengaturan sumber sheet & jadwal.
 */
export default function OutageSyncDrawer({
  open,
  asPage = false,
  onClose,
  onSynced,
}) {
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
  const [settingsOpen, setSettingsOpen] = useState(false)
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
      setState({
        loading: false,
        error: e?.message || 'Gagal memuat data sinkronisasi gangguan.',
        data: null,
      })
      return null
    }
  }, [])

  useEffect(() => {
    if (!open) return
    let alive = true
    load().then((d) => {
      if (!alive || !d) return
      apply(d.settings)
      if (d.settings.last_run && ACTIVE.includes(d.settings.last_run.status)) {
        setActiveRun(d.settings.last_run.id)
      }
    })
    return () => {
      alive = false
    }
  }, [open, load, apply])

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
            title:
              r.data.status === 'OK'
                ? 'Sinkronisasi gangguan selesai'
                : 'Sinkronisasi gangguan gagal',
            desc: r.data.message || countsText(r.data.counts),
            tag: 'Data Gangguan',
          })
          if (r.data.status === 'OK' && onSynced) {
            onSynced()
          }
          return
        }
      } catch {
        /* coba lagi pada putaran berikutnya */
      }
      timer.current = setTimeout(tick, 2500)
    }
    timer.current = setTimeout(tick, 1200)
    return () => {
      stop = true
      clearTimeout(timer.current)
    }
  }, [activeRun, load, notify, onSynced])

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
      setSettingsOpen(false)
      notify({
        type: 'success',
        title: 'Pengaturan gangguan disimpan',
        desc: 'Berlaku untuk sinkronisasi dan analisis berikutnya.',
        tag: 'Data Gangguan',
      })
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
      const r = await outageApi.alias({
        gi_name: row.gi_name,
        feeder_name: row.feeder_name,
        feeder_id: feederId,
      })
      setState((s) => ({ ...s, data: { ...s.data, unmatched: r.data.unmatched } }))
      notify({
        type: 'success',
        title: 'Penyulang dipetakan',
        desc: r.message,
        tag: 'Data Gangguan',
      })
      load()
    } catch (err) {
      setFormError(err?.message || 'Gagal memetakan penyulang.')
    } finally {
      setMapBusy('')
    }
  }

  const s = data?.settings
  const feederOptions = (data?.feeders || []).map((f) => ({
    value: f.id,
    label: `${f.name}${f.gi_name ? ` · ${f.gi_name}` : ''}${f.code ? ` (${f.code})` : ''}`,
  }))
  const last = s?.last_run

  return (
    <PanelShell
      asPage={asPage}
      onBack={onClose}
      open={open}
      onClose={onClose}
      title="Sinkronisasi Data Gangguan"
      subtitle="Penarikan riwayat gangguan penyulang dan recloser dari Google Sheet / APKT"
      size={asPage ? 'max-w-6xl' : 'max-w-2xl'}
      width={asPage ? 'max-w-6xl' : 'max-w-2xl'}
    >
      {state.loading && !data ? (
        <div className="py-16 text-center text-xs text-slate-500">
          <IconRefresh size={24} className="animate-spin mx-auto text-blue-600 mb-2" />
          <p>Memuat status sinkronisasi data gangguan…</p>
        </div>
      ) : (
        <div className="space-y-6 text-xs">
          {/* Kartu Ringkasan Status */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Sumber Data</div>
              <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1 truncate">
                {s?.sheet_id_set ? 'Google Sheet' : 'Belum diisi'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                {s?.sheet_id_hint || 'Sheet ID belum diatur'}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Otomasi Harian</div>
              <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1">
                {s?.auto_enabled ? `Pukul ${s?.auto_time} WIB` : 'Nonaktif'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {s?.auto_enabled ? 'Sinkron otomatis' : 'Manual saja'}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Total Peristiwa</div>
              <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1">
                {fmtInt(data?.stats?.events ?? 0)}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                {data?.stats?.feeders ? `${fmtInt(data.stats.feeders)} penyulang` : '0 penyulang'}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Sesi Terakhir</div>
              <div className="mt-1">
                {last ? <StatusBadge status={last.status} /> : <span className="text-slate-500">-</span>}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                {last ? fmtDate(last.finished_at || last.created_at) : 'Belum pernah'}
              </div>
            </div>
          </div>

          {/* Action Trigger Box */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100 flex items-center gap-2">
                  <IconZap size={16} className="text-amber-500" />
                  Eksekusi Sinkronisasi Data Gangguan
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Tarik baris peristiwa gangguan penyulang dan recloser terkini dari spreadsheet APKT.
                </p>
              </div>

              <div className="flex items-center gap-2 shrink-0">
                {canSync && (
                  <Button
                    variant="outline"
                    size="sm"
                    icon={IconSettings}
                    onClick={() => setSettingsOpen(!settingsOpen)}
                  >
                    Pengaturan
                  </Button>
                )}
                {canSync && (
                  <Button
                    variant="primary"
                    size="sm"
                    icon={IconRefresh}
                    onClick={start}
                    loading={starting || running}
                    disabled={!s?.sheet_id_set || running}
                  >
                    {running ? 'Menyinkronkan…' : 'Sinkronkan Sekarang'}
                  </Button>
                )}
              </div>
            </div>

            {!s?.sheet_id_set && (
              <Alert type="warning">
                Sumber Google Sheet belum diisi. Silakan isi tautan Google Sheet pada panel pengaturan di bawah.
              </Alert>
            )}

            {formError && <Alert type="error">{formError}</Alert>}
          </div>

          {/* Pengaturan Sumber Sheet & Jadwal */}
          {canSync && form && settingsOpen && (
            <form
              onSubmit={save}
              className="bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-4"
            >
              <div className="border-b border-slate-200 dark:border-slate-700/60 pb-2">
                <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Pengaturan Sumber Google Sheet &amp; Ambang SAIDI/SAIFI
                </h4>
                <p className="text-[11px] text-slate-500">
                  Pastikan spreadsheet APKT dibagikan &quot;siapa saja dengan link dapat melihat&quot;.
                </p>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <label htmlFor="outage-drawer-url" className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Tautan Google Sheet
                  </label>
                  <input
                    id="outage-drawer-url"
                    className={INPUT}
                    value={sheetUrl}
                    onChange={(e) => setSheetUrl(e.target.value)}
                    autoComplete="off"
                    placeholder={
                      s?.sheet_id_set
                        ? `Tersimpan (${s.sheet_id_hint}); isi hanya untuk mengganti`
                        : 'Tempel URL Google Sheet'
                    }
                  />
                  {fieldErrors.sheet_url && (
                    <p className="mt-1 text-[11px] font-medium text-rose-600">
                      {fieldErrors.sheet_url[0]}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="outage-drawer-gids" className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    GID Tab yang Dibaca
                  </label>
                  <input
                    id="outage-drawer-gids"
                    className={INPUT}
                    value={gidText}
                    onChange={(e) => setGidText(e.target.value)}
                    placeholder="Contoh: 0, 123456"
                  />
                  <p className="mt-1 text-[11px] text-slate-500">
                    Angka setelah gid= pada URL tab; pisahkan koma jika lebih dari satu.
                  </p>
                  {fieldErrors.gids && (
                    <p className="mt-1 text-[11px] font-medium text-rose-600">
                      {fieldErrors.gids[0]}
                    </p>
                  )}
                </div>

                <div className="flex items-center gap-3">
                  <label className="inline-flex items-center gap-2 text-xs font-semibold text-slate-700 dark:text-slate-200">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-slate-300"
                      checked={form.auto_enabled}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, auto_enabled: e.target.checked }))
                      }
                    />
                    Sinkron harian otomatis
                  </label>
                  <div>
                    <input
                      type="time"
                      className={`${INPUT} w-28`}
                      value={form.auto_time}
                      onChange={(e) => setForm((f) => ({ ...f, auto_time: e.target.value }))}
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="outage-drawer-min" className="block text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Ambang SAIDI/SAIFI (menit)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      id="outage-drawer-min"
                      type="number"
                      min="0"
                      max="120"
                      className={`${INPUT} w-28`}
                      value={form.saidi_min_minutes}
                      onChange={(e) =>
                        setForm((f) => ({ ...f, saidi_min_minutes: e.target.value }))
                      }
                    />
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-200">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-slate-300"
                        checked={form.saidi_only_permanent}
                        onChange={(e) =>
                          setForm((f) => ({ ...f, saidi_only_permanent: e.target.checked }))
                        }
                      />
                      Hanya permanen
                    </label>
                  </div>
                </div>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setSettingsOpen(false)}
                >
                  Batal
                </Button>
                <Button type="submit" size="sm" loading={saving} icon={IconCheck}>
                  Simpan Pengaturan
                </Button>
              </div>
            </form>
          )}

          {/* Penyulang Belum Terpetakan */}
          {data?.unmatched?.length > 0 && (
            <div className="bg-amber-50/50 dark:bg-amber-950/20 rounded-2xl border border-amber-200 dark:border-amber-900/60 p-4 space-y-3">
              <div className="flex items-start gap-2">
                <IconAlertCircle size={18} className="text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <h4 className="text-xs font-bold text-amber-900 dark:text-amber-200">
                    {data.unmatched.length} Nama Penyulang Belum Terpetakan
                  </h4>
                  <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                    Peristiwa padam belum dihitung ke SAIDI/SAIFI unit. Petakan nama di sheet ke master penyulang:
                  </p>
                </div>
              </div>

              <div className="overflow-x-auto max-h-56 overflow-y-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-amber-200/60 text-slate-500">
                      <th className="py-1.5 pr-2">GI</th>
                      <th className="py-1.5 pr-2">Penyulang di Sheet</th>
                      <th className="py-1.5 pr-2 text-right">Peristiwa</th>
                      {canSync && <th className="py-1.5">Petakan ke</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {data.unmatched.map((row) => {
                      const key = `${row.gi_name}|${row.feeder_name}`
                      return (
                        <tr key={key} className="border-b border-amber-100 dark:border-slate-800">
                          <td className="py-1.5 pr-2">{row.gi_name || '-'}</td>
                          <td className="py-1.5 pr-2 font-medium">{row.feeder_name}</td>
                          <td className="py-1.5 pr-2 text-right tabular-nums">{fmtInt(row.events)}</td>
                          {canSync && (
                            <td className="py-1.5">
                              <div className="flex items-center gap-2">
                                <div className="w-52">
                                  <SearchSelect
                                    options={feederOptions}
                                    value={mapping[key] || ''}
                                    onChange={(v) =>
                                      setMapping((m) => ({ ...m, [key]: v }))
                                    }
                                    placeholder="Pilih penyulang…"
                                    ariaLabel={`Petakan ${row.feeder_name}`}
                                  />
                                </div>
                                <Button
                                  size="sm"
                                  onClick={() => mapFeeder(row)}
                                  disabled={!mapping[key]}
                                  loading={mapBusy === key}
                                >
                                  Petakan
                                </Button>
                              </div>
                            </td>
                          )}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {/* Riwayat Sinkronisasi */}
          <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-5 shadow-xs space-y-3">
            <div className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
              <IconDatabase size={16} className="text-slate-500" />
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                Riwayat Sinkronisasi Terakhir
              </h4>
            </div>

            {(!data?.runs || data.runs.length === 0) ? (
              <p className="text-center py-4 text-slate-400">Belum ada riwayat sinkronisasi gangguan.</p>
            ) : (
              <div className="overflow-x-auto max-h-60 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b border-slate-100 dark:border-slate-800 text-slate-500 text-left">
                      <th className="py-1.5 pr-2">Waktu</th>
                      <th className="py-1.5 pr-2">Pemicu</th>
                      <th className="py-1.5 pr-2">Status</th>
                      <th className="py-1.5">Hasil</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.runs.map((r) => (
                      <tr key={r.id} className="border-b border-slate-50 dark:border-slate-800/60">
                        <td className="py-1.5 pr-2 whitespace-nowrap">{fmtDate(r.created_at)}</td>
                        <td className="py-1.5 pr-2">{TRIGGER[r.trigger] || r.trigger}</td>
                        <td className="py-1.5 pr-2">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="py-1.5 text-slate-600 dark:text-slate-300">
                          {r.status === 'FAILED' ? r.message || 'Gagal' : countsText(r.counts)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}
    </PanelShell>
  )
}
