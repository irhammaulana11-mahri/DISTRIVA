import { useState, useEffect, useCallback } from 'react'
import ServiceSlaBadge from '../../components/ServiceSlaBadge.jsx'
import { Link } from 'react-router-dom'
import { kkfRunsApi, kkoApi, drawingApi, mtoApi } from '../../services/api.js'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import Drawer from '../../components/Drawer.jsx'
import OutputDocumentModal from '../../components/OutputDocumentModal.jsx'
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
} from '../../components/icons.jsx'
import {
  formatRupiah,
  formatNumber,
  formatPercentNumber,
  formatPercentDisplay,
  formatRupiahPerKwh,
} from '../../utils/kkfFormatters.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'

export default function ApplicationKkfPanel({
  application,
  canRun = false,
  canView = true,
}) {
  const { notify } = useNotifications()

  // Form State
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10))
  const [estheticFee, setEstheticFee] = useState('')
  const [loadFactor, setLoadFactor] = useState('')   // kosong = ikut set parameter
  const [previousMeterPayment, setPreviousMeterPayment] = useState('')
  const [rabRunId, setRabRunId] = useState('')

  // Runs & Calculation State
  const [calculating, setCalculating] = useState(false)
  const [storing, setStoring] = useState(false)
  const [error, setError] = useState('')
  const [calcResult, setCalcResult] = useState(null) // holds dry run or active view result
  const [isDryRunResult, setIsDryRunResult] = useState(false)

  // Pratinjau server: BP sesudah UJL (pascabayar) dan syarat yang masih menghalangi (mis. belum ada run RAB)
  const [preview, setPreview] = useState(null)

  // Past Runs History State
  const [runs, setRuns] = useState([])
  const [loadingRuns, setLoadingRuns] = useState(false)
  const [selectedRunDetail, setSelectedRunDetail] = useState(null)
  const [loadingRunDetail, setLoadingRunDetail] = useState(false)
  const [detailModalOpen, setDetailModalOpen] = useState(false)

  // Output Document Modal State (docs/70 & docs/57)
  const [docModalConfig, setDocModalConfig] = useState({
    open: false,
    runId: null,
    type: 'kkf',
    category: 'kkf',
    title: '',
    customDoc: null,
  })

  const handleOpenDoc = (runId, type = 'kkf', category = 'kkf', title = '', customDoc = null) => {
    setDocModalConfig({
      open: true,
      runId,
      type,
      category,
      title,
      customDoc,
    })
  }

  // Handle Open KKO Document Modal
  const handleOpenKkoDoc = async (run = null) => {
    if (!application?.id) return
    try {
      const res = await kkoApi.get(application.id)
      if (!res?.data?.record) {
        notify({
          type: 'warning',
          title: 'KKO Belum Dicatat',
          desc: 'Hasil survei KKO belum tersimpan pada permohonan ini.',
          tag: 'KKO',
        })
        return
      }
      let mtoPkg = null
      let drwData = null
      try {
        if (typeof drawingApi?.forApplication === 'function') {
          const drwRes = await drawingApi.forApplication(application.id)
          if (drwRes?.data?.id) {
            drwData = drwRes.data
            const latestVer = drwRes.data.versions?.[0]
            if (latestVer?.id && typeof mtoApi?.forVersion === 'function') {
              const mtoRes = await mtoApi.forVersion(drwRes.data.id, latestVer.id)
              mtoPkg = mtoRes?.data || null
            }
          }
        }
      } catch {
        // ignore
      }

      const doc = buildKkoDocument({
        kko: res.data,
        application,
        run,
        mtoPackage: mtoPkg,
        drawing: drwData,
      })
      handleOpenDoc(
        application.id,
        'kko',
        'kko',
        'Kajian Kelayakan Operasi (KKO)',
        doc
      )
    } catch (err) {
      notify({
        type: 'danger',
        title: 'Gagal Memuat KKO',
        desc: err?.message || 'Data KKO tidak ditemukan.',
        tag: 'KKO',
      })
    }
  }

  // Cash flow table collapse/expand toggle (default collapsed on initial load)
  const [showCashFlow, setShowCashFlow] = useState(false)

  // Determine if previous_meter_payment should be required/shown
  // It is required for power change (PD) to postpaid (pascabayar)
  const sarPkg = (application?.sar_package || '').toLowerCase()
  const isPostpaid = sarPkg.includes('pascabayar')
  const isPowerChange = application?.application_type === 'PD'
  const isPreviousMeterNeeded = isPowerChange && isPostpaid

  // Load Past Runs
  const loadRuns = useCallback(async () => {
    if (!application?.id || application?.proposal_number) return
    setLoadingRuns(true)
    try {
      const res = await kkfRunsApi.listForApplication(application.id)
      setRuns(res?.data || [])
    } catch (err) {
      // Non-fatal or 404 if no runs yet
    } finally {
      setLoadingRuns(false)
    }
  }, [application?.id])

  useEffect(() => {
    loadRuns()
  }, [loadRuns])

  // Pratinjau BP dan syarat run; gagal memuat tidak menghalangi form (hanya tanpa pratinjau)
  useEffect(() => {
    if (!application?.id || application?.proposal_number) return undefined
    let alive = true
    const t = setTimeout(async () => {
      try {
        const res = await kkfRunsApi.preview(application.id, {
          date: date || undefined,
          previous_meter_payment: previousMeterPayment || undefined,
        })
        if (alive) setPreview(res?.data || null)
      } catch {
        if (alive) setPreview(null)
      }
    }, 250)
    return () => {
      alive = false
      clearTimeout(t)
    }
  }, [application?.id, application?.proposal_number, date, previousMeterPayment, runs.length])

  // Handle Calculate (Dry Run)
  const handleCalculate = async (e) => {
    e?.preventDefault?.()
    if (!application?.id) return
    setCalculating(true)
    setError('')

    try {
      const payload = {
        dry_run: true,
        date: date || undefined,
        esthetic_fee: estheticFee !== '' ? Number(estheticFee) : 0,
        load_factor: loadFactor !== '' ? Number(loadFactor) : undefined,
        rab_run_id: rabRunId || undefined,
      }
      if (previousMeterPayment) {
        payload.previous_meter_payment = previousMeterPayment
      }

      const res = await kkfRunsApi.run(application.id, payload)
      setCalcResult(res.data)
      setIsDryRunResult(true)
    } catch (err) {
      // Display 403, 404, 409, 422 verbatim
      setError(err?.message || 'Gagal menghitung kelayakan keuangan (KKF).')
    } finally {
      setCalculating(false)
    }
  }

  // Handle Save Run (Stored Run)
  const handleSaveRun = async () => {
    if (!application?.id) return
    setStoring(true)
    setError('')

    try {
      const payload = {
        dry_run: false,
        date: date || undefined,
        esthetic_fee: estheticFee !== '' ? Number(estheticFee) : 0,
        load_factor: loadFactor !== '' ? Number(loadFactor) : undefined,
        rab_run_id: rabRunId || undefined,
      }
      if (previousMeterPayment) {
        payload.previous_meter_payment = previousMeterPayment
      }

      const res = await kkfRunsApi.run(application.id, payload)
      setCalcResult(res.data)
      setIsDryRunResult(false)

      notify({
        type: 'success',
        title: 'Run KKF Tersimpan',
        desc: `Kalkulasi KKF Run #${res.data?.run_number} (${res.data?.feasible ? 'LAYAK' : 'TIDAK LAYAK'}) berhasil disimpan dan terkunci secara permanen.`,
        tag: 'KKF',
      })

      // Refresh runs list
      loadRuns()
    } catch (err) {
      setError(err?.message || 'Gagal menyimpan hasil run KKF.')
    } finally {
      setStoring(false)
    }
  }

  // View Past Run Detail
  const handleViewPastRun = async (runId) => {
    setLoadingRunDetail(true)
    try {
      const res = await kkfRunsApi.get(runId)
      setSelectedRunDetail(res.data)
      setDetailModalOpen(true)
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Memuat Detail',
        desc: err?.message || 'Tidak dapat memuat detail run KKF.',
        tag: 'KKF',
      })
    } finally {
      setLoadingRunDetail(false)
    }
  }

  // Active view payload (either active calcResult or selectedRunDetail)
  const activeData = calcResult
  const result = activeData?.result
  const inputs = activeData?.inputs
  const sources = activeData?.sources

  // If application is part of a proposal, hide per-application KKF and link to proposal KKF
  if (application?.proposal_number) {
    const proposalTarget = application.proposal_id
      ? `/usulan/${application.proposal_id}`
      : `/usulan?q=${encodeURIComponent(application.proposal_number)}`
    return (
      <div className="p-6 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 space-y-4">
        <div className="flex items-start gap-3">
          <span className="p-2 rounded-lg bg-blue-600 text-white shrink-0 mt-0.5">
            <IconCalculator size={20} />
          </span>
          <div>
            <h3 className="text-sm font-bold">Kajian Kelayakan Finansial (KKF) Usulan Kelompok</h3>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-1 leading-relaxed">
              Permohonan ini merupakan bagian dari usulan pelanggan kelompok. Kalkulasi kelayakan finansial (KKF) dan Harga Perkiraan Enjiniring (HPE) dihitung secara agregat tertimbang pada tingkat usulan.
            </p>
          </div>
        </div>
        <div className="pt-1">
          <Link
            to={proposalTarget}
            className="px-4 py-2 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white transition inline-flex items-center gap-1.5 shadow-xs"
          >
            <span>KKF dihitung pada usulan {application.proposal_number}</span>
            <IconChevronRight size={14} />
          </Link>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <IconCalculator size={18} className="text-blue-600 dark:text-blue-400" />
              <span>Kajian Kelayakan Keuangan (KKF) Permohonan</span>
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Evaluasi parameter finansial investasi distribusi: IRR, NPV, B/C Ratio, dan Payback Period (PBP).
            </p>
            <ServiceSlaBadge applicationId={application?.id} className="mt-1" />
          </div>
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono text-slate-400">
              Agenda: <strong>{application?.application_number}</strong> ({application?.application_type})
            </span>
          </div>
        </div>
      </div>

      {/* Error alert verbatim */}
      {error && <Alert kind="error">{error}</Alert>}

      {/* KKF Parameter Input Form */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-4">
        <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
          Parameter Masukan & Sumber Data
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 text-xs">
          {/* Read-Only: Meter Type from PAKET_SAR */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Jenis kWh Meter (dari PAKET_SAR)
            </label>
            <div className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-medium">
              {application?.sar_package || 'Tidak ada data'}
            </div>
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              Ditentukan otomatis dari sinkronisasi EIS
            </span>
          </div>

          {/* Read-Only: Biaya Penyambungan Info */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-500 mb-1">
              Biaya Penyambungan (BP)
            </label>
            <div className="px-3 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono font-medium">
              {preview?.connection_fee != null
                ? formatRupiah(preview.connection_fee)
                : sources?.total_cost != null
                ? formatRupiah(sources.total_cost)
                : application?.total_cost != null
                ? formatRupiah(application.total_cost)
                : 'Belum sinkron'}
            </div>
            {preview?.connection_fee != null ? (
              <span className="text-[10px] text-slate-400 mt-0.5 block" data-testid="kkf-bp-breakdown">
                {preview.ujl_total != null && preview.meter_mode === 'PASCABAYAR'
                  ? `Total biaya EIS ${formatRupiah(preview.total_cost)} dikurangi UJL ${formatRupiah(preview.ujl_total)} (${formatNumber(preview.ujl_per_va)} Rp/VA × ${formatNumber(preview.ujl_power_va)} VA)`
                  : `Total biaya EIS ${formatRupiah(preview.total_cost)} (prabayar: tanpa pengurangan UJL)`}
              </span>
            ) : (
              <span className="text-[10px] text-slate-400 mt-0.5 block">
                {isPostpaid
                  ? 'Total biaya EIS, belum dikurangi UJL. Nilai BP setelah UJL tampil begitu syaratnya lengkap.'
                  : 'Nilai TOTALBIAYA dari sinkronisasi EIS (prabayar: tanpa pengurangan UJL)'}
              </span>
            )}
          </div>

          {/* Input: Tanggal Evaluasi */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Tanggal Evaluasi
            </label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              Menentukan set parameter dan buku tarif aktif
            </span>
          </div>

          {/* Input: Biaya Estetika (Opsional) */}
          <div>
            <label className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Biaya Estetika (Rp, Opsional)
            </label>
            <input
              type="number"
              min="0"
              step="1000"
              placeholder="0"
              value={estheticFee}
              onChange={(e) => setEstheticFee(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              Biaya tambahan estetika pelanggan (jika ada)
            </span>
          </div>

          <div>
            <label htmlFor="kkf-load-factor" className="block text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Faktor Beban (Opsional)
            </label>
            <input
              id="kkf-load-factor"
              type="number"
              min="0.01"
              max="1"
              step="0.05"
              placeholder="Ikut set parameter"
              value={loadFactor}
              onChange={(e) => setLoadFactor(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
            <span className="text-[10px] text-slate-400 mt-0.5 block">
              Antara 0 dan 1 (lazimnya 0,8). Kosong = nilai pada set parameter KKF. Hanya berlaku untuk run ini.
            </span>
          </div>

          {/* Conditional Input: Previous Meter Payment (only for PD to Postpaid) */}
          {(isPreviousMeterNeeded || error.toLowerCase().includes('previous_meter_payment')) && (
            <div className="sm:col-span-2 p-3 rounded-xl bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800">
              <label className="block text-[11px] font-bold text-blue-900 dark:text-blue-300 mb-1">
                Jenis kWh Meter Sebelumnya <span className="text-rose-500">*</span>
              </label>
              <select
                value={previousMeterPayment}
                onChange={(e) => setPreviousMeterPayment(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-blue-300 dark:border-blue-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500 font-semibold"
              >
                <option value="">-- Pilih Jenis Meter Sebelumnya --</option>
                <option value="PRABAYAR">PRABAYAR (UJL dihitung dari nol ke daya baru)</option>
                <option value="PASCABAYAR">PASCABAYAR (UJL dihitung dari selisih daya)</option>
              </select>
              <span className="text-[10px] text-blue-700 dark:text-blue-400 mt-1 block">
                Permohonan perubahan daya ke pascabayar memerlukan konfirmasi jenis kWh meter sebelumnya untuk kalkulasi UJL (docs/57, docs/62 §26).
              </span>
            </div>
          )}
        </div>

        {/* Syarat yang belum terpenuhi (dari server) */}
        {(() => {
          const hasNoExtensionBlocker = (preview?.blockers || []).some((b) =>
            b.toLowerCase().includes('tanpa perluasan')
          )

          if (hasNoExtensionBlocker) {
            return (
              <div data-testid="kkf-no-extension-notice">
                <Alert kind="info" className="text-xs">
                  KKF tidak diterbitkan: survei menyatakan tanpa perluasan
                </Alert>
              </div>
            )
          }

          if (preview && !preview.ready && (preview.blockers || []).length > 0) {
            return (
              <Alert kind="warning" className="text-xs">
                <ul className="list-disc pl-4 space-y-0.5" data-testid="kkf-blockers">
                  {preview.blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
              </Alert>
            )
          }

          return null
        })()}

        {/* Action Buttons */}
        {!((preview?.blockers || []).some((b) => b.toLowerCase().includes('tanpa perluasan'))) && (
          <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 dark:border-slate-800">
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={handleCalculate}
                disabled={calculating || storing || (preview != null && preview.rab_run == null && !rabRunId)}
                title={preview != null && preview.rab_run == null ? 'Belum ada run RAB' : undefined}
                className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white"
              >
                {calculating ? (
                  <span className="flex items-center gap-1.5">
                    <Spinner size="xs" />
                    <span>Menghitung...</span>
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <IconCalculator size={15} />
                    <span>Hitung (Dry Run)</span>
                  </span>
                )}
              </Button>

              {canRun && activeData && isDryRunResult && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleSaveRun}
                  disabled={storing || calculating}
                  className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white"
                >
                  {storing ? (
                    <span className="flex items-center gap-1.5">
                      <Spinner size="xs" />
                      <span>Menyimpan Run...</span>
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5">
                      <IconCheck size={15} />
                      <span>Simpan Run KKF</span>
                    </span>
                  )}
                </Button>
              )}
            </div>

            {activeData && isDryRunResult && (
              <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950/40 px-2.5 py-1 rounded-full border border-amber-200 dark:border-amber-800">
                Pratinjau Dry Run (Hasil belum tersimpan ke database)
              </span>
            )}
          </div>
        )}
      </div>

      {/* KKF Results Card */}
      {activeData && result && (
        <div className="space-y-4">
          {(activeData.warnings || []).map((w) => (
            <div key={w.code} data-testid="kkf-warning">
              <Alert kind="warning" className="text-xs">
                {w.message}
              </Alert>
            </div>
          ))}
          {/* Extended Approval Warning Banner */}
          {activeData.extended_required && (
            <div className="p-4 rounded-xl border border-rose-300 dark:border-rose-900 bg-rose-50 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200 text-xs space-y-1.5 shadow-xs">
              <div className="flex items-center gap-2 font-bold text-rose-800 dark:text-rose-300">
                <IconExclamation size={18} className="shrink-0 text-rose-600" />
                <span>PERINGATAN: KAJIAN KELAYAKAN KEUANGAN TIDAK LAYAK</span>
              </div>
              <p className="text-[11px] leading-relaxed text-rose-700 dark:text-rose-300">
                Berdasarkan hasil kalkulasi KKF, permohonan ini berstatus <strong>TIDAK LAYAK</strong> (extended_required = true). Dokumen paket gambar teknik memerlukan <strong>Rantai Persetujuan Diperpanjang (Extended Approval Chain)</strong> yang melibatkan persetujuan ASMAN NIAGA dan UP3 MANAGER.
              </p>
              <p className="text-[10px] text-rose-600 dark:text-rose-400 italic">
                Catatan: Hak persetujuan gambar tetap berada pada modul gambar teknik; status extended approval gambar tidak diubah dari panel ini.
              </p>
            </div>
          )}

          {/* Feasibility Header Badge & Criteria Checklist */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div className="flex items-center gap-3">
                <span
                  className={`px-3 py-1.5 rounded-xl font-bold text-sm tracking-wide shadow-xs ${
                    activeData.feasible
                      ? 'bg-emerald-600 text-white'
                      : 'bg-rose-600 text-white'
                  }`}
                >
                  {activeData.feasible ? 'LAYAK (FEASIBLE)' : 'TIDAK LAYAK'}
                </span>
                <div>
                  <h4 className="text-xs font-bold text-slate-900 dark:text-slate-100">
                    Hasil Uji Kelayakan Finansial
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Evaluasi 3 kriteria kelayakan investasi PLN (docs/62 §26)
                  </p>
                </div>
              </div>

              {activeData.snapshot_hash && (
                <div className="text-[10px] font-mono text-slate-400 bg-slate-50 dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700 truncate max-w-xs">
                  Hash: {activeData.snapshot_hash}
                </div>
              )}
            </div>

            {/* Criteria Checklist */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-2 border-t border-slate-100 dark:border-slate-800 text-xs">
              <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                {result.criteria?.irr_above_discount ? (
                  <IconCheckCircle size={16} className="text-emerald-500 shrink-0" />
                ) : (
                  <IconExclamation size={16} className="text-rose-500 shrink-0" />
                )}
                <div>
                  <span className="font-semibold block text-[11px]">IRR &gt; Discount Rate</span>
                  <span className="text-[10px] text-slate-500">
                    {formatPercentNumber(result.irr_percent)} vs {formatPercentNumber(result.discount_rate_percent)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                {result.criteria?.npv_positive ? (
                  <IconCheckCircle size={16} className="text-emerald-500 shrink-0" />
                ) : (
                  <IconExclamation size={16} className="text-rose-500 shrink-0" />
                )}
                <div>
                  <span className="font-semibold block text-[11px]">NPV Bernilai Positif</span>
                  <span className="text-[10px] text-slate-500 font-mono">
                    {formatRupiah(result.npv)}
                  </span>
                </div>
              </div>

              <div className="flex items-center gap-2 p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60">
                {result.criteria?.payback_within_5_years ? (
                  <IconCheckCircle size={16} className="text-emerald-500 shrink-0" />
                ) : (
                  <IconExclamation size={16} className="text-rose-500 shrink-0" />
                )}
                <div>
                  <span className="font-semibold block text-[11px]">Payback &le; Batas Maks</span>
                  <span className="text-[10px] text-slate-500">
                    {result.payback?.text || 'Tidak Kembali'} (maks {inputs?.payback_limit_months || 60} bln)
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Financial Indicators Grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 text-xs">
            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <span className="text-[11px] text-slate-400 block mb-0.5">Nilai Investasi (RAB)</span>
              <p className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm">
                {formatRupiah(inputs?.investment)}
              </p>
              <span className="text-[10px] text-slate-400">
                {sources?.rab_run_number ? `RAB Run #${sources.rab_run_number}` : 'Run RAB'}
              </span>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <span className="text-[11px] text-slate-400 block mb-0.5">Biaya Penyambungan (BP)</span>
              <p className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm">
                {formatRupiah(inputs?.connection_fee)}
              </p>
              <span className="text-[10px] text-slate-400">
                {sources?.meter_payment || 'Kas Masuk BP'}
              </span>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <span className="text-[11px] text-slate-400 block mb-0.5">Net Present Value (NPV)</span>
              <p
                className={`font-mono font-bold text-sm ${
                  result.npv > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
                }`}
              >
                {formatRupiah(result.npv)}
              </p>
              <span className="text-[10px] text-slate-400">Diskonto {formatPercentNumber(result.discount_rate_percent)}</span>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <span className="text-[11px] text-slate-400 block mb-0.5">Internal Rate of Return (IRR)</span>
              <p
                className={`font-mono font-bold text-sm ${
                  result.criteria?.irr_above_discount ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
                }`}
              >
                {formatPercentNumber(result.irr_percent)}
              </p>
              <span className="text-[10px] text-slate-400">Target &gt; {formatPercentNumber(result.discount_rate_percent)}</span>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <span className="text-[11px] text-slate-400 block mb-0.5">Payback Period (PBP)</span>
              <p className="font-semibold text-slate-800 dark:text-slate-200">
                {result.payback?.text || 'Tidak Kembali'}
              </p>
              <span className="text-[10px] text-slate-400">Horizon {inputs?.horizon || 25} thn</span>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <span className="text-[11px] text-slate-400 block mb-0.5">Benefit-Cost (B/C) Ratio</span>
              <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {formatNumber(result.bc_ratio, 3)}
              </p>
              <span className="text-[10px] text-slate-400">PV Revenue / PV Cost</span>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <span className="text-[11px] text-slate-400 block mb-0.5">Rasio BP / Investasi</span>
              <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {formatPercentNumber(result.bp_ratio * 100)}
              </p>
              <span className="text-[10px] text-slate-400">(BP + Estetika) / Investasi</span>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <span className="text-[11px] text-slate-400 block mb-0.5">RWACC (Indikator)</span>
              <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {formatPercentNumber(result.rwacc_percent)}
              </p>
              <span className="text-[10px] text-slate-400">Equity & Debt Weighted</span>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <span className="text-[11px] text-slate-400 block mb-0.5">Daya Hitung (Selisih)</span>
              <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {formatNumber(inputs?.power_kva)} kVA
              </p>
              <span className="text-[10px] text-slate-400">Delta daya lama ke baru</span>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <span className="text-[11px] text-slate-400 block mb-0.5">Harga Rata-rata</span>
              <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {formatRupiah(inputs?.avg_price, true)} / kWh
              </p>
              <span className="text-[10px] text-slate-400">Tarif {sources?.tariff_code || '-'}</span>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <span className="text-[11px] text-slate-400 block mb-0.5">Biaya Pokok (BPP)</span>
              <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {formatRupiah(inputs?.bpp)} / kWh
              </p>
              <span className="text-[10px] text-slate-400">Set: {sources?.parameter_set_name || '-'}</span>
            </div>

            <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
              <span className="text-[11px] text-slate-400 block mb-0.5">Jam Nyala Rata-rata</span>
              <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {formatNumber(inputs?.jam_nyala)} Jam/Bulan
              </p>
              <span className="text-[10px] text-slate-400">Buku: {sources?.tariff_book_name || '-'}</span>
            </div>
          </div>

          {/* 25-Year Cash Flow Table Accordion */}
          {result.years && result.years.length > 0 && (
            <div className="border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
              <div
                onClick={() => setShowCashFlow(!showCashFlow)}
                className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between cursor-pointer select-none"
              >
                <div className="flex items-center gap-2">
                  <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                    Tabel Proyeksi Arus Kas Finansial (Tahun 0 s/d 25)
                  </h4>
                  <span className="text-[11px] text-slate-400">({result.years.length} baris)</span>
                </div>
                {showCashFlow ? <IconChevronDown size={16} /> : <IconChevronRight size={16} />}
              </div>

              {showCashFlow && (
                <div className="overflow-x-auto max-h-96 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse font-mono text-[11px]">
                    <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 font-semibold z-10 text-right">
                      <tr>
                        <th className="py-2.5 px-3 text-left w-16">Thn</th>
                        <th className="py-2.5 px-3 text-left w-20">Kalender</th>
                        <th className="py-2.5 px-3">Energi (MWh)</th>
                        <th className="py-2.5 px-3">Investasi (Rp)</th>
                        <th className="py-2.5 px-3">Biaya Energi</th>
                        <th className="py-2.5 px-3">Biaya O&M</th>
                        <th className="py-2.5 px-3">Total Biaya</th>
                        <th className="py-2.5 px-3">Kas Masuk BP</th>
                        <th className="py-2.5 px-3">Penjualan Tenaga</th>
                        <th className="py-2.5 px-3">Total Pendapatan</th>
                        <th className="py-2.5 px-3">Net Benefit</th>
                        <th className="py-2.5 px-3">Kumulatif</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/70 text-right">
                      {result.years.map((y) => (
                        <tr
                          key={y.year_index}
                          className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40"
                        >
                          <td className="py-2 px-3 text-left font-bold text-slate-800 dark:text-slate-200">
                            {y.year_index}
                          </td>
                          <td className="py-2 px-3 text-left text-slate-500 font-sans">
                            {y.year}
                          </td>
                          <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                            {formatNumber(y.energy_sold_mwh, 3)}
                          </td>
                          <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                            {y.cost_investment > 0 ? formatRupiah(y.cost_investment) : '-'}
                          </td>
                          <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                            {y.cost_energy > 0 ? formatRupiah(y.cost_energy) : '-'}
                          </td>
                          <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                            {y.cost_om > 0 ? formatRupiah(y.cost_om) : '-'}
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                            {formatRupiah(y.cost_total)}
                          </td>
                          <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                            {y.cash_in_connection > 0 ? formatRupiah(y.cash_in_connection) : '-'}
                          </td>
                          <td className="py-2 px-3 text-slate-700 dark:text-slate-300">
                            {y.revenue_sales > 0 ? formatRupiah(y.revenue_sales) : '-'}
                          </td>
                          <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                            {formatRupiah(y.revenue_total)}
                          </td>
                          <td
                            className={`py-2 px-3 font-semibold ${
                              y.net >= 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {formatRupiah(y.net)}
                          </td>
                          <td
                            className={`py-2 px-3 font-bold ${
                              y.cumulative >= 0
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {formatRupiah(y.cumulative)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Past Runs History Section */}
      <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <IconClock size={16} />
              <span>Riwayat Run KKF ({runs.length} tersimpan)</span>
            </h4>
            <p className="text-[11px] text-slate-500">
              Daftar catatan run KKF tersimpan yang tak-berubah (immutable audit trail).
            </p>
          </div>
          <button
            type="button"
            onClick={loadRuns}
            disabled={loadingRuns}
            className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 inline-flex items-center gap-1"
          >
            <IconRefresh size={13} className={loadingRuns ? 'animate-spin' : ''} />
            <span>Segarkan</span>
          </button>
        </div>

        {loadingRuns ? (
          <div className="py-8 text-center">
            <Spinner size="sm" label="Memuat riwayat KKF..." />
          </div>
        ) : runs.length === 0 ? (
          <div className="p-6 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl text-xs text-slate-400">
            Belum ada run KKF yang disimpan untuk permohonan ini.
          </div>
        ) : (
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800 text-[10px]">
                  <tr>
                    <th className="py-2.5 px-3">Run #</th>
                    <th className="py-2.5 px-3">Tanggal Evaluasi</th>
                    <th className="py-2.5 px-3">Kelayakan</th>
                    <th className="py-2.5 px-3 text-right">NPV</th>
                    <th className="py-2.5 px-3 text-right">IRR</th>
                    <th className="py-2.5 px-3">Payback</th>
                    <th className="py-2.5 px-3">Run RAB</th>
                    <th className="py-2.5 px-3">Dibuat Oleh</th>
                    <th className="py-2.5 px-3 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono text-[11px]">
                  {runs.map((r) => (
                    <tr
                      key={r.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-200">
                        #{r.run_number}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 font-sans">
                        {r.valid_on}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            r.feasible
                              ? 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300'
                              : 'bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300'
                          }`}
                        >
                          {r.feasible ? 'LAYAK' : 'TIDAK LAYAK'}
                        </span>
                      </td>
                      <td
                        className={`py-2.5 px-3 text-right font-semibold ${
                          r.npv > 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600'
                        }`}
                      >
                        {formatRupiah(r.npv)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300 font-semibold">
                        {r.irr_percent != null ? formatPercentNumber(r.irr_percent) : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 font-sans">
                        {r.payback_months != null
                          ? `${Math.floor(r.payback_months / 12)} Thn ${r.payback_months % 12} Bln`
                          : 'Tidak Kembali'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                        {r.rab_run_number ? (
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span>RAB #{r.rab_run_number}</span>
                            {r.rab_run_id && (
                              <span className="inline-flex items-center gap-1 text-[10px]">
                                <button
                                  type="button"
                                  onClick={() => handleOpenDoc(r.rab_run_id, 'rekap', 'rab', `RAB Rekap #${r.rab_run_number}`)}
                                  className="text-blue-600 dark:text-blue-400 hover:underline font-bold"
                                  title="Pratinjau Dokumen REKAP RAB"
                                >
                                  REKAP
                                </button>
                                <span className="text-slate-300 dark:text-slate-600">|</span>
                                <button
                                  type="button"
                                  onClick={() => handleOpenDoc(r.rab_run_id, 'rinci', 'rab', `RAB Rekap Rinci #${r.rab_run_number}`)}
                                  className="text-blue-600 dark:text-blue-400 hover:underline font-bold"
                                  title="Pratinjau Dokumen REKAP RINCI RAB"
                                >
                                  RINCI
                                </button>
                              </span>
                            )}
                          </div>
                        ) : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-slate-500 font-sans text-[10px]">
                        {r.created_by_name || '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1.5 flex-wrap">
                          <button
                            type="button"
                            onClick={() => handleOpenDoc(r.id, 'kkf', 'kkf', `Kajian Kelayakan Finansial (KKF) #${r.run_number}`)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-blue-200 dark:border-blue-800 transition"
                            title="Pratinjau, Cetak & Unduh Dokumen KKF"
                          >
                            <IconDocument size={12} />
                            <span>KKF</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenDoc(r.id, 'hpe', 'kkf', `Harga Perkiraan Engineering (HPE) #${r.run_number}`)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-blue-200 dark:border-blue-800 transition"
                            title="Pratinjau, Cetak & Unduh Dokumen HPE"
                          >
                            <IconDocument size={12} />
                            <span>HPE</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenKkoDoc(r)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-blue-200 dark:border-blue-800 transition"
                            title="Pratinjau, Cetak & Unduh Dokumen KKO"
                          >
                            <IconDocument size={12} />
                            <span>KKO</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => handleViewPastRun(r.id)}
                            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition"
                          >
                            <IconEye size={12} />
                            <span>Detail</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Drawer: Detailed Past Run Snapshot */}
      {detailModalOpen && selectedRunDetail && (
        <Drawer
          isOpen={detailModalOpen}
          onClose={() => {
            setDetailModalOpen(false)
            setSelectedRunDetail(null)
          }}
          title={`Detail Run KKF #${selectedRunDetail.run_number} (${selectedRunDetail.feasible ? 'LAYAK' : 'TIDAK LAYAK'})`}
          subtitle={`Evaluasi tanggal ${selectedRunDetail.valid_on} · Snapshot hash: ${selectedRunDetail.snapshot_hash || '-'}`}
          width="max-w-4xl"
          footer={
            <div className="flex justify-end w-full">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDetailModalOpen(false)
                  setSelectedRunDetail(null)
                }}
              >
                Tutup
              </Button>
            </div>
          }
        >
          <div className="space-y-5 text-xs">
            {/* Feasibility Alert */}
            <div
              className={`p-4 rounded-xl border flex items-center justify-between ${
                selectedRunDetail.feasible
                  ? 'border-emerald-200 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200'
                  : 'border-rose-200 bg-rose-50 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200'
              }`}
            >
              <div className="flex items-center gap-2 font-bold text-sm">
                {selectedRunDetail.feasible ? (
                  <IconCheckCircle size={20} className="text-emerald-600" />
                ) : (
                  <IconExclamation size={20} className="text-rose-600" />
                )}
                <span>Status Kelayakan: {selectedRunDetail.feasible ? 'LAYAK' : 'TIDAK LAYAK'}</span>
              </div>
              <span className="font-mono text-[10px] bg-white dark:bg-slate-800 px-2 py-1 rounded border border-slate-200 dark:border-slate-700">
                Terkunci (Immutable)
              </span>
            </div>

            {/* Key Indicators */}
            {selectedRunDetail.result && (
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                  <span className="text-[10px] text-slate-400 block mb-0.5">NPV</span>
                  <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
                    {formatRupiah(selectedRunDetail.result.npv)}
                  </p>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                  <span className="text-[10px] text-slate-400 block mb-0.5">IRR</span>
                  <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
                    {formatPercentNumber(selectedRunDetail.result.irr_percent)}
                  </p>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                  <span className="text-[10px] text-slate-400 block mb-0.5">Payback Period</span>
                  <p className="font-semibold text-slate-800 dark:text-slate-200">
                    {selectedRunDetail.result.payback?.text || 'Tidak Kembali'}
                  </p>
                </div>
                <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                  <span className="text-[10px] text-slate-400 block mb-0.5">B/C Ratio</span>
                  <p className="font-mono font-bold text-slate-800 dark:text-slate-200">
                    {formatNumber(selectedRunDetail.result.bc_ratio, 3)}
                  </p>
                </div>
              </div>
            )}

            {/* Full Cash Flow Table */}
            {selectedRunDetail.result?.years && (
              <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 font-bold border-b border-slate-200 dark:border-slate-800">
                  Arus Kas Finansial Tahun 0 s/d 25
                </div>
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-left text-xs border-collapse font-mono text-[11px]">
                    <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-b border-slate-200 text-right">
                      <tr>
                        <th className="py-2 px-3 text-left">Thn</th>
                        <th className="py-2 px-3">Investasi</th>
                        <th className="py-2 px-3">Total Biaya</th>
                        <th className="py-2 px-3">Kas Masuk BP</th>
                        <th className="py-2 px-3">Total Pendapatan</th>
                        <th className="py-2 px-3">Net</th>
                        <th className="py-2 px-3">Kumulatif</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-right">
                      {selectedRunDetail.result.years.map((y) => (
                        <tr key={y.year_index}>
                          <td className="py-1.5 px-3 text-left font-bold">{y.year_index}</td>
                          <td className="py-1.5 px-3">{y.cost_investment > 0 ? formatRupiah(y.cost_investment) : '-'}</td>
                          <td className="py-1.5 px-3">{formatRupiah(y.cost_total)}</td>
                          <td className="py-1.5 px-3">{y.cash_in_connection > 0 ? formatRupiah(y.cash_in_connection) : '-'}</td>
                          <td className="py-1.5 px-3">{formatRupiah(y.revenue_total)}</td>
                          <td className={`py-1.5 px-3 font-semibold ${y.net >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                            {formatRupiah(y.net)}
                          </td>
                          <td className="py-1.5 px-3 font-bold">{formatRupiah(y.cumulative)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </Drawer>
      )}

      {/* Output Document Modal (docs/70 & docs/57) */}
      <OutputDocumentModal
        open={docModalConfig.open}
        onClose={() => setDocModalConfig((prev) => ({ ...prev, open: false, customDoc: null }))}
        runId={docModalConfig.runId}
        type={docModalConfig.type}
        category={docModalConfig.category}
        title={docModalConfig.title}
        customDoc={docModalConfig.customDoc}
      />
    </div>
  )
}
