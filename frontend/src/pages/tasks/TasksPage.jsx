import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { applicationApi, serviceSlaApi, slaApi, tasksApi } from '../../services/api.js'
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
import {
  IconAlertCircle,
  IconCalendar,
  IconCheckCircle,
  IconClipboard,
  IconClock,
  IconFileText,
  IconHistory,
  IconInfo,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconUser,
} from '../../components/icons.jsx'

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
  { key: 'service', label: 'SLA layanan' },
  { key: 'sla', label: 'Pengaturan SLA' },
]

const pill = 'inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium'

export function formatDue(iso) {
  if (!iso) return 'Tanpa tenggat'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function formatDateTime(iso) {
  if (!iso) return '-'
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? '-' : d.toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
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
  const { taskId } = useParams()
  const navigate = useNavigate()

  const canAssign = Boolean(can['tasks.assign'] || isSysAdmin)
  const userId = user?.id
  const tabs = TABS.filter((t) => !t.assignOnly || canAssign)

  const [tab, setTab] = useState('mine')
  const [search, setSearch] = useState('')
  const debouncedSearch = useDebounce(search, 300)
  const [statusFilter, setStatusFilter] = useState('')

  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })
  const [summary, setSummary] = useState(null)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [busyId, setBusyId] = useState(null)
  const [reasonFor, setReasonFor] = useState(null)
  const [pickFor, setPickFor] = useState(null)
  const [creating, setCreating] = useState(false)
  const [detailTask, setDetailTask] = useState(null)

  const current = tabs.find((t) => t.key === tab) || tabs[0]

  // Direct load when URL parameter has taskId
  useEffect(() => {
    if (!taskId || typeof tasksApi.get !== 'function') return
    tasksApi.get(taskId)
      .then((res) => {
        if (res?.data) setDetailTask(res.data)
      })
      .catch(() => {})
  }, [taskId])

  const load = useCallback(async () => {
    if (current.key === 'sla' || current.key === 'service') return
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const params = {
        ...current.params,
        page,
        per_page: perPage,
      }
      if (current.key === 'all' && statusFilter) {
        params.status = statusFilter
      }
      if (debouncedSearch.trim()) {
        params.search = debouncedSearch.trim()
      }

      const [list, sum] = await Promise.all([
        tasksApi.list(params),
        tasksApi.summary(),
      ])
      setState({ loading: false, error: '', rows: list?.data || [], meta: list?.meta || null })
      setSummary(sum?.data || null)
    } catch (err) {
      setState({ loading: false, error: err?.message || 'Gagal memuat tugas.', rows: [], meta: null })
    }
  }, [current, page, perPage, debouncedSearch, statusFilter])

  useEffect(() => { load() }, [load])

  const run = async (task, step, body) => {
    setBusyId(task.id)
    try {
      const res = await tasksApi.step(task.id, step, body)
      notify({ type: 'success', title: 'Tugas diperbarui', desc: res?.message || 'Berhasil.', tag: 'Tugas' })
      await load()
      if (detailTask && detailTask.id === task.id) {
        if (typeof tasksApi.get === 'function') {
          const updated = await tasksApi.get(task.id)
          setDetailTask(updated?.data || null)
        }
      }
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

  const closeDetail = () => {
    setDetailTask(null)
    if (taskId) {
      navigate('/tugas')
    }
  }

  return (
    <div className="space-y-6">
      {/* Header Halaman */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-brand-600 p-2.5 text-white shadow-xs">
              <IconClipboard className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Tugas &amp; SLA
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Operasional
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
                Tugas permohonan dengan tenggat hari kerja. Yang terlambat ditandai merah dan diingatkan lewat notifikasi.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="secondary" icon={IconRefresh} onClick={load} aria-label="Muat ulang">
              Muat ulang
            </Button>
            {canAssign && (
              <Button icon={IconPlus} onClick={() => setCreating(true)}>
                Tugas baru
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Ringkasan Status & SLA (Dashboard KPI Cards) */}
      {summary && (
        <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat
            label="Tugas saya"
            value={summary.mine_open}
            icon={IconUser}
            desc="Tugas aktif Anda"
          />
          <Stat
            label="Terlambat (saya)"
            value={summary.mine_overdue}
            danger
            icon={IconAlertCircle}
            desc="Melewati batas tenggat"
          />
          {canAssign && (
            <Stat
              label="Menunggu saya periksa"
              value={summary.awaiting_my_review}
              icon={IconClock}
              highlight={summary.awaiting_my_review > 0}
              desc="Perlu tinjauan hasil"
            />
          )}
          <Stat
            label="Terlambat di unit"
            value={summary.unit_overdue}
            danger
            icon={IconAlertCircle}
            desc="Total terlambat di unit"
          />
        </dl>
      )}

      {/* Navigasi Tab */}
      <div className="border-b border-slate-200 dark:border-slate-700">
        <div role="tablist" aria-label="Tampilan tugas" className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
          {tabs.map((t) => {
            const isActive = current.key === t.key
            let badge = null
            if (summary) {
              if (t.key === 'mine' && summary.mine_open > 0) badge = summary.mine_open
              if (t.key === 'review' && summary.awaiting_my_review > 0) badge = summary.awaiting_my_review
              if (t.key === 'late' && (summary.mine_overdue > 0 || summary.unit_overdue > 0)) {
                badge = summary.mine_overdue > 0 ? summary.mine_overdue : summary.unit_overdue
              }
            }

            return (
              <button
                key={t.key}
                role="tab"
                aria-selected={isActive}
                type="button"
                onClick={() => {
                  setTab(t.key)
                  setPage(1)
                }}
                className={`flex items-center gap-2 whitespace-nowrap rounded-t-lg px-4 py-3 text-sm font-medium border-b-2 -mb-px transition-colors cursor-pointer ${
                  isActive
                    ? 'border-brand-600 bg-white dark:bg-slate-900 text-brand-700 dark:text-brand-300 shadow-2xs'
                    : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200 hover:bg-slate-100/50 dark:hover:bg-slate-800/50'
                }`}
              >
                {t.label}
                {badge !== null && (
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-semibold ${
                      t.key === 'late'
                        ? 'bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-300'
                        : t.key === 'review'
                        ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                        : 'bg-brand-100 text-brand-700 dark:bg-brand-950 dark:text-brand-300'
                    }`}
                  >
                    {badge}
                  </span>
                )}
              </button>
            )
          })}
        </div>
      </div>

      {/* Konten Tab */}
      {current.key === 'sla' ? (
        <SlaPanel />
      ) : current.key === 'service' ? (
        <ServiceSlaPanel />
      ) : (
        <div className="space-y-4">
          {/* Filter & Search Bar untuk Daftar Tugas */}
          <div className="flex flex-col gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative flex-1">
              <IconSearch className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="search"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value)
                  setPage(1)
                }}
                placeholder="Cari judul tugas, no. permohonan, atau petugas…"
                className="w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 pl-9 pr-3 py-1.5 text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:border-brand-500 focus:bg-white dark:focus:bg-slate-800 focus:outline-hidden"
              />
            </div>
            {current.key === 'all' && (
              <div className="flex items-center gap-2">
                <label htmlFor="task-status-filter" className="text-xs font-medium text-slate-500 dark:text-slate-400 whitespace-nowrap">
                  Status:
                </label>
                <select
                  id="task-status-filter"
                  value={statusFilter}
                  onChange={(e) => {
                    setStatusFilter(e.target.value)
                    setPage(1)
                  }}
                  className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2.5 py-1.5 text-xs text-slate-700 dark:text-slate-200"
                >
                  <option value="">Semua Status</option>
                  <option value="ASSIGNED">Ditugaskan</option>
                  <option value="ACCEPTED">Diterima</option>
                  <option value="IN_PROGRESS">Dikerjakan</option>
                  <option value="SUBMITTED">Menunggu Pemeriksaan</option>
                  <option value="COMPLETED">Selesai</option>
                  <option value="CANCELLED">Dibatalkan</option>
                </select>
              </div>
            )}
          </div>

          {state.error && <Alert variant="error">{state.error}</Alert>}

          {state.loading ? (
            <div className="flex flex-col items-center justify-center py-16">
              <Spinner className="h-8 w-8 text-brand-600" />
              <p className="mt-3 text-sm text-slate-500">Memuat daftar tugas…</p>
            </div>
          ) : state.rows.length === 0 ? (
            <EmptyState
              icon={IconClipboard}
              title="Belum ada tugas"
              description="Tugas yang diberikan kepada Anda atau di unit Anda akan tampil di sini."
            />
          ) : (
            <div className="space-y-3.5">
              {state.rows.map((t) => (
                <TaskRow
                  key={t.id}
                  task={t}
                  busy={busyId === t.id}
                  actions={taskActions(t, { userId, canAssign })}
                  onAction={(a) => onAction(t, a)}
                  onViewDetail={() => setDetailTask(t)}
                />
              ))}
              {state.meta && (
                <TableFooter
                  itemCount={state.rows.length}
                  total={state.meta.total}
                  entityLabel="tugas"
                  page={state.meta.current_page}
                  perPage={perPage}
                  onPage={setPage}
                  onPerPage={(n) => {
                    setPerPage(n)
                    setPage(1)
                  }}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* Dialog Konfirmasi Alasan (Kembalikan / Batalkan) */}
      {reasonFor && (
        <ReasonDialog
          open
          title={`${reasonFor.action.label} tugas`}
          description={reasonFor.task.title}
          confirmLabel={reasonFor.action.label}
          onClose={() => setReasonFor(null)}
          onConfirm={async (reason) => {
            await tasksApi.step(reasonFor.task.id, reasonFor.action.step, { reason })
            setReasonFor(null)
            notify({
              type: 'success',
              title: 'Tugas diperbarui',
              desc: `${reasonFor.action.label} berhasil.`,
              tag: 'Tugas',
            })
            await load()
          }}
        />
      )}

      {/* Modal Alihkan Tugas */}
      {pickFor && (
        <ReassignModal
          task={pickFor}
          onClose={() => setPickFor(null)}
          onDone={async () => {
            setPickFor(null)
            await load()
          }}
        />
      )}

      {/* Modal Buat Tugas Baru */}
      {creating && (
        <CreateModal
          onClose={() => setCreating(false)}
          onDone={async () => {
            setCreating(false)
            await load()
          }}
        />
      )}

      {/* Modal Rincian & Riwayat Audit Tugas */}
      {detailTask && (
        <TaskDetailModal
          task={detailTask}
          onClose={closeDetail}
          actions={taskActions(detailTask, { userId, canAssign })}
          onAction={(a) => onAction(detailTask, a)}
          busy={busyId === detailTask.id}
        />
      )}
    </div>
  )
}

function Stat({ label, value, danger = false, highlight = false, icon: Icon, desc }) {
  let colorCls = 'text-slate-900 dark:text-slate-100'
  let bgIconCls = 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300'
  let borderCls = 'border-slate-200 dark:border-slate-700'

  if (danger && value > 0) {
    colorCls = 'text-red-600 dark:text-red-400'
    bgIconCls = 'bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400'
    borderCls = 'border-red-200 dark:border-red-900/60 bg-red-50/20 dark:bg-red-950/10'
  } else if (highlight && value > 0) {
    colorCls = 'text-amber-600 dark:text-amber-400'
    bgIconCls = 'bg-amber-50 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
    borderCls = 'border-amber-200 dark:border-amber-900/60'
  }

  return (
    <div className={`rounded-xl border ${borderCls} bg-white dark:bg-slate-900 p-4 transition-all shadow-xs`}>
      <div className="flex items-center justify-between">
        <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</dt>
        {Icon && (
          <div className={`rounded-lg p-1.5 ${bgIconCls}`}>
            <Icon className="h-4 w-4" />
          </div>
        )}
      </div>
      <dd className={`mt-2 text-2xl font-bold tracking-tight ${colorCls}`}>
        {value ?? 0}
      </dd>
      {desc && <p className="mt-1 text-xs text-slate-400 dark:text-slate-500 truncate">{desc}</p>}
    </div>
  )
}

function TaskRow({ task, busy, actions, onAction, onViewDetail }) {
  const st = STATUS[task.status] || { label: task.status, cls: STATUS.ASSIGNED.cls }

  return (
    <article className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100 break-words">
              {task.title}
            </h2>
            {task.type_label && (
              <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-xs font-medium text-slate-600 dark:text-slate-300 border border-slate-200/60 dark:border-slate-700/60">
                {task.type_label}
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
            <IconFileText className="h-3.5 w-3.5 text-slate-400" />
            <span>Permohonan</span>
            <Link
              className="font-medium text-brand-600 dark:text-brand-400 hover:underline"
              to={`/permohonan/${task.application_id}`}
            >
              {task.application_number}
            </Link>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <span className={`${pill} ${st.cls}`}>{st.label}</span>
          {task.is_overdue && (
            <span className={`${pill} bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800/60`}>
              Terlambat
            </span>
          )}
          {task.is_due_soon && (
            <span className={`${pill} bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60`}>
              Segera jatuh tempo
            </span>
          )}
        </div>
      </div>

      <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 rounded-lg bg-slate-50/80 dark:bg-slate-800/40 p-3 text-xs text-slate-600 dark:text-slate-300 sm:grid-cols-3 border border-slate-100 dark:border-slate-800">
        <div>
          <dt className="text-slate-400 dark:text-slate-500">Penerima:</dt>
          <dd className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">{task.assignee_name || '-'}</dd>
        </div>
        <div>
          <dt className="text-slate-400 dark:text-slate-500">Diberikan oleh:</dt>
          <dd className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">{task.assigned_by_name || '-'}</dd>
        </div>
        <div>
          <dt className="text-slate-400 dark:text-slate-500">Tenggat:</dt>
          <dd className="font-medium text-slate-800 dark:text-slate-200 mt-0.5">
            {formatDue(task.due_at)}
            {task.due_basis === 'TMP' && task.due_at ? ' (mengikuti SLA TMP)' : ''}
          </dd>
        </div>
      </dl>

      {task.description && (
        <p className="mt-3 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line bg-slate-50/50 dark:bg-slate-800/30 p-2.5 rounded-lg border border-slate-100 dark:border-slate-800">
          {task.description}
        </p>
      )}

      {task.review_note && task.status !== 'COMPLETED' && (
        <div className="mt-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20 p-2.5 text-xs text-amber-800 dark:text-amber-300">
          <span className="font-semibold">Catatan pemeriksa:</span> {task.review_note}
        </div>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 pt-3">
        <div className="flex flex-wrap gap-2">
          {actions.map((a) => (
            <Button
              key={a.step}
              size="sm"
              variant={a.variant}
              loading={busy}
              onClick={() => onAction(a)}
            >
              {a.label}
            </Button>
          ))}
        </div>
        {onViewDetail && (
          <Button
            size="sm"
            variant="ghost"
            icon={IconHistory}
            onClick={onViewDetail}
            aria-label="Lihat riwayat tugas"
          >
            Rincian &amp; riwayat
          </Button>
        )}
      </div>
    </article>
  )
}

function TaskDetailModal({ task, onClose, actions = [], onAction, busy }) {
  const [events, setEvents] = useState([])
  const [loadingEvents, setLoadingEvents] = useState(true)

  useEffect(() => {
    if (!task?.id || typeof tasksApi.get !== 'function') {
      setLoadingEvents(false)
      return
    }
    setLoadingEvents(true)
    tasksApi.get(task.id)
      .then((res) => {
        setEvents(res?.data?.events || [])
      })
      .catch(() => setEvents([]))
      .finally(() => setLoadingEvents(false))
  }, [task?.id])

  const st = STATUS[task.status] || { label: task.status, cls: STATUS.ASSIGNED.cls }

  return (
    <Modal
      open
      title="Rincian & Riwayat Tugas"
      subtitle={`${task.title} · ${task.application_number}`}
      onClose={onClose}
      footer={
        <div className="flex flex-wrap items-center justify-between gap-2 w-full">
          <div className="flex flex-wrap gap-2">
            {actions.map((a) => (
              <Button
                key={a.step}
                size="sm"
                variant={a.variant}
                loading={busy}
                onClick={() => onAction(a)}
              >
                {a.label}
              </Button>
            ))}
          </div>
          <Button variant="secondary" onClick={onClose}>
            Tutup
          </Button>
        </div>
      }
    >
      <div className="space-y-5">
        {/* Status Header */}
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-slate-50 dark:bg-slate-800/60 p-3.5 border border-slate-200 dark:border-slate-700">
          <div>
            <p className="text-xs text-slate-500 dark:text-slate-400">Jenis Tugas</p>
            <p className="font-semibold text-slate-900 dark:text-slate-100">{task.type_label || '-'}</p>
          </div>
          <div className="flex items-center gap-1.5">
            <span className={`${pill} ${st.cls}`}>{st.label}</span>
            {task.is_overdue && (
              <span className={`${pill} bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800/60`}>
                Terlambat
              </span>
            )}
          </div>
        </div>

        {/* Informasi Penerima & Tenggat */}
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3 text-xs">
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5">
            <dt className="text-slate-500 dark:text-slate-400">Penerima Tugas</dt>
            <dd className="font-semibold text-slate-800 dark:text-slate-200 mt-1">{task.assignee_name || '-'}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5">
            <dt className="text-slate-500 dark:text-slate-400">Pemberi Tugas</dt>
            <dd className="font-semibold text-slate-800 dark:text-slate-200 mt-1">{task.assigned_by_name || '-'}</dd>
          </div>
          <div className="rounded-lg border border-slate-200 dark:border-slate-700 p-2.5">
            <dt className="text-slate-500 dark:text-slate-400">Tenggat Waktu</dt>
            <dd className="font-semibold text-slate-800 dark:text-slate-200 mt-1">{formatDue(task.due_at)}</dd>
          </div>
        </dl>

        {/* Uraian Tugas */}
        {task.description && (
          <div>
            <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-1.5">
              Uraian Tugas
            </h3>
            <p className="rounded-lg bg-slate-50 dark:bg-slate-800/50 p-3 text-sm text-slate-700 dark:text-slate-300 whitespace-pre-line border border-slate-200/60 dark:border-slate-700/60">
              {task.description}
            </p>
          </div>
        )}

        {/* Riwayat Perjalanan Audit Tugas */}
        <div>
          <h3 className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">
            Riwayat Aktivitas
          </h3>
          {loadingEvents ? (
            <div className="flex justify-center py-6">
              <Spinner className="h-5 w-5 text-brand-600" />
            </div>
          ) : events.length === 0 ? (
            <p className="text-xs text-slate-500">Belum ada aktivitas tercatat.</p>
          ) : (
            <ol className="relative border-l border-slate-200 dark:border-slate-700 ml-2 space-y-4 py-1">
              {events.map((ev, idx) => (
                <li key={idx} className="ml-4">
                  <div className="absolute -left-1.5 mt-1.5 h-3 w-3 rounded-full border border-white dark:border-slate-900 bg-brand-500" />
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                      {ev.event_type}
                    </span>
                    <time className="text-[11px] text-slate-400">{formatDateTime(ev.occurred_at)}</time>
                  </div>
                  {ev.actor_name && (
                    <p className="text-xs text-slate-500 dark:text-slate-400">Oleh: {ev.actor_name}</p>
                  )}
                  {ev.note && (
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 bg-slate-50 dark:bg-slate-800 p-2 rounded-md">
                      {ev.note}
                    </p>
                  )}
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </Modal>
  )
}

function ReassignModal({ task, onClose, onDone }) {
  const { notify } = useNotifications()
  const [people, setPeople] = useState([])
  const [pick, setPick] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    tasksApi.assignees(task.application_id)
      .then((r) => setPeople(r?.data || []))
      .catch((e) => setError(e?.message || 'Gagal memuat daftar petugas.'))
  }, [task.application_id])

  const options = useMemo(
    () => people.filter((p) => p.id !== task.assignee_id).map((p) => ({ value: p.id, label: p.name, description: p.email })),
    [people, task.assignee_id],
  )

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
    <Modal
      open
      title="Alihkan tugas"
      subtitle={task.title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button onClick={save} loading={busy} disabled={!pick}>Alihkan</Button>
        </>
      }
    >
      {error && <Alert variant="error">{error}</Alert>}
      <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Penerima baru</label>
      <SearchSelect
        options={options}
        value={pick}
        onChange={setPick}
        placeholder="Cari petugas…"
        ariaLabel="Penerima baru"
      />
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

  useEffect(() => {
    slaApi.configurations()
      .then((r) => setTypes((r?.data || []).filter((t) => t.kind !== 'SERVICE')))
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (debounced.trim().length < 2) return
    applicationApi.list({ search: debounced.trim(), per_page: 20 })
      .then((r) => setApps(r?.data || []))
      .catch(() => setApps([]))
  }, [debounced])

  useEffect(() => {
    setPeople([])
    setForm((f) => ({ ...f, assignee_id: '' }))
    if (appId) {
      tasksApi.assignees(appId)
        .then((r) => setPeople(r?.data || []))
        .catch((e) => setError(e?.message || 'Gagal memuat daftar petugas.'))
    }
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
    <Modal
      open
      title="Tugas baru"
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Batal</Button>
          <Button type="submit" form="task-form" loading={busy} disabled={!valid}>Buat tugas</Button>
        </>
      }
    >
      <form id="task-form" onSubmit={save} className="space-y-4">
        {error && <Alert variant="error">{error}</Alert>}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Permohonan</label>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Ketik no. permohonan atau nama pelanggan (min. 2 huruf)"
            className="mb-2 block w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-base sm:text-sm"
          />
          <SearchSelect
            options={appOptions}
            value={appId}
            onChange={setAppId}
            placeholder="Pilih permohonan…"
            ariaLabel="Permohonan"
            emptyText="Ketik pencarian di atas dulu."
          />
        </div>
        <div>
          <label htmlFor="task-type" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Jenis tugas</label>
          <select
            id="task-type"
            value={form.task_type}
            onChange={(e) => setForm({ ...form, task_type: e.target.value })}
            className="block w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-base sm:text-sm"
          >
            <option value="">Pilih jenis…</option>
            {types.map((t) => <option key={t.task_type} value={t.task_type}>{t.label}</option>)}
          </select>
          {selectedType && (
            <p className="mt-1 text-xs text-slate-500">
              {selectedType.is_active && selectedType.working_days
                ? `Tenggat ${selectedType.working_days} hari kerja.`
                : 'Jenis ini belum punya tenggat.'}
            </p>
          )}
        </div>
        <div>
          <label htmlFor="task-title" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Judul</label>
          <input
            id="task-title"
            required
            maxLength={200}
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            className="block w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-base sm:text-sm"
          />
        </div>
        <div>
          <label htmlFor="task-desc" className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Uraian (opsional)</label>
          <textarea
            id="task-desc"
            rows={3}
            maxLength={2000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            className="block w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-base sm:text-sm"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-200 mb-1">Penerima</label>
          <SearchSelect
            options={peopleOptions}
            value={form.assignee_id}
            onChange={(v) => setForm({ ...form, assignee_id: v })}
            placeholder={appId ? 'Pilih petugas…' : 'Pilih permohonan dulu'}
            ariaLabel="Penerima"
            disabled={!appId}
          />
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

      <section aria-labelledby="sla-h" className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 id="sla-h" className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <IconClock className="h-5 w-5 text-brand-600" />
              Tenggat tugas dan SLA layanan
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Dihitung dalam hari kerja (Senin–Jumat, di luar hari libur di bawah) sejak tugas diberikan. Kosong = tanpa tenggat. Perubahan hanya berlaku untuk tugas baru.
            </p>
          </div>
        </div>

        <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
          {state.rows.map((r) => (
            <li key={r.task_type} className="flex flex-wrap items-center justify-between gap-3 p-3.5">
              <span className="text-sm font-medium text-slate-800 dark:text-slate-200">
                {r.label}
                {r.kind === 'SERVICE' && (
                  <span className="ml-2 rounded-full bg-blue-50 dark:bg-blue-950 px-2 py-0.5 text-xs font-normal text-blue-700 dark:text-blue-300">
                    (sejak tanggal bayar)
                  </span>
                )}
              </span>
              {state.canManage ? (
                <span className="flex items-center gap-2">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    inputMode="numeric"
                    aria-label={`Hari kerja ${r.label}`}
                    value={draft[r.task_type] ?? (r.working_days ?? '')}
                    onChange={(e) => setDraft({ ...draft, [r.task_type]: e.target.value })}
                    className="w-20 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1.5 text-base sm:text-sm text-center"
                  />
                  <span className="text-xs text-slate-500">hari kerja</span>
                  <Button size="sm" variant="secondary" onClick={() => saveRow(r)}>
                    Simpan
                  </Button>
                </span>
              ) : (
                <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">
                  {r.working_days ? `${r.working_days} hari kerja` : 'Tanpa tenggat'}
                </span>
              )}
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="hol-h" className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs space-y-4">
        <div>
          <h2 id="hol-h" className="text-base font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <IconCalendar className="h-5 w-5 text-brand-600" />
            Hari libur {new Date().getFullYear()}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            Daftar libur nasional yang tidak dihitung sebagai hari kerja SLA.
          </p>
        </div>

        {holidays.length === 0 ? (
          <p className="text-sm text-slate-500">Belum ada hari libur tercatat.</p>
        ) : (
          <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/30">
            {holidays.map((h) => (
              <li key={h.holiday_date} className="flex items-center justify-between gap-3 p-3.5 text-sm">
                <span className="font-medium text-slate-800 dark:text-slate-200">
                  {formatDue(h.holiday_date)} · {h.name}
                </span>
                {state.canManage && (
                  <Button
                    size="xs"
                    variant="outline"
                    onClick={() => removeDay(String(h.holiday_date).slice(0, 10))}
                  >
                    Hapus
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}

        {state.canManage && (
          <form onSubmit={addDay} className="flex flex-wrap items-end gap-3 pt-2">
            <div>
              <label htmlFor="hol-date" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Tanggal Libur
              </label>
              <input
                id="hol-date"
                type="date"
                required
                value={newDay.holiday_date}
                onChange={(e) => setNewDay({ ...newDay, holiday_date: e.target.value })}
                className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-base sm:text-sm"
              />
            </div>
            <div className="flex-1 min-w-48">
              <label htmlFor="hol-name" className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
                Nama Hari Libur
              </label>
              <input
                id="hol-name"
                required
                maxLength={150}
                placeholder="Contoh: Tahun Baru Imlek, Idul Fitri"
                value={newDay.name}
                onChange={(e) => setNewDay({ ...newDay, name: e.target.value })}
                className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-base sm:text-sm"
              />
            </div>
            <Button type="submit" size="md">
              Tambah
            </Button>
          </form>
        )}
      </section>
    </div>
  )
}

const SERVICE_STATUS = {
  NOT_STARTED: { label: 'Belum bayar', cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700' },
  ON_TRACK: { label: 'Dalam SLA', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60' },
  DUE_SOON: { label: 'Segera jatuh tempo', cls: 'bg-amber-50 text-amber-800 border-amber-200 dark:bg-amber-950/50 dark:text-amber-300 dark:border-amber-800/60' },
  OVERDUE: { label: 'Melewati SLA', cls: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800/60' },
  MET: { label: 'Selesai tepat waktu', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/50 dark:text-emerald-300 dark:border-emerald-800/60' },
  MET_LATE: { label: 'Selesai terlambat', cls: 'bg-red-50 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-300 dark:border-red-800/60' },
}

const BASIS = {
  PAID: 'sejak tanggal bayar',
  STATUS_BAYAR: 'sejak status Bayar tercatat (tanggal bayar belum ada)',
  REQUESTED: 'sejak tanggal permohonan (tanggal bayar belum ada)',
}

const SERVICE_FILTERS = [
  { v: 'RUNNING', label: 'Sedang berjalan' },
  { v: 'OVERDUE', label: 'Melewati SLA' },
  { v: 'DUE_SOON', label: 'Segera jatuh tempo' },
  { v: 'MET_LATE', label: 'Selesai terlambat' },
  { v: 'MET', label: 'Selesai tepat waktu' },
  { v: 'NOT_STARTED', label: 'Belum bayar' },
  { v: '', label: 'Semua' },
]

/** SLA layanan perluasan jaringan (14/24/100 hari kerja sejak bayar) dan keterangan keterlambatan, mis. material belum lengkap. */
function ServiceSlaPanel() {
  const [filter, setFilter] = useState('RUNNING')
  const [needsNote, setNeedsNote] = useState(false)
  const [search, setSearch] = useState('')
  const debounced = useDebounce(search, 350)
  const [page, setPage] = useState(1)
  const [state, setState] = useState({ loading: true, error: '', rows: [], meta: null })
  const [summary, setSummary] = useState(null)
  const [openFor, setOpenFor] = useState(null)

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const [list, sum] = await Promise.all([
        serviceSlaApi.list({
          status: filter,
          needs_note: needsNote ? 1 : '',
          search: debounced.trim(),
          page,
          per_page: 25,
        }),
        serviceSlaApi.summary(),
      ])
      setState({ loading: false, error: '', rows: list?.data || [], meta: list?.meta || null })
      setSummary(sum?.data || null)
    } catch (err) {
      setState({ loading: false, error: err?.message || 'Gagal memuat SLA layanan.', rows: [], meta: null })
    }
  }, [filter, needsNote, debounced, page])

  useEffect(() => { load() }, [load])

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/40 dark:bg-blue-950/20 p-4">
        <div className="flex items-start gap-3">
          <IconInfo className="h-5 w-5 text-blue-600 dark:text-blue-400 mt-0.5 shrink-0" />
          <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">
            Perluasan jaringan: <span className="font-semibold text-slate-900 dark:text-slate-100">14 hari kerja</span> (tiang JTR saja), <span className="font-semibold text-slate-900 dark:text-slate-100">24 hari kerja</span> (JTM / trafo), <span className="font-semibold text-slate-900 dark:text-slate-100">100 hari kerja</span> (kubikel), dihitung sejak tanggal bayar. Permohonan yang melewati SLA perlu diberi keterangan, misalnya material belum lengkap.
          </p>
        </div>
      </div>

      {summary && (
        <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Stat label="Melewati SLA" value={summary.overdue} danger icon={IconAlertCircle} />
          <Stat label="Segera jatuh tempo" value={summary.due_soon} highlight icon={IconClock} />
          <Stat label="Dalam SLA" value={summary.on_track} icon={IconCheckCircle} />
          <Stat label="Selesai terlambat" value={summary.met_late} danger icon={IconAlertCircle} />
        </dl>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5">
        <div>
          <label htmlFor="svc-filter" className="block text-xs font-medium text-slate-500 mb-1">
            Status SLA
          </label>
          <select
            id="svc-filter"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value)
              setPage(1)
            }}
            className="rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-base sm:text-sm text-slate-700 dark:text-slate-200"
          >
            {SERVICE_FILTERS.map((f) => (
              <option key={f.v} value={f.v}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="flex-1 min-w-48">
          <label htmlFor="svc-search" className="block text-xs font-medium text-slate-500 mb-1">
            Cari Permohonan
          </label>
          <input
            id="svc-search"
            type="search"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setPage(1)
            }}
            placeholder="No. permohonan atau nama pelanggan…"
            className="w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1.5 text-base sm:text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200 pb-2 cursor-pointer">
          <input
            type="checkbox"
            checked={needsNote}
            onChange={(e) => {
              setNeedsNote(e.target.checked)
              setPage(1)
            }}
            className="h-4 w-4 rounded border-slate-300 text-brand-600 focus:ring-brand-500"
          />
          Belum ada keterangan
        </label>
      </div>

      {state.error && <Alert variant="error">{state.error}</Alert>}

      {state.loading ? (
        <div className="flex justify-center py-12"><Spinner /></div>
      ) : state.rows.length === 0 ? (
        <EmptyState
          icon={IconClipboard}
          title="Tidak ada permohonan"
          description="Hanya permohonan perluasan jaringan yang sudah memiliki MTO yang punya SLA layanan."
        />
      ) : (
        <div className="space-y-3.5">
          {state.rows.map((r) => {
            const st = SERVICE_STATUS[r.status] || SERVICE_STATUS.ON_TRACK
            return (
              <article
                key={r.application_id}
                className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-xs hover:border-slate-300 dark:hover:border-slate-700 transition-all"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">
                      <Link className="text-brand-700 dark:text-brand-300 hover:underline" to={`/permohonan/${r.application_id}`}>
                        {r.application_number}
                      </Link>
                      {' · '}
                      <span>{r.customer_name}</span>
                    </h2>
                    <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">
                      {r.category_label} · {r.working_days} hari kerja · {r.unit_name}
                    </p>
                  </div>
                  <span className={`${pill} ${st.cls}`}>
                    {st.label}
                    {r.late_working_days > 0 ? ` ${r.late_working_days} hari kerja` : ''}
                  </span>
                </div>

                <p className="mt-2.5 text-xs text-slate-600 dark:text-slate-300">
                  {r.due_at ? (
                    <>Tenggat {formatDue(r.due_at)} ({BASIS[r.start_basis]})</>
                  ) : (
                    'SLA mulai berjalan setelah pelanggan membayar.'
                  )}
                </p>

                {r.last_note ? (
                  <div className="mt-3 rounded-lg border border-slate-200/60 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-800/40 p-2.5 text-sm text-slate-700 dark:text-slate-300">
                    <span className="font-medium text-slate-900 dark:text-slate-100">Keterangan:</span> {r.last_note.note}
                  </div>
                ) : (
                  ['OVERDUE', 'MET_LATE'].includes(r.status) && (
                    <p className="mt-2 text-sm text-red-700 dark:text-red-300 font-medium">
                      Belum ada keterangan keterlambatan.
                    </p>
                  )
                )}

                <div className="mt-3.5 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <Button
                    size="sm"
                    variant={['OVERDUE', 'MET_LATE'].includes(r.status) && !r.last_note ? 'primary' : 'outline'}
                    onClick={() => setOpenFor(r)}
                  >
                    Keterangan &amp; material
                  </Button>
                </div>
              </article>
            )
          })}

          {state.meta && (
            <TableFooter
              itemCount={state.rows.length}
              total={state.meta.total}
              entityLabel="permohonan"
              page={state.meta.current_page}
              perPage={25}
              onPage={setPage}
              onPerPage={() => {}}
              perPageOptions={[25]}
            />
          )}
        </div>
      )}

      {openFor && <ServiceNoteModal row={openFor} onClose={() => setOpenFor(null)} onSaved={load} />}
    </div>
  )
}

function ServiceNoteModal({ row, onClose, onSaved }) {
  const { notify } = useNotifications()
  const [state, setState] = useState({ loading: true, error: '', data: null, canNote: false })
  const [note, setNote] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      const r = await serviceSlaApi.forApplication(row.application_id)
      setState({ loading: false, error: '', data: r?.data || null, canNote: Boolean(r?.can?.note) })
    } catch (err) {
      setState({ loading: false, error: err?.message || 'Gagal memuat rincian.', data: null, canNote: false })
    }
  }, [row.application_id])

  useEffect(() => { load() }, [load])

  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await serviceSlaApi.addNote(row.application_id, note.trim())
      notify({ type: 'success', title: 'Keterangan disimpan', desc: row.application_number, tag: 'SLA' })
      setNote('')
      await load()
      onSaved?.()
    } catch (err) {
      setState((s) => ({ ...s, error: err?.message || 'Gagal menyimpan keterangan.' }))
    } finally {
      setBusy(false)
    }
  }

  const d = state.data
  const shortfall = d?.materials?.shortfall || []

  return (
    <Modal
      open
      title="Keterangan SLA layanan"
      subtitle={`${row.application_number} · ${row.customer_name}`}
      onClose={onClose}
      footer={<Button variant="secondary" onClick={onClose}>Tutup</Button>}
    >
      {state.loading ? (
        <div className="flex justify-center py-8"><Spinner /></div>
      ) : (
        <div className="space-y-5">
          {state.error && <Alert variant="error">{state.error}</Alert>}
          {d && (
            <section aria-labelledby="mat-h" className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 bg-slate-50/50 dark:bg-slate-900/40">
              <h3 id="mat-h" className="text-sm font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Kelengkapan material
              </h3>
              {!d.materials.known ? (
                <p className="text-sm text-slate-500">MTO belum disetujui, kelengkapan material belum dapat dinilai.</p>
              ) : d.materials.complete ? (
                <p className="text-sm font-medium text-emerald-700 dark:text-emerald-300">
                  Semua material PLN sudah dialokasikan.
                </p>
              ) : shortfall.length === 0 ? (
                <p className="text-sm text-amber-700 dark:text-amber-300">
                  Ada material yang belum dialokasikan (rinciannya tampil bila permohonan sudah mendekati atau melewati SLA).
                </p>
              ) : (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-amber-700 dark:text-amber-300">
                    Material belum dialokasikan:
                  </p>
                  <ul className="divide-y divide-slate-200 dark:divide-slate-700 rounded-lg border border-slate-200 dark:border-slate-700 text-sm bg-white dark:bg-slate-900">
                    {shortfall.map((m) => (
                      <li key={m.khs_code} className="flex justify-between items-center gap-3 p-2.5">
                        <span className="min-w-0 font-medium text-slate-800 dark:text-slate-200">
                          {m.khs_code} · {m.khs_name}
                        </span>
                        <span className="shrink-0 rounded-full bg-red-50 dark:bg-red-950 px-2 py-0.5 text-xs font-semibold text-red-700 dark:text-red-300">
                          kurang {m.remaining} {m.unit_text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </section>
          )}

          <section aria-labelledby="note-h" className="space-y-3">
            <h3 id="note-h" className="text-sm font-semibold text-slate-900 dark:text-slate-100">
              Keterangan keterlambatan
            </h3>
            {(d?.notes || []).length === 0 ? (
              <p className="text-sm text-slate-500">Belum ada keterangan.</p>
            ) : (
              <ul className="space-y-2.5 max-h-60 overflow-y-auto">
                {d.notes.map((n) => (
                  <li key={n.id} className="rounded-lg bg-slate-50 dark:bg-slate-800 p-3 text-sm border border-slate-200/60 dark:border-slate-700/60">
                    <p className="whitespace-pre-line text-slate-800 dark:text-slate-200">{n.note}</p>
                    <p className="mt-1.5 text-xs text-slate-500 dark:text-slate-400">
                      {n.author} · {formatDue(n.created_at)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            {state.canNote && (
              <form onSubmit={save} className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-700">
                <label htmlFor="sla-note" className="block text-sm font-medium text-slate-700 dark:text-slate-200">
                  Tambah keterangan
                </label>
                <textarea
                  id="sla-note"
                  rows={3}
                  maxLength={1000}
                  required
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Contoh: kabel TIC 3x70 belum tersedia di gudang, menunggu pengiriman."
                  className="block w-full rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-base sm:text-sm text-slate-900 dark:text-slate-100 placeholder:text-slate-400"
                />
                <Button type="submit" loading={busy} disabled={!note.trim()}>
                  Simpan keterangan
                </Button>
              </form>
            )}
          </section>
        </div>
      )}
    </Modal>
  )
}
