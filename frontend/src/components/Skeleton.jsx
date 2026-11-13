// Lightweight, accessible skeleton placeholder for tables and cards.
// Avoids Cumulative Layout Shift (CLS) and provides immediate perceived feedback.

export function TableSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div role="status" aria-label="Memuat data..." className="w-full space-y-3 py-2 animate-pulse">
      <div className="h-8 w-full rounded bg-slate-100" />
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex items-center gap-4 py-2 border-b border-slate-100">
          {Array.from({ length: cols }).map((_, c) => (
            <div
              key={c}
              className={`h-4 rounded bg-slate-200/70 ${c === 0 ? 'w-1/4' : c === 1 ? 'w-1/3' : 'w-1/6'}`}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export function CardSkeleton() {
  return (
    <div role="status" aria-label="Memuat..." className="rounded-lg border border-slate-200 bg-white p-5 animate-pulse space-y-4">
      <div className="h-5 w-1/3 rounded bg-slate-200" />
      <div className="h-4 w-2/3 rounded bg-slate-100" />
      <div className="h-20 w-full rounded bg-slate-50" />
    </div>
  )
}
