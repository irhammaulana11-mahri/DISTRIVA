import Button from '../../components/Button.jsx'
import { IconShieldCheck } from '../../components/icons.jsx'

export const SYNC_CARD =
  'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs'

/**
 * Kerangka layout standar 4-blok untuk seluruh tab di Pusat Sinkronisasi Data:
 * 1) 4 Kartu Ringkasan KPI
 * 2) Strip Koneksi & Tombol Pengaturan/Aksi Cepat
 * 3) Kartu Aksi Penarikan Data (+ progres berjalan)
 * 4) Kartu Riwayat / Hasil / Matriks
 */
export default function SyncTabLayout({ stats = [], banner = null, alerts = null, children }) {
  return (
    <div className={`${SYNC_CARD} p-4 sm:p-6 space-y-6 text-xs`}>
      {stats.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {stats.map((st, idx) => (
            <div
              key={st.key || st.label || idx}
              className="bg-white dark:bg-slate-900 p-3.5 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-xs"
            >
              <div className="text-[10px] text-slate-400 font-semibold uppercase truncate">{st.label}</div>
              <div className="text-sm font-bold text-slate-800 dark:text-slate-200 mt-1 truncate">{st.value}</div>
              {st.sub && <div className="text-[11px] text-slate-500 mt-0.5 truncate">{st.sub}</div>}
              {st.extra}
            </div>
          ))}
        </div>
      )}

      {banner && (
        <div className="flex flex-wrap items-center justify-between gap-3 p-4 bg-blue-50/70 dark:bg-blue-950/30 rounded-2xl border border-blue-200 dark:border-blue-900/60 shadow-xs">
          <div className="flex items-start gap-3">
            {banner.icon || <IconShieldCheck size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />}
            <div className="space-y-0.5">
              <div className="font-bold text-sm text-blue-950 dark:text-blue-100 flex items-center gap-2 flex-wrap">
                <span>{banner.title}</span>
                {banner.badge && (
                  <span
                    className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                      banner.badgeTone === 'warn'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                    }`}
                  >
                    {banner.badge}
                  </span>
                )}
              </div>
              {banner.desc && (
                <p className="text-[11px] text-blue-700 dark:text-blue-300 max-w-3xl">{banner.desc}</p>
              )}
            </div>
          </div>
          {(banner.actions || banner.onAction) && (
            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {banner.actions}
              {banner.onAction && (
                <Button
                  type="button"
                  variant={banner.actionVariant || 'secondary'}
                  size="sm"
                  icon={banner.actionIcon}
                  loading={banner.actionLoading}
                  disabled={banner.actionDisabled}
                  onClick={banner.onAction}
                  className="cursor-pointer"
                >
                  {banner.actionLabel || 'Pengaturan'}
                </Button>
              )}
            </div>
          )}
        </div>
      )}

      {alerts}

      {children}
    </div>
  )
}
