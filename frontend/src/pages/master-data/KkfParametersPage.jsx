import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { kkfParametersApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import KkfParameterFormDrawer from './KkfParameterFormDrawer.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import {
  IconPlus,
  IconCheck,
  IconExclamation,
  IconEye,
  IconPencil,
  IconRefresh,
  IconTrash,
  IconChart,
} from '../../components/icons.jsx'
import {
  formatPercentDisplay,
  formatRupiahPerKwh,
} from '../../utils/kkfFormatters.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'

export default function KkfParametersPage() {
  const { can, isSysAdmin } = useAccess()
  const { user } = useAuth()
  const { notify } = useNotifications()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sets, setSets] = useState([])
  const [defaults, setDefaults] = useState(null)
  const [statusFilter, setStatusFilter] = useState('ALL') // 'ALL' | 'DRAFT' | 'APPROVED' | 'INACTIVE'
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  // Drawer / Dialog states
  const [formDrawerOpen, setFormDrawerOpen] = useState(false)
  const [editTarget, setEditTarget] = useState(null)
  const [dialog, setDialog] = useState(null) // { type: 'approve' | 'retire', set }
  const [dialogError, setDialogError] = useState('')

  const canManage = Boolean(can['kkf_params.manage'])
  const canApprove = Boolean(can['kkf_params.approve'])

  const loadSets = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = statusFilter !== 'ALL' ? { status: statusFilter } : {}
      const res = await kkfParametersApi.list(params)
      setSets(res?.data || [])
      if (res?.defaults) setDefaults(res.defaults)
    } catch (err) {
      setError(err?.message || 'Gagal memuat daftar parameter KKF.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    loadSets()
  }, [loadSets])

  const todayStr = new Date().toISOString().slice(0, 10)

  // Determine which approved set is currently active in force
  const isActiveSet = (s) => {
    if (s.status !== 'APPROVED') return false
    const validFrom = s.valid_from
    const validUntil = s.valid_until
    return validFrom <= todayStr && (!validUntil || validUntil >= todayStr)
  }

  // Handle Approve or Retire confirmation
  const handleConfirmAction = async (reason) => {
    if (!dialog) return
    setDialogError('')

    try {
      if (dialog.type === 'approve') {
        await kkfParametersApi.approve({
          set_ids: [dialog.set.id],
          reason,
        })
        notify({
          type: 'success',
          title: 'Parameter KKF Disetujui',
          desc: `Set parameter "${dialog.set.name}" berhasil disetujui dan kini aktif berlaku.`,
          tag: 'Parameter KKF',
        })
      } else if (dialog.type === 'retire') {
        await kkfParametersApi.retire(dialog.set.id, { reason })
        notify({
          type: 'warning',
          title: 'Parameter KKF Dinonaktifkan',
          desc: `Set parameter "${dialog.set.name}" telah diubah statusnya menjadi INACTIVE.`,
          tag: 'Parameter KKF',
        })
      }
      setDialog(null)
      loadSets()
    } catch (err) {
      setDialogError(err?.message || 'Gagal memproses aksi persetujuan / penonaktifan.')
      throw err
    }
  }

  return (
    <div className="space-y-6 w-full">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 pb-4 border-b border-slate-200 dark:border-slate-800">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            DISTRIVA / MASTER DATA
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
            Parameter Kelayakan Keuangan (KKF)
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-3xl">
            Konfigurasi sembilan parameter finansial investasi distribusi: tingkat diskonto, BPP, O&M, faktor beban, ROE, suku bunga, pajak, horizon, dan batas payback period (PBP).
          </p>
        </div>

        {/* Header Action Button */}
        <div className="flex items-center gap-2.5 shrink-0">
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setEditTarget(null)
                setFormDrawerOpen(true)
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-4 py-2 text-sm shadow-xs transition focus-ring cursor-pointer"
            >
              <IconPlus size={16} />
              <span>Buat Draf Parameter</span>
            </button>
          )}
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Filter Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-slate-200 dark:border-slate-800">
        <div className="flex space-x-2 overflow-x-auto pb-2">
          {[
            { id: 'ALL', label: 'Semua Status' },
            { id: 'DRAFT', label: 'Draf (Menunggu Persetujuan)' },
            { id: 'APPROVED', label: 'Disetujui (Aktif)' },
            { id: 'INACTIVE', label: 'Nonaktif' },
          ].map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => setStatusFilter(tab.id)}
              className={`px-3 py-1.5 text-xs font-semibold rounded-xl whitespace-nowrap transition cursor-pointer ${
                statusFilter === tab.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'bg-white dark:bg-slate-800/80 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={loadSets}
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 py-1 cursor-pointer"
        >
          <IconRefresh size={14} className={loading ? 'animate-spin' : ''} />
          <span>Segarkan Data</span>
        </button>
      </div>

      {/* Main Table Card */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <Spinner label="Memuat parameter KKF..." />
          </div>
        ) : sets.length === 0 ? (
          <EmptyState
            icon={IconChart}
            title="Belum ada parameter KKF"
            description={
              canManage
                ? 'Klik tombol "Buat Draf Parameter" di atas untuk menambahkan konfigurasi parameter baru.'
                : 'Belum ada parameter yang tersedia untuk status yang dipilih.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs data-table">
              <thead className="bg-slate-50/75 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800 text-slate-500 dark:text-slate-400">
                <tr>
                  <th className="py-3.5 px-6 font-semibold uppercase tracking-wider">Nama Set Parameter</th>
                  <th className="py-3.5 px-6 font-semibold uppercase tracking-wider">Status</th>
                  <th className="py-3.5 px-6 font-semibold uppercase tracking-wider">Masa Berlaku</th>
                  <th className="py-3.5 px-6 font-semibold uppercase tracking-wider">Discount Rate</th>
                  <th className="py-3.5 px-6 font-semibold uppercase tracking-wider">BPP</th>
                  <th className="py-3.5 px-6 font-semibold uppercase tracking-wider">Faktor Beban</th>
                  <th className="py-3.5 px-6 font-semibold uppercase tracking-wider">Horizon & PBP</th>
                  <th className="py-3.5 px-6 font-semibold uppercase tracking-wider text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sets
                  .slice((page - 1) * perPage, page * perPage)
                  .map((s) => {
                  const isDraft = s.status === 'DRAFT'
                  const isApproved = s.status === 'APPROVED'
                  const isCurrentActive = isActiveSet(s)

                  return (
                    <tr
                      key={s.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-6">
                        <div className="space-y-0.5">
                          <Link
                            to={`/master-data/kkf-parameters/${s.id}`}
                            className="font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 transition"
                          >
                            {s.name}
                          </Link>
                          {s.notes && (
                            <p className="text-[11px] text-slate-400 truncate max-w-xs">{s.notes}</p>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-6">
                        <div className="flex flex-col gap-1 items-start">
                          <StatusBadge status={s.status} />
                          {isCurrentActive && (
                            <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700">
                              Sedang Berlaku
                            </span>
                          )}
                        </div>
                      </td>

                      <td className="py-3.5 px-6 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        <div>Mulai: {s.valid_from}</div>
                        {s.valid_until && (
                          <div className="text-slate-400">s/d: {s.valid_until}</div>
                        )}
                      </td>

                      <td className="py-3.5 px-6 font-mono font-semibold text-slate-800 dark:text-slate-200">
                        {formatPercentDisplay(s.discount_rate)}
                      </td>

                      <td className="py-3.5 px-6 font-mono font-semibold text-slate-800 dark:text-slate-200">
                        {formatRupiahPerKwh(s.bpp)}
                      </td>

                      <td className="py-3.5 px-6 font-mono text-slate-700 dark:text-slate-300">
                        {formatPercentDisplay(s.load_factor, 1)}
                      </td>

                      <td className="py-3.5 px-6 text-slate-600 dark:text-slate-400">
                        <div className="font-semibold">{s.horizon_years} Tahun</div>
                        <div className="text-[11px] text-slate-400">Batas PBP: {s.payback_limit_months} Bln</div>
                      </td>

                      <td className="py-3.5 px-6 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          <Link
                            to={`/master-data/kkf-parameters/${s.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200 text-xs transition-colors"
                          >
                            <IconEye size={13} />
                            <span>Detail</span>
                          </Link>

                          {isDraft && canManage && (
                            <button
                              type="button"
                              onClick={() => {
                                setEditTarget(s)
                                setFormDrawerOpen(true)
                              }}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200 text-xs transition-colors cursor-pointer"
                              title="Ubah Nilai Draf"
                            >
                              <IconPencil size={13} />
                              <span>Ubah</span>
                            </button>
                          )}

                          {isDraft && canApprove && (
                            <button
                              type="button"
                              onClick={() => setDialog({ type: 'approve', set: s })}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                              title="Setujui Set Parameter"
                            >
                              <IconCheck size={13} />
                              <span>Setujui</span>
                            </button>
                          )}

                          {isApproved && canApprove && (
                            <button
                              type="button"
                              onClick={() => setDialog({ type: 'retire', set: s })}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
                              title="Nonaktifkan Set Parameter"
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

        <TableFooter
          itemCount={sets.slice((page - 1) * perPage, page * perPage).length}
          total={sets.length}
          entityLabel="set parameter KKF"
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

      {/* Form Drawer (Create / Edit) */}
      <KkfParameterFormDrawer
        open={formDrawerOpen}
        onClose={() => {
          setFormDrawerOpen(false)
          setEditTarget(null)
        }}
        initialData={editTarget}
        defaults={defaults}
        onSuccess={() => {
          loadSets()
        }}
      />

      {/* Confirmation Dialog with mandatory reason for Approve / Retire */}
      {dialog && (
        <ReasonDialog
          title={
            dialog.type === 'approve'
              ? `Setujui Parameter KKF: ${dialog.set.name}`
              : `Nonaktifkan Parameter KKF: ${dialog.set.name}`
          }
          description={
            dialog.type === 'approve'
              ? `Menyetujui set parameter ini akan mengubah statusnya menjadi APPROVED dan otomatis menutup (mengakhiri masa berlaku) set parameter yang aktif sebelumnya.${isSysAdmin ? '' : ' Pembuat set parameter tidak dapat menyetujui set buatannya sendiri.'}`
              : `Menonaktifkan set parameter ini akan mengubah statusnya menjadi INACTIVE sehingga tidak lagi digunakan dalam perhitungan proyek baru.`
          }
          confirmLabel={dialog.type === 'approve' ? 'Setujui Parameter' : 'Nonaktifkan'}
          confirmVariant={dialog.type === 'approve' ? 'primary' : 'danger'}
          error={dialogError}
          onConfirm={handleConfirmAction}
          onClose={() => {
            setDialog(null)
            setDialogError('')
          }}
        />
      )}
    </div>
  )
}
