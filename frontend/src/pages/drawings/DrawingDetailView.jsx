import { Fragment, useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { drawingApi, documentApi, mtoApi, applicationApi } from '../../services/api.js'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import ConfirmationModal from '../../components/ConfirmationModal.jsx'
import MtoPackageDetailView from '../mto/MtoPackageDetailView.jsx'
import DocumentPreview, { canPreview } from './DocumentPreview.jsx'
import DrawingApprovalChain, { DRAWING_STAGE_LABELS, DRAWING_STEP_LABELS, buildFlowGuide } from './DrawingApprovalChain.jsx'
import {
  IconCheck,
  IconX,
  IconChevronDown,
  IconShield,
  IconUsers,
  IconEye,
  IconDownload,
  IconTrash,
  IconFileText,
  IconTag,
  IconRefresh,
  IconAlertCircle,
  IconCalculator,
  IconArrowRight,
} from '../../components/icons.jsx'

// Helper ambil nomor agenda dari data permohonan
export const getApplicationAgenda = (app) => {
  if (!app) return ''
  if (app.agenda_number) return app.agenda_number
  if (Array.isArray(app.external_references)) {
    const agendaRef = app.external_references.find(
      (r) => (r.reference_type === 'AGENDA' || r.type === 'AGENDA') && r.is_active !== false
    )
    if (agendaRef?.reference_number) return agendaRef.reference_number
    if (agendaRef?.reference_value) return agendaRef.reference_value
    if (agendaRef?.value) return agendaRef.value
  }
  return ''
}

// Helper ambil nama pelanggan dari data permohonan
export const getApplicationCustomerName = (app) => {
  if (!app) return ''
  return app.customer?.name || app.customer_name || ''
}

// Helper format judul & penamaan gambar usulan otomatis: GBR_USULAN_AGENDA_NAMA PELANGGAN
export const getAutoTitle = (appData) => {
  const agenda = getApplicationAgenda(appData) || appData?.application_number || 'AGENDA'
  const nama = getApplicationCustomerName(appData) || 'PELANGGAN'
  const cleanAgenda = String(agenda).trim().replace(/[\/\\]/g, '_')
  const cleanNama = String(nama).trim().replace(/[\/\\]/g, '_')
  return `GBR_USULAN_${cleanAgenda}_${cleanNama}`
}

export default function DrawingDetailView({
  drawingId,
  application: initialApp,
  onBack,
  onReloadApplication,
  previewOnly = false,
  hideApprovalChain = false,
  hideHistory = false,
}) {
  const { user } = useAuth()
  const { notify } = useNotifications()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [drawing, setDrawing] = useState(null)
  const [appDetails, setAppDetails] = useState(initialApp || null)
  const [error, setError] = useState('')

  // Form State for editing DRAFT
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    notes: '',
  })
  const [savingDraft, setSavingDraft] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  // File Upload State
  const [uploadingMain, setUploadingMain] = useState(false)
  const [uploadingAttachment, setUploadingAttachment] = useState(false)
  const [uploadError, setUploadError] = useState('')

  // Decision Modal State
  const [decisionStep, setDecisionStep] = useState(null)
  const [decisionType, setDecisionType] = useState('APPROVED')
  const [decisionNotes, setDecisionNotes] = useState('')
  const [submittingDecision, setSubmittingDecision] = useState(false)
  const [decisionError, setDecisionError] = useState('')

  // Escalate Modal State
  const [escalateOpen, setEscalateOpen] = useState(false)
  const [escalateReason, setEscalateReason] = useState('')
  const [escalating, setEscalating] = useState(false)
  const [escalateError, setEscalateError] = useState('')

  // Reassign Modal State
  const [reassignOpen, setReassignOpen] = useState(false)
  const [authors, setAuthors] = useState([])
  const [loadingAuthors, setLoadingAuthors] = useState(false)
  const [selectedAuthor, setSelectedAuthor] = useState('')
  const [reassigning, setReassigning] = useState(false)
  const [reassignError, setReassignError] = useState('')

  // Revise State
  const [revising, setRevising] = useState(false)
  const [reviseError, setReviseError] = useState('')
  const [reviseConfirmOpen, setReviseConfirmOpen] = useState(false)
  const [deleteDocTarget, setDeleteDocTarget] = useState(null)

  // MTO Package State
  const [mtoPackage, setMtoPackage] = useState(null)
  const [loadingMto, setLoadingMto] = useState(false)
  const [mtoViewOpen, setMtoViewOpen] = useState(false)
  const [detailTab, setDetailTab] = useState('gambar')
  const [submitError, setSubmitError] = useState('')
  const [creatingMto, setCreatingMto] = useState(false)
  const [copyFromPrevious, setCopyFromPrevious] = useState(false)

  // Accordion for Returned & Superseded Versions
  const [expandedVersions, setExpandedVersions] = useState({})

  // Sinkronkan state appDetails bila initialApp berubah
  useEffect(() => {
    if (initialApp) {
      setAppDetails((prev) => ({ ...prev, ...initialApp }))
    }
  }, [initialApp])

  const loadDrawing = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await drawingApi.get(drawingId)
      setDrawing(res.data)

      // Cari atau lengkapi data permohonan (nama pelanggan & nomor agenda)
      let resolvedApp = initialApp || res.data.application || {}
      const hasCustomer = Boolean(getApplicationCustomerName(resolvedApp))
      const hasAgenda = Boolean(getApplicationAgenda(resolvedApp))

      if ((!hasCustomer || !hasAgenda) && res.data.application?.id && typeof applicationApi?.get === 'function') {
        try {
          const appRes = await applicationApi.get(res.data.application.id)
          if (appRes?.data) {
            resolvedApp = { ...res.data.application, ...resolvedApp, ...appRes.data }
            setAppDetails(resolvedApp)
          }
        } catch {
          // Abaikan bila permohonan gagal diambil, gunakan fallback
        }
      } else if (resolvedApp) {
        setAppDetails(resolvedApp)
      }

      const latest = res.data.versions?.[res.data.versions.length - 1]
      if (latest) {
        const autoTitle = getAutoTitle(resolvedApp)
        const isFallback =
          !latest.title ||
          latest.title === 'GBR_USULAN_AGENDA_NAMA PELANGGAN' ||
          latest.title.includes('_NAMA PELANGGAN') ||
          latest.title.includes('_AGENDA_')

        setFormData({
          title: isFallback ? autoTitle : latest.title,
          description: latest.description || '',
          notes: latest.notes || '',
        })

        // Fetch MTO package for latest version (docs/63 §F)
        try {
          const mtoRes = await mtoApi.forVersion(drawingId, latest.id)
          setMtoPackage(mtoRes.data)
        } catch {
          setMtoPackage(null)
        }
      }
    } catch (err) {
      setError(err.message || 'Gagal memuat detail paket gambar teknik.')
    } finally {
      setLoading(false)
    }
  }, [drawingId, initialApp])

  useEffect(() => {
    loadDrawing()
  }, [loadDrawing])

  const openVersion = drawing?.versions?.find((v) => ['DRAFT', 'SUBMITTED', 'UNDER_REVIEW'].includes(v.status))
  const latestVersion = drawing?.versions?.[drawing.versions.length - 1]
  const returnedVersions = drawing?.versions?.filter((v) => v.status === 'RETURNED') || []
  const supersededVersions = drawing?.versions?.filter((v) => v.status === 'SUPERSEDED') || []
  const approvedVersion = drawing?.versions?.find((v) => v.status === 'APPROVED')

  const isWithSurvey = Boolean(latestVersion?.with_survey ?? drawing?.with_survey)
  const surveyTargetId = drawing?.survey_id || latestVersion?.survey_id || drawing?.application?.survey_id || latestVersion?.survey_version_id

  // null = belum dipilih pengguna: untuk pemutus, berkas utama otomatis terbuka agar bisa ditinjau sebelum memutuskan
  const [previewChoice, setPreviewChoice] = useState(null)

  const canExecute = previewOnly ? false : Boolean(drawing?.can?.execute && openVersion?.status === 'DRAFT')
  const canAssign = previewOnly ? false : Boolean(drawing?.can?.assign)
  const canRevise = previewOnly ? false : Boolean(drawing?.can?.revise)
  const canEscalate = previewOnly ? false : (isWithSurvey ? false : Boolean(drawing?.can?.escalate))
  const canDecideSteps = previewOnly ? [] : (isWithSurvey ? [] : (drawing?.can?.decide || []))


  // Split documents of latest version
  const mainDocument = latestVersion?.documents?.find((d) => d.file_role === 'MAIN')
  const previewDocId = previewChoice === null ? (canDecideSteps.length > 0 ? mainDocument?.id ?? null : null) : (previewChoice === 'none' ? null : previewChoice)
  const togglePreview = (id) => setPreviewChoice(previewDocId === id ? 'none' : id)
  const attachmentDocuments = latestVersion?.documents?.filter((d) => d.file_role === 'ATTACHMENT') || []

  // Panduan posisi alur: siapa yang ditunggu pada status versi terbaru (teks dibagi dengan rantai di halaman usulan)
  const flowGuide = buildFlowGuide(latestVersion, mtoPackage, canExecute)

  // Download document with Bearer token
  const handleDownloadDoc = async (docId, fileName) => {
    try {
      const blob = await documentApi.downloadBlob(docId, { inline: false })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName || `dokumen-${docId}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      alert(err.message || 'Gagal mengunduh berkas gambar.')
    }
  }

  // Delete document
  const handleDeleteDoc = (docId) => {
    setDeleteDocTarget(docId)
  }

  const handleConfirmDeleteDoc = async () => {
    if (!deleteDocTarget) return
    try {
      await documentApi.remove(deleteDocTarget)
      setDeleteDocTarget(null)
      loadDrawing()
    } catch (err) {
      alert(err.message || 'Gagal menghapus berkas.')
    }
  }

  // Upload file (MAIN or ATTACHMENT)
  const handleFileUpload = async (e, role = 'MAIN') => {
    const file = e.target.files?.[0]
    if (!file) return

    setUploadError('')
    if (role === 'MAIN') setUploadingMain(true)
    else setUploadingAttachment(true)

    try {
      const currentApp = appDetails || drawing?.application
      const autoTitle = getAutoTitle(currentApp)
      const baseTitle = formData.title?.trim() || autoTitle
      const docTitle = role === 'MAIN' ? baseTitle : `${baseTitle} - Lampiran ${attachmentDocuments.length + 1}`
      await drawingApi.uploadDocument(drawing.id, latestVersion.id, file, {
        role,
        title: docTitle,
      })
      loadDrawing()
    } catch (err) {
      setUploadError(err.message || `Gagal mengunggah berkas ${role === 'MAIN' ? 'utama' : 'lampiran'}.`)
    } finally {
      if (role === 'MAIN') setUploadingMain(false)
      else setUploadingAttachment(false)
      e.target.value = ''
    }
  }

  // Save Draft (PATCH)
  const handleSaveDraft = async (e) => {
    if (e) e.preventDefault()
    setSavingDraft(true)
    setFormError('')

    try {
      const currentApp = appDetails || drawing?.application
      const effectiveTitle = formData.title?.trim() || getAutoTitle(currentApp)
      await drawingApi.updateDraft(drawing.id, latestVersion.id, {
        title: effectiveTitle,
        description: formData.description || undefined,
        notes: formData.notes || undefined,
      })
      notify({
        type: 'success',
        title: 'Draf Gambar Disimpan',
        desc: 'Draf paket gambar berhasil disimpan.',
        tag: 'Gambar Teknik',
      })
      loadDrawing()
    } catch (err) {
      setFormError(err.message || 'Gagal menyimpan draf gambar.')
    } finally {
      setSavingDraft(false)
    }
  }

  // Submit Drawing Version
  const handleSubmitDrawing = async () => {
    setSubmitting(true)
    setFormError('')
    setSubmitError('')
    try {
      await drawingApi.submit(drawing.id, latestVersion.id)
      notify({
        type: 'success',
        title: 'Paket Gambar Diajukan',
        desc: 'Paket gambar teknik berhasil diajukan untuk proses persetujuan.',
        tag: 'Gambar Teknik',
      })
      loadDrawing()
      onReloadApplication?.()
    } catch (err) {
      // shown next to the submit button (the form's own alert sits far above and may be on another tab)
      setSubmitError(err.message || 'Gagal mengajukan paket gambar.')
    } finally {
      setSubmitting(false)
    }
  }

  // Create MTO Package (POST /drawings/{d}/versions/{v}/mto)
  const handleCreateMto = async () => {
    if (!drawing || !latestVersion) return
    setCreatingMto(true)
    try {
      const res = await mtoApi.create(drawing.id, latestVersion.id, copyFromPrevious)
      setMtoPackage(res.data)
      setDetailTab('mto')
      loadDrawing()
    } catch (err) {
      alert(err.message || 'Gagal membuat paket MTO.')
    } finally {
      setCreatingMto(false)
    }
  }

  // Escalate
  const handleConfirmEscalate = async (e) => {
    e.preventDefault()
    if (!escalateReason.trim()) {
      setEscalateError('Alasan persetujuan diperluas wajib diisi.')
      return
    }
    setEscalating(true)
    setEscalateError('')
    try {
      await drawingApi.escalate(drawing.id, latestVersion.id, {
        reason: escalateReason.trim(),
      })
      setEscalateOpen(false)
      loadDrawing()
    } catch (err) {
      setEscalateError(err.message || 'Gagal mewajibkan persetujuan diperluas.')
    } finally {
      setEscalating(false)
    }
  }

  // Decisions
  const handleOpenDecisionModal = (step, type) => {
    setDecisionStep(step)
    setDecisionType(type)
    setDecisionNotes('')
    setDecisionError('')
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
      await drawingApi.decide(drawing.id, latestVersion.id, {
        step: decisionStep,
        decision: decisionType,
        notes: decisionNotes.trim() || undefined,
      })
      notify({
        type: decisionType === 'APPROVED' ? 'success' : 'warning',
        title: decisionType === 'APPROVED' ? 'Gambar Teknik Disetujui' : 'Gambar Teknik Ditolak',
        desc: `Tahap ${decisionStep} gambar "${drawing?.title || 'Gambar Teknik'}" telah ${decisionType === 'APPROVED' ? 'disetujui' : 'ditolak'}.`,
        tag: 'Gambar Teknik',
      })
      setDecisionStep(null)
      loadDrawing()
      onReloadApplication?.()
    } catch (err) {
      setDecisionError(err.message || 'Gagal mengirimkan keputusan.')
    } finally {
      setSubmittingDecision(false)
    }
  }

  // Revise (POST /drawings/{id}/versions)
  const handleCreateRevision = () => {
    setReviseConfirmOpen(true)
  }

  const handleConfirmRevision = async () => {
    setRevising(true)
    setReviseError('')
    try {
      await drawingApi.revise(drawing.id)
      setReviseConfirmOpen(false)
      loadDrawing()
    } catch (err) {
      setReviseError(err.message || 'Gagal membuat revisi gambar.')
    } finally {
      setRevising(false)
    }
  }

  // Reassign
  const handleOpenReassign = async () => {
    setReassignOpen(true)
    setReassignError('')
    setLoadingAuthors(true)
    try {
      const res = await drawingApi.authors(drawing.application.id)
      setAuthors(res.data || [])
      setSelectedAuthor(res.data?.[0]?.id || '')
    } catch (err) {
      setReassignError(err.message || 'Gagal memuat daftar penyusun.')
    } finally {
      setLoadingAuthors(false)
    }
  }

  const handleConfirmReassign = async (e) => {
    e.preventDefault()
    if (!selectedAuthor) return
    setReassigning(true)
    setReassignError('')
    try {
      await drawingApi.reassign(drawing.id, { assigned_to: selectedAuthor })
      setReassignOpen(false)
      loadDrawing()
    } catch (err) {
      setReassignError(err.message || 'Gagal menugaskan ulang penyusun.')
    } finally {
      setReassigning(false)
    }
  }

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Spinner label="Memuat paket gambar teknik..." />
      </div>
    )
  }

  if (error || !drawing) {
    return (
      <div className="p-6 space-y-4">
        <Alert kind="error">{error || 'Paket gambar teknik tidak ditemukan.'}</Alert>
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← Kembali
          </Button>
        )}
      </div>
    )
  }

  // Jika sedang membuka/mengelola Paket MTO, tampilkan sebagai tampilan halaman (bukan modal)
  if (mtoViewOpen && mtoPackage) {
    return (
      <div className="space-y-6">
        <MtoPackageDetailView
          packageId={mtoPackage.id}
          drawingId={drawing.id}
          versionId={latestVersion?.id}
          onBack={() => {
            setMtoViewOpen(false)
            loadDrawing()
          }}
          onReload={() => {
            loadDrawing()
          }}
        />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Banner Preview-Only Mode */}
      {previewOnly && (
        <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-800 bg-blue-50/80 dark:bg-blue-950/40 text-blue-900 dark:text-blue-100 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-2xs">
          <div className="flex items-start gap-2.5">
            <span className="p-1.5 rounded-lg bg-blue-600 text-white font-bold text-xs shrink-0 mt-0.5">
              <IconEye size={16} />
            </span>
            <div>
              <span className="font-bold text-xs block">Pratinjau Gambar Teknik &amp; MTO (Mode Pratinjau)</span>
              <p className="text-[11px] text-blue-700 dark:text-blue-300 mt-0.5 leading-relaxed">
                Drawer ini hanya digunakan untuk melihat pratinjau data. Untuk melakukan input data (unggah gambar, isi spesifikasi teknis, atau menyusun paket MTO), silakan buka halaman gambar penuh.
              </p>
            </div>
          </div>
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              const propId = appDetails?.proposal_id || drawing?.application?.proposal_id
              if (propId) {
                navigate(`/usulan/${propId}?tab=drawings`)
              } else {
                navigate(`/gambar/${drawingId}`)
              }
            }}
            className="shrink-0 inline-flex items-center gap-1.5 font-semibold text-xs"
          >
            <span>Buka Halaman Gambar &amp; MTO</span>
            <IconArrowRight size={13} />
          </Button>
        </div>
      )}

      {/* Header Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <div className="flex items-center gap-2">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-semibold"
              >
                ← Kembali
              </button>
            )}
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Paket Gambar #{drawing.drawing_number}
            </h3>
            {latestVersion?.extended_approval && (
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300">
                Persetujuan Diperluas
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Permohonan: <span className="font-semibold text-slate-700 dark:text-slate-300">{drawing.application?.application_number}</span>
            {getApplicationCustomerName(appDetails || drawing.application) && (
              <> · Pelanggan: <span className="font-semibold text-slate-700 dark:text-slate-300">{getApplicationCustomerName(appDetails || drawing.application)}</span></>
            )}
            {getApplicationAgenda(appDetails || drawing.application) && (
              <> · Agenda: <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">{getApplicationAgenda(appDetails || drawing.application)}</span></>
            )}
            {' '}· Penyusun: <span className="font-semibold text-slate-700 dark:text-slate-300">{drawing.author?.name}</span> ({drawing.author?.email})
          </p>
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {canAssign && (
            <Button variant="secondary" size="sm" onClick={handleOpenReassign}>
              Tugaskan Ulang
            </Button>
          )}
          {canEscalate && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => { setEscalateOpen(true); setEscalateReason(''); setEscalateError('') }}
            >
              Wajibkan Persetujuan Diperluas
            </Button>
          )}
          {canRevise && (
            <Button
              variant="primary"
              size="sm"
              loading={revising}
              onClick={handleCreateRevision}
            >
              Buat Revisi (Versi Baru)
            </Button>
          )}
        </div>
      </div>

      {reviseError && <Alert kind="error">{reviseError}</Alert>}

      {latestVersion?.status === 'RETURNED' && latestVersion?.return_reason && (
        <Alert kind="error">
          {latestVersion.returned_at_step === 'PROPOSAL_CANCELLED' ? (
            <span>
              Paket gambar ini <strong>Dikembalikan: usulan dibatalkan</strong>. Alasan: <em>&ldquo;{latestVersion.return_reason}&rdquo;</em>
            </span>
          ) : (
            <span>
              Paket gambar ini dikembalikan pada tahap <strong>{DRAWING_STEP_LABELS[latestVersion.returned_at_step] || latestVersion.returned_at_step}</strong>. Alasan: <em>&ldquo;{latestVersion.return_reason}&rdquo;</em>
            </span>
          )}
        </Alert>
      )}

      {isWithSurvey && (
        <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/80 dark:bg-blue-950/40 text-xs text-blue-900 dark:text-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-2 shadow-sm">
          <div className="flex items-center gap-2">
            <IconShield className="text-blue-600 shrink-0" size={18} />
            <span className="font-medium">
              Gambar ini diputuskan bersama survei (satu paket).
            </span>
          </div>
          {surveyTargetId && (
            <Link
              to={`/survei/${surveyTargetId}`}
              className="inline-flex items-center gap-1 font-semibold text-blue-700 dark:text-blue-300 hover:text-blue-800 dark:hover:text-blue-100 hover:underline"
            >
              Lihat Survei →
            </Link>
          )}
        </div>
      )}

      {/* Rantai persetujuan versi terbaru (docs/63 §E) */}
      {!hideApprovalChain && (
        <DrawingApprovalChain version={latestVersion} mtoPackage={mtoPackage} guide={flowGuide} />
      )}

      {/* Decision Action Bar (When user has permission for pending step) */}
      {canDecideSteps.length > 0 && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 px-4 py-3 flex flex-col lg:flex-row lg:items-center gap-3 lg:gap-6">
          <div className="flex items-start gap-3 min-w-0 flex-1">
            <span className="shrink-0 w-8 h-8 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-600 dark:text-blue-300 flex items-center justify-center">
              <IconShield size={16} />
            </span>
            <div className="min-w-0">
              <h4 className="text-sm font-bold text-blue-900 dark:text-blue-200">Keputusan persetujuan Anda diperlukan</h4>
              <p className="text-xs text-blue-800/90 dark:text-blue-300 mt-0.5">
                Tinjau berkas gambar utama, lampiran, dan MTO lewat tombol Pratinjau di bawah sebelum memutuskan.
                {canDecideSteps.includes('ULP_MANAGER') && ' Menyetujui gambar pada tahap ini juga menyetujui MTO-nya.'}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {canDecideSteps.map((step) => (
              <div key={step} className="flex items-center gap-2 pl-3 pr-2 py-1.5 rounded-lg bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800">
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-200 mr-1">
                  {DRAWING_STEP_LABELS[step] || step}
                </span>
                <Button size="sm" variant="success" onClick={() => handleOpenDecisionModal(step, 'APPROVED')}>
                  Setujui
                </Button>
                <Button size="sm" variant="danger" onClick={() => handleOpenDecisionModal(step, 'REJECTED')}>
                  Tolak
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab Gambar & Berkas / MTO (alur persetujuan tetap di atas, terlihat di kedua tab) */}
      {latestVersion && (
        <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800" role="tablist">
          {[['gambar', 'Gambar & Berkas'], ['mto', `Kalkulasi MTO${mtoPackage ? ` (${mtoPackage.status === 'APPROVED' ? 'Disetujui' : mtoPackage.status === 'VERIFIED' ? 'Terverifikasi' : 'Draf'})` : ''}`]].map(([key, label]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={detailTab === key}
              onClick={() => setDetailTab(key)}
              className={`px-4 py-2 text-xs font-semibold border-b-2 -mb-px transition-colors ${
                detailTab === key
                  ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      )}

      {detailTab === 'gambar' && (
      <>
      {/* Collapsible Returned & Superseded Versions */}
      {!hideHistory && returnedVersions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            Riwayat Versi yang Dikembalikan ({returnedVersions.length})
          </h4>
          {returnedVersions.map((v) => {
            const isExp = Boolean(expandedVersions[v.id])
            return (
              <div key={v.id} className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/30 dark:bg-rose-950/20 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedVersions((prev) => ({ ...prev, [v.id]: !prev[v.id] }))}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-rose-50/60 dark:hover:bg-rose-950/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-rose-800 dark:text-rose-300">
                      Versi {v.version_number} (RETURNED)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      {v.returned_at_step === 'PROPOSAL_CANCELLED' ? (
                        <strong>Dikembalikan: usulan dibatalkan</strong>
                      ) : (
                        <>pada langkah: <strong>{DRAWING_STEP_LABELS[v.returned_at_step] || v.returned_at_step}</strong></>
                      )}
                    </span>
                  </div>
                  <IconChevronDown size={14} className={`transform transition-transform ${isExp ? 'rotate-180' : ''}`} />
                </button>
                {isExp && (
                  <div className="p-4 border-t border-rose-100 dark:border-rose-900/40 space-y-3 bg-white/70 dark:bg-slate-900/70 text-xs">
                    <div>
                      <span className="text-slate-400">Alasan Pengembalian:</span>
                      <p className="font-semibold text-rose-700 dark:text-rose-400 mt-0.5">
                        &ldquo;{v.return_reason || '-'}&rdquo;
                      </p>
                    </div>
                    <div>
                      <span className="text-slate-400">Judul & Uraian:</span>
                      <p className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">{v.title} — {v.description || '-'}</p>
                    </div>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Main Content: Form for DRAFT or Read-Only for Submitted */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Rincian Desain & Berkas Gambar {latestVersion ? `(Versi ${latestVersion.version_number})` : ''}
          </h4>
          {canExecute && (
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              ✏️ Mode Penyusunan Draf (Penyusun TEKNIK)
            </span>
          )}
        </div>

        {formError && <Alert kind="error">{formError}</Alert>}
        {uploadError && <Alert kind="error">{uploadError}</Alert>}

        {canExecute ? (
          /* Editable Form for Drafter */
          <form id="drawing-draft-form" onSubmit={handleSaveDraft} className="space-y-4">
            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                  Judul Gambar Teknik <span className="text-rose-500">*</span>
                </label>
                <button
                  type="button"
                  onClick={() => {
                    const currentApp = appDetails || drawing?.application
                    const autoTitle = getAutoTitle(currentApp)
                    setFormData((prev) => ({ ...prev, title: autoTitle }))
                  }}
                  title="Klik untuk mengisi otomatis sesuai format: GBR_USULAN_{AGENDA}_{NAMA PELANGGAN}"
                  className="text-[10px] text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 px-2 py-0.5 rounded font-mono font-semibold transition-colors cursor-pointer"
                >
                  Format Otomatis: GBR_USULAN_AGENDA_NAMA PELANGGAN ↻
                </button>
              </div>
              <input
                type="text"
                value={formData.title}
                onChange={(e) => setFormData({ ...formData, title: e.target.value })}
                placeholder="GBR_USULAN_AGENDA_NAMA PELANGGAN"
                required
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono"
              />
            </div>

            {/* Berkas Gambar Utama (MAIN) */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="space-y-1">
                  <h5 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                    Berkas Gambar Utama (MAIN) <span className="text-rose-500">*</span>
                  </h5>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Format yang didukung: Excel (.xlsx, .xls), PDF (.pdf), CAD (.dwg, .dxf), atau Gambar (.jpg, .jpeg, .png, .webp) ≤50 MB.
                  </p>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Format penamaan berkas &amp; gambar otomatis: <span className="font-mono font-semibold text-blue-600 dark:text-blue-400">GBR_USULAN_{'{AGENDA}'}_{'{NAMA PELANGGAN}'}</span> (lampiran ditambah “ - Lampiran n”).
                  </p>
                  <p className="text-[11px] text-blue-700 dark:text-blue-300 bg-blue-50/80 dark:bg-blue-950/40 p-2 rounded-lg border border-blue-200 dark:border-blue-900">
                    Unggah lembar GAMBAR Excel (xlsx/xls) atau PDF hasil ekspor Excel agar kebutuhan material terbaca otomatis; DWG/DXF/foto sebagai lampiran, jumlah diisi manual.
                  </p>
                </div>
                {!mainDocument && (
                  <label className="cursor-pointer shrink-0">
                    <input
                      type="file"
                      accept=".xlsx,.xls,.pdf,.dwg,.dxf,.jpg,.jpeg,.png,.webp"
                      onChange={(e) => handleFileUpload(e, 'MAIN')}
                      disabled={uploadingMain}
                      className="hidden"
                    />
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors">
                      {uploadingMain ? 'Mengunggah…' : '+ Unggah Gambar Utama'}
                    </span>
                  </label>
                )}
              </div>

              {mainDocument ? (
                <div className="p-3 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2.5">
                    <span className="p-2 rounded bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 font-bold text-[10px] uppercase">
                      {mainDocument.extension || 'FILE'}
                    </span>
                    <div>
                      <p className="font-semibold text-slate-800 dark:text-slate-200">{mainDocument.title || mainDocument.original_name}</p>
                      <span className="text-[10px] text-slate-400">{mainDocument.original_name} · {(mainDocument.size_bytes / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDownloadDoc(mainDocument.id, mainDocument.original_name)}
                    >
                      Unduh
                    </Button>
                    <button
                      type="button"
                      onClick={() => handleDeleteDoc(mainDocument.id)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 rounded"
                      title="Hapus berkas utama"
                    >
                      <IconTrash size={14} />
                    </button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-rose-500 italic">
                  Belum ada berkas gambar utama. Wajib diunggah sebelum dapat diajukan.
                </p>
              )}
            </div>

            {/* Lampiran Teknis (ATTACHMENT) */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h5 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200">
                    Lampiran Tambahan (ATTACHMENT) ({attachmentDocuments.length})
                  </h5>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Berkas pendukung seperti kalkulasi, nota dinas, atau foto (≤50 MB).
                  </p>
                </div>
                <label className="cursor-pointer">
                  <input
                    type="file"
                    accept=".pdf,.dwg,.dxf,.jpg,.jpeg,.png,.webp,.xls,.xlsx,.doc,.docx"
                    onChange={(e) => handleFileUpload(e, 'ATTACHMENT')}
                    disabled={uploadingAttachment}
                    className="hidden"
                  />
                  <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-800 dark:text-slate-200 transition-colors">
                    {uploadingAttachment ? 'Mengunggah…' : '+ Tambah Lampiran'}
                  </span>
                </label>
              </div>

              {attachmentDocuments.length > 0 ? (
                <div className="space-y-2">
                  {attachmentDocuments.map((doc) => (
                    <div key={doc.id} className="p-2.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="p-1 px-1.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-[10px] uppercase">
                          {doc.extension || 'FILE'}
                        </span>
                        <div>
                          <p className="font-semibold text-slate-800 dark:text-slate-200">{doc.title || doc.original_name}</p>
                          <span className="text-[10px] text-slate-400">{(doc.size_bytes / 1024).toFixed(1)} KB</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDownloadDoc(doc.id, doc.original_name)}
                        >
                          Unduh
                        </Button>
                        <button
                          type="button"
                          onClick={() => handleDeleteDoc(doc.id)}
                          className="p-1.5 text-slate-400 hover:text-rose-600 rounded"
                          title="Hapus lampiran"
                        >
                          <IconTrash size={14} />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">Tidak ada lampiran tambahan.</p>
              )}
            </div>

            {/* Uraian Desain & Spesifikasi Teknis diletakkan di bawah berkas gambar/lampiran */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Uraian Desain & Spesifikasi Teknis
              </label>
              <textarea
                rows={3}
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                placeholder="Rincian jalur konstruksi tiang, kabel SUTM/SUTR, konfigurasi gardu…"
                className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>
          </form>
        ) : (
          /* Read-Only Presentation */
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
              <span className="text-slate-400">Judul Gambar Teknik:</span>
              <p className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {latestVersion?.title || '-'}
              </p>
              {latestVersion?.description && (
                <div className="pt-2">
                  <span className="text-slate-400">Uraian Desain:</span>
                  <p className="text-slate-700 dark:text-slate-300 mt-0.5 whitespace-pre-wrap">{latestVersion.description}</p>
                </div>
              )}
              {latestVersion?.notes && (
                <div className="pt-1">
                  <span className="text-slate-400">Catatan:</span>
                  <p className="text-slate-600 dark:text-slate-400 italic mt-0.5">{latestVersion.notes}</p>
                </div>
              )}
            </div>

            {/* Main File */}
            <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/30 dark:bg-blue-950/20 space-y-2">
              <span className="text-[11px] font-bold uppercase tracking-wider text-blue-900 dark:text-blue-300">
                Berkas Gambar Utama (MAIN)
              </span>
              {mainDocument ? (
                <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800 flex items-center justify-between text-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300 flex items-center justify-center font-bold text-xs uppercase">
                      {mainDocument.extension || 'DWG'}
                    </div>
                    <div>
                      <p className="font-bold text-slate-800 dark:text-slate-200">{mainDocument.title || mainDocument.original_name}</p>
                      <span className="text-[10px] text-slate-400">{mainDocument.original_name} · {(mainDocument.size_bytes / 1024).toFixed(1)} KB</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {canPreview(mainDocument) && (
                      <Button type="button" variant="secondary" size="sm" aria-expanded={previewDocId === mainDocument.id} onClick={() => togglePreview(mainDocument.id)}>
                        {previewDocId === mainDocument.id ? 'Tutup Pratinjau' : 'Pratinjau'}
                      </Button>
                    )}
                    <Button type="button" variant="primary" size="sm" onClick={() => handleDownloadDoc(mainDocument.id, mainDocument.original_name)}>
                      Unduh
                    </Button>
                  </div>
                </div>
              ) : (
                <p className="text-xs text-slate-400 italic">Tidak ada berkas gambar utama.</p>
              )}
              {mainDocument && previewDocId === mainDocument.id && (
                <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800">
                  <DocumentPreview doc={mainDocument} />
                </div>
              )}
            </div>

            {/* Attachments */}
            {attachmentDocuments.length > 0 && (
              <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Lampiran Pendukung ({attachmentDocuments.length})
                </span>
                <div className="space-y-2">
                  {attachmentDocuments.map((doc) => (
                    <Fragment key={doc.id}><div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-center justify-between text-xs">
                      <div className="flex items-center gap-2">
                        <span className="p-1 px-1.5 rounded bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold text-[10px] uppercase">
                          {doc.extension || 'FILE'}
                        </span>
                        <div>
                          <p className="font-semibold text-slate-800 dark:text-slate-200">{doc.title || doc.original_name}</p>
                          <span className="text-[10px] text-slate-400">{(doc.size_bytes / 1024).toFixed(1)} KB</span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        {canPreview(doc) && (
                          <Button type="button" variant="ghost" size="sm" aria-expanded={previewDocId === doc.id} onClick={() => togglePreview(doc.id)}>
                            {previewDocId === doc.id ? 'Tutup' : 'Pratinjau'}
                          </Button>
                        )}
                        <Button type="button" variant="ghost" size="sm" onClick={() => handleDownloadDoc(doc.id, doc.original_name)}>
                          Unduh
                        </Button>
                      </div>
                    </div>
                    {previewDocId === doc.id && (
                      <div className="p-3 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700">
                        <DocumentPreview doc={doc} />
                      </div>
                    )}
                    </Fragment>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      </>
      )}

      {detailTab === 'mto' && (
      <>
      {/* Paket MTO langsung tampil di tab ini (tidak lewat tombol); mode pratinjau tetap memakai ringkasan di bawah */}
      {mtoPackage && !previewOnly && latestVersion && (
        <MtoPackageDetailView
          key={mtoPackage.id}
          packageId={mtoPackage.id}
          drawingId={drawing.id}
          versionId={latestVersion.id}
          onReload={() => {
            loadDrawing()
          }}
        />
      )}

      {/* MTO (Material Take-Off) Section per Drawing Version (docs/63 §F) */}
      {latestVersion && !(mtoPackage && !previewOnly) && (
        <div className="p-4 sm:p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <div className="flex items-center gap-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 dark:text-slate-200 flex items-center gap-2">
                  <IconCalculator size={16} className="text-blue-600 dark:text-blue-400" />
                  <span>Kalkulasi Material Take-Off (MTO) — Versi {latestVersion.version_number}</span>
                </h4>
                {mtoPackage && <StatusBadge status={mtoPackage.status} />}
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                Kebutuhan material terstruktur berbasis jenis konstruksi standar PLN dan mesin BOM. Persetujuan MTO oleh Manager ULP merupakan prasyarat pengesahan gambar teknik.
              </p>
            </div>

            <div className="flex items-center gap-2">
              {mtoPackage ? (
                previewOnly ? (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      const propId = appDetails?.proposal_id || drawing?.application?.proposal_id
                      if (propId) {
                        navigate(`/usulan/${propId}?tab=drawings`)
                      } else {
                        navigate(`/gambar/${drawingId}`)
                      }
                    }}
                    className="inline-flex items-center gap-1.5"
                  >
                    <span>Buka Halaman Gambar untuk Kelola MTO ({mtoPackage.package_number})</span>
                    <IconArrowRight size={12} />
                  </Button>
                ) : (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => setMtoViewOpen(true)}
                  >
                    Kelola &amp; Lihat MTO ({mtoPackage.package_number})
                  </Button>
                )
              ) : (
                canExecute && (
                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-2">
                    {drawing.versions?.length > 1 && (
                      <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={copyFromPrevious}
                          onChange={(e) => setCopyFromPrevious(e.target.checked)}
                          className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                        />
                        <span>Salin jumlah dari versi sebelumnya</span>
                      </label>
                    )}
                    <Button
                      variant="primary"
                      size="sm"
                      loading={creatingMto}
                      onClick={handleCreateMto}
                    >
                      + Buat Paket MTO
                    </Button>
                  </div>
                )
              )}
            </div>
          </div>

          {mtoPackage ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-slate-50 dark:bg-slate-800/40 p-3.5 rounded-lg border border-slate-200/60 dark:border-slate-700/60">
              <div>
                <span className="text-slate-400 block text-[11px] mb-0.5">Nomor Paket MTO:</span>
                <strong className="text-slate-800 dark:text-slate-200 font-mono text-sm">{mtoPackage.package_number}</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px] mb-0.5">Item Konstruksi:</span>
                <strong className="text-slate-800 dark:text-slate-200">{mtoPackage.items?.length || 0} jenis konstruksi terdaftar</strong>
              </div>
              <div>
                <span className="text-slate-400 block text-[11px] mb-0.5">Status Validasi Data:</span>
                <span className="text-slate-700 dark:text-slate-300 font-mono">
                  {mtoPackage.snapshot_hash ? `${mtoPackage.snapshot_hash.slice(0, 8)}… (Terkunci)` : 'Draf Dinamis (Belum diverifikasi)'}
                </span>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic py-2">
              Belum ada paket MTO yang disusun untuk versi gambar ini. Tekan tombol &quot;+ Buat Paket MTO&quot; di atas untuk mulai mengisi jumlah pasang/bongkar konstruksi.
            </p>
          )}
        </div>
      )}

      </>
      )}

      {/* Action Buttons at Bottom (Below MTO) */}
      {canExecute && submitError && <Alert kind="error">Pengajuan gagal: {submitError}</Alert>}
      {canExecute && (
        <div className="flex items-center justify-between p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          {detailTab === 'gambar' ? (
            <Button
              type="submit"
              form="drawing-draft-form"
              variant="secondary"
              loading={savingDraft}
            >
              Simpan Draf
            </Button>
          ) : <span />}
          <Button
            type="button"
            variant="primary"
            onClick={handleSubmitDrawing}
            loading={submitting}
            disabled={!mainDocument || !mtoPackage}
          >
            Ajukan Paket Gambar & MTO (Kunci Draf)
          </Button>
          {(!mainDocument || !mtoPackage) && (
            <span className="text-[11px] text-rose-500 italic ml-3">
              {!mainDocument ? 'Unggah berkas gambar utama untuk mengaktifkan pengajuan.' : 'Buat paket MTO untuk mengaktifkan pengajuan.'}
            </span>
          )}
        </div>
      )}

      {/* Decision Dialog Modal (Setujui / Tolak) */}
      {decisionStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {decisionType === 'APPROVED' ? 'Setujui Gambar' : 'Tolak Gambar'} ({DRAWING_STEP_LABELS[decisionStep] || decisionStep})
              </h4>
              <button
                type="button"
                onClick={() => setDecisionStep(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
                aria-label="Tutup modal keputusan"
                title="Tutup (Esc)"
              >
                <IconX size={16} />
              </button>
            </div>

            {decisionError && (
              <div className="space-y-2">
                <Alert kind="error">{decisionError}</Alert>
                {decisionError.toLowerCase().includes('mto') && mtoPackage && (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="w-full"
                    onClick={() => {
                      setDecisionStep(null)
                      setMtoViewOpen(true)
                    }}
                  >
                    Buka & Kelola Paket MTO
                  </Button>
                )}
              </div>
            )}

            <form onSubmit={handleSubmitDecision} className="space-y-4">
              {decisionType === 'REJECTED' ? (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Alasan Penolakan <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    rows={4}
                    value={decisionNotes}
                    onChange={(e) => setDecisionNotes(e.target.value)}
                    placeholder="Sebutkan instruksi revisi desain untuk penyusun TEKNIK…"
                    required
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Penolakan akan mengembalikan paket gambar ke penyusun TEKNIK (status <strong>RETURNED</strong>) dan membuka draf versi baru. Berkas harus diunggah ulang pada draf baru tersebut.
                  </p>
                </div>
              ) : (
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Catatan Persetujuan (Opsional)
                  </label>
                  <textarea
                    rows={3}
                    value={decisionNotes}
                    onChange={(e) => setDecisionNotes(e.target.value)}
                    placeholder="Catatan persetujuan bila diperlukan…"
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              )}

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setDecisionStep(null)}
                  disabled={submittingDecision}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  variant={decisionType === 'APPROVED' ? 'success' : 'danger'}
                  size="sm"
                  loading={submittingDecision}
                >
                  {decisionType === 'APPROVED' ? 'Konfirmasi Setujui' : 'Konfirmasi Tolak'}
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Escalate Modal */}
      {escalateOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-start justify-between pb-2 border-b border-slate-100 dark:border-slate-800 gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Wajibkan Persetujuan Diperluas
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Persetujuan diperluas akan menambahkan kewenangan <strong>Asman Niaga</strong> dan <strong>Manager UP3</strong> ke dalam rantai persetujuan paket gambar ini. Tindakan ini tidak dapat dibatalkan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEscalateOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
                aria-label="Tutup modal eskalasi"
                title="Tutup (Esc)"
              >
                <IconX size={16} />
              </button>
            </div>

            {escalateError && <Alert kind="error">{escalateError}</Alert>}

            <form onSubmit={handleConfirmEscalate} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Alasan Eskalasi <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={escalateReason}
                  onChange={(e) => setEscalateReason(e.target.value)}
                  placeholder="Contoh: Hasil kajian tidak layak atau PBP > 5 tahun sehingga memerlukan persetujuan Manager UP3…"
                  required
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setEscalateOpen(false)}
                  disabled={escalating}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  loading={escalating}
                  disabled={!escalateReason.trim()}
                >
                  Konfirmasi Eskalasi
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reassign Modal */}
      {reassignOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-start justify-between pb-2 border-b border-slate-100 dark:border-slate-800 gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Tugaskan Ulang Penyusun Gambar
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Pilih petugas TEKNIK aktif pada unit kerja ULP permohonan.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setReassignOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
                aria-label="Tutup modal penugasan ulang"
                title="Tutup (Esc)"
              >
                <IconX size={16} />
              </button>
            </div>

            {reassignError && <Alert kind="error">{reassignError}</Alert>}

            {loadingAuthors ? (
              <div className="p-4 text-center"><Spinner size="sm" /></div>
            ) : (
              <form onSubmit={handleConfirmReassign} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Petugas TEKNIK Pengganti
                  </label>
                  <select
                    value={selectedAuthor}
                    onChange={(e) => setSelectedAuthor(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    {authors.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name} ({u.email})
                      </option>
                    ))}
                  </select>
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setReassignOpen(false)}
                    disabled={reassigning}
                  >
                    Batal
                  </Button>
                  <Button
                    type="submit"
                    variant="primary"
                    size="sm"
                    loading={reassigning}
                    disabled={!selectedAuthor}
                  >
                    Tugaskan Ulang
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Confirmation Modal: Delete Document */}
      <ConfirmationModal
        open={Boolean(deleteDocTarget)}
        onClose={() => setDeleteDocTarget(null)}
        onConfirm={handleConfirmDeleteDoc}
        title="Hapus Berkas Dokumen"
        description="Berkas akan disembunyikan dari paket gambar. Berkas fisik dan riwayat tetap tersimpan di server untuk audit trail."
        confirmLabel="Ya, Sembunyikan Dokumen"
        variant="danger"
      />

      {/* Confirmation Modal: Create Revision */}
      <ConfirmationModal
        open={reviseConfirmOpen}
        onClose={() => setReviseConfirmOpen(false)}
        onConfirm={handleConfirmRevision}
        title="Buat Revisi Gambar Baru"
        description="Buat revisi gambar baru? Versi yang disetujui (Approved) saat ini akan tetap berlaku sampai versi revisi baru disetujui secara definitif."
        confirmLabel="Buat Revisi Baru"
        variant="warning"
        loading={revising}
      />
    </div>
  )
}
