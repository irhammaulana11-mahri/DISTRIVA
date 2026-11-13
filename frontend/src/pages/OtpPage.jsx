import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { authApi } from '../services/api.js'
import Field from '../components/Field.jsx'
import Alert from '../components/Alert.jsx'
import { IconShield, IconKey, IconLock, IconArrowLeft } from '../components/icons.jsx'

// Public page for account activation and recovery with a one-time code (OTP).
const TEXT = {
  activation: {
    title: 'Aktivasi akun',
    bannerTitle: 'Aktivasi Akun Pegawai DISTRIVA',
    bannerDesc: 'Sistem verifikasi mandiri berbasis kode OTP satu kali pakai yang dikirimkan langsung ke email resmi kedinasan atau WhatsApp Anda.',
    intro: 'Masukkan email yang didaftarkan administrator untuk menerima kode OTP aktivasi.',
    submit: 'Aktifkan akun',
  },
  recovery: {
    title: 'Pemulihan akses',
    bannerTitle: 'Pemulihan Akses & Buka Kunci Akun',
    bannerDesc: 'Atur ulang kata sandi atau buka status penguncian akun secara mandiri dan aman melalui kode verifikasi OTP resmi.',
    intro: 'Lupa password atau akun terkunci? Masukkan email Anda untuk menerima kode OTP pemulihan.',
    submit: 'Atur password baru',
  },
}
const COOLDOWN = 60

