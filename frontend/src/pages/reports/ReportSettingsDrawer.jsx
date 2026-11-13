import { useEffect, useState } from 'react'
import { reportsApi } from '../../services/api.js'
import Modal from '../../components/Modal.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'

const VENDOR_WEIGHTS = [
  ['weight_completion', 'Tingkat selesai'],
  ['weight_timeliness', 'Ketepatan waktu (target selesai SPK)'],
  ['weight_quality', 'Kualitas (revisi BASTP)'],
  ['weight_discipline', 'Disiplin laporan progres'],
]

function NumberField({ label, hint, value, onChange, step = 1, min, max }) {
  return (
    <label className="block text-xs">
      <span className="block font-semibold mb-1 text-slate-700 dark:text-slate-300">{label}</span>
      <input
        type="number"
        step={step}
        min={min}
        max={max}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
      />
      {hint && <span className="block text-[11px] text-slate-500 mt-1">{hint}</span>}
    </label>
  )
}

/** Pengaturan parameter laporan stok kritis dan rapor vendor; hanya administrator yang dapat menyimpan. */
export default function ReportSettingsDrawer({ open, section, settings, onClose, onSaved }) {
  const [form, setForm] = useState(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (open && settings) {
      setForm({ stock: { ...settings.stock }, vendor: { ...settings.vendor } })
      setError('')
    }
  }, [open, settings])

  if (!form) return null
  const set = (group, key) => (v) => setForm((f) => ({ ...f, [group]: { ...f[group], [key]: v } }))
  const total = VENDOR_WEIGHTS.reduce((n, [k]) => n + Number(form.vendor[k] || 0), 0)
  const canEdit = Boolean(settings?.can_edit)

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const num = (g) => Object.fromEntries(Object.entries(form[g]).map(([k, v]) => [k, Number(v)]))
      const res = await reportsApi.saveSettings({ stock: num('stock'), vendor: num('vendor') })
      onSaved?.(res?.data)
      onClose()
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Gagal menyimpan pengaturan.')
    } finally {
      setSaving(false)
    }
  }

  const restore = () => setForm({ stock: { ...settings.defaults.stock }, vendor: { ...settings.defaults.vendor } })

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={section === 'stock' ? 'Pengaturan Stok Kritis' : 'Pengaturan Rapor Vendor'}
      subtitle={canEdit ? 'Parameter berlaku untuk semua pengguna.' : 'Hanya administrator yang dapat mengubah parameter ini.'}
      footer={
        <div className="flex items-center justify-between w-full">
          <Button variant="ghost" size="sm" onClick={restore} disabled={!canEdit}>Kembalikan standar</Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={onClose}>Tutup</Button>
            <Button onClick={save} loading={saving} disabled={!canEdit || (section === 'vendor' && total !== 100)}>Simpan</Button>
          </div>
        </div>
      }
    >
      <div className="space-y-4">
        {error && <Alert kind="error">{error}</Alert>}
        {section === 'stock' ? (
          <>
            <NumberField label="Rentang riwayat pemakaian (bulan)" min={1} max={12} value={form.stock.usage_months} onChange={set('stock', 'usage_months')} hint="Stok minimum = rata-rata pemakaian per bulan pada rentang ini (penyerahan material TUG 7; bila belum ada, alokasi terkonfirmasi), atau safety stock ERP bila lebih tinggi." />
            <NumberField label="Faktor peringatan" step="0.1" min={1} max={5} value={form.stock.warning_factor} onChange={set('stock', 'warning_factor')} hint="Peringatan bila stok proyeksi (tersedia + kedatangan 1 bulan) kurang dari stok minimum × faktor ini." />
          </>
        ) : (
          <>
            <fieldset className="space-y-3">
              <legend className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Bobot skor (%)</legend>
              {VENDOR_WEIGHTS.map(([k, label]) => (
                <NumberField key={k} label={label} min={0} max={100} value={form.vendor[k]} onChange={set('vendor', k)} />
              ))}
              <p className={`text-xs font-semibold ${total === 100 ? 'text-emerald-600' : 'text-rose-600'}`}>Jumlah bobot: {total}% {total === 100 ? '' : '(harus 100%)'}</p>
            </fieldset>
            <NumberField label="Batas SPK tanpa laporan (hari)" min={1} max={60} value={form.vendor.stale_days} onChange={set('vendor', 'stale_days')} hint="SPK berjalan yang tidak dilaporkan lebih dari batas ini dihitung tidak disiplin." />
            <div className="grid grid-cols-2 gap-3">
              <NumberField label="Nilai minimum “Baik”" min={1} max={100} value={form.vendor.good_min} onChange={set('vendor', 'good_min')} />
              <NumberField label="Nilai minimum “Cukup”" min={0} max={99} value={form.vendor.fair_min} onChange={set('vendor', 'fair_min')} />
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}
