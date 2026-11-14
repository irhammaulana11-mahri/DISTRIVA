import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { poleWorkOrdersApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Modal from '../../components/Modal.jsx'
import Spinner from '../../components/Spinner.jsx'
import { IconArrowLeft } from '../../components/icons.jsx'
import { PoleWoStatusBadge } from './PoleWoStatusBadge.jsx'

const inputCls = 'block w-full px-3 py-2 text-base sm:text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800'
const today = () => new Date().toISOString().slice(0, 10)

const EVENT_LABEL = {
  CREATED: 'Dibuat', UPDATED: 'Diubah', LETTER_ATTACHED: 'Lampiran surat', ISSUED: 'Diterbitkan', CANCELLED: 'Dibatalkan',
  PROGRESS_SUBMITTED: 'Progres dilaporkan', PROGRESS_VERIFIED: 'Progres diverifikasi', PROGRESS_RETURNED: 'Progres dikembalikan',
  REVISED: 'Direvisi', BASTP_SUBMITTED: 'BASTP diajukan', BASTP_RETURNED: 'BASTP dikembalikan', COMPLETED: 'Selesai',
}

function Section({ title, children, right, className = '' }) {
  return (
    <section className={`rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs ${className}`}>
      <div className="px-4 sm:px-5 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between gap-3">
        <h2 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300">{title}</h2>
        {right}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  )
}

const COLS = 'lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)_minmax(0,.7fr)_minmax(0,1.2fr)_3.5rem_minmax(0,1.3fr)_auto]'
const cellLabel = 'before:content-[attr(data-label)] before:block before:mb-0.5 before:text-[10px] before:uppercase before:font-semibold before:text-slate-400 lg:before:hidden'

/** Detail WO Tiang (halaman penuh, atau `embedded` di dalam tab WO Tiang pada halaman agenda): lokasi, progres vendor (dilaporkan hanya oleh pabrikan tiang, diverifikasi Perencanaan), BASTP tiang, riwayat. */
export default function PoleWorkOrderDetailPage({ woId, embedded = false }) {
  const params = useParams()
  const id = woId || params.id
  const navigate = useNavigate()
  const { can } = useAccess()
  const { notify } = useNotifications()
  const canManage = Boolean(can?.['pole_wo.manage'])
  const canClose = Boolean(can?.['pole_wo.close'])
  const isVendor = Boolean(can?.['vendor.portal']) && !canManage

  const [wo, setWo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState('')
  const [modal, setModal] = useState(null) // {type, ...}
  const [form, setForm] = useState({})

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await poleWorkOrdersApi.get(id)
      setWo(res?.data || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat WO Tiang.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  const run = async (key, fn, okTitle, okDesc) => {
    setBusy(key)
    setError('')
    try {
      await fn()
      if (okTitle) notify({ type: 'success', title: okTitle, desc: okDesc || '', tag: 'WO TIANG' })
      setModal(null)
      await load()
    } catch (err) {
      setError(err?.message || 'Aksi gagal.')
      setModal((m) => (m ? { ...m, error: err?.message || 'Aksi gagal.' } : m))
    } finally {
      setBusy('')
    }
  }

  const pendingByLine = useMemo(() => {
    const m = {}
    ;(wo?.progress || []).forEach((p) => { if (p.status === 'SUBMITTED') m[p.line_id] = p })
    return m
  }, [wo])

  const openLetter = async () => {
    try {
      const { blob } = await poleWorkOrdersApi.letterBlob(id)
      window.open(URL.createObjectURL(blob), '_blank', 'noopener')
    } catch (err) {
      setError(err?.message || 'Gagal membuka lampiran.')
    }
  }

  if (loading) return <div className="py-20 text-center"><Spinner size="lg" label="Memuat WO Tiang..." /></div>
  if (!wo) return <Alert kind="error">{error || 'WO Tiang tidak ditemukan.'}</Alert>

  const live = ['ISSUED', 'IN_PROGRESS'].includes(wo.status)
  const allDone = wo.lines.length > 0 && wo.lines.every((l) => l.verified_percent >= 100)
  const hasOpenBastp = wo.bastp.some((b) => b.status === 'SUBMITTED')
  const totalPoles = wo.lines.reduce((a, l) => a + l.quantity, 0)
  const canReport = live && isVendor

  const totalForAvg = wo.lines.reduce((acc, l) => acc + l.quantity, 0)
  const overall = totalForAvg > 0 ? Math.round(wo.lines.reduce((acc, l) => acc + l.quantity * Math.min(100, l.verified_percent), 0) / totalForAvg) : 0

  return (
    <div className="space-y-5">
      <div>
        {!embedded && <nav className="text-xs text-slate-500 mb-1"><Link to="/work-orders" className="hover:underline">SPK / WO</Link><span className="mx-1.5">/</span><span className="font-mono text-slate-800 dark:text-slate-200 break-all">{wo.letter_number}</span></nav>}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          {!embedded && <button type="button" onClick={() => navigate('/work-orders')} aria-label="Kembali ke daftar" className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"><IconArrowLeft size={16} /></button>}
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 font-mono break-all min-w-0">{wo.letter_number}</h1>
          <PoleWoStatusBadge status={wo.status} />
          {wo.revision_number > 0 && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">Revisi {wo.revision_number}</span>}
          <div className="w-full sm:w-auto sm:ml-auto flex flex-wrap gap-2">
            {canManage && wo.status === 'DRAFT' && <Button size="sm" variant="secondary" onClick={() => navigate(`/wo-tiang/${id}/edit`)}>Ubah</Button>}
            {canManage && wo.status === 'DRAFT' && <Button size="sm" variant="primary" loading={busy === 'issue'} onClick={() => run('issue', () => poleWorkOrdersApi.issue(id), 'WO Tiang Diterbitkan', 'Vendor tiang kini dapat melaporkan progres.')}>Terbitkan</Button>}
            {canManage && live && !hasOpenBastp && <Button size="sm" variant="secondary" onClick={() => navigate(`/wo-tiang/${id}/revisi`)}>Revisi</Button>}
            {canManage && ['DRAFT', 'ISSUED', 'IN_PROGRESS'].includes(wo.status) && <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => { setForm({ reason: '' }); setModal({ type: 'cancel' }) }}>Batalkan</Button>}
          </div>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {wo.status === 'CANCELLED' && <Alert kind="error">Dibatalkan: {wo.cancel_reason || '-'}</Alert>}

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
        <aside className="order-1 xl:order-2 space-y-5 xl:sticky xl:top-4">
          <Section title="Surat permintaan">
            <dl className="grid grid-cols-2 xl:grid-cols-1 gap-4 text-xs">
              <div><dt className="text-slate-500">Tanggal surat</dt><dd className="font-semibold">{wo.letter_date}</dd></div>
              <div><dt className="text-slate-500">Lokasi / tiang</dt><dd className="font-semibold">{new Set(wo.lines.map((l) => l.application_id)).size} lokasi · {totalPoles} batang</dd></div>
              <div className="col-span-2 xl:col-span-1"><dt className="text-slate-500">Vendor tiang</dt><dd className="font-semibold break-words">{wo.vendor_name}{wo.vendor_code ? ` (${wo.vendor_code})` : ''}</dd></div>
              <div className="col-span-2 xl:col-span-1"><dt className="text-slate-500">Lampiran surat</dt>
                <dd className="font-semibold">
                  {wo.has_letter ? <button type="button" onClick={openLetter} className="text-blue-700 dark:text-blue-400 hover:underline cursor-pointer break-all text-left">{wo.letter_name || 'Buka lampiran'}</button> : <span className="text-slate-400">Tidak ada</span>}
                  {canManage && ['DRAFT', 'ISSUED', 'IN_PROGRESS'].includes(wo.status) && (
                    <label className="ml-2 text-[11px] text-slate-500 cursor-pointer underline">
                      {wo.has_letter ? 'ganti' : 'unggah'}
                      <input type="file" accept=".pdf,.jpg,.jpeg,.png" className="sr-only" aria-label="Unggah lampiran surat"
                        onChange={(e) => { const f = e.target.files?.[0]; if (f) run('letter', () => poleWorkOrdersApi.uploadLetter(id, f), 'Lampiran Disimpan', f.name) }} />
                    </label>
                  )}
                </dd>
              </div>
              {wo.notes && <div className="col-span-2 xl:col-span-1"><dt className="text-slate-500">Catatan</dt><dd className="break-words">{wo.notes}</dd></div>}
              <div className="col-span-2 xl:col-span-1 pt-3 border-t border-slate-100 dark:border-slate-800">
                <dt className="text-slate-500 mb-1.5">Progres keseluruhan</dt>
                <dd>
                  <div className="h-2 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><div className={`h-full ${overall >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${overall}%` }} /></div>
                  <div className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 font-mono">{overall}% terverifikasi (berbobot jumlah batang)</div>
                </dd>
              </div>
            </dl>
          </Section>
        </aside>

        <div className="order-2 xl:order-1 xl:col-span-2 space-y-5 min-w-0">
          <Section title="Lokasi dan progres">
            <div role="table" aria-label="Lokasi dan progres" className="text-xs">
              <div role="row" className={`hidden lg:grid ${COLS} gap-x-3 pb-2 text-[11px] font-semibold text-slate-500 border-b border-slate-200 dark:border-slate-800`}>
                <div role="columnheader">Permohonan</div><div role="columnheader">Kontrak Rinci</div><div role="columnheader">Jenis</div><div role="columnheader">Kondisi / asal</div><div role="columnheader" className="text-right">Batang</div><div role="columnheader">Terverifikasi</div><div role="columnheader" className="text-right">Aksi</div>
              </div>
              <div className="divide-y divide-slate-100 dark:divide-slate-800">
                {wo.lines.map((l) => {
                  const pending = pendingByLine[l.id]
                  return (
                    <div role="row" key={l.id} className={`grid grid-cols-2 sm:grid-cols-4 ${COLS} gap-x-3 gap-y-2.5 py-3.5 items-start lg:items-center`}>
                      <div role="cell" className="col-span-2 sm:col-span-4 lg:col-span-1 min-w-0"><div className="font-mono font-semibold break-all">{l.application_number}</div><div className="text-[11px] text-slate-500">{l.customer_name || ''}</div></div>
                      <div role="cell" data-label="Kontrak Rinci" className={`font-mono ${cellLabel}`}>{l.kr_number}</div>
                      <div role="cell" data-label="Jenis" className={cellLabel}>Tiang {l.pole_type}</div>
                      <div role="cell" data-label="Kondisi / asal" className={`col-span-2 sm:col-span-1 text-[11px] ${cellLabel}`}>
                        <span className={`px-1.5 py-0.5 rounded font-semibold ${l.pole_condition === 'BEKAS' ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300' : l.pole_condition === 'RELOKASI' ? 'bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300' : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'}`}>{{ BARU: 'Baru', BEKAS: 'Bekas', RELOKASI: 'Relokasi' }[l.pole_condition] || 'Baru'}</span>
                        {l.origin_note && <div className="text-slate-500 mt-0.5 break-words">{l.origin_note}</div>}
                      </div>
                      <div role="cell" data-label="Batang" className={`col-span-2 sm:col-span-1 lg:text-right font-mono ${cellLabel}`}>{l.quantity}</div>
                      <div role="cell" data-label="Terverifikasi" className={`col-span-2 sm:col-span-4 lg:col-span-1 ${cellLabel}`}>
                        <div className="flex items-center gap-2">
                          <div className="h-1.5 w-full max-w-40 lg:w-24 rounded-full bg-slate-200 dark:bg-slate-700 overflow-hidden"><div className={`h-full ${l.verified_percent >= 100 ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: `${Math.min(100, l.verified_percent)}%` }} /></div>
                          <span className="font-mono">{l.verified_percent}%</span>
                        </div>
                        {pending && <div className="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">Menunggu verifikasi: {pending.cumulative_percent}% ({pending.work_date})</div>}
                      </div>
                      <div role="cell" className="col-span-2 sm:col-span-4 lg:col-span-1 flex flex-wrap lg:justify-end gap-1.5 empty:hidden">
                        {canReport && !pending && l.verified_percent < 100 && (
                          <Button size="xs" variant="secondary" onClick={() => { setForm({ percent: String(Math.min(100, Math.max(l.verified_percent, 0))), work_date: today(), notes: '', key: `k-${Date.now()}` }); setModal({ type: 'progress', line: l }) }}>Laporkan progres</Button>
                        )}
                        {canManage && pending && (
                          <>
                            <Button size="xs" variant="primary" loading={busy === `v-${pending.id}`} onClick={() => run(`v-${pending.id}`, () => poleWorkOrdersApi.decideProgress(pending.id, { decision: 'VERIFIED' }), 'Progres Diverifikasi')}>Verifikasi</Button>
                            <Button size="xs" variant="ghost" className="text-rose-600" onClick={() => { setForm({ reason: '' }); setModal({ type: 'return', progress: pending }) }}>Kembalikan</Button>
                          </>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          </Section>

          <Section title="BASTP tiang"
            right={canManage && wo.status === 'IN_PROGRESS' && allDone && !hasOpenBastp && <Button size="sm" variant="primary" onClick={() => { setForm({ number: '', date: today(), notes: '' }); setModal({ type: 'bastp' }) }}>Buat BASTP</Button>}>
            {wo.bastp.length === 0 ? (
              <p className="text-xs text-slate-400">{allDone ? 'Semua lokasi sudah 100%. Perencanaan dapat membuat BASTP.' : 'BASTP dapat dibuat setelah semua lokasi terverifikasi 100%.'}</p>
            ) : (
              <ul className="space-y-2 text-xs">
                {wo.bastp.map((b) => (
                  <li key={b.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 rounded-lg border border-slate-200 dark:border-slate-800 p-3">
                    <span className="font-mono font-bold break-all">{b.bastp_number}</span><span className="text-slate-500">{b.bastp_date} · {b.prepared_by_name}</span>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800">{{ SUBMITTED: 'Menunggu Asman Perencanaan', CLOSED: 'Ditutup', RETURNED: 'Dikembalikan', CANCELLED: 'Dibatalkan' }[b.status] || b.status}</span>
                    {b.return_reason && <span className="text-rose-600">Alasan: {b.return_reason}</span>}
                    {canClose && b.status === 'SUBMITTED' && (
                      <span className="sm:ml-auto flex gap-1.5">
                        <Button size="xs" variant="primary" loading={busy === `c-${b.id}`} onClick={() => run(`c-${b.id}`, () => poleWorkOrdersApi.decideBastp(b.id, { decision: 'CLOSE' }), 'BASTP Ditutup', 'WO Tiang selesai.')}>Tutup BASTP</Button>
                        <Button size="xs" variant="ghost" className="text-rose-600" onClick={() => { setForm({ reason: '' }); setModal({ type: 'bastpReturn', bastp: b }) }}>Kembalikan</Button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {(wo.revisions || []).length > 0 && (
            <Section title="Riwayat revisi">
              <ol className="space-y-2 text-xs">
                {wo.revisions.map((r) => (
                  <li key={r.revision_number} className="flex flex-col sm:flex-row gap-0.5 sm:gap-3">
                    <span className="font-bold sm:w-16 shrink-0">Revisi {r.revision_number}</span>
                    <span>{String(r.created_at).slice(0, 10)} · {r.actor_name} — {r.reason} <span className="text-slate-500">(+{r.added} lokasi, −{r.removed} lokasi, {r.changed} keterangan diubah)</span></span>
                  </li>
                ))}
              </ol>
            </Section>
          )}

          {!isVendor && wo.events.length > 0 && (
            <Section title="Riwayat">
              <ol className="space-y-2 text-xs">
                {wo.events.map((e, i) => (
                  <li key={i} className="flex flex-col sm:flex-row gap-0.5 sm:gap-3"><span className="text-slate-400 font-mono sm:w-40 shrink-0">{String(e.occurred_at).slice(0, 16).replace('T', ' ')}</span><span><b>{EVENT_LABEL[e.event_type] || e.event_type}</b> · {e.actor_name}{e.reason ? ` — ${e.reason}` : ''}</span></li>
                ))}
              </ol>
            </Section>
          )}
        </div>
      </div>

      <Modal open={Boolean(modal)} title={{ cancel: 'Batalkan WO Tiang', progress: 'Laporkan progres', return: 'Kembalikan progres', bastp: 'Buat BASTP tiang', bastpReturn: 'Kembalikan BASTP' }[modal?.type] || ''} onClose={() => setModal(null)}>
        <form className="space-y-3 text-xs" onSubmit={(e) => {
          e.preventDefault()
          if (modal.type === 'cancel') run('cancel', () => poleWorkOrdersApi.cancel(id, { reason: form.reason }), 'WO Tiang Dibatalkan')
          if (modal.type === 'progress') run('progress', () => poleWorkOrdersApi.submitProgress(id, { line_id: modal.line.id, cumulative_percent: Number(form.percent), work_date: form.work_date, notes: form.notes, submission_key: form.key }), 'Progres Dilaporkan', 'Menunggu verifikasi Perencanaan.')
          if (modal.type === 'return') run('return', () => poleWorkOrdersApi.decideProgress(modal.progress.id, { decision: 'RETURNED', reason: form.reason }), 'Progres Dikembalikan')
          if (modal.type === 'bastp') run('bastp', () => poleWorkOrdersApi.prepareBastp(id, { bastp_number: form.number, bastp_date: form.date, notes: form.notes }), 'BASTP Diajukan', 'Menunggu penutupan Asman Perencanaan.')
          if (modal.type === 'bastpReturn') run('bastpReturn', () => poleWorkOrdersApi.decideBastp(modal.bastp.id, { decision: 'RETURN', reason: form.reason }), 'BASTP Dikembalikan')
        }}>
          {modal?.error && <Alert kind="error">{modal.error}</Alert>}
          {modal?.type === 'progress' && (
            <>
              <p className="text-slate-500">Lokasi <b className="font-mono">{modal.line.application_number}</b> · {modal.line.kr_number} · Tiang {modal.line.pole_type} ({modal.line.quantity} batang)</p>
              <label className="block"><span className="block font-semibold mb-1">Progres kumulatif (%) *</span><input required type="number" min="0" max="100" step="0.01" value={form.percent} onChange={(e) => setForm({ ...form, percent: e.target.value })} className={inputCls} /></label>
              <label className="block"><span className="block font-semibold mb-1">Tanggal laporan * <span className="font-normal text-slate-500">(pada 100% = tanggal pekerjaan selesai)</span></span><input required type="date" max={today()} value={form.work_date} onChange={(e) => setForm({ ...form, work_date: e.target.value })} className={inputCls} /></label>
              <label className="block"><span className="block font-semibold mb-1">Catatan</span><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} /></label>
            </>
          )}
          {modal?.type === 'bastp' && (
            <>
              <label className="block"><span className="block font-semibold mb-1">Nomor BASTP *</span><input required value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} className={`${inputCls} font-mono`} /></label>
              <label className="block"><span className="block font-semibold mb-1">Tanggal BASTP *</span><input required type="date" value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} className={inputCls} /></label>
              <label className="block"><span className="block font-semibold mb-1">Catatan</span><textarea rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} className={inputCls} /></label>
            </>
          )}
          {['cancel', 'return', 'bastpReturn'].includes(modal?.type) && (
            <label className="block"><span className="block font-semibold mb-1">Alasan *</span><textarea required rows={3} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} className={inputCls} /></label>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" size="sm" onClick={() => setModal(null)}>Batal</Button>
            <Button type="submit" variant="primary" size="sm" loading={Boolean(busy)}>Simpan</Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
