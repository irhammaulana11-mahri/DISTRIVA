export default function Pagination({
  meta,
  page,
  total: totalProp,
  perPage = 10,
  onPage,
  onChange,
  onPerPage,
  perPageOptions = [10, 25, 50, 100],
  showSummary = true,                                   // false di dalam TableFooter: ringkasan "Menampilkan X dari Y" sudah ada di kirinya
}) {
  const pageHandler = onPage || onChange
  const total = Number(totalProp ?? meta?.total ?? 0)
  const perPageVal = Number(perPage || meta?.per_page || 10)
  const currentPage = Number(page || meta?.current_page || 1)
  const lastPage = Number(meta?.last_page || Math.max(1, Math.ceil(total / (perPageVal || 10))))

  if (!meta && totalProp === undefined) return null

  const from = total === 0 ? 0 : meta?.from ?? ((currentPage - 1) * perPageVal + 1)
  const to = total === 0 ? 0 : meta?.to ?? Math.min(currentPage * perPageVal, total)

  // Ensure perPageVal is always present in perPageOptions so <select> is never out of sync
  const effectiveOptions = Array.from(new Set([...perPageOptions, perPageVal])).sort((a, b) => a - b)

  return (
    <nav
      aria-label="Halaman"
      className={`flex flex-col sm:flex-row sm:items-center gap-3 text-xs text-slate-500 dark:text-slate-400 py-1 ${showSummary ? 'sm:justify-between' : 'sm:justify-end'}`}
    >
      {/* Ringkasan di kiri (dilewati di TableFooter, yang sudah menampilkannya); teks halaman untuk pembaca layar tetap ada */}
      {showSummary ? (
        <div className="flex items-center gap-1.5 font-medium text-slate-600 dark:text-slate-400">
          <span>Menampilkan {from}–{to} dari {total}</span>
          <span className="sr-only">Halaman {currentPage} dari {lastPage} · {total} data</span>
        </div>
      ) : (
        <span className="sr-only">Halaman {currentPage} dari {lastPage} · {total} data</span>
      )}

      {/* Right side: Per page, Prev, Hal X/Y, Next */}
      <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
        {Boolean(onPerPage) && (
          <div className="flex items-center gap-1.5">
            <span className="text-slate-400 dark:text-slate-500 text-[11px]">Per halaman</span>
            <select
              value={perPageVal}
              onChange={(e) => onPerPage(Number(e.target.value))}
              aria-label="Jumlah per halaman"
              role="none"
              className="rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-1 text-xs text-slate-700 dark:text-slate-200 shadow-2xs focus-ring cursor-pointer"
            >
              {effectiveOptions.map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={currentPage <= 1 || !pageHandler}
            onClick={() => pageHandler && pageHandler(currentPage - 1)}
            className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
          >
            Sebelumnya
          </button>

          <span className="px-2 font-medium text-slate-700 dark:text-slate-200 text-xs">
            Hal. {currentPage}/{lastPage}
          </span>

          <button
            type="button"
            disabled={currentPage >= lastPage || !pageHandler}
            onClick={() => pageHandler && pageHandler(currentPage + 1)}
            className="rounded-lg px-2.5 py-1 text-xs font-medium text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 disabled:opacity-30 disabled:pointer-events-none transition cursor-pointer"
          >
            Berikutnya
          </button>
        </div>
      </div>
    </nav>
  )
}
