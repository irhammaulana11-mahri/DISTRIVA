/**
 * Kartu statistik halaman Laporan: satu ukuran untuk semua tab (tinggi sama, label/angka/keterangan di tempat yang sama),
 * ditaruh tepat di bawah header halaman. `items`: [{ label, value, unit?, sub?, tone?, icon? }].
 */
const TONES = {
  slate: { box: 'border-slate-200 dark:border-slate-800', label: 'text-slate-500', value: 'text-slate-900 dark:text-slate-100', sub: 'text-slate-400', chip: 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300' },
  emerald: { box: 'border-emerald-200/80 dark:border-emerald-900/60 bg-emerald-50/10 dark:bg-emerald-950/10', label: 'text-emerald-700 dark:text-emerald-400', value: 'text-emerald-600 dark:text-emerald-400', sub: 'text-emerald-600/70 dark:text-emerald-500/70', chip: 'bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400' },
  blue: { box: 'border-blue-200/80 dark:border-blue-900/60 bg-blue-50/10 dark:bg-blue-950/10', label: 'text-blue-700 dark:text-blue-400', value: 'text-blue-600 dark:text-blue-400', sub: 'text-blue-600/70 dark:text-blue-500/70', chip: 'bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400' },
  amber: { box: 'border-amber-200/80 dark:border-amber-900/60 bg-amber-50/10 dark:bg-amber-950/10', label: 'text-amber-700 dark:text-amber-400', value: 'text-amber-600 dark:text-amber-400', sub: 'text-amber-600/70 dark:text-amber-500/70', chip: 'bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400' },
  rose: { box: 'border-rose-200/80 dark:border-rose-900/60 bg-rose-50/10 dark:bg-rose-950/10', label: 'text-rose-700 dark:text-rose-400', value: 'text-rose-600 dark:text-rose-400', sub: 'text-rose-600/70 dark:text-rose-500/70', chip: 'bg-rose-100 dark:bg-rose-950 text-rose-600 dark:text-rose-400' },
  purple: { box: 'border-purple-200/80 dark:border-purple-900/60 bg-purple-50/10 dark:bg-purple-950/10', label: 'text-purple-700 dark:text-purple-400', value: 'text-purple-600 dark:text-purple-400', sub: 'text-purple-600/70 dark:text-purple-500/70', chip: 'bg-purple-100 dark:bg-purple-950 text-purple-600 dark:text-purple-400' },
  indigo: { box: 'border-indigo-200/80 dark:border-indigo-900/60 bg-indigo-50/10 dark:bg-indigo-950/10', label: 'text-indigo-700 dark:text-indigo-400', value: 'text-indigo-600 dark:text-indigo-400', sub: 'text-indigo-600/70 dark:text-indigo-500/70', chip: 'bg-indigo-100 dark:bg-indigo-950 text-indigo-600 dark:text-indigo-400' },
}

// Kelas statis (Tailwind tidak membaca kelas yang dirangkai): jumlah kolom layar lebar menurut jumlah kartu.
const COLS = { 3: 'lg:grid-cols-3', 4: 'lg:grid-cols-4', 5: 'lg:grid-cols-5', 6: 'lg:grid-cols-6' }

export function StatCard({ label, value, unit, sub, tone = 'slate', icon: Icon }) {
  const t = TONES[tone] || TONES.slate
  return (
    <div className={`h-full min-h-[104px] p-4 bg-white dark:bg-slate-900 border rounded-2xl shadow-xs flex flex-col ${t.box}`}>
      <div className="flex items-start justify-between gap-2">
        <span className={`text-[11px] font-semibold uppercase tracking-wider leading-snug ${t.label}`}>{label}</span>
        {Icon && (
          <span className={`rounded-lg p-1.5 shrink-0 ${t.chip}`}>
            <Icon className="h-4 w-4" />
          </span>
        )}
      </div>
      <div className={`text-2xl font-bold mt-1.5 leading-tight ${t.value}`}>
        {value}
        {unit && <span className="ml-1.5 text-xs font-normal text-slate-500">{unit}</span>}
      </div>
      {sub && <p className={`text-[11px] mt-auto pt-1.5 ${t.sub}`}>{sub}</p>}
    </div>
  )
}

export default function StatGrid({ items = [] }) {
  if (items.length === 0) return null
  const cols = COLS[Math.min(Math.max(items.length, 3), 6)]
  return (
    <div data-testid="report-stat-cards" className={`grid grid-cols-2 sm:grid-cols-3 ${cols} gap-3 sm:gap-4`}>
      {items.map((it) => (
        <StatCard key={it.label} {...it} />
      ))}
    </div>
  )
}
