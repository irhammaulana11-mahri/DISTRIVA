import { useState, useEffect, useCallback, useMemo } from 'react'
import ServiceSlaBadge from '../../components/ServiceSlaBadge.jsx'
import { useNavigate } from 'react-router-dom'
import { surveyApi, kkoApi } from '../../services/api.js'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import DocumentGallery from '../../components/DocumentGallery.jsx'
import ApplicationKkoPanel from '../applications/ApplicationKkoPanel.jsx'
import { recommendExtension } from '../../utils/kkoPhase.js'
import {
  IconCheck,
  IconX,
  IconChevronDown,
  IconShield,
  IconUsers,
  IconClipboard,
  IconMapPin,
  IconAlertCircle,
} from '../../components/icons.jsx'

const STAGE_LABELS = {
  ULP_MANAGER: 'Manager ULP',
  UP3_REVIEW: 'Review UP3 (Perencanaan & Konstruksi)',
  ASMAN: 'Persetujuan Asman (Perencanaan & Konstruksi)',
}

const STEP_LABELS = {
  ULP_MANAGER: 'Persetujuan Manager ULP',
  REVIEW_PERENCANAAN: 'Review Perencanaan UP3',
  REVIEW_KONSTRUKSI: 'Review Konstruksi UP3',
  ASMAN_PERENCANAAN: 'Persetujuan Asman Perencanaan',
  ASMAN_KONSTRUKSI: 'Persetujuan Asman Konstruksi',
}

