import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Grafik ringan (SVG/HTML, tanpa pustaka) untuk analisis tren, mengikuti panduan dataviz: batang tipis berujung bulat 4px di garis dasar, satu sumbu,
 * grid hairline yang redup, label langsung hanya pada nilai penting, tooltip saat disorot, warna dari token (terang/gelap), legenda bila lebih dari satu seri.
 * Semua grafik punya padanan tabel di halaman pemakainya (jangan menjadikan grafik satu-satunya jalur ke angka).
 */

export const fmtInt = (n) => (n === null || n === undefined ? '-' : Math.round(n).toLocaleString('id-ID'))
export const fmtNum = (n, d = 1) => (n === null || n === undefined ? '-' : Number(n).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d }))
export const fmtPct = (n, d = 1) => (n === null || n === undefined ? '-' : `${n > 0 ? '+' : ''}${Number(n).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d })}%`)
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
export const monthLabel = (ym, withYear = true) => { const [y, m] = String(ym).split('-'); return withYear ? `${MONTHS[Number(m) - 1]} ${y.slice(2)}` : MONTHS[Number(m) - 1] }
export const monthLong = (ym) => { const [y, m] = String(ym).split('-'); return `${MONTHS[Number(m) - 1]} ${y}` }

const STYLE = `
.viz-root{--viz-text:#0b0b0b;--viz-text2:#52514e;--viz-muted:#898781;--viz-grid:#e1e0d9;--viz-axis:#c3c2b7;--viz-surface:#fcfcfb;--viz-s1:#2a78d6;--viz-s2:#eb6834;--viz-pos:#2a78d6;--viz-neg:#e34948;--viz-neutral:#c3c2b7}
:root.dark .viz-root{--viz-text:#f0efec;--viz-text2:#c3c2b7;--viz-muted:#898781;--viz-grid:#2c2c2a;--viz-axis:#383835;--viz-surface:#1a1a19;--viz-s1:#3987e5;--viz-s2:#d95926;--viz-pos:#3987e5;--viz-neg:#e66767;--viz-neutral:#383835}
.viz-root svg text{font-family:system-ui,-apple-system,"Segoe UI",sans-serif}
`
export function VizStyles() { return <style>{STYLE}</style> }

function useWidth(fallback = 640) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver((entries) => { const cw = Math.floor(entries[0].contentRect.width); if (cw > 0) setW(cw) })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

function niceMax(v) {
  if (v <= 0) return 1
  const p = 10 ** Math.floor(Math.log10(v))
  const f = v / p
  return ([1, 1.5, 2, 2.5, 3, 4, 5, 6, 8].find((x) => f <= x) || 10) * p
}

/** Batang dengan ujung data membulat 4px dan dasar rata di garis dasar. */
function barPath(x, y, w, h, r) {
  const rr = Math.max(0, Math.min(r, w / 2, h))
  if (h <= 0) return ''
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
}

function Tooltip({ box, children }) {
  if (!box) return null
  return (
    <div role="tooltip" className="pointer-events-none absolute z-10 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md dark:border-slate-700 dark:bg-slate-900" style={{ left: box.x, top: box.y, transform: box.flip ? 'translate(-100%, 0)' : 'none' }}>
      {children}
    </div>
  )
}

/**
 * Kolom satu seri. data: [{ key, label, value, partial?, lines?: string[] }]. color: token CSS (bawaan --viz-s1). refLine: { value, label } garis acuan (mis. indeks 1,0).
 * Bulan berjalan (partial) digambar sebagai garis tepi putus-putus agar tidak dibaca sebagai turun.
 */
