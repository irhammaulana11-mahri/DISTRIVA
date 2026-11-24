import { useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { applicationApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import { ApplicationCreateDrawer, ApplicationDetailDrawer, CompleteDataModal, EisImportDrawer } from './ApplicationsPage.jsx'
import EisSyncDrawer from './EisSyncDrawer.jsx'

/**
 * Halaman kerja Permohonan. Laci pada daftar hanya pratinjau; semua pekerjaan yang mengubah data (daftar baru, impor, sinkronisasi EIS,
 * ajukan, batalkan, lengkapi data, survei, gambar, KKF, alokasi, SPK) dilakukan di halaman-halaman ini.
 */
export function ApplicationCreatePage() {
  const { can, createUnits } = useAccess()
  const { notify } = useNotifications()
  const navigate = useNavigate()
  return (
    <ApplicationCreateDrawer
      open
      asPage
      createUnits={createUnits}
      canImport={Boolean(can['applications.import'])}
      onSwitchToImport={() => navigate('/permohonan/impor', { replace: true })}
      onClose={() => navigate('/permohonan')}
      onSuccess={(created) => {
        notify({ type: 'success', title: 'Permohonan Didaftarkan', desc: `Agenda permohonan ${created.application_number} berhasil dibuat sebagai Draf.`, tag: 'PB/PD' })
        navigate(created?.id ? `/permohonan/${created.id}` : '/permohonan')
      }}
    />
  )
}

export function ApplicationImportPage() {
  const { can } = useAccess()
  const navigate = useNavigate()
  return (
    <EisImportDrawer
      open
      asPage
      canCreate={Boolean(can['applications.create'])}
      onSwitchToCreate={() => navigate('/permohonan/baru', { replace: true })}
      onClose={() => navigate('/permohonan')}
      onSuccess={() => {}}
    />
  )
}

export function EisSyncPage() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const mode = searchParams.get('mode') || 'permohonan'
  return <EisSyncDrawer open asPage mode={mode} onClose={() => navigate(-1)} onSynced={() => {}} />
}

export function ApplicationDetailPage() {
  const { applicationId } = useParams()
  const { can, isSysAdmin } = useAccess()
  const { notify } = useNotifications()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const [version, setVersion] = useState(0)
  const [cancelTarget, setCancelTarget] = useState(null)
  const [completeTarget, setCompleteTarget] = useState(null)
  const [submitting, setSubmitting] = useState(false)
  const reload = () => setVersion((v) => v + 1)

  const submit = async (app) => {
    if (!app || submitting) return
    setSubmitting(true)
    try {
      await applicationApi.submit(app.id)
      notify({ type: 'success', title: 'Permohonan Berhasil Diajukan', desc: `Permohonan ${app.application_number} telah diajukan dan siap diproses ke tahap Survei Lapangan.`, tag: 'PB/PD' })
      reload()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal Mengajukan Permohonan', desc: err.message || 'Terjadi kesalahan saat memproses permohonan.', tag: 'PB/PD' })
    } finally {
      setSubmitting(false)
    }
  }

  const confirmCancel = async (reason) => {
    try {
      await applicationApi.cancel(cancelTarget.id, { reason })
      notify({ type: 'warning', title: 'Permohonan Dibatalkan', desc: `Permohonan ${cancelTarget.application_number} telah dibatalkan dengan pencatatan audit log.`, tag: 'PB/PD' })
      setCancelTarget(null)
      reload()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal Membatalkan Permohonan', desc: err.message || 'Terjadi kesalahan saat membatalkan permohonan.', tag: 'PB/PD' })
    }
  }

  return (
    <>
      <ApplicationDetailDrawer
        key={`${applicationId}-${version}`}
        asPage
        applicationId={applicationId}
        canSubmit={can['applications.submit']}
        canCancel={can['applications.cancel']}
        canAddRef={can['applications.update']}
        canExecuteSurvey={Boolean(can['surveys.execute'] || isSysAdmin)}
        canIssueProposal={Boolean(can['proposals.manage'] || isSysAdmin)}
        canViewSurvey={Boolean(can['surveys.view'] || isSysAdmin)}
        canAssignDrawing={Boolean(can['drawings.assign'] || isSysAdmin)}
        canExecuteDrawing={Boolean(can['drawings.execute'] || isSysAdmin)}
        canViewDrawing={Boolean(can['drawings.view'] || isSysAdmin)}
        canRunKkf={Boolean(can['kkf.run'] || isSysAdmin)}
        canViewKkf={Boolean(can['kkf.view'] || isSysAdmin)}
        canViewKko={Boolean(can['kko.view'] || isSysAdmin)}
        canRecordKko={Boolean(can['kko.record'] || isSysAdmin)}
        canDecideKko={Boolean(can['kko.decide'] || isSysAdmin)}
        canManageMaterials={Boolean(can['allocations.manage'] || isSysAdmin)}
        canManagePoles={Boolean(can['allocations.poles'] || isSysAdmin)}
        canManageAllocations={Boolean(can['allocations.manage'] || isSysAdmin)}
        canViewAllocations={Boolean(can['allocations.view'] || can['allocations.manage'] || can['allocations.poles'] || isSysAdmin)}
        canWoView={Boolean(can['wo.view'] || can['vendor.portal'] || isSysAdmin)}
        canWoCreate={Boolean(can['wo.create'] || isSysAdmin)}
        canWoIssue={Boolean(can['wo.issue'] || isSysAdmin)}
        canWoSubmitProgress={false}
        canWoVerifyProgress={Boolean(can['wo.progress_verify'] || isSysAdmin)}
        canWoComplete={Boolean(can['wo.complete'] || isSysAdmin)}
        initialTab={searchParams.get('tab') || 'detail'}
        onSubmit={submit}
        onSelectApplication={(id) => navigate(`/permohonan/${id}`)}
        onCancel={setCancelTarget}
        onClose={() => navigate('/permohonan')}
        onReload={() => {}}
        onCompleteData={(app, field) => setCompleteTarget({ app, field })}
      />
      {cancelTarget && (
        <ReasonDialog
          title={`Batalkan Permohonan ${cancelTarget.application_number}`}
          description="Alasan pembatalan wajib dicatat dalam riwayat audit trail (docs/54, docs/62)."
          confirmLabel="Konfirmasi Pembatalan"
          onConfirm={confirmCancel}
          onClose={() => setCancelTarget(null)}
        />
      )}
      {completeTarget && (
        <CompleteDataModal target={completeTarget} onClose={() => setCompleteTarget(null)} onSuccess={() => { setCompleteTarget(null); reload() }} />
      )}
    </>
  )
}
