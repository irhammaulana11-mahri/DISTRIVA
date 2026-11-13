import { useMemo, useState } from 'react'
import useDrawingBundle from './useDrawingBundle.js'
import Spinner from '../../components/Spinner.jsx'
import { DRAWING_STEP_LABELS } from '../drawings/DrawingApprovalChain.jsx'

const EVENT_LABELS = {
  CREATED: 'Usulan dibuat',
  MEMBER_ADDED: 'Anggota ditambahkan',
  MEMBER_REMOVED: 'Anggota dikeluarkan',
  CANCELLED: 'Usulan dibatalkan',
}

const toTime = (v) => {
  if (!v) return 0
  // Format Postgres '2026-11-11 12:13:50+00' → ISO '2026-11-11T12:13:50+00:00'
  const iso = String(v).replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  const t = new Date(iso).getTime()
  return Number.isNaN(t) ? 0 : t
}

const TONE = {
  ok: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
  bad: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300',
  info: 'bg-blue-100 text-blue-800 dark:bg-blue-950/50 dark:text-blue-300',
  muted: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
}
const DOT = { ok: 'bg-emerald-500', bad: 'bg-rose-500', info: 'bg-blue-500', muted: 'bg-slate-400' }

/** Gabungkan kejadian usulan + keputusan/pengajuan/pengembalian paket gambar & MTO (semua versi) menjadi satu daftar berurutan. */
export function buildTimeline(events = [], drawing = null) {
  const items = events.map((e, i) => ({
    key: `e${i}`,
    at: toTime(e.occurred_at),
    atText: e.occurred_at,
    tone: e.event_type === 'CANCELLED' ? 'bad' : 'muted',
    badge: 'USULAN',
    title: EVENT_LABELS[e.event_type] || e.event_type,
    actor: e.actor_name || 'Sistem',
    notes: e.reason,
  }))
  for (const v of drawing?.versions || []) {
    if (v.submitted_at) {
      items.push({ key: `s${v.id}`, at: toTime(v.submitted_at), atText: v.submitted_at, tone: 'info', badge: `GAMBAR V${v.version_number}`, title: 'Gambar & MTO diajukan untuk persetujuan', actor: v.submitted_by_name || null, notes: null })
    }
    for (const [i, d] of (v.decisions || []).entries()) {
      const ok = d.decision === 'APPROVED'
      items.push({
        key: `d${v.id}-${i}`,
        at: toTime(d.decided_at),
        atText: d.decided_at,
        tone: ok ? 'ok' : 'bad',
        badge: ok ? 'SETUJU' : 'TOLAK',
        title: `${DRAWING_STEP_LABELS[d.step] || d.step} — Versi ${v.version_number}`,
        actor: d.decided_by_name ? `${d.decided_by_name}${d.decided_role ? ` (${d.decided_role})` : ''}` : null,
        notes: d.notes,
        after: !ok && v.status === 'RETURNED' ? `Paket gambar Versi ${v.version_number} dikembalikan ke penyusun; draf versi baru dibuka.` : null,
      })
    }
    // Pengembalian tanpa keputusan tolak (mis. usulan dibatalkan) tetap dicatat
    if (v.status === 'RETURNED' && v.returned_at_step === 'PROPOSAL_CANCELLED') {
      items.push({ key: `r${v.id}`, at: toTime(v.returned_at), atText: v.returned_at, tone: 'bad', badge: 'DIKEMBALIKAN', title: `Gambar Versi ${v.version_number} dikembalikan: usulan dibatalkan`, actor: null, notes: v.return_reason })
    }
  }
  return items.sort((a, b) => b.at - a.at)
}

const fmt = (it) => {
  const t = it.at ? new Date(it.at) : null
  return t ? t.toLocaleString('id-ID') : it.atText || '-'
}

/** Satu linimasa: kejadian usulan, catatan keputusan persetujuan, dan riwayat penolakan/pengembalian (terbaru di atas). */
export default function ProposalHistoryTimeline({ events = [], representativeApplicationId, reloadKey = 0, bundle = null }) {
  const own = useDrawingBundle(representativeApplicationId, reloadKey, !bundle)
  const { drawing, loading } = bundle || own
  const [filter, setFilter] = useState('all')

  const all = useMemo(() => buildTimeline(events, drawing), [events, drawing])
  const items = filter === 'all' ? all : filter === 'tolak' ? all.filter((i) => i.tone === 'bad') : all.filter((i) => i.badge === 'USULAN')
  const rejected = all.filter((i) => i.tone === 'bad').length

  return (
    <div className="border border-slate-200 dark:border-slate-800 rounded-xl bg-white dark:bg-slate-900 shadow-2xs">
      <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-slate-100 dark:border-slate-800">
        <p className="text-xs text-slate-500">Seluruh kejadian usulan, keputusan persetujuan, dan penolakan dalam satu urutan waktu (terbaru di atas).</p>
        <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5" role="group" aria-label="Saring riwayat">
          {[['all', `Semua (${all.length})`], ['tolak', `Penolakan (${rejected})`], ['usulan', 'Kejadian usulan']].map(([k, label]) => (
            <button key={k} type="button" aria-pressed={filter === k} onClick={() => setFilter(k)}
              className={`px-3 py-1 rounded-md text-[11px] font-semibold ${filter === k ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-slate-500'}`}>
              {label}
            </button>
          ))}
        </div>
      </div>
      {loading && <div className="p-4 text-center"><Spinner size="sm" label="Memuat riwayat…" /></div>}
      {!loading && items.length === 0 ? (
        <p className="py-8 text-center text-slate-400 text-xs">{filter === 'tolak' ? 'Belum ada penolakan.' : 'Belum ada catatan riwayat.'}</p>
      ) : (
        <ol className="px-4 py-3">
          {items.map((it, idx) => (
            <li key={it.key} className="relative pl-6 pb-4 last:pb-0 text-xs">
              {idx < items.length - 1 && <span className="absolute left-[5px] top-3 bottom-0 w-px bg-slate-200 dark:bg-slate-700" aria-hidden="true" />}
              <span className={`absolute left-0 top-1.5 w-[11px] h-[11px] rounded-full ring-2 ring-white dark:ring-slate-900 ${DOT[it.tone]}`} aria-hidden="true" />
              <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
                <div className="flex items-center gap-2 min-w-0">
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${TONE[it.tone]}`}>{it.badge}</span>
                  <span className="font-semibold text-slate-800 dark:text-slate-100">{it.title}</span>
                </div>
                <span className="text-[11px] text-slate-400 font-mono shrink-0">{fmt(it)}</span>
              </div>
              {it.actor && <p className="text-[11px] text-slate-500 mt-0.5">Oleh <span className="font-medium text-slate-700 dark:text-slate-300">{it.actor}</span></p>}
              {it.notes && <p className="mt-1 text-[11px] text-slate-600 dark:text-slate-300 italic bg-slate-50 dark:bg-slate-800/60 px-2 py-1 rounded">&ldquo;{it.notes}&rdquo;</p>}
              {it.after && <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">{it.after}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
