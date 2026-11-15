import { useEffect, useState, useCallback, useMemo } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { connectionsApi, substationsApi, feedersApi, adminApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Drawer from '../../components/Drawer.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import DilSyncDrawer from './DilSyncDrawer.jsx'
import {
  IconSearch,
  IconUsers,
  IconZap,
  IconInfo,
  IconCheck,
  IconX,
  IconWrench,
  IconRefresh,
  IconUpload,
  IconCheckCircle,
  IconAlertCircle,
} from '../../components/icons.jsx'

const inputCls =
  'px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100'

const fmt = (v, d = 0) =>
  v === null || v === undefined
    ? '-'
    : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d })

const STATUS_STYLE = {
  AKTIF: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300',
  BONGKAR: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  HAPUS: 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300',
  PROSES: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
}

export function CustomerStatusBadge({ status }) {
  const cls = STATUS_STYLE[status] || 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
  return (
    <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${cls}`}>
      {status || '-'}
    </span>
  )
}

function CustomerDetail({ id, canManage, onClose, onLinked }) {
  const { notify } = useNotifications()
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Substation picker state for manual link
  const [garduSearch, setGarduSearch] = useState('')
  const [garduResults, setGarduResults] = useState([])
  const [searchingGardu, setSearchingGardu] = useState(false)
  const [selectedSubstation, setSelectedSubstation] = useState(null)
  const [savingLink, setSavingLink] = useState(false)
  const [linkError, setLinkError] = useState('')

  const loadDetail = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await connectionsApi.get(id)
      setData(res?.data || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat detail pelanggan.')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  // Search substations in the customer's ULP only
  useEffect(() => {
    const q = garduSearch.trim()
    if (!q || !data?.connection?.organizational_unit_id) {
      setGarduResults([])
      return
    }

    const timer = setTimeout(() => {
      setSearchingGardu(true)
      substationsApi
        .list({
          q,
          organizational_unit_id: data.connection.organizational_unit_id,
          per_page: 10,
        })
        .then((res) => setGarduResults(res?.data || []))
        .catch(() => setGarduResults([]) )
        .finally(() => setSearchingGardu(false))
    }, 300)

    return () => clearTimeout(timer)
  }, [garduSearch, data?.connection?.organizational_unit_id])

  const handleApplyLink = async (substationId) => {
    setSavingLink(true)
    setLinkError('')
    try {
      await connectionsApi.link(id, { substation_id: substationId })
      notify({
        type: 'success',
        title: substationId ? 'Tautan Gardu Diperbarui' : 'Tautan Gardu Dilepas',
        desc: substationId
          ? `Pelanggan ditautkan ke gardu.`
          : 'Tautan gardu pelanggan telah dilepas.',
        tag: 'CUSTOMER',
      })
      setSelectedSubstation(null)
      setGarduSearch('')
      setGarduResults([])
      await loadDetail()
      onLinked?.()
    } catch (err) {
      setLinkError(err?.message || 'Gagal memperbarui tautan gardu.')
    } finally {
      setSavingLink(false)
    }
  }

  if (loading) {
    return (
      <div className="py-20 flex justify-center">
        <Spinner size="lg" label="Memuat detail pelanggan..." />
      </div>
    )
  }

  if (error || !data) {
    return (
      <div className="py-10" data-testid="customer-detail-error">
        <Alert kind="error">{error || 'Data pelanggan tidak ditemukan.'}</Alert>
      </div>
    )
  }

  const { connection: c, applications = [] } = data

  return (
    <div className="space-y-6 text-xs" data-testid="customer-detail">
      {/* Header IDPEL & Nama */}
      <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="font-mono text-base font-bold text-slate-900 dark:text-slate-100">
              {c.idpel}
            </span>
            <CustomerStatusBadge status={c.status} />
          </div>
          {c.name_masked && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
              Nama Tersamar
            </span>
          )}
        </div>
        <p className="text-sm font-semibold text-slate-800 dark:text-slate-200">
          {c.name || '-'}
        </p>
        <p className="text-slate-500 text-[11px]">
          {c.unit_name || 'Unit tidak tercatat'}
        </p>
      </div>

      {/* Rincian Kontrak & Teknis */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <IconInfo size={14} className="text-blue-500" />
          Rincian Pelanggan & Layanan
        </h3>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
          <div>
            <dt className="text-[11px] text-slate-500">Tarif / Daya</dt>
            <dd className="font-semibold text-slate-800 dark:text-slate-200">
              {c.tariff_code || '-'} / {fmt(c.power_va, 0)} VA
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">Jenis Layanan</dt>
            <dd className="font-semibold text-slate-800 dark:text-slate-200">
              {c.service_type || '-'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">Fasa Listrik</dt>
            <dd className="font-semibold font-mono text-slate-800 dark:text-slate-200">
              {c.phase_code ? `${c.phase_code} Fasa` : '-'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">Nomor Meter kWh</dt>
            <dd className="font-semibold font-mono text-slate-800 dark:text-slate-200">
              {c.meter_number || '-'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">Tanggal Nyala (PB)</dt>
            <dd className="font-semibold font-mono text-slate-800 dark:text-slate-200">
              {c.energized_on || '-'}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] text-slate-500">Sumber Data / Periode</dt>
            <dd className="font-semibold text-slate-800 dark:text-slate-200">
              {c.source || 'DIL'} {c.snapshot_month ? `(${c.snapshot_month})` : ''}
            </dd>
          </div>
          <div className="col-span-2">
            <dt className="text-[11px] text-slate-500">Wilayah Administrasi</dt>
            <dd className="text-slate-800 dark:text-slate-200">
              {[c.kelurahan, c.kecamatan, c.kabupaten].filter(Boolean).join(', ') || '-'}
            </dd>
          </div>
        </dl>
      </div>

      {/* Rantai Gardu & Penyulang */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <IconZap size={14} className="text-amber-500" />
          Tautan Gardu & Penyulang Distribusi
        </h3>

        <div className="p-3 bg-slate-50 dark:bg-slate-800/40 rounded-xl space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-slate-500">Gardu Distribusi Terhubung:</span>
            {c.link_source && (
              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300">
                Sumber: {c.link_source === 'DIL' ? 'File DIL (No. GADIS)' : c.link_source === 'DIL_NAMA' ? 'File DIL (nama gardu)' : c.link_source === 'DIL_KODE' ? 'File DIL (kode pendek)' : c.link_source === 'KKO' ? 'Survei KKO' : 'Manual'}
              </span>
            )}
          </div>

          {c.substation_id ? (
            <div className="flex items-center justify-between">
              <div>
                <span className="font-mono text-sm font-bold text-slate-900 dark:text-slate-100 mr-2">
                  {c.substation_code}
                </span>
                <span className="text-slate-600 dark:text-slate-400">
                  {c.substation_name || ''}
                </span>
                {c.feeder_code && (
                  <div className="text-[11px] text-slate-500 mt-0.5">
                    Penyulang:{' '}
                    <span className="font-mono font-semibold text-slate-700 dark:text-slate-300">
                      {c.feeder_code}
                    </span>
                  </div>
                )}
              </div>
              <Link
                to={`/master-data/substations?q=${c.substation_code}`}
                className="text-xs text-blue-600 dark:text-blue-400 font-semibold hover:underline"
              >
                Lihat Gardu →
              </Link>
            </div>
          ) : (
            <div className="space-y-1">
              <div className="text-rose-600 dark:text-rose-400 font-semibold">
                Belum tertaut ke gardu master
              </div>
              {c.gardu_ref && (
                <div className="text-[11px] text-slate-500 italic">
                  Referensi gardu dari berkas DIL: <span className="font-mono font-semibold">{c.gardu_ref}</span> (menunggu gardu masuk master)
                </div>
              )}
            </div>
          )}
        </div>

        {/* Form Perbaiki Tautan Gardu (hanya bila customers.manage) */}
        {canManage && (
          <div className="mt-4 pt-3 border-t border-slate-200 dark:border-slate-800 space-y-3" data-testid="fix-link-section">
            <h4 className="font-semibold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <IconWrench size={13} className="text-slate-600 dark:text-slate-400" />
              Perbaiki Tautan Gardu (Manual)
            </h4>

            {linkError && (
              <div data-testid="link-error">
                <Alert kind="error">{linkError}</Alert>
              </div>
            )}

            <div className="space-y-2">
              <label className="block text-[11px] text-slate-600 dark:text-slate-400">
                Cari gardu dalam unit ULP pelanggan ini ({c.unit_name || 'ULP Pelanggan'}):
              </label>

              <div className="flex gap-2">
                <div className="relative flex-1">
                  <IconSearch size={14} className="absolute left-3 top-2.5 text-slate-400" />
                  <input
                    aria-label="Cari gardu se-ULP"
                    type="text"
                    placeholder="Ketik kode / nama gardu..."
                    value={garduSearch}
                    onChange={(e) => setGarduSearch(e.target.value)}
                    className={`${inputCls} pl-8 w-full`}
                  />
                  {searchingGardu && (
                    <div className="absolute right-3 top-2 text-slate-400">
                      <Spinner size="xs" />
                    </div>
                  )}
                </div>
              </div>

              {garduResults.length > 0 && (
                <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden max-h-48 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800 bg-white dark:bg-slate-900 shadow-sm">
                  {garduResults.map((g) => (
                    <div
                      key={g.id}
                      onClick={() => setSelectedSubstation(g)}
                      className={`p-2.5 cursor-pointer flex items-center justify-between text-xs hover:bg-slate-50 dark:hover:bg-slate-800 ${
                        selectedSubstation?.id === g.id
                          ? 'bg-blue-50 dark:bg-blue-950/40 border-l-4 border-blue-500'
                          : ''
                      }`}
                    >
                      <div>
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100 mr-2">
                          {g.code}
                        </span>
                        <span className="text-slate-600 dark:text-slate-400">
                          {g.name || g.area_note || '-'}
                        </span>
                      </div>
                      <span className="text-[11px] text-slate-400 font-mono">
                        {fmt(g.capacity_kva, 0)} kVA
                      </span>
                    </div>
                  ))}
                </div>
              )}

              {selectedSubstation && (
                <div className="p-3 bg-blue-50 dark:bg-blue-950/30 rounded-xl border border-blue-200 dark:border-blue-900 flex items-center justify-between">
                  <div>
                    <span className="text-[11px] text-blue-700 dark:text-blue-300 font-semibold block">
                      Gardu Terpilih:
                    </span>
                    <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                      {selectedSubstation.code} - {selectedSubstation.name || selectedSubstation.area_note || ''}
                    </span>
                  </div>
                  <Button
                    size="sm"
                    variant="primary"
                    loading={savingLink}
                    onClick={() => handleApplyLink(selectedSubstation.id)}
                  >
                    Tautkan ke Gardu Ini
                  </Button>
                </div>
              )}

              {c.substation_id && (
                <div className="pt-2 flex justify-end">
                  <Button
                    size="sm"
                    variant="danger"
                    loading={savingLink}
                    onClick={() => handleApplyLink(null)}
                  >
                    Lepas Tautan Gardu
                  </Button>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Permohonan Terkait */}
      <div className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 p-4 space-y-3">
        <h3 className="font-bold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
          <IconUsers size={14} className="text-indigo-500" />
          Permohonan Terkait ({applications.length})
        </h3>

        {applications.length === 0 ? (
          <p className="text-slate-500 text-xs italic">
            Belum ada permohonan pasang baru / perubahan daya yang terhubung ke pelanggan ini.
          </p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-[11px] text-slate-600 dark:text-slate-400">
                  <th className="py-2 px-3">No. Permohonan</th>
                  <th className="py-2 px-3">Jenis</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3">Tanggal</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {applications.map((a) => (
                  <tr key={a.id}>
                    <td className="py-2 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                      <Link
                        to={`/permohonan?q=${a.application_number}`}
                        className="text-blue-600 dark:text-blue-400 hover:underline"
                      >
                        {a.application_number}
                      </Link>
                    </td>
                    <td className="py-2 px-3">{a.application_type || '-'}</td>
                    <td className="py-2 px-3">{a.current_status || '-'}</td>
                    <td className="py-2 px-3 font-mono text-slate-500">
                      {a.created_at ? a.created_at.slice(0, 10) : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}

export default function CustomersPage() {
  const { can, isSysAdmin } = useAccess()
  const { notify } = useNotifications()
  const canManage = Boolean(can?.['customers.manage'])
  const canImport = Boolean(can?.['customers.import'] || isSysAdmin)
  const [syncOpen, setSyncOpen] = useState(false)
  const [searchParams] = useSearchParams()

  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Filter state
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [q, setQ] = useState('')
  const [query, setQuery] = useState('')
  const [up3Id, setUp3Id] = useState('')
  const [unitId, setUnitId] = useState('')
  const [feederId, setFeederId] = useState(searchParams.get('feeder_id') || '')
  const [substationId, setSubstationId] = useState(searchParams.get('substation_id') || '')
  const [tariffCode, setTariffCode] = useState('')
  const [status, setStatus] = useState('')
  const [serviceType, setServiceType] = useState('')
  const [unlinkedOnly, setUnlinkedOnly] = useState(false)

  // Reference data
  const [units, setUnits] = useState([])
  const [feeders, setFeeders] = useState([])

  // Detail drawer state
  const [openId, setOpenId] = useState(null)

  useEffect(() => {
    adminApi
      .units()
      .then((res) => {
        const ulps = (res?.data || []).filter((u) => u.unit_type === 'ULP')
        setUnits(ulps)
      })
      .catch(() => setUnits([]))

    feedersApi
      .list({ per_page: 100 })
      .then((res) => setFeeders(res?.data || []))
      .catch(() => setFeeders([]))
  }, [])

  const loadCustomers = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await connectionsApi.list({
        q: query || undefined,
        organizational_unit_id: unitId || undefined,
        feeder_id: feederId || undefined,
        substation_id: substationId || undefined,
        tariff_code: tariffCode ? tariffCode.trim().toUpperCase() : undefined,
        status: status || undefined,
        service_type: serviceType || undefined,
        linked: unlinkedOnly ? 0 : undefined,
        page,
        per_page: perPage,
      })
      setRows(res?.data || [])
      setMeta(res?.meta || null)
      setSummary(res?.summary || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat daftar pelanggan.')
    } finally {
      setLoading(false)
    }
  }, [
    query,
    unitId,
    feederId,
    substationId,
    tariffCode,
    status,
    serviceType,
    unlinkedOnly,
    page,
    perPage,
  ])

  useEffect(() => {
    loadCustomers()
  }, [loadCustomers])

  // Kartu menghitung seluruh data yang cocok dengan filter (dari server), bukan hanya baris pada halaman ini.
  const stats = useMemo(() => {
    const total = summary?.total ?? meta?.total ?? rows.length
    const activeCount = summary?.active ?? rows.filter((r) => r.status === 'AKTIF').length
    const totalPowerVa = summary?.active_va ?? rows.reduce((acc, r) => acc + (r.status === 'AKTIF' ? Number(r.power_va) || 0 : 0), 0)
    const unlinkedCount = summary?.unlinked ?? rows.filter((r) => !r.substation_code && !r.substation_id).length
    return {
      total,
      activeCount,
      totalPowerVa,
      totalPowerKva: Math.round(totalPowerVa / 1000),
      unlinkedCount,
    }
  }, [rows, meta, summary])
  const filtered = Boolean(query || unitId || feederId || substationId || tariffCode || status || serviceType || unlinkedOnly)
  const scopeNote = filtered ? 'sesuai filter' : 'seluruh data'

  return (
    <div className="space-y-6">
      {/* Header Modul Master Pelanggan */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-emerald-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-emerald-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-emerald-600 p-2.5 text-white shadow-xs">
              <IconUsers className="h-6 w-6" />
            </div>
            <div>
              <nav className="text-xs text-slate-500 mb-1">
                <span>DISTRIVA</span>
                <span className="mx-1.5">/</span>
                <span>Master Data</span>
                <span className="mx-1.5">/</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">Pelanggan</span>
              </nav>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Master Pelanggan (IDPEL)
                </h1>
                <span className="rounded-full bg-emerald-100 dark:bg-emerald-950 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  Konsumen &amp; Sambungan
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                Daftar sambungan pelanggan dari berkas DIL dan survei KKO yang tertaut ke gardu dan penyulang distribusi.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              icon={IconRefresh}
              onClick={loadCustomers}
              aria-label="Segarkan"
            >
              Segarkan
            </Button>
            {canImport && (
              <Button size="sm" icon={IconUpload} onClick={() => setSyncOpen(true)} aria-label="Sinkron DIL">
                Sinkron DIL
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Ringkasan Metrik Master Pelanggan */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Pelanggan</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconUsers className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {stats.total.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Pelanggan terdaftar ({scopeNote})</p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Pelanggan Aktif</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {stats.activeCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Sambungan aktif ({scopeNote})</p>
        </div>

        <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-blue-700 dark:text-blue-400">Daya Tersambung</dt>
            <div className="rounded-lg p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <IconZap className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {stats.totalPowerKva.toLocaleString('id-ID')} <span className="text-sm font-semibold">kVA</span>
          </dd>
          <p className="mt-1 text-xs text-blue-600/70 dark:text-blue-500/70">
            {stats.totalPowerVa.toLocaleString('id-ID')} VA sambungan aktif ({scopeNote})
          </p>
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-amber-700 dark:text-amber-400">Belum Tertaut Gardu</dt>
            <div className="rounded-lg p-1.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
              <IconAlertCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {stats.unlinkedCount.toLocaleString('id-ID')}
          </dd>
          <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-500/70">Perlu pemetaan gardu ({scopeNote})</p>
        </div>
      </dl>

      {/* Filter Bar */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
        <form
          className="flex flex-wrap items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            setPage(1)
            setQuery(q.trim())
          }}
        >
          <div className="relative">
            <IconSearch size={14} className="absolute left-3 top-2.5 text-slate-400" />
            <input
              aria-label="Cari pelanggan"
              placeholder="Awalan IDPEL, nama, no. meter…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              className={`${inputCls} pl-8 w-56`}
            />
          </div>

          <HierarchicalUnitFilter
            up3Id={up3Id}
            onUp3Change={(newUp3) => {
              setPage(1)
              setUp3Id(newUp3)
            }}
            unitId={unitId}
            onUnitChange={(newUnit) => {
              setPage(1)
              setUnitId(newUnit)
            }}
            allUp3Label="Semua UP3"
            allUnitLabel="Semua unit ULP"
            unitAriaLabel="Unit ULP"
            selectClassName={inputCls}
          />

          <select
            aria-label="Penyulang"
            value={feederId}
            onChange={(e) => {
              setPage(1)
              setFeederId(e.target.value)
            }}
            className={inputCls}
          >
            <option value="">Semua penyulang</option>
            {feeders.map((f) => (
              <option key={f.id} value={f.id}>
                {f.code} {f.name ? `(${f.name})` : ''}
              </option>
            ))}
          </select>

          <input
            aria-label="Tarif"
            placeholder="Tarif (misal: R1)"
            value={tariffCode}
            onChange={(e) => setTariffCode(e.target.value)}
            className={`${inputCls} w-24`}
          />

          <select
            aria-label="Status Pelanggan"
            value={status}
            onChange={(e) => {
              setPage(1)
              setStatus(e.target.value)
            }}
            className={inputCls}
          >
            <option value="">Semua status</option>
            <option value="AKTIF">AKTIF</option>
            <option value="BONGKAR">BONGKAR</option>
            <option value="HAPUS">HAPUS</option>
            <option value="PROSES">PROSES</option>
          </select>

          <select
            aria-label="Jenis Layanan"
            value={serviceType}
            onChange={(e) => {
              setPage(1)
              setServiceType(e.target.value)
            }}
            className={inputCls}
          >
            <option value="">Semua layanan</option>
            <option value="PASKABAYAR">Paskabayar</option>
            <option value="PRABAYAR">Prabayar</option>
          </select>

          {substationId && (
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-xs font-mono">
              <span>Gardu Terpilih</span>
              <button
                type="button"
                aria-label="Hapus filter gardu"
                onClick={() => {
                  setPage(1)
                  setSubstationId('')
                }}
                className="ml-1 hover:text-rose-600 font-bold cursor-pointer"
                title="Hapus filter gardu"
              >
                ✕
              </button>
            </div>
          )}

          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300 font-medium">
            <input
              aria-label="Belum tertaut ke gardu"
              type="checkbox"
              checked={unlinkedOnly}
              onChange={(e) => {
                setPage(1)
                setUnlinkedOnly(e.target.checked)
              }}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
            />
            Belum tertaut gardu
          </label>

          <Button type="submit" variant="secondary" size="sm">
            Cari
          </Button>
        </form>
      </div>

      {error && (
        <div data-testid="customers-list-error">
          <Alert kind="error">{error}</Alert>
        </div>
      )}

      {/* Table Container */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-500">
            <Spinner size="lg" label="Memuat pelanggan..." />
          </div>
        ) : rows.length === 0 ? (
          <EmptyState
            icon={IconUsers}
            title="Belum ada pelanggan"
            description="Tidak ada data pelanggan yang cocok dengan kriteria filter."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800 font-semibold text-[11px]">
                  <th className="py-3 px-4">IDPEL</th>
                  <th className="py-3 px-4">Nama Pelanggan</th>
                  <th className="py-3 px-4">Unit ULP</th>
                  <th className="py-3 px-4">Tarif</th>
                  <th className="py-3 px-4 text-right">Daya (VA)</th>
                  <th className="py-3 px-4">Layanan</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4">Gardu</th>
                  <th className="py-3 px-4">Penyulang</th>
                  <th className="py-3 px-4">Kelurahan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80">
                {rows.map((c) => (
                  <tr
                    key={c.id}
                    onClick={() => setOpenId(c.id)}
                    className="cursor-pointer hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                    data-testid="customer-row"
                  >
                    <td className="py-3 px-4 font-mono font-bold text-slate-900 dark:text-slate-100">
                      {c.idpel}
                    </td>
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-1.5">
                        <span className="font-medium text-slate-800 dark:text-slate-200 truncate max-w-xs">
                          {c.name || '-'}
                        </span>
                        {c.name_masked && (
                          <span
                            data-testid="badge-masked"
                            className="px-1.5 py-0.2 rounded text-[9px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 shrink-0"
                          >
                            Tersamar
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                      {c.unit_name || '-'}
                    </td>
                    <td className="py-3 px-4 font-semibold text-slate-700 dark:text-slate-300">
                      {c.tariff_code || '-'}
                    </td>
                    <td className="py-3 px-4 text-right font-mono">
                      {fmt(c.power_va, 0)}
                    </td>
                    <td className="py-3 px-4 text-slate-600 dark:text-slate-400">
                      {c.service_type || '-'}
                    </td>
                    <td className="py-3 px-4">
                      <CustomerStatusBadge status={c.status} />
                    </td>
                    <td className="py-3 px-4 font-mono">
                      {c.substation_code ? (
                        <span className="font-semibold text-blue-600 dark:text-blue-400">
                          {c.substation_code}
                        </span>
                      ) : c.gardu_ref ? (
                        <span className="text-slate-400 italic">
                          {c.gardu_ref}*
                        </span>
                      ) : (
                        <span className="text-rose-500 font-semibold">-</span>
                      )}
                    </td>
                    <td className="py-3 px-4 font-mono text-slate-700 dark:text-slate-300">
                      {c.feeder_code || '-'}
                    </td>
                    <td className="py-3 px-4 text-slate-500 truncate max-w-xs">
                      {c.kelurahan || '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <TableFooter
          itemCount={rows.length}
          total={meta?.total ?? rows.length}
          entityLabel="pelanggan"
          page={page}
          perPage={perPage}
          onPage={setPage}
          onPerPage={(n) => {
            setPerPage(n)
            setPage(1)
          }}
          perPageOptions={[25, 50, 100]}
        />
      </div>

      {/* Customer Detail Drawer */}
      <Drawer
        isOpen={Boolean(openId)}
        onClose={() => setOpenId(null)}
        title="Detail Pelanggan"
        width="max-w-3xl"
      >
        {openId && (
          <CustomerDetail
            id={openId}
            canManage={canManage}
            onClose={() => setOpenId(null)}
            onLinked={loadCustomers}
          />
        )}
      </Drawer>
      {canImport && (
        <DilSyncDrawer
          open={syncOpen}
          onClose={() => setSyncOpen(false)}
          onFinished={(run) => {
            loadCustomers()
            notify({ type: run.status === 'OK' ? 'success' : 'error', title: run.status === 'OK' ? 'Sinkron DIL selesai' : 'Sinkron DIL belum sempurna', desc: `${Number(run.rows_done || 0).toLocaleString('id-ID')} baris diproses.`, tag: 'DIL' })
          }}
        />
      )}
    </div>
  )
}
