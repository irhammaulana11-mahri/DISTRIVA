import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { adminApi } from '../../services/api.js'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import Spinner from '../../components/Spinner.jsx'
import Alert from '../../components/Alert.jsx'
import Field from '../../components/Field.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import Card from '../../components/Card.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import { describeDelivery } from '../../features/admin/delivery.js'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import { IconArrowLeft, IconUser, IconKey, IconShield } from '../../components/icons.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'

const STATUSES = [
  ['ACTIVE', 'Aktif'],
  ['SUSPENDED', 'Ditangguhkan'],
  ['INACTIVE', 'Nonaktif'],
  ['PENDING_ACTIVATION', 'Menunggu aktivasi'],
]
const emptyForm = {
  role_id: '',
  organizational_unit_id: '',
  valid_from: '',
  valid_until: '',
  assignment_document: '',
  reason: '',
}

export default function UserDetailPage() {
  const { id } = useParams()
  const { user: currentUser } = useAuth()
  const { canWrite } = useAccess()
  const { notify } = useNotifications()
  const [state, setState] = useState({ loading: true, error: '', user: null, assignments: [] })
  const [dialog, setDialog] = useState(null) // { type: 'end', assignment } | { type: 'status', status }
  const [newStatus, setNewStatus] = useState('SUSPENDED')
  const [profile, setProfile] = useState(null) // { name, position } while the data card is being edited
  const [profileError, setProfileError] = useState('')

  const load = useCallback(() => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    Promise.all([adminApi.user(id), adminApi.assignments(id)])
      .then(([u, a]) => setState({ loading: false, error: '', user: u.data, assignments: a.data }))
      .catch((e) => setState({ loading: false, error: e.message, user: null, assignments: [] }))
  }, [id])

  useEffect(load, [load])

  if (state.loading) return <Spinner />
  if (state.error) return <Alert>{state.error}</Alert>
  const { user, assignments } = state
  const isSelf = currentUser && String(currentUser.id) === String(user?.id)

  async function saveProfile(e) {
    e.preventDefault()
    setProfileError('')
    try {
      await adminApi.updateUser(id, { name: profile.name, position: profile.position })
      notify({ type: 'info', title: 'Data pengguna disimpan.', desc: 'Nama dan jabatan diperbarui.', tag: 'Pengguna' })
      setProfile(null)
      load()
    } catch (err) {
      setProfileError(err.message)
    }
  }

  async function confirm(reason) {
    if (dialog.type === 'end') {
      await adminApi.endAssignment(dialog.assignment.id, reason)
      notify({
        type: 'warning',
        title: 'Penugasan diakhiri.',
        desc: `Penugasan peran ${dialog.assignment?.role} pada unit ${dialog.assignment?.unit_code} telah diakhiri.`,
        tag: 'Penugasan',
      })
    } else if (dialog.type === 'invite') {
      const res = await adminApi.resendInvitation(id, reason)
      const delivered = Boolean(res.delivery?.delivered?.length)
      notify({
        type: delivered ? 'info' : 'warning',
        title: delivered ? 'Undangan Terkirim' : 'Undangan Gagal Terkirim',
        desc: delivered
          ? `Undangan aktivasi dikirim ulang. ${describeDelivery(res.delivery)}`
          : `Penyedia pengiriman pesan melaporkan kegagalan pengiriman. ${describeDelivery(res.delivery)}`,
        tag: 'Pengguna',
      })
      setDialog(null)
      load()
      return
    } else {
      await adminApi.changeStatus(id, dialog.status, reason)
      notify({
        type: 'success',
        title: 'Status akun diperbarui.',
        desc: `Status akun pengguna ${user?.name} kini berstatus ${dialog.status}.`,
        tag: 'Pengguna',
      })
    }
    setDialog(null)
    load()
  }

  return (
    <div className="space-y-6 w-full">
      {/* Breadcrumb Navigation & Back Link */}
      <div className="flex items-center justify-between">
        <Link
          to="/admin/users"
          className="inline-flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-600 dark:text-slate-300 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
        >
          <IconArrowLeft size={16} />
          <span>Kembali ke Daftar Pengguna</span>
        </Link>
        <div className="text-xs text-slate-400 font-medium">
          ID: <span className="font-mono">{user.id}</span>
        </div>
      </div>

      {/* Hero Profile Banner */}
      <div className="relative overflow-hidden rounded-3xl bg-gradient-to-r from-slate-900 via-indigo-950 to-blue-950 p-6 sm:p-8 text-white shadow-xl border border-slate-800">
        <div className="relative z-10 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <div className="flex items-start sm:items-center gap-4">
            <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-white font-extrabold text-2xl shadow-lg border border-white/20">
              {user.name.charAt(0).toUpperCase()}
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-extrabold text-white">{user.name}</h1>
                <StatusBadge status={user.account_status} />
              </div>
              <p className="text-xs sm:text-sm text-blue-200/90 font-mono">{user.email}</p>
              <div className="flex flex-wrap items-center gap-4 text-xs text-blue-300/80 pt-1">
                {user.position && <span>Jabatan: <strong className="text-white">{user.position}</strong></span>}
                {user.nip && <span>NIP: <strong className="text-white font-mono">{user.nip}</strong></span>}
                {user.phone && <span>Telp: <strong className="text-white font-mono">{user.phone}</strong></span>}
                <span>Terdaftar: <strong className="text-white">{user.created_at ? new Date(user.created_at).toLocaleDateString('id-ID') : '—'}</strong></span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            {user.account_status === 'PENDING_ACTIVATION' && canWrite['users.create'] && (
              <button
                type="button"
                onClick={() => setDialog({ type: 'invite' })}
                className="inline-flex items-center gap-2 rounded-xl bg-amber-500 hover:bg-amber-600 text-slate-950 font-semibold px-4 py-2 text-xs sm:text-sm shadow-md transition cursor-pointer"
              >
                <IconKey size={15} />
                <span>Kirim ulang undangan aktivasi…</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Profile (name, position) */}
      {canWrite['users.update'] && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">Data Pengguna</h3>
          {profile ? (
            <form onSubmit={saveProfile} className="flex flex-wrap items-end gap-3 mt-3">
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                Nama
                <input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} required maxLength={150}
                  className="mt-1 block w-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <label className="text-xs font-semibold text-slate-600 dark:text-slate-400">
                Jabatan
                <input value={profile.position} onChange={(e) => setProfile({ ...profile, position: e.target.value })} maxLength={100}
                  className="mt-1 block w-64 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3.5 py-2 text-sm outline-none focus:ring-2 focus:ring-blue-500" />
              </label>
              <button type="submit" className="rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold px-4 py-2 text-sm cursor-pointer">Simpan</button>
              <button type="button" onClick={() => setProfile(null)} className="rounded-xl border border-slate-300 dark:border-slate-600 px-4 py-2 text-sm cursor-pointer">Batal</button>
              {profileError && <p className="w-full text-xs text-red-600">{profileError}</p>}
            </form>
          ) : (
            <div className="flex flex-wrap items-center gap-4 mt-2 text-sm text-slate-700 dark:text-slate-300">
              <span>Nama: <strong>{user.name}</strong></span>
              <span>Jabatan: <strong>{user.position || '—'}</strong></span>
              <button type="button" onClick={() => setProfile({ name: user.name, position: user.position || '' })}
                className="rounded-xl border border-slate-300 dark:border-slate-600 px-3 py-1.5 text-xs font-semibold cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800">Ubah</button>
            </div>
          )}
        </div>
      )}

      {/* Account Status Control Card */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-1">
          Kontrol Status Akun &amp; Keamanan
        </h3>
        <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
          Status akun menentukan hak login pengguna. Penonaktifan akun tetap mencatat audit trail permanen tanpa penghapusan fisik.
        </p>

        {isSelf ? (
          <div className="rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3.5 text-xs text-amber-800 dark:text-amber-200 border border-amber-200 dark:border-amber-900/60">
            Anda tidak dapat mengubah status akun sendiri untuk mencegah terkunci dari sistem (<em>anti-lockout policy</em>).
          </div>
        ) : canWrite['users.change_status'] ? (
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="new-status" className="block text-xs font-semibold text-slate-600 dark:text-slate-400 mb-1">
                Ubah status menjadi
              </label>
              <select
                id="new-status"
                value={newStatus}
                onChange={(e) => setNewStatus(e.target.value)}
                className="rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3.5 py-2 text-xs sm:text-sm shadow-xs focus:ring-2 focus:ring-blue-500 outline-none cursor-pointer"
              >
                {STATUSES.filter(([v]) => v !== user.account_status).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
            <button
              type="button"
              onClick={() => setDialog({ type: 'status', status: newStatus })}
              className="rounded-xl bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-semibold px-4 py-2 text-xs sm:text-sm shadow-xs transition cursor-pointer"
            >
              Ubah status…
            </button>
          </div>
        ) : (
          <p className="text-xs text-slate-500">Anda tidak memiliki hak mengubah status akun ini.</p>
        )}
      </div>

      <Card noPadding>
        <div className="p-5 border-b border-slate-100">
          <h3 className="text-base font-bold text-slate-900">Penugasan</h3>
          <p className="text-xs text-slate-500">Penetapan peran dan unit organisasi (user_role_assignments)</p>
        </div>

        <div className="p-5">
          {assignments.length === 0 ? (
            <p className="text-sm text-slate-500">Belum ada penugasan pada cakupan Anda.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-left text-sm data-table">
                <thead>
                  <tr>
                    <th className="py-2.5 px-4">Role</th>
                    <th className="py-2.5 px-4">Unit</th>
                    <th className="py-2.5 px-4">Periode</th>
                    <th className="py-2.5 px-4">Status</th>
                    <th className="py-2.5 px-4 text-right">Aksi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {assignments.map((a) => (
                    <tr key={a.id}>
                      <td className="py-2.5 px-4 font-semibold text-slate-800">{a.role}</td>
                      <td className="py-2.5 px-4 font-mono text-xs">{a.unit_code ?? '—'}</td>
                      <td className="py-2.5 px-4 text-xs text-slate-600">
                        {a.valid_from} s/d {a.valid_until ?? 'tanpa batas'}
                      </td>
                      <td className="py-2.5 px-4">
                        <span className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${a.is_active ? 'bg-green-100 text-green-800' : 'bg-slate-100 text-slate-600'}`}>
                          {a.is_active ? 'Aktif' : 'Berakhir'}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-right">
                        {a.is_active && canWrite['role_assignments.end'] && (
                          <button
                            type="button"
                            disabled={isSelf}
                            onClick={() => setDialog({ type: 'end', assignment: a })}
                            className="rounded border border-red-300 bg-white px-2.5 py-1 text-xs font-semibold text-red-700 hover:bg-red-50 focus-ring disabled:opacity-40 disabled:cursor-not-allowed"
                            title={isSelf ? 'Tidak boleh mengakhiri penugasan akun sendiri' : 'Akhiri penugasan'}
                          >
                            Akhiri
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <TableFooter
                itemCount={assignments.length}
                total={assignments.length}
                entityLabel="penugasan peran"
              />
            </div>
          )}
        </div>
      </Card>

      {canWrite['role_assignments.assign'] && (
        <AssignForm
          userId={id}
          onDone={() => {
            notify({
              type: 'success',
              title: 'Penugasan ditambahkan.',
              desc: 'Peran dan unit organisasi baru berhasil ditetapkan ke pengguna.',
              tag: 'Penugasan',
            })
            load()
          }}
        />
      )}

      {dialog && (
        <ReasonDialog
          title={{ end: 'Akhiri penugasan', invite: 'Kirim ulang undangan aktivasi', status: 'Ubah status akun' }[dialog.type]}
          description={{
            end: `Penugasan ${dialog.assignment?.role} pada ${dialog.assignment?.unit_code} akan diakhiri.`,
            invite: `Undangan aktivasi akan dikirim ulang ke ${user.name} lewat email/WhatsApp. Undangan tidak berisi password atau kode.`,
            status: `Status ${user.name} akan diubah menjadi ${dialog.status}.`,
          }[dialog.type]}
          confirmLabel={{ end: 'Akhiri penugasan', invite: 'Kirim ulang', status: 'Ubah status' }[dialog.type]}
          onConfirm={confirm}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  )
}

function AssignForm({ userId, onDone }) {
  const [roles, setRoles] = useState([])
  const [units, setUnits] = useState([])
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
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
      await adminApi.assign({
        ...form,
        user_id: userId,
        valid_until: form.valid_until || null,
      })
      setForm(emptyForm)
      onDone()
    } catch (err) {
      if (err.status === 422 && err.errors) setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.join(' ')])))
      else setMessage(err.message)
    } finally {
      setBusy(false)
    }
  }

  const select = 'mt-1 block w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 px-3 py-2 text-base sm:text-sm shadow-xs focus-ring'

  return (
    <Card>
      <div className="mb-4 border-b border-slate-100 pb-3">
        <h3 className="text-base font-bold text-slate-900">Tambah penugasan</h3>
        <p className="text-xs text-slate-500">Tetapkan peran operasional baru bagi pengguna pada unit kerja</p>
      </div>

      <form onSubmit={onSubmit} noValidate className="grid gap-4 sm:grid-cols-2">
        {message && <div className="sm:col-span-2"><Alert>{message}</Alert></div>}

        <div>
          <label htmlFor="role_id" className="block text-sm font-medium text-slate-700">Role</label>
          <select id="role_id" value={form.role_id} onChange={set('role_id')} className={select}>
            <option value="">Pilih role</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id} disabled={r.name === 'SYS_ADMIN'}>
                {r.name} {r.name === 'SYS_ADMIN' ? '(Khusus Konsol CLI)' : ''}
              </option>
            ))}
          </select>
          {errors.role_id && <p className="mt-1 text-sm text-red-600">{errors.role_id}</p>}
        </div>

        <div>
          <label htmlFor="organizational_unit_id" className="block text-sm font-medium text-slate-700">Unit</label>
          <select id="organizational_unit_id" value={form.organizational_unit_id} onChange={set('organizational_unit_id')} className={select}>
            <option value="">Pilih unit</option>
            {units.map((u) => <option key={u.id} value={u.id}>{u.code} — {u.name}</option>)}
          </select>
          {errors.organizational_unit_id && <p className="mt-1 text-sm text-red-600">{errors.organizational_unit_id}</p>}
        </div>

        <Field id="valid_from" label="Berlaku mulai" type="date" value={form.valid_from} onChange={set('valid_from')} error={errors.valid_from} />
        <Field id="valid_until" label="Berlaku sampai (opsional)" type="date" value={form.valid_until} onChange={set('valid_until')} error={errors.valid_until} />
        <Field id="assignment_document" label="Dokumen penugasan" value={form.assignment_document} onChange={set('assignment_document')} error={errors.assignment_document} />
        <Field id="assign_reason" label="Alasan" value={form.reason} onChange={set('reason')} error={errors.reason} />

        <div className="sm:col-span-2 pt-2 border-t border-slate-100 flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-blue-600 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 transition focus-ring"
          >
            {busy ? 'Menyimpan…' : 'Tambah penugasan'}
          </button>
        </div>
      </form>
    </Card>
  )
}
