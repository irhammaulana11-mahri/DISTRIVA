import { useState, useEffect, useCallback, useRef } from 'react'
import { Navigate, useNavigate, useLocation, Link } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthContext.jsx'
import { mfaApi } from '../services/api.js'
import QrCode from '../components/QrCode.jsx'
import Alert from '../components/Alert.jsx'
import Button from '../components/Button.jsx'
import {
  IconShield,
  IconLock,
  IconKey,
  IconCheck,
  IconCheckCircle,
  IconDownload,
  IconClipboard,
  IconLogout,
  IconAlertCircle,
  IconRefresh,
} from '../components/icons.jsx'

export default function MfaPage() {
  const { user, mfaState, setMfaVerified, refreshMfaStatus, logout } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()

  // Enrolment state
  const [enrollData, setEnrollData] = useState(null)
  const [loadingEnroll, setLoadingEnroll] = useState(false)
  const [recoveryCodes, setRecoveryCodes] = useState(null)
  const [copiedSecret, setCopiedSecret] = useState(false)
  const [copiedRecovery, setCopiedRecovery] = useState(false)

  // Form input state
  const [code, setCode] = useState('')
  const [isRecoveryMode, setIsRecoveryMode] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  const isRequired = Boolean(mfaState?.required)
  const isEnrolled = Boolean(mfaState?.enrolled)
  const isVerified = Boolean(mfaState?.verified)

  // MFA is exclusively enforced for SYS_ADMIN. Non-SYS_ADMIN roles must not access this page.
  if (mfaState && !mfaState.required) {
    return <Navigate to="/" replace />
  }

  // Ref to guard against concurrent enrollment calls across React StrictMode cycles
  const enrollingRef = useRef(false)

  const handleEnroll = useCallback(() => {
    if (enrollingRef.current) return
    enrollingRef.current = true
    setLoadingEnroll(true)
    setError('')

    mfaApi
      .enroll()
      .then((res) => {
        setEnrollData(res.data)
      })
      .catch((err) => {
        if (err.status === 409) {
          // Already enrolled on server; transition immediately to verification mode
          setMfaVerified({ required: true, enrolled: true, verified: false })
          refreshMfaStatus()
        } else {
          setError(err.message || 'Gagal memulai pendaftaran MFA.')
        }
      })
      .finally(() => {
        enrollingRef.current = false
        setLoadingEnroll(false)
      })
  }, [setMfaVerified, refreshMfaStatus])

  // Fetch enrolment data ONLY if MFA is required and not enrolled yet
  useEffect(() => {
    if (isRequired && !isEnrolled && !enrollData && !recoveryCodes) {
      handleEnroll()
    }
  }, [isRequired, isEnrolled, Boolean(enrollData), Boolean(recoveryCodes), handleEnroll])

  // Copy secret key
  const handleCopySecret = () => {
    if (!enrollData?.secret) return
    navigator.clipboard?.writeText(enrollData.secret)
    setCopiedSecret(true)
    setTimeout(() => setCopiedSecret(false), 2500)
  }

  // Copy all recovery codes
  const handleCopyRecoveryCodes = () => {
    if (!recoveryCodes || recoveryCodes.length === 0) return
    const text = recoveryCodes.join('\n')
    navigator.clipboard?.writeText(text)
    setCopiedRecovery(true)
    setTimeout(() => setCopiedRecovery(false), 2500)
  }

  // Download recovery codes as txt
  const handleDownloadRecoveryCodes = () => {
    if (!recoveryCodes || recoveryCodes.length === 0) return
    const content = [
      '====================================================',
      ' DISTRIVA - KODE PEMULIHAN DARURAT (MFA TOTP)',
      ` Pengguna : ${user?.name || ''} (${user?.email || ''})`,
      ` Dibuat   : ${new Date().toLocaleString('id-ID')}`,
      '====================================================',
      '',
      'PERINGATAN:',
      '- Setiap kode hanya dapat digunakan SATU KALI.',
      '- Gunakan jika Anda kehilangan akses ke aplikasi authenticator.',
      '- Simpan dokumen ini di tempat yang aman dan rahasia.',
      '',
      'DAFTAR KODE PEMULIHAN:',
      ...recoveryCodes.map((c, i) => ` [${i + 1}] ${c}`),
      '',
      '====================================================',
    ].join('\n')

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `distriva-recovery-codes-${user?.email || 'admin'}.txt`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }

  // Enrolment confirmation
  const handleConfirmEnroll = async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')
    if (!code.trim()) {
      setError('Masukkan 6 digit kode dari aplikasi authenticator.')
      return
    }

    setBusy(true)
    try {
      const res = await mfaApi.confirm(code.trim())
      setRecoveryCodes(res.recovery_codes || [])
      setNotice('Pendaftaran MFA berhasil diaktifkan! Harap simpan kode pemulihan berikut.')
      setCode('')
    } catch (err) {
      if (err.status === 422) {
        setError(err.message || 'Kode salah. Pastikan waktu pada perangkat Anda sesuai.')
      } else if (err.status === 409) {
        setError(err.message || 'MFA sudah terdaftar atau sesi pendaftaran kedaluwarsa.')
        refreshMfaStatus()
      } else {
        setError(err.message || 'Terjadi kesalahan saat mengonfirmasi MFA.')
      }
    } finally {
      setBusy(false)
    }
  }

  // Verification
  const handleVerify = async (e) => {
    e.preventDefault()
    setError('')
    setNotice('')
    if (!code.trim()) {
      setError(
        isRecoveryMode
          ? 'Masukkan kode pemulihan darurat (format: XXXXX-XXXXX).'
          : 'Masukkan 6 digit kode dari aplikasi authenticator.'
      )
      return
    }

    setBusy(true)
    try {
      const res = await mfaApi.verify(code.trim())
      setMfaVerified(res.mfa)
      // Navigate to original destination or home
      const destination = location.state?.from?.pathname || '/'
      navigate(destination, { replace: true })
    } catch (err) {
      if (err.status === 422) {
        setError('Kode salah.')
      } else if (err.status === 409) {
        setError(err.message || 'Terlalu banyak percobaan salah. Coba lagi nanti.')
      } else {
        setError(err.message || 'Gagal memverifikasi MFA.')
      }
    } finally {
      setBusy(false)
    }
  }

  // Completion after saving recovery codes
  const handleFinishEnrollment = () => {
    setMfaVerified({ required: true, enrolled: true, verified: true })
    const destination = location.state?.from?.pathname || '/'
    navigate(destination, { replace: true })
  }

  // Helper format secret into groups of 4 characters: ABCD EFGH ...
  const formatSecret = (sec) => {
    if (!sec) return ''
    return sec.match(/.{1,4}/g)?.join(' ') || sec
  }

  return (
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 flex flex-col justify-between text-slate-800 dark:text-slate-100">
      {/* Top Bar Navigation */}
      <header className="border-b border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 px-6 py-4">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src="/distriva-icon.png" alt="DISTRIVA" className="h-9 w-9 object-contain drop-shadow" />
            <div>
              <span className="font-bold tracking-tight text-slate-900 dark:text-white block text-sm leading-tight">
                DISTRIVA
              </span>
              <span className="text-[10px] text-slate-500 uppercase tracking-wider font-semibold">
                Sistem Keamanan Akses
              </span>
            </div>
          </div>

          <div className="flex items-center gap-4 text-xs">
            <div className="hidden sm:flex flex-col text-right">
              <span className="font-semibold text-slate-900 dark:text-slate-100">{user?.name}</span>
              <span className="text-slate-400 font-mono text-[11px]">{user?.email}</span>
            </div>
            <button
              type="button"
              onClick={logout}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 font-medium transition-colors cursor-pointer"
            >
              <IconLogout size={14} />
              <span>Keluar</span>
            </button>
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex items-center justify-center p-4 sm:p-6 lg:p-8">
        <div className="w-full max-w-2xl bg-white dark:bg-slate-900 rounded-3xl border border-slate-200/90 dark:border-slate-800 shadow-xl overflow-hidden">
          {/* Header Banner */}
          <div className="bg-gradient-to-r from-blue-700 via-indigo-700 to-slate-900 p-6 sm:p-8 text-white">
            <div className="flex items-center gap-3.5 mb-2">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 backdrop-blur-md text-white border border-white/20 shadow-inner">
                <IconShield size={24} />
              </div>
              <div>
                <span className="text-[11px] uppercase tracking-widest text-blue-200 font-bold block">
                  Autentikasi Dua Faktor (MFA)
                </span>
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                  {recoveryCodes
                    ? 'Simpan Kode Pemulihan Darurat'
                    : isEnrolled
                    ? 'Verifikasi Identitas Anda'
                    : 'Pendaftaran Authenticator (TOTP)'}
                </h1>
              </div>
            </div>
            <p className="text-xs sm:text-sm text-blue-100/90 leading-relaxed max-w-xl">
              {recoveryCodes
                ? 'Kode pemulihan ini adalah kunci cadangan Anda jika kehilangan perangkat autentikasi. Simpan di tempat yang aman.'
                : isEnrolled
                ? 'Akun SYS_ADMIN wajib diverifikasi menggunakan kode TOTP aplikasi authenticator pada setiap sesi baru.'
                : 'Sesuai kebijakan keamanan platform DISTRIVA (RFC 6238), peran SYS_ADMIN wajib mengaktifkan autentikasi dua faktor.'}
            </p>
          </div>

          <div className="p-6 sm:p-8 space-y-6">
            {error && <Alert kind="error">{error}</Alert>}
            {notice && <Alert kind="success">{notice}</Alert>}

            {/* FLOW 1: ENROLMENT - STEP 3: RECOVERY CODES DISPLAY */}
            {recoveryCodes && (
              <div className="space-y-6" data-testid="mfa-recovery-codes-section">
                <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 text-amber-900 dark:text-amber-200 text-xs sm:text-sm space-y-1">
                  <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
                    <IconAlertCircle size={18} />
                    <span>Perhatian: Kode Hanya Ditampilkan Satu Kali</span>
                  </div>
                  <p className="text-xs text-amber-700 dark:text-amber-300/90 leading-relaxed">
                    Kode-kode di bawah ini tidak akan pernah dapat ditampilkan kembali setelah Anda meninggalkan halaman ini.
                    Simpan salinan cetak atau simpan di password manager aman Anda.
                  </p>
                </div>

                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                      8 Kode Pemulihan Darurat (One-Time Recovery Codes)
                    </span>
                    <span className="text-xs text-slate-400">Format: XXXXX-XXXXX</span>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700">
                    {recoveryCodes.map((rc, idx) => (
                      <div
                        key={idx}
                        className="px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200/80 dark:border-slate-800 text-center font-mono text-xs sm:text-sm font-bold text-slate-800 dark:text-slate-200 tracking-wider shadow-xs"
                      >
                        {rc}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actions: Copy & Download */}
                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleCopyRecoveryCodes}
                    className="flex-1 justify-center py-2.5"
                  >
                    {copiedRecovery ? <IconCheck size={16} className="text-emerald-600" /> : <IconClipboard size={16} />}
                    <span>{copiedRecovery ? 'Kode Berhasil Disalin!' : 'Salin Semua Kode'}</span>
                  </Button>

                  <Button
                    type="button"
                    variant="secondary"
                    onClick={handleDownloadRecoveryCodes}
                    className="flex-1 justify-center py-2.5"
                  >
                    <IconDownload size={16} />
                    <span>Unduh File (.txt)</span>
                  </Button>
                </div>

                <div className="pt-4 border-t border-slate-100 dark:border-slate-800">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={handleFinishEnrollment}
                    className="w-full justify-center py-3 text-sm font-semibold shadow-md"
                  >
                    <IconCheckCircle size={18} />
                    <span>Saya Telah Menyimpan Kode & Masuk ke Sistem</span>
                  </Button>
                </div>
              </div>
            )}

            {/* FLOW 1: ENROLMENT - STEP 1 & 2: SETUP & CONFIRM */}
            {!isEnrolled && !recoveryCodes && (
              <div className="space-y-6" data-testid="mfa-enroll-section">
                {loadingEnroll && (
                  <div className="p-8 text-center text-slate-400 text-sm flex flex-col items-center gap-2">
                    <IconRefresh size={24} className="animate-spin text-blue-600" />
                    <span>Mempersiapkan kunci rahasia authenticator…</span>
                  </div>
                )}

                {!loadingEnroll && !enrollData && (
                  <div className="p-8 text-center text-slate-500 text-sm space-y-3">
                    <p>Kunci rahasia authenticator belum dapat dimuat.</p>
                    <Button
                      type="button"
                      variant="primary"
                      onClick={handleEnroll}
                      className="inline-flex justify-center"
                    >
                      <IconRefresh size={16} />
                      <span>Coba Muat Ulang Kunci</span>
                    </Button>
                  </div>
                )}

                {enrollData && (
                  <>
                    <div className="grid grid-cols-1 md:grid-cols-12 gap-6 items-center p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700">
                      {/* Left: QR Code Display */}
                      <div className="md:col-span-5 flex flex-col items-center justify-center space-y-2">
                        <QrCode value={enrollData.otpauth_uri} size={170} />
                        <span className="text-[11px] text-slate-500 dark:text-slate-400 text-center">
                          Pindai dengan Google Authenticator atau aplikasi sejenis
                        </span>
                      </div>

                      {/* Right: Secret Key & Manual Instructions */}
                      <div className="md:col-span-7 space-y-3.5">
                        <div>
                          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400 block mb-1">
                            Atau Masukkan Secret Key Manual
                          </span>
                          <div className="p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2">
                            <div className="font-mono text-sm sm:text-base font-bold text-blue-700 dark:text-blue-400 tracking-wider break-all select-all">
                              {formatSecret(enrollData.secret)}
                            </div>
                            <Button
                              type="button"
                              variant="ghost"
                              onClick={handleCopySecret}
                              className="text-xs py-1 px-2.5 h-auto w-full justify-center text-slate-600 dark:text-slate-300"
                            >
                              {copiedSecret ? <IconCheck size={14} className="text-emerald-600" /> : <IconClipboard size={14} />}
                              <span>{copiedSecret ? 'Secret Disalin!' : 'Salin Secret Key'}</span>
                            </Button>
                          </div>
                        </div>

                        <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1">
                          <p>• Akun: <span className="font-mono font-medium text-slate-700 dark:text-slate-200">{user?.email}</span></p>
                          <p>• Tipe: <span className="font-medium text-slate-700 dark:text-slate-200">Time-based (TOTP - 30s)</span></p>
                        </div>
                      </div>
                    </div>

                    {/* Step 2: Confirm 6-Digit Code */}
                    <form onSubmit={handleConfirmEnroll} noValidate className="space-y-4 pt-2">
                      <div>
                        <label
                          htmlFor="enroll-code"
                          className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5"
                        >
                          Masukkan 6 Digit Kode dari Aplikasi Authenticator
                        </label>
                        <input
                          id="enroll-code"
                          type="text"
                          inputMode="numeric"
                          pattern="[0-9]*"
                          maxLength={6}
                          autoComplete="one-time-code"
                          placeholder="000000"
                          value={code}
                          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                          className="w-full text-center tracking-widest text-2xl font-mono font-bold px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 shadow-xs"
                        />
                      </div>

                      <Button
                        type="submit"
                        variant="primary"
                        disabled={busy || code.length < 6}
                        loading={busy}
                        className="w-full justify-center py-3 text-sm font-semibold"
                      >
                        <IconKey size={16} />
                        <span>Konfirmasi & Aktifkan MFA</span>
                      </Button>
                    </form>
                  </>
                )}
              </div>
            )}

            {/* FLOW 2: VERIFICATION (ENROLLED BUT UNVERIFIED TOKEN) */}
            {isEnrolled && !isVerified && (
              <div className="space-y-6" data-testid="mfa-verify-section">
                <form onSubmit={handleVerify} noValidate className="space-y-5">
                  <div>
                    <label
                      htmlFor="verify-code"
                      className="block text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-1.5"
                    >
                      {isRecoveryMode
                        ? 'Masukkan Kode Pemulihan Darurat (10 Karakter)'
                        : 'Kode 6 Digit dari Aplikasi Authenticator'}
                    </label>
                    <input
                      id="verify-code"
                      type="text"
                      autoComplete="one-time-code"
                      placeholder={isRecoveryMode ? 'XXXXX-XXXXX' : '000000'}
                      maxLength={isRecoveryMode ? 11 : 6}
                      value={code}
                      onChange={(e) => {
                        const val = e.target.value
                        if (isRecoveryMode) {
                          setCode(val.toUpperCase())
                        } else {
                          setCode(val.replace(/\D/g, ''))
                        }
                      }}
                      className="w-full text-center tracking-widest text-2xl font-mono font-bold px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 shadow-xs uppercase"
                    />
                    <p className="text-xs text-slate-400 mt-1.5 text-center">
                      {isRecoveryMode
                        ? 'Gunakan salah satu dari 8 kode cadangan yang telah Anda simpan.'
                        : 'Buka aplikasi authenticator di ponsel Anda dan masukkan kode 6 angka yang tampil.'}
                    </p>
                  </div>

                  <Button
                    type="submit"
                    variant="primary"
                    disabled={busy || (isRecoveryMode ? code.trim().length < 10 : code.trim().length < 6)}
                    loading={busy}
                    className="w-full justify-center py-3 text-sm font-semibold"
                  >
                    <IconLock size={16} />
                    <span>Verifikasi & Lanjutkan</span>
                  </Button>
                </form>

                {/* Switch between TOTP and Recovery Code */}
                <div className="pt-4 border-t border-slate-100 dark:border-slate-800 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setIsRecoveryMode(!isRecoveryMode)
                      setCode('')
                      setError('')
                    }}
                    className="text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    {isRecoveryMode
                      ? 'Kembali gunakan kode TOTP 6 digit aplikasi'
                      : 'Kehilangan akses authenticator? Gunakan Kode Pemulihan Darurat'}
                  </button>
                </div>
              </div>
            )}

            {/* FLOW 3: ALREADY ENROLLED & VERIFIED (STATUS OVERVIEW) */}
            {isEnrolled && isVerified && (
              <div className="space-y-6" data-testid="mfa-status-section">
                <div className="p-5 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-900/60 flex items-start gap-4">
                  <div className="p-2.5 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 shrink-0">
                    <IconCheckCircle size={24} />
                  </div>
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
                      Autentikasi Dua Faktor Aktif & Terlindungi
                    </h3>
                    <p className="text-xs text-emerald-800/80 dark:text-emerald-300/80 leading-relaxed">
                      Sesi akun Anda saat ini telah berhasil diverifikasi dengan standar RFC 6238 TOTP.
                      Seluruh hak tulis konfigurasi sistem dan master data telah dibuka secara aman.
                    </p>
                  </div>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-2 text-xs text-slate-600 dark:text-slate-400">
                  <span className="font-bold text-slate-800 dark:text-slate-200 block">
                    Penanganan Perangkat Hilang / Reset:
                  </span>
                  <p>
                    Apabila Anda kehilangan perangkat authenticator dan kehabisan kode pemulihan darurat,
                    reset credential MFA dapat dijalankan oleh pengelola server melalui CLI Laravel:
                  </p>
                  <code className="block p-2.5 rounded-lg bg-slate-900 text-emerald-400 font-mono text-[11px] overflow-x-auto">
                    php artisan distriva:mfa-reset --email={user?.email || 'admin@distriva.com'}
                  </code>
                </div>

                <div className="pt-2 flex flex-col sm:flex-row gap-3">
                  <Button
                    type="button"
                    variant="primary"
                    onClick={() => navigate('/')}
                    className="flex-1 justify-center py-2.5"
                  >
                    <span>Kembali ke Beranda</span>
                  </Button>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => navigate('/profil')}
                    className="flex-1 justify-center py-2.5"
                  >
                    <span>Lihat Profil Akun</span>
                  </Button>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>

      {/* Footer */}
      <footer className="p-4 text-center text-xs text-slate-400">
        © 2026 PT PLN (Persero) · DISTRIVA Security Gateway · Dokumen 57 §3b
      </footer>
    </div>
  )
}
