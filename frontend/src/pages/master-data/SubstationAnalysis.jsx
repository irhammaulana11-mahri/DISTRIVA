import { useEffect, useState, useCallback } from 'react'
import { substationsApi } from '../../services/api.js'
import { readingTime } from '../../utils/readingTime.js'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'

const fmt = (v, d = 1) => (v === null || v === undefined ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d }))
const COLORS = ['#2563eb', '#d97706', '#059669', '#e11d48', '#7c3aed', '#0891b2', '#65a30d', '#db2777']

export const FLAG_LABEL = {
  BASE_LOW: 'Tegangan pangkal rendah',
  PHASE_UNBALANCED: 'Fasa tidak seimbang',
  FEEDER_UNBALANCED: 'Jurusan tidak seimbang',
  END_LOW: 'Tegangan ujung rendah',
  END_DROP: 'Drop tegangan tinggi',
}

export function FlagChips({ flags = [] }) {
  return (
    <>
      {flags.map((f) => (
        <span key={f} data-testid={`flag-${f}`} className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
          {FLAG_LABEL[f] || f}
        </span>
      ))}
    </>
  )
}

const CLASS_CLS = {
  UNDERLOAD: 'text-sky-700',
  NORMAL: 'text-emerald-700',
  OVERLOAD: 'text-amber-700',
  OVERBLAST: 'text-rose-700 font-bold',
}

/**
 * Grafik garis SVG sederhana. series: [{ name, points: [{ x, y }] }] (x = label); refs: [{ y, label }] garis batas.
 * Titik tanpa nilai (y = null) memutus garis, tidak diisi nol: nilai 0 berarti belum diukur.
 */
export function LineChart({ series, refs = [], unit = '', height = 160, testId }) {
  const W = 560
  const H = height
  const pad = { l: 40, r: 12, t: 10, b: 24 }
  const labels = [...new Set(series.flatMap((s) => s.points.map((p) => p.x)))]
  const ys = series.flatMap((s) => s.points.map((p) => p.y)).filter((y) => y !== null && y !== undefined).concat(refs.map((r) => r.y))
  if (labels.length === 0 || ys.length === 0) return <p className="text-xs text-slate-500">Belum ada data untuk grafik.</p>
  const lo = Math.min(0, ...ys)
  const hi = Math.max(...ys) * 1.08 || 1
  const X = (i) => pad.l + (labels.length === 1 ? (W - pad.l - pad.r) / 2 : (i * (W - pad.l - pad.r)) / (labels.length - 1))
  const Y = (y) => pad.t + (1 - (y - lo) / (hi - lo)) * (H - pad.t - pad.b)
  const step = Math.max(1, Math.ceil(labels.length / 8))
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto text-slate-500" role="img" data-testid={testId}>
      {[0, 0.5, 1].map((t) => {
        const y = lo + (hi - lo) * t
        return (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={Y(y)} y2={Y(y)} stroke="currentColor" strokeOpacity="0.15" />
            <text x={pad.l - 4} y={Y(y) + 3} fontSize="9" textAnchor="end" fill="currentColor">{fmt(y, 0)}</text>
          </g>
        )
      })}
      {refs.map((r) => (
        <g key={r.label}>
          <line x1={pad.l} x2={W - pad.r} y1={Y(r.y)} y2={Y(r.y)} stroke="#e11d48" strokeDasharray="4 3" strokeOpacity="0.7" />
          <text x={W - pad.r} y={Y(r.y) - 3} fontSize="9" textAnchor="end" fill="#e11d48">{r.label}</text>
        </g>
      ))}
      {labels.map((l, i) => (i % step === 0 ? <text key={l} x={X(i)} y={H - 8} fontSize="9" textAnchor="middle" fill="currentColor">{l}</text> : null))}
      {series.map((s, si) => {
        const color = COLORS[si % COLORS.length]
        let d = ''
        let pen = false
        s.points.forEach((p) => {
          if (p.y === null || p.y === undefined) { pen = false; return }
          d += `${pen ? 'L' : 'M'}${X(labels.indexOf(p.x))},${Y(p.y)} `
          pen = true
        })
        return (
          <g key={s.name}>
            <path d={d} fill="none" stroke={color} strokeWidth="2" />
            {s.points.filter((p) => p.y !== null && p.y !== undefined).map((p) => (
              <circle key={p.x} cx={X(labels.indexOf(p.x))} cy={Y(p.y)} r="2.5" fill={color}><title>{`${s.name} ${p.x}: ${fmt(p.y, 2)}${unit}`}</title></circle>
            ))}
          </g>
        )
      })}
    </svg>
  )
}