export default function SurveyDetailView({ surveyId, isEmbedded = false, onBack, onReloadApplication }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { notify } = useNotifications()
  const [loading, setLoading] = useState(true)
  const [survey, setSurvey] = useState(null)
  const [error, setError] = useState('')

  // Form State for editing DRAFT
  const [formData, setFormData] = useState({
    survey_date: new Date().toISOString().slice(0, 10),
    findings: '',
    technical_recommendation: '',
    requires_drawing: false,
    requires_network_extension: false,
    requires_feasibility_study: false,
    no_extension_reason: '',
    latitude: '',
    longitude: '',
    network_distance_m: '',
    sr_length_m: '',
    network_type: '',
    transformer_capacity_kva: '',
    network_condition: '',
    notes: '',
    measurements: [],
  })
  const [kkoData, setKkoData] = useState(null)
  const [kkoDraft, setKkoDraft] = useState(null)          // isian KKO per fasa yang belum disimpan (dari panel KKO)
  const [extTouched, setExtTouched] = useState(false)     // surveyor memilih sendiri: rekomendasi otomatis berhenti menimpa
  const [savingDraft, setSavingDraft] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [formError, setFormError] = useState('')

  // Decision Modal State
  const [decisionStep, setDecisionStep] = useState(null)
  const [decisionType, setDecisionType] = useState('APPROVED')
  const [decisionNotes, setDecisionNotes] = useState('')
  const [submittingDecision, setSubmittingDecision] = useState(false)
  const [decisionError, setDecisionError] = useState('')

  // Reassign Modal State
  const [reassignOpen, setReassignOpen] = useState(false)
  const [surveyors, setSurveyors] = useState([])
  const [loadingSurveyors, setLoadingSurveyors] = useState(false)
  const [selectedSurveyor, setSelectedSurveyor] = useState('')
  const [reassigning, setReassigning] = useState(false)
  const [reassignError, setReassignError] = useState('')

  // Cancel Survey Modal State
  const [cancelOpen, setCancelOpen] = useState(false)
  const [cancelReason, setCancelReason] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [cancelError, setCancelError] = useState('')

  // History Accordion
  const [expandedHistory, setExpandedHistory] = useState({})

  // quiet: muat ulang data survei TANPA layar pemuatan dan TANPA menimpa isian formulir yang belum disimpan (unggah foto tidak boleh menghapus isian).
  const refreshSurveyQuietly = useCallback(async () => {
    try {
      const res = await surveyApi.get(surveyId)
      setSurvey(res.data)
    } catch {
      /* daftar dokumen lama tetap tampil */
    }
  }, [surveyId])

  const loadSurvey = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await surveyApi.get(surveyId)
      setSurvey(res.data)

      if (res.data?.application?.id && kkoApi?.get) {
        kkoApi.get(res.data.application.id)
          .then((kRes) => setKkoData(kRes?.data || null))
          .catch(() => setKkoData(null))
      }

      // Initialize form with latest version data
      const latest = res.data.versions?.[res.data.versions.length - 1]
      if (latest) {
        setFormData({
          survey_date: latest.survey_date || new Date().toISOString().slice(0, 10),
          findings: latest.findings || '',
          technical_recommendation: latest.technical_recommendation || '',
          requires_drawing: Boolean(latest.requires_drawing),
          requires_network_extension: Boolean(latest.requires_network_extension),
          requires_feasibility_study: Boolean(latest.requires_feasibility_study),
          no_extension_reason: latest.no_extension_reason || '',
          latitude: latest.latitude ?? '',
          longitude: latest.longitude ?? '',
          network_distance_m: latest.network_distance_m ?? '',
          sr_length_m: latest.sr_length_m ?? '',
          network_type: latest.network_type || '',
          transformer_capacity_kva: latest.transformer_capacity_kva ?? '',
          network_condition: latest.network_condition || '',
          notes: latest.notes || '',
          measurements: Array.isArray(latest.measurements) ? latest.measurements : [],
        })
      }
    } catch (err) {
      setError(err.message || 'Gagal memuat detail survei.')
    } finally {
      setLoading(false)
    }
  }, [surveyId])

  useEffect(() => {
    loadSurvey()
  }, [loadSurvey])

  const openVersion = survey?.versions?.find((v) => !['RETURNED', 'ACCEPTED'].includes(v.status))
  const latestVersion = survey?.versions?.[survey.versions.length - 1]
  const returnedVersions = survey?.versions?.filter((v) => v.status === 'RETURNED') || []

  const canExecute = Boolean(survey?.can?.execute && latestVersion?.status === 'DRAFT')
  const canAssign = Boolean(survey?.can?.assign)
  const canDecideSteps = survey?.can?.decide || []

  // Rekomendasi otomatis "memerlukan perluasan jaringan" (16 Nov 2026): normal di pembebanan, keseimbangan beban, tegangan, dan jarak ≤ 40 m → Tidak; selain itu → Ya.
  const recPd = kkoDraft?.phase || kkoData?.record?.phase_detail || null
  const recCapacity = kkoDraft?.capacity ?? kkoData?.record?.transformer_capacity_kva ?? null
  const recommendation = useMemo(
    () => (recPd ? recommendExtension({ pd: recPd, capacity: recCapacity, distanceM: formData.network_distance_m }) : null),
    [recPd, recCapacity, formData.network_distance_m],
  )
  useEffect(() => {
    if (!canExecute || extTouched || !recommendation || recommendation.extension === null) return
    setFormData((f) =>
      f.requires_network_extension === recommendation.extension
        ? f
        : { ...f, requires_network_extension: recommendation.extension, ...(recommendation.extension ? {} : { requires_drawing: false, requires_feasibility_study: false }) },
    )
  }, [canExecute, extTouched, recommendation, formData.requires_network_extension])

  // Helper to build survey payload for draft and submit
  const buildSurveyPayload = () => ({
    survey_date: formData.survey_date || null,
    requires_drawing: Boolean(formData.requires_drawing),
    requires_network_extension: Boolean(formData.requires_network_extension),
    requires_feasibility_study: Boolean(formData.requires_feasibility_study),
    no_extension_reason: formData.no_extension_reason || null,
    latitude: formData.latitude !== '' && formData.latitude !== null && formData.latitude !== undefined ? Number(formData.latitude) : null,
    longitude: formData.longitude !== '' && formData.longitude !== null && formData.longitude !== undefined ? Number(formData.longitude) : null,
    network_distance_m: formData.network_distance_m !== '' && formData.network_distance_m !== null && formData.network_distance_m !== undefined ? Number(formData.network_distance_m) : null,
    sr_length_m: formData.sr_length_m !== '' && formData.sr_length_m !== null && formData.sr_length_m !== undefined ? Number(formData.sr_length_m) : null,
    network_type: formData.network_type || null,
    transformer_capacity_kva: formData.transformer_capacity_kva !== '' && formData.transformer_capacity_kva !== null && formData.transformer_capacity_kva !== undefined ? Number(formData.transformer_capacity_kva) : null,
    network_condition: formData.network_condition || null,
    notes: formData.notes || null,
    measurements: (formData.measurements || []).filter((m) => m && m.name && m.value),
  })

  // Format server error verbatim (including 409 and 422 details if available)
  const formatServerError = (err, fallbackMsg) => {
    if (err?.errors && typeof err.errors === 'object') {
      const details = Object.values(err.errors).flat().filter(Boolean).join(' ')
      if (details) return `${err.message || fallbackMsg}: ${details}`
    }
    return err?.response?.data?.message || err?.message || fallbackMsg
  }

  // Data trafo (KKO) tersimpan bersama draf/pengajuan survei: tidak ada tombol simpan KKO terpisah.
  const persistKko = async () => {
    if (!kkoDraft?.body || !survey?.application?.id || !kkoApi?.record) return
    const res = await kkoApi.record(survey.application.id, kkoDraft.body)
    if (res?.data) setKkoData(res.data)
  }

  // Save Draft (PATCH)
  const handleSaveDraft = async (e) => {
    if (e?.preventDefault) e.preventDefault()
    setSavingDraft(true)
    setFormError('')

    const payload = buildSurveyPayload()

    try {
      await persistKko()
      await surveyApi.updateDraft(survey.id, latestVersion.id, payload)
      notify({
        type: 'success',
        title: 'Draf Survei Disimpan',
        desc: 'Draf hasil survei berhasil disimpan.',
        tag: 'Survei Lapangan',
      })
      await loadSurvey()
    } catch (err) {
      setFormError(formatServerError(err, 'Gagal menyimpan draf survei.'))
    } finally {
      setSavingDraft(false)
    }
  }

  // Submit Survey (POST submit with form payload)
  const handleSubmitSurvey = async (e) => {
    if (e?.preventDefault) e.preventDefault()
    setSubmitting(true)
    setSavingDraft(false)
    setFormError('')

    const payload = buildSurveyPayload()

    try {
      await persistKko()
      await surveyApi.submit(survey.id, latestVersion.id, payload)
      notify({
        type: 'success',
        title: 'Survei Diajukan',
        desc: 'Hasil survei berhasil diajukan untuk proses persetujuan.',
        tag: 'Survei Lapangan',
      })
      await loadSurvey()
      onReloadApplication?.()
    } catch (err) {
      setFormError(formatServerError(err, 'Gagal mengajukan hasil survei.'))
    } finally {
      setSubmitting(false)
      setSavingDraft(false)
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
      const res = await surveyApi.decide(survey.id, latestVersion.id, {
        step: decisionStep,
        decision: decisionType,
        notes: decisionNotes.trim() || undefined,
      })
      notify({
        type: decisionType === 'APPROVED' ? 'success' : 'warning',
        title: decisionType === 'APPROVED' ? 'Survei Disetujui' : 'Survei Ditolak',
        desc: `Tahap ${decisionStep} survei ${survey?.application?.registration_number || ''} telah ${decisionType === 'APPROVED' ? 'disetujui' : 'ditolak'}.`,
        tag: 'Survei Lapangan',
      })
      const closedProposalNumber =
        res?.result?.proposal_closed ||
        res?.proposal_closed ||
        res?.data?.result?.proposal_closed ||
        res?.data?.proposal_closed
      if (closedProposalNumber) {
        notify({
          type: 'success',
          title: 'Usulan Ditutup',
          desc: `Usulan ${closedProposalNumber} selesai tanpa perluasan; anggotanya kini permohonan biasa`,
          tag: 'Usulan Perluasan',
        })
      }
      setDecisionStep(null)
      loadSurvey()
      onReloadApplication?.()
    } catch (err) {
      setDecisionError(formatServerError(err, 'Gagal mengirimkan keputusan.'))
    } finally {
      setSubmittingDecision(false)
    }
  }

  // Reassign
  const handleOpenReassign = async () => {
    setReassignOpen(true)
    setReassignError('')
    setLoadingSurveyors(true)
    try {
      const res = await surveyApi.surveyors(survey.application.id)
      setSurveyors(res.data || [])
      setSelectedSurveyor(res.data?.[0]?.id || '')
    } catch (err) {
      setReassignError(err.message || 'Gagal memuat daftar surveyor.')
    } finally {
      setLoadingSurveyors(false)
    }
  }

  const handleConfirmReassign = async (e) => {
    e.preventDefault()
    if (!selectedSurveyor) return
    setReassigning(true)
    setReassignError('')
    try {
      await surveyApi.reassign(survey.id, { assigned_to: selectedSurveyor })
      setReassignOpen(false)
      loadSurvey()
    } catch (err) {
      setReassignError(err.message || 'Gagal menugaskan ulang surveyor.')
    } finally {
      setReassigning(false)
    }
  }

  // Cancel Survey
  const handleConfirmCancel = async (e) => {
    e.preventDefault()
    if (!cancelReason.trim()) {
      setCancelError('Alasan pembatalan wajib diisi.')
      return
    }
    setCancelling(true)
    setCancelError('')
    try {
      await surveyApi.cancel(survey.id, { reason: cancelReason.trim() })
      setCancelOpen(false)
      loadSurvey()
      onReloadApplication?.()
    } catch (err) {
      setCancelError(err.message || 'Gagal membatalkan survei.')
    } finally {
      setCancelling(false)
    }
  }

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Spinner label="Memuat data survei & pengukuran..." />
      </div>
    )
  }

  if (error || !survey) {
    return (
      <div className="p-6 space-y-4">
        <Alert kind="error">{error || 'Data survei tidak ditemukan.'}</Alert>
        {onBack && (
          <Button variant="ghost" size="sm" onClick={onBack}>
            ← Kembali
          </Button>
        )}
      </div>
    )
  }

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
                className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-xs font-semibold"
              >
                ← Kembali
              </button>
            )}
            <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Survei #{survey.survey_number}
            </h3>
            <span className={`px-2 py-0.5 rounded-full text-[11px] font-bold ${
              survey.status === 'ACTIVE'
                ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                : 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-300'
            }`}>
              {survey.status}
            </span>
            {latestVersion?.outcome === 'NO_EXTENSION' && (
              <span data-testid="survey-outcome-badge" className="px-2 py-0.5 rounded text-[11px] font-bold bg-teal-100 text-teal-800 dark:bg-teal-950/60 dark:text-teal-300 border border-teal-200">
                Tanpa perluasan
              </span>
            )}
            {latestVersion?.outcome === 'EXTENSION' && (
              <span data-testid="survey-outcome-badge" className="px-2 py-0.5 rounded text-[11px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200">
                Perlu perluasan
              </span>
            )}
            {(survey.ready_to_install || (latestVersion?.outcome === 'NO_EXTENSION' && latestVersion?.status === 'ACCEPTED')) && (
              <span
                data-testid="ready-to-install-badge"
                title="Survei tanpa perluasan telah diterima; status selanjutnya mengikuti data EIS"
                className="px-2 py-0.5 rounded text-[11px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/80 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700 cursor-help"
              >
                Siap pasang
              </span>
            )}
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Permohonan: <span className="font-semibold text-slate-700 dark:text-slate-300">{survey.application?.application_number}</span> · Surveyor: <span className="font-semibold text-slate-700 dark:text-slate-300">{survey.surveyor?.name}</span> ({survey.surveyor?.email})
          </p>
          <ServiceSlaBadge applicationId={survey.application?.id} className="mt-1" />
        </div>

        {/* Top Actions */}
        <div className="flex items-center gap-2">
          {!isEmbedded &&
            (latestVersion?.status === 'ACCEPTED' || survey.status === 'ACCEPTED') &&
            (latestVersion?.outcome === 'EXTENSION' || survey.outcome === 'EXTENSION') && (
            <Button
              variant="primary"
              size="sm"
              className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5 shadow-xs"
              onClick={() => {
                const propId = survey.application?.proposal_id || survey.application?.proposal?.id || survey.proposal_id
                const appId = survey.application?.id
                if (propId) {
                  navigate(`/usulan/${propId}?tab=drawings`)
                } else if (appId) {
                  // usulan belum dibuat: dibuat di daftar Usulan Survei (bukan di drawer pratinjau)
                  navigate(`/permohonan?tab=survei&cari=${encodeURIComponent(survey.application?.application_number || '')}`)
                } else {
                  navigate('/permohonan?tab=usulan')
                }
              }}
            >
              <span>Buka Usulan Perluasan →</span>
            </Button>
          )}
          {canAssign && latestVersion?.status === 'DRAFT' && survey.status === 'ACTIVE' && (
            <Button variant="secondary" size="sm" onClick={handleOpenReassign}>
              Tugaskan Ulang
            </Button>
          )}
          {canAssign && survey.status === 'ACTIVE' && (
            <Button variant="danger" size="sm" onClick={() => { setCancelOpen(true); setCancelReason(''); setCancelError('') }}>
              Batalkan Survei
            </Button>
          )}
        </div>
      </div>

      {survey.status === 'CANCELLED' && (
        <Alert kind="error">
          Survei ini telah dibatalkan. Alasan: <em>&ldquo;{survey.cancel_reason || 'Tidak ada alasan.'}&rdquo;</em>
        </Alert>
      )}

      {/* Stepper Persetujuan (docs/63 §27) */}
      {latestVersion && (
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/50 space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Rantai Persetujuan Versi {latestVersion.version_number}
            </h4>
            <span className={`text-[11px] font-bold px-2 py-0.5 rounded ${
              latestVersion.status === 'ACCEPTED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' :
              latestVersion.status === 'RETURNED' ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300' :
              latestVersion.status === 'DRAFT' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300' :
              'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300'
            }`}>
              {latestVersion.status === 'DRAFT' ? 'Draf Lapangan' :
               latestVersion.status === 'SUBMITTED' ? 'Diajukan' :
               latestVersion.status === 'UNDER_REVIEW' ? `Dalam Review (${STAGE_LABELS[latestVersion.stage] || latestVersion.stage})` :
               latestVersion.status === 'ACCEPTED' ? 'Diterima' :
               latestVersion.status === 'RETURNED' ? 'Dikembalikan' : latestVersion.status}
            </span>
          </div>

          {/* Stepper Stages Timeline */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 text-xs">
            {/* Step 1: Draft Surveyor */}
            <div className={`p-3 rounded-lg border ${
              latestVersion.status === 'DRAFT'
                ? 'border-amber-400 bg-amber-50/60 dark:border-amber-700 dark:bg-amber-950/20'
                : 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/10'
            }`}>
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 dark:text-slate-200">1. Surveyor</span>
                {latestVersion.status !== 'DRAFT' && <IconCheck size={14} className="text-emerald-600" />}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {latestVersion.status === 'DRAFT' ? 'Pengisian & Bukti Foto' : 'Selesai Diajukan'}
              </p>
            </div>

            {/* Step 2: Manager ULP */}
            <div className={`p-3 rounded-lg border ${
              latestVersion.stage === 'ULP_MANAGER'
                ? 'border-blue-400 bg-blue-50/60 dark:border-blue-700 dark:bg-blue-950/20 font-bold'
                : (latestVersion.status === 'ACCEPTED' || latestVersion.decisions?.some((d) => d.step === 'ULP_MANAGER'))
                ? 'border-emerald-200 bg-emerald-50/40 dark:border-emerald-900/40 dark:bg-emerald-950/10'
                : 'border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900/40 opacity-70'
            }`}>
              <div className="flex items-center justify-between">
                <span className="font-semibold text-slate-800 dark:text-slate-200">2. Manager ULP</span>
                {(latestVersion.status === 'ACCEPTED' || latestVersion.decisions?.some((d) => d.step === 'ULP_MANAGER')) && <IconCheck size={14} className="text-emerald-600" />}
              </div>
              <p className="text-[11px] text-slate-500 mt-1">
                {latestVersion.status === 'ACCEPTED'
                  ? 'Diterima'
                  : 'Persetujuan Tingkat Unit'}
              </p>
            </div>

          </div>

          {/* Decisions Timeline */}
          {latestVersion.decisions?.length > 0 && (
            <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                Catatan Keputusan ({latestVersion.decisions.length})
              </span>
              <div className="mt-2 space-y-2">
                {latestVersion.decisions.map((d, i) => (
                  <div key={i} className="p-2.5 rounded-lg bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-xs">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                          d.decision === 'APPROVED' ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300' : 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300'
                        }`}>
                          {d.decision === 'APPROVED' ? 'SETUJU' : 'TOLAK'}
                        </span>
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {STEP_LABELS[d.step] || d.step}
                        </span>
                      </div>
                      <span className="text-[10px] text-slate-400">
                        {d.decided_at ? new Date(d.decided_at).toLocaleString('id-ID') : '-'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                      Oleh: <span className="font-medium text-slate-700 dark:text-slate-300">{d.decided_by_name}</span> ({d.decided_role})
                    </p>
                    {d.notes && (
                      <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 italic bg-slate-50 dark:bg-slate-800/60 p-1.5 rounded">
                        &ldquo;{d.notes}&rdquo;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Decision Action Bar (When user has permission for pending step) */}
      {canDecideSteps.length > 0 && (
        <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/70 dark:bg-blue-950/30 space-y-3">
          <div className="flex items-center gap-2">
            <IconShield className="text-blue-600" size={18} />
            <h4 className="text-xs font-bold text-blue-900 dark:text-blue-200 uppercase tracking-wider">
              Keputusan Anda Diperlukan
            </h4>
          </div>
          <p className="text-xs text-blue-800 dark:text-blue-300">
            Anda memiliki kewenangan untuk memutuskan tahap survei ini. Silakan tinjau data teknis dan foto lapangan di bawah.
          </p>

          {canDecideSteps.includes('ULP_MANAGER') && latestVersion?.requires_drawing && (
            <div className="p-3 rounded-lg bg-amber-50/90 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 text-xs space-y-1.5">
              <div className="flex items-center gap-1.5 font-bold text-amber-900 dark:text-amber-200">
                <IconAlertCircle size={15} className="text-amber-600 shrink-0" />
                <span>Daftar Periksa Persetujuan Manager ULP (Satu Paket Survei & Gambar):</span>
              </div>
              <ul className="space-y-1 text-slate-700 dark:text-slate-300 ml-5 list-disc">
                <li>
                  Gambar teknik diajukan?{' '}
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {survey?.drawing_submitted ? 'Sudah Diajukan' : 'Pastikan berkas gambar utama telah diajukan'}
                  </span>
                </li>
                <li>
                  MTO disetujui?{' '}
                  <span className="font-semibold text-slate-900 dark:text-slate-100">
                    {survey?.mto_approved ? 'Sudah Disetujui' : 'Pastikan MTO telah disetujui Manager ULP'}
                  </span>
                </li>
              </ul>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {canDecideSteps.map((step) => (
              <div key={step} className="flex items-center gap-2 p-2 rounded-lg bg-white dark:bg-slate-900 border border-blue-200 dark:border-blue-800">
                <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                  {STEP_LABELS[step] || step}:
                </span>
                <Button
                  size="sm"
                  variant="success"
                  onClick={() => handleOpenDecisionModal(step, 'APPROVED')}
                >
                  Setujui
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => handleOpenDecisionModal(step, 'REJECTED')}
                >
                  Tolak
                </Button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Accordion: Versi Lama yang Dikembalikan (docs/63 §27) */}
      {returnedVersions.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
            Riwayat Versi yang Dikembalikan ({returnedVersions.length})
          </h4>
          {returnedVersions.map((v) => {
            const isExp = Boolean(expandedHistory[v.id])
            return (
              <div key={v.id} className="rounded-xl border border-rose-200 dark:border-rose-900/50 bg-rose-50/30 dark:bg-rose-950/20 overflow-hidden">
                <button
                  type="button"
                  onClick={() => setExpandedHistory((prev) => ({ ...prev, [v.id]: !prev[v.id] }))}
                  className="w-full flex items-center justify-between p-3 text-left hover:bg-rose-50/60 dark:hover:bg-rose-950/40 transition-colors"
                >
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-xs text-rose-800 dark:text-rose-300">
                      Versi {v.version_number} (RETURNED)
                    </span>
                    <span className="text-[11px] text-slate-500">
                      pada langkah: <strong>{STEP_LABELS[v.returned_at_step] || v.returned_at_step}</strong>
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
                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <span className="text-slate-400">Temuan:</span>
                        <p className="text-slate-700 dark:text-slate-300 mt-0.5">{v.findings || '-'}</p>
                      </div>
                      <div>
                        <span className="text-slate-400">Rekomendasi:</span>
                        <p className="text-slate-700 dark:text-slate-300 mt-0.5">{v.technical_recommendation || '-'}</p>
                      </div>
                    </div>
                    {v.documents?.length > 0 && (
                      <div>
                        <span className="text-slate-400">Dokumen Versi Ini:</span>
                        <div className="mt-1 flex flex-wrap gap-2">
                          {v.documents.map((d) => (
                            <span key={d.id} className="p-1 px-2 rounded bg-slate-100 dark:bg-slate-800 text-[10px]">
                              {d.title || d.original_name}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Main Results Form / Presentation */}
      <div className="space-y-4">
        <div className="flex items-center justify-between border-b border-slate-200 dark:border-slate-800 pb-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Hasil Survei & Pengukuran Teknis {latestVersion ? `(Versi ${latestVersion.version_number})` : ''}
          </h4>
          {canExecute && (
            <span className="text-[11px] font-semibold text-amber-600 dark:text-amber-400">
              ✏️ Mode Pengisian (Draf Surveyor)
            </span>
          )}
        </div>

        {formError && <Alert kind="error">{formError}</Alert>}

        {canExecute ? (
          /* Editable Form for Surveyor on DRAFT */
          <form onSubmit={handleSaveDraft} className="space-y-5">
            {/* Bagian Kondisi Trafo & Jaringan (KKO) */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-3">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Kondisi trafo dan jaringan (KKO)
              </h4>
              <ApplicationKkoPanel
                application={survey.application}
                canRecord={canExecute}
                canDecide={false}
                onSaved={(kData) => setKkoData(kData)}
                onDraftChange={setKkoDraft}
                embedded
              />
            </div>

            {/* Jarak dan panjang SR (diisi setelah data gardu) */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Panjang SR yang dibutuhkan (meter) <span className="text-rose-500">*</span>
                </label>
                <input
                  aria-label="Panjang SR yang dibutuhkan"
                  type="number"
                  step="any"
                  min="0"
                  value={formData.sr_length_m}
                  onChange={(e) => setFormData({ ...formData, sr_length_m: e.target.value })}
                  placeholder="Contoh: 25"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Jarak bangunan dari tiang eksisting (meter) <span className="text-rose-500">*</span>
                </label>
                <input
                  aria-label="Jarak bangunan dari tiang eksisting"
                  type="number"
                  step="any"
                  min="0"
                  value={formData.network_distance_m}
                  onChange={(e) => setFormData({ ...formData, network_distance_m: e.target.value })}
                  placeholder="Contoh: 40"
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>
            </div>

            {/* Foto survei tepat di bawah panjang SR dan jarak bangunan; unggah tidak memuat ulang halaman sehingga isian yang belum disimpan tetap ada */}
            {latestVersion && (
              <div className="pt-3 border-t border-slate-200 dark:border-slate-800" data-testid="survey-evidence">
                <DocumentGallery
                  documents={latestVersion.documents || []}
                  surveyId={survey.id}
                  versionNumber={latestVersion.id}
                  canUpload={canExecute}
                  canDelete={canExecute}
                  onDocumentAdded={() => refreshSurveyQuietly()}
                  onDocumentRemoved={() => refreshSurveyQuietly()}
                />
              </div>
            )}

            {/* Hasil Survei (docs/82 §3 & docs/57) */}
            <div className="p-3.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-3">
              <span className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block mb-1">
                Hasil Survei
              </span>

              {/* Memerlukan Perluasan Jaringan: dua pilihan tegas Ya/Tidak */}
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900/60 space-y-2">
                <label className="block text-xs font-bold text-slate-800 dark:text-slate-200">
                  Memerlukan Perluasan Jaringan
                </label>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-300">
                    <input
                      type="radio"
                      name="requires_network_extension"
                      value="ya"
                      checked={formData.requires_network_extension === true}
                      onChange={() => {
                        setExtTouched(true)
                        setFormData({ ...formData, requires_network_extension: true })
                      }}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span>Ya (Memerlukan penambahan tiang, trafo, atau JTM/JTR)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-slate-700 dark:text-slate-300">
                    <input
                      type="radio"
                      name="requires_network_extension"
                      value="tidak"
                      checked={formData.requires_network_extension === false}
                      onChange={() => {
                        setExtTouched(true)
                        setFormData({
                        ...formData,
                        requires_network_extension: false,
                        requires_drawing: false,
                        requires_feasibility_study: false,
                      })
                      }}
                      className="text-blue-600 focus:ring-blue-500"
                    />
                    <span>Tidak</span>
                  </label>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
                  Tidak = tidak ada penambahan JTR/JTM/trafo; setelah survei disetujui Manager ULP pelanggan siap pasang
                </p>
                {recommendation && (
                  <p data-testid="extension-recommendation" className={`text-[11px] font-semibold ${recommendation.extension === true ? 'text-amber-700 dark:text-amber-400' : recommendation.extension === false ? 'text-emerald-700 dark:text-emerald-400' : 'text-slate-500'}`}>
                    {recommendation.extension === false && 'Rekomendasi otomatis: tidak memerlukan perluasan (pembebanan, keseimbangan beban, tegangan, dan jarak dalam rentang normal).'}
                    {recommendation.extension === true && `Rekomendasi otomatis: memerlukan perluasan — ${recommendation.reasons.join('; ')}.`}
                    {recommendation.extension === null && `Rekomendasi otomatis menunggu data: ${recommendation.missing.join(', ')}.`}
                    {extTouched && recommendation.extension !== null && ' (pilihan Anda dipakai, bukan rekomendasi)'}
                  </p>
                )}
              </div>

              {/* Bila Tanpa Perluasan: Kolom Alasan Tanpa Perluasan */}
              {formData.requires_network_extension === false && (
                <div className="space-y-1 pt-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Alasan Tanpa Perluasan
                  </label>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400">
                    Wajib diisi bila KKO menunjukkan pembebanan &gt; 100 % setelah beban baru, tegangan rendah, atau keputusan TIDAK LAYAK.
                  </p>
                  <textarea
                    rows={2}
                    value={formData.no_extension_reason}
                    onChange={(e) => setFormData({ ...formData, no_extension_reason: e.target.value })}
                    placeholder="Tuliskan alasan teknis tanpa perluasan..."
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                </div>
              )}

              {/* Bila Perlu Perluasan: Checkbox Kebutuhan Teknis Lanjutan */}
              {formData.requires_network_extension === true && (
                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-700">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 block">
                    Penanda Kebutuhan Teknis Tambahan
                  </span>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={formData.requires_drawing}
                      onChange={(e) => setFormData({ ...formData, requires_drawing: e.target.checked })}
                      className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span>Memerlukan Gambar Usulan (SLD / CAD jaringan; dibuat setelah usulan terbit)</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer text-xs text-slate-700 dark:text-slate-300">
                    <input
                      type="checkbox"
                      checked={formData.requires_feasibility_study}
                      onChange={(e) => setFormData({ ...formData, requires_feasibility_study: e.target.checked })}
                      className="rounded text-blue-600 focus:ring-blue-500"
                    />
                    <span>Memerlukan Studi Kelayakan Khusus (Kajian Tegangan / Beban Lanjutan)</span>
                  </label>
                </div>
              )}
            </div>

            {/* Ringkasan KKO di atas tombol Ajukan (docs/82 §3) */}
            {!kkoData?.record ? (
              <div data-testid="kko-missing-alert">
                <Alert kind="warning">
                  KKO belum dicatat pada permohonan ini.
                </Alert>
              </div>
            ) : (
              <div data-testid="kko-summary-box" className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 space-y-1.5 text-xs">
                <span className="font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 block text-[11px]">
                  Ringkasan KKO (Kondisi Trafo & Jaringan)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400">Gardu:</span>
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      {kkoData.record.substation_code || '-'} {kkoData.record.substation_name ? `(${kkoData.record.substation_name})` : ''}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Pembebanan:</span>
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      {kkoData.record.loading_before_pct ?? '-'}% → {kkoData.record.loading_after_pct ?? '-'}% ({kkoData.record.class_after || '-'})
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Tegangan Lokasi:</span>
                    <p className="font-semibold text-slate-800 dark:text-slate-200">
                      {kkoData.record.voltage_location_v ?? '-'} V {kkoData.record.voltage_low ? '(Tegangan Rendah)' : ''}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Keputusan KKO:</span>
                    <p className="font-bold text-slate-800 dark:text-slate-200">{kkoData.record.decision || 'Menunggu keputusan'}</p>
                  </div>
                </div>
              </div>
            )}

            {/* Form Action Buttons */}
            <div className="flex items-center justify-between pt-4 border-t border-slate-200 dark:border-slate-800">
              <Button
                type="submit"
                variant="secondary"
                loading={savingDraft}
                disabled={savingDraft || submitting}
              >
                Simpan Draf
              </Button>
              <Button
                type="button"
                variant="primary"
                onClick={handleSubmitSurvey}
                loading={submitting}
                disabled={savingDraft || submitting}
              >
                Ajukan Hasil Survei (Kunci Draf)
              </Button>
            </div>
          </form>
        ) : (
          /* Read-only Presentation */
          <div className="space-y-4 text-xs">
            {/* KKO Snapshot saat survei diajukan (docs/82 §3) */}
            {latestVersion?.kko_snapshot && (
              <div data-testid="kko-snapshot-box" className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  Kondisi Trafo & Jaringan (saat survei diajukan)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div>
                    <span className="text-slate-400">Gardu:</span>
                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                      {latestVersion.kko_snapshot.substation_code || '-'}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Pembebanan Sebelum → Sesudah:</span>
                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                      {latestVersion.kko_snapshot.loading_before_pct ?? '-'}% → {latestVersion.kko_snapshot.loading_after_pct ?? '-'}% ({latestVersion.kko_snapshot.class_after || '-'})
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Tegangan Lokasi:</span>
                    <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                      {latestVersion.kko_snapshot.voltage_location_v ?? '-'} V {latestVersion.kko_snapshot.voltage_low ? '(Tegangan Rendah)' : ''}
                    </p>
                  </div>
                  <div>
                    <span className="text-slate-400">Keputusan KKO:</span>
                    <p className="font-bold text-slate-800 dark:text-slate-200 mt-0.5">
                      {latestVersion.kko_snapshot.decision || '-'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Alasan Tanpa Perluasan bila ada */}
            {latestVersion?.no_extension_reason && (
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">Alasan Tanpa Perluasan</span>
                <p className="text-slate-700 dark:text-slate-300 mt-1 whitespace-pre-wrap">{latestVersion.no_extension_reason}</p>
              </div>
            )}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
              <div>
                <span className="text-slate-400">Tanggal Survei:</span>
                <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                  {latestVersion?.survey_date ? new Date(latestVersion.survey_date).toLocaleDateString('id-ID') : '-'}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Koordinat (Lat, Long):</span>
                <p className="font-mono text-slate-800 dark:text-slate-200 mt-0.5">
                  {latestVersion?.latitude !== null && latestVersion?.longitude !== null
                    ? `${latestVersion?.latitude}, ${latestVersion?.longitude}`
                    : '-'}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Jarak Jaringan:</span>
                <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                  {latestVersion?.network_distance_m !== null ? `${latestVersion.network_distance_m} meter` : '-'}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Trafo & Tipe Jaringan:</span>
                <p className="font-semibold text-slate-800 dark:text-slate-200 mt-0.5">
                  {latestVersion?.transformer_capacity_kva !== null ? `${latestVersion.transformer_capacity_kva} kVA` : '-'} ({latestVersion?.network_type || '-'})
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Temuan Lapangan</span>
                <p className="text-slate-700 dark:text-slate-300 mt-1 whitespace-pre-wrap">
                  {latestVersion?.findings || '-'}
                </p>
              </div>
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">Rekomendasi Teknis</span>
                <p className="text-slate-700 dark:text-slate-300 mt-1 whitespace-pre-wrap">
                  {latestVersion?.technical_recommendation || '-'}
                </p>
              </div>
            </div>

            <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-wrap gap-4">
              <div>
                <span className="text-slate-400">Gambar Desain SLD:</span>
                <p className="font-semibold mt-0.5">
                  {latestVersion?.requires_drawing ? '✅ Diperlukan' : '❌ Tidak Perlu'}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Perluasan Jaringan:</span>
                <p className="font-semibold mt-0.5">
                  {latestVersion?.requires_network_extension ? '✅ Diperlukan' : '❌ Tidak Perlu'}
                </p>
              </div>
              <div>
                <span className="text-slate-400">Studi Kelayakan:</span>
                <p className="font-semibold mt-0.5">
                  {latestVersion?.requires_feasibility_study ? '✅ Diperlukan' : '❌ Tidak Perlu'}
                </p>
              </div>
            </div>

            {/* Dynamic Measurements Table */}
            {latestVersion?.measurements?.length > 0 && (
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
                  Data Pengukuran Lapangan
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {latestVersion.measurements.map((m, idx) => (
                    <div key={idx} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                      <span className="text-[10px] text-slate-400 block">{m.name}</span>
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {m.value} {m.unit || ''}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Evidence Documents & Photos Section (docs/63 §D) */}
      {latestVersion && !canExecute && (
        <div className="pt-4 border-t border-slate-200 dark:border-slate-800">
          <DocumentGallery
            documents={latestVersion.documents || []}
            surveyId={survey.id}
            versionNumber={latestVersion.id}
            canUpload={canExecute}
            canDelete={canExecute}
            onDocumentAdded={() => refreshSurveyQuietly()}
            onDocumentRemoved={() => refreshSurveyQuietly()}
          />
        </div>
      )}

      {/* Decision Dialog Modal (Setujui / Tolak) */}
      {decisionStep && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {decisionType === 'APPROVED' ? 'Setujui Survei' : 'Tolak Survei'} ({STEP_LABELS[decisionStep] || decisionStep})
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

            {decisionError && <Alert kind="error">{decisionError}</Alert>}

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
                    placeholder="Sebutkan alasan penolakan dan instruksi perbaikan untuk surveyor…"
                    required
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  />
                  <p className="text-[11px] text-slate-400 mt-1">
                    Penolakan di langkah mana pun akan mengembalikan survei dan gambar (bila ada) ke status <strong>RETURNED</strong> dan membuka draf versi baru; alasan penolakan tercatat pada keduanya.
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
                    placeholder="Catatan tambahan bila diperlukan…"
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

      {/* Reassign Modal */}
      {reassignOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-start justify-between pb-2 border-b border-slate-100 dark:border-slate-800 gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Tugaskan Ulang Surveyor
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Pilih petugas TEKNIK aktif pada ULP permohonan untuk menggantikan surveyor saat ini.
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

            {loadingSurveyors ? (
              <div className="p-4 text-center"><Spinner size="sm" /></div>
            ) : (
              <form onSubmit={handleConfirmReassign} className="space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Petugas TEKNIK Pengganti
                  </label>
                  <select
                    value={selectedSurveyor}
                    onChange={(e) => setSelectedSurveyor(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                  >
                    {surveyors.map((u) => (
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
                    disabled={!selectedSurveyor}
                  >
                    Tugaskan Ulang
                  </Button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Cancel Survey Modal */}
      {cancelOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-w-md w-full bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xl space-y-4">
            <div className="flex items-start justify-between pb-2 border-b border-slate-100 dark:border-slate-800 gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Batalkan Survei
                </h4>
                <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                  Survei yang dibatalkan tidak dapat dilanjutkan. Masukkan alasan pembatalan untuk audit trail.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCancelOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
                aria-label="Tutup modal batalkan survei"
                title="Tutup (Esc)"
              >
                <IconX size={16} />
              </button>
            </div>

            {cancelError && <Alert kind="error">{cancelError}</Alert>}

            <form onSubmit={handleConfirmCancel} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Alasan Pembatalan <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={3}
                  value={cancelReason}
                  onChange={(e) => setCancelReason(e.target.value)}
                  placeholder="Masukkan alasan pembatalan survei…"
                  required
                  className="w-full px-3 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setCancelOpen(false)}
                  disabled={cancelling}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  variant="danger"
                  size="sm"
                  loading={cancelling}
                  disabled={!cancelReason.trim()}
                >
                  Ya, Batalkan Survei
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
