import { useState, useEffect, useCallback } from 'react'
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom'
import { proposalsApi, drawingApi } from '../../services/api.js'
import DrawingDetailView from '../drawings/DrawingDetailView.jsx'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ProposalSelectableModal from './ProposalSelectableModal.jsx'
import ProposalKkfPanel from './ProposalKkfPanel.jsx'
import ProposalApprovalChain from './ProposalApprovalChain.jsx'
import ApplicationAllocationPanel from '../applications/ApplicationAllocationPanel.jsx'
import ProposalHistoryTimeline from './ProposalHistoryTimeline.jsx'
import useDrawingBundle from './useDrawingBundle.js'
import {
  IconUsers,
  IconUser,
  IconPlus,
  IconTrash,
  IconX,
  IconClock,
  IconCalculator,
  IconHistory,
  IconCheckCircle,
  IconAlertCircle,
  IconFileText,
  IconBuilding,
  IconArrowRight,
  IconArrowLeft,
  IconTag,
} from '../../components/icons.jsx'
import { formatRupiah } from '../../utils/kkfFormatters.js'

/**
 * ProposalDetailPage (docs/62 §37, docs/76 & docs/57)
 * Detail Usulan Banyak Pelanggan:
 * - Menampilkan daftar anggota lengkap dengan indikator Pelanggan Utama (Perwakilan)
 * - Tambah anggota (tabel pelanggan 3 fasa selectable + alasan audit)
 * - Keluarkan anggota (alasan audit; ditolak bila perwakilan)
 * - Batalkan usulan (alasan audit)
 * - Tautan "Lanjutkan ke Alur Teknis" via representative_application_id dengan banner usulan
 * - Panel KKF Usulan terintegrasi
 */
