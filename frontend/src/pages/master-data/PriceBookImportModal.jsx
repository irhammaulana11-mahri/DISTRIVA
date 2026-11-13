import { useState, useRef } from 'react'
import { priceBookApi } from '../../services/api.js'
import Drawer from '../../components/Drawer.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import {
  IconUpload,
  IconDownload,
  IconCheck,
  IconCheckCircle,
  IconExclamation,
  IconRefresh,
} from '../../components/icons.jsx'
import { downloadCsv, PRICE_BOOK_TEMPLATE } from '../../utils/csvTemplates.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'

export default function PriceBookImportModal({ isOpen, onClose, onSuccess }) {
  const { user } = useAuth()
  const { notify } = useNotifications()
  const fileInputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
  const [contractReference, setContractReference] = useState('')
  const [validFrom, setValidFrom] = useState(new Date().toISOString().slice(0, 10))
  const [sourceReference, setSourceReference] = useState('')

  const [step, setStep] = useState('form') // 'form' | 'preview'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [summary, setSummary] = useState(null)
  const [previewRows, setPreviewRows] = useState([])
  const [applying, setApplying] = useState(false)
  const [isDragging, setIsDragging] = useState(false)

  const processSelectedFile = (selected) => {
    if (selected) {
      setFile(selected)
      if (!name) {
        setName(selected.name.replace(/\.[^/.]+$/, '').replace(/[_-]/g, ' '))
      }
    }
  }

  const handleFileChange = (e) => {
    const selected = e.target.files?.[0]
    processSelectedFile(selected)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer?.files?.[0]
    processSelectedFile(f)
  }

  const handleDownloadTemplate = () => {
    downloadCsv('template_buku_harga.csv', PRICE_BOOK_TEMPLATE)
    notify({
      type: 'info',
      title: 'Templat CSV Diunduh',
      desc: 'Berkas template_buku_harga.csv berhasil diunduh.',
      tag: 'Buku Harga',
    })
  }

  // Step 1: Dry run
  const handleDryRun = async (e) => {
    e?.preventDefault?.()
    if (!file) {
      setError('Silakan pilih berkas CSV buku harga.')
      return
    }
    if (!name.trim()) {
      setError('Nama buku harga wajib diisi.')
      return
    }
    if (!validFrom) {
      setError('Tanggal berlaku (valid_from) wajib diisi.')
      return
    }

    setLoading(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('name', name.trim())
      if (contractReference.trim()) formData.append('contract_reference', contractReference.trim())
      formData.append('valid_from', validFrom)
      if (sourceReference.trim()) formData.append('source_reference', sourceReference.trim())
      formData.append('dry_run', '1')

      const res = await priceBookApi.import(formData)
      setSummary(res.data)
      setPreviewRows(res.rows || [])
      setStep('preview')
    } catch (err) {
      if (err.status === 409 && err.data?.rows) {
        setSummary(err.data.data || null)
        setPreviewRows(err.data.rows)
        setError(err.message || 'Terdapat baris data CSV yang tidak valid atau bermasalah.')
        setStep('preview')
      } else {
        setError(err.message || 'Gagal memproses validasi berkas CSV.')
      }
    } finally {
      setLoading(false)
    }
  }

  // Step 2: Apply commit
  const handleApply = async () => {
    setApplying(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('name', name.trim())
      if (contractReference.trim()) formData.append('contract_reference', contractReference.trim())
      formData.append('valid_from', validFrom)
      if (sourceReference.trim()) formData.append('source_reference', sourceReference.trim())
      formData.append('dry_run', '0')

      const res = await priceBookApi.import(formData)
      notify({
        type: 'success',
        title: 'Buku Harga Berhasil Diimpor',
        desc: `Buku harga "${name}" berhasil diunggah dengan status DRAFT.`,
        tag: 'Buku Harga',
      })
      if (onSuccess) onSuccess(res.data?.id)
      handleClose()
    } catch (err) {
      if (err.status === 409 && err.data?.rows) {
        setPreviewRows(err.data.rows)
        setError(err.message || 'Gagal menerapkan impor: terdapat baris data yang bermasalah.')
      } else {
        setError(err.message || 'Gagal menerapkan impor buku harga ke server.')
      }
    } finally {
      setApplying(false)
    }
  }

  const handleClose = () => {
    setFile(null)
    setName('')
    setContractReference('')
    setValidFrom(new Date().toISOString().slice(0, 10))
    setSourceReference('')
    setStep('form')
    setError('')
    setSummary(null)
    setPreviewRows([])
    setLoading(false)
    setApplying(false)
    setIsDragging(false)
    onClose()
  }

  const hasErrors = summary && summary.rejected_rows > 0

  return (
    <Drawer
      open={isOpen}
      onClose={handleClose}
      title={step === 'form' ? 'Impor Buku Harga Satuan Kontrak (CSV)' : 'Pratinjau Hasil Validasi (Dry Run)'}
      subtitle={
        step === 'form'
          ? 'Unggah berkas CSV daftar harga satuan material dan jasa instalasi per zona.'
          : 'Periksa baris data yang lolos verifikasi sebelum disimpan sebagai draf baru.'
      }
      size="max-w-3xl"
      footer={
        <div className="flex items-center justify-between w-full">
          {step === 'form' ? (
            <>
              <Button type="button" variant="secondary" onClick={handleClose} disabled={loading}>
                Batal
              </Button>
              <Button
                type="submit"
                form="price-book-import-form"
                onClick={handleDryRun}
                variant="primary"
                disabled={loading || !file}
              >
                {loading ? <Spinner size={14} label="Memvalidasi CSV..." /> : (
                  <>
                    <IconUpload size={14} />
                    <span>Lanjutkan Uji Coba (Dry Run)</span>
                  </>
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                type="button"
                variant="secondary"
                onClick={() => setStep('form')}
                disabled={applying}
              >
                <IconRefresh size={14} />
                <span>&larr; Kembali Ubah Berkas</span>
              </Button>
              <div className="flex items-center gap-2">
                <Button type="button" variant="secondary" onClick={handleClose} disabled={applying}>
                  Batal
                </Button>
                <Button
                  type="button"
                  variant="primary"
                  onClick={handleApply}
                  disabled={applying || hasErrors}
                  className={hasErrors ? 'opacity-50 cursor-not-allowed' : ''}
                >
                  {applying ? <Spinner size={14} label="Menerapkan Impor..." /> : (
                    <>
                      <IconCheck size={14} />
                      <span>Terapkan & Buat Draf</span>
                    </>
                  )}
                </Button>
              </div>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-5 text-xs text-slate-700 dark:text-slate-300">
        {error && <Alert kind="error">{error}</Alert>}

        {step === 'form' ? (
          <form id="price-book-import-form" onSubmit={handleDryRun} className="space-y-5">
            {/* Template Download Banner */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/30 text-blue-900 dark:text-blue-200">
              <div className="space-y-0.5 text-xs">
                <span className="font-bold block">Format Berkas CSV Standar</span>
                <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                  Kolom wajib: <code>kode</code>, <code>status_material</code> (PLN atau HARGA), <code>harga_material</code>, <code>z1_pasang</code>, <code>z1_bongkar</code>, dll.
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDownloadTemplate}
                className="shrink-0 bg-white dark:bg-slate-800 hover:bg-blue-50"
              >
                <IconDownload size={14} className="text-blue-600 dark:text-blue-400" />
                <span>Unduh Templat CSV</span>
              </Button>
            </div>

            {/* Form Grid */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label htmlFor="price-book-name" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nama Buku Harga <span className="text-rose-500">*</span>
                </label>
                <input
                  id="price-book-name"
                  type="text"
                  required
                  maxLength={150}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Contoh: KHS Distribusi Jatim 2026 Tahap 1"
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
                />
              </div>

              <div>
                <label htmlFor="price-book-contract-ref" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nomor Referensi Kontrak
                </label>
                <input
                  id="price-book-contract-ref"
                  type="text"
                  maxLength={150}
                  value={contractReference}
                  onChange={(e) => setContractReference(e.target.value)}
                  placeholder="Contoh: 001.PJ/DAN.01.01/UID-JTM/2026"
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
                />
              </div>

              <div>
                <label htmlFor="price-book-valid-from" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Tanggal Berlaku (Mulai) <span className="text-rose-500">*</span>
                </label>
                <input
                  id="price-book-valid-from"
                  type="date"
                  required
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring font-mono"
                />
                <p className="text-[11px] text-slate-400 mt-1">Ditentukan oleh Admin/Engineer.</p>
              </div>

              <div>
                <label htmlFor="price-book-source-ref" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Sumber Acuan / SK (Opsional)
                </label>
                <input
                  id="price-book-source-ref"
                  type="text"
                  maxLength={255}
                  value={sourceReference}
                  onChange={(e) => setSourceReference(e.target.value)}
                  placeholder="Contoh: Surat Keputusan GM UID Jawa Timur"
                  className="w-full px-3.5 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
                />
              </div>
            </div>

            {/* File Dropzone / Selector */}
            <div>
              <label htmlFor="price-book-file" className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Berkas CSV Buku Harga (.csv, .txt) <span className="text-rose-500">*</span>
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
                  id="price-book-file"
                  ref={fileInputRef}
                  type="file"
                  accept=".csv,text/csv,text/plain"
                  onChange={handleFileChange}
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
                        Pilih berkas CSV atau seret dan lepas ke area ini
                      </span>
                      <span className="text-[11px] text-slate-400">
                        Format .csv atau .txt (maks. 10 MB)
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </form>
        ) : (
          /* Step 2: Preview & Validation results */
          <div className="space-y-5">
            {summary && (
              <div className="space-y-4">
                {summary.rejected_rows > 0 ? (
                  <div className="p-4 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/30 text-rose-900 dark:text-rose-200 text-xs flex items-center gap-2 font-semibold">
                    <IconExclamation size={18} className="text-rose-600 dark:text-rose-400 shrink-0" />
                    <span>Terdapat {summary.rejected_rows} baris data CSV yang tidak valid. Perbaiki sebelum komit.</span>
                  </div>
                ) : (
                  <div className="p-4 rounded-xl border border-emerald-200 dark:border-emerald-800/80 bg-emerald-50/60 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 text-xs flex items-center gap-2 font-semibold">
                    <IconCheckCircle size={18} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <span>Semua baris data valid dan siap diimpor sebagai draf buku harga baru.</span>
                  </div>
                )}

                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs">
                  <div className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/50">
                    <span className="text-slate-500 block text-[11px] uppercase font-semibold">Total Baris</span>
                    <span className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
                      {summary.total_rows ?? previewRows.length}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/60 dark:bg-emerald-950/30">
                    <span className="text-emerald-700 dark:text-emerald-300 block text-[11px] uppercase font-semibold">Baris Diterima</span>
                    <span className="text-base font-bold text-emerald-700 dark:text-emerald-300 font-mono">
                      {summary.accepted_rows ?? 0}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-900/60 bg-rose-50/60 dark:bg-rose-950/30">
                    <span className="text-rose-700 dark:text-rose-300 block text-[11px] uppercase font-semibold">Baris Ditolak</span>
                    <span className="text-base font-bold text-rose-700 dark:text-rose-300 font-mono">
                      {summary.rejected_rows ?? 0}
                    </span>
                  </div>
                  <div className="p-3 rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/30">
                    <span className="text-blue-700 dark:text-blue-300 block text-[11px] uppercase font-semibold">Zona Terdeteksi</span>
                    <span className="text-base font-bold text-blue-700 dark:text-blue-300 font-mono">
                      {Array.isArray(summary.zones) ? summary.zones.join(', ') : '-'}
                    </span>
                  </div>
                </div>
              </div>
            )}

            {/* Detailed Rows Table */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden shadow-xs">
              <div className="px-4 py-2.5 bg-slate-100 dark:bg-slate-800 border-b border-slate-200 dark:border-slate-700 text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center justify-between">
                <span>Pratinjau Baris Data ({previewRows.length} baris)</span>
                <span className="text-[11px] font-normal text-slate-500">
                  {summary?.priced ?? 0} PRICED / {summary?.pln ?? 0} PLN
                </span>
              </div>
              <div className="max-h-72 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 sticky top-0 border-b border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 font-semibold">
                    <tr>
                      <th className="p-2.5 w-12 text-center">Baris</th>
                      <th className="p-2.5">Kode KHS</th>
                      <th className="p-2.5">Nama Item</th>
                      <th className="p-2.5">Status Mat.</th>
                      <th className="p-2.5">Zona</th>
                      <th className="p-2.5">Pesan Validasi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {previewRows.slice(0, 100).map((r, idx) => {
                      const isErr = r.messages && r.messages.length > 0 && r.status === 'REJECTED'
                      return (
                        <tr
                          key={idx}
                          className={
                            isErr
                              ? 'bg-rose-50/60 dark:bg-rose-950/20 text-rose-900 dark:text-rose-200'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/40'
                          }
                        >
                          <td className="p-2.5 text-center font-mono text-[11px] text-slate-400">
                            {r.row ?? idx + 1}
                          </td>
                          <td className="p-2.5 font-mono font-bold">{r.code}</td>
                          <td className="p-2.5 max-w-[200px] truncate" title={r.name}>
                            {r.name || '-'}
                          </td>
                          <td className="p-2.5">
                            <span
                              className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                                r.status === 'PLN'
                                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                                  : r.status === 'REJECTED'
                                  ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                  : 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                              }`}
                            >
                              {r.status || 'PLN'}
                            </span>
                          </td>
                          <td className="p-2.5 font-mono text-[11px]">
                            {Array.isArray(r.zones) ? r.zones.join(', ') : '-'}
                          </td>
                          <td className="p-2.5">
                            {r.messages && r.messages.length > 0 ? (
                              <ul className="list-disc list-inside space-y-0.5 text-rose-600 dark:text-rose-400 text-[11px]">
                                <li key={0}>{r.messages[0]}</li>
                              </ul>
                            ) : (
                              <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400 font-semibold text-[11px]">
                                <IconCheck size={12} /> Valid
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </div>
    </Drawer>
  )
}
