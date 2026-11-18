import { useState } from 'react'
import Modal from '../../components/Modal.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import { priceBookApi } from '../../services/api.js'

const today = () => new Date().toISOString().slice(0, 10)

/** A DRAFT price book that starts as a copy of the book in force, so MDU values can be adjusted on it without a price file. */
export default function PriceBookCloneModal({ open, onClose, onCreated }) {
  const [name, setName] = useState(`Buku harga ${today()}`)
  const [validFrom, setValidFrom] = useState(today())
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    if (!name.trim() || !validFrom || !reason.trim()) {
      setError('Nama, tanggal berlaku, dan alasan wajib diisi.')
      return
    }
    setSaving(true)
    setError('')
    try {
      const res = await priceBookApi.createFromActive({ name: name.trim(), valid_from: validFrom, reason: reason.trim() })
      setReason('')
      onCreated?.(res?.data)
    } catch (err) {
      setError(err?.message || 'Gagal membuat draf buku harga.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onClose={onClose} title="Buat Draf dari Buku Berlaku" size="max-w-md">
      <form onSubmit={submit} className="space-y-4 text-xs" noValidate>
        {error && <Alert kind="error">{error}</Alert>}
        <p className="text-slate-600 dark:text-slate-300">
          Draf baru berisi salinan buku harga yang sedang berlaku (item, harga jasa per zona, dan zona UP3). Setelah dibuat, nilai MDU dapat diubah per barang di
          draf itu. Draf tetap harus disetujui akun lain, dan baru berlaku setelah itu.
        </p>
        <div>
          <label htmlFor="clone-name" className="block font-semibold mb-1 text-slate-800 dark:text-slate-200">Nama buku harga</label>
          <input id="clone-name" value={name} maxLength={150} disabled={saving} onChange={(e) => setName(e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring" />
        </div>
        <div>
          <label htmlFor="clone-from" className="block font-semibold mb-1 text-slate-800 dark:text-slate-200">Berlaku mulai</label>
          <input id="clone-from" type="date" value={validFrom} disabled={saving} onChange={(e) => setValidFrom(e.target.value)}
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring" />
        </div>
        <div>
          <label htmlFor="clone-reason" className="block font-semibold mb-1 text-slate-800 dark:text-slate-200">Alasan <span className="text-rose-500">*</span></label>
          <textarea id="clone-reason" rows={3} maxLength={1000} value={reason} disabled={saving} onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: Menyesuaikan nilai MDU sesuai Excel revisi 18 Nov 2026..."
            className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring" />
        </div>
        <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving}>Batal</Button>
          <Button type="submit" disabled={saving}>{saving ? <Spinner size={14} label="Membuat..." /> : 'Buat Draf'}</Button>
        </div>
      </form>
    </Modal>
  )
}