export default function ProposalDetailPage({
  proposalId: propIdFromProps = null,
  onBack,
  onNavigateRepresentative,
}) {
  const { id: paramId } = useParams()
  const navigate = useNavigate()
  const proposalId = propIdFromProps || paramId

  const { can, isSysAdmin } = useAccess()
  const { notify } = useNotifications()

  const [loading, setLoading] = useState(true)
  const [proposal, setProposal] = useState(null)
  const [error, setError] = useState('')

  // Active Tab: 'members' | 'drawings' | 'kkf' | 'history'
  const [searchParams, setSearchParams] = useSearchParams()
  const initialTab = searchParams.get('tab') === 'drawings' || searchParams.get('tab') === 'gambar' ? 'drawings' : searchParams.get('tab') === 'alokasi' ? 'alokasi' : 'members'
  const [activeTab, setActiveTab] = useState(initialTab)
  const [memberPage, setMemberPage] = useState(1)
  const [memberPerPage, setMemberPerPage] = useState(10)

  // Drawing state for full-page input in ProposalDetailPage
  const [openingDrawing, setOpeningDrawing] = useState(false)
  const [drawingError, setDrawingError] = useState('')
  const [chainKey, setChainKey] = useState(0)

  // Modals State
  const [selectableModalOpen, setSelectableModalOpen] = useState(false)
  const [cancelModalOpen, setCancelModalOpen] = useState(false)
  const [removeTargetMember, setRemoveTargetMember] = useState(null)
  const [actionError, setActionError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const [removing, setRemoving] = useState(false)

  // Paket gambar diambil sekali dan dibagikan ke rantai persetujuan, tab Gambar, dan riwayat; chainKey memaksa muat ulang
  const bundle = useDrawingBundle(proposal?.representative_application_id, chainKey)
  const drawingPkg = bundle.drawing
  const loadingDrawing = bundle.loading && !bundle.drawing
  const loadDrawingPkg = useCallback(() => setChainKey((k) => k + 1), [])

  const handleOpenDrawing = async () => {
    const repId = proposal?.representative_application_id
    if (!repId || openingDrawing) return
    setOpeningDrawing(true)
    setDrawingError('')
    try {
      const res = await drawingApi.create(repId, {})
      notify({
        type: 'success',
        title: 'Paket Gambar Berhasil Dibuka',
        desc: `Paket gambar teknik #${res.data?.drawing_number || ''} berhasil dibuka.`,
        tag: 'Gambar Teknik',
      })
      loadDrawingPkg()
    } catch (err) {
      setDrawingError(err?.message || 'Gagal membuka paket gambar teknik.')
    } finally {
      setOpeningDrawing(false)
    }
  }

  // Load Proposal Detail
  const loadDetail = useCallback(async () => {
    if (!proposalId) return
    setLoading(true)
    setError('')
    try {
      const res = await proposalsApi.get(proposalId)
      setProposal(res?.data || null)
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Gagal memuat detail usulan.')
    } finally {
      setLoading(false)
    }
  }, [proposalId])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  // Handle Cancel Proposal
  const handleConfirmCancel = async (reason) => {
    if (!proposal?.id || !reason) return
    setCancelling(true)
    setActionError('')
    try {
      await proposalsApi.cancel(proposal.id, { reason })
      notify({
        type: 'warning',
        title: 'Usulan Dibatalkan',
        desc: `Usulan ${proposal.proposal_number} telah dibatalkan dengan pencatatan audit log.`,
        tag: 'Usulan',
      })
      setCancelModalOpen(false)
      await loadDetail()
    } catch (err) {
      // 409 / 403 apa adanya
      setActionError(err?.response?.data?.message || err?.message || 'Gagal membatalkan usulan.')
    } finally {
      setCancelling(false)
    }
  }

  // Handle Remove Member
  const handleConfirmRemoveMember = async (reason) => {
    if (!proposal?.id || !removeTargetMember || !reason) return
    setRemoving(true)
    setActionError('')
    try {
      await proposalsApi.removeMember(proposal.id, removeTargetMember.application_id, { reason })
      notify({
        type: 'info',
        title: 'Pelanggan Dikeluarkan',
        desc: `Pelanggan ${removeTargetMember.customer_name} telah dikeluarkan dari usulan.`,
        tag: 'Usulan',
      })
      setRemoveTargetMember(null)
      await loadDetail()
    } catch (err) {
      setActionError(err?.response?.data?.message || err?.message || 'Gagal mengeluarkan pelanggan.')
    } finally {
      setRemoving(false)
    }
  }

  // Handle Navigate to Technical Pipeline
  const handleContinuePipeline = () => {
    if (!proposal?.representative_application_id) return

    if (onNavigateRepresentative) {
      onNavigateRepresentative(proposal.representative_application_id, proposal)
    } else {
      setActiveTab('drawings')
      const p = new URLSearchParams(searchParams)
      p.set('tab', 'drawings')
      setSearchParams(p, { replace: true })
    }
  }

  if (loading) {
    return (
      <div className="py-24 flex flex-col items-center justify-center gap-3 text-slate-500">
        <Spinner size="lg" />
        <p className="text-xs">Memuat data usulan...</p>
      </div>
    )
  }

  if (error || !proposal) {
    return (
      <div className="p-6 max-w-4xl mx-auto space-y-4">
        <Alert variant="danger">{error || 'Data usulan tidak ditemukan.'}</Alert>
        <Button variant="secondary" onClick={() => (onBack ? onBack() : navigate('/usulan'))}>
          Kembali ke Daftar Usulan
        </Button>
      </div>
    )
  }

  const isProposalOpen = proposal.status === 'OPEN'
  const canManage = Boolean(can['proposals.manage'] || isSysAdmin)
  const canManageMaterials = Boolean(can['allocations.manage'] || isSysAdmin)
  const canManagePoles = Boolean(can['allocations.poles'] || isSysAdmin)
  const canViewAllocations = Boolean(can['allocations.view'] || can['allocations.manage'] || can['allocations.poles'] || isSysAdmin)
  const staleKkfNote = proposal.kkf_runs_count > 0
    ? `Usulan ini sudah memiliki ${proposal.kkf_runs_count} run KKF tersimpan yang memakai daftar anggota sebelumnya. Setelah daftar berubah, hitung ulang KKF di tab Kelayakan Finansial.`
    : ''
  const members = proposal.members || []
  const repMember = members.find((m) => m.is_representative) || members[0]

  return (
    <div className="space-y-6">
      {/* Header & Back Navigation */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => (onBack ? onBack() : navigate('/usulan'))}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            title="Kembali"
          >
            <IconArrowLeft size={16} />
          </button>
          <div>
            <div className="flex items-center gap-2.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Usulan Banyak Pelanggan (3 Fasa)
              </span>
              <StatusBadge status={proposal.status} />
            </div>
            <h2 className="text-xl font-extrabold text-slate-900 dark:text-slate-100 font-mono tracking-tight mt-0.5">
              {proposal.proposal_number}
            </h2>
            {proposal.title && (
              <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                {proposal.title}
              </p>
            )}
          </div>
        </div>

        {/* Global Action Buttons */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Tambah Anggota */}
          {isProposalOpen && canManage && (
            <Button
              type="button"
              variant="secondary"
              onClick={() => setSelectableModalOpen(true)}
              className="inline-flex items-center gap-1.5"
            >
              <IconPlus size={14} />
              <span>Tambah Anggota</span>
            </Button>
          )}

          {/* Batalkan Usulan: tombol garis merah, dipisah dari tindakan lain; nonaktif dengan alasan bila WO sudah terbit */}
          {isProposalOpen && canManage && (
            <>
              <span className="h-5 w-px bg-slate-200 dark:bg-slate-700 hidden sm:block" aria-hidden="true" />
              <Button
                type="button"
                variant="secondary"
                disabled={Boolean(proposal.cancel_blocked_reason)}
                title={proposal.cancel_blocked_reason || 'Batalkan usulan ini (alasan wajib diisi)'}
                onClick={() => setCancelModalOpen(true)}
                className="inline-flex items-center gap-1.5 border-rose-300! dark:border-rose-800! text-rose-700! dark:text-rose-300! hover:bg-rose-50! dark:hover:bg-rose-950/40!"
              >
                <IconX size={14} />
                <span>Batalkan Usulan</span>
              </Button>
            </>
          )}
        </div>
      </div>

      {actionError && (
        <Alert variant="danger" onClose={() => setActionError('')}>
          {actionError}
        </Alert>
      )}

      {proposal.status === 'COMPLETED_NO_EXTENSION' && (
        <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-emerald-900 dark:text-emerald-200 text-xs flex items-center gap-2.5">
          <IconCheckCircle size={18} className="text-emerald-600 shrink-0" />
          <div>
            <strong className="block font-bold">Usulan Selesai Tanpa Perluasan</strong>
            <span>Survei menyatakan tidak memerlukan perluasan jaringan. Seluruh pelanggan anggota kini berstatus lepas dan dikelola sebagai permohonan biasa di tab Permohonan.</span>
          </div>
        </div>
      )}

      {/* Meta Card & Summary */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div>
            <span className="text-slate-400 text-[10px] font-semibold uppercase block">Pelanggan Utama (Perwakilan)</span>
            <strong className="text-slate-900 dark:text-slate-100 block mt-0.5 truncate">
              {repMember?.customer_name || '-'}
            </strong>
            <span className="text-[11px] text-slate-500 font-mono">
              {repMember?.application_number || '-'} · IDPEL: {repMember?.idpel || '-'}
            </span>
          </div>

          <div>
            <span className="text-slate-400 text-[10px] font-semibold uppercase block">Jumlah Pelanggan</span>
            <span className="text-base font-extrabold text-blue-600 dark:text-blue-400 block mt-0.5">
              {members.length} Pelanggan
            </span>
            <span className="text-[11px] text-slate-500">Seluruhnya 3 Fasa (≥ 6.600 VA)</span>
          </div>

          <div>
            <span className="text-slate-400 text-[10px] font-semibold uppercase block">Total Selisih Daya</span>
            <span className="text-base font-bold text-slate-900 dark:text-slate-100 block mt-0.5 font-mono">
              {members.reduce((acc, m) => acc + (Number(m.delta_power_kva) || 0), 0).toFixed(2)} kVA
            </span>
            <span className="text-[11px] text-slate-500">Akumulasi daya hitung</span>
          </div>

          <div>
            <span className="text-slate-400 text-[10px] font-semibold uppercase block">Status Alur</span>
            <div className="flex items-center gap-1.5 mt-1">
              <span className={`inline-block w-2 h-2 rounded-full ${isProposalOpen ? 'bg-emerald-500' : 'bg-slate-400'}`} />
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {isProposalOpen ? 'Aktif (Tahap Perencanaan)' : 'Dibatalkan'}
              </span>
            </div>
            {proposal.cancel_reason && (
              <span className="text-[10px] text-rose-500 block truncate" title={proposal.cancel_reason}>
                Alasan: {proposal.cancel_reason}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Rantai persetujuan gambar + MTO: satu kali, di atas semua tab */}
      <ProposalApprovalChain representativeApplicationId={proposal.representative_application_id} bundle={bundle} />

      {/* Tabs Navigation */}
      <div className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800">
        <button
          type="button"
          onClick={() => {
            setActiveTab('members')
            const p = new URLSearchParams(searchParams)
            p.delete('tab')
            setSearchParams(p, { replace: true })
          }}
          className={`px-4 py-2 text-xs font-bold transition border-b-2 cursor-pointer flex items-center gap-2 ${
            activeTab === 'members'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <IconUsers size={14} />
          <span>Daftar Anggota Pelanggan ({members.length})</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('drawings')
            const p = new URLSearchParams(searchParams)
            p.set('tab', 'drawings')
            setSearchParams(p, { replace: true })
          }}
          className={`px-4 py-2 text-xs font-bold transition border-b-2 cursor-pointer flex items-center gap-2 ${
            activeTab === 'drawings'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <IconFileText size={14} />
          <span>Gambar &amp; Lampiran Usulan</span>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('kkf')
            const p = new URLSearchParams(searchParams)
            p.set('tab', 'kkf')
            setSearchParams(p, { replace: true })
          }}
          className={`px-4 py-2 text-xs font-bold transition border-b-2 cursor-pointer flex items-center gap-2 ${
            activeTab === 'kkf'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <IconCalculator size={14} />
          <span>Kelayakan Finansial (KKF Usulan)</span>
        </button>

        {canViewAllocations && (
          <button
            type="button"
            onClick={() => {
              setActiveTab('alokasi')
              const p = new URLSearchParams(searchParams)
              p.set('tab', 'alokasi')
              setSearchParams(p, { replace: true })
            }}
            className={`px-4 py-2 text-xs font-bold transition border-b-2 cursor-pointer flex items-center gap-2 ${
              activeTab === 'alokasi'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <IconBuilding size={14} />
            <span>Alokasi Material</span>
          </button>
        )}

        <button
          type="button"
          onClick={() => {
            setActiveTab('history')
            const p = new URLSearchParams(searchParams)
            p.set('tab', 'history')
            setSearchParams(p, { replace: true })
          }}
          className={`px-4 py-2 text-xs font-bold transition border-b-2 cursor-pointer flex items-center gap-2 ${
            activeTab === 'history'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
          }`}
        >
          <IconHistory size={14} />
          <span>Riwayat &amp; Keputusan</span>
        </button>
      </div>

      {/* Tab 1: Members Table */}
      {activeTab === 'members' && (
        <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
          {members.length === 0 ? (
            <EmptyState
              icon={IconUsers}
              title="Belum ada anggota pelanggan"
              description="Belum ada permohonan pelanggan yang ditambahkan ke dalam usulan ini."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-3 w-10 text-center">No</th>
                    <th className="py-2.5 px-3">Peran dalam Usulan</th>
                    <th className="py-2.5 px-3">Nama Pelanggan</th>
                    <th className="py-2.5 px-3">IDPEL</th>
                    <th className="py-2.5 px-3">No. Permohonan</th>
                    <th className="py-2.5 px-3">Tarif & Daya Baru</th>
                    <th className="py-2.5 px-3 text-right">Daya Hitung (kVA)</th>
                    <th className="py-2.5 px-3 text-right">Biaya EIS (BP)</th>
                    <th className="py-2.5 px-3 text-center">Status</th>
                    {isProposalOpen && canManage && (
                      <th className="py-2.5 px-3 text-right">Aksi</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-sans">
                  {members
                    .slice((memberPage - 1) * memberPerPage, memberPage * memberPerPage)
                    .map((m, idx) => {
                    const actualIdx = (memberPage - 1) * memberPerPage + idx
                    return (
                    <tr key={m.application_id} className={`hover:bg-slate-50 dark:hover:bg-slate-800/40 ${m.is_representative ? 'bg-blue-50/30 dark:bg-blue-950/20' : ''}`}>
                      <td className="py-2.5 px-3 text-center text-slate-400 font-mono text-[11px]">
                        {actualIdx + 1}
                      </td>
                      <td className="py-2.5 px-3">
                        {m.is_representative ? (
                          <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-tight bg-blue-600 text-white shadow-2xs">
                            <IconUser size={11} />
                            <span>Pelanggan Utama</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                            Anggota
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100">
                        {m.customer_name}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-300">
                        {m.idpel || '-'}
                      </td>
                      <td className="py-2.5 px-3 font-mono font-semibold text-blue-700 dark:text-blue-400">
                        {m.application_number}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="font-semibold text-slate-800 dark:text-slate-200">
                          {m.tariff || '-'}
                        </span>
                        <span className="text-[11px] text-slate-500 block">
                          {m.power ? `${m.power.toLocaleString('id-ID')} ${m.power_unit || 'VA'}` : '-'}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono font-semibold text-slate-900 dark:text-slate-100">
                        {m.delta_power_kva != null ? Number(m.delta_power_kva).toFixed(2) : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                        {m.total_cost != null ? formatRupiah(m.total_cost) : '-'}
                      </td>
                      <td className="py-2.5 px-3 text-center">
                        <StatusBadge status={m.status} />
                      </td>
                      {isProposalOpen && canManage && (
                        <td className="py-2.5 px-3 text-right">
                          {m.is_representative ? (
                            <span
                              className="text-[10px] text-slate-400 italic cursor-not-allowed"
                              title="Pelanggan utama (perwakilan) usulan tidak dapat dikeluarkan; batalkan usulan bila perlu."
                            >
                              Perwakilan (Terkunci)
                            </span>
                          ) : (
                            <Button
                              size="xs"
                              variant="secondary"
                              onClick={() => setRemoveTargetMember(m)}
                              className="text-rose-600 hover:text-rose-700 hover:bg-rose-50 dark:hover:bg-rose-950/40 inline-flex items-center gap-1"
                            >
                              <IconTrash size={12} />
                              <span>Keluarkan</span>
                            </Button>
                          )}
                        </td>
                      )}
                    </tr>
                  )})}
                </tbody>
              </table>
            </div>
          )}

          <TableFooter
            itemCount={members.slice((memberPage - 1) * memberPerPage, memberPage * memberPerPage).length}
            total={members.length}
            entityLabel="pelanggan dalam usulan"
            page={memberPage}
            perPage={memberPerPage}
            onPage={setMemberPage}
            onPerPage={(n) => {
              setMemberPerPage(n)
              setMemberPage(1)
            }}
            perPageOptions={[10, 25, 50, 100]}
          />
        </div>
      )}

      {/* Tab: Gambar & Lampiran Usulan */}
      {activeTab === 'drawings' && (
        <div className="space-y-4">
          {drawingError && <Alert variant="danger">{drawingError}</Alert>}
          {loadingDrawing ? (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800">
              <Spinner size="sm" label="Memuat paket gambar teknik usulan..." />
            </div>
          ) : drawingPkg ? (
            <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-6 shadow-2xs space-y-4">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
                <span className="text-xs text-slate-500">
                  Paket gambar teknik &amp; dokumen teknis untuk usulan ini dikelola melalui permohonan utama ({repMember?.application_number || 'perwakilan'}).
                </span>
                <span className="text-[11px] font-semibold text-blue-700 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-1 rounded-lg border border-blue-200 dark:border-blue-800">
                  Halaman Gambar &amp; MTO Usulan
                </span>
              </div>
              <DrawingDetailView
                drawingId={drawingPkg.id}
                application={repMember || proposal?.members?.find((m) => m.is_representative || m.id === proposal.representative_application_id)}
                hideApprovalChain
                hideHistory
                onReloadApplication={() => {
                  setChainKey((k) => k + 1)
                  loadDetail()
                }}
              />
            </div>
          ) : (
            <div className="p-12 text-center bg-white dark:bg-slate-900 rounded-2xl border-2 border-dashed border-slate-200 dark:border-slate-800 space-y-4">
              <div className="w-12 h-12 mx-auto rounded-full bg-blue-50 dark:bg-blue-950 flex items-center justify-center text-blue-600 dark:text-blue-400">
                <IconFileText size={24} />
              </div>
              <div className="space-y-1">
                <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                  Belum Ada Paket Gambar Teknik untuk Usulan Ini
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Paket gambar teknik dapat dibuka langsung di halaman ini untuk menyusun berkas gambar desain SLD, lampiran teknis, MTO, RAB, dan KKF.
                </p>
              </div>
              {proposal.representative_application_id && isProposalOpen && (
                <Button
                  variant="primary"
                  loading={openingDrawing}
                  onClick={handleOpenDrawing}
                  className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5 shadow-xs"
                >
                  <IconPlus size={14} />
                  <span>+ Buat / Buka Paket Gambar Teknik Usulan</span>
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tab 2: Proposal KKF Panel */}
      {activeTab === 'kkf' && (
        <div className="space-y-4">
          <ProposalKkfPanel
            proposal={proposal}
            canRun={can['kkf.run'] || isSysAdmin}
            canRunRab={can['rab.run'] || isSysAdmin}
            canView={can['kkf.view'] || isSysAdmin}
            lockedReason={bundle.version?.status === 'APPROVED' ? 'Gambar & MTO sudah disetujui seluruhnya, sehingga RAB dan KKF dikunci. Untuk mengubah, revisi paket gambar (versi baru).' : ''}
          />
        </div>
      )}

      {/* Tab: Alokasi Material & Tiang (dibuat di sini, bukan di drawer pratinjau permohonan) */}
      {activeTab === 'alokasi' && canViewAllocations && (
        <div className="space-y-3">
          {bundle.mto?.status !== 'APPROVED' && (
            <Alert variant="info">
              Alokasi material memakai MTO usulan yang sudah disetujui. {bundle.mto ? `Status MTO saat ini: ${bundle.mto.status}.` : 'Paket MTO belum ada.'} Selesaikan persetujuan gambar &amp; MTO terlebih dahulu.
            </Alert>
          )}
          {proposal.representative_application_id ? (
            <ApplicationAllocationPanel
              application={{ id: proposal.representative_application_id }}
              canManageMaterials={canManageMaterials}
              canManagePoles={canManagePoles}
              canView={canViewAllocations}
              createBlockReason={bundle.mto?.status === 'APPROVED' ? '' : 'Paket MTO usulan belum disetujui; alokasi baru bisa dibuat setelah MTO berstatus APPROVED.'}
            />
          ) : (
            <p className="p-6 text-center text-xs text-slate-400">Usulan belum memiliki permohonan perwakilan.</p>
          )}
        </div>
      )}

      {/* Tab 3: Events History */}
      {activeTab === 'history' && (
        <ProposalHistoryTimeline events={proposal.events || []} representativeApplicationId={proposal.representative_application_id} bundle={bundle} />
      )}

      {/* Selectable Modal (Add Members) */}
      {selectableModalOpen && (
        <ProposalSelectableModal
          open={true}
          proposalId={proposal.id}
          proposalNumber={proposal.proposal_number}
          notice={staleKkfNote}
          onClose={() => setSelectableModalOpen(false)}
          onSuccess={() => {
            loadDetail()
            notify({
              type: 'success',
              title: 'Anggota Berhasil Ditambahkan',
              desc: 'Pelanggan berhasil ditambahkan ke dalam usulan kelompok.',
              tag: 'Usulan',
            })
          }}
        />
      )}

      {/* Cancel Proposal Dialog */}
      {cancelModalOpen && (
        <ReasonDialog
          title={`Batalkan Usulan ${proposal.proposal_number}`}
          description={`Pembatalan usulan akan: membatalkan survei yang masih berjalan, mengembalikan gambar yang sedang diproses, dan membebaskan ${(proposal.members || []).length} permohonan anggota agar dapat diproses mandiri atau dimasukkan ke usulan lain. Tindakan ini tidak dapat diurungkan.`}
          confirmLabel="Batalkan Usulan Ini"
          onConfirm={handleConfirmCancel}
          onClose={() => setCancelModalOpen(false)}
          loading={cancelling}
          error={actionError}
        />
      )}

      {/* Remove Member Dialog */}
      {removeTargetMember && (
        <ReasonDialog
          title={`Keluarkan Pelanggan dari Usulan`}
          description={`Keluarkan ${removeTargetMember.customer_name} (${removeTargetMember.application_number}) dari usulan kelompok ini. Permohonan ini akan dapat diproses mandiri atau dimasukkan ke usulan lain.${staleKkfNote ? ` ${staleKkfNote}` : ''}`}
          confirmLabel="Keluarkan dari Usulan"
          onConfirm={handleConfirmRemoveMember}
          onClose={() => setRemoveTargetMember(null)}
          loading={removing}
          error={actionError}
        />
      )}
    </div>
  )
}
