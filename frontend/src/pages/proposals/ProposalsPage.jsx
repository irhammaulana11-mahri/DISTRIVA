import { useState, useEffect, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { proposalsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import ProposalSelectableModal from './ProposalSelectableModal.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import {
  IconUsers,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconEye,
  IconArrowRight,
  IconFileText,
  IconUser,
  IconBuilding,
  IconZap,
  IconCheckCircle,
} from '../../components/icons.jsx'
import { filterSelectCls, filterSearchCls } from '../../components/filterStyles.js'

/**
 * ProposalsPage (docs/62 §37, docs/76 & docs/57)
 * Halaman Daftar Usulan Banyak Pelanggan (3 Fasa).
 * 
 * Aturan Utama:
 * Sebelum tombol "Buat Usulan" ditekan, TIDAK ADA tabel data pelanggan yang ditampilkan di layar.
 * Tabel pelanggan hanya dimuat dari GET /proposals/selectable di dalam layar/modal pemilihan.
 */
export default function ProposalsPage() {
  const navigate = useNavigate()
  const { can, isSysAdmin } = useAccess()
  const { notify } = useNotifications()

  const [loading, setLoading] = useState(true)
  const [proposals, setProposals] = useState([])
  const [error, setError] = useState('')

  // Search & Filter State
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  // Create Proposal Modal State
  const [createModalOpen, setCreateModalOpen] = useState(false)

  // Load Proposals
  const loadProposals = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await proposalsApi.list({ issued: 1 })
      setProposals(res?.data || [])
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Gagal memuat daftar usulan.')
      setProposals([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadProposals()
  }, [loadProposals])

  const canManage = Boolean(can['proposals.manage'] || isSysAdmin)

  // Filtered proposals
  const filteredProposals = proposals.filter((p) => {
    if (statusFilter && p.status !== statusFilter) return false
    if (search.trim()) {
      const q = search.toLowerCase()
      const matchNum = p.proposal_number?.toLowerCase().includes(q)
      const matchTitle = p.title?.toLowerCase().includes(q)
      const matchRep = p.representative_number?.toLowerCase().includes(q)
      const matchUlp = p.ulp_name?.toLowerCase().includes(q)
      if (!matchNum && !matchTitle && !matchRep && !matchUlp) return false
    }
    return true
  })

  // KPI Summary Stats
  const stats = useMemo(() => {
    const list = proposals || []
    return {
      total: list.length,
      active: list.filter((p) => p.status === 'OPEN').length,
      noExtension: list.filter((p) => p.status === 'COMPLETED_NO_EXTENSION').length,
      totalCustomers: list.reduce((sum, p) => sum + (Number(p.members_count) || 1), 0),
    }
  }, [proposals])

  return (
    <div className="space-y-6">
      {/* Header Modul Usulan Perluasan */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
              <IconUsers className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Usulan Perluasan
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  3 Fasa &amp; Kolektif
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                Satu atau beberapa pelanggan dikaji dalam satu proses: survei, gambar, MTO, RAB, alokasi, SPK, dan KKF gabungan.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={loadProposals}
              icon={IconRefresh}
              aria-label="Segarkan"
            >
              Segarkan
            </Button>

            {canManage && (
              <Button
                type="button"
                variant="primary"
                size="sm"
                onClick={() => setCreateModalOpen(true)}
                aria-label="Buat Usulan Baru (Usulan Perluasan)"
                className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1.5 shadow-xs"
              >
                <IconPlus size={14} />
                <span>Buat Usulan Perluasan</span>
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Ringkasan Metrik Usulan Perluasan */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Usulan</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconUsers className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {stats.total}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Berkas usulan terbit</p>
        </div>

        <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-blue-700 dark:text-blue-400">Usulan Aktif (OPEN)</dt>
            <div className="rounded-lg p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <IconZap className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {stats.active}
          </dd>
          <p className="mt-1 text-xs text-blue-600/70 dark:text-blue-500/70">Dalam siklus konstruksi/KKF</p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Tanpa Perluasan</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {stats.noExtension}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Selesai tanpa perluasan</p>
        </div>

        <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/20 dark:bg-indigo-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-indigo-700 dark:text-indigo-400">Pelanggan Terkait</dt>
            <div className="rounded-lg p-1.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
              <IconBuilding className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-indigo-600 dark:text-indigo-400">
            {stats.totalCustomers}
          </dd>
          <p className="mt-1 text-xs text-indigo-600/70 dark:text-indigo-500/70">Total pemohon dalam usulan</p>
        </div>
      </dl>

      {error && (
        <Alert variant="danger">
          {error}
        </Alert>
      )}

      {/* Filter & Bar Pencarian */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xs">
        <div className="relative flex-1">
          <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
            <IconSearch size={14} />
          </span>
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari nomor usulan, judul, permohonan utama, atau ULP..."
            className={`${filterSearchCls} w-full`}
          />
        </div>

        <div className="flex items-center gap-2">
          <label htmlFor="filter-status-usulan" className="text-xs font-medium text-slate-500 dark:text-slate-400 shrink-0">
            Status:
          </label>
          <select
            id="filter-status-usulan"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className={filterSelectCls}
          >
            <option value="">Semua Status</option>
            <option value="OPEN">Aktif (OPEN)</option>
            <option value="COMPLETED_NO_EXTENSION">Selesai tanpa perluasan</option>
            <option value="CANCELLED">Dibatalkan (CANCELLED)</option>
          </select>
        </div>
      </div>

      {/* Tabel Usulan Pelanggan */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden bg-white dark:bg-slate-900 shadow-xs">
        {loading ? (
          <div className="py-16 text-center text-slate-400">
            <div className="flex flex-col items-center justify-center gap-2">
              <Spinner size="md" />
              <span className="text-xs">Memuat daftar usulan pelanggan...</span>
            </div>
          </div>
        ) : filteredProposals.length === 0 ? (
          <EmptyState
            icon={IconUsers}
            title={search || statusFilter ? 'Tidak ada usulan yang sesuai' : 'Belum ada usulan banyak pelanggan'}
            description={
              search || statusFilter
                ? 'Tidak ada usulan yang sesuai dengan filter pencarian atau status yang dipilih.'
                : 'Belum ada usulan banyak pelanggan yang dibuat. Klik tombol "Buat Usulan Perluasan" di atas untuk memilih pelanggan 3 fasa dan membentuk usulan kelompok.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-3.5">Nomor Usulan</th>
                  <th className="py-3 px-3.5">Judul Usulan</th>
                  <th className="py-3 px-3.5">ULP</th>
                  <th className="py-3 px-3.5">Permohonan Perwakilan</th>
                  <th className="py-3 px-3.5 text-center">Anggota</th>
                  <th className="py-3 px-3.5 text-center">Status</th>
                  <th className="py-3 px-3.5">Tanggal Dibuat</th>
                  <th className="py-3 px-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-sans">
                {filteredProposals
                  .slice((page - 1) * perPage, page * perPage)
                  .map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-3.5 font-mono font-bold text-blue-700 dark:text-blue-400">
                      <Link to={`/usulan/${p.id}`} className="hover:underline">
                        {p.proposal_number}
                      </Link>
                    </td>
                    <td className="py-3 px-3.5 font-medium text-slate-900 dark:text-slate-100 max-w-xs truncate" title={p.title}>
                      {p.title || '-'}
                    </td>
                    <td className="py-3 px-3.5 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                      {p.ulp_name || '-'}
                    </td>
                    <td className="py-3 px-3.5 font-mono text-slate-800 dark:text-slate-200">
                      {p.representative_number || '-'}
                    </td>
                    <td className="py-3 px-3.5 text-center font-bold text-blue-600 dark:text-blue-400 font-mono">
                      <span className="inline-flex items-center justify-center rounded-full bg-blue-50 dark:bg-blue-950 px-2 py-0.5 text-xs">
                        {p.members_count}
                      </span>
                    </td>
                    <td className="py-3 px-3.5 text-center">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="py-3 px-3.5 text-slate-500 text-[11px]">
                      {p.created_at?.slice(0, 10)}
                    </td>
                    <td className="py-3 px-3.5 text-right">
                      <div className="flex items-center justify-end gap-1.5">
                        <Button
                          size="xs"
                          variant="secondary"
                          onClick={() => navigate(`/usulan/${p.id}`)}
                          className="inline-flex items-center gap-1"
                        >
                          <IconEye size={12} />
                          <span>Buka Usulan</span>
                        </Button>

                        {p.status === 'OPEN' && p.representative_application_id && (
                          <Button
                            size="xs"
                            variant="primary"
                            onClick={() => navigate(`/usulan/${p.id}?tab=drawings`)}
                            className="bg-blue-600 hover:bg-blue-700 text-white inline-flex items-center gap-1"
                            title="Lanjutkan ke Alur Teknis (Gambar Usulan)"
                          >
                            <span>Gambar &amp; MTO</span>
                            <IconArrowRight size={11} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <TableFooter
          itemCount={filteredProposals.slice((page - 1) * perPage, page * perPage).length}
          total={filteredProposals.length}
          entityLabel="usulan kelompok"
          page={page}
          perPage={perPage}
          onPage={setPage}
          onPerPage={(n) => {
            setPerPage(n)
            setPage(1)
          }}
          perPageOptions={[10, 25, 50, 100]}
        />
      </div>

      {/* Modal Pemilihan Pelanggan Usulan (Hanya terbuka saat diminta) */}
      {createModalOpen && (
        <ProposalSelectableModal
          open={true}
          onClose={() => setCreateModalOpen(false)}
          onSuccess={() => {
            loadProposals()
            notify({
              type: 'success',
              title: 'Usulan Berhasil Dibuat',
              desc: 'Usulan kelompok baru berhasil disimpan dengan pelanggan utama terpilih.',
              tag: 'Usulan',
            })
          }}
        />
      )}
    </div>
  )
}