export function ColumnChart({ data, height = 220, color = 'var(--viz-s1)', format = fmtInt, ariaLabel, refLine = null, unit = '', labelEvery = null, tickCount = 4 }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const m = { l: 46, r: 8, t: 12, b: 26 }
  const iw = Math.max(80, width - m.l - m.r)
  const ih = height - m.t - m.b
  const n = data.length
  const maxV = Math.max(0, ...data.map((d) => d.value || 0), refLine?.value || 0)
  const top = niceMax(maxV)
  const ticks = Array.from({ length: tickCount + 1 }, (_, i) => (top * i) / tickCount)
  const band = n > 0 ? iw / n : iw
  const bw = Math.max(2, Math.min(band - 2, 22))
  const every = labelEvery || Math.max(1, Math.ceil(46 / Math.max(band, 1)))
  const y = (v) => m.t + ih - (v / top) * ih
  const best = data.reduce((a, d, i) => ((d.value || 0) > (data[a]?.value || 0) && !d.partial ? i : a), 0)
  const lastFull = [...data].map((d, i) => [d, i]).filter(([d]) => !d.partial).pop()?.[1]
  const labeled = new Set([best, lastFull].filter((i) => i !== undefined))
  if (n === 0) return <p className="py-8 text-center text-sm text-slate-500">Belum ada data pada rentang ini.</p>
  return (
    <div ref={ref} className="viz-root relative w-full" onMouseLeave={() => setHover(null)}>
      <VizStyles />
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--viz-muted)">{format(t)}</text>
          </g>
        ))}
        {refLine && (
          <g>
            <line x1={m.l} x2={m.l + iw} y1={y(refLine.value)} y2={y(refLine.value)} stroke="var(--viz-text2)" strokeWidth={1} strokeDasharray="4 3" />
            <text x={m.l + 4} y={y(refLine.value) - 4} textAnchor="start" fontSize="11" fill="var(--viz-text2)">{refLine.label}</text>
          </g>
        )}
        {data.map((d, i) => {
          const cx = m.l + band * i + band / 2
          const h = ((d.value || 0) / top) * ih
          const isHover = hover?.i === i
          return (
            <g key={d.key}>
              {d.partial
                ? <path d={barPath(cx - bw / 2, y(d.value || 0), bw, h, 4)} fill={color} fillOpacity={0.18} stroke={color} strokeWidth={1.5} strokeDasharray="3 2" />
                : <path d={barPath(cx - bw / 2, y(d.value || 0), bw, h, 4)} fill={color} fillOpacity={hover && !isHover ? 0.55 : 1} />}
              {labeled.has(i) && !d.partial && (
                <text x={cx} y={y(d.value || 0) - 4} textAnchor="middle" fontSize="11" fontWeight="600" fill="var(--viz-text)">{format(d.value)}</text>
              )}
              {i % every === 0 && <text x={cx} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--viz-muted)">{d.label}</text>}
              <rect x={m.l + band * i} y={m.t} width={band} height={ih} fill="transparent" tabIndex={0} aria-label={`${d.label}: ${format(d.value)}${unit ? ` ${unit}` : ''}`}
                onMouseMove={() => setHover({ i, x: Math.min(cx + 10, width - 160), y: Math.max(m.t, y(d.value || 0) - 6), flip: false })} onFocus={() => setHover({ i, x: Math.min(cx + 10, width - 160), y: m.t, flip: false })} onBlur={() => setHover(null)} />
            </g>
          )
        })}
      </svg>
      <Tooltip box={hover}>
        {hover && (
          <div className="space-y-0.5">
            <div className="font-semibold text-slate-900 dark:text-slate-100">{data[hover.i].label}{data[hover.i].partial ? ' (belum lengkap)' : ''}</div>
            <div className="text-slate-700 dark:text-slate-300">{format(data[hover.i].value)}{unit ? ` ${unit}` : ''}</div>
            {(data[hover.i].lines || []).map((l) => <div key={l} className="text-slate-500 dark:text-slate-400">{l}</div>)}
          </div>
        )}
      </Tooltip>
    </div>
  )
}

