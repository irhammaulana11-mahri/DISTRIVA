import { useCallback, useEffect, useMemo, useState } from 'react'
import { outageApi, triggerFileDownload } from '../../services/api.js'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import HierarchicalUnitFilter from '../../components/HierarchicalUnitFilter.jsx'
import { filterControlCls } from '../../components/filterStyles.js'
import { IconActivity, IconRefresh, IconDownload, IconX } from '../../components/icons.jsx'
import {
  ColumnChart,
  StackedColumns,
  ForecastLine,
  RankedBars,
  YearlyComparisonChart,
  fmtInt,
  fmtNum,
  fmtPct,
  monthLabel,
  monthLong,
} from '../../components/TrendCharts.jsx'

const TABS = [
  { key: 'trend', label: 'Tren & KPI', hint: 'Permanen, temporer, ENS, SAIFI, SAIDI' },
  { key: 'feeders', label: 'Penyulang & gardu', hint: 'Penyulang paling sering terganggu dan gardu di bawahnya' },
  { key: 'forecast', label: 'Prakiraan', hint: 'Prakiraan statistik 12 bulan ke depan' },
]

const CARD = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs'
const SERIES = [
  { key: 'permanent', label: 'Permanen', color: 'var(--viz-s1)' },
  { key: 'temporary', label: 'Temporer', color: 'var(--viz-s2)' },
]
const DEVICE = { PMT: 'PMT (penyulang)', RECLOSER: 'Recloser', OTHER: 'Lainnya' }
const RISK = {
  KRITIS: 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300',
  TINGGI: 'bg-amber-50 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300',
  WASPADA: 'bg-yellow-50 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-300',
  AMAN: 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300',
}

