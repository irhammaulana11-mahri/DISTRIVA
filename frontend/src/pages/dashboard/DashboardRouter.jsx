import { useMemo, useState } from 'react'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { resolveProfiles, PROFILE_LABEL } from '../../features/dashboard/profiles.js'
import HomePage from '../HomePage.jsx'
import RoleDashboard from './RoleDashboard.jsx'
import Spinner from '../../components/Spinner.jsx'

/** Halaman "/": dasbor sesuai peran. Admin sistem (dan pengguna tanpa peran operasional) memakai Beranda umum. */
export default function DashboardRouter() {
  const { can, isSysAdmin, loading } = useAccess()
  const profiles = useMemo(() => resolveProfiles({ can, isSysAdmin }), [can, isSysAdmin])
  const [selected, setSelected] = useState(null)

  if (loading) {
    return (
      <div className="py-16 text-center">
        <Spinner label="Memuat dasbor…" />
      </div>
    )
  }

  const active = profiles.includes(selected) ? selected : profiles[0]

  return (
    <div className="space-y-4">
      {profiles.length > 1 && (
        <div role="tablist" aria-label="Pilih tampilan dasbor" className="flex flex-wrap gap-2">
          {profiles.map((p) => (
            <button
              key={p}
              type="button"
              role="tab"
              aria-selected={p === active}
              onClick={() => setSelected(p)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition ${
                p === active
                  ? 'bg-blue-600 text-white shadow-sm'
                  : 'bg-white dark:bg-slate-800 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 hover:bg-slate-50'
              }`}
            >
              {PROFILE_LABEL[p]}
            </button>
          ))}
        </div>
      )}
      {active === 'admin' || active === 'general' ? <HomePage /> : <RoleDashboard profile={active} />}
    </div>
  )
}
