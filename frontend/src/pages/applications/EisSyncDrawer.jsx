import { useCallback, useEffect, useRef, useState } from 'react'
import { eisSyncApi, syncApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Modal from '../../components/Modal.jsx'
import EisRunResults from './EisRunResults.jsx'
import { SyncUp3Selector, SyncRunMetaBadges, SyncConflictAlert } from '../sync/SyncRunStatusHelpers.jsx'
import SyncUlpAccountsPanel from '../sync/SyncUlpAccountsPanel.jsx'
import SyncUnitPicker from '../sync/SyncUnitPicker.jsx'
import {
  IconRefresh,
  IconCheck,
  IconShieldCheck,
  IconEye,
  IconEyeOff,
  IconClock,
  IconCalendar,
  IconX,
} from '../../components/icons.jsx'

const inputCls =
  'block w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500 transition-all'

const STATUS = {
  QUEUED: ['Menunggu', 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'],
  RUNNING: ['Berjalan', 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'],
  OK: ['Selesai', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'],
  FAILED: ['Gagal', 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'],
}

const when = (v) =>
  v ? new Date(v).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-'

function Field({ label, hint, children }) {
  return (
    <label className="block text-xs">
      <span className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">{label}</span>
      {children}
      {hint && <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-1">{hint}</span>}
    </label>
  )
}

/**
 * Sinkronisasi EIS dari DISTRIVA:
 * Antarmuka proporsional, interaktif, user-friendly, aman, dan responsif
 * untuk penarikan data langsung dari server EIS PLN.
 *
 * Mendukung mode kontekstual via prop `mode`:
 * - 'permohonan': hanya menampilkan form penarikan Permohonan Pelanggan (PB/PD).
 * - 'piutang': hanya menampilkan form penarikan Laporan Saldo Piutang (Golongan, Lembar, Kogol).
 * - 'all' / null: menampilkan selector/tab atau mode kontekstual.
 */
export default function EisSyncDrawer({ open, asPage = false, embedded = false, selectedUp3Id = '', onUp3Context, mode = null, initialDataset = 'saidi-saifi', initialReports = null, onClose, onSynced }) {
  const { can } = useAccess?.() || { can: {} }
  const canApktSync = Boolean(can?.['eis_sync.manage'] && can?.['eis_reports.import'])

  const [settings, setSettings] = useState(null)
  const [form, setForm] = useState(null)
  const [runs, setRuns] = useState([])
  const [units, setUnits] = useState([])
  const [up3Id, setUp3Id] = useState(selectedUp3Id || '')
  const [up3s, setUp3s] = useState([])
  const [ulpAccounts, setUlpAccounts] = useState([])
  const [picked, setPicked] = useState(null)       // null = semua unit; selain itu daftar kode ULP yang dipilih
  const [current, setCurrent] = useState(null)
  const [batchRuns, setBatchRuns] = useState([])
  const [conflict, setConflict] = useState(null)
  const [range, setRange] = useState({ from: '', to: '' })
  const [completeOld, setCompleteOld] = useState(false)       // melengkapi permohonan lama (maks. 180 hari sebelum rentang): hanya bila pengguna memilihnya
  const [saving, setSaving] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)

  // Tab internal jika mode = 'all' atau tidak ditentukan
  const [activeTab, setActiveTab] = useState(
    mode === 'piutang' ? 'piutang' : mode === 'apkt' ? 'apkt' : mode === 'ap2t' ? 'ap2t' : 'permohonan'
  )

  // Sinkronkan activeTab bila prop mode berubah
  useEffect(() => {
    if (mode === 'piutang') {
      setActiveTab('piutang')
    } else if (mode === 'apkt') {
      setActiveTab('apkt')
    } else if (mode === 'ap2t') {
      setActiveTab('ap2t')
    } else if (mode === 'permohonan') {
      setActiveTab('permohonan')
    }
  }, [mode])

  // State untuk penarikan piutang
  const nowMonth = new Date().toISOString().slice(0, 7)
  const [piutangFromMonth, setPiutangFromMonth] = useState('')
  const [piutangToMonth, setPiutangToMonth] = useState(nowMonth)
  const [piutangReports, setPiutangReports] = useState(['GOLONGAN', 'LEMBAR', 'KOGOL', 'PRABAYAR'])
  const [piutangStarting, setPiutangStarting] = useState(false)
  const [piutangError, setPiutangError] = useState('')

  // State untuk penarikan AP2T (TAGSUS kWh P2TL)
  const [ap2tFromMonth, setAp2tFromMonth] = useState('')
  const [ap2tToMonth, setAp2tToMonth] = useState(nowMonth)
  const [ap2tReports, setAp2tReports] = useState(['realisasi', 'belum_realisasi'])
  const [ap2tStarting, setAp2tStarting] = useState(false)
  const [ap2tError, setAp2tError] = useState('')

  // State untuk penarikan SAIDI/SAIFI APKT (DIFI) & RPT/RCT
  const [apktDataset, setApktDataset] = useState(initialDataset || 'saidi-saifi')
  const [apktToken, setApktToken] = useState('')
  const [saveApktToken, setSaveApktToken] = useState(false)
  const [useSavedToken, setUseSavedToken] = useState(false)
  const [savedTokenInfo, setSavedTokenInfo] = useState({ saved: false, saved_at: null, last_result: null, last_used_at: null })
  const [apktFromMonth, setApktFromMonth] = useState('')
  const [apktToMonth, setApktToMonth] = useState(nowMonth)
  const [apktStarting, setApktStarting] = useState(false)
  const [apktError, setApktError] = useState('')
  const [deletingToken, setDeletingToken] = useState(false)

  const timer = useRef(null)
  const logRef = useRef(null)

  const load = useCallback(async (overrideUp3Id) => {
    try {
      const targetUp3 = overrideUp3Id !== undefined ? overrideUp3Id : up3Id
      const res = await eisSyncApi.show(targetUp3 ? { up3_id: targetUp3 } : {})
      const s = res?.data?.settings
      setSettings(s)
      if (res?.data?.up3s) setUp3s(res.data.up3s)
      const resolvedUp3Id = res?.data?.up3_id || targetUp3 || ''
      if (res?.data?.up3_id) setUp3Id(res.data.up3_id)
      onUp3Context?.({ up3Id: resolvedUp3Id, up3s: res?.data?.up3s || [] })
      if (syncApi?.accounts) {
        syncApi.accounts({ source: 'eis', ...(resolvedUp3Id ? { up3_id: resolvedUp3Id } : {}) })
          .then((aRes) => setUlpAccounts(Array.isArray(aRes?.data) ? aRes.data : []))
          .catch(() => {})
      }
      setForm((f) => f || {
        eis_username: s?.eis_username || '',
        eis_password: '',
        power_min: s?.power_min ?? 0,
        power_max: s?.power_max ?? 99999999,
        lookback_days: s?.lookback_days ?? 180,
        auto_enabled: Boolean(s?.auto_enabled),
        auto_time: s?.auto_time || '18:13',
      })
      setRuns(res?.data?.runs || [])
      const rawUnits = res?.data?.units || []
      setUnits(
        resolvedUp3Id
          ? rawUnits.filter((u) => (!u.parent_id && !u.up3_id) || u.parent_id === resolvedUp3Id || u.up3_id === resolvedUp3Id)
          : rawUnits,
      )
      const live = (res?.data?.runs || []).find((r) => r.status === 'QUEUED' || r.status === 'RUNNING')
      if (live) setCurrent((c) => c || live)

      // Cek status token APKT tersimpan
      if (canApktSync) {
        try {
          const tRes = await eisSyncApi.apktTokenStatus?.()
          if (tRes?.data) {
            setSavedTokenInfo(tRes.data)
            if (tRes.data.saved && tRes.data.last_result !== 'REJECTED') {
              setUseSavedToken(true)
            }
          }
        } catch {
          // Abaikan bila endpoint belum tersedia atau izin terbatas
        }
      }
    } catch (err) {
      setError(err?.message || 'Gagal memuat pengaturan sinkronisasi EIS.')
    }
  }, [canApktSync, up3Id])

  useEffect(() => {
    if (initialDataset) {
      setApktDataset(initialDataset)
    }
  }, [initialDataset])

  useEffect(() => {
    if (initialReports && Array.isArray(initialReports)) {
      if (mode === 'ap2t' || activeTab === 'ap2t') {
        setAp2tReports(initialReports)
      } else {
        setPiutangReports(initialReports)
      }
    }
  }, [initialReports, mode, activeTab])

  useEffect(() => {
    if (selectedUp3Id && selectedUp3Id !== up3Id) {
      setUp3Id(selectedUp3Id)
      setForm(null)
      setCurrent(null)
      setBatchRuns([])
      setConflict(null)
      setPicked(null)
      load(selectedUp3Id)
    }
  }, [selectedUp3Id]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (open) {
      setForm(null)
      setCurrent(null)
      setPicked(null)
      setError('')
      setNotice('')
      setShowPassword(false)
      load()
    }
    return () => clearTimeout(timer.current)
  }, [open, load])

  // Ikuti satu atau beberapa sinkronisasi yang sedang berjalan sampai selesai
  useEffect(() => {
    clearTimeout(timer.current)
    const liveBatch = batchRuns.filter((r) => ['QUEUED', 'RUNNING'].includes(r.status))
    const hasCurrentLive = current && ['QUEUED', 'RUNNING'].includes(current.status)
    if (!open || (!hasCurrentLive && liveBatch.length === 0)) return undefined
    timer.current = setTimeout(async () => {
      try {
        if (hasCurrentLive) {
          const res = await eisSyncApi.run(current.id)
          if (res?.data) {
            setCurrent(res.data)
            if (!['QUEUED', 'RUNNING'].includes(res.data.status)) {
              load()
              if (res.data.status === 'OK') onSynced?.()
            }
          }
        }
        if (batchRuns.length > 1 && liveBatch.length > 0) {
          const updated = await Promise.all(
            batchRuns.map(async (r) => {
              if (!['QUEUED', 'RUNNING'].includes(r.status)) return r
              try {
                const res = await eisSyncApi.run(r.id)
                return res?.data || r
              } catch {
                return r
              }
            }),
          )
          setBatchRuns(updated)
          const firstFinished = updated.find((r) => r.status === 'OK')
          if (updated.every((r) => !['QUEUED', 'RUNNING'].includes(r.status))) {
            load()
            if (firstFinished) onSynced?.()
          }
        }
      } catch {
        setCurrent((c) => (c ? { ...c } : c))
      }
    }, 3000)
    return () => clearTimeout(timer.current)
  }, [open, current, batchRuns, load, onSynced])

  // Auto-scroll log saat ada pembaruan
  useEffect(() => {
    if (current?.log && logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight
    }
  }, [current?.log])

  const set = (k) => (e) =>
    setForm((f) => ({
      ...f,
      [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value,
    }))

  const handleUp3Change = (nextUp3Id) => {
    setUp3Id(nextUp3Id)
    setForm(null)
    setCurrent(null)
    setBatchRuns([])
    setConflict(null)
    setPicked(null)
    load(nextUp3Id)
  }

  const handleStartResponse = (res) => {
    const primary = res?.data || null
    const allRuns = Array.isArray(res?.runs) && res.runs.length > 0 ? res.runs : primary ? [primary] : []
    setCurrent(primary)
    setBatchRuns(allRuns)
    setConflict(null)
  }

  const handleStartConflict = (err, fallbackMsg, setErrFn) => {
    if (err?.status === 409 && err?.data) {
      setConflict(err.data)
      if (err.data.active_run_id) {
        eisSyncApi.run(err.data.active_run_id).then((r) => {
          if (r?.data) setCurrent(r.data)
        }).catch(() => {})
      }
    }
    setErrFn(err?.message || fallbackMsg)
  }

  const save = async () => {
    setSaving(true)
    setError('')
    setNotice('')
    try {
      const res = await eisSyncApi.save({
        ...form,
        ...(up3Id ? { up3_id: up3Id } : {}),
        power_min: Number(form.power_min),
        power_max: Number(form.power_max),
        lookback_days: Number(form.lookback_days),
      })
      setSettings(res?.data)
      setForm((f) => ({ ...f, eis_password: '' }))
      setNotice('Pengaturan disimpan.')
    } catch (err) {
      setError(err?.message || 'Gagal menyimpan pengaturan.')
    } finally {
      setSaving(false)
    }
  }

  const allCodes = units.map((u) => u.code)
  const selected = picked ?? allCodes
  const toggleUnit = (code) => setPicked(selected.includes(code) ? selected.filter((c) => c !== code) : allCodes.filter((c) => c === code || selected.includes(c)))

  const start = async () => {
    setStarting(true)
    setError('')
    setNotice('')
    setConflict(null)
    try {
      const body = range.from && range.to ? { from: range.from, to: range.to } : {}
      if (up3Id) body.up3_id = up3Id
      if (units.length > 0 && selected.length < units.length) body.units = selected      // semua unit = tanpa daftar; sebagian = hanya unit itu, berurutan
      if (completeOld) body.complete_old = true
      const res = await eisSyncApi.start(body)
      handleStartResponse(res)
    } catch (err) {
      handleStartConflict(err, 'Gagal memulai sinkronisasi.', setError)
    } finally {
      setStarting(false)
    }
  }

  const togglePiutangReport = (rep) => {
    setPiutangReports((prev) =>
      prev.includes(rep) ? prev.filter((r) => r !== rep) : [...prev, rep]
    )
  }

  const startPiutang = async () => {
    setPiutangStarting(true)
    setPiutangError('')
    setNotice('')
    setConflict(null)
    try {
      const body = {
        kind: 'piutang',
        to_month: piutangToMonth,
        from_month: piutangFromMonth || piutangToMonth,
        reports: piutangReports,
      }
      if (up3Id) body.up3_id = up3Id
      if (units.length > 0 && selected.length < units.length) body.units = selected
      const res = await eisSyncApi.start(body)
      handleStartResponse(res)
    } catch (err) {
      handleStartConflict(err, 'Gagal memulai penarikan saldo piutang.', setPiutangError)
    } finally {
      setPiutangStarting(false)
    }
  }

  const toggleAp2tReport = (rep) => {
    setAp2tReports((prev) =>
      prev.includes(rep) ? prev.filter((r) => r !== rep) : [...prev, rep]
    )
  }

  const startAp2t = async () => {
    setAp2tStarting(true)
    setAp2tError('')
    setNotice('')
    setConflict(null)
    try {
      const body = {
        kind: 'ap2t',
        to_month: ap2tToMonth,
        from_month: ap2tFromMonth || ap2tToMonth,
        reports: ap2tReports,
      }
      if (up3Id) body.up3_id = up3Id
      if (units.length > 0 && selected.length < units.length) body.units = selected
      const res = await eisSyncApi.start(body)
      handleStartResponse(res)
    } catch (err) {
      handleStartConflict(err, 'Gagal memulai penarikan TAGSUS AP2T.', setAp2tError)
    } finally {
      setAp2tStarting(false)
    }
  }

  const startApkt = async () => {
    setApktStarting(true)
    setApktError('')
    setNotice('')
    setConflict(null)
    const token = apktToken.trim()
    // Segera kosongkan input token demi keamanan; jangan pernah simpan di browser storage
    setApktToken('')

    try {
      const body = {
        kind: 'apkt',
        dataset: apktDataset,
        to_month: apktToMonth,
        from_month: apktFromMonth || apktToMonth,
      }
      if (up3Id) body.up3_id = up3Id
      if (useSavedToken) {
        body.use_saved_token = true
      } else {
        body.apkt_token = token
        if (saveApktToken) body.save_token = true
      }
      if (units.length > 0 && selected.length < units.length) body.units = selected
      const res = await eisSyncApi.start(body)
      handleStartResponse(res)
      // Refresh status token
      if (saveApktToken) {
        setSavedTokenInfo((prev) => ({ ...prev, saved: true, saved_at: new Date().toISOString() }))
      }
    } catch (err) {
      // Backend mengirim pesan Indonesia apa adanya (422 / 409)
      const msg = err?.message || 'Gagal memulai penarikan SAIDI/SAIFI APKT.'
      handleStartConflict(err, msg, setApktError)
      // Galat 409 terkait token tersimpan: tampilkan pesan dan pindah ke pilihan tempel token
      if (useSavedToken && (err?.status === 409 || msg.includes('token APKT tersimpan') || msg.includes('tidak dapat dibaca lagi'))) {
        setUseSavedToken(false)
      }
    } finally {
      setApktStarting(false)
    }
  }

  const handleDeleteSavedApktToken = async () => {
    setDeletingToken(true)
    try {
      await eisSyncApi.deleteApktToken()
      setSavedTokenInfo({ saved: false, saved_at: null, last_result: null, last_used_at: null })
      setUseSavedToken(false)
      setNotice('Token APKT tersimpan berhasil dihapus.')
    } catch (err) {
      setApktError(err?.message || 'Gagal menghapus token APKT tersimpan.')
    } finally {
      setDeletingToken(false)
    }
  }

  // Jika log memuat "token APKT ditolak", kosongkan token jika ada
  useEffect(() => {
    if (typeof current?.log === 'string' && current.log.toLowerCase().includes('token apkt ditolak')) {
      setApktToken('')
    }
  }, [current?.log])

  const running = current && ['QUEUED', 'RUNNING'].includes(current.status)
  const sameUp3Active = !current?.up3?.id || !up3Id || current.up3.id === up3Id
  const runningPermohonan = Boolean(running && sameUp3Active && (!current?.kind || current.kind === 'permohonan'))
  const runningPiutang = Boolean(running && sameUp3Active && current?.kind === 'piutang')
  const runningApkt = Boolean(running && sameUp3Active && current?.kind === 'apkt' && (!current?.dataset || current.dataset === apktDataset))
  const runningAp2t = Boolean(running && sameUp3Active && current?.kind === 'ap2t')
  const ready = Boolean(settings?.eis_username && settings?.has_password)

  // Metrik Ringkasan KPI
  const lastRun = runs[0] || null

  // Tentukan mode aktif: jika prop mode spesifik ('permohonan' | 'piutang' | 'apkt' | 'ap2t'), kunci ke mode itu.
  // Jika tidak ('all' / null), ikuti activeTab yang bisa di-switch pengguna.
  const isPermohonan = mode === 'permohonan' || (!mode && activeTab === 'permohonan')
  const isPiutang = mode === 'piutang' || (!mode && activeTab === 'piutang')
  const isApkt = mode === 'apkt' || (!mode && activeTab === 'apkt')
  const isAp2t = mode === 'ap2t' || (!mode && activeTab === 'ap2t')

  const isAp2tPrrMode = isAp2t && ap2tReports.length > 0 && ap2tReports.every((r) => r === 'pelunasan_prr' || r === 'pelunasan_ex_prr' || r === 'saldo_prr' || r === 'hapus_prr')
  const isAp2tBpMode = isAp2t && ap2tReports.length === 1 && ap2tReports[0] === 'bp'

  const titleText = isAp2t
    ? (isAp2tBpMode ? 'Tarik Rekap Laporan BP (AP2T)' : isAp2tPrrMode ? 'Tarik Laporan Pelunasan PRR (AP2T)' : 'Tarik TAGSUS AP2T (kWh P2TL)')
    : isApkt
    ? apktDataset === 'rpt-rct-gangguan'
      ? 'Tarik RPT/RCT WO Gangguan APKT'
      : apktDataset === 'rpt-rct-keluhan'
      ? 'Tarik RPT/RCT WO Keluhan APKT'
      : apktDataset === 'anomali-gangguan'
      ? 'Tarik Anomali Gangguan APKT'
      : apktDataset === 'anomali-keluhan'
      ? 'Tarik Anomali Keluhan APKT'
      : 'Tarik SAIDI/SAIFI APKT (DIFI)'
    : isPiutang && !isPermohonan
    ? 'Sinkronisasi Saldo Piutang EIS'
    : 'Sinkronisasi EIS'
  const subtitleText = isAp2t
    ? (isAp2tBpMode ? 'Tarik rekap laporan biaya penyambungan (penerimaan, restitusi, peremajaan) per ULP langsung dari AP2T ke DISTRIVA' : isAp2tPrrMode ? 'Tarik laporan pelunasan piutang ragu-ragu dan ex-PRR per ULP langsung dari AP2T ke DISTRIVA' : 'Tarik laporan realisasi tagihan susulan (TAGSUS) P2TL per ULP langsung dari AP2T ke DISTRIVA')
    : isApkt
    ? apktDataset === 'rpt-rct-gangguan'
      ? 'Tarik durasi respons dan pemulihan WO gangguan langsung dari GraphQL APKT'
      : apktDataset === 'rpt-rct-keluhan'
      ? 'Tarik durasi respons dan penyelesaian WO keluhan pelanggan langsung dari GraphQL APKT'
      : apktDataset === 'anomali-gangguan'
      ? 'Tarik anomali penanganan pengaduan gangguan langsung dari GraphQL APKT'
      : apktDataset === 'anomali-keluhan'
      ? 'Tarik anomali penanganan pengaduan keluhan langsung dari GraphQL APKT'
      : 'Tarik laporan SAIDI/SAIFI SE004 bulanan langsung dari APKT ke format DIFI DISTRIVA'
    : isPiutang && !isPermohonan
    ? 'Tarik laporan saldo piutang bulanan langsung dari server EIS ke DISTRIVA'
    : 'Tarik permohonan pelanggan PB/PD langsung dari server EIS ke DISTRIVA'

  return (
    <PanelShell
      asPage={asPage}
      embedded={embedded}
      onBack={embedded ? undefined : onClose}
      open={open}
      onClose={onClose}
      title={titleText}
      subtitle={subtitleText}
      size={asPage ? 'max-w-6xl' : 'max-w-2xl'}
      width={asPage ? 'max-w-6xl' : 'max-w-2xl'}
    >
      {!form ? (
        <div className="py-16 text-center text-xs text-slate-500">
          <IconRefresh size={24} className="animate-spin mx-auto text-blue-600 mb-2" />
          <p>Memuat pengaturan dan riwayat sinkronisasi EIS…</p>
        </div>
      ) : (
        <div className="space-y-6 text-xs">
          {!embedded && <SyncUp3Selector up3Id={up3Id} up3s={up3s} onChange={handleUp3Change} />}
          <SyncConflictAlert conflict={conflict} onDismiss={() => setConflict(null)} />
          {/* Kartu ringkasan: akun, otomasi, total riwayat, sesi terakhir */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">
                Akun EIS {up3s.find((u) => u.id === up3Id)?.name ? `· ${up3s.find((u) => u.id === up3Id).name}` : ''}
              </div>
              <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1 truncate">
                {settings?.eis_username || 'Belum diatur'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {settings?.has_password ? 'Password aman tersimpan' : 'Password belum ada'}
              </div>
              {ulpAccounts.length > 0 && (
                <button
                  type="button"
                  onClick={() => setSettingsOpen(true)}
                  className="mt-1.5 inline-flex items-center rounded-full bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 text-[10px] font-semibold text-indigo-700 dark:text-indigo-300 hover:underline cursor-pointer"
                >
                  {ulpAccounts.length === 1
                    ? `${ulpAccounts[0].name}: ${ulpAccounts[0].has_own_account ? `Akun sendiri (${ulpAccounts[0].username})` : 'Ikut akun UP3'}`
                    : `Akun Khusus ULP: ${ulpAccounts.filter((a) => a.has_own_account).length}/${ulpAccounts.length} ULP`}
                </button>
              )}
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Otomasi Harian</div>
              <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1">
                {settings?.auto_enabled ? `Pukul ${settings?.auto_time} WIB` : 'Nonaktif'}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {settings?.auto_enabled ? 'Penjadwalan aktif' : 'Manual saja'}
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Total Riwayat</div>
              <div className="text-sm font-bold font-mono text-slate-800 dark:text-slate-200 mt-1">
                {runs.length} Sesi
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5">
                10 sesi penarikan terakhir
              </div>
            </div>

            <div className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs">
              <div className="text-[10px] text-slate-400 font-semibold uppercase">Sesi Terakhir</div>
              <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1">
                {lastRun ? (
                  <span className={lastRun.status === 'OK' ? 'text-emerald-600' : 'text-slate-700 dark:text-slate-300'}>
                    {STATUS[lastRun.status]?.[0] || lastRun.status}
                  </span>
                ) : (
                  'Belum ada'
                )}
              </div>
              <div className="text-[11px] text-slate-500 mt-0.5 truncate">
                {lastRun ? when(lastRun.created_at) : '-'}
              </div>
            </div>
          </div>

          {/* Banner Informasi Keamanan & Enkripsi */}
          <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-blue-50/70 dark:bg-blue-950/30 rounded-2xl border border-blue-200 dark:border-blue-900/60 shadow-xs">
            <div className="flex items-start gap-3">
              <IconShieldCheck size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <div className="space-y-0.5">
                <div className="font-bold text-sm text-blue-950 dark:text-blue-100 flex items-center gap-2">
                  <span>Koneksi Aman & Perlindungan Kredensial EIS</span>
                  {ready ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                      Tersimpan & Terenkripsi AES-256
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                      Kredensial Belum Lengkap
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-blue-700 dark:text-blue-300 max-w-3xl">
                  Password akun EIS dienkripsi AES-256 pada database server dan tidak pernah dikirim kembali ke browser. Token otorisasi API pekerja sinkronisasi bersifat sementara dan langsung dicabut seketika setelah proses selesai.
                </p>
              </div>
            </div>
            <Button type="button" variant="secondary" size="sm" onClick={() => setSettingsOpen(true)} className="cursor-pointer">
              Pengaturan
            </Button>
          </div>

          {!settingsOpen && error && <Alert kind="error">{error}</Alert>}
          {!settingsOpen && notice && <Alert kind="success">{notice}</Alert>}

          {/* Tab Navigasi bila mode tidak dikunci ('all' atau null) */}
          {!mode && (
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
              <button
                type="button"
                onClick={() => setActiveTab('permohonan')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'permohonan'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                Permohonan Pelanggan
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('piutang')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'piutang'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                Laporan Saldo Piutang
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('apkt')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'apkt'
                    ? 'bg-purple-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                SAIDI/SAIFI APKT (DIFI)
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ap2t')}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer ${
                  activeTab === 'ap2t'
                    ? 'bg-amber-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800'
                }`}
              >
                TAGSUS AP2T (kWh P2TL)
              </button>
            </div>
          )}

          <div className="space-y-6">
            {isPermohonan && (
              <section className="p-5 rounded-2xl border border-blue-200 dark:border-blue-900/80 bg-white dark:bg-slate-900 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                      Tarik Permohonan dari EIS Langsung
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Eksekusi penarikan data agenda penyambungan (PB/PD) secara online.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-300 border border-blue-200 dark:border-blue-900">
                    Online Pull
                  </span>
                </div>

                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">Cakupan Data yang Ditarik:</div>
                  <p>
                    Pelanggan baru diambil untuk <b>semua daya</b> dan <b>semua status</b> (Mohon, Disetujui, Bayar, Cetak PK, PDL Awal, Peremajaan, dan lainnya); tabel Permohonan tinggal disaring menurut status. Permohonan yang sudah ada di DISTRIVA hanya diperbarui <b>Hari Kerja</b> dan <b>Status Permohonan</b>.
                  </p>
                </div>

                {/* Filter Rentang Tanggal Mohon */}
                <div className="space-y-3 pt-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                    Rentang Tanggal Permohonan
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Dari tanggal (opsional)">
                      <input
                        aria-label="Dari tanggal"
                        type="date"
                        value={range.from}
                        onChange={(e) => setRange({ ...range, from: e.target.value })}
                        className={inputCls}
                      />
                    </Field>
                    <Field label="Sampai tanggal (opsional)">
                      <input
                        aria-label="Sampai tanggal"
                        type="date"
                        value={range.to}
                        onChange={(e) => setRange({ ...range, to: e.target.value })}
                        className={inputCls}
                      />
                    </Field>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Kosongkan tanggal untuk memakai rentang bawaan ({form.lookback_days} hari terakhir).
                  </p>
                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={completeOld}
                      onChange={(e) => setCompleteOld(e.target.checked)}
                      aria-label="Lengkapi permohonan lama"
                      className="mt-0.5 rounded text-blue-600"
                    />
                    <span className="text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">Lengkapi permohonan lama</span>
                      <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                        Setelah rentang di atas selesai, tarik juga rentang sebelumnya (paling jauh 180 hari) agar permohonan yang masih berjalan di DISTRIVA tetapi sudah selesai di EIS ikut diperbarui. Berlaku untuk semua unit dan menambah waktu proses. Sinkron otomatis tidak melakukannya.
                      </span>
                    </span>
                  </label>
                </div>

                {/* Pilih unit yang disinkronkan */}
                <SyncUnitPicker
                  units={units}
                  selected={selected}
                  onToggle={toggleUnit}
                  onSelectAll={() => setPicked(null)}
                  onClear={() => setPicked([])}
                  disabled={runningPermohonan}
                  up3Name={up3s.find((u) => u.id === up3Id)?.name || ''}
                  ulpAccounts={ulpAccounts}
                  tone="blue"
                  checkboxAriaPrefix="Sinkronkan"
                  hint="Unit dipilih di EIS satu per satu; tiap unit diunduh dan diunggah dulu sebelum lanjut ke unit berikutnya. Satu unit yang gagal tidak menghentikan yang lain."
                />

                {/* Tombol Eksekusi Penarikan Permohonan */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <Button
                    onClick={start}
                    loading={starting}
                    disabled={!ready || runningPermohonan || Boolean(range.from) !== Boolean(range.to) || (units.length > 0 && selected.length === 0)}
                    variant="primary"
                    size="md"
                    className="w-full sm:w-auto cursor-pointer"
                  >
                    <IconRefresh size={14} className={runningPermohonan ? 'animate-spin mr-1.5' : 'mr-1.5'} />
                    {runningPermohonan ? 'Sedang berjalan…' : 'Sinkronkan Sekarang'}
                  </Button>

                  {!ready && (
                    <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      Simpan user dan password EIS terlebih dulu.
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* KARTU: Tarik Laporan Piutang dari EIS */}
            {isPiutang && (
              <section className="p-5 rounded-2xl border border-emerald-200 dark:border-emerald-900/80 bg-white dark:bg-slate-900 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                      Tarik Laporan Piutang
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Tarik otomatis laporan saldo piutang bulanan (Per Golongan, Per Lembar, dan Kogol) langsung dari server EIS PLN.
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-900">
                    Laporan EIS
                  </span>
                </div>

                <div className="p-3 bg-emerald-50/50 dark:bg-emerald-950/20 rounded-xl border border-emerald-200/60 dark:border-emerald-900/40 text-[11px] text-emerald-800 dark:text-emerald-300 space-y-1">
                  <p>
                    Laporan saldo piutang diunduh dari EIS dan langsung masuk ke modul <b>Laporan Bulanan EIS</b> serta <b>Analisa &amp; Tren Pengusahaan</b>.
                  </p>
                </div>

                {piutangError && <Alert kind="error">{piutangError}</Alert>}

                {/* Filter Periode Bulan */}
                <div className="space-y-3 pt-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                    Periode Bulan Laporan
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field label="Bulan akhir (wajib)" hint="Bulan mutasi target laporan">
                      <input
                        aria-label="Bulan akhir piutang"
                        type="month"
                        value={piutangToMonth}
                        onChange={(e) => setPiutangToMonth(e.target.value)}
                        className={inputCls}
                        required
                      />
                    </Field>
                    <Field label="Bulan awal (opsional)" hint="Kosongkan untuk hanya menarik bulan akhir saja">
                      <input
                        aria-label="Bulan awal piutang"
                        type="month"
                        value={piutangFromMonth}
                        onChange={(e) => setPiutangFromMonth(e.target.value)}
                        className={inputCls}
                        placeholder={piutangToMonth}
                      />
                    </Field>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Bila bulan awal diisi, DISTRIVA akan menarik rentang bulan secara berurutan (paling banyak 24 bulan per sesi).
                  </p>
                </div>

                {/* Centang Laporan */}
                <div className="space-y-2 pt-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                    Laporan yang Ditarik
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    {[
                      { key: 'GOLONGAN', label: 'Per Golongan' },
                      { key: 'LEMBAR', label: 'Per Lembar' },
                      { key: 'KOGOL', label: 'Kogol' },
                      { key: 'PRABAYAR', label: 'Saldo Prabayar' },
                      { key: 'KONTROL309', label: 'Kontrol Penjualan 309' },
                    ].map((rep) => (
                      <label
                        key={rep.key}
                        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs cursor-pointer select-none transition ${
                          piutangReports.includes(rep.key)
                            ? 'border-emerald-300 bg-emerald-50/70 text-emerald-900 font-semibold dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-200'
                            : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={piutangReports.includes(rep.key)}
                          onChange={() => togglePiutangReport(rep.key)}
                          disabled={running}
                          aria-label={`Laporan ${rep.label}`}
                          className="rounded text-emerald-600 focus:ring-emerald-500"
                        />
                        <span>{rep.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Pilih unit yang disinkronkan untuk piutang (hanya bila kartu permohonan tidak tampil) */}
                {!isPermohonan && (
                  <SyncUnitPicker
                    units={units}
                    selected={selected}
                    onToggle={toggleUnit}
                    onSelectAll={() => setPicked(null)}
                    onClear={() => setPicked([])}
                    disabled={runningPiutang}
                    up3Name={up3s.find((u) => u.id === up3Id)?.name || ''}
                    ulpAccounts={ulpAccounts}
                    tone="emerald"
                    checkboxAriaPrefix="Sinkronkan"
                    hint="Unit dipilih di EIS satu per satu; tiap unit diunduh dan diunggah dulu sebelum lanjut ke unit berikutnya."
                  />
                )}

                {/* Info Unit terpilih bila kartu permohonan tampil bersamaan */}
                {isPermohonan && (
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Unit yang ditarik mengikuti pilihan di atas ({selected.length} dari {units.length} unit).
                  </p>
                )}

                {/* Tombol Eksekusi Penarikan Piutang */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <Button
                    onClick={startPiutang}
                    loading={piutangStarting}
                    disabled={!ready || runningPiutang || !piutangToMonth || piutangReports.length === 0 || (units.length > 0 && selected.length === 0)}
                    variant="primary"
                    size="md"
                    className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700 active:bg-emerald-800 text-white cursor-pointer"
                  >
                    <IconRefresh size={14} className={runningPiutang ? 'animate-spin mr-1.5' : 'mr-1.5'} />
                    {runningPiutang ? 'Sedang menarik piutang…' : 'Tarik Piutang'}
                  </Button>

                  {!ready && (
                    <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      Simpan user dan password EIS terlebih dulu.
                    </span>
                  )}
                </div>
              </section>
            )}

            {/* Kartu Penarikan SAIDI/SAIFI APKT (DIFI) & RPT/RCT */}
            {isApkt && (
              <section className="p-5 rounded-2xl border border-purple-200 dark:border-purple-900/80 bg-white dark:bg-slate-900 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                      {apktDataset === 'rpt-rct-gangguan'
                        ? 'Tarik RPT/RCT WO Gangguan APKT'
                        : apktDataset === 'rpt-rct-keluhan'
                        ? 'Tarik RPT/RCT WO Keluhan APKT'
                        : apktDataset === 'anomali-gangguan'
                        ? 'Tarik Anomali Gangguan APKT'
                        : apktDataset === 'anomali-keluhan'
                        ? 'Tarik Anomali Keluhan APKT'
                        : 'Tarik SAIDI/SAIFI APKT (DIFI)'}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {apktDataset === 'rpt-rct-gangguan'
                        ? 'Tarik durasi respons (RPT) dan pemulihan (RCT) WO gangguan langsung dari GraphQL APKT (tanpa & dengan clear temper).'
                        : apktDataset === 'rpt-rct-keluhan'
                        ? 'Tarik durasi respons (RPT) dan penyelesaian (RCT) WO keluhan pelanggan langsung dari GraphQL APKT (satuan jam).'
                        : apktDataset === 'anomali-gangguan'
                        ? 'Tarik penanganan anomali gangguan (berulang dan rating negatif) langsung dari GraphQL APKT.'
                        : apktDataset === 'anomali-keluhan'
                        ? 'Tarik penanganan anomali keluhan (berulang dan rating negatif) langsung dari GraphQL APKT.'
                        : 'Tarik Laporan SAIDI SAIFI SE004 bulanan langsung dari GraphQL APKT dan impor otomatis sebagai laporan DIFI ke DISTRIVA.'}
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-purple-50 text-purple-700 dark:bg-purple-950/50 dark:text-purple-300 border border-purple-200 dark:border-purple-900">
                    APKT GraphQL
                  </span>
                </div>

                {/* Pemilih Dataset APKT */}
                <div className="space-y-1.5">
                  <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                    Dataset APKT yang Ditarik
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => setApktDataset('saidi-saifi')}
                      disabled={running}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                        apktDataset === 'saidi-saifi'
                          ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      SAIDI/SAIFI SE004 (DIFI)
                    </button>
                    <button
                      type="button"
                      onClick={() => setApktDataset('rpt-rct-gangguan')}
                      disabled={running}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                        apktDataset === 'rpt-rct-gangguan'
                          ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      RPT/RCT WO Gangguan
                    </button>
                    <button
                      type="button"
                      onClick={() => setApktDataset('rpt-rct-keluhan')}
                      disabled={running}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                        apktDataset === 'rpt-rct-keluhan'
                          ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      RPT/RCT WO Keluhan
                    </button>
                    <button
                      type="button"
                      onClick={() => setApktDataset('anomali-gangguan')}
                      disabled={running}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                        apktDataset === 'anomali-gangguan'
                          ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      Anomali Gangguan (Berulang & Rating Negatif)
                    </button>
                    <button
                      type="button"
                      onClick={() => setApktDataset('anomali-keluhan')}
                      disabled={running}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold border transition cursor-pointer ${
                        apktDataset === 'anomali-keluhan'
                          ? 'bg-purple-600 text-white border-purple-600 shadow-xs'
                          : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      Anomali Keluhan (Berulang & Rating Negatif)
                    </button>
                  </div>
                </div>

                {apktError && <Alert kind="error">{apktError}</Alert>}

                {/* Petunjuk Pengambilan Token APKT */}
                <div className="p-3.5 bg-purple-50/60 dark:bg-purple-950/30 rounded-xl border border-purple-200/80 dark:border-purple-800/60 text-[11px] text-purple-950 dark:text-purple-200 space-y-2">
                  <div className="font-bold flex items-center gap-1.5 text-purple-900 dark:text-purple-100">
                    <span>Petunjuk Mengambil Token APKT:</span>
                  </div>
                  <ol className="list-decimal list-inside space-y-1 text-slate-700 dark:text-slate-300">
                    <li>Buka aplikasi APKT di peramban dan pastikan sudah dalam keadaan masuk (login).</li>
                    <li>Masuk ke menu <span className="font-semibold">Saidi Saifi &gt; Laporan Saidi Saifi &gt; Laporan SAIDI SAIFI SE004</span>.</li>
                    <li>Buka <b>Developer Tools</b> peramban (<kbd className="px-1.5 py-0.5 rounded bg-slate-200 dark:bg-slate-800 font-mono text-[10px]">F12</kbd> atau klik kanan &gt; Inspeksi), lalu pilih tab <b>Network</b>.</li>
                    <li>Klik salah satu permintaan <span className="font-mono font-semibold">graphql</span>, buka bagian <b>Request Headers</b>, dan salin seluruh nilai <span className="font-mono font-semibold">authorization</span> (dengan atau tanpa kata &quot;Bearer&quot;).</li>
                    <li>Tempelkan nilai tersebut ke kolom <b>Token APKT</b> di bawah.</li>
                  </ol>
                  <div className="text-[10px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 p-2 rounded-lg border border-amber-200 dark:border-amber-900/40">
                    ⚠️ <b>Penting:</b> Jangan menutup atau me-logout sesi APKT selama penarikan berjalan. Token hanya dipakai selama proses penarikan di server dan tidak pernah disimpan secara permanen di database maupun di browser.
                  </div>
                </div>

                {/* Opsi Penggunaan Token APKT Tersimpan / Tempel Token Baru */}
                {savedTokenInfo.saved && (
                  <div className="p-3.5 rounded-xl border border-purple-200 dark:border-purple-800 bg-purple-50/40 dark:bg-purple-950/20 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={useSavedToken}
                          onChange={(e) => setUseSavedToken(e.target.checked)}
                          disabled={running}
                          aria-label="Gunakan token APKT tersimpan"
                          className="mt-0.5 rounded text-purple-600 focus:ring-purple-500"
                        />
                        <div className="space-y-0.5">
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            Gunakan Token APKT Tersimpan
                          </span>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400">
                            Tersimpan terenkripsi untuk akun Anda (disimpan {when(savedTokenInfo.saved_at)}).
                            {savedTokenInfo.last_result === 'REJECTED' && (
                              <span className="block text-rose-600 dark:text-rose-400 font-semibold mt-0.5">
                                ⚠️ Terakhir ditolak oleh APKT (sesi mungkin sudah kedaluwarsa). Silakan tempel token baru.
                              </span>
                            )}
                            {savedTokenInfo.last_result === 'OK' && (
                              <span className="block text-emerald-600 dark:text-emerald-400 font-semibold mt-0.5">
                                ✓ Terakhir berhasil digunakan {when(savedTokenInfo.last_used_at)}.
                              </span>
                            )}
                          </p>
                        </div>
                      </label>
                      <button
                        type="button"
                        onClick={handleDeleteSavedApktToken}
                        disabled={running || deletingToken}
                        className="text-[11px] font-semibold text-rose-600 hover:text-rose-700 dark:text-rose-400 hover:underline shrink-0 cursor-pointer"
                      >
                        {deletingToken ? 'Menghapus…' : 'Hapus Token'}
                      </button>
                    </div>
                  </div>
                )}

                {/* Form Input APKT */}
                <div className="space-y-3 pt-1">
                  {!useSavedToken && (
                    <div className="space-y-2">
                      <Field
                        label="Token APKT (Wajib)"
                        hint="Tempel nilai header Authorization dari permintaan GraphQL di APKT. Kolom ini langsung dikosongkan setelah pengiriman."
                      >
                        <input
                          aria-label="Token APKT"
                          type="password"
                          autoComplete="off"
                          value={apktToken}
                          onChange={(e) => setApktToken(e.target.value)}
                          placeholder="Tempel nilai token / header Authorization APKT di sini..."
                          className={inputCls}
                          disabled={running}
                        />
                      </Field>

                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input
                          type="checkbox"
                          checked={saveApktToken}
                          onChange={(e) => setSaveApktToken(e.target.checked)}
                          disabled={running}
                          aria-label="Simpan token APKT untuk penarikan berikutnya"
                          className="rounded text-purple-600 focus:ring-purple-500"
                        />
                        <span className="text-[11px] font-medium text-slate-700 dark:text-slate-300">
                          Simpan token ini (terenkripsi untuk akun Anda) agar tidak perlu menempel ulang setiap penarikan
                        </span>
                      </label>
                    </div>
                  )}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field
                      label="Bulan akhir (wajib)"
                      hint="Bulan terakhir laporan yang ditarik (format YYYY-MM)."
                    >
                      <input
                        aria-label="Bulan akhir APKT"
                        type="month"
                        value={apktToMonth}
                        onChange={(e) => setApktToMonth(e.target.value)}
                        className={inputCls}
                        disabled={running}
                      />
                    </Field>

                    <Field
                      label="Bulan awal (opsional)"
                      hint="Kosongkan bila hanya ingin menarik satu bulan (bulan akhir)."
                    >
                      <input
                        aria-label="Bulan awal APKT"
                        type="month"
                        value={apktFromMonth}
                        onChange={(e) => setApktFromMonth(e.target.value)}
                        className={inputCls}
                        disabled={running}
                      />
                    </Field>
                  </div>

                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    💡 Paling banyak <b>24 bulan</b> per penarikan. Untuk rentang panjang (mis. beberapa tahun), disarankan memecah penarikan per tahun agar proses lebih cepat dan terhindar dari batas waktu sesi APKT.
                  </p>
                </div>

                {/* Pilih unit ULP yang ditarik */}
                <SyncUnitPicker
                  units={units}
                  selected={selected}
                  onToggle={toggleUnit}
                  onSelectAll={() => setPicked(null)}
                  onClear={() => setPicked([])}
                  disabled={runningApkt}
                  up3Name={up3s.find((u) => u.id === up3Id)?.name || ''}
                  tone="purple"
                  checkboxAriaPrefix="Tarik APKT"
                />

                {/* Tombol Eksekusi Penarikan APKT */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <Button
                    onClick={startApkt}
                    loading={apktStarting}
                    disabled={
                      !canApktSync ||
                      runningApkt ||
                      (!useSavedToken && !apktToken.trim()) ||
                      !apktToMonth ||
                      (units.length > 0 && selected.length === 0)
                    }
                    variant="primary"
                    size="md"
                    className="w-full sm:w-auto bg-purple-600 hover:bg-purple-700 active:bg-purple-800 text-white cursor-pointer"
                  >
                    <IconRefresh size={14} className={runningApkt ? 'animate-spin mr-1.5' : 'mr-1.5'} />
                    {runningApkt
                      ? apktDataset === 'rpt-rct-gangguan'
                        ? 'Sedang menarik RPT/RCT Gangguan…'
                        : apktDataset === 'rpt-rct-keluhan'
                        ? 'Sedang menarik RPT/RCT Keluhan…'
                        : apktDataset === 'anomali-gangguan'
                        ? 'Sedang menarik Anomali Gangguan…'
                        : apktDataset === 'anomali-keluhan'
                        ? 'Sedang menarik Anomali Keluhan…'
                        : 'Sedang menarik SAIDI/SAIFI APKT…'
                      : apktDataset === 'rpt-rct-gangguan'
                      ? 'Tarik RPT/RCT Gangguan'
                      : apktDataset === 'rpt-rct-keluhan'
                      ? 'Tarik RPT/RCT Keluhan'
                      : apktDataset === 'anomali-gangguan'
                      ? 'Tarik Anomali Gangguan'
                      : apktDataset === 'anomali-keluhan'
                      ? 'Tarik Anomali Keluhan'
                      : 'Tarik SAIDI/SAIFI APKT'}
                  </Button>

                  {!canApktSync && (
                    <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      Anda membutuhkan izin eis_sync.manage dan eis_reports.import untuk menjalankan penarikan ini.
                    </span>
                  )}
                </div>
              </section>
            )}

            {isAp2t && (
              <section className="p-5 rounded-2xl border border-amber-200 dark:border-amber-900/80 bg-white dark:bg-slate-900 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <div>
                    <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                      {isAp2tBpMode ? 'Tarik Rekap Laporan BP (AP2T)' : isAp2tPrrMode ? 'Tarik Laporan Pelunasan PRR (AP2T)' : 'Tarik TAGSUS AP2T (kWh P2TL)'}
                    </h3>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      {isAp2tBpMode
                        ? 'Tarik rekap laporan biaya penyambungan (penerimaan, restitusi, peremajaan) per ULP langsung dari AP2T tanpa login.'
                        : isAp2tPrrMode
                        ? 'Tarik laporan pelunasan piutang ragu-ragu dan ex-PRR per ULP langsung dari AP2T tanpa token.'
                        : 'Tarik laporan realisasi pendapatan penetapan tagihan susulan (TAGSUS) P2TL per ULP langsung dari AP2T tanpa token.'}
                    </p>
                  </div>
                  <span className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-900">
                    AP2T Server
                  </span>
                </div>

                {ap2tError && <Alert kind="error">{ap2tError}</Alert>}

                <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-800 text-[11px] text-slate-600 dark:text-slate-400 space-y-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-200">Cakupan Laporan AP2T:</div>
                  <p>
                    Laporan yang ditarik adalah <b>Daftar Realisasi Pendapatan Penetapan Tagihan Susulan (TAGSUS)</b>, <b>Daftar Tagihan Susulan Belum Realisasi</b>, <b>Pelunasan PRR</b>, <b>Pelunasan Ex PRR</b>, <b>Saldo PRR (Daftar PRR)</b>, <b>Penghapusan PRR</b>, dan/atau <b>Rekap BP</b> per ULP per bulan. Berkas masuk otomatis ke repositori laporan DISTRIVA secara idempoten (tanpa memerlukan token otorisasi AP2T).
                  </p>
                </div>

                {/* Centang Laporan AP2T */}
                <div className="space-y-2 pt-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                    Laporan yang Ditarik
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    {[
                      { key: 'realisasi', label: 'Realisasi' },
                      { key: 'belum_realisasi', label: 'Belum realisasi' },
                      { key: 'pelunasan_prr', label: 'Pelunasan PRR' },
                      { key: 'pelunasan_ex_prr', label: 'Pelunasan Ex PRR' },
                      { key: 'saldo_prr', label: 'Saldo PRR (Daftar PRR)' },
                      { key: 'hapus_prr', label: 'Penghapusan PRR' },
                      { key: 'bp', label: 'Rekap BP' },
                    ].map((rep) => (
                      <label
                        key={rep.key}
                        className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs cursor-pointer select-none transition ${
                          ap2tReports.includes(rep.key)
                            ? 'border-amber-300 bg-amber-50/70 text-amber-900 font-semibold dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-200'
                            : 'border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={ap2tReports.includes(rep.key)}
                          onChange={() => toggleAp2tReport(rep.key)}
                          disabled={running}
                          aria-label={`Laporan ${rep.label}`}
                          className="rounded text-amber-600 focus:ring-amber-500"
                        />
                        <span>{rep.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Filter Rentang Bulan AP2T */}
                <div className="space-y-3 pt-1">
                  <div className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                    Rentang Bulan Laporan AP2T
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <Field
                      label="Bulan akhir (wajib)"
                      hint="Bulan terakhir laporan yang ditarik (format YYYY-MM)."
                    >
                      <input
                        aria-label="Bulan akhir AP2T"
                        type="month"
                        value={ap2tToMonth}
                        onChange={(e) => setAp2tToMonth(e.target.value)}
                        className={inputCls}
                        disabled={running}
                      />
                    </Field>

                    <Field
                      label="Bulan awal (opsional)"
                      hint="Kosongkan bila hanya ingin menarik satu bulan (bulan akhir)."
                    >
                      <input
                        aria-label="Bulan awal AP2T"
                        type="month"
                        value={ap2tFromMonth}
                        onChange={(e) => setAp2tFromMonth(e.target.value)}
                        className={inputCls}
                        disabled={running}
                        placeholder={ap2tToMonth}
                      />
                    </Field>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Bila bulan awal diisi, DISTRIVA akan menarik rentang bulan secara berurutan (paling banyak 24 bulan per sesi).
                  </p>
                </div>

                {/* Pilih unit yang disinkronkan untuk AP2T */}
                <SyncUnitPicker
                  units={units}
                  selected={selected}
                  onToggle={toggleUnit}
                  onSelectAll={() => setPicked(null)}
                  onClear={() => setPicked([])}
                  disabled={runningAp2t}
                  up3Name={up3s.find((u) => u.id === up3Id)?.name || ''}
                  tone="amber"
                  checkboxAriaPrefix="Tarik AP2T"
                />

                {/* Tombol Eksekusi Penarikan AP2T */}
                <div className="pt-2 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                  <Button
                    onClick={startAp2t}
                    loading={ap2tStarting}
                    disabled={
                      !canApktSync ||
                      runningAp2t ||
                      !ap2tToMonth ||
                      ap2tReports.length === 0 ||
                      (units.length > 0 && selected.length === 0)
                    }
                    variant="primary"
                    size="md"
                    className="w-full sm:w-auto bg-amber-600 hover:bg-amber-700 active:bg-amber-800 text-white cursor-pointer"
                  >
                    <IconRefresh size={14} className={runningAp2t ? 'animate-spin mr-1.5' : 'mr-1.5'} />
                    {runningAp2t
                      ? (isAp2tBpMode ? 'Sedang menarik Rekap BP…' : isAp2tPrrMode ? 'Sedang menarik Pelunasan PRR…' : 'Sedang menarik TAGSUS AP2T…')
                      : (isAp2tBpMode ? 'Tarik Rekap BP' : isAp2tPrrMode ? 'Tarik Pelunasan PRR' : 'Tarik TAGSUS AP2T')}
                  </Button>

                  {!canApktSync && (
                    <span className="text-[11px] font-medium text-amber-600 dark:text-amber-400">
                      Anda membutuhkan izin eis_sync.manage dan eis_reports.import untuk menjalankan penarikan ini.
                    </span>
                  )}
                </div>
              </section>
            )}
            {current && <SyncRunMetaBadges run={current} />}
            {batchRuns.length > 1 && (
              <div className="rounded-xl border border-indigo-200 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/20 p-3.5 space-y-2">
                <div className="font-bold text-xs text-indigo-900 dark:text-indigo-200">
                  Progres Multi-Akun ({batchRuns.length} run)
                </div>
                <div className="space-y-1.5">
                  {batchRuns.map((r) => (
                    <div key={r.id} className="rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 px-3 py-2">
                      <SyncRunMetaBadges run={r} />
                    </div>
                  ))}
                </div>
              </div>
            )}
            <EisRunResults run={current} units={units} />
          </div>

          <Modal open={settingsOpen} onClose={() => setSettingsOpen(false)} title="Pengaturan Sinkronisasi EIS" subtitle="Akun EIS, rentang daya, dan jadwal otomatis" size="max-w-3xl" width="max-w-3xl">
            <div className="space-y-5 text-xs">
              {error && <Alert kind="error">{error}</Alert>}
              {notice && <Alert kind="success">{notice}</Alert>}
              {/* KARTU 1: Akun & Parameter Rentang EIS */}
              <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    Akun & rentang EIS
                  </h4>
                  <span className="text-[11px] text-slate-400">Parameter Koneksi</span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                  <Field label="User EIS">
                    <input
                      aria-label="User EIS"
                      autoComplete="off"
                      value={form.eis_username}
                      onChange={set('eis_username')}
                      placeholder="e.g. petugas.eis"
                      className={inputCls}
                    />
                  </Field>

                  <Field
                    label="Password EIS"
                    hint={
                      settings?.has_password
                        ? 'Tersimpan terenkripsi; kosongkan untuk tetap memakainya.'
                        : 'Disimpan terenkripsi dan tidak pernah ditampilkan lagi.'
                    }
                  >
                    <div className="relative">
                      <input
                        aria-label="Password EIS"
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        value={form.eis_password}
                        onChange={set('eis_password')}
                        placeholder={settings?.has_password ? '••••••••' : 'Masukkan password EIS'}
                        className={`${inputCls} pr-9`}
                      />
                      <button
                        type="button"
                        aria-label={showPassword ? 'Sembunyikan password' : 'Tampilkan password'}
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                      >
                        {showPassword ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                      </button>
                    </div>
                  </Field>

                  <Field label="Daya minimum (VA)">
                    <input
                      aria-label="Daya minimum"
                      type="number"
                      min="0"
                      value={form.power_min}
                      onChange={set('power_min')}
                      className={inputCls}
                    />
                  </Field>

                  <Field label="Daya maksimum (VA)" hint="0 – 99.999.999 = semua daya.">
                    <input
                      aria-label="Daya maksimum"
                      type="number"
                      min="0"
                      value={form.power_max}
                      onChange={set('power_max')}
                      className={inputCls}
                    />
                  </Field>

                  <div className="sm:col-span-2">
                    <Field
                      label="Tarik mundur (hari)"
                      hint="Rentang Tanggal Mohon = hari ini dikurangi jumlah hari ini."
                    >
                      <input
                        aria-label="Tarik mundur"
                        type="number"
                        min="1"
                        max="730"
                        value={form.lookback_days}
                        onChange={set('lookback_days')}
                        className={inputCls}
                      />
                    </Field>
                  </div>
                </div>
              </section>

              {/* KARTU 1B: Akun Khusus per ULP (docs/94 §7) */}
              <SyncUlpAccountsPanel source="eis" up3Id={up3Id} title="Akun EIS Khusus per ULP" />

              {/* KARTU 2: Sinkronisasi Otomatis Harian */}
              <section className="p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
                <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
                  <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    Sinkronisasi otomatis
                  </h4>
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      form.auto_enabled
                        ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                        : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                    }`}
                  >
                    {form.auto_enabled ? 'Aktif' : 'Nonaktif'}
                  </span>
                </div>

                <div className="space-y-3">
                  <label className="flex items-start gap-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.auto_enabled}
                      onChange={set('auto_enabled')}
                      aria-label="Jalankan otomatis setiap hari"
                      className="mt-0.5 rounded text-blue-600"
                    />
                    <div className="space-y-0.5">
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        Jalankan otomatis setiap hari
                      </span>
                      <p className="text-[11px] text-slate-500 dark:text-slate-400">
                        Sistem melakukan penarikan otomatis agenda PB/PD secara berkala di latar belakang.
                      </p>
                    </div>
                  </label>

                  <Field
                    label="Jam (WIB)"
                    hint="Berjalan atas nama akun yang menyimpan pengaturan ini; butuh penjadwal server (`schedule:run`) aktif."
                  >
                    <input
                      aria-label="Jam sinkronisasi otomatis"
                      type="time"
                      value={form.auto_time}
                      onChange={set('auto_time')}
                      className={`${inputCls} max-w-44 font-mono font-bold`}
                    />
                  </Field>
                </div>

                <div className="pt-2 flex justify-end">
                  <Button onClick={save} loading={saving} variant="primary" size="md">
                    <IconCheck size={14} className="mr-1.5" />
                    Simpan Pengaturan
                  </Button>
                </div>
              </section>
            </div>
          </Modal>
        </div>
      )}

    </PanelShell>
  )
}
