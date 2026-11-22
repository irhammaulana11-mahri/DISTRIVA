import { useState, useEffect } from 'react'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { mfaApi } from '../../services/api.js'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import {
  IconShield,
  IconCheckCircle,
  IconKey,
  IconLock,
  IconRefresh,
  IconAlertCircle,
  IconClipboard,
  IconCheck,
} from '../../components/icons.jsx'

/**
 * Halaman Manajemen Keamanan MFA (di dalam menu Pengaturan).
 * Digunakan oleh pengguna SYS_ADMIN yang sudah login untuk memantau status MFA,
 * panduan authenticator, dan prosedur pemulihan darurat.
 */
export default function MfaSettingsPage() {
  const { user, mfaState, refreshMfaStatus } = useAuth()
  const [loading, setLoading] = useState(false)
  const [copiedCli, setCopiedCli] = useState(false)
  const [notice, setNotice] = useState('')

  const isEnrolled = Boolean(mfaState?.enrolled)
  const isVerified = Boolean(mfaState?.verified)
  const isRequired = Boolean(mfaState?.required)

  const handleRefresh = async () => {
    setLoading(true)
    try {
      if (refreshMfaStatus) {
        await refreshMfaStatus()
      }
      setNotice('Status keamanan MFA berhasil diperbarui.')
      setTimeout(() => setNotice(''), 3000)
    } finally {
      setLoading(false)
    }
  }

  const cliCommand = `php artisan distriva:mfa-reset --email=${user?.email || 'admin@distriva.com'}`

  const handleCopyCli = () => {
    navigator.clipboard?.writeText(cliCommand)
    setCopiedCli(true)
    setTimeout(() => setCopiedCli(false), 2500)
  }

  return (
    <div className="space-y-5 w-full">
      {/* 1. Hero Header Card Standar DISTRIVA */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-600 flex items-center justify-center text-white shadow-xs shrink-0">
              <IconShield size={26} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                  Keamanan MFA (Autentikasi Dua Faktor)
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                  RFC 6238 TOTP
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                  <IconShield size={12} />
                  SYS_ADMIN
                </span>
              </div>
              <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
                Pengelolaan dan pemantauan autentikasi dua faktor berbasis waktu (TOTP) untuk melindungi akun administrator dan transaksi sistem.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
            <Button
              variant="secondary"
              onClick={handleRefresh}
              loading={loading}
              icon={IconRefresh}
            >
              Segarkan
            </Button>
          </div>
        </div>
      </div>

      {/* 2. KPI Metrics Cards (4 Kolom Seragam) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium">Status Proteksi</span>
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                isEnrolled
                  ? 'bg-emerald-500 ring-2 ring-emerald-200 dark:ring-emerald-900'
                  : 'bg-amber-500 ring-2 ring-amber-200 dark:ring-amber-900'
              }`}
            />
          </div>
          <div className="mt-2 text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
            {isEnrolled ? 'Aktif & Terlindungi' : 'Belum Terdaftar'}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {isEnrolled ? 'TOTP terhubung ke perangkat' : 'Pendaftaran diperlukan'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium">Algoritma Kunci</span>
            <IconKey size={16} className="text-blue-500" />
          </div>
          <div className="mt-2 text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
            TOTP (30 Detik)
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            Standar RFC 6238 6-Digit
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium">Sesi Saat Ini</span>
            <IconLock size={16} className="text-emerald-500" />
          </div>
          <div className="mt-2 text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
            {isVerified ? 'Terverifikasi' : 'Belum Verifikasi'}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {isVerified ? 'Hak tulis sistem terbuka' : 'Perlu validasi login'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium">Kebijakan Akses</span>
            <IconShield size={16} className="text-purple-500" />
          </div>
          <div className="mt-2 text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
            {isRequired ? 'Wajib (SYS_ADMIN)' : 'Opsional'}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            Kebijakan keamanan platform
          </p>
        </div>
      </div>

      {notice && <Alert kind="success">{notice}</Alert>}

      {/* 3. Panel Informasi Status Keamanan */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-5 sm:p-6 space-y-5">
        <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
            Informasi Status Autentikasi Dua Faktor
          </h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Rincian kredensial akun dan metode verifikasi yang diterapkan pada sesi Anda.
          </p>
        </div>

        <div className="p-4 sm:p-5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/60 flex items-start gap-3.5">
          <div className="p-2 rounded-xl bg-emerald-100 dark:bg-emerald-900/60 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5">
            <IconCheckCircle size={22} />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-bold text-emerald-900 dark:text-emerald-200">
              Akun Administrator Terlindungi Penuh
            </h3>
            <p className="text-xs text-emerald-800/90 dark:text-emerald-300/90 leading-relaxed">
              Akun <strong>{user?.name}</strong> ({user?.email}) terdaftar dengan perlindungan MFA.
              Setiap kali masuk ke sistem, kode TOTP 6 digit dari aplikasi authenticator akan diminta untuk mengonfirmasi identitas Anda.
            </p>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-1.5">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Aplikasi Authenticator yang Didukung
            </span>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              Anda dapat menggunakan aplikasi authenticator standar apa pun yang mendukung protokol TOTP RFC 6238:
            </p>
            <ul className="text-xs text-slate-600 dark:text-slate-400 space-y-1 list-disc list-inside pt-1">
              <li>Google Authenticator (Android / iOS)</li>
              <li>Microsoft Authenticator</li>
              <li>2FAS Authenticator / Aegis Authenticator</li>
              <li>Bitwarden / 1Password / KeePassXC</li>
            </ul>
          </div>

          <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-1.5">
            <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider">
              Kode Pemulihan Cadangan (Recovery Codes)
            </span>
            <p className="text-xs text-slate-700 dark:text-slate-300 leading-relaxed">
              Saat pertama kali mendaftar, sistem memberikan 8 kode pemulihan sekali pakai (format XXXXX-XXXXX).
              Kode tersebut digunakan saat Anda tidak membawa ponsel atau kehilangan akses ke aplikasi authenticator.
            </p>
          </div>
        </div>

        {/* 4. Prosedur Reset & Penanganan Darurat */}
        <div className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 space-y-3">
          <div className="flex items-center gap-2 text-slate-800 dark:text-slate-200 font-bold text-sm">
            <IconAlertCircle size={18} className="text-amber-500" />
            <span>Prosedur Ganti Perangkat / Pemulihan Darurat</span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
            Jika Anda berganti ponsel baru, kehilangan perangkat authenticator, atau kehabisan kode pemulihan darurat,
            administrator server dapat melakukan reset kredensial MFA melalui perintah Artisan di terminal server:
          </p>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <code className="flex-1 p-2.5 rounded-xl bg-slate-900 text-emerald-400 font-mono text-xs overflow-x-auto border border-slate-800 select-all">
              {cliCommand}
            </code>
            <Button
              type="button"
              variant="secondary"
              onClick={handleCopyCli}
              className="shrink-0 text-xs py-2"
            >
              {copiedCli ? <IconCheck size={14} className="text-emerald-600" /> : <IconClipboard size={14} />}
              <span>{copiedCli ? 'Disalin!' : 'Salin Perintah'}</span>
            </Button>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
            * Setelah reset dijalankan, pengguna akan otomatis diarahkan kembali ke layar pendaftaran QR code saat login berikutnya.
          </p>
        </div>
      </div>
    </div>
  )
}
