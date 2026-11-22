import Drawer from './Drawer.jsx'

/**
 * Cangkang satu panel kerja: laci (Drawer) untuk pratinjau, atau halaman penuh (`asPage`) untuk pekerjaan yang mengubah data.
 * Komponen yang memakainya menulis isi dan aksinya sekali; laci hanya dipakai bila isinya baca-saja, sedangkan form dan tombol simpan
 * dirender sebagai halaman lewat rute sendiri (keputusan pemilik 13 Nov 2026: laci hanya pratinjau, semua proses input/post di halaman).
 */
export default function PanelShell({ asPage = false, onClose, onBack, ...drawerProps }) {
  if (!asPage) return <Drawer onClose={onClose} {...drawerProps} />
  const isDrawerOpen = Boolean(drawerProps.open ?? drawerProps.isOpen ?? true)
  if (!isDrawerOpen) return null
  const { title, subtitle, eyebrow, children, footer } = drawerProps
  return (
    <div className="space-y-4">
      <div>
        {onBack && (
          <button type="button" onClick={onBack} className="text-xs text-blue-600 hover:underline cursor-pointer mb-2">← Kembali</button>
        )}
        {eyebrow && <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400 block mb-0.5">{eyebrow}</span>}
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight break-words">{title}</h1>
        {subtitle && <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 break-words">{subtitle}</p>}
      </div>
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
        <div className="p-4 sm:p-6 space-y-4 sm:space-y-6">{children}</div>
        {footer && (
          <div className="px-4 py-3 sm:px-6 sm:py-4 border-t border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 rounded-b-2xl flex flex-wrap items-center justify-end gap-2 sm:gap-2.5">{footer}</div>
        )}
      </div>
    </div>
  )
}
