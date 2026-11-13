import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { poleContractsApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import KrLinesEditor, { toApiLines, validateLines } from './KrLinesEditor.jsx'

const BACK = '/master-data/pole-contracts'

/** Daftar KR dan pilihan vendor/UP3 pemilik, sekali muat (satu panggilan daftar). */
function useContractOptions() {
  const [state, setState] = useState(null)
  useEffect(() => {
    poleContractsApi.list()
      .then((res) => setState({ vendors: res?.options?.vendors || [], up3: res?.options?.up3 || [], contracts: res?.data || [] }))
      .catch(() => setState({ vendors: [], up3: [], contracts: [] }))
  }, [])
  return state
}

/** Halaman tambah Kontrak Rinci (KR) tiang (laci/dialog pada daftar tidak lagi memuat form). */
export function PoleContractCreatePage() {
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const options = useContractOptions()
  const [createVendor, setCreateVendor] = useState('')
  const [createUp3, setCreateUp3] = useState('')
  const [createKrNumber, setCreateKrNumber] = useState('')
  const [createDescription, setCreateDescription] = useState('')
  const [createLines, setCreateLines] = useState([])
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')
  const goBack = () => navigate(BACK)
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
      goBack()
    } catch (err) {
      setCreateError(err?.message || 'Gagal membuat Kontrak Rinci.')
    } finally {
      setCreating(false)
    }
  }


  if (!options) return <div className="p-8 text-center"><Spinner /></div>
  return (
    <PanelShell asPage onBack={goBack} title="Tambah Kontrak Rinci (KR) Tiang">
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
                    onClick={() => goBack()}
                  >
                    Batal
                  </Button>
                  <Button type="submit" variant="primary" size="sm" loading={creating}>
                    Simpan Kontrak Rinci
                  </Button>
                </div>
              </form>
    </PanelShell>
  )
}

/** Halaman ubah Kontrak Rinci tiang: baris material atau kuantitas TM/TR, uraian, vendor/UP3 pemilik, dan alasan perubahan (audit). */
export function PoleContractEditPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const options = useContractOptions()
  const [contract, setContract] = useState(null)
  const [loadError, setLoadError] = useState('')
  const [updateVendor, setUpdateVendor] = useState('')
  const [updateUp3, setUpdateUp3] = useState('')
  const [updateQtyTm, setUpdateQtyTm] = useState('')
  const [updateQtyTr, setUpdateQtyTr] = useState('')
  const [updateLines, setUpdateLines] = useState([])
  const [updateDescription, setUpdateDescription] = useState('')
  const [updateReason, setUpdateReason] = useState('')
  const [updating, setUpdating] = useState(false)
  const [updateError, setUpdateError] = useState('')
  const goBack = () => navigate(BACK)

  useEffect(() => {
    if (!options) return
    const c = options.contracts.find((x) => x.id === id)
    if (!c) {
      setLoadError('Kontrak Rinci tidak ditemukan.')
      return
    }
    setContract(c)
    setUpdateQtyTm(c.tm?.total ?? '')
    setUpdateQtyTr(c.tr?.total ?? '')
    setUpdateLines((c.lines || []).map((l) => ({ khs_item_id: l.khs_item_id, khs_code: l.khs_code, khs_name: l.khs_name, pole_type: l.pole_type, quantity: l.total })))
    setUpdateDescription(c.description || '')
    setUpdateVendor(c.vendor_company_id || '')
    setUpdateUp3(c.up3_unit_id || '')
  }, [id, options])

  const handleUpdate = async (e) => {
    e.preventDefault()
    if (!contract) return
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
      await poleContractsApi.update(contract.id, body)
      notify({
        type: 'success',
        title: 'Kontrak Rinci Diperbarui',
        desc: `Kuantitas Kontrak Rinci ${contract.kr_number} berhasil disesuaikan.`,
        tag: 'TIANG',
      })
      goBack()
    } catch (err) {
      setUpdateError(err?.message || 'Gagal memperbarui Kontrak Rinci.')
    } finally {
      setUpdating(false)
    }
  }


  if (loadError) return <Alert kind="error">{loadError}</Alert>
  if (!contract || !options) return <div className="p-8 text-center"><Spinner /></div>
  return (
    <PanelShell asPage onBack={goBack} title={`Ubah Kontrak Rinci: ${contract.kr_number}`}>
      <form onSubmit={handleUpdate} className="space-y-4 text-xs">
                  {updateError && <Alert kind="error">{updateError}</Alert>}

                  {(contract.lines || []).length > 0 || updateLines.length > 0 ? (
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
                      onClick={() => goBack()}
                    >
                      Batal
                    </Button>
                    <Button type="submit" variant="primary" size="sm" loading={updating} disabled={!updateReason.trim()}>
                      Simpan Perubahan
                    </Button>
                  </div>
                </form>
    </PanelShell>
  )
}
