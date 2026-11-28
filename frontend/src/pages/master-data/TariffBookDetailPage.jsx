import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { tariffBooksApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { useScopedUnits } from '../../utils/unitScope.js'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import {
  IconArrowLeft,
  IconCheck,
  IconCheckCircle,
  IconExclamation,
  IconRefresh,
  IconSearch,
  IconClock,
  IconHistory,
  IconZap,
  IconTrash,
} from '../../components/icons.jsx'
import { formatRupiah, formatNumber } from '../../utils/kkfFormatters.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'

export default function TariffBookDetailPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { can } = useAccess()
  const { user } = useAuth()
  const { notify } = useNotifications()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [book, setBook] = useState(null)

  // Rows state
  const [rows, setRows] = useState([])
  const [rowsMeta, setRowsMeta] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 50 })
  const [rowsLoading, setRowsLoading] = useState(false)
  const [tariffFilter, setTariffFilter] = useState('')
  const [up3Id, setUp3Id] = useState('')
  const [unitId, setUnitId] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(50)
  const unitInfo = useScopedUnits('master_data.view')

  const visibleRows = useMemo(() => {
    if (!up3Id && !unitId) return rows
    const ulps = unitInfo?.ulp_units || []
    if (unitId) {
      const selectedUlp = ulps.find((u) => String(u.id) === String(unitId))
      if (!selectedUlp?.code) return rows
      return rows.filter((r) => String(r.ulp_code || '') === String(selectedUlp.code))
    }
    const allowedCodes = new Set(
      ulps.filter((u) => String(u.parent_id) === String(up3Id)).map((u) => String(u.code || '')),
    )
    if (allowedCodes.size === 0) return rows
    return rows.filter((r) => r.ulp_code && allowedCodes.has(String(r.ulp_code)))
  }, [rows, up3Id, unitId, unitInfo])

  // Dialog state
  const [dialog, setDialog] = useState(null) // { type: 'approve' | 'retire' }
  const [dialogError, setDialogError] = useState('')

  const canManage = Boolean(can['tariffs.manage'])
  const canApprove = Boolean(can['tariffs.approve'])

  const loadBookDetail = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await tariffBooksApi.get(id)
      setBook(res?.data || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat detail buku tarif.')
    } finally {
      setLoading(false)
    }
  }, [id])

  const loadRows = useCallback(async () => {
    setRowsLoading(true)
    try {
      const params = {
        page,
        per_page: perPage,
      }
      if (tariffFilter.trim()) {
        params.tariff = tariffFilter.trim()
      }
      const res = await tariffBooksApi.rows(id, params)
      setRows(res?.data || [])
      setRowsMeta(res?.meta || { current_page: 1, last_page: 1, total: 0, per_page: perPage })
    } catch (err) {
      // Row error can be non-fatal or displayed
    } finally {
      setRowsLoading(false)
    }
  }, [id, page, perPage, tariffFilter])

  useEffect(() => {
    loadBookDetail()
  }, [loadBookDetail])

  useEffect(() => {
    loadRows()
  }, [loadRows])

  // Handle Approve or Retire
  const handleConfirmAction = async (reason) => {
    if (!dialog) return
    setDialogError('')

    try {
      if (dialog.type === 'approve') {
        await tariffBooksApi.approve({
          book_ids: [id],
          reason,
        })
        notify({
          type: 'success',
          title: 'Buku Tarif Disetujui',
          desc: `Buku tarif "${book.name}" telah disetujui dan kini aktif berlaku.`,
          tag: 'Buku Tarif',
        })
      } else if (dialog.type === 'discard') {
        await tariffBooksApi.discard(id, { reason })
        notify({
          type: 'warning',
          title: 'Draf Buku Tarif Dibatalkan',
          desc: `Draf buku tarif "${book.name}" dibatalkan; riwayatnya tetap tersimpan dan tidak dapat disetujui lagi.`,
          tag: 'Buku Tarif',
        })
      } else if (dialog.type === 'retire') {
        await tariffBooksApi.retire(id, { reason })
        notify({
          type: 'warning',
          title: 'Buku Tarif Dinonaktifkan',
          desc: `Buku tarif "${book.name}" telah dinonaktifkan.`,
          tag: 'Buku Tarif',
        })
      }
      setDialog(null)
      loadBookDetail()
      loadRows()
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

  const handleSearchSubmit = (e) => {
    e.preventDefault()
    setPage(1)
    loadRows()
  }

  if (loading) {
    return (
      <div className="py-20 text-center">
        <Spinner size="md" label="Memuat data buku tarif..." />
      </div>
    )
  }

  if (error || !book) {
    return (
      <div className="space-y-4">
        <Link
          to="/master-data/tariff-books"
          className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 font-medium"
        >
          <IconArrowLeft size={16} />
          <span>Kembali ke Buku Tarif</span>
        </Link>
        <Alert kind="error">{error || 'Data buku tarif tidak ditemukan.'}</Alert>
      </div>
    )
  }

  const isDraft = book.status === 'DRAFT'
  const isApproved = book.status === 'APPROVED'

  return (
    <div className="space-y-6">
      {/* Top Nav & Breadcrumbs */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <Link
            to="/master-data/tariff-books"
            className="inline-flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 dark:hover:text-blue-400 font-semibold mb-2 transition"
          >
            <IconArrowLeft size={16} />
            <span>Kembali ke Buku Tarif</span>
          </Link>
          <div className="flex items-center gap-2.5">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
              {book.name}
            </h1>
            <StatusBadge status={book.status} />
          </div>
          {book.source_reference && (
            <p className="text-xs text-slate-500 mt-1">
              Referensi: <span className="font-mono text-slate-700 dark:text-slate-300">{book.source_reference}</span>
            </p>
          )}
        </div>

        {/* Action Buttons */}
        <div className="flex items-center gap-2">
          {isDraft && canApprove && (
            <Button
              variant="primary"
              size="sm"
              onClick={() => setDialog({ type: 'approve' })}
              className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white"
            >
              <IconCheck size={16} />
              <span>Setujui Buku Tarif</span>
            </Button>
          )}
          {isDraft && (canManage || canApprove) && (
            <button
              type="button"
              onClick={() => setDialog({ type: 'discard' })}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
              title="Batalkan Draf Ini"
            >
              <IconTrash size={13} />
              <span>Batalkan Draf</span>
            </button>
          )}

          {isApproved && canApprove && (
            <button
              type="button"
              onClick={() => setDialog({ type: 'retire' })}
              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
            >
              <IconTrash size={13} />
              <span>Nonaktifkan</span>
            </button>
          )}
        </div>
      </div>

      {/* Metadata Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Masa Berlaku
          </span>
          <p className="font-mono font-medium text-slate-800 dark:text-slate-200">
            {book.valid_from} {book.valid_until ? `s/d ${book.valid_until}` : '(Sekarang)'}
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Jumlah Baris Tarif
          </span>
          <p className="font-mono font-bold text-slate-800 dark:text-slate-100 text-sm">
            {book.rows_count != null ? Number(book.rows_count).toLocaleString('id-ID') : '-'} baris
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Diunggah Oleh
          </span>
          <p className="text-slate-700 dark:text-slate-300 truncate" title={book.created_by}>
            {book.created_by || '-'}
          </p>
        </div>

        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
          <span className="text-[11px] font-semibold text-slate-400 uppercase tracking-wider block mb-1">
            Persetujuan
          </span>
          <p className="text-slate-700 dark:text-slate-300 truncate">
            {book.approved_by ? `${book.approved_by} (${book.approved_at || '-'})` : 'Belum disetujui'}
          </p>
        </div>
      </div>

      {/* Rows Section */}
      <div className="space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold text-slate-800 dark:text-slate-200">
              Daftar Baris Tarif & Daya Listrik ({rowsMeta.total.toLocaleString('id-ID')} item)
            </h3>
            <p className="text-xs text-slate-500">
              Harga rata-rata, jam nyala, dan UJL per kombinasi golongan tarif dan daya.
            </p>
          </div>

          {/* Search by Tariff + UP3/ULP Filter */}
          <form onSubmit={handleSearchSubmit} className="flex flex-wrap items-center gap-2">
            <HierarchicalUnitFilter
              permission="master_data.view"
              up3Id={up3Id}
              onUp3Change={(v) => { setUp3Id(v); setPage(1) }}
              unitId={unitId}
              onUnitChange={(v) => { setUnitId(v); setPage(1) }}
              className="w-40"
              ulpClassName="w-48"
            />
            <div className="relative">
              <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Cari tarif (mis. R1, B2)..."
                value={tariffFilter}
                onChange={(e) => setTariffFilter(e.target.value)}
                className="pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-50 w-48 sm:w-56"
              />
            </div>
            <Button
              type="submit"
              size="sm"
              variant="primary"
              className="bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white"
            >
              Cari
            </Button>
            {(tariffFilter || up3Id || unitId) && (
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => {
                  setTariffFilter('')
                  setUp3Id('')
                  setUnitId('')
                  setPage(1)
                }}
              >
                Reset
              </Button>
            )}
          </form>
        </div>

        {/* Rows Table */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-2xl bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
          {rowsLoading ? (
            <div className="py-12 text-center">
              <Spinner size="sm" label="Memuat baris tarif..." />
            </div>
          ) : visibleRows.length === 0 ? (
            <EmptyState
              icon={IconZap}
              title="Belum ada data tarif"
              description="Tidak ada baris data tarif yang cocok dengan kriteria pencarian atau buku tarif belum memiliki baris."
            />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 font-bold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2.5 px-4">Golongan Tarif</th>
                    <th className="py-2.5 px-4">Tingkat Daya (VA)</th>
                    <th className="py-2.5 px-4">Cakupan ULP</th>
                    <th className="py-2.5 px-4 text-right">Harga Rata-rata (Rp/kWh)</th>
                    <th className="py-2.5 px-4 text-right">Jam Nyala (Jam/Bln)</th>
                    <th className="py-2.5 px-4 text-right">UJL (Rp/VA)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono text-[11px]">
                  {visibleRows.map((r, idx) => (
                    <tr
                      key={idx}
                      className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    >
                      <td className="py-2.5 px-4 font-bold text-slate-800 dark:text-slate-200">
                        {r.tariff}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">
                        {r.power_va ? `${Number(r.power_va).toLocaleString('id-ID')} VA` : 'Semua Daya'}
                      </td>
                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">
                        {r.ulp_code ? (
                          <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-semibold text-slate-700 dark:text-slate-300">
                            {r.ulp_code}
                          </span>
                        ) : (
                          <span className="text-slate-400">Semua ULP</span>
                        )}
                      </td>
                      <td className="py-2.5 px-4 text-right font-semibold text-slate-800 dark:text-slate-200">
                        {formatRupiah(r.avg_price, true)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-700 dark:text-slate-300">
                        {formatNumber(r.jam_nyala)}
                      </td>
                      <td className="py-2.5 px-4 text-right text-slate-700 dark:text-slate-300">
                        {r.ujl != null ? formatRupiah(r.ujl) : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Standardized Table Footer */}
          <TableFooter
            meta={rowsMeta}
            itemCount={rows.length}
            total={rowsMeta?.total ?? rows.length}
            entityLabel="baris tarif"
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
      </div>

      {/* Audit Events History */}
      {book.events && book.events.length > 0 && (
        <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <IconHistory size={16} />
            <span>Riwayat & Audit Trail Buku Tarif</span>
          </h3>
          <div className="space-y-2">
            {book.events.map((e, ei) => (
              <div
                key={ei}
                className="p-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/30 text-xs flex flex-col sm:flex-row sm:items-center justify-between gap-2"
              >
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      {e.event_type}
                    </span>
                    <span className="text-slate-400 font-mono text-[11px]">
                      oleh {e.actor_email}
                    </span>
                  </div>
                  {e.reason && (
                    <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5">
                      Alasan: &ldquo;{e.reason}&rdquo;
                    </p>
                  )}
                </div>
                <span className="text-[11px] text-slate-400 font-mono shrink-0">
                  {e.occurred_at}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Dialog Reason */}
      {/* Discard a wrong DRAFT (status DISCARDED, history kept) */}
      {dialog?.type === 'discard' && (
        <ReasonDialog
          isOpen={true}
          title={`Batalkan Draf Buku Tarif: ${book.name}`}
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
              ? `Setujui Buku Tarif: ${book.name}`
              : `Nonaktifkan Buku Tarif: ${book.name}`
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
