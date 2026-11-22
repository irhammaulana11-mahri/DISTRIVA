import { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { poleContractsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import SearchSelect from '../../components/SearchSelect.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'

import Drawer from '../../components/Drawer.jsx'
import Modal from '../../components/Modal.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import KrLinesEditor, { toApiLines, validateLines } from './KrLinesEditor.jsx'
import {
  IconPlus,
  IconRefresh,
  IconSearch,
  IconEye,
  IconPencil,
  IconTrash,
  IconCheck,
  IconX,
  IconAlertCircle,
  IconClock,
  IconClipboard,
} from '../../components/icons.jsx'
import { filterSearchCls } from '../../components/filterStyles.js'

export default function PoleContractsPage() {
  const navigate = useNavigate()
  const { can } = useAccess()
  const { notify } = useNotifications()
  const canManage = Boolean(can?.['poles.manage'])

  const [contracts, setContracts] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [up3Id, setUp3Id] = useState('')
  const [up3Options, setUp3Options] = useState([])
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  // Modal Create

  // Modal Update
  const [selectedContract, setSelectedContract] = useState(null)

  // Modal Close
  const [closeModalOpen, setCloseModalOpen] = useState(false)
  const [closeReason, setCloseReason] = useState('')
  const [closing, setClosing] = useState(false)
  const [closeError, setCloseError] = useState('')

  // Drawer Detail & Audit Trail
  const [detailDrawerOpen, setDetailDrawerOpen] = useState(false)
  const [contractDetail, setContractDetail] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)

  // Load contracts
  const loadContracts = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await poleContractsApi.list({ up3_id: up3Id || undefined })
      setContracts(res?.data || [])
      setUp3Options(res?.options?.up3 || [])
    } catch (err) {
      setError(err?.message || 'Gagal memuat daftar Kontrak Rinci tiang.')
    } finally {
      setLoading(false)
    }
  }, [up3Id])

  useEffect(() => {
    loadContracts()
  }, [loadContracts])

  // Handle Close
  const handleCloseContract = async (e) => {
    e.preventDefault()
    if (!selectedContract) return
    setClosing(true)
    setCloseError('')
    try {
      await poleContractsApi.close(selectedContract.id, {
        reason: closeReason.trim(),
      })
      notify({
        type: 'success',
        title: 'Kontrak Rinci Ditutup',
        desc: `Kontrak Rinci ${selectedContract.kr_number} telah ditutup secara permanen.`,
        tag: 'TIANG',
      })
      setCloseModalOpen(false)
      loadContracts()
    } catch (err) {
      setCloseError(err?.message || 'Gagal menutup Kontrak Rinci.')
    } finally {
      setClosing(false)
    }
  }

  // View Detail & Events
  const handleViewDetail = async (contract) => {
    setSelectedContract(contract)
    setDetailDrawerOpen(true)
    setLoadingDetail(true)
    try {
      const res = await poleContractsApi.get(contract.id)
      setContractDetail(res?.data || null)
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Memuat Detail',
        desc: err?.message || 'Tidak dapat memuat detail Kontrak Rinci.',
        tag: 'TIANG',
      })
    } finally {
      setLoadingDetail(false)
    }
  }

  const filtered = contracts.filter((c) => {
    if (!search) return true
    const s = search.toLowerCase()
    return (
      c.kr_number.toLowerCase().includes(s) ||
      (c.description || '').toLowerCase().includes(s)
    )
  })

  // Metrik KPI Tiang
  const activeContractsCount = contracts.filter((c) => c.status === 'ACTIVE').length
  const totalPolesQuota = contracts.reduce((acc, c) => acc + (Number(c.tm?.total) || 0) + (Number(c.tr?.total) || 0), 0)
  const totalPolesRemaining = contracts.reduce((acc, c) => acc + (Number(c.tm?.remaining) || 0) + (Number(c.tr?.remaining) || 0), 0)

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
              <IconClipboard className="h-6 w-6" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Kontrak Rinci (KR) Tiang
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Pabrikan &amp; Vendor Tiang
                </span>
                <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  Kuota TM &amp; TR
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">
                Pencatatan alokasi kuota tiang TM dan TR per Kontrak Rinci pabrikan/vendor untuk proyek distribusi dan pengendalian utang kerja tiang.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="secondary"
              size="md"
              onClick={loadContracts}
              icon={IconRefresh}
              aria-label="Segarkan data kontrak tiang"
            >
              Segarkan
            </Button>
            {canManage && (
              <Button
                variant="primary"
                size="md"
                icon={IconPlus}
                onClick={() => navigate('/master-data/pole-contracts/baru')}
              >
                Tambah Kontrak Rinci
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Ringkasan Metrik Kontrak Tiang */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Kontrak Rinci</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconClipboard className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {contracts.length.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Nomor KR terdaftar</p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Kontrak Berstatus Aktif</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheck className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {activeContractsCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Dapat dialokasikan ke SPK</p>
        </div>

        <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-blue-700 dark:text-blue-400">Total Kuota Tiang (TM+TR)</dt>
            <div className="rounded-lg p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <IconClock className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {totalPolesQuota.toLocaleString('id-ID')} <span className="text-sm font-normal text-slate-500">btg</span>
          </dd>
          <p className="mt-1 text-xs text-blue-600/70 dark:text-blue-500/70">Total komitmen pabrikan</p>
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-amber-700 dark:text-amber-400">Sisa Kuota Belum Alokasi</dt>
            <div className="rounded-lg p-1.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
              <IconAlertCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {totalPolesRemaining.toLocaleString('id-ID')} <span className="text-sm font-normal text-slate-500">btg</span>
          </dd>
          <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-500/70">Kapasitas siap pakai</p>
        </div>
      </dl>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Main Table Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xs">
            <IconSearch size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              placeholder="Cari nomor KR atau uraian..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className={`${filterSearchCls} w-full`}
            />
          </div>
          <SearchSelect
            variant="filter"
            ariaLabel="Filter Unit UP3"
            options={[{ value: '', label: 'Semua UP3' }, ...up3Options.map((u) => ({ value: u.id, label: u.name }))]}
            value={up3Id}
            onChange={(v) => { setUp3Id(v); setPage(1) }}
            placeholder="Cari UP3…"
            className="w-48"
          />
          <span className="text-xs text-slate-500 font-mono">
            {filtered.length} Kontrak Rinci
          </span>
        </div>

        {loading ? (
          <div className="py-20 text-center text-slate-500">
            <Spinner size="lg" label="Memuat Kontrak Rinci..." />
          </div>
        ) : filtered.length === 0 ? (
          <EmptyState
            icon={IconClipboard}
            title="Belum ada kontrak rinci"
            description="Katalog kontrak rinci (KR) tiang masih kosong. Klik tombol &quot;Tambah Kontrak Rinci&quot; untuk menambahkan pasokan tiang baru."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                  <th className="py-3 px-4">Nomor KR</th>
                  <th className="py-3 px-4">Deskripsi / Uraian</th>
                  <th className="py-3 px-4 text-center">Tiang TM (Total / Pakai / Sisa)</th>
                  <th className="py-3 px-4 text-center">Tiang TR (Total / Pakai / Sisa)</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-sans text-xs">
                {filtered
                  .slice((page - 1) * perPage, page * perPage)
                  .map((c) => (
                  <tr
                    key={c.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">
                      {c.kr_number}
                      {c.in_debt && <span className="ml-2 px-1.5 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 text-[10px] font-sans font-bold" title="Alokasi melebihi kuota; menjadi utang kerja">Utang kerja</span>}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400 max-w-xs truncate">
                      {c.description || '-'}
                      {(c.vendor_name || c.up3_name) && (
                        <div className="text-[10px] text-slate-500 truncate">{[c.vendor_name, c.up3_name && `UP3 ${c.up3_name}`].filter(Boolean).join(' · ')}</div>
                      )}
                    </td>
                    <td className="py-3 px-4 text-center font-mono">
                      <span className="text-slate-700 dark:text-slate-300 font-semibold">
                        {c.tm?.total}
                      </span>
                      <span className="text-slate-400 mx-1">/</span>
                      <span className="text-amber-600 font-semibold">
                        {c.tm?.allocated}
                      </span>
                      <span className="text-slate-400 mx-1">/</span>
                      <span
                        className={`font-bold ${
                          c.tm?.remaining > 0 ? 'text-emerald-600' : c.tm?.remaining < 0 ? 'text-rose-700' : 'text-slate-500'
                        }`}
                      >
                        {c.tm?.remaining}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-center font-mono">
                      <span className="text-slate-700 dark:text-slate-300 font-semibold">
                        {c.tr?.total}
                      </span>
                      <span className="text-slate-400 mx-1">/</span>
                      <span className="text-amber-600 font-semibold">
                        {c.tr?.allocated}
                      </span>
                      <span className="text-slate-400 mx-1">/</span>
                      <span
                        className={`font-bold ${
                          c.tr?.remaining > 0 ? 'text-emerald-600' : c.tr?.remaining < 0 ? 'text-rose-700' : 'text-slate-500'
                        }`}
                      >
                        {c.tr?.remaining}
                      </span>
                    </td>
                    <td className="py-3 px-4">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          c.status === 'ACTIVE'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex items-center justify-end gap-1.5 flex-wrap">
                        <button
                          type="button"
                          onClick={() => handleViewDetail(c)}
                          className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200 text-xs transition-colors cursor-pointer"
                        >
                          <IconEye size={13} />
                          <span>Detail</span>
                        </button>

                        {canManage && c.status === 'ACTIVE' && (
                          <>
                            <button
                              type="button"
                              onClick={() => navigate(`/master-data/pole-contracts/${c.id}/ubah`)}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 font-semibold text-slate-700 dark:text-slate-200 text-xs transition-colors cursor-pointer"
                            >
                              <IconPencil size={13} />
                              <span>Ubah</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedContract(c)
                                setCloseReason('')
                                setCloseError('')
                                setCloseModalOpen(true)
                              }}
                              aria-label="Tutup"
                              title="Nonaktifkan / Tutup Kontrak Rinci"
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-rose-200 dark:border-rose-800 hover:bg-rose-50 dark:hover:bg-rose-950/50 text-rose-600 dark:text-rose-400 font-semibold text-xs transition-colors cursor-pointer"
                            >
                              <IconTrash size={13} />
                              <span>Nonaktifkan</span>
                            </button>
                          </>
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
          itemCount={filtered.slice((page - 1) * perPage, page * perPage).length}
          total={filtered.length}
          entityLabel="kontrak rinci tiang"
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

      {/* MODAL 3: Close Pole Contract */}
      {selectedContract && (
        <Modal
          open={closeModalOpen}
          title={`Tutup Kontrak Rinci: ${selectedContract.kr_number}`}
          onClose={() => setCloseModalOpen(false)}
          footer={null}
        >
          <form onSubmit={handleCloseContract} className="space-y-4 text-xs">
            {closeError && <Alert kind="error">{closeError}</Alert>}

            <p className="text-slate-600 dark:text-slate-300">
              Apakah Anda yakin ingin menutup Kontrak Rinci ini? Kontrak Rinci yang ditutup tidak dapat digunakan lagi untuk alokasi baru.
            </p>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Penutupan * (Wajib untuk catatan audit trail)
              </label>
              <textarea
                rows={2}
                required
                value={closeReason}
                onChange={(e) => setCloseReason(e.target.value)}
                placeholder="Contoh: Masa kontrak pengadaan berakhir dan sisa kuota hangus..."
                className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setCloseModalOpen(false)}
              >
                Batal
              </Button>
              <Button type="submit" variant="primary" size="sm" loading={closing} disabled={!closeReason.trim()}>
                Tutup Kontrak
              </Button>
            </div>
          </form>
        </Modal>
      )}

      {/* DRAWER: Detail & Events Audit Trail */}
      {selectedContract && (
        <Drawer
          isOpen={detailDrawerOpen}
          onClose={() => setDetailDrawerOpen(false)}
          title={`Detail Kontrak Rinci: ${selectedContract.kr_number}`}
          subtitle={selectedContract.description || 'Pencatatan alokasi tiang distribusi'}
          width="max-w-2xl"
          footer={
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setDetailDrawerOpen(false)}
            >
              Tutup
            </Button>
          }
        >
          {loadingDetail ? (
            <div className="py-12 text-center text-slate-500">
              <Spinner size="md" label="Memuat riwayat kontrak..." />
            </div>
          ) : !contractDetail ? (
            <div className="p-8 text-center text-slate-400 text-xs">
              Detail tidak ditemukan.
            </div>
          ) : (
            <div className="space-y-5 text-xs">
              {/* Summary Cards */}
              <div className="grid grid-cols-2 gap-3">
                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40">
                  <span className="font-semibold text-slate-600 dark:text-slate-400 block mb-1">
                    Kuota Tiang TM
                  </span>
                  <div className="flex items-baseline justify-between font-mono">
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {contractDetail.tm?.total} Batang
                    </span>
                    <span className="text-[11px] text-emerald-600">
                      Sisa: {contractDetail.tm?.remaining}
                    </span>
                  </div>
                  <span className="text-[10px] text-amber-600 block mt-0.5">
                    Teralokasi: {contractDetail.tm?.allocated}
                  </span>
                </div>

                <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/40">
                  <span className="font-semibold text-slate-600 dark:text-slate-400 block mb-1">
                    Kuota Tiang TR
                  </span>
                  <div className="flex items-baseline justify-between font-mono">
                    <span className="text-sm font-bold text-slate-900 dark:text-slate-100">
                      {contractDetail.tr?.total} Batang
                    </span>
                    <span className="text-[11px] text-emerald-600">
                      Sisa: {contractDetail.tr?.remaining}
                    </span>
                  </div>
                  <span className="text-[10px] text-amber-600 block mt-0.5">
                    Teralokasi: {contractDetail.tr?.allocated}
                  </span>
                </div>
              </div>

              {(contractDetail.lines || []).length > 0 && (
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">
                    Baris Material Tiang
                  </h4>
                  <div className="border border-slate-200 dark:border-slate-800 rounded-lg overflow-x-auto">
                    <table className="w-full text-left text-xs border-collapse">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                          <th className="py-2 px-3">Material</th>
                          <th className="py-2 px-3">Tipe</th>
                          <th className="py-2 px-3 text-right">Total</th>
                          <th className="py-2 px-3 text-right">Terplot</th>
                          <th className="py-2 px-3 text-right">Sisa</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                        {contractDetail.lines.map((l) => (
                          <tr key={l.khs_item_id}>
                            <td className="py-2 px-3">
                              <div className="font-mono font-bold">{l.khs_code}</div>
                              <div className="text-[11px] text-slate-500">{l.khs_name}</div>
                              {l.in_erp_stock && (
                                <span
                                  title="Stok ERP sudah memuat material ini; KR tidak lagi dihitung sebagai pasokan tambahan."
                                  className="inline-block mt-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300"
                                >
                                  Sudah masuk stok ERP
                                </span>
                              )}
                            </td>
                            <td className="py-2 px-3 font-bold">{l.pole_type}</td>
                            <td className="py-2 px-3 text-right font-mono">{l.total}</td>
                            <td className="py-2 px-3 text-right font-mono text-amber-600">{l.allocated}</td>
                            <td className="py-2 px-3 text-right font-mono font-bold text-emerald-600">{l.remaining}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {contractDetail.lines.some((l) => l.in_erp_stock) && (
                    <p className="mt-1.5 text-[11px] text-slate-500">
                      Stok ERP sudah memuat material ini; KR tidak lagi dihitung sebagai pasokan tambahan.
                    </p>
                  )}
                </div>
              )}

              {/* Events Audit Trail */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-1.5">
                  <IconClock size={14} />
                  <span>Riwayat Kejadian (Audit Trail)</span>
                </h4>

                {(contractDetail.events || []).length === 0 ? (
                  <div className="p-4 text-center text-slate-400 text-xs bg-slate-50 dark:bg-slate-800/30 rounded-lg">
                    Belum ada riwayat kejadian tercatat.
                  </div>
                ) : (
                  <div className="relative pl-4 space-y-3 before:absolute before:left-1.5 before:top-2 before:bottom-2 before:w-0.5 before:bg-slate-200 dark:before:bg-slate-700">
                    {(contractDetail.events || []).map((ev, idx) => (
                      <div key={idx} className="relative text-xs">
                        <div className="absolute -left-4 top-1 w-2.5 h-2.5 rounded-full bg-blue-500 border-2 border-white dark:border-slate-900" />
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-slate-800 dark:text-slate-200">
                            {ev.event_type}
                          </span>
                          <span className="text-[10px] text-slate-400">
                            {ev.occurred_at ? new Date(ev.occurred_at).toLocaleString('id-ID') : '-'}
                          </span>
                        </div>
                        <p className="text-[11px] text-slate-500 mt-0.5">
                          Oleh: {ev.actor_email}
                        </p>
                        {ev.reason && (
                          <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 italic bg-slate-50 dark:bg-slate-800/60 p-1.5 rounded">
                            &ldquo;{ev.reason}&rdquo;
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </Drawer>
      )}
    </div>
  )
}
