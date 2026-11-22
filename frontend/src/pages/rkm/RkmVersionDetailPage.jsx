import { useEffect, useState, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { rkmApi, reportsApi, triggerFileDownload } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Modal from '../../components/Modal.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import {
  IconCheck,
  IconX,
  IconPlus,
  IconRefresh,
  IconClock,
  IconCheckCircle,
  IconAlertCircle,
  IconCalendar,
  IconChevronRight,
  IconArrowLeft,
} from '../../components/icons.jsx'

export default function RkmVersionDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAccess()
  const { notify } = useNotifications()

  // Permissions
  const canPlan = Boolean(can?.['rkm.plan'])
  const canPrepare = Boolean(can?.['rkm.prepare'])
  const canSubmit = Boolean(can?.['rkm.submit'])
  const canValidatePerencanaan = Boolean(can?.['rkm.validate_perencanaan'])
  const canValidateKonstruksi = Boolean(can?.['rkm.validate_konstruksi'])
  const canApproveUp3 = Boolean(can?.['rkm.approve'])

  const [version, setVersion] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [activeTab, setActiveTab] = useState('proposals') // 'proposals' | 'requirements' | 'audit'

  // Selected Proposal for Line Editing (COLLECTING)
  const [editingProposal, setEditingProposal] = useState(null)
  const [proposalLines, setProposalLines] = useState([])
  const [savingLines, setSavingLines] = useState(false)
  const [submittingProposal, setSubmittingProposal] = useState(false)

  // Modal Adjust Quantity (VALIDATING)
  const [adjustModalOpen, setAdjustModalOpen] = useState(false)
  const [adjustProposalId, setAdjustProposalId] = useState('')
  const [adjustKhsCode, setAdjustKhsCode] = useState('')
  const [adjustQuantity, setAdjustQuantity] = useState('')
  const [adjustReason, setAdjustReason] = useState('')
  const [adjusting, setAdjusting] = useState(false)
  const [adjustError, setAdjustError] = useState('')

  // Modal Decision (UP3)
  const [decisionModalOpen, setDecisionModalOpen] = useState(false)
  const [decisionStep, setDecisionStep] = useState('VALIDATE_PERENCANAAN')
  const [decisionValue, setDecisionValue] = useState('APPROVED')
  const [decisionNotes, setDecisionNotes] = useState('')
  const [deciding, setDeciding] = useState(false)
  const [decisionError, setDecisionError] = useState('')

  // Modal Amend (APPROVED)
  const [amendModalOpen, setAmendModalOpen] = useState(false)
  const [amendReason, setAmendReason] = useState('')
  const [amending, setAmending] = useState(false)
  const [amendError, setAmendError] = useState('')

  // Requirements Panel State (UP3)
  const [requirementsData, setRequirementsData] = useState(null)
  const [loadingReqs, setLoadingReqs] = useState(false)
  const [reqsError, setReqsError] = useState('')
  const [reqPage, setReqPage] = useState(1)
  const [reqPerPage, setReqPerPage] = useState(25)
  const [reqsDate, setReqsDate] = useState('')

  // Report Tab State
  const [reportType, setReportType] = useState('per-ulp') // 'per-ulp' | 'comparison' | 'critical'
  const [reportData, setReportData] = useState(null)
  const [loadingReport, setLoadingReport] = useState(false)
  const [reportError, setReportError] = useState('')
  const [downloadingReport, setDownloadingReport] = useState(false)

  // Load Version Detail
  const loadVersion = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const res = await rkmApi.version(id)
      setVersion(res?.data || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat detail versi RKM.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadVersion()
  }, [loadVersion])

  // Load Requirements
  const loadRequirements = useCallback(async () => {
    if (!id) return
    setLoadingReqs(true)
    setReqsError('')
    try {
      const res = await rkmApi.requirements(id, reqsDate || undefined)
      setRequirementsData(res || null)
    } catch (err) {
      setReqsError(err?.message || 'Gagal memuat kebutuhan bersih (UP3 level only).')
    } finally {
      setLoadingReqs(false)
    }
  }, [id, reqsDate])

  useEffect(() => {
    if (activeTab === 'requirements') {
      loadRequirements()
    }
  }, [activeTab, loadRequirements])

  // Load RKM Report
  const loadRkmReport = useCallback(async (type) => {
    if (!id) return
    setLoadingReport(true)
    setReportError('')
    try {
      const res = await reportsApi.rkm(id, type)
      setReportData(res?.data || null)
    } catch (err) {
      setReportError(err?.message || 'Gagal memuat dokumen laporan RKM.')
    } finally {
      setLoadingReport(false)
    }
  }, [id])

  useEffect(() => {
    if (activeTab === 'reports') {
      loadRkmReport(reportType)
    }
  }, [activeTab, reportType, loadRkmReport])

  const handleDownloadRkmXlsx = async () => {
    setDownloadingReport(true)
    try {
      const { blob, filename } = await reportsApi.downloadRkmXlsx(id, reportType)
      triggerFileDownload(blob, filename || `RKM-${reportType}.xlsx`)
    } catch (err) {
      alert(err?.message || 'Gagal mengunduh berkas laporan XLSX.')
    } finally {
      setDownloadingReport(false)
    }
  }

  // Start Validation (COLLECTING -> VALIDATING)
  const handleStartValidation = async () => {
    try {
      await rkmApi.startValidation(id)
      notify({
        type: 'success',
        title: 'Validasi Dimulai',
        desc: 'Status versi RKM telah berpindah ke tahap VALIDATING.',
        tag: 'RKM',
      })
      loadVersion()
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Memulai Validasi',
        desc: err?.message || 'Tidak dapat memulai validasi.',
        tag: 'RKM',
      })
    }
  }

  // Handle Edit Proposal Lines
  const handleOpenEditProposal = (prop) => {
    setEditingProposal(prop)
    setProposalLines(
      (prop.lines || []).map((l) => ({
        khs_code: l.khs_code,
        qty_work: l.qty_work,
        qty_pipeline: l.qty_pipeline ?? 0,
        qty_forecast: l.qty_forecast ?? 0,
        note: l.note || '',
      }))
    )
  }

  const handleSaveProposalLines = async () => {
    if (!editingProposal) return
    setSavingLines(true)
    try {
      await rkmApi.putLines(editingProposal.id, {
        lines: proposalLines.map((l) => ({
          khs_code: l.khs_code,
          qty_pipeline: Number(l.qty_pipeline) || 0,
          qty_forecast: Number(l.qty_forecast) || 0,
          note: l.note.trim() || undefined,
        })),
      })
      notify({
        type: 'success',
        title: 'Usulan Disimpan',
        desc: `Kuantitas usulan ${editingProposal.ulp?.name} berhasil disimpan.`,
        tag: 'RKM',
      })
      setEditingProposal(null)
      loadVersion()
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Menyimpan',
        desc: err?.message || 'Tidak dapat menyimpan usulan.',
        tag: 'RKM',
      })
    } finally {
      setSavingLines(false)
    }
  }

  // Submit Proposal (MANAGER_ULP)
  const handleSubmitProposal = async (propId) => {
    setSubmittingProposal(true)
    try {
      await rkmApi.submit(propId)
      notify({
        type: 'success',
        title: 'Usulan Diajukan',
        desc: 'Usulan ULP berhasil diajukan ke UP3.',
        tag: 'RKM',
      })
      loadVersion()
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Mengajukan',
        desc: err?.message || 'Tidak dapat mengajukan usulan.',
        tag: 'RKM',
      })
    } finally {
      setSubmittingProposal(false)
    }
  }

  // Adjust Quantity
  const handleAdjustQuantity = async (e) => {
    e.preventDefault()
    setAdjusting(true)
    setAdjustError('')
    try {
      await rkmApi.adjust(id, {
        proposal_id: adjustProposalId,
        khs_code: adjustKhsCode,
        quantity: Number(adjustQuantity),
        reason: adjustReason.trim(),
      })
      notify({
        type: 'success',
        title: 'Kuantitas Disesuaikan',
        desc: `Kuantitas KHS ${adjustKhsCode} berhasil disesuaikan.`,
        tag: 'RKM',
      })
      setAdjustModalOpen(false)
      loadVersion()
    } catch (err) {
      setAdjustError(err?.message || 'Gagal menyesuaikan kuantitas.')
    } finally {
      setAdjusting(false)
    }
  }

  // Submit Decision
  const handleDecision = async (e) => {
    e.preventDefault()
    setDeciding(true)
    setDecisionError('')
    try {
      await rkmApi.decide(id, {
        step: decisionStep,
        decision: decisionValue,
        notes: decisionNotes.trim() || undefined,
      })
      notify({
        type: 'success',
        title: 'Keputusan Dicatat',
        desc: `Keputusan ${decisionValue} untuk langkah ${decisionStep} berhasil disimpan.`,
        tag: 'RKM',
      })
      setDecisionModalOpen(false)
      loadVersion()
    } catch (err) {
      setDecisionError(err?.message || 'Gagal mencatat keputusan.')
    } finally {
      setDeciding(false)
    }
  }

  // Submit Amend
  const handleAmend = async (e) => {
    e.preventDefault()
    if (!version?.plan?.id) return
    setAmending(true)
    setAmendError('')
    try {
      const res = await rkmApi.amend(version.plan.id, {
        reason: amendReason.trim(),
      })
      notify({
        type: 'success',
        title: 'Rencana Diamandemen',
        desc: 'Versi amandemen baru berhasil diinisiasi.',
        tag: 'RKM',
      })
      setAmendModalOpen(false)
      if (res?.data?.version_id) {
        navigate(`/rkm/versions/${res.data.version_id}`)
      } else {
        loadVersion()
      }
    } catch (err) {
      setAmendError(err?.message || 'Gagal mengamandemen rencana.')
    } finally {
      setAmending(false)
    }
  }

  if (loading) {
    return (
      <div className="py-20 text-center text-slate-500">
        <Spinner size="lg" label="Memuat detail versi RKM..." />
      </div>
    )
  }

  if (error || !version) {
    return (
      <div className="space-y-4">
        <button
          type="button"
          onClick={() => navigate('/rkm')}
          className="text-xs text-slate-500 hover:text-slate-800 inline-flex items-center gap-1"
        >
          <IconArrowLeft size={14} />
          <span>Kembali ke Daftar RKM</span>
        </button>
        <Alert kind="error">{error || 'Data versi RKM tidak ditemukan.'}</Alert>
      </div>
    )
  }

  const isCollecting = version.status === 'COLLECTING'
  const isValidating = version.status === 'VALIDATING'
  const isApproved = version.status === 'APPROVED'

  return (
    <div className="space-y-6">
      {/* Top Breadcrumb & Header */}
      <div>
        <nav className="text-xs text-slate-500 mb-1 flex items-center gap-1.5">
          <Link to="/rkm" className="hover:text-blue-600 transition">
            RKM
          </Link>
          <span>/</span>
          <span className="font-mono">{version.plan?.plan_number}</span>
          <span>/</span>
          <span className="text-slate-800 dark:text-slate-200 font-medium">
            Versi v{version.version_number}
          </span>
        </nav>

        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mt-2">
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
                RKM: {version.plan?.plan_number} (v{version.version_number})
              </h1>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold ${
                  isApproved
                    ? 'bg-emerald-100 text-emerald-800'
                    : isValidating
                    ? 'bg-blue-100 text-blue-800'
                    : 'bg-amber-100 text-amber-800'
                }`}
              >
                {version.status} (Putaran #{version.round})
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              Periode: {version.plan?.period_start} s/d {version.plan?.period_end} · Tipe: {version.plan?.period_type}
              {version.snapshot_hash && ` · Hash: ${version.snapshot_hash.slice(0, 16)}...`}
            </p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {isCollecting && canPlan && (
              <Button
                variant="primary"
                size="sm"
                onClick={handleStartValidation}
              >
                Mulai Validasi UP3
              </Button>
            )}

            {isValidating && (canValidatePerencanaan || canValidateKonstruksi || canApproveUp3) && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setDecisionError('')
                  setDecisionNotes('')
                  setDecisionModalOpen(true)
                }}
              >
                Buat Keputusan Langkah
              </Button>
            )}

            {isApproved && canPlan && (
              <Button
                variant="primary"
                size="sm"
                onClick={() => {
                  setAmendError('')
                  setAmendReason('')
                  setAmendModalOpen(true)
                }}
              >
                Amandemen Rencana
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('proposals')}
          className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer whitespace-nowrap ${
            activeTab === 'proposals'
              ? 'border-blue-600 text-blue-700 dark:text-blue-300'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Usulan ULP ({version.proposals?.length || 0})
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('requirements')}
          className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer whitespace-nowrap ${
            activeTab === 'requirements'
              ? 'border-blue-600 text-blue-700 dark:text-blue-300'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Panel Kebutuhan Bersih (UP3)
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('audit')}
          className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer whitespace-nowrap ${
            activeTab === 'audit'
              ? 'border-blue-600 text-blue-700 dark:text-blue-300'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Riwayat Keputusan & Penyesuaian
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('reports')}
          className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer whitespace-nowrap ${
            activeTab === 'reports'
              ? 'border-blue-600 text-blue-700 dark:text-blue-300'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          Laporan RKM
        </button>
      </div>

      {/* TAB 1: Proposals List & Detail */}
      {activeTab === 'proposals' && (
        <div className="space-y-4">
          {(version.proposals || []).map((prop) => (
            <div
              key={prop.id}
              className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 shadow-xs"
            >
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-2">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-sm text-slate-800 dark:text-slate-200">
                      {prop.ulp?.name} ({prop.ulp?.code})
                    </span>
                    <span
                      className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                        prop.status === 'SUBMITTED'
                          ? 'bg-emerald-100 text-emerald-800'
                          : prop.status === 'RETURNED'
                          ? 'bg-rose-100 text-rose-800'
                          : 'bg-amber-100 text-amber-800'
                      }`}
                    >
                      {prop.status}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    {prop.submitted_at
                      ? `Diajukan pada: ${new Date(prop.submitted_at).toLocaleString('id-ID')}`
                      : 'Belum diajukan ke UP3'}
                    {prop.return_reason && ` · Alasan Dikembalikan: "${prop.return_reason}"`}
                  </p>
                </div>

                <div className="flex items-center gap-2 flex-wrap">
                  {isCollecting && canPrepare && prop.status !== 'SUBMITTED' && (
                    <Button
                      variant="primary"
                      size="sm"
                      onClick={() => handleOpenEditProposal(prop)}
                    >
                      Edit Kuantitas Pipeline/Forecast
                    </Button>
                  )}

                  {isCollecting && canSubmit && prop.status !== 'SUBMITTED' && (
                    <Button
                      variant="primary"
                      size="sm"
                      loading={submittingProposal}
                      onClick={() => handleSubmitProposal(prop.id)}
                    >
                      Ajukan Usulan
                    </Button>
                  )}

                  {isValidating && canPlan && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => {
                        setAdjustProposalId(prop.id)
                        setAdjustKhsCode(prop.lines?.[0]?.khs_code || '')
                        setAdjustQuantity('')
                        setAdjustReason('')
                        setAdjustError('')
                        setAdjustModalOpen(true)
                      }}
                      className="text-blue-600 border border-blue-200"
                    >
                      Sesuaikan Kuantitas KHS
                    </Button>
                  )}
                </div>
              </div>

              {/* Proposals Lines Table */}
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[10px] text-slate-600 dark:text-slate-400 border-b">
                      <th className="py-2 px-3">Kode KHS</th>
                      <th className="py-2 px-3 text-right">Kebutuhan MTO (Work)</th>
                      <th className="py-2 px-3 text-right">Pipeline</th>
                      <th className="py-2 px-3 text-right">Forecast</th>
                      <th className="py-2 px-3 text-right bg-blue-50/50 dark:bg-blue-950/20 font-bold">
                        Kuantitas Tervalidasi
                      </th>
                      <th className="py-2 px-3">Catatan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                    {(prop.lines || []).length === 0 ? (
                      <tr>
                        <td colSpan={6} className="py-4 text-center text-slate-400 font-sans text-xs">
                          Belum ada baris kebutuhan material untuk usulan ULP ini.
                        </td>
                      </tr>
                    ) : (
                      prop.lines.map((l, lIdx) => (
                        <tr key={lIdx} className="hover:bg-slate-50/50">
                          <td className="py-1.5 px-3 font-bold text-slate-900 dark:text-slate-100">
                            {l.khs_code}
                          </td>
                          <td className="py-1.5 px-3 text-right text-slate-700 dark:text-slate-300">
                            {l.qty_work?.toLocaleString('id-ID')}
                          </td>
                          <td className="py-1.5 px-3 text-right text-amber-600">
                            {l.qty_pipeline?.toLocaleString('id-ID')}
                          </td>
                          <td className="py-1.5 px-3 text-right text-indigo-600">
                            {l.qty_forecast?.toLocaleString('id-ID')}
                          </td>
                          <td className="py-1.5 px-3 text-right font-bold text-blue-700 dark:text-blue-300 bg-blue-50/30">
                            {l.qty_validated != null ? l.qty_validated.toLocaleString('id-ID') : '-'}
                          </td>
                          <td className="py-1.5 px-3 font-sans text-[11px] text-slate-500">
                            {l.note || '-'}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* TAB 2: Net Requirements Panel (UP3) */}
      {activeTab === 'requirements' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Konsolidasi Kebutuhan Bersih Material (UP3)
                </h3>
                {requirementsData?.frozen && (
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-100 text-slate-700 border border-slate-300">
                    BEKU (FROZEN)
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-500">
                Formula: Kebutuhan Bersih = max(0, Kebutuhan Kotor + Stok Pengaman − Stok Tersedia − Pasokan Masuk).
              </p>
            </div>

            <div className="flex items-center gap-2">
              <input
                type="date"
                value={reqsDate}
                onChange={(e) => setReqsDate(e.target.value)}
                className="px-3 py-1.5 text-base sm:text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
              <Button
                variant="primary"
                size="sm"
                loading={loadingReqs}
                onClick={loadRequirements}
                icon={IconRefresh}
              >
                Hitung Ulang
              </Button>
            </div>
          </div>

          {reqsError && <Alert kind="error">{reqsError}</Alert>}

          {loadingReqs ? (
            <div className="py-20 text-center text-slate-500">
              <Spinner size="lg" label="Menghitung kebutuhan bersih material..." />
            </div>
          ) : !requirementsData || !requirementsData.data ? (
            <div className="p-12 text-center text-slate-400 text-xs bg-white dark:bg-slate-900 border rounded-xl">
              Tidak ada data konsolidasi kebutuhan.
            </div>
          ) : (
            <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[10px] text-slate-600 dark:text-slate-400 border-b">
                      <th className="py-2.5 px-3">Kode KHS</th>
                      <th className="py-2.5 px-3 text-right">Kebutuhan Kotor</th>
                      <th className="py-2.5 px-3 text-right">Dialokasi</th>
                      <th className="py-2.5 px-3 text-right text-emerald-600">Stok Tersedia</th>
                      <th className="py-2.5 px-3 text-right text-slate-500">Stok Pengaman</th>
                      <th className="py-2.5 px-3 text-right text-blue-600">Pasokan Masuk</th>
                      <th className="py-2.5 px-3 text-right font-bold bg-amber-50/60 text-amber-900 dark:text-amber-200">
                        Kebutuhan Bersih
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                    {Object.entries(requirementsData.data || {})
                      .slice((reqPage - 1) * reqPerPage, reqPage * reqPerPage)
                      .map(([code, row]) => (
                      <tr key={code} className="hover:bg-slate-50/60">
                        <td className="py-2 px-3 font-bold text-slate-900 dark:text-slate-100">
                          {row.khs_code || code}
                        </td>
                        <td className="py-2 px-3 text-right font-semibold">
                          {row.gross?.toLocaleString('id-ID')}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-500">
                          {row.allocated?.toLocaleString('id-ID')}
                        </td>
                        <td className="py-2 px-3 text-right text-emerald-600">
                          {row.available?.toLocaleString('id-ID')}
                        </td>
                        <td className="py-2 px-3 text-right text-slate-500">
                          {row.safety?.toLocaleString('id-ID')}
                        </td>
                        <td className="py-2 px-3 text-right text-blue-600">
                          {row.incoming?.toLocaleString('id-ID')}
                        </td>
                        <td
                          className={`py-2 px-3 text-right font-bold bg-amber-50/40 ${
                            row.net > 0 ? 'text-rose-600 font-extrabold' : 'text-slate-400'
                          }`}
                        >
                          {row.net?.toLocaleString('id-ID')}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {Object.keys(requirementsData.data || {}).length > 0 && (
                <TableFooter
                  itemCount={Object.keys(requirementsData.data || {}).slice((reqPage - 1) * reqPerPage, reqPage * reqPerPage).length}
                  total={Object.keys(requirementsData.data || {}).length}
                  entityLabel="material KHS kebutuhan bersih"
                  page={reqPage}
                  perPage={reqPerPage}
                  onPage={setReqPage}
                  onPerPage={(n) => {
                    setReqPerPage(n)
                    setReqPage(1)
                  }}
                  perPageOptions={[10, 25, 50, 100]}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: Audit Trail & Decisions */}
      {activeTab === 'audit' && (
        <div className="space-y-5">
          {/* Decisions */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 shadow-xs">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <IconCheckCircle size={15} />
              <span>Riwayat Keputusan Langkah Validasi</span>
            </h4>

            {(version.decisions || []).length === 0 ? (
              <p className="text-xs text-slate-400 italic py-2">
                Belum ada keputusan langkah yang dicatat untuk versi ini.
              </p>
            ) : (
              <div className="space-y-2">
                {version.decisions.map((d, dIdx) => (
                  <div
                    key={dIdx}
                    className="p-3 rounded-lg border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-xs space-y-1"
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                          {d.step} (Putaran #{d.round})
                        </span>
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            d.decision === 'APPROVED'
                              ? 'bg-emerald-100 text-emerald-800'
                              : 'bg-rose-100 text-rose-800'
                          }`}
                        >
                          {d.decision}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400">
                        {d.decided_at ? new Date(d.decided_at).toLocaleString('id-ID') : '-'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500">
                      Oleh: <strong>{d.decided_by_name}</strong> ({d.decided_role})
                    </p>
                    {d.notes && (
                      <p className="text-[11px] text-slate-600 dark:text-slate-300 italic mt-1 bg-white dark:bg-slate-800 p-2 rounded">
                        &ldquo;{d.notes}&rdquo;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Adjustments */}
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3 shadow-xs">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
              <IconClock size={15} />
              <span>Riwayat Penyesuaian Kuantitas (Perencanaan UP3)</span>
            </h4>

            {(version.adjustments || []).length === 0 ? (
              <p className="text-xs text-slate-400 italic py-2">
                Belum ada penyesuaian kuantitas yang dicatat.
              </p>
            ) : (
              <div className="border rounded-lg overflow-x-auto text-xs">
                <table className="w-full text-left border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-800 text-[10px] font-semibold text-slate-600 border-b">
                    <tr>
                      <th className="py-2 px-3">Kode KHS</th>
                      <th className="py-2 px-3 text-right">Sebelum</th>
                      <th className="py-2 px-3 text-right">Sesudah</th>
                      <th className="py-2 px-3">Alasan Penyesuaian</th>
                      <th className="py-2 px-3">Pelaku</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y font-mono text-[11px]">
                    {version.adjustments.map((a, aIdx) => (
                      <tr key={aIdx}>
                        <td className="py-1.5 px-3 font-bold">{a.khs_code}</td>
                        <td className="py-1.5 px-3 text-right text-slate-500">{a.before_qty}</td>
                        <td className="py-1.5 px-3 text-right font-bold text-blue-600">{a.after_qty}</td>
                        <td className="py-1.5 px-3 font-sans text-slate-700 text-[11px]">{a.reason}</td>
                        <td className="py-1.5 px-3 font-sans text-slate-500 text-[10px]">{a.actor_name}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 4: Laporan RKM */}
      {activeTab === 'reports' && (
        <div className="space-y-4">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Pilih Jenis Laporan:
              </span>
              <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-800 p-0.5 bg-slate-50 dark:bg-slate-800">
                <button
                  type="button"
                  onClick={() => setReportType('per-ulp')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                    reportType === 'per-ulp'
                      ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  Usulan per ULP
                </button>
                <button
                  type="button"
                  onClick={() => setReportType('comparison')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                    reportType === 'comparison'
                      ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  Komparasi (Usulan vs Validasi vs Disetujui)
                </button>
                <button
                  type="button"
                  onClick={() => setReportType('critical')}
                  className={`px-3 py-1 rounded-md text-xs font-semibold transition ${
                    reportType === 'critical'
                      ? 'bg-white dark:bg-slate-900 text-blue-600 shadow-xs'
                      : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
                  }`}
                >
                  Material Kritis
                </button>
              </div>
            </div>

            <Button
              variant="secondary"
              size="sm"
              loading={downloadingReport}
              onClick={handleDownloadRkmXlsx}
            >
              Unduh XLSX
            </Button>
          </div>

          {reportError && <Alert kind="error">{reportError}</Alert>}

          {loadingReport ? (
            <div className="py-20 text-center text-slate-500">
              <Spinner size="lg" label="Menghasilkan dokumen laporan RKM..." />
            </div>
          ) : !reportData ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              Tidak ada data laporan untuk ditampilkan.
            </div>
          ) : (
            <div className="space-y-4">
              {/* Document Header & Meta */}
              <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b pb-3">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                      {reportData.title}
                    </h3>
                    <p className="text-xs text-slate-500">
                      {reportData.header?.name || 'PT PLN (PERSERO)'} · {reportData.header?.sub || 'DISTRIBUSI'}
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
                  {(reportData.meta || []).map(([label, val], idx) => (
                    <div key={idx}>
                      <span className="text-[10px] text-slate-400 uppercase font-semibold block">{label}</span>
                      <span className="font-medium text-slate-800 dark:text-slate-200">{val}</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sections Tables */}
              {(reportData.sections || []).map((sec, secIdx) => (
                <div
                  key={secIdx}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden"
                >
                  {sec.heading && (
                    <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border-b font-bold text-xs text-slate-800 dark:text-slate-200">
                      {sec.heading}
                    </div>
                  )}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50/50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400 font-semibold text-[10px] border-b">
                          {(sec.columns || []).map((col, cIdx) => (
                            <th
                              key={cIdx}
                              className={`py-2.5 px-3 ${cIdx > 1 ? 'text-right' : 'text-left'}`}
                            >
                              {col}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono text-[11px]">
                        {(sec.rows || []).map((row, rIdx) => (
                          <tr key={rIdx} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            {row.map((cell, cellIdx) => (
                              <td
                                key={cellIdx}
                                className={`py-2 px-3 ${
                                  cellIdx > 1
                                    ? 'text-right'
                                    : cellIdx === 0
                                    ? 'font-bold font-sans'
                                    : 'font-bold'
                                }`}
                              >
                                {typeof cell === 'number' ? cell.toLocaleString('id-ID') : cell}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {(sec.rows || []).length > 0 && (
                    <TableFooter
                      itemCount={(sec.rows || []).length}
                      total={(sec.rows || []).length}
                      entityLabel="baris rincian laporan"
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* DRAWER 1: Edit Proposal Lines */}
      {editingProposal && (
        <Modal
          open={Boolean(editingProposal)}
          title={`Edit Kuantitas Usulan: ${editingProposal.ulp?.name}`}
          onClose={() => setEditingProposal(null)}
          size="max-w-3xl"
          footer={
            <div className="flex justify-end gap-2 w-full">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setEditingProposal(null)}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                size="sm"
                loading={savingLines}
                onClick={handleSaveProposalLines}
              >
                Simpan Usulan
              </Button>
            </div>
          }
        >
          <div className="space-y-3 text-xs max-h-96 overflow-y-auto">
            <p className="text-slate-500">
              Isi perkiraan kebutuhan pekerjaan lanjutan (pipeline) dan perkiraan kebutuhan tak terduga (forecast) per kode KHS material.
            </p>

            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800 font-semibold text-[10px] border-b">
                  <th className="py-1.5 px-2">Kode KHS</th>
                  <th className="py-1.5 px-2 text-right">Kebutuhan MTO</th>
                  <th className="py-1.5 px-2">Qty Pipeline</th>
                  <th className="py-1.5 px-2">Qty Forecast</th>
                  <th className="py-1.5 px-2">Catatan</th>
                </tr>
              </thead>
              <tbody className="divide-y font-sans">
                {proposalLines.map((l, idx) => (
                  <tr key={idx}>
                    <td className="py-1 px-2 font-mono font-bold">{l.khs_code}</td>
                    <td className="py-1 px-2 text-right font-mono">{l.qty_work}</td>
                    <td className="py-1 px-2">
                      <input
                        type="number"
                        min="0"
                        value={l.qty_pipeline}
                        onChange={(e) => {
                          const val = e.target.value
                          setProposalLines((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, qty_pipeline: val } : item
                            )
                          )}
                        }
                        className="w-20 px-2 py-1 text-xs border rounded font-mono"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <input
                        type="number"
                        min="0"
                        value={l.qty_forecast}
                        onChange={(e) => {
                          const val = e.target.value
                          setProposalLines((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, qty_forecast: val } : item
                            )
                          )}
                        }
                        className="w-20 px-2 py-1 text-xs border rounded font-mono"
                      />
                    </td>
                    <td className="py-1 px-2">
                      <input
                        type="text"
                        value={l.note}
                        onChange={(e) => {
                          const val = e.target.value
                          setProposalLines((prev) =>
                            prev.map((item, i) =>
                              i === idx ? { ...item, note: val } : item
                            )
                          )}
                        }
                        placeholder="Keterangan..."
                        className="w-32 px-2 py-1 text-xs border rounded"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {/* DRAWER 2: Adjust Quantity (Perencanaan UP3) */}
      <Modal
        open={adjustModalOpen}
        title="Sesuaikan Kuantitas Material KHS"
        onClose={() => setAdjustModalOpen(false)}
        size="max-w-lg"
      >
        <form onSubmit={handleAdjustQuantity} className="space-y-4 text-xs">
          {adjustError && <Alert kind="error">{adjustError}</Alert>}

          <div>
            <label className="block font-semibold mb-1">Kode KHS *</label>
            <input
              type="text"
              required
              value={adjustKhsCode}
              onChange={(e) => setAdjustKhsCode(e.target.value)}
              className="block w-full px-3 py-1.5 border rounded font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">Kuantitas Baru *</label>
            <input
              type="number"
              min="0"
              required
              value={adjustQuantity}
              onChange={(e) => setAdjustQuantity(e.target.value)}
              className="block w-full px-3 py-1.5 border rounded font-mono"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1">Alasan Penyesuaian * (Wajib)</label>
            <textarea
              rows={2}
              required
              value={adjustReason}
              onChange={(e) => setAdjustReason(e.target.value)}
              placeholder="Contoh: Rasionalisasi kebutuhan berdasarkan sisa pagu anggaran..."
              className="block w-full px-3 py-2 border rounded"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAdjustModalOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={adjusting}>
              Simpan Penyesuaian
            </Button>
          </div>
        </form>
      </Modal>

      {/* DRAWER 3: Submit Step Decision (UP3) */}
      <Modal
        open={decisionModalOpen}
        title="Keputusan Langkah Validasi RKM"
        onClose={() => setDecisionModalOpen(false)}
        size="max-w-lg"
      >
        <form onSubmit={handleDecision} className="space-y-4 text-xs">
          {decisionError && <Alert kind="error">{decisionError}</Alert>}

          <div>
            <label className="block font-semibold mb-1">Langkah Validasi *</label>
            <select
              value={decisionStep}
              onChange={(e) => setDecisionStep(e.target.value)}
              className="block w-full px-3 py-2 border rounded font-semibold"
            >
              {canValidatePerencanaan && (
                <option value="VALIDATE_PERENCANAAN">
                  Validasi Perencanaan (ASMAN / Tim Perencanaan)
                </option>
              )}
              {canValidateKonstruksi && (
                <option value="VALIDATE_KONSTRUKSI">
                  Validasi Konstruksi (ASMAN / Tim Konstruksi)
                </option>
              )}
              {canApproveUp3 && (
                <option value="APPROVE_UP3_MANAGER">
                  Persetujuan Akhir (UP3 Manager)
                </option>
              )}
            </select>
          </div>

          <div>
            <label className="block font-semibold mb-1">Keputusan *</label>
            <div className="flex items-center gap-3">
              {['APPROVED', 'RETURNED', 'REJECTED'].map((dec) => (
                <label key={dec} className="flex items-center gap-1.5 cursor-pointer">
                  <input
                    type="radio"
                    name="decisionVal"
                    value={dec}
                    checked={decisionValue === dec}
                    onChange={(e) => setDecisionValue(e.target.value)}
                  />
                  <span className="font-bold">{dec}</span>
                </label>
              ))}
            </div>
          </div>

          <div>
            <label className="block font-semibold mb-1">
              Catatan Keputusan {decisionValue !== 'APPROVED' && <span className="text-rose-500">* (Wajib)</span>}
            </label>
            <textarea
              rows={3}
              required={decisionValue !== 'APPROVED'}
              value={decisionNotes}
              onChange={(e) => setDecisionNotes(e.target.value)}
              placeholder={
                decisionValue !== 'APPROVED'
                  ? 'Tuliskan alasan pengembalian/penolakan dan instruksi perbaikan...'
                  : 'Catatan persetujuan (opsional)...'
              }
              className="block w-full px-3 py-2 border rounded"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setDecisionModalOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={deciding}>
              Kirim Keputusan
            </Button>
          </div>
        </form>
      </Modal>

      {/* DRAWER 4: Amend Plan */}
      <Modal
        open={amendModalOpen}
        title="Amandemen Rencana RKM"
        onClose={() => setAmendModalOpen(false)}
        size="max-w-lg"
      >
        <form onSubmit={handleAmend} className="space-y-4 text-xs">
          {amendError && <Alert kind="error">{amendError}</Alert>}

          <p className="text-slate-600 dark:text-slate-300">
            Mengamandemen rencana RKM yang telah disetujui akan menginisiasi versi baru dengan status <strong>COLLECTING</strong> untuk putaran berikutnya.
          </p>

          <div>
            <label className="block font-semibold mb-1">
              Alasan Amandemen * (Wajib untuk catatan audit)
            </label>
            <textarea
              rows={3}
              required
              value={amendReason}
              onChange={(e) => setAmendReason(e.target.value)}
              placeholder="Contoh: Perubahan target kinerja distribusi atau penambahan proyek prioritas..."
              className="block w-full px-3 py-2 border rounded"
            />
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setAmendModalOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={amending}>
              Inisiasi Amandemen
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
