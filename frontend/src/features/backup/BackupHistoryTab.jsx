import { useState, useEffect } from 'react'
import { backupApi } from '../../services/api.js'
import { formatBytes, formatDateTime, formatTriggerLabel } from './backupUtils.js'
import StatusBadge, { VerifiedBadge } from '../../components/StatusBadge.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import Drawer from '../../components/Drawer.jsx'
import Modal from '../../components/Modal.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import RestoreDialog from './RestoreDialog.jsx'
import {
  IconCheck,
  IconX,
  IconExclamation,
  IconDownload,
  IconTrash,
  IconShield,
  IconRefresh,
  IconChevronRight,
  IconChevronDown,
} from '../../components/icons.jsx'

export default function BackupHistoryTab({ can, onReloadSummary }) {
  const [backups, setBackups] = useState([])
  const [meta, setMeta] = useState({ current_page: 1, last_page: 1, total: 0, per_page: 10 })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filter states
  const [statusFilter, setStatusFilter] = useState('')
  const [triggerFilter, setTriggerFilter] = useState('')
  const [perPage, setPerPage] = useState(10)
  const [page, setPage] = useState(1)

  // Detail Modal State
  const [detailModalOpen, setDetailModalOpen] = useState(false)
  const [detailBackup, setDetailBackup] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [detailError, setDetailError] = useState('')
  const [copiedSha, setCopiedSha] = useState(false)

  // Verification State
  const [verifyingId, setVerifyingId] = useState(null)
  const [verifyResultModal, setVerifyResultModal] = useState(null)

  // Download State
  const [downloadModalBackup, setDownloadModalBackup] = useState(null)
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState('')

  // Remove State
  const [removeModalBackup, setRemoveModalBackup] = useState(null)
  const [removeReason, setRemoveReason] = useState('')
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState('')

  // Restore State
  const [restoreModalBackup, setRestoreModalBackup] = useState(null)

  // Load backups list
  const loadBackups = async (silent = false) => {
    if (!silent) setLoading(true)
    setError('')
    try {
      const res = await backupApi.list({
        status: statusFilter || undefined,
        trigger: triggerFilter || undefined,
        per_page: perPage,
        page,
      })
      setBackups(res.data || [])
      if (res.meta) setMeta(res.meta)
    } catch (err) {
      setError(err.message || 'Gagal memuat riwayat cadangan.')
    } finally {
      if (!silent) setLoading(false)
    }
  }

  useEffect(() => {
    loadBackups()
  }, [statusFilter, triggerFilter, perPage, page])

  // Open Detail
  const handleOpenDetail = async (backupId) => {
    setDetailModalOpen(true)
    setLoadingDetail(true)
    setDetailError('')
    setDetailBackup(null)
    setCopiedSha(false)
    try {
      const res = await backupApi.get(backupId)
      setDetailBackup(res.data)
    } catch (err) {
      setDetailError(err.message || 'Gagal memuat rincian cadangan.')
    } finally {
      setLoadingDetail(false)
    }
  }

  // Handle Verify (synchronous)
  const handleRunVerify = async (b) => {
    setVerifyingId(b.id)
    try {
      const res = await backupApi.verify(b.id)
      setVerifyResultModal({
        backup: res.data,
        result: res.result,
      })
      loadBackups(true)
      onReloadSummary?.()
    } catch (err) {
      setVerifyResultModal({
        backup: b,
        result: {
          passed: false,
          error: err.message || 'Proses verifikasi cadangan gagal dieksekusi.',
        },
      })
    } finally {
      setVerifyingId(null)
    }
  }

  // Handle Download via Authenticated Blob
  const handleDownloadFile = async (fileType) => {
    if (!downloadModalBackup) return
    setDownloading(true)
    setDownloadError('')
    try {
      const { blob, filename } = await backupApi.downloadBlob(downloadModalBackup.id, fileType)
      const url = window.URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = filename
      document.body.appendChild(a)
      a.click()
      a.remove()
      setTimeout(() => window.URL.revokeObjectURL(url), 1000)
      setDownloadModalBackup(null)
    } catch (err) {
      setDownloadError(err.message || 'Gagal mengunduh berkas cadangan.')
    } finally {
      setDownloading(false)
    }
  }

  // Handle Remove
  const handleConfirmRemove = async (e) => {
    e.preventDefault()
    if (!removeModalBackup) return
    if (removeReason.trim().length < 3) {
      setRemoveError('Alasan penghapusan minimal 3 karakter.')
      return
    }

    setRemoving(true)
    setRemoveError('')
    try {
      await backupApi.remove(removeModalBackup.id, { reason: removeReason.trim() })
      setRemoveModalBackup(null)
      setRemoveReason('')
      loadBackups(true)
      onReloadSummary?.()
    } catch (err) {
      setRemoveError(err.message || 'Gagal menghapus berkas cadangan.')
    } finally {
      setRemoving(false)
    }
  }

  const copyShaToClipboard = (sha) => {
    if (!sha) return
    navigator.clipboard?.writeText(sha)
    setCopiedSha(true)
    setTimeout(() => setCopiedSha(false), 2000)
  }

  return (
    <div className="space-y-4">
      {error && <Alert kind="error">{error}</Alert>}

      {/* Filter and Controls Toolbar */}
      <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col md:flex-row md:items-center justify-between gap-3 text-xs">
        <div className="flex flex-wrap items-center gap-2">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => {
              setStatusFilter(e.target.value)
              setPage(1)
            }}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <option value="">Semua Status</option>
            <option value="SUCCEEDED">Berhasil (SUCCEEDED)</option>
            <option value="RUNNING">Berjalan (RUNNING)</option>
            <option value="FAILED">Gagal (FAILED)</option>
            <option value="DELETED">Dihapus (DELETED)</option>
          </select>

          {/* Trigger Filter */}
          <select
            value={triggerFilter}
            onChange={(e) => {
              setTriggerFilter(e.target.value)
              setPage(1)
            }}
            className="px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 cursor-pointer"
          >
            <option value="">Semua Pemicu</option>
            <option value="MANUAL">Manual</option>
            <option value="SCHEDULED">Terjadwal</option>
            <option value="PRE_RESTORE">Pengaman Sebelum Pemulihan</option>
          </select>
        </div>

        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => loadBackups()}>
            <IconRefresh size={14} className="mr-1" />
            Segarkan
          </Button>
        </div>
      </div>

      {/* Backups Table */}
      <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-xs data-table">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-semibold uppercase">
              <tr>
                <th className="py-2.5 px-4">Nomor Cadangan</th>
                <th className="py-2.5 px-4">Jenis Pemicu</th>
                <th className="py-2.5 px-4">Status</th>
                <th className="py-2.5 px-4">Ukuran Data</th>
                <th className="py-2.5 px-4">Verifikasi</th>
                <th className="py-2.5 px-4">Pembuat</th>
                <th className="py-2.5 px-4">Waktu Mulai</th>
                <th className="py-2.5 px-4 text-right">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center">
                    <Spinner label="Memuat riwayat cadangan..." />
                  </td>
                </tr>
              ) : backups.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-0">
                    <EmptyState
                      icon={IconShield}
                      title="Belum ada riwayat cadangan"
                      description="Belum ada riwayat berkas cadangan database yang tercatat di sistem."
                    />
                  </td>
                </tr>
              ) : (
                backups.map((b) => {
                  const isDeleted = b.status === 'DELETED'
                  const isRunning = b.status === 'RUNNING'
                  const isVerified = Boolean(b.verified_passed)
                  const isSucceeded = b.status === 'SUCCEEDED'

                  return (
                    <tr
                      key={b.id}
                      className={`transition-colors ${
                        isDeleted
                          ? 'opacity-60 bg-slate-50/50 dark:bg-slate-900/50'
                          : 'hover:bg-slate-50/70 dark:hover:bg-slate-800/40'
                      }`}
                    >
                      <td className="py-2.5 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">
                        <button
                          type="button"
                          onClick={() => handleOpenDetail(b.id)}
                          className="hover:text-blue-600 dark:hover:text-blue-400 hover:underline text-left cursor-pointer"
                        >
                          #{b.backup_number}
                        </button>
                      </td>

                      <td className="py-2.5 px-4 text-slate-700 dark:text-slate-300">
                        <span className="px-2 py-0.5 rounded text-[11px] bg-slate-100 dark:bg-slate-800 font-medium">
                          {formatTriggerLabel(b.trigger)}
                        </span>
                      </td>

                      <td className="py-2.5 px-4">
                        <StatusBadge status={b.status} />
                      </td>

                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-300 font-mono">
                        <div>DB: {formatBytes(b.db_size)}</div>
                        {b.include_documents && (
                          <div className="text-[10px] text-slate-400">
                            Dokumen: {formatBytes(b.docs_size)}
                          </div>
                        )}
                      </td>

                      <td className="py-2.5 px-4">
                        {isVerified ? (
                          <VerifiedBadge passed={true} date={b.verified_at} />
                        ) : (
                          <span className="text-[11px] text-slate-400 italic">Belum</span>
                        )}
                      </td>

                      <td className="py-2.5 px-4 text-slate-600 dark:text-slate-400">
                        {b.requested_by?.name || (
                          <span className="italic text-slate-400">Sistem (Otomatis)</span>
                        )}
                      </td>

                      <td className="py-2.5 px-4 text-slate-500 font-mono text-[11px]">
                        {formatDateTime(b.started_at)}
                      </td>

                      <td className="py-2.5 px-4 text-right">
                        {!isDeleted && !isRunning && (
                          <div className="flex items-center justify-end gap-1.5">
                            {/* Verifikasi Action */}
                            {can['backups.verify'] && isSucceeded && (
                              <Button
                                size="sm"
                                variant="secondary"
                                loading={verifyingId === b.id}
                                disabled={verifyingId !== null}
                                onClick={() => handleRunVerify(b)}
                                title="Uji pemulihan ke database sementara"
                              >
                                Verifikasi
                              </Button>
                            )}

                            {/* Unduh Action */}
                            {can['backups.download'] && isSucceeded && (
                              <Button
                                size="sm"
                                variant="secondary"
                                onClick={() => {
                                  setDownloadModalBackup(b)
                                  setDownloadError('')
                                }}
                                title="Unduh berkas cadangan"
                              >
                                Unduh
                              </Button>
                            )}

                            {/* Pulihkan / Verifikasi Dulu Action */}
                            {can['backups.restore'] && isSucceeded && (
                              isVerified ? (
                                <Button
                                  size="sm"
                                  variant="danger"
                                  onClick={() => setRestoreModalBackup(b)}
                                  title="Pulihkan database dari cadangan ini"
                                >
                                  Pulihkan
                                </Button>
                              ) : (
                                can['backups.verify'] && (
                                  <Button
                                    size="sm"
                                    variant="secondary"
                                    onClick={() => handleRunVerify(b)}
                                    title="Cadangan harus diverifikasi sebelum dapat dipulihkan"
                                  >
                                    Verifikasi Dulu
                                  </Button>
                                )
                              )
                            )}

                            {/* Hapus Action */}
                            {can['backups.manage'] && (
                              <button
                                type="button"
                                onClick={() => {
                                  setRemoveModalBackup(b)
                                  setRemoveReason('')
                                  setRemoveError('')
                                }}
                                className="p-1.5 text-slate-400 hover:text-rose-600 rounded transition cursor-pointer"
                                title="Hapus berkas cadangan"
                              >
                                <IconTrash size={14} />
                              </button>
                            )}
                          </div>
                        )}
                      </td>
                    </tr>
                  )
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Standardized Table Footer */}
        <TableFooter
          meta={meta}
          itemCount={backups.length}
          total={meta?.total ?? backups.length}
          entityLabel="cadangan database"
          page={page}
          perPage={perPage}
          onPage={setPage}
          onPerPage={(n) => {
            setPerPage(n)
            setPage(1)
          }}
          perPageOptions={[10, 25, 50, 100]}
        />
      </div>

      {/* DRAWER 1: Detail Cadangan */}
      <Drawer
        open={detailModalOpen}
        title={`Rincian Cadangan #${detailBackup?.backup_number || ''}`}
        onClose={() => setDetailModalOpen(false)}
        size="max-w-2xl"
        footer={
          <Button variant="ghost" onClick={() => setDetailModalOpen(false)}>
            Tutup
          </Button>
        }
      >
        <div className="space-y-4 text-xs">
          {loadingDetail && (
            <div className="p-8 text-center">
              <Spinner label="Memuat rincian dan riwayat kejadian..." />
            </div>
          )}

          {detailError && <Alert kind="error">{detailError}</Alert>}

          {detailBackup && (
            <div className="space-y-4">
              {/* Header Overview */}
              <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/40 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400">Checksum SHA-256 Database:</span>
                  <div className="flex items-center gap-1.5">
                    <code className="font-mono font-bold text-slate-800 dark:text-slate-200 bg-white dark:bg-slate-800 px-1.5 py-0.5 rounded border border-slate-200 dark:border-slate-700">
                      {detailBackup.db_sha256 ? detailBackup.db_sha256.slice(0, 12) + '…' : '-'}
                    </code>
                    {detailBackup.db_sha256 && (
                      <button
                        type="button"
                        onClick={() => copyShaToClipboard(detailBackup.db_sha256)}
                        className="text-[10px] text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                      >
                        {copiedSha ? 'Tersalin!' : 'Salin'}
                      </button>
                    )}
                  </div>
                </div>

                <div className="flex items-center justify-between pt-1 border-t border-slate-200/60 dark:border-slate-800/60">
                  <span className="text-slate-400">Versi Skema Migrasi:</span>
                  <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                    {detailBackup.schema_version || '-'}
                  </span>
                </div>
              </div>

              {/* Verification Results Checks */}
              {detailBackup.verify_result && (
                <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-2">
                  <h5 className="font-bold text-xs uppercase tracking-wider text-slate-700 dark:text-slate-300">
                    Pemeriksaan Uji Verifikasi
                  </h5>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <span className={detailBackup.verify_result.checks?.sha256_matches ? 'text-emerald-600 font-bold' : 'text-rose-600'}>
                        {detailBackup.verify_result.checks?.sha256_matches ? '✓' : '✗'}
                      </span>
                      <span>Kecocokan SHA-256 Dump</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className={detailBackup.verify_result.checks?.restore_completed ? 'text-emerald-600 font-bold' : 'text-rose-600'}>
                        {detailBackup.verify_result.checks?.restore_completed ? '✓' : '✗'}
                      </span>
                      <span>Pemulihan Selesai (Exit Code 0)</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className={detailBackup.verify_result.checks?.schema_version_present ? 'text-emerald-600 font-bold' : 'text-rose-600'}>
                        {detailBackup.verify_result.checks?.schema_version_present ? '✓' : '✗'}
                      </span>
                      <span>Tabel Migrasi Tersedia</span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className={detailBackup.verify_result.checks?.migrations_count_matches ? 'text-emerald-600 font-bold' : 'text-rose-600'}>
                        {detailBackup.verify_result.checks?.migrations_count_matches ? '✓' : '✗'}
                      </span>
                      <span>Jumlah Versi Skema Cocok</span>
                    </div>
                  </div>

                  {detailBackup.verify_result.differences?.length > 0 && (
                    <p className="text-[10px] text-slate-500 italic pt-1 border-t border-slate-100 dark:border-slate-800">
                      Catatan perbedaan baris ({detailBackup.verify_result.differences.join(', ')}): mungkin karena penulisan transaksi saat proses pencadangan berjalan.
                    </p>
                  )}
                </div>
              )}

              {/* Table Counts Summary */}
              {detailBackup.table_counts && (
                <div>
                  <h5 className="font-bold text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                    Jumlah Baris per Tabel
                  </h5>
                  <div className="max-h-36 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg p-2.5 bg-slate-50 dark:bg-slate-800/40 grid grid-cols-2 sm:grid-cols-3 gap-2 font-mono text-[11px]">
                    {Object.entries(detailBackup.table_counts).map(([tbl, cnt]) => (
                      <div key={tbl} className="truncate">
                        <span className="text-slate-500">{tbl}: </span>
                        <strong>{Number(cnt).toLocaleString('id-ID')}</strong>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Events Audit Trail */}
              {detailBackup.events?.length > 0 && (
                <div>
                  <h5 className="font-bold text-xs uppercase tracking-wider text-slate-600 dark:text-slate-400 mb-1.5">
                    Linimasa Peristiwa (Audit Trail)
                  </h5>
                  <div className="space-y-2 border-l-2 border-slate-200 dark:border-slate-700 pl-3">
                    {detailBackup.events.map((ev, idx) => (
                      <div key={idx} className="text-[11px]">
                        <div className="font-bold text-slate-800 dark:text-slate-200">
                          {ev.event_type}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {formatDateTime(ev.occurred_at)} · {ev.actor_name || 'Sistem'}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </Drawer>

      {/* DRAWER 2: Hasil Uji Verifikasi */}
      <Modal
        open={Boolean(verifyResultModal)}
        title={`Hasil Uji Verifikasi #${verifyResultModal?.backup?.backup_number || ''}`}
        onClose={() => setVerifyResultModal(null)}
        size="max-w-xl"
        footer={
          <Button variant="primary" onClick={() => setVerifyResultModal(null)}>
            Tutup
          </Button>
        }
      >
        <div className="space-y-4 text-xs">
          {verifyResultModal?.result?.passed ? (
            <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/40 text-emerald-900 dark:text-emerald-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm">
                <IconCheck size={18} className="text-emerald-600 dark:text-emerald-400" />
                <span>Verifikasi Berhasil: Cadangan Layak Dipulihkan</span>
              </div>
              <p className="text-[11px] leading-relaxed">
                Berkas dump berhasil dipulihkan secara penuh ke database uji sementara dan seluruh pengujian integritas skema dinyatakan valid.
              </p>
            </div>
          ) : (
            <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900 bg-rose-50/60 dark:bg-rose-950/40 text-rose-900 dark:text-rose-200 space-y-2">
              <div className="flex items-center gap-2 font-bold text-sm">
                <IconX size={18} className="text-rose-600 dark:text-rose-400" />
                <span>Verifikasi Gagal: Cadangan Tidak Boleh Dipakai</span>
              </div>
              <p className="text-[11px]">
                {verifyResultModal?.result?.error || 'Uji pemulihan ke database sementara gagal.'}
              </p>
              <div className="p-2.5 rounded bg-white/60 dark:bg-slate-900/60 text-[11px] font-semibold text-rose-800 dark:text-rose-300">
                Peringatan: Berkas cadangan ini tidak boleh dipakai untuk pemulihan karena integritas data atau skema tidak memenuhi syarat.
              </div>
            </div>
          )}

          {/* Checks list */}
          {verifyResultModal?.result?.checks && (
            <div className="space-y-1.5 p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 text-[11px]">
              <div className="flex items-center justify-between">
                <span>Integritas Checksum SHA-256:</span>
                <span className="font-bold">{verifyResultModal.result.checks.sha256_matches ? '✓ Cocok' : '✗ Tidak Cocok'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Eksekusi Pemulihan pg_restore:</span>
                <span className="font-bold">{verifyResultModal.result.checks.restore_completed ? '✓ Selesai' : '✗ Gagal'}</span>
              </div>
              <div className="flex items-center justify-between">
                <span>Struktur Versi Migrasi:</span>
                <span className="font-bold">{verifyResultModal.result.checks.migrations_count_matches ? '✓ Cocok' : '✗ Tidak Cocok'}</span>
              </div>
            </div>
          )}
        </div>
      </Modal>

      {/* DRAWER 3: Pilihan Unduh Berkas */}
      <Modal
        open={Boolean(downloadModalBackup)}
        title={`Unduh Berkas Cadangan #${downloadModalBackup?.backup_number || ''}`}
        onClose={() => setDownloadModalBackup(null)}
        size="max-w-xl"
        footer={
          <Button variant="ghost" onClick={() => setDownloadModalBackup(null)} disabled={downloading}>
            Tutup
          </Button>
        }
      >
        <div className="space-y-4 text-xs">
          {downloadError && <Alert kind="error">{downloadError}</Alert>}

          <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/60 dark:bg-amber-950/30 text-amber-900 dark:text-amber-200 space-y-1">
            <span className="font-bold text-xs">Peringatan Keamanan Data:</span>
            <p className="text-[11px] leading-relaxed">
              Berkas ini memuat seluruh data transaksi dan informasi konfigurasi sistem. Simpan berkas hasil unduhan di media penyimpanan fisik yang aman dan terenkripsi.
            </p>
          </div>

          <div className="space-y-2.5">
            <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-between">
              <div>
                <h6 className="font-bold text-slate-800 dark:text-slate-200">
                  Dump Database PostgreSQL (.dump)
                </h6>
                <p className="text-[11px] text-slate-400">
                  Ukuran: {formatBytes(downloadModalBackup?.db_size)}
                </p>
              </div>
              <Button
                variant="primary"
                size="sm"
                loading={downloading}
                onClick={() => handleDownloadFile('database')}
              >
                Unduh Database
              </Button>
            </div>

            {downloadModalBackup?.include_documents && downloadModalBackup?.docs_size > 0 && (
              <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 flex items-center justify-between">
                <div>
                  <h6 className="font-bold text-slate-800 dark:text-slate-200">
                    Arsip Dokumen Fisik (.tar.gz)
                  </h6>
                  <p className="text-[11px] text-slate-400">
                    Ukuran: {formatBytes(downloadModalBackup?.docs_size)}
                  </p>
                </div>
                <Button
                  variant="secondary"
                  size="sm"
                  loading={downloading}
                  onClick={() => handleDownloadFile('documents')}
                >
                  Unduh Dokumen
                </Button>
              </div>
            )}
          </div>
        </div>
      </Modal>

      {/* DRAWER 4: Hapus Berkas Cadangan */}
      <Modal
        open={Boolean(removeModalBackup)}
        title={`Hapus Berkas Cadangan #${removeModalBackup?.backup_number || ''}`}
        onClose={() => setRemoveModalBackup(null)}
        size="max-w-lg"
        footer={
          <div className="flex items-center justify-end gap-2">
            <Button variant="ghost" onClick={() => setRemoveModalBackup(null)} disabled={removing}>
              Batal
            </Button>
            <Button
              variant="danger"
              loading={removing}
              disabled={removeReason.trim().length < 3}
              onClick={handleConfirmRemove}
            >
              Konfirmasi Hapus
            </Button>
          </div>
        }
      >
        <form onSubmit={handleConfirmRemove} className="space-y-4 text-xs">
          {removeError && <Alert kind="error">{removeError}</Alert>}

          <p className="text-slate-600 dark:text-slate-300">
            Penghapusan akan membuang berkas fisik dump database dan arsip dokumen dari media penyimpanan server. Catatan riwayat audit akan tetap tersimpan dengan status <strong>DELETED</strong>.
          </p>

          <div>
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Alasan Penghapusan <span className="text-rose-500">* (Min. 3 karakter)</span>
            </label>
            <input
              type="text"
              required
              value={removeReason}
              onChange={(e) => setRemoveReason(e.target.value)}
              placeholder="Contoh: Pembersihan manual kapasitas drive cadangan..."
              className="w-full px-3 py-1.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
            />
          </div>
        </form>
      </Modal>

      {/* MODAL 5: Restore Dialog (Critical Multi-Step) */}
      <RestoreDialog
        open={Boolean(restoreModalBackup)}
        backup={restoreModalBackup}
        onClose={() => setRestoreModalBackup(null)}
        onSuccess={() => {
          loadBackups(true)
          onReloadSummary?.()
        }}
      />
    </div>
  )
}