function Legend({ names }) {
  return (
    <div className="flex flex-wrap gap-3 text-[11px] mb-1">
      {names.map((n, i) => (
        <span key={n} className="inline-flex items-center gap-1"><span className="inline-block w-3 h-0.5" style={{ background: COLORS[i % COLORS.length] }} />{n}</span>
      ))}
    </div>
  )
}

function Th({ children, right }) {
  return <th className={`py-2 px-3 ${right ? 'text-right' : ''}`}>{children}</th>
}

const TABLE = 'w-full text-left text-xs'
const HEAD = 'bg-slate-50 dark:bg-slate-800/60 text-[11px] text-slate-600 dark:text-slate-400'

/** Beban (A) tiap jurusan pada satu pembacaan: "A 45 / 52 / 48" = arus fasa R / S / T; netral di tooltip. Kosong = jurusan tidak terukur. */
function FeederLoads({ feeders = [] }) {
  if (feeders.length === 0) return <span className="text-slate-400">-</span>
  return (
    <div className="space-y-0.5 font-mono whitespace-nowrap">
      {feeders.map((f) => (
        <div key={f.label} title={`Jurusan ${f.label}: R ${fmt(f.current_r_a)} A, S ${fmt(f.current_s_a)} A, T ${fmt(f.current_t_a)} A, N ${fmt(f.current_n_a)} A (total ${fmt(f.total_a)} A)`}>
          <b className="font-sans">{f.label}</b> {fmt(f.current_r_a, 0)} / {fmt(f.current_s_a, 0)} / {fmt(f.current_t_a, 0)}
        </div>
      ))}
    </div>
  )
}

/** Satu deret per jurusan (A, B, C, ...): total arus R+S+T tiap pembacaan; pembacaan tanpa jurusan itu memutus garis. */
function feederSeries(h) {
  const labels = [...new Set(h.flatMap((r) => (r.feeders || []).map((f) => f.label)))].sort()
  return labels.map((label) => ({ name: `Jurusan ${label}`, points: h.map((r) => ({ x: r.measured_on, y: (r.feeders || []).find((f) => f.label === label)?.total_a ?? null })) }))
}

