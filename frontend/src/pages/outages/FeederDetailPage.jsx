import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { outageApi } from '../../services/api.js'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import { filterControlCls } from '../../components/filterStyles.js'
import { IconActivity, IconArrowLeft, IconRefresh } from '../../components/icons.jsx'
import { RankedBars, YearlyComparisonChart, fmtInt, fmtNum } from '../../components/TrendCharts.jsx'

const CARD = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs'

const lastDay = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}

const fmtMinutes = (m) => {
  if (m === null || m === undefined) return '-'
  if (m < 60) return `${fmtNum(m, 0)} mnt`
  return `${Math.floor(m / 60)} j ${Math.round(m % 60)} mnt`
}

const fmtDay = (v) =>
  v
    ? new Date(v).toLocaleString('id-ID', {
        day: '2-digit',
        month: 'short',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '-'

export default function FeederDetailPage() {
  const { feederId } = useParams()
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()

  const now = new Date()
  const defaultTo = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1)
  const defaultFrom = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`

  const [fromMonth, setFromMonth] = useState(searchParams.get('from')?.slice(0, 7) || defaultFrom)
  const [toMonth, setToMonth] = useState(searchParams.get('to')?.slice(0, 7) || defaultTo)

  const [state, setState] = useState({ loading: true, error: '', data: null })
  const [gangguanType, setGangguanType] = useState('total') // 'total' | 'permanent' | 'temporary'
  const [recentFilter, setRecentFilter] = useState('ALL') // 'ALL' | 'PERMANEN' | 'TEMPORER'
  const [garduFilter, setGarduFilter] = useState('ALL') // 'ALL' | '80' | '100'

  const load = useCallback(async () => {
    if (!feederId) return
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const res = await outageApi.feeder(feederId, {
        from: `${fromMonth}-01`,
        to: lastDay(toMonth),
      })
      setState({ loading: false, error: '', data: res?.data || null })
    } catch (err) {
      setState({ loading: false, error: err?.message || 'Gagal memuat detail penyulang.', data: null })
    }
  }, [feederId, fromMonth, toMonth])

  useEffect(() => {
    load()
  }, [load])

  const d = state.data

  const totals = useMemo(() => {
    const monthly = d?.monthly || []
    return monthly.reduce(
      (acc, m) => ({
        events: acc.events + Number(m.events || 0),
        permanent: acc.permanent + Number(m.permanent || 0),
        temporary: acc.temporary + Number(m.temporary || 0),
      }),
      { events: 0, permanent: 0, temporary: 0 },
    )
  }, [d?.monthly])

  const causeItems = useMemo(
    () =>
      (d?.by_cause || []).map((r) => ({
        key: r.label,
        label: r.label,
        value: r.events,
        text: `${fmtInt(r.events)} · ${fmtNum(r.share_pct, 1)}%`,
        sub: `${fmtInt(r.permanent)} permanen · ENS ${fmtInt(r.ens_kwh)} kWh`,
      })),
    [d?.by_cause],
  )

  const filteredRecent = useMemo(() => {
    const list = d?.recent || []
    if (recentFilter === 'ALL') return list
    return list.filter((r) => r.type === recentFilter)
  }, [d?.recent, recentFilter])

  const filteredGardu = useMemo(() => {
    const list = d?.gardu?.items || []
    if (garduFilter === '100') return list.filter((g) => g.loading_pct !== null && g.loading_pct >= 100)
    if (garduFilter === '80') return list.filter((g) => g.loading_pct !== null && g.loading_pct >= 80)
    return list
  }, [d?.gardu?.items, garduFilter])

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/pengusahaan/gangguan')
    }
  }

  return (
    <div className="space-y-6 w-full">
      {/* Header & Tombol Kembali */}
      <div className={`${CARD} p-5 sm:p-6 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
              <IconActivity size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  {d?.feeder?.name || 'Detail Penyulang'}
                </h1>
                {d?.feeder?.code && (
                  <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-mono font-semibold text-blue-700 dark:text-blue-300">
                    {d.feeder.code}
                  </span>
                )}
              </div>
              <p className="mt-1 text-xs sm:text-sm text-slate-600 dark:text-slate-400">
                {d
                  ? [d.feeder.gi_name, d.feeder.owner, `${fmtInt(d.feeder.customers)} pelanggan`].filter(Boolean).join(' · ')
                  : 'Rincian gangguan bulanan, penyebab, riwayat kejadian, dan beban gardu di bawah penyulang.'}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" size="md" icon={IconArrowLeft} onClick={handleBack}>
              Kembali
            </Button>
            <Button type="button" variant="secondary" size="md" icon={IconRefresh} onClick={load} aria-label="Segarkan">
              Segarkan
            </Button>
          </div>
        </div>
      </div>

      {/* Filter Periode */}
      <div className={`${CARD} p-4 flex flex-wrap items-center gap-3`}>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
          <span>Dari</span>
          <input
            type="month"
            value={fromMonth}
            onChange={(e) => setFromMonth(e.target.value)}
            aria-label="Dari bulan"
            className={filterControlCls}
          />
        </label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
          <span>Sampai</span>
          <input
            type="month"
            value={toMonth}
            onChange={(e) => setToMonth(e.target.value)}
            aria-label="Sampai bulan"
            className={filterControlCls}
          />
        </label>
      </div>

      {state.loading ? (
        <div className={`${CARD} py-20 flex justify-center`}>
          <Spinner size="lg" label="Memuat rincian penyulang..." />
        </div>
      ) : state.error ? (
        <Alert type="error">{state.error}</Alert>
      ) : d && (
        <div className="space-y-6">
          {/* 4 Kartu KPI */}
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className={`${CARD} p-4`}>
              <dt className="text-xs font-medium text-slate-500">Total Gangguan</dt>
              <dd className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {fmtInt(totals.events)}
              </dd>
              <p className="mt-1 text-xs text-slate-500">
                {fmtInt(totals.permanent)} permanen · {fmtInt(totals.temporary)} temporer
              </p>
            </div>

            <div className={`${CARD} p-4`}>
              <dt className="text-xs font-medium text-slate-500">Pelanggan & Gardu</dt>
              <dd className="mt-1.5 text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">
                {fmtInt(d.feeder.customers)}
              </dd>
              <p className="mt-1 text-xs text-slate-500">
                {fmtInt(d.gardu.count)} gardu ({fmtInt(d.gardu.measured)} terukur)
              </p>
            </div>

            <div className={`${CARD} p-4`}>
              <dt className="text-xs font-medium text-slate-500">Rata-rata Beban Gardu</dt>
              <dd className="mt-1.5 text-2xl font-bold tabular-nums text-blue-600 dark:text-blue-400">
                {d.gardu.avg_loading_pct !== null ? `${fmtNum(d.gardu.avg_loading_pct, 1)}%` : '-'}
              </dd>
              <p className="mt-1 text-xs text-slate-500">Dari gardu terukur</p>
            </div>

            <div className={`${CARD} p-4`}>
              <dt className="text-xs font-medium text-slate-500">Gardu Beban Tinggi</dt>
              <dd className="mt-1.5 text-2xl font-bold tabular-nums text-amber-600 dark:text-amber-400">
                {fmtInt(d.gardu.at_80)} <span className="text-sm font-normal text-slate-500">(≥80%)</span>
              </dd>
              <p className="mt-1 text-xs text-rose-600 dark:text-rose-400 font-medium">
                {fmtInt(d.gardu.at_100)} gardu ≥ 100%
              </p>
            </div>
          </dl>

          {/* Baris 1: Grafik Gangguan per Bulan */}
          <section className={`${CARD} p-5 sm:p-6 space-y-4`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Gangguan per Bulan</h2>
                <p className="text-xs text-slate-500">Perbandingan kejadian bulanan terhadap periode sama tahun sebelumnya.</p>
              </div>
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs">
                {[['total', 'Total'], ['permanent', 'Permanen'], ['temporary', 'Temporer']].map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setGangguanType(k)}
                    className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                      gangguanType === k
                        ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>
            <YearlyComparisonChart
              data={d.monthly}
              valueKey={gangguanType === 'permanent' ? 'permanent' : gangguanType === 'temporary' ? 'temporary' : 'events'}
              height={230}
              ariaLabel={`Gangguan bulanan ${d.feeder.name}`}
              unit="kali"
            />
          </section>

          {/* Baris 2: Penyebab & Riwayat Terakhir */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <section className={`${CARD} p-5 sm:p-6 space-y-4`}>
              <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Komposisi Penyebab</h2>
                <p className="text-xs text-slate-500">Distribusi kejadian gangguan menurut penyebab.</p>
              </div>
              <RankedBars items={causeItems} ariaLabel="Penyebab gangguan penyulang" />
            </section>

            <section className={`${CARD} p-5 sm:p-6 space-y-4`}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
                <div>
                  <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">Gangguan Terakhir</h2>
                  <p className="text-xs text-slate-500">Riwayat kejadian terkini pada penyulang ini.</p>
                </div>
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-[11px]">
                  {[['ALL', 'Semua'], ['PERMANEN', 'Permanen'], ['TEMPORER', 'Temporer']].map(([k, lbl]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setRecentFilter(k)}
                      className={`px-2 py-0.5 rounded font-semibold transition cursor-pointer ${
                        recentFilter === k
                          ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
              </div>
              {filteredRecent.length === 0 ? (
                <p className="py-6 text-center text-xs text-slate-500">Tidak ada riwayat gangguan untuk filter ini.</p>
              ) : (
                <ul className="space-y-2 text-xs max-h-80 overflow-y-auto pr-1">
                  {filteredRecent.map((r, i) => (
                    <li key={`${r.occurred_at}-${r.fault_code || ''}-${i}`} className="rounded-xl border border-slate-100 dark:border-slate-800 px-3 py-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500">
                        <span>{fmtDay(r.occurred_at)}</span>
                        <span>
                          {r.type === 'PERMANEN' ? 'Permanen' : r.type === 'TEMPORER' ? 'Temporer' : '-'} · {fmtMinutes(r.minutes)}
                          {r.ens_kwh ? ` · ENS ${fmtNum(r.ens_kwh, 0)} kWh` : ''}
                        </span>
                      </div>
                      <div className="mt-1 font-medium text-slate-800 dark:text-slate-200">
                        {r.category || r.cause || 'Tanpa keterangan'}
                        {r.weather ? ` · ${r.weather}` : ''}
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>

          {/* Baris 3: Tabel Gardu di Bawah Penyulang */}
          <section className={`${CARD} p-5 sm:p-6 space-y-4`}>
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                  Gardu di Bawah Penyulang ({filteredGardu.length})
                </h2>
                <p className="text-xs text-slate-500">
                  Klik kode/nama gardu untuk melihat detail master gardu.
                </p>
              </div>
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-lg text-xs">
                {[['ALL', 'Semua'], ['80', 'Beban ≥ 80%'], ['100', 'Beban ≥ 100%']].map(([k, lbl]) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => setGarduFilter(k)}
                    className={`px-2.5 py-1 rounded-md font-semibold transition cursor-pointer ${
                      garduFilter === k
                        ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs'
                        : 'text-slate-500 hover:text-slate-800'
                    }`}
                  >
                    {lbl}
                  </button>
                ))}
              </div>
            </div>

            {filteredGardu.length === 0 ? (
              <p className="py-6 text-center text-xs text-slate-500">Tidak ada gardu yang sesuai filter.</p>
            ) : (
              <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-50 dark:bg-slate-800/80 text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Gardu</th>
                      <th className="py-2.5 px-3">ULP</th>
                      <th className="py-2.5 px-3 text-right">Kapasitas (kVA)</th>
                      <th className="py-2.5 px-3 text-right">Beban (%)</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredGardu.map((g) => (
                      <tr key={g.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-semibold">
                          <Link to={`/master-data/substations/${g.id}`} className="text-blue-700 dark:text-blue-400 hover:underline">
                            {g.code || g.name}
                          </Link>
                        </td>
                        <td className="py-2.5 px-3 text-slate-500">{g.unit_name || '-'}</td>
                        <td className="py-2.5 px-3 text-right font-mono tabular-nums">{fmtInt(g.capacity_kva)}</td>
                        <td
                          className={`py-2.5 px-3 text-right font-mono tabular-nums ${
                            g.loading_pct >= 100
                              ? 'font-bold text-rose-600'
                              : g.loading_pct >= 80
                              ? 'font-bold text-amber-600'
                              : 'text-slate-700 dark:text-slate-300'
                          }`}
                        >
                          {g.loading_pct === null ? '-' : `${fmtNum(g.loading_pct, 1)}%`}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      )}
    </div>
  )
}
