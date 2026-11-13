import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { adminApi } from '../../services/api.js'
import { describeDelivery } from '../../features/admin/delivery.js'
import Field from '../../components/Field.jsx'
import Alert from '../../components/Alert.jsx'
import Card from '../../components/Card.jsx'
import { IconArrowLeft, IconUsers, IconShield } from '../../components/icons.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'

const empty = {
  name: '',
  email: '',
  phone: '',
  nip: '',
  role_id: '',
  organizational_unit_id: '',
  valid_from: '',
  valid_until: '',
  assignment_document: '',
  reason: '',
}

const selectStyle =
  'mt-1 block w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm shadow-xs focus-ring'

export default function NewUserPage() {
  const { notify } = useNotifications()
  const [roles, setRoles] = useState([])
  const [units, setUnits] = useState([])
  const [form, setForm] = useState(empty)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [created, setCreated] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    adminApi.roles().then((d) => setRoles(d.data)).catch(() => setRoles([]))
    adminApi.units({ per_page: 100 }).then((d) => setUnits(d.data.filter((u) => u.is_active))).catch(() => setUnits([]))
  }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  async function onSubmit(e) {
    e.preventDefault()
    setErrors({})
    setMessage('')
    setBusy(true)
    try {
      const body = Object.fromEntries(Object.entries(form).map(([k, v]) => [k, v === '' ? null : v]))
      const res = await adminApi.createUser({
        ...body,
        name: form.name,
        email: form.email,
        reason: form.reason,
        assignment_document: form.assignment_document,
      })
      const userName = form.name
      setCreated({ user: res.data, delivery: res.delivery })
      setForm(empty)
      notify({
        type: 'success',
        title: 'Pengguna Berhasil Ditambahkan',
        desc: `Akun ${userName} berhasil didaftarkan ke sistem dan undangan aktivasi disiapkan.`,
        tag: 'Pengguna',
      })
    } catch (err) {
      if (err.status === 422 && err.errors) {
        setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.join(' ')])))
      } else if (err.status === 503) {
        setMessage(`${err.message} ${describeDelivery(err.data?.delivery)}`.trim())
      } else {
        setMessage(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4 w-full">
      <div>
        <Link to="/admin/users" className="inline-flex items-center gap-1.5 text-sm font-medium text-blue-600 hover:text-blue-800 underline">
          <IconArrowLeft size={16} />
          <span>← Kembali ke daftar</span>
        </Link>
      </div>

      {created && (
        <Alert kind={created.delivery?.delivered?.length ? 'success' : 'warning'}>
          Pengguna <Link className="underline font-semibold" to={`/admin/users/${created.user.id}`}>{created.user.name}</Link> dibuat (menunggu aktivasi).{' '}
          {created.delivery?.delivered?.length
            ? `Undangan aktivasi terkirim. ${describeDelivery(created.delivery)} Pengguna mengaktifkan akun sendiri dengan kode OTP dan membuat passwordnya sendiri.`
            : `Undangan TIDAK terkirim. ${describeDelivery(created.delivery)} Pengguna tetap dibuat; kirim ulang undangan dari halaman detail setelah email/WhatsApp siap.`}
        </Alert>
      )}

      <Card>
        <div className="mb-4 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="rounded-lg bg-blue-50 p-2 text-blue-600">
              <IconUsers size={22} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">Tambah pengguna</h2>
              <p className="text-xs text-slate-500">
                Pengguna menerima undangan lewat email/WhatsApp, lalu mengaktifkan akunnya sendiri dengan kode OTP dan membuat password sendiri. Administrator tidak pernah mengetahui password.
              </p>
            </div>
          </div>
        </div>

        <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
          {message && (
            <div className="sm:col-span-2">
              <Alert>{message}</Alert>
            </div>
          )}

          <Field
            id="name"
            label="Nama lengkap"
            value={form.name}
            onChange={set('name')}
            error={errors.name}
            required
          />

          <Field
            id="email"
            label="Email"
            type="email"
            value={form.email}
            onChange={set('email')}
            error={errors.email}
            required
          />

          <Field
            id="phone"
            label="Nomor WhatsApp (opsional)"
            value={form.phone}
            onChange={set('phone')}
            error={errors.phone}
          />

          <Field
            id="nip"
            label="NIP (opsional)"
            value={form.nip}
            onChange={set('nip')}
            error={errors.nip}
          />

          <div>
            <label htmlFor="role_id" className="block text-sm font-medium text-slate-700">Role</label>
            <select
              id="role_id"
              value={form.role_id}
              onChange={set('role_id')}
              className={selectStyle}
            >
              <option value="">Pilih role</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id} disabled={r.name === 'SYS_ADMIN'}>
                  {r.name} {r.name === 'SYS_ADMIN' ? '(Khusus Konsol CLI)' : ''}
                </option>
              ))}
            </select>
            {errors.role_id && <p className="mt-1 text-sm text-red-600">{errors.role_id}</p>}
            <p className="text-[11px] text-slate-400 mt-1">Role SYS_ADMIN dikelola langsung via CLI server konsol sesuai kebijakan keamanan docs/55.</p>
          </div>

          <div>
            <label htmlFor="organizational_unit_id" className="block text-sm font-medium text-slate-700">Unit</label>
            <select
              id="organizational_unit_id"
              value={form.organizational_unit_id}
              onChange={set('organizational_unit_id')}
              className={selectStyle}
            >
              <option value="">Pilih unit</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
            </select>
            {errors.organizational_unit_id && <p className="mt-1 text-sm text-red-600">{errors.organizational_unit_id}</p>}
          </div>

          <Field
            id="valid_from"
            label="Berlaku mulai"
            type="date"
            value={form.valid_from}
            onChange={set('valid_from')}
            error={errors.valid_from}
            required
          />

          <Field
            id="valid_until"
            label="Berlaku sampai (opsional)"
            type="date"
            value={form.valid_until}
            onChange={set('valid_until')}
            error={errors.valid_until}
          />

          <Field
            id="assignment_document"
            label="Dokumen penugasan"
            value={form.assignment_document}
            onChange={set('assignment_document')}
            error={errors.assignment_document}
            placeholder="Contoh: SK-123/SDM/2026"
            required
          />

          <Field
            id="reason"
            label="Alasan"
            value={form.reason}
            onChange={set('reason')}
            error={errors.reason}
            placeholder="Alasan penetapan penugasan awal"
            required
          />

          <div className="sm:col-span-2 pt-2 border-t border-slate-100 flex items-center justify-end gap-3">
            <Link
              to="/admin/users"
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
            >
              Batal
            </Link>
            <button
              type="submit"
              disabled={busy}
              className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 transition focus-ring"
            >
              {busy ? 'Membuat…' : 'Buat pengguna'}
            </button>
          </div>
        </form>
      </Card>
    </div>
  )
}