export default function OtpPage({ purpose }) {
  const t = TEXT[purpose]
  const [step, setStep] = useState('email') // email -> code -> done
  const [email, setEmail] = useState('')
  const [form, setForm] = useState({ otp: '', password: '', password_confirmation: '' })
  const [errors, setErrors] = useState({})
  const [message, setMessage] = useState('')
  const [info, setInfo] = useState('')
  const [busy, setBusy] = useState(false)
  const [wait, setWait] = useState(0)

  useEffect(() => {
    if (wait <= 0) return undefined
    const id = setTimeout(() => setWait((w) => w - 1), 1000)
    return () => clearTimeout(id)
  }, [wait])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))
  const fieldErrors = (errs) => Object.fromEntries(Object.entries(errs).map(([k, v]) => [k, v.join(' ')]))

  async function requestCode(e) {
    e?.preventDefault()
    setErrors({})
    setMessage('')
    setBusy(true)
    try {
      const res = await authApi.otpRequest(email.trim(), purpose)
      setInfo(res.message)
      setStep('code')
      setWait(COOLDOWN)
    } catch (err) {
      if (err.status === 422 && err.errors) setErrors(fieldErrors(err.errors))
      else setMessage(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function submitCode(e) {
    e.preventDefault()
    setErrors({})
    setMessage('')
    setBusy(true)
    try {
      const res = await authApi.otpVerify({ email: email.trim(), purpose, ...form })
      setInfo(res.message)
      setStep('done')
    } catch (err) {
      if (err.status === 422 && err.errors) setErrors(fieldErrors(err.errors))
      else setMessage(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col lg:flex-row bg-slate-50">
      {/* Left Panel: High-Impact Distribution Brand Panel */}
      <div className="w-full lg:w-1/2 bg-gradient-to-br from-blue-700 via-blue-600 to-indigo-800 flex flex-col justify-between p-8 sm:p-12 lg:p-16 text-white min-h-[260px] lg:min-h-screen">
        <div className="flex items-center gap-3">
          <img src="/distriva-icon.png" alt="DISTRIVA" className="h-10 w-10 object-contain drop-shadow" />
          <div>
            <span className="text-lg font-bold tracking-tight text-white block leading-tight">DISTRIVA</span>
            <span className="text-[10px] text-blue-200 uppercase tracking-widest font-semibold">Distribution Platform</span>
          </div>
        </div>

        <div className="my-auto py-8 lg:py-0 text-center max-w-xl mx-auto">
          <h1 className="text-2xl sm:text-3xl lg:text-4xl font-extrabold text-white tracking-tight leading-tight mb-4">
            {t.bannerTitle}
          </h1>
          <p className="text-sm sm:text-base text-blue-100/90 leading-relaxed font-normal max-w-lg mx-auto">
            {t.bannerDesc}
          </p>
        </div>

        <div className="text-center lg:text-left text-xs text-blue-200/80">
          <p>© 2026 PT PLN (Persero) · Enterprise Distribution Platform</p>
        </div>
      </div>

      {/* Right Panel: Floating Card Container */}
      <div className="w-full lg:w-1/2 flex items-center justify-center p-6 sm:p-10 lg:p-12">
        <div className="w-full max-w-md bg-white rounded-3xl p-7 sm:p-10 shadow-xl border border-slate-100 space-y-6">
          <div className="text-center space-y-2">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-xs mb-3">
              {purpose === 'activation' ? <IconKey size={26} /> : <IconLock size={26} />}
            </div>
            <h2 className="text-2xl font-bold text-slate-900 tracking-tight">{t.title}</h2>
            {step === 'email' && <p className="text-xs text-slate-500">{t.intro}</p>}
          </div>

          {message && <Alert>{message}</Alert>}

          {step === 'email' && (
            <form onSubmit={requestCode} noValidate className="space-y-4">
              <Field
                id="email"
                label="Email"
                type="email"
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                error={errors.email}
                required
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-blue-600 py-3 px-4 text-sm font-semibold text-white shadow-md shadow-blue-500/25 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 transition cursor-pointer focus-ring"
              >
                {busy ? 'Mengirim…' : 'Kirim kode OTP'}
              </button>
            </form>
          )}

          {step === 'code' && (
            <form onSubmit={submitCode} noValidate className="space-y-4">
              <Alert kind="success">{info}</Alert>
              <Field
                id="otp"
                label="Kode OTP (6 digit)"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                value={form.otp}
                onChange={set('otp')}
                error={errors.otp}
                required
              />
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                <p className="text-xs font-semibold text-slate-700 mb-1">Ketentuan Kata Sandi (Doc 16):</p>
                <ul className="list-disc space-y-0.5 pl-5 text-xs text-slate-500" aria-label="Aturan password">
                  <li>Minimal 8 karakter, memuat huruf besar, huruf kecil, angka, dan simbol.</li>
                  <li>Tidak sama dengan 5 password terakhir dan bukan password yang umum.</li>
                  <li>Tidak memuat nama atau bagian email Anda.</li>
                </ul>
              </div>
              <Field
                id="password"
                label="Password baru"
                type="password"
                autoComplete="new-password"
                value={form.password}
                onChange={set('password')}
                error={errors.password}
                required
              />
              <Field
                id="password_confirmation"
                label="Konfirmasi password baru"
                type="password"
                autoComplete="new-password"
                value={form.password_confirmation}
                onChange={set('password_confirmation')}
                error={errors.password_confirmation}
                required
              />
              <button
                type="submit"
                disabled={busy}
                className="w-full rounded-xl bg-blue-600 py-3 px-4 text-sm font-semibold text-white shadow-md shadow-blue-500/25 hover:bg-blue-700 active:bg-blue-800 disabled:opacity-60 transition cursor-pointer focus-ring"
              >
                {busy ? 'Memproses…' : t.submit}
              </button>
              <div className="flex items-center justify-between text-xs pt-2">
                <button
                  type="button"
                  disabled={busy || wait > 0}
                  onClick={requestCode}
                  className="text-blue-600 hover:text-blue-800 font-semibold underline disabled:text-slate-400 disabled:no-underline"
                >
                  {wait > 0 ? `Kirim ulang kode (${wait} dtk)` : 'Kirim ulang kode'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setStep('email')
                    setErrors({})
                    setMessage('')
                  }}
                  className="text-slate-600 hover:text-slate-900 underline"
                >
                  Ganti email
                </button>
              </div>
            </form>
          )}

          {step === 'done' && (
            <div className="space-y-4">
              <Alert kind="success">{info}</Alert>
              <Link
                to="/login"
                className="block w-full rounded-xl bg-blue-600 py-3 px-4 text-center text-sm font-semibold text-white shadow-md shadow-blue-500/25 hover:bg-blue-700 active:bg-blue-800 transition"
              >
                Ke halaman masuk
              </Link>
            </div>
          )}

          {step !== 'done' && (
            <div className="pt-3 border-t border-slate-100 text-center">
              <Link
                to="/login"
                className="inline-flex items-center gap-1.5 text-xs text-blue-600 hover:text-blue-800 font-semibold hover:underline"
              >
                <IconArrowLeft size={14} />
                <span>Kembali ke halaman masuk</span>
              </Link>
            </div>
          )}

          <div className="rounded-xl bg-slate-50 p-2.5 border border-slate-100 text-center">
            <div className="flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
              <IconShield size={13} className="text-slate-400" />
              <span>Otentikasi Aman Sanctum & Proteksi Kredensial PLN</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
