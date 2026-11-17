import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { workOrdersApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Drawer from '../../components/Drawer.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import { AgendaFacts, OutboxBadge, ProgressBar, RevisionBadge } from './AgendaParts.jsx'
import { PoleWoStatusBadge } from './PoleWoStatusBadge.jsx'
import {
  IconArrowRight,
  IconCheckCircle,
  IconClock,
  IconEye,
  IconPlus,
  IconRefresh,
  IconSearch,
  IconWrench,
} from '../../components/icons.jsx'
import { filterSearchCls } from '../../components/filterStyles.js'

const FILTERS = [
  { key: 'ALL', label: 'Semua' },
  { key: 'NEEDS', label: 'Perlu dibuat', internalOnly: true },
  { key: 'FOLLOWUP', label: 'Outbox perlu tindak lanjut', internalOnly: true },
  { key: 'DRAFT', label: 'Draf' },
  { key: 'ISSUED', label: 'Diterbitkan' },
  { key: 'IN_PROGRESS', label: 'Dalam Pengerjaan' },
  { key: 'COMPLETED', label: 'Selesai' },
]

const dateId = (v) => (v ? new Date(v).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' }) : '-')

const isOverdue = (n) => Boolean(n.target_date) && ['ISSUED', 'IN_PROGRESS'].includes(n.status) && n.target_date < new Date().toLocaleDateString('en-CA')
const needsWo = (r) => r.network_creatable || r.poles_creatable_quantity > 0

function matchesFilter(r, key) {
  if (key === 'ALL') return true
  if (key === 'NEEDS') return needsWo(r)
  if (key === 'FOLLOWUP') return Boolean(r.material_request?.needs_followup)
  return r.network?.status === key || r.poles.some((p) => p.status === key)
}

function matchesSearch(r, q) {
  if (!q) return true
  const hay = [r.agenda_number, r.application_number, r.customer_name, r.unit_name, r.network?.wo_number, r.network?.vendor_name, ...r.poles.flatMap((p) => [p.letter_number, p.vendor_name])]
  return hay.some((v) => v && String(v).toLowerCase().includes(q))
}

export default function WorkOrdersPage() {
  const { can, isSysAdmin } = useAccess()
  const { notify } = useNotifications()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [rows, setRows] = useState([])
  const [params] = useSearchParams()
  const [filter, setFilter] = useState(() => (params.get('filter') === 'followup' ? 'FOLLOWUP' : 'ALL'))
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [selectedId, setSelectedId] = useState(null)
  const [creating, setCreating] = useState(null)

  const isVendor = Boolean(can['vendor.portal'])
  const perms = {
    isVendor,
    create: Boolean(can['wo.create'] || isSysAdmin),
    issue: Boolean(can['wo.issue'] || isSysAdmin),
    submitProgress: false, // progres pekerjaan hanya dilaporkan akun Pelaksana (portal vendor); internal memverifikasi
    verifyProgress: Boolean(can['wo.progress_verify'] || isSysAdmin),
    complete: Boolean(can['wo.complete'] || isSysAdmin),
    managePoles: Boolean(can['pole_wo.manage'] || isSysAdmin),
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await workOrdersApi.byAgenda()
      setRows(res?.data || [])
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Gagal memuat daftar SPK / WO.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const q = search.trim().toLowerCase()
  const filtered = useMemo(() => rows.filter((r) => matchesFilter(r, filter) && matchesSearch(r, q)), [rows, filter, q])
  const paginated = filtered.slice((page - 1) * perPage, page * perPage)
  const countOf = (key) => rows.filter((r) => matchesFilter(r, key)).length

  const createNetwork = async (row) => {
    setCreating(row.application_id)
    try {
      await workOrdersApi.create(row.application_id)
      notify({ type: 'success', title: 'WO Jaringan Dibuat', desc: `Draf WO jaringan untuk ${row.application_number} dibuat. Pilih vendor lalu ajukan.`, tag: 'WO' })
      navigate(`/work-orders/${row.application_id}`)
    } catch (err) {
      notify({ type: 'error', title: 'Gagal Membuat WO', desc: err?.response?.data?.message || err?.message || 'WO tidak dapat dibuat.', tag: 'WO' })
    } finally {
      setCreating(null)
    }
  }

  const selected = rows.find((r) => r.application_id === selectedId) || null
  const visibleFilters = FILTERS.filter((f) => !f.internalOnly || !isVendor)

  const stats = useMemo(() => {
    return {
      total: rows.length,
      inProgress: rows.filter((r) => r.network?.status === 'IN_PROGRESS' || r.poles.some((p) => p.status === 'IN_PROGRESS')).length,
      needsWoCount: rows.filter((r) => needsWo(r)).length,
      completed: rows.filter((r) => (r.network?.status === 'COMPLETED' || (r.network == null && r.poles.length > 0)) && r.poles.every((p) => p.status === 'COMPLETED')).length,
    }
  }, [rows])

  return (
    <div className="space-y-6">
      {/* Header Modul SPK / WO */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
              <IconWrench className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Surat Perintah Kerja (SPK / WO)
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Konstruksi &amp; Pelaksanaan
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                {isVendor
                  ? 'Penugasan konstruksi dan pemasangan tiang yang diberikan kepada perusahaan Anda, per No. Agenda.'
                  : 'WO jaringan dan WO tiang dikelompokkan per No. Agenda. Buat, terbitkan, dan pantau progres dari sini.'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={load}
            title="Muat Ulang"
            aria-label="Muat Ulang"
            className="self-start sm:self-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 text-xs font-medium transition cursor-pointer shadow-2xs"
          >
            <IconRefresh size={14} />
            <span>Segarkan</span>
          </button>
        </div>
      </div>

      {/* KPI Ringkasan Metrik SPK / WO */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Agenda SPK</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconWrench className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {stats.total}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Agenda terdaftar</p>
        </div>

        <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-blue-700 dark:text-blue-400">Dalam Pengerjaan</dt>
            <div className="rounded-lg p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <IconClock className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {stats.inProgress}
          </dd>
          <p className="mt-1 text-xs text-blue-600/70 dark:text-blue-500/70">Pekerjaan aktif di lapangan</p>
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-amber-700 dark:text-amber-400">Perlu Dibuat</dt>
            <div className="rounded-lg p-1.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
              <IconPlus className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {stats.needsWoCount}
          </dd>
          <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-500/70">Menunggu penerbitan WO</p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Selesai</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {stats.completed}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Pekerjaan tuntas</p>
        </div>
      </dl>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
          <div className="flex items-center gap-1 flex-wrap">
            {visibleFilters.map(({ key, label }) => {
              const count = countOf(key)
              const active = filter === key
              return (
                <button key={key} type="button" onClick={() => { setFilter(key); setPage(1) }} aria-pressed={active}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition cursor-pointer ${active ? 'bg-blue-600 text-white shadow-xs' : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200/70 dark:hover:bg-slate-700'}`}>
                  {label}
                  {count > 0 && <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${active ? 'bg-white/20 text-white' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-400'}`}>{count}</span>}
                </button>
              )
            })}
          </div>
          <div className="relative lg:ml-auto lg:w-80">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400"><IconSearch size={14} /></span>
            <input type="text" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1) }} placeholder="Cari No. Agenda, pelanggan, nomor WO / surat, vendor..." aria-label="Cari"
              className={`${filterSearchCls} w-full`} />
          </div>
        </div>

        {error && <div className="p-5"><Alert kind="error">{error}</Alert></div>}
        {loading && <div className="py-16"><Spinner /></div>}

        {!loading && !error && filtered.length === 0 && (
          <EmptyState
            icon={IconWrench}
            title={rows.length === 0 ? 'Belum ada Surat Perintah Kerja' : 'Tidak ada data yang cocok'}
            description={rows.length === 0
              ? (isVendor ? 'SPK dan WO tiang yang diterbitkan untuk perusahaan Anda akan tampil di sini.' : 'WO jaringan dapat dibuat setelah MTO disetujui dan RAB tersedia; WO tiang setelah alokasi tiang dikonfirmasi.')
              : 'Coba ubah filter atau kosongkan pencarian.'}
          />
        )}

        {!loading && paginated.length > 0 && (
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm data-table">
              <thead className="border-b border-slate-100 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-800/60 text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                <tr>
                  <th className="py-3 px-4">No. Agenda</th>
                  <th className="py-3 px-4">Pelanggan</th>
                  <th className="py-3 px-4">WO Jaringan</th>
                  <th className="py-3 px-4">WO Tiang</th>
                  <th className="py-3 px-4 min-w-44">Progres Pekerjaan</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {paginated.map((r) => (
                  <tr key={r.application_id} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition align-top">
                    <td className="py-3 px-4">
                      {r.agenda_number
                        ? <div className="font-mono font-bold text-slate-900 dark:text-slate-100 text-sm">{r.agenda_number}</div>
                        : <div className="text-xs text-amber-600 dark:text-amber-400">Belum ada No. Agenda</div>}
                      <div className="font-mono text-[11px] text-blue-600 dark:text-blue-400 mt-0.5">{r.application_number}</div>
                    </td>
                    <td className="py-3 px-4">
                      <div className="text-xs font-semibold text-slate-800 dark:text-slate-200">{r.customer_name || '-'}</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">{r.unit_name}</div>
                    </td>
                    <td className="py-3 px-4">
                      {r.network ? (
                        <div className="space-y-1">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-mono text-xs font-semibold text-slate-900 dark:text-slate-100">{r.network.wo_number}</span>
                            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">v{r.network.version_number}</span>
                            <StatusBadge status={r.network.status} />
                          </div>
                          {r.network.target_date && (
                            <div className={`text-[11px] ${isOverdue(r.network) ? 'text-rose-600 dark:text-rose-400 font-semibold' : 'text-slate-500'}`}>
                              Target {dateId(`${r.network.target_date}T00:00:00`)}{isOverdue(r.network) && ' · lewat target'}
                            </div>
                          )}
                          {!isVendor && <div className="text-[11px] text-slate-500">{r.network.vendor_name || <span className="text-amber-600 dark:text-amber-400">Belum ada vendor</span>}</div>}
                          {r.network.pending_progress > 0 && perms.verifyProgress && <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-950/50 dark:text-blue-400 border border-blue-200 dark:border-blue-800">Progres menunggu verifikasi</span>}
                          <OutboxBadge request={r.material_request} />
                        </div>
                      ) : <span className="text-xs text-slate-400">Belum ada</span>}
                      {r.network_creatable && perms.create && (
                        <div className={r.network ? 'mt-1.5' : 'mt-1'}>
                          <Button size="sm" variant="secondary" loading={creating === r.application_id} onClick={() => createNetwork(r)} aria-label={`Buat WO Jaringan ${r.application_number}`}>
                            <IconPlus size={12} /><span>Buat WO Jaringan</span>
                          </Button>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {r.poles.length > 0 ? (
                        <div className="space-y-1.5">
                          {r.poles.map((p) => (
                            <div key={p.id} className="space-y-0.5">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <Link to={`/wo-tiang/${p.id}`} className="font-mono text-xs font-semibold text-blue-700 dark:text-blue-400 hover:underline">{p.letter_number}</Link>
                                <PoleWoStatusBadge status={p.status} />
                                <RevisionBadge number={p.revision_number} />
                              </div>
                              <div className="text-[11px] text-slate-500">{!isVendor && `${p.vendor_name} · `}{p.quantity} tiang</div>
                            </div>
                          ))}
                        </div>
                      ) : <span className="text-xs text-slate-400">Belum ada</span>}
                      {r.poles_creatable_quantity > 0 && perms.managePoles && (
                        <div className={r.poles.length ? 'mt-1.5' : 'mt-1'}>
                          <Button size="sm" variant="secondary" onClick={() => navigate('/wo-tiang/new')} aria-label={`Buat WO Tiang ${r.application_number}`}>
                            <IconPlus size={12} /><span>Buat WO Tiang ({r.poles_creatable_quantity} tiang siap)</span>
                          </Button>
                        </div>
                      )}
                    </td>
                    <td className="py-3 px-4">
                      {(() => {
                        const net = r.network && r.network.progress_percent != null && ['ISSUED', 'IN_PROGRESS', 'COMPLETED'].includes(r.network.status) ? r.network : null
                        const poles = r.poles.filter((p) => p.progress_percent != null && ['ISSUED', 'IN_PROGRESS', 'COMPLETED'].includes(p.status))
                        if (!net && poles.length === 0) return <span className="text-xs text-slate-400">-</span>
                        return (
                          <div className="space-y-2" aria-label="Progres pekerjaan">
                            {net && <div><div className="text-[10px] uppercase font-semibold text-slate-400 mb-0.5">Jaringan</div><ProgressBar percent={net.progress_percent} wide /></div>}
                            {poles.map((p) => <div key={p.id}><div className="text-[10px] uppercase font-semibold text-slate-400 mb-0.5">Tiang</div><ProgressBar percent={p.progress_percent} wide /></div>)}
                          </div>
                        )
                      })()}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                        <button type="button" onClick={() => setSelectedId(r.application_id)} aria-label={`Detail ${r.application_number}`}
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-300 transition cursor-pointer">
                          <IconEye size={13} /><span>Detail</span>
                        </button>
                        <button type="button" onClick={() => navigate(`/work-orders/${r.application_id}`)} aria-label={`Buka halaman ${r.application_number}`} title="Buka halaman SPK / WO"
                          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 text-xs font-semibold text-white shadow-xs transition cursor-pointer">
                          <span>Buka</span><IconArrowRight size={13} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <TableFooter itemCount={paginated.length} total={filtered.length} entityLabel="agenda" page={page} perPage={perPage} onPage={setPage}
          onPerPage={(n) => { setPerPage(n); setPage(1) }} perPageOptions={[10, 25, 50, 100]} />
      </div>

      {selected && <AgendaPreviewDrawer row={selected} isVendor={isVendor} onClose={() => setSelectedId(null)} />}
    </div>
  )
}

/** Pratinjau read-only satu agenda; pekerjaan (buat, vendor, ajukan, terbitkan, progres) ada di halaman agenda. */
function AgendaPreviewDrawer({ row, isVendor, onClose }) {
  const [wo, setWo] = useState(null)
  const [loading, setLoading] = useState(false)
  const networkId = row.network?.id

  useEffect(() => {
    if (!networkId) { setWo(null); return undefined }
    let alive = true
    setLoading(true)
    workOrdersApi.get(networkId).then((res) => alive && setWo(res?.data || null)).catch(() => alive && setWo(null)).finally(() => alive && setLoading(false))
    return () => { alive = false }
  }, [networkId])

  const PREVIEW_MATERIALS = 6

  return (
    <Drawer open onClose={onClose} title={row.agenda_number ? `Agenda ${row.agenda_number}` : `Permohonan ${row.application_number}`} subtitle={row.customer_name} width="max-w-3xl"
      footer={<div className="flex justify-end"><Button variant="secondary" onClick={onClose}>Tutup</Button></div>}>
      <div className="space-y-5 text-xs">
        <AgendaFacts row={row} />

        <section className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">WO Jaringan</h4>
          {!row.network ? <p className="text-slate-500 italic">Belum ada WO jaringan.{row.network_creatable && ' Dapat dibuat dari halaman SPK / WO.'}</p> : (
            <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="font-mono font-bold text-sm">{row.network.wo_number}</span>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">v{row.network.version_number}</span>
                <StatusBadge status={row.network.status} />
              </div>
              <div className="flex items-center gap-4 flex-wrap text-slate-500">
                {!isVendor && <span>Vendor: <b className="text-slate-700 dark:text-slate-300">{row.network.vendor_name || 'belum ditentukan'}</b></span>}
                {row.network.issued_at && <span>Diterbitkan {dateId(row.network.issued_at)}</span>}
                {row.network.target_date && <span>Target selesai {dateId(`${row.network.target_date}T00:00:00`)}</span>}
                {row.network.completed_at && <span>Selesai {dateId(row.network.completed_at)}</span>}
                {row.network.progress_percent != null && <ProgressBar percent={row.network.progress_percent} />}
                <OutboxBadge request={row.material_request} />
              </div>
              {loading && <Spinner />}
              {wo?.tasks?.length > 0 && (
                <table className="min-w-full text-left">
                  <thead className="text-[11px] text-slate-500 font-semibold uppercase border-b border-slate-100 dark:border-slate-800"><tr><th className="py-1.5 pr-3">Pekerjaan</th><th className="py-1.5 pr-3">Satuan</th><th className="py-1.5 pr-3 text-right">Volume</th><th className="py-1.5 text-right">Progres</th></tr></thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {wo.tasks.map((t) => (
                      <tr key={t.id}><td className="py-1.5 pr-3 text-slate-900 dark:text-slate-100">{t.title}</td><td className="py-1.5 pr-3 text-slate-500">{t.unit}</td><td className="py-1.5 pr-3 text-right font-mono">{t.volume}</td><td className="py-1.5 text-right font-mono font-semibold">{t.verified_percent}%</td></tr>
                    ))}
                  </tbody>
                </table>
              )}
              {wo?.materials?.length > 0 && (
                <div>
                  <div className="text-[11px] text-slate-500 font-semibold uppercase mb-1">Material ({wo.materials.length})</div>
                  <ul className="divide-y divide-slate-100 dark:divide-slate-800">
                    {wo.materials.slice(0, PREVIEW_MATERIALS).map((m) => (
                      <li key={m.khs_code} className="py-1.5 flex items-center justify-between gap-3"><span className="text-slate-900 dark:text-slate-100">{m.khs_name}</span><span className="font-mono text-slate-600 dark:text-slate-300 whitespace-nowrap">{m.quantity?.toLocaleString('id-ID')} {m.unit}</span></li>
                    ))}
                  </ul>
                  {wo.materials.length > PREVIEW_MATERIALS && <p className="text-[11px] text-slate-400 mt-1">dan {wo.materials.length - PREVIEW_MATERIALS} material lain di halaman SPK / WO.</p>}
                </div>
              )}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-600 dark:text-slate-400">WO Tiang</h4>
          {row.poles.length === 0 ? <p className="text-slate-500 italic">Belum ada WO tiang.</p> : row.poles.map((p) => (
            <div key={p.id} className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 space-y-0.5">
              <div className="flex items-center gap-2 flex-wrap"><span className="font-mono font-bold">{p.letter_number}</span><PoleWoStatusBadge status={p.status} /><RevisionBadge number={p.revision_number} /></div>
              <div className="text-slate-500">{!isVendor && `${p.vendor_name} · `}{p.quantity} tiang pada agenda ini</div>
            </div>
          ))}
        </section>
      </div>
    </Drawer>
  )
}
