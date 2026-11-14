import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { applicationApi, slaApi, tasksApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import { useDebounce } from '../../utils/useDebounce.js'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Modal from '../../components/Modal.jsx'
import ReasonDialog from '../../components/ReasonDialog.jsx'
import SearchSelect from '../../components/SearchSelect.jsx'
import Spinner from '../../components/Spinner.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import { IconClipboard, IconPlus, IconRefresh } from '../../components/icons.jsx'

/**
 * Tugas & SLA (docs/24 §8): tugas yang diberikan Manager ULP kepada petugas, dengan tenggat dalam hari kerja menurut SLA jenis tugas.
 * Alur: Ditugaskan → Diterima → Dikerjakan → Diajukan → Selesai (diperiksa orang lain), atau dikembalikan untuk diperbaiki.
 * Tidak ada jeda SLA otomatis (belum ada SOP); tugas yang dikembalikan tercatat di riwayat.
 */
const STATUS = {
  ASSIGNED: { label: 'Ditugaskan', cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
  ACCEPTED: { label: 'Diterima', cls: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/60' },
  IN_PROGRESS: { label: 'Dikerjakan', cls: 'bg-blue-50 text-blue-800 border-blue-200 dark:bg-blue-950/50 dark:text-blue-300 dark:border-blue-800/60' },
  SUBMITTED: { label: 'Menunggu pemeriksaan', cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60' },
  COMPLETED: { label: 'Selesai', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60' },
  CANCELLED: { label: 'Dibatalkan', cls: 'bg-slate-100 text-slate-500 border-slate-200 dark:bg-slate-800 dark:text-slate-400 dark:border-slate-700' },
}

const TABS = [
  { key: 'mine', label: 'Tugas saya', params: { mine: 1, status: 'OPEN' } },
  { key: 'review', label: 'Perlu diperiksa', params: { status: 'SUBMITTED' }, assignOnly: true },
  { key: 'late', label: 'Terlambat', params: { overdue: 1 } },
  { key: 'all', label: 'Semua tugas', params: {} },
  { key: 'sla', label: 'Pengaturan SLA' },
]

const pill = 'inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium'

export function formatDue(iso) {
  if (!iso) return 'Tanpa tenggat'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Langkah yang boleh dilakukan pengguna pada sebuah tugas, menurut status dan perannya. */
export function taskActions(task, { userId, canAssign }) {
  const mine = task.assignee_id === userId
  const out = []
  if (mine && task.status === 'ASSIGNED') out.push({ step: 'accept', label: 'Terima', variant: 'secondary' })
  if (mine && ['ASSIGNED', 'ACCEPTED'].includes(task.status)) out.push({ step: 'start', label: 'Mulai', variant: 'primary' })
  if (mine && task.status === 'IN_PROGRESS') out.push({ step: 'submit', label: 'Ajukan', variant: 'primary' })
  if (canAssign && !mine && task.status === 'SUBMITTED') {
    out.push({ step: 'complete', label: 'Terima hasil', variant: 'success' })
    out.push({ step: 'return', label: 'Kembalikan', variant: 'warning', reason: true })
  }
  if (canAssign && ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'SUBMITTED'].includes(task.status)) {
    out.push({ step: 'reassign', label: 'Alihkan', variant: 'outline', pick: true })
    out.push({ step: 'cancel', label: 'Batalkan', variant: 'outline', reason: true })
  }
  return out
}

export default function TasksPage() {
  const { can, isSysAdmin } = useAccess()
  const { user } = useAuth()
  const { notify } = useNotifications()
  const canAssign = Boolean(can['tasks.assign'] || isSysAdmin)
  const userId = user?.id
  const tabs = TABS.filter((t) => !t.assignOnly || canAssign)

  const [tab, setTab] = useState('mine')
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })
  const [summary, setSummary] = useState(null)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [busyId, setBusyId] = useState(null)
  const [reasonFor, setReasonFor] = useState(null)
  const [pickFor, setPickFor] = useState(null)
  const [creating, setCreating] = useState(false)

  const current = tabs.find((t) => t.key === tab) || tabs[0]

  const load = useCallback(async () => {
    if (current.key === 'sla') return
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const [list, sum] = await Promise.all([tasksApi.list({ ...current.params, page, per_page: perPage }), tasksApi.summary()])
      setState({ loading: false, error: '', rows: list?.data || [], meta: list?.meta || null })
      setSummary(sum?.data || null)
    } catch (err) {
      setState({ loading: false, error: err?.message || 'Gagal memuat tugas.', rows: [], meta: null })
    }
  }, [current, page, perPage])

  useEffect(() => { load() }, [load])

  const run = async (task, step, body) => {
    setBusyId(task.id)
    try {
      const res = await tasksApi.step(task.id, step, body)
      notify({ type: 'success', title: 'Tugas diperbarui', desc: res?.message || 'Berhasil.', tag: 'Tugas' })
      await load()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal memproses tugas', desc: err?.message || 'Terjadi kesalahan.', tag: 'Tugas' })
    } finally {
      setBusyId(null)
    }
  }

  const onAction = (task, a) => {
    if (a.reason) setReasonFor({ task, action: a })
    else if (a.pick) setPickFor(task)
    else run(task, a.step)
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Tugas &amp; SLA</h1>
          <p className="text-sm text-slate-500 dark:text-slate-400">Tugas permohonan dengan tenggat hari kerja. Yang terlambat ditandai merah dan diingatkan lewat notifikasi.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" icon={IconRefresh} onClick={load} aria-label="Muat ulang">Muat ulang</Button>
          {canAssign && <Button icon={IconPlus} onClick={() => setCreating(true)}>Tugas baru</Button>}
        </div>
      </div>

      {summary && (
        <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat label="Tugas saya" value={summary.mine_open} />
          <Stat label="Terlambat (saya)" value={summary.mine_overdue} danger />
          {canAssign && <Stat label="Menunggu saya periksa" value={summary.awaiting_my_review} />}
          <Stat label="Terlambat di unit" value={summary.unit_overdue} danger />
        </dl>
      )}

      <div role="tablist" aria-label="Tampilan tugas" className="flex gap-1 overflow-x-auto border-b border-slate-200 dark:border-slate-700">
        {tabs.map((t) => (
          <button key={t.key} role="tab" aria-selected={current.key === t.key} type="button" onClick={() => { setTab(t.key); setPage(1) }}
            className={`whitespace-nowrap px-3 py-2.5 text-sm font-medium border-b-2 -mb-px cursor-pointer ${current.key === t.key ? 'border-brand-600 text-brand-700 dark:text-brand-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {current.key === 'sla' ? <SlaPanel /> : (
        <>
          {state.error && <Alert variant="error">{state.error}</Alert>}
          {state.loading ? (
            <div className="flex justify-center py-12"><Spinner /></div>
          ) : state.rows.length === 0 ? (
            <EmptyState icon={IconClipboard} title="Belum ada tugas" description="Tugas yang diberikan kepada Anda atau di unit Anda akan tampil di sini." />
          ) : (
            <div className="space-y-3">
              {state.rows.map((t) => <TaskRow key={t.id} task={t} busy={busyId === t.id} actions={taskActions(t, { userId, canAssign })} onAction={(a) => onAction(t, a)} />)}
              {state.meta && <TableFooter itemCount={state.rows.length} total={state.meta.total} entityLabel="tugas" page={state.meta.current_page} perPage={perPage} onPage={setPage} onPerPage={(n) => { setPerPage(n); setPage(1) }} />}
            </div>
          )}
        </>
      )}

      {reasonFor && (
        <ReasonDialog open title={`${reasonFor.action.label} tugas`} description={reasonFor.task.title} confirmLabel={reasonFor.action.label}
          onClose={() => setReasonFor(null)}
          onConfirm={async (reason) => { await tasksApi.step(reasonFor.task.id, reasonFor.action.step, { reason }); setReasonFor(null); notify({ type: 'success', title: 'Tugas diperbarui', desc: `${reasonFor.action.label} berhasil.`, tag: 'Tugas' }); await load() }} />
      )}
      {pickFor && <ReassignModal task={pickFor} onClose={() => setPickFor(null)} onDone={async () => { setPickFor(null); await load() }} />}
      {creating && <CreateModal onClose={() => setCreating(false)} onDone={async () => { setCreating(false); await load() }} />}
    </div>
  )
}

function Stat({ label, value, danger = false }) {
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-3">
      <dt className="text-xs text-slate-500 dark:text-slate-400">{label}</dt>
      <dd className={`text-2xl font-bold ${danger && value > 0 ? 'text-red-600 dark:text-red-400' : 'text-slate-900 dark:text-slate-100'}`}>{value ?? 0}</dd>
    </div>
  )
}

function TaskRow({ task, busy, actions, onAction }) {
  const st = STATUS[task.status] || { label: task.status, cls: STATUS.ASSIGNED.cls }
  return (
    <article className="rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-slate-900 dark:text-slate-100 break-words">{task.title}</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            {task.type_label} · Permohonan <Link className="text-brand-700 dark:text-brand-300 hover:underline" to={`/permohonan/${task.application_id}`}>{task.application_number}</Link>
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <span className={`${pill} ${st.cls}`}>{st.label}</span>
          {task.is_overdue && <span className={`${pill} bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800/60`}>Terlambat</span>}
          {task.is_due_soon && <span className={`${pill} bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60`}>Segera jatuh tempo</span>}
        </div>
      </div>
      <dl className="mt-2 grid grid-cols-1 gap-x-4 gap-y-1 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-3">
        <div><dt className="inline text-slate-400">Penerima: </dt><dd className="inline">{task.assignee_name}</dd></div>
        <div><dt className="inline text-slate-400">Diberikan oleh: </dt><dd className="inline">{task.assigned_by_name}</dd></div>
        <div><dt className="inline text-slate-400">Tenggat: </dt><dd className="inline">{formatDue(task.due_at)}</dd></div>
      </dl>
      {task.description && <p className="mt-2 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line">{task.description}</p>}
      {task.review_note && task.status !== 'COMPLETED' && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">Catatan pemeriksa: {task.review_note}</p>}
      {actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {actions.map((a) => <Button key={a.step} size="sm" variant={a.variant} loading={busy} onClick={() => onAction(a)}>{a.label}</Button>)}
        </div>
      )}
    </article>
  )
}

function ReassignModal({ task, onClose, onDone }) {
  const { notify } = useNotifications()
  const [people, setPeople] = useState([])
  const [pick, setPick] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => { tasksApi.assignees(task.application_id).then((r) => setPeople(r?.data || [])).catch((e) => setError(e?.message || 'Gagal memuat daftar petugas.')) }, [task.application_id])
  const options = useMemo(() => people.filter((p) => p.id !== task.assignee_id).map((p) => ({ value: p.id, label: p.name, description: p.email })), [people, task.assignee_id])
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await tasksApi.step(task.id, 'reassign', { assignee_id: pick })
      notify({ type: 'success', title: 'Tugas dialihkan', desc: task.title, tag: 'Tugas' })
      await onDone()
    } catch (err) {
      setError(err?.message || 'Gagal mengalihkan tugas.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open title="Alihkan tugas" subtitle={task.title} onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button onClick={save} loading={busy} disabled={!pick}>Alihkan</Button></>}>
      {error && <Alert variant="error">{error}</Alert>}
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Penerima baru</label>
      <SearchSelect options={options} value={pick} onChange={setPick} placeholder="Cari petugas…" ariaLabel="Penerima baru" />
    </Modal>
  )
}

function CreateModal({ onClose, onDone }) {
  const { notify } = useNotifications()
  const [types, setTypes] = useState([])
  const [q, setQ] = useState('')
  const debounced = useDebounce(q, 350)
  const [apps, setApps] = useState([])
  const [appId, setAppId] = useState('')
  const [people, setPeople] = useState([])
  const [form, setForm] = useState({ task_type: '', title: '', description: '', assignee_id: '' })
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { slaApi.configurations().then((r) => setTypes(r?.data || [])).catch(() => {}) }, [])
  useEffect(() => {
    if (debounced.trim().length < 2) return
    applicationApi.list({ search: debounced.trim(), per_page: 20 }).then((r) => setApps(r?.data || [])).catch(() => setApps([]))
  }, [debounced])
  useEffect(() => {
    setPeople([])
    setForm((f) => ({ ...f, assignee_id: '' }))
    if (appId) tasksApi.assignees(appId).then((r) => setPeople(r?.data || [])).catch((e) => setError(e?.message || 'Gagal memuat daftar petugas.'))
  }, [appId])

  const appOptions = apps.map((a) => ({ value: a.id, label: a.application_number, description: a.customer?.name }))
  const peopleOptions = people.map((p) => ({ value: p.id, label: p.name, description: p.email }))
  const selectedType = types.find((t) => t.task_type === form.task_type)
  const valid = appId && form.task_type && form.title.trim() && form.assignee_id

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      await tasksApi.create(appId, { ...form, description: form.description || null })
      notify({ type: 'success', title: 'Tugas dibuat', desc: form.title, tag: 'Tugas' })
      await onDone()
    } catch (err) {
      setError(err?.message || 'Gagal membuat tugas.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open title="Tugas baru" onClose={onClose}
      footer={<><Button variant="secondary" onClick={onClose}>Batal</Button><Button type="submit" form="task-form" loading={busy} disabled={!valid}>Buat tugas</Button></>}>
      <form id="task-form" onSubmit={save} className="space-y-3">
        {error && <Alert variant="error">{error}</Alert>}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Permohonan</label>
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ketik no. permohonan atau nama pelanggan (min. 2 huruf)"
            className="mb-2 block w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-base sm:text-sm" />
          <SearchSelect options={appOptions} value={appId} onChange={setAppId} placeholder="Pilih permohonan…" ariaLabel="Permohonan" emptyText="Ketik pencarian di atas dulu." />
        </div>
        <div>
          <label htmlFor="task-type" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Jenis tugas</label>
          <select id="task-type" value={form.task_type} onChange={(e) => setForm({ ...form, task_type: e.target.value })}
            className="block w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-base sm:text-sm">
            <option value="">Pilih jenis…</option>
            {types.map((t) => <option key={t.task_type} value={t.task_type}>{t.label}</option>)}
          </select>
          {selectedType && <p className="mt-1 text-xs text-slate-500">{selectedType.is_active && selectedType.working_days ? `Tenggat ${selectedType.working_days} hari kerja.` : 'Jenis ini belum punya tenggat.'}</p>}
        </div>
        <div>
          <label htmlFor="task-title" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Judul</label>
          <input id="task-title" required maxLength={200} value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="block w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-base sm:text-sm" />
        </div>
        <div>
          <label htmlFor="task-desc" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Uraian (opsional)</label>
          <textarea id="task-desc" rows={3} maxLength={2000} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="block w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-base sm:text-sm" />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Penerima</label>
          <SearchSelect options={peopleOptions} value={form.assignee_id} onChange={(v) => setForm({ ...form, assignee_id: v })} placeholder={appId ? 'Pilih petugas…' : 'Pilih permohonan dulu'} ariaLabel="Penerima" disabled={!appId} />
        </div>
      </form>
    </Modal>
  )
}

function SlaPanel() {
  const { notify } = useNotifications()
  const [state, setState] = useState({ loading: true, error: '', rows: [], canManage: false })
  const [holidays, setHolidays] = useState([])
  const [draft, setDraft] = useState({})
  const [newDay, setNewDay] = useState({ holiday_date: '', name: '' })

  const load = useCallback(async () => {
    try {
      const [cfg, hol] = await Promise.all([slaApi.configurations(), slaApi.holidays({ year: new Date().getFullYear() })])
      setState({ loading: false, error: '', rows: cfg?.data || [], canManage: Boolean(cfg?.can?.manage) })
      setHolidays(hol?.data || [])
    } catch (err) {
      setState({ loading: false, error: err?.message || 'Gagal memuat pengaturan SLA.', rows: [], canManage: false })
    }
  }, [])
  useEffect(() => { load() }, [load])

  const saveRow = async (r) => {
    const raw = draft[r.task_type] ?? (r.working_days ?? '')
    try {
      await slaApi.update(r.task_type, { working_days: raw === '' ? null : Number(raw), is_active: r.is_active })
      notify({ type: 'success', title: 'SLA disimpan', desc: `${r.label}: berlaku untuk tugas baru.`, tag: 'Tugas' })
      setDraft((d) => { const n = { ...d }; delete n[r.task_type]; return n })
      await load()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal menyimpan SLA', desc: err?.message || 'Terjadi kesalahan.', tag: 'Tugas' })
    }
  }
  const addDay = async (e) => {
    e.preventDefault()
    try {
      await slaApi.addHoliday(newDay)
      setNewDay({ holiday_date: '', name: '' })
      await load()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal menambah hari libur', desc: err?.message || 'Terjadi kesalahan.', tag: 'Tugas' })
    }
  }
  const removeDay = async (date) => {
    try {
      await slaApi.removeHoliday(date)
      await load()
    } catch (err) {
      notify({ type: 'error', title: 'Gagal menghapus hari libur', desc: err?.message || 'Terjadi kesalahan.', tag: 'Tugas' })
    }
  }

  if (state.loading) return <div className="flex justify-center py-12"><Spinner /></div>
  return (
    <div className="space-y-6">
      {state.error && <Alert variant="error">{state.error}</Alert>}
      <section aria-labelledby="sla-h" className="space-y-2">
        <h2 id="sla-h" className="text-base font-semibold text-slate-900 dark:text-slate-100">Tenggat per jenis tugas</h2>
        <p className="text-xs text-slate-500">Dihitung dalam hari kerja (Senin–Jumat, di luar hari libur di bawah) sejak tugas diberikan. Kosong = tanpa tenggat. Perubahan hanya berlaku untuk tugas baru.</p>
        <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
          {state.rows.map((r) => (
            <li key={r.task_type} className="flex flex-wrap items-center justify-between gap-2 p-3">
              <span className="text-sm text-slate-800 dark:text-slate-200">{r.label}</span>
              {state.canManage ? (
                <span className="flex items-center gap-2">
                  <input type="number" min={1} max={365} inputMode="numeric" aria-label={`Hari kerja ${r.label}`} value={draft[r.task_type] ?? (r.working_days ?? '')}
                    onChange={(e) => setDraft({ ...draft, [r.task_type]: e.target.value })}
                    className="w-20 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-base sm:text-sm" />
                  <span className="text-xs text-slate-500">hari kerja</span>
                  <Button size="sm" variant="secondary" onClick={() => saveRow(r)}>Simpan</Button>
                </span>
              ) : <span className="text-sm text-slate-600 dark:text-slate-300">{r.working_days ? `${r.working_days} hari kerja` : 'Tanpa tenggat'}</span>}
            </li>
          ))}
        </ul>
      </section>
      <section aria-labelledby="hol-h" className="space-y-2">
        <h2 id="hol-h" className="text-base font-semibold text-slate-900 dark:text-slate-100">Hari libur {new Date().getFullYear()}</h2>
        {holidays.length === 0 ? <p className="text-sm text-slate-500">Belum ada hari libur tercatat.</p> : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900">
            {holidays.map((h) => (
              <li key={h.holiday_date} className="flex items-center justify-between gap-2 p-3 text-sm">
                <span>{formatDue(h.holiday_date)} · {h.name}</span>
                {state.canManage && <Button size="xs" variant="outline" onClick={() => removeDay(String(h.holiday_date).slice(0, 10))}>Hapus</Button>}
              </li>
            ))}
          </ul>
        )}
        {state.canManage && (
          <form onSubmit={addDay} className="flex flex-wrap items-end gap-2">
            <div><label htmlFor="hol-date" className="block text-xs text-slate-500">Tanggal</label>
              <input id="hol-date" type="date" required value={newDay.holiday_date} onChange={(e) => setNewDay({ ...newDay, holiday_date: e.target.value })} className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-base sm:text-sm" /></div>
            <div className="flex-1 min-w-40"><label htmlFor="hol-name" className="block text-xs text-slate-500">Keterangan</label>
              <input id="hol-name" required maxLength={150} value={newDay.name} onChange={(e) => setNewDay({ ...newDay, name: e.target.value })} className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-base sm:text-sm" /></div>
            <Button type="submit" size="md">Tambah</Button>
          </form>
        )}
      </section>
    </div>
  )
}
