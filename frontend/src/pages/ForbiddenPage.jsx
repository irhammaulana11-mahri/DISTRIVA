import { Link } from 'react-router-dom'
import { IconShield, IconArrowLeft } from '../components/icons.jsx'

export default function ForbiddenPage({ capability, anyOf }) {
  const requiredInfo = capability || (anyOf ? anyOf.join(', ') : null)

  return (
    <div className="min-h-[60vh] flex flex-col items-center justify-center text-center px-4 py-12">
      <div className="w-16 h-16 rounded-2xl bg-amber-100 dark:bg-amber-950/60 border border-amber-200 dark:border-amber-800/80 flex items-center justify-center text-amber-600 dark:text-amber-400 mb-5 shadow-xs">
        <IconShield size={32} />
      </div>

      <span className="text-xs font-bold uppercase tracking-wider text-amber-600 dark:text-amber-400 mb-1">
        Galat 403 · Akses Terbatas
      </span>

      <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-3xl">
        Hak Akses Tidak Mencukupi
      </h1>

      <p className="mt-3 max-w-md text-sm text-slate-600 dark:text-slate-400 leading-relaxed">
        Akun Anda saat ini tidak memiliki wewenang atau kapabilitas yang disyaratkan untuk membuka fitur ini.
      </p>

      {requiredInfo && (
        <div className="mt-4 px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-[11px] font-mono text-slate-500 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
          Izin yang dibutuhkan: <span className="text-slate-700 dark:text-slate-300 font-semibold">{requiredInfo}</span>
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <Link
          to="/"
          className="inline-flex items-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-semibold px-4 py-2 text-sm shadow-xs transition focus-ring cursor-pointer"
        >
          <IconArrowLeft size={16} />
          <span>Kembali ke Beranda</span>
        </Link>
      </div>
    </div>
  )
}
