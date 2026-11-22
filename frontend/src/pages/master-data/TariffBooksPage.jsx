import { useState, useEffect, useCallback } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { tariffBooksApi } from '../../services/api.js'
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
  IconUpload,
  IconCheck,
  IconCheckCircle,
  IconExclamation,
  IconEye,
  IconRefresh,
  IconZap,
  IconTrash,
} from '../../components/icons.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'

export default function TariffBooksPage() {
  const { can } = useAccess()
  const { user } = useAuth()
  const { notify } = useNotifications()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [books, setBooks] = useState([])
  const [statusFilter, setStatusFilter] = useState('ALL') // 'ALL' | 'DRAFT' | 'APPROVED' | 'INACTIVE'
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const [dialog, setDialog] = useState(null) // { type: 'approve' | 'retire', book }
  const [dialogError, setDialogError] = useState('')

  const canManage = Boolean(can['tariffs.manage'])
  const canApprove = Boolean(can['tariffs.approve'])

  const loadBooks = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = statusFilter !== 'ALL' ? { status: statusFilter } : {}
      const res = await tariffBooksApi.list(params)
      setBooks(res?.data || [])
    } catch (err) {
      setError(err?.message || 'Gagal memuat daftar buku tarif.')
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
        await tariffBooksApi.approve({
          book_ids: [dialog.book.id],
          reason,
        })
        notify({
          type: 'success',
          title: 'Buku Tarif Disetujui',
          desc: `Buku tarif "${dialog.book.name}" telah disetujui dan kini aktif berlaku.`,
          tag: 'Buku Tarif',
        })
      } else if (dialog.type === 'discard') {
        await tariffBooksApi.discard(dialog.book.id, { reason })
        notify({
          type: 'warning',
          title: 'Draf Buku Tarif Dibatalkan',
          desc: `Draf buku tarif "${dialog.book.name}" dibatalkan; riwayatnya tetap tersimpan dan tidak dapat disetujui lagi.`,
          tag: 'Buku Tarif',
        })
      } else if (dialog.type === 'retire') {
        await tariffBooksApi.retire(dialog.book.id, { reason })
        notify({
          type: 'warning',
          title: 'Buku Tarif Dinonaktifkan',
          desc: `Buku tarif "${dialog.book.name}" telah diubah statusnya menjadi INACTIVE.`,
          tag: 'Buku Tarif',
        })
      }
      setDialog(null)
      loadBooks()
    } catch (err) {
      const msg = err?.message || 'Gagal memproses aksi.'
      setDialogError(msg)
      notify({
        type: 'error',
        title: dialog.type === 'approve' ? 'Gagal Menyetujui Buku Tarif' : dialog.type === 'discard' ? 'Gagal Membatalkan Draf' : 'Gagal Menonaktifkan Buku Tarif',
        desc: msg,
        tag: 'Buku Tarif',
      })
    }
  }

  // Find pending drafts
  const draftBooks = books.filter((b) => b.status === 'DRAFT')

  // Metrik KPI Tarif
  const approvedTariffsCount = books.filter((b) => b.status === 'APPROVED').length
  const inactiveTariffsCount = books.filter((b) => b.status === 'INACTIVE').length

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
              <IconZap className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Buku Tarif Listrik
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Golongan Tarif PLN
                </span>
                <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  Rp/kWh &amp; UJL
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">
                Katalog tarif tenaga listrik: harga jual rata-rata (Rp/kWh), jam nyala (kWh/kVA/bulan), dan UJL (Rp/VA) per golongan tarif dan daya.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={loadBooks}
              icon={IconRefresh}
              aria-label="Segarkan data buku tarif"
            >
              Segarkan
            </Button>
            {canManage && (
              <Button
                variant="primary"
                size="md"
                icon={IconUpload}
                onClick={() => navigate('/master-data/tariff-books/impor')}
              >
                Impor Buku Tarif
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Ringkasan Metrik Buku Tarif */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Buku Tarif</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconZap className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {books.length.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Katalog tarif terdaftar</p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Buku Tarif Aktif</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {approvedTariffsCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Berlaku untuk perhitungan KKF</p>
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-amber-700 dark:text-amber-400">Draf Menunggu Persetujuan</dt>
            <div className="rounded-lg p-1.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
              <IconExclamation className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {draftBooks.length.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-500/70">Perlu telaah Manager UP3</p>
        </div>

        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Nonaktif / Lampau</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconTrash className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {inactiveTariffsCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Arsip tarif masa lalu</p>
        </div>
      </dl>

      {/* Pending Draft Alert Banner */}
      {draftBooks.length > 0 && (
        <div className="p-4 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 text-xs text-amber-800 dark:text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs">
          <div className="flex items-start gap-2.5">
            <IconExclamation size={18} className="text-amber-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-amber-900 dark:text-amber-100">
                Terdapat {draftBooks.length} draf buku tarif menunggu persetujuan
              </p>
              <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-0.5">
                Draf harus disetujui oleh pejabat berwenang (UP3_MANAGER / SYS_ADMIN) sebelum dapat digunakan untuk kalkulasi KKF.
              </p>
            </div>
          </div>
          {canApprove && (
            <Button
              size="sm"
              variant="primary"
              onClick={() => setStatusFilter('DRAFT')}
              className="shrink-0 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white"
            >
              Tinjau Draf
            </Button>
          )}
        </div>
      )}

      {/* Filter Tabs */}
      <div role="tablist" aria-label="Status Buku Tarif" className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800 overflow-x-auto">
        {[
          { id: 'ALL', label: 'Semua Status' },
          { id: 'DRAFT', label: 'Draf (Menunggu Persetujuan)' },
          { id: 'APPROVED', label: 'Disetujui (Aktif)' },
          { id: 'INACTIVE', label: 'Nonaktif' },
          { id: 'DISCARDED', label: 'Dibatalkan' },
        ].map((tab) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={statusFilter === tab.id}
            onClick={() => setStatusFilter(tab.id)}
            className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer whitespace-nowrap ${
              statusFilter === tab.id
                ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Main Table */}
      <div className="border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-16 text-center">
            <Spinner size="md" label="Memuat daftar buku tarif..." />
          </div>
        ) : error ? (
          <div className="p-4"><Alert kind="error">{error}</Alert></div>
        ) : books.length === 0 ? (
          <EmptyState
            icon={IconZap}
            title="Belum ada buku tarif"
            description={
              statusFilter !== 'ALL'
                ? `Belum ada buku tarif berstatus ${statusFilter}.`
                : canManage
                ? 'Klik tombol "Impor Buku Tarif" di atas untuk mengunggah draf buku tarif baru dari berkas CSV.'
                : 'Belum ada draf atau buku tarif aktif yang tersedia di sistem.'
            }
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">Nama Buku Tarif</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Masa Berlaku</th>
                  <th className="py-3 px-4 text-center">Jumlah Baris</th>
                  <th className="py-3 px-4">Pembuat / Penyetuju</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {books
                  .slice((page - 1) * perPage, page * perPage)
                  .map((b) => {
                  const isCreator = user?.id && b.created_by && user.id === b.created_by
                  const isDraft = b.status === 'DRAFT'
                  const isApproved = b.status === 'APPROVED'

                  return (
                    <tr
                      key={b.id}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-3.5 px-4 font-medium text-slate-900 dark:text-slate-100">
                        <Link
                          to={`/master-data/tariff-books/${b.id}`}
                          className="text-blue-600 dark:text-blue-400 hover:underline font-semibold block"
                        >
                          {b.name}
                        </Link>
                        {b.source_reference && (
                          <span className="text-[11px] text-slate-400 block font-normal mt-0.5">
                            Ref: {b.source_reference}
                          </span>
                        )}
                      </td>
                      <td className="py-3.5 px-4">
                        <StatusBadge status={b.status} />
                      </td>
                      <td className="py-3.5 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                        <div>Mulai: {b.valid_from}</div>
                        {b.valid_until && <div>s/d: {b.valid_until}</div>}
                      </td>
                      <td className="py-3.5 px-4 text-center font-mono font-semibold text-slate-700 dark:text-slate-300">
                        {b.rows_count != null ? Number(b.rows_count).toLocaleString('id-ID') : '-'}
                      </td>
                      <td className="py-3.5 px-4 text-[11px] text-slate-500 dark:text-slate-400">
                        <div>Oleh: {b.created_by || '-'}</div>
                        {b.approved_by && (
                          <div className="text-emerald-600 dark:text-emerald-400 mt-0.5">
                            Disetujui: {b.approved_by}
                          </div>
                        )}
                      </td>
                      <td className="py-3.5 px-4 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <Link
                            to={`/master-data/tariff-books/${b.id}`}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-300 font-semibold text-xs transition-colors"
                          >
                            <IconEye size={13} />
                            <span>Detail</span>
                          </Link>

                          {isDraft && canApprove && (
                            <Button
                              size="xs"
                              variant="primary"
                              onClick={() => setDialog({ type: 'approve', book: b })}
                              className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white"
                            >
                              <IconCheck size={14} />
                              <span>Setujui</span>
                            </Button>
                          )}

                          {isDraft && (canManage || canApprove) && (
                            <button
                              type="button"
                              onClick={() => setDialog({ type: 'discard', book: b })}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
                              title="Batalkan Draf Ini"
                            >
                              <IconTrash size={13} />
                              <span>Batalkan</span>
                            </button>
                          )}

                          {isApproved && canApprove && (
                            <button
                              type="button"
                              onClick={() => setDialog({ type: 'retire', book: b })}
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

        <TableFooter
          itemCount={books.slice((page - 1) * perPage, page * perPage).length}
          total={books.length}
          entityLabel="buku tarif"
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

      {/* Confirmation Dialog with Audit Reason */}
      {/* Discard a wrong DRAFT (status DISCARDED, history kept) */}
      {dialog?.type === 'discard' && (
        <ReasonDialog
          isOpen={true}
          title={`Batalkan Draf Buku Tarif: ${dialog.book.name}`}
          description="Draf tidak dihapus: riwayatnya tetap tersimpan, tetapi tidak bisa disetujui atau diubah lagi. Alasan pembatalan wajib dan tercatat."
          confirmLabel="Batalkan Draf"
          confirmVariant="danger"
          onConfirm={handleConfirmAction}
          onClose={() => {
            setDialog(null)
            setDialogError('')
          }}
          error={dialogError}
        />
      )}

      {dialog && dialog.type !== 'discard' && (
        <ReasonDialog
          isOpen={true}
          title={
            dialog.type === 'approve'
              ? `Setujui Buku Tarif: ${dialog.book.name}`
              : `Nonaktifkan Buku Tarif: ${dialog.book.name}`
          }
          description={
            dialog.type === 'approve'
              ? 'Menyetujui buku tarif ini akan mengubah statusnya menjadi APPROVED dan otomatis menutup (mengakhiri masa berlaku) buku tarif aktif sebelumnya.'
              : 'Menonaktifkan buku tarif ini akan mengubah statusnya menjadi INACTIVE sehingga tidak lagi digunakan dalam kalkulasi KKF baru.'
          }
          confirmLabel={
            dialog.type === 'approve' ? 'Setujui Buku Tarif' : 'Nonaktifkan Buku Tarif'
          }
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
