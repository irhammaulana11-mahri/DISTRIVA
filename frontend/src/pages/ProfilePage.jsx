import { useState, useEffect } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthContext.jsx'
import { authApi } from '../services/api.js'
import Field from '../components/Field.jsx'
import Alert from '../components/Alert.jsx'
import Button from '../components/Button.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import { IconUser, IconKey, IconShield, IconLock, IconCheckCircle, IconClock } from '../components/icons.jsx'
import { useNotifications } from '../features/notifications/NotificationContext.jsx'

const profileFields = [
  ['Nama Lengkap', 'name'],
  ['Alamat Email Kedinasan', 'email'],
  ['NIP Pegawai', 'nip'],
  ['Nomor Telepon', 'phone'],
  ['Status Akun', 'account_status'],
]

const emptyForm = { current_password: '', password: '', password_confirmation: '' }

export default function ProfilePage({ defaultTab = 'profile' }) {
  const { user, mustChangePassword, passwordChanged, mfaState } = useAuth()
  const { notify } = useNotifications()
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')

  // Active tab: 'profile' or 'password'
  const [activeTab, setActiveTab] = useState(
    mustChangePassword || defaultTab === 'password' || tabParam === 'password' ? 'password' : 'profile'
  )

  useEffect(() => {
    if (tabParam === 'password') {
      setActiveTab('password')
    }
  }, [tabParam])

  // Change Password Form State
  const [form, setForm] = useState(emptyForm)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  const setField = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const handlePasswordSubmit = async (e) => {
    e.preventDefault()
    setErrors({})
    setMessage('')
    setBusy(true)
    try {
      await authApi.changePassword(form)
      setForm(emptyForm)
      passwordChanged()
      // Notification badge toast replaces the previous static body alert
      notify({
        type: 'success',
        title: 'Kata Sandi Diperbarui',
        desc: 'Password berhasil diubah. Sesi perangkat lain telah dikeluarkan.',
        tag: 'Keamanan',
      })
    } catch (err) {
      if (err.status === 422 && err.errors) {
        setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v.join(' ')])))
      } else {
        setMessage(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  const selectTab = (tabName) => {
    setActiveTab(tabName)
    setSearchParams(tabName === 'password' ? { tab: 'password' } : {})
  }

  return (
    <div className="space-y-6">
      {/* Standard Page Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div>
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
            DISTRIVA / PROFIL & KEAMANAN AKUN
          </span>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
            Profil & Keamanan Akun
          </h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 mt-1 max-w-2xl">
            Kelola data identitas pengguna, status keaktifan akun, dan pengaturan kredensial kata sandi login.
          </p>
        </div>
      </div>

      {/* Main Standardized Full-Width Profile Card */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {/* Profile Hero Header */}
        <div className="p-6 bg-gradient-to-r from-slate-900 via-slate-850 to-slate-800 text-white border-b border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center gap-5">
            <div className="flex h-18 w-18 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white font-bold text-2xl ring-4 ring-white/10 shadow-lg">
              {user?.name ? user.name.slice(0, 2).toUpperCase() : <IconUser size={32} />}
            </div>
            <div className="space-y-1.5 min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2.5">
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white truncate">
                  {user?.name}
                </h2>
                {user?.account_status && (
                  <StatusBadge status={user.account_status} />
                )}
              </div>
              <div className="flex flex-wrap items-center gap-3 text-xs text-slate-300">
                <span className="font-mono">{user?.email}</span>
                {user?.nip && (
                  <>
                    <span className="text-slate-500">•</span>
                    <span className="font-mono text-slate-300">NIP: {user.nip}</span>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 px-6 gap-6">
          <button
            type="button"
            onClick={() => selectTab('profile')}
            className={`flex items-center gap-2 border-b-2 py-3.5 text-sm font-semibold transition-colors cursor-pointer ${
              activeTab === 'profile'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <IconUser size={16} />
            <span>Informasi Profil</span>
          </button>
          <button
            type="button"
            onClick={() => selectTab('password')}
            className={`flex items-center gap-2 border-b-2 py-3.5 text-sm font-semibold transition-colors cursor-pointer ${
              activeTab === 'password'
                ? 'border-emerald-600 text-emerald-600 dark:text-emerald-400'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            <IconKey size={16} />
            <span>Ubah Password & Keamanan</span>
          </button>
        </div>

        {/* Tab 1: Informasi Profil */}
        {activeTab === 'profile' && (
          <div className="p-6 sm:p-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              {/* Left Column (span 2): Detail Akun */}
              <div className="lg:col-span-2 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Detail Akun Pengguna
                  </h3>
                  <span className="text-xs text-slate-400">Terdaftar di DISTRIVA</span>
                </div>

                <dl className="divide-y divide-slate-100 dark:divide-slate-800 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                  {profileFields.map(([label, key]) => (
                    <div key={key} className="grid grid-cols-1 sm:grid-cols-3 gap-1 px-5 py-3.5 text-sm">
                      <dt className="font-medium text-slate-500 dark:text-slate-400">{label}</dt>
                      <dd className="sm:col-span-2 text-slate-900 dark:text-slate-100 font-mono text-xs sm:text-sm">
                        {key === 'account_status' && user?.[key] ? (
                          <StatusBadge status={user[key]} />
                        ) : (
                          user?.[key] || <span className="text-slate-400 italic font-sans">Belum diisi</span>
                        )}
                      </dd>
                    </div>
                  ))}
                </dl>
              </div>

              {/* Right Column (span 1): Info Keamanan & Shortcut */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Keamanan & Otoritas
                  </h3>
                </div>

                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 p-4 space-y-3">
                  <div className="flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 shrink-0">
                      <IconShield size={18} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                        Scope Penugasan: {mfaState?.required ? 'GLOBAL (Semua Unit)' : 'SAME_UNIT'}
                      </h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                        {mfaState?.required
                          ? 'Otoritas administrasi sistem global dan kontrol penuh seluruh unit kerja PLN.'
                          : 'Akses operasional dan data dibatasi sesuai unit kerja penugasan aktif Anda.'}
                      </p>
                    </div>
                  </div>

                  <div className="pt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex items-start gap-3">
                    <div className="p-2 rounded-lg bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 shrink-0">
                      <IconClock size={18} />
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">Batas Waktu Sesi</h4>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                        Sesi token aktif selama 30 menit idle time untuk menjaga keamanan platform.
                      </p>
                    </div>
                  </div>

                  {mfaState?.required && (
                    <div className="pt-3 border-t border-slate-200/60 dark:border-slate-700/60 flex items-start gap-3">
                      <div className="p-2 rounded-lg bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 shrink-0">
                        <IconKey size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">Autentikasi Dua Faktor (MFA)</h4>
                          <Link to="/mfa" className="text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:underline shrink-0">
                            Status &rarr;
                          </Link>
                        </div>
                        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                          Perlindungan TOTP RFC 6238 dan kode pemulihan darurat untuk akun SYS_ADMIN.
                        </p>
                      </div>
                    </div>
                  )}

                  <div className="pt-3">
                    <Button
                      variant="primary"
                      className="w-full justify-center"
                      onClick={() => selectTab('password')}
                    >
                      <IconKey size={14} />
                      <span>Ubah Password Sekarang</span>
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tab 2: Ubah Password & Keamanan */}
        {activeTab === 'password' && (
          <div className="p-6 sm:p-8">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
              {/* Left Column (span 2): Form Ubah Kata Sandi */}
              <div className="lg:col-span-2 space-y-5">
                <div>
                  <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">Ubah Kata Sandi</h2>
                  <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                    Kelola kredensial login akun DISTRIVA Anda. Notifikasi pembaruan akan otomatis muncul pada badge notifikasi.
                  </p>
                </div>

                <form onSubmit={handlePasswordSubmit} noValidate className="space-y-4">
                  {mustChangePassword && (
                    <Alert kind="warning">Anda harus mengubah password sebelum melanjutkan.</Alert>
                  )}
                  {message && <Alert>{message}</Alert>}

                  <Field
                    id="current_password"
                    label="Password saat ini"
                    type="password"
                    autoComplete="current-password"
                    value={form.current_password}
                    onChange={setField('current_password')}
                    error={errors.current_password}
                  />

                  <Field
                    id="password"
                    label="Password baru"
                    type="password"
                    autoComplete="new-password"
                    value={form.password}
                    onChange={setField('password')}
                    error={errors.password}
                  />

                  <Field
                    id="password_confirmation"
                    label="Konfirmasi password baru"
                    type="password"
                    autoComplete="new-password"
                    value={form.password_confirmation}
                    onChange={setField('password_confirmation')}
                    error={errors.password_confirmation}
                  />

                  <div className="pt-3">
                    <Button
                      type="submit"
                      variant="primary"
                      disabled={busy}
                      loading={busy}
                      className="px-6"
                    >
                      Simpan
                    </Button>
                  </div>
                </form>
              </div>

              {/* Right Column (span 1): Kebijakan Kata Sandi (Doc 16) */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
                  <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Kebijakan Keamanan Kredensial
                  </h3>
                </div>

                <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-5 space-y-4">
                  <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200">
                    <IconLock size={16} className="text-emerald-600 dark:text-emerald-400" />
                    <span className="text-xs font-bold">Ketentuan Kata Sandi (Doc 16):</span>
                  </div>

                  <ul className="list-disc space-y-2 pl-5 text-xs text-slate-600 dark:text-slate-400 leading-relaxed" aria-label="Aturan password">
                    <li>Minimal 8 karakter, memuat huruf besar, huruf kecil, angka, dan simbol.</li>
                    <li>Tidak sama dengan 5 password terakhir dan bukan password yang umum.</li>
                    <li>Tidak memuat nama atau bagian email Anda.</li>
                  </ul>

                  <div className="pt-3 border-t border-slate-200/60 dark:border-slate-700/60 text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
                    Setiap rotasi kredensial kata sandi dicatat dalam riwayat audit keamanan (Doc 16), dan sesi login pada perangkat lain akan otomatis dikeluarkan.
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