const lastDay = (ym) => {
  const [y, m] = ym.split('-').map(Number)
  return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`
}
const fmtMinutes = (m) => {
  if (m === null || m === undefined) return '-'
  if (m < 60) return `${fmtNum(m, 0)} mnt`
  return `${Math.floor(m / 60)} j ${Math.round(m % 60)} mnt`
}
const fmtDay = (v) => (v ? new Date(v).toLocaleString('id-ID', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-')

/** Perubahan; untuk gangguan naik = buruk, jadi warna dibalik (turun = baik). */
function Delta({ value }) {
  if (value === null || value === undefined) return <span className="text-xs text-slate-400">-</span>
  const worse = value > 0
  return (
    <span className={`inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 text-xs font-semibold ${worse ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/50 dark:text-rose-300' : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300'}`}>
      <span aria-hidden>{value > 0 ? '▲' : value < 0 ? '▼' : '■'}</span>
      {fmtPct(value)}
      <span className="sr-only">{worse ? ' naik' : ' turun'}</span>
    </span>
  )
}

function Tile({ label, value, sub, delta }) {
  return (
    <div className={`${CARD} p-4`}>
      <div className="text-xs font-medium text-slate-500 dark:text-slate-400 truncate">{label}</div>
      <div className="mt-1.5 text-xl sm:text-2xl font-bold tabular-nums text-slate-900 dark:text-slate-100">{value}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
        {delta !== undefined && <Delta value={delta} />}
        {sub && <span>{sub}</span>}
      </div>
    </div>
  )
}

function Section({ title, hint, children, actions = null }) {
  return (
    <section className={`${CARD} p-5 sm:p-6`}>
      <div className="mb-4 flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
        <div>
          <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">{title}</h2>
          {hint && <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
        </div>
        {actions}
      </div>
      {children}
    </section>
  )
}

function Th({ children, right = false }) {
  return <th className={`py-2 pr-3 font-semibold ${right ? 'text-right' : ''}`}>{children}</th>
}

function Breakdown({ rows, label }) {
  const items = rows.map((r) => ({ key: r.label, label: r.label, value: r.events, text: `${fmtInt(r.events)} · ${fmtNum(r.share_pct, 1)}%`, sub: `${fmtInt(r.permanent)} permanen · ENS ${fmtInt(r.ens_kwh)} kWh` }))
  return <RankedBars items={items} ariaLabel={label} />
}

function TrendTab({ data }) {
  const { kpi, monthly, yearly } = data
  const l = kpi.l12m
  const p = kpi.prev12m
  const c = kpi.change_pct || {}
  const [gangguanType, setGangguanType] = useState('total') // 'total' | 'permanent' | 'temporary' | 'all'
  const hours = data.by_hour.map((h) => ({ key: String(h.hour), label: String(h.hour).padStart(2, '0'), value: h.events }))
  if (!l) return <Alert type="info">Belum ada bulan lengkap pada rentang ini.</Alert>

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <Tile label="Gangguan 12 bln terakhir" value={fmtInt(l.events)} delta={c.events} sub={`s.d. ${monthLong(kpi.last_full_month)}`} />
        <Tile label="Permanen" value={fmtInt(l.permanent)} delta={c.permanent} sub={p ? `sebelumnya ${fmtInt(p.permanent)}` : undefined} />
        <Tile label="Temporer" value={fmtInt(l.temporary)} delta={c.temporary} sub={p ? `sebelumnya ${fmtInt(p.temporary)}` : undefined} />
        <Tile label="ENS (kWh)" value={fmtInt(l.ens_kwh)} delta={c.ens_kwh} sub="energi tidak tersalur" />
        <Tile label="SAIFI (kali/plg)" value={fmtNum(l.saifi, 2)} delta={c.saifi} sub={`CAIDI ${kpi.caidi_l12m ? fmtNum(kpi.caidi_l12m, 0) : '-'} mnt`} />
        <Tile label="SAIDI (menit/plg)" value={fmtNum(l.saidi, 1)} delta={c.saidi} sub={`ambang ≥ ${data.settings.saidi_min_minutes} mnt${data.settings.saidi_only_permanent ? ', permanen' : ''}`} />
      </div>

      <Section
        title="Gangguan per bulan"
        hint="Perbandingan antar tahun (YoY) dengan sumbu rentang 1 tahun (Jan–Des). Warna legenda membedakan tiap tahun; kolom putus-putus = bulan berjalan."
        actions={
          <div className="flex flex-wrap items-center gap-1 bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs">
            <button
              type="button"
              onClick={() => setGangguanType('total')}
              className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                gangguanType === 'total'
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Total
            </button>
            <button
              type="button"
              onClick={() => setGangguanType('permanent')}
              className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                gangguanType === 'permanent'
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Permanen
            </button>
            <button
              type="button"
              onClick={() => setGangguanType('temporary')}
              className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                gangguanType === 'temporary'
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Temporer
            </button>
            <button
              type="button"
              onClick={() => setGangguanType('all')}
              className={`px-3 py-1 rounded-lg font-semibold transition cursor-pointer ${
                gangguanType === 'all'
                  ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              Bandingkan Ketiganya
            </button>
          </div>
        }
      >
        {gangguanType === 'total' && (
          <YearlyComparisonChart
            data={monthly}
            valueKey="events"
            unit="kali"
            ariaLabel="Gangguan permanen dan temporer per bulan"
          />
        )}
        {gangguanType === 'permanent' && (
          <YearlyComparisonChart
            data={monthly}
            valueKey="permanent"
            unit="kali"
            ariaLabel="Gangguan permanen dan temporer per bulan"
          />
        )}
        {gangguanType === 'temporary' && (
          <YearlyComparisonChart
            data={monthly}
            valueKey="temporary"
            unit="kali"
            ariaLabel="Gangguan permanen dan temporer per bulan"
          />
        )}
        {gangguanType === 'all' && (
          <div className="grid gap-6 lg:grid-cols-3 pt-2">
            <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-4 bg-slate-50/40 dark:bg-slate-800/30">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">Total Gangguan</h3>
              <YearlyComparisonChart data={monthly} valueKey="events" unit="kali" height={210} showModeSwitch={false} ariaLabel="Gangguan permanen dan temporer per bulan" />
            </div>
            <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-4 bg-slate-50/40 dark:bg-slate-800/30">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">Gangguan Permanen</h3>
              <YearlyComparisonChart data={monthly} valueKey="permanent" unit="kali" height={210} showModeSwitch={false} ariaLabel="Gangguan permanen per bulan" />
            </div>
            <div className="rounded-xl border border-slate-100 dark:border-slate-800 p-4 bg-slate-50/40 dark:bg-slate-800/30">
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2">Gangguan Temporer</h3>
              <YearlyComparisonChart data={monthly} valueKey="temporary" unit="kali" height={210} showModeSwitch={false} ariaLabel="Gangguan temporer per bulan" />
            </div>
          </div>
        )}
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="SAIFI per bulan" hint="Rata-rata gangguan yang dialami pelanggan (kali/pelanggan), sumbu 12 bulan (Jan–Des) per tahun.">
          <YearlyComparisonChart data={monthly} valueKey="saifi" format={(v) => fmtNum(v, 2)} ariaLabel="SAIFI per bulan" unit="kali/plg" />
        </Section>
        <Section title="SAIDI per bulan" hint="Rata-rata lama padam per pelanggan (menit), sumbu 12 bulan (Jan–Des) per tahun.">
          <YearlyComparisonChart data={monthly} valueKey="saidi" format={(v) => fmtNum(v, 1)} ariaLabel="SAIDI per bulan" unit="menit/plg" />
        </Section>
      </div>

      <Section title="Energi tidak tersalur (ENS) per bulan" hint="kWh, perbandingan tahun ke tahun (YoY) sumbu 12 bulan (Jan–Des).">
        <YearlyComparisonChart data={monthly} valueKey="ens_kwh" format={fmtInt} ariaLabel="ENS per bulan" unit="kWh" />
      </Section>

      <Section title="Ringkasan per tahun">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-100 dark:border-slate-800"><Th>Tahun</Th><Th right>Gangguan</Th><Th right>Permanen</Th><Th right>Temporer</Th><Th right>ENS (kWh)</Th><Th right>SAIFI</Th><Th right>SAIDI (mnt)</Th><Th right>Perubahan gangguan</Th></tr></thead>
            <tbody>
              {yearly.map((y) => (
                <tr key={y.year} className="border-b border-slate-50 dark:border-slate-800/60">
                  <td className="py-2 pr-3 font-medium">{y.year}{y.partial || y.months < 12 ? <span className="ml-1 text-xs text-slate-400">({y.months} bln)</span> : null}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(y.events)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(y.permanent)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(y.temporary)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(y.ens_kwh)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(y.saifi, 2)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(y.saidi, 1)}</td>
                  <td className="py-2 text-right"><Delta value={y.events_yoy_pct} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Section title="Penyebab gangguan"><Breakdown rows={data.by_cause} label="Gangguan menurut penyebab" /></Section>
        <Section title="Cuaca saat gangguan"><Breakdown rows={data.by_weather} label="Gangguan menurut cuaca" /></Section>
        <Section title="Jenis peralatan">
          <Breakdown rows={data.by_device.map((r) => ({ ...r, label: DEVICE[r.label] || r.label }))} label="Gangguan menurut peralatan" />
        </Section>
        <Section title="Jam kejadian" hint="Jumlah gangguan menurut jam (WIB).">
          <ColumnChart data={hours} height={180} ariaLabel="Gangguan menurut jam" unit="kali" labelEvery={3} />
        </Section>
      </div>

      {data.by_unit.length > 0 && (
        <Section title="Per ULP" hint="Jumlah gangguan dan ENS menurut RAYON di sheet; SAIFI/SAIDI memakai pelanggan ULP pada penyulang terdampak.">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-100 dark:border-slate-800"><Th>ULP</Th><Th>UP3</Th><Th right>Gangguan</Th><Th right>Permanen</Th><Th right>Temporer</Th><Th right>ENS (kWh)</Th><Th right>Pelanggan</Th><Th right>SAIFI</Th><Th right>SAIDI (mnt)</Th></tr></thead>
              <tbody>
                {data.by_unit.map((u) => (
                  <tr key={u.unit_id} className="border-b border-slate-50 dark:border-slate-800/60">
                    <td className="py-2 pr-3 font-medium">{u.unit_name}</td>
                    <td className="py-2 pr-3 text-slate-500">{u.up3_name || '-'}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(u.events)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(u.permanent)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(u.temporary)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(u.ens_kwh)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(u.customers)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtNum(u.saifi, 2)}</td>
                    <td className="py-2 text-right tabular-nums">{fmtNum(u.saidi, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  )
}

function FeederDrawer({ feederId, params, onClose }) {
  const [state, setState] = useState({ loading: true, error: '', data: null })
  const [feederGangguanType, setFeederGangguanType] = useState('total') // 'total' | 'permanent' | 'temporary'
  useEffect(() => {
    let alive = true
    setState({ loading: true, error: '', data: null })
    outageApi.feeder(feederId, params).then(
      (r) => alive && setState({ loading: false, error: '', data: r.data }),
      (e) => alive && setState({ loading: false, error: e?.message || 'Gagal memuat penyulang.', data: null })
    )
    return () => { alive = false }
  }, [feederId, params])
  const d = state.data
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/40" role="dialog" aria-modal="true" aria-label="Detail penyulang" onClick={onClose}>
      <div className="h-full w-full max-w-2xl overflow-y-auto bg-white dark:bg-slate-900 p-5 sm:p-6 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-bold text-slate-900 dark:text-slate-100">{d ? d.feeder.name : 'Penyulang'}</h2>
            {d && <p className="text-xs text-slate-500">{[d.feeder.gi_name, d.feeder.code, d.feeder.owner].filter(Boolean).join(' · ')} · {fmtInt(d.feeder.customers)} pelanggan</p>}
          </div>
          <Button variant="ghost" size="sm" icon={IconX} onClick={onClose} aria-label="Tutup" />
        </div>
        {state.loading && <div className="flex justify-center py-12"><Spinner /></div>}
        {state.error && <div className="mt-4"><Alert type="error">{state.error}</Alert></div>}
        {d && (
          <div className="mt-5 space-y-5">
            <div>
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <h3 className="text-sm font-semibold">Gangguan per bulan</h3>
                <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-[11px]">
                  {[['total', 'Total'], ['permanent', 'Permanen'], ['temporary', 'Temporer']].map(([k, lbl]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => setFeederGangguanType(k)}
                      className={`px-2 py-0.5 rounded font-medium transition cursor-pointer ${
                        feederGangguanType === k
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
                valueKey={feederGangguanType === 'permanent' ? 'permanent' : feederGangguanType === 'temporary' ? 'temporary' : 'events'}
                height={190}
                ariaLabel={`Gangguan bulanan ${d.feeder.name}`}
                unit="kali"
              />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Penyebab</h3>
              <Breakdown rows={d.by_cause} label="Penyebab gangguan penyulang" />
            </div>
            <div>
              <h3 className="mb-1 text-sm font-semibold">Gardu di bawah penyulang</h3>
              <p className="mb-2 text-xs text-slate-500">
                {fmtInt(d.gardu.count)} gardu, {fmtInt(d.gardu.measured)} terukur
                {d.gardu.avg_loading_pct !== null ? `, rata-rata beban ${fmtNum(d.gardu.avg_loading_pct, 1)}%` : ''}; {fmtInt(d.gardu.at_80)} gardu ≥ 80%, {fmtInt(d.gardu.at_100)} gardu ≥ 100%.
              </p>
              {d.gardu.items.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-100 dark:border-slate-800"><Th>Gardu</Th><Th>ULP</Th><Th right>kVA</Th><Th right>Beban</Th></tr></thead>
                    <tbody>
                      {d.gardu.items.map((g) => (
                        <tr key={g.id} className="border-b border-slate-50 dark:border-slate-800/60">
                          <td className="py-1.5 pr-3 font-medium">{g.code || g.name}</td>
                          <td className="py-1.5 pr-3 text-slate-500">{g.unit_name || '-'}</td>
                          <td className="py-1.5 pr-3 text-right tabular-nums">{fmtInt(g.capacity_kva)}</td>
                          <td className={`py-1.5 text-right tabular-nums ${g.loading_pct >= 100 ? 'font-semibold text-rose-600' : g.loading_pct >= 80 ? 'font-semibold text-amber-600' : ''}`}>{g.loading_pct === null ? '-' : `${fmtNum(g.loading_pct, 1)}%`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            <div>
              <h3 className="mb-2 text-sm font-semibold">Gangguan terakhir</h3>
              <ul className="space-y-2 text-sm">
                {d.recent.map((r) => (
                  <li key={`${r.occurred_at}-${r.fault_code || ''}-${r.minutes}`} className="rounded-xl border border-slate-100 dark:border-slate-800 px-3 py-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                      <span>{fmtDay(r.occurred_at)}</span>
                      <span>{r.type === 'PERMANEN' ? 'Permanen' : r.type === 'TEMPORER' ? 'Temporer' : '-'} · {fmtMinutes(r.minutes)}{r.ens_kwh ? ` · ENS ${fmtNum(r.ens_kwh, 0)} kWh` : ''}</span>
                    </div>
                    <div className="mt-0.5 text-slate-700 dark:text-slate-300">{r.category || r.cause || 'Tanpa keterangan'}{r.weather ? ` · ${r.weather}` : ''}</div>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function FeedersTab({ data, params }) {
  const [open, setOpen] = useState(null)
  const rows = data.by_feeder
  return (
    <div className="space-y-5">
      <Section title="Penyulang dengan gangguan terbanyak" hint="Klik penyulang untuk tren bulanan, penyebab, gangguan terakhir, dan gardu di bawahnya (maks. 40 penyulang).">
        {rows.length === 0 ? <p className="py-6 text-center text-sm text-slate-500">Belum ada data.</p> : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-100 dark:border-slate-800"><Th>Penyulang</Th><Th right>Gangguan</Th><Th right>Permanen</Th><Th right>Temporer</Th><Th right>12 bln</Th><Th right>Tren</Th><Th right>ENS (kWh)</Th><Th right>Pelanggan</Th><Th right>Gardu</Th><Th right>Kontribusi SAIDI</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.feeder_id || `${r.gi_name}-${r.name}`} className="border-b border-slate-50 dark:border-slate-800/60">
                    <td className="py-2 pr-3">
                      {r.matched ? (
                        <button type="button" className="text-left font-medium text-blue-700 dark:text-blue-400 hover:underline" onClick={() => setOpen(r.feeder_id)}>{r.name}</button>
                      ) : <span className="font-medium">{r.name} <span className="text-xs text-amber-600">(belum terpetakan)</span></span>}
                      <div className="text-xs text-slate-500">{r.gi_name || '-'}</div>
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(r.events)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(r.permanent)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(r.temporary)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(r.l12m_events)}</td>
                    <td className="py-2 pr-3 text-right"><Delta value={r.trend_pct} /></td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(r.ens_kwh)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(r.customers)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(r.gardu)}</td>
                    <td className="py-2 text-right tabular-nums">{r.saidi_contribution === null ? '-' : fmtNum(r.saidi_contribution, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      {open && <FeederDrawer feederId={open} params={params} onClose={() => setOpen(null)} />}
    </div>
  )
}

function ForecastTab({ params }) {
  const [state, setState] = useState({ loading: true, error: '', data: null })
  const [metric, setMetric] = useState('permanent')
  useEffect(() => {
    let alive = true
    setState({ loading: true, error: '', data: null })
    const { up3_id: up3, unit_id: unit } = params
    outageApi.forecast({ up3_id: up3, unit_id: unit }).then(
      (r) => alive && setState({ loading: false, error: '', data: r.data }),
      (e) => alive && setState({ loading: false, error: e?.message || 'Gagal memuat prakiraan.', data: null })
    )
    return () => { alive = false }
  }, [params])

  if (state.loading) return <div className="flex justify-center py-12"><Spinner /></div>
  if (state.error) return <Alert type="error">{state.error}</Alert>
  const f = state.data
  if (!f) return null
  if (f.status !== 'OK') return <Alert type="info">{f.message}</Alert>
  const m = f.metrics.find((x) => x.key === metric) || f.metrics[0]
  const isInt = ['permanent', 'temporary', 'ens_kwh'].includes(m.key)
  const fmt = isInt ? fmtInt : (v) => fmtNum(v, m.key === 'saifi' ? 2 : 1)
  const ch = m.last12m > 0 ? ((m.next12m.p50 - m.last12m) / m.last12m) * 100 : null

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap gap-2" role="tablist" aria-label="Metrik prakiraan">
        {f.metrics.map((x) => (
          <button key={x.key} type="button" role="tab" aria-selected={x.key === m.key} onClick={() => setMetric(x.key)}
            className={`rounded-xl border px-3 py-1.5 text-sm font-semibold transition ${x.key === m.key ? 'border-blue-600 bg-blue-600 text-white' : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800'}`}>
            {x.label}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Tile label="12 bulan ke depan" value={fmt(m.next12m.p50)} delta={ch} sub={`rentang ${fmt(m.next12m.p10)} – ${fmt(m.next12m.p90)}`} />
        <Tile label="12 bulan terakhir" value={fmt(m.last12m)} sub={`s.d. ${monthLong(f.last_full_month)}`} />
        <Tile label="Galat backtest (WAPE)" value={m.quality.wape === null ? '-' : `${fmtNum(m.quality.wape * 100, 0)}%`} sub={`${m.quality.backtest_points} titik uji`} />
        <Tile label="Lebih baik dari naif musiman" value={m.quality.gain_vs_naive_pct === null ? '-' : fmtPct(m.quality.gain_vs_naive_pct, 0)} sub="selisih galat vs bulan sama tahun lalu" />
      </div>

      <Section title={m.label} hint="Garis penuh = riwayat 24 bulan terakhir; putus-putus = prakiraan median; pita = p10–p90 dari galat backtest.">
        <ForecastLine history={m.history} forecast={m.forecast} format={fmt} ariaLabel={`Prakiraan ${m.label}`} unit={m.key === 'saidi' ? 'menit/plg' : m.key === 'ens_kwh' ? 'kWh' : m.key === 'saifi' ? 'kali/plg' : 'kali'} />
      </Section>

      <Section title="Risiko gangguan per penyulang" hint="Perkiraan jumlah gangguan 12 bulan ke depan (laju Poisson dari 12 bulan terakhir dan sebelumnya). KRITIS ≥ 24, TINGGI ≥ 12, WASPADA ≥ 6 kali.">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead><tr className="text-left text-xs text-slate-500 border-b border-slate-100 dark:border-slate-800"><Th>Penyulang</Th><Th right>12 bln terakhir</Th><Th right>12 bln sebelumnya</Th><Th right>Prakiraan 12 bln</Th><Th right>Rentang</Th><Th right>Pelanggan</Th><Th>Risiko</Th></tr></thead>
            <tbody>
              {f.feeders.map((r) => (
                <tr key={r.feeder_id} className="border-b border-slate-50 dark:border-slate-800/60">
                  <td className="py-2 pr-3"><span className="font-medium">{r.name}</span><div className="text-xs text-slate-500">{r.gi_name || '-'}</div></td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(r.l12m_events)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(r.prev12m_events)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums font-semibold">{fmtNum(r.expected_12m, 1)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums text-slate-500">{fmtNum(r.p10, 0)} – {fmtNum(r.p90, 0)}</td>
                  <td className="py-2 pr-3 text-right tabular-nums">{fmtInt(r.customers)}</td>
                  <td className="py-2"><span className={`inline-flex rounded-md px-2 py-0.5 text-xs font-semibold ${RISK[r.risk]}`}>{r.risk}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Section>
      {f.notes?.length > 0 && <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500 dark:text-slate-400">{f.notes.map((n) => <li key={n}>{n}</li>)}</ul>}
    </div>
  )
}

/** Laporan & Monitoring > Analisis Gangguan: tren, penyulang & gardu, dan prakiraan gangguan. */
export default function OutageAnalysisPage() {
  const [tab, setTab] = useState('trend')
  const [up3Id, setUp3Id] = useState('')
  const [unitId, setUnitId] = useState('')
  const [fromM, setFromM] = useState('')
  const [toM, setToM] = useState('')
  const [state, setState] = useState({ loading: true, error: '', data: null })
  const [exporting, setExporting] = useState(false)

  const params = useMemo(() => ({
    from: fromM ? `${fromM}-01` : undefined,
    to: toM ? lastDay(toM) : undefined,
    up3_id: up3Id || undefined,
    unit_id: unitId || undefined,
  }), [fromM, toM, up3Id, unitId])

  const load = useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: '' }))
    try {
      const r = await outageApi.analysis(params)
      setState({ loading: false, error: '', data: r.data })
    } catch (e) {
      setState({ loading: false, error: e?.message || 'Gagal memuat analisis gangguan.', data: null })
    }
  }, [params])

  useEffect(() => { load() }, [load])

  const exportXlsx = async () => {
    setExporting(true)
    try {
      const { blob, filename } = await outageApi.downloadAnalysisXlsx(params)
      triggerFileDownload(blob, filename || 'ANALISIS-GANGGUAN.xlsx')
    } catch (e) {
      setState((s) => ({ ...s, error: e?.message || 'Gagal mengekspor.' }))
    } finally {
      setExporting(false)
    }
  }

  const d = state.data
  const cov = d?.coverage

  return (
    <div className="space-y-5 w-full">
      <div className={`${CARD} p-5 sm:p-6`}>
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-3">
            <span className="rounded-xl bg-rose-50 dark:bg-rose-950/40 p-2.5 text-rose-600"><IconActivity size={22} /></span>
            <div>
              <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">Analisis Gangguan Penyulang</h1>
              <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                Tren gangguan permanen dan temporer, ENS, SAIFI, SAIDI, kaitan dengan gardu, dan prakiraan. Sumber: Data Gangguan (Sinkron).
              </p>
            </div>
          </div>
          <div className="flex gap-2">
            <Button variant="secondary" icon={IconRefresh} onClick={load} loading={state.loading}>Muat ulang</Button>
            <Button variant="secondary" icon={IconDownload} onClick={exportXlsx} loading={exporting} disabled={!d}>Ekspor Excel</Button>
          </div>
        </div>
      </div>

      <div className={`${CARD} p-4 flex flex-wrap items-center gap-3`}>
        <HierarchicalUnitFilter permission="outages.view" up3Id={up3Id} onUp3Change={setUp3Id} unitId={unitId} onUnitChange={setUnitId} unitAriaLabel="Filter Unit ULP" />
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400">
          Dari
          <input type="month" value={fromM} onChange={(e) => setFromM(e.target.value)} aria-label="Dari bulan" className={`${filterControlCls} w-32`} />
        </label>
        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-400">
          Sampai
          <input type="month" value={toM} onChange={(e) => setToM(e.target.value)} aria-label="Sampai bulan" className={`${filterControlCls} w-32`} />
        </label>
        {cov && cov.events > 0 && (
          <span className="ml-auto text-xs text-slate-500 dark:text-slate-400">
            {fmtInt(cov.events)} peristiwa{cov.unmatched_feeder_events > 0 ? ` · ${fmtInt(cov.unmatched_feeder_events)} belum terpetakan ke penyulang` : ''}
          </span>
        )}
      </div>

      <div className="flex flex-wrap gap-2 border-b border-slate-200 dark:border-slate-800" role="tablist" aria-label="Bagian analisis">
        {TABS.map((t) => (
          <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} title={t.hint} onClick={() => setTab(t.key)}
            className={`-mb-px border-b-2 px-4 py-2 text-sm font-semibold transition ${tab === t.key ? 'border-blue-600 text-blue-700 dark:text-blue-400' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {state.error && <Alert type="error">{state.error}</Alert>}
      {state.loading && !d && <div className="flex justify-center py-16"><Spinner /></div>}
      {d && cov.events === 0 && <Alert type="info">Belum ada data gangguan pada cakupan ini. Jalankan sinkronisasi di Master Data &rsaquo; Data Gangguan (Sinkron).</Alert>}
      {d && cov.events > 0 && tab === 'trend' && <TrendTab data={d} />}
      {d && cov.events > 0 && tab === 'feeders' && <FeedersTab data={d} params={params} />}
      {tab === 'forecast' && <ForecastTab params={params} />}

      {d && tab === 'trend' && d.notes?.length > 0 && (
        <ul className="list-disc space-y-1 pl-5 text-xs text-slate-500 dark:text-slate-400">{d.notes.map((n) => <li key={n}>{n}</li>)}</ul>
      )}
    </div>
  )
}
