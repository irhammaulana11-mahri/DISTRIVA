import { useCallback, useEffect, useState } from 'react'
import { nkoApi, triggerFileDownload } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { filterControlCls, filterSelectCls } from '../../components/filterStyles.js'
import { IconDownload, IconUpload, IconX } from '../../components/icons.jsx'
import { CheckReportPanel, UPLOAD_STATUS_CLS, fmtDate } from './NkoWorkbookTab.jsx'

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']

function TargetDecisionModal({ upload, mode, onClose, onDecided }) {
  const { notify } = useNotifications()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [recheckReport, setRecheckReport] = useState(null)

  useEffect(() => {
    setNote('')
    setError('')
    setRecheckReport(null)
  }, [upload, mode])

  if (!upload) return null
  const isReject = mode === 'reject'

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (isReject && !note.trim()) {
      setError('Alasan penolakan wajib diisi.')
      return
    }
    setSaving(true)
    setError('')
    setRecheckReport(null)
    try {
      const res = await nkoApi.decideTargetUpload(upload.id, {
        decision: mode,
        note: note.trim() || null,
      })
      notify({
        type: 'success',
        title: isReject ? 'Unggahan Target Ditolak' : 'Target NKO Disetujui',
        desc:
          res?.message ||
          (isReject
            ? 'Unggahan target ditolak.'
            : 'Target NKO diperbarui. Jangan lupa hitung ulang NKO untuk memperbarui nilai.'),
        tag: 'NKO',
      })
      onDecided?.()
      onClose()
    } catch (err) {
      setError(err?.message || 'Gagal memproses keputusan unggahan target.')
      const checkData = err?.data?.data
      if (checkData && (Array.isArray(checkData.tabs) || Array.isArray(checkData.errors))) {
        setRecheckReport(checkData)
      }
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {isReject ? 'Tolak Unggahan Target' : 'Setujui Unggahan Target'}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <IconX size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4 overflow-y-auto">
          <div className="text-xs text-slate-600 dark:text-slate-300 space-y-1">
            <p>Berkas: <strong>{upload.source_name}</strong> ({upload.year})</p>
            <p>Catatan pengunggah: {upload.note}</p>
          </div>
          <label className="block text-xs">
            <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
              {isReject ? 'Alasan Penolakan (Wajib)' : 'Catatan Persetujuan (Opsional)'}
              {isReject && <span className="text-rose-600"> *</span>}
            </span>
            <textarea
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={isReject ? 'Jelaskan alasan penolakan target...' : 'Catatan tambahan (opsional)...'}
              aria-label="Catatan Keputusan Target"
              className={`${filterControlCls} w-full text-xs py-2`}
            />
          </label>
          {error && <Alert kind="error">{error}</Alert>}
          {recheckReport && <CheckReportPanel report={recheckReport} title="Hasil Pemeriksaan Ulang Target" />}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
            <Button type="submit" variant={isReject ? 'danger' : 'primary'} loading={saving}>
              {isReject ? 'Tolak Unggahan' : 'Setujui & Simpan Target'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function TargetChangesDetail({ detail, onClose }) {
  if (!detail) return null
  const changes = Array.isArray(detail.changes) ? detail.changes : []

  return (
    <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/30 dark:bg-emerald-950/20 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Rincian Perubahan Target: {detail.source_name} ({detail.year})
          </h4>
          <p className="text-xs text-slate-500">
            Status: <strong>{detail.status}</strong> • Pengunggah: {detail.uploaded_by?.name || '-'}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Tutup rincian perubahan target" className="text-slate-400 hover:text-slate-600 p-1">
          <IconX size={18} />
        </button>
      </div>

      {detail.check && <CheckReportPanel report={detail.check} title="Laporan Pemeriksaan Target" />}

      {changes.length === 0 ? (
        <p className="text-xs text-slate-500">Tidak ada sel target yang berubah.</p>
      ) : (
        <div className="space-y-3">
          {changes.map((c, idx) => (
            <div key={`${c.unit_name}-${idx}`} className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-2.5 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 dark:text-slate-100">{c.unit_name}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                    {c.level}
                  </span>
                </div>
                <span className="text-[11px] text-slate-500">
                  <strong>{c.cells ?? 0}</strong> sel berubah
                  {c.compared_with ? ` • Pembanding: ${c.compared_with}` : ''}
                </span>
              </div>

              {(c.items || []).length > 0 && (
                <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                  <table className="w-full text-left text-[11px]">
                    <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500">
                      <tr>
                        <th className="py-1.5 px-2.5">Indikator</th>
                        <th className="py-1.5 px-2.5">Perubahan Target per Bulan (Dari → Ke)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                      {c.items.map((it) => (
                        <tr key={it.code}>
                          <td className="py-1.5 px-2.5 font-semibold text-slate-800 dark:text-slate-200">
                            {it.name} <span className="font-mono text-[10px] text-slate-400">({it.code})</span>
                          </td>
                          <td className="py-1.5 px-2.5">
                            <div className="flex flex-wrap gap-1.5">
                              {Object.entries(it.months || {}).map(([mo, diff]) => (
                                <span
                                  key={mo}
                                  className="px-2 py-0.5 rounded bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
                                >
                                  <strong>{MONTH_SHORT[Number(mo) - 1] || mo}:</strong>{' '}
                                  <span className="line-through text-rose-600">{diff?.from ?? 'kosong'}</span> →{' '}
                                  <span className="text-emerald-700 dark:text-emerald-300 font-semibold">{diff?.to ?? 'kosong'}</span>
                                </span>
                              ))}
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function NkoTargetSection({ year, canPropose, canApprove, currentUserId, isSysAdmin = false }) {
  const { notify } = useNotifications()
  const [templateYear, setTemplateYear] = useState(year || new Date().getFullYear())
  const [templateLevel, setTemplateLevel] = useState('ULP')
  const [downloading, setDownloading] = useState(false)

  const [uploadYear, setUploadYear] = useState(new Date().getFullYear())
  const [file, setFile] = useState(null)
  const [note, setNote] = useState('')
  const [checking, setChecking] = useState(false)
  const [checkReport, setCheckReport] = useState(null)
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const [uploadsState, setUploadsState] = useState({ loading: false, error: '', data: [] })
  const [statusFilter, setStatusFilter] = useState('')
  const [detailState, setDetailState] = useState({ loading: false, error: '', data: null })
  const [decisionModal, setDecisionModal] = useState({ upload: null, mode: 'approve' })

  const loadTargetUploads = useCallback(async () => {
    setUploadsState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await nkoApi.targetUploads(statusFilter ? { status: statusFilter } : {})
      setUploadsState({ loading: false, error: '', data: res?.data || [] })
    } catch (err) {
      setUploadsState({ loading: false, error: err?.message || 'Gagal memuat daftar unggahan target.', data: [] })
    }
  }, [statusFilter])

  useEffect(() => {
    loadTargetUploads()
  }, [loadTargetUploads])

  const handleDownloadTemplate = async () => {
    setDownloading(true)
    try {
      const { blob, filename } = await nkoApi.targetTemplate({ year: templateYear, level: templateLevel })
      triggerFileDownload(blob, filename)
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Unduh Template Target',
        desc: err?.message || 'Tidak dapat mengunduh template target.',
        tag: 'NKO',
      })
    } finally {
      setDownloading(false)
    }
  }

  const handleCheck = async () => {
    setUploadError('')
    if (!file) {
      setUploadError('Pilih berkas workbook target (.xlsx) terlebih dahulu.')
      return
    }
    setChecking(true)
    setCheckReport(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('year', String(uploadYear))
      const res = await nkoApi.checkTargetUpload(fd)
      setCheckReport(res?.data || null)
    } catch (err) {
      setUploadError(err?.message || 'Gagal memeriksa workbook target.')
    } finally {
      setChecking(false)
    }
  }

  const loadTargetDetail = async (id) => {
    setDetailState({ loading: true, error: '', data: null })
    try {
      const res = await nkoApi.targetUpload(id)
      setDetailState({ loading: false, error: '', data: res?.data || null })
    } catch (err) {
      setDetailState({ loading: false, error: err?.message || 'Gagal memuat rincian perubahan target.', data: null })
    }
  }

  const handleUpload = async (e) => {
    e.preventDefault()
    setUploadError('')
    if (!file) {
      setUploadError('Pilih berkas workbook target (.xlsx) terlebih dahulu.')
      return
    }
    if (!note.trim()) {
      setUploadError('Catatan unggahan target wajib diisi.')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('year', String(uploadYear))
      fd.append('note', note.trim())
      const res = await nkoApi.uploadTargets(fd)
      notify({
        type: 'success',
        title: 'Workbook Target Diunggah',
        desc: res?.message || 'Target diterima, menunggu persetujuan ASMAN_PERENCANAAN.',
        tag: 'NKO',
      })
      setFile(null)
      setNote('')
      setCheckReport(null)
      loadTargetUploads()
      if (res?.data?.id) loadTargetDetail(res.data.id)
    } catch (err) {
      setUploadError(err?.message || 'Gagal mengunggah workbook target.')
      const checkData = err?.data?.data
      if (checkData && (Array.isArray(checkData.tabs) || Array.isArray(checkData.errors))) {
        setCheckReport(checkData)
      }
    } finally {
      setUploading(false)
    }
  }

  const handleCancel = async (id) => {
    try {
      const res = await nkoApi.cancelTargetUpload(id)
      notify({ type: 'success', title: 'Unggahan Target Dibatalkan', desc: res?.message || 'Dibatalkan.', tag: 'NKO' })
      if (detailState.data?.id === id) setDetailState({ loading: false, error: '', data: null })
      loadTargetUploads()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal Membatalkan', desc: err?.message || 'Tidak dapat membatalkan.', tag: 'NKO' })
    }
  }

  const uploadBlocked = Boolean(checkReport && checkReport.can_upload === false)

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-emerald-200 dark:border-emerald-900/50 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Target NKO (Terpisah dari Definisi)
            </h3>
            <p className="text-xs text-slate-500">
              Ubah target bulanan per unit tanpa mengunggah ulang definisi.
            </p>
          </div>
          {canPropose && (
            <div className="flex flex-wrap items-center gap-2">
              <input
                type="number"
                min="2000"
                max="2100"
                value={templateYear}
                onChange={(e) => setTemplateYear(Number(e.target.value))}
                aria-label="Tahun Template Target"
                className={`${filterControlCls} w-20 tabular-nums text-xs`}
              />
              <select
                value={templateLevel}
                onChange={(e) => setTemplateLevel(e.target.value)}
                aria-label="Tingkat Template Target"
                className={`${filterSelectCls} text-xs`}
              >
                <option value="ULP">ULP</option>
                <option value="UP3">UP3</option>
              </select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={IconDownload}
                loading={downloading}
                onClick={handleDownloadTemplate}
              >
                Unduh Template Target
              </Button>
            </div>
          )}
        </div>

        {canPropose && (
          <form onSubmit={handleUpload} className="space-y-3 pt-1">
            <div className="grid grid-cols-1 md:grid-cols-12 gap-3">
              <label className="block text-xs md:col-span-2">
                <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Tahun <span className="text-rose-600">*</span>
                </span>
                <input
                  type="number"
                  min="2000"
                  max="2100"
                  required
                  value={uploadYear}
                  onChange={(e) => {
                    setUploadYear(Number(e.target.value))
                    setCheckReport(null)
                  }}
                  aria-label="Tahun Unggahan Target"
                  className={`${filterControlCls} w-full tabular-nums text-xs`}
                />
              </label>

              <label className="block text-xs md:col-span-5">
                <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">Berkas Target (.xlsx)</span>
                <input
                  type="file"
                  accept=".xlsx"
                  aria-label="Berkas Workbook Target"
                  onChange={(e) => {
                    setFile(e.target.files?.[0] || null)
                    setCheckReport(null)
                  }}
                  className={`${filterControlCls} w-full py-1.5 text-xs`}
                />
              </label>

              <label className="block text-xs md:col-span-5">
                <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">
                  Catatan <span className="text-rose-600">*</span>
                </span>
                <input
                  type="text"
                  maxLength={500}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Mis. Penyesuaian target semester 2"
                  aria-label="Catatan Unggahan Target"
                  className={`${filterControlCls} w-full text-xs`}
                />
              </label>
            </div>

            {(checking || uploading) && (
              <div className="flex items-center gap-2 text-xs text-emerald-700 dark:text-emerald-300">
                <Spinner size="sm" />
                <span>{checking ? 'Memeriksa workbook target...' : 'Mengunggah workbook target...'}</span>
              </div>
            )}
            {uploadError && <Alert kind="error">{uploadError}</Alert>}
            {checkReport && <CheckReportPanel report={checkReport} title="Hasil Pemeriksaan Target" />}

            <div className="flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" size="sm" loading={checking} disabled={uploading} onClick={handleCheck}>
                Periksa Target
              </Button>
              <Button type="submit" variant="primary" size="sm" icon={IconUpload} loading={uploading} disabled={checking || uploadBlocked}>
                Unggah Target
              </Button>
            </div>
          </form>
        )}

        {/* Daftar Unggahan Target */}
        <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200">
              Daftar Unggahan Target
            </h4>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              aria-label="Filter Status Unggahan Target"
              className={`${filterSelectCls} text-xs`}
            >
              <option value="">Semua Status</option>
              <option value="MENUNGGU">MENUNGGU</option>
              <option value="DISETUJUI">DISETUJUI</option>
              <option value="DITOLAK">DITOLAK</option>
              <option value="DIBATALKAN">DIBATALKAN</option>
            </select>
          </div>

          {detailState.loading && <div className="py-4 flex justify-center"><Spinner size="sm" label="Memuat rincian target..." /></div>}
          {detailState.error && <Alert kind="error">{detailState.error}</Alert>}
          {detailState.data && (
            <TargetChangesDetail detail={detailState.data} onClose={() => setDetailState({ loading: false, error: '', data: null })} />
          )}

          {uploadsState.loading ? (
            <div className="py-6 flex justify-center"><Spinner size="sm" label="Memuat unggahan target..." /></div>
          ) : uploadsState.error ? (
            <Alert kind="error">{uploadsState.error}</Alert>
          ) : uploadsState.data.length === 0 ? (
            <EmptyState title="Belum Ada Unggahan Target" desc="Belum ada unggahan perubahan target NKO." />
          ) : (
            <div className="space-y-2">
              {uploadsState.data.map((u) => {
                const isOwn = Boolean(currentUserId && u.uploaded_by?.id === currentUserId)
                const isPending = u.status === 'MENUNGGU'
                return (
                  <div
                    key={u.id}
                    className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs"
                  >
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-slate-900 dark:text-slate-100">{u.source_name}</span>
                        <span className="font-mono text-slate-500">({u.year})</span>
                        <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${UPLOAD_STATUS_CLS[u.status] || ''}`}>
                          {u.status}
                        </span>
                      </div>
                      <p className="text-slate-600 dark:text-slate-300">{u.note}</p>
                      <div className="text-[11px] text-slate-500">
                        {u.uploaded_by?.name || '-'} ({fmtDate(u.uploaded_at)})
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <Button type="button" variant="secondary" size="sm" onClick={() => loadTargetDetail(u.id)}>
                        Lihat Perubahan Target
                      </Button>
                      {isPending && canPropose && isOwn && (
                        <Button type="button" variant="ghost" size="sm" onClick={() => handleCancel(u.id)}>
                          Batalkan
                        </Button>
                      )}
                      {isPending && canApprove && (!isOwn || isSysAdmin) && (
                        <>
                          <Button type="button" variant="primary" size="sm" onClick={() => setDecisionModal({ upload: u, mode: 'approve' })}>
                            Setujui Target
                          </Button>
                          <Button type="button" variant="danger" size="sm" onClick={() => setDecisionModal({ upload: u, mode: 'reject' })}>
                            Tolak Target
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      </div>

      <TargetDecisionModal
        upload={decisionModal.upload}
        mode={decisionModal.mode}
        onClose={() => setDecisionModal({ upload: null, mode: 'approve' })}
        onDecided={() => loadTargetUploads()}
      />
    </div>
  )
}
