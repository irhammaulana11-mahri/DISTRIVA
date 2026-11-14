import { useEffect, useState, useCallback } from 'react'
import ServiceSlaBadge from '../../components/ServiceSlaBadge.jsx'
import { mtoApi, masterDataApi, rabRunsApi } from '../../services/api.js'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import StatusBadge, { formatStatusLabel } from '../../components/StatusBadge.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Modal from '../../components/Modal.jsx'
import ConfirmationModal from '../../components/ConfirmationModal.jsx'
import OutputDocumentModal from '../../components/OutputDocumentModal.jsx'
import RabDryRunModal from './RabDryRunModal.jsx'
import RabRunDetailDrawer from './RabRunDetailDrawer.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import { formatRupiah } from '../../utils/kkfFormatters.js'
import {
  IconCalculator,
  IconCheck,
  IconX,
  IconPlus,
  IconTrash,
  IconRefresh,
  IconClock,
  IconCheckCircle,
  IconAlertCircle,
  IconDocument,
  IconUpload,
  IconSearch,
  IconEye,
} from '../../components/icons.jsx'

export const CONSTRUCTION_GROUPS = [
  { code: 'ALL', label: 'Semua Kelompok' },
  { code: 'SUTM', label: 'SUTM' },
  { code: 'MVTIC', label: 'MVTIC' },
  { code: 'SUTR', label: 'SUTR' },
  { code: 'SKTM', label: 'SKTM' },
  { code: 'KUBIKEL', label: 'Kubikel' },
  { code: 'GTT_UMUM', label: 'GTT Umum' },
  { code: 'GTT_KHUSUS', label: 'GTT Khusus' },
]

export const PBPD_JENIS_OPTIONS = ['PBPD', 'PD 6,6-23 KVA', 'PD 6,6-41,5', 'PD 33-41,5 KVA']
export const PBPD_PEMBAYARAN_OPTIONS = ['PLN', 'TUNAI']
export const PBPD_RENTANG_OPTIONS = ['', '450-5500 VA', '6,6-16,5 kVA', '23 kVA', '33 kVA', '41,5 kVA', '53-197 kVA']

