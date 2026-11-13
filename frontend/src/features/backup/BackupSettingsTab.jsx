import { useState, useEffect } from 'react'
import { backupApi } from '../../services/api.js'
import { useNotifications } from '../notifications/NotificationContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import { IconCheck, IconExclamation } from '../../components/icons.jsx'

export default function BackupSettingsTab({ can }) {
  const { notify } = useNotifications()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [fieldErrors, setFieldErrors] = useState({})

  // Form states
  const [enabled, setEnabled] = useState(false)
  const [runAt, setRunAt] = useState('02:00')
  const [includeDocs, setIncludeDocs] = useState(false)
  const [retentionCount, setRetentionCount] = useState(30)
  const [updatedAt, setUpdatedAt] = useState(null)

  const canManage = Boolean(can?.['backups.manage'])

  // Load Settings
  const loadSettings = async () => {
    setLoading(true)
    setError('')
    try {
      const res = await backupApi.settings()
      const s = res?.data ?? res ?? {}
      setEnabled(Boolean(s?.enabled))
      setRunAt(s?.run_at || '02:00')
      setIncludeDocs(Boolean(s?.include_documents))
      setRetentionCount(Number(s?.retention_count) || 30)
      setUpdatedAt(s?.updated_at || null)
    } catch (err) {
      // If endpoint returns empty or fails gracefully, provide sensible defaults
      setEnabled(false)
      setRunAt('02:00')
      setIncludeDocs(false)
      setRetentionCount(30)
      setError(err?.message || 'Gagal memuat pengaturan jadwal cadangan.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadSettings()
  }, [])

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!canManage) return

    setFieldErrors({})
    setError('')
    setSaving(true)

    try {
      const payload = {
        enabled: Boolean(enabled),
        run_at: runAt.trim(),
        include_documents: Boolean(includeDocs),
        retention_count: Number(retentionCount) || 30,
      }
      const res = await backupApi.updateSettings(payload)
      const s = res?.data ?? res ?? {}
      setEnabled(Boolean(s?.enabled))
      setRunAt(s?.run_at || '02:00')
      setIncludeDocs(Boolean(s?.include_documents))
      setRetentionCount(Number(s?.retention_count) || 30)
      setUpdatedAt(s?.updated_at || null)
      notify({
        type: 'success',
        title: 'Jadwal Pencadangan Disimpan',
        desc: 'Pengaturan jadwal pencadangan berhasil disimpan.',
        tag: 'Backup',
      })
    } catch (err) {
      if (err?.data?.errors) {
        setFieldErrors(err.data.errors)
      } else {
        setError(err.message || 'Gagal menyimpan pengaturan jadwal.')
      }
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Spinner label="Memuat konfigurasi jadwal pencadangan otomatis..." />
      </div>
    )
  }

  return (
    <div className="w-full space-y-6">
      {error && <Alert kind="error">{error}</Alert>}

      {/* Static Important Server Cron Notice */}
      <div className="w-full p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 space-y-1.5 text-xs">
        <div className="flex items-center gap-2 font-bold">
          <IconExclamation size={16} className="text-blue-600 dark:text-blue-400" />
          <span>Informasi Penjadwalan Server (Cron Job)</span>
        </div>
        <p className="leading-relaxed">
          Pencadangan terjadwal membutuhkan cron <code>schedule:run</code> di server (lihat docs/64 §2). Satu percobaan per hari; kegagalan muncul di Ringkasan.
        </p>
      </div>

      {/* Main Settings Form Card */}
      <div className="w-full p-6 sm:p-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
        <form onSubmit={handleSubmit} className="space-y-6 text-xs">
          {/* Active Switch */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
            <div>
              <span className="text-sm font-bold text-slate-800 dark:text-slate-200 block">
                Aktifkan Pencadangan Otomatis Terjadwal
              </span>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Sistem akan menjalankan pencadangan secara otomatis setiap hari pada jam yang ditentukan.
              </p>
            </div>
            <label className="relative inline-flex items-center cursor-pointer shrink-0">
              <input
                type="checkbox"
                disabled={!canManage || saving}
                checked={enabled}
                onChange={(e) => setEnabled(e.target.checked)}
                className="sr-only peer"
              />
              <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-blue-600"></div>
            </label>
          </div>

          {/* Responsive Two-Column Grid for Schedule Parameters */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Time Picker (HH:MM) */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Waktu Eksekusi Harian (WIB / Asia/Jakarta) <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                disabled={!canManage || saving}
                value={runAt}
                onChange={(e) => setRunAt(e.target.value)}
                placeholder="02:00"
                pattern="^([01][0-9]|2[0-3]):[0-5][0-9]$"
                title="Format waktu HH:MM (contoh: 02:00)"
                required
                className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono focus-ring disabled:opacity-60"
              />
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
                Disarankan pada jam beban rendah (misalnya pukul 02:00 dini hari).
              </p>
              {fieldErrors.run_at && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">{fieldErrors.run_at}</p>
              )}
            </div>

            {/* Retention Count */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Jumlah Salinan Cadangan yang Disimpan (Retensi) <span className="text-rose-500">* (1–365)</span>
              </label>
              <input
                type="number"
                min={1}
                max={365}
                disabled={!canManage || saving}
                value={retentionCount}
                onChange={(e) => setRetentionCount(Math.max(1, Math.min(365, Number(e.target.value) || 1)))}
                required
                className="w-full px-3.5 py-2 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 font-mono focus-ring disabled:opacity-60"
              />
              <p className="text-[11px] text-slate-400 dark:text-slate-500 mt-1.5">
                Cadangan lama yang melebihi kuota retensi akan dihapus otomatis dari server (catatan riwayat tetap disimpan).
              </p>
              {fieldErrors.retention_count && (
                <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">{fieldErrors.retention_count}</p>
              )}
            </div>
          </div>

          {/* Include Documents Checkbox */}
          <div className="w-full p-4 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50 dark:bg-slate-800/40 space-y-1">
            <label className="flex items-start gap-2.5 cursor-pointer">
              <input
                type="checkbox"
                disabled={!canManage || saving}
                checked={includeDocs}
                onChange={(e) => setIncludeDocs(e.target.checked)}
                className="mt-0.5 rounded border-slate-300 dark:border-slate-600 text-blue-600 focus:ring-blue-500 disabled:opacity-60"
              />
              <span className="font-semibold text-slate-800 dark:text-slate-200 text-xs">
                Sertakan folder arsip dokumen fisik dalam jadwal otomatis
              </span>
            </label>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 pl-6">
              Jika dicentang, berkas dokumen permohonan dan foto survei akan diarsipkan bersama berkas dump database.
            </p>
          </div>

          {/* Submit Button & Last Updated Notice */}
          <div className="pt-5 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <span className="text-xs text-slate-400 dark:text-slate-500 order-2 sm:order-1">
              {updatedAt ? `Terakhir diperbarui: ${new Date(updatedAt).toLocaleString('id-ID')}` : ''}
            </span>

            <div className="order-1 sm:order-2">
              {canManage ? (
                <Button type="submit" variant="primary" loading={saving} className="w-full sm:w-auto">
                  Simpan Pengaturan Jadwal
                </Button>
              ) : (
                <span className="text-xs text-slate-400 dark:text-slate-500 italic">
                  Hanya dapat diubah oleh administrator dengan hak backups.manage.
                </span>
              )}
            </div>
          </div>
        </form>
      </div>
    </div>
  )
}