function History({ a }) {
  const h = a.history
  if (h.length === 0) return <p className="text-xs text-slate-500">Belum ada pembacaan.</p>
  const perFeeder = feederSeries(h)
  return (
    <div className="space-y-3">
      <Legend names={['Pembebanan (%)']} />
      <LineChart testId="chart-history" unit="%" refs={[{ y: 100, label: '100%' }, { y: 80, label: '80%' }]} series={[{ name: 'Pembebanan (%)', points: h.map((r) => ({ x: r.measured_on, y: r.loading_pct })) }]} />
      {perFeeder.length > 0 && (
        <>
          <Legend names={perFeeder.map((x) => x.name)} />
          <LineChart testId="chart-feeders" unit=" A" series={perFeeder} />
        </>
      )}
      <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
        <table className={TABLE}>
          <thead><tr className={HEAD}><Th>Tanggal & jam</Th><Th right>Kapasitas (kVA)</Th><Th right>R / S / T (A)</Th><Th right>Beban (kVA)</Th><Th right>Pembebanan</Th><Th right>Tegangan R / S / T (V)</Th><Th right>Ujung (V)</Th><Th>Beban per jurusan (A)</Th><Th>Sumber</Th></tr></thead>
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            {[...h].reverse().map((r, i) => (
              <tr key={`${r.measured_on}-${r.source}-${i}`}>
                <td className="py-2 px-3 font-mono" data-testid="history-time">{readingTime(r)}</td>
                <td className="py-2 px-3 text-right font-mono" data-testid="history-capacity">
                  {fmt(r.capacity_kva, 0)}
                  {r.capacity_change && <span title={`Kapasitas berubah dari ${fmt(r.capacity_change.from, 0)} ke ${fmt(r.capacity_change.to, 0)} kVA (manajemen trafo)`} className="ml-1 px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 text-[10px] font-bold">dari {fmt(r.capacity_change.from, 0)}</span>}
                </td>
                <td className="py-2 px-3 text-right font-mono">{r.current_r_a === null && r.current_max_a !== null ? `maks ${fmt(r.current_max_a)}` : `${fmt(r.current_r_a)} / ${fmt(r.current_s_a)} / ${fmt(r.current_t_a)}`}</td>
                <td className="py-2 px-3 text-right font-mono">{fmt(r.load_kva, 2)}</td>
                <td className="py-2 px-3 text-right font-mono">{r.loading_pct === null ? '-' : `${fmt(r.loading_pct)}%`}</td>
                <td className="py-2 px-3 text-right font-mono whitespace-nowrap" data-testid="history-voltage">{`${fmt(r.base_voltage_r_v, 0)} / ${fmt(r.base_voltage_s_v, 0)} / ${fmt(r.base_voltage_t_v, 0)}`}</td>
                <td className="py-2 px-3 text-right font-mono">{fmt(r.end_voltage_v)}</td>
                <td className="py-2 px-3" data-testid="history-feeders"><FeederLoads feeders={r.feeders} /></td>
                <td className="py-2 px-3">{r.source}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Balance({ a }) {
  const l = a.latest
  if (!l) return <p className="text-xs text-slate-500">Belum ada pembacaan.</p>
  const lim = a.limits
  const phases = [['R', l.current_r_a], ['S', l.current_s_a], ['T', l.current_t_a]]
  const max = Math.max(...phases.map(([, v]) => v || 0), 1)
  return (
    <div className="space-y-4" data-testid="balance">
      <div>
        <h4 className="font-bold mb-1">Keseimbangan beban antar fasa (pembacaan {readingTime(l)})</h4>
        {l.phase_imbalance_pct === null ? (
          <p className="text-slate-500">Arus R, S, dan T belum lengkap, jadi ketidakseimbangan tidak dapat dihitung.</p>
        ) : (
          <p>
            Ketidakseimbangan <b data-testid="phase-imbalance" className={l.flags.includes('PHASE_UNBALANCED') ? 'text-rose-700' : 'text-emerald-700'}>{fmt(l.phase_imbalance_pct)}%</b> (batas {fmt(lim.imbalance_max_pct, 0)}%)
            {l.neutral_ratio_pct !== null && <> · arus netral {fmt(l.neutral_ratio_pct)}% dari rata-rata fasa</>}
          </p>
        )}
        <div className="mt-2 space-y-1">
          {phases.map(([n, v]) => (
            <div key={n} className="flex items-center gap-2">
              <span className="w-4 font-bold">{n}</span>
              <div className="flex-1 h-3 rounded bg-slate-100 dark:bg-slate-800"><div className="h-3 rounded bg-blue-500" style={{ width: `${((v || 0) / max) * 100}%` }} /></div>
              <span className="w-16 text-right font-mono">{fmt(v)} A</span>
            </div>
          ))}
        </div>
      </div>
      <div>
        <h4 className="font-bold mb-1">Keseimbangan antar jurusan</h4>
        {l.feeders.length === 0 ? (
          <p className="text-slate-500">Belum ada arus per jurusan pada pembacaan terakhir.</p>
        ) : (
          <>
            {l.feeder_imbalance_pct !== null ? (
              <p>
                Ketidakseimbangan <b data-testid="feeder-imbalance" className={l.flags.includes('FEEDER_UNBALANCED') ? 'text-rose-700' : 'text-emerald-700'}>{fmt(l.feeder_imbalance_pct)}%</b> (batas {fmt(lim.feeder_imbalance_max_pct, 0)}%)
              </p>
            ) : (
              <p className="text-slate-500">Hanya satu jurusan terukur: tidak ada pembanding.</p>
            )}
            <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 mt-1">
              <table className={TABLE}>
                <thead><tr className={HEAD}><Th>Jurusan</Th><Th right>R (A)</Th><Th right>S (A)</Th><Th right>T (A)</Th><Th right>N (A)</Th><Th right>Total (A)</Th><Th right>Porsi</Th><Th right>Ujung (V)</Th></tr></thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {l.feeders.map((f) => (
                    <tr key={f.label}>
                      <td className="py-2 px-3 font-bold">{f.label}</td>
                      {[f.current_r_a, f.current_s_a, f.current_t_a, f.current_n_a].map((v, i) => <td key={i} className="py-2 px-3 text-right font-mono">{fmt(v)}</td>)}
                      <td className="py-2 px-3 text-right font-mono font-semibold">{fmt(f.total_a)}</td>
                      <td className="py-2 px-3 text-right font-mono">{f.share_pct === null ? '-' : `${fmt(f.share_pct)}%`}</td>
                      <td className="py-2 px-3 text-right font-mono">{fmt(f.end_voltage_v)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Voltage({ a }) {
  const h = a.history
  const l = a.latest
  if (!l) return <p className="text-xs text-slate-500">Belum ada pembacaan.</p>
  const lim = a.limits
  return (
    <div className="space-y-3" data-testid="voltage">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {[
          ['Pangkal terendah', l.base_voltage_min_v, 'V', l.flags.includes('BASE_LOW'), `batas ${fmt(lim.base_voltage_min_v, 0)} V`],
          ['Ujung terendah', l.end_voltage_min_v, 'V', l.flags.includes('END_LOW'), `batas ${fmt(lim.end_voltage_min_v, 0)} V`],
          ['Drop dari 220 V → ujung', l.drop_v, 'V', l.flags.includes('END_DROP'), `batas ${fmt(lim.drop_max_pct, 0)}%`],
          ['Drop (persen)', l.drop_pct, '%', l.flags.includes('END_DROP'), 'dari tegangan nominal 220 V'],
        ].map(([k, v, u, bad, note]) => (
          <div key={k} className={`rounded-xl border p-3 ${bad ? 'border-rose-300 bg-rose-50 dark:bg-rose-950/30' : 'border-slate-200 dark:border-slate-700'}`}>
            <div className="text-[11px] text-slate-500">{k}</div>
            <div className="text-lg font-bold">{fmt(v)} <span className="text-xs font-normal">{u}</span></div>
            <div className="text-[10px] text-slate-500">{note}</div>
          </div>
        ))}
      </div>
      {l.base_voltage_min_v === null && <p className="text-xs text-slate-500">Tegangan pangkal belum diukur pada pembacaan terakhir, sehingga drop tidak dapat dihitung.</p>}
      <div className="grid grid-cols-3 gap-2" data-testid="voltage-phases">
        {[['R-N', l.base_voltage_r_v], ['S-N', l.base_voltage_s_v], ['T-N', l.base_voltage_t_v]].map(([k, v]) => (
          <div key={k} className="rounded-xl border border-slate-200 dark:border-slate-700 p-3">
            <div className="text-[11px] text-slate-500">Tegangan pangkal {k}</div>
            <div className="text-lg font-bold">{fmt(v)} <span className="text-xs font-normal">V</span></div>
          </div>
        ))}
      </div>
      <Legend names={['Fasa R (V)', 'Fasa S (V)', 'Fasa T (V)']} />
      <LineChart testId="chart-voltage-phases" unit=" V" refs={[{ y: lim.base_voltage_min_v, label: `${fmt(lim.base_voltage_min_v, 0)} V` }]}
        series={[['R', 'base_voltage_r_v'], ['S', 'base_voltage_s_v'], ['T', 'base_voltage_t_v']].map(([n, k]) => ({ name: `Fasa ${n}`, points: h.map((r) => ({ x: r.measured_on, y: r[k] })) }))} />
      <Legend names={['Pangkal terendah (V)', 'Ujung terendah (V)']} />
      <LineChart testId="chart-voltage" unit=" V" refs={[{ y: lim.base_voltage_min_v, label: `${fmt(lim.base_voltage_min_v, 0)} V` }, { y: lim.end_voltage_min_v, label: `${fmt(lim.end_voltage_min_v, 0)} V` }]}
        series={[{ name: 'Pangkal', points: h.map((r) => ({ x: r.measured_on, y: r.base_voltage_min_v })) }, { name: 'Ujung', points: h.map((r) => ({ x: r.measured_on, y: r.end_voltage_min_v })) }]} />
    </div>
  )
}

const NOTE_TEXT = {
  NO_CAPACITY: 'Kapasitas gardu belum diketahui.',
  NO_LOAD_READING: 'Belum ada pembacaan yang memuat beban (kVA): isi arus per fasa atau persen pembebanan.',
  STALE_READING: 'Pembacaan beban terakhir sudah lewat batas usia: ukur ulang agar proyeksi dapat dipercaya.',
}

function Forecast({ a, growth, setGrowth }) {
  const f = a.forecast
  return (
    <div className="space-y-3" data-testid="forecast">
      {f.notes.map((n) => <Alert key={n} kind="warning">{NOTE_TEXT[n] || n}</Alert>)}
      {f.available && (
        <>
          <p>
            Dasar: beban {fmt(f.base.load_kva, 1)} kVA (diukur {f.base.measured_on}) + {fmt(f.base.connected_since_kva, 1)} kVA pelanggan tersambung sejak itu. Pelanggan dalam proses (belum tersambung) {fmt(a.forecast.additions.pipeline_kva, 1)} kVA masuk bulan depan; setelah itu
            tumbuh <b>{fmt(f.growth_kva_per_month, 2)} kVA/bulan</b>{f.growth_overridden ? ' (simulasi)' : ' (rata-rata penambahan 12 bulan terakhir)'}.
          </p>
          <p data-testid="forecast-crossing">
            {f.over_100_on ? <b className="text-rose-700">Diperkirakan melewati 100% pada {f.over_100_on}. </b> : <span>Tidak melewati 100% dalam horizon. </span>}
            {f.over_normal_on ? <b className="text-amber-700">Melewati 80% (overload) pada {f.over_normal_on}.</b> : <span>Tidak melewati 80% dalam horizon.</span>}
          </p>
          <Legend names={['Proyeksi pembebanan (%)']} />
          <LineChart testId="chart-forecast" unit="%" refs={[{ y: 100, label: '100%' }, { y: 80, label: '80%' }]} series={[{ name: 'Proyeksi', points: f.months.map((m) => ({ x: m.month, y: m.loading_pct })) }]} />
          <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className={TABLE}>
              <thead><tr className={HEAD}><Th>Bulan</Th><Th right>Beban (kVA)</Th><Th right>Pembebanan</Th><Th>Kelas</Th></tr></thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {f.months.map((m) => (
                  <tr key={m.month}>
                    <td className="py-2 px-3 font-mono">{m.month}</td>
                    <td className="py-2 px-3 text-right font-mono">{fmt(m.load_kva, 1)}</td>
                    <td className="py-2 px-3 text-right font-mono">{fmt(m.loading_pct)}%</td>
                    <td className={`py-2 px-3 ${CLASS_CLS[m.class] || ''}`}>{m.class}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      <label className="block font-semibold">
        Simulasi penambahan beban (kVA per bulan)
        <input aria-label="Simulasi pertumbuhan" type="number" step="0.5" value={growth} onChange={(e) => setGrowth(e.target.value)} placeholder="Kosongkan = pakai rata-rata 12 bulan"
          className="mt-1 block w-full px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800" />
      </label>
      <div>
        <h4 className="font-bold mb-1">Penambahan pelanggan per bulan (permohonan DISTRIVA, beban × faktor beban KKO)</h4>
        <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800">
          <table className={TABLE}>
            <thead><tr className={HEAD}><Th>Bulan</Th><Th right>Pelanggan tersambung</Th><Th right>Tambahan beban (kVA)</Th></tr></thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {f.additions.monthly.map((m) => (
                <tr key={m.month}><td className="py-2 px-3 font-mono">{m.month}</td><td className="py-2 px-3 text-right font-mono">{m.count}</td><td className="py-2 px-3 text-right font-mono">{fmt(m.kva, 2)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-[11px] text-slate-500">Hanya permohonan yang KKO-nya terhubung ke gardu ini, bukan trafo khusus, belum dibatalkan, dan tidak berstatus TIDAK LAYAK. Pelanggan yang tersambung di luar DISTRIVA belum terhitung.</p>
      </div>
    </div>
  )
}

const TABS = [['history', 'Riwayat'], ['balance', 'Keseimbangan'], ['voltage', 'Tegangan'], ['forecast', 'Proyeksi']]

/** Analisis satu gardu (docs/80 §14): riwayat pengukuran, keseimbangan fasa / jurusan, tegangan pangkal & ujung, proyeksi beban. */
export default function SubstationAnalysis({ id }) {
  const [tab, setTab] = useState('history')
  const [a, setA] = useState(null)
  const [error, setError] = useState('')
  const [growth, setGrowth] = useState('')

  const load = useCallback(async () => {
    setError('')
    try {
      const res = await substationsApi.analysis(id, { growth_kva: growth === '' ? undefined : growth })
      setA(res?.data || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat analisis gardu.')
    }
  }, [id, growth])

  useEffect(() => {
    const t = setTimeout(load, growth === '' ? 0 : 400)
    return () => clearTimeout(t)
  }, [load, growth])

  if (error) return <Alert kind="error">{error}</Alert>
  if (!a) return <div className="py-8 flex justify-center"><Spinner /></div>

  return (
    <div className="space-y-3 text-xs" data-testid="substation-analysis">
      {a.latest?.flags?.length > 0 && (
        <div className="flex flex-wrap gap-1.5" data-testid="analysis-flags"><FlagChips flags={a.latest.flags} /></div>
      )}
      <div className="flex gap-1.5 border-b border-slate-200 dark:border-slate-800 pb-2">
        {TABS.map(([k, label]) => (
          <button key={k} type="button" onClick={() => setTab(k)} className={`px-3 py-1 rounded-lg font-semibold cursor-pointer ${tab === k ? 'bg-blue-600 text-white' : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'}`}>
            {label}
          </button>
        ))}
      </div>
      {tab === 'history' && <History a={a} />}
      {tab === 'balance' && <Balance a={a} />}
      {tab === 'voltage' && <Voltage a={a} />}
      {tab === 'forecast' && <Forecast a={a} growth={growth} setGrowth={setGrowth} />}
    </div>
  )
}
