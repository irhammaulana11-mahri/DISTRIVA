import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { masterExcelApi, adminApi, triggerFileDownload } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ConfirmationModal from '../../components/ConfirmationModal.jsx'
import PriceBookCloneModal from './PriceBookCloneModal.jsx'
import {
  IconUpload,
  IconDownload,
  IconRefresh,
  IconTrash,
  IconCheckCircle,
  IconAlertCircle,
  IconInfo,
  IconFileText,
  IconSearch,
  IconX,
  IconChevronDown,
  IconChevronRight,
  IconCheck,
  IconLock,
} from '../../components/icons.jsx'
import UnitPicker from '../../components/UnitPicker.jsx'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import { useScopedUnits } from '../../utils/unitScope.js'

const fmtSize = (b) => (b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const fmtWhen = (iso) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}
const today = () => new Date().toISOString().slice(0, 10)
const KIND = { RAB_KKF: 'Excel RAB & KKF', TARIF: 'Excel Tarif & Jam Nyala', DISTRIVA: 'MASTER DISTRIVA' }
const DATASET_SHORT = { BOM: 'BOM', PRICE: 'Harga', TARIFF: 'Tarif', KKF: 'KKF' }
const STATE = {
  UPLOADED: ['Terunggah', 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'],
  PROCESSING: ['Diperiksa…', 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'],
  READY: ['Siap ditinjau', 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'],
  FAILED: ['Gagal', 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'],
}
const CHANGE = {
  CHANGED: ['Ada perubahan', 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'],
  UNCHANGED: ['Sama dengan data berlaku', 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700'],
  NEW: ['Belum ada versi', 'bg-blue-50 text-blue-700 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'],
  BLOCKED: ['Perlu dibereskan', 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'],
}
const chip = (map, key) => {
  const [label, cls] = map[key] || [key, map.UNCHANGED?.[1] || '']
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold ${cls}`}>{label}</span>
}
const card = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-xs'
const input = 'rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-2 text-sm text-slate-900 dark:text-slate-100 focus-ring'

function WorkflowStepper({ activeStep }) {
  const steps = [
    { num: 1, title: 'Unggah & Periksa', desc: 'Cek format dan selisih otomatis' },
    { num: 2, title: 'Tinjau Perubahan', desc: 'Verifikasi hasil hitung & perbedaan' },
    { num: 3, title: 'Terapkan DRAFT', desc: 'Menunggu persetujuan akun lain' },
  ]
  return (
    <ol className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-3" aria-label="Alur impor Excel">
      {steps.map((s) => {
        const done = activeStep > s.num
        const current = activeStep === s.num
        return (
          <li
            key={s.num}
            className={`flex items-center gap-2.5 rounded-xl border px-3 py-2 text-xs transition ${
              current
                ? 'border-emerald-300 bg-emerald-50/70 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100'
                : done
                  ? 'border-emerald-200/70 bg-white/80 text-slate-700 dark:border-emerald-900/60 dark:bg-slate-900/60 dark:text-slate-300'
                  : 'border-slate-200/80 bg-white/60 text-slate-500 dark:border-slate-800 dark:bg-slate-900/40 dark:text-slate-400'
            }`}
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ${
                done
                  ? 'bg-emerald-600 text-white'
                  : current
                    ? 'bg-emerald-600 text-white ring-4 ring-emerald-100 dark:ring-emerald-950'
                    : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
              }`}
            >
              {done ? <IconCheck className="h-3.5 w-3.5" /> : s.num}
            </span>
            <div className="min-w-0">
              <div className="font-semibold leading-tight">{s.title}</div>
              <div className="text-[11px] opacity-80 truncate">{s.desc}</div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}

function TariffCoverageBox({ coverage = [] }) {
  const valid = useMemo(() => coverage.filter((c) => c.code !== ''), [coverage])
  const unitInfo = useScopedUnits('tariffs.manage')
  const [covUp3Id, setCovUp3Id] = useState('')
  const [covUnitId, setCovUnitId] = useState('')
  const [expanded, setExpanded] = useState(() => valid.length <= 8)
  const [filterMode, setFilterMode] = useState('all') // 'all' | 'filled' | 'empty'
  const [query, setQuery] = useState('')

  useEffect(() => {
    if (valid.length <= 8) setExpanded(true)
  }, [valid.length])

  const scopedValid = useMemo(() => {
    if (!covUp3Id && !covUnitId) return valid
    const ulps = unitInfo?.ulp_units || []
    if (covUnitId) {
      const target = ulps.find((u) => String(u.id) === String(covUnitId))
      if (!target?.code) return valid
      return valid.filter((c) => String(c.code) === String(target.code))
    }
    const allowedCodes = new Set(
      ulps.filter((u) => String(u.parent_id) === String(covUp3Id)).map((u) => String(u.code || '')),
    )
    if (allowedCodes.size === 0) return valid
    return valid.filter((c) => allowedCodes.has(String(c.code)))
  }, [valid, covUp3Id, covUnitId, unitInfo])

  const filledCount = useMemo(() => scopedValid.filter((c) => c.rows > 0).length, [scopedValid])

  if (valid.length === 0) return null
  const pct = scopedValid.length > 0 ? Math.round((filledCount / scopedValid.length) * 100) : 0
  const filtered = scopedValid.filter((c) => {
    if (filterMode === 'filled' && c.rows <= 0) return false
    if (filterMode === 'empty' && c.rows > 0) return false
    if (query.trim() && !`${c.name} ${c.code}`.toLowerCase().includes(query.trim().toLowerCase())) return false
    return true
  })

  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/40 p-3 space-y-2.5" aria-label="Cakupan ULP pada buku tarif berlaku">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">Jam nyala dan UJL pada buku tarif berlaku</p>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            <strong className="text-slate-700 dark:text-slate-200">{filledCount}</strong> dari <strong>{scopedValid.length}</strong> ULP sudah terisi ({pct}%)
          </p>
        </div>
        {valid.length > 8 && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 cursor-pointer"
          >
            {expanded ? <IconChevronDown className="h-3.5 w-3.5" /> : <IconChevronRight className="h-3.5 w-3.5" />}
            {expanded ? 'Sembunyikan rincian ULP' : `Lihat rincian ULP (${scopedValid.length})`}
          </button>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <HierarchicalUnitFilter
          permission="tariffs.manage"
          up3Id={covUp3Id}
          onUp3Change={setCovUp3Id}
          unitId={covUnitId}
          onUnitChange={setCovUnitId}
          up3AriaLabel="Filter UP3 cakupan tarif"
          unitAriaLabel="Filter ULP cakupan tarif"
          className="w-40"
          ulpClassName="w-48"
        />
      </div>

      <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-200 dark:bg-slate-800">
        <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
      </div>

      {expanded && (
        <div className="space-y-2 pt-1">
          {valid.length > 8 && (
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative flex-1 min-w-44">
                <IconSearch className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
                <input
                  type="search"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Cari ULP…"
                  aria-label="Cari cakupan ULP"
                  className="w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 pl-8 pr-2.5 py-1 text-xs text-slate-900 dark:text-slate-100 focus-ring"
                />
              </div>
              <div className="inline-flex rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 p-0.5 text-[11px]">
                {[
                  ['all', `Semua (${scopedValid.length})`],
                  ['filled', `Terisi (${filledCount})`],
                  ['empty', `Belum ada (${scopedValid.length - filledCount})`],
                ].map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setFilterMode(k)}
                    className={`rounded-md px-2 py-0.5 font-medium cursor-pointer transition ${
                      filterMode === k
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
          )}

          {filtered.length === 0 ? (
            <p className="text-[11px] text-slate-500">Tidak ada ULP yang cocok dengan filter.</p>
          ) : (
            <ul className="flex max-h-48 flex-wrap gap-1.5 overflow-y-auto pr-1">
              {filtered.map((c) => (
                <li
                  key={c.code}
                  className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
                    c.rows > 0
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                      : 'border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  {c.name} · {c.rows > 0 ? `${c.rows} baris` : 'belum ada'}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <p className="text-[11px] text-slate-500">
        Untuk menambah atau memperbarui satu ULP: pilih ULP itu, unggah laporan penjualannya, terapkan. ULP lain tidak berubah.
      </p>
    </div>
  )
}

function UploadCard({ kind, title, hint, badge, disabled, units, coverage = [], maxMb = 60, onUploaded, className = '', actions = null }) {
  const { notify } = useNotifications()
  const ref = useRef(null)
  const [file, setFile] = useState(null)
  const [dragOver, setDragOver] = useState(false)
  const [ulp, setUlp] = useState('')
  const [busy, setBusy] = useState(false)

  const pickFile = (nextFile) => {
    if (!nextFile) {
      setFile(null)
      return
    }
    if (!nextFile.name.toLowerCase().endsWith('.xlsx')) {
      notify({ type: 'error', title: 'Format berkas tidak didukung', desc: 'Hanya berkas Excel (.xlsx) yang diterima.', tag: 'Excel' })
      return
    }
    setFile(nextFile)
  }

  const clearFile = () => {
    setFile(null)
    if (ref.current) ref.current.value = ''
  }

  const submit = async () => {
    if (!file) return
    const fd = new FormData()
    fd.append('file', file)
    fd.append('kind', kind)
    if (kind === 'TARIF' && ulp) fd.append('ulp_code', ulp)
    setBusy(true)
    try {
      const r = await masterExcelApi.upload(fd)
      notify({ type: 'success', title: 'Berkas diterima', desc: 'Sedang diperiksa terhadap data yang berlaku.', tag: 'Excel' })
      clearFile()
      onUploaded(r?.data)
    } catch (err) {
      notify({ type: 'error', title: 'Berkas ditolak', desc: err?.message || 'Gagal mengunggah.', tag: 'Excel' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className={`${card} ${className}`} aria-label={title}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
            {badge && (
              <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                {badge}
              </span>
            )}
          </div>
          <p className="mt-1 text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-3xl">{hint}</p>
        </div>
        {actions && !disabled && <div className="shrink-0">{actions}</div>}
      </div>

      {disabled ? (
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-850 p-3.5 text-xs text-slate-500">
          <IconLock className="h-4 w-4 shrink-0 text-slate-400" />
          <p>Akun Anda tidak berwenang menyiapkan data ini.</p>
        </div>
      ) : (
        <div className="mt-4 space-y-4">
          {/* Drag-and-Drop Zone */}
          <div
            onDragOver={(e) => {
              e.preventDefault()
              setDragOver(true)
            }}
            onDragLeave={() => setDragOver(false)}
            onDrop={(e) => {
              e.preventDefault()
              setDragOver(false)
              pickFile(e.dataTransfer?.files?.[0] || null)
            }}
            className={`relative rounded-xl border-2 border-dashed p-5 transition ${
              dragOver
                ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/30'
                : file
                  ? 'border-emerald-300 bg-emerald-50/30 dark:border-emerald-800 dark:bg-emerald-950/10'
                  : 'border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-850/40 hover:border-emerald-400 dark:hover:border-emerald-700'
            }`}
          >
            <input
              ref={ref}
              id={`excel-file-${kind}`}
              type="file"
              accept=".xlsx"
              aria-label={`Berkas ${title}`}
              onChange={(e) => pickFile(e.target.files?.[0] || null)}
              className="sr-only"
            />

            {!file ? (
              <label htmlFor={`excel-file-${kind}`} className="flex cursor-pointer flex-col items-center justify-center text-center">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300">
                  <IconUpload className="h-5 w-5" />
                </span>
                <span className="mt-2.5 text-sm font-semibold text-slate-800 dark:text-slate-100">
                  Pilih berkas Excel atau tarik ke sini
                </span>
                <span className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">
                  Format .xlsx (tanpa makro) · maksimal {maxMb} MB
                </span>
              </label>
            ) : (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300">
                    <IconFileText className="h-5 w-5" />
                  </span>
                  <div className="min-w-0">
                    <p className="truncate text-sm font-semibold text-slate-900 dark:text-slate-100">{file.name}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{fmtSize(file.size)} · Siap diperiksa</p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <label
                    htmlFor={`excel-file-${kind}`}
                    className="cursor-pointer rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700"
                  >
                    Ganti
                  </label>
                  <button
                    type="button"
                    onClick={clearFile}
                    aria-label="Hapus berkas terpilih"
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-200 dark:border-rose-900/60 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/30 cursor-pointer"
                  >
                    <IconX className="h-3.5 w-3.5" /> Hapus
                  </button>
                </div>
              </div>
            )}
          </div>

          {kind === 'TARIF' && (
            <div>
              <span className="block text-[11px] font-medium text-slate-500">Jam nyala dalam berkas ini berasal dari ULP (kosongkan = berlaku umum)</span>
              <UnitPicker
                permission="tariffs.manage"
                level="ulp"
                clearable
                value={units.find((u) => u.code === ulp)?.id || ''}
                onChange={(id, unit) => setUlp(unit?.code || '')}
                units={units}
                up3AriaLabel="UP3 asal jam nyala"
                unitAriaLabel="ULP asal jam nyala"
                className="mt-1"
              />
            </div>
          )}

          {kind === 'TARIF' && <TariffCoverageBox coverage={coverage} />}

          <div className="flex flex-wrap items-center gap-2">
            <Button icon={IconUpload} onClick={submit} loading={busy} disabled={!file}>
              Unggah &amp; periksa
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}

function Problems({ items }) {
  if (!items?.length) return null
  return <ul className="mt-2 space-y-1 text-xs text-rose-700 dark:text-rose-300">{items.map((p) => <li key={p} className="flex gap-1.5"><IconAlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>{p}</span></li>)}</ul>
}

function Applied({ result }) {
  if (!result) return null
  return (
    <p className="mt-3 flex flex-wrap items-center gap-1.5 rounded-lg bg-emerald-50 dark:bg-emerald-950/30 border border-emerald-200/70 dark:border-emerald-900 px-3 py-2 text-xs text-emerald-900 dark:text-emerald-200">
      <IconCheckCircle className="h-4 w-4 shrink-0" /> <span>{result.message}</span>
      {result.link && <Link to={result.link} className="font-semibold underline">Buka untuk disetujui akun lain</Link>}
    </p>
  )
}

function ApplyBar({ dataset, label, needName, defaultName, disabled, applied, onApply, extra, defaultValidFrom }) {
  const [validFrom, setValidFrom] = useState(defaultValidFrom || today())
  const [name, setName] = useState(defaultName || '')
  const [confirm, setConfirm] = useState(false)
  const [busy, setBusy] = useState(false)
  if (applied?.status === 'OK') return <Applied result={applied} />
  return (
    <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-slate-100 dark:border-slate-800 pt-3">
      <div>
        <label htmlFor={`vf-${dataset}`} className="block text-[11px] font-medium text-slate-500">Berlaku mulai</label>
        <input id={`vf-${dataset}`} type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} className={input} />
      </div>
      {needName && (
        <div className="min-w-56 flex-1">
          <label htmlFor={`nm-${dataset}`} className="block text-[11px] font-medium text-slate-500">Nama versi baru</label>
          <input id={`nm-${dataset}`} type="text" value={name} onChange={(e) => setName(e.target.value)} className={`${input} w-full`} maxLength={150} />
        </div>
      )}
      <Button onClick={() => setConfirm(true)} disabled={disabled || !validFrom || (needName && !name.trim())}>{label}</Button>
      <ConfirmationModal open={confirm} variant="info" title={`${label}?`} confirmLabel="Terapkan sebagai DRAFT" loading={busy}
        description="Perubahan dibuat sebagai versi DRAFT baru. Data yang sudah disetujui tidak berubah; akun lain perlu menyetujuinya di halaman datanya."
        onClose={() => setConfirm(false)}
        onConfirm={async () => {
          setBusy(true)
          try { await onApply({ dataset, valid_from: validFrom, name: name.trim() || undefined, ...(extra ? extra() : {}) }) } finally { setBusy(false); setConfirm(false) }
        }} />
    </div>
  )
}

function BomSection({ imp, can, onApply, defaultValidFrom, workbook = false }) {
  const groups = imp.report?.bom?.groups || []
  const [pick, setPick] = useState(null)
  const changed = groups.filter((g) => g.status === 'CHANGED').map((g) => g.group)
  const selected = pick ?? changed
  const toggle = (g) => setPick((selected.includes(g) ? selected.filter((x) => x !== g) : [...selected, g]))
  return (
    <section className={card} aria-labelledby="mx-bom">
      <h3 id="mx-bom" className="text-base font-semibold text-slate-900 dark:text-slate-100">BOM (rumus volume)</h3>
      <p className="text-xs text-slate-500 dark:text-slate-400">{workbook ? 'Dibandingkan baris demi baris dengan BOM yang disetujui. Kelompok yang berubah hanya bisa diterapkan bila hasil hitung Excel sama dengan hitungan DISTRIVA.' : 'Dibandingkan baris demi baris dengan BOM yang disetujui. Kode KHS lama di Excel diterjemahkan ke kode yang dipakai.'}</p>
      <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className="w-full min-w-136 text-left text-xs">
          <caption className="sr-only">Perbandingan BOM per kelompok</caption>
          <thead className="bg-slate-50 dark:bg-slate-850 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800">
            <tr><th scope="col" className="px-3 py-2 w-8"><span className="sr-only">Pilih</span></th><th scope="col" className="px-3 py-2">Kelompok</th><th scope="col" className="px-3 py-2">Status</th><th scope="col" className="px-3 py-2 text-right">Berubah</th><th scope="col" className="px-3 py-2 text-right">Baru</th><th scope="col" className="px-3 py-2 text-right">Hilang</th></tr>
          </thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {groups.map((g) => (
              <tr key={g.group} className="align-top">
                <td className="px-3 py-2"><input type="checkbox" aria-label={`Terapkan ${g.group}`} disabled={g.status !== 'CHANGED'} checked={selected.includes(g.group) && g.status === 'CHANGED'} onChange={() => toggle(g.group)} /></td>
                <td className="px-3 py-2 font-semibold text-slate-900 dark:text-slate-100">{g.group}
                  {g.samples?.length > 0 && <details className="mt-1 font-normal text-slate-500"><summary className="cursor-pointer">Contoh perubahan</summary><ul className="mt-1 space-y-1">{g.samples.map((s) => <li key={s.sequence}>baris {s.sequence}: <span className="line-through">{s.before}</span> → {s.after}</li>)}</ul></details>}
                  {g.parity && <p className="mt-1 text-[11px] font-normal text-slate-500">{g.parity.mismatch_count > 0 ? <span className="text-rose-600">{`Hasil hitung berbeda di ${g.parity.mismatch_count} sel`}</span> : `Hasil hitung cocok (${g.parity.checked} sel diuji)`}</p>}
                  <Problems items={g.problems} />
                </td>
                <td className="px-3 py-2">{chip(CHANGE, g.status)}</td>
                <td className="px-3 py-2 text-right">{g.changed}</td><td className="px-3 py-2 text-right">{g.added}</td><td className="px-3 py-2 text-right">{g.removed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ApplyBar dataset="BOM" label="Terapkan BOM terpilih" defaultValidFrom={defaultValidFrom} disabled={!can || selected.length === 0 || changed.length === 0} applied={imp.applied?.BOM} onApply={onApply} extra={() => ({ groups: selected })} />
      {!can && <p className="mt-2 text-xs text-slate-500">Menerapkan BOM memerlukan izin kelola BOM.</p>}
    </section>
  )
}

function PriceSection({ imp, can, onApply, defaultValidFrom }) {
  const p = imp.report?.price
  const navigate = useNavigate()
  const { notify } = useNotifications()
  const [cloneOpen, setCloneOpen] = useState(false)
  if (!p) return null
  return (
    <section className={card} aria-labelledby="mx-price">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="mx-price" className="text-base font-semibold text-slate-900 dark:text-slate-100">Buku harga</h3>
        {chip(CHANGE, p.status)}
      </div>
      {p.book && <p className="text-xs text-slate-500">Dasar perbandingan: {p.book}</p>}
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
        {[['Baris di Excel', p.excel_rows], ['Baris berlaku', p.current_rows], ['Harga berubah', p.changed_rows], ['Tetap sama', p.unchanged_rows]].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60 p-3"><dt className="text-slate-500">{l}</dt><dd className="mt-0.5 text-lg font-bold text-slate-900 dark:text-slate-100">{(v ?? 0).toLocaleString('id-ID')}</dd></div>
        ))}
      </dl>
      {p.new_codes?.count > 0 && <div className="mt-3"><Alert variant="warning">{`${p.new_codes.count} kode di Excel belum punya kode baru, jadi tidak ikut diterapkan: ${p.new_codes.items.join(', ')}${p.new_codes.count > p.new_codes.items.length ? ', …' : ''}.`}</Alert></div>}
      {p.samples?.length > 0 && (
        <div className="mt-3 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className="w-full min-w-120 text-left text-xs">
            <caption className="sr-only">Contoh harga yang berubah</caption>
            <thead className="bg-slate-50 dark:bg-slate-850 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800"><tr><th scope="col" className="px-3 py-2">Material</th><th scope="col" className="px-3 py-2">Perubahan</th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {p.samples.map((s) => <tr key={s.code}><td className="px-3 py-2"><span className="font-semibold">{s.name}</span><span className="block font-mono text-[10px] text-slate-400">{s.code}</span></td><td className="px-3 py-2">{s.fields.map((f) => <span key={f.field} className="mr-3 inline-block whitespace-nowrap">{f.field}: <span className="line-through text-slate-400">{f.before ?? '-'}</span> → <strong>{f.after}</strong></span>)}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
      {p.mdu_differences?.count > 0 && (
        <div className="mt-3" data-testid="mdu-differences">
          <Alert variant="warning">{`Nilai MDU di Excel berbeda dari buku yang berlaku pada ${p.mdu_differences.count.toLocaleString('id-ID')} barang. Nilai MDU tidak ditimpa dari Excel; bila perlu diubah, buat draf dari buku berlaku di halaman Buku Harga lalu ubah per barang (tombol Ubah pada kolom Nilai MDU).`}</Alert>
          <div className="mt-2 overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full min-w-120 text-left text-xs">
              <caption className="sr-only">Selisih nilai MDU</caption>
              <thead className="bg-slate-50 dark:bg-slate-850 text-[11px] font-semibold uppercase tracking-wider text-slate-500 border-b border-slate-200 dark:border-slate-800"><tr><th scope="col" className="px-3 py-2">Material</th><th scope="col" className="px-3 py-2 text-right">Berlaku</th><th scope="col" className="px-3 py-2 text-right">Excel</th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {p.mdu_differences.items.map((m) => <tr key={m.code}><td className="px-3 py-2"><span className="font-semibold">{m.name}</span><span className="block font-mono text-[10px] text-slate-400">{m.code}</span></td><td className="px-3 py-2 text-right font-mono">{m.current === null || m.current === undefined ? '-' : m.current.toLocaleString('id-ID')}</td><td className="px-3 py-2 text-right font-mono font-semibold">{m.excel.toLocaleString('id-ID')}</td></tr>)}
              </tbody>
            </table>
          </div>
          {p.mdu_differences.count > p.mdu_differences.items.length && <p className="mt-1 text-[11px] text-slate-500">Menampilkan {p.mdu_differences.items.length} dari {p.mdu_differences.count.toLocaleString('id-ID')} barang.</p>}
          {can && (
            <div className="mt-3">
              <Button type="button" variant="secondary" size="sm" onClick={() => setCloneOpen(true)}>Buat draf dari buku berlaku</Button>
              <span className="ml-2 text-[11px] text-slate-500">Drafnya berisi salinan buku berlaku; nilai MDU diubah per barang di draf itu.</span>
            </div>
          )}
          <PriceBookCloneModal
            open={cloneOpen}
            onClose={() => setCloneOpen(false)}
            onCreated={(created) => {
              setCloneOpen(false)
              notify({ type: 'success', title: 'Draf buku harga dibuat', desc: 'Ubah nilai MDU per barang di halaman rincian draf, lalu minta persetujuan.', tag: 'Buku Harga' })
              if (created?.id) navigate(`/master-data/harga/${created.id}`)
            }}
          />
        </div>
      )}
      {p.note && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{p.note}</p>}
      <Problems items={p.problems} />
      <ApplyBar dataset="PRICE" label="Buat buku harga DRAFT" defaultValidFrom={defaultValidFrom} needName defaultName={`Buku harga ${today()}`} disabled={!can || p.status !== 'CHANGED'} applied={imp.applied?.PRICE} onApply={onApply} />
      {!can && <p className="mt-2 text-xs text-slate-500">Membuat buku harga memerlukan izin kelola harga.</p>}
    </section>
  )
}

function TariffSection({ imp, can, onApply, defaultValidFrom, perRow = false }) {
  const t = imp.report?.tariff
  if (!t) return null
  return (
    <section className={card} aria-labelledby="mx-tariff">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="mx-tariff" className="text-base font-semibold text-slate-900 dark:text-slate-100">Buku tarif, jam nyala, dan UJL</h3>
        {chip(CHANGE, t.status)}
      </div>
      <p className="text-xs text-slate-500">{perRow ? 'Setiap baris membawa kode ULP-nya sendiri (kosong = semua ULP).' : imp.ulp_code ? `Jam nyala dari ULP ${imp.ulp_code}.` : 'Tanpa ULP: baris berlaku untuk semua ULP.'} {t.book ? `Dasar perbandingan: ${t.book}.` : ''}</p>
      <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4 text-xs">
        {[['Baris di Excel', t.excel_rows], ['Baris berlaku', t.current_rows], ['Berubah', t.changed_rows], ['Baru', t.added_rows]].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60 p-3"><dt className="text-slate-500">{l}</dt><dd className="mt-0.5 text-lg font-bold text-slate-900 dark:text-slate-100">{(v ?? 0).toLocaleString('id-ID')}</dd></div>
        ))}
      </dl>
      {t.samples?.length > 0 && <ul className="mt-3 space-y-1 text-xs">{t.samples.map((s) => <li key={s.key}><strong>{s.key}</strong>: <span className="line-through text-slate-400">{s.before}</span> → {s.after}</li>)}</ul>}
      {t.note && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{t.note}</p>}
      {t.warnings?.map((w) => <div key={w} className="mt-2"><Alert variant="warning">{w}</Alert></div>)}
      {t.coverage_after?.length > 0 && (
        <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">Setelah diterapkan: {t.coverage_after.filter((c) => c.rows > 0).map((c) => `${c.name} ${c.rows} baris`).join(', ') || 'belum ada baris'}{t.coverage_after.some((c) => c.rows === 0 && c.code !== '') ? `. Belum ada: ${t.coverage_after.filter((c) => c.rows === 0 && c.code !== '').map((c) => c.name).join(', ')}.` : '.'}</p>
      )}
      <Problems items={t.problems} />
      <ApplyBar dataset="TARIFF" label="Buat buku tarif DRAFT" defaultValidFrom={defaultValidFrom} needName defaultName={`Buku tarif ${today()}`} disabled={!can || t.status !== 'CHANGED'} applied={imp.applied?.TARIFF} onApply={onApply} />
      {!can && <p className="mt-2 text-xs text-slate-500">Membuat buku tarif memerlukan izin kelola tarif.</p>}
    </section>
  )
}

function KkfSection({ imp, can, onApply, defaultValidFrom }) {
  const k = imp.report?.kkf
  if (!k) return null
  const c = k.cases || {}
  const fmt = (v) => (typeof v === 'number' ? v.toLocaleString('id-ID', { maximumFractionDigits: 6 }) : v)
  return (
    <section className={card} aria-labelledby="mx-kkf">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="mx-kkf" className="text-base font-semibold text-slate-900 dark:text-slate-100">Parameter KKF</h3>
        {chip(CHANGE, k.status)}
      </div>
      <p className="text-xs text-slate-500">{k.set ? `Dasar perbandingan: ${k.set}.` : 'Belum ada set parameter yang disetujui.'} Contoh hitung (UJI_KKF) dicocokkan dengan mesin KKF memakai parameter di berkas ini.</p>
      <p className="mt-2 text-xs text-slate-600 dark:text-slate-300">{c.mismatch_count > 0 ? <span className="text-rose-600">{`Hasil contoh berbeda di ${c.mismatch_count} sel`}</span> : `Hasil contoh cocok (${c.checked ?? 0} nilai diuji${c.skipped ? `, ${c.skipped} contoh tanpa hasil dilewati` : ''})`}</p>
      {k.changes?.length > 0 && (
        <ul className="mt-3 space-y-1 text-xs">{k.changes.map((x) => <li key={x.field}><strong>{x.label}</strong>: <span className="line-through text-slate-400">{fmt(x.before)}</span> → {fmt(x.after)}</li>)}</ul>
      )}
      <Problems items={k.problems} />
      <ApplyBar dataset="KKF" label="Buat set parameter KKF DRAFT" defaultValidFrom={defaultValidFrom} needName defaultName={`Parameter KKF ${today()}`} disabled={!can || !['CHANGED', 'NEW'].includes(k.status)} applied={imp.applied?.KKF} onApply={onApply} />
      {!can && <p className="mt-2 text-xs text-slate-500">Membuat set parameter KKF memerlukan izin kelola parameter KKF.</p>}
    </section>
  )
}

function DistrivaSummaryCards({ imp }) {
  const r = imp.report || {}
  const bomGroups = r.bom?.groups || []
  const bomChanged = bomGroups.filter((g) => g.status === 'CHANGED').length
  const bomBlocked = bomGroups.filter((g) => g.status === 'BLOCKED').length
  const bomStatus = bomBlocked > 0 ? 'BLOCKED' : bomChanged > 0 ? 'CHANGED' : 'UNCHANGED'

  const items = [
    r.bom && {
      key: 'BOM',
      anchor: 'mx-bom',
      label: 'BOM',
      status: bomStatus,
      detail: bomChanged > 0 ? `${bomChanged} kelompok berubah` : bomBlocked > 0 ? `${bomBlocked} perlu dibereskan` : `${bomGroups.length} kelompok sama`,
    },
    r.price && {
      key: 'PRICE',
      anchor: 'mx-price',
      label: 'Buku Harga',
      status: r.price.status,
      detail: `${(r.price.changed_rows ?? 0).toLocaleString('id-ID')} baris berubah`,
    },
    r.tariff && {
      key: 'TARIFF',
      anchor: 'mx-tariff',
      label: 'Buku Tarif',
      status: r.tariff.status,
      detail: `${((r.tariff.changed_rows ?? 0) + (r.tariff.added_rows ?? 0)).toLocaleString('id-ID')} berubah/baru`,
    },
    r.kkf && {
      key: 'KKF',
      anchor: 'mx-kkf',
      label: 'KKF',
      status: r.kkf.status,
      detail: `${r.kkf.changes?.length ?? 0} parameter berubah`,
    },
  ].filter(Boolean)

  if (items.length === 0) return null

  const jumpTo = (anchor) => {
    const el = document.getElementById(anchor)
    el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
  }

  return (
    <div className="mt-4 grid grid-cols-2 gap-2.5 lg:grid-cols-4" aria-label="Ringkasan pemeriksaan dataset">
      {items.map((it) => {
        const isApplied = imp.applied?.[it.key]?.status === 'OK'
        return (
          <button
            key={it.key}
            type="button"
            onClick={() => jumpTo(it.anchor)}
            className="flex flex-col items-start justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/50 p-3 text-left transition hover:border-emerald-300 dark:hover:border-emerald-700 cursor-pointer"
          >
            <div className="flex w-full items-center justify-between gap-1.5">
              <span className="text-xs font-bold text-slate-800 dark:text-slate-100">{it.label}</span>
              {isApplied ? (
                <span className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300">
                  <IconCheck className="h-3 w-3" /> DRAFT
                </span>
              ) : (
                chip(CHANGE, it.status)
              )}
            </div>
            <span className="mt-1.5 text-[11px] text-slate-500 dark:text-slate-400">{it.detail}</span>
          </button>
        )
      })}
    </div>
  )
}

function DistrivaSection({ imp, can, onApply }) {
  const r = imp.report || {}
  const m = r.meta || {}
  return (
    <>
      <section className={card} aria-labelledby="mx-distriva">
        <h3 id="mx-distriva" className="text-base font-semibold text-slate-900 dark:text-slate-100">Template MASTER DISTRIVA</h3>
        <dl className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
          {[['Versi template', m.template_version || '-'], ['Berlaku sejak', m.valid_from || '-'], ['Dasar perubahan', m.basis || '-']].map(([l, v]) => (
            <div key={l} className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-850/60 p-3"><dt className="text-slate-500">{l}</dt><dd className="mt-0.5 font-semibold text-slate-900 dark:text-slate-100 break-words">{v}</dd></div>
          ))}
        </dl>
        {!r.blocked && <DistrivaSummaryCards imp={imp} />}
        {r.layout_problem_count > 0 && (
          <div className="mt-3">
            <Alert variant="error">{`${r.layout_problem_count} masalah pada susunan berkas. Perbaiki sel yang disebut di Excel lalu unggah ulang; belum ada yang dibandingkan.`}</Alert>
            <Problems items={r.layout_problems} />
          </div>
        )}
      </section>
      {!r.blocked && <BomSection imp={imp} can={can.bom} onApply={onApply} defaultValidFrom={m.valid_from} workbook />}
      {!r.blocked && <PriceSection imp={imp} can={can.price} onApply={onApply} defaultValidFrom={m.valid_from} />}
      {!r.blocked && <TariffSection imp={imp} can={can.tariffs} onApply={onApply} defaultValidFrom={m.valid_from} perRow />}
      {!r.blocked && <KkfSection imp={imp} can={can.kkf} onApply={onApply} defaultValidFrom={m.valid_from} />}
      {!r.blocked && r.rab && (r.rab.status === 'MISMATCH'
        ? <Alert variant="warning">{`Pembulatan RAB di Excel berbeda dengan aturan DISTRIVA di ${r.rab.mismatch_count} sel (${r.rab.mismatches.slice(0, 3).map((x) => `${x.cell}: Excel ${x.excel}, DISTRIVA ${x.distriva}`).join('; ')}). Unggahan ini tidak mengubah aturan RAB; bila memang berubah, program perlu disesuaikan oleh pengembang.`}</Alert>
        : r.rab.checked > 0 && <p className="text-xs text-slate-500">{`Uji pembulatan RAB cocok (${r.rab.checked} nilai diuji).`}</p>)}
      {!r.blocked && r.rules?.status === 'DIFFERENT' && (
        <Alert variant="warning">{`Aturan tetap di berkas berbeda dengan program DISTRIVA: ${r.rules.differences.map((d) => `${d.label} (Excel ${d.workbook}, DISTRIVA ${d.distriva})`).join('; ')}. Unggahan ini tidak mengubah aturan tersebut; bila memang berubah, program perlu disesuaikan oleh pengembang.`}</Alert>
      )}
    </>
  )
}

function Detail({ imp, can, onChanged, onRemoved }) {
  const { notify } = useNotifications()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const apply = async (body) => {
    try {
      const r = await masterExcelApi.apply(imp.id, body)
      notify({ type: 'success', title: 'Dibuat sebagai DRAFT', desc: r?.data?.message || 'Menunggu persetujuan akun lain.', tag: 'Excel' })
      onChanged(r?.import)
    } catch (err) {
      notify({ type: 'error', title: 'Tidak dapat diterapkan', desc: err?.message || 'Terjadi kesalahan.', tag: 'Excel' })
    }
  }
  const recheck = async () => {
    try { onChanged((await masterExcelApi.recheck(imp.id))?.data) } catch (err) { notify({ type: 'error', title: 'Tidak dapat diperiksa ulang', desc: err?.message || 'Terjadi kesalahan.', tag: 'Excel' }) }
  }
  return (
    <div className="space-y-4" aria-live="polite">
      <div className={`${card} border-emerald-200/80 dark:border-emerald-900/60 flex flex-wrap items-center justify-between gap-3`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 break-all">{imp.file_name}</h2>{chip(STATE, imp.status)}</div>
          <p className="text-xs text-slate-500">{KIND[imp.kind]} · {fmtSize(imp.size_bytes)} · diunggah {fmtWhen(imp.created_at)} oleh {imp.uploaded_by_name || '-'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={IconRefresh} onClick={recheck} disabled={imp.status === 'PROCESSING'}>Periksa ulang</Button>
          <Button variant="secondary" icon={IconTrash} onClick={() => setConfirmRemove(true)}>Hapus berkas</Button>
        </div>
      </div>
      {imp.status === 'PROCESSING' && (
        <div className={`${card} flex items-center gap-3 border-blue-200 bg-blue-50/50 dark:border-blue-900/60 dark:bg-blue-950/20 text-sm text-blue-900 dark:text-blue-200`}>
          <Spinner />
          <div>
            <p className="font-semibold">Membaca Excel dan membandingkan dengan data yang berlaku…</p>
            <p className="text-xs text-blue-700/80 dark:text-blue-300/80">Halaman ini akan memperbarui otomatis saat pemeriksaan selesai.</p>
          </div>
        </div>
      )}
      {imp.status === 'FAILED' && <Alert variant="error">{imp.message || 'Berkas gagal diperiksa.'}</Alert>}
      {imp.status === 'READY' && imp.report && (
        <>
          {imp.kind === 'DISTRIVA' && <DistrivaSection imp={imp} can={can} onApply={apply} />}
          {imp.kind === 'RAB_KKF' && <BomSection imp={imp} can={can.bom} onApply={apply} />}
          {imp.kind === 'RAB_KKF' && <PriceSection imp={imp} can={can.price} onApply={apply} />}
          {imp.kind === 'TARIF' && <TariffSection imp={imp} can={can.tariffs} onApply={apply} />}
          {imp.report.new_khs?.count > 0 && <Alert variant="info">{`${imp.report.new_khs.count} KHS baru di Excel tidak diimpor dari layar ini. ${imp.report.new_khs.note}`}</Alert>}
        </>
      )}
      <ConfirmationModal open={confirmRemove} variant="danger" title="Hapus berkas Excel?" confirmLabel="Hapus"
        description="Berkas dan hasil pemeriksaannya dihapus dari server. DRAFT yang sudah dibuat dari berkas ini tidak ikut terhapus."
        onClose={() => setConfirmRemove(false)} onConfirm={async () => { await masterExcelApi.remove(imp.id); setConfirmRemove(false); onRemoved(imp.id) }} />
    </div>
  )
}

/** Impor master dari Excel: unggah, periksa terhadap data yang berlaku, lalu terapkan hanya perubahan sebagai DRAFT (disetujui akun lain). */
export default function MasterExcelImportPage() {
  const { notify } = useNotifications()
  const [state, setState] = useState({ loading: true, error: '', rows: [], can: {}, limits: {}, coverage: [] })
  const [selected, setSelected] = useState(null)
  const [units, setUnits] = useState([])
  const [uploadTab, setUploadTab] = useState('DISTRIVA') // 'DISTRIVA' | 'RAB_KKF' | 'TARIF'
  const [historyKind, setHistoryKind] = useState('ALL')
  const detailRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const r = await masterExcelApi.list()
      setState({ loading: false, error: '', rows: r?.data || [], can: r?.can || {}, limits: r?.limits || {}, coverage: r?.tariff_coverage || [] })
      return r?.data || []
    } catch (err) {
      setState((s) => ({ ...s, loading: false, error: err?.message || 'Gagal memuat daftar berkas.' }))
      return []
    }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { adminApi.units().then((r) => setUnits((r?.data || []).filter((u) => u.unit_type === 'ULP'))).catch(() => setUnits([])) }, [])

  const scrollToDetail = useCallback(() => {
    setTimeout(() => {
      detailRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'start' })
    }, 50)
  }, [])

  const open = useCallback(async (id) => {
    try {
      const next = (await masterExcelApi.get(id))?.data || null
      setSelected(next)
      if (next) scrollToDetail()
    } catch {
      setSelected(null)
    }
  }, [scrollToDetail])

  useEffect(() => {
    if (selected?.status !== 'PROCESSING') return undefined
    const t = setInterval(async () => {
      const r = await masterExcelApi.get(selected.id).catch(() => null)
      if (r?.data) { setSelected(r.data); if (r.data.status !== 'PROCESSING') load() }
    }, 2500)
    return () => clearInterval(t)
  }, [selected, load])

  const nothing = !state.can.rab && !state.can.tariff && !state.can.bom && !state.can.price && !state.can.tariffs && !state.can.kkf
  const canDistriva = Boolean(state.can.bom || state.can.price || state.can.tariffs || state.can.kkf)
  const [downloading, setDownloading] = useState(false)
  const downloadTemplate = async () => {
    setDownloading(true)
    try {
      const { blob, filename } = await masterExcelApi.template()
      triggerFileDownload(blob, filename)
    } catch (err) {
      notify({ type: 'error', title: 'Template tidak dapat diunduh', desc: err?.message || 'Terjadi kesalahan.', tag: 'Excel' })
    } finally {
      setDownloading(false)
    }
  }

  const activeStep = useMemo(() => {
    if (selected?.applied && Object.values(selected.applied).some((a) => a?.status === 'OK')) return 3
    if (selected && ['PROCESSING', 'READY', 'FAILED'].includes(selected.status)) return 2
    return 1
  }, [selected])

  const filteredHistory = useMemo(() => {
    if (historyKind === 'ALL') return state.rows
    return state.rows.filter((r) => r.kind === historyKind)
  }, [state.rows, historyKind])

  const uploadTabs = [
    { id: 'DISTRIVA', label: 'MASTER DISTRIVA', badge: 'Direkomendasikan', locked: !canDistriva },
    { id: 'RAB_KKF', label: 'Excel RAB & KKF', locked: !state.can.rab },
    { id: 'TARIF', label: 'Excel Tarif & Jam Nyala', locked: !state.can.tariff },
  ]

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-emerald-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/20 p-4 sm:p-5 shadow-xs">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Impor Master dari Excel</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">
          Unggah Excel master, sistem membacanya dan membandingkannya dengan data yang berlaku. Hanya yang berbeda yang dibuat sebagai versi <strong>DRAFT</strong>; data yang sudah disetujui, nilai MDU, dan zona tidak tertimpa, dan akun lain menyetujuinya di halaman masing-masing.
        </p>
        <WorkflowStepper activeStep={activeStep} />
        <p className="mt-3 flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400">
          <IconInfo className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <span>Berkas .xlsx maksimal {state.limits.max_mb || 60} MB, tanpa makro. KHS baru dan jenis konstruksi belum dicakup di sini; impor lewat halamannya.</span>
        </p>
      </header>

      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.loading ? <div className="flex justify-center py-10"><Spinner /></div> : nothing ? (
        <EmptyState title="Tidak ada akses" description="Impor dari Excel memerlukan izin kelola BOM, harga, atau tarif." />
      ) : (
        <>
          {/* Tab Pemilih Jenis Berkas Unggahan */}
          <div className="space-y-3">
            <div role="tablist" aria-label="Pilih jenis berkas Excel" className="flex flex-wrap items-center gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2">
              {uploadTabs.map((t) => {
                const active = uploadTab === t.id
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setUploadTab(t.id)}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3.5 py-2 text-xs sm:text-sm font-semibold transition cursor-pointer ${
                      active
                        ? 'bg-emerald-600 text-white shadow-xs'
                        : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
                    }`}
                  >
                    <span>{t.label}</span>
                    {t.badge && (
                      <span
                        className={`rounded-full px-1.5 py-0.5 text-[10px] font-bold ${
                          active
                            ? 'bg-white/20 text-white'
                            : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                        }`}
                      >
                        {t.badge}
                      </span>
                    )}
                    {t.locked && <IconLock className={`h-3.5 w-3.5 ${active ? 'text-white/80' : 'text-slate-400'}`} />}
                  </button>
                )
              })}
            </div>

            {uploadTab === 'DISTRIVA' && (
              <UploadCard
                kind="DISTRIVA"
                title="MASTER DISTRIVA (template untuk unit induk)"
                badge="Direkomendasikan"
                hint="Unduh template berisi aturan BOM, harga, tarif, dan parameter KKF yang berlaku, isi di Excel (kirim ke unit induk bila perlu), lalu unggah kembali. Hasil hitung Excel dicocokkan dengan mesin DISTRIVA sebelum menjadi DRAFT."
                disabled={!canDistriva}
                units={units}
                maxMb={state.limits.max_mb || 60}
                actions={<Button variant="secondary" icon={IconDownload} loading={downloading} onClick={downloadTemplate}>Unduh template</Button>}
                onUploaded={(imp) => {
                  setSelected(imp)
                  load()
                  scrollToDetail()
                }}
              />
            )}

            {uploadTab === 'RAB_KKF' && (
              <UploadCard
                kind="RAB_KKF"
                title="Excel RAB & KKF"
                hint="Memeriksa BOM dan buku harga (MASTER RAB & KKF.xlsx)."
                disabled={!state.can.rab}
                units={units}
                maxMb={state.limits.max_mb || 60}
                onUploaded={(imp) => {
                  setSelected(imp)
                  load()
                  scrollToDetail()
                }}
              />
            )}

            {uploadTab === 'TARIF' && (
              <UploadCard
                kind="TARIF"
                title="Excel Tarif & Jam Nyala"
                hint="Memeriksa harga rata-rata, jam nyala, dan UJL (MASTER TARIF & JAM NYALA.xlsx)."
                disabled={!state.can.tariff}
                units={units}
                coverage={state.coverage}
                maxMb={state.limits.max_mb || 60}
                onUploaded={(imp) => {
                  setSelected(imp)
                  load()
                  scrollToDetail()
                }}
              />
            )}
          </div>

          <div ref={detailRef}>
            {selected && <Detail key={selected.id} imp={selected} can={state.can} onChanged={(imp) => { imp && setSelected(imp); load() }} onRemoved={() => { setSelected(null); load() }} />}
          </div>

          <section className={card} aria-labelledby="mx-history">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <h2 id="mx-history" className="text-base font-semibold text-slate-900 dark:text-slate-100">Riwayat unggahan</h2>
                <span className="rounded-full bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                  {filteredHistory.length}
                </span>
              </div>
              {state.rows.length > 0 && (
                <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Filter jenis riwayat unggahan">
                  {[
                    ['ALL', 'Semua'],
                    ['DISTRIVA', 'MASTER DISTRIVA'],
                    ['RAB_KKF', 'RAB & KKF'],
                    ['TARIF', 'Tarif'],
                  ].map(([k, lbl]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setHistoryKind(k)}
                      className={`rounded-lg px-2.5 py-1 text-[11px] font-semibold transition cursor-pointer ${
                        historyKind === k
                          ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:hover:bg-slate-700'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {filteredHistory.length === 0 ? (
              <p className="mt-3 text-sm text-slate-500">
                {state.rows.length === 0 ? 'Belum ada berkas yang diunggah.' : 'Tidak ada riwayat untuk jenis berkas ini.'}
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                {filteredHistory.map((r) => {
                  const isActive = selected?.id === r.id
                  const appliedKeys = Object.entries(r.applied || {})
                    .filter(([, v]) => v?.status === 'OK')
                    .map(([k]) => DATASET_SHORT[k] || k)
                  return (
                    <li
                      key={r.id}
                      className={`flex flex-wrap items-center justify-between gap-2 py-2.5 px-2.5 -mx-2.5 rounded-xl transition ${
                        isActive ? 'bg-emerald-50/70 dark:bg-emerald-950/30 ring-1 ring-emerald-200 dark:ring-emerald-800' : ''
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="break-all text-sm font-medium text-slate-900 dark:text-slate-100">{r.file_name}</p>
                          {isActive && (
                            <span className="rounded-full bg-emerald-600 px-2 py-0.5 text-[10px] font-bold text-white">
                              Sedang dibuka
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                          <span>{KIND[r.kind]} · {fmtWhen(r.created_at)} · {r.uploaded_by_name || '-'}</span>
                          {appliedKeys.map((ds) => (
                            <span
                              key={ds}
                              className="inline-flex items-center gap-0.5 rounded-full border border-emerald-200 bg-emerald-50 px-1.5 py-0 text-[10px] font-semibold text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300"
                            >
                              {ds} ✓
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {chip(STATE, r.status)}
                        <Button size="sm" variant={isActive ? 'primary' : 'secondary'} onClick={() => open(r.id)}>
                          Buka
                        </Button>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
