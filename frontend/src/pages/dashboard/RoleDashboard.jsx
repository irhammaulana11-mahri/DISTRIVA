import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../../features/auth/AuthContext.jsx'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { reportsApi, workOrdersApi, materialRequestsApi, applicationApi } from '../../services/api.js'
import { buildDashboard } from '../../features/dashboard/dashboardModel.js'
import { PROFILE_LABEL } from '../../features/dashboard/profiles.js'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import { IconRefresh, IconChevronRight } from '../../components/icons.jsx'

const TONE = {
  amber: 'text-amber-600 dark:text-amber-400',
  rose: 'text-rose-600 dark:text-rose-400',
  default: 'text-slate-900 dark:text-slate-100',
}

const WITH_OVERVIEW = ['niaga', 'mulp', 'teknik', 'konstruksi', 'perencanaan', 'executive', 'viewer']

/** Memuat data dari endpoint yang sudah ada sesuai profil; kegagalan satu sumber tidak menjatuhkan seluruh dasbor. */
function useDashboardData(profile, can) {
  const [state, setState] = useState({ loading: true, data: {}, failed: [] })

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true }))
    const jobs = {}
    if (WITH_OVERVIEW.includes(profile) && can['reports.view']) {
      jobs.overview = reportsApi.overview().then((r) => r?.data ?? null)
      jobs.pipeline = reportsApi.pipeline().then((r) => r?.data ?? [])
    }
    if (['konstruksi', 'vendor', 'executive'].includes(profile) && (can['wo.view'] || can['vendor.portal'])) {
      jobs.workOrders = workOrdersApi.list().then((r) => r?.data ?? [])
    }
    if (profile === 'konstruksi' && can['material_requests.view']) {
      jobs.followup = materialRequestsApi.list({ followup: true, per_page: 1 })
    }
    if (profile === 'niaga' && can['applications.view']) {
      jobs.apps = applicationApi
        .list({ listing: 'pbpd', lifecycle: 'active', per_page: 100 })
        .then((r) => r?.data ?? [])
    }
    const keys = Object.keys(jobs)
    const settled = await Promise.allSettled(keys.map((k) => jobs[k]))
    const data = {}
    const failed = []
    settled.forEach((s, i) => {
      if (s.status === 'fulfilled') data[keys[i]] = s.value
      else failed.push(keys[i])
    })
    setState({ loading: false, data, failed })
  }, [profile, can])

  useEffect(() => {
    load()
  }, [load])

  return { ...state, reload: load }
}

function StatCard({ label, value, hint, to, tone = 'default' }) {
  const body = (
    <>
      <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
      <span className={`mt-1.5 text-2xl font-bold tabular-nums ${value === null ? 'text-slate-300 dark:text-slate-600' : TONE[tone] || TONE.default}`}>
        {value === null || value === undefined ? '–' : value}
      </span>
      {hint && <span className="mt-0.5 text-[10px] text-slate-400">{hint}</span>}
    </>
  )
  const cls =
    'flex flex-col rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition'
  return to ? (
    <Link to={to} className={`${cls} hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm`}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}

function ActionList({ items }) {
  if (!items.length) return null
  return (
    <section className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
      <h2 className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">
        Perlu tindakan
      </h2>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {items.map((a) => (
          <li key={a.key}>
            <Link to={a.to} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 dark:hover:bg-slate-800/40">
              <span className="min-w-0">
                <span className="block text-sm font-medium text-slate-800 dark:text-slate-100">{a.label}</span>
                {a.desc && <span className="block text-xs text-slate-500">{a.desc}</span>}
              </span>
              <span className="flex items-center gap-2 shrink-0">
                <span
                  className={`rounded-full px-2.5 py-0.5 text-xs font-bold tabular-nums ${
                    a.count > 0
                      ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                      : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                  }`}
                >
                  {a.count === null || a.count === undefined ? '–' : a.count}
                </span>
                <IconChevronRight size={14} className="text-slate-400" />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

function Funnel({ stages }) {
  if (!stages.length) return null
  const max = Math.max(1, ...stages.map((s) => s.value))
  return (
    <section className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-xs">
      <h2 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-3">Alur pekerjaan (cakupan unit Anda)</h2>
      <ul className="space-y-2">
        {stages.map((s) => (
          <li key={s.key} className="flex items-center gap-2 sm:gap-3 text-xs">
            <span className="w-24 sm:w-32 shrink-0 truncate text-slate-600 dark:text-slate-400">{s.label}</span>
            <span className="h-2.5 flex-1 rounded-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
              <span className="block h-full rounded-full bg-blue-500" style={{ width: `${(s.value / max) * 100}%` }} />
            </span>
            <span className="w-8 sm:w-10 text-right font-mono font-semibold tabular-nums">{s.value}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function OrderList({ orders }) {
  if (!orders.length) return null
  return (
    <section className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
      <h2 className="px-5 py-3 text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 border-b border-slate-100 dark:border-slate-800">
        SPK aktif
      </h2>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {orders.map((o) => (
          <li key={o.id}>
            <Link to="/work-orders" className="flex items-center justify-between gap-3 px-5 py-2.5 hover:bg-slate-50 dark:hover:bg-slate-800/40 text-xs">
              <span className="font-mono font-semibold">{o.wo_number}</span>
              <span className="flex-1 text-slate-500 truncate">{o.application_number}</span>
              <StatusBadge status={o.status} />
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function RoleDashboard({ profile }) {
  const { user } = useAuth()
  const { can } = useAccess()
  const { loading, data, failed, reload } = useDashboardData(profile, can)
  const model = buildDashboard(profile, data)

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 sm:p-5 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-lg sm:text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100">Selamat datang, {user?.name}</h1>
          <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400">
            Dasbor kerja: <strong>{PROFILE_LABEL[profile]}</strong>
          </p>
        </div>
        <button
          type="button"
          onClick={reload}
          aria-label="Muat ulang dasbor"
          className="self-start sm:self-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 px-3 py-1.5 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 cursor-pointer"
        >
          <IconRefresh size={14} />
          <span>Muat ulang</span>
        </button>
      </section>

      {failed.length > 0 && (
        <Alert kind="warning">
          Sebagian data dasbor gagal dimuat ({failed.join(', ')}). Angka yang tidak tersedia ditampilkan sebagai “–”.
        </Alert>
      )}

      {loading && model.kpis.every((k) => k.value === null) ? (
        <div className="py-10 text-center">
          <Spinner label="Memuat dasbor…" />
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            {model.kpis.map(({ key, ...k }) => (
              <StatCard key={key} {...k} />
            ))}
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <ActionList items={model.actions} />
            <OrderList orders={model.orders} />
            <Funnel stages={model.funnel} />
          </div>

          {model.notes.map((n) => (
            <p key={n} className="text-[11px] text-slate-400">
              {n}
            </p>
          ))}
        </>
      )}
    </div>
  )
}
