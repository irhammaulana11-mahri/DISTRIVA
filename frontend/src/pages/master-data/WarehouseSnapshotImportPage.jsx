import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { warehousesApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { downloadCsv, STOCK_SNAPSHOT_TEMPLATE } from '../../utils/csvTemplates.js'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import { IconCheck, IconCheckCircle, IconDownload, IconUpload, IconAlertCircle, IconFileText } from '../../components/icons.jsx'

/** Halaman impor cuplikan stok sebuah gudang: pilih berkas CSV/XLSX, uji (dry run), lalu terapkan. Laci pada daftar gudang hanya pratinjau. */
export default function WarehouseSnapshotImportPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const goBack = () => navigate('/master-data/warehouses')
  const [selectedWarehouse, setSelectedWarehouse] = useState(null)
  const [loadError, setLoadError] = useState('')
  const snapshotFileInputRef = useRef(null)
  const [importFile, setImportFile] = useState(null)
  const [isDraggingSnapshot, setIsDraggingSnapshot] = useState(false)
  const [importAsOf, setImportAsOf] = useState(new Date().toISOString().slice(0, 10))
  const [importSourceRef, setImportSourceRef] = useState('')
  const [dryRunLoading, setDryRunLoading] = useState(false)
  const [dryRunResult, setDryRunResult] = useState(null)
  const [applying, setApplying] = useState(false)
  const [importError, setImportError] = useState('')


  useEffect(() => {
    warehousesApi.list().then((res) => {
      const w = (res?.data || []).find((x) => x.id === id)
      if (w) setSelectedWarehouse(w)
      else setLoadError('Gudang tidak ditemukan.')
    }).catch((e) => setLoadError(e?.message || 'Gagal memuat gudang.'))
  }, [id])

  // daftar SKU yang belum terpetakan dibuka dari halaman daftar gudang (laci baca-saja)
  const openUnmapped = (snapshotId) => navigate(`/master-data/warehouses?sku_belum_terpetakan=${snapshotId}&gudang=${encodeURIComponent(selectedWarehouse?.name || '')}`)

  const handleDryRunImport = async (e) => {
    e?.preventDefault?.()
    if (!importFile || !selectedWarehouse) return
    setDryRunLoading(true)
    setImportError('')
    try {
      const formData = new FormData()
      formData.append('file', importFile)
      formData.append('as_of', importAsOf)
      if (importSourceRef) formData.append('source_reference', importSourceRef)
      formData.append('dry_run', '1')

      const res = await warehousesApi.importSnapshot(selectedWarehouse.id, formData)
      setDryRunResult(res)
      notify({
        type: 'info',
        title: 'Validasi Cuplikan Stok Selesai',
        desc: `Pratinjau cuplikan stok gudang ${selectedWarehouse.name} siap ditinjau.`,
        tag: 'STOK',
      })
    } catch (err) {
      const msg = err?.message || 'Validasi dry run gagal.'
      setImportError(msg)
      notify({
        type: 'error',
        title: 'Gagal Validasi Cuplikan Stok',
        desc: msg,
        tag: 'STOK',
      })
    } finally {
      setDryRunLoading(false)
    }
  }

  // Handle Commit Snapshot Import
  const handleCommitImport = async () => {
    if (!importFile || !selectedWarehouse) return
    setApplying(true)
    setImportError('')
    try {
      const formData = new FormData()
      formData.append('file', importFile)
      formData.append('as_of', importAsOf)
      if (importSourceRef) formData.append('source_reference', importSourceRef)
      formData.append('dry_run', '0')

      const res = await warehousesApi.importSnapshot(selectedWarehouse.id, formData)
      notify({
        type: 'success',
        title: 'Cuplikan Stok Tersimpan',
        desc: `Cuplikan stok gudang ${selectedWarehouse.name} per ${importAsOf} berhasil diimpor (${res?.data?.total || 0} total SKU).`,
        tag: 'STOK',
      })
      goBack()
      setImportFile(null)
      setDryRunResult(null)
    } catch (err) {
      const msg = err?.message || 'Gagal menyimpan cuplikan stok ke database.'
      setImportError(msg)
      notify({
        type: 'error',
        title: 'Gagal Menyimpan Cuplikan Stok',
        desc: msg,
        tag: 'STOK',
      })
    } finally {
      setApplying(false)
    }
  }


  if (loadError) return <Alert kind="error">{loadError}</Alert>
  if (!selectedWarehouse) return <div className="p-8 text-center"><Spinner /></div>
  return (
    <>
        <PanelShell
          asPage
          onBack={goBack}
          title={`Impor Cuplikan Stok: ${selectedWarehouse.name}`}
          subtitle="Unggah berkas CSV cuplikan stok fisik harian atau berkas .xlsx Monitoring Stock ERP."
          footer={
            <div className="flex items-center justify-between w-full">
              <Button
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
                {dryRunResult && (
                  <Button
                    variant="primary"
                    size="sm"
                    loading={applying}
                    onClick={handleCommitImport}
                  >
                    <IconCheck size={14} />
                    <span>Terapkan & Simpan Cuplikan ({dryRunResult.data?.accepted || dryRunResult.data?.total || dryRunResult.rows?.length || 0} Baris)</span>
                  </Button>
                )}
              </div>
            </div>
          }
        >
          <div className="space-y-4 text-xs">
            {/* Guide Card */}
            <div className="p-3.5 rounded-xl border border-blue-200 dark:border-blue-900 bg-blue-50/60 dark:bg-blue-950/40 flex items-start justify-between gap-3">
              <div>
                <p className="font-bold text-blue-900 dark:text-blue-300">
                  Format Berkas CSV atau .xlsx Monitoring Stock ERP
                </p>
                <p className="text-[11px] text-blue-800 dark:text-blue-400 mt-0.5 leading-relaxed">
                  Menerima CSV (<code className="font-mono">kode_khs,stok,reservasi,pasokan_masuk,stok_pengaman</code>) atau berkas Excel <code className="font-mono">.xlsx</code> resmi dari aplikasi Monitoring Stock ERP.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  downloadCsv('templat-cuplikan-stok.csv', STOCK_SNAPSHOT_TEMPLATE)
                  notify({
                    type: 'info',
                    title: 'Templat CSV Diunduh',
                    desc: 'Berkas templat-cuplikan-stok.csv berhasil diunduh.',
                    tag: 'STOK',
                  })
                }}
                className="shrink-0 px-3 py-1.5 text-xs font-semibold rounded-lg bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-700 text-blue-700 dark:text-blue-300 hover:bg-blue-50 inline-flex items-center gap-1.5 shadow-xs cursor-pointer"
              >
                <IconDownload size={13} />
                <span>Unduh Templat CSV</span>
              </button>
            </div>

            {importError && <Alert kind="error">{importError}</Alert>}

            <form onSubmit={handleDryRunImport} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Tanggal Cuplikan (as_of) <span className="text-rose-500">*</span>
                  </label>
                  <input
                    type="date"
                    required
                    max={new Date().toISOString().slice(0, 10)}
                    value={importAsOf}
                    onChange={(e) => setImportAsOf(e.target.value)}
                    className="block w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
                  />
                </div>
                <div>
                  <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                    Referensi Sumber (Opsional)
                  </label>
                  <input
                    type="text"
                    value={importSourceRef}
                    onChange={(e) => setImportSourceRef(e.target.value)}
                    placeholder="Contoh: SAP ERP Monitoring Stock 07-Nov"
                    className="block w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus-ring"
                  />
                </div>
              </div>

              <div>
                <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Berkas Cuplikan (.csv, .xlsx) <span className="text-rose-500">*</span>
                </label>
                <div
                  onDragOver={(e) => {
                    e.preventDefault()
                    setIsDraggingSnapshot(true)
                  }}
                  onDragLeave={() => setIsDraggingSnapshot(false)}
                  onDrop={(e) => {
                    e.preventDefault()
                    setIsDraggingSnapshot(false)
                    const f = e.dataTransfer?.files?.[0]
                    if (f) {
                      setImportFile(f)
                      setDryRunResult(null)
                    }
                  }}
                  onClick={() => snapshotFileInputRef.current?.click()}
                  className={`border-2 border-dashed rounded-xl p-5 text-center cursor-pointer transition ${
                    isDraggingSnapshot
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-950/30'
                      : importFile
                      ? 'border-emerald-400 dark:border-emerald-600 bg-emerald-50/40 dark:bg-emerald-950/20'
                      : 'border-slate-300 dark:border-slate-700 hover:border-slate-400 dark:hover:border-slate-600 bg-slate-50/50 dark:bg-slate-800/30'
                  }`}
                >
                  <input
                    ref={snapshotFileInputRef}
                    type="file"
                    required
                    accept=".csv,.txt,.xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
                    onChange={(e) => {
                      setImportFile(e.target.files?.[0] || null)
                      setDryRunResult(null)
                    }}
                    className="sr-only"
                  />
                  <IconUpload
                    size={26}
                    className={`mx-auto mb-1.5 ${
                      importFile ? 'text-emerald-500' : 'text-slate-400 dark:text-slate-500'
                    }`}
                  />
                  {importFile ? (
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold text-emerald-700 dark:text-emerald-400">
                        {importFile.name}
                      </p>
                      <p className="text-[11px] text-slate-500">
                        {(importFile.size / 1024).toFixed(1)} KB — Klik atau seret untuk mengganti berkas
                      </p>
                    </div>
                  ) : (
                    <div className="space-y-0.5">
                      <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Klik untuk memilih berkas .csv / .xlsx atau seret ke area ini
                      </p>
                      <p className="text-[11px] text-slate-400">
                        Mendukung berkas CSV standar atau Excel (.xlsx) Monitoring Stock ERP
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </form>

            {/* Dry Run Preview Summary & Table */}
            {dryRunResult && (
              <div className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-lg border flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="font-bold text-slate-800 dark:text-slate-200 block">
                      Ringkasan Validasi Cuplikan
                    </span>
                    <span className="text-[11px] text-slate-500">
                      Gudang: <strong>{dryRunResult.data?.warehouse_label || selectedWarehouse.name}</strong> · Tanggal: {importAsOf}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {dryRunResult.data?.accepted !== undefined && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        Valid: {dryRunResult.data.accepted}
                      </span>
                    )}
                    {dryRunResult.data?.rejected !== undefined && dryRunResult.data.rejected > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800">
                        Galat: {dryRunResult.data.rejected}
                      </span>
                    )}
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-blue-100 text-blue-800">
                      Total SKU: {dryRunResult.data?.total ?? dryRunResult.data?.accepted ?? dryRunResult.rows?.length ?? 0}
                    </span>
                    {dryRunResult.data?.mapped !== undefined && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                        Terpetakan: {dryRunResult.data.mapped}
                      </span>
                    )}
                    {dryRunResult.data?.unmapped !== undefined && dryRunResult.data.unmapped > 0 && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800">
                        Belum Terpetakan: {dryRunResult.data.unmapped}
                      </span>
                    )}
                    {dryRunResult.data?.khs_lines !== undefined && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800">
                        Baris KHS: {dryRunResult.data.khs_lines}
                      </span>
                    )}
                  </div>
                </div>

                {dryRunResult.data?.unmapped > 0 && dryRunResult.data?.snapshot_id && (
                  <div className="text-right">
                    <button
                      type="button"
                      onClick={() => openUnmapped(dryRunResult.data.snapshot_id)}
                      className="text-xs text-blue-600 font-semibold underline hover:text-blue-800"
                    >
                      Lihat Daftar SKU Belum Terpetakan →
                    </button>
                  </div>
                )}

                <div className="max-h-60 overflow-y-auto border rounded-lg">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead className="bg-slate-50 dark:bg-slate-800 sticky top-0">
                      <tr className="border-b font-semibold text-[10px] text-slate-600 dark:text-slate-400">
                        <th className="py-1.5 px-2.5">Baris</th>
                        <th className="py-1.5 px-2.5">Kode KHS / SKU</th>
                        <th className="py-1.5 px-2.5 text-right">Stok</th>
                        <th className="py-1.5 px-2.5">Status</th>
                        <th className="py-1.5 px-2.5">Keterangan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y font-mono text-[11px]">
                      {(dryRunResult.rows || []).map((r, idx) => (
                        <tr key={idx} className={r.status === 'REJECTED' ? 'bg-rose-50/60' : ''}>
                          <td className="py-1.5 px-2.5">{r.row ?? idx + 1}</td>
                          <td className="py-1.5 px-2.5 font-bold">{r.khs_code || r.material_no}</td>
                          <td className="py-1.5 px-2.5 text-right">{r.on_hand ?? r.stock_ready}</td>
                          <td className="py-1.5 px-2.5">
                            <span
                              className={`px-1.5 py-0.2 rounded text-[10px] font-bold ${
                                r.status === 'OK'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-rose-100 text-rose-800'
                              }`}
                            >
                              {r.status || 'OK'}
                            </span>
                          </td>
                          <td className="py-1.5 px-2.5 text-[10px] text-rose-600 font-sans">
                            {(r.errors || []).join('; ') || '-'}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        </PanelShell>
    </>
  )
}
