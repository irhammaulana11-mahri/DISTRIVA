import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { eisReportsApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { useScopedUnits } from '../../utils/unitScope.js'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import EisSyncDrawer from '../applications/EisSyncDrawer.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Drawer from '../../components/Drawer.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import { filterControlCls, filterSelectCls } from '../../components/filterStyles.js'
import {
  IconFileText,
  IconRefresh,
  IconUpload,
  IconLayers,
  IconCheckCircle,
  IconAlertCircle,
  IconEye,
  IconX,
  IconCalendar,
  IconBuilding,
  IconClock,
  IconFolder,
} from '../../components/icons.jsx'

const CARD = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs'

const FAMILY_LABELS = {
  309: '309 (Penjualan Tenaga Listrik)',
  '309EIS': '309EIS (Kontrol Penjualan 309)',
  DIFI: 'DIFI (SAIDI / SAIFI / ENS)',
  GGNALL: 'GGNALL (Rekap Gangguan & SLA)',
  GGNPERJENIS: 'GGNPERJENIS (Gangguan per Jenis)',
  GGNBERULANG: 'GGNBERULANG (Gangguan Berulang)',
  GGNNEGATIF: 'GGNNEGATIF (Rating Negatif Gangguan)',
  KLHALL: 'KLHALL (Rekap Keluhan & Durasi)',
  KLHBERULANG: 'KLHBERULANG (Keluhan Berulang)',
  KLHNEGATIF: 'KLHNEGATIF (Rating Negatif Keluhan)',
  PIUTANGLPB_EIS: 'PIUTANGLPB_EIS (Piutang & Golongan)',
  AKHIRBULAN_EIS: 'AKHIRBULAN_EIS (Rekening Akhir Bulan)',
  AKHIEPERIODE_EIS: 'AKHIEPERIODE_EIS (Rekening Akhir Periode)',
  TAGSUS: 'TAGSUS (Tagihan Susulan P2TL)',
  TAGSUS_BELUM: 'TAGSUS_BELUM (Tagihan Susulan Belum Realisasi - Potret per Tanggal Unduh)',
  UMURPIUTANG: 'UMURPIUTANG (Umur Tunggakan Pascabayar)',
  PRR: 'PRR (Pelunasan Piutang Ragu-Ragu)',
  EXPRR: 'EXPRR (Pelunasan Ex Piutang Ragu-Ragu)',
  DAFTAR_PRR: 'DAFTAR_PRR (Saldo Piutang Ragu-Ragu)',
  HAPUS_PRR: 'HAPUS_PRR (Penghapusan Piutang Ragu-Ragu)',
  BP_REKAP: 'BP_REKAP (Rekap Laporan Biaya Penyambungan)',
}

const MONTH_NAMES = [
  'Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun',
  'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des',
]

function fmtDate(v) {
  if (!v) return '-'
  const d = new Date(v)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function StatusBadge({ status }) {
  const isAktif = status === 'AKTIF' || status === 'BARU'
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold ${
        isAktif
          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-300'
          : 'bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-300'
      }`}
    >
      {status}
    </span>
  )
}

function SourceBadge({ source }) {
  const s = String(source || '').toUpperCase()
  if (s === 'AP2T') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300">
        AP2T
      </span>
    )
  }
  if (s === 'APKT') {
    return (
      <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300">
        APKT
      </span>
    )
  }
  return (
    <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-bold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
      EIS
    </span>
  )
}

/** Modal untuk mengunggah satu atau banyak berkas laporan EIS bulanan (nama bebas, ZIP, folder, pengiriman bertahap) */
function UploadModal({ isOpen, onClose, onUploaded }) {
  const { notify } = useNotifications()
  const unitInfo = useScopedUnits('eis_reports.import')
  const [files, setFiles] = useState([])
  const [selectedUnitId, setSelectedUnitId] = useState('')
  const [selectedPeriod, setSelectedPeriod] = useState('')
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(null) // { current, total, percent, message }
  const [results, setResults] = useState(null)
  const [error, setError] = useState('')

  const fileInputRef = useRef(null)
  const folderInputRef = useRef(null)

  const handleFileChange = (e) => {
    const chosen = Array.from(e.target.files || [])
    if (chosen.length > 0) {
      setFiles((prev) => [...prev, ...chosen])
      setResults(null)
      setError('')
    }
    e.target.value = ''
  }

  const handleClearFiles = () => {
    setFiles([])
    setResults(null)
    setError('')
    setProgress(null)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (files.length === 0) {
      setError('Pilih minimal satu berkas laporan.')
      return
    }

    setUploading(true)
    setError('')
    setProgress(null)

    // Kirim berkas lepas paling banyak 20 per permintaan (batas PHP max_file_uploads, kelebihan dibuang diam-diam)
    const CHUNK_SIZE = 20
    const chunks = []
    for (let i = 0; i < files.length; i += CHUNK_SIZE) {
      chunks.push(files.slice(i, i + CHUNK_SIZE))
    }

    let allResults = []
    let anySuccess = false
    let lastErrorMsg = ''

    for (let i = 0; i < chunks.length; i++) {
      const currentBatch = i + 1
      const totalBatches = chunks.length
      const batchFiles = chunks[i]
      setProgress({
        current: currentBatch,
        total: totalBatches,
        percent: Math.round((currentBatch / totalBatches) * 100),
        message: totalBatches > 1
          ? `Mengunggah kumpulan ${currentBatch} dari ${totalBatches} (${batchFiles.length} berkas)...`
          : `Mengunggah ${batchFiles.length} berkas...`,
      })

      const fd = new FormData()
      batchFiles.forEach((f) => fd.append('files[]', f))
      if (selectedPeriod) fd.append('period', selectedPeriod)
      if (selectedUnitId) fd.append('unit_id', selectedUnitId)

      try {
        const res = await eisReportsApi.importFiles(fd)
        if (res?.data) {
          allResults = allResults.concat(res.data)
          anySuccess = true
        }
      } catch (err) {
        lastErrorMsg = err?.message || 'Gagal mengunggah berkas laporan EIS.'
        if (err?.data?.data) {
          allResults = allResults.concat(err.data.data)
        } else {
          batchFiles.forEach((f) => {
            allResults.push({
              name: f.name,
              ok: false,
              message: err?.message || 'Gagal diproses oleh server.',
            })
          })
        }
      }
    }

    setResults(allResults)
    setUploading(false)
    setProgress(null)

    const successCount = allResults.filter((r) => r.ok).length
    const failCount = allResults.filter((r) => !r.ok).length

    if (anySuccess) {
      notify({
        type: 'success',
        title: 'Impor Selesai',
        desc: `Selesai memproses ${allResults.length} berkas (${successCount} berhasil${failCount > 0 ? `, ${failCount} gagal` : ''}).`,
        tag: 'EIS_REPORT',
      })
      onUploaded?.()
    } else if (lastErrorMsg) {
      setError(lastErrorMsg)
    }
  }

  if (!isOpen) return null

  const ulpUnits = unitInfo?.ulp_units || []
  const up3Units = unitInfo?.up3_units || []

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-xs">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
        <div className="px-5 py-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="p-2 bg-blue-50 dark:bg-blue-950/50 text-blue-600 rounded-xl">
              <IconUpload size={20} />
            </span>
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Unggah Laporan APKT / EIS / AP2T
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Nama berkas bebas (dikenali otomatis dari isi), mendukung Excel, ZIP, dan Folder.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-1 rounded-lg cursor-pointer"
            aria-label="Tutup"
          >
            <IconX size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 overflow-y-auto space-y-4">
          <div className="p-3.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
            <p className="font-semibold text-slate-800 dark:text-slate-200">Petunjuk Unggah &amp; Format Berkas:</p>
            <ul className="list-disc pl-4 space-y-1">
              <li>
                <strong>Nama berkas bebas:</strong> Unduhan resmi EIS/AP2T apa adanya (seperti <span className="font-mono">Rekap.xls</span>, <span className="font-mono">Rekap (1).xls</span>) otomatis dikenali jenis, unit, dan bulannya dari isi dokumen.
              </li>
              <li>
                Format lama berpola <span className="font-mono font-semibold">JENIS-KODEUNIT-BBTTTT.xls|xlsx</span> (contoh <span className="font-mono">309-51453-042026.xls</span>) tetap didukung penuh.
              </li>
              <li>
                <strong>Arsip ZIP &amp; Folder:</strong> Mendukung berkas <span className="font-mono font-semibold">.zip</span> atau pilih folder langsung. Contoh susunan folder ZIP satu UP3: <span className="font-mono font-semibold">JOMBANG/2026-10/Rekap.xls</span> (nama folder dibaca otomatis sebagai unit dan bulan).
              </li>
              <li>
                Mendukung jenis: <span className="font-mono">309, 309EIS, DIFI, GGNALL, KLHALL, PIUTANGLPB_EIS, AKHIRBULAN_EIS, AKHIEPERIODE_EIS, TAGSUS, TAGSUS_BELUM, UMURPIUTANG</span>.
              </li>
            </ul>
          </div>

          {/* Tombol Pemilihan Berkas & Folder */}
          <div className="space-y-2">
            <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Pilih Berkas atau Folder Laporan
            </label>
            <div className="flex flex-wrap gap-2.5">
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={IconFileText}
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
              >
                Pilih Berkas (.xls, .xlsx, .zip)
              </Button>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                icon={IconFolder}
                onClick={() => folderInputRef.current?.click()}
                disabled={uploading}
              >
                Pilih Folder (Banyak Berkas)
              </Button>
              {files.length > 0 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClearFiles}
                  disabled={uploading}
                >
                  Kosongkan ({files.length})
                </Button>
              )}
            </div>

            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept=".xls,.xlsx,.zip"
              onChange={handleFileChange}
              disabled={uploading}
              className="hidden"
              aria-label="Pilih Berkas"
            />
            <input
              ref={folderInputRef}
              type="file"
              webkitdirectory=""
              directory=""
              multiple
              onChange={handleFileChange}
              disabled={uploading}
              className="hidden"
              aria-label="Pilih Folder"
            />

            {files.length > 0 ? (
              <div className="p-2.5 bg-blue-50/60 dark:bg-blue-950/30 rounded-xl border border-blue-100 dark:border-blue-900/40 text-xs text-blue-900 dark:text-blue-300 flex items-center justify-between">
                <div>
                  <strong>{files.length} berkas</strong> siap diunggah.
                  {files.length > 20 && (
                    <span className="block text-[11px] text-blue-700 dark:text-blue-400 mt-0.5">
                      Berkas akan dikirim bertahap dalam {Math.ceil(files.length / 20)} kali pengiriman (@ maks 20 berkas per permintaan sesuai batas server PHP).
                    </span>
                  )}
                </div>
              </div>
            ) : (
              <p className="text-[11px] text-slate-400">
                Belum ada berkas yang dipilih. Anda dapat memilih beberapa berkas Excel/ZIP atau seluruh folder sekaligus.
              </p>
            )}
          </div>

          {/* Opsi Opsional: Bulan dan Unit */}
          <div className="p-3 bg-slate-50/70 dark:bg-slate-800/30 rounded-xl border border-slate-200 dark:border-slate-800 space-y-2">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Pilihan Opsional (Pelengkap Berkas Tanpa Info)
              </span>
              <span className="text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 px-1.5 py-0.2 rounded font-medium">
                Opsional
              </span>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed">
              Hanya dipakai untuk laporan yang tidak menyebut bulan/unit di dalam isinya: <span className="font-mono">309EIS, AKHIEPERIODE_EIS, PIUTANGLPB_EIS</span> (tidak menyebut bulan) dan <span className="font-mono">UMURPIUTANG</span> (tidak menyebut unit).
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Bulan Laporan (Opsional)
                </label>
                <input
                  type="month"
                  value={selectedPeriod}
                  onChange={(e) => setSelectedPeriod(e.target.value)}
                  disabled={uploading}
                  aria-label="Pilihan bulan opsional"
                  className={`${filterControlCls} w-full`}
                />
              </div>
              <div>
                <label className="block text-[11px] font-semibold text-slate-600 dark:text-slate-400 mb-1">
                  Unit ULP / UP3 (Opsional)
                </label>
                <select
                  value={selectedUnitId}
                  onChange={(e) => setSelectedUnitId(e.target.value)}
                  disabled={uploading}
                  aria-label="Pilihan unit opsional"
                  className={`${filterSelectCls} w-full`}
                >
                  <option value="">Otomatis (dari isi berkas / folder ZIP)</option>
                  {up3Units.length > 0 && (
                    <optgroup label="UP3">
                      {up3Units.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code ? `${u.code} - ${u.name}` : u.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                  {ulpUnits.length > 0 && (
                    <optgroup label="ULP">
                      {ulpUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.code ? `${u.code} - ${u.name}` : u.name}
                        </option>
                      ))}
                    </optgroup>
                  )}
                </select>
              </div>
            </div>
          </div>

          {/* Indikator Kemajuan Upload Bertahap */}
          {progress && (
            <div className="p-3 bg-blue-50 dark:bg-blue-950/40 rounded-xl border border-blue-200 dark:border-blue-900/50 space-y-1.5">
              <div className="flex justify-between text-xs font-semibold text-blue-900 dark:text-blue-200">
                <span>{progress.message}</span>
                <span>{progress.percent}%</span>
              </div>
              <div className="w-full bg-blue-200 dark:bg-blue-900/60 rounded-full h-2 overflow-hidden">
                <div
                  className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                  style={{ width: `${progress.percent}%` }}
                />
              </div>
            </div>
          )}

          {error && <Alert kind="error">{error}</Alert>}

          {results && results.length > 0 && (
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">
                  Hasil Pemrosesan Berkas ({results.length})
                </h3>
                <span className="text-[11px] text-slate-500">
                  {results.filter((r) => r.ok).length} Berhasil · {results.filter((r) => !r.ok).length} Gagal
                </span>
              </div>
              <div className="max-h-60 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2 px-3">Nama Berkas</th>
                      <th className="py-2 px-3">Status</th>
                      <th className="py-2 px-3">Jenis / Unit / Bulan</th>
                      <th className="py-2 px-3">Keterangan / Galat</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {results.map((r, i) => (
                      <tr key={i} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-mono text-[11px] text-slate-800 dark:text-slate-200 max-w-xs break-all">
                          {r.name?.includes(' › ') ? (
                            <div>
                              <span className="text-slate-400 text-[10px] block font-sans">{r.name.split(' › ')[0]} ›</span>
                              <span className="font-semibold text-slate-700 dark:text-slate-300">{r.name.split(' › ')[1]}</span>
                            </div>
                          ) : (
                            r.name
                          )}
                        </td>
                        <td className="py-2 px-3">
                          <StatusBadge status={r.ok ? r.status : 'GAGAL'} />
                        </td>
                        <td className="py-2 px-3 text-[11px] text-slate-600 dark:text-slate-400">
                          {r.ok ? (
                            <div>
                              <span className="font-semibold text-slate-800 dark:text-slate-200">{r.family}</span>
                              {r.unit && <span className="text-slate-500"> · {r.unit}</span>}
                              {r.period && <span className="font-mono text-slate-500"> · {r.period}</span>}
                              {r.lines ? <span className="text-slate-400"> · {r.lines} baris</span> : ''}
                            </div>
                          ) : (
                            <span className="text-slate-400">-</span>
                          )}
                        </td>
                        <td className="py-2 px-3 text-[11px]">
                          {r.ok ? (
                            r.warnings && r.warnings.length > 0 ? (
                              <span className="text-amber-600 dark:text-amber-400">Peringatan: {r.warnings.join(', ')}</span>
                            ) : (
                              <span className="text-emerald-600 dark:text-emerald-400">Berhasil diproses</span>
                            )
                          ) : (
                            <span className="text-rose-600 dark:text-rose-400">{r.message || 'Gagal diproses'}</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="pt-3 border-t border-slate-200 dark:border-slate-800 flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={onClose} disabled={uploading}>
              Tutup
            </Button>
            <Button type="submit" variant="primary" loading={uploading} disabled={files.length === 0}>
              {uploading ? (progress?.message || 'Mengunggah...') : `Unggah Sekarang (${files.length})`}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

/** Drawer Pratinjau Isi Berkas Laporan EIS */
function FileLinesDrawer({ fileId, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', file: null, lines: [] })

  useEffect(() => {
    if (!fileId) return
    let active = true
    setState({ loading: true, error: '', file: null, lines: [] })

    eisReportsApi
      .lines(fileId)
      .then((res) => {
        if (!active) return
        setState({
          loading: false,
          error: '',
          file: res?.data?.file || null,
          lines: res?.data?.lines || [],
        })
      })
      .catch((err) => {
        if (!active) return
        setState({
          loading: false,
          error: err?.message || 'Gagal memuat isi laporan.',
          file: null,
          lines: [],
        })
      })

    return () => {
      active = false
    }
  }, [fileId])

  return (
    <Drawer
      isOpen={Boolean(fileId)}
      onClose={onClose}
      title={state.file ? `Isi Laporan ${state.file.original_name}` : 'Rincian Berkas Laporan'}
      size="xl"
    >
      {state.loading && (
        <div className="py-20 flex justify-center">
          <Spinner size="lg" label="Memuat baris laporan..." />
        </div>
      )}

      {state.error && <Alert kind="error">{state.error}</Alert>}

      {!state.loading && state.file && (
        <div className="space-y-5 text-xs">
          {/* Header Metadata Berkas */}
          <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 flex flex-wrap items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  {state.file.family}
                </span>
                <StatusBadge status={state.file.status} />
              </div>
              <p className="text-slate-600 dark:text-slate-400">
                Unit: <span className="font-semibold">{state.file.unit_name}</span> · Periode:{' '}
                <span className="font-mono font-semibold">{state.file.period}</span>
              </p>
            </div>
            <span className="text-[11px] font-mono text-slate-400">
              {state.lines.length} baris data
            </span>
          </div>

          {/* DIFI Summary Header jika ada */}
          {state.file.summary && (
            <div className="p-4 bg-blue-50/50 dark:bg-blue-950/20 rounded-2xl border border-blue-100 dark:border-blue-900/40 space-y-2">
              <h4 className="font-bold text-blue-900 dark:text-blue-300">Ringkasan DIFI (Kepala Laporan)</h4>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                {Object.entries(state.file.summary).map(([k, v]) => (
                  <div key={k} className="p-2 bg-white dark:bg-slate-900 rounded-lg border border-blue-100 dark:border-blue-900/30">
                    <dt className="text-[10px] text-slate-500 uppercase">{k}</dt>
                    <dd className="font-mono font-bold text-slate-800 dark:text-slate-200">{String(v)}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}

          {/* Tabel Baris Laporan */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <div className="max-h-[60vh] overflow-y-auto">
              <table className="w-full text-left text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 backdrop-blur-xs text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-2 px-3 w-12 text-center">#</th>
                    <th className="py-2 px-3">Uraian / Golongan / Tarif</th>
                    <th className="py-2 px-3">Nilai Data</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                  {state.lines.map((l, idx) => (
                    <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3 text-center text-slate-400">{l.line_no}</td>
                      <td className="py-2 px-3 font-sans">
                        <div className="font-semibold text-slate-800 dark:text-slate-200">
                          {l.label || l.code || '-'}
                        </div>
                        {l.group_label && (
                          <div className="text-[10px] text-slate-500">{l.group_label}</div>
                        )}
                      </td>
                      <td className="py-2 px-3">
                        {l.values && typeof l.values === 'object' ? (
                          <div className="flex flex-wrap gap-2 text-[10px]">
                            {Object.entries(l.values).map(([vk, vv]) => (
                              <span key={vk} className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700">
                                <span className="text-slate-500">{vk}:</span>{' '}
                                <span className="font-bold text-slate-800 dark:text-slate-200">{String(vv)}</span>
                              </span>
                            ))}
                          </div>
                        ) : (
                          String(l.values || '-')
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  )
}

/** Tampilan Matriks Kelengkapan untuk Seluruh ULP di Bawah Satu UP3 */
function Up3CoverageView({ data, onSelectUlp, onTriggerSync }) {
  const [viewMode, setViewMode] = useState('summary') // 'summary' | 'matrix'
  const [filterDataset, setFilterDataset] = useState('')

  const expectedUntil = data.expected_until_month || 0
  const expectedMonthName = expectedUntil > 0 ? MONTH_NAMES[expectedUntil - 1] : '-'
  const pctComplete = data.expected_total > 0
    ? Math.round(((data.expected_total - data.missing_total) / data.expected_total) * 100)
    : 100

  // Daftar dataset aktif (docs/88 & Butir 31)
  const datasetsList = useMemo(() => {
    if (data.datasets_list && data.datasets_list.length > 0) {
      return data.datasets_list
    }
    // Fallback bila backend versi lama
    return (data.families_list || Object.keys(FAMILY_LABELS)).map((f) => ({
      code: f === '309EIS' ? 'EIS.KONTROL_309' : f,
      name: FAMILY_LABELS[f] || f,
      source: f === 'DIFI' || f.startsWith('GGN') || f.startsWith('KLH') ? 'APKT' : f === '309' || f === 'TAGSUS' || f === 'TAGSUS_BELUM' ? 'AP2T' : 'EIS',
      storage: 'file',
      used_by: f === '309EIS' ? ['kwh-jual', 'pendapatan', 'kwh-p2tl'] : [],
    }))
  }, [data])

  const filteredDatasets = filterDataset
    ? datasetsList.filter((d) => d.code === filterDataset)
    : datasetsList

  const datasetMap = useMemo(() => {
    const map = {}
    datasetsList.forEach((d) => {
      map[d.code] = d
    })
    return map
  }, [datasetsList])

  return (
    <div className="space-y-5">
      {/* Header & KPI Summary */}
      <div className="p-4 sm:p-5 rounded-2xl bg-linear-to-r from-blue-50/50 via-indigo-50/30 to-white dark:from-slate-800/60 dark:via-slate-800/40 dark:to-slate-900 border border-blue-100 dark:border-slate-800 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100">
                Kelengkapan Laporan Semua ULP — {data.up3_name}
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300">
                Tahun {data.year}
              </span>
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Kelengkapan {datasetsList.length} dataset aktif (AP2T, APKT, EIS) dari seluruh ULP di bawah {data.up3_name}.
            </p>
          </div>

          <div className="flex items-center gap-1.5 bg-white dark:bg-slate-900 p-1 rounded-xl border border-slate-200 dark:border-slate-800 text-xs">
            <button
              type="button"
              onClick={() => setViewMode('summary')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                viewMode === 'summary'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Ringkasan per ULP
            </button>
            <button
              type="button"
              onClick={() => setViewMode('matrix')}
              className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                viewMode === 'matrix'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Matriks Rinci Semua ULP
            </button>
          </div>
        </div>

        {/* KPI Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className="p-3.5 bg-white dark:bg-slate-900/80 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
              Batas Bulan Diharapkan
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                s.d. Bulan {expectedMonthName} ({expectedUntil})
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Bulan setelahnya belum jatuh tempo &amp; tidak dihitung kurang.
            </p>
          </div>

          <div className="p-3.5 bg-white dark:bg-slate-900/80 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
              Laporan Masuk (Realisasi)
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className="text-xl font-bold text-slate-900 dark:text-slate-100 tabular-nums">
                {data.expected_total - data.missing_total} / {data.expected_total}
              </span>
              <span className="text-xs font-semibold text-emerald-600 dark:text-emerald-400">
                {pctComplete}%
              </span>
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              Dari 11 dataset aktif s.d. bulan berjalan
            </p>
          </div>

          <div className="p-3.5 bg-white dark:bg-slate-900/80 rounded-xl border border-slate-200 dark:border-slate-800">
            <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 block">
              Laporan Belum Masuk
            </span>
            <div className="mt-1 flex items-baseline gap-2">
              <span className={`text-xl font-bold tabular-nums ${
                data.missing_total === 0
                  ? 'text-emerald-600 dark:text-emerald-400'
                  : 'text-rose-600 dark:text-rose-400'
              }`}>
                {data.missing_total} berkas
              </span>
              {data.missing_total === 0 ? (
                <span className="text-xs font-semibold text-emerald-600">Lengkap</span>
              ) : (
                <span className="text-xs font-semibold text-rose-600">Perlu Diunggah / Ditarik</span>
              )}
            </div>
            <p className="text-[10px] text-slate-400 mt-1">
              {data.missing_total === 0
                ? 'Seluruh ULP telah memenuhi berkas laporan.'
                : 'Laporan/data yang perlu diunggah atau ditarik via sinkronisasi.'}
            </p>
          </div>
        </div>
      </div>

      {/* Mode 1: Ringkasan per ULP */}
      {viewMode === 'summary' && (
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
              <tr>
                <th className="py-2.5 px-4 w-48">Unit ULP</th>
                <th className="py-2.5 px-3 w-36">Status</th>
                <th className="py-2.5 px-4">Dataset Belum Masuk (Missing)</th>
                <th className="py-2.5 px-3 text-right w-36">Aksi</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.units.map((u) => {
                const isComplete = u.missing_count === 0
                return (
                  <tr key={u.unit_id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="py-3 px-4">
                      <div className="font-semibold text-slate-900 dark:text-slate-100">
                        {u.unit_name}
                      </div>
                      <span className="font-mono text-[10px] text-slate-400">
                        Kode: {u.unit_code}
                      </span>
                    </td>
                    <td className="py-3 px-3">
                      {isComplete ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          <IconCheckCircle size={12} />
                          Lengkap
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-800">
                          <IconAlertCircle size={12} />
                          {u.missing_count} Kurang
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {isComplete ? (
                        <span className="text-emerald-600 dark:text-emerald-400 text-xs font-medium">
                          Seluruh dataset aktif s.d. bulan {expectedMonthName} lengkap.
                        </span>
                      ) : (
                        <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                          {u.missing.map((m, idx) => {
                            const datasetCode = m.dataset || m.family
                            const meta = datasetMap[datasetCode]
                            const displayName = meta ? meta.name : datasetCode
                            const source = meta?.source || (datasetCode.startsWith('APKT') ? 'APKT' : datasetCode.startsWith('AP2T') ? 'AP2T' : 'EIS')
                            return (
                              <span
                                key={idx}
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[10px] font-medium bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300 border border-rose-200 dark:border-rose-800/60 font-mono"
                                title={`Belum ada data ${displayName} untuk bulan ${MONTH_NAMES[m.month - 1]}`}
                              >
                                <SourceBadge source={source} />
                                <span>{displayName} ({MONTH_NAMES[m.month - 1]})</span>
                              </span>
                            )
                          })}
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-3 text-right">
                      <Button
                        variant="secondary"
                        size="xs"
                        onClick={() => onSelectUlp(u.unit_id)}
                      >
                        Matriks ULP &rarr;
                      </Button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Mode 2: Matriks Rinci Lengkap Semua ULP */}
      {viewMode === 'matrix' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <span className="text-xs font-semibold text-slate-700 dark:text-slate-300">
              Matriks Baris ULP &times; Dataset per Bulan (Jan–Des)
            </span>
            <div className="flex items-center gap-2">
              <label className="text-xs text-slate-500">Filter Dataset:</label>
              <select
                value={filterDataset}
                onChange={(e) => setFilterDataset(e.target.value)}
                className={`${filterSelectCls} text-xs`}
              >
                <option value="">Semua Dataset Aktif ({datasetsList.length})</option>
                {datasetsList.map((d) => (
                  <option key={d.code} value={d.code}>
                    [{d.source}] {d.name} ({d.code})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 max-h-[70vh]">
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 backdrop-blur-xs text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 z-10">
                <tr>
                  <th className="py-2.5 px-3 w-40">ULP</th>
                  <th className="py-2.5 px-3 w-56">Dataset &amp; Sumber</th>
                  {MONTH_NAMES.map((m, idx) => (
                    <th key={idx} className="py-2.5 px-1.5 text-center w-10">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.units.map((u) => {
                  return filteredDatasets.map((d, fIdx) => {
                    const rowMonths = u.datasets?.[d.code] || (d.family && u.families?.[d.family]) || {}
                    const isApkt = d.source === 'APKT'
                    const isAp2tTagsus = d.code === 'AP2T.TAGSUS' || d.code === 'AP2T.TAGSUS_BELUM_REALISASI'
                    const isAp2tPrr = d.code === 'AP2T.PELUNASAN_PRR' || d.code === 'AP2T.PELUNASAN_EX_PRR' || d.code === 'AP2T.SALDO_PRR' || d.code === 'AP2T.HAPUS_PRR' || d.code === 'AP2T.BP_REKAP'
                    const isEisKontrol309 = d.code === 'EIS.KONTROL_309' || d.family === '309EIS'
                    const usedByText = d.used_by && d.used_by.length > 0
                      ? `Dipakai menu: ${d.used_by.join(', ')}`
                      : 'Arsip / belum dipakai menu'

                    return (
                      <tr key={`${u.unit_id}-${d.code}`} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        {fIdx === 0 && (
                          <td
                            rowSpan={filteredDatasets.length}
                            className="py-2.5 px-3 font-semibold text-slate-900 dark:text-slate-100 align-top border-r border-slate-100 dark:border-slate-800 bg-slate-50/30 dark:bg-slate-900/30"
                          >
                            <div>{u.unit_name}</div>
                            <span className="text-[10px] text-slate-400 font-mono">
                              Kode {u.unit_code}
                            </span>
                            <div className="mt-2">
                              {u.missing_count === 0 ? (
                                <span className="text-[10px] text-emerald-600 font-semibold">Lengkap</span>
                              ) : (
                                <span className="text-[10px] text-rose-600 font-semibold">{u.missing_count} kurang</span>
                              )}
                            </div>
                          </td>
                        )}
                        <td className="py-2 px-3 font-medium text-slate-700 dark:text-slate-300" title={usedByText}>
                          <div className="flex items-center gap-1.5">
                            <SourceBadge source={d.source} />
                            <span className="truncate max-w-[200px] font-semibold text-slate-800 dark:text-slate-200">
                              {d.name}
                            </span>
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-[10px] font-mono text-slate-400">
                              {d.code}
                            </span>
                            {d.code === 'AP2T.TAGSUS_BELUM_REALISASI' && (
                              <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400" title="Potret per tanggal unduh, bukan angka bulan penuh">
                                • Potret per tanggal unduh
                              </span>
                            )}
                            {d.used_by && d.used_by.length > 0 && (
                              <span className="text-[9px] text-slate-400 truncate max-w-[140px]" title={usedByText}>
                                • {d.used_by.join(', ')}
                              </span>
                            )}
                          </div>
                        </td>
                        {Array.from({ length: 12 }, (_, i) => i + 1).map((mNum) => {
                          const isPresent = Boolean(rowMonths[mNum])
                          const isExpected = mNum <= expectedUntil

                          return (
                            <td key={mNum} className="py-2 px-1 text-center">
                              {isPresent ? (
                                <span
                                  className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold text-[10px]"
                                  title={`Bulan ${mNum}: Lengkap / Aktif`}
                                >
                                  ✓
                                </span>
                              ) : isExpected ? (
                                isApkt ? (
                                  <button
                                    type="button"
                                    onClick={() => onTriggerSync?.('apkt', d.code)}
                                    className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-purple-100 hover:bg-purple-200 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 font-bold text-[10px] cursor-pointer"
                                    title={`Bulan ${mNum}: Belum ada data. Klik untuk tarik lewat tombol Tarik APKT`}
                                  >
                                    !
                                  </button>
                                ) : isAp2tTagsus || isAp2tPrr ? (
                                  <button
                                    type="button"
                                    onClick={() => onTriggerSync?.('ap2t', d.code)}
                                    className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 font-bold text-[10px] cursor-pointer"
                                    title={`Bulan ${mNum}: Belum ada data. Klik untuk tarik lewat tombol Tarik AP2T`}
                                  >
                                    !
                                  </button>
                                ) : isEisKontrol309 ? (
                                  <button
                                    type="button"
                                    onClick={() => onTriggerSync?.('kontrol309', d.code)}
                                    className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-blue-100 hover:bg-blue-200 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 font-bold text-[10px] cursor-pointer"
                                    title={`Bulan ${mNum}: Belum ada data. Klik untuk tarik lewat tombol Tarik Kontrol 309`}
                                  >
                                    !
                                  </button>
                                ) : (
                                  <span
                                    className="inline-flex items-center justify-center w-5 h-5 rounded-md bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 font-bold text-[10px]"
                                    title={`Bulan ${mNum}: Belum ada berkas (Unggah lewat tombol Unggah Laporan)`}
                                  >
                                    !
                                  </span>
                                )
                              ) : (
                                <span
                                  className="inline-block text-slate-300 dark:text-slate-600 text-[11px]"
                                  title={`Bulan ${mNum}: Belum jatuh tempo`}
                                >
                                  —
                                </span>
                              )}
                            </td>
                          )
                        })}
                      </tr>
                    )
                  })
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

/** Tampilan Matriks Kelengkapan untuk Satu ULP Spesifik */
function SingleUnitCoverageView({ data, expectedUntil = 12, onBackToUp3, onTriggerSync }) {
  const [showLegacy, setShowLegacy] = useState(false)

  // Daftar dataset aktif (docs/88 & Butir 31)
  const datasets = useMemo(() => {
    if (data.datasets && data.datasets.length > 0) {
      return data.datasets
    }
    // Fallback dari families jika API lama
    return Object.keys(FAMILY_LABELS).map((fam) => ({
      code: fam,
      name: FAMILY_LABELS[fam] || fam,
      source: fam === 'DIFI' || fam.startsWith('GGN') || fam.startsWith('KLH') ? 'APKT' : fam === '309' || fam === 'TAGSUS' || fam === 'TAGSUS_BELUM' ? 'AP2T' : 'EIS',
      storage: 'file',
      family: fam,
      used_by: [],
      months: data?.families?.[fam] || {},
    }))
  }, [data])

  const legacyFamilies = data?.legacy_families || []

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3 flex-wrap gap-2">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-slate-100">
            Matriks Kelengkapan Dataset Tahun {data.year}
          </h3>
          <p className="text-xs text-slate-500">
            Status keberadaan {datasets.length} dataset aktif (Januari - Desember) untuk unit terpilih.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {legacyFamilies.length > 0 && (
            <button
              type="button"
              onClick={() => setShowLegacy((v) => !v)}
              className="text-xs text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 underline cursor-pointer"
            >
              {showLegacy ? 'Sembunyikan Jenis Lama' : `Lihat Arsip (${legacyFamilies.length} Jenis Lama)`}
            </button>
          )}
          {onBackToUp3 && (
            <Button variant="secondary" size="xs" onClick={onBackToUp3}>
              &larr; Kembali ke Ringkasan UP3
            </Button>
          )}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
            <tr>
              <th className="py-2.5 px-3">Dataset &amp; Sumber</th>
              {MONTH_NAMES.map((m, idx) => (
                <th key={idx} className="py-2.5 px-2 text-center w-12">{m}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {datasets.map((d) => {
              const rowMonths = d.months || {}
              const isApkt = d.source === 'APKT'
              const isAp2tTagsus = d.code === 'AP2T.TAGSUS' || d.code === 'AP2T.TAGSUS_BELUM_REALISASI'
              const isAp2tPrr = d.code === 'AP2T.PELUNASAN_PRR' || d.code === 'AP2T.PELUNASAN_EX_PRR' || d.code === 'AP2T.SALDO_PRR' || d.code === 'AP2T.HAPUS_PRR' || d.code === 'AP2T.BP_REKAP'
              const isEisKontrol309 = d.code === 'EIS.KONTROL_309' || d.family === '309EIS'
              const usedByText = d.used_by && d.used_by.length > 0
                ? `Dipakai menu: ${d.used_by.join(', ')}`
                : 'Arsip / belum dipakai menu'

              return (
                <tr key={d.code} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                  <td className="py-2.5 px-3" title={usedByText}>
                    <div className="flex items-center gap-1.5">
                      <SourceBadge source={d.source} />
                      <span className="font-semibold text-slate-800 dark:text-slate-200">
                        {d.name}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[10px] font-mono text-slate-400">
                        {d.code}
                      </span>
                      {d.code === 'AP2T.TAGSUS_BELUM_REALISASI' && (
                        <span className="text-[9px] font-semibold text-amber-600 dark:text-amber-400" title="Potret per tanggal unduh, bukan angka bulan penuh">
                          • Potret per tanggal unduh
                        </span>
                      )}
                      {d.used_by && d.used_by.length > 0 && (
                        <span className="text-[10px] text-slate-400">
                          • {usedByText}
                        </span>
                      )}
                    </div>
                  </td>
                  {Array.from({ length: 12 }, (_, i) => i + 1).map((mNum) => {
                    const isPresent = Boolean(rowMonths[mNum])
                    const isExpected = mNum <= expectedUntil
                    return (
                      <td key={mNum} className="py-2.5 px-2 text-center">
                        {isPresent ? (
                          <span
                            className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 font-bold text-[10px]"
                            title={`Bulan ${mNum}: Lengkap / Aktif`}
                          >
                            ✓
                          </span>
                        ) : isExpected ? (
                          isApkt ? (
                            <button
                              type="button"
                              onClick={() => onTriggerSync?.('apkt', d.code)}
                              className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-purple-100 hover:bg-purple-200 text-purple-800 dark:bg-purple-950/80 dark:text-purple-300 font-bold text-[10px] cursor-pointer"
                              title={`Bulan ${mNum}: Belum ada data. Tarik lewat tombol Tarik APKT`}
                            >
                              !
                            </button>
                          ) : isAp2tTagsus || isAp2tPrr ? (
                            <button
                              type="button"
                              onClick={() => onTriggerSync?.('ap2t', d.code)}
                              className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-amber-100 hover:bg-amber-200 text-amber-800 dark:bg-amber-950/80 dark:text-amber-300 font-bold text-[10px] cursor-pointer"
                              title={`Bulan ${mNum}: Belum ada data. Tarik lewat tombol Tarik AP2T`}
                            >
                              !
                            </button>
                          ) : isEisKontrol309 ? (
                            <button
                              type="button"
                              onClick={() => onTriggerSync?.('kontrol309', d.code)}
                              className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-blue-100 hover:bg-blue-200 text-blue-800 dark:bg-blue-950/80 dark:text-blue-300 font-bold text-[10px] cursor-pointer"
                              title={`Bulan ${mNum}: Belum ada data. Tarik lewat tombol Tarik Kontrol 309`}
                            >
                              !
                            </button>
                          ) : (
                            <span
                              className="inline-flex items-center justify-center w-6 h-6 rounded-md bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 font-bold text-[10px]"
                              title={`Bulan ${mNum}: Belum ada berkas (Kurang)`}
                            >
                              !
                            </span>
                          )
                        ) : (
                          <span className="inline-block text-slate-300 dark:text-slate-600 text-[11px]" title="Belum jatuh tempo">
                            —
                          </span>
                        )}
                      </td>
                    )
                  })}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Bagian Arsip / Jenis Lama jika diaktifkan */}
      {showLegacy && legacyFamilies.length > 0 && (
        <div className="p-4 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Arsip Jenis Laporan EIS Lama (Tidak Dihitung Kurang)
              </h4>
              <p className="text-[11px] text-slate-500">
                Laporan-laporan berikut sudah digantikan oleh penarikan APKT langsung atau format baru. Berkas tetap dapat diunggah dan disimpan.
              </p>
            </div>
          </div>
          <div className="overflow-x-auto rounded-lg border border-slate-200 dark:border-slate-700">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-100 dark:bg-slate-700/60 text-[10px] text-slate-500 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2 px-3">Jenis Laporan Lama</th>
                  {MONTH_NAMES.map((m, idx) => (
                    <th key={idx} className="py-2 px-1 text-center w-10">{m}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {legacyFamilies.map((fam) => {
                  const rowMonths = data?.families?.[fam] || {}
                  return (
                    <tr key={fam} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                      <td className="py-1.5 px-3 font-mono text-[11px] text-slate-600 dark:text-slate-400">
                        {fam} <span className="font-sans text-[10px] text-slate-400">({FAMILY_LABELS[fam] || fam})</span>
                      </td>
                      {Array.from({ length: 12 }, (_, i) => i + 1).map((mNum) => (
                        <td key={mNum} className="py-1.5 px-1 text-center">
                          {rowMonths[mNum] ? (
                            <span className="text-slate-600 dark:text-slate-400 font-bold text-[10px]">✓</span>
                          ) : (
                            <span className="text-slate-300 dark:text-slate-600 text-[10px]">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}

export default function EisReportsPage({ embedded = false, selectedUp3Id = '' }) {
  const { can } = useAccess()
  const canImport = Boolean(can?.['eis_reports.import'])

  const [searchParams] = useSearchParams()
  const rawTab = searchParams.get('subtab') || searchParams.get('tab')
  const initialTab = rawTab === 'coverage' || rawTab === 'files' ? rawTab : 'files'
  const initialUp3Id = searchParams.get('up3_id') || ''
  const initialUnitId = searchParams.get('unit_id') || ''
  const initialYear = Number(searchParams.get('year')) || new Date().getFullYear()

  const [tab, setTab] = useState(initialTab)
  const [up3Id, setUp3Id] = useState(selectedUp3Id || initialUp3Id)
  const [unitId, setUnitId] = useState(initialUnitId)

  useEffect(() => {
    if (selectedUp3Id && selectedUp3Id !== up3Id) {
      setPage(1)
      setUp3Id(selectedUp3Id)
      setUnitId('')
    }
  }, [selectedUp3Id]) // eslint-disable-line react-hooks/exhaustive-deps
  const [family, setFamily] = useState('')
  const [fromMonth, setFromMonth] = useState('')
  const [toMonth, setToMonth] = useState('')
  const [status, setStatus] = useState('AKTIF')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)

  // Data state
  const [filesState, setFilesState] = useState({ loading: true, error: '', rows: [], meta: null, families: [] })
  const [covState, setCovState] = useState({ loading: false, error: '', data: null })
  const [covYear, setCovYear] = useState(initialYear)

  // Modal / Drawer state
  const [isUploadOpen, setIsUploadOpen] = useState(false)
  const [previewFileId, setPreviewFileId] = useState(null)
  const [syncDrawerState, setSyncDrawerState] = useState({ open: false, mode: 'apkt', dataset: 'saidi-saifi', reports: null })

  const handleTriggerSync = (mode, datasetCode) => {
    let dataset = 'saidi-saifi'
    let reports = null
    let targetMode = mode
    if (mode === 'kontrol309') {
      targetMode = 'piutang'
      reports = ['KONTROL309']
    } else if (datasetCode === 'AP2T.PELUNASAN_PRR') {
      targetMode = 'ap2t'
      reports = ['pelunasan_prr']
    } else if (datasetCode === 'AP2T.PELUNASAN_EX_PRR') {
      targetMode = 'ap2t'
      reports = ['pelunasan_ex_prr']
    } else if (datasetCode === 'AP2T.SALDO_PRR') {
      targetMode = 'ap2t'
      reports = ['saldo_prr']
    } else if (datasetCode === 'AP2T.HAPUS_PRR') {
      targetMode = 'ap2t'
      reports = ['hapus_prr']
    } else if (datasetCode === 'AP2T.BP_REKAP') {
      targetMode = 'ap2t'
      reports = ['bp']
    } else if (datasetCode === 'APKT.RPT_RCT_GANGGUAN') dataset = 'rpt-rct-gangguan'
    else if (datasetCode === 'APKT.RPT_RCT_KELUHAN') dataset = 'rpt-rct-keluhan'
    else if (datasetCode === 'APKT.ANOMALI_GANGGUAN') dataset = 'anomali-gangguan'
    else if (datasetCode === 'APKT.ANOMALI_KELUHAN') dataset = 'anomali-keluhan'
    setSyncDrawerState({ open: true, mode: targetMode, dataset, reports })
  }

  const loadFiles = useCallback(async () => {
    setFilesState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await eisReportsApi.list({
        up3_id: up3Id || undefined,
        unit_id: unitId || undefined,
        family: family || undefined,
        from: fromMonth || undefined,
        to: toMonth || undefined,
        status: status || undefined,
        page,
        per_page: perPage,
      })
      setFilesState({
        loading: false,
        error: '',
        rows: res?.data || [],
        meta: res?.meta || null,
        families: res?.families || Object.keys(FAMILY_LABELS),
      })
    } catch (err) {
      setFilesState((s) => ({
        ...s,
        loading: false,
        error: err?.message || 'Gagal memuat daftar berkas laporan EIS.',
      }))
    }
  }, [up3Id, unitId, family, fromMonth, toMonth, status, page, perPage])

  const loadCoverage = useCallback(async () => {
    const targetUnitId = unitId
    const targetUp3Id = !unitId ? up3Id : undefined
    if (!targetUnitId && !targetUp3Id) {
      setCovState({ loading: false, error: '', data: null })
      return
    }

    setCovState({ loading: true, error: '', data: null })
    try {
      const params = { year: covYear }
      if (targetUnitId) {
        params.unit_id = targetUnitId
      } else if (targetUp3Id) {
        params.up3_id = targetUp3Id
      }
      const res = await eisReportsApi.coverage(params)
      setCovState({ loading: false, error: '', data: res?.data || null })
    } catch (err) {
      setCovState({
        loading: false,
        error: err?.message || 'Gagal memuat matriks kelengkapan.',
        data: null,
      })
    }
  }, [unitId, up3Id, covYear])

  useEffect(() => {
    loadFiles()
  }, [loadFiles])

  useEffect(() => {
    if (tab === 'coverage') {
      loadCoverage()
    }
  }, [tab, loadCoverage])

  const stats = useMemo(() => {
    const total = filesState.meta?.total ?? filesState.rows.length
    const familiesSet = new Set(filesState.rows.map((r) => r.family))
    const unitsSet = new Set(filesState.rows.map((r) => r.unit_id))
    return {
      total,
      familiesCount: familiesSet.size,
      unitsCount: unitsSet.size,
      latestPeriod: filesState.rows[0]?.period || '-',
    }
  }, [filesState])

  return (
    <div className="space-y-6 w-full">
      {embedded ? (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-blue-50/70 dark:bg-blue-950/30 rounded-2xl border border-blue-200 dark:border-blue-900/60 shadow-xs">
          <div className="space-y-0.5">
            <div className="font-bold text-sm text-blue-950 dark:text-blue-100 flex items-center gap-2 flex-wrap">
              <span>Matriks Kelengkapan &amp; Upload Manual APKT/EIS/AP2T</span>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                Basis Data NKO &amp; Pengusahaan
              </span>
            </div>
            <p className="text-[11px] text-blue-700 dark:text-blue-300">
              Arsip dan normalisasi laporan bulanan EIS (309, DIFI, Gangguan, Keluhan, Piutang, TAGSUS) per ULP dan UP3.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <Button
              variant="secondary"
              size="sm"
              icon={IconRefresh}
              onClick={tab === 'files' ? loadFiles : loadCoverage}
              aria-label="Segarkan"
            >
              Segarkan
            </Button>
            {canImport && (
              <Button
                variant="primary"
                size="sm"
                icon={IconUpload}
                onClick={() => setIsUploadOpen(true)}
              >
                Unggah Laporan
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className={`${CARD} p-5 sm:p-6 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20`}>
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex items-start gap-3.5">
              <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
                <IconFileText size={24} />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                    Upload APKT/EIS/AP2T
                  </h1>
                  <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                    Penjualan &amp; Keandalan
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
                  Arsip dan normalisasi laporan bulanan EIS (309, DIFI, Gangguan, Keluhan, Piutang, TAGSUS) sebagai basis data NKO dan pengusahaan.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                size="md"
                icon={IconRefresh}
                onClick={tab === 'files' ? loadFiles : loadCoverage}
                aria-label="Segarkan"
              >
                Segarkan
              </Button>
              {canImport && (
                <Button
                  variant="primary"
                  size="md"
                  icon={IconUpload}
                  onClick={() => setIsUploadOpen(true)}
                >
                  Unggah Laporan
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* KPI Stats Cards */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className={`${CARD} p-4`}>
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Berkas</dt>
            <span className="rounded-lg p-1.5 bg-blue-50 dark:bg-blue-950/50 text-blue-600"><IconFileText size={16} /></span>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-slate-900 dark:text-slate-100">
            {stats.total.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Berkas terdaftar di sistem</p>
        </div>

        <div className={`${CARD} p-4`}>
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Jenis Laporan</dt>
            <span className="rounded-lg p-1.5 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-600"><IconLayers size={16} /></span>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-emerald-600 dark:text-emerald-400">
            {stats.familiesCount} jenis
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">309, DIFI, GGN, KLH, TAGSUS</p>
        </div>

        <div className={`${CARD} p-4`}>
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Unit Terlayani</dt>
            <span className="rounded-lg p-1.5 bg-indigo-50 dark:bg-indigo-950/50 text-indigo-600"><IconBuilding size={16} /></span>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-indigo-600 dark:text-indigo-400">
            {stats.unitsCount} unit
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Tingkat ULP dan UP3</p>
        </div>

        <div className={`${CARD} p-4`}>
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Periode Terkini</dt>
            <span className="rounded-lg p-1.5 bg-amber-50 dark:bg-amber-950/50 text-amber-600"><IconCalendar size={16} /></span>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-amber-600 dark:text-amber-400">
            {stats.latestPeriod}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Laporan terakhir masuk</p>
        </div>
      </dl>

      {/* Underline Tabs */}
      <div role="tablist" aria-label="Tampilan Laporan EIS" className="flex items-center gap-1 border-b border-slate-200 dark:border-slate-800">
        {[
          ['files', 'Daftar Berkas Laporan'],
          ['coverage', 'Matriks Kelengkapan Unit'],
        ].map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer ${
              tab === id
                ? 'border-blue-600 text-blue-700 dark:text-blue-300'
                : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filter Bar */}
      <div className={`${CARD} p-4`}>
        <div className="flex flex-wrap items-center gap-2.5">
          <HierarchicalUnitFilter
            permission="eis_reports.view"
            up3Id={up3Id}
            onUp3Change={(v) => {
              setPage(1)
              setUp3Id(v)
            }}
            unitId={unitId}
            onUnitChange={(v) => {
              setPage(1)
              setUnitId(v)
            }}
            up3AriaLabel="Filter UP3"
            unitAriaLabel="Filter ULP"
          />

          {tab === 'files' && (
            <>
              <select
                aria-label="Jenis Laporan"
                value={family}
                onChange={(e) => {
                  setPage(1)
                  setFamily(e.target.value)
                }}
                className={filterSelectCls}
              >
                <option value="">Semua Jenis Laporan</option>
                {Object.entries(FAMILY_LABELS).map(([k, label]) => (
                  <option key={k} value={k}>{label}</option>
                ))}
              </select>

              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <span>Dari</span>
                <input
                  type="month"
                  value={fromMonth}
                  onChange={(e) => {
                    setPage(1)
                    setFromMonth(e.target.value)
                  }}
                  aria-label="Dari bulan"
                  className={`${filterControlCls} w-32`}
                />
              </label>

              <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <span>Sampai</span>
                <input
                  type="month"
                  value={toMonth}
                  onChange={(e) => {
                    setPage(1)
                    setToMonth(e.target.value)
                  }}
                  aria-label="Sampai bulan"
                  className={`${filterControlCls} w-32`}
                />
              </label>

              <select
                aria-label="Status Berkas"
                value={status}
                onChange={(e) => {
                  setPage(1)
                  setStatus(e.target.value)
                }}
                className={filterSelectCls}
              >
                <option value="AKTIF">Status: AKTIF</option>
                <option value="DIGANTIKAN">Status: DIGANTIKAN</option>
              </select>
            </>
          )}

          {tab === 'coverage' && (
            <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
              <span>Tahun</span>
              <input
                type="number"
                min="2020"
                max="2030"
                value={covYear}
                onChange={(e) => setCovYear(Number(e.target.value))}
                aria-label="Tahun kelengkapan"
                className={`${filterControlCls} w-24 tabular-nums`}
              />
            </label>
          )}
        </div>
      </div>

      {/* Konten Tab 1: Daftar Berkas */}
      {tab === 'files' && (
        <div className={`${CARD} overflow-hidden`}>
          {filesState.error && <Alert kind="error">{filesState.error}</Alert>}

          {filesState.loading ? (
            <div className="py-20 flex justify-center">
              <Spinner size="lg" label="Memuat berkas laporan EIS..." />
            </div>
          ) : filesState.rows.length === 0 ? (
            <EmptyState
              title="Belum ada berkas laporan"
              desc="Unggah berkas laporan EIS bulanan (.xls atau .xlsx) sesuai format nama JENIS-KODEUNIT-BBTTTT."
            />
          ) : (
            <>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50/80 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-3 px-4">Periode</th>
                      <th className="py-3 px-4">Unit</th>
                      <th className="py-3 px-4">Jenis Laporan</th>
                      <th className="py-3 px-4">Nama Berkas</th>
                      <th className="py-3 px-4 text-right">Jumlah Baris</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-4">Diimpor</th>
                      <th className="py-3 px-4 text-center">Aksi</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filesState.rows.map((r) => (
                      <tr key={r.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">
                          {r.period}
                        </td>
                        <td className="py-3 px-4">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">{r.unit_name}</div>
                          <div className="text-[10px] text-slate-400">{r.unit_type}</div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-semibold text-blue-700 dark:text-blue-300">{r.family}</span>
                        </td>
                        <td className="py-3 px-4 font-mono text-[11px] text-slate-600 dark:text-slate-400 truncate max-w-xs" title={r.original_name}>
                          {r.original_name}
                          {r.warnings && r.warnings.length > 0 && (
                            <span className="block text-[10px] text-amber-600 font-sans">
                              {r.warnings.join(', ')}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          {r.line_count?.toLocaleString('id-ID')}
                        </td>
                        <td className="py-3 px-4">
                          <StatusBadge status={r.status} />
                        </td>
                        <td className="py-3 px-4 text-slate-500 whitespace-nowrap">
                          {fmtDate(r.imported_at)}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <Button
                            size="sm"
                            variant="secondary"
                            icon={IconEye}
                            onClick={() => setPreviewFileId(r.id)}
                            aria-label={`Lihat isi ${r.original_name}`}
                          >
                            Lihat Isi
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {filesState.meta && (
                <TableFooter
                  page={page}
                  perPage={perPage}
                  total={filesState.meta.total}
                  onPageChange={setPage}
                  onPerPageChange={(v) => {
                    setPage(1)
                    setPerPage(v)
                  }}
                />
              )}
            </>
          )}
        </div>
      )}

      {/* Konten Tab 2: Matriks Kelengkapan */}
      {tab === 'coverage' && (
        <div className={`${CARD} p-5 space-y-4`}>
          {!unitId && !up3Id ? (
            <Alert kind="info">
              Pilih satu ULP atau UP3 pada bilah filter di atas untuk melihat matriks kelengkapan berkas tahun {covYear}.
            </Alert>
          ) : covState.loading ? (
            <div className="py-20 flex justify-center">
              <Spinner size="lg" label="Memuat matriks kelengkapan..." />
            </div>
          ) : covState.error ? (
            <Alert kind="error">{covState.error}</Alert>
          ) : !covState.data ? (
            <p className="text-center text-slate-500 text-xs py-10">Data tidak tersedia.</p>
          ) : covState.data?.units ? (
            <Up3CoverageView
              data={covState.data}
              onSelectUlp={(uid) => {
                setUnitId(uid)
              }}
              onTriggerSync={handleTriggerSync}
            />
          ) : (
            <SingleUnitCoverageView
              data={covState.data}
              expectedUntil={
                covYear < new Date().getFullYear()
                  ? 12
                  : covYear === new Date().getFullYear()
                  ? Math.max(0, new Date().getMonth())
                  : 0
              }
              onBackToUp3={up3Id ? () => setUnitId('') : null}
              onTriggerSync={handleTriggerSync}
            />
          )}
        </div>
      )}

      {/* Modal Unggah Berkas */}
      <UploadModal
        isOpen={isUploadOpen}
        onClose={() => setIsUploadOpen(false)}
        onUploaded={() => {
          loadFiles()
          if (tab === 'coverage') loadCoverage()
        }}
      />

      {/* Drawer Tarik APKT / AP2T dari Matriks Kelengkapan */}
      <EisSyncDrawer
        open={syncDrawerState.open}
        mode={syncDrawerState.mode}
        initialDataset={syncDrawerState.dataset}
        initialReports={syncDrawerState.reports}
        onClose={() => setSyncDrawerState((s) => ({ ...s, open: false }))}
        onSynced={() => {
          if (tab === 'coverage') loadCoverage()
          loadFiles()
        }}
      />

      {/* Drawer Lihat Isi Baris Berkas */}
      <FileLinesDrawer
        fileId={previewFileId}
        onClose={() => setPreviewFileId(null)}
      />
    </div>
  )
}
