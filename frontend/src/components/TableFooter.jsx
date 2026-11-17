import { useState, useMemo } from 'react'
import Pagination from './Pagination.jsx'

/**
 * Custom hook for client-side table pagination with standardized 10-25-50-100 options.
 */
export function useTablePagination(items = [], initialPerPage = 25) {
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(initialPerPage)

  const list = Array.isArray(items) ? items : []
  const total = list.length
  const lastPage = Math.max(1, Math.ceil(total / (perPage || 10)))
  const safePage = Math.max(1, Math.min(page, lastPage))

  const paginatedItems = useMemo(() => {
    const start = (safePage - 1) * perPage
    return list.slice(start, start + perPage)
  }, [list, safePage, perPage])

  const tableFooterProps = {
    itemCount: paginatedItems.length,
    total,
    page: safePage,
    perPage,
    onPage: setPage,
    onPerPage: (n) => {
      setPerPage(n)
      setPage(1)
    },
    perPageOptions: [10, 25, 50, 100],
  }

  return {
    page: safePage,
    setPage,
    perPage,
    setPerPage,
    paginatedItems,
    tableFooterProps,
  }
}

/**
 * Standardized Table Footer matching DISTRIVA Design System
 *
 * Left side: "Menampilkan X dari Y [label]"
 * Right side: Pagination (per page dropdown 10-25-50-100, Prev, Hal X/Y, Next); the summary is shown once, on the left
 */
export default function TableFooter({
  itemCount,
  total,
  entityLabel = 'data',
  page = 1,
  perPage = 25,
  onPage,
  onPerPage,
  perPageOptions = [10, 25, 50, 100],
  meta,
}) {
  const currentTotal = Number(total ?? meta?.total ?? 0)
  const currentPage = Number(page || meta?.current_page || 1)
  const currentPerPage = Number(perPage || meta?.per_page || 25)
  const calculatedMeta = meta || {
    current_page: currentPage,
    per_page: currentPerPage,
    total: currentTotal,
    last_page: Math.max(1, Math.ceil(currentTotal / (currentPerPage || 25))),
  }

  const visibleCount =
    itemCount !== undefined
      ? Number(itemCount)
      : calculatedMeta.total === 0
      ? 0
      : Math.min(currentPerPage, currentTotal)

  const hasPagination = Boolean(onPage || onPerPage || meta)

  return (
    <div className="p-4 sm:p-5 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500 dark:text-slate-400">
      <span>
        Menampilkan {visibleCount} dari {calculatedMeta.total} {entityLabel}
      </span>
      {hasPagination && (
        <Pagination
          meta={calculatedMeta}
          page={currentPage}
          perPage={currentPerPage}
          onPage={onPage}
          onPerPage={onPerPage}
          perPageOptions={perPageOptions}
          showSummary={false}
        />
      )}
    </div>
  )
}
