import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { priceBookApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import {
  IconTag,
  IconUpload,
  IconCheck,
  IconCheckCircle,
  IconExclamation,
  IconEye,
  IconTrash,
  IconRefresh,
} from '../../components/icons.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'

export default function PriceBooksPage() {
  const { can } = useAccess()
  const { user } = useAuth()
  const { notify } = useNotifications()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [books, setBooks] = useState([])
  const [statusFilter, setStatusFilter] = useState('ALL') // 'ALL' | 'DRAFT' | 'APPROVED' | 'INACTIVE'

  const [dialog, setDialog] = useState(null) // { type: 'approve' | 'retire', book }
  const [dialogError, setDialogError] = useState('')

  const canManage = Boolean(can['prices.manage'])
  const canApprove = Boolean(can['prices.approve'])

  const loadBooks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = statusFilter !== 'ALL' ? { status: statusFilter } : {}
      const res = await priceBookApi.list(params)
      setBooks(res?.data || [])
    } catch (err) {
      setError(err?.message || 'Gagal memuat daftar buku harga.')
    } finally {
      setLoading(false)
    }
  }, [statusFilter])

  useEffect(() => {
    loadBooks()
  }, [loadBooks])

  // Handle Approve or Retire
  const handleConfirmAction = async (reason) => {
    if (!dialog) return
    setDialogError('')

    try {
      if (dialog.type === 'approve') {
        await priceBookApi.approve({
          book_ids: [dialog.book.id],
          reason,
        })
        notify({
          type: 'success',
          title: 'Buku Harga Disetujui',
          desc: `Buku harga "${dialog.book.name}" telah disetujui dan kini aktif berlaku.`,
          tag: 'Buku Harga',
        })
      } else if (dialog.type === 'retire') {
        await priceBookApi.retire(dialog.book.id, { reason })
        notify({
          type: 'warning',
          title: 'Buku Harga Dinonaktifkan',
          desc: `Buku harga "${dialog.book.name}" telah diubah statusnya menjadi INACTIVE.`,
          tag: 'Buku Harga',
        })
      }
      setDialog(null)
      loadBooks()
    } catch (err) {
      const msg = err?.message || 'Gagal memproses aksi.'
      setDialogError(msg)
      notify({
        type: 'error',
        title: dialog.type === 'approve' ? 'Gagal Menyetujui Buku Harga' : 'Gagal Menonaktifkan Buku Harga',
        desc: msg,
        tag: 'Buku Harga',
      })
    }
  }

  // Find pending drafts
  const draftBooks = books.filter((b) => b.status === 'DRAFT')

  // Metrik KPI
  const approvedBooksCount = books.filter((b) => b.status === 'APPROVED').length
  const inactiveBooksCount = books.filter((b) => b.status === 'INACTIVE').length

  return (
    <div className="space-y-6 w-full">
      {/* Page Header */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
              <IconTag className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Buku Harga Kontrak
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Katalog Tarif &amp; Jasa
                </span>
                <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  Zonasi UP3
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">
                Katalog harga satuan per kontrak kerja, penetapan status pengadaan material (PLN non-RAB atau dibeli vendor), dan tarif jasa pekerjaan instalasi/pembongkaran per zona UP3.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={loadBooks}
              icon={IconRefresh}
              aria-label="Segarkan data buku harga"
            >
              Segarkan
            </Button>
            {canManage && (
              <button
                type="button"
                onClick={() => navigate('/master-data/harga/impor')}
                className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-3 py-1.5 text-xs shadow-xs transition focus-ring cursor-pointer"
              >
                <IconUpload className="h-4 w-4" />
                <span>Impor Buku Harga</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Ringkasan Metrik Buku Harga */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Buku Harga</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconTag className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {books.length.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Kontrak referensi terdaftar</p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Buku Harga Aktif</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {approvedBooksCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Aktif & berlaku untuk RAB/MTO</p>
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-amber-700 dark:text-amber-400">Draf Menunggu Approval</dt>
            <div className="rounded-lg p-1.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
              <IconExclamation className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {draftBooks.length.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-500/70">Menunggu telaah Manager UP3</p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Nonaktif / Lampau</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconTrash className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {inactiveBooksCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Arsip masa kontrak berakhir</p>
        </div>
      </dl>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Prominent Attention Banner for DRAFT price books awaiting approval */}
      {draftBooks.length > 0 && (
        <div className="p-4 sm:p-5 rounded-2xl border border-amber-300 dark:border-amber-800/80 bg-amber-50/80 dark:bg-amber-950/30 text-amber-950 dark:text-amber-100 space-y-3">
          <div className="flex items-center gap-2.5">
            <div className="p-2 rounded-xl bg-amber-200/80 dark:bg-amber-900/60 text-amber-800 dark:text-amber-300">
              <IconExclamation size={18} />
            </div>
            <div>
              <h3 className="text-xs sm:text-sm font-bold">
                Terdapat {draftBooks.length} Draf Buku Harga Menunggu Persetujuan
              </h3>
              <p className="text-xs text-amber-800/80 dark:text-amber-300/80 mt-0.5">
                Buku harga berstatus DRAFT harus ditinjau dan disetujui oleh UP3_MANAGER atau SYS_ADMIN sebelum dapat digunakan dalam perhitungan RAB/MTO.
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
            {draftBooks.map((d) => (
              <div
                key={d.id}
                className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/80 bg-white/80 dark:bg-slate-900/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-900 dark:text-slate-100">{d.name}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                      Menunggu Persetujuan
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-500 space-x-2">
                    {d.contract_reference && <span>Ref: {d.contract_reference} ·</span>}
                    <span>{d.items_count} item KHS</span>
                    <span>· {d.zones_count} unit UP3 berzona</span>
                  </div>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <Link
                    to={`/master-data/harga/${d.id}`}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200 transition-colors"
                  >
                    <IconEye size={14} />
                    <span>Periksa</span>
                  </Link>
                  {canApprove && (
                    <Button
                      type="button"
                      variant="primary"
                      size="sm"
                      onClick={() => setDialog({ type: 'approve', book: d })}
                    >
                      <IconCheck size={14} />
                      <span>Setujui</span>
                    </Button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

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
              className={`px-3.5 py-2 text-xs font-semibold rounded-xl transition-colors cursor-pointer shrink-0 ${
                statusFilter === tab.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

      </div>

      {/* Main Table Card */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-12 text-center">
            <Spinner label="Memuat daftar buku harga..." />
          </div>
        ) : books.length === 0 ? (
          <EmptyState
            icon={IconTag}
            title="Belum ada buku harga"
            description={
              statusFilter !== 'ALL'
                ? `Tidak ditemukan buku harga dengan filter status ${statusFilter}.`
                : 'Belum ada buku harga kontrak yang diunggah ke sistem.'
            }
            action={
              canManage && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => navigate('/master-data/harga/impor')}
                >
                  <IconUpload size={14} />
                  <span>Impor Buku Harga Baru</span>
                </Button>
              )
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                <tr>
                  <th className="p-3.5 sm:px-5">Nama Buku Harga & Kontrak</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Masa Berlaku</th>
                  <th className="p-3.5 text-center">Item KHS</th>
                  <th className="p-3.5 text-center">Zona UP3</th>
                  <th className="p-3.5">Pembuat / Penyetuju</th>
                  <th className="p-3.5 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {books
                  .slice((page - 1) * perPage, page * perPage)
                  .map((b) => {
                  const isDraft = b.status === 'DRAFT'
                  const isApproved = b.status === 'APPROVED'

                  return (
                    <tr
                      key={b.id}
                      className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="p-3.5 sm:px-5">
                        <Link
                          to={`/master-data/harga/${b.id}`}
                          className="font-bold text-blue-600 dark:text-blue-400 hover:underline block text-sm"
                        >
                          {b.name}
                        </Link>
                        {b.contract_reference && (
                          <span className="text-[11px] font-mono text-slate-500 dark:text-slate-400 block mt-0.5">
                            Kontrak: {b.contract_reference}
                          </span>
                        )}
                      </td>
                      <td className="p-3.5">
                        <div className="flex flex-col items-start gap-1">
                          <StatusBadge status={b.status} />
                          {isDraft && (
                            <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                              Menunggu persetujuan
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-3.5 font-mono text-[11px] text-slate-600 dark:text-slate-300">
                        <div>
                          Mulai: <span className="font-semibold">{b.valid_from}</span>
                        </div>
                        {b.valid_until && (
                          <div className="text-slate-400">
                            S/d: <span>{b.valid_until}</span>
                          </div>
                        )}
                      </td>
                      <td className="p-3.5 text-center font-mono font-bold text-slate-800 dark:text-slate-200">
                        {b.items_count}
                      </td>
                      <td className="p-3.5 text-center font-mono text-slate-800 dark:text-slate-200">
                        <span className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold text-[11px]">
                          {b.zones_count} UP3
                        </span>
                      </td>
                      <td className="p-3.5 text-[11px] text-slate-500 space-y-0.5">
                        {b.created_by && <div>Oleh: {b.created_by}</div>}
                        {b.approved_by && (
                          <div className="text-emerald-600 dark:text-emerald-400 font-medium">
                            Disetujui: {b.approved_by}
                          </div>
                        )}
                      </td>
                      <td className="p-3.5 text-right space-x-2">
                        <Link
                          to={`/master-data/harga/${b.id}`}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors"
                        >
                          <IconEye size={13} />
                          <span>Detail</span>
                        </Link>

                        {isDraft && canApprove && (
                          <button
                            type="button"
                            onClick={() => setDialog({ type: 'approve', book: b })}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold text-xs shadow-xs transition-colors cursor-pointer"
                          >
                            <IconCheck size={13} />
                            <span>Setujui</span>
                          </button>
                        )}

                        {isApproved && canApprove && (
                          <button
                            type="button"
                            onClick={() => setDialog({ type: 'retire', book: b })}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors"
                          >
                            <IconTrash size={13} />
                            <span>Nonaktifkan</span>
                          </button>
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
          itemCount={books.slice((page - 1) * perPage, page * perPage).length}
          total={books.length}
          entityLabel="buku harga"
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

      {/* Approve / Retire Reason Dialog */}
      {dialog && (
        <ReasonDialog
          isOpen={true}
          title={
            dialog.type === 'approve'
              ? `Setujui Buku Harga: ${dialog.book.name}`
              : `Nonaktifkan Buku Harga: ${dialog.book.name}`
          }
          description={
            dialog.type === 'approve'
              ? 'Buku harga yang disetujui akan menjadi acuan harga aktif (APPROVED) untuk kalkulasi RAB/MTO, dan akan otomatis menutup buku harga terdahulu. Buku yang telah disetujui bersifat immutable (tidak dapat diubah).'
              : 'Buku harga yang dinonaktifkan (INACTIVE) tidak akan dapat digunakan lagi untuk estimasi RAB kontrak baru. Tindakan ini memerlukan audit alasan resmi.'
          }
          confirmLabel={dialog.type === 'approve' ? 'Setujui & Aktifkan' : 'Nonaktifkan Buku'}
          confirmVariant={dialog.type === 'approve' ? 'primary' : 'danger'}
          onConfirm={handleConfirmAction}
          onClose={() => {
            setDialog(null)
            setDialogError('')
          }}
          error={dialogError}
        />
      )}
    </div>
  )
}
