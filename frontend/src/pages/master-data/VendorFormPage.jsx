import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { vendorsApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import { IconArrowLeft } from '../../components/icons.jsx'
import VendorProfileForm, { emptyVendorForm, vendorToForm, PROFILE_FIELDS } from './VendorProfileForm.jsx'

/** Halaman tambah / ubah profil vendor (/master-data/vendors/new dan /master-data/vendors/:id/edit). Drawer di daftar vendor hanya untuk pratinjau. */
export default function VendorFormPage() {
  const { id } = useParams()
  const editing = Boolean(id)
  const navigate = useNavigate()
  const { notify } = useNotifications()

  const [form, setForm] = useState(emptyVendorForm())
  const [loading, setLoading] = useState(editing)
  const [loadError, setLoadError] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!editing) return undefined
    let alive = true
    setLoading(true)
    vendorsApi.list()
      .then((res) => {
        if (!alive) return
        const vendor = (res?.data || []).find((v) => v.id === id)
        if (vendor) setForm(vendorToForm(vendor))
        else setLoadError('Perusahaan vendor tidak ditemukan.')
      })
      .catch((err) => alive && setLoadError(err?.message || 'Gagal memuat data vendor.'))
      .finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [editing, id])

  const back = () => navigate('/master-data/vendors')

  const handleSubmit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const body = { name: form.name.trim(), ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f, String(form[f] ?? '').trim()])) }
      if (editing) {
        await vendorsApi.update(id, body)
        notify({ type: 'success', title: 'Profil Vendor Diperbarui', desc: `Profil ${form.name} berhasil disimpan.`, tag: 'VENDOR' })
      } else {
        // saat tambah baru, kolom profil yang kosong tidak dikirim
        const payload = Object.fromEntries(Object.entries({ code: form.code.trim(), ...body }).filter(([, v]) => v !== ''))
        if (form.create_account) payload.account = { name: form.account_name.trim(), email: form.account_email.trim(), ...(form.account_phone.trim() && { phone: form.account_phone.trim() }), ...(form.account_unit && { organizational_unit_id: form.account_unit }) }
        await vendorsApi.create(payload)
        notify({ type: 'success', title: 'Perusahaan Vendor Dibuat', desc: `Perusahaan vendor ${form.name} (${form.code}) berhasil ditambahkan.${form.create_account ? ` Undangan aktivasi akun dikirim ke ${form.account_email.trim()}.` : ''}`, tag: 'VENDOR' })
      }
      back()
    } catch (err) {
      setError(err?.message || 'Gagal menyimpan perusahaan vendor.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <nav className="text-xs text-slate-500 mb-1">
          <Link to="/master-data/vendors" className="hover:underline">Mitra &amp; Vendor</Link>
          <span className="mx-1.5">/</span>
          <span className="text-slate-800 dark:text-slate-200 font-medium">{editing ? 'Ubah Profil' : 'Tambah Vendor'}</span>
        </nav>
        <div className="flex items-center gap-3">
          <button type="button" onClick={back} aria-label="Kembali ke daftar vendor" className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            <IconArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{editing ? 'Ubah Profil Perusahaan Vendor' : 'Tambah Perusahaan Vendor'}</h1>
            <p className="text-xs text-slate-500 mt-0.5">Lengkapi profil vendor. Hanya kode dan nama yang wajib; kolom lain dapat dilengkapi kemudian.</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-20 text-center"><Spinner size="lg" label="Memuat data vendor..." /></div>
      ) : loadError ? (
        <Alert kind="error">{loadError}</Alert>
      ) : (
        <VendorProfileForm mode={editing ? 'edit' : 'create'} form={form} onChange={setForm} onSubmit={handleSubmit} onCancel={back} saving={saving} error={error} />
      )}
    </div>
  )
}
