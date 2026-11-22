import { useEffect, useRef, useState } from 'react'

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
