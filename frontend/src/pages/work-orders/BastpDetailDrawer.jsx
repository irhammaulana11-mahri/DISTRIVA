import { useState, useEffect, useCallback } from 'react'
import { bastpApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import BastpSignModal from '../../components/BastpSignModal.jsx'
import OutputDocumentModal from '../../components/OutputDocumentModal.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import {
  IconFileText,
  IconCheck,
  IconCheckCircle,
  IconShield,
  IconAlertCircle,
  IconUpload,
  IconPlus,
  IconTrash,
  IconDownload,
  IconDocument,
  IconLayers,
  IconZap,
  IconCamera,
} from '../../components/icons.jsx'

/**
 * BastpDetailDrawer (docs/62 §36, docs/73 §6, docs/75 & docs/57)
 * Comprehensive BASTP manager: Material attachment, kWh meter photos, electronic signing per step,
 * return workflow with rounds, and PLN output document preview/print/XLSX download.
 */
export default function BastpDetailDrawer({
  asPage = false,
  bastpId,
  workOrder,
  isVendor = false,
  onClose,
  onUpdated,
}) {
  const { user } = useAuth()
  const { can, isSysAdmin } = useAccess()
  const { notify } = useNotifications()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bastp, setBastp] = useState(null)
  const [activeTab, setActiveTab] = useState('materials') // 'materials' | 'meters' | 'signatures' | 'events'

  // Draft Editing State: Materials
  const [materialsForm, setMaterialsForm] = useState([])
  const [generalNotes, setGeneralNotes] = useState('')
  const [savingMaterials, setSavingMaterials] = useState(false)
  const [materialsError, setMaterialsError] = useState('')
  const [matPage, setMatPage] = useState(1)
  const [matPerPage, setMatPerPage] = useState(10)

  // Draft Editing State: Meters
  const [metersForm, setMetersForm] = useState([])
  const [savingMeters, setSavingMeters] = useState(false)
  const [metersError, setMetersError] = useState('')

  // Uploading Photo per Meter
  const [uploadingPhotoMeterId, setUploadingPhotoMeterId] = useState(null)
  const [photoError, setPhotoError] = useState('')

  // Sign Modal (Password Confirmation for Electronic Signature)
  const [signModalConfig, setSignModalConfig] = useState({
    open: false,
    step: '', // 'submit' | 'accept' | 'sign' | 'close'
    title: '',
    description: '',
    confirmLabel: '',
  })
  const [signing, setSigning] = useState(false)
  const [signError, setSignError] = useState('')

  // Return Reason Dialog
  const [returnDialogOpen, setReturnDialogOpen] = useState(false)
  const [returning, setReturning] = useState(false)
  const [returnError, setReturnError] = useState('')

  // Output Document Modal
  const [docModalOpen, setDocModalOpen] = useState(false)

  // Permission Checks (fail-closed, docs/57)
  const isAssignedVendor = isVendor || (workOrder?.vendor_company_id && user?.vendor_company_id === workOrder.vendor_company_id)
  const canPrepare = Boolean(isAssignedVendor || can?.['bastp.prepare'] || isSysAdmin)
  const canAccept = Boolean(can?.['bastp.accept'] || isSysAdmin)
  const canSignKonstruksi = Boolean(can?.['bastp.sign_konstruksi'] || isSysAdmin)
  const canClose = Boolean(can?.['bastp.close'] || isSysAdmin)

  // Load BASTP Detail
  const loadBastp = useCallback(async () => {
    if (!bastpId) return
    setLoading(true)
    setError('')
    try {
      const res = await bastpApi.get(bastpId)
      const data = res?.data || res
      setBastp(data)

      // Initialize forms from fetched data
      setMaterialsForm(
        (data.materials || []).map((m) => ({
          khs_code: m.khs_code,
          planned_qty: m.planned_qty,
          installed_qty: m.installed_qty ?? '',
          note: m.note || '',
        }))
      )
      setGeneralNotes(data.notes || '')

      setMetersForm(
        (data.meters || []).map((m) => ({
          id: m.id,
          customer_idpel: m.customer_idpel,
          meter_number: m.meter_number,
          photo_document_ids: m.photo_document_ids || [],
        }))
      )
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Gagal memuat detail BASTP.')
    } finally {
      setLoading(false)
    }
  }, [bastpId])

  useEffect(() => {
    loadBastp()
  }, [loadBastp])

  // Save Materials Attachment (PUT /bastp/{id}/materials)
  const handleSaveMaterials = async (e) => {
    e?.preventDefault()
    setSavingMaterials(true)
    setMaterialsError('')
    try {
      const payload = {
        materials: materialsForm.map((m) => ({
          khs_code: m.khs_code,
          installed_qty: m.installed_qty === '' ? 0 : Number(m.installed_qty),
          note: m.note ? m.note.trim() : null,
        })),
        notes: generalNotes.trim() || null,
      }
      await bastpApi.putMaterials(bastp.id, payload)
      notify({
        type: 'success',
        title: 'Material Terpasang Disimpan',
        desc: 'Realisasi kuantitas material terpasang berhasil disimpan.',
        tag: 'BASTP',
      })
      await loadBastp()
      onUpdated?.()
    } catch (err) {
      setMaterialsError(err?.response?.data?.message || err?.message || 'Gagal menyimpan lampiran material.')
    } finally {
      setSavingMaterials(false)
    }
  }

  // Meter form manipulation
  const handleAddMeterRow = () => {
    setMetersForm((prev) => [
      ...prev,
      {
        id: `temp-${Date.now()}`,
        customer_idpel: workOrder?.application?.customer?.idpel || '',
        meter_number: '',
        photo_document_ids: [],
      },
    ])
  }

  const handleRemoveMeterRow = (index) => {
    setMetersForm((prev) => prev.filter((_, idx) => idx !== index))
  }

  const handleMeterFieldChange = (index, field, value) => {
    setMetersForm((prev) =>
      prev.map((m, idx) => (idx === index ? { ...m, [field]: value } : m))
    )
  }

  // Save Meters List (PUT /bastp/{id}/meters)
  const handleSaveMeters = async (e) => {
    e?.preventDefault()
    setSavingMeters(true)
    setMetersError('')
    try {
      const payload = {
        meters: metersForm.map((m) => ({
          customer_idpel: m.customer_idpel.trim(),
          meter_number: m.meter_number.trim(),
        })),
      }
      await bastpApi.putMeters(bastp.id, payload)
      notify({
        type: 'success',
        title: 'Data kWh Meter Disimpan',
        desc: 'Daftar kWh meter BASTP berhasil disimpan.',
        tag: 'BASTP',
      })
      await loadBastp()
      onUpdated?.()
    } catch (err) {
      setMetersError(err?.response?.data?.message || err?.message || 'Gagal menyimpan data kWh meter.')
    } finally {
      setSavingMeters(false)
    }
  }

  // Upload Photo for Meter (POST /bastp/{id}/meters/{meter}/photos)
  const handleUploadPhoto = async (meterId, file) => {
    if (!file || !meterId) return
    setUploadingPhotoMeterId(meterId)
    setPhotoError('')
    try {
      await bastpApi.uploadPhoto(bastp.id, meterId, file, file.name)
      notify({
        type: 'success',
        title: 'Foto Meter Diunggah',
        desc: `Foto dokumentasi "${file.name}" berhasil diunggah.`,
        tag: 'BASTP',
      })
      await loadBastp()
      onUpdated?.()
    } catch (err) {
      setPhotoError(err?.response?.data?.message || err?.message || 'Gagal mengunggah foto kWh meter.')
    } finally {
      setUploadingPhotoMeterId(null)
    }
  }

  // Open Electronic Signature Modal
  const handleOpenSignModal = (step) => {
    setSignError('')
    let title = ''
    let description = ''
    let confirmLabel = ''

    if (step === 'submit') {
      title = 'Ajukan & Tanda Tangani BASTP'
      description =
        'Dengan mengajukan BASTP, seluruh lampiran material dan bukti kWh meter akan dibekukan (immutable) dan diberi nomor registrasi BASTP.'
      confirmLabel = 'Ajukan & Tanda Tangani'
    } else if (step === 'accept') {
      title = 'Terima & Tanda Tangani BASTP (Manager ULP)'
      description =
        'Konfirmasi penerimaan pekerjaan serah terima konstruksi dan pembubuhan tanda tangan elektronik Manager ULP.'
      confirmLabel = 'Terima & Tanda Tangani'
    } else if (step === 'sign') {
      title = 'Tanda Tangani BASTP (Konstruksi UP3)'
      description =
        'Konfirmasi verifikasi fisik lapangan dan pembubuhan tanda tangan elektronik Tim Konstruksi UP3.'
      confirmLabel = 'Tanda Tangani BASTP'
    } else if (step === 'close') {
      title = 'Tutup & Tanda Tangani BASTP (Asman Konstruksi)'
      description =
        'Penutupan BASTP akan secara resmi menyelesaikan Surat Perintah Kerja (WO). Pelanggan wajib berstatus eksternal PEREMAJAAN (sinkronisasi EIS).'
      confirmLabel = 'Tutup BASTP & Selesaikan WO'
    }

    setSignModalConfig({
      open: true,
      step,
      title,
      description,
      confirmLabel,
    })
  }

  // Execute Electronic Signature with Password
  const handleConfirmSignature = async (password) => {
    setSigning(true)
    setSignError('')
    const { step } = signModalConfig

    try {
      if (step === 'submit') {
        await bastpApi.submit(bastp.id, { password })
        notify({
          type: 'success',
          title: 'BASTP Berhasil Diajukan',
          desc: 'BASTP telah dibekukan dan diteruskan ke Manager ULP untuk persetujuan.',
          tag: 'BASTP',
        })
      } else if (step === 'accept') {
        await bastpApi.accept(bastp.id, { password })
        notify({
          type: 'success',
          title: 'BASTP Diterima',
          desc: 'BASTP berhasil disetujui Manager ULP dan diteruskan ke Konstruksi UP3.',
          tag: 'BASTP',
        })
      } else if (step === 'sign') {
        await bastpApi.sign(bastp.id, { password })
        notify({
          type: 'success',
          title: 'BASTP Ditandatangani',
          desc: 'BASTP berhasil ditandatangani Konstruksi UP3 dan diteruskan ke Asman Konstruksi.',
          tag: 'BASTP',
        })
      } else if (step === 'close') {
        await bastpApi.close(bastp.id, { password })
        notify({
          type: 'success',
          title: 'BASTP Ditutup & SPK Selesai',
          desc: 'BASTP resmi ditutup. Surat Perintah Kerja (WO) telah dinyatakan rampung.',
          tag: 'BASTP',
        })
      }

      setSignModalConfig((prev) => ({ ...prev, open: false }))
      await loadBastp()
      onUpdated?.()
    } catch (err) {
      // 403 (wrong password) or 409 (status not ready / not PEREMAJAAN) verbatim
      setSignError(err?.response?.data?.message || err?.message || 'Gagal memproses tanda tangan elektronik.')
    } finally {
      setSigning(false)
    }
  }

  // Return BASTP to DRAFT (Round + 1)
  const handleConfirmReturn = async (reason) => {
    setReturning(true)
    setReturnError('')
    try {
      await bastpApi.return(bastp.id, { reason })
      notify({
        type: 'info',
        title: 'BASTP Dikembalikan',
        desc: `BASTP dikembalikan ke status DRAFT untuk putaran ke-${(bastp?.round || 1) + 1}.`,
        tag: 'BASTP',
      })
      setReturnDialogOpen(false)
      await loadBastp()
      onUpdated?.()
    } catch (err) {
      setReturnError(err?.response?.data?.message || err?.message || 'Gagal mengembalikan BASTP.')
    } finally {
      setReturning(false)
    }
  }

  const isDraft = bastp?.status === 'DRAFT'
  const isSubmitted = bastp?.status === 'SUBMITTED'
  const isAccepted = bastp?.status === 'ACCEPTED'
  const isKonstruksiSigned = bastp?.status === 'KONSTRUKSI_SIGNED'
  const isClosed = bastp?.status === 'CLOSED'

  return (
    <PanelShell
      asPage={asPage}
      onBack={onClose}
      open={true}
      onClose={onClose}
      title={bastp ? `BASTP: ${bastp.bastp_number || 'Draf Baru'}` : 'Detail BASTP'}
      subtitle={bastp ? `WO #${bastp.wo_number || '-'} · Putaran ke-${bastp.round} · Status: ${bastp.status}` : ''}
      width="max-w-5xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2 flex-wrap">
            {bastp && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setDocModalOpen(true)}
                className="inline-flex items-center gap-1.5"
              >
                <IconDocument size={13} />
                <span>Dokumen BASTP</span>
              </Button>
            )}

            {/* Step Actions: Submit (Vendor / TEKNIK) */}
            {isDraft && canPrepare && (
              <Button
                size="sm"
                variant="primary"
                onClick={() => handleOpenSignModal('submit')}
                className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5"
              >
                <IconCheck size={13} />
                <span>Ajukan & Tanda Tangani</span>
              </Button>
            )}

            {/* Step Actions: Accept (Manager ULP) */}
            {isSubmitted && canAccept && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => handleOpenSignModal('accept')}
                  className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5"
                >
                  <IconCheck size={13} />
                  <span>Terima & Tanda Tangani</span>
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    setReturnError('')
                    setReturnDialogOpen(true)
                  }}
                >
                  Kembalikan
                </Button>
              </>
            )}

            {/* Step Actions: Sign (Konstruksi UP3) */}
            {isAccepted && canSignKonstruksi && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => handleOpenSignModal('sign')}
                  className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5"
                >
                  <IconCheck size={13} />
                  <span>Tanda Tangani</span>
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    setReturnError('')
                    setReturnDialogOpen(true)
                  }}
                >
                  Kembalikan
                </Button>
              </>
            )}

            {/* Step Actions: Close (Asman Konstruksi) */}
            {isKonstruksiSigned && canClose && (
              <>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => handleOpenSignModal('close')}
                  className="bg-emerald-600 hover:bg-emerald-700 text-white inline-flex items-center gap-1.5"
                >
                  <IconCheckCircle size={13} />
                  <span>Tutup & Tanda Tangani</span>
                </Button>
                <Button
                  size="sm"
                  variant="danger"
                  onClick={() => {
                    setReturnError('')
                    setReturnDialogOpen(true)
                  }}
                >
                  Kembalikan
                </Button>
              </>
            )}
          </div>

          <Button variant="secondary" onClick={onClose}>
            Tutup
          </Button>
        </div>
      }
    >
      <div className="space-y-6 text-xs">
        {loading && <Spinner label="Memuat rincian BASTP..." />}
        {error && <Alert variant="danger">{error}</Alert>}

        {bastp && (
          <>
            {/* Header Identity Card */}
            <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Berita Acara Serah Terima Pekerjaan (BASTP)
                  </span>
                  <div className="flex items-center gap-2 mt-0.5">
                    <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
                      {bastp.bastp_number || 'BELUM DITERBITKAN (DRAFT)'}
                    </h3>
                    <StatusBadge status={bastp.status} />
                  </div>
                  <p className="text-xs text-slate-500 mt-1">
                    Nomor WO: <strong className="text-slate-700 dark:text-slate-300 font-mono">{bastp.wo_number}</strong>
                    {' · '}
                    Putaran: <strong className="text-slate-700 dark:text-slate-300">Ke-{bastp.round}</strong>
                  </p>
                </div>

                {bastp.content_hash && (
                  <div className="text-right font-mono text-[10px] text-slate-400">
                    <span>Hash Dokumen:</span>
                    <div className="font-bold text-slate-600 dark:text-slate-300 truncate max-w-xs" title={bastp.content_hash}>
                      {bastp.content_hash.slice(0, 16)}…
                    </div>
                  </div>
                )}
              </div>

              {/* Return Reason Banner (if returned) */}
              {bastp.return_reason && isDraft && (
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 flex items-start gap-2">
                  <IconAlertCircle size={15} className="shrink-0 mt-0.5" />
                  <div>
                    <span className="font-bold block">Catatan Pengembalian (Putaran {bastp.round}):</span>
                    <span>{bastp.return_reason}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Navigation Tabs */}
            <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 flex-wrap">
              <button
                type="button"
                onClick={() => setActiveTab('materials')}
                className={`px-3 py-1.5 rounded-xl font-medium text-xs transition cursor-pointer ${
                  activeTab === 'materials'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200/70'
                }`}
              >
                1. Lampiran Material ({bastp.materials?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('meters')}
                className={`px-3 py-1.5 rounded-xl font-medium text-xs transition cursor-pointer ${
                  activeTab === 'meters'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200/70'
                }`}
              >
                2. Bukti kWh Meter ({bastp.meters?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('signatures')}
                className={`px-3 py-1.5 rounded-xl font-medium text-xs transition cursor-pointer ${
                  activeTab === 'signatures'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200/70'
                }`}
              >
                3. Tanda Tangan Elektronik ({bastp.signatures?.length || 0})
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('events')}
                className={`px-3 py-1.5 rounded-xl font-medium text-xs transition cursor-pointer ${
                  activeTab === 'events'
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200/70'
                }`}
              >
                4. Riwayat Kejadian ({bastp.events?.length || 0})
              </button>
            </div>

            {/* TAB 1: Lampiran Material Terpasang */}
            {activeTab === 'materials' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <IconLayers size={14} />
                    <span>Realisasi Material Terpasang vs Rencana WO</span>
                  </h4>
                  {isDraft && canPrepare && (
                    <Button
                      size="sm"
                      loading={savingMaterials}
                      onClick={handleSaveMaterials}
                      className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1"
                    >
                      <IconCheck size={13} />
                      <span>Simpan Perubahan Material</span>
                    </Button>
                  )}
                </div>

                {materialsError && <Alert variant="danger">{materialsError}</Alert>}

                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                  {materialsForm.length === 0 ? (
                    <EmptyState
                      icon={IconLayers}
                      title="Belum ada material lampiran BASTP"
                      description="Tidak ada daftar material yang terlampir pada dokumen BASTP ini."
                    />
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-left text-xs data-table">
                        <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-slate-500 font-semibold text-[11px]">
                          <tr>
                            <th className="py-2.5 px-3">No</th>
                            <th className="py-2.5 px-3">Kode KHS</th>
                            <th className="py-2.5 px-3 text-right">Rencana WO</th>
                            <th className="py-2.5 px-3 text-right">Terpasang (Realisasi)</th>
                            <th className="py-2.5 px-3 text-right">Selisih</th>
                            <th className="py-2.5 px-3">Catatan</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                          {materialsForm
                            .slice((matPage - 1) * matPerPage, matPage * matPerPage)
                            .map((m, idx) => {
                            const actualIdx = (matPage - 1) * matPerPage + idx
                            const planned = Number(m.planned_qty) || 0
                            const installed = m.installed_qty === '' ? null : Number(m.installed_qty)
                            const diff = installed !== null ? installed - planned : null
                            return (
                              <tr key={m.khs_code} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                                <td className="py-2 px-3 text-slate-400 font-sans">{actualIdx + 1}</td>
                                <td className="py-2 px-3 font-semibold text-slate-900 dark:text-slate-100">
                                  {m.khs_code}
                                </td>
                                <td className="py-2 px-3 text-right text-slate-600 dark:text-slate-400">
                                  {planned}
                                </td>
                                <td className="py-2 px-3 text-right">
                                  {isDraft && canPrepare ? (
                                    <input
                                      type="number"
                                      step="any"
                                      min="0"
                                      value={m.installed_qty}
                                      onChange={(e) => {
                                        const val = e.target.value
                                        setMaterialsForm((prev) =>
                                          prev.map((item, i) => (i === actualIdx ? { ...item, installed_qty: val } : item))
                                        )
                                      }}
                                      placeholder="0"
                                      className="w-24 px-2 py-1 text-right text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                                    />
                                  ) : (
                                    <span className="font-semibold text-slate-800 dark:text-slate-200">
                                      {installed !== null ? installed : '-'}
                                    </span>
                                  )}
                                </td>
                                <td className="py-2 px-3 text-right">
                                  {diff === null ? (
                                    <span className="text-slate-400">-</span>
                                  ) : diff === 0 ? (
                                    <span className="text-slate-500">0</span>
                                  ) : diff > 0 ? (
                                    <span className="text-amber-600 font-semibold">+{diff}</span>
                                  ) : (
                                    <span className="text-blue-600 font-semibold">{diff}</span>
                                  )}
                                </td>
                                <td className="py-2 px-3 font-sans">
                                  {isDraft && canPrepare ? (
                                    <input
                                      type="text"
                                      value={m.note}
                                      onChange={(e) => {
                                        const val = e.target.value
                                        setMaterialsForm((prev) =>
                                          prev.map((item, i) => (i === actualIdx ? { ...item, note: val } : item))
                                        )
                                      }}
                                      placeholder="Catatan material (opsional)"
                                      className="w-full px-2 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                                    />
                                  ) : (
                                    <span className="text-slate-500">{m.note || '-'}</span>
                                  )}
                                </td>
                              </tr>
                            )
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}

                  <TableFooter
                    itemCount={materialsForm.slice((matPage - 1) * matPerPage, matPage * matPerPage).length}
                    total={materialsForm.length}
                    entityLabel="material lampiran BASTP"
                    page={matPage}
                    perPage={matPerPage}
                    onPage={setMatPage}
                    onPerPage={(n) => {
                      setMatPerPage(n)
                      setMatPage(1)
                    }}
                    perPageOptions={[10, 25, 50, 100]}
                  />
                </div>

                {/* Catatan Umum BASTP */}
                <div className="space-y-1">
                  <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Catatan Umum BASTP
                  </label>
                  {isDraft && canPrepare ? (
                    <textarea
                      rows={2}
                      value={generalNotes}
                      onChange={(e) => setGeneralNotes(e.target.value)}
                      placeholder="Tambahkan catatan pelaksanaan pekerjaan jika ada..."
                      className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                    />
                  ) : (
                    <p className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                      {generalNotes || 'Tidak ada catatan umum.'}
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* TAB 2: Bukti kWh Meter & Foto */}
            {activeTab === 'meters' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                      <IconZap size={14} />
                      <span>Daftar Bukti kWh Meter Terpasang ({metersForm.length})</span>
                    </h4>
                    <p className="text-[11px] text-slate-500">
                      Setiap kWh meter wajib memiliki minimal 1 foto fisik meter (maksimal 10 foto) sebelum BASTP diajukan.
                    </p>
                  </div>

                  {isDraft && canPrepare && (
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={handleAddMeterRow}
                        className="inline-flex items-center gap-1"
                      >
                        <IconPlus size={13} />
                        <span>Tambah Meter</span>
                      </Button>
                      <Button
                        size="sm"
                        loading={savingMeters}
                        onClick={handleSaveMeters}
                        className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1"
                      >
                        <IconCheck size={13} />
                        <span>Simpan Data Meter</span>
                      </Button>
                    </div>
                  )}
                </div>

                {metersError && <Alert variant="danger">{metersError}</Alert>}
                {photoError && <Alert variant="danger">{photoError}</Alert>}

                {metersForm.length === 0 ? (
                  <EmptyState
                    icon={IconZap}
                    title="Belum ada data kWh meter"
                    description="Setiap kWh meter wajib memiliki minimal 1 foto fisik meter (maksimal 10 foto) sebelum BASTP diajukan."
                    action={
                      isDraft && canPrepare ? (
                        <button
                          type="button"
                          onClick={handleAddMeterRow}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-semibold shadow-xs cursor-pointer"
                        >
                          <IconPlus size={14} />
                          <span>Tambah Baris kWh Meter</span>
                        </button>
                      ) : null
                    }
                  />
                ) : (
                  <div className="space-y-3">
                    {metersForm.map((m, idx) => {
                      const isSaved = m.id && !m.id.startsWith('temp-')
                      const photoCount = m.photo_document_ids?.length || 0

                      return (
                        <div
                          key={m.id || idx}
                          className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3"
                        >
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                            <div className="flex items-center gap-3 flex-1 flex-wrap">
                              <span className="font-bold text-slate-400 font-mono text-xs">
                                #{idx + 1}
                              </span>

                              <div className="w-48">
                                <label className="block text-[10px] text-slate-400 font-medium mb-0.5">
                                  ID Pelanggan (IDPEL)
                                </label>
                                {isDraft && canPrepare ? (
                                  <input
                                    type="text"
                                    value={m.customer_idpel}
                                    onChange={(e) => handleMeterFieldChange(idx, 'customer_idpel', e.target.value)}
                                    placeholder="Contoh: 515430001234"
                                    className="w-full px-2.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                                  />
                                ) : (
                                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                                    {m.customer_idpel}
                                  </span>
                                )}
                              </div>

                              <div className="w-48">
                                <label className="block text-[10px] text-slate-400 font-medium mb-0.5">
                                  Nomor Seri kWh Meter
                                </label>
                                {isDraft && canPrepare ? (
                                  <input
                                    type="text"
                                    value={m.meter_number}
                                    onChange={(e) => handleMeterFieldChange(idx, 'meter_number', e.target.value)}
                                    placeholder="Contoh: 01140023948"
                                    className="w-full px-2.5 py-1 text-xs rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                                  />
                                ) : (
                                  <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                                    {m.meter_number}
                                  </span>
                                )}
                              </div>

                              <div className="flex items-center gap-1.5 pt-4 sm:pt-0">
                                <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                  photoCount > 0 ? 'bg-emerald-100 text-emerald-800' : 'bg-amber-100 text-amber-800'
                                }`}>
                                  {photoCount} Foto
                                </span>
                              </div>
                            </div>

                            {isDraft && canPrepare && (
                              <button
                                type="button"
                                onClick={() => handleRemoveMeterRow(idx)}
                                className="text-rose-500 hover:text-rose-700 text-xs inline-flex items-center gap-1"
                                title="Hapus baris meter ini"
                              >
                                <IconTrash size={13} />
                                <span>Hapus</span>
                              </button>
                            )}
                          </div>

                          {/* Foto Dokumentasi Meter */}
                          <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 flex-wrap">
                            <span className="text-[11px] text-slate-500">
                              {photoCount === 0
                                ? 'Belum ada foto terunggah. Simpan meter terlebih dahulu untuk mengunggah foto.'
                                : `Terdapat ${photoCount} foto terlampir (maks. 10).`}
                            </span>

                            {isDraft && canPrepare && isSaved && photoCount < 10 && (
                              <label className="inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-medium bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 cursor-pointer transition">
                                <IconCamera size={13} />
                                <span>{uploadingPhotoMeterId === m.id ? 'Mengunggah...' : '+ Unggah Foto Meter'}</span>
                                <input
                                  type="file"
                                  accept="image/*"
                                  className="hidden"
                                  disabled={uploadingPhotoMeterId === m.id}
                                  onChange={(e) => {
                                    const file = e.target.files?.[0]
                                    if (file) handleUploadPhoto(m.id, file)
                                  }}
                                />
                              </label>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* TAB 3: Tanda Tangan Elektronik */}
            {activeTab === 'signatures' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                    <IconShield size={14} />
                    <span>Daftar Tanda Tangan Elektronik Berjenjang</span>
                  </h4>
                  <span className="text-slate-400 font-mono text-[11px]">
                    Total: {bastp.signatures?.length || 0} Tanda Tangan
                  </span>
                </div>

                {(!bastp.signatures || bastp.signatures.length === 0) ? (
                  <div className="p-8 text-center text-slate-400 border border-slate-200 dark:border-slate-800 rounded-xl">
                    BASTP masih dalam status DRAFT. Belum ada tanda tangan elektronik yang dibubuhkan.
                  </div>
                ) : (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <table className="min-w-full text-left text-xs data-table">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-slate-500 font-semibold text-[11px]">
                        <tr>
                          <th className="py-2.5 px-3">Putaran</th>
                          <th className="py-2.5 px-3">Langkah / Peran</th>
                          <th className="py-2.5 px-3">Nama Penanda Tangan</th>
                          <th className="py-2.5 px-3">Waktu Tanda Tangan</th>
                          <th className="py-2.5 px-3 font-mono">Sidik Jari (HMAC 16-Karakter)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-sans text-xs">
                        {bastp.signatures.map((sig, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                            <td className="py-2 px-3 font-mono text-slate-500">
                              Putaran {sig.round}
                            </td>
                            <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                              {sig.step === 'SUBMIT' && 'PELAKSANA (PIHAK KEDUA)'}
                              {sig.step === 'ULP_MANAGER' && 'MANAGER ULP'}
                              {sig.step === 'KONSTRUKSI_UP3' && 'KONSTRUKSI UP3'}
                              {sig.step === 'ASMAN_KONSTRUKSI' && 'ASMAN KONSTRUKSI'}
                              {!['SUBMIT', 'ULP_MANAGER', 'KONSTRUKSI_UP3', 'ASMAN_KONSTRUKSI'].includes(sig.step) && sig.step}
                              <span className="block text-[10px] font-normal text-slate-400 font-mono">
                                {sig.signer_role}
                              </span>
                            </td>
                            <td className="py-2 px-3 font-medium text-slate-900 dark:text-slate-100">
                              {sig.signer_name}
                            </td>
                            <td className="py-2 px-3 text-slate-500 font-mono text-[11px]">
                              {sig.signed_at ? new Date(sig.signed_at).toLocaleString('id-ID') : '-'}
                            </td>
                            <td className="py-2 px-3 font-mono text-[11px] text-emerald-600 dark:text-emerald-400 font-bold">
                              {sig.signature ? sig.signature.slice(0, 16) : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                {/* Disclaimer / Catatan TTE */}
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400 italic">
                  Catatan: Ditandatangani secara elektronik dalam sistem DISTRIVA (konfirmasi kata sandi akun); sidik jari tanda tangan merupakan 16 karakter pertama HMAC atas isi beku dokumen BASTP. Dokumen ini bukan tanda tangan elektronik tersertifikasi (non-PSrE).
                </div>
              </div>
            )}

            {/* TAB 4: Riwayat Kejadian (Audit Trail) */}
            {activeTab === 'events' && (
              <div className="space-y-4">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Riwayat Kejadian BASTP ({bastp.events?.length || 0})
                </h4>

                {(!bastp.events || bastp.events.length === 0) ? (
                  <p className="text-xs text-slate-400 italic">Belum ada riwayat tercatat.</p>
                ) : (
                  <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
                    <table className="min-w-full text-left text-xs data-table">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-slate-500 font-semibold text-[11px]">
                        <tr>
                          <th className="py-2 px-3">Kejadian</th>
                          <th className="py-2 px-3">Alasan / Catatan</th>
                          <th className="py-2 px-3">Aktor</th>
                          <th className="py-2 px-3">Waktu</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
                        {bastp.events.map((e, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                            <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                              {e.event_type}
                            </td>
                            <td className="py-2 px-3 text-slate-600 dark:text-slate-400 font-sans">
                              {e.reason || '-'}
                            </td>
                            <td className="py-2 px-3 text-slate-500">{e.actor_name || '-'}</td>
                            <td className="py-2 px-3 text-slate-400 font-mono text-[11px]">
                              {e.occurred_at ? new Date(e.occurred_at).toLocaleString('id-ID') : '-'}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Electronic Signature Password Modal */}
      <BastpSignModal
        open={signModalConfig.open}
        title={signModalConfig.title}
        description={signModalConfig.description}
        confirmLabel={signModalConfig.confirmLabel}
        onConfirm={handleConfirmSignature}
        onClose={() => setSignModalConfig((prev) => ({ ...prev, open: false }))}
        loading={signing}
        error={signError}
      />

      {/* Return Reason Dialog */}
      {returnDialogOpen && (
        <ReasonDialog
          title="Kembalikan BASTP ke Pembuat"
          description={`Pengembalian BASTP akan menaikkan putaran dokumen menjadi Putaran ke-${(bastp?.round || 1) + 1} dan mengembalikan status ke DRAFT agar dapat diperbaiki.`}
          confirmLabel="Kembalikan BASTP"
          onConfirm={handleConfirmReturn}
          onClose={() => setReturnDialogOpen(false)}
          loading={returning}
          error={returnError}
        />
      )}

      {/* Output Document Modal (docs/70 & docs/57) */}
      <OutputDocumentModal
        open={docModalOpen}
        onClose={() => setDocModalOpen(false)}
        runId={bastp?.id}
        category="bastp"
        type="bastp"
        title={`Dokumen BASTP #${bastp?.bastp_number || ''}`}
      />
    </PanelShell>
  )
}