export default function MtoPackageDetailView({
  packageId,
  drawingId,
  versionId,
  onBack,
  onReload,
  showRabRuns = false,
}) {
  const { user } = useAuth()
  const { can, isSysAdmin } = useAccess()
  const canRunRab = Boolean(can?.['rab.run'] || isSysAdmin)
  const canViewRab = Boolean(can?.['rab.view'] || isSysAdmin)
  const { notify } = useNotifications()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [mto, setMto] = useState(null)

  // Items and parameters form state
  const [items, setItems] = useState([])
  const [params, setParams] = useState({})
  const [changeReason, setChangeReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState('')

  // Filter Group Tab
  const [selectedGroup, setSelectedGroup] = useState('ALL')
  const [itemPage, setItemPage] = useState(1)
  const [itemPerPage, setItemPerPage] = useState(10)
  const [rabPage, setRabPage] = useState(1)
  const [rabPerPage, setRabPerPage] = useState(10)

  // Add Construction Type Modal
  const [addModalOpen, setAddModalOpen] = useState(false)
  const [loadingTypes, setLoadingTypes] = useState(false)
  const [availableTypes, setAvailableTypes] = useState([])
  const [typeSearch, setTypeSearch] = useState('')
  const [typeGroupFilter, setTypeGroupFilter] = useState('')

  // Calculate Modal (Pratinjau Kebutuhan Material KHS)
  const [calcModalOpen, setCalcModalOpen] = useState(false)
  const [calculating, setCalculating] = useState(false)
  const [calcResult, setCalcResult] = useState(null)
  const [calcError, setCalcError] = useState('')
  const [calcTotalsPage, setCalcTotalsPage] = useState(1)
  const [calcTotalsPerPage, setCalcTotalsPerPage] = useState(10)

  // Extract from Drawing Excel File Modal
  const [extractModalOpen, setExtractModalOpen] = useState(false)
  const [extracting, setExtracting] = useState(false)
  const [extractReason, setExtractReason] = useState('')
  const [extractReport, setExtractReport] = useState(null)
  const [extractError, setExtractError] = useState('')

  // Decision Modal (Manager ULP)
  const [decisionModalOpen, setDecisionModalOpen] = useState(false)
  const [decisionType, setDecisionType] = useState('APPROVED')
  const [decisionNotes, setDecisionNotes] = useState('')
  const [submittingDecision, setSubmittingDecision] = useState(false)
  const [decisionError, setDecisionError] = useState('')

  // Confirmation Modal (Verifikasi MTO)
  const [verifyConfirmOpen, setVerifyConfirmOpen] = useState(false)

  // Verifying state
  const [verifying, setVerifying] = useState(false)
  const [verifyError, setVerifyError] = useState('')

  // RAB Runs & Output Documents State (docs/70 & docs/57)
  const [rabRuns, setRabRuns] = useState([])
  const [loadingRabRuns, setLoadingRabRuns] = useState(false)
  const [runningRab, setRunningRab] = useState(false)
  const [dryRunningRab, setDryRunningRab] = useState(false)
  const [rabError, setRabError] = useState('')
  const [rabReferenceDate, setRabReferenceDate] = useState('')
  const [dryRunModalOpen, setDryRunModalOpen] = useState(false)
  const [dryRunData, setDryRunData] = useState(null)
  const [detailRunId, setDetailRunId] = useState(null)
  const [docModalConfig, setDocModalConfig] = useState({
    open: false,
    runId: null,
    type: 'rekap',
    category: 'rab',
    title: '',
  })

  // Load RAB runs for the package
  const loadRabRuns = useCallback(async (pkgId) => {
    const targetId = pkgId || packageId
    if (!targetId) return
    setLoadingRabRuns(true)
    setRabError('')
    try {
      const res = await rabRunsApi.listForPackage(targetId)
      setRabRuns(res?.data || [])
    } catch (err) {
      // 404 or no runs yet is non-fatal
    } finally {
      setLoadingRabRuns(false)
    }
  }, [packageId])

  const handleOpenDoc = (runId, type = 'rekap', title = '') => {
    setDocModalConfig({
      open: true,
      runId,
      type,
      category: 'rab',
      title,
    })
  }

  // Hitung RAB (Dry Run - Tanpa Menyimpan)
  const handleDryRunRab = async () => {
    const targetId = mto?.id || packageId
    if (!targetId) return
    setDryRunningRab(true)
    setRabError('')
    try {
      const res = await rabRunsApi.run(targetId, {
        dry_run: true,
        date: rabReferenceDate || undefined,
      })
      setDryRunData(res?.data)
      setDryRunModalOpen(true)
      notify({
        type: 'info',
        title: 'Simulasi RAB (Dry Run)',
        desc: `Kalkulasi RAB sementara: ${formatRupiah(res?.data?.grand_total || 0)} (tidak disimpan ke riwayat).`,
        tag: 'RAB',
      })
    } catch (err) {
      setRabError(err?.response?.data?.message || err?.message || 'Gagal menghitung simulasi RAB.')
    } finally {
      setDryRunningRab(false)
    }
  }

  // Simpan Run RAB Resmi
  const handleRunRab = async () => {
    const targetId = mto?.id || packageId
    if (!targetId) return
    setRunningRab(true)
    setRabError('')
    try {
      const res = await rabRunsApi.run(targetId, {
        dry_run: false,
        date: rabReferenceDate || undefined,
      })
      setDryRunModalOpen(false)
      notify({
        type: 'success',
        title: 'Run RAB Berhasil Disimpan',
        desc: `Kalkulasi RAB Run #${res?.data?.run_number || ''} sebesar ${formatRupiah(res?.data?.grand_total || 0)} berhasil disimpan.`,
        tag: 'RAB',
      })
      loadRabRuns(targetId)
    } catch (err) {
      setRabError(err?.response?.data?.message || err?.message || 'Gagal menghitung dan menyimpan run RAB.')
    } finally {
      setRunningRab(false)
    }
  }

  // Load MTO Package
  const loadMto = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      let res
      if (packageId) {
        res = await mtoApi.get(packageId)
      } else if (drawingId && versionId) {
        res = await mtoApi.forVersion(drawingId, versionId)
      } else {
        throw new Error('ID paket atau versi gambar tidak diberikan.')
      }

      const data = res.data
      setMto(data)
      if (data?.id && showRabRuns) {
        loadRabRuns(data.id)
      }
      if (data) {
        setItems(
          (data.items || []).map((i) => ({
            construction_code: i.construction_code,
            construction_label: i.construction_label,
            group: i.group,
            psg: Number(i.psg) || 0,
            bkr: Number(i.bkr) || 0,
            note: i.note || '',
            source: i.source || 'MANUAL',
            detected_psg: i.detected_psg !== null && i.detected_psg !== undefined ? Number(i.detected_psg) : null,
            detected_bkr: i.detected_bkr !== null && i.detected_bkr !== undefined ? Number(i.detected_bkr) : null,
          }))
        )
        setParams(data.params || {})
      }
    } catch (err) {
      setError(err.message || 'Gagal memuat detail paket MTO.')
    } finally {
      setLoading(false)
    }
  }, [packageId, drawingId, versionId])

  useEffect(() => {
    loadMto()
  }, [loadMto])

  // Check if reason is required (if package already has items or past change events)
  const isReasonRequired = Boolean(
    mto &&
    (mto.items?.length > 0 || mto.events?.some((e) => e.event_type === 'ITEMS_CHANGED'))
  )

  // Handle Save Items & Params (PUT /mto/{id}/items)
  const handleSaveItems = async (e) => {
    e?.preventDefault()
    if (!mto?.can?.edit) return

    if (isReasonRequired && !changeReason.trim()) {
      setSaveError('Alasan perubahan wajib diisi untuk audit trail perubahan item MTO.')
      return
    }

    setSaving(true)
    setSaveError('')

    try {
      const payload = {
        items: items.map((it) => ({
          construction_code: it.construction_code,
          psg: Number(it.psg) || 0,
          bkr: Number(it.bkr) || 0,
          note: it.note?.trim() || undefined,
        })),
        params,
        reason: changeReason.trim() || undefined,
      }

      const res = await mtoApi.updateItems(mto.id, payload)
      setMto(res.data)
      setChangeReason('')
      notify({
        type: 'success',
        title: 'Item MTO Disimpan',
        desc: 'Draf item MTO berhasil disimpan.',
        tag: 'MTO',
      })
      onReload?.()
    } catch (err) {
      setSaveError(err.message || 'Gagal menyimpan draf item MTO.')
    } finally {
      setSaving(false)
    }
  }

  // Handle Item Field Changes
  const handleItemChange = (code, field, value) => {
    setItems((prev) =>
      prev.map((it) => {
        if (it.construction_code !== code) return it
        const updated = { ...it, [field]: value }
        // If user changed psg or bkr, mark source as MANUAL
        if ((field === 'psg' || field === 'bkr') && it.source === 'EXTRACTED') {
          updated.source = 'MANUAL'
        }
        return updated
      })
    )
  }

  // Handle Remove Item
  const handleRemoveItem = (code) => {
    setItems((prev) => prev.filter((it) => it.construction_code !== code))
  }

  // Load available construction types for adding
  const handleOpenAddModal = async () => {
    setAddModalOpen(true)
    setLoadingTypes(true)
    setTypeSearch('')
    try {
      const res = await masterDataApi.constructionTypes({ per_page: 100 })
      setAvailableTypes(res.data || [])
    } catch {
      setAvailableTypes([])
    } finally {
      setLoadingTypes(false)
    }
  }

  // Add construction type to items list
  const handleAddConstructionType = (t) => {
    if (items.some((it) => it.construction_code === t.code)) return
    const activeVer = t.active_version || t.current || {}
    const label = t.name || t.current?.name || activeVer.name || t.construction_label || t.label || t.code
    setItems((prev) => [
      ...prev,
      {
        construction_code: t.code,
        construction_label: label,
        group: t.group_code || t.group,
        psg: 0,
        bkr: 0,
        note: '',
        source: 'MANUAL',
        detected_psg: null,
        detected_bkr: null,
      },
    ])
    setAddModalOpen(false)
  }

  // Handle Calculate (POST /mto/{id}/calculate)
  const handleOpenCalculate = async () => {
    setCalcModalOpen(true)
    setCalculating(true)
    setCalcError('')
    setCalcResult(null)
    try {
      const res = await mtoApi.calculate(mto.id)
      setCalcResult(res.data)
    } catch (err) {
      setCalcError(err.message || 'Gagal menghitung kebutuhan material.')
    } finally {
      setCalculating(false)
    }
  }

  // Handle Extract (POST /mto/{id}/extract)
  const handleRunExtract = async (e) => {
    e?.preventDefault()
    if (isReasonRequired && !extractReason.trim()) {
      setExtractError('Alasan penimpaan data wajib diisi.')
      return
    }

    setExtracting(true)
    setExtractError('')
    try {
      const res = await mtoApi.extract(mto.id, {
        reason: extractReason.trim() || undefined,
      })
      setMto(res.data)
      setExtractReport(res.extraction)
      setExtractReason('')
      loadMto()
      onReload?.()
    } catch (err) {
      setExtractError(err.message || 'Gagal mengekstrak data dari berkas gambar.')
    } finally {
      setExtracting(false)
    }
  }

  // Handle Verify (POST /mto/{id}/verify)
  const handleVerify = () => {
    setVerifyConfirmOpen(true)
  }

  const handleConfirmVerify = async () => {
    setVerifying(true)
    setVerifyError('')
    try {
      const res = await mtoApi.verify(mto.id)
      setMto(res.data)
      notify({
        type: 'success',
        title: 'Paket MTO Diverifikasi',
        desc: 'Paket MTO berhasil diverifikasi dan kini menunggu persetujuan Manajer ULP.',
        tag: 'MTO',
      })
      loadMto()
      onReload?.()
      setVerifyConfirmOpen(false)
    } catch (err) {
      setVerifyError(err.message || 'Gagal memverifikasi paket MTO.')
    } finally {
      setVerifying(false)
    }
  }

  // Handle Decision Modal (Manager ULP)
  const handleOpenDecision = (type) => {
    setDecisionType(type)
    setDecisionNotes('')
    setDecisionError('')
    setDecisionModalOpen(true)
  }

  const handleSubmitDecision = async (e) => {
    e.preventDefault()
    if (decisionType === 'REJECTED' && !decisionNotes.trim()) {
      setDecisionError('Alasan penolakan wajib diisi untuk catatan audit trail.')
      return
    }

    setSubmittingDecision(true)
    setDecisionError('')
    try {
      const res = await mtoApi.decide(mto.id, {
        decision: decisionType,
        notes: decisionNotes.trim() || undefined,
      })
      notify({
        type: decisionType === 'APPROVED' ? 'success' : 'warning',
        title: decisionType === 'APPROVED' ? 'Paket MTO Disetujui' : 'Paket MTO Ditolak',
        desc: `Paket MTO permohonan ${mto?.application?.registration_number || ''} telah ${decisionType === 'APPROVED' ? 'disetujui' : 'ditolak'}.`,
        tag: 'MTO',
      })
      setMto(res.data)
      setDecisionModalOpen(false)
      loadMto()
      onReload?.()
    } catch (err) {
      setDecisionError(err.message || 'Gagal menyimpan keputusan MTO.')
    } finally {
      setSubmittingDecision(false)
    }
  }

  // Filter items by selected tab group
  const filteredItems = items.filter((it) => {
    if (selectedGroup === 'ALL') return true
    return it.group === selectedGroup
  })

  // Group items by construction group for totals summary
  const groupCounts = items.reduce((acc, it) => {
    acc[it.group] = (acc[it.group] || 0) + 1
    return acc
  }, {})

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Spinner label="Memuat rincian paket MTO..." />
      </div>
    )
  }

  if (error || !mto) {
    return (
      <div className="space-y-4 p-4">
        {onBack && (
          <button type="button" onClick={onBack} className="text-xs font-semibold text-slate-500 hover:text-slate-800">
            ← Kembali
          </button>
        )}
        <Alert kind="error">{error || 'Paket MTO tidak ditemukan.'}</Alert>
      </div>
    )
  }

  const canEdit = Boolean(mto.can?.edit)
  const canVerify = Boolean(mto.can?.verify)
  const canDecide = Boolean(mto.can?.decide)

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-semibold mr-1 cursor-pointer"
              >
                ← Kembali
              </button>
            )}
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Paket MTO #{mto.package_number}
            </h3>
            <StatusBadge status={mto.status} />
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Permohonan: <strong className="text-slate-700 dark:text-slate-300">{mto.application?.application_number}</strong> · Versi Gambar: v{mto.drawing_version?.version_number} ({mto.drawing_version?.status})
          </p>
          <ServiceSlaBadge applicationId={mto.application?.id} className="mt-1" />
        </div>

        {/* Global Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          {canEdit && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setExtractModalOpen(true)
                setExtractReason('')
                setExtractError('')
                setExtractReport(null)
              }}
            >
              <IconDocument size={14} className="mr-1 text-blue-600 dark:text-blue-400" />
              Isi dari Berkas Gambar
            </Button>
          )}

          <Button variant="secondary" size="sm" onClick={handleOpenCalculate}>
            <IconCalculator size={14} className="mr-1 text-slate-600 dark:text-slate-300" />
            Hitung Kebutuhan KHS
          </Button>

          {canVerify && (
            <Button
              variant="primary"
              size="sm"
              loading={verifying}
              onClick={handleVerify}
            >
              <IconCheckCircle size={14} className="mr-1" />
              Verifikasi MTO
            </Button>
          )}

          {canDecide && (
            <div className="flex items-center gap-2" title="MTO juga ikut disetujui otomatis saat Manager ULP menyetujui gambar pada halaman gambar.">
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleOpenDecision('APPROVED')}
              >
                <IconCheck size={14} className="mr-1" />
                Setujui MTO
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={() => handleOpenDecision('REJECTED')}
              >
                <IconX size={14} className="mr-1" />
                Tolak MTO
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Global Alerts */}
      {saveError && <Alert kind="error">{saveError}</Alert>}
      {verifyError && <Alert kind="error">{verifyError}</Alert>}

      {/* Package Status & Snapshot Metadata Banner */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 text-xs">
        <div>
          <span className="text-slate-400 block mb-0.5">Penyusun (TEKNIK):</span>
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            {mto.created_by?.name || '-'}
          </span>
          <span className="text-[11px] text-slate-400 block">{mto.created_by?.email}</span>
        </div>

        <div>
          <span className="text-slate-400 block mb-0.5">Pemeriksa Verifikasi:</span>
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            {mto.verified_by?.name || 'Belum diverifikasi'}
          </span>
          <span className="text-[10px] text-slate-400 block">
            {mto.verified_at ? new Date(mto.verified_at).toLocaleString('id-ID') : '-'}
          </span>
        </div>

        <div>
          <span className="text-slate-400 block mb-0.5">Penyetuju (Manager ULP):</span>
          <span className="font-semibold text-slate-800 dark:text-slate-200">
            {mto.approved_by?.name || (mto.status === 'APPROVED' ? 'Disetujui' : 'Menunggu')}
          </span>
          <span className="text-[10px] text-slate-400 block">
            {mto.approved_at ? new Date(mto.approved_at).toLocaleString('id-ID') : '-'}
          </span>
        </div>

        <div>
          <span className="text-slate-400 block mb-0.5">Validitas & Kode Hash Data:</span>
          {mto.snapshot_hash ? (
            <div className="flex items-center gap-1.5 mt-0.5">
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                {mto.snapshot_hash.slice(0, 8)}…
              </span>
              <span className="text-[10px] text-emerald-600 font-bold">Terkunci</span>
            </div>
          ) : (
            <span className="text-slate-500 italic">Draf Dinamis (Belum dikunci)</span>
          )}
          {mto.valid_on && (
            <span className="text-[10px] text-slate-400 block mt-0.5">
              Berlaku per: {new Date(mto.valid_on).toLocaleDateString('id-ID')}
            </span>
          )}
        </div>
      </div>

      {/* Declared BOM & PB/PD Parameters Form */}
      {(mto.declared_params?.length > 0 || Object.keys(params).length > 0 || canEdit) && (
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Parameter Perhitungan BOM & Sambungan Pelanggan (PB/PD)
              </h4>
              <p className="text-[11px] text-slate-400">
                Variabel parameter dinamis yang digunakan oleh mesin BOM untuk menghitung kebutuhan material khusus.
              </p>
            </div>
            {canEdit && !Object.keys(params).some((k) => k.startsWith('PBPD:')) && (
              <button
                type="button"
                onClick={() =>
                  setParams((prev) => ({
                    ...prev,
                    'PBPD:JENIS': 'PBPD',
                    'PBPD:PEMBAYARAN': 'PLN',
                    'PBPD:RENTANG_1': '450-5500 VA',
                    'PBPD:PSG_1': 1,
                    'PBPD:BKR_1': 0,
                  }))
                }
                className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-blue-50 text-blue-600 hover:bg-blue-100 dark:bg-blue-950/50 dark:text-blue-400 cursor-pointer self-start sm:self-auto transition-colors"
              >
                + Aktifkan Parameter PB/PD
              </button>
            )}
          </div>

          {/* Declared BOM parameters */}
          {mto.declared_params?.length > 0 && (
            <div className="space-y-2">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                Parameter Dideklarasikan ({mto.declared_params.length})
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {mto.declared_params.map((dp) => (
                  <div key={dp.name}>
                    <label
                      htmlFor={`param-${dp.name}`}
                      className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                    >
                      {dp.name} ({dp.group})
                    </label>
                    {dp.description && (
                      <p className="text-[10px] text-slate-400 mb-1">{dp.description}</p>
                    )}
                    {dp.options && dp.options.length > 0 ? (
                      <select
                        id={`param-${dp.name}`}
                        disabled={!canEdit}
                        value={params[dp.name] !== undefined ? params[dp.name] : (dp.default ?? '')}
                        onChange={(e) => setParams({ ...params, [dp.name]: e.target.value })}
                        className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus-ring disabled:opacity-60"
                      >
                        {dp.options.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    ) : dp.type === 'text' ? (
                      <input
                        id={`param-${dp.name}`}
                        type="text"
                        disabled={!canEdit}
                        value={params[dp.name] !== undefined ? params[dp.name] : (dp.default ?? '')}
                        onChange={(e) => setParams({ ...params, [dp.name]: e.target.value })}
                        className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus-ring disabled:opacity-60"
                      />
                    ) : (
                      <input
                        id={`param-${dp.name}`}
                        type="number"
                        min="0"
                        step="0.001"
                        disabled={!canEdit}
                        value={params[dp.name] !== undefined ? params[dp.name] : dp.default}
                        onChange={(e) => setParams({ ...params, [dp.name]: Number(e.target.value) || 0 })}
                        className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus-ring disabled:opacity-60"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* PB/PD & Extra Parameters (if present in params) */}
          {Object.keys(params).filter((k) => !mto.declared_params?.some((dp) => dp.name === k)).length > 0 && (
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-400 uppercase tracking-wider">
                Parameter Sambungan Standar PB/PD
              </span>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {Object.keys(params)
                  .filter((k) => !mto.declared_params?.some((dp) => dp.name === k))
                  .map((key) => {
                    if (key === 'PBPD:JENIS') {
                      return (
                        <div key={key}>
                          <label
                            htmlFor={`extra-${key}`}
                            className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Jenis Transaksi ({key})
                          </label>
                          <select
                            id={`extra-${key}`}
                            disabled={!canEdit}
                            value={params[key] || 'PBPD'}
                            onChange={(e) => setParams({ ...params, [key]: e.target.value })}
                            className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus-ring disabled:opacity-60"
                          >
                            {PBPD_JENIS_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </div>
                      )
                    }

                    if (key === 'PBPD:PEMBAYARAN') {
                      return (
                        <div key={key}>
                          <label
                            htmlFor={`extra-${key}`}
                            className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Skema Pembayaran ({key})
                          </label>
                          <select
                            id={`extra-${key}`}
                            disabled={!canEdit}
                            value={params[key] || 'PLN'}
                            onChange={(e) => setParams({ ...params, [key]: e.target.value })}
                            className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus-ring disabled:opacity-60"
                          >
                            {PBPD_PEMBAYARAN_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt}</option>
                            ))}
                          </select>
                        </div>
                      )
                    }

                    if (key.startsWith('PBPD:RENTANG_')) {
                      return (
                        <div key={key}>
                          <label
                            htmlFor={`extra-${key}`}
                            className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                          >
                            Rentang Daya ({key})
                          </label>
                          <select
                            id={`extra-${key}`}
                            disabled={!canEdit}
                            value={params[key] || ''}
                            onChange={(e) => setParams({ ...params, [key]: e.target.value })}
                            className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus-ring disabled:opacity-60"
                          >
                            {PBPD_RENTANG_OPTIONS.map((opt) => (
                              <option key={opt} value={opt}>{opt || '— Kosong —'}</option>
                            ))}
                          </select>
                        </div>
                      )
                    }

                    const isNumeric = key.startsWith('PBPD:PSG_') || key.startsWith('PBPD:BKR_') || typeof params[key] === 'number'

                    return (
                      <div key={key}>
                        <label
                          htmlFor={`extra-${key}`}
                          className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                        >
                          {key}
                        </label>
                        {isNumeric ? (
                          <input
                            id={`extra-${key}`}
                            type="number"
                            min="0"
                            step="0.001"
                            disabled={!canEdit}
                            value={params[key] !== undefined ? params[key] : 0}
                            onChange={(e) => setParams({ ...params, [key]: Number(e.target.value) || 0 })}
                            className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus-ring disabled:opacity-60"
                          />
                        ) : (
                          <input
                            id={`extra-${key}`}
                            type="text"
                            disabled={!canEdit}
                            value={params[key] || ''}
                            onChange={(e) => setParams({ ...params, [key]: e.target.value })}
                            className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-900 dark:text-slate-100 focus-ring disabled:opacity-60"
                          />
                        )}
                      </div>
                    )
                  })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Main Table: Construction Types & Quantities */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
        {/* Table Toolbar & Group Filter Tabs */}
        <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            {CONSTRUCTION_GROUPS.map((g) => {
              const count = g.code === 'ALL' ? items.length : groupCounts[g.code] || 0
              return (
                <button
                  key={g.code}
                  type="button"
                  onClick={() => setSelectedGroup(g.code)}
                  className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 cursor-pointer ${
                    selectedGroup === g.code
                      ? 'bg-blue-600 text-white shadow-2xs'
                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <span>{g.label}</span>
                  {count > 0 && (
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full ${
                      selectedGroup === g.code ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300'
                    }`}>
                      {count}
                    </span>
                  )}
                </button>
              )
            })}
          </div>

          {canEdit && (
            <Button
              variant="secondary"
              size="sm"
              onClick={handleOpenAddModal}
            >
              <IconPlus size={14} className="mr-1" />
              Tambah Jenis Konstruksi
            </Button>
          )}
        </div>

        {/* Construction Items Table */}
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs data-table">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase">
              <tr>
                <th className="py-2.5 px-4">Kelompok</th>
                <th className="py-2.5 px-4">Uraian Konstruksi</th>
                <th className="py-2.5 px-4 w-32">Pasang (Psg)</th>
                <th className="py-2.5 px-4 w-32">Bongkar (Bkr)</th>
                <th className="py-2.5 px-4">Sumber</th>
                <th className="py-2.5 px-4">Catatan</th>
                {canEdit && <th className="py-2.5 px-4 text-right">Aksi</th>}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {filteredItems.length === 0 ? (
                <tr>
                  <td colSpan={canEdit ? 7 : 6} className="py-8 text-center text-slate-400 italic">
                    {items.length === 0
                      ? 'Belum ada jenis konstruksi. Gunakan tombol "Isi dari Berkas Gambar" atau "+ Tambah Jenis Konstruksi".'
                      : 'Tidak ada jenis konstruksi pada kelompok ini.'}
                  </td>
                </tr>
              ) : (
                filteredItems
                  .slice((itemPage - 1) * itemPerPage, itemPage * itemPerPage)
                  .map((it) => {
                  const hasDiffPsg = it.detected_psg !== null && it.detected_psg !== it.psg
                  const hasDiffBkr = it.detected_bkr !== null && it.detected_bkr !== it.bkr

                  return (
                    <tr key={it.construction_code} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                      <td className="py-2.5 px-4 font-semibold text-slate-700 dark:text-slate-300">
                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[10px] font-mono">
                          {it.group}
                        </span>
                      </td>

                      <td className="py-2.5 px-4">
                        <div className="font-semibold text-slate-900 dark:text-slate-100" title={it.construction_code}>
                          {it.construction_label || it.construction_code}
                        </div>
                      </td>

                      <td className="py-2.5 px-4">
                        {canEdit ? (
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            value={it.psg}
                            onChange={(e) => handleItemChange(it.construction_code, 'psg', Number(e.target.value) || 0)}
                            className="block w-full px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring font-mono"
                          />
                        ) : (
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            {it.psg}
                          </span>
                        )}
                        {hasDiffPsg && (
                          <span className="text-[10px] text-amber-600 block mt-0.5" title="Nilai terbaca dari berkas">
                            Terbaca: {it.detected_psg}
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-4">
                        {canEdit ? (
                          <input
                            type="number"
                            min="0"
                            step="0.001"
                            value={it.bkr}
                            onChange={(e) => handleItemChange(it.construction_code, 'bkr', Number(e.target.value) || 0)}
                            className="block w-full px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring font-mono"
                          />
                        ) : (
                          <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                            {it.bkr}
                          </span>
                        )}
                        {hasDiffBkr && (
                          <span className="text-[10px] text-amber-600 block mt-0.5" title="Nilai terbaca dari berkas">
                            Terbaca: {it.detected_bkr}
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-4">
                        {it.source === 'EXTRACTED' ? (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                            Dari berkas
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                            Manual
                          </span>
                        )}
                      </td>

                      <td className="py-2.5 px-4">
                        {canEdit ? (
                          <input
                            type="text"
                            value={it.note}
                            onChange={(e) => handleItemChange(it.construction_code, 'note', e.target.value)}
                            placeholder="Catatan..."
                            className="block w-full px-2 py-1 text-xs rounded border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
                          />
                        ) : (
                          <span className="text-slate-500 italic">{it.note || '-'}</span>
                        )}
                      </td>

                      {canEdit && (
                        <td className="py-2.5 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => handleRemoveItem(it.construction_code)}
                            title="Hapus Baris"
                            className="p-1 rounded text-slate-400 hover:text-rose-600 transition cursor-pointer"
                          >
                            <IconTrash size={15} />
                          </button>
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
          itemCount={filteredItems.slice((itemPage - 1) * itemPerPage, itemPage * itemPerPage).length}
          total={filteredItems.length}
          entityLabel="jenis konstruksi MTO"
          page={itemPage}
          perPage={itemPerPage}
          onPage={setItemPage}
          onPerPage={(n) => {
            setItemPerPage(n)
            setItemPage(1)
          }}
          perPageOptions={[10, 25, 50, 100]}
        />

        {/* Save Draf Section with Reason input */}
        {canEdit && items.length > 0 && (
          <div className="p-4 bg-slate-50 dark:bg-slate-800/40 border-t border-slate-200 dark:border-slate-800 space-y-3">
            {isReasonRequired && (
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Alasan Perubahan Isian MTO <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={changeReason}
                  onChange={(e) => setChangeReason(e.target.value)}
                  placeholder="Wajib diisi: contoh revisi tiang ujung karena penyesuaian lokasi..."
                  className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
                />
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Setiap perubahan jumlah pasang/bongkar setelah penyimpanan pertama wajib menyertakan alasan untuk catatan audit trail.
                </p>
              </div>
            )}

            <div className="flex items-center justify-between">
              <span className="text-xs text-slate-500">
                Total {items.length} item jenis konstruksi terdaftar
              </span>
              <Button
                variant="primary"
                size="sm"
                loading={saving}
                onClick={handleSaveItems}
              >
                Simpan Draf MTO
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Riwayat Run RAB & Dokumen Keluaran (docs/70, docs/74 & docs/62 §21, §28) */}
      {/* RAB dihitung dan dilihat di tab Kelayakan Finansial usulan; section ini hanya tampil bila showRabRuns diaktifkan */}
      {showRabRuns && (
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-2">
          <div>
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <IconCalculator size={16} />
              <span>Kalkulasi & Riwayat Run RAB ({rabRuns.length} tersimpan)</span>
            </h4>
            <p className="text-[11px] text-slate-500">
              Kalkulasi anggaran biaya berdasarkan data paket MTO disetujui, buku harga kontrak, dan zona UP3.
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {/* Tanggal Acuan Opsional */}
            {mto?.status === 'APPROVED' && (
              <div className="flex items-center gap-1">
                <span className="text-[10px] text-slate-400 font-medium">Tgl Acuan:</span>
                <input
                  type="date"
                  value={rabReferenceDate}
                  onChange={(e) => setRabReferenceDate(e.target.value)}
                  className="px-2 py-1 text-base sm:text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                  title="Tanggal acuan buku harga (bawaan: hari ini)"
                />
              </div>
            )}

            <button
              type="button"
              onClick={() => loadRabRuns(mto?.id)}
              disabled={loadingRabRuns}
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 inline-flex items-center gap-1 px-2 py-1"
            >
              <IconRefresh size={12} className={loadingRabRuns ? 'animate-spin' : ''} />
              <span>Segarkan</span>
            </button>

            {mto?.status === 'APPROVED' && (
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={dryRunningRab}
                  onClick={handleDryRunRab}
                  icon={IconCalculator}
                >
                  Hitung RAB (Dry Run)
                </Button>

                {canRunRab && (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={runningRab}
                    onClick={handleRunRab}
                    icon={IconCalculator}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    Simpan Run RAB
                  </Button>
                )}
              </>
            )}
          </div>
        </div>

        {rabError && (
          <Alert variant="danger">{rabError}</Alert>
        )}

        {loadingRabRuns ? (
          <div className="py-6 text-center text-slate-400">
            <Spinner size="sm" label="Memuat riwayat run RAB..." />
          </div>
        ) : rabRuns.length === 0 ? (
          <div className="p-6 text-center text-slate-400 dark:text-slate-500 text-xs bg-slate-50/50 dark:bg-slate-800/30 rounded-lg">
            {mto?.status === 'APPROVED'
              ? 'Belum ada run RAB yang tersimpan untuk paket MTO ini. Gunakan tombol "Hitung RAB (Dry Run)" untuk simulasi atau "Simpan Run RAB" untuk menyimpan run baru.'
              : 'Paket MTO belum disetujui (APPROVED). Run RAB hanya dapat dihitung setelah paket MTO disetujui oleh Manager ULP.'}
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                  <th className="py-2.5 px-3">Run</th>
                  <th className="py-2.5 px-3">Tanggal Berlaku</th>
                  <th className="py-2.5 px-3">Zona UP3</th>
                  <th className="py-2.5 px-3 text-right">Total RAB</th>
                  <th className="py-2.5 px-3">Buku Harga</th>
                  <th className="py-2.5 px-3">Dibuat Oleh</th>
                  <th className="py-2.5 px-3 text-right">Aksi & Dokumen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono text-[11px]">
                {rabRuns
                  .slice((rabPage - 1) * rabPerPage, rabPage * rabPerPage)
                  .map((r) => (
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
                    <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">
                      Zona {r.zone || '-'}
                    </td>
                    <td className="py-2.5 px-3 text-right font-semibold text-emerald-600 dark:text-emerald-400">
                      {formatRupiah(r.grand_total)}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 font-sans text-[11px] truncate max-w-xs">
                      {r.price_book_name || '-'}
                    </td>
                    <td className="py-2.5 px-3 text-slate-500 font-sans text-[10px]">
                      {r.created_by_name || '-'}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => setDetailRunId(r.id)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 transition"
                          title="Lihat Detail Baris Komponen RAB"
                        >
                          <IconEye size={12} />
                          <span>Detail</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenDoc(r.id, 'rekap', `RAB Rekap #${r.run_number}`)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-blue-200 dark:border-blue-800 transition"
                          title="Pratinjau, Cetak & Unduh Dokumen REKAP RAB"
                        >
                          <IconDocument size={12} />
                          <span>REKAP</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOpenDoc(r.id, 'rinci', `RAB Rekap Rinci #${r.run_number}`)}
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-semibold text-blue-700 dark:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/30 border border-blue-200 dark:border-blue-800 transition"
                          title="Pratinjau, Cetak & Unduh Dokumen REKAP RINCI RAB"
                        >
                          <IconDocument size={12} />
                          <span>REKAP RINCI</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <TableFooter
              itemCount={rabRuns.slice((rabPage - 1) * rabPerPage, rabPage * rabPerPage).length}
              total={rabRuns.length}
              entityLabel="run kalkulasi RAB"
              page={rabPage}
              perPage={rabPerPage}
              onPage={setRabPage}
              onPerPage={(n) => {
                setRabPerPage(n)
                setRabPage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          </div>
        )}
      </div>
      )}

      {/* Events Audit Trail (docs/63 §F butir 7) */}
      {mto.events?.length > 0 && (
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-100 dark:border-slate-800 pb-2">
            Riwayat Kejadian MTO (Audit Trail)
          </h4>
          <div className="relative pl-4 space-y-3 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-700">
            {mto.events.map((ev, idx) => (
              <div key={idx} className="relative text-xs">
                <div className="absolute -left-4 top-1 w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-white dark:border-slate-900" />
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {ev.event_type}
                  </span>
                  <span className="text-[10px] text-slate-400">
                    {ev.occurred_at ? new Date(ev.occurred_at).toLocaleString('id-ID') : '-'}
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Pelaku: <span className="font-semibold">{ev.actor_name}</span> ({ev.actor_email})
                </p>
                {ev.reason && (
                  <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 italic bg-slate-50 dark:bg-slate-800/60 p-1.5 rounded">
                    &ldquo;{ev.reason}&rdquo;
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* MODAL 1: Add Construction Type */}
      <Modal
        open={addModalOpen}
        title="Pilih Jenis Konstruksi Standar PLN"
        onClose={() => setAddModalOpen(false)}
        maxWidth="max-w-2xl"
        footer={
          <Button variant="ghost" onClick={() => setAddModalOpen(false)}>
            Tutup
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="relative flex-1">
              <IconSearch size={15} className="absolute left-3 top-2.5 text-slate-400" />
              <input
                type="text"
                placeholder="Cari uraian atau nama konstruksi..."
                value={typeSearch}
                onChange={(e) => setTypeSearch(e.target.value)}
                className="block w-full pl-9 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
              />
            </div>
            <select
              value={typeGroupFilter}
              onChange={(e) => setTypeGroupFilter(e.target.value)}
              className="px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 cursor-pointer"
            >
              <option value="">Semua Kelompok</option>
              {CONSTRUCTION_GROUPS.filter((g) => g.code !== 'ALL').map((g) => (
                <option key={g.code} value={g.code}>{g.label}</option>
              ))}
            </select>
          </div>

          {loadingTypes ? (
            <div className="p-8 text-center"><Spinner /></div>
          ) : (
            <div className="max-h-72 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 border rounded-lg">
              {availableTypes
                .filter((t) => {
                  const grp = t.group_code || t.group
                  if (typeGroupFilter && grp !== typeGroupFilter) return false
                  if (!typeSearch) return true
                  const s = typeSearch.toLowerCase()
                  const name = (t.name || t.current?.name || t.active_version?.name || t.construction_label || t.label || '').toLowerCase()
                  const code = (t.code || '').toLowerCase()
                  return name.includes(s) || code.includes(s)
                })
                .map((t) => {
                  const isAdded = items.some((it) => it.construction_code === t.code)
                  const constructionName = t.name || t.current?.name || t.active_version?.name || t.construction_label || t.label || t.code
                  const grpCode = t.group_code || t.group || ''
                  const groupObj = CONSTRUCTION_GROUPS.find((g) => g.code === grpCode)
                  return (
                    <div
                      key={t.id}
                      className="p-2.5 flex items-center justify-between hover:bg-slate-50 dark:hover:bg-slate-800/40 text-xs gap-3"
                    >
                      <div className="min-w-0 flex-1">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 truncate" title={constructionName}>
                          {constructionName}
                        </div>
                        {grpCode && (
                          <div className="text-[11px] text-slate-500 mt-0.5">
                            {groupObj?.label || grpCode}
                          </div>
                        )}
                      </div>

                      <Button
                        size="sm"
                        variant={isAdded ? 'ghost' : 'secondary'}
                        disabled={isAdded}
                        onClick={() => handleAddConstructionType(t)}
                        className="shrink-0"
                      >
                        {isAdded ? 'Sudah Ada' : '+ Tambah'}
                      </Button>
                    </div>
                  )
                })}
            </div>
          )}
        </div>
      </Modal>

      {/* MODAL 2: Calculate KHS Requirements Preview */}
      <Modal
        open={calcModalOpen}
        title="Pratinjau Kebutuhan Material KHS (Mesin BOM)"
        onClose={() => setCalcModalOpen(false)}
        maxWidth="max-w-4xl"
        footer={
          <Button variant="ghost" onClick={() => setCalcModalOpen(false)}>
            Tutup
          </Button>
        }
      >
        <div className="space-y-4 text-xs">
          {calculating && <div className="p-8 text-center"><Spinner label="Menghitung koefisien BOM..." /></div>}
          {calcError && <Alert kind="error">{calcError}</Alert>}

          {calcResult && (
            <div className="space-y-4">
              <div className="flex items-center justify-between pb-2 border-b border-slate-200 dark:border-slate-800">
                <span className="text-slate-500">
                  Tanggal Berlaku: <strong>{calcResult.valid_on}</strong>
                </span>
                {calcResult.frozen && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
                    Snapshot Beku (Frozen)
                  </span>
                )}
              </div>

              {/* Totals Summary Table */}
              <div>
                <h5 className="font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-2 text-[11px]">
                  Total Kebutuhan Material per Kode KHS ({calcResult.totals?.length || 0})
                </h5>
                <div className="max-h-64 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xs">
                  <table className="min-w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 dark:bg-slate-800/90 backdrop-blur-xs text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 sticky top-0 z-10">
                      <tr>
                        <th className="py-2.5 px-3 w-28">Kode KHS</th>
                        <th className="py-2.5 px-3 min-w-[220px]">Uraian Material KHS</th>
                        <th className="py-2.5 px-3 w-20 text-center">Satuan</th>
                        <th className="py-2.5 px-3 w-24 text-right">Material</th>
                        <th className="py-2.5 px-3 w-20 text-right">Pasang</th>
                        <th className="py-2.5 px-3 w-20 text-right">Bongkar</th>
                        <th className="py-2.5 px-3 w-20 text-right">Retur</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {(calcResult.totals || [])
                        .slice((calcTotalsPage - 1) * calcTotalsPerPage, calcTotalsPage * calcTotalsPerPage)
                        .map((t) => (
                        <tr key={t.khs_code} className="hover:bg-slate-50 dark:hover:bg-slate-800/50 transition">
                          <td className="py-2 px-3 font-mono font-bold text-slate-800 dark:text-slate-200">{t.khs_code}</td>
                          <td className="py-2 px-3 text-slate-900 dark:text-slate-100 font-medium">{t.khs_name}</td>
                          <td className="py-2 px-3 text-center text-slate-600 dark:text-slate-400 font-mono text-[11px]">{t.unit_text}</td>
                          <td className="py-2 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">{t.material.toLocaleString('id-ID')}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">{t.install.toLocaleString('id-ID')}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">{t.remove.toLocaleString('id-ID')}</td>
                          <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">{t.return.toLocaleString('id-ID')}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {(calcResult.totals || []).length > 0 && (
                  <TableFooter
                    itemCount={
                      (calcResult.totals || []).slice(
                        (calcTotalsPage - 1) * calcTotalsPerPage,
                        calcTotalsPage * calcTotalsPerPage
                      ).length
                    }
                    total={(calcResult.totals || []).length}
                    entityLabel="material KHS"
                    page={calcTotalsPage}
                    perPage={calcTotalsPerPage}
                    onPage={setCalcTotalsPage}
                    onPerPage={(n) => {
                      setCalcTotalsPerPage(n)
                      setCalcTotalsPage(1)
                    }}
                    perPageOptions={[10, 25, 50, 100]}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* MODAL: Extract from Drawing Excel File */}
      <Modal
        open={extractModalOpen}
        title={extractReport ? 'Hasil Ekstraksi Berkas Gambar (Excel)' : 'Konfirmasi Ekstraksi Jumlah dari Berkas Gambar (Excel)'}
        onClose={() => setExtractModalOpen(false)}
        maxWidth={extractReport ? 'max-w-2xl' : 'max-w-lg'}
        footer={
          <>
            <Button variant="ghost" onClick={() => setExtractModalOpen(false)}>
              {extractReport ? 'Tutup' : 'Batal'}
            </Button>
            {!extractReport && (
              <Button variant="primary" loading={extracting} onClick={handleRunExtract}>
                Mulai Ekstraksi
              </Button>
            )}
          </>
        }
      >
        <div className="space-y-4 text-xs">
          <p className="text-slate-600 dark:text-slate-300">
            Sistem akan membaca lembar <strong>GAMBAR</strong> dari berkas utama (role MAIN) versi gambar ini, lalu mencocokkan kelompok dan nama tipe konstruksi standar PLN secara otomatis.
          </p>

          {extractError && <Alert kind="error">{extractError}</Alert>}

          {isReasonRequired && !extractReport && (
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Penimpaan Data <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                value={extractReason}
                onChange={(e) => setExtractReason(e.target.value)}
                placeholder="Contoh: Ekstraksi ulang dari revisi berkas gambar terbaru..."
                className="block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
              />
            </div>
          )}

          {extractReport && (
            <div className="space-y-3 pt-2 border-t">
              {extractReport.file && (
                <div className="p-2.5 bg-slate-50 dark:bg-slate-800 rounded-lg flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] border border-slate-200 dark:border-slate-700">
                  <div>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Sumber Berkas: </span>
                    <span className="font-mono text-slate-800 dark:text-slate-200">{extractReport.file.name}</span>
                    {extractReport.file.format && (
                      <span className="ml-1.5 px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-mono text-[10px]">
                        {extractReport.file.format.toUpperCase()}
                      </span>
                    )}
                  </div>
                  {extractReport.file.sha256 && (
                    <span className="text-[10px] text-slate-400 font-mono" title={extractReport.file.sha256}>
                      SHA: {extractReport.file.sha256.slice(0, 12)}…
                    </span>
                  )}
                </div>
              )}

              <div className="p-3 bg-emerald-50 text-emerald-800 rounded-lg">
                <strong>Ekstraksi Selesai:</strong> {extractReport.matched?.length || 0} item jenis konstruksi berhasil dicocokkan dari berkas.
              </div>

              {/* PB/PD Block Information */}
              {extractReport.pbpd_applied ? (
                <div className="p-2.5 bg-blue-50 text-blue-900 rounded-lg text-[11px] flex items-center gap-2 border border-blue-200">
                  <span className="font-bold">✓ Parameter PB/PD Diterapkan:</span>
                  <span>Rentang daya dan jumlah pelanggan telah otomatis disimpan ke parameter MTO.</span>
                </div>
              ) : extractReport.pbpd?.length > 0 ? (
                <div className="p-2.5 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 rounded-lg text-[11px] border border-slate-200 dark:border-slate-700">
                  <span className="font-bold">Laporan Blok PB/PD:</span>
                  <span className="ml-1">BOM PBPD belum disetujui aktif, nilai parameter tidak diterapkan otomatis ke MTO.</span>
                </div>
              ) : null}

              {extractReport.pbpd?.length > 0 && (
                <div>
                  <h6 className="font-bold text-slate-700 dark:text-slate-300 mb-1.5 text-xs">
                    Blok Pelanggan PB/PD Terbaca ({extractReport.pbpd.length}):
                  </h6>
                  <div className="border border-slate-200 dark:border-slate-700 rounded-xl overflow-hidden max-h-36 overflow-y-auto shadow-2xs">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-slate-50 dark:bg-slate-800/80 text-[10px] uppercase font-bold text-slate-500 dark:text-slate-400 sticky top-0 border-b border-slate-200 dark:border-slate-700">
                        <tr>
                          <th className="py-2 px-3">Parameter Blok Pelanggan</th>
                          <th className="py-2 px-3 w-28 text-right">Pasang (PSG)</th>
                          <th className="py-2 px-3 w-28 text-right">Bongkar (BKR)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {extractReport.pbpd.map((p, idx) => (
                          <tr key={idx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-1.5 px-3 font-medium text-slate-800 dark:text-slate-200">{p.label}</td>
                            <td className="py-1.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">{p.psg}</td>
                            <td className="py-1.5 px-3 text-right font-mono text-slate-600 dark:text-slate-400">{p.bkr}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {extractReport.pbpd_unmatched?.length > 0 && (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 rounded-xl text-xs border border-amber-200 dark:border-amber-800 space-y-1.5">
                  <div className="font-bold text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
                    <span>⚠️ Peringatan: rentang daya tidak dikenali, pilih manual</span>
                  </div>
                  <div className="divide-y divide-amber-200/60 dark:divide-amber-800/60 text-[11px]">
                    {extractReport.pbpd_unmatched.map((u, uIdx) => (
                      <div key={uIdx} className="py-1 flex items-center justify-between">
                        <span>{u.label || JSON.stringify(u)}</span>
                        <span className="font-mono text-[10px] text-amber-700 dark:text-amber-400 font-semibold">{u.reason}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Unmatched Items List */}
              {extractReport.unmatched?.length > 0 && (
                <div>
                  <h6 className="font-bold text-amber-700 dark:text-amber-400 mb-1 text-xs">
                    Item Tidak Dikenali ({extractReport.unmatched.length}):
                  </h6>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-2">
                    Item berikut tidak cocok dengan katalog konstruksi disetujui. Anda dapat menambahkannya secara manual jika diperlukan.
                  </p>
                  <div className="border border-amber-200 dark:border-amber-800 rounded-xl overflow-hidden max-h-40 overflow-y-auto shadow-2xs">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead className="bg-amber-50/80 dark:bg-amber-950/60 text-[10px] uppercase font-bold text-amber-800 dark:text-amber-300 sticky top-0 border-b border-amber-200 dark:border-amber-800">
                        <tr>
                          <th className="py-2 px-3 w-20">Kelompok</th>
                          <th className="py-2 px-3">Uraian pada Lembar Gambar</th>
                          <th className="py-2 px-3 w-24">Sel Terbaca</th>
                          <th className="py-2 px-3 w-36 text-right">Keterangan</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-amber-100 dark:divide-amber-900/40">
                        {extractReport.unmatched.map((u, i) => (
                          <tr key={i} className="hover:bg-amber-50/50 dark:hover:bg-amber-950/30">
                            <td className="py-1.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">{u.group}</td>
                            <td className="py-1.5 px-3 font-medium text-slate-800 dark:text-slate-200">{u.label}</td>
                            <td className="py-1.5 px-3 font-mono text-[11px] text-slate-500">{u.cell_psg || u.cell_bkr || '-'}</td>
                            <td className="py-1.5 px-3 text-right font-mono text-[11px] text-rose-600 dark:text-rose-400">{u.reason}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Warnings List */}
              {extractReport.warnings?.length > 0 && (
                <div>
                  <h6 className="font-bold text-amber-700 mb-1">Peringatan:</h6>
                  <ul className="list-disc pl-4 space-y-0.5 text-[11px] text-amber-800">
                    {extractReport.warnings.map((w, i) => (
                      <li key={i}>{w.cell ? `Sel ${w.cell}: ` : ''}{w.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </Modal>

      {/* MODAL 4: Decision Setujui / Tolak MTO (Manager ULP) */}
      <Modal
        open={decisionModalOpen}
        title={decisionType === 'APPROVED' ? 'Persetujuan Paket MTO' : 'Penolakan Paket MTO'}
        onClose={() => setDecisionModalOpen(false)}
        maxWidth="max-w-md"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setDecisionModalOpen(false)}>
              Batal
            </Button>
            <Button
              variant={decisionType === 'APPROVED' ? 'primary' : 'danger'}
              loading={submittingDecision}
              onClick={handleSubmitDecision}
            >
              {decisionType === 'APPROVED' ? 'Konfirmasi Setujui' : 'Konfirmasi Tolak'}
            </Button>
          </div>
        }
      >
        <form onSubmit={handleSubmitDecision} className="space-y-4 text-xs">
          {decisionError && <Alert kind="error">{decisionError}</Alert>}

          <p className="text-slate-600 dark:text-slate-300">
            {decisionType === 'APPROVED'
              ? 'Anda akan menyetujui paket MTO ini sebagai Manager ULP. Persetujuan MTO merupakan prasyarat mutlak sebelum gambar teknik dapat disetujui.'
              : 'Anda akan menolak paket MTO ini. Paket akan dibuka kembali ke status DRAFT agar penyusun (TEKNIK) dapat memperbaikinya.'}
          </p>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Catatan Keputusan {decisionType === 'REJECTED' && <span className="text-rose-500">* (Wajib)</span>}
            </label>
            <textarea
              rows={3}
              required={decisionType === 'REJECTED'}
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              placeholder={decisionType === 'REJECTED' ? 'Tuliskan alasan penolakan dan perbaikan yang diminta...' : 'Catatan persetujuan (opsional)...'}
              className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>
        </form>
      </Modal>

      {/* Output Document Modal (docs/70 & docs/57) */}
      <OutputDocumentModal
        open={docModalConfig.open}
        onClose={() => setDocModalConfig((prev) => ({ ...prev, open: false }))}
        runId={docModalConfig.runId}
        type={docModalConfig.type}
        category={docModalConfig.category}
        title={docModalConfig.title}
      />

      {/* RAB Dry Run Calculation Modal (docs/74) */}
      <RabDryRunModal
        open={dryRunModalOpen}
        onClose={() => setDryRunModalOpen(false)}
        data={dryRunData}
        isDryRun={true}
        canSave={canRunRab}
        saving={runningRab}
        onSave={handleRunRab}
      />

      {/* RAB Run Detail Drawer with Full Line Items (docs/74) */}
      {detailRunId && (
        <RabRunDetailDrawer
          runId={detailRunId}
          onClose={() => setDetailRunId(null)}
          onOpenDoc={handleOpenDoc}
        />
      )}

      {/* Confirmation Modal: Verifikasi MTO */}
      <ConfirmationModal
        open={verifyConfirmOpen}
        onClose={() => setVerifyConfirmOpen(false)}
        onConfirm={handleConfirmVerify}
        title="Verifikasi Paket MTO"
        description="Verifikasi paket MTO? Seluruh isian jumlah konstruksi akan dikunci secara permanen dan diteruskan ke Manager ULP untuk persetujuan."
        confirmLabel="Verifikasi Sekarang"
        variant="warning"
        loading={verifying}
      />
    </div>
  )
}
