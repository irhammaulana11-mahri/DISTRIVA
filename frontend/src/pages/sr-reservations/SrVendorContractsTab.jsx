import { useCallback, useEffect, useMemo, useState } from 'react'
import { srVendorContractsApi, vendorsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { useScopedUnits } from '../../utils/unitScope.js'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import UnitPicker from '../../components/UnitPicker.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Modal from '../../components/Modal.jsx'
import { IconPlus, IconRefresh, IconClipboard } from '../../components/icons.jsx'

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
  const [form, setForm] = useState({
    organizational_unit_id: '',
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

  const handleCreate = async (e) => {
    e.preventDefault()
    if (!form.organizational_unit_id || !form.vendor_company_id || !form.contract_number.trim() || !form.valid_from) {
      notify({ type: 'error', title: 'Data belum lengkap', desc: 'ULP, pelaksana, nomor kontrak, dan tanggal mulai wajib diisi.', tag: 'Kontrak 1 Phasa' })
      return
    }
    setSubmitting(true)
    try {
      await srVendorContractsApi.create({
        organizational_unit_id: form.organizational_unit_id,
        vendor_company_id: form.vendor_company_id,
        contract_number: form.contract_number.trim(),
        valid_from: form.valid_from,
        ...(form.valid_until ? { valid_until: form.valid_until } : {}),
      })
      notify({ type: 'success', title: 'Kontrak ditambahkan', desc: 'Kontrak pelaksana 1 phasa per ULP berhasil disimpan.', tag: 'Kontrak 1 Phasa' })
      setCreateOpen(false)
      setForm({
        organizational_unit_id: '',
        vendor_company_id: '',
        contract_number: '',
        valid_from: new Date().toISOString().slice(0, 10),
        valid_until: '',
      })
      load()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal menyimpan kontrak', desc: err?.message || 'Terjadi kesalahan.', tag: 'Kontrak 1 Phasa' })
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
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
        <div className="flex flex-wrap items-center gap-2">
          <HierarchicalUnitFilter
            permission="sr_reservations.view"
            up3Id={up3Id}
            onUp3Change={setUp3Id}
            unitId={unitId}
            onUnitChange={setUnitId}
            showLabels
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

      {error && <Alert variant="error">{error}</Alert>}

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-12 flex justify-center"><Spinner label="Memuat kontrak pelaksana 1 phasa..." /></div>
        ) : filteredRows.length === 0 ? (
          <EmptyState
            icon={IconClipboard}
            title="Belum ada kontrak pelaksana 1 phasa"
            description="Tambahkan kontrak pelaksana 1 phasa per ULP agar rencana reservasi sambungan 1 phasa dapat dibuat."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-850 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="px-4 py-3">Unit Layanan (ULP)</th>
                  <th className="px-4 py-3">Pelaksana (Vendor)</th>
                  <th className="px-4 py-3">Nomor Kontrak</th>
                  <th className="px-4 py-3">Masa Berlaku</th>
                  {canManage && <th className="px-4 py-3 text-right">Aksi</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {filteredRows.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="px-4 py-3 font-semibold text-slate-900 dark:text-slate-100">
                      {c.unit?.code ? `${c.unit.code} - ` : ''}{c.unit?.name || '-'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800 dark:text-slate-200">{c.vendor?.name || '-'}</div>
                      {c.vendor?.code && <div className="font-mono text-[10px] text-slate-400">{c.vendor.code}</div>}
                    </td>
                    <td className="px-4 py-3 font-mono font-semibold text-slate-700 dark:text-slate-300">
                      {c.contract_number}
                    </td>
                    <td className="px-4 py-3 text-slate-600 dark:text-slate-400">
                      {c.valid_from} s/d {c.valid_until || 'Seterusnya'}
                    </td>
                    {canManage && (
                      <td className="px-4 py-3 text-right">
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
      </div>

      {/* Modal Tambah Kontrak */}
      <Modal open={createOpen} onClose={() => setCreateOpen(false)} title="Tambah Kontrak Pelaksana 1 Phasa">
        <form onSubmit={handleCreate} className="space-y-4 text-xs">
          <div>
            <span className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">Unit Layanan (ULP)</span>
            <UnitPicker
              permission="sr_vendor_contracts.manage"
              level="ulp"
              value={form.organizational_unit_id}
              onChange={(id) => setForm((f) => ({ ...f, organizational_unit_id: id }))}
              up3AriaLabel="UP3 kontrak 1 phasa"
              unitAriaLabel="ULP kontrak 1 phasa"
            />
          </div>

          <div>
            <label htmlFor="c-vendor" className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Vendor Pelaksana
            </label>
            <select
              id="c-vendor"
              value={form.vendor_company_id}
              onChange={(e) => setForm((f) => ({ ...f, vendor_company_id: e.target.value }))}
              className="w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus-ring"
            >
              <option value="">Pilih vendor…</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.code ? `${v.code} - ` : ''}{v.name}</option>
              ))}
            </select>
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

          <div className="grid grid-cols-2 gap-3">
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

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setCreateOpen(false)}>Batal</Button>
            <Button type="submit" variant="primary" loading={submitting}>Simpan Kontrak</Button>
          </div>
        </form>
      </Modal>

      {/* Modal Ubah Kontrak */}
      <Modal open={Boolean(editTarget)} onClose={() => setEditTarget(null)} title="Ubah Kontrak Pelaksana 1 Phasa">
        <form onSubmit={handleEdit} className="space-y-4 text-xs">
          <div className="rounded-xl bg-slate-50 dark:bg-slate-850 p-3 text-slate-600 dark:text-slate-300">
            <strong>{editTarget?.unit?.name}</strong> · Pelaksana: <strong>{editTarget?.vendor?.name}</strong>
          </div>
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
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="secondary" onClick={() => setEditTarget(null)}>Batal</Button>
            <Button type="submit" variant="primary" loading={submitting}>Simpan Perubahan</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
