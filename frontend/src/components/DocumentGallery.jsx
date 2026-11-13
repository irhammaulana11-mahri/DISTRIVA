import { useState, useEffect } from 'react'
import { documentApi } from '../services/api.js'
import Button from './Button.jsx'
import Alert from './Alert.jsx'
import Spinner from './Spinner.jsx'
import { IconTrash, IconEye, IconTag, IconX } from './icons.jsx'

/**
 * Single Document/Photo Thumbnail with Authenticated Fetch & Blob.
 * In accordance with docs/63 §35:
 * Endpoint /documents/{id}/download requires Authorization: Bearer.
 * We fetch via fetch + token, transform to Blob -> URL.createObjectURL,
 * and revoke on unmount.
 */
export function AuthenticatedDocumentItem({
  doc,
  canDelete = false,
  onDeleted,
}) {
  const isImage = Boolean(doc.mime_type && doc.mime_type.startsWith('image/'))
  const [blobUrl, setBlobUrl] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)

  // Load thumbnail if it is an image
  useEffect(() => {
    let active = true
    let createdUrl = null

    if (isImage) {
      setLoading(true)
      Promise.resolve(documentApi.downloadBlob?.(doc.id, { inline: true }))
        .then((blob) => {
          if (!active || !blob) return
          createdUrl = URL.createObjectURL(blob)
          setBlobUrl(createdUrl)
        })
        .catch((err) => {
          if (active) setError(err?.message || 'Gagal memuat gambar.')
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }

    return () => {
      active = false
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl)
      }
    }
  }, [doc.id, isImage])

  const handleDownload = async () => {
    try {
      const blob = await documentApi.downloadBlob(doc.id, { inline: false })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = doc.original_name || `dokumen-${doc.id}`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(url), 1000)
    } catch (err) {
      alert(err.message || 'Gagal mengunduh berkas.')
    }
  }

  const handleDelete = async () => {
    setDeleting(true)
    try {
      await documentApi.remove(doc.id)
      setConfirmDelete(false)
      onDeleted?.(doc.id)
    } catch (err) {
      alert(err.message || 'Gagal menghapus dokumen.')
    } finally {
      setDeleting(false)
    }
  }

  const formatSize = (bytes) => {
    if (!bytes) return ''
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  }

  return (
    <div className="relative group rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden shadow-xs hover:shadow-md transition-shadow">
      {/* Thumbnail view */}
      <div className="h-36 w-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center overflow-hidden relative">
        {isImage ? (
          loading ? (
            <div className="text-slate-400 text-xs flex items-center gap-1.5">
              <Spinner size="sm" />
              <span>Memuat...</span>
            </div>
          ) : error ? (
            <div className="text-rose-500 text-[11px] p-2 text-center">{error}</div>
          ) : blobUrl ? (
            <img
              src={blobUrl}
              alt={doc.title || doc.original_name}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200"
            />
          ) : null
        ) : (
          <div className="flex flex-col items-center justify-center p-3 text-center">
            <div className="w-10 h-10 rounded-lg bg-red-100 dark:bg-red-950/60 text-red-600 dark:text-red-400 flex items-center justify-center font-bold text-xs uppercase mb-1">
              {doc.original_name?.split('.').pop() || 'PDF'}
            </div>
            <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 line-clamp-1 max-w-[120px]">
              {doc.original_name}
            </span>
          </div>
        )}

        {/* Hover overlay with action buttons */}
        <div className="absolute inset-0 bg-slate-900/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center gap-2">
          <button
            type="button"
            onClick={handleDownload}
            className="p-1.5 rounded-lg bg-white/90 text-slate-800 hover:bg-white text-xs font-semibold shadow-xs flex items-center gap-1"
            title="Unduh / Pratinjau Berkas"
          >
            <IconEye size={14} />
            <span>Unduh</span>
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={() => setConfirmDelete(true)}
              className="p-1.5 rounded-lg bg-rose-600 text-white hover:bg-rose-700 text-xs font-semibold shadow-xs"
              title="Hapus Dokumen"
            >
              <IconTrash size={14} />
            </button>
          )}
        </div>
      </div>

      {/* Meta Footer */}
      <div className="p-2.5">
        <p className="text-xs font-semibold text-slate-800 dark:text-slate-200 truncate" title={doc.title || doc.original_name}>
          {doc.title || doc.original_name}
        </p>
        <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400">
          <span>{formatSize(doc.size_bytes)}</span>
          <span className="truncate max-w-[90px]">{doc.original_name}</span>
        </div>
      </div>

      {/* Honest confirmation modal for delete (docs/63 §36) */}
      {confirmDelete && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/60 p-4">
          <div className="max-w-sm w-full bg-white dark:bg-slate-900 rounded-xl p-5 border border-slate-200 dark:border-slate-800 shadow-xl space-y-3">
            <div className="flex items-center justify-between pb-1 border-b border-slate-100 dark:border-slate-800">
              <h4 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                Hapus Dokumen Ini?
              </h4>
              <button
                type="button"
                onClick={() => setConfirmDelete(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer shrink-0"
                aria-label="Tutup konfirmasi hapus"
                title="Tutup (Esc)"
              >
                <IconX size={16} />
              </button>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Berkas akan disembunyikan dari tampilan permohonan. Berkas dan riwayat unggahan tetap tersimpan di server untuk kelengkapan audit trail.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDelete(false)}
                disabled={deleting}
              >
                Batal
              </Button>
              <Button
                variant="danger"
                size="sm"
                onClick={handleDelete}
                loading={deleting}
              >
                Ya, Sembunyikan Dokumen
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * Multi-file Document Gallery & Uploader Component.
 */
export default function DocumentGallery({
  documents = [],
  surveyId,
  versionNumber,
  canUpload = false,
  canDelete = false,
  onDocumentAdded,
  onDocumentRemoved,
}) {
  const [uploading, setUploading] = useState(false)
  const [progressMsg, setProgressMsg] = useState('')
  const [uploadError, setUploadError] = useState('')

  const handleFilesSelected = async (e) => {
    const files = Array.from(e.target.files || [])
    if (files.length === 0) return

    setUploading(true)
    setUploadError('')

    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
    const maxBytes = 10 * 1024 * 1024 // 10MB

    for (let i = 0; i < files.length; i++) {
      const f = files[i]
      setProgressMsg(`Mengunggah berkas ${i + 1} dari ${files.length}: ${f.name}…`)

      if (!allowed.includes(f.type) && !f.name.match(/\.(jpg|jpeg|png|webp|pdf)$/i)) {
        setUploadError(`Berkas "${f.name}" tidak diizinkan. Hanya JPG, PNG, WebP, dan PDF yang didukung.`)
        setUploading(false)
        return
      }

      if (f.size > maxBytes) {
        setUploadError(`Berkas "${f.name}" melebihi ukuran maksimum 10 MB.`)
        setUploading(false)
        return
      }

      try {
        const res = await documentApi.uploadToSurvey(
          surveyId,
          versionNumber,
          f,
          f.name.replace(/\.[^/.]+$/, '')
        )
        onDocumentAdded?.(res.data)
      } catch (err) {
        setUploadError(err.message || `Gagal mengunggah berkas ${f.name}.`)
        setUploading(false)
        return
      }
    }

    setUploading(false)
    setProgressMsg('')
    e.target.value = ''
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
            Foto & Dokumen Bukti Lapangan ({documents.length})
          </h4>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Dokumen pendukung hasil survei (JPG, PNG, WebP, PDF ≤10 MB).
          </p>
        </div>

        {canUpload && (
          <div>
            <label className="cursor-pointer">
              <input
                type="file"
                multiple
                accept=".jpg,.jpeg,.png,.webp,.pdf,image/jpeg,image/png,image/webp,application/pdf"
                onChange={handleFilesSelected}
                disabled={uploading}
                className="hidden"
              />
              <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 hover:bg-blue-700 text-white shadow-xs transition-colors">
                {uploading ? 'Mengunggah…' : '+ Unggah Berkas'}
              </span>
            </label>
          </div>
        )}
      </div>

      {uploading && (
        <div className="p-3 rounded-lg bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 flex items-center gap-2 text-xs text-blue-700 dark:text-blue-300">
          <Spinner size="sm" />
          <span>{progressMsg}</span>
        </div>
      )}

      {uploadError && <Alert kind="error">{uploadError}</Alert>}

      {documents.length === 0 ? (
        <div className="p-8 text-center border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-xl">
          <IconTag className="mx-auto text-slate-300 dark:text-slate-700 mb-2" size={32} />
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Belum ada foto atau dokumen yang diunggah untuk versi survei ini.
          </p>
          {canUpload && (
            <p className="text-[11px] text-slate-400 mt-1">
              Wajib mengunggah minimal 1 foto/dokumen sebelum mengajukan survei.
            </p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {documents.map((doc) => (
            <AuthenticatedDocumentItem
              key={doc.id}
              doc={doc}
              canDelete={canDelete}
              onDeleted={onDocumentRemoved}
            />
          ))}
        </div>
      )}
    </div>
  )
}
