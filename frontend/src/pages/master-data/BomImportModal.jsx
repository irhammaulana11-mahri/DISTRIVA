import { useState, useRef } from 'react'
import Drawer from '../../components/Drawer.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import {
  IconUpload,
  IconCheckCircle,
  IconAlertCircle,
  IconRefresh,
} from '../../components/icons.jsx'
import { bomApi } from '../../services/api.js'

export default function BomImportModal({ open, onClose, onSuccess }) {
  const { user } = useAuth()
  const { notify } = useNotifications()
  const fileInputRef = useRef(null)
  const [file, setFile] = useState(null)
  const [validFrom, setValidFrom] = useState('')
  const [sourceRef, setSourceRef] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [problems, setProblems] = useState([])
  const [preview, setPreview] = useState(null)
  const [isDragging, setIsDragging] = useState(false)

  const resetState = () => {
    setFile(null)
    setValidFrom('')
    setSourceRef('')
    setLoading(false)
    setError('')
    setProblems([])
    setPreview(null)
    setIsDragging(false)
  }

  const handleClose = () => {
    resetState()
    onClose()
  }

  const processSelectedFile = (selected) => {
    if (selected) {
      setFile(selected)
      setPreview(null)
      setError('')
      setProblems([])
    }
  }

  const handleFileChange = (e) => {
    const f = e.target.files?.[0]
    processSelectedFile(f)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer?.files?.[0]
    processSelectedFile(f)
  }

  // Dry run preview
  const handleDryRun = async (e) => {
    e?.preventDefault?.()
    if (!file) {
      setError('Pilih berkas JSON BOM terlebih dahulu.')
      return
    }
    if (!validFrom) {
      setError('Tanggal mulai berlaku (valid_from) wajib diisi.')
      return
    }

    setLoading(true)
    setError('')
    setProblems([])
    setPreview(null)

    const formData = new FormData()
    formData.append('file', file)
    formData.append('valid_from', validFrom)
    if (sourceRef.trim()) {
      formData.append('source_reference', sourceRef.trim())
    }
    formData.append('dry_run', '1')

    try {
      const res = await bomApi.import(formData)
      setPreview(res?.data || null)
      setProblems(res?.problems || [])
    } catch (err) {
      setError(err?.message || 'Gagal memproses pratinjau impor BOM.')
      if (err?.data?.problems) {
        setProblems(err.data.problems)
      }
    } finally {
      setLoading(false)
    }
  }

  // Commit apply
  const handleApply = async () => {
    if (!file || !validFrom) return

    setLoading(true)
    setError('')
    setProblems([])

    const formData = new FormData()
    formData.append('file', file)
    formData.append('valid_from', validFrom)
    if (sourceRef.trim()) {
      formData.append('source_reference', sourceRef.trim())
    }
    formData.append('dry_run', '0')

    try {
      const res = await bomApi.import(formData)
      notify({
        type: 'success',
        title: 'BOM Berhasil Diimpor',
        desc: `BOM kelompok ${res?.data?.group ?? ''} berhasil diimpor sebagai versi draf baru.`,
        tag: 'Bill of Materials',
      })
      handleClose()
      onSuccess?.(res?.data)
    } catch (err) {
      setError(err?.message || 'Gagal menerapkan impor BOM.')
      if (err?.data?.problems) {
        setProblems(err.data.problems)
      }
    } finally {
      setLoading(false)
    }
  }

  return (
    <Drawer
      open={open}
      onClose={handleClose}
      title="Impor Bill of Materials (BOM)"
      subtitle="Unggah berkas JSON hasil ekstraksi workbook BOM untuk membuat draf versi baru."
      size="max-w-2xl"
      footer={
        <div className="flex items-center justify-between w-full">
          {!preview ? (
            <>
              <Button type="button" variant="secondary" onClick={handleClose} disabled={loading}>
                Batal
              </Button>
              <Button
                type="submit"
                form="bom-import-form"
                onClick={handleDryRun}
                variant="primary"
                disabled={loading || !file || !validFrom}
              >
                {loading ? <Spinner size={14} label="Memvalidasi..." /> : (
                  <>
                    <IconUpload size={14} />
                    <span>Uji Validasi (Dry Run)</span>
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="secondary" onClick={() => setPreview(null)} disabled={loading}>
                <IconRefresh size={14} />
                <span>Ubah Berkas / Parameter</span>
              </Button>
              <Button type="button" variant="primary" onClick={handleApply} disabled={loading}>
                {loading ? <Spinner size={14} label="Menerapkan..." /> : (
                  <>
                    <IconCheckCircle size={14} />
                    <span>Terapkan & Buat Versi Baru</span>
                  </>
                )}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-5 text-xs text-slate-700 dark:text-slate-300">
        {error && <Alert kind="error">{error}</Alert>}

        {/* Info Banner */}
        <div className="p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200 text-xs space-y-1">
          <span className="font-bold block">Format Berkas Ekstraksi JSON</span>
          <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
            Berkas JSON diekstraksi dari workbook resmi BOM menggunakan skrip CLI:
            <br />
            <code className="inline-block mt-1 font-mono text-[11px] bg-white/70 dark:bg-slate-800/80 px-2 py-0.5 rounded border border-blue-200/50 dark:border-blue-800/50 text-blue-800 dark:text-blue-300">
              python tools/extract_bom_json.py &lt;workbook.xlsx&gt; --sheet BOM
            </code>
          </p>
        </div>

        {!preview ? (
          <form id="bom-import-form" onSubmit={handleDryRun} className="space-y-4">
            {/* Inputs Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="import-valid-from" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tanggal Mulai Berlaku (Valid From) <span className="text-rose-500">*</span>
                </label>
                <input
                  id="import-valid-from"
                  type="date"
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                  disabled={loading}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring font-mono"
                  required
                />
                <p className="text-[11px] text-slate-400 mt-1">Ditentukan oleh Admin/Engineer.</p>
              </div>

              <div>
                <label htmlFor="import-source-ref" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Referensi Sumber (Opsional)
                </label>
                <input
                  id="import-source-ref"
                  type="text"
                  placeholder="mis. SK Direksi No... / Workbook 2026"
                  value={sourceRef}
                  onChange={(e) => setSourceRef(e.target.value)}
                  disabled={loading}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
                />
              </div>
            </div>

            {/* File Dropzone */}
            <div>
              <label htmlFor="import-bom-file" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Berkas JSON BOM <span className="text-rose-500">*</span>
              </label>

              <div
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                className={`border-2 border-dashed rounded-2xl p-6 text-center cursor-pointer transition-colors ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50/40 dark:bg-blue-950/30'
                    : 'border-slate-300 dark:border-slate-700 hover:border-blue-500 dark:hover:border-blue-400 bg-slate-50/50 dark:bg-slate-800/40'
                }`}
              >
                <input
                  id="import-bom-file"
                  ref={fileInputRef}
                  type="file"
                  accept=".json,application/json"
                  onChange={handleFileChange}
                  disabled={loading}
                  className="hidden"
                />

                <div className="flex flex-col items-center gap-2">
                  <div className="p-3 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400">
                    <IconUpload size={24} />
                  </div>
                  {file ? (
                    <div className="space-y-0.5">
                      <span className="text-xs font-bold text-slate-800 dark:text-slate-200 block">
                        {file.name}
                      </span>
                      <span className="text-[11px] text-slate-400">
                        {(file.size / 1024).toFixed(1)} KB · Klik untuk mengganti berkas
                      </span>
                    </div>
                  ) : (
                    <div>
                      <span className="text-xs font-medium text-slate-600 dark:text-slate-300 block">
                        Pilih berkas JSON atau seret dan lepas ke area ini
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Format .json (maks. 10 MB)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </form>
        ) : (
          /* Preview Summary (Dry Run Results) */
          <div className="space-y-4 pt-1">
            <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/60 dark:bg-emerald-950/30">
              <div className="flex items-center gap-2 font-bold text-emerald-800 dark:text-emerald-300 mb-2.5">
                <IconCheckCircle size={16} />
                <span>Hasil Validasi Pratinjau (Dry Run Berhasil)</span>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-lg border border-emerald-100 dark:border-emerald-900">
                  <span className="text-slate-500 text-[10px] uppercase font-semibold block">Kelompok</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 text-sm font-mono">{preview.group}</span>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-lg border border-emerald-100 dark:border-emerald-900">
                  <span className="text-slate-500 text-[10px] uppercase font-semibold block">Total Baris</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 text-sm font-mono">{preview.total_lines ?? preview.accepted_lines}</span>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-lg border border-emerald-100 dark:border-emerald-900">
                  <span className="text-slate-500 text-[10px] uppercase font-semibold block">Baris KHS</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 text-sm font-mono">{preview.with_khs ?? 0}</span>
                </div>
                <div className="bg-white/80 dark:bg-slate-900/80 p-2.5 rounded-lg border border-emerald-100 dark:border-emerald-900">
                  <span className="text-slate-500 text-[10px] uppercase font-semibold block">Sel Rumus</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200 text-sm font-mono">{preview.formula_cells ?? 0}</span>
                </div>
              </div>
            </div>

            {/* Problems warning if any */}
            {problems.length > 0 && (
              <div className="p-3.5 rounded-xl border border-amber-200 dark:border-amber-800 bg-amber-50/70 dark:bg-amber-950/40 space-y-2">
                <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
                  <IconAlertCircle size={16} />
                  <span>Catatan Masalah ({problems.length})</span>
                </div>
                <div className="max-h-40 overflow-y-auto space-y-1.5 text-[11px]">
                  {problems.map((p, idx) => (
                    <div key={idx} className="bg-white/70 dark:bg-slate-900/70 p-2 rounded border border-amber-100 dark:border-amber-900">
                      <span className="font-semibold text-amber-900 dark:text-amber-200">
                        {p.where ? `${p.where}: ` : p.row ? `Baris ${p.row}: ` : ''}
                      </span>
                      <span>{Array.isArray(p.messages) ? p.messages.join('; ') : p.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Drawer>
  )
}
