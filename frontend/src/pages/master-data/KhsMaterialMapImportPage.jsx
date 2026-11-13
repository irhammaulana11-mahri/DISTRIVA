import { useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { khsMaterialMapApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { downloadCsv, KHS_MATERIAL_MAP_TEMPLATE } from '../../utils/csvTemplates.js'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import { IconAlertCircle, IconCheck, IconCheckCircle, IconDownload, IconPlus, IconUpload, IconX, IconInfo } from '../../components/icons.jsx'

/** Halaman impor pemetaan SKU↔KHS (CSV dengan pratinjau) atau tambah pasangan manual. Laci/dialog pada daftar tidak lagi memuat form. */
export default function KhsMaterialMapImportPage() {
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const goBack = () => navigate('/master-data/mapping')
  // CSV Import & Manual Drawer
  const fileInputRef = useRef(null)
  const [drawerMode, setDrawerMode] = useState('upload') // 'upload' | 'manual'
  const [drawerKhsCode, setDrawerKhsCode] = useState('')
  const [drawerSku, setDrawerSku] = useState('')
  const [drawerNote, setDrawerNote] = useState('')
  const [drawerManualSaving, setDrawerManualSaving] = useState(false)
  const [importFile, setImportFile] = useState(null)
  const [isDragging, setIsDragging] = useState(false)
  const [dryRunLoading, setDryRunLoading] = useState(false)
  const [dryRunResult, setDryRunResult] = useState(null)
  const [applying, setApplying] = useState(false)
  const [importError, setImportError] = useState('')

  // Handle Dry Run CSV Import
  const handleDryRunImport = async (e) => {
    e?.preventDefault?.()
    if (!importFile) {
      setImportError('Silakan pilih berkas CSV pemetaan terlebih dahulu.')
      return
    }
    setDryRunLoading(true)
    setImportError('')
    try {
      const formData = new FormData()
      formData.append('file', importFile)
      formData.append('dry_run', '1')

      const res = await khsMaterialMapApi.importCsv(formData)
      // the server reports {total, new, unchanged}; a rejected row aborts the whole import with an error, so rejected is 0 here
      const sum = res?.data || {}
      const norm = { ...res, data: { ...sum, accepted: sum.new ?? sum.accepted ?? 0, rejected: sum.rejected ?? 0 } }
      setDryRunResult(norm)
      notify({
        type: 'info',
        title: 'Uji Validasi Pemetaan Selesai',
        desc: `Hasil dry run: ${norm.data.accepted} pasangan baru, ${sum.unchanged || 0} sudah ada, ${norm.data.rejected} baris ditolak.`,
        tag: 'PEMETAAN',
      })
    } catch (err) {
      const msg = err?.message || 'Validasi berkas pemetaan gagal.'
      setImportError(msg)
      notify({
        type: 'error',
        title: 'Gagal Validasi Berkas CSV',
        desc: msg,
        tag: 'PEMETAAN',
      })
    } finally {
      setDryRunLoading(false)
    }
  }

  // Handle Commit CSV Import
  const handleCommitImport = async () => {
    if (!importFile) return
    setApplying(true)
    setImportError('')
    try {
      const formData = new FormData()
      formData.append('file', importFile)
      formData.append('dry_run', '0')

      const res = await khsMaterialMapApi.importCsv(formData)
      notify({
        type: 'success',
        title: 'Impor Pemetaan Berhasil',
        desc: `Berhasil mengimpor ${res?.data?.new ?? res?.data?.accepted ?? 0} pasangan pemetaan SKU↔KHS.`,
        tag: 'PEMETAAN',
      })
      goBack()
      setImportFile(null)
      setDryRunResult(null)
    } catch (err) {
      const msg = err?.message || 'Gagal menyimpan berkas pemetaan.'
      setImportError(msg)
      notify({
        type: 'error',
        title: 'Gagal Menerapkan Pemetaan',
        desc: msg,
        tag: 'PEMETAAN',
      })
    } finally {
      setApplying(false)
    }
  }

  const handleSaveDrawerManual = async (e) => {
    e?.preventDefault?.()
    if (!drawerKhsCode.trim() || !drawerSku.trim()) {
      setImportError('Kode KHS dan Nomor Material ERP (SKU) wajib diisi.')
      return
    }
    setDrawerManualSaving(true)
    setImportError('')
    try {
      await khsMaterialMapApi.create({
        khs_code: drawerKhsCode.trim(),
        material_no: drawerSku.trim(),
        note: drawerNote.trim() || undefined,
      })
      notify({
        type: 'success',
        title: 'Pemetaan Berhasil Disimpan',
        desc: `Material ERP ${drawerSku.trim()} berhasil dipetakan ke KHS ${drawerKhsCode.trim()}.`,
        tag: 'PEMETAAN',
      })
      goBack()
      setDrawerKhsCode('')
      setDrawerSku('')
      setDrawerNote('')
    } catch (err) {
      const msg = err?.message || 'Gagal menyimpan pemetaan manual.'
      setImportError(msg)
      notify({
        type: 'error',
        title: 'Gagal Menyimpan Pemetaan',
        desc: msg,
        tag: 'PEMETAAN',
      })
    } finally {
      setDrawerManualSaving(false)
    }
  }

  return (
    <>
      {/* DRAWER: Impor Pemetaan CSV / Tambah Manual */}
      <PanelShell
        asPage
        onBack={goBack}
        title="Impor Pasangan Pemetaan SKU↔KHS (CSV)"
        subtitle="Tambahkan pasangan kode item KHS dan nomor material ERP (SKU) via berkas CSV atau secara manual."
        footer={
          drawerMode === 'manual' ? (
            <div className="flex items-center justify-between w-full">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => goBack()}
                disabled={drawerManualSaving}
              >
                Batal
              </Button>
              <Button
                type="button"
                variant="primary"
                size="sm"
                loading={drawerManualSaving}
                disabled={!drawerKhsCode.trim() || !drawerSku.trim()}
                onClick={handleSaveDrawerManual}
              >
                <IconCheck size={14} />
                <span>Simpan Pemetaan</span>
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between w-full">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => goBack()}
                disabled={dryRunLoading || applying}
              >
                Batal
              </Button>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant={dryRunResult ? 'secondary' : 'primary'}
                  size="sm"
                  loading={dryRunLoading}
                  disabled={!importFile || applying}
                  onClick={handleDryRunImport}
                >
                  <IconUpload size={14} />
                  <span>Uji Validasi (Dry Run)</span>
                </Button>
                {dryRunResult && dryRunResult.data?.accepted > 0 && dryRunResult.data?.rejected === 0 && (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    loading={applying}
                    onClick={handleCommitImport}
                  >
                    <IconCheck size={14} />
                    <span>Terapkan & Simpan Pemetaan ({dryRunResult.data.accepted} Baris)</span>
                  </Button>
                )}
              </div>
            </div>
          )
        }
      >
        <div className="space-y-5 text-xs">
          {/* Mode Switcher */}
          <div className="grid grid-cols-2 gap-2 p-1 rounded-xl bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700">
            <button
              type="button"
              onClick={() => {
                setDrawerMode('upload')
                setImportError('')
              }}
              className={`inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                drawerMode === 'upload'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <IconUpload size={14} />
              <span>Via Upload (CSV)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setDrawerMode('manual')
                setImportError('')
              }}
              className={`inline-flex items-center justify-center gap-2 py-2 px-3 rounded-lg text-xs font-semibold transition cursor-pointer ${
                drawerMode === 'manual'
                  ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <IconPlus size={14} />
              <span>Tambah Manual</span>
            </button>
          </div>

          {drawerMode === 'manual' ? (
            <form onSubmit={handleSaveDrawerManual} className="space-y-4">
              {importError && <Alert kind="error">{importError}</Alert>}
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Kode KHS <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={drawerKhsCode}
                  onChange={(e) => setDrawerKhsCode(e.target.value)}
                  placeholder="Contoh: KHS-KBL-01"
                  className="block w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Nomor Material ERP (SKU) <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={drawerSku}
                  onChange={(e) => setDrawerSku(e.target.value)}
                  placeholder="Contoh: 1002389"
                  className="block w-full px-3 py-2 text-xs font-mono rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Catatan Alasan Pemetaan (Opsional)
                </label>
                <input
                  type="text"
                  value={drawerNote}
                  onChange={(e) => setDrawerNote(e.target.value)}
                  placeholder="Catatan verifikasi spesifikasi..."
                  className="block w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                />
              </div>
            </form>
          ) : (
            <>
          {/* Format Guide Banner */}
          <div className="p-4 bg-blue-50/70 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-900/60 rounded-xl space-y-2.5">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-1">
                <h4 className="font-bold text-blue-900 dark:text-blue-200 text-xs">
                  Format Berkas CSV Pemetaan SKU↔KHS
                </h4>
                <p className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
                  Baris header wajib memuat kolom berikut:
                </p>
                <code className="inline-block px-2.5 py-1 bg-white dark:bg-slate-800 rounded-lg border border-blue-200 dark:border-blue-800 font-mono text-[11px] text-blue-700 dark:text-blue-300">
                  kode_khs,no_material,catatan
                </code>
              </div>
              <button
                type="button"
                onClick={() => {
                  downloadCsv('template_pemetaan_sku_khs.csv', KHS_MATERIAL_MAP_TEMPLATE)
                  notify({
                    type: 'info',
                    title: 'Templat CSV Diunduh',
                    desc: 'Berkas template_pemetaan_sku_khs.csv berhasil diunduh.',
                    tag: 'PEMETAAN',
                  })
                }}
                className="shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white dark:bg-slate-800 border border-blue-200 dark:border-blue-700 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-slate-700 font-semibold text-xs shadow-xs transition cursor-pointer"
              >
                <IconDownload size={14} />
                <span>Unduh Templat CSV</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-600 dark:text-slate-400 pt-1 border-t border-blue-200/50 dark:border-blue-900/40">
              Mendukung juga alias header <code className="font-mono">khs_code,material_no,note</code>. Satu kode KHS dapat dipetakan ke satu atau beberapa nomor material ERP.
            </p>
          </div>

          {importError && <Alert kind="error">{importError}</Alert>}

          {/* Styled File Upload Dropzone */}
          <form onSubmit={handleDryRunImport} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                Berkas CSV Pemetaan <span className="text-rose-500">*</span>
              </label>
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  setIsDragging(true)
                }}
                onDragLeave={() => setIsDragging(false)}
                onDrop={(e) => {
                  e.preventDefault()
                  setIsDragging(false)
                  const f = e.dataTransfer?.files?.[0]
                  if (f) {
                    setImportFile(f)
                    setDryRunResult(null)
                  }
                }}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition ${
                  isDragging
                    ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                    : importFile
                    ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20'
                    : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30'
                }`}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  required
                  accept=".csv,text/csv,text/plain"
                  onChange={(e) => {
                    setImportFile(e.target.files?.[0] || null)
                    setDryRunResult(null)
                  }}
                  className="sr-only"
                />
                <IconUpload
                  size={28}
                  className={`mx-auto mb-2 ${
                    importFile ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'
                  }`}
                />
                {importFile ? (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                      {importFile.name}
                    </p>
                    <p className="text-[11px] text-slate-500">
                      {(importFile.size / 1024).toFixed(1)} KB — Klik atau seret berkas untuk mengganti
                    </p>
                  </div>
                ) : (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                      Klik untuk memilih berkas CSV atau seret ke area ini
                    </p>
                    <p className="text-[11px] text-slate-400">
                      Format berkas .csv (maksimal 5 MB)
                    </p>
                  </div>
                )}
              </div>
            </div>
          </form>

          {/* Dry Run Result Preview */}
          {dryRunResult && (
            <div className="space-y-3 pt-4 border-t border-slate-200 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <span className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                  Hasil Validasi Pratinjau Pemetaan
                </span>
              </div>

              {/* Summary KPI Cards */}
              <div className="grid grid-cols-3 gap-3">
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
                  <span className="block text-[11px] font-semibold text-slate-500">Total Baris</span>
                  <span className="text-base font-bold font-mono text-slate-800 dark:text-slate-100">
                    {dryRunResult.data?.total ?? (dryRunResult.rows || []).length}
                  </span>
                </div>
                <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-center">
                  <span className="block text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                    Valid: {dryRunResult.data?.accepted || 0}
                  </span>
                  <span className="text-base font-bold font-mono text-emerald-700 dark:text-emerald-300">
                    {dryRunResult.data?.accepted || 0}
                  </span>
                </div>
                <div
                  className={`p-3 rounded-xl border text-center ${
                    dryRunResult.data?.rejected > 0
                      ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-800'
                      : 'bg-slate-50 dark:bg-slate-800/60 border-slate-200 dark:border-slate-700'
                  }`}
                >
                  <span
                    className={`block text-[11px] font-semibold ${
                      dryRunResult.data?.rejected > 0
                        ? 'text-rose-600 dark:text-rose-400'
                        : 'text-slate-500'
                    }`}
                  >
                    Galat: {dryRunResult.data?.rejected || 0}
                  </span>
                  <span
                    className={`text-base font-bold font-mono ${
                      dryRunResult.data?.rejected > 0
                        ? 'text-rose-700 dark:text-rose-300'
                        : 'text-slate-800 dark:text-slate-100'
                    }`}
                  >
                    {dryRunResult.data?.rejected || 0}
                  </span>
                </div>
              </div>

              <div className="max-h-72 overflow-y-auto border border-slate-200 dark:border-slate-800 rounded-xl">
                <table className="w-full text-left text-xs border-collapse">
                  <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0 border-b border-slate-200 dark:border-slate-700">
                    <tr className="font-semibold text-[11px] text-slate-600 dark:text-slate-300">
                      <th className="py-2 px-3">Baris</th>
                      <th className="py-2 px-3">Kode KHS</th>
                      <th className="py-2 px-3">Nomor Material (SKU)</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Keterangan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                    {(dryRunResult.rows || []).map((r, idx) => (
                      <tr key={idx} className={r.status === 'REJECTED' ? 'bg-rose-50/60 dark:bg-rose-950/30' : 'hover:bg-slate-50/60 dark:hover:bg-slate-800/40'}>
                        <td className="py-2 px-3">{r.row}</td>
                        <td className="py-2 px-3 font-bold">{r.khs_code}</td>
                        <td className="py-2 px-3">{r.material_no}</td>
                        <td className="py-2 px-3">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              r.status === 'OK'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                        <td className="py-2 px-3 text-[11px] font-sans text-rose-600 dark:text-rose-400">
                          {(r.errors || []).join('; ') || '-'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
            </>
          )}
        </div>
      </PanelShell>
    </>
  )
}