/** Kolom berlawanan arah di sekitar nol: data [{ key, label, up, down (<=0), partial?, lines? }]. Biru = naik, merah = turun (pasangan divergen); legenda selalu tampil. */
export function DivergingColumns({ data, height = 220, format = fmtInt, ariaLabel, upLabel = 'Naik', downLabel = 'Turun', unit = '' }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const m = { l: 52, r: 8, t: 12, b: 26 }
  const iw = Math.max(80, width - m.l - m.r)
  const ih = height - m.t - m.b
  const n = data.length
  const maxUp = Math.max(0, ...data.map((d) => d.up || 0))
  const maxDown = Math.max(0, ...data.map((d) => Math.abs(d.down || 0)))
  const span = niceMax(Math.max(maxUp, maxDown, 1))
  const upShare = maxUp + maxDown > 0 ? maxUp / (maxUp + maxDown) : 0.5
  const zeroY = m.t + ih * Math.min(0.85, Math.max(0.15, upShare))
  const scale = Math.min((zeroY - m.t) / Math.max(maxUp, 1), (m.t + ih - zeroY) / Math.max(maxDown, 1))
  const band = n > 0 ? iw / n : iw
  const bw = Math.max(2, Math.min(band - 2, 22))
  const every = Math.max(1, Math.ceil(46 / Math.max(band, 1)))
  if (n === 0) return <p className="py-8 text-center text-sm text-slate-500">Belum ada data pada rentang ini.</p>
  const ticks = [-span, -span / 2, 0, span / 2, span].filter((t) => (t >= 0 ? t <= maxUp * 1.05 + 1 : -t <= maxDown * 1.05 + 1))
  return (
    <div ref={ref} className="viz-root relative w-full" onMouseLeave={() => setHover(null)}>
      <VizStyles />
      <div className="mb-1 flex items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-pos)' }} />{upLabel}</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: 'var(--viz-neg)' }} />{downLabel}</span>
      </div>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + iw} y1={zeroY - t * scale} y2={zeroY - t * scale} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} />
            <text x={m.l - 6} y={zeroY - t * scale + 4} textAnchor="end" fontSize="11" fill="var(--viz-muted)">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = m.l + band * i + band / 2
          const upH = (d.up || 0) * scale
          const dnH = Math.abs(d.down || 0) * scale
          const dim = hover && hover.i !== i ? 0.55 : 1
          return (
            <g key={d.key}>
              {upH > 0 && <path d={barPath(cx - bw / 2, zeroY - upH, bw, upH, 4)} fill="var(--viz-pos)" fillOpacity={d.partial ? 0.35 : dim} />}
              {dnH > 0 && <path d={`M${cx - bw / 2},${zeroY} V${zeroY + dnH - Math.min(4, bw / 2, dnH)} Q${cx - bw / 2},${zeroY + dnH} ${cx - bw / 2 + Math.min(4, bw / 2, dnH)},${zeroY + dnH} H${cx + bw / 2 - Math.min(4, bw / 2, dnH)} Q${cx + bw / 2},${zeroY + dnH} ${cx + bw / 2},${zeroY + dnH - Math.min(4, bw / 2, dnH)} V${zeroY} Z`} fill="var(--viz-neg)" fillOpacity={d.partial ? 0.35 : dim} />}
              {i % every === 0 && <text x={cx} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--viz-muted)">{d.label}</text>}
              <rect x={m.l + band * i} y={m.t} width={band} height={ih} fill="transparent" tabIndex={0} aria-label={`${d.label}: naik ${format(d.up)}, turun ${format(d.down)}${unit ? ` ${unit}` : ''}`}
                onMouseMove={() => setHover({ i, x: Math.min(cx + 10, width - 170), y: m.t })} onFocus={() => setHover({ i, x: Math.min(cx + 10, width - 170), y: m.t })} onBlur={() => setHover(null)} />
            </g>
          )
        })}
      </svg>
      <Tooltip box={hover}>
        {hover && (
          <div className="space-y-0.5">
            <div className="font-semibold text-slate-900 dark:text-slate-100">{data[hover.i].label}{data[hover.i].partial ? ' (belum lengkap)' : ''}</div>
            <div className="text-slate-700 dark:text-slate-300">{upLabel}: {format(data[hover.i].up)}{unit ? ` ${unit}` : ''}</div>
            <div className="text-slate-700 dark:text-slate-300">{downLabel}: {format(data[hover.i].down)}{unit ? ` ${unit}` : ''}</div>
            {(data[hover.i].lines || []).map((l) => <div key={l} className="text-slate-500 dark:text-slate-400">{l}</div>)}
          </div>
        )}
      </Tooltip>
    </div>
  )
}

