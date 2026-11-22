import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { maximoSyncApi } from '../../services/api.js'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import Modal from '../../components/Modal.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import {
  IconRefresh,
  IconCheck,
  IconEye,
  IconClipboard,
  IconActivity,
  IconZap,
  IconShieldCheck,
  IconAlertCircle,
} from '../../components/icons.jsx'

const STATUS = {
  QUEUED: ['Menunggu', 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'],
  RUNNING: ['Berjalan', 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'],
  OK: ['Selesai', 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'],
  FAILED: ['Gagal', 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'],
}

const selectCls =
  'px-3 py-1.5 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/20 focus:border-blue-500'

const when = (v) =>
  v ? new Date(v).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' }) : '-'
const dayText = (v) =>
  v
    ? new Date(`${String(v).slice(0, 10)}T00:00:00`).toLocaleDateString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
      })
    : '-'

function StatusBadge({ status }) {
  const [label, cls] = STATUS[status] || [status, STATUS.QUEUED[1]]
  return <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}`}>{label}</span>
}

function SummaryText({ run }) {
  const s = run.summary
  if (!s) return <span className="text-slate-400">-</span>
  return (
    <span className="font-mono text-[11px]" data-testid="run-summary">
      {s.fetched ?? 0}/{s.chosen ?? 0} WO
      {s.failed ? <b className="text-rose-600 dark:text-rose-400"> · {s.failed} gagal</b> : ''}
      {s.load?.readings_stored ? (
        <>
          {' '}
          ·{' '}
          <span className="text-emerald-700 dark:text-emerald-300 font-semibold">
            {s.load.readings_stored} pembacaan baru
          </span>
        </>
      ) : (
        ''
      )}
    </span>
  )
}

/**
 * Tab Riwayat Sinkronisasi Maximo pada halaman Pengukuran Gardu.
 * Memuat rekapitulasi sesi sinkronisasi data gardu (WO inspeksi menjadi pembacaan beban/tegangan),
 * filter status & pemicu, paginasi riwayat, serta penampil log teknis.
 */
export default function SubstationSyncHistory({ onOpenSync }) {
  const navigate = useNavigate()
  const [runs, setRuns] = useState([])
  const [meta, setMeta] = useState(null)
  const [settings, setSettings] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [triggerFilter, setTriggerFilter] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [logRun, setLogRun] = useState(null)
  const [copied, setCopied] = useState(false)

  const loadData = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [showRes, runsRes] = await Promise.all([
        maximoSyncApi.show().catch(() => null),
        maximoSyncApi.runs({
          page,
          per_page: perPage,
          ...(statusFilter ? { status: statusFilter } : {}),
          ...(triggerFilter ? { trigger: triggerFilter } : {}),
        }),
      ])
      if (showRes?.data?.settings) {
        setSettings(showRes.data.settings)
      }
      setRuns(runsRes?.data || [])
      setMeta(runsRes?.meta || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat riwayat sinkronisasi data gardu.')
    } finally {
      setLoading(false)
    }
  }, [page, perPage, statusFilter, triggerFilter])

  useEffect(() => {
    loadData()
  }, [loadData])

  const openLog = async (r) => {
    setLogRun({ ...r, log: null })
    try {
      const res = await maximoSyncApi.run(r.id)
      setLogRun(res?.data || r)
    } catch (err) {
      setLogRun({ ...r, log: err?.message || 'Gagal memuat log teknis sesi ini.' })
    }
  }

  const copyLog = async (text) => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1800)
    } catch {
      /* ignore */
    }
  }

  const lastRun = runs[0] || null
  const hasFilter = Boolean(statusFilter || triggerFilter)

  return (
    <div className="space-y-4" data-testid="substation-sync-history">
      {/* KPI Cards Ringkasan Sinkronisasi */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Akun Maximo</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconShieldCheck className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-base sm:text-lg font-bold tracking-tight text-slate-900 dark:text-slate-100 truncate">
            {settings?.maximo_username || 'Belum diatur'}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">
            {settings?.has_password ? 'Password tersimpan aman' : 'Kredensial belum lengkap'}
          </p>
        </div>

        <div className="rounded-xl border border-indigo-200 dark:border-indigo-900/60 bg-indigo-50/20 dark:bg-indigo-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-indigo-700 dark:text-indigo-400">Otomasi Harian</dt>
            <div className="rounded-lg p-1.5 bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400">
              <IconZap className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-base sm:text-lg font-bold tracking-tight text-indigo-600 dark:text-indigo-400">
            {settings?.auto_enabled ? `Pukul ${settings.auto_time} WIB` : 'Manual Saja'}
          </dd>
          <p className="mt-1 text-xs text-indigo-600/70 dark:text-indigo-400/70">
            {settings?.auto_enabled
              ? `WO selesai ${settings.lookback_days} hari terakhir`
              : 'Otomasi terjadwal non-aktif'}
          </p>
        </div>

        <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-blue-700 dark:text-blue-400">Total Riwayat</dt>
            <div className="rounded-lg p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <IconActivity className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-base sm:text-lg font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {meta?.total ?? runs.length} Sesi
          </dd>
          <p className="mt-1 text-xs text-blue-600/70 dark:text-blue-400/70">
            Jenis pekerjaan: {settings?.work_type || 'INST1'}
          </p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Sesi Terakhir</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheck className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-base sm:text-lg font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {lastRun ? <StatusBadge status={lastRun.status} /> : 'Belum Ada'}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-400/70 truncate">
            {lastRun ? when(lastRun.created_at) : 'Belum pernah disinkronkan'}
          </p>
        </div>
      </dl>

      {/* Toolbar Filter & Aksi */}
      <div className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={statusFilter}
            onChange={(e) => {
              setPage(1)
              setStatusFilter(e.target.value)
            }}
            aria-label="Filter status sinkronisasi"
            className={selectCls}
          >
            <option value="">Semua Status</option>
            <option value="OK">Selesai (OK)</option>
            <option value="RUNNING">Berjalan (RUNNING)</option>
            <option value="QUEUED">Menunggu (QUEUED)</option>
            <option value="FAILED">Gagal (FAILED)</option>
          </select>

          <select
            value={triggerFilter}
            onChange={(e) => {
              setPage(1)
              setTriggerFilter(e.target.value)
            }}
            aria-label="Filter pemicu sinkronisasi"
            className={selectCls}
          >
            <option value="">Semua Pemicu</option>
            <option value="AUTO">Otomatis</option>
            <option value="MANUAL">Manual</option>
          </select>

          {hasFilter && (
            <button
              type="button"
              onClick={() => {
                setStatusFilter('')
                setTriggerFilter('')
                setPage(1)
              }}
              className="text-xs font-semibold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 px-2 py-1 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            >
              Reset Filter
            </button>
          )}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={loadData}
            icon={IconRefresh}
            aria-label="Segarkan riwayat"
          >
            Segarkan
          </Button>
        </div>

        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={
            onOpenSync ||
            (() => navigate('/master-data/substation-measurements/sinkronisasi-maximo'))
          }
          className="cursor-pointer"
        >
          Buka Sinkronisasi Maximo →
        </Button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Tabel Riwayat */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-16 text-center text-xs text-slate-500">
            <Spinner size="lg" label="Memuat riwayat sinkronisasi data gardu…" />
          </div>
        ) : runs.length === 0 ? (
          <div className="py-12">
            <EmptyState
              icon={IconActivity}
              title="Belum ada riwayat sinkronisasi data gardu"
              description={
                hasFilter
                  ? 'Tidak ada riwayat yang cocok dengan filter yang dipilih.'
                  : 'Belum ada sesi sinkronisasi Maximo yang tercatat.'
              }
            />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                  <th className="py-3 px-4">Waktu Mulai</th>
                  <th className="py-3 px-4">Pemicu</th>
                  <th className="py-3 px-4">WO Selesai Sejak</th>
                  <th className="py-3 px-4">Dijalankan Oleh</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Hasil Sinkronisasi</th>
                  <th className="py-3 px-4 text-right">Aksi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {runs.map((r) => (
                  <tr
                    key={r.id}
                    className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    data-testid="substation-sync-row"
                  >
                    <td className="py-3 px-4 font-mono font-medium text-slate-800 dark:text-slate-200">
                      {when(r.created_at)}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">
                      {r.trigger === 'AUTO' ? (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300">
                          Otomatis
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-sky-100 text-sky-800 dark:bg-sky-950/60 dark:text-sky-300">
                          Manual
                        </span>
                      )}
                      {r.all_work_orders && (
                        <span className="ml-1.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                          Semua WO
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                      {dayText(r.since)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                      {r.started_by || 'Sistem Terjadwal'}
                    </td>
                    <td className="py-3 px-4">
                      <StatusBadge status={r.status} />
                    </td>
                    <td className="py-3 px-4">
                      <SummaryText run={r} />
                    </td>
                    <td className="py-3 px-4 text-right">
                      <button
                        type="button"
                        onClick={() => openLog(r)}
                        aria-label={`Lihat log ${when(r.created_at)}`}
                        className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold text-blue-600 hover:text-blue-700 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 border border-blue-200 dark:border-blue-800 transition cursor-pointer"
                      >
                        <IconEye size={12} />
                        <span>Log</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {meta && (
          <TableFooter
            itemCount={runs.length}
            total={meta.total}
            entityLabel="sesi"
            meta={meta}
            page={page}
            perPage={perPage}
            onPage={setPage}
            onPerPage={(n) => {
              setPerPage(n)
              setPage(1)
            }}
            perPageOptions={[10, 25, 50]}
          />
        )}
      </div>

      {/* Modal Log Teknis */}
      <Modal
        open={Boolean(logRun)}
        onClose={() => setLogRun(null)}
        title="Log Sinkronisasi Maximo"
        subtitle={
          logRun
            ? `${when(logRun.created_at)} · ${STATUS[logRun.status]?.[0] || logRun.status}`
            : ''
        }
        size="max-w-3xl"
        width="max-w-3xl"
      >
        <div className="space-y-3">
          <div className="flex items-center justify-between text-xs text-slate-500">
            <span>Rincian rekaman eksekusi penarikan WO dan pemuatan data gardu:</span>
            {logRun?.log && (
              <Button
                type="button"
                variant="secondary"
                size="xs"
                icon={copied ? IconCheck : IconClipboard}
                onClick={() => copyLog(logRun.log)}
              >
                {copied ? 'Tersalin' : 'Salin Log'}
              </Button>
            )}
          </div>
          <pre
            aria-label="Isi log"
            className="max-h-[60vh] overflow-auto rounded-xl bg-slate-950 text-slate-100 p-3.5 font-mono text-[11px] leading-relaxed whitespace-pre-wrap select-all"
          >
            {logRun?.log ?? 'Memuat log teknis…'}
          </pre>
        </div>
      </Modal>
    </div>
  )
}
