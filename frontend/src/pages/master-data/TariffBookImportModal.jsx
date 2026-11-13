import { useState, useRef } from 'react'
import { tariffBooksApi } from '../../services/api.js'
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
import { downloadCsv, TARIFF_BOOK_TEMPLATE } from '../../utils/csvTemplates.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'

export default function TariffBookImportModal({ isOpen, onClose, onSuccess }) {
  const { user } = useAuth()
  const { notify } = useNotifications()
  const fileInputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [name, setName] = useState('')
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
    downloadCsv('template_buku_tarif.csv', TARIFF_BOOK_TEMPLATE)
    notify({
      type: 'info',
      title: 'Templat CSV Diunduh',
      desc: 'Berkas template_buku_tarif.csv berhasil diunduh.',
      tag: 'Buku Tarif',
    })
  }

  // Step 1: Dry run
  const handleDryRun = async (e) => {
    e?.preventDefault?.()
    if (!file) {
      setError('Silakan pilih berkas CSV buku tarif.')
      return
    }
    if (!name.trim()) {
      setError('Nama buku tarif wajib diisi.')
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
      formData.append('valid_from', validFrom)
      if (sourceReference.trim()) formData.append('source_reference', sourceReference.trim())
      formData.append('dry_run', '1')

      const res = await tariffBooksApi.import(formData)
      setSummary(res.data)
      setPreviewRows(res.rows || [])
      setStep('preview')
    } catch (err) {
      setError(err?.message || 'Gagal memvalidasi berkas buku tarif.')
    } finally {
      setLoading(false)
    }
  }

  // Step 2: Commit / Apply (non dry-run)
  const handleApply = async () => {
    setApplying(true)
    setError('')

    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('name', name.trim())
      formData.append('valid_from', validFrom)
      if (sourceReference.trim()) formData.append('source_reference', sourceReference.trim())
      formData.append('dry_run', '0')

      const res = await tariffBooksApi.import(formData)

      notify({
        type: 'success',
        title: 'Buku Tarif Dibuat',
        desc: `Draf buku tarif "${name}" berhasil diunggah (${res.data?.accepted || 0} baris) dan menunggu persetujuan pejabat berwenang.`,
        tag: 'Buku Tarif',
      })

      onSuccess?.(res.data)
      handleClose()
    } catch (err) {
      setError(err?.message || 'Gagal menyimpan buku tarif.')
    } finally {
      setApplying(false)
    }
  }

  const handleClose = () => {
    setFile(null)
    setName('')
    setValidFrom(new Date().toISOString().slice(0, 10))
    setSourceReference('')
    setStep('form')
    setError('')
    setSummary(null)
    setPreviewRows([])
    onClose()
  }

  if (!isOpen) return null

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      title="Impor Buku Tarif Listrik"
      subtitle="Unggah berkas CSV untuk membuat draf buku tarif listrik (harga rata-rata, jam nyala, dan UJL)."
      width="max-w-3xl"
      footer={
        <div className="flex items-center justify-between w-full">
          {step === 'preview' ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setStep('form')}
                disabled={applying}
              >
                Kembali ke Formulir
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleClose}
                  disabled={applying}
                >
                  Batal
                </Button>
                {summary && summary.rejected === 0 && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={handleApply}
                    disabled={applying}
                  >
                    {applying ? (
                      <span className="flex items-center gap-1.5">
                        <Spinner size="xs" />
                        Menyimpan Draf...
                      </span>
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <IconCheck size={16} />
                        Terapkan & Simpan Draf
                      </span>
                    )}
                  </Button>
                )}
              </div>
            </>
          ) : (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={handleClose}
                disabled={loading}
              >
                Batal
              </Button>
              <Button
                variant="primary"
                size="sm"
                onClick={handleDryRun}
                disabled={loading || !file || !name.trim() || !validFrom}
              >
                {loading ? (
                  <span className="flex items-center gap-1.5">
                    <Spinner size="xs" />
                    Memvalidasi CSV...
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5">
                    <IconUpload size={16} />
                    Uji Validasi (Dry Run)
                  </span>
                )}
              </Button>
            </>
          )}
        </div>
      }
    >
      <div className="space-y-5">
        {error && <Alert kind="error">{error}</Alert>}

        {step === 'form' && (
          <form onSubmit={handleDryRun} className="space-y-5">
            {/* Template & Format Specification Guide */}
            <div className="p-4 rounded-xl border border-blue-100 dark:border-blue-900/40 bg-blue-50/60 dark:bg-blue-950/20 text-xs space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <h4 className="font-semibold text-blue-900 dark:text-blue-300">
                    Format Berkas CSV Buku Tarif Listrik
                  </h4>
                  <p className="text-slate-600 dark:text-slate-400 leading-relaxed">
                    Berkas CSV harus memuat kolom berikut (baris pertama sebagai header):
                  </p>
                  <code className="inline-block px-2 py-1 bg-white dark:bg-slate-800 rounded border border-blue-200 dark:border-blue-800 font-mono text-[11px] text-blue-700 dark:text-blue-300">
                    tarif, daya_va, harga_rata2, jam_nyala, ujl, ulp
                  </code>
                </div>
                <button
                  type="button"
                  onClick={handleDownloadTemplate}
                  className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-blue-600 dark:text-blue-400 hover:bg-slate-50 dark:hover:bg-slate-700 font-medium text-xs shadow-xs transition"
                >
                  <IconDownload size={14} />
                  <span>Unduh Templat CSV</span>
                </button>
              </div>

              <div className="text-[11px] text-slate-500 dark:text-slate-400 space-y-1 pt-2 border-t border-blue-200/50 dark:border-blue-900/40">
                <p>• <strong>tarif</strong>: Kode golongan tarif (misal R1, R2, B1, I1). Tanda hubung dinormalkan otomatis.</p>
                <p>• <strong>daya_va</strong>: Tingkat daya dalam VA (kosongkan jika tarif berlaku untuk semua daya).</p>
                <p>• <strong>harga_rata2</strong>: Harga jual tenaga listrik rata-rata (Rp/kWh) &gt; 0.</p>
                <p>• <strong>jam_nyala</strong>: Jam nyala rata-rata bulanan (kWh/kVA/bulan) &gt;= 0.</p>
                <p>• <strong>ujl</strong>: Uang Jaminan Langganan (Rp/VA, opsional &gt;= 0). Wajib jika ada pelanggan pascabayar.</p>
                <p>• <strong>ulp</strong>: Kode ULP (opsional; kosongkan jika berlaku untuk semua ULP).</p>
              </div>
            </div>

            {/* Drag & Drop File Upload Area */}
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Berkas CSV Buku Tarif <span className="text-rose-500">*</span>
              </label>
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                    : file
                    ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20'
                    : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30'
                }`}
              >
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileChange}
                  accept=".csv,text/csv,text/plain"
                  className="hidden"
                />
                <IconUpload
                  size={32}
                  className={`mx-auto mb-2 ${
                    file ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'
                  }`}
                />
                {file ? (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      {file.name}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {(file.size / 1024).toFixed(1)} KB — Klik atau seret untuk mengganti berkas
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs font-medium text-slate-700 dark:text-slate-300">
                      Klik untuk memilih berkas CSV atau seret ke area ini
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Maksimal ukuran berkas 10 MB (format .csv)
                    </p>
                  </div>
                )}
              </div>
            </div>

            {/* Form Metadata Fields */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="sm:col-span-2">
                <label
                  htmlFor="tariff-book-name"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Nama Buku Tarif <span className="text-rose-500">*</span>
                </label>
                <input
                  id="tariff-book-name"
                  type="text"
                  required
                  placeholder="mis. Buku Tarif Listrik PLN 2026"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label
                  htmlFor="tariff-valid-from"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Tanggal Mulai Berlaku (Valid From) <span className="text-rose-500">*</span>
                </label>
                <input
                  id="tariff-valid-from"
                  type="date"
                  required
                  value={validFrom}
                  onChange={(e) => setValidFrom(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label
                  htmlFor="tariff-source-ref"
                  className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1"
                >
                  Referensi Dokumen Sumber (Opsional)
                </label>
                <input
                  id="tariff-source-ref"
                  type="text"
                  placeholder="mis. Permen ESDM No. / SK Direksi"
                  value={sourceReference}
                  onChange={(e) => setSourceReference(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </form>
        )}

        {step === 'preview' && summary && (
          <div className="space-y-4">
            {/* Summary KPI Badges */}
            <div className="grid grid-cols-3 gap-3">
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
                <span className="block text-[11px] font-semibold text-slate-500">Total Baris</span>
                <span className="text-lg font-bold text-slate-800 dark:text-slate-100">
                  {summary.total}
                </span>
              </div>
              <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                <span className="block text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                  Valid / Diterima
                </span>
                <span className="text-lg font-bold text-emerald-700 dark:text-emerald-300">
                  {summary.accepted}
                </span>
              </div>
              <div
                className={`p-3 rounded-xl border text-center ${
                  summary.rejected > 0
                    ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800'
                    : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
                }`}
              >
                <span
                  className={`block text-[11px] font-semibold ${
                    summary.rejected > 0
                      ? 'text-rose-600 dark:text-rose-400'
                      : 'text-slate-500'
                  }`}
                >
                  Ditolak
                </span>
                <span
                  className={`text-lg font-bold ${
                    summary.rejected > 0
                      ? 'text-rose-700 dark:text-rose-300'
                      : 'text-slate-800 dark:text-slate-100'
                  }`}
                >
                  {summary.rejected}
                </span>
              </div>
            </div>

            {summary.rejected > 0 ? (
              <div className="p-3.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-800 dark:text-rose-200 space-y-1">
                <div className="flex items-center gap-2 font-semibold">
                  <IconExclamation size={16} />
                  <span>Aturan All-or-Nothing: Impor Ditolak</span>
                </div>
                <p className="text-[11px] text-rose-700 dark:text-rose-300">
                  Terdapat {summary.rejected} baris data yang tidak memenuhi validasi. Seluruh baris harus valid sebelum buku tarif dapat disimpan. Periksa daftar galat di bawah, lalu perbaiki berkas CSV Anda.
                </p>
              </div>
            ) : (
              <div className="p-3.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
                <IconCheckCircle size={16} className="text-emerald-600 shrink-0" />
                <span>Seluruh baris ({summary.accepted} item) telah tervalidasi dan siap disimpan sebagai draf buku tarif.</span>
              </div>
            )}

            {/* Validation Rows Table */}
            <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="sticky top-0 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 font-semibold z-10">
                    <tr>
                      <th className="py-2.5 px-3 w-16">Baris</th>
                      <th className="py-2.5 px-3">Tarif</th>
                      <th className="py-2.5 px-3">Daya (VA)</th>
                      <th className="py-2.5 px-3">ULP</th>
                      <th className="py-2.5 px-3 w-28">Status</th>
                      <th className="py-2.5 px-3">Keterangan / Galat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono text-[11px]">
                    {previewRows.map((row, idx) => {
                      const isOk = row.status === 'OK'
                      return (
                        <tr
                          key={idx}
                          className={
                            isOk
                              ? 'hover:bg-slate-50/60 dark:hover:bg-slate-800/30'
                              : 'bg-rose-50/50 dark:bg-rose-950/20 hover:bg-rose-50 dark:hover:bg-rose-950/30'
                          }
                        >
                          <td className="py-2 px-3 text-slate-400">{row.row}</td>
                          <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                            {row.tariff}
                          </td>
                          <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                            {row.power_va ? `${Number(row.power_va).toLocaleString('id-ID')} VA` : 'Semua Daya'}
                          </td>
                          <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                            {row.ulp || 'Semua ULP'}
                          </td>
                          <td className="py-2 px-3">
                            {isOk ? (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-300">
                                <IconCheck size={11} /> OK
                              </span>
                            ) : (
                              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 dark:bg-rose-900/50 text-rose-800 dark:text-rose-300">
                                DITOLAK
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-slate-600 dark:text-slate-400 font-sans">
                            {row.errors && row.errors.length > 0 ? (
                              <ul className="list-disc list-inside text-rose-600 dark:text-rose-400 text-[11px] space-y-0.5">
                                {row.errors.map((e, ei) => (
                                  <li key={ei}>{e}</li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-slate-400 text-[11px]">Valid</span>
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