/** Daftar batang horizontal berperingkat (satu rona): items [{ key, label, value, text, sub? }]; teks nilai selalu tampil di ujung baris. */
export function RankedBars({ items, color = 'var(--viz-s1)', ariaLabel }) {
  const max = Math.max(1, ...items.map((i) => i.value || 0))
  if (items.length === 0) return <p className="py-6 text-center text-sm text-slate-500">Belum ada data.</p>
  return (
    <ul className="viz-root space-y-2" aria-label={ariaLabel}>
      <VizStyles />
      {items.map((it) => (
        <li key={it.key} className="grid grid-cols-[minmax(0,9rem)_1fr_8.5rem] items-center gap-3 text-sm" title={it.sub || undefined}>
          <span className="truncate text-slate-700 dark:text-slate-300">{it.label}</span>
          <span className="h-2.5 rounded-r-full bg-slate-100 dark:bg-slate-800" aria-hidden>
            <span className="block h-2.5 rounded-r-full" style={{ width: `${Math.max(1, ((it.value || 0) / max) * 100)}%`, background: color }} />
          </span>
          <span className="text-right tabular-nums text-xs font-medium text-slate-900 dark:text-slate-100">{it.text}</span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Kolom bertumpuk beberapa seri (kategoris, urutan tetap): series [{ key, label, color }], data [{ key, label, values: { [seriesKey]: number }, partial?, lines? }].
 * Segmen dipisah celah 2px; legenda selalu tampil; sorot satu kolom untuk rincian tiap seri.
 */
export function StackedColumns({ data, series, height = 220, format = fmtInt, ariaLabel, unit = '' }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const m = { l: 46, r: 8, t: 12, b: 26 }
  const iw = Math.max(80, width - m.l - m.r)
  const ih = height - m.t - m.b
  const n = data.length
  const total = (d) => series.reduce((a, s) => a + (d.values[s.key] || 0), 0)
  const top = niceMax(Math.max(0, ...data.map(total)))
  const ticks = [0, 1, 2, 3, 4].map((i) => (top * i) / 4)
  const band = n > 0 ? iw / n : iw
  const bw = Math.max(2, Math.min(band - 2, 22))
  const every = Math.max(1, Math.ceil(46 / Math.max(band, 1)))
  const y = (v) => m.t + ih - (v / top) * ih
  if (n === 0) return <p className="py-8 text-center text-sm text-slate-500">Belum ada data pada rentang ini.</p>
  return (
    <div ref={ref} className="viz-root relative w-full" onMouseLeave={() => setHover(null)}>
      <VizStyles />
      <div className="mb-1 flex flex-wrap items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
        {series.map((s) => <span key={s.key} className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: s.color }} />{s.label}</span>)}
      </div>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--viz-muted)">{format(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx = m.l + band * i + band / 2
          let acc = 0
          const dim = hover && hover.i !== i ? 0.55 : 1
          return (
            <g key={d.key}>
              {series.map((s, si) => {
                const v = d.values[s.key] || 0
                const y0 = y(acc)
                const y1 = y(acc + v)
                acc += v
                const h = Math.max(0, y0 - y1 - (v > 0 && si > 0 ? 2 : 0))
                const last = si === series.length - 1 || series.slice(si + 1).every((x) => !(d.values[x.key] > 0))
                if (v <= 0 || h <= 0) return null
                return last
                  ? <path key={s.key} d={barPath(cx - bw / 2, y1, bw, h, 4)} fill={s.color} fillOpacity={d.partial ? 0.35 : dim} />
                  : <rect key={s.key} x={cx - bw / 2} y={y1} width={bw} height={h} fill={s.color} fillOpacity={d.partial ? 0.35 : dim} />
              })}
              {i % every === 0 && <text x={cx} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--viz-muted)">{d.label}</text>}
              <rect x={m.l + band * i} y={m.t} width={band} height={ih} fill="transparent" tabIndex={0} aria-label={`${d.label}: ${series.map((s) => `${s.label} ${format(d.values[s.key] || 0)}`).join(', ')}${unit ? ` ${unit}` : ''}`}
                onMouseMove={() => setHover({ i, x: Math.min(cx + 10, width - 180), y: m.t })} onFocus={() => setHover({ i, x: Math.min(cx + 10, width - 180), y: m.t })} onBlur={() => setHover(null)} />
            </g>
          )
        })}
      </svg>
      <Tooltip box={hover}>
        {hover && (
          <div className="space-y-0.5">
            <div className="font-semibold text-slate-900 dark:text-slate-100">{data[hover.i].label}{data[hover.i].partial ? ' (belum lengkap)' : ''}</div>
            {series.map((s) => <div key={s.key} className="text-slate-700 dark:text-slate-300"><span aria-hidden className="mr-1.5 inline-block h-2 w-2 rounded-sm" style={{ background: s.color }} />{s.label}: {format(data[hover.i].values[s.key] || 0)}{unit ? ` ${unit}` : ''}</div>)}
            <div className="text-slate-500 dark:text-slate-400">Total: {format(total(data[hover.i]))}{unit ? ` ${unit}` : ''}</div>
            {(data[hover.i].lines || []).map((l) => <div key={l} className="text-slate-500 dark:text-slate-400">{l}</div>)}
          </div>
        )}
      </Tooltip>
    </div>
  )
}

/**
 * Garis riwayat dan prakiraan dengan pita p10-p90: history [{ month, value }], forecast [{ month, p10, p50, p90 }]. Riwayat garis penuh, prakiraan putus-putus dengan pita;
 * sorot satu bulan untuk nilainya. Satu sumbu.
 */
