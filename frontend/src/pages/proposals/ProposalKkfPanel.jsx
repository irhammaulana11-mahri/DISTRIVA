import { useState, useEffect, useCallback } from 'react'
import { proposalsApi, kkfRunsApi, drawingApi, mtoApi, rabRunsApi, kkoApi, applicationApi } from '../../services/api.js'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import OutputDocumentModal from '../../components/OutputDocumentModal.jsx'
import RabDryRunModal from '../mto/RabDryRunModal.jsx'
import { buildKkoDocument } from '../../utils/kkoDocumentBuilder.js'
import {
  IconCalculator,
  IconCheck,
  IconCheckCircle,
  IconExclamation,
  IconRefresh,
  IconEye,
  IconClock,
  IconLock,
  IconFileText,
  IconChevronDown,
  IconChevronRight,
  IconZap,
  IconDocument,
  IconUsers,
  IconLayers,
  IconAlertCircle,
} from '../../components/icons.jsx'
import {
  formatRupiah,
  formatNumber,
  formatPercentNumber,
  formatPercentDisplay,
  formatRupiahPerKwh,
} from '../../utils/kkfFormatters.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'

/**
 * ProposalKkfPanel (docs/62 §37, docs/76 & docs/57)
 * Panel KKF Khusus Usulan Banyak Pelanggan:
 * - Menghitung kelayakan investasi agregat untuk seluruh pelanggan dalam usulan
 * - Menggunakan rumus rata-rata tertimbang daya (jam nyala) dan tertimbang energi (harga jual rata-rata)
 * - Rincian individual per anggota dari sources.members[]
 * - Input previous_meter_payment per anggota bila diperlukan (409)
 */
