import { useCallback, useEffect, useMemo, useState } from 'react'
import { srVendorContractsApi, vendorsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { useScopedUnits } from '../../utils/unitScope.js'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import SearchSelect from '../../components/SearchSelect.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Modal from '../../components/Modal.jsx'
import TableFooter, { useTablePagination } from '../../components/TableFooter.jsx'
import { IconPlus, IconRefresh, IconClipboard, IconAlertCircle, IconSearch } from '../../components/icons.jsx'

export default function SrVendorContractsTab() {
  const { can, isSysAdmin } = useAccess()
  const { notify } = useNotifications()
  const canManage = Boolean(isSysAdmin || can?.['sr_vendor_contracts.manage'])

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [up3Id, setUp3Id] = useState('')
  const [unitId, setUnitId] = useState('')
  const unitInfo = useScopedUnits('sr_reservations.view')

  // Create modal
  const [createOpen, setCreateOpen] = useState(false)
  const [vendors, setVendors] = useState([])
  const [modalUp3Id, setModalUp3Id] = useState('')
  const [modalUlpSearch, setModalUlpSearch] = useState('')
  const [selectedUlpIds, setSelectedUlpIds] = useState([])
  const [form, setForm] = useState({
    vendor_company_id: '',
    contract_number: '',
    valid_from: new Date().toISOString().slice(0, 10),
    valid_until: '',
  })
  const [submitting, setSubmitting] = useState(false)

  // Edit modal
  const [editTarget, setEditTarget] = useState(null)
  const [editForm, setEditForm] = useState({ contract_number: '', valid_until: '' })

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await srVendorContractsApi.list()
      setRows(res?.data || [])
    } catch (err) {
      setError(err?.message || 'Gagal memuat kontrak pelaksana 1 phasa.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    load()
  }, [load])

  useEffect(() => {
    if (!createOpen) return
    vendorsApi.list({ status: 'ACTIVE', per_page: 200 })
      .then((res) => setVendors(res?.data || []))
      .catch(() => setVendors([]))
  }, [createOpen])

  const filteredRows = useMemo(() => {
    if (!up3Id && !unitId) return rows
    if (unitId) {
      return rows.filter((r) => String(r.unit?.id || '') === String(unitId))
    }
    const allowedIds = new Set(
      (unitInfo?.ulp_units || [])
        .filter((u) => String(u.parent_id) === String(up3Id))
        .map((u) => String(u.id)),
    )
    if (allowedIds.size === 0) return rows
    return rows.filter((r) => allowedIds.has(String(r.unit?.id || '')))
  }, [rows, up3Id, unitId, unitInfo])

  const { paginatedItems, tableFooterProps } = useTablePagination(filteredRows, 25)

  const up3Choices = useMemo(() => unitInfo?.up3_units || [], [unitInfo])
  const modalUlpChoices = useMemo(() => {
    const all = unitInfo?.ulp_units || []
    const byUp3 = modalUp3Id ? all.filter((u) => String(u.parent_id) === String(modalUp3Id)) : all
    const q = modalUlpSearch.trim().toLowerCase()
    if (!q) return byUp3
    return byUp3.filter((u) => `${u.code || ''} ${u.name || ''}`.toLowerCase().includes(q))
  }, [unitInfo, modalUp3Id, modalUlpSearch])

  const activeContractByUlp = useMemo(() => {
    const map = {}
    if (!form.valid_from) return map
    const newUntil = form.valid_until || '9999-12-31'
    rows.forEach((c) => {
      const uid = String(c.unit?.id || '')
      if (!uid) return
      const from = c.valid_from || ''
      const until = c.valid_until || '9999-12-31'
      if (form.valid_from <= until && newUntil >= from && !map[uid]) {
        map[uid] = c
      }
    })
    return map
  }, [rows, form.valid_from, form.valid_until])

  const overlappingContracts = useMemo(
    () => selectedUlpIds.map((id) => activeContractByUlp[id]).filter(Boolean),
    [selectedUlpIds, activeContractByUlp],
  )

  const vendorOptions = useMemo(
    () => [
      { value: '', label: 'Pilih vendor pelaksana…' },
      ...vendors.map((v) => ({ value: v.id, label: `${v.code ? `${v.code} - ` : ''}${v.name}` })),
    ],
    [vendors],
  )

  const toggleUlp = (id) => {
    const sId = String(id)
    setSelectedUlpIds((prev) => (prev.includes(sId) ? prev.filter((x) => x !== sId) : [...prev, sId]))
  }

  const handleCreate = async (e) => {
    e.preventDefault()
    if (selectedUlpIds.length === 0 || !form.vendor_company_id || !form.contract_number.trim() || !form.valid_from) {
      notify({ type: 'error', title: 'Data belum lengkap', desc: 'Pilih minimal 1 ULP, pelaksana, nomor kontrak, dan tanggal mulai.', tag: 'Kontrak 1 Phasa' })
      return
    }
    setSubmitting(true)
    try {
      for (const ulpUnitId of selectedUlpIds) {
        await srVendorContractsApi.create({
          organizational_unit_id: ulpUnitId,
          vendor_company_id: form.vendor_company_id,
          contract_number: form.contract_number.trim(),
          valid_from: form.valid_from,
          ...(form.valid_until ? { valid_until: form.valid_until } : {}),
        })
      }
      notify({
        type: 'success',
        title: 'Kontrak ditambahkan',
        desc: `Kontrak pelaksana 1 phasa berhasil disimpan untuk ${selectedUlpIds.length} ULP.`,
        tag: 'Kontrak 1 Phasa',
      })
      setCreateOpen(false)
      setSelectedUlpIds([])
      setForm({
        vendor_company_id: '',
        contract_number: '',
        valid_from: new Date().toISOString().slice(0, 10),
        valid_until: '',
      })
      load()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal menyimpan kontrak', desc: err?.message || 'Periksa apakah ULP sudah memiliki kontrak aktif pada tanggal tersebut.', tag: 'Kontrak 1 Phasa' })
    } finally {
      setSubmitting(false)
    }
  }

  const handleEdit = async (e) => {
    e.preventDefault()
    if (!editTarget) return
    setSubmitting(true)
    try {
      await srVendorContractsApi.update(editTarget.id, {
        ...(editForm.contract_number.trim() ? { contract_number: editForm.contract_number.trim() } : {}),
        valid_until: editForm.valid_until || null,
      })
      notify({ type: 'success', title: 'Kontrak diperbarui', desc: 'Perubahan kontrak pelaksana 1 phasa tersimpan.', tag: 'Kontrak 1 Phasa' })
      setEditTarget(null)
      load()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal memperbarui kontrak', desc: err?.message || 'Terjadi kesalahan.', tag: 'Kontrak 1 Phasa' })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
      <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <HierarchicalUnitFilter
            permission="sr_reservations.view"
            up3Id={up3Id}
            onUp3Change={setUp3Id}
            unitId={unitId}
            onUnitChange={setUnitId}
          />
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" variant="secondary" icon={IconRefresh} onClick={load}>
            Segarkan
          </Button>
          {canManage && (
            <Button size="sm" variant="primary" icon={IconPlus} onClick={() => setCreateOpen(true)}>
              Tambah Kontrak 1 Phasa
            </Button>
          )}
        </div>
      </div>

      {error && (
        <div className="p-4">
          <Alert variant="error">{error}</Alert>
        </div>
      )}

      <div>
        {loading ? (
          <div className="py-16 flex justify-center"><Spinner label="Memuat kontrak pelaksana 1 phasa..." /></div>
        ) : filteredRows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              icon={IconClipboard}
              title="Belum ada kontrak pelaksana 1 phasa"
              description="Tambahkan kontrak pelaksana 1 phasa per ULP agar rencana reservasi sambungan 1 phasa dapat dibuat."
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/70 text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-3 px-4">Unit Layanan (ULP)</th>
                  <th className="py-3 px-4">Pelaksana (Vendor)</th>
                  <th className="py-3 px-4">Nomor Kontrak</th>
                  <th className="py-3 px-4">Masa Berlaku</th>
                  {canManage && <th className="py-3 px-4 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginatedItems.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/50 transition-colors">
                    <td className="py-3 px-4 font-semibold text-slate-900 dark:text-slate-100">
                      {c.unit?.code ? `${c.unit.code} - ` : ''}{c.unit?.name || '-'}
                    </td>
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{c.vendor?.name || '-'}</div>
                      {c.vendor?.code && <div className="font-mono text-[10px] text-slate-400">{c.vendor.code}</div>}
                    </td>
                    <td className="py-3 px-4 font-mono font-semibold text-slate-700 dark:text-slate-300">
                      {c.contract_number}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                      {c.valid_from} s/d {c.valid_until || 'Seterusnya'}
                    </td>
                    {canManage && (
                      <td className="py-3 px-4 text-right">
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setEditTarget(c)
                            setEditForm({ contract_number: c.contract_number || '', valid_until: c.valid_until || '' })
                          }}
                        >
                          Ubah
                        </Button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {!loading && filteredRows.length > 0 && <TableFooter {...tableFooterProps} />}
      </div>

      {/* Modal Tambah Kontrak (Proporsional 2 bagian: Identitas Kontrak + Cakupan Multi-ULP) */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        size="max-w-2xl"
        title="Tambah Kontrak Pelaksana 1 Phasa"
        subtitle="Tetapkan vendor pelaksana 1 phasa untuk satu atau beberapa ULP beserta nomor dan masa berlaku kontraknya."
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Batal</Button>
            <Button
              type="submit"
              form="sr-contract-create-form"
              variant="primary"
              loading={submitting}
              disabled={selectedUlpIds.length === 0 || !form.vendor_company_id || !form.contract_number.trim()}
            >
              Simpan Kontrak ({selectedUlpIds.length} ULP)
            </Button>
          </>
        }
      >
        <form id="sr-contract-create-form" onSubmit={handleCreate} className="space-y-4 text-xs">
          {/* Bagian 1: Identitas Kontrak & Pelaksana */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-850/40 p-3.5 space-y-3">
            <div className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
              1. Identitas Kontrak &amp; Pelaksana
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Vendor Pelaksana
                </label>
                <SearchSelect
                  ariaLabel="Vendor pelaksana 1 phasa"
                  options={vendorOptions}
                  value={form.vendor_company_id}
                  onChange={(val) => setForm((f) => ({ ...f, vendor_company_id: val }))}
                  placeholder="Ketik nama atau kode vendor…"
                />
              </div>

              <div>
                <label htmlFor="c-number" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nomor Kontrak
                </label>
                <input
                  id="c-number"
                  type="text"
                  value={form.contract_number}
                  onChange={(e) => setForm((f) => ({ ...f, contract_number: e.target.value }))}
                  placeholder="Contoh: 001.PJ/DAN.01/UP3/2026"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
                />
              </div>

              <div>
                <label htmlFor="c-from" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Berlaku Mulai
                </label>
                <input
                  id="c-from"
                  type="date"
                  value={form.valid_from}
                  onChange={(e) => setForm((f) => ({ ...f, valid_from: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
                />
              </div>

              <div>
                <label htmlFor="c-until" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Berlaku Sampai (Opsional)
                </label>
                <input
                  id="c-until"
                  type="date"
                  value={form.valid_until}
                  onChange={(e) => setForm((f) => ({ ...f, valid_until: e.target.value }))}
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
                />
              </div>
            </div>
          </div>

          {/* Bagian 2: Cakupan Unit Layanan (ULP) */}
          <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 space-y-2.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  2. Cakupan Unit Layanan (ULP)
                </span>
                <span className="rounded-full bg-blue-50 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-200 dark:border-blue-800 px-2 py-0.5 text-[10px] font-bold">
                  {selectedUlpIds.length} dipilih
                </span>
              </div>
              {modalUlpChoices.length > 0 && (
                <div className="flex items-center gap-2.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setSelectedUlpIds(modalUlpChoices.map((u) => String(u.id)))}
                    className="text-blue-600 dark:text-blue-400 hover:underline font-semibold cursor-pointer"
                  >
                    Pilih Semua
                  </button>
                  {selectedUlpIds.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSelectedUlpIds([])}
                      className="text-slate-500 hover:underline cursor-pointer"
                    >
                      Kosongkan
                    </button>
                  )}
                </div>
              )}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {up3Choices.length > 1 && (
                <SearchSelect
                  ariaLabel="Saring UP3 untuk daftar ULP kontrak"
                  options={[
                    { value: '', label: 'Semua UP3' },
                    ...up3Choices.map((u) => ({ value: u.id, label: `${u.code ? `${u.code} - ` : ''}${u.name}` })),
                  ]}
                  value={modalUp3Id}
                  onChange={setModalUp3Id}
                  placeholder="Saring UP3…"
                />
              )}
              <div className={`relative ${up3Choices.length <= 1 ? 'sm:col-span-2' : ''}`}>
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={modalUlpSearch}
                  onChange={(e) => setModalUlpSearch(e.target.value)}
                  placeholder="Cari kode atau nama ULP…"
                  aria-label="Cari ULP kontrak"
                  className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-8 pr-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
                />
              </div>
            </div>

            <div className="max-h-48 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-850/40 p-2 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {modalUlpChoices.length === 0 ? (
                <p className="col-span-2 text-slate-400 p-3 text-center">Tidak ada ULP yang cocok.</p>
              ) : (
                modalUlpChoices.map((u) => {
                  const checked = selectedUlpIds.includes(String(u.id))
                  const existing = activeContractByUlp[String(u.id)]
                  return (
                    <label
                      key={u.id}
                      className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 cursor-pointer transition ${
                        checked
                          ? 'border-blue-400 bg-blue-50/70 text-blue-900 dark:border-blue-700 dark:bg-blue-950/40 dark:text-blue-100'
                          : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 hover:border-slate-300'
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggleUlp(u.id)}
                          className="rounded border-slate-300 shrink-0"
                        />
                        <span className="truncate font-medium">{u.code ? `${u.code} - ` : ''}{u.name}</span>
                      </span>
                      {existing && (
                        <span className="shrink-0 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 px-1.5 py-0.5 text-[9px] font-bold">
                          Ada kontrak
                        </span>
                      )}
                    </label>
                  )
                })
              )}
            </div>
          </div>

          {overlappingContracts.length > 0 && (
            <Alert variant="warning">
              <div className="space-y-1">
                <div className="font-bold flex items-center gap-1.5">
                  <IconAlertCircle className="h-4 w-4 shrink-0" />
                  ULP berikut sudah punya kontrak aktif pada rentang tanggal ini:
                </div>
                <ul className="list-disc pl-5 text-[11px]">
                  {overlappingContracts.map((oc) => (
                    <li key={oc.id}>
                      <strong>{oc.unit?.name}</strong>: {oc.contract_number} ({oc.vendor?.name}, {oc.valid_from} s/d {oc.valid_until || 'Seterusnya'})
                    </li>
                  ))}
                </ul>
              </div>
            </Alert>
          )}
        </form>
      </Modal>

      {/* Modal Ubah Kontrak */}
      <Modal
        open={Boolean(editTarget)}
        onClose={() => setEditTarget(null)}
        size="max-w-lg"
        title="Ubah Kontrak Pelaksana 1 Phasa"
        subtitle={editTarget ? `${editTarget.unit?.name || ''} · ${editTarget.vendor?.name || ''}` : ''}
        footer={
          <>
            <Button type="button" variant="secondary" onClick={() => setEditTarget(null)}>Batal</Button>
            <Button type="submit" form="sr-contract-edit-form" variant="primary" loading={submitting}>Simpan Perubahan</Button>
          </>
        }
      >
        <form id="sr-contract-edit-form" onSubmit={handleEdit} className="space-y-4 text-xs">
          <div>
            <label htmlFor="ce-number" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Nomor Kontrak
            </label>
            <input
              id="ce-number"
              type="text"
              value={editForm.contract_number}
              onChange={(e) => setEditForm((f) => ({ ...f, contract_number: e.target.value }))}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>
          <div>
            <label htmlFor="ce-until" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Berlaku Sampai (Kosongkan = seterusnya)
            </label>
            <input
              id="ce-until"
              type="date"
              value={editForm.valid_until}
              onChange={(e) => setEditForm((f) => ({ ...f, valid_until: e.target.value }))}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>
        </form>
      </Modal>
    </div>
  )
}