export function ForecastLine({ history, forecast, height = 220, format = fmtInt, ariaLabel, unit = '' }) {
  const [ref, width] = useWidth()
  const [hover, setHover] = useState(null)
  const m = { l: 52, r: 10, t: 12, b: 26 }
  const iw = Math.max(80, width - m.l - m.r)
  const ih = height - m.t - m.b
  const pts = [...history.map((h) => ({ month: h.month, p50: h.value, hist: true })), ...forecast.map((f) => ({ month: f.month, p10: f.p10, p50: f.p50, p90: f.p90, hist: false }))]
  const n = pts.length
  if (n === 0) return <p className="py-8 text-center text-sm text-slate-500">Belum ada data.</p>
  const top = niceMax(Math.max(0, ...pts.map((p) => p.p90 ?? p.p50 ?? 0)))
  const ticks = [0, 1, 2, 3, 4].map((i) => (top * i) / 4)
  const step = n > 1 ? iw / (n - 1) : iw
  const x = (i) => m.l + step * i
  const y = (v) => m.t + ih - (v / top) * ih
  const histPts = pts.filter((p) => p.hist)
  const fPts = pts.map((p, i) => [p, i]).filter(([p]) => !p.hist)
  const startF = histPts.length - 1
  const line = (arr) => arr.map(([p, i], k) => `${k === 0 ? 'M' : 'L'}${x(i)},${y(p.p50)}`).join(' ')
  const band = fPts.length ? `${fPts.map(([p, i], k) => `${k === 0 ? 'M' : 'L'}${x(i)},${y(p.p90)}`).join(' ')} ${[...fPts].reverse().map(([p, i]) => `L${x(i)},${y(p.p10)}`).join(' ')} Z` : ''
  const every = Math.max(1, Math.ceil(52 / Math.max(step, 1)))
  return (
    <div ref={ref} className="viz-root relative w-full" onMouseLeave={() => setHover(null)}>
      <VizStyles />
      <div className="mb-1 flex items-center gap-4 text-xs text-slate-600 dark:text-slate-300">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-0.5 w-4" style={{ background: 'var(--viz-s1)' }} />Riwayat</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-0.5 w-4 border-t-2 border-dashed" style={{ borderColor: 'var(--viz-s2)' }} />Prakiraan (p50)</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden className="inline-block h-2.5 w-3 rounded-sm" style={{ background: 'var(--viz-s2)', opacity: 0.2 }} />Rentang p10-p90</span>
      </div>
      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--viz-muted)">{format(t)}</text>
          </g>
        ))}
        {band && <path d={band} fill="var(--viz-s2)" fillOpacity={0.2} />}
        <path d={line(histPts.map((p, k) => [p, k]))} fill="none" stroke="var(--viz-s1)" strokeWidth={2} strokeLinejoin="round" />
        {fPts.length > 0 && <path d={line([[pts[startF], startF], ...fPts])} fill="none" stroke="var(--viz-s2)" strokeWidth={2} strokeDasharray="5 3" strokeLinejoin="round" />}
        {hover && <line x1={x(hover.i)} x2={x(hover.i)} y1={m.t} y2={m.t + ih} stroke="var(--viz-text2)" strokeWidth={1} />}
        {hover && <circle cx={x(hover.i)} cy={y(pts[hover.i].p50)} r={4} fill={pts[hover.i].hist ? 'var(--viz-s1)' : 'var(--viz-s2)'} stroke="var(--viz-surface)" strokeWidth={2} />}
        {pts.map((p, i) => i % every === 0 && <text key={p.month} x={x(i)} y={height - 8} textAnchor="middle" fontSize="11" fill="var(--viz-muted)">{monthLabel(p.month)}</text>)}
        {pts.map((p, i) => (
          <rect key={p.month} x={x(i) - step / 2} y={m.t} width={Math.max(step, 4)} height={ih} fill="transparent" tabIndex={0} aria-label={`${monthLabel(p.month)}: ${format(p.p50)}${unit ? ` ${unit}` : ''}`}
            onMouseMove={() => setHover({ i, x: Math.min(x(i) + 10, width - 170), y: m.t })} onFocus={() => setHover({ i, x: Math.min(x(i) + 10, width - 170), y: m.t })} onBlur={() => setHover(null)} />
        ))}
      </svg>
      <Tooltip box={hover}>
        {hover && (
          <div className="space-y-0.5">
            <div className="font-semibold text-slate-900 dark:text-slate-100">{monthLong(pts[hover.i].month)}{pts[hover.i].hist ? '' : ' (prakiraan)'}</div>
            <div className="text-slate-700 dark:text-slate-300">{pts[hover.i].hist ? 'Aktual' : 'p50'}: {format(pts[hover.i].p50)}{unit ? ` ${unit}` : ''}</div>
            {!pts[hover.i].hist && <div className="text-slate-500 dark:text-slate-400">Rentang {format(pts[hover.i].p10)} sampai {format(pts[hover.i].p90)}</div>}
          </div>
        )}
      </Tooltip>
    </div>
  )
}

