import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { backupApi, tokenStore } from '../../services/api.js'
import { formatBytes, formatDateTime } from './backupUtils.js'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import Modal from '../../components/Modal.jsx'
import { IconShield, IconExclamation, IconCheck, IconX } from '../../components/icons.jsx'

export default function RestoreDialog({ open, backup, onClose, onSuccess }) {
  const navigate = useNavigate()
  const [restoreDocs, setRestoreDocs] = useState(false)
  const [reason, setReason] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPhrase, setConfirmPhrase] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [serverError, setServerError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  // In-flight restore tracking
  const [restoreRun, setRestoreRun] = useState(null)
  const [restoreProgress, setRestoreProgress] = useState(null)
  const pollingRef = useRef(null)

  const targetPhrase = backup ? `PULIHKAN ${backup.backup_number}` : ''
  const isMatch = confirmPhrase.trim() === targetPhrase

  // Clean up polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current)
        pollingRef.current = null
      }
    }
  }, [])

  // Poll restore status
  const startPolling = (restoreId) => {
    if (pollingRef.current) clearInterval(pollingRef.current)

    pollingRef.current = setInterval(async () => {
      try {
        const res = await backupApi.getRestore(restoreId)
        const run = res.data
        setRestoreProgress(run)

        if (run.status === 'SUCCEEDED' || run.status === 'FAILED') {
          clearInterval(pollingRef.current)
          pollingRef.current = null
          onSuccess?.()
        }
      } catch (err) {
        // 401 is normal and expected when database is restored (auth token restored to backup state)
        if (err?.status === 401) {
          clearInterval(pollingRef.current)
          pollingRef.current = null
          tokenStore.clear()
          navigate('/login', {
            replace: true,
            state: {
              flash: 'Pemulihan selesai atau sesi berakhir; masuk kembali lalu periksa Riwayat Pemulihan.',
            },
          })
        }
      }
    }, 3000)
  }

  const handleStartRestore = async (e) => {
    e.preventDefault()
    setFieldErrors({})
    setServerError('')

    if (!isMatch) {
      setFieldErrors({ confirm: `Ketik persis: ${targetPhrase}` })
      return
    }

    if (reason.trim().length < 5) {
      setFieldErrors({ reason: 'Alasan pemulihan minimal 5 karakter.' })
      return
    }

    if (!password) {
      setFieldErrors({ password: 'Kata sandi wajib diisi.' })
      return
    }

    const currentPassword = password
    setPassword('') // Immediately clear password from local component state

    setSubmitting(true)
    try {
      const res = await backupApi.restore(backup.id, {
        confirm: confirmPhrase.trim(),
        reason: reason.trim(),
        password: currentPassword,
        restore_documents: restoreDocs,
      })

      const run = res.data
      setRestoreRun(run)
      setRestoreProgress(run)
      startPolling(run.id)
    } catch (err) {
      setSubmitting(false)
      if (err?.data?.errors) {
        setFieldErrors(err.data.errors)
      } else {
        setServerError(err?.message || 'Gagal memulai pemulihan database.')
      }
    }
  }

  if (!open || !backup) return null

  // 1. Fullscreen In-Flight / Result Overlay
  if (restoreRun) {
    const isRunning = !restoreProgress || restoreProgress.status === 'RUNNING'
    const isSucceeded = restoreProgress?.status === 'SUCCEEDED'
    const isFailed = restoreProgress?.status === 'FAILED'

    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-md p-4"
        role="alertdialog"
        aria-live="assertive"
      >
        <div className="max-w-lg w-full bg-white dark:bg-slate-900 rounded-2xl p-6 sm:p-8 shadow-2xl border border-slate-200 dark:border-slate-800 space-y-6 text-center">
          {isRunning && (
            <div className="space-y-4">
              <div className="inline-flex p-4 rounded-full bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400">
                <Spinner size="lg" label="Pemulihan sedang berjalan..." />
              </div>
              <div>
                <h3 className="text-lg font-bold text-slate-900 dark:text-slate-100">
                  Pemulihan Berjalan — Jangan Tutup Halaman
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-2">
                  Sistem sedang memulihkan data dari cadangan <strong>{backup.backup_number}</strong>. Transaksi database berjalan dalam mode aman (single-transaction).
                </p>
              </div>
              <div className="p-3 rounded-lg bg-amber-50 dark:bg-amber-950/40 text-amber-800 dark:text-amber-300 text-xs border border-amber-200 dark:border-amber-800 text-left">
                <strong>Catatan Keamanan:</strong> Bila sesi login Anda terputus (401), sistem akan mengarahkan Anda ke halaman login secara otomatis karena tabel pengguna telah dipulihkan.
              </div>
            </div>
          )}

          {isSucceeded && (
            <div className="space-y-4">
              <div className="inline-flex p-4 rounded-full bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400">
                <IconCheck size={36} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-emerald-700 dark:text-emerald-400">
                  Pemulihan Database Berhasil
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-2">
                  Seluruh data berhasil dipulihkan sesuai kondisi cadangan <strong>{backup.backup_number}</strong>.
                </p>
                {restoreProgress.safety_backup_id && (
                  <p className="text-xs text-slate-500 mt-1">
                    Cadangan pengaman sebelum pemulihan dibuat otomatis (ID: <code className="font-mono text-[11px]">{restoreProgress.safety_backup_id.slice(0, 8)}…</code>).
                  </p>
                )}
              </div>
              <Button
                variant="primary"
                className="w-full"
                onClick={() => {
                  setRestoreRun(null)
                  onClose?.()
                }}
              >
                Tutup & Periksa Data
              </Button>
            </div>
          )}

          {isFailed && (
            <div className="space-y-4">
              <div className="inline-flex p-4 rounded-full bg-rose-50 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400">
                <IconX size={36} />
              </div>
              <div>
                <h3 className="text-lg font-bold text-rose-700 dark:text-rose-400">
                  Pemulihan Database Gagal
                </h3>
                <p className="text-xs text-slate-600 dark:text-slate-300 mt-2">
                  {restoreProgress.error || 'Terjadi kesalahan sistem saat memulihkan database.'}
                </p>
                <div className="mt-3 p-3 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-slate-700 dark:text-slate-300 font-semibold border border-slate-200 dark:border-slate-700 text-left">
                  Data Anda tidak berubah karena proses pemulihan berjalan dalam satu transaksi penuh (atomic roll-back).
                </div>
              </div>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  setRestoreRun(null)
                  onClose?.()
                }}
              >
                Tutup
              </Button>
            </div>
          )}
        </div>
      </div>
    )
  }

  // 2. Multi-Step Confirmation Drawer
  return (
    <Modal
      open={open}
      title={`Konfirmasi Pemulihan Data (${backup.backup_number})`}
      onClose={onClose}
      size="max-w-xl"
      footer={
        <div className="flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={submitting}>
            Batal
          </Button>
          <Button
            variant="danger"
            disabled={!isMatch || submitting || reason.trim().length < 5}
            loading={submitting}
            onClick={handleStartRestore}
          >
            Pulihkan Sekarang
          </Button>
        </div>
      }
    >
      <form onSubmit={handleStartRestore} className="space-y-4 text-xs">
        {/* Critical Red Warning Banner */}
        <div className="p-3.5 rounded-xl border border-red-300 dark:border-red-900/80 bg-red-50/90 dark:bg-red-950/40 text-red-900 dark:text-red-200 space-y-2">
          <div className="flex items-center gap-2 font-bold">
            <IconExclamation size={16} className="text-red-600 dark:text-red-400 shrink-0" />
            <span>PERINGATAN KRITIKAL: PENGGANTIAN DATA TOTAL</span>
          </div>
          <p className="text-[11px] leading-relaxed">
            Tindakan ini mengganti seluruh data aplikasi dengan isi cadangan <strong>{backup.backup_number}</strong> ({formatDateTime(backup.started_at)}). Data yang dibuat setelah waktu tersebut akan hilang dari sistem (cadangan pengaman otomatis dibuat lebih dulu). Semua pengguna harus login ulang.
          </p>
          {backup.verified_at && (
            <div className="pt-1 flex items-center gap-1.5 text-[10px] text-emerald-800 dark:text-emerald-300 font-semibold">
              <span className="p-0.5 rounded bg-emerald-100 text-emerald-700">✓</span>
              <span>Terverifikasi aman pada: {formatDateTime(backup.verified_at)}</span>
            </div>
          )}
        </div>

        {serverError && <Alert kind="error">{serverError}</Alert>}

        {/* Optional Document Restoration Checkbox */}
        {backup.include_documents && backup.docs_size > 0 && (
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/50 space-y-1">
            <label className="flex items-start gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={restoreDocs}
                onChange={(e) => setRestoreDocs(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Pulihkan juga berkas dokumen yang hilang ({formatBytes(backup.docs_size)})
              </span>
            </label>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 pl-5">
              Hanya menambahkan berkas yang hilang di direktori penyimpanan; tidak menimpa atau menghapus berkas yang sudah ada.
            </p>
          </div>
        )}

        {/* Reason Field */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Alasan Pemulihan <span className="text-rose-500">* (Min. 5 karakter)</span>
          </label>
          <input
            type="text"
            required
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Contoh: Pemulihan data setelah insiden kegagalan migrasi server..."
            className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
          />
          {fieldErrors.reason && (
            <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.reason}</p>
          )}
        </div>

        {/* Administrator Password Confirmation */}
        <div>
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Kata Sandi Anda (SYS_ADMIN) <span className="text-rose-500">*</span>
          </label>
          <input
            type="password"
            required
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="Masukkan kata sandi akun Anda untuk otorisasi..."
            className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
          />
          {fieldErrors.password && (
            <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.password}</p>
          )}
        </div>

        {/* Exact Phrase Match Field */}
        <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
          <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
            Ketik persis frasa verifikasi berikut untuk mengaktifkan tombol:
          </label>
          <div className="p-2 mb-2 rounded bg-slate-100 dark:bg-slate-800 text-center font-mono font-bold text-slate-900 dark:text-slate-100 select-all tracking-wider text-xs border border-slate-200 dark:border-slate-700">
            {targetPhrase}
          </div>
          <input
            type="text"
            required
            value={confirmPhrase}
            onChange={(e) => setConfirmPhrase(e.target.value)}
            placeholder={`Ketik ${targetPhrase}`}
            className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono focus-ring"
          />
          {fieldErrors.confirm && (
            <p className="text-[11px] text-rose-600 mt-1">{fieldErrors.confirm}</p>
          )}
        </div>
      </form>
    </Modal>
  )
}
