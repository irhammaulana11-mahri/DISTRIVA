import { useState, useEffect, useCallback } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { priceBookApi, adminApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import {
  IconTag,
  IconArrowLeft,
  IconCheck,
  IconCheckCircle,
  IconExclamation,
  IconMapPin,
  IconFileText,
  IconClock,
  IconTrash,
  IconSearch,
  IconRefresh,
  IconX,
} from '../../components/icons.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'

// Indonesian currency formatter without client-side rounding
function formatRupiah(val) {
  if (val === null || val === undefined || val === '') return '-'
  const num = Number(val)
  if (isNaN(num)) return '-'
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  }).format(num)
}

export default function PriceBookDetailPage() {
  const { id } = useParams()
  const { can } = useAccess()
  const { notify } = useNotifications()
  const navigate = useNavigate()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [book, setBook] = useState(null)
  const [activeTab, setActiveTab] = useState('zones') // 'zones' | 'items' | 'events'

  // Zone assignment state
  const [zonePage, setZonePage] = useState(1)
  const [zonePerPage, setZonePerPage] = useState(10)
  const [up3Units, setUp3Units] = useState([])
  const [loadingUnits, setLoadingUnits] = useState(false)
  const [zoneModalOpen, setZoneModalOpen] = useState(false)
  const [selectedUnitId, setSelectedUnitId] = useState('')
  const [selectedZone, setSelectedZone] = useState('')
  const [zoneReason, setZoneReason] = useState('')
  const [zoneSaving, setZoneSaving] = useState(false)
  const [zoneError, setZoneError] = useState('')

  // Items tab state
  const [items, setItems] = useState([])
  const [itemsMeta, setItemsMeta] = useState(null)
  const [itemsLoading, setItemsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [materialStatus, setMaterialStatus] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(50)

  // Approve / Retire dialogs
  const [actionDialog, setActionDialog] = useState(null) // { type: 'approve' | 'retire' }
  const [actionError, setActionError] = useState('')

  const canManage = Boolean(can['prices.manage'])
  const canApprove = Boolean(can['prices.approve'])

  // 1. Load Price Book detail
  const loadBook = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await priceBookApi.get(id)
      setBook(res?.data || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat rincian buku harga.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadBook()
  }, [loadBook])

  // 2. Load UP3 units when needed for zone assignment
  const loadUnits = useCallback(async () => {
    if (up3Units.length > 0) return
    setLoadingUnits(true)
    try {
      const res = await adminApi.units({ unit_type: 'UP3', per_page: 100 })
      setUp3Units(res?.data || [])
    } catch {
      setUp3Units([])
    } finally {
      setLoadingUnits(false)
    }
  }, [up3Units.length])

  // 3. Load items on search/filter/page change
  const loadItems = useCallback(async () => {
    if (!id) return
    setItemsLoading(true)
    try {
      const params = {
        page,
        per_page: perPage,
      }
      if (search.trim()) params.search = search.trim()
      if (materialStatus) params.material_status = materialStatus

      const res = await priceBookApi.items(id, params)
      setItems(res?.data || [])
      setItemsMeta(res?.meta || null)
    } catch (err) {
      setItems([])
    } finally {
      setItemsLoading(false)
    }
  }, [id, page, perPage, search, materialStatus])

  useEffect(() => {
    if (activeTab === 'items') {
      loadItems()
    }
  }, [activeTab, loadItems])

  // Handle Zone setting submit (PUT /zones)
  const handleSetZoneSubmit = async (e) => {
    e.preventDefault()
    if (!selectedUnitId || !selectedZone || !zoneReason.trim()) {
      setZoneError('Seluruh bidang formulir penetapan zona wajib diisi.')
      return
    }

    setZoneSaving(true)
    setZoneError('')

    try {
      await priceBookApi.setZone(id, {
        up3_unit_id: selectedUnitId,
        zone: Number(selectedZone),
        reason: zoneReason.trim(),
      })
      notify({
        type: 'success',
        title: 'Zona UP3 Ditetapkan',
        desc: 'Penetapan zona tarif berhasil diperbarui untuk unit UP3 terpilih.',
        tag: 'Buku Harga',
      })
      setZoneModalOpen(false)
      setSelectedUnitId('')
      setSelectedZone('')
      setZoneReason('')
      loadBook()
    } catch (err) {
      const msg = err?.message || 'Gagal menyimpan penetapan zona UP3.'
      setZoneError(msg)
      notify({
        type: 'error',
        title: 'Gagal Menetapkan Zona UP3',
        desc: msg,
        tag: 'Buku Harga',
      })
    } finally {
      setZoneSaving(false)
    }
  }

  // Handle Approve or Retire
  const handleConfirmAction = async (reason) => {
    if (!actionDialog) return
    setActionError('')

    try {
      if (actionDialog.type === 'approve') {
        await priceBookApi.approve({
          book_ids: [id],
          reason,
        })
        notify({
          type: 'success',
          title: 'Buku Harga Disetujui',
          desc: `Buku harga "${book?.name}" berhasil disetujui (APPROVED) dan kini aktif berlaku.`,
          tag: 'Buku Harga',
        })
      } else if (actionDialog.type === 'retire') {
        await priceBookApi.retire(id, { reason })
        notify({
          type: 'warning',
          title: 'Buku Harga Dinonaktifkan',
          desc: `Buku harga "${book?.name}" telah dinonaktifkan (INACTIVE).`,
          tag: 'Buku Harga',
        })
      }
      setActionDialog(null)
      loadBook()
    } catch (err) {
      const msg = err?.message || 'Gagal memproses aksi persetujuan / penonaktifan.'
      setActionError(msg)
      notify({
        type: 'error',
        title: actionDialog.type === 'approve' ? 'Gagal Menyetujui Buku Harga' : 'Gagal Menonaktifkan Buku Harga',
        desc: msg,
        tag: 'Buku Harga',
      })
    }
  }

  if (loading) {
    return (
      <div className="p-16 text-center">
        <Spinner label="Memuat data buku harga..." />
      </div>
    )
  }

  if (error || !book) {
    return (
      <div className="space-y-4">
        <Link
          to="/master-data/harga"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 hover:underline"
        >
          <IconArrowLeft size={16} />
          <span>Kembali ke Daftar Buku Harga</span>
        </Link>
        <Alert kind="error">{error || 'Data buku harga tidak ditemukan.'}</Alert>
      </div>
    )
  }

  const isDraft = book.status === 'DRAFT'
  const isApproved = book.status === 'APPROVED'
  const isInactive = book.status === 'INACTIVE'
  const availableZones = Array.isArray(book.available_zones) ? book.available_zones : []

  return (
    <div className="space-y-6 w-full">
      {/* Back Link */}
      <div>
        <Link
          to="/master-data/harga"
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200"
        >
          <IconArrowLeft size={16} />
          <span>Kembali ke Daftar Buku Harga</span>
        </Link>
      </div>

      {/* Main Header Card */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        <div className="p-6 sm:p-7 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-5">
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
                  BUKU HARGA SATUAN KONTRAK
                </span>
                <StatusBadge status={book.status} />
                {isDraft && (
                  <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-100 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                    Menunggu Persetujuan Manager / Admin
                  </span>
                )}
              </div>

              <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                {book.name}
              </h1>

              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500 dark:text-slate-400 font-mono">
                {book.contract_reference && <span>Nomor Kontrak: <strong>{book.contract_reference}</strong></span>}
                <span>Berlaku Mulai: <strong>{book.valid_from}</strong></span>
                {book.valid_until && <span>S/d: <strong>{book.valid_until}</strong></span>}
                {book.source_reference && <span>Sumber SK: <strong>{book.source_reference}</strong></span>}
              </div>
            </div>

            {/* Header Action Buttons */}
            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              {isDraft && canApprove && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => setActionDialog({ type: 'approve' })}
                >
                  <IconCheck size={16} />
                  <span>Setujui Buku Harga</span>
                </Button>
              )}

              {isApproved && canApprove && (
                <button
                  type="button"
                  onClick={() => setActionDialog({ type: 'retire' })}
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
                >
                  <IconTrash size={13} />
                  <span>Nonaktifkan Buku</span>
                </button>
              )}
            </div>
          </div>

          {/* Quick Metrics Bar */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-6 pt-5 border-t border-slate-100 dark:border-slate-800 text-xs">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
              <span className="text-slate-500 block text-[11px]">Total Item KHS</span>
              <span className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
                {book.items_count} Item
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
              <span className="text-slate-500 block text-[11px]">Penetapan Zona UP3</span>
              <span className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
                {book.zones?.length || 0} Unit UP3
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
              <span className="text-slate-500 block text-[11px]">Pilihan Zona Tersedia</span>
              <span className="text-base font-bold text-blue-600 dark:text-blue-400 font-mono">
                {availableZones.length > 0 ? availableZones.map((z) => `Zona ${z}`).join(', ') : '-'}
              </span>
            </div>
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50">
              <span className="text-slate-500 block text-[11px]">Dibuat / Disetujui</span>
              <div className="text-[11px] text-slate-700 dark:text-slate-300 truncate">
                {book.approved_by ? `Disetujui: ${book.approved_by}` : `Dibuat: ${book.created_by || '-'}`}
              </div>
            </div>
          </div>
        </div>

        {/* Tab Navigation */}
        <div className="flex border-b border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 px-6 gap-6">
          <button
            type="button"
            onClick={() => setActiveTab('zones')}
            className={`flex items-center gap-2 border-b-2 py-3.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
              activeTab === 'zones'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <IconMapPin size={16} />
            <span>Zona per UP3 ({book.zones?.length || 0})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('items')}
            className={`flex items-center gap-2 border-b-2 py-3.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
              activeTab === 'items'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <IconFileText size={16} />
            <span>Item KHS & Tarif Jasa ({book.items_count})</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('events')}
            className={`flex items-center gap-2 border-b-2 py-3.5 text-xs sm:text-sm font-semibold transition-colors cursor-pointer ${
              activeTab === 'events'
                ? 'border-blue-600 text-blue-600 dark:text-blue-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <IconClock size={16} />
            <span>Riwayat Audit ({book.events?.length || 0})</span>
          </button>
        </div>

        {/* Tab 1: Zona per UP3 */}
        {activeTab === 'zones' && (
          <div className="p-6 space-y-5">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Pemetaan Zona Tarif Pekerjaan Jasa per UP3
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Setiap unit kerja UP3 memiliki koefisien zona tarif jasa pasang & bongkar (mis. Zona 1, 2, 3, atau 5) yang berlaku untuk seluruh permohonan/RAB di bawah unit tersebut.
                </p>
              </div>

              {isDraft && canManage && (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    loadUnits()
                    setZoneModalOpen(true)
                  }}
                >
                  <IconMapPin size={14} />
                  <span>Tetapkan / Ubah Zona UP3</span>
                </Button>
              )}
            </div>

            {!isDraft && (
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 text-xs text-slate-600 dark:text-slate-400 flex items-center gap-2">
                <IconExclamation size={16} className="text-slate-400 shrink-0" />
                <span>
                  Buku harga ini berstatus <strong>{book.status}</strong>. Penetapan zona UP3 bersifat tetap (immutable) dan hanya dapat diatur saat berstatus DRAFT.
                </span>
              </div>
            )}

            {/* Table of Zones */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
              {book.zones && book.zones.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                      <tr>
                        <th className="p-3.5">Kode Unit</th>
                        <th className="p-3.5">Nama Unit UP3</th>
                        <th className="p-3.5">Zona Tarif Berlaku</th>
                        <th className="p-3.5 text-right">Status Tarif Jasa</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {book.zones
                        .slice((zonePage - 1) * zonePerPage, zonePage * zonePerPage)
                        .map((z, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="p-3.5 font-mono font-bold text-slate-800 dark:text-slate-200">
                            {z.code}
                          </td>
                          <td className="p-3.5 font-medium text-slate-900 dark:text-slate-100">
                            {z.name}
                          </td>
                          <td className="p-3.5">
                            <span className="px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-900 font-bold font-mono">
                              Zona {z.zone}
                            </span>
                          </td>
                          <td className="p-3.5 text-right">
                            <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
                              <IconCheck size={13} /> Aktif Terpetakan
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState
                  icon={IconMapPin}
                  title="Belum ada penetapan zona UP3"
                  description="Belum ada unit kerja UP3 yang dipetakan ke zona tarif buku harga ini."
                />
              )}

              <TableFooter
                itemCount={book.zones ? book.zones.slice((zonePage - 1) * zonePerPage, zonePage * zonePerPage).length : 0}
                total={book.zones?.length || 0}
                entityLabel="zona UP3"
                page={zonePage}
                perPage={zonePerPage}
                onPage={setZonePage}
                onPerPage={(n) => {
                  setZonePerPage(n)
                  setZonePage(1)
                }}
                perPageOptions={[10, 25, 50, 100]}
              />
            </div>
          </div>
        )}

        {/* Tab 2: Item KHS & Tarif Jasa */}
        {activeTab === 'items' && (
          <div className="p-6 space-y-5">
            {/* Filters Bar */}
            <div className="flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
              <div className="relative flex-1 max-w-md">
                <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
                  <IconSearch size={15} />
                </span>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value)
                    setPage(1)
                  }}
                  placeholder="Cari kode KHS atau nama item material/jasa..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
                />
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={materialStatus}
                  onChange={(e) => {
                    setMaterialStatus(e.target.value)
                    setPage(1)
                  }}
                  className="px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 focus-ring"
                >
                  <option value="">Semua Status Material</option>
                  <option value="PLN">PLN (Material Disediakan PLN / Non-RAB)</option>
                  <option value="PRICED">PRICED (Material Dibeli Vendor)</option>
                </select>

                <button
                  type="button"
                  onClick={loadItems}
                  className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500"
                >
                  <IconRefresh size={14} />
                </button>
              </div>
            </div>

            {/* Items Table */}
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto shadow-xs">
              {itemsLoading ? (
                <div className="p-12 text-center">
                  <Spinner label="Memuat item buku harga..." />
                </div>
              ) : items.length === 0 ? (
                <EmptyState
                  icon={IconTag}
                  title="Belum ada item KHS"
                  description="Tidak ditemukan item yang cocok dengan kriteria pencarian atau buku harga belum memiliki item."
                />
              ) : (
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                    <tr>
                      <th className="p-3 w-16">Kode</th>
                      <th className="p-3 min-w-[200px]">Nama Item KHS</th>
                      <th className="p-3">Status Material</th>
                      <th className="p-3 text-right">Harga Material</th>
                      {availableZones.map((z) => (
                        <th key={z} className="p-3 text-center border-l border-slate-200 dark:border-slate-700">
                          Zona {z} (Pasang / Bongkar)
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {items.map((i, idx) => {
                      const isPln = i.material_status === 'PLN'
                      return (
                        <tr key={idx} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                          <td className="p-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                            {i.khs_code}
                          </td>
                          <td className="p-3 font-medium text-slate-800 dark:text-slate-200">
                            {i.name}
                          </td>
                          <td className="p-3">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                isPln
                                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              }`}
                            >
                              {isPln ? 'Material PLN (Non-RAB)' : 'Dibeli Vendor (PRICED)'}
                            </span>
                          </td>
                          <td className="p-3 text-right font-mono font-semibold text-slate-800 dark:text-slate-200">
                            {isPln ? '-' : formatRupiah(i.material_price)}
                          </td>

                          {availableZones.map((z) => {
                            const svc = i.service?.[String(z)]
                            return (
                              <td
                                key={z}
                                className="p-3 text-center font-mono text-[11px] border-l border-slate-100 dark:border-slate-800"
                              >
                                {svc ? (
                                  <div className="space-y-0.5">
                                    <div className="text-emerald-600 dark:text-emerald-400" title="Tarif Pasang">
                                      Psg: {formatRupiah(svc.install)}
                                    </div>
                                    <div className="text-slate-400" title="Tarif Bongkar">
                                      Bkr: {formatRupiah(svc.remove)}
                                    </div>
                                  </div>
                                ) : (
                                  <span className="text-slate-400">-</span>
                                )}
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* Standardized Table Footer */}
            <TableFooter
              meta={itemsMeta}
              itemCount={items.length}
              total={itemsMeta?.total ?? items.length}
              entityLabel="item KHS"
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
        )}

        {/* Tab 3: Riwayat Audit Events */}
        {activeTab === 'events' && (
          <div className="p-6 space-y-4">
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-2">
              Linimasa Peristiwa Audit Buku Harga
            </h3>

            {book.events && book.events.length > 0 ? (
              <div className="relative pl-6 space-y-6 before:content-[''] before:absolute before:left-2 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-700">
                {book.events.map((e, idx) => (
                  <div key={idx} className="relative space-y-1 text-xs">
                    <div className="absolute -left-6 top-1 w-3.5 h-3.5 rounded-full bg-blue-600 ring-4 ring-white dark:ring-slate-900" />
                    <div className="flex items-center gap-2">
                      <span className="font-bold text-slate-800 dark:text-slate-200 font-mono">
                        {e.event_type}
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono">{e.occurred_at}</span>
                      {e.actor_email && (
                        <span className="text-[11px] text-slate-500">({e.actor_email})</span>
                      )}
                    </div>
                    {e.reason && (
                      <p className="text-slate-600 dark:text-slate-400 italic">
                        Alasan: &ldquo;{e.reason}&rdquo;
                      </p>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <div className="p-8 text-center text-slate-400 text-xs">
                Belum ada catatan peristiwa audit.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Set Zone Modal (PUT /zones) */}
      {zoneModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="relative w-full max-w-lg rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl p-6 space-y-5">
            <div className="flex items-start justify-between border-b border-slate-100 dark:border-slate-800 pb-3 gap-2">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Tetapkan / Ubah Zona UP3
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Tentukan zona tarif yang diberlakukan untuk unit kerja UP3 pada buku harga kontrak ini.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setZoneModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
                aria-label="Tutup dialog zona"
                title="Tutup (Esc)"
              >
                <IconX size={16} />
              </button>
            </div>

            {zoneError && <Alert kind="error">{zoneError}</Alert>}

            <form onSubmit={handleSetZoneSubmit} className="space-y-4 text-xs">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Pilih Unit UP3 <span className="text-rose-500">*</span>
                </label>
                {loadingUnits ? (
                  <div className="py-2 text-slate-400">Memuat daftar unit UP3...</div>
                ) : (
                  <select
                    aria-label="Pilih Unit UP3"
                    required
                    value={selectedUnitId}
                    onChange={(e) => setSelectedUnitId(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
                  >
                    <option value="">-- Pilih Unit Kerja UP3 --</option>
                    {up3Units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code} - {u.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Pilih Zona Tarif <span className="text-rose-500">*</span>
                </label>
                <select
                  aria-label="Pilih Zona Tarif"
                  required
                  value={selectedZone}
                  onChange={(e) => setSelectedZone(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring font-mono"
                >
                  <option value="">-- Pilih Zona --</option>
                  {availableZones.map((z) => (
                    <option key={z} value={z}>
                      Zona {z}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Alasan Penetapan / Perubahan Zona <span className="text-rose-500">*</span>
                </label>
                <textarea
                  required
                  rows={3}
                  maxLength={1000}
                  value={zoneReason}
                  onChange={(e) => setZoneReason(e.target.value)}
                  placeholder="Jelaskan dasar surat penetapan wilayah kerja UP3 terhadap zona tarif kontrak..."
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setZoneModalOpen(false)}
                  disabled={zoneSaving}
                >
                  Batal
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={zoneSaving}
                >
                  {zoneSaving ? <Spinner size="sm" /> : <IconCheck size={14} />}
                  <span>{zoneSaving ? 'Menyimpan...' : 'Simpan Penetapan Zona'}</span>
                </Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Approve / Retire Reason Dialog */}
      {actionDialog && (
        <ReasonDialog
          isOpen={true}
          title={
            actionDialog.type === 'approve'
              ? `Persetujuan Buku Harga: ${book.name}`
              : `Nonaktifkan Buku Harga: ${book.name}`
          }
          description={
            actionDialog.type === 'approve'
              ? 'Persetujuan oleh Manager UP3 / SYS_ADMIN akan mengaktifkan buku harga ini sebagai referensi resmi perhitungan RAB. Seluruh buku harga aktif terdahulu akan ditutup secara otomatis.'
              : 'Menonaktifkan buku harga ini akan menjadikannya berstatus INACTIVE dan tidak dapat dipilih lagi untuk perhitungan RAB baru.'
          }
          confirmLabel={actionDialog.type === 'approve' ? 'Setujui Sekarang' : 'Nonaktifkan Buku'}
          confirmVariant={actionDialog.type === 'approve' ? 'primary' : 'danger'}
          onConfirm={handleConfirmAction}
          onClose={() => {
            setActionDialog(null)
            setActionError('')
          }}
          error={actionError}
        />
      )}
    </div>
  )
}
