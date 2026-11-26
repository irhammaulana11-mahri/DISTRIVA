import { useEffect, useState } from 'react'
import { nkoApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import { filterControlCls, filterSelectCls } from '../../components/filterStyles.js'
import { IconAlertCircle, IconUpload, IconX } from '../../components/icons.jsx'

const UPLOAD_STATUS_CLS = {
  MENUNGGU: 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300 border-amber-200 dark:border-amber-800',
  DISETUJUI: 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300 border-emerald-200 dark:border-emerald-800',
  DITOLAK: 'bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-300 border-rose-200 dark:border-rose-800',
  DIBATALKAN: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 border-slate-200 dark:border-slate-700',
}

const fmtDate = (d) => {
  if (!d) return '-'
  try {
    return new Date(d).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return String(d)
  }
}

function UploadDecisionModal({ upload, mode, onClose, onDecided }) {
  const { notify } = useNotifications()
  const [note, setNote] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    setNote('')
    setError('')
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
    try {
      const res = await nkoApi.decideDefinitionUpload(upload.id, {
        decision: mode,
        note: note.trim() || null,
      })
      notify({
        type: 'success',
        title: isReject ? 'Unggahan Ditolak' : 'Workbook Definisi Disetujui',
        desc: res?.message || (isReject ? 'Unggahan ditolak.' : 'Definisi baru aktif.'),
        tag: 'NKO',
      })
      onDecided?.(res?.data, isReject)
      onClose()
    } catch (err) {
      setError(err?.message || 'Gagal memproses keputusan unggahan.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            {isReject ? 'Tolak Unggahan Workbook' : 'Setujui Unggahan Workbook'}
          </h3>
          <button type="button" onClick={onClose} className="text-slate-400 hover:text-slate-600 p-1">
            <IconX size={18} />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
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
              placeholder={isReject ? 'Jelaskan alasan penolakan workbook...' : 'Catatan tambahan (opsional)...'}
              aria-label="Catatan Keputusan Workbook"
              className={`${filterControlCls} w-full text-xs py-2`}
            />
          </label>
          {error && <Alert kind="error">{error}</Alert>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>Batal</Button>
            <Button type="submit" variant={isReject ? 'danger' : 'primary'} loading={saving}>
              {isReject ? 'Tolak Unggahan' : 'Setujui & Aktifkan'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

function UploadChangesDetail({ detail, onClose }) {
  if (!detail) return null
  const changes = Array.isArray(detail.changes) ? detail.changes : []

  return (
    <div className="p-4 rounded-xl border border-indigo-200 dark:border-indigo-900/50 bg-indigo-50/30 dark:bg-indigo-950/20 space-y-4">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Rincian Perubahan Workbook: {detail.source_name} ({detail.year})
          </h4>
          <p className="text-xs text-slate-500">
            Status: <strong>{detail.status}</strong> • Pengunggah: {detail.uploaded_by?.name || '-'}
          </p>
        </div>
        <button type="button" onClick={onClose} aria-label="Tutup rincian perubahan" className="text-slate-400 hover:text-slate-600 p-1">
          <IconX size={18} />
        </button>
      </div>

      {changes.length === 0 ? (
        <p className="text-xs text-slate-500">Tidak ada rincian perubahan tingkat unit.</p>
      ) : (
        <div className="space-y-3">
          {changes.map((c, idx) => {
            const targetEntries = c.targets_changed && !Array.isArray(c.targets_changed)
              ? Object.entries(c.targets_changed)
              : []

            return (
              <div key={`${c.level}-${idx}`} className="p-3.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-bold text-slate-900 dark:text-slate-100">Tingkat {c.level}</span>
                  <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                    {c.status}
                  </span>
                  {c.compared_with && (
                    <span className="text-[11px] text-slate-500">Dibandingkan dengan: <strong>{c.compared_with}</strong></span>
                  )}
                  {c.total_rule_changed && (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                      Rumus Total/NKO Berubah
                    </span>
                  )}
                </div>

                {c.warnings?.length > 0 && (
                  <Alert kind="warning">
                    <ul className="list-disc pl-4 space-y-0.5">
                      {c.warnings.map((w, wi) => <li key={wi}>{w}</li>)}
                    </ul>
                  </Alert>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {c.added?.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-900/50">
                      <div className="font-bold text-emerald-800 dark:text-emerald-300 mb-1">Bertambah ({c.added.length})</div>
                      <ul className="space-y-1 text-[11px]">
                        {c.added.map((a) => (
                          <li key={a.code}>
                            <strong>{a.name}</strong> (<code className="font-mono">{a.code}</code>)
                            {a.weight != null ? ` • Bobot: ${a.weight}` : ''}
                            {a.needs_realization && !a.has_rule ? ' • Belum ada aturan' : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {c.removed?.length > 0 && (
                    <div className="p-2.5 rounded-lg bg-rose-50/60 dark:bg-rose-950/20 border border-rose-200 dark:border-rose-900/50">
                      <div className="font-bold text-rose-800 dark:text-rose-300 mb-1">Hilang ({c.removed.length})</div>
                      <ul className="space-y-1 text-[11px]">
                        {c.removed.map((r) => (
                          <li key={r.code}>
                            <strong>{r.name}</strong> (<code className="font-mono">{r.code}</code>)
                            {r.has_rule ? ' • Memiliki aturan aktif' : ''}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                </div>

                {c.possible_renames?.length > 0 && (
                  <div className="p-2.5 rounded-lg bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-900/50">
                    <div className="font-bold text-amber-800 dark:text-amber-300 mb-1">
                      Kemungkinan Ganti Nama ({c.possible_renames.length})
                    </div>
                    <ul className="space-y-1 text-[11px]">
                      {c.possible_renames.map((pr, pi) => (
                        <li key={pi}>
                          <code>{pr.from_name}</code> → <strong>{pr.to_name}</strong> ({Math.round((pr.score || 0) * 100)}%)
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {c.changed?.length > 0 && (
                  <div className="space-y-1.5">
                    <div className="font-bold text-slate-800 dark:text-slate-200">Item Berubah ({c.changed.length})</div>
                    <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-800">
                      <table className="w-full text-left text-[11px]">
                        <thead className="bg-slate-50 dark:bg-slate-800 text-slate-500">
                          <tr>
                            <th className="py-1.5 px-2.5">Indikator</th>
                            <th className="py-1.5 px-2.5">Perubahan Kolom (Lama → Baru)</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                          {c.changed.map((ch) => (
                            <tr key={ch.code}>
                              <td className="py-1.5 px-2.5 font-semibold">{ch.name}</td>
                              <td className="py-1.5 px-2.5 space-y-0.5">
                                {Object.entries(ch.fields || {}).map(([field, diff]) => (
                                  <div key={field}>
                                    <span className="font-mono text-slate-500">{field}:</span>{' '}
                                    <span className="line-through text-rose-600">{String(diff?.from ?? '-')}</span>{' '}
                                    → <span className="text-emerald-700 dark:text-emerald-300 font-semibold">{String(diff?.to ?? '-')}</span>
                                  </div>
                                ))}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {targetEntries.length > 0 && (
                  <div className="text-[11px] text-slate-600 dark:text-slate-400">
                    <strong>Target Bulanan Berubah:</strong>{' '}
                    {targetEntries.map(([unitName, count]) => `${unitName} (${count} target)`).join(', ')}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export default function NkoWorkbookTab({
  year,
  canPropose,
  canApprove,
  currentUserId,
  setsState,
  uploadsState,
  uploadStatusFilter,
  onUploadStatusFilterChange,
  onRefresh,
  onApproved,
}) {
  const { notify } = useNotifications()
  const [file, setFile] = useState(null)
  const [note, setNote] = useState('')
  const [uploading, setUploading] = useState(false)
  const [uploadError, setUploadError] = useState('')

  const [detailState, setDetailState] = useState({ loading: false, error: '', data: null })
  const [decisionModal, setDecisionModal] = useState({ upload: null, mode: 'approve' })

  const handleUpload = async (e) => {
    e.preventDefault()
    setUploadError('')
    if (!file) {
      setUploadError('Pilih berkas workbook (.xlsx) terlebih dahulu.')
      return
    }
    if (!note.trim()) {
      setUploadError('Catatan unggahan wajib diisi.')
      return
    }
    setUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('note', note.trim())
      const res = await nkoApi.uploadDefinitions(fd)
      notify({
        type: 'success',
        title: 'Workbook Diunggah',
        desc: res?.message || 'Workbook diterima, menunggu persetujuan ASMAN_PERENCANAAN.',
        tag: 'NKO',
      })
      setFile(null)
      setNote('')
      onRefresh?.()
      if (res?.data?.id) {
        loadUploadDetail(res.data.id)
      }
    } catch (err) {
      setUploadError(err?.message || 'Gagal mengunggah workbook definisi.')
    } finally {
      setUploading(false)
    }
  }

  const loadUploadDetail = async (id) => {
    setDetailState({ loading: true, error: '', data: null })
    try {
      const res = await nkoApi.definitionUpload(id)
      setDetailState({ loading: false, error: '', data: res?.data || null })
    } catch (err) {
      setDetailState({ loading: false, error: err?.message || 'Gagal memuat rincian perubahan workbook.', data: null })
    }
  }

  const handleCancelUpload = async (id) => {
    try {
      const res = await nkoApi.cancelDefinitionUpload(id)
      notify({
        type: 'success',
        title: 'Unggahan Dibatalkan',
        desc: res?.message || 'Unggahan berhasil dibatalkan.',
        tag: 'NKO',
      })
      if (detailState.data?.id === id) {
        setDetailState({ loading: false, error: '', data: null })
      }
      onRefresh?.()
    } catch (err) {
      notify({
        type: 'error',
        title: 'Gagal Membatalkan',
        desc: err?.message || 'Tidak dapat membatalkan unggahan.',
        tag: 'NKO',
      })
    }
  }

  return (
    <div className="space-y-6">
      {/* Unggah Workbook Baru */}
      {canPropose && (
        <form onSubmit={handleUpload} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
              Unggah Workbook Definisi NKO (.xlsx)
            </h3>
            <p className="text-xs text-slate-500">
              Berkas diperiksa terlebih dahulu tanpa langsung mengubah definisi aktif. Perubahan berlaku setelah disetujui ASMAN_PERENCANAAN.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="block text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">Berkas Excel (.xlsx, maks. 8 MB)</span>
              <input
                type="file"
                accept=".xlsx"
                aria-label="Berkas Workbook NKO"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className={`${filterControlCls} w-full py-1.5 text-xs`}
              />
            </label>

            <label className="block text-xs">
              <span className="font-semibold text-slate-700 dark:text-slate-300 block mb-1">Catatan Perubahan <span className="text-rose-600">*</span></span>
              <input
                type="text"
                maxLength={500}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Mis. Penambahan indikator baru / pembaruan target triwulan"
                aria-label="Catatan Unggahan Workbook"
                className={`${filterControlCls} w-full text-xs`}
              />
            </label>
          </div>

          {uploading && (
            <div className="flex items-center gap-2 text-xs text-indigo-700 dark:text-indigo-300">
              <Spinner size="sm" />
              <span>Memeriksa dan membandingkan isi workbook (.xlsx)...</span>
            </div>
          )}

          {uploadError && <Alert kind="error">{uploadError}</Alert>}

          <div className="flex justify-end">
            <Button type="submit" variant="primary" size="md" icon={IconUpload} loading={uploading}>
              Unggah Workbook
            </Button>
          </div>
        </form>
      )}

      {/* Daftar Unggahan */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
            Daftar Unggahan Workbook Definisi
          </h3>
          <select
            value={uploadStatusFilter}
            onChange={(e) => onUploadStatusFilterChange(e.target.value)}
            aria-label="Filter Status Unggahan"
            className={filterSelectCls}
          >
            <option value="">Semua Status</option>
            <option value="MENUNGGU">MENUNGGU</option>
            <option value="DISETUJUI">DISETUJUI</option>
            <option value="DITOLAK">DITOLAK</option>
            <option value="DIBATALKAN">DIBATALKAN</option>
          </select>
        </div>

        {detailState.loading && (
          <div className="py-6 flex justify-center">
            <Spinner size="md" label="Memuat rincian perubahan workbook..." />
          </div>
        )}
        {detailState.error && <Alert kind="error">{detailState.error}</Alert>}
        {detailState.data && (
          <UploadChangesDetail
            detail={detailState.data}
            onClose={() => setDetailState({ loading: false, error: '', data: null })}
          />
        )}

        {uploadsState.loading ? (
          <div className="py-12 flex justify-center">
            <Spinner size="lg" label="Memuat daftar unggahan..." />
          </div>
        ) : uploadsState.error ? (
          <Alert kind="error">{uploadsState.error}</Alert>
        ) : uploadsState.data.length === 0 ? (
          <EmptyState title="Belum Ada Unggahan" desc="Belum ada unggahan workbook definisi NKO." />
        ) : (
          <div className="space-y-3">
            {uploadsState.data.map((u) => {
              const isOwn = Boolean(currentUserId && u.uploaded_by?.id === currentUserId)
              const isPending = u.status === 'MENUNGGU'

              return (
                <div
                  key={u.id}
                  className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="space-y-1 text-xs">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-bold text-slate-900 dark:text-slate-100">{u.source_name}</span>
                      <span className="font-mono text-slate-500">({u.year})</span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${UPLOAD_STATUS_CLS[u.status] || ''}`}>
                        {u.status}
                      </span>
                    </div>
                    <p className="text-slate-700 dark:text-slate-300">{u.note}</p>
                    <div className="text-[11px] text-slate-500 flex flex-wrap gap-x-4">
                      <span>Diunggah oleh: <strong>{u.uploaded_by?.name || '-'}</strong> ({fmtDate(u.uploaded_at)})</span>
                      {u.decided_by && (
                        <span>
                          Diputus oleh: <strong>{u.decided_by.name}</strong> ({fmtDate(u.decided_at)})
                          {u.decision_note ? ` — "${u.decision_note}"` : ''}
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <Button type="button" variant="secondary" size="sm" onClick={() => loadUploadDetail(u.id)}>
                      Lihat Perubahan
                    </Button>
                    {isPending && canPropose && isOwn && (
                      <Button type="button" variant="ghost" size="sm" onClick={() => handleCancelUpload(u.id)}>
                        Batalkan
                      </Button>
                    )}
                    {isPending && canApprove && !isOwn && (
                      <>
                        <Button type="button" variant="primary" size="sm" onClick={() => setDecisionModal({ upload: u, mode: 'approve' })}>
                          Setujui
                        </Button>
                        <Button type="button" variant="danger" size="sm" onClick={() => setDecisionModal({ upload: u, mode: 'reject' })}>
                          Tolak
                        </Button>
                      </>
                    )}
                    {isPending && canApprove && isOwn && (
                      <span className="text-[11px] text-amber-600 dark:text-amber-400 italic">
                        Pengunggah tidak dapat memutus unggahannya sendiri
                      </span>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Daftar Versi Workbook */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 space-y-4">
        <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
          Daftar Versi Workbook Definisi ({year})
        </h3>
        {setsState.loading ? (
          <div className="py-10 flex justify-center">
            <Spinner size="md" label="Memuat versi definisi..." />
          </div>
        ) : setsState.error ? (
          <Alert kind="error">{setsState.error}</Alert>
        ) : setsState.data.length === 0 ? (
          <EmptyState title="Belum Ada Versi" desc={`Belum ada versi definisi untuk tahun ${year}.`} />
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Tingkat</th>
                  <th className="py-2.5 px-3 text-center">Versi</th>
                  <th className="py-2.5 px-3 text-center">Status</th>
                  <th className="py-2.5 px-3">Berkas Sumber</th>
                  <th className="py-2.5 px-3 text-right">Total Bobot</th>
                  <th className="py-2.5 px-3">Diimpor Oleh</th>
                  <th className="py-2.5 px-3">Waktu Impor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {setsState.data.map((s) => (
                  <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="py-2.5 px-3 font-bold text-slate-800 dark:text-slate-200">{s.unit_level}</td>
                    <td className="py-2.5 px-3 text-center font-mono">v{s.version}</td>
                    <td className="py-2.5 px-3 text-center">
                      <span
                        className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                          s.status === 'AKTIF'
                            ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800'
                            : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'
                        }`}
                      >
                        {s.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 font-mono text-[11px]">{s.source_name || '-'}</td>
                    <td className="py-2.5 px-3 text-right font-mono">{s.total_weight ?? '-'}</td>
                    <td className="py-2.5 px-3">{s.imported_by?.name || 'CLI / Server'}</td>
                    <td className="py-2.5 px-3 text-slate-500 text-[11px]">{fmtDate(s.imported_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <UploadDecisionModal
        upload={decisionModal.upload}
        mode={decisionModal.mode}
        onClose={() => setDecisionModal({ upload: null, mode: 'approve' })}
        onDecided={(data, isReject) => {
          onRefresh?.()
          if (!isReject) {
            onApproved?.(data?.mapping || null)
          }
        }}
      />
    </div>
  )
}
