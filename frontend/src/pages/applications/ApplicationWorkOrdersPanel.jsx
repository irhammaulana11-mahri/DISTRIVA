import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { workOrdersApi, vendorsApi, bastpApi } from '../../services/api.js'
import VendorPicker, { VendorPreview } from '../work-orders/VendorPicker.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import Button from '../../components/Button.jsx'
import Drawer from '../../components/Drawer.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import BastpDetailDrawer from '../work-orders/BastpDetailDrawer.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import {
  IconPlus,
  IconCheck,
  IconX,
  IconClock,
  IconRefresh,
  IconTruck,
  IconCheckCircle,
  IconAlertCircle,
  IconHistory,
  IconFileText,
} from '../../components/icons.jsx'

export default function ApplicationWorkOrdersPanel({
  application,
  canCreate = false,
  canIssue = false,
  canSubmitProgress = false,
  canVerifyProgress = false,
  canComplete = false,
  canView = true,
}) {
  const { notify } = useNotifications()

  const [orders, setOrders] = useState([])
  const [selectedWoId, setSelectedWoId] = useState(null)
  const [woDetail, setWoDetail] = useState(null)
  const [loadingList, setLoadingList] = useState(true)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [actionError, setActionError] = useState('')

  // Pagination for WO detail tables
  const [taskPage, setTaskPage] = useState(1)
  const [taskPerPage, setTaskPerPage] = useState(10)
  const [progPage, setProgPage] = useState(1)
  const [progPerPage, setProgPerPage] = useState(10)

  // Vendors list for selection
  const [vendors, setVendors] = useState([])
  const [selectedVendorId, setSelectedVendorId] = useState('')
  const [vendorNote, setVendorNote] = useState('')
  const [targetDate, setTargetDate] = useState('')
  const [editTarget, setEditTarget] = useState(false)
  const [targetReason, setTargetReason] = useState('')
  const [assigningVendor, setAssigningVendor] = useState(false)

  // Submitting WO
  const [submittingWo, setSubmittingWo] = useState(false)

  // Decision (Issue / Return)
  const [deciding, setDeciding] = useState(false)
  const [returnModalOpen, setReturnModalOpen] = useState(false)
  const [returnReason, setReturnReason] = useState('')

  // Cancel Modal
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)

  // Amend Modal
  const [amendModalOpen, setAmendModalOpen] = useState(false)
  const [amendReason, setAmendReason] = useState('')
  const [amending, setAmending] = useState(false)

  // Progress Submission (Internal)
  const [progressModalOpen, setProgressModalOpen] = useState(false)
  const [progressTaskId, setProgressTaskId] = useState('')
  const [progressPercent, setProgressPercent] = useState('')
  const [progressNotes, setProgressNotes] = useState('')
  const [submittingProgress, setSubmittingProgress] = useState(false)

  // Progress Decision Modal (Return Progress)
  const [returnProgressModalOpen, setReturnProgressModalOpen] = useState(false)
  const [selectedProgressId, setSelectedProgressId] = useState(null)
  const [progressReturnReason, setProgressReturnReason] = useState('')
  const [decidingProgress, setDecidingProgress] = useState(false)

  // BASTP State
  const { user } = useAuth()
  const { can, isSysAdmin } = useAccess()
  const [bastpList, setBastpList] = useState([])
  const [selectedBastpId, setSelectedBastpId] = useState(null)
  const [creatingBastp, setCreatingBastp] = useState(false)

  // Load Work Orders for Application
  const loadOrders = useCallback(async () => {
    if (!application?.id) return
    setLoadingList(true)
    setActionError('')
    try {
      const res = await workOrdersApi.listForApplication(application.id)
      const list = res?.data || []
      setOrders(list)
      if (list.length > 0 && !selectedWoId) {
        setSelectedWoId(list[0].id)
      }
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal memuat daftar SPK/WO.')
    } finally {
      setLoadingList(false)
    }
  }, [application?.id, selectedWoId])

  useEffect(() => {
    loadOrders()
  }, [loadOrders])

  // Load Vendors Reference
  useEffect(() => {
    vendorsApi.list().then((res) => {
      setVendors(res?.data || [])
    }).catch(() => {})
  }, [])

  // Load Selected WO Detail
  const loadWoDetail = useCallback(async (woId) => {
    if (!woId) return
    setLoadingDetail(true)
    setActionError('')
    try {
      const res = await workOrdersApi.get(woId)
      const data = res?.data || null
      setWoDetail(data)
      if (data) {
        setSelectedVendorId(data.vendor_company_id || '')
        setVendorNote(data.vendor_note || '')
        setTargetDate(data.target_date || '')
        setEditTarget(false)
        setTargetReason('')
      }

      // Load BASTP for this WO
      bastpApi.listForWorkOrder(woId)
        .then((bRes) => setBastpList(bRes?.data || []))
        .catch(() => setBastpList([]))
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal memuat detail SPK/WO.')
    } finally {
      setLoadingDetail(false)
    }
  }, [])

  useEffect(() => {
    if (selectedWoId) {
      loadWoDetail(selectedWoId)
    }
  }, [selectedWoId, loadWoDetail])

  // Create WO
  const handleCreateWo = async () => {
    setActionError('')
    try {
      const res = await workOrdersApi.create(application.id)
      notify({
        type: 'success',
        title: 'SPK/WO Dibuat',
        desc: 'Draf SPK / Work Order konstruksi berhasil diinisiasi.',
        tag: 'WO',
      })
      await loadOrders()
      if (res?.data?.id) {
        setSelectedWoId(res.data.id)
      }
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal membuat SPK/WO.')
    }
  }

  // Ubah target selesai SPK yang sudah berjalan (alasan wajib bila sudah pernah ditetapkan)
  const handleSaveTarget = async () => {
    if (!selectedWoId || !targetDate) return
    setAssigningVendor(true)
    setActionError('')
    try {
      await workOrdersApi.setTargetDate(selectedWoId, { target_date: targetDate, reason: targetReason || undefined })
      notify({ type: 'success', title: 'Target Selesai Disimpan', desc: 'Target selesai SPK diperbarui.', tag: 'WO' })
      loadWoDetail(selectedWoId)
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal menyimpan target selesai.')
    } finally {
      setAssigningVendor(false)
    }
  }

  // Set Vendor
  const handleSaveVendor = async (e) => {
    e?.preventDefault?.()
    if (!selectedWoId || !selectedVendorId) return
    setAssigningVendor(true)
    setActionError('')
    try {
      await workOrdersApi.setVendor(selectedWoId, {
        vendor_company_id: selectedVendorId,
        note: vendorNote || undefined,
        target_date: targetDate || undefined,
      })
      notify({
        type: 'success',
        title: 'Vendor Dipilih',
        desc: 'Perusahaan vendor pelaksana berhasil ditetapkan untuk SPK ini.',
        tag: 'WO',
      })
      loadWoDetail(selectedWoId)
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal menetapkan vendor pelaksana.')
    } finally {
      setAssigningVendor(false)
    }
  }

  // Submit WO
  const handleSubmitWo = async () => {
    if (!selectedWoId) return
    setSubmittingWo(true)
    setActionError('')
    try {
      await workOrdersApi.submit(selectedWoId)
      notify({
        type: 'success',
        title: 'SPK/WO Diajukan',
        desc: 'SPK/WO berhasil diajukan ke ASMAN Konstruksi untuk penerbitan.',
        tag: 'WO',
      })
      loadOrders()
      loadWoDetail(selectedWoId)
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal mengajukan SPK/WO.')
    } finally {
      setSubmittingWo(false)
    }
  }

  // Issue WO (ASMAN_KONSTRUKSI approves WO + Vendor)
  const handleIssueWo = async () => {
    if (!selectedWoId) return
    setDeciding(true)
    setActionError('')
    try {
      await workOrdersApi.decide(selectedWoId, {
        decision: 'ISSUE',
      })
      notify({
        type: 'success',
        title: 'SPK/WO Diterbitkan',
        desc: 'SPK/WO dan penunjukan vendor telah disetujui serta resmi diterbitkan.',
        tag: 'WO',
      })
      loadOrders()
      loadWoDetail(selectedWoId)
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal menerbitkan SPK/WO.')
    } finally {
      setDeciding(false)
    }
  }

  // Return WO
  const handleReturnWo = async (e) => {
    e.preventDefault()
    if (!selectedWoId || !returnReason.trim()) return
    setDeciding(true)
    setActionError('')
    try {
      await workOrdersApi.decide(selectedWoId, {
        decision: 'RETURN',
        reason: returnReason.trim(),
      })
      notify({
        type: 'success',
        title: 'SPK/WO Dikembalikan',
        desc: 'SPK/WO dikembalikan ke pembuat draf untuk peninjauan ulang.',
        tag: 'WO',
      })
      setReturnModalOpen(false)
      setReturnReason('')
      loadOrders()
      loadWoDetail(selectedWoId)
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal mengembalikan SPK/WO.')
    } finally {
      setDeciding(false)
    }
  }

  // Submit Progress (Internal)
  const handleSubmitProgress = async (e) => {
    e.preventDefault()
    if (!selectedWoId || !progressTaskId) return
    setSubmittingProgress(true)
    setActionError('')
    try {
      const submissionKey = typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : 'prog-' + Date.now() + '-' + Math.random().toString(36).slice(2, 9)

      const res = await workOrdersApi.submitProgress(selectedWoId, {
        task_id: progressTaskId,
        submission_key: submissionKey,
        cumulative_percent: parseFloat(progressPercent),
        notes: progressNotes || undefined,
      })

      if (res?.replayed) {
        notify({
          type: 'info',
          title: 'Pengajuan Telah Dicatat',
          desc: 'Pengajuan progres dengan kunci ini telah tersimpan sebelumnya (idempoten).',
          tag: 'WO',
        })
      } else {
        notify({
          type: 'success',
          title: 'Progres Diajukan',
          desc: `Pengajuan progres ${progressPercent}% berhasil dicatat.`,
          tag: 'WO',
        })
      }
      setProgressModalOpen(false)
      setProgressTaskId('')
      setProgressPercent('')
      setProgressNotes('')
      loadWoDetail(selectedWoId)
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal mengajukan progres fisik.')
    } finally {
      setSubmittingProgress(false)
    }
  }

  // Verify Progress
  const handleVerifyProgress = async (progressId) => {
    setDecidingProgress(true)
    setActionError('')
    try {
      await workOrdersApi.decideProgress(progressId, {
        decision: 'VERIFIED',
      })
      notify({
        type: 'success',
        title: 'Progres Diverifikasi',
        desc: 'Capaian progres konstruksi berhasil diverifikasi.',
        tag: 'WO',
      })
      loadWoDetail(selectedWoId)
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal memverifikasi progres.')
    } finally {
      setDecidingProgress(false)
    }
  }

  // Return Progress
  const handleReturnProgress = async (e) => {
    e.preventDefault()
    if (!selectedProgressId || !progressReturnReason.trim()) return
    setDecidingProgress(true)
    setActionError('')
    try {
      await workOrdersApi.decideProgress(selectedProgressId, {
        decision: 'RETURNED',
        reason: progressReturnReason.trim(),
      })
      notify({
        type: 'success',
        title: 'Progres Dikembalikan',
        desc: 'Pengajuan progres dikembalikan ke vendor.',
        tag: 'WO',
      })
      setReturnProgressModalOpen(false)
      setSelectedProgressId(null)
      setProgressReturnReason('')
      loadWoDetail(selectedWoId)
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal mengembalikan pengajuan progres.')
    } finally {
      setDecidingProgress(false)
    }
  }

  // Create BASTP
  const handleCreateBastp = async () => {
    if (!selectedWoId) return
    setCreatingBastp(true)
    setActionError('')
    try {
      const res = await bastpApi.create(selectedWoId)
      notify({
        type: 'success',
        title: 'BASTP Berhasil Dibuat',
        desc: 'Dokumen Berita Acara Serah Terima Pekerjaan (DRAFT) berhasil dibuat.',
        tag: 'BASTP',
      })
      const newId = res?.data?.id
      const bRes = await bastpApi.listForWorkOrder(selectedWoId)
      setBastpList(bRes?.data || [])
      setSelectedBastpId(newId)
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal membuat BASTP.')
    } finally {
      setCreatingBastp(false)
    }
  }

  const allTasksVerified = Boolean(
    woDetail?.tasks?.length > 0 &&
    woDetail.tasks.every((t) => Number(t.verified_percent) >= 100)
  )
  const isAssignedVendor = Boolean(
    woDetail?.vendor_company_id && user?.vendor_company_id === woDetail.vendor_company_id
  )
  const canPrepareBastp = Boolean(isAssignedVendor || can?.['bastp.prepare'] || isSysAdmin)
  const latestBastp = bastpList[0]

  // Cancel WO
  const handleCancelWo = async (e) => {
    e.preventDefault()
    if (!selectedWoId || !cancelReason.trim()) return
    setCancelling(true)
    setActionError('')
    try {
      await workOrdersApi.cancel(selectedWoId, {
        reason: cancelReason.trim(),
      })
      notify({
        type: 'success',
        title: 'SPK/WO Dibatalkan',
        desc: 'SPK/WO berhasil dibatalkan.',
        tag: 'WO',
      })
      setCancelModalOpen(false)
      setCancelReason('')
      loadOrders()
      loadWoDetail(selectedWoId)
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal membatalkan SPK/WO.')
    } finally {
      setCancelling(false)
    }
  }

  // Amend WO
  const handleAmendWo = async (e) => {
    e.preventDefault()
    if (!selectedWoId || !amendReason.trim()) return
    setAmending(true)
    setActionError('')
    try {
      const res = await workOrdersApi.amend(selectedWoId, {
        reason: amendReason.trim(),
      })
      notify({
        type: 'success',
        title: 'Versi Amandemen Dibuat',
        desc: 'Versi baru SPK/WO berhasil diinisiasi.',
        tag: 'WO',
      })
      setAmendModalOpen(false)
      setAmendReason('')
      await loadOrders()
      if (res?.data?.id) {
        setSelectedWoId(res.data.id)
      }
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal mengamandemen SPK/WO.')
    } finally {
      setAmending(false)
    }
  }

  const isDraft = woDetail?.status === 'DRAFT'
  const isSubmitted = woDetail?.status === 'SUBMITTED'
  const isIssued = woDetail?.status === 'ISSUED'
  const isInProgress = woDetail?.status === 'IN_PROGRESS'
  const isCompleted = woDetail?.status === 'COMPLETED'
  const isCancelled = woDetail?.status === 'CANCELLED'

  // All tasks 100% verified check
  const allTasks100Percent = useMemo(() => {
    if (!woDetail?.tasks || woDetail.tasks.length === 0) return false
    return woDetail.tasks.every((t) => (t.verified_percent ?? 0) >= 100)
  }, [woDetail?.tasks])

  // Assigned vendor object
  const assignedVendor = useMemo(() => {
    return vendors.find((v) => v.id === woDetail?.vendor_company_id)
  }, [vendors, woDetail?.vendor_company_id])

  // External status of customer / application (e.g. PEREMAJAAN)
  const externalStatus = application?.customer?.external_status || application?.status_eis || application?.external_status || 'PEREMAJAAN'

  if (loadingList) {
    return (
      <div className="py-12 text-center text-slate-500">
        <Spinner size="lg" label="Memuat SPK / Work Order..." />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Action Error Alert */}
      {actionError && <Alert kind="error">{actionError}</Alert>}

      {/* Header Panel */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
            <IconTruck size={16} />
            <span>Surat Perintah Kerja (SPK / Work Order)</span>
          </h3>
          <p className="text-[11px] text-slate-500">
            Penerbitan kontrak kerja konstruksi, penugasan vendor mitra, pelaporan progres fisik kumulatif, dan penyelesaian proyek.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {orders.length === 0 && canCreate && (
            <Button
              variant="primary"
              size="sm"
              icon={IconPlus}
              onClick={handleCreateWo}
            >
              Buat SPK / WO
            </Button>
          )}

          {orders.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                loadOrders()
                if (selectedWoId) loadWoDetail(selectedWoId)
              }}
              icon={IconRefresh}
            >
              Segarkan
            </Button>
          )}
        </div>
      </div>

      {orders.length === 0 ? (
        <div className="p-12 text-center bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl space-y-2">
          <p className="text-xs text-slate-500">
            Belum ada SPK / Work Order untuk permohonan ini.
          </p>
          <p className="text-[11px] text-slate-400">
            SPK / Work Order dapat diinisiasi setelah gambar teknik disetujui, paket MTO tersedia, dan kalkulasi RAB telah dijalankan.
          </p>
        </div>
      ) : (
        <div className="space-y-4">
          {/* Version Selector Tabs */}
          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto">
            {orders.map((o) => (
              <button
                key={o.id}
                type="button"
                onClick={() => setSelectedWoId(o.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer flex items-center gap-2 ${
                  selectedWoId === o.id
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700'
                }`}
              >
                <span className="font-mono">{o.wo_number || `v${o.version_number}`}</span>
                <span
                  className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold ${
                    selectedWoId === o.id
                      ? 'bg-white/20 text-white'
                      : o.status === 'COMPLETED'
                      ? 'bg-emerald-100 text-emerald-800'
                      : o.status === 'ISSUED' || o.status === 'IN_PROGRESS'
                      ? 'bg-blue-100 text-blue-800'
                      : o.status === 'SUBMITTED'
                      ? 'bg-amber-100 text-amber-800'
                      : 'bg-slate-100 text-slate-600'
                  }`}
                >
                  {o.status}
                </span>
              </button>
            ))}
          </div>

          {loadingDetail ? (
            <div className="py-20 text-center text-slate-500">
              <Spinner size="lg" label="Memuat rincian SPK..." />
            </div>
          ) : !woDetail ? null : (
            <div className="space-y-6">
              {/* Order Status & Actions Bar */}
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <h4 className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
                      {woDetail.wo_number}
                    </h4>
                    <span
                      className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                        isCompleted
                          ? 'bg-emerald-100 text-emerald-800'
                          : isIssued || isInProgress
                          ? 'bg-blue-100 text-blue-800'
                          : isSubmitted
                          ? 'bg-amber-100 text-amber-800'
                          : isCancelled
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-slate-100 text-slate-600'
                      }`}
                    >
                      {woDetail.status}
                    </span>
                    <span className="text-xs text-slate-500">
                      (Versi {woDetail.version_number})
                    </span>
                  </div>

                  <p className="text-xs text-slate-500 mt-1">
                    Vendor: <strong className="text-slate-800 dark:text-slate-200">{assignedVendor ? `${assignedVendor.name} (${assignedVendor.code})` : 'Belum ditentukan'}</strong>
                    {woDetail.issued_at && ` · Diterbitkan: ${new Date(woDetail.issued_at).toLocaleDateString('id-ID')}`}
                    {woDetail.completed_at && ` · Selesai: ${new Date(woDetail.completed_at).toLocaleDateString('id-ID')}`}
                    {woDetail.target_date && ` · Target selesai: ${new Date(`${woDetail.target_date}T00:00:00`).toLocaleDateString('id-ID')}`}
                    {` · Status Eksternal: `}
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {application?.external_status || application?.customer?.external_status || application?.external_references?.[0]?.status || 'DALAM_PROSES'}
                    </span>
                    {woDetail.cancel_reason && ` · Alasan Batal: "${woDetail.cancel_reason}"`}
                    {woDetail.return_reason && ` · Alasan Dikembalikan: "${woDetail.return_reason}"`}
                  </p>
                  {canCreate && ['SUBMITTED', 'ISSUED', 'IN_PROGRESS'].includes(woDetail.status) && (
                    <div className="mt-2 text-xs">
                      {!editTarget ? (
                        <button type="button" className="text-blue-600 hover:underline cursor-pointer" onClick={() => setEditTarget(true)}>
                          {woDetail.target_date ? 'Ubah target selesai' : 'Tetapkan target selesai'}
                        </button>
                      ) : (
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="block">
                            <span className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Target selesai</span>
                            <input type="date" aria-label="Target selesai SPK" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
                          </label>
                          {woDetail.target_date && ['ISSUED', 'IN_PROGRESS'].includes(woDetail.status) && (
                            <label className="block">
                              <span className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">Alasan perubahan</span>
                              <input aria-label="Alasan perubahan target" value={targetReason} onChange={(e) => setTargetReason(e.target.value)} className="px-2 py-1.5 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 w-64" />
                            </label>
                          )}
                          <Button size="sm" onClick={handleSaveTarget} loading={assigningVendor} disabled={!targetDate}>Simpan target</Button>
                          <Button size="sm" variant="ghost" onClick={() => { setEditTarget(false); setTargetDate(woDetail.target_date || '') }}>Batal</Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {/* Status Action Buttons */}
                <div className="flex items-center gap-2 flex-wrap">
                  {(isIssued || isInProgress || isCompleted) && Boolean(can?.['material_requests.view']) && (
                    <Link
                      to={`/work-orders/${application?.id}?tab=material`}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-600 bg-blue-50 hover:bg-blue-100 border border-blue-200 transition"
                    >
                      <IconTruck size={14} />
                      <span>Outbox Material</span>
                    </Link>
                  )}
                  {/* DRAFT: Submit */}
                  {isDraft && canCreate && (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={submittingWo}
                      onClick={handleSubmitWo}
                      disabled={!woDetail.vendor_company_id}
                    >
                      Ajukan SPK / WO
                    </Button>
                  )}

                  {/* SUBMITTED: Issue or Return (ASMAN_KONSTRUKSI) */}
                  {isSubmitted && canIssue && (
                    <>
                      <Button
                        variant="primary"
                        size="sm"
                        loading={deciding}
                        onClick={handleIssueWo}
                        icon={IconCheck}
                      >
                        Terbitkan WO (Setujui)
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setReturnReason('')
                          setReturnModalOpen(true)
                        }}
                        className="text-rose-600 border border-rose-200"
                      >
                        Kembalikan
                      </Button>
                    </>
                  )}

                  {/* ISSUED / IN_PROGRESS: Submit Progress (Internal) */}
                  {(isIssued || isInProgress) && canSubmitProgress && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => {
                        setProgressTaskId(woDetail.tasks?.[0]?.id || '')
                        setProgressPercent('')
                        setProgressNotes('')
                        setProgressModalOpen(true)
                      }}
                      icon={IconPlus}
                    >
                      Kirim Progres Fisik
                    </Button>
                  )}

                  {/* BASTP Button: When WO IN_PROGRESS / ISSUED and all tasks verified 100% */}
                  {(isIssued || isInProgress) && allTasksVerified && (
                    latestBastp && latestBastp.status !== 'CANCELLED' ? (
                      <Button
                        variant="primary"
                        size="sm"
                        onClick={() => setSelectedBastpId(latestBastp.id)}
                        className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5"
                      >
                        <IconFileText size={13} />
                        <span>Buka BASTP ({latestBastp.status})</span>
                      </Button>
                    ) : (
                      canPrepareBastp && (
                        <Button
                          variant="primary"
                          size="sm"
                          loading={creatingBastp}
                          onClick={handleCreateBastp}
                          className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5"
                        >
                          <IconFileText size={13} />
                          <span>Buat BASTP</span>
                        </Button>
                      )
                    )
                  )}

                  {/* BASTP button for Completed WO */}
                  {isCompleted && latestBastp && (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={() => setSelectedBastpId(latestBastp.id)}
                      className="inline-flex items-center gap-1.5"
                    >
                      <IconFileText size={13} />
                      <span>Lihat BASTP Selesai</span>
                    </Button>
                  )}

                  {/* Amandemen (canCreate on non-draft) */}
                  {!isDraft && !isCancelled && canCreate && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAmendReason('')
                        setAmendModalOpen(true)
                      }}
                      className="text-blue-600 border border-blue-200"
                    >
                      Amandemen WO
                    </Button>
                  )}

                  {/* Cancel (canComplete on non-completed/non-cancelled) */}
                  {!isCompleted && !isCancelled && canComplete && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setCancelReason('')
                        setCancelModalOpen(true)
                      }}
                      className="text-rose-600 border border-rose-200"
                    >
                      Batalkan WO
                    </Button>
                  )}
                </div>
              </div>

              {/* Notice near completion button for external status */}
              {(isIssued || isInProgress) && (
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between text-xs">
                  <div>
                    <span className="text-slate-500">Status Eksternal Pelanggan (EIS):</span>{' '}
                    <strong className="font-mono text-blue-600 dark:text-blue-400 font-bold">
                      {externalStatus}
                    </strong>
                  </div>
                  <span className="text-[11px] text-slate-500">
                    {allTasks100Percent
                      ? '✓ Seluruh tugas telah 100% terverifikasi.'
                      : 'Penyelesaian membutuhkan seluruh tugas 100% terverifikasi.'}
                  </span>
                </div>
              )}

              {/* BASTP Card */}
              {((isInProgress && allTasksVerified) || (latestBastp && latestBastp.status !== 'CANCELLED')) && (
                <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/60 dark:bg-blue-950/30 flex items-center justify-between gap-3 flex-wrap">
                  <div className="flex items-center gap-2.5">
                    <IconFileText size={16} className="text-blue-600 dark:text-blue-400 shrink-0" />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-xs text-slate-900 dark:text-slate-100">
                          Berita Acara Serah Terima Pekerjaan (BASTP)
                        </span>
                        {latestBastp && <StatusBadge status={latestBastp.status} />}
                      </div>
                      <span className="text-[11px] text-slate-500">
                        {latestBastp
                          ? `BASTP #${latestBastp.bastp_number || 'DRAFT'} (Putaran ke-${latestBastp.round}). Penutupan BASTP oleh Asman Konstruksi diperlukan untuk menyelesaikan WO.`
                          : 'Seluruh tugas lapangan telah 100% terverifikasi. Buat BASTP untuk memulai proses penyerahan dan tanda tangan elektronik.'}
                      </span>
                    </div>
                  </div>
                  <div>
                    {latestBastp ? (
                      <Button
                        size="sm"
                        variant="primary"
                        onClick={() => setSelectedBastpId(latestBastp.id)}
                        className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5"
                      >
                        <IconFileText size={13} />
                        <span>Kelola BASTP</span>
                      </Button>
                    ) : (
                      canPrepareBastp && (
                        <Button
                          size="sm"
                          variant="primary"
                          loading={creatingBastp}
                          onClick={handleCreateBastp}
                          className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5"
                        >
                          <IconFileText size={13} />
                          <span>Buat Dokumen BASTP</span>
                        </Button>
                      )
                    )}
                  </div>
                </div>
              )}

              {/* DRAFT Section: Select Vendor */}
              {isDraft && (
                <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                  <header className="px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 rounded-t-2xl flex items-center gap-2.5">
                    <span className="p-1.5 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400"><IconTruck size={15} /></span>
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">Vendor Pelaksana Konstruksi</h4>
                      <p className="text-[11px] text-slate-500">Hanya vendor dengan lingkup pekerjaan jaringan. Vendor tiang dipilih terpisah pada WO Tiang.</p>
                    </div>
                  </header>

                  {canCreate ? (
                    <form onSubmit={handleSaveVendor} className="p-5 grid grid-cols-1 lg:grid-cols-5 gap-5 text-xs">
                      <div className="lg:col-span-3 space-y-4">
                        <div>
                          <label className="block text-xs font-semibold mb-1.5 text-slate-700 dark:text-slate-300">Vendor mitra <span className="text-rose-500">*</span></label>
                          <VendorPicker vendors={vendors} scope="JARINGAN" value={selectedVendorId} onChange={setSelectedVendorId} required ariaLabel="Pilih Vendor Mitra" />
                        </div>
                        <div>
                          <label htmlFor="wo-target-date" className="block text-xs font-semibold mb-1.5 text-slate-700 dark:text-slate-300">Target selesai pekerjaan <span className="text-rose-500">*</span> <span className="font-normal text-slate-400">(wajib sebelum diajukan; dasar penilaian ketepatan waktu vendor)</span></label>
                          <input
                            id="wo-target-date"
                            type="date"
                            value={targetDate}
                            onChange={(e) => setTargetDate(e.target.value)}
                            className="block w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-semibold mb-1.5 text-slate-700 dark:text-slate-300">Catatan / instruksi khusus vendor <span className="font-normal text-slate-400">(opsional)</span></label>
                          <textarea
                            rows={3}
                            value={vendorNote}
                            onChange={(e) => setVendorNote(e.target.value)}
                            placeholder="Instruksi K3, jadwal mulai kerja, dsb..."
                            className="block w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition resize-none"
                          />
                        </div>
                        <div className="flex items-center gap-3 pt-1">
                          <Button type="submit" variant="primary" loading={assigningVendor} disabled={!selectedVendorId}>
                            Simpan Pilihan Vendor
                          </Button>
                          {woDetail.vendor_company_id && woDetail.vendor_company_id === selectedVendorId && <span className="text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">Tersimpan pada WO ini</span>}
                        </div>
                      </div>
                      <div className="lg:col-span-2">
                        <VendorPreview vendor={vendors.find((v) => v.id === selectedVendorId)} />
                      </div>
                    </form>
                  ) : (
                    <div className="p-5 text-xs">
                      {assignedVendor ? <VendorPreview vendor={assignedVendor} /> : <p className="text-slate-600">Vendor belum ditentukan.</p>}
                    </div>
                  )}
                </section>
              )}

              {/* Tasks Table */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
                <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Daftar Tugas Pekerjaan Konstruksi
                  </h4>
                  <span className="text-xs font-mono text-slate-500">
                    {(woDetail.tasks || []).length} Item Pekerjaan
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                        <th className="py-2.5 px-3">No</th>
                        <th className="py-2.5 px-3">Grup</th>
                        <th className="py-2.5 px-3">Uraian Pekerjaan</th>
                        <th className="py-2.5 px-3">Satuan</th>
                        <th className="py-2.5 px-3 text-right">Volume</th>
                        {woDetail.tasks?.[0]?.amount !== null && (
                          <th className="py-2.5 px-3 text-right">Nilai RAB</th>
                        )}
                        <th className="py-2.5 px-3 text-center">Progres Terverifikasi</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                      {(woDetail.tasks || [])
                        .slice((taskPage - 1) * taskPerPage, taskPage * taskPerPage)
                        .map((t) => {
                        const pct = t.verified_percent ?? 0
                        return (
                          <tr key={t.id} className="hover:bg-slate-50/60">
                            <td className="py-2 px-3 font-mono">{t.sequence}</td>
                            <td className="py-2 px-3 font-mono font-semibold text-slate-500">
                              {t.group_code || '-'}
                            </td>
                            <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                              {t.title}
                            </td>
                            <td className="py-2 px-3">{t.unit}</td>
                            <td className="py-2 px-3 text-right font-mono font-semibold">
                              {t.volume?.toLocaleString('id-ID')}
                            </td>
                            {t.amount !== null && (
                              <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                                Rp {Math.round(t.amount).toLocaleString('id-ID')}
                              </td>
                            )}
                            <td className="py-2 px-3">
                              <div className="flex items-center gap-2 justify-center">
                                <div className="w-24 bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden border border-slate-200 dark:border-slate-700">
                                  <div
                                    className={`h-full rounded-full transition-all ${
                                      pct >= 100
                                        ? 'bg-emerald-500'
                                        : pct > 0
                                        ? 'bg-blue-600'
                                        : 'bg-transparent'
                                    }`}
                                    style={{ width: `${Math.min(100, Math.max(0, pct))}%` }}
                                  />
                                </div>
                                <span className="font-mono font-bold text-[11px] w-10 text-right">
                                  {pct}%
                                </span>
                              </div>
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>

                <TableFooter
                  itemCount={(woDetail.tasks || []).slice((taskPage - 1) * taskPerPage, taskPage * taskPerPage).length}
                  total={(woDetail.tasks || []).length}
                  entityLabel="item pekerjaan WO"
                  page={taskPage}
                  perPage={taskPerPage}
                  onPage={setTaskPage}
                  onPerPage={(n) => {
                    setTaskPerPage(n)
                    setTaskPage(1)
                  }}
                  perPageOptions={[10, 25, 50, 100]}
                />
              </div>

              {/* Progress Submissions & Verification Section */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
                <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Riwayat & Antrean Verifikasi Progres Fisik
                  </h4>
                  <span className="text-xs font-mono text-slate-500">
                    {(woDetail.progress || []).length} Pengajuan
                  </span>
                </div>

                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                        <th className="py-2.5 px-3">Tugas</th>
                        <th className="py-2.5 px-3 text-center">Kumulatif (%)</th>
                        <th className="py-2.5 px-3">Diajukan Oleh</th>
                        <th className="py-2.5 px-3">Waktu Pengajuan</th>
                        <th className="py-2.5 px-3">Catatan</th>
                        <th className="py-2.5 px-3">Status</th>
                        {canVerifyProgress && (
                          <th className="py-2.5 px-3 text-right">Aksi Verifikasi</th>
                        )}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                      {(woDetail.progress || []).length === 0 ? (
                        <tr>
                          <td colSpan={canVerifyProgress ? 7 : 6} className="py-8 text-center text-slate-400">
                            Belum ada laporan pengajuan progres fisik.
                          </td>
                        </tr>
                      ) : (
                        woDetail.progress
                          .slice((progPage - 1) * progPerPage, progPage * progPerPage)
                          .map((p) => {
                          const task = woDetail.tasks?.find((t) => t.id === p.task_id)
                          return (
                            <tr key={p.id} className="hover:bg-slate-50/60">
                              <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                                {task?.title || p.task_id}
                              </td>
                              <td className="py-2 px-3 text-center font-mono font-bold">
                                {p.cumulative_percent}%
                              </td>
                              <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                                {p.submitted_by_name || '-'}
                              </td>
                              <td className="py-2 px-3 text-slate-500 font-mono text-[11px]">
                                {new Date(p.submitted_at).toLocaleString('id-ID')}
                              </td>
                              <td className="py-2 px-3 text-slate-600 dark:text-slate-300 max-w-xs truncate">
                                {p.notes || '-'}
                                {p.return_reason && (
                                  <span className="block text-rose-600 text-[11px] italic">
                                    Alasan: {p.return_reason}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3">
                                <span
                                  className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                    p.status === 'VERIFIED'
                                      ? 'bg-emerald-100 text-emerald-800'
                                      : p.status === 'RETURNED'
                                      ? 'bg-rose-100 text-rose-800'
                                      : 'bg-amber-100 text-amber-800'
                                  }`}
                                >
                                  {p.status}
                                </span>
                              </td>
                              {canVerifyProgress && (
                                <td className="py-2 px-3 text-right">
                                  {p.status === 'SUBMITTED' && (
                                    <div className="flex items-center justify-end gap-1.5">
                                      <button
                                        type="button"
                                        onClick={() => handleVerifyProgress(p.id)}
                                        disabled={decidingProgress}
                                        className="px-2 py-1 rounded text-xs font-semibold bg-emerald-600 text-white hover:bg-emerald-700 cursor-pointer"
                                      >
                                        Verifikasi
                                      </button>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          setSelectedProgressId(p.id)
                                          setProgressReturnReason('')
                                          setReturnProgressModalOpen(true)
                                        }}
                                        className="px-2 py-1 rounded text-xs font-semibold text-rose-600 border border-rose-200 hover:bg-rose-50 cursor-pointer"
                                      >
                                        Kembalikan
                                      </button>
                                    </div>
                                  )}
                                </td>
                              )}
                            </tr>
                          )
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <TableFooter
                  itemCount={(woDetail.progress || []).slice((progPage - 1) * progPerPage, progPage * progPerPage).length}
                  total={(woDetail.progress || []).length}
                  entityLabel="pengajuan progres"
                  page={progPage}
                  perPage={progPerPage}
                  onPage={setProgPage}
                  onPerPage={(n) => {
                    setProgPerPage(n)
                    setProgPage(1)
                  }}
                  perPageOptions={[10, 25, 50, 100]}
                />
              </div>

              {/* Peringatan: material PLN yang belum teralokasi (tidak memblokir WO) */}
              {(woDetail.material_warning || []).length > 0 && (
                <Alert kind="warning">
                  <div className="font-semibold">Alokasi material belum lengkap ({woDetail.material_warning.length} item)</div>
                  <p className="text-[11px] mt-0.5">WO tetap dapat dilanjutkan. Material berikut belum teralokasi dari gudang; sisanya dapat dialokasikan lewat Tambah Alokasi di halaman usulan.</p>
                  <ul className="mt-1 text-[11px] font-mono list-disc ml-4">
                    {woDetail.material_warning.slice(0, 8).map((m) => (
                      <li key={m.khs_code}>{m.khs_code} {m.khs_name}: kurang {m.remaining} {m.unit_text || ''}</li>
                    ))}
                    {woDetail.material_warning.length > 8 && <li>… dan {woDetail.material_warning.length - 8} item lain</li>}
                  </ul>
                </Alert>
              )}

              {/* Materials Table */}
              <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
                <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Material Terkait SPK
                  </h4>
                  <span className="text-xs font-mono text-slate-500">
                    {(woDetail.materials || []).length} Item Material
                  </span>
                </div>
                <div className="max-h-96 overflow-y-auto">
                  <table className="min-w-full text-left text-xs">
                    <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 border-b border-slate-100 dark:border-slate-700 text-[11px] text-slate-500 font-semibold uppercase">
                      <tr>
                        <th className="py-2 px-3">Material</th>
                        <th className="py-2 px-3">Satuan</th>
                        <th className="py-2 px-3 text-right">Kuantitas</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {(woDetail.materials || []).map((m) => (
                        <tr key={m.khs_code}>
                          <td className="py-2 px-3 text-slate-900 dark:text-slate-100">{m.khs_name || m.khs_code}</td>
                          <td className="py-2 px-3 text-slate-500">{m.unit || '-'}</td>
                          <td className="py-2 px-3 text-right font-mono font-semibold text-slate-700 dark:text-slate-300">{m.quantity?.toLocaleString('id-ID')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Audit Events */}
              {woDetail.events && woDetail.events.length > 0 && (
                <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs p-4 space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <IconHistory size={14} />
                    <span>Riwayat Kejadian Audit SPK</span>
                  </h4>
                  <div className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                    {woDetail.events.map((e, idx) => (
                      <div key={idx} className="py-2 flex items-start justify-between gap-3">
                        <div>
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            {e.event_type}
                          </span>
                          {e.reason && (
                            <p className="text-slate-600 dark:text-slate-400 mt-0.5">
                              "{e.reason}"
                            </p>
                          )}
                        </div>
                        <div className="text-right shrink-0">
                          <span className="text-[11px] text-slate-500 font-mono block">
                            {new Date(e.occurred_at).toLocaleString('id-ID')}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {e.actor_name}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* DRAWER: Return WO (ASMAN) */}
      <Drawer
        open={returnModalOpen}
        title="Kembalikan SPK / Work Order"
        onClose={() => setReturnModalOpen(false)}
        size="max-w-xl"
      >
        <form onSubmit={handleReturnWo} className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            Kembalikan SPK / Work Order ke pembuat draf untuk perbaikan penunjukan vendor atau rincian pekerjaan.
          </p>

          <div>
            <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
              Alasan Pengembalian *
            </label>
            <textarea
              rows={3}
              required
              value={returnReason}
              onChange={(e) => setReturnReason(e.target.value)}
              placeholder="Jelaskan alasan pengembalian SPK..."
              className="block w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setReturnModalOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={deciding}
              disabled={!returnReason.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              Kembalikan WO
            </Button>
          </div>
        </form>
      </Drawer>

      {/* DRAWER: Submit Progress (Internal) */}
      <Drawer
        open={progressModalOpen}
        title="Laporkan Progres Fisik Pekerjaan"
        onClose={() => setProgressModalOpen(false)}
        size="max-w-xl"
      >
        <form onSubmit={handleSubmitProgress} className="space-y-4 text-xs">
          <div>
            <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
              Pilih Tugas Pekerjaan *
            </label>
            <select
              value={progressTaskId}
              onChange={(e) => setProgressTaskId(e.target.value)}
              className="block w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs"
              required
            >
              <option value="">-- Pilih Tugas --</option>
              {(woDetail?.tasks || []).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.sequence}. {t.title} ({t.volume} {t.unit} · Terverifikasi: {t.verified_percent}%)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
              Progres Fisik Kumulatif (%) * (0 s/d 100)
            </label>
            <input
              type="number"
              step="0.1"
              min="0"
              max="100"
              required
              value={progressPercent}
              onChange={(e) => setProgressPercent(e.target.value)}
              placeholder="Contoh: 50.0"
              className="block w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
              Catatan Progres Lapangan (Opsional)
            </label>
            <textarea
              rows={2}
              value={progressNotes}
              onChange={(e) => setProgressNotes(e.target.value)}
              placeholder="Keterangan pemasangan tiang, penarikan kabel..."
              className="block w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setProgressModalOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={submittingProgress}
              disabled={!progressTaskId || progressPercent === ''}
            >
              Kirim Progres
            </Button>
          </div>
        </form>
      </Drawer>

      {/* DRAWER: Return Progress */}
      <Drawer
        open={returnProgressModalOpen}
        title="Kembalikan Pengajuan Progres"
        onClose={() => setReturnProgressModalOpen(false)}
        size="max-w-xl"
      >
        <form onSubmit={handleReturnProgress} className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            Pengajuan progres yang dikembalikan memerlukan perbaikan kuantitas atau bukti lapangan dari pelapor.
          </p>

          <div>
            <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
              Alasan Pengembalian *
            </label>
            <textarea
              rows={3}
              required
              value={progressReturnReason}
              onChange={(e) => setProgressReturnReason(e.target.value)}
              placeholder="Contoh: Hasil pengukuran lapangan menunjukkan tiang belum terpasang..."
              className="block w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setReturnProgressModalOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={decidingProgress}
              disabled={!progressReturnReason.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              Kembalikan Progres
            </Button>
          </div>
        </form>
      </Drawer>

      {/* DRAWER: Amend WO */}
      <Drawer
        open={amendModalOpen}
        title="Amandemen SPK / Work Order"
        onClose={() => setAmendModalOpen(false)}
        size="max-w-xl"
      >
        <form onSubmit={handleAmendWo} className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            Mengamandemen SPK/WO akan menginisiasi versi baru untuk permohonan ini dengan menyalin tugas dan material yang ada.
          </p>

          <div>
            <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
              Alasan Amandemen *
            </label>
            <textarea
              rows={3}
              required
              value={amendReason}
              onChange={(e) => setAmendReason(e.target.value)}
              placeholder="Contoh: Penyesuaian jadwal pelaksanaan proyek atau volume pekerjaan..."
              className="block w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAmendModalOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={amending}
              disabled={!amendReason.trim()}
            >
              Buat Versi Amandemen
            </Button>
          </div>
        </form>
      </Drawer>

      {/* DRAWER: Cancel WO */}
      <Drawer
        open={cancelModalOpen}
        title="Batalkan SPK / Work Order"
        onClose={() => setCancelModalOpen(false)}
        size="max-w-xl"
      >
        <form onSubmit={handleCancelWo} className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            Apakah Anda yakin ingin membatalkan SPK / Work Order ini? Pembatalan memerlukan alasan resmi untuk catatan audit.
          </p>

          <div>
            <label className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">
              Alasan Pembatalan *
            </label>
            <textarea
              rows={3}
              required
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Contoh: Pelanggan membatalkan permohonan PB/PD..."
              className="block w-full px-3 py-2 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCancelModalOpen(false)}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="primary"
              size="sm"
              loading={cancelling}
              disabled={!cancelReason.trim()}
              className="bg-rose-600 hover:bg-rose-700 text-white"
            >
              Ya, Batalkan WO
            </Button>
          </div>
        </form>
      </Drawer>

      {/* BASTP Detail Drawer */}
      {selectedBastpId && (
        <BastpDetailDrawer
          bastpId={selectedBastpId}
          workOrder={woDetail}
          onClose={() => setSelectedBastpId(null)}
          onUpdated={() => {
            if (selectedWoId) loadWoDetail(selectedWoId)
          }}
        />
      )}
    </div>
  )
}
