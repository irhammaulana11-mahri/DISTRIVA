import { useState, useEffect } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { bomApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import Drawer from '../../components/Drawer.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { BOM_GROUPS } from './BomPage.jsx'
import {
  IconArrowLeft,
  IconClock,
  IconCheck,
  IconLayers,
  IconFileText,
  IconPencil,
  IconTrash,
  IconCheckCircle,
} from '../../components/icons.jsx'

export default function BomDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAccess()
  const { user } = useAuth()
  const { notify } = useNotifications()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [bom, setBom] = useState(null)

  // Lines
  const [lines, setLines] = useState([])
  const [linesMeta, setLinesMeta] = useState(null)
  const [linesPage, setLinesPage] = useState(1)
  const [linesPerPage, setLinesPerPage] = useState(50)
  const [linesLoading, setLinesLoading] = useState(false)

  // Parameters pagination
  const [paramsPage, setParamsPage] = useState(1)
  const [paramsPerPage, setParamsPerPage] = useState(25)

  // Active Tab
  const [activeTab, setActiveTab] = useState('lines') // 'lines' | 'params' | 'events'

  // Approve dialog
  const [approveOpen, setApproveOpen] = useState(false)
  const [approveReason, setApproveReason] = useState('')
  const [approving, setApproving] = useState(false)
  const [approveError, setApproveError] = useState('')

  // Retire dialog
  const [retireOpen, setRetireOpen] = useState(false)
  const [retireReason, setRetireReason] = useState('')
  const [retiring, setRetiring] = useState(false)
  const [retireError, setRetireError] = useState('')

  // Edit Draft dialog
  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editDescription, setEditDescription] = useState('')
  const [editValidFrom, setEditValidFrom] = useState('')
  const [editReason, setEditReason] = useState('')
  const [editing, setEditing] = useState(false)
  const [editError, setEditError] = useState('')

  const canManage = Boolean(can['bom.manage'])
  const canApprove = Boolean(can['bom.approve'])

  // Load BOM Detail
  const loadBom = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await bomApi.get(id)
      const data = res?.data || null
      setBom(data)
      if (data) {
        setEditName(data.name || '')
        setEditDescription(data.description || '')
        setEditValidFrom(data.valid_from || '')
      }
    } catch (err) {
      setError(err?.message || 'Gagal memuat detail BOM.')
    } finally {
      setLoading(false)
    }
  }

  // Load Lines
  const loadLines = async (page = 1, perPage = linesPerPage) => {
    setLinesLoading(true)
    try {
      const res = await bomApi.lines(id, { page, per_page: perPage })
      setLines(res?.data || [])
      setLinesMeta(res?.meta || null)
      setLinesPage(page)
    } catch (err) {
      // ignore or set error
    } finally {
      setLinesLoading(false)
    }
  }

  useEffect(() => {
    loadBom()
  }, [id])

  useEffect(() => {
    if (bom?.id) {
      loadLines(linesPage, linesPerPage)
    }
  }, [bom?.id, linesPage, linesPerPage])

  // Handle Approve
  const handleApprove = async (e) => {
    e.preventDefault()
    if (!approveReason.trim()) {
      setApproveError('Alasan persetujuan wajib diisi.')
      return
    }

    setApproving(true)
    setApproveError('')

    try {
      await bomApi.approve({
        version_ids: [id],
        reason: approveReason.trim(),
      })
      setApproveOpen(false)
      notify({
        type: 'success',
        title: 'Versi BOM Disetujui',
        desc: `Versi BOM "${bom?.name || bom?.group}" berhasil disetujui.`,
        tag: 'Bill of Materials',
      })
      loadBom()
    } catch (err) {
      setApproveError(err?.message || 'Gagal menyetujui versi BOM.')
    } finally {
      setApproving(false)
    }
  }

  // Handle Retire
  const handleRetire = async (e) => {
    e.preventDefault()
    if (!retireReason.trim()) {
      setRetireError('Alasan penonaktifan wajib diisi.')
      return
    }

    setRetiring(true)
    setRetireError('')

    try {
      await bomApi.retire(id, {
        reason: retireReason.trim(),
      })
      setRetireOpen(false)
      notify({
        type: 'warning',
        title: 'BOM Dinonaktifkan',
        desc: 'Versi BOM berhasil dinonaktifkan.',
        tag: 'Bill of Materials',
      })
      loadBom()
    } catch (err) {
      setRetireError(err?.message || 'Gagal menonaktifkan versi BOM.')
    } finally {
      setRetiring(false)
    }
  }

  // Handle Edit Draft
  const handleEditDraft = async (e) => {
    e.preventDefault()
    if (!editReason.trim()) {
      setEditError('Alasan perubahan wajib diisi.')
      return
    }

    setEditing(true)
    setEditError('')

    try {
      await bomApi.updateDraft(id, {
        name: editName.trim(),
        description: editDescription.trim(),
        valid_from: editValidFrom,
        reason: editReason.trim(),
      })
      setEditOpen(false)
      notify({
        type: 'success',
        title: 'Draf BOM Diperbarui',
        desc: 'Draf BOM berhasil diperbarui.',
        tag: 'Bill of Materials',
      })
      loadBom()
    } catch (err) {
      setEditError(err?.message || 'Gagal memperbarui draf BOM.')
    } finally {
      setEditing(false)
    }
  }

  if (loading) {
    return (
      <div className="p-16 text-center">
        <Spinner label="Memuat detail versi Bill of Materials..." />
      </div>
    )
  }

  if (error || !bom) {
    return (
      <div className="space-y-4">
        <Link
          to="/master-data/bom"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        >
          <IconArrowLeft size={16} />
          <span>Kembali ke Daftar BOM</span>
        </Link>
        <Alert kind="error">{error || 'Data BOM tidak ditemukan.'}</Alert>
      </div>
    )
  }

  const groupMeta = BOM_GROUPS.find((g) => g.code === bom.group)
  const isDraft = bom.status === 'DRAFT'
  const isApproved = bom.status === 'APPROVED'

  return (
    <div className="w-full space-y-6">
      {/* Back button & Breadcrumb */}
      <div className="flex items-center justify-between gap-4">
        <Link
          to="/master-data/bom"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 transition"
        >
          <IconArrowLeft size={16} />
          <span>Kembali ke Daftar BOM</span>
        </Link>

        <div className="flex items-center gap-2">
          <Link
            to={`/master-data/bom/${bom.id}/hitung`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-semibold text-xs transition"
          >
            <IconLayers size={14} />
            <span>Kalkulator & Uji Hitung</span>
          </Link>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Header Info Card */}
      <div className="w-full p-6 sm:p-7 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-5">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div>
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="text-xs font-bold uppercase tracking-wider text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-0.5 rounded-full">
                {groupMeta?.name ?? bom.group}
              </span>
              <span className="text-xs font-mono font-bold text-slate-600 dark:text-slate-400">
                Versi {bom.version_number}
              </span>
              <StatusBadge status={bom.status} />
              {isDraft && (
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-bold bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
                  <IconClock size={12} />
                  <span>Menunggu persetujuan</span>
                </span>
              )}
            </div>

            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-2">
              {bom.name || groupMeta?.label || `BOM ${bom.group} Versi ${bom.version_number}`}
            </h1>

            {bom.description && (
              <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1">
                {bom.description}
              </p>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex items-center gap-2 shrink-0">
            {isDraft && canManage && (
              <Button
                type="button"
                variant="secondary"
                onClick={() => setEditOpen(true)}
                className="text-xs"
              >
                <IconPencil size={14} />
                <span>Ubah Draf</span>
              </Button>
            )}

            {isDraft && canApprove && (
              <Button
                type="button"
                variant="primary"
                onClick={() => {
                  setApproveReason('')
                  setApproveError('')
                  setApproveOpen(true)
                }}
                className="bg-blue-600 hover:bg-blue-700 text-white text-xs"
              >
                <IconCheck size={14} />
                <span>Setujui Versi Ini</span>
              </Button>
            )}

            {isApproved && canApprove && (
              <button
                type="button"
                onClick={() => {
                  setRetireReason('')
                  setRetireError('')
                  setRetireOpen(true)
                }}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
              >
                <IconTrash size={13} />
                <span>Nonaktifkan</span>
              </button>
            )}
          </div>
        </div>

        {/* Metadata Details Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Masa Berlaku</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {bom.valid_from} {bom.valid_until ? `s/d ${bom.valid_until}` : '(Sekarang)'}
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Baris Workbook</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {bom.lines_count ?? linesMeta?.total ?? '-'} baris formula
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">Jumlah Parameter</span>
            <span className="font-semibold text-slate-800 dark:text-slate-200">
              {Array.isArray(bom.parameters) ? bom.parameters.length : 0} parameter
            </span>
          </div>

          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
            <span className="text-[10px] uppercase font-bold text-slate-400 block">
              {bom.approved_by ? 'Disetujui Oleh' : 'Dibuat Oleh'}
            </span>
            <span className="font-semibold text-slate-800 dark:text-slate-200 truncate block" title={bom.approved_by || bom.created_by}>
              {bom.approved_by || bom.created_by || '-'}
            </span>
          </div>
        </div>

        {isApproved && (
          <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-[11px] text-slate-500">
            ℹ️ Versi BOM yang telah disetujui bersifat permanen (immutable). Rumus dan parameter tidak dapat diubah lagi. Untuk pembaruan formula, buat versi baru melalui menu <strong>Impor BOM</strong>.
          </div>
        )}
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-800">
        <nav className="flex space-x-6">
          <button
            type="button"
            onClick={() => setActiveTab('lines')}
            className={`py-3 px-1 text-xs sm:text-sm font-semibold border-b-2 cursor-pointer transition ${
              activeTab === 'lines'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Daftar Baris & Rumus Workbook ({bom.lines_count ?? lines.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('params')}
            className={`py-3 px-1 text-xs sm:text-sm font-semibold border-b-2 cursor-pointer transition ${
              activeTab === 'params'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Parameter BOM ({Array.isArray(bom.parameters) ? bom.parameters.length : 0})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('events')}
            className={`py-3 px-1 text-xs sm:text-sm font-semibold border-b-2 cursor-pointer transition ${
              activeTab === 'events'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            Riwayat Audit ({Array.isArray(bom.events) ? bom.events.length : 0})
          </button>
        </nav>
      </div>

      {/* TAB 1: LINES TABLE */}
      {activeTab === 'lines' && (
        <div className="space-y-4">
          <div className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs overflow-hidden">
            {linesLoading ? (
              <div className="p-12 text-center">
                <Spinner label="Memuat baris rumus BOM..." />
              </div>
            ) : lines.length === 0 ? (
              <EmptyState
                icon={IconLayers}
                title="Belum ada baris formula BOM"
                description="Belum ada baris rumus perhitungan atau item KHS yang dimuat untuk versi BOM ini."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm data-table">
                  <thead className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/60 sticky top-0 z-10">
                    <tr>
                      <th className="py-3.5 px-4 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider text-center w-14">No.</th>
                      <th className="py-3.5 px-4 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider w-48">Kode KHS</th>
                      <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider min-w-[220px]">Uraian KHS / Pekerjaan</th>
                      <th className="py-3.5 px-4 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider min-w-[140px]">Rumus H (Material)</th>
                      <th className="py-3.5 px-4 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider min-w-[140px]">Rumus I (Pasang)</th>
                      <th className="py-3.5 px-4 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider min-w-[140px]">Rumus J (Bongkar)</th>
                      <th className="py-3.5 px-4 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider min-w-[140px]">Rumus K (Retur)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {lines.map((l, idx) => {
                      const hasFormulaB = Boolean(l.formulas?.B)
                      return (
                        <tr
                          key={idx}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors"
                        >
                          <td className="py-3 px-3 text-center font-mono text-slate-400 font-semibold">
                            {l.sequence}
                          </td>

                          <td className="py-3 px-3">
                            {hasFormulaB ? (
                              <div className="space-y-1">
                                <span className="inline-block px-2 py-0.5 rounded text-[10px] font-bold bg-purple-50 dark:bg-purple-950/60 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                                  Kode KHS ditentukan rumus
                                </span>
                                <div className="font-mono text-[11px] text-slate-600 dark:text-slate-300 bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded truncate max-w-[180px]" title={l.formulas.B}>
                                  {l.formulas.B}
                                </div>
                              </div>
                            ) : l.khs_code ? (
                              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                                {l.khs_code}
                              </span>
                            ) : (
                              <span className="text-slate-400 italic">Non-KHS / Header</span>
                            )}
                          </td>

                          <td className="py-3 px-4">
                            <div className="font-medium text-slate-800 dark:text-slate-200">
                              {l.description}
                            </div>
                            {l.source_reference && (
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                Ref: {l.source_reference}
                              </div>
                            )}
                          </td>

                          <td className="py-3 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                            {l.formulas?.H ? (
                              <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                {l.formulas.H}
                              </span>
                            ) : '-'}
                          </td>

                          <td className="py-3 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                            {l.formulas?.I ? (
                              <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                {l.formulas.I}
                              </span>
                            ) : '-'}
                          </td>

                          <td className="py-3 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                            {l.formulas?.J ? (
                              <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                {l.formulas.J}
                              </span>
                            ) : '-'}
                          </td>

                          <td className="py-3 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                            {l.formulas?.K ? (
                              <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded">
                                {l.formulas.K}
                              </span>
                            ) : '-'}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Standardized Table Footer */}
          <TableFooter
            meta={linesMeta}
            itemCount={lines.length}
            total={linesMeta?.total ?? lines.length}
            entityLabel="baris formula BOM"
            page={linesPage}
            perPage={linesPerPage}
            onPage={(p) => setLinesPage(p)}
            onPerPage={(newPerPage) => {
              setLinesPerPage(newPerPage)
              setLinesPage(1)
            }}
            perPageOptions={[10, 25, 50, 100]}
          />
        </div>
      )}

      {/* TAB 2: PARAMETERS TABLE */}
      {activeTab === 'params' && (
        <div className="w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs overflow-hidden">
          {(!bom.parameters || bom.parameters.length === 0) ? (
            <EmptyState
              icon={IconLayers}
              title="Belum ada parameter BOM"
              description="Tidak ada parameter khusus yang dideklarasikan pada versi BOM ini."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm data-table">
                <thead className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/75 dark:bg-slate-800/60 sticky top-0 z-10">
                  <tr>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Nama Parameter</th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Sel Workbook</th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Tipe Data</th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Pilihan Opsi</th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Nilai Default</th>
                    <th className="py-3.5 px-6 text-[11px] font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">Deskripsi / Kegunaan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {(bom.parameters || [])
                    .slice((paramsPage - 1) * paramsPerPage, paramsPage * paramsPerPage)
                    .map((p, idx) => {
                    const isText = (p.type ?? 'number') === 'text'
                    return (
                      <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50">
                        <td className="py-3.5 px-4 font-mono font-bold text-blue-600 dark:text-blue-400">
                          {p.name}
                        </td>
                        <td className="py-3.5 px-4 font-mono text-slate-500">
                          {p.cell || '-'}
                        </td>
                        <td className="py-3.5 px-4">
                          <span className={`inline-flex px-2 py-0.5 rounded text-[10px] font-bold ${
                            isText
                              ? 'bg-purple-50 dark:bg-purple-950/50 text-purple-700 dark:text-purple-300'
                              : 'bg-emerald-50 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-300'
                          }`}>
                            {isText ? 'Teks (Pilihan)' : 'Angka (≥ 0)'}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 max-w-xs">
                          {isText && Array.isArray(p.options) && p.options.length > 0 ? (
                            <div className="flex flex-wrap gap-1">
                              {p.options.map((opt, oIdx) => (
                                <span
                                  key={oIdx}
                                  className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[10px] font-medium"
                                >
                                  {opt}
                                </span>
                              ))}
                            </div>
                          ) : (
                            <span className="text-slate-400 text-[11px]">-</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 font-mono font-semibold text-slate-700 dark:text-slate-300">
                          {p.default !== undefined && p.default !== null && p.default !== '' ? String(p.default) : '-'}
                        </td>
                        <td className="py-3.5 px-4 text-slate-600 dark:text-slate-400 text-[11px]">
                          {p.description || '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          <TableFooter
            itemCount={(bom.parameters || []).slice((paramsPage - 1) * paramsPerPage, paramsPage * paramsPerPage).length}
            total={bom.parameters?.length || 0}
            entityLabel="parameter formula"
            page={paramsPage}
            perPage={paramsPerPage}
            onPage={setParamsPage}
            onPerPage={(n) => {
              setParamsPerPage(n)
              setParamsPage(1)
            }}
            perPageOptions={[10, 25, 50, 100]}
          />
        </div>
      )}

      {/* TAB 3: AUDIT TRAIL EVENTS */}
      {activeTab === 'events' && (
        <div className="w-full p-6 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs space-y-4">
          {(!bom.events || bom.events.length === 0) ? (
            <p className="text-center text-slate-400 text-xs py-8">Belum ada riwayat aktivitas.</p>
          ) : (
            <div className="relative pl-6 space-y-6 before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-800">
              {bom.events.map((evt, idx) => (
                <div key={idx} className="relative">
                  <div className="absolute -left-[27px] top-1.5 w-3 h-3 rounded-full bg-blue-600 border-2 border-white dark:border-slate-900" />
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800 dark:text-slate-200">
                        {evt.event_type}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {evt.occurred_at ? new Date(evt.occurred_at).toLocaleString('id-ID') : '-'}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500">
                      Oleh: <span className="font-semibold text-slate-700 dark:text-slate-300">{evt.actor_email || '-'}</span>
                    </div>
                    {evt.reason && (
                      <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 text-[11px] text-slate-700 dark:text-slate-300">
                        "{evt.reason}"
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* APPROVE DRAWER */}
      <Drawer
        open={approveOpen}
        onClose={() => setApproveOpen(false)}
        title={`Setujui Versi BOM ${bom.group} v${bom.version_number}`}
        size="max-w-md"
      >
        <form onSubmit={handleApprove} className="space-y-4 text-xs">
          {approveError && <Alert kind="error">{approveError}</Alert>}

          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            Persetujuan versi BOM bersifat final dan akan mengaktifkan rumus untuk kalkulasi MTO pekerjaan distribusi.
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
              placeholder="Contoh: Disetujui setelah diverifikasi kesesuaian formula dan KHS..."
              value={approveReason}
              onChange={(e) => setApproveReason(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setApproveOpen(false)}
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
              {approving ? <Spinner size={14} label="Menyetujui..." /> : 'Setujui Versi Ini'}
            </Button>
          </div>
        </form>
      </Drawer>

      {/* RETIRE DRAWER */}
      <Drawer
        open={retireOpen}
        onClose={() => setRetireOpen(false)}
        title="Nonaktifkan Versi BOM"
        size="max-w-md"
      >
        <form onSubmit={handleRetire} className="space-y-4 text-xs">
          {retireError && <Alert kind="error">{retireError}</Alert>}

          <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300">
            <p className="font-bold">Konfirmasi Penonaktifan BOM</p>
            <p className="text-[11px] mt-1">
              Versi {bom.group} v{bom.version_number} akan dinonaktifkan (INACTIVE).
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
              placeholder="Contoh: Digantikan oleh pembaruan versi berikutnya..."
              value={retireReason}
              onChange={(e) => setRetireReason(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setRetireOpen(false)}
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
      </Drawer>

      {/* EDIT DRAFT DRAWER */}
      <Drawer
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Ubah Informasi Draf BOM"
        size="max-w-md"
      >
        <form onSubmit={handleEditDraft} className="space-y-4 text-xs">
          {editError && <Alert kind="error">{editError}</Alert>}

          <div>
            <label className="block font-semibold mb-1 text-slate-800 dark:text-slate-200">
              Nama / Judul BOM
            </label>
            <input
              type="text"
              maxLength={150}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              disabled={editing}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1 text-slate-800 dark:text-slate-200">
              Deskripsi
            </label>
            <textarea
              rows={2}
              maxLength={2000}
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              disabled={editing}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1 text-slate-800 dark:text-slate-200">
              Tanggal Mulai Berlaku (Valid From)
            </label>
            <input
              type="date"
              value={editValidFrom}
              onChange={(e) => setEditValidFrom(e.target.value)}
              disabled={editing}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>

          <div>
            <label className="block font-semibold mb-1 text-slate-800 dark:text-slate-200">
              Alasan Perubahan <span className="text-rose-500">* (maks 1000 karakter)</span>
            </label>
            <textarea
              rows={2}
              maxLength={1000}
              required
              disabled={editing}
              placeholder="Contoh: Koreksi penamaan judul dan penyesuaian tanggal berlaku..."
              value={editReason}
              onChange={(e) => setEditReason(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>

          <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setEditOpen(false)}
              disabled={editing}
            >
              Batal
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={editing || !editReason.trim()}
            >
              {editing ? <Spinner size={14} label="Menyimpan..." /> : 'Simpan Perubahan Draf'}
            </Button>
          </div>
        </form>
      </Drawer>
    </div>
  )
}
