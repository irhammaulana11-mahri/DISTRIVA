import { useState, useEffect, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { bomApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import Modal from '../../components/Modal.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import {
  IconUpload,
  IconCheck,
  IconLayers,
  IconEye,
  IconClock,
  IconExclamation,
  IconTrash,
  IconFileText,
  IconPencil,
  IconAlertCircle,
  IconCheckCircle,
  IconRefresh,
  IconZap,
} from '../../components/icons.jsx'

export const BOM_GROUPS = [
  { code: 'SUTM', name: 'SUTM', label: 'Saluran Udara Tegangan Menengah' },
  { code: 'MVTIC', name: 'MVTIC', label: 'Kabel Pilin Tegangan Menengah' },
  { code: 'SUTR', name: 'SUTR', label: 'Saluran Udara Tegangan Rendah' },
  { code: 'SKTM', name: 'SKTM', label: 'Saluran Kabel Tanah Menengah' },
  { code: 'KUBIKEL', name: 'KUBIKEL', label: 'Kubikel 20 kV' },
  { code: 'GTT_UMUM', name: 'GTT Umum', label: 'Gardu Trafo Tiang (Umum)' },
  { code: 'GTT_KHUSUS', name: 'GTT Khusus', label: 'Gardu Trafo Tiang (Khusus)' },
  { code: 'PBPD_6_41', name: 'APP Pengukuran Langsung', label: 'APP Pengukuran Langsung, pasang baru & perubahan daya (6,6–41,5 kVA)' },
  { code: 'PBPD_53_197', name: 'APP Pengukuran Tak Langsung', label: 'APP Pengukuran Tak Langsung, pasang baru & perubahan daya (53–197 kVA)' },
  { code: 'SR1PH', name: 'APP 1 Phasa', label: 'APP 1 Phasa, pasang baru SDES-1 dan SDES-2' },
]

export default function BomPage() {
  const { can } = useAccess()
  const { user } = useAuth()
  const { notify } = useNotifications()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [boms, setBoms] = useState([])

  // Filters
  const [selectedGroup, setSelectedGroup] = useState('')
  const [selectedStatus, setSelectedStatus] = useState('')

  // Pagination states
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  // Batch selection for Draft approval
  const [selectedDraftIds, setSelectedDraftIds] = useState([])

  // Modals
  const [approveModalOpen, setApproveModalOpen] = useState(false)
  const [approveTargets, setApproveTargets] = useState([]) // array of IDs
  const [approveReason, setApproveReason] = useState('')
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState('')

  // Retire Modal
  const [retireTarget, setRetireTarget] = useState(null)
  const [retireReason, setRetireReason] = useState('')
  const [retiring, setRetiring] = useState(false)
  const [retireError, setRetireError] = useState('')

  // Edit Draft Modal
  const [editDraftTarget, setEditDraftTarget] = useState(null)

  const canManage = Boolean(can['bom.manage'])
  const canApprove = Boolean(can['bom.approve'])

  const loadBoms = async () => {
    setLoading(true)
    setError('')
    try {
      const params = {}
      if (selectedGroup) params.group = selectedGroup
      if (selectedStatus) params.status = selectedStatus
      const res = await bomApi.list(params)
      setBoms(res?.data || [])
    } catch (err) {
      setError(err?.message || 'Gagal memuat daftar BOM.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadBoms()
  }, [selectedGroup, selectedStatus])

  // Pagination calculations
  const pagedBoms = boms.slice((page - 1) * perPage, page * perPage)
  const bomMeta = {
    current_page: page,
    per_page: perPage,
    total: boms.length,
    last_page: Math.max(1, Math.ceil(boms.length / perPage)),
  }

  // Drafts waiting for approval
  const draftBoms = boms.filter((b) => b.status === 'DRAFT')

  // Checkbox toggle
  const toggleSelectDraft = (id) => {
    setSelectedDraftIds((prev) =>
      prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
    )
  }

  const toggleSelectAllDrafts = () => {
    if (selectedDraftIds.length === draftBoms.length) {
      setSelectedDraftIds([])
    } else {
      setSelectedDraftIds(draftBoms.map((d) => d.id).slice(0, 50))
    }
  }

  // Open Approval Dialog
  const handleOpenApprove = (versionIds) => {
    setApproveTargets(versionIds)
    setApproveReason('')
    setApproveError('')
    setApproveModalOpen(true)
  }

  // Submit Approval
  const handleSubmitApprove = async (e) => {
    e.preventDefault()
    if (!approveReason.trim()) {
      setApproveError('Alasan persetujuan wajib diisi.')
      return
    }

    setApproving(true)
    setApproveError('')

    try {
      await bomApi.approve({
        version_ids: approveTargets,
        reason: approveReason.trim(),
      })
      setApproveModalOpen(false)
      setSelectedDraftIds([])
      notify({
        type: 'success',
        title: 'Versi BOM Disetujui',
        desc: `Berhasil menyetujui ${approveTargets.length} versi BOM.`,
        tag: 'Bill of Materials',
      })
      loadBoms()
    } catch (err) {
      // 403 (self-approval, no permission) or 409 (cyclic formula, invalid KHS/construction, etc.)
      setApproveError(err?.message || 'Gagal menyetujui versi BOM.')
    } finally {
      setApproving(false)
    }
  }

  // Open Retire Dialog
  const handleOpenRetire = (bom) => {
    setRetireTarget(bom)
    setRetireReason('')
    setRetireError('')
  }

  // Submit Retire
  const handleSubmitRetire = async (e) => {
    e.preventDefault()
    if (!retireReason.trim()) {
      setRetireError('Alasan penonaktifan wajib diisi.')
      return
    }

    setRetiring(true)
    setRetireError('')

    try {
      await bomApi.retire(retireTarget.id, {
        reason: retireReason.trim(),
      })
      notify({
        type: 'warning',
        title: 'BOM Dinonaktifkan',
        desc: `Versi BOM ${retireTarget.group} v${retireTarget.version_number} dinonaktifkan.`,
        tag: 'Bill of Materials',
      })
      setRetireTarget(null)
      loadBoms()
    } catch (err) {
      setRetireError(err?.message || 'Gagal menonaktifkan versi BOM.')
    } finally {
      setRetiring(false)
    }
  }

  const stats = useMemo(() => {
    const total = boms.length
    const approvedCount = boms.filter((b) => b.status === 'APPROVED').length
    const draftCount = draftBoms.length
    const groupsCount = BOM_GROUPS.length
    return {
      total,
      approvedCount,
      draftCount,
      groupsCount,
    }
  }, [boms, draftBoms])

  return (
    <div className="w-full space-y-6">
      {/* Header Modul BOM Distribusi */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-indigo-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-indigo-600 p-2.5 text-white shadow-xs">
              <IconLayers className="h-6 w-6" />
            </div>
            <div>
              <nav className="text-xs text-slate-500 mb-1">
                <span>DISTRIVA</span>
                <span className="mx-1.5">/</span>
                <span>Master Data</span>
                <span className="mx-1.5">/</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">BOM Distribusi</span>
              </nav>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Bill of Materials (BOM) Distribusi
                </h1>
                <span className="rounded-full bg-indigo-100 dark:bg-indigo-950 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                  Formula MTO / KHS
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                Rumus kebutuhan material dan jasa KHS per kelompok jaringan distribusi dan pekerjaan Pasang Baru / Perubahan Daya (PB/PD).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={IconRefresh}
              onClick={loadBoms}
              aria-label="Segarkan"
            >
              Segarkan
            </Button>
            {canManage && (
              <button
                type="button"
                onClick={() => navigate('/master-data/bom/impor')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-3 py-1.5 text-xs shadow-xs transition focus-ring cursor-pointer"
              >
                <IconUpload size={14} />
                <span>Impor BOM (JSON)</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Ringkasan Metrik BOM */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Versi BOM</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconLayers className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {stats.total.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Versi formula terdaftar</p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">BOM Disetujui</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {stats.approvedCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Formula aktif mengikat RAB</p>
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-amber-700 dark:text-amber-400">Draf Menunggu</dt>
            <div className="rounded-lg p-1.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
              <IconClock className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {stats.draftCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-500/70">Perlu persetujuan UP3</p>
        </div>

        <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/20 dark:bg-indigo-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-indigo-700 dark:text-indigo-400">Kelompok Jaringan</dt>
            <div className="rounded-lg p-1.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
              <IconZap className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400">
            {stats.groupsCount}
          </dd>
          <p className="mt-1 text-xs text-indigo-600/70 dark:text-indigo-500/70">Klasifikasi MTO terdaftar</p>
        </div>
      </dl>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Prominent Banner for Pending Approval DRAFTS */}
      {draftBoms.length > 0 && (
        <div className="w-full p-4 sm:p-5 rounded-2xl border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2.5">
              <span className="p-2 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-700 dark:text-amber-300">
                <IconClock size={18} />
              </span>
              <div>
                <h3 className="text-sm font-bold text-amber-900 dark:text-amber-200">
                  Draf BOM Menunggu Persetujuan ({draftBoms.length})
                </h3>
                <p className="text-xs text-amber-700 dark:text-amber-400">
                  Versi draf memerlukan persetujuan UP3 Manager sebelum aktif diterapkan pada kalkulasi MTO operasional.
                </p>
              </div>
            </div>

            {canApprove && (
              <div className="flex items-center gap-2">
                {selectedDraftIds.length > 0 && (
                  <Button size="sm"
                    type="button"
                    variant="primary"
                    onClick={() => handleOpenApprove(selectedDraftIds)}
                    className="bg-blue-600 hover:bg-blue-700 text-white"
                  >
                    <IconCheck size={16} />
                    <span>Setujui {selectedDraftIds.length} Terpilih</span>
                  </Button>
                )}
                <button
                  type="button"
                  onClick={toggleSelectAllDrafts}
                  className="text-xs text-amber-800 dark:text-amber-300 font-semibold underline underline-offset-2 px-2 py-1"
                >
                  {selectedDraftIds.length === draftBoms.length ? 'Batal Pilih Semua' : 'Pilih Semua Draf'}
                </button>
              </div>
            )}
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3 pt-2">
            {draftBoms.map((d) => {
              const isSelected = selectedDraftIds.includes(d.id)
              const groupMeta = BOM_GROUPS.find((g) => g.code === d.group)
              return (
                <div
                  key={d.id}
                  className={`p-3.5 rounded-xl border bg-white dark:bg-slate-900 transition flex flex-col justify-between gap-3 ${
                    isSelected
                      ? 'border-blue-500 ring-2 ring-blue-500/20'
                      : 'border-amber-200/90 dark:border-amber-900/70'
                  }`}
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {canApprove && (
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleSelectDraft(d.id)}
                            className="rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 cursor-pointer"
                          />
                        )}
                        <span className="font-bold text-slate-800 dark:text-slate-100 text-xs">
                          {groupMeta?.name ?? d.group} <span className="text-amber-600">v{d.version_number}</span>
                        </span>
                      </div>
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-300">
                        Menunggu persetujuan
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1 line-clamp-1">
                      {d.name || d.description || groupMeta?.label}
                    </p>

                    <div className="grid grid-cols-2 gap-2 mt-2.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <div>
                        <span className="text-slate-400 block text-[10px]">Baris Workbook:</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{d.lines_count ?? '-'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Parameter:</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">
                          {Array.isArray(d.parameters) ? d.parameters.length : (d.parameters_count ?? '-')}
                        </span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Mulai Berlaku:</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300">{d.valid_from || '-'}</span>
                      </div>
                      <div>
                        <span className="text-slate-400 block text-[10px]">Pembuat:</span>
                        <span className="font-semibold text-slate-700 dark:text-slate-300 truncate block">
                          {d.created_by ?? '-'}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
                    <Link
                      to={`/master-data/bom/${d.id}`}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 transition"
                    >
                      Detail Draf
                    </Link>
                    <Link
                      to={`/master-data/bom/${d.id}/hitung`}
                      className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 transition"
                    >
                      Uji Hitung
                    </Link>
                    {canApprove && (
                      <button
                        type="button"
                        onClick={() => handleOpenApprove([d.id])}
                        className="px-2.5 py-1 text-xs font-semibold rounded-lg bg-blue-600 hover:bg-blue-700 text-white transition cursor-pointer"
                      >
                        Setujui
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Main Standardized Table Card */}
      <div className="w-full rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {/* Integrated Filter Bar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none pb-1 lg:pb-0">
            <button
              type="button"
              onClick={() => { setSelectedGroup(''); setPage(1); }}
              className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                selectedGroup === ''
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Semua Kelompok ({BOM_GROUPS.length})
            </button>
            {BOM_GROUPS.map((g) => (
              <button
                key={g.code}
                type="button"
                onClick={() => { setSelectedGroup(g.code); setPage(1); }}
                className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  selectedGroup === g.code
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
                }`}
              >
                {g.name}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <label className="text-xs text-slate-500 dark:text-slate-400 font-semibold">Status:</label>
            <select
              aria-label="Filter Status BOM"
              value={selectedStatus}
              onChange={(e) => { setSelectedStatus(e.target.value); setPage(1); }}
              className="text-xs px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus-ring cursor-pointer"
            >
              <option value="">Semua Status</option>
              <option value="APPROVED">Disetujui (Aktif)</option>
              <option value="DRAFT">Draf</option>
              <option value="INACTIVE">Nonaktif</option>
            </select>
          </div>
        </div>

        {/* Table Content */}
        {loading ? (
          <div className="p-12 text-center">
            <Spinner label="Memuat daftar Bill of Materials..." />
          </div>
        ) : boms.length === 0 ? (
          <EmptyState
            icon={IconLayers}
            title="Belum ada versi BOM"
            description="Belum ada versi BOM yang terdaftar. Gunakan tombol &quot;Impor BOM&quot; untuk mengunggah workbook formula per kelompok."
          />
        ) : (
          <>
            <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm data-table">
              <thead className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/60 sticky top-0 z-10">
                <tr>
                  <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    KELOMPOK & VERSI
                  </th>
                  <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    NAMA / JUDUL BOM
                  </th>
                  <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    MASA BERLAKU
                  </th>
                  <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center">
                    BARIS & PARAMETER
                  </th>
                  <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    STATUS
                  </th>
                  <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
                    PENYUSUN & PERSETUJUAN
                  </th>
                  <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-right">
                    AKSI
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {pagedBoms.map((bom) => {
                  const groupMeta = BOM_GROUPS.find((g) => g.code === bom.group)
                  return (
                    <tr
                      key={bom.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-6">
                        <div className="flex items-center gap-2">
                          <span className="inline-block rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-bold text-slate-800 dark:text-slate-200 font-mono">
                            {groupMeta?.name ?? bom.group}
                          </span>
                          <span className="text-xs font-mono font-semibold text-blue-600 dark:text-blue-400">
                            v{bom.version_number}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-6 max-w-xs">
                        <div className="font-semibold text-slate-900 dark:text-slate-100 text-sm">
                          {bom.name || groupMeta?.label || '-'}
                        </div>
                        {bom.source_reference && (
                          <div className="text-xs text-slate-400 truncate mt-0.5">
                            Ref: {bom.source_reference}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-6 font-mono text-xs text-slate-600 dark:text-slate-400">
                        <div>
                          Mulai: <span className="font-semibold text-slate-800 dark:text-slate-200">{bom.valid_from}</span>
                        </div>
                        {bom.valid_until && (
                          <div className="text-[11px] text-slate-400 mt-0.5">
                            S/d: {bom.valid_until}
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-6 text-center">
                        <div className="inline-flex items-center gap-2">
                          <span className="px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs font-mono">
                            {bom.lines_count ?? '-'} baris
                          </span>
                          <span className="px-2.5 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 text-xs font-mono">
                            {Array.isArray(bom.parameters) ? bom.parameters.length : (bom.parameters_count ?? 0)} param
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-6">
                        <StatusBadge status={bom.status} />
                      </td>

                      <td className="py-3.5 px-6 text-xs text-slate-500">
                        {bom.approved_by ? (
                          <div className="space-y-0.5">
                            <span className="text-[10px] uppercase font-bold text-emerald-600 dark:text-emerald-400 block tracking-wider">
                              Disetujui
                            </span>
                            <span className="font-medium text-slate-700 dark:text-slate-300 block truncate max-w-[180px]">
                              {bom.approved_by}
                            </span>
                          </div>
                        ) : (
                          <div className="space-y-0.5">
                            <span className="text-[10px] uppercase font-bold text-slate-400 block tracking-wider">
                              Dibuat Oleh
                            </span>
                            <span className="font-medium text-slate-700 dark:text-slate-300 block truncate max-w-[180px]">
                              {bom.created_by ?? '-'}
                            </span>
                          </div>
                        )}
                      </td>

                      <td className="py-3.5 px-6 text-right">
                        <div className="inline-flex items-center justify-end gap-1.5">
                          <Link
                            to={`/master-data/bom/${bom.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 font-semibold text-xs transition"
                            title="Lihat Detail BOM"
                          >
                            <IconEye size={14} />
                            <span>Detail</span>
                          </Link>

                          <Link
                            to={`/master-data/bom/${bom.id}/hitung`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/60 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-semibold text-xs transition"
                            title="Uji Kalkulasi BOM"
                          >
                            <span>Kalkulator</span>
                          </Link>

                          {bom.status === 'DRAFT' && canManage && (
                            <button
                              type="button"
                              onClick={() => setEditDraftTarget(bom)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition cursor-pointer"
                              title="Ubah Rincian Draf BOM"
                            >
                              <IconPencil size={13} />
                              <span>Ubah</span>
                            </button>
                          )}

                          {bom.status === 'DRAFT' && canApprove && (
                            <button
                              type="button"
                              onClick={() => handleOpenApprove([bom.id])}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-semibold text-xs shadow-xs transition cursor-pointer"
                              title="Setujui Versi Ini"
                            >
                              <IconCheck size={14} />
                              <span>Setujui</span>
                            </button>
                          )}

                          {bom.status === 'APPROVED' && canApprove && (
                            <button
                              type="button"
                              onClick={() => handleOpenRetire(bom)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
                              title="Nonaktifkan Versi Ini"
                            >
                              <IconTrash size={13} />
                              <span>Nonaktifkan</span>
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Standardized Table Pagination Footer */}
          <TableFooter
            meta={bomMeta}
            itemCount={pagedBoms.length}
            total={boms.length}
            entityLabel="versi BOM"
            page={page}
            perPage={perPage}
            onPage={setPage}
            onPerPage={(newPerPage) => {
              setPerPage(newPerPage)
              setPage(1)
            }}
            perPageOptions={[10, 25, 50, 100]}
          />
        </>
        )}
      </div>

      {/* Approval Reason Drawer */}
      <Modal
        open={approveModalOpen}
        onClose={() => setApproveModalOpen(false)}
        title={`Setujui ${approveTargets.length} Versi BOM`}
        size="max-w-md"
      >
        <form onSubmit={handleSubmitApprove} className="space-y-4 text-xs">
          {approveError && <Alert kind="error">{approveError}</Alert>}

          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            Persetujuan versi BOM bersifat final dan akan mengaktifkan rumus untuk perhitungan MTO operasional.
            Versi yang disetujui tidak dapat diubah kembali (immutable).
          </p>

          <div>
            <label className="block font-semibold mb-1 text-slate-800 dark:text-slate-200">
              Alasan Persetujuan <span className="text-rose-500">* (maks 1000 karakter)</span>
            </label>
            <textarea
              rows={3}
              maxLength={1000}
              required
              disabled={approving}
              placeholder="Contoh: Disetujui sesuai telaah teknis dan pembaruan KHS 2026..."
              value={approveReason}
              onChange={(e) => setApproveReason(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setApproveModalOpen(false)}
              disabled={approving}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={approving || !approveReason.trim()}
              className="bg-blue-600 hover:bg-blue-700 text-white"
            >
              {approving ? <Spinner size={14} label="Menyetujui..." /> : 'Setujui Versi BOM'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Retire Drawer */}
      <Modal
        open={Boolean(retireTarget)}
        onClose={() => setRetireTarget(null)}
        title="Nonaktifkan Versi BOM"
        size="max-w-md"
      >
        <form onSubmit={handleSubmitRetire} className="space-y-4 text-xs">
          {retireError && <Alert kind="error">{retireError}</Alert>}

          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300">
            <p className="font-bold">Konfirmasi Penonaktifan BOM</p>
            <p className="text-[11px] mt-1">
              Versi {retireTarget?.group} v{retireTarget?.version_number} akan dinonaktifkan (INACTIVE).
              Kalkulasi baru tidak akan menggunakan versi ini lagi.
            </p>
          </div>

          <div>
            <label className="block font-semibold mb-1 text-slate-800 dark:text-slate-200">
              Alasan Penonaktifan <span className="text-rose-500">*</span>
            </label>
            <textarea
              rows={3}
              maxLength={1000}
              required
              disabled={retiring}
              placeholder="Contoh: Digantikan oleh versi terbaru hasil revisi desain..."
              value={retireReason}
              onChange={(e) => setRetireReason(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRetireTarget(null)}
              disabled={retiring}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="danger"
              disabled={retiring || !retireReason.trim()}
            >
              {retiring ? <Spinner size={14} label="Menonaktifkan..." /> : 'Nonaktifkan Sekarang'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* Edit Draft Modal */}
      {editDraftTarget && (
        <BomEditDraftModal
          open={Boolean(editDraftTarget)}
          target={editDraftTarget}
          onClose={() => setEditDraftTarget(null)}
          onSaved={loadBoms}
        />
      )}
    </div>
  )
}

function BomEditDraftModal({ open, target, onClose, onSaved }) {
  const { notify } = useNotifications()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [validFrom, setValidFrom] = useState('')
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (target) {
      setName(target.name || '')
      setDescription(target.description || '')
      setValidFrom(target.valid_from ? target.valid_from.slice(0, 10) : new Date().toISOString().slice(0, 10))
      setReason('')
      setError('')
    }
  }, [target, open])

  if (!open || !target) return null

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!reason.trim()) {
      setError('Alasan perubahan draf BOM wajib diisi.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await bomApi.updateDraft(target.id, {
        name: name.trim() || undefined,
        description: description.trim() || null,
        valid_from: validFrom || undefined,
        reason: reason.trim(),
      })
      notify({
        type: 'success',
        title: 'Draf BOM Diperbarui',
        desc: `Perubahan draf BOM ${target.group} v${target.version_number} berhasil disimpan.`,
        tag: 'BOM',
      })
      onSaved?.()
      onClose?.()
    } catch (err) {
      setError(err?.message || 'Gagal menyimpan perubahan draf BOM.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`Ubah Draf BOM: ${target.group} v${target.version_number}`}
      subtitle={target.name || 'Formula kebutuhan material & jasa KHS'}
      width="max-w-lg"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Nama / Judul BOM
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Judul formula BOM"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Tanggal Berlaku
          </label>
          <input
            type="date"
            value={validFrom}
            onChange={(e) => setValidFrom(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            required
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Deskripsi / Catatan Perubahan
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            rows={3}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Uraian perubahan formula dan parameter rujukan..."
          />
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Alasan Perubahan <span className="text-rose-500">*</span>
          </label>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Misal: Penyesuaian koefisien tarikan konduktor 2026"
            required
          />
        </div>

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>
            Batal
          </Button>
          <Button type="submit" variant="primary" disabled={saving}>
            {saving ? 'Menyimpan...' : 'Simpan Perubahan'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
