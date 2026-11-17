import { useCallback, useEffect, useState, useRef } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { adminApi } from '../../services/api.js'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Spinner from '../../components/Spinner.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import Drawer from '../../components/Drawer.jsx'
import ConfirmationModal from '../../components/ConfirmationModal.jsx'
import {
  IconPlus,
  IconUsers,
  IconSearch,
  IconEye,
  IconPencil,
  IconPower,
  IconTrash,
  IconShield,
  IconUser,
  IconKey,
  IconArrowRight,
  IconCheck,
  IconRefresh,
  IconCheckCircle,
  IconAlertCircle,
  IconClock,
} from '../../components/icons.jsx'
import { filterSelectCls, filterSearchCls } from '../../components/filterStyles.js'

// Helper to render user roles cleanly as badges
function renderUserRoles(u) {
  let rolesList = []
  if (Array.isArray(u.roles) && u.roles.length > 0) {
    rolesList = u.roles.map((r) => (typeof r === 'object' ? r : { role: r }))
  } else if (Array.isArray(u.role_names) && u.role_names.length > 0) {
    rolesList = u.role_names.map((name) => ({ role: name }))
  } else if (u.role) {
    rolesList = [{ role: u.role }]
  }

  if (rolesList.length === 0) {
    return <span className="text-slate-400 dark:text-slate-500 text-xs italic">—</span>
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {rolesList.map((item, idx) => {
        const roleName = item.role || item.name || 'PENGGUNA'
        const isSysAdmin = roleName === 'SYS_ADMIN'
        const isManager = roleName.includes('MANAGER')
        const badgeColor = isSysAdmin
          ? 'bg-purple-50 text-purple-700 dark:bg-purple-950/40 dark:text-purple-300 border-purple-200/80 dark:border-purple-800/60'
          : isManager
          ? 'bg-amber-50 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300 border-amber-200/80 dark:border-amber-800/60'
          : 'bg-blue-50 text-blue-700 dark:bg-blue-950/40 dark:text-blue-300 border-blue-200/80 dark:border-blue-800/60'

        return (
          <span
            key={idx}
            className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-semibold border ${badgeColor}`}
          >
            <span>{roleName}</span>
            {item.unit_code && (
              <span className="text-[10px] opacity-75 font-mono">({item.unit_code})</span>
            )}
          </span>
        )
      })}
    </div>
  )
}

export default function UsersPage() {
  const navigate = useNavigate()
  const { canWrite, isSysAdmin } = useAccess()
  const { notify } = useNotifications()
  const searchInputRef = useRef(null)

  // Filters & Pagination State
  const [filters, setFilters] = useState({ search: '', status: '' })
  const [applied, setApplied] = useState({ search: '', status: '' })
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })

  // Drawer & Modal Target States
  const [previewTarget, setPreviewTarget] = useState(null)
  const [deactivateTarget, setDeactivateTarget] = useState(null)

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    adminApi.users({ ...applied, page, per_page: perPage })
      .then((d) => setState({ loading: false, error: '', rows: d.data ?? [], meta: d.meta }))
      .catch((e) => setState({ loading: false, error: e.message, rows: [], meta: null }))
  }, [applied, page, perPage])

  useEffect(load, [load])

  // Keyboard shortcut: Press "/" to focus search box
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === '/' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
        e.preventDefault()
        searchInputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])

  function onSubmit(e) {
    e.preventDefault()
    setPage(1)
    setApplied(filters)
  }

  function handleReset() {
    setFilters({ search: '', status: '' })
    setApplied({ search: '', status: '' })
    setPage(1)
  }

  // Handle Deactivation (for users linked to data)
  const handleConfirmDeactivate = async (reason) => {
    if (!deactivateTarget) return
    const target = deactivateTarget
    await adminApi.changeStatus(target.id, 'INACTIVE', reason)
    notify({
      type: 'warning',
      title: 'Akun Pengguna Dinonaktifkan',
      desc: `Akun ${target.name} (${target.email}) berhasil dinonaktifkan sesuai audit trail.`,
      tag: 'Pengguna',
    })
    setDeactivateTarget(null)
    load()
  }

  // KPI Calculations
  const totalUsers = state.meta?.total ?? state.rows.length
  const activeCount = state.rows.filter((u) => u.account_status === 'ACTIVE').length
  const pendingCount = state.rows.filter((u) => u.account_status === 'PENDING_ACTIVATION').length
  const inactiveCount = state.rows.filter((u) => ['SUSPENDED', 'INACTIVE'].includes(u.account_status)).length

  return (
    <div className="space-y-6">
      {/* Hero Banner Header */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 p-6 sm:p-8 text-white shadow-xl border border-slate-800">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2 text-xs font-semibold tracking-wider uppercase text-blue-300">
              <span>DISTRIVA</span>
              <span className="opacity-40">/</span>
              <span>ADMINISTRASI</span>
              <span className="opacity-40">/</span>
              <span className="text-white">PENGGUNA</span>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-md text-white border border-white/20 shadow-inner">
                <IconUsers size={24} />
              </div>
              <div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-white">
                  Pengguna &amp; Akses Otoritas
                </h1>
                <p className="text-xs sm:text-sm text-blue-200/80 max-w-2xl mt-0.5">
                  Pengelolaan akun pengguna terdaftar, status aktivasi OTP, hierarki penugasan peran jabatan, dan audit boundary keamanan SAME_UNIT.
                </p>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <div className="inline-flex items-center gap-2 rounded-xl bg-white/10 backdrop-blur-md px-3.5 py-2 text-xs text-blue-200 border border-white/10 shadow-xs">
              <IconShield size={14} className="text-blue-300" />
              <span>Scope: <strong className="text-white font-semibold">{isSysAdmin ? 'GLOBAL' : 'SAME_UNIT'}</strong></span>
            </div>

            <button
              type="button"
              onClick={load}
              disabled={state.loading}
              title="Segarkan daftar pengguna"
              className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 active:bg-white/30 text-white px-3 py-1.5 text-xs font-semibold transition border border-white/15 cursor-pointer disabled:opacity-50"
            >
              <IconRefresh size={15} className={state.loading ? 'animate-spin' : ''} />
              <span className="hidden sm:inline">Segarkan</span>
            </button>

            {canWrite['users.create'] && (
              <Link
                to="/admin/users/new"
                className="inline-flex items-center gap-2 rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold px-3 py-1.5 text-xs shadow-md transition cursor-pointer"
              >
                <IconPlus size={16} />
                <span>Tambah pengguna</span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* KPI Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Total Pengguna</span>
            <div className="p-2 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
              <IconUsers size={18} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {totalUsers}
          </div>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Akun terdaftar dalam sistem</span>
        </div>

        <div className="p-4 rounded-2xl border border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/30 dark:bg-emerald-950/20 shadow-xs">
          <div className="flex items-center justify-between text-emerald-600 dark:text-emerald-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Akun Aktif</span>
            <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle size={18} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-emerald-700 dark:text-emerald-300">
            {activeCount}
          </div>
          <span className="text-[11px] text-emerald-600/80 dark:text-emerald-400/80 mt-0.5 block">Dapat login dan bertransaksi</span>
        </div>

        <div className="p-4 rounded-2xl border border-amber-200/80 dark:border-amber-900/60 bg-amber-50/30 dark:bg-amber-950/20 shadow-xs">
          <div className="flex items-center justify-between text-amber-600 dark:text-amber-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Menunggu Aktivasi</span>
            <div className="p-2 rounded-xl bg-amber-100 dark:bg-amber-900/60 text-amber-600 dark:text-amber-400">
              <IconClock size={18} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-amber-700 dark:text-amber-300">
            {pendingCount}
          </div>
          <span className="text-[11px] text-amber-600/80 dark:text-amber-400/80 mt-0.5 block">Undangan aktivasi dikirimkan</span>
        </div>

        <div className="p-4 rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-semibold uppercase tracking-wider">Nonaktif / Suspend</span>
            <div className="p-2 rounded-xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400">
              <IconAlertCircle size={18} />
            </div>
          </div>
          <div className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {inactiveCount}
          </div>
          <span className="text-[11px] text-slate-400 mt-0.5 block">Akses dicabut sementara</span>
        </div>
      </div>

      {/* Main Standardized Table Card */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {/* Filter Toolbar */}
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800/80">
          <form onSubmit={onSubmit} className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
            {/* Search Input with Icon */}
            <div className="relative flex-1">
              <label htmlFor="search" className="sr-only">
                Cari nama / email
              </label>
              <span className="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400 dark:text-slate-500">
                <IconSearch size={16} />
              </span>
              <input
                id="search"
                ref={searchInputRef}
                value={filters.search}
                onChange={(e) => setFilters({ ...filters, search: e.target.value })}
                placeholder="Cari nama atau email…"
                className={`${filterSearchCls} w-full`}
              />
              <span className="absolute inset-y-0 right-0 pr-3 flex items-center pointer-events-none">
                <span className="hidden sm:inline-block text-[10px] font-mono text-slate-400 dark:text-slate-500 bg-slate-200/60 dark:bg-slate-700/60 px-1.5 py-0.5 rounded">
                  /
                </span>
              </span>
            </div>

            {/* Status Select Filter */}
            <div className="min-w-[170px]">
              <label htmlFor="status" className="sr-only">
                Status
              </label>
              <select
                id="status"
                value={filters.status}
                onChange={(e) => setFilters({ ...filters, status: e.target.value })}
                className={`${filterSelectCls} w-full`}
              >
                <option value="">Semua status</option>
                <option value="ACTIVE">Aktif</option>
                <option value="PENDING_ACTIVATION">Menunggu aktivasi</option>
                <option value="SUSPENDED">Ditangguhkan</option>
                <option value="INACTIVE">Nonaktif</option>
              </select>
            </div>

            {/* Filter Buttons */}
            <div className="flex items-center gap-2 shrink-0">
              {(filters.search || filters.status || applied.search || applied.status) && (
                <button
                  type="button"
                  onClick={handleReset}
                  className="rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 px-3 py-2 text-xs sm:text-sm font-semibold transition cursor-pointer"
                >
                  Reset
                </button>
              )}
              <button
                type="submit"
                className="rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white px-4 py-2 text-xs sm:text-sm font-semibold shadow-xs transition focus-ring cursor-pointer"
              >
                Terapkan
              </button>
            </div>
          </form>
        </div>

        {/* Content States & Table */}
        <div>
          {state.error && (
            <div className="p-5">
              <Alert>{state.error}</Alert>
            </div>
          )}
          {state.loading && (
            <div className="p-8">
              <Spinner />
            </div>
          )}

          {!state.loading && !state.error && state.rows.length === 0 && (
            <EmptyState
              icon={IconUsers}
              title="Belum ada pengguna"
              description="Tidak ada pengguna pada cakupan Anda. Coba sesuaikan kata kunci pencarian atau filter status akun."
            />
          )}

          {!state.loading && state.rows.length > 0 && (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm data-table">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-slate-800">
                    <th className="py-3 px-6 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-transparent">
                      PENGGUNA / NAMA ↑
                    </th>
                    <th className="py-3 px-6 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-transparent">
                      EMAIL
                    </th>
                    <th className="py-3 px-6 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-transparent">
                      NO HP
                    </th>
                    <th className="py-3 px-6 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-transparent">
                      ROLE
                    </th>
                    <th className="py-3 px-6 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-transparent">
                      STATUS ↕
                    </th>
                    <th className="py-3 px-6 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-transparent text-right">
                      AKSI
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {state.rows.map((u) => {
                    return (
                      <tr key={u.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                        <td className="py-3.5 px-6 font-medium text-slate-900 dark:text-slate-100">
                          <div className="flex items-center gap-3">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-bold text-xs shadow-xs">
                              {u.name ? u.name.charAt(0).toUpperCase() : 'U'}
                            </div>
                            <div>
                              <Link
                                className="font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                                to={`/admin/users/${u.id}`}
                              >
                                {u.name}
                              </Link>
                              {u.position && (
                                <span className="block text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">{u.position}</span>
                              )}
                              {u.nip && (
                                <span className="block text-[11px] font-mono text-slate-400 dark:text-slate-500 mt-0.5">
                                  NIP: {u.nip}
                                </span>
                              )}
                            </div>
                          </div>
                        </td>
                        <td className="py-3.5 px-6 text-slate-600 dark:text-slate-400 font-mono text-xs">
                          {u.email}
                        </td>
                        <td className="py-3.5 px-6 font-mono text-xs text-slate-600 dark:text-slate-300">
                          {u.phone ? (
                            <span>{u.phone}</span>
                          ) : (
                            <span className="text-slate-400 dark:text-slate-500 font-sans italic">—</span>
                          )}
                        </td>
                        <td className="py-3.5 px-6">
                          {renderUserRoles(u)}
                        </td>
                        <td className="py-3.5 px-6">
                          <StatusBadge status={u.account_status} />
                        </td>
                        <td className="py-3.5 px-6 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            {/* 1. Preview Action (IconEye -> Preview Drawer) */}
                            <button
                              type="button"
                              onClick={() => setPreviewTarget(u)}
                              aria-label={`Preview ${u.name}`}
                              title={`Preview detail pengguna ${u.name}`}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200 text-xs transition-colors cursor-pointer"
                            >
                              <IconEye size={13} />
                              <span>Detail</span>
                            </button>

                            {/* 2. Edit Action (IconPencil -> Edit Drawer) */}
                            {canWrite['users.change_status'] && (
                              <button
                                type="button"
                                onClick={() => navigate(`/admin/users/${u.id}`)}
                                aria-label={`Ubah ${u.name}`}
                                title={`Ubah data profil pengguna ${u.name}`}
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200 text-xs transition-colors cursor-pointer"
                              >
                                <IconPencil size={13} />
                                <span>Ubah</span>
                              </button>
                            )}

                            {/* 3. Nonaktifkan (akun tidak pernah dihapus fisik: riwayat audit append-only, O-030 & doc 54) */}
                            {canWrite['users.change_status'] && u.account_status !== 'INACTIVE' && (
                              <button
                                type="button"
                                onClick={() => setDeactivateTarget(u)}
                                aria-label={`Nonaktifkan ${u.name}`}
                                title="Nonaktifkan akun"
                                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
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
          )}

          {/* Standardized Table Pagination Footer */}
          {state.meta && (
            <TableFooter
              itemCount={state.rows.length}
              total={state.meta.total}
              entityLabel="pengguna"
              meta={state.meta}
              page={page}
              perPage={perPage}
              onPage={setPage}
              onPerPage={(newPerPage) => {
                setPerPage(newPerPage)
                setPage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          )}
        </div>
      </div>

      {/* ----------------------------------------------------------------------------------------- */}
      {/* DRAWERS: TAMBAH, PREVIEW, & EDIT PENGGUNA                                                 */}
      {/* ----------------------------------------------------------------------------------------- */}

      {/* 2. Drawer Preview Pengguna */}
      {previewTarget && (
        <UserPreviewDrawer
          user={previewTarget}
          onClose={() => setPreviewTarget(null)}
          onEdit={(u) => {
            setPreviewTarget(null)
            navigate(`/admin/users/${u.id}`)
          }}
        />
      )}

      {/* ----------------------------------------------------------------------------------------- */}
      {/* MODAL KONFIRMASI REUSABLE: DELETE & NONAKTIFKAN                                           */}
      {/* ----------------------------------------------------------------------------------------- */}

      {/* Modal Konfirmasi Nonaktifkan */}
      {deactivateTarget && (
        <ConfirmationModal
          open={Boolean(deactivateTarget)}
          variant="warning"
          title="Nonaktifkan Akun Pengguna"
          itemName={`${deactivateTarget.name} (${deactivateTarget.email})`}
          description="Akun pengguna tidak dihapus secara fisik: riwayat penugasan dan audit bersifat append-only (O-030 & doc 54). Akun diubah menjadi Nonaktif, tidak dapat login lagi, dan riwayatnya tetap tersimpan."
          confirmLabel="Nonaktifkan Akun"
          cancelLabel="Batal"
          requireReason
          reasonLabel="Alasan Penonaktifan (Audit Log)"
          reasonPlaceholder="Tuliskan alasan penonaktifan akun untuk riwayat audit…"
          onConfirm={handleConfirmDeactivate}
          onClose={() => setDeactivateTarget(null)}
        />
      )}
    </div>
  )
}

// -------------------------------------------------------------------------------------------------
// Sub-component: UserPreviewDrawer (Tampilan Bersih, Read-Only, Lengkap Penugasan)
// -------------------------------------------------------------------------------------------------
function UserPreviewDrawer({ user, onClose, onEdit }) {
  const [assignments, setAssignments] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!user?.id) return
    setLoading(true)
    adminApi.assignments(user.id)
      .then((res) => {
        setAssignments(res.data ?? [])
        setLoading(false)
      })
      .catch(() => {
        setAssignments([])
        setLoading(false)
      })
  }, [user?.id])

  return (
    <Drawer
      open={Boolean(user)}
      onClose={onClose}
      eyebrow="PREVIEW DETAIL PENGGUNA"
      title={user.name}
      subtitle={user.email}
      size="max-w-xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Link
            to={`/admin/users/${user.id}`}
            className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline inline-flex items-center gap-1"
          >
            <span>Buka Halaman Lengkap</span>
            <IconArrowRight size={14} />
          </Link>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={onClose}>
              Tutup
            </Button>
            <Button variant="primary" size="sm" onClick={() => onEdit(user)}>
              Ubah Data
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Profile Identity Card */}
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-4">
          <div className="flex items-center gap-3.5 mb-4">
            <div className="h-12 w-12 rounded-2xl bg-emerald-600 text-white flex items-center justify-center font-bold text-lg shadow-sm">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-slate-100 text-base">{user.name}</h3>
              <p className="text-xs font-mono text-slate-500 dark:text-slate-400">{user.email}</p>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 text-xs border-t border-slate-200/60 dark:border-slate-700/60 pt-3">
            <div>
              <span className="text-slate-400 dark:text-slate-500 block mb-0.5">NIP Pegawai:</span>
              <span className="font-mono font-semibold text-slate-800 dark:text-slate-200">
                {user.nip || '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 dark:text-slate-500 block mb-0.5">No. Telepon / WA:</span>
              <span className="font-mono text-slate-800 dark:text-slate-200">
                {user.phone || '—'}
              </span>
            </div>
            <div>
              <span className="text-slate-400 dark:text-slate-500 block mb-1">Status Akun:</span>
              <StatusBadge status={user.account_status} />
            </div>
            <div>
              <span className="text-slate-400 dark:text-slate-500 block mb-0.5">Rotasi Password:</span>
              <span className="text-slate-700 dark:text-slate-300">
                {user.must_change_password ? 'Wajib ganti sandi' : 'Normal / Terverifikasi'}
              </span>
            </div>
          </div>
        </div>

        {/* Assignments List */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Penugasan Peran & Unit Organisasi
            </h4>
            <span className="text-[11px] text-slate-400 font-mono">
              {assignments.length} penugasan
            </span>
          </div>

          {loading ? (
            <div className="py-6 flex justify-center"><Spinner /></div>
          ) : assignments.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-4 text-center text-xs text-slate-400">
              Belum ada penugasan peran terdaftar untuk pengguna ini.
            </div>
          ) : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 divide-y divide-slate-100 dark:divide-slate-800 overflow-hidden text-xs">
              {assignments.map((a) => (
                <div key={a.id} className="p-3 bg-white dark:bg-slate-900/60 flex items-center justify-between">
                  <div>
                    <span className="font-bold text-slate-900 dark:text-slate-100">{a.role}</span>
                    <span className="ml-2 font-mono text-[11px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                      Unit: {a.unit_code ?? 'Pusat'}
                    </span>
                    <span className="block text-[11px] text-slate-400 mt-0.5">
                      {a.valid_from} s/d {a.valid_until ?? 'tanpa batas'}
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${a.is_active ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-400' : 'bg-slate-100 text-slate-500'}`}>
                    {a.is_active ? 'Aktif' : 'Berakhir'}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  )
}
