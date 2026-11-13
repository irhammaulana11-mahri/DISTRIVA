import { useRef, useState } from 'react'
import { substationsApi } from '../../services/api.js'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import PanelShell from '../../components/PanelShell.jsx'
import { IconUpload, IconCheck, IconDownload } from '../../components/icons.jsx'
import { downloadCsv, SUBSTATION_MASTER_TEMPLATE } from '../../utils/csvTemplates.js'

const ACTION_LABEL = { NEW: 'Baru', CHANGED: 'Berubah', UNCHANGED: 'Tetap', REJECT: 'Ditolak' }
const ACTION_CLS = {
  NEW: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  CHANGED: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  UNCHANGED: 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  REJECT: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
}

/**
 * Impor master gardu (docs/80 §5): unggah → tinjau hasil (NEW/CHANGED/UNCHANGED/REJECT) → konfirmasi. Tidak ada yang tersimpan sebelum konfirmasi;
 * "Buang" menandai batch DISCARDED. Unit dibaca dari kolom ULP_CODE / awalan SSOTNUMG; "unit bawaan" hanya untuk baris yang tidak punya keduanya.
 */
export default function SubstationImportModal({ open, asPage = false, onClose, units = [], onApplied }) {
  const fileRef = useRef(null)
  const [file, setFile] = useState(null)
  const [unitId, setUnitId] = useState('')
  const [full, setFull] = useState(false)
  const [batch, setBatch] = useState(null)
  const [rows, setRows] = useState([])
  const [filter, setFilter] = useState('REJECT')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [applied, setApplied] = useState(null)

  const reset = () => {
    setFile(null)
    setBatch(null)
    setRows([])
    setApplied(null)
    setError('')
    setFilter('REJECT')
    if (fileRef.current) fileRef.current.value = ''
  }

  const close = () => {
    // Batch yang belum dikonfirmasi tidak dibiarkan menggantung.
    if (batch && !applied) substationsApi.discard(batch.id).catch(() => {})
    reset()
    onClose?.()
  }

  const loadRows = async (batchId, action) => {
    try {
      const res = await substationsApi.batch(batchId, { action, per_page: 50 })
      setRows(res?.rows || [])
    } catch (err) {
      setError(err?.message || 'Gagal memuat baris batch.')
    }
  }

  const stage = async () => {
    if (!file) return
    setBusy(true)
    setError('')
    try {
      const fd = new FormData()
      fd.append('file', file)
      if (unitId) fd.append('unit_id', unitId)
      fd.append('full_snapshot', full ? '1' : '0')
      const res = await substationsApi.stage(fd)
      const b = res?.data
      setBatch(b)
      const first = (b?.counts?.REJECT ?? 0) > 0 ? 'REJECT' : 'NEW'
      setFilter(first)
      await loadRows(b.id, first)
    } catch (err) {
      setError(err?.message || 'Gagal membaca berkas gardu.')
    } finally {
      setBusy(false)
    }
  }

  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      const res = await substationsApi.confirm(batch.id)
      setApplied(res?.data?.applied || {})
      onApplied?.()
    } catch (err) {
      setError(err?.message || 'Gagal menerapkan batch.')
    } finally {
      setBusy(false)
    }
  }

  const discard = async () => {
    setBusy(true)
    try {
      await substationsApi.discard(batch.id)
      reset()
    } catch (err) {
      setError(err?.message || 'Gagal membuang batch.')
    } finally {
      setBusy(false)
    }
  }

  const counts = batch?.counts || {}
  const importable = (counts.NEW || 0) + (counts.CHANGED || 0) + (counts.UNCHANGED || 0)

  return (
    <PanelShell
      asPage={asPage}
      onBack={onClose}
      isOpen={open}
      onClose={close}
      title="Impor Master Gardu"
      subtitle="Unggah berkas gardu (xlsx / csv), tinjau hasilnya, lalu terapkan. Tidak ada data yang berubah sebelum Anda menerapkan."
      width="max-w-3xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <Button type="button" variant="secondary" size="sm" onClick={close} disabled={busy}>
            {applied ? 'Tutup' : 'Batal'}
          </Button>
          {!applied && !batch && (
            <Button type="button" size="sm" loading={busy} disabled={!file} onClick={stage}>
              <IconUpload size={14} />
              <span>Periksa Berkas</span>
            </Button>
          )}
          {!applied && batch && (
            <div className="flex items-center gap-2">
              <Button type="button" variant="secondary" size="sm" disabled={busy} onClick={discard}>
                Buang
              </Button>
              <Button type="button" size="sm" loading={busy} disabled={importable === 0} onClick={confirm}>
                <IconCheck size={14} />
                <span>Terapkan ({importable} gardu)</span>
              </Button>
            </div>
          )}
        </div>
      }
    >
      <div className="space-y-4 text-xs" data-testid="substation-import">
        {error && <Alert kind="error">{error}</Alert>}

        {!batch && !applied && (
          <div className="space-y-3">
            <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl p-3 border border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
              <div>
                <span className="font-semibold text-xs text-slate-900 dark:text-slate-100 block">
                  Format Berkas CSV Gardu
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400">
                  Unduh template resmi dengan header kolom standar (KD_GARDU, NO_GADIS, LOKASI, ULP_CODE, KD_PYLG, dll).
                </span>
              </div>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => downloadCsv('template-master-gardu.csv', SUBSTATION_MASTER_TEMPLATE)}
                className="shrink-0 text-xs py-1.5 px-3"
              >
                <IconDownload size={14} className="text-emerald-600 dark:text-emerald-400" />
                <span>Unduh Template CSV</span>
              </Button>
            </div>

            <label className="block font-semibold">
              Berkas gardu
              <input
                ref={fileRef}
                aria-label="Berkas gardu"
                type="file"
                accept=".xlsx,.csv"
                onChange={(e) => setFile(e.target.files?.[0] || null)}
                className="mt-1 block w-full text-xs"
              />
            </label>
            <label className="block font-semibold">
              Unit bawaan (untuk baris tanpa ULP_CODE dan tanpa SSOTNUMG)
              <select
                aria-label="Unit bawaan"
                value={unitId}
                onChange={(e) => setUnitId(e.target.value)}
                className="mt-1 block w-full px-3 py-2 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800"
              >
                <option value="">— tidak ada (baris tanpa unit ditolak) —</option>
                {units
                  .filter((u) => u.unit_type === 'ULP')
                  .map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.code} - {u.name}
                    </option>
                  ))}
              </select>
            </label>
            <label className="inline-flex items-start gap-2 font-semibold">
              <input aria-label="Daftar lengkap" type="checkbox" checked={full} onChange={(e) => setFull(e.target.checked)} className="mt-0.5" />
              <span>
                Berkas ini daftar lengkap gardu.
                <span className="block font-normal text-slate-500">Gardu aktif yang tidak ada di berkas hanya ditandai &quot;perlu ditinjau&quot;, tidak dinonaktifkan.</span>
              </span>
            </label>
          </div>
        )}

        {batch && !applied && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {['NEW', 'CHANGED', 'UNCHANGED', 'REJECT'].map((a) => (
                <button
                  key={a}
                  type="button"
                  data-testid={`import-count-${a}`}
                  onClick={() => {
                    setFilter(a)
                    loadRows(batch.id, a)
                  }}
                  className={`rounded-xl border p-3 text-left transition cursor-pointer ${filter === a ? 'border-blue-500 ring-1 ring-blue-500' : 'border-slate-200 dark:border-slate-700'}`}
                >
                  <div className="text-[11px] text-slate-500">{ACTION_LABEL[a]}</div>
                  <div className="text-lg font-bold">{(counts[a] || 0).toLocaleString('id-ID')}</div>
                </button>
              ))}
            </div>
            <p className="text-[11px] text-slate-500">
              Berkas {batch.file_name} · {batch.total_rows?.toLocaleString('id-ID')} baris{batch.full_snapshot ? ' · daftar lengkap' : ''}. Baris ditolak tidak ikut diterapkan.
            </p>
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800/60 text-[11px] text-slate-600 dark:text-slate-400">
                    <th className="py-2 px-3">Baris</th>
                    <th className="py-2 px-3">Kode</th>
                    <th className="py-2 px-3">Hasil</th>
                    <th className="py-2 px-3">Keterangan</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={4} className="py-4 px-3 text-center text-slate-500">
                        Tidak ada baris untuk filter ini.
                      </td>
                    </tr>
                  )}
                  {rows.map((r) => (
                    <tr key={r.row}>
                      <td className="py-2 px-3 font-mono">{r.row}</td>
                      <td className="py-2 px-3 font-mono font-semibold">{r.code || '-'}</td>
                      <td className="py-2 px-3">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${ACTION_CLS[r.action]}`}>{ACTION_LABEL[r.action]}</span>
                      </td>
                      <td className="py-2 px-3 text-slate-600 dark:text-slate-400">
                        {r.errors ? Object.values(r.errors).flat().join('; ') : r.changes ? Object.keys(r.changes).join(', ') : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {applied && (
          <div data-testid="import-applied">
            <Alert kind="success">
              Batch diterapkan: {applied.created ?? 0} gardu baru, {applied.updated ?? 0} diperbarui, {applied.readings ?? 0} pembacaan tersimpan
              {applied.review_marked ? `, ${applied.review_marked} gardu ditandai perlu ditinjau` : ''}.
            </Alert>
          </div>
        )}
      </div>
    </PanelShell>
  )
}
