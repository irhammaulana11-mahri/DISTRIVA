import { useState, useRef } from 'react'
import { substationsApi } from '../../services/api.js'
import Drawer from '../../components/Drawer.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import {
  IconUpload,
  IconDownload,
  IconCheck,
  IconCheckCircle,
  IconAlertCircle,
  IconRefresh,
} from '../../components/icons.jsx'
import { downloadCsv, SUBSTATION_READING_TEMPLATE } from '../../utils/csvTemplates.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'

/**
 * Parse CSV text into array of objects with normalized header keys.
 */
function parseCsv(text) {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  if (lines.length < 2) return []

  const headerLine = lines[0].replace(/^\uFEFF/, '') // remove BOM if present
  // Handle comma or semicolon separated
  const delimiter = headerLine.includes(';') ? ';' : ','

  const headers = headerLine.split(delimiter).map((h) =>
    h
      .trim()
      .replace(/^["']|["']$/g, '')
      .toLowerCase()
  )

  const KEY_MAP = {
    kd_gardu: 'code',
    kode_gardu: 'code',
    no_gardu: 'code',
    gardu: 'code',
    code: 'code',

    tgl_ukur: 'measured_on',
    tanggal_ukur: 'measured_on',
    tanggal: 'measured_on',
    tgl: 'measured_on',
    measured_on: 'measured_on',

    persen: 'loading_pct',
    beban_pct: 'loading_pct',
    pembebanan: 'loading_pct',
    loading_pct: 'loading_pct',

    beban_kva: 'load_kva',
    load_kva: 'load_kva',
    kva: 'load_kva',

    teg_ujung: 'end_voltage_v',
    v_ujung: 'end_voltage_v',
    end_voltage_v: 'end_voltage_v',

    teg_pangkal_r: 'base_voltage_r_v',
    vr: 'base_voltage_r_v',
    base_voltage_r_v: 'base_voltage_r_v',

    teg_pangkal_s: 'base_voltage_s_v',
    vs: 'base_voltage_s_v',
    base_voltage_s_v: 'base_voltage_s_v',

    teg_pangkal_t: 'base_voltage_t_v',
    vt: 'base_voltage_t_v',
    base_voltage_t_v: 'base_voltage_t_v',

    arus_r: 'current_r_a',
    ir: 'current_r_a',
    current_r_a: 'current_r_a',

    arus_s: 'current_s_a',
    is: 'current_s_a',
    current_s_a: 'current_s_a',

    arus_t: 'current_t_a',
    it: 'current_t_a',
    current_t_a: 'current_t_a',

    arus_n: 'current_n_a',
    in: 'current_n_a',
    current_n_a: 'current_n_a',
  }

  const mappedKeys = headers.map((h) => KEY_MAP[h] || h)

  const rows = []
  for (let i = 1; i < lines.length; i++) {
    const rawCells = lines[i].split(delimiter).map((c) => c.trim().replace(/^["']|["']$/g, ''))
    const row = {}
    mappedKeys.forEach((key, idx) => {
      if (rawCells[idx] !== undefined && rawCells[idx] !== '') {
        const val = rawCells[idx]
        if (
          [
            'loading_pct',
            'load_kva',
            'end_voltage_v',
            'base_voltage_r_v',
            'base_voltage_s_v',
            'base_voltage_t_v',
            'current_r_a',
            'current_s_a',
            'current_t_a',
            'current_n_a',
          ].includes(key)
        ) {
          const num = parseFloat(val.replace(',', '.'))
          row[key] = isNaN(num) ? null : num
        } else {
          row[key] = val
        }
      }
    })
    if (row.code) {
      rows.push(row)
    }
  }
  return rows
}

export default function SubstationReadingsImportModal({ isOpen, onClose, onSuccess }) {
  const { notify } = useNotifications()
  const fileInputRef = useRef(null)

  const [file, setFile] = useState(null)
  const [step, setStep] = useState('upload') // 'upload' | 'preview' | 'result'
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [parsedRows, setParsedRows] = useState([])
  const [validationErrors, setValidationErrors] = useState([])
  const [result, setResult] = useState(null)
  const [isDragging, setIsDragging] = useState(false)

  const reset = () => {
    setFile(null)
    setStep('upload')
    setLoading(false)
    setError('')
    setParsedRows([])
    setValidationErrors([])
    setResult(null)
    if (fileInputRef.current) fileInputRef.current.value = ''
  }

  const handleClose = () => {
    reset()
    onClose?.()
  }

  const handleDownloadTemplate = () => {
    downloadCsv('template-pengukuran-gardu.csv', SUBSTATION_READING_TEMPLATE)
    notify({
      type: 'info',
      title: 'Templat CSV Diunduh',
      desc: 'Berkas template-pengukuran-gardu.csv berhasil diunduh.',
      tag: 'Pengukuran Gardu',
    })
  }

  const processFile = (f) => {
    if (!f) return
    setFile(f)
    setError('')

    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const text = e.target.result
        const rows = parseCsv(text)
        if (rows.length === 0) {
          setError('Berkas CSV kosong atau tidak memiliki baris data yang valid dengan kolom "code" / "kd_gardu".')
          return
        }

        const errors = []
        const today = new Date().toISOString().slice(0, 10)

        rows.forEach((r, idx) => {
          if (!r.code) {
            errors.push(`Baris ${idx + 2}: Kode gardu wajib diisi.`)
          }
          if (!r.measured_on) {
            errors.push(`Baris ${idx + 2}: Tanggal ukur (measured_on) wajib diisi.`)
          } else if (r.measured_on > today) {
            errors.push(`Baris ${idx + 2}: Tanggal ukur tidak boleh di masa depan (${r.measured_on}).`)
          }
        })

        setParsedRows(rows)
        setValidationErrors(errors)
        setStep('preview')
      } catch (err) {
        setError(`Gagal membaca berkas CSV: ${err.message}`)
      }
    }
    reader.readAsText(f)
  }

  const handleFileChange = (e) => {
    const f = e.target.files?.[0]
    processFile(f)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const f = e.dataTransfer?.files?.[0]
    processFile(f)
  }

  const handleSubmit = async () => {
    if (parsedRows.length === 0) return
    setLoading(true)
    setError('')

    try {
      const payload = parsedRows.map((r) => {
        const item = {
          code: String(r.code).trim(),
          measured_on: r.measured_on,
        }
        if (r.loading_pct !== undefined && r.loading_pct !== null) item.loading_pct = r.loading_pct
        if (r.load_kva !== undefined && r.load_kva !== null) item.load_kva = r.load_kva
        if (r.end_voltage_v !== undefined && r.end_voltage_v !== null) item.end_voltage_v = r.end_voltage_v
        if (r.base_voltage_r_v !== undefined && r.base_voltage_r_v !== null) item.base_voltage_r_v = r.base_voltage_r_v
        if (r.base_voltage_s_v !== undefined && r.base_voltage_s_v !== null) item.base_voltage_s_v = r.base_voltage_s_v
        if (r.base_voltage_t_v !== undefined && r.base_voltage_t_v !== null) item.base_voltage_t_v = r.base_voltage_t_v
        if (r.current_r_a !== undefined && r.current_r_a !== null) item.current_r_a = r.current_r_a
        if (r.current_s_a !== undefined && r.current_s_a !== null) item.current_s_a = r.current_s_a
        if (r.current_t_a !== undefined && r.current_t_a !== null) item.current_t_a = r.current_t_a
        if (r.current_n_a !== undefined && r.current_n_a !== null) item.current_n_a = r.current_n_a
        return item
      })

      const res = await substationsApi.bulkReadings(payload)
      setResult(res?.data || {})
      setStep('result')
      notify({
        type: 'success',
        title: 'Impor Pengukuran Selesai',
        desc: `Berhasil memproses ${payload.length} data pembacaan gardu.`,
        tag: 'Pengukuran Gardu',
      })
      onSuccess?.()
    } catch (err) {
      setError(err?.message || 'Gagal mengimpor pembacaan gardu.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Drawer
      isOpen={isOpen}
      onClose={handleClose}
      title="Impor Pengukuran Gardu"
      subtitle="Unggah berkas CSV pembacaan operasional / pengukuran beban gardu (dua tahap: pratinjau & validasi lalu simpan)."
      width="max-w-4xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button type="button" variant="secondary" size="sm" onClick={handleClose} disabled={loading}>
            {step === 'result' ? 'Tutup' : 'Batal'}
          </Button>
          {step === 'preview' && (
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={loading} onClick={() => setStep('upload')}>
                Pilih Berkas Lain
              </Button>
              <Button
                type="button"
                size="sm"
                loading={loading}
                disabled={validationErrors.length > 0 || parsedRows.length === 0}
                onClick={handleSubmit}
              >
                <IconCheck size={14} />
                <span>Simpan ({parsedRows.length} Data)</span>
              </Button>
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-4 text-xs" data-testid="readings-import-drawer">
        {error && <Alert kind="error">{error}</Alert>}

        {step === 'upload' && (
          <div className="space-y-4">
            {/* Box Format & Unduh Template */}
            <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div>
                <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 block">
                  Format Berkas CSV Pengukuran Gardu
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Unduh template resmi berisi header standar (code/kd_gardu, measured_on/tgl_ukur, loading_pct, end_voltage_v, dll).
                </span>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleDownloadTemplate}
                className="shrink-0 text-xs py-1.5 px-3"
              >
                <IconDownload size={14} className="text-emerald-600 dark:text-emerald-400" />
                <span>Unduh Template CSV</span>
              </Button>
            </div>

            {/* Dropzone */}
            <div
              onDragOver={(e) => {
                e.preventDefault()
                setIsDragging(true)
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              className={`rounded-2xl border-2 border-dashed p-8 text-center transition-colors ${
                isDragging
                  ? 'border-emerald-500 bg-emerald-50/20 dark:bg-emerald-950/20'
                  : 'border-slate-200 dark:border-slate-700 hover:border-emerald-500'
              }`}
            >
              <IconUpload size={36} className="mx-auto text-slate-400 mb-2" />
              <label htmlFor="csv-readings-upload" className="block text-sm font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                Pilih Berkas CSV Pengukuran
              </label>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                Format UTF-8 (.csv), kolom wajib: <code>code</code> (atau <code>kd_gardu</code>) dan <code>measured_on</code> (atau <code>tgl_ukur</code>).
              </p>
              <input
                ref={fileInputRef}
                id="csv-readings-upload"
                type="file"
                accept=".csv,text/csv,text/plain"
                onChange={handleFileChange}
                className="mt-4 text-xs text-slate-600 dark:text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-xl file:border-0 file:text-xs file:font-semibold file:bg-emerald-50 file:text-emerald-700 hover:file:bg-emerald-100 cursor-pointer"
              />
            </div>
          </div>
        )}

        {step === 'preview' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Pratinjau Staging ({parsedRows.length} Baris Terbaca)
                </h4>
                <p className="text-[11px] text-slate-500">
                  Periksa integritas data sebelum menyimpan ke basis data pengukuran operasional.
                </p>
              </div>
              <span className="font-mono text-xs px-2.5 py-1 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                {file?.name}
              </span>
            </div>

            {validationErrors.length > 0 && (
              <Alert kind="error">
                <div className="font-bold mb-1">Ditemukan kesalahan validasi ({validationErrors.length}):</div>
                <ul className="list-disc pl-4 space-y-0.5 max-h-36 overflow-y-auto">
                  {validationErrors.slice(0, 10).map((err, i) => (
                    <li key={i}>{err}</li>
                  ))}
                  {validationErrors.length > 10 && (
                    <li>...dan {validationErrors.length - 10} kesalahan lainnya.</li>
                  )}
                </ul>
              </Alert>
            )}

            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 max-h-80 overflow-y-auto">
              <table className="w-full text-left text-xs border-collapse">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-700 text-[11px]">
                  <tr>
                    <th className="py-2 px-3">#</th>
                    <th className="py-2 px-3">Kode Gardu</th>
                    <th className="py-2 px-3">Tgl Ukur</th>
                    <th className="py-2 px-3 text-right">Beban (%)</th>
                    <th className="py-2 px-3 text-right">Beban (kVA)</th>
                    <th className="py-2 px-3 text-right">Teg. Ujung (V)</th>
                    <th className="py-2 px-3 text-right">Teg. Pangkal (R/S/T)</th>
                    <th className="py-2 px-3 text-right">Arus (R/S/T/N)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {parsedRows.map((r, i) => (
                    <tr key={i} className="hover:bg-slate-50 dark:hover:bg-slate-800/50">
                      <td className="py-2 px-3 font-mono text-slate-400">{i + 1}</td>
                      <td className="py-2 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">{r.code}</td>
                      <td className="py-2 px-3 font-mono">{r.measured_on}</td>
                      <td className="py-2 px-3 text-right font-mono">
                        {r.loading_pct != null ? `${r.loading_pct}%` : '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono">{r.load_kva != null ? r.load_kva : '-'}</td>
                      <td className="py-2 px-3 text-right font-mono">{r.end_voltage_v != null ? r.end_voltage_v : '-'}</td>
                      <td className="py-2 px-3 text-right font-mono text-[11px]">
                        {[r.base_voltage_r_v, r.base_voltage_s_v, r.base_voltage_t_v].some((v) => v != null)
                          ? `${r.base_voltage_r_v ?? '-'} / ${r.base_voltage_s_v ?? '-'} / ${r.base_voltage_t_v ?? '-'}`
                          : '-'}
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-[11px]">
                        {[r.current_r_a, r.current_s_a, r.current_t_a].some((v) => v != null)
                          ? `${r.current_r_a ?? '-'} / ${r.current_s_a ?? '-'} / ${r.current_t_a ?? '-'}`
                          : '-'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {step === 'result' && result && (
          <div className="space-y-4 py-2" data-testid="import-readings-result">
            <div className="p-4 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 flex items-start gap-3">
              <IconCheckCircle size={22} className="text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
              <div>
                <h4 className="font-bold text-sm text-emerald-900 dark:text-emerald-200">
                  Impor Pembacaan Selesai
                </h4>
                <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-0.5">
                  Proses sinkronisasi pembacaan operasional gardu berhasil dijalankan.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
              <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500">Tersimpan Baru</div>
                <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400">
                  {result.counts?.stored ?? 0}
                </div>
              </div>
              <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500">Tetap (Sama)</div>
                <div className="text-lg font-bold font-mono text-slate-600 dark:text-slate-400">
                  {result.counts?.unchanged ?? 0}
                </div>
              </div>
              <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500">Gardu Tidak Dikenal</div>
                <div className="text-lg font-bold font-mono text-amber-600 dark:text-amber-400">
                  {result.counts?.unknown ?? 0}
                </div>
              </div>
              <div className="p-3 bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700">
                <div className="text-[11px] text-slate-500">Di Luar Cakupan Unit</div>
                <div className="text-lg font-bold font-mono text-rose-600 dark:text-rose-400">
                  {result.counts?.out_of_scope ?? 0}
                </div>
              </div>
            </div>

            {result.problems && result.problems.length > 0 && (
              <div className="space-y-1">
                <div className="font-semibold text-slate-700 dark:text-slate-300">
                  Catatan Baris yang Dilewati ({result.problems.length}):
                </div>
                <div className="max-h-40 overflow-y-auto rounded-lg border border-slate-200 dark:border-slate-800 p-2 bg-slate-50 dark:bg-slate-900 text-[11px] space-y-1">
                  {result.problems.map((p, i) => (
                    <div key={i} className="text-slate-600 dark:text-slate-400">
                      Baris #{p.index + 1} ({p.code}): <span className="text-rose-600 dark:text-rose-400">{p.problem}</span>
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
