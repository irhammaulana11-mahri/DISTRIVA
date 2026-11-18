import { useCallback, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { masterExcelApi, adminApi, triggerFileDownload } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import ConfirmationModal from '../../components/ConfirmationModal.jsx'
import { IconUpload, IconDownload, IconRefresh, IconTrash, IconCheckCircle, IconAlertCircle, IconInfo } from '../../components/icons.jsx'

const fmtSize = (b) => (b >= 1024 ** 2 ? `${(b / 1024 ** 2).toFixed(1).replace('.', ',')} MB` : `${Math.max(1, Math.round(b / 1024))} KB`)
const fmtWhen = (iso) => {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' })
}
const today = () => new Date().toISOString().slice(0, 10)
const KIND = { RAB_KKF: 'Excel RAB & KKF', TARIF: 'Excel Tarif & Jam Nyala', DISTRIVA: 'MASTER DISTRIVA' }
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

function UploadCard({ kind, title, hint, disabled, units, coverage = [], onUploaded, className = '', actions = null }) {
  const { notify } = useNotifications()
  const ref = useRef(null)
  const [file, setFile] = useState(null)
  const [ulp, setUlp] = useState('')
  const [busy, setBusy] = useState(false)
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
      setFile(null)
      if (ref.current) ref.current.value = ''
      onUploaded(r?.data)
    } catch (err) {
      notify({ type: 'error', title: 'Berkas ditolak', desc: err?.message || 'Gagal mengunggah.', tag: 'Excel' })
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className={`${card} ${className}`} aria-label={title}>
      <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>
      <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>
      {disabled ? <p className="mt-3 rounded-lg bg-slate-50 dark:bg-slate-850 p-3 text-xs text-slate-500">Akun Anda tidak berwenang menyiapkan data ini.</p> : (
        <div className="mt-3 space-y-3">
          <input ref={ref} type="file" accept=".xlsx" aria-label={`Berkas ${title}`} onChange={(e) => setFile(e.target.files?.[0] || null)}
            className="block w-full text-sm text-slate-600 dark:text-slate-300 file:mr-3 file:rounded-lg file:border-0 file:bg-emerald-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-emerald-700 hover:file:bg-emerald-100" />
          {kind === 'TARIF' && (
            <div>
              <label htmlFor="mx-ulp" className="block text-[11px] font-medium text-slate-500">Jam nyala dalam berkas ini berasal dari ULP</label>
              <select id="mx-ulp" value={ulp} onChange={(e) => setUlp(e.target.value)} className={`${input} w-full`}>
                <option value="">Semua ULP (berlaku umum)</option>
                {units.map((u) => <option key={u.id} value={u.code}>{u.code} · {u.name}</option>)}
              </select>
            </div>
          )}
          {kind === 'TARIF' && coverage.length > 0 && (
            <div aria-label="Cakupan ULP pada buku tarif berlaku">
              <p className="text-[11px] font-medium text-slate-500">Jam nyala dan UJL pada buku tarif berlaku</p>
              <ul className="mt-1 flex flex-wrap gap-1.5">
                {coverage.filter((c) => c.code !== '').map((c) => (
                  <li key={c.code} className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${c.rows > 0 ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300' : 'border-slate-200 bg-slate-50 text-slate-500 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400'}`}>
                    {c.name} · {c.rows > 0 ? `${c.rows} baris` : 'belum ada'}
                  </li>
                ))}
              </ul>
              <p className="mt-1 text-[11px] text-slate-500">Untuk menambah atau memperbarui satu ULP: pilih ULP itu, unggah laporan penjualannya, terapkan. ULP lain tidak berubah.</p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <Button icon={IconUpload} onClick={submit} loading={busy} disabled={!file}>Unggah &amp; periksa</Button>
            {actions}
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

function PriceSection({ imp, can, onApply }) {
  const p = imp.report?.price
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
      {p.new_codes?.count > 0 && <Alert variant="warning">{`${p.new_codes.count} kode di Excel belum punya kode baru, jadi tidak ikut diterapkan: ${p.new_codes.items.join(', ')}${p.new_codes.count > p.new_codes.items.length ? ', …' : ''}.`}</Alert>}
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
      {p.note && <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{p.note}</p>}
      <Problems items={p.problems} />
      <ApplyBar dataset="PRICE" label="Buat buku harga DRAFT" needName defaultName={`Buku harga ${today()}`} disabled={!can || p.status !== 'CHANGED'} applied={imp.applied?.PRICE} onApply={onApply} />
      {!can && <p className="mt-2 text-xs text-slate-500">Membuat buku harga memerlukan izin kelola harga.</p>}
    </section>
  )
}

function TariffSection({ imp, can, onApply }) {
  const t = imp.report?.tariff
  if (!t) return null
  return (
    <section className={card} aria-labelledby="mx-tariff">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 id="mx-tariff" className="text-base font-semibold text-slate-900 dark:text-slate-100">Buku tarif, jam nyala, dan UJL</h3>
        {chip(CHANGE, t.status)}
      </div>
      <p className="text-xs text-slate-500">{imp.ulp_code ? `Jam nyala dari ULP ${imp.ulp_code}.` : 'Tanpa ULP: baris berlaku untuk semua ULP.'} {t.book ? `Dasar perbandingan: ${t.book}.` : ''}</p>
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
      <ApplyBar dataset="TARIFF" label="Buat buku tarif DRAFT" needName defaultName={`Buku tarif ${today()}`} disabled={!can || t.status !== 'CHANGED'} applied={imp.applied?.TARIFF} onApply={onApply} />
      {!can && <p className="mt-2 text-xs text-slate-500">Membuat buku tarif memerlukan izin kelola tarif.</p>}
    </section>
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
        {r.layout_problem_count > 0 && (
          <div className="mt-3">
            <Alert variant="error">{`${r.layout_problem_count} masalah pada susunan berkas. Perbaiki sel yang disebut di Excel lalu unggah ulang; belum ada yang dibandingkan.`}</Alert>
            <Problems items={r.layout_problems} />
          </div>
        )}
      </section>
      {!r.blocked && <BomSection imp={imp} can={can.bom} onApply={onApply} defaultValidFrom={m.valid_from} workbook />}
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
      <div className={`${card} flex flex-wrap items-center justify-between gap-3`}>
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2"><h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 break-all">{imp.file_name}</h2>{chip(STATE, imp.status)}</div>
          <p className="text-xs text-slate-500">{KIND[imp.kind]} · {fmtSize(imp.size_bytes)} · diunggah {fmtWhen(imp.created_at)} oleh {imp.uploaded_by_name || '-'}</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={IconRefresh} onClick={recheck} disabled={imp.status === 'PROCESSING'}>Periksa ulang</Button>
          <Button variant="secondary" icon={IconTrash} onClick={() => setConfirmRemove(true)}>Hapus berkas</Button>
        </div>
      </div>
      {imp.status === 'PROCESSING' && <div className="flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300"><Spinner /> Membaca Excel dan membandingkan dengan data yang berlaku…</div>}
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

  const open = useCallback(async (id) => {
    try { setSelected((await masterExcelApi.get(id))?.data || null) } catch { setSelected(null) }
  }, [])
  useEffect(() => {
    if (selected?.status !== 'PROCESSING') return undefined
    const t = setInterval(async () => {
      const r = await masterExcelApi.get(selected.id).catch(() => null)
      if (r?.data) { setSelected(r.data); if (r.data.status !== 'PROCESSING') load() }
    }, 2500)
    return () => clearInterval(t)
  }, [selected, load])

  const nothing = !state.can.rab && !state.can.tariff && !state.can.bom
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

  return (
    <div className="space-y-5">
      <header className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-emerald-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/20 p-4 sm:p-5 shadow-xs">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Impor Master dari Excel</h1>
        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-3xl leading-relaxed">Unggah Excel master, sistem membacanya dan membandingkannya dengan data yang berlaku. Hanya yang berbeda yang dibuat sebagai versi <strong>DRAFT</strong>; data yang sudah disetujui, nilai MDU, dan zona tidak tertimpa, dan akun lain menyetujuinya di halaman masing-masing.</p>
        <p className="mt-2 flex items-start gap-1.5 text-xs text-slate-500 dark:text-slate-400"><IconInfo className="mt-0.5 h-3.5 w-3.5 shrink-0" /> <span>Berkas .xlsx maksimal {state.limits.max_mb || 60} MB, tanpa makro. KHS baru dan jenis konstruksi belum dicakup di sini; impor lewat halamannya.</span></p>
      </header>

      {state.error && <Alert variant="error">{state.error}</Alert>}
      {state.loading ? <div className="flex justify-center py-10"><Spinner /></div> : nothing ? (
        <EmptyState title="Tidak ada akses" description="Impor dari Excel memerlukan izin kelola BOM, harga, atau tarif." />
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-2">
            <UploadCard kind="DISTRIVA" className="lg:col-span-2" title="MASTER DISTRIVA (template untuk unit induk)" hint="Unduh template berisi aturan BOM yang berlaku, isi di Excel (kirim ke unit induk bila perlu), lalu unggah kembali. Hasil hitung Excel dicocokkan dengan mesin DISTRIVA sebelum menjadi DRAFT." disabled={!state.can.bom} units={units} actions={<Button variant="secondary" icon={IconDownload} loading={downloading} onClick={downloadTemplate}>Unduh template</Button>} onUploaded={(imp) => { setSelected(imp); load() }} />
            <UploadCard kind="RAB_KKF" title="Excel RAB & KKF" hint="Memeriksa BOM dan buku harga (MASTER RAB & KKF.xlsx)." disabled={!state.can.rab} units={units} onUploaded={(imp) => { setSelected(imp); load() }} />
            <UploadCard kind="TARIF" title="Excel Tarif & Jam Nyala" hint="Memeriksa harga rata-rata, jam nyala, dan UJL (MASTER TARIF & JAM NYALA.xlsx)." disabled={!state.can.tariff} units={units} coverage={state.coverage} onUploaded={(imp) => { setSelected(imp); load() }} />
          </div>

          {selected && <Detail key={selected.id} imp={selected} can={state.can} onChanged={(imp) => { imp && setSelected(imp); load() }} onRemoved={() => { setSelected(null); load() }} />}

          <section className={card} aria-labelledby="mx-history">
            <h2 id="mx-history" className="text-base font-semibold text-slate-900 dark:text-slate-100">Riwayat unggahan</h2>
            {state.rows.length === 0 ? <p className="mt-2 text-sm text-slate-500">Belum ada berkas yang diunggah.</p> : (
              <ul className="mt-3 divide-y divide-slate-100 dark:divide-slate-800">
                {state.rows.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                    <div className="min-w-0"><p className="break-all text-sm font-medium text-slate-900 dark:text-slate-100">{r.file_name}</p><p className="text-xs text-slate-500">{KIND[r.kind]} · {fmtWhen(r.created_at)} · {r.uploaded_by_name || '-'}</p></div>
                    <div className="flex items-center gap-2">{chip(STATE, r.status)}<Button size="sm" variant="secondary" onClick={() => open(r.id)}>Buka</Button></div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}
