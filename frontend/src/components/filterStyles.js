/**
 * Gaya baku kontrol di bilah filter dan pencarian semua halaman (tinggi h-9, teks xs, sudut rounded-lg).
 * Dipakai untuk kolom pencarian, dropdown, dan isian tanggal/bulan/angka pada filter; isian di dalam formulir/modal memakai gaya form masing-masing.
 */
export const filterControlCls =
  'h-9 px-2.5 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-800/50 text-slate-700 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:bg-white dark:focus:bg-slate-800 focus:border-emerald-500 dark:focus:border-emerald-500 focus:ring-2 focus:ring-emerald-500/20 transition-all outline-none'

/** Dropdown filter (kursor tangan). */
export const filterSelectCls = `${filterControlCls} cursor-pointer`

/** Kolom pencarian dengan ikon kaca pembesar di kiri (ikon diposisikan absolut; `pl-8` memberi ruang). */
export const filterSearchCls = `${filterControlCls} pl-8`
