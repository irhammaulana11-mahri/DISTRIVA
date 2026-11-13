import { useEffect, useState, useCallback } from 'react'
import { poleContractsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'

import Drawer from '../../components/Drawer.jsx'
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

export default function PoleContractsPage() {
  const { can } = useAccess()
  const { notify } = useNotifications()
  const canManage = Boolean(can?.['poles.manage'])

  const [contracts, setContracts] = useState([])
  const [options, setOptions] = useState({ vendors: [], up3: [] })
  const [createVendor, setCreateVendor] = useState('')
  const [createUp3, setCreateUp3] = useState('')
  const [updateVendor, setUpdateVendor] = useState('')
  const [updateUp3, setUpdateUp3] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  // Modal Create
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [createKrNumber, setCreateKrNumber] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createLines, setCreateLines] = useState([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Modal Update
  const [updateModalOpen, setUpdateModalOpen] = useState(false)
  const [selectedContract, setSelectedContract] = useState(null)
  const [updateQtyTm, setUpdateQtyTm] = useState('')
  const [updateQtyTr, setUpdateQtyTr] = useState('')
  const [updateLines, setUpdateLines] = useState([])
  const [updateDescription, setUpdateDescription] = useState('')
  const [updateReason, setUpdateReason] = useState('')
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState('')

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
      const res = await poleContractsApi.list()
      setContracts(res?.data || [])
      if (res?.options) setOptions({ vendors: res.options.vendors || [], up3: res.options.up3 || [] })
    } catch (err) {
      setError(err?.message || 'Gagal memuat daftar Kontrak Rinci tiang.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadContracts()
  }, [loadContracts])

  // Handle Create
  const handleCreate = async (e) => {
    e.preventDefault()
    setCreateError('')
    if (createLines.length === 0) {
      setCreateError('Tambahkan minimal satu baris material tiang.')
      return
    }
    const invalid = validateLines(createLines)
    if (invalid) {
      setCreateError(invalid)
      return
    }
    setCreating(true)
    try {
      await poleContractsApi.create({
        kr_number: createKrNumber.trim(),
        description: createDescription.trim() || undefined,
        vendor_company_id: createVendor || undefined,
        up3_unit_id: createUp3 || undefined,
        lines: toApiLines(createLines),
      })
      notify({
        type: 'success',
        title: 'Kontrak Rinci Dibuat',
        desc: `Kontrak Rinci ${createKrNumber} berhasil didaftarkan.`,
        tag: 'TIANG',
      })
      setCreateModalOpen(false)
      setCreateVendor('')
      setCreateUp3('')
      setCreateKrNumber('')
      setCreateDescription('')
      setCreateLines([])
      loadContracts()
    } catch (err) {
      setCreateError(err?.message || 'Gagal membuat Kontrak Rinci.')
    } finally {
      setCreating(false)
    }
  }

  // Handle Update
  const handleUpdate = async (e) => {
    e.preventDefault()
    if (!selectedContract) return
    setUpdateError('')
    if (!updateReason.trim()) {
      setUpdateError('Alasan perubahan wajib diisi.')
      return
    }
    // KR berbaris, atau KR lama yang kini ditambah baris: kirim seluruh baris
    // (server menghitung qty_tm/qty_tr). KR lama tanpa baris: isian TM/TR.
    const sendLines = updateLines.length > 0
    if (sendLines) {
      const invalid = validateLines(updateLines)
      if (invalid) {
        setUpdateError(invalid)
        return
      }
    }
    setUpdating(true)
    try {
      const body = {
        description: updateDescription.trim() || undefined,
        vendor_company_id: updateVendor || null,
        up3_unit_id: updateUp3 || null,
        reason: updateReason.trim(),
      }
      if (sendLines) {
        body.lines = toApiLines(updateLines)
      } else {
        body.qty_tm = updateQtyTm !== '' ? Number(updateQtyTm) : undefined
        body.qty_tr = updateQtyTr !== '' ? Number(updateQtyTr) : undefined
      }
      await poleContractsApi.update(selectedContract.id, body)
      notify({
        type: 'success',
        title: 'Kontrak Rinci Diperbarui',
        desc: `Kuantitas Kontrak Rinci ${selectedContract.kr_number} berhasil disesuaikan.`,
        tag: 'TIANG',
      })
      setUpdateModalOpen(false)
      loadContracts()
    } catch (err) {
      setUpdateError(err?.message || 'Gagal memperbarui Kontrak Rinci.')
    } finally {
      setUpdating(false)
    }
  }

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

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <nav className="text-xs text-slate-500 mb-1">
            <span>DISTRIVA</span>
            <span className="mx-1.5">/</span>
            <span>Master Data</span>
            <span className="mx-1.5">/</span>
            <span className="text-slate-800 dark:text-slate-200 font-medium">Kontrak Rinci Tiang</span>
          </nav>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            Kontrak Rinci (KR) Tiang
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            Pencatatan alokasi kuota tiang TM dan TR per Kontrak Rinci pabrikan/vendor untuk proyek distribusi.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {canManage && (
            <button
              type="button"
              onClick={() => {
                setCreateModalOpen(true)
                setCreateError('')
              }}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-4 py-2 text-sm shadow-xs transition focus-ring cursor-pointer"
            >
              <IconPlus size={16} />
              <span>Tambah Kontrak Rinci</span>
            </button>
          )}
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Main Table Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
          <div className="relative flex-1 max-w-xs">
            <IconSearch size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              type="text"
              placeholder="Cari nomor KR atau uraian..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="block w-full pl-8 pr-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
            />
          </div>
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
                              onClick={() => {
                                setSelectedContract(c)
                                setUpdateQtyTm(c.tm?.total ?? '')
                                setUpdateQtyTr(c.tr?.total ?? '')
                                setUpdateLines(
                                  (c.lines || []).map((l) => ({
                                    khs_item_id: l.khs_item_id,
                                    khs_code: l.khs_code,
                                    khs_name: l.khs_name,
                                    pole_type: l.pole_type,
                                    quantity: l.total,
                                  })),
                                )
                                setUpdateDescription(c.description || '')
                setUpdateVendor(c.vendor_company_id || '')
                setUpdateUp3(c.up3_unit_id || '')
                                setUpdateReason('')
                                setUpdateError('')
                                setUpdateModalOpen(true)
                              }}
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

      {/* MODAL 1: Create Pole Contract */}
      <Drawer
        open={createModalOpen}
        title="Tambah Kontrak Rinci (KR) Tiang"
        onClose={() => setCreateModalOpen(false)}
        width="max-w-3xl"
        footer={null}
      >
        <form onSubmit={handleCreate} className="space-y-4 text-xs">
          {createError && <Alert kind="error">{createError}</Alert>}

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Nomor Kontrak Rinci (KR) *
            </label>
            <input
              type="text"
              required
              value={createKrNumber}
              onChange={(e) => setCreateKrNumber(e.target.value)}
              placeholder="Contoh: KR-2026-MJK-01"
              className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
            />
          </div>

          <KrLinesEditor lines={createLines} onChange={setCreateLines} />

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Uraian / Keterangan Kontrak
            </label>
            <input
              type="text"
              value={createDescription}
              onChange={(e) => setCreateDescription(e.target.value)}
              placeholder="Contoh: Pengadaan Tiang Beton Spun Distribusi PT WIKA Beton"
              className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Vendor tiang pemilik KR</span>
              <select value={createVendor} onChange={(e) => setCreateVendor(e.target.value)} className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800">
                <option value="">— belum ditentukan —</option>
                {options.vendors.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">UP3 pemilik KR (opsional)</span>
              <select value={createUp3} onChange={(e) => setCreateUp3(e.target.value)} className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800">
                <option value="">— tidak dicatat —</option>
                {options.up3.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCreateModalOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={creating}>
              Simpan Kontrak Rinci
            </Button>
          </div>
        </form>
      </Drawer>

      {/* MODAL 2: Update Pole Contract */}
      {selectedContract && (
        <Drawer
          open={updateModalOpen}
          title={`Ubah Kontrak Rinci: ${selectedContract.kr_number}`}
          onClose={() => setUpdateModalOpen(false)}
          width="max-w-3xl"
          footer={null}
        >
          <form onSubmit={handleUpdate} className="space-y-4 text-xs">
            {updateError && <Alert kind="error">{updateError}</Alert>}

            {(selectedContract.lines || []).length > 0 || updateLines.length > 0 ? (
              <KrLinesEditor lines={updateLines} onChange={setUpdateLines} />
            ) : null}
            {updateLines.length === 0 && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Kuantitas Tiang TM (Batang)
                </label>
                <input
                  type="number"
                  min="0"
                  value={updateQtyTm}
                  onChange={(e) => setUpdateQtyTm(e.target.value)}
                  className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Kuantitas Tiang TR (Batang)
                </label>
                <input
                  type="number"
                  min="0"
                  value={updateQtyTr}
                  onChange={(e) => setUpdateQtyTr(e.target.value)}
                  className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 font-mono"
                />
              </div>
            </div>
            )}
            {updateLines.length === 0 && (
              <button
                type="button"
                onClick={() =>
                  setUpdateLines([{ khs_item_id: '', khs_code: '', khs_name: '', pole_type: 'TM', quantity: '' }])
                }
                className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
              >
                + Tambah baris material tiang (KR dihitung dari baris)
              </button>
            )}

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Uraian / Keterangan
              </label>
              <input
                type="text"
                value={updateDescription}
                onChange={(e) => setUpdateDescription(e.target.value)}
                className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Vendor tiang pemilik KR</span>
              <select value={updateVendor} onChange={(e) => setUpdateVendor(e.target.value)} className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800">
                <option value="">— belum ditentukan —</option>
                {options.vendors.map((x) => <option key={x.id} value={x.id}>{x.name} ({x.code})</option>)}
              </select>
            </label>
            <label className="block">
              <span className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">UP3 pemilik KR (opsional)</span>
              <select value={updateUp3} onChange={(e) => setUpdateUp3(e.target.value)} className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800">
                <option value="">— tidak dicatat —</option>
                {options.up3.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
              </select>
            </label>
          </div>

            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Alasan Perubahan * (Wajib untuk catatan audit trail)
              </label>
              <textarea
                rows={2}
                required
                value={updateReason}
                onChange={(e) => setUpdateReason(e.target.value)}
                placeholder="Contoh: Penyesuaian adendum volume tiang dari pabrikan..."
                className="block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              />
            </div>

            <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setUpdateModalOpen(false)}
              >
                Batal
              </Button>
              <Button type="submit" variant="primary" size="sm" loading={updating} disabled={!updateReason.trim()}>
                Simpan Perubahan
              </Button>
            </div>
          </form>
        </Drawer>
      )}

      {/* MODAL 3: Close Pole Contract */}
      {selectedContract && (
        <Drawer
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
        </Drawer>
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