const YEAR_PALETTE = [
  '#2563eb', // Blue-600 (Warna primer DISTRIVA untuk tahun terkini)
  '#ea580c', // Orange-600
  '#059669', // Emerald-600
  '#7c3aed', // Purple-600
  '#e11d48', // Rose-600
  '#0891b2', // Cyan-600
  '#d97706', // Amber-600
  '#4f46e5', // Indigo-600
  '#0d9488', // Teal-600
  '#64748b', // Slate-500
]

/**
 * Grafik perbandingan tahunan (Year-over-Year / YoY) dengan sumbu X tetap rentang 1 tahun (12 bulan: Jan - Des).
 * Seri data dibedakan per tahun dengan warna legenda masing-masing.
 * Mendukung mode Garis (Line) dan Batang Berkelompok (Grouped Bar), toggle visibilitas tahun interaktif,
 * serta tooltip komparatif antar tahun.
 */
export function YearlyComparisonChart({
  data = [],
  valueKey = 'value',
  getValue = null,
  height = 240,
  format = fmtInt,
  ariaLabel = 'Perbandingan tahunan 12 bulan',
  unit = '',
  initialMode = 'line',
  showModeSwitch = true,
  className = '',
}) {
  const [ref, width] = useWidth()
  const [mode, setMode] = useState(initialMode)
  const [hiddenYears, setHiddenYears] = useState(new Set())
  const [hover, setHover] = useState(null)

  // 1. Ekstrak dan kelompokkan data bulanan per tahun (1..12)
  const yearMap = useMemo(() => {
    const map = {}
    data.forEach((d) => {
      if (!d.month) return
      const [yStr, mStr] = String(d.month).split('-')
      const y = Number(yStr)
      const m = Number(mStr)
      if (!y || !m || m < 1 || m > 12) return
      if (!map[y]) map[y] = {}
      const val = getValue ? getValue(d) : (d[valueKey] !== undefined ? d[valueKey] : d.value)
      map[y][m] = {
        value: typeof val === 'number' ? val : Number(val) || 0,
        partial: Boolean(d.partial),
        raw: d,
      }
    })
    return map
  }, [data, valueKey, getValue])

  const allYears = useMemo(() => Object.keys(yearMap).map(Number).sort((a, b) => a - b), [yearMap])
  const activeYears = useMemo(() => allYears.filter((y) => !hiddenYears.has(y)), [allYears, hiddenYears])

  // Pemetaan warna tahun: tahun terbaru mendapat warna primer (#2563eb), tahun sebelumnya warna kontras lain
  const yearColorMap = useMemo(() => {
    const desc = [...allYears].sort((a, b) => b - a)
    const map = {}
    desc.forEach((y, idx) => {
      map[y] = YEAR_PALETTE[idx % YEAR_PALETTE.length]
    })
    return map
  }, [allYears])

  const toggleYear = (yr) => {
    setHiddenYears((prev) => {
      const next = new Set(prev)
      if (next.has(yr)) {
        next.delete(yr)
      } else {
        if (allYears.length - next.size > 1) {
          next.add(yr)
        }
      }
      return next
    })
  }

  const resetYears = () => setHiddenYears(new Set())

  // Dimensi gambar SVG
  const m = { l: 48, r: 12, t: 14, b: 28 }
  const iw = Math.max(80, width - m.l - m.r)
  const ih = Math.max(40, height - m.t - m.b)
  const band = iw / 12
  const cx = (mIdx) => m.l + band * mIdx + band / 2

  // Nilai maksimum untuk skala sumbu Y
  let maxVal = 0
  activeYears.forEach((y) => {
    for (let mNum = 1; mNum <= 12; mNum++) {
      const v = yearMap[y]?.[mNum]?.value
      if (v !== undefined && v > maxVal) maxVal = v
    }
  })
  const top = niceMax(maxVal)
  const ticks = [0, 1, 2, 3, 4].map((i) => (top * i) / 4)
  const y = (v) => m.t + ih - (v / top) * ih

  if (allYears.length === 0) {
    return <p className="py-8 text-center text-sm text-slate-500">Belum ada data pada rentang ini.</p>
  }

  return (
    <div ref={ref} className={`viz-root relative w-full ${className}`} onMouseLeave={() => setHover(null)}>
      <VizStyles />

      {/* Header Legenda Tahun & Pilihan Mode Tampilan */}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          {allYears.map((yr) => {
            const isHidden = hiddenYears.has(yr)
            const color = yearColorMap[yr]
            return (
              <button
                key={yr}
                type="button"
                onClick={() => toggleYear(yr)}
                className={`inline-flex items-center gap-1.5 px-2 py-0.5 text-xs rounded-full border transition cursor-pointer select-none ${
                  isHidden
                    ? 'opacity-40 border-slate-200 dark:border-slate-800 line-through bg-slate-50 dark:bg-slate-800/40 text-slate-400'
                    : 'border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 font-medium hover:border-slate-300'
                }`}
                title={`Klik untuk menyembunyikan/menampilkan tahun ${yr}`}
              >
                <span className="inline-block h-2.5 w-2.5 rounded-full shrink-0" style={{ background: color }} />
                <span>{yr}</span>
              </button>
            )
          })}
          {hiddenYears.size > 0 && (
            <button
              type="button"
              onClick={resetYears}
              className="text-[11px] text-blue-600 hover:underline dark:text-blue-400 ml-1 cursor-pointer"
            >
              Tampilkan semua
            </button>
          )}
        </div>

        {showModeSwitch && (
          <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg text-[11px]">
            <button
              type="button"
              onClick={() => setMode('line')}
              className={`px-2 py-0.5 rounded font-medium transition cursor-pointer ${
                mode === 'line'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Garis
            </button>
            <button
              type="button"
              onClick={() => setMode('bar')}
              className={`px-2 py-0.5 rounded font-medium transition cursor-pointer ${
                mode === 'bar'
                  ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100 shadow-xs'
                  : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              Batang
            </button>
          </div>
        )}
      </div>

      <svg width={width} height={height} role="img" aria-label={ariaLabel}>
        {/* Garis Grid Horizontal & Angka Sumbu Y */}
        {ticks.map((t) => (
          <g key={t}>
            <line x1={m.l} x2={m.l + iw} y1={y(t)} y2={y(t)} stroke={t === 0 ? 'var(--viz-axis)' : 'var(--viz-grid)'} strokeWidth={1} />
            <text x={m.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--viz-muted)">{format(t)}</text>
          </g>
        ))}

        {/* Highlight Kolom Bulan Saat Hover */}
        {hover && (
          <rect
            x={m.l + band * hover.mIdx}
            y={m.t}
            width={band}
            height={ih}
            fill="var(--viz-grid)"
            fillOpacity={0.35}
            pointerEvents="none"
          />
        )}

        {/* ── Mode 1: Garis Tren (Line Chart) ── */}
        {mode === 'line' && activeYears.map((yr) => {
          const color = yearColorMap[yr]
          const isLatest = yr === Math.max(...allYears)

          // Kumpulkan titik-titik bulan yang memiliki data
          const pts = []
          for (let mIdx = 0; mIdx < 12; mIdx++) {
            const item = yearMap[yr]?.[mIdx + 1]
            if (item !== undefined) {
              pts.push({ mIdx, x: cx(mIdx), y: y(item.value), value: item.value, partial: item.partial })
            }
          }
          if (pts.length === 0) return null

          const pathD = pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x},${p.y}`).join(' ')

          return (
            <g key={yr}>
              <path
                d={pathD}
                fill="none"
                stroke={color}
                strokeWidth={isLatest ? 2.5 : 1.75}
                strokeLinejoin="round"
                strokeLinecap="round"
                opacity={hover && !hover.entries.some((e) => e.year === yr) ? 0.35 : 1}
              />
              {pts.map((p) => (
                <circle
                  key={p.mIdx}
                  cx={p.x}
                  cy={p.y}
                  r={hover?.mIdx === p.mIdx ? 4.5 : isLatest ? 3.5 : 2.5}
                  fill={p.partial ? 'var(--viz-surface)' : color}
                  stroke={color}
                  strokeWidth={p.partial ? 2 : 1}
                  strokeDasharray={p.partial ? '2 1' : undefined}
                />
              ))}
            </g>
          )
        })}

        {/* ── Mode 2: Batang Berkelompok (Grouped Bar) ── */}
        {mode === 'bar' && Array.from({ length: 12 }, (_, mIdx) => {
          const presentYears = activeYears.filter((yr) => yearMap[yr]?.[mIdx + 1] !== undefined)
          const k = presentYears.length
          if (k === 0) return null

          const totalBarSpace = Math.min(band - 4, Math.max(k * 4, k * 14))
          const bw = Math.max(2, Math.floor(totalBarSpace / k) - 1)
          const startX = cx(mIdx) - totalBarSpace / 2

          return (
            <g key={mIdx}>
              {presentYears.map((yr, yi) => {
                const item = yearMap[yr][mIdx + 1]
                const color = yearColorMap[yr]
                const val = item.value
                const bh = Math.max(0, (val / top) * ih)
                const bx = startX + yi * (bw + 1)
                const isHoverMonth = hover?.mIdx === mIdx

                return (
                  <path
                    key={yr}
                    d={barPath(bx, y(val), bw, bh, 3)}
                    fill={color}
                    fillOpacity={item.partial ? 0.35 : isHoverMonth ? 1 : hover ? 0.6 : 0.9}
                    stroke={item.partial ? color : undefined}
                    strokeWidth={item.partial ? 1 : undefined}
                    strokeDasharray={item.partial ? '2 2' : undefined}
                  />
                )
              })}
            </g>
          )
        })}

        {/* Label Sumbu X: 12 Bulan (Jan - Des) */}
        {Array.from({ length: 12 }, (_, mIdx) => (
          <text
            key={mIdx}
            x={cx(mIdx)}
            y={height - 8}
            textAnchor="middle"
            fontSize="11"
            fontWeight={hover?.mIdx === mIdx ? '600' : 'normal'}
            fill={hover?.mIdx === mIdx ? 'var(--viz-text)' : 'var(--viz-muted)'}
          >
            {MONTHS[mIdx]}
          </text>
        ))}

        {/* Area Interaktif Tangkapan Mouse per Bulan */}
        {Array.from({ length: 12 }, (_, mIdx) => {
          const mNum = mIdx + 1
          const entries = activeYears
            .filter((yr) => yearMap[yr]?.[mNum] !== undefined)
            .map((yr) => ({
              year: yr,
              value: yearMap[yr][mNum].value,
              partial: yearMap[yr][mNum].partial,
              color: yearColorMap[yr],
            }))
            .sort((a, b) => b.year - a.year)

          let delta = null
          let latestYear = null
          let prevYear = null
          if (entries.length >= 2) {
            latestYear = entries[0].year
            prevYear = entries[1].year
            const currVal = entries[0].value
            const prevVal = entries[1].value
            if (prevVal > 0) {
              delta = ((currVal - prevVal) / prevVal) * 100
            }
          }

          return (
            <rect
              key={mIdx}
              x={m.l + band * mIdx}
              y={m.t}
              width={band}
              height={ih}
              fill="transparent"
              tabIndex={0}
              aria-label={`Bulan ${MONTHS[mIdx]}: ${entries.map((e) => `${e.year} ${format(e.value)}`).join(', ')}`}
              onMouseMove={() =>
                setHover({
                  mIdx,
                  x: Math.min(cx(mIdx) + 12, width - 180),
                  y: m.t,
                  entries,
                  delta,
                  latestYear,
                  prevYear,
                })
              }
              onFocus={() =>
                setHover({
                  mIdx,
                  x: Math.min(cx(mIdx) + 12, width - 180),
                  y: m.t,
                  entries,
                  delta,
                  latestYear,
                  prevYear,
                })
              }
              onBlur={() => setHover(null)}
            />
          )
        })}
      </svg>

      {/* Tooltip Interaktif Sumbu 12 Bulan */}
      <Tooltip box={hover}>
        {hover && (
          <div className="space-y-1 min-w-[145px]">
            <div className="font-bold text-xs text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-1">
              Bulan {MONTHS[hover.mIdx]}
            </div>
            {hover.entries.length === 0 ? (
              <div className="text-xs text-slate-400">Tidak ada data</div>
            ) : (
              <div className="space-y-1 pt-0.5">
                {hover.entries.map((ent) => (
                  <div key={ent.year} className="flex items-center justify-between gap-3 text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-300">
                      <span className="inline-block h-2 w-2 rounded-full shrink-0" style={{ background: ent.color }} />
                      {ent.year}{ent.partial ? ' *' : ''}:
                    </span>
                    <span className="font-mono tabular-nums text-slate-900 dark:text-slate-100 font-semibold">
                      {format(ent.value)}{unit ? ` ${unit}` : ''}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {hover.delta !== null && (
              <div className="pt-1 border-t border-slate-100 dark:border-slate-800 text-[10px] text-slate-500 flex items-center justify-between gap-2">
                <span>YoY ({hover.latestYear} vs {hover.prevYear}):</span>
                <span className={hover.delta > 0 ? 'text-rose-600 dark:text-rose-400 font-bold' : hover.delta < 0 ? 'text-emerald-600 dark:text-emerald-400 font-bold' : 'font-medium'}>
                  {hover.delta > 0 ? `+${fmtNum(hover.delta, 1)}% ▲` : hover.delta < 0 ? `${fmtNum(hover.delta, 1)}% ▼` : '0%'}
                </span>
              </div>
            )}
            {hover.entries.some((e) => e.partial) && (
              <div className="text-[10px] text-slate-400 italic pt-0.5">* Bulan berjalan (data belum lengkap)</div>
            )}
          </div>
        )}
      </Tooltip>
    </div>
  )
}