/** Hijau bila memenuhi target, merah bila tidak; abu-abu biasa bila target tidak diketahui (run lama). */
const targetTone = (ok) => (ok === null ? 'text-slate-700 dark:text-slate-300' : ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400')

export default function ProposalKkfPanel({
  proposal,
  canRun = false,
  canRunRab = canRun,
  lockedReason = '',
  canView = true,
}) {
  const { notify } = useNotifications()

  // Form State
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [estheticFee, setEstheticFee] = useState('')
  const [loadFactor, setLoadFactor] = useState('')   // kosong = ikut set parameter
  const [memberMeterModes, setMemberMeterModes] = useState({}) // { [applicationId]: 'PRABAYAR' | 'PASCABAYAR' }

  // Calculation & Storing State
  const [calculating, setCalculating] = useState(false)
  const [storing, setStoring] = useState(false)
  const [error, setError] = useState('')
  const [calcResult, setCalcResult] = useState(null)

  // Stored Runs History State
  const [runs, setRuns] = useState([])
  const [loadingRuns, setLoadingRuns] = useState(true)
  const [runsError, setRunsError] = useState('')

  // Document Viewer Modal State
  const [docModalOpen, setDocModalOpen] = useState(false)
  const [selectedRunId, setSelectedRunId] = useState(null)
  const [docType, setDocType] = useState('kkf') // 'kkf' | 'hpe' | 'rekap' | 'rinci' | 'kko'
  const [docCategory, setDocCategory] = useState('kkf') // 'kkf' | 'rab' | 'kko'
  const [docTitle, setDocTitle] = useState('')
  const [customDoc, setCustomDoc] = useState(null)

  // Representative App & RAB State
  const [loadingRab, setLoadingRab] = useState(false)
  const [rabPreview, setRabPreview] = useState(null)
  const [repApplication, setRepApplication] = useState(null)
  const [drawing, setDrawing] = useState(null)
  const [mtoPackage, setMtoPackage] = useState(null)
  const [rabRuns, setRabRuns] = useState([])
  const [kkoData, setKkoData] = useState(null)
  const [dryRunningRab, setDryRunningRab] = useState(false)
  const [runningRab, setRunningRab] = useState(false)
  const [dryRunModalOpen, setDryRunModalOpen] = useState(false)
  const [dryRunData, setDryRunData] = useState(null)
  const [rabError, setRabError] = useState('')

  const repAppId = proposal?.representative_application_id

  // Load RAB, KKF Preview & KKO from Representative Application
  const loadRabAndPreview = useCallback(async () => {
    if (!repAppId) return
    setLoadingRab(true)
    setRabError('')
    try {
      if (typeof kkfRunsApi?.preview === 'function') {
        const prevRes = await kkfRunsApi.preview(repAppId, { date })
        setRabPreview(prevRes?.data || null)
      }
    } catch {
      // preview error ignored
    }

    try {
      if (typeof applicationApi?.get === 'function') {
        const appRes = await applicationApi.get(repAppId)
        setRepApplication(appRes?.data || null)
      }
    } catch {
      // ignore
    }

    try {
      if (typeof kkoApi?.get === 'function') {
        const kkoRes = await kkoApi.get(repAppId)
        setKkoData(kkoRes?.data || null)
      }
    } catch {
      // ignore
    }

    try {
      if (typeof drawingApi?.forApplication === 'function') {
        const drwRes = await drawingApi.forApplication(repAppId)
        if (drwRes?.data?.id) {
          setDrawing(drwRes.data)
          const latestVer = drwRes.data.versions?.[0]
          if (latestVer?.id && typeof mtoApi?.forVersion === 'function') {
            const mtoRes = await mtoApi.forVersion(drwRes.data.id, latestVer.id)
            const mtoData = mtoRes?.data || null
            setMtoPackage(mtoData)
            if (mtoData?.id && typeof rabRunsApi?.listForPackage === 'function') {
              const runsRes = await rabRunsApi.listForPackage(mtoData.id)
              setRabRuns(runsRes?.data || [])
            }
          }
        }
      }
    } catch {
      // ignore
    } finally {
      setLoadingRab(false)
    }
  }, [repAppId, date])

  useEffect(() => {
    loadRabAndPreview()
  }, [loadRabAndPreview])

  // Handle RAB Dry Run
  const handleDryRunRab = async () => {
    if (!mtoPackage?.id) return
    setDryRunningRab(true)
    setRabError('')
    try {
      const res = await rabRunsApi.run(mtoPackage.id, {
        dry_run: true,
        date: date || undefined,
      })
      setDryRunData(res?.data || null)
      setDryRunModalOpen(true)
    } catch (err) {
      setRabError(err?.response?.data?.message || err?.message || 'Gagal menghitung simulasi RAB.')
    } finally {
      setDryRunningRab(false)
    }
  }

  // Handle Save Run RAB Resmi
  const handleRunRab = async () => {
    if (!mtoPackage?.id) return
    setRunningRab(true)
    setRabError('')
    try {
      const res = await rabRunsApi.run(mtoPackage.id, {
        dry_run: false,
        date: date || undefined,
      })
      setDryRunModalOpen(false)
      notify({
        type: 'success',
        title: 'Run RAB Berhasil Disimpan',
        desc: `Kalkulasi RAB Run #${res?.data?.run_number || ''} sebesar ${formatRupiah(res?.data?.grand_total || 0)} berhasil disimpan.`,
        tag: 'RAB',
      })
      await loadRabAndPreview()
    } catch (err) {
      setRabError(err?.response?.data?.message || err?.message || 'Gagal menyimpan run RAB.')
    } finally {
      setRunningRab(false)
    }
  }

  // Load KKF Runs History
  const loadRuns = useCallback(async () => {
    if (!proposal?.id) return
    setLoadingRuns(true)
    setRunsError('')
    try {
      const res = await proposalsApi.kkfRuns(proposal.id)
      setRuns(res?.data || [])
    } catch (err) {
      setRunsError(err?.response?.data?.message || err?.message || 'Gagal memuat riwayat run KKF usulan.')
    } finally {
      setLoadingRuns(false)
    }
  }, [proposal?.id])

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  // Build Payload
  const buildPayload = (isDryRun = false) => {
    const membersPayload = (proposal?.members || []).map((m) => {
      const prevMode = memberMeterModes[m.application_id] || undefined
      return {
        application_id: m.application_id,
        ...(prevMode ? { previous_meter_payment: prevMode } : {}),
      }
    })

    return {
      date: date || undefined,
      esthetic_fee: estheticFee ? Number(estheticFee) : 0,
      load_factor: loadFactor !== '' ? Number(loadFactor) : undefined,
      dry_run: isDryRun,
      members: membersPayload.length > 0 ? membersPayload : undefined,
    }
  }

  // Handle Calculate (Dry Run)
  const handleCalculate = async () => {
    if (!proposal?.id) return
    setCalculating(true)
    setError('')
    try {
      const payload = buildPayload(true)
      const res = await proposalsApi.runKkf(proposal.id, payload)
      const data = res?.data || null
      setCalcResult(data)
      notify({
        type: 'info',
        title: 'Perhitungan KKF Usulan Selesai',
        desc: 'Hasil kalkulasi kelayakan gabungan ditampilkan tanpa menyimpan ke riwayat.',
        tag: 'KKF Usulan',
      })
    } catch (err) {
      // 409 / 422 ditampilkan apa adanya
      setError(err?.response?.data?.message || err?.message || 'Gagal melakukan perhitungan KKF usulan.')
    } finally {
      setCalculating(false)
    }
  }

  // Handle Save Run
  const handleSaveRun = async () => {
    if (!proposal?.id) return
    setStoring(true)
    setError('')
    try {
      const payload = buildPayload(false)
      const res = await proposalsApi.runKkf(proposal.id, payload)
      const data = res?.data || null
      setCalcResult(data)
      notify({
        type: 'success',
        title: 'Run KKF Usulan Disimpan',
        desc: `Kajian kelayakan finansial usulan berhasil disimpan secara permanen.`,
        tag: 'KKF Usulan',
      })
      await loadRuns()
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Gagal menyimpan run KKF usulan.')
    } finally {
      setStoring(false)
    }
  }

  // Open Document Modal
  const openDocument = (runId, type, category = 'kkf', title = '', docData = null) => {
    setSelectedRunId(runId)
    setDocType(type)
    setDocCategory(category)
    setDocTitle(title)
    setCustomDoc(docData)
    setDocModalOpen(true)
  }

  // Handle Open KKO Document Modal
  const handleOpenKkoDoc = async (run = null) => {
    let currentKko = kkoData
    if (!currentKko && repAppId && typeof kkoApi?.get === 'function') {
      try {
        const res = await kkoApi.get(repAppId)
        currentKko = res?.data || null
        setKkoData(currentKko)
      } catch (err) {
        notify({
          type: 'danger',
          title: 'Gagal Memuat KKO',
          desc: err?.message || 'Data KKO tidak dapat diakses.',
          tag: 'KKO',
        })
        return
      }
    }

    if (!currentKko?.record) {
      notify({
        type: 'warning',
        title: 'KKO Belum Dicatat',
        desc: 'Hasil survei KKO belum tersimpan pada permohonan utama ini.',
        tag: 'KKO',
      })
      return
    }

    // Pastikan data permohonan utama termuat untuk data pelanggan lengkap (lokasi, ULP, tarif, daya)
    let currentApp = repApplication
    if (!currentApp && repAppId && typeof applicationApi?.get === 'function') {
      try {
        const appRes = await applicationApi.get(repAppId)
        currentApp = appRes?.data || null
        setRepApplication(currentApp)
      } catch {
        // ignore
      }
    }

    // Pastikan data gambar usulan dan MTO termuat untuk rencana jaringan
    let currentMto = mtoPackage
    let currentDrw = drawing
    if (!currentMto && repAppId && typeof drawingApi?.forApplication === 'function') {
      try {
        const drwRes = await drawingApi.forApplication(repAppId)
        if (drwRes?.data?.id) {
          currentDrw = drwRes.data
          setDrawing(currentDrw)
          const latestVer = drwRes.data.versions?.[0]
          if (latestVer?.id && typeof mtoApi?.forVersion === 'function') {
            const mtoRes = await mtoApi.forVersion(drwRes.data.id, latestVer.id)
            currentMto = mtoRes?.data || null
            setMtoPackage(currentMto)
          }
        }
      } catch {
        // ignore
      }
    }

    const doc = buildKkoDocument({
      kko: currentKko,
      application: currentApp || repApplication,
      proposal,
      run,
      mtoPackage: currentMto || mtoPackage,
      drawing: currentDrw || drawing,
    })

    openDocument(
      repAppId,
      'kko',
      'kko',
      'Kajian Kelayakan Operasi (KKO)',
      doc
    )
  }

  const isProposalOpen = proposal?.status === 'OPEN'
  const members = proposal?.members || []
  const hasMembers = members.length > 0

  const isBlockedByRab = Boolean(
    rabPreview?.blockers?.some((b) => b.toLowerCase().includes('rab')) ||
    (rabPreview && !rabPreview.rab_run && (!rabRuns || rabRuns.length === 0))
  )
  const hasRabRun = Boolean(
    !isBlockedByRab &&
    (rabPreview?.rab_run || (rabRuns && rabRuns.length > 0) || (calcResult?.sources?.rab_run_id) || rabPreview === null)
  )
  const isKkfReady = Boolean(hasRabRun && isProposalOpen && hasMembers)
  const activeRabNumber =
    calcResult?.sources?.rab_run_number ||
    rabPreview?.rab_run?.run_number ||
    rabRuns[0]?.run_number ||
    null
  const blockerMsg =
    error ||
    rabPreview?.blockers?.[0] ||
    'Permohonan belum memiliki run RAB'

  // Syarat tiap tombol (status + data); peran diperiksa terpisah lewat canRunRab / canRun. Alasan yang belum terpenuhi ditampilkan dan jadi tooltip.
  const otherBlockers = (rabPreview?.blockers || []).filter((b) => !b.toLowerCase().includes('rab'))
  const rabBlockReason = !isProposalOpen
    ? 'Usulan sudah dibatalkan.'
    : lockedReason
      ? lockedReason
      : !mtoPackage
      ? 'Paket MTO belum dibuat pada gambar usulan.'
      : mtoPackage.status !== 'APPROVED'
        ? `MTO berstatus ${mtoPackage.status}; RAB dapat dihitung setelah Manager ULP menyetujui gambar beserta MTO.`
        : null
  const kkfBlockReason = !isProposalOpen
    ? 'Usulan sudah dibatalkan.'
    : lockedReason
      ? lockedReason
      : !hasMembers
      ? 'Usulan belum memiliki pelanggan anggota.'
      : !hasRabRun
        ? 'Belum ada run RAB tersimpan; hitung dan simpan RAB lebih dulu.'
        : otherBlockers[0] || null
  const activeReasons = [canRunRab ? rabBlockReason : null, canRun ? kkfBlockReason : null].filter(Boolean)

  return (
    <div className="space-y-6 text-xs">
      {/* Configuration & Action Card */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                <IconCalculator size={15} className="text-blue-600 dark:text-blue-400" />
                <span>Simulasi &amp; Hitung KKF Usulan Kelompok</span>
              </h4>

              {/* Status Notification Badge replacing body Alert (User Request Gambar 3) */}
              {hasRabRun ? (
                <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  <span>RAB Siap {activeRabNumber ? `(Run #${activeRabNumber})` : '(Tersimpan)'}</span>
                </span>
              ) : (
                <span
                  className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-300 dark:border-rose-800"
                  title={blockerMsg}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-500 animate-pulse"></span>
                  <span>{blockerMsg}</span>
                </span>
              )}
            </div>
            <p className="text-[11px] text-slate-500 mt-0.5">
              Kajian Finansial Gabungan ({members.length} Pelanggan 3 Fasa) · Investasi mengacu pada run RAB Pelanggan Utama
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Action RAB Pelanggan Utama */}
            {canRunRab && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={dryRunningRab}
                  disabled={Boolean(rabBlockReason) || dryRunningRab || runningRab}
                  onClick={handleDryRunRab}
                  title={rabBlockReason || 'Simulasi kalkulasi RAB (tidak disimpan)'}
                  className="inline-flex items-center gap-1"
                >
                  <IconCalculator size={13} />
                  <span>Hitung RAB (Dry Run)</span>
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={runningRab}
                  disabled={Boolean(rabBlockReason) || dryRunningRab || runningRab}
                  onClick={handleRunRab}
                  title={rabBlockReason || 'Simpan kalkulasi Run RAB resmi'}
                  className="inline-flex items-center gap-1"
                >
                  <IconCheck size={13} />
                  <span>Simpan Run RAB</span>
                </Button>
              </>
            )}

            {/* Pemisah visual */}
            {canRunRab && canRun && <div className="h-4 w-px bg-slate-200 dark:bg-slate-700 mx-0.5 hidden sm:block" />}

            {/* Action KKF Usulan */}
            {canRun && (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  loading={calculating}
                  disabled={Boolean(kkfBlockReason) || calculating || storing}
                  onClick={handleCalculate}
                  title={kkfBlockReason || 'Simulasi kalkulasi KKF Usulan (tidak disimpan)'}
                  className="inline-flex items-center gap-1"
                >
                  <IconCalculator size={13} />
                  <span>Hitung (Dry Run)</span>
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  loading={storing}
                  disabled={Boolean(kkfBlockReason) || calculating || storing}
                  onClick={handleSaveRun}
                  title={kkfBlockReason || 'Simpan kalkulasi Run KKF Usulan'}
                  className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1"
                >
                  <IconCheck size={13} />
                  <span>Simpan Run KKF</span>
                </Button>
              </>
            )}
          </div>
        </div>

        {/* Syarat tombol yang belum terpenuhi / hak akses */}
        {!canRun && !canRunRab ? (
          <p className="text-[11px] text-slate-500 italic">Anda hanya dapat melihat hasil RAB dan KKF; menghitung dan menyimpan dilakukan oleh Perencanaan UP3.</p>
        ) : activeReasons.length > 0 ? (
          <div className="text-[11px] text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2 space-y-0.5">
            <span className="font-semibold block">Belum dapat dijalankan:</span>
            {activeReasons.map((r, i) => <span key={i} className="block">• {r}</span>)}
          </div>
        ) : null}

        {/* Form Controls */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label htmlFor="kkf-prop-date" className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Tanggal Acuan Parameter
            </label>
            <input
              id="kkf-prop-date"
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>

          <div>
            <label htmlFor="kkf-prop-esthetic" className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Biaya Estetika / Sharing Investasi (Rp)
            </label>
            <input
              id="kkf-prop-esthetic"
              type="number"
              min="0"
              placeholder="0"
              value={estheticFee}
              onChange={(e) => setEstheticFee(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono"
            />
          </div>
          <div>
            <label htmlFor="kkf-prop-load-factor" className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Faktor Beban (opsional, lazimnya 0,8)
            </label>
            <input
              id="kkf-prop-load-factor"
              type="number"
              min="0.01"
              max="1"
              step="0.05"
              placeholder="Ikut set parameter"
              value={loadFactor}
              onChange={(e) => setLoadFactor(e.target.value)}
              className="w-full px-2.5 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono"
            />
          </div>
        </div>

        {/* Member Meter Configuration (if change of power to postpaid meter) */}
        {hasMembers && (
          <div className="mt-3 p-3 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-2">
            <span className="text-[11px] font-bold text-slate-700 dark:text-slate-300 block">
              Konfigurasi Meter Pelanggan (Perubahan Daya ke Pascabayar)
            </span>
            <div className="space-y-1.5">
              {members.map((m, idx) => {
                const memberKey = m.application_id || m.id || `member-${idx}`
                return (
                  <div key={memberKey} className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 p-2 rounded bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-[11px]">
                    <div className="min-w-0">
                      <strong className="text-slate-900 dark:text-slate-100">{m.customer_name}</strong>
                      <span className="text-slate-500 font-mono ml-2">({m.application_number} · IDPEL: {m.idpel || '-'})</span>
                      <span className="text-slate-400 block text-[10px]">
                        Paket SAR: {m.sar_package || '-'} · Jenis: {m.application_type}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <label htmlFor={`meter-prev-${memberKey}`} className="text-[10px] text-slate-500">
                        Meter Sebelumnya:
                      </label>
                      <select
                        id={`meter-prev-${memberKey}`}
                        value={memberMeterModes[m.application_id || m.id] || ''}
                        onChange={(e) =>
                          setMemberMeterModes((prev) => ({
                            ...prev,
                            [m.application_id || m.id]: e.target.value || undefined,
                          }))
                        }
                        className="px-2 py-1 text-base sm:text-[11px] rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                      >
                        <option value="">(Otomatis dari Sistem)</option>
                        <option value="PRABAYAR">PRABAYAR</option>
                        <option value="PASCABAYAR">PASCABAYAR</option>
                      </select>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>

      {/* Result Display Card (Dry run or last calculated) */}
      {calcResult && (
        <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/40 dark:bg-blue-950/20 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-blue-100 dark:border-blue-900/60 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Hasil Perhitungan KKF Usulan
                </h4>
                <StatusBadge status={calcResult.feasible ? 'LAYAK' : 'TIDAK_LAYAK'} />
                {calcResult.extended_required && (
                  <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-300">
                    Memerlukan Extended Approval
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500 mt-0.5">
                Snapshot Hash: <span className="font-mono">{calcResult.snapshot_hash?.slice(0, 16)}...</span>
              </p>
            </div>
          </div>

          {/* Financial Metrics Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">NPV</span>
              <span className={`text-base font-bold font-mono ${calcResult.result?.npv >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {formatRupiah(calcResult.result?.npv || 0)}
              </span>
              <span className="text-[10px] text-slate-500 block mt-0.5">Kriteria: &gt; 0</span>
            </div>

            <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">IRR</span>
              <span className={`text-base font-bold font-mono ${targetTone(calcResult.result?.irr_percent != null && calcResult.inputs?.discount_rate != null ? calcResult.result.irr_percent > calcResult.inputs.discount_rate * 100 : null)}`}>
                {calcResult.result?.irr_percent != null ? formatPercentNumber(calcResult.result.irr_percent) : 'N/A'}
              </span>
              <span className="text-[10px] text-slate-500 block mt-0.5">
                Target: &gt; {formatPercentNumber((calcResult.inputs?.discount_rate || 0) * 100)}
              </span>
            </div>

            <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Payback Period (PBP)</span>
              <span className={`text-base font-bold font-mono ${targetTone(calcResult.result?.payback && calcResult.inputs?.payback_limit_months ? calcResult.result.payback.years * 12 + calcResult.result.payback.months <= calcResult.inputs.payback_limit_months : null)}`}>
                {calcResult.result?.payback?.text || `${calcResult.result?.payback_months || '-'} Bulan`}
              </span>
              <span className="text-[10px] text-slate-500 block mt-0.5">
                Batas: &lt; {Math.floor((calcResult.inputs?.payback_limit_months || 60) / 12)} Tahun
              </span>
            </div>

            <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400 block">Rasio BP</span>
              <span className="text-base font-bold font-mono text-slate-900 dark:text-slate-100">
                {calcResult.result?.bp_ratio != null ? Number(calcResult.result.bp_ratio).toFixed(4) : '-'}
              </span>
              <span className="text-[10px] text-slate-500 block mt-0.5">≥ 1 (Informasi)</span>
            </div>
          </div>

          {/* Aggregate Inputs Breakdown */}
          <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 space-y-2">
            <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block border-b border-slate-100 dark:border-slate-700 pb-1.5">
              Parameter Agregat Usulan (Rata-rata Tertimbang)
            </span>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div>
                <span className="text-slate-500 block text-[10px]">Total Investasi (RAB):</span>
                <span className="font-semibold font-mono">{formatRupiah(calcResult.inputs?.investment || 0)}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Total Biaya Penyambungan (BP):</span>
                <span className="font-semibold font-mono">{formatRupiah(calcResult.inputs?.connection_fee || 0)}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Total Daya Hitung:</span>
                <span className="font-semibold font-mono">{Number(calcResult.inputs?.power_kva || 0).toFixed(2)} kVA</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Jam Nyala Tertimbang:</span>
                <span className="font-semibold font-mono">{Number(calcResult.inputs?.jam_nyala || 0).toFixed(2)} Jam</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Harga Jual Rata-rata Tertimbang:</span>
                <span className="font-semibold font-mono">{formatRupiahPerKwh(calcResult.inputs?.avg_price || 0)}</span>
              </div>
              <div>
                <span className="text-slate-500 block text-[10px]">Total Biaya UJL:</span>
                <span className="font-semibold font-mono">{formatRupiah(calcResult.sources?.ujl_total || 0)}</span>
              </div>
            </div>
          </div>

          {/* Members Table from sources.members[] */}
          {Array.isArray(calcResult.sources?.members) && calcResult.sources.members.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block">
                Rincian Perhitungan Per Anggota Usulan ({calcResult.sources.members.length})
              </span>
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-700 rounded-lg bg-white dark:bg-slate-800">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-900/60 text-[10px] font-bold uppercase text-slate-500 border-b border-slate-200 dark:border-slate-700">
                    <tr>
                      <th className="py-2 px-2.5">No</th>
                      <th className="py-2 px-2.5">Pelanggan & IDPEL</th>
                      <th className="py-2 px-2.5">No. Permohonan</th>
                      <th className="py-2 px-2.5">Tarif / Daya</th>
                      <th className="py-2 px-2.5 text-right">Daya Hitung (kVA)</th>
                      <th className="py-2 px-2.5 text-right">Jam Nyala</th>
                      <th className="py-2 px-2.5 text-right">Harga Jual (Rp/kWh)</th>
                      <th className="py-2 px-2.5 text-right">Total Biaya EIS</th>
                      <th className="py-2 px-2.5 text-right">BP Efektif (fee)</th>
                      <th className="py-2 px-2.5">Meter</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                    {calcResult.sources.members.map((m, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-900/40">
                        <td className="py-2 px-2.5 text-slate-400 font-sans">{idx + 1}</td>
                        <td className="py-2 px-2.5 font-sans">
                          <strong className="text-slate-900 dark:text-slate-100 block">{m.customer_name}</strong>
                          <span className="text-slate-500 text-[10px]">{m.idpel || '-'}</span>
                        </td>
                        <td className="py-2 px-2.5 text-slate-700 dark:text-slate-300">{m.application_number}</td>
                        <td className="py-2 px-2.5 text-slate-800 dark:text-slate-200 font-sans">
                          {m.tariff_code} / {m.power_va?.toLocaleString('id-ID')} VA
                        </td>
                        <td className="py-2 px-2.5 text-right font-semibold text-slate-900 dark:text-slate-100">
                          {Number(m.delta_kva || 0).toFixed(2)}
                        </td>
                        <td className="py-2 px-2.5 text-right text-slate-700 dark:text-slate-300">
                          {Number(m.jam_nyala || 0).toFixed(2)}
                        </td>
                        <td className="py-2 px-2.5 text-right text-slate-700 dark:text-slate-300">
                          {formatRupiahPerKwh(m.avg_price || 0)}
                        </td>
                        <td className="py-2 px-2.5 text-right text-slate-500">
                          {formatRupiah(m.total_cost || 0)}
                        </td>
                        <td className="py-2 px-2.5 text-right font-bold text-blue-700 dark:text-blue-300">
                          {formatRupiah(m.fee || 0)}
                        </td>
                        <td className="py-2 px-2.5 font-sans">
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                            {m.mode || '-'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Riwayat Run RAB Pelanggan Utama */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <IconLayers size={15} />
              <span>Kalkulasi &amp; Riwayat Run RAB Pelanggan Utama ({rabRuns.length} tersimpan)</span>
            </h4>
            {hasRabRun && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                Aktif untuk KKF
              </span>
            )}
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={loadRabAndPreview}
            disabled={loadingRab}
            className="inline-flex items-center gap-1 text-[11px]"
          >
            <IconRefresh size={12} className={loadingRab ? 'animate-spin' : ''} />
            <span>Segarkan</span>
          </Button>
        </div>

        {rabError && (
          <Alert variant="danger">
            {rabError}
          </Alert>
        )}

        {mtoPackage && mtoPackage.status !== 'APPROVED' && (
          <div className="p-2.5 rounded-lg bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-300 text-[11px] flex items-center gap-2">
            <IconAlertCircle size={14} className="shrink-0 text-amber-600" />
            <span>
              Paket MTO permohonan utama berstatus <strong>{mtoPackage.status}</strong>. Selesaikan verifikasi dan persetujuan MTO terlebih dahulu sebelum menjalankan perhitungan RAB resmi.
            </span>
          </div>
        )}

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
          <div className="overflow-x-auto">
            {rabRuns.length === 0 ? (
              <div className="py-8 text-center text-slate-400">
                Belum ada run RAB yang tersimpan untuk paket MTO ini. Gunakan tombol &quot;Hitung RAB (Dry Run)&quot; atau &quot;Simpan Run RAB&quot; di bagian atas untuk menyimpan run baru.
              </div>
            ) : (
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3 w-28">Nomor Run</th>
                    <th className="py-2.5 px-3 w-32">Tanggal</th>
                    <th className="py-2.5 px-3 text-right">Grand Total RAB</th>
                    <th className="py-2.5 px-3" title="Kode hash verifikasi keaslian data kalkulasi">Kode Hash Validasi</th>
                    <th className="py-2.5 px-3 w-40 text-center">Dokumen</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-sans">
                  {rabRuns.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2.5 px-3 font-mono font-bold text-blue-600 dark:text-blue-400">
                        Run #{r.run_number}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                        {r.valid_on || r.created_at?.slice(0, 10) || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                        {formatRupiah(r.grand_total)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-slate-400">
                        {r.snapshot_hash ? `${r.snapshot_hash.slice(0, 16)}…` : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => openDocument(r.id, 'rekap', 'rab', `RAB Rekap #${r.run_number}`)}
                            className="inline-flex items-center gap-1"
                          >
                            <IconDocument size={12} />
                            <span>Rekap</span>
                          </Button>
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => openDocument(r.id, 'rinci', 'rab', `RAB Rekap Rinci #${r.run_number}`)}
                            className="inline-flex items-center gap-1"
                          >
                            <IconDocument size={12} />
                            <span>Rinci</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>

      {/* Stored Runs History */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <IconClock size={15} />
            <span>Riwayat Run KKF Usulan</span>
          </h4>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={loadRuns}
            className="inline-flex items-center gap-1 text-[11px]"
          >
            <IconRefresh size={12} />
            <span>Segarkan</span>
          </Button>
        </div>

        {runsError && (
          <Alert variant="danger">
            {runsError}
          </Alert>
        )}

        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Run #</th>
                  <th className="py-2.5 px-3">Nomor Dokumen</th>
                  <th className="py-2.5 px-3">Tanggal</th>
                  <th className="py-2.5 px-3 text-right">NPV (Rp)</th>
                  <th className="py-2.5 px-3 text-right">IRR (%)</th>
                  <th className="py-2.5 px-3">PBP</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3">Dibuat Oleh</th>
                  <th className="py-2.5 px-3 text-right">Dokumen Resmi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-sans">
                {loadingRuns ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">
                      <div className="flex flex-col items-center justify-center gap-2">
                        <Spinner size="sm" />
                        <span>Memuat riwayat KKF usulan...</span>
                      </div>
                    </td>
                  </tr>
                ) : runs.length === 0 ? (
                  <tr>
                    <td colSpan={9} className="py-8 text-center text-slate-400">
                      Belum ada run KKF yang tersimpan untuk usulan ini.
                    </td>
                  </tr>
                ) : (
                  runs.map((r) => (
                    <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                        #{r.run_number}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                        {r.document_number || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                        {r.valid_on || r.created_at?.slice(0, 10)}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-mono font-bold ${r.npv >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                        {formatRupiah(r.npv)}
                      </td>
                      <td className={`py-2.5 px-3 text-right font-mono font-semibold ${targetTone(r.irr_percent != null && r.discount_rate_percent != null ? r.irr_percent > r.discount_rate_percent : null)}`}>
                        {r.irr_percent != null ? formatPercentNumber(r.irr_percent) : '-'}
                      </td>
                      <td className={`py-2.5 px-3 font-semibold ${targetTone(r.payback_months && r.payback_limit_months ? r.payback_months <= r.payback_limit_months : null)}`}>
                        {r.payback_months ? `${r.payback_months} Bulan` : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <StatusBadge status={r.feasible ? 'LAYAK' : 'TIDAK_LAYAK'} />
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 text-[11px]">
                        {r.created_by_name || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => openDocument(r.id, 'kkf')}
                            className="inline-flex items-center gap-1"
                            title="Pratinjau, Cetak & Unduh Dokumen KKF"
                          >
                            <IconDocument size={12} />
                            <span>KKF</span>
                          </Button>
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => openDocument(r.id, 'hpe')}
                            className="inline-flex items-center gap-1"
                            title="Pratinjau, Cetak & Unduh Dokumen HPE"
                          >
                            <IconDocument size={12} />
                            <span>HPE</span>
                          </Button>
                          <Button
                            size="xs"
                            variant="secondary"
                            onClick={() => handleOpenKkoDoc(r)}
                            className="inline-flex items-center gap-1 text-blue-700 dark:text-blue-300 font-semibold"
                            title="Pratinjau, Cetak & Unduh Dokumen KKO"
                          >
                            <IconDocument size={12} />
                            <span>KKO</span>
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Output Document Modal */}
      {selectedRunId && (
        <OutputDocumentModal
          open={docModalOpen}
          onClose={() => {
            setDocModalOpen(false)
            setCustomDoc(null)
          }}
          runId={selectedRunId}
          type={docType}
          category={docCategory}
          title={docTitle || `Dokumen ${docType.toUpperCase()}`}
          customDoc={customDoc}
        />
      )}

      {/* RAB Dry Run Calculation Modal */}
      <RabDryRunModal
        open={dryRunModalOpen}
        onClose={() => setDryRunModalOpen(false)}
        data={dryRunData}
        isDryRun={true}
        canSave={canRun}
        saving={runningRab}
        onSave={handleRunRab}
      />
    </div>
  )
}
