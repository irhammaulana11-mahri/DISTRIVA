import { useState } from 'react'
import { Link, Navigate, useLocation } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthContext.jsx'
import Alert from '../components/Alert.jsx'
import { IconShield, IconLock, IconMail, IconLogin, IconEye } from '../components/icons.jsx'

export default function LoginPage() {
  const { login, status, mfaPending } = useAuth()
  const location = useLocation()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)

  if (status === 'authenticated') {
    if (mfaPending) {
      return <Navigate to="/mfa" replace state={{ from: location.state?.from }} />
    }
    return <Navigate to={location.state?.from?.pathname ?? '/'} replace />
  }

  async function onSubmit(e) {
    e.preventDefault()
    setErrors({})
    setMessage('')
    setBusy(true)
    try {
      await login(email, password)
    } catch (err) {
      if (err.status === 422 && err.errors) {
        setErrors(Object.fromEntries(Object.entries(err.errors).map(([k, v]) => [k, v[0]])))
      } else if (err.status === 429) {
        setMessage('Terlalu banyak percobaan. Coba lagi sebentar lagi.')
      } else {
        setMessage(err.message)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-slate-50">
      {/* Left Panel: High-Impact Distribution Brand Panel (approx 50% width on desktop) */}
      <div className="w-full lg:w-1/2 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-800 flex flex-col justify-between p-8 sm:p-12 lg:p-16 text-white min-h-[300px] lg:min-h-screen">
        <div className="flex items-center gap-3">
          <img src="/distriva-icon.png" alt="DISTRIVA" className="h-10 w-10 object-contain drop-shadow" />
          <div>
            <span className="text-lg font-bold tracking-tight text-white block leading-tight">DISTRIVA</span>
            <span className="text-[10px] text-blue-200 uppercase tracking-widest font-semibold">Distribution Platform</span>
          </div>
        </div>

        <div className="my-auto py-10 lg:py-0 text-center max-w-xl mx-auto">
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-white tracking-tight leading-tight mb-5">
            Sistem Manajemen Distribusi & Operasional Jaringan
          </h1>
          <p className="text-sm sm:text-base text-blue-100/90 leading-relaxed font-normal max-w-lg mx-auto">
            Platform terpadu pengelolaan permohonan pelanggan PB/PD, survei teknis, kalkulasi Auto MTO,
            perencanaan RKM & KKF, hingga penerbitan Work Order dan monitoring jaringan secara realtime terpusat.
          </p>
        </div>

        <div className="text-center lg:text-left text-xs text-blue-200/80">
          <p>© 2026 PT PLN (Persero) · Enterprise Distribution Platform</p>
        </div>
      </div>

      {/* Right Panel: Clean Floating Login Card Container (approx 50% width on desktop) */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-10 lg:p-12">
        <div className="w-full max-w-md bg-white rounded-3xl p-7 sm:p-10 shadow-xl border border-slate-100 space-y-6">
          {/* Card Header with Icon */}
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-xs mb-3">
              <IconLogin size={26} />
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">Selamat Datang Kembali</h2>
            <p className="text-xs text-slate-500">Silakan masukkan akun kredensial Anda yang terdaftar resmi</p>
          </div>

          {message && <Alert>{message}</Alert>}

          <form onSubmit={onSubmit} noValidate className="space-y-4">
            {/* Field: Alamat Email */}
            <div>
              <label
                htmlFor="email"
                className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5"
              >
                ALAMAT EMAIL
              </label>
              <div
                className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 transition-colors ${
                  errors.email
                    ? 'border-red-400 bg-red-50/30'
                    : 'border-slate-200 bg-blue-50/30 focus-within:border-blue-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500/20'
                }`}
              >
                <IconMail size={18} className="text-slate-400 shrink-0" />
                <input
                  id="email"
                  type="email"
                  autoComplete="username"
                  aria-label="Email"
                  placeholder="nama@pln.co.id"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full bg-transparent text-sm text-slate-900 placeholder-slate-400 font-medium focus:outline-none"
                  required
                />
              </div>
              {errors.email && <p className="text-xs text-red-600 mt-1">{errors.email}</p>}
            </div>

            {/* Field: Kata Sandi */}
            <div>
              <label
                htmlFor="password"
                className="block text-[11px] font-bold text-slate-700 uppercase tracking-wider mb-1.5"
              >
                KATA SANDI (PASSWORD)
              </label>
              <div
                className={`flex items-center gap-2.5 rounded-xl border px-3.5 py-3 transition-colors ${
                  errors.password
                    ? 'border-red-400 bg-red-50/30'
                    : 'border-slate-200 bg-blue-50/30 focus-within:border-blue-500 focus-within:bg-white focus-within:ring-2 focus-within:ring-blue-500/20'
                }`}
              >
                <IconLock size={18} className="text-slate-400 shrink-0" />
                <input
                  id="password"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="current-password"
                  aria-label="Password"
                  placeholder="••••••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full bg-transparent text-sm text-slate-900 placeholder-slate-400 font-medium focus:outline-none"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((p) => !p)}
                  className="text-slate-400 hover:text-slate-600 p-0.5 focus:outline-none"
                  title={showPassword ? 'Sembunyikan password' : 'Lihat password'}
                >
                  <IconEye size={16} />
                </button>
              </div>
              {errors.password && <p className="text-xs text-red-600 mt-1">{errors.password}</p>}
            </div>

            {/* Submit Button */}
            <div className="pt-2">
              <button
                type="submit"
                disabled={busy}
                aria-label="Masuk"
                className="w-full rounded-xl bg-blue-600 py-3 px-4 text-sm font-semibold text-white shadow-md shadow-blue-500/25 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 transition cursor-pointer focus-ring"
              >
                {busy ? 'Memverifikasi Kredensial…' : 'Masuk ke Sistem'}
              </button>
            </div>

            {/* Connected Menus / Links */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs pt-3 border-t border-slate-100">
              <Link
                to="/aktivasi"
                className="text-blue-600 hover:text-blue-800 font-semibold hover:underline"
              >
                Aktivasi akun baru
              </Link>
              <Link
                to="/pemulihan"
                className="text-blue-600 hover:text-blue-800 font-semibold hover:underline"
              >
                Lupa password / akun terkunci?
              </Link>
            </div>

            {/* Security Indicator */}
            <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100 text-center">
              <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
                <IconShield size={13} className="text-slate-400" />
                <span>Otentikasi Terproteksi & Akreditasi Resmi PLN</span>
              </div>
            </div>
          </form>
        </div>
      </div>
    </div>
  )
}
