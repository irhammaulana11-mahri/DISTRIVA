import { useState, useEffect, useRef } from 'react'
import { backupApi } from '../../services/api.js'
import { formatBytes, formatDateTime, isOlderThanHours } from './backupUtils.js'
import { useBackupPolling } from './useBackupPolling.js'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import Modal from '../../components/Modal.jsx'
import StatusBadge, { VerifiedBadge } from '../../components/StatusBadge.jsx'
import {
  IconDatabase,
  IconShield,
  IconCheck,
  IconX,
  IconExclamation,
  IconRefresh,
  IconPlus,
} from '../../components/icons.jsx'

export default function BackupSummaryTab({ can, onSwitchTab }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusData, setStatusData] = useState(null)

  // Create Backup Dialog State
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [includeDocs, setIncludeDocs] = useState(false)
  const [notes, setNotes] = useState('')
  const [createSubmitting, setCreateSubmitting] = useState(false)
  const [createError, setCreateError] = useState('')
  const [createdBackup, setCreatedBackup] = useState(null)
  const [createdProgress, setCreatedProgress] = useState(null)

  const activePollingBackupRef = useRef(null)

  // Load Status Data
  const loadStatus = async (silent = false) => {
    if (!silent) setError('')
    try {
      const res = await backupApi.status()
      setStatusData(res.data)
    } catch (err) {
      if (!silent) setError(err.message || 'Gagal memuat status cadangan.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadStatus()
  }, [])

  // Check if any process is currently running
  const isRunning = Boolean(statusData?.running_backup || statusData?.running_restore)

  // Polling hook: polls every 5s ONLY if something is running
  useBackupPolling(() => {
    loadStatus(true)
  }, 5000, isRunning)

  // Polling for manual backup creation
  const pollCreatedBackup = (id) => {
    if (activePollingBackupRef.current) clearInterval(activePollingBackupRef.current)

    activePollingBackupRef.current = setInterval(async () => {
      try {
        const res = await backupApi.get(id)
        const b = res.data
        setCreatedProgress(b)
        if (b.status === 'SUCCEEDED' || b.status === 'FAILED') {
          clearInterval(activePollingBackupRef.current)
          activePollingBackupRef.current = null
          loadStatus(true)
        }
      } catch {
        // keep polling
      }
    }, 2500)
  }

  useEffect(() => {
    return () => {
      if (activePollingBackupRef.current) {
        clearInterval(activePollingBackupRef.current)
        activePollingBackupRef.current = null
      }
    }
  }, [])

  const handleCreateBackup = async (e) => {
    e.preventDefault()
    setCreateSubmitting(true)
    setCreateError('')
    try {
      const res = await backupApi.create({
        include_documents: includeDocs,
        notes: notes.trim() || undefined,
      })
      const b = res.data
      setCreatedBackup(b)
      setCreatedProgress(b)
      pollCreatedBackup(b.id)
      loadStatus(true)
    } catch (err) {
      setCreateError(err.message || 'Gagal membuat cadangan sistem.')
      setCreateSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Spinner label="Memeriksa kesehatan dan status sistem cadangan..." />
      </div>
    )
  }

  const health = statusData?.health || {}
  const isHealthOk = Boolean(health.ok)
  const lastSuccess = statusData?.last_success
  const lastVerified = statusData?.last_verified
  const lastFailure = statusData?.last_failure
  const runningBackup = statusData?.running_backup
  const runningRestore = statusData?.running_restore

  const isStale = lastSuccess ? isOlderThanHours(lastSuccess.started_at, 36) : true
  const noVerified = !lastVerified

  return (
    <div className="space-y-6">
      {error && <Alert kind="error">{error}</Alert>}

      {/* Global In-Flight Process Banner */}
      {isRunning && (
        <div
          className="p-4 rounded-xl border border-blue-300 dark:border-blue-900 bg-blue-50/90 dark:bg-blue-950/40 text-blue-900 dark:text-blue-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3 shadow-xs animate-pulse"
          role="status"
          aria-live="polite"
        >
          <div className="flex items-center gap-3">
            <Spinner size="sm" />
            <div>
              <h4 className="text-sm font-bold">
                {runningBackup
                  ? `Pencadangan Sistem Sedang Berjalan (#${runningBackup.backup_number})`
                  : `Pemulihan Database Sedang Berjalan (#${runningRestore?.backup_number})`}
              </h4>
              <p className="text-xs text-blue-700 dark:text-blue-300 mt-0.5">
                Dimulai sejak: {formatDateTime(runningBackup?.started_at || runningRestore?.started_at)}. Seluruh tombol aksi dinonaktifkan sementara demi konsistensi data.
              </p>
            </div>
          </div>
          <span className="text-xs font-mono font-bold px-2.5 py-1 rounded-md bg-blue-200 dark:bg-blue-900 text-blue-800 dark:text-blue-200 self-start sm:self-auto">
            PROSES AKTIF
          </span>
        </div>
      )}

      {/* Health Warning Alert if health is not OK */}
      {!isHealthOk && (
        <div className="p-4 rounded-xl border border-red-300 dark:border-red-900 bg-red-50 dark:bg-red-950/40 text-red-900 dark:text-red-200 space-y-1">
          <div className="flex items-center gap-2 font-bold text-sm">
            <IconExclamation size={16} className="text-red-600 dark:text-red-400" />
            <span>Kesehatan Folder Cadangan Terganggu</span>
          </div>
          <p className="text-xs">
            {health.message || 'Folder penyimpanan cadangan tidak dapat ditulis atau tidak memenuhi kriteria keamanan.'}
          </p>
        </div>
      )}

      {/* Stale / No-Verification Warning Alert */}
      {isHealthOk && (isStale || noVerified) && (
        <div className="p-4 rounded-xl border border-amber-300 dark:border-amber-900 bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 space-y-1">
          <div className="flex items-center gap-2 font-bold text-sm">
            <IconExclamation size={16} className="text-amber-600 dark:text-amber-400" />
            <span>Peringatan Pemeliharaan Cadangan</span>
          </div>
          <ul className="text-xs list-disc list-inside space-y-0.5">
            {isStale && (
              <li>
                Cadangan berhasil terakhir berumur lebih dari 36 jam. Disarankan untuk segera membuat cadangan baru.
              </li>
            )}
            {noVerified && (
              <li>
                Belum ada berkas cadangan yang terverifikasi aman untuk pemulihan. Lakukan verifikasi cadangan pada tab Riwayat.
              </li>
            )}
          </ul>
        </div>
      )}

      {/* Top Cards: Health & Status */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Folder Health */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Kesehatan Penyimpanan
            </span>
            <span
              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold ${
                isHealthOk
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
              }`}
            >
              {isHealthOk ? 'Normal' : 'Bermasalah'}
            </span>
          </div>
          <div>
            <div className="text-xl font-bold font-mono text-slate-900 dark:text-slate-100">
              {formatBytes(health.free_bytes)}
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5">Sisa Ruang Bebas Penyimpanan</p>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 leading-snug border-t border-slate-100 dark:border-slate-800 pt-2">
            {health.message || (isHealthOk ? 'Direktori penyimpanan cadangan privat siap digunakan.' : 'Akses direktori gagal.')}
          </p>
        </div>

        {/* Card 2: Last Succeeded Backup */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Cadangan Terakhir Berhasil
            </span>
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
          </div>
          {lastSuccess ? (
            <div>
              <div className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100 truncate">
                #{lastSuccess.backup_number}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {formatDateTime(lastSuccess.started_at)}
              </p>
              <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                Ukuran DB: <strong className="font-mono">{formatBytes(lastSuccess.db_size)}</strong>
              </div>
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic py-2">Belum ada cadangan berhasil.</p>
          )}
        </div>

        {/* Card 3: Last Verified */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Terakhir Terverifikasi
            </span>
            <span className="h-2 w-2 rounded-full bg-cyan-500" />
          </div>
          {lastVerified ? (
            <div>
              <div className="text-sm font-bold font-mono text-slate-900 dark:text-slate-100 truncate flex items-center gap-1.5">
                <span>#{lastVerified.backup_number}</span>
                <VerifiedBadge passed={true} />
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {formatDateTime(lastVerified.verified_at)}
              </p>
              <div className="mt-2 text-xs text-slate-600 dark:text-slate-300">
                Ukuran DB: <strong className="font-mono">{formatBytes(lastVerified.db_size)}</strong>
              </div>
            </div>
          ) : (
            <p className="text-xs text-amber-600 dark:text-amber-400 italic py-2">
              Belum ada cadangan yang terverifikasi.
            </p>
          )}
        </div>

        {/* Card 4: Last Failure */}
        <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Terakhir Gagal
            </span>
            <span className="h-2 w-2 rounded-full bg-rose-500" />
          </div>
          {lastFailure ? (
            <div>
              <div className="text-sm font-bold font-mono text-rose-600 dark:text-rose-400 truncate">
                #{lastFailure.backup_number}
              </div>
              <p className="text-xs text-slate-500 mt-0.5">
                {formatDateTime(lastFailure.started_at)}
              </p>
              <p className="mt-2 text-[11px] text-rose-700 dark:text-rose-300 truncate" title={lastFailure.error}>
                {lastFailure.error || 'Terjadi kesalahan sistem saat pencadangan.'}
              </p>
            </div>
          ) : (
            <p className="text-xs text-slate-400 italic py-2">Tidak ada riwayat kegagalan.</p>
          )}
        </div>
      </div>

      {/* Primary Actions & Quick Links Bar */}
      <div className="p-5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Tindakan Pencadangan Sistem
          </h4>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Buat salinan data lengkap database dan dokumen secara manual, atau kelola jadwal otomatis.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => loadStatus()}
            disabled={isRunning}
          >
            <IconRefresh size={14} className="mr-1" />
            Segarkan
          </Button>

          {can['backups.create'] && (
            <Button
              variant="primary"
              size="sm"
              disabled={!isHealthOk || isRunning}
              onClick={() => {
                setCreateModalOpen(true)
                setIncludeDocs(false)
                setNotes('')
                setCreateError('')
                setCreatedBackup(null)
                setCreatedProgress(null)
                setCreateSubmitting(false)
              }}
            >
              <IconPlus size={14} className="mr-1" />
              Buat Cadangan Sekarang
            </Button>
          )}
        </div>
      </div>

      {/* DRAWER: Buat Cadangan Sekarang */}
      <Modal
        open={createModalOpen}
        title="Buat Cadangan Sistem Sekarang"
        size="max-w-xl"
        onClose={() => {
          if (!createSubmitting && (!createdProgress || createdProgress.status !== 'RUNNING')) {
            setCreateModalOpen(false)
          }
        }}
        footer={
          createdProgress?.status === 'SUCCEEDED' || createdProgress?.status === 'FAILED' ? (
            <Button
              variant="primary"
              onClick={() => {
                setCreateModalOpen(false)
                onSwitchTab?.('history')
              }}
            >
              Lihat di Tab Riwayat
            </Button>
          ) : (
            <div className="flex items-center justify-end gap-2">
              <Button
                variant="ghost"
                onClick={() => setCreateModalOpen(false)}
                disabled={createSubmitting}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                loading={createSubmitting}
                onClick={handleCreateBackup}
              >
                Mulai Cadangkan
              </Button>
            </div>
          )
        }
      >
        <div className="space-y-4 text-xs">
          {createError && <Alert kind="error">{createError}</Alert>}

          {/* If Backup was initiated, show progress and polling state */}
          {createdProgress ? (
            <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/50 dark:bg-blue-950/30 text-center space-y-3">
              {createdProgress.status === 'RUNNING' && (
                <>
                  <Spinner size="md" label="Pencadangan sedang diproses..." />
                  <h4 className="font-bold text-slate-800 dark:text-slate-200">
                    Proses Pencadangan Berjalan (#{createdProgress.backup_number})
                  </h4>
                  <p className="text-[11px] text-slate-500">
                    Sistem sedang mengekspor database dan mengarsipkan dokumen. Status diperiksa otomatis...
                  </p>
                </>
              )}

              {createdProgress.status === 'SUCCEEDED' && (
                <div className="text-emerald-700 dark:text-emerald-400 space-y-1">
                  <div className="inline-flex p-2 rounded-full bg-emerald-100 text-emerald-700 mb-1">
                    <IconCheck size={24} />
                  </div>
                  <h4 className="font-bold text-sm">Pencadangan Berhasil</h4>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    Nomor Cadangan: <strong>#{createdProgress.backup_number}</strong> ({formatBytes(createdProgress.db_size)})
                  </p>
                </div>
              )}

              {createdProgress.status === 'FAILED' && (
                <div className="text-rose-700 dark:text-rose-400 space-y-1">
                  <div className="inline-flex p-2 rounded-full bg-rose-100 text-rose-700 mb-1">
                    <IconX size={24} />
                  </div>
                  <h4 className="font-bold text-sm">Pencadangan Gagal</h4>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300">
                    {createdProgress.error || 'Terjadi kesalahan sistem saat mengekspor database.'}
                  </p>
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={handleCreateBackup} className="space-y-4">
              <p className="text-slate-600 dark:text-slate-300">
                Cadangan akan mencakup seluruh tabel database utama secara atomik. Berkas disimpan dengan izin privat di server.
              </p>

              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 space-y-1">
                <label className="flex items-start gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={includeDocs}
                    onChange={(e) => setIncludeDocs(e.target.checked)}
                    className="mt-0.5 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span className="font-semibold text-slate-800 dark:text-slate-200">
                    Sertakan folder dokumen fisik (tar.gz)
                  </span>
                </label>
                <p className="text-[10px] text-slate-400 pl-5">
                  Mengarsipkan seluruh foto survei dan dokumen permohonan ke dalam arsip pendukung.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Catatan Cadangan (Opsional)
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Contoh: Cadangan sebelum pembaruan sistem dan konfigurasi jaringan..."
                  className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
                />
              </div>
            </form>
          )}
        </div>
      </Modal>
    </div>
  )
}
