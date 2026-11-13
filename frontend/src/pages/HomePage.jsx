import { useState, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { useAuth } from '../features/auth/AuthContext.jsx'
import { useAccess } from '../features/admin/AccessContext.jsx'
import Card from '../components/Card.jsx'
import StatusBadge from '../components/StatusBadge.jsx'
import TableFooter from '../components/TableFooter.jsx'
import { MODULE_DOMAINS } from '../features/modules/moduleRegistry.js'
import {
  IconUsers,
  IconBuilding,
  IconShield,
  IconKey,
  IconChevronRight,
  IconLock,
  IconClipboard,
  IconMapPin,
  IconDocument,
  IconCalculator,
  IconTruck,
  IconChart,
} from '../components/icons.jsx'

// Business pipeline sequence mapping end-to-end electrical distribution work
const WORKFLOW_STEPS = [
  { step: 1, slug: 'aplikasi-pb-pd', to: '/permohonan', label: '1. PB / PD', desc: 'Registrasi Agenda', icon: IconClipboard },
  { step: 2, slug: 'survey-meter', to: '/permohonan', label: '2. Survey', desc: 'Pengukuran Lapangan', icon: IconMapPin },
  { step: 3, slug: 'drawing', to: '/permohonan', label: '3. Drawing', desc: 'Desain Gambar & SLD', icon: IconDocument },
  { step: 4, slug: 'auto-mto', to: '/permohonan', label: '4. Auto MTO', desc: 'Ekstraksi Material', icon: IconCalculator },
  { step: 5, slug: 'rab-kkf', to: '/permohonan', label: '5. RAB & KKF', desc: 'Kelayakan Finansial', icon: IconCalculator },
  { step: 6, slug: 'rkm', to: '/rkm', label: '6. RKM', desc: 'Rencana Kebutuhan Material', icon: IconBuilding },
  { step: 7, slug: 'work-order', to: '/work-orders', label: '7. SPK / WO', desc: 'Penugasan Pelaksana', icon: IconTruck },
  { step: 8, slug: 'bastp', to: '/work-orders', label: '8. BASTP', desc: 'Serah Terima Pekerjaan', icon: IconChart },
]

export default function HomePage() {
  const { user } = useAuth()
  const { can } = useAccess()
  const [selectedCategory, setSelectedCategory] = useState('Semua')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)

  const categories = useMemo(() => {
    const list = ['Semua', ...new Set(MODULE_DOMAINS.map((m) => m.category))]
    return list
  }, [])

  const filteredModules = useMemo(() => {
    if (selectedCategory === 'Semua') return MODULE_DOMAINS
    return MODULE_DOMAINS.filter((m) => m.category === selectedCategory)
  }, [selectedCategory])

  const pagedModules = useMemo(() => {
    const start = (page - 1) * perPage
    return filteredModules.slice(start, start + perPage)
  }, [filteredModules, page, perPage])

  const activeModulesCount = MODULE_DOMAINS.filter((m) => m.status === 'ACTIVE').length
  const pendingModulesCount = MODULE_DOMAINS.filter((m) => m.status === 'PENDING_BACKEND').length

  return (
    <div className="space-y-6">
      {/* Welcome Banner */}
      <section className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-xs">
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5">
              <span className="inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
              <h1 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 sm:text-2xl">
                Selamat datang, {user?.name}
              </h1>
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Modul bisnis akan muncul di sini setelah desain, otorisasi, dan persetujuan implementasinya tersedia.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {user?.account_status && <StatusBadge status={user.account_status} />}
            <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-3 py-1 font-mono text-xs text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
              {user?.email}
            </span>
          </div>
        </div>
      </section>

      {/* Workflow Stepper: End-to-End PLN Distribution Process */}
      <section className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-xs">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-sm font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
              Alur Proses Distribusi Tenaga Listrik (End-to-End Pipeline)
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Tahapan siklus pekerjaan penyambungan dari pendaftaran agenda hingga penerbitan BASTP:
            </p>
          </div>
          <span className="hidden sm:inline-block text-[11px] font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/50 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-800">
            Siklus Standar PLN
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8 pt-2">
          {WORKFLOW_STEPS.map((ws) => {
            const Icon = ws.icon
            return (
              <Link
                key={ws.step}
                to={ws.to || `/modul/${ws.slug}`}
                className="group relative flex flex-col items-center rounded-lg border border-slate-200/70 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 p-3 text-center transition hover:border-blue-300 dark:hover:border-blue-600 hover:bg-blue-50/40 dark:hover:bg-blue-950/30 hover:shadow-xs"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-full bg-white dark:bg-slate-800 text-blue-600 dark:text-blue-400 shadow-2xs group-hover:bg-blue-600 group-hover:text-white transition">
                  <Icon size={16} />
                </div>
                <div className="mt-2 text-xs font-bold text-slate-800 dark:text-slate-200 group-hover:text-blue-700 dark:group-hover:text-blue-400">
                  {ws.label}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 line-clamp-1">{ws.desc}</div>
              </Link>
            )
          })}
        </div>
      </section>

      {/* Operational Highlights / Quick Actions */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Link
          to="/profil"
          className="group rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Profil Akun</span>
            <span className="rounded-md bg-blue-50 dark:bg-blue-950/50 p-1.5 text-blue-600 dark:text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition">
              <IconChevronRight size={16} />
            </span>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Lihat Data & Sesi</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">NIP, email, dan status aktif</p>
        </Link>

        <Link
          to="/ubah-password"
          className="group rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm"
        >
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Keamanan</span>
            <span className="rounded-md bg-slate-100 dark:bg-slate-800 p-1.5 text-slate-600 dark:text-slate-300 group-hover:bg-blue-600 group-hover:text-white transition">
              <IconKey size={16} />
            </span>
          </div>
          <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Ubah Password</p>
          <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Rotasi kredensial berkala</p>
        </Link>

        {can['users.view'] ? (
          <Link
            to="/admin/users"
            className="group rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Administrasi</span>
              <span className="rounded-md bg-blue-50 dark:bg-blue-950/50 p-1.5 text-blue-600 dark:text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition">
                <IconUsers size={16} />
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Kelola Pengguna</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">User & role assignment</p>
          </Link>
        ) : (
          <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 p-4">
            <div className="flex items-center justify-between text-slate-400 dark:text-slate-500">
              <span className="text-xs font-semibold uppercase tracking-wider">Administrasi</span>
              <IconLock size={16} />
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-400">Pengguna</p>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Memerlukan hak akses admin</p>
          </div>
        )}

        {can['organizational_units.view'] ? (
          <Link
            to="/admin/units"
            className="group rounded-xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs transition hover:border-blue-300 dark:hover:border-blue-600 hover:shadow-sm"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">Hierarki Unit</span>
              <span className="rounded-md bg-blue-50 dark:bg-blue-950/50 p-1.5 text-blue-600 dark:text-blue-400 group-hover:bg-blue-600 group-hover:text-white transition">
                <IconBuilding size={16} />
              </span>
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">Unit Organisasi</p>
            <p className="mt-0.5 text-xs text-slate-500 dark:text-slate-400">Pusat, UID, UP3, ULP</p>
          </Link>
        ) : (
          <div className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 p-4">
            <div className="flex items-center justify-between text-slate-400 dark:text-slate-500">
              <span className="text-xs font-semibold uppercase tracking-wider">Hierarki Unit</span>
              <IconLock size={16} />
            </div>
            <p className="mt-2 text-sm font-semibold text-slate-600 dark:text-slate-400">Unit Organisasi</p>
            <p className="mt-0.5 text-xs text-slate-400 dark:text-slate-500">Memerlukan hak akses admin</p>
          </div>
        )}
      </div>

      {/* Domain Readiness Matrix (Tahap 5 Audit Matrix) */}
      <div className="rounded-2xl border border-slate-200/90 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
              AUDIT OPERASIONAL
            </span>
            <h2 className="text-xl font-bold tracking-tight text-slate-900 dark:text-slate-100 mt-0.5">
              Matriks Kesiapan Modul Platform DISTRIVA
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Status implementasi endpoint backend, otorisasi, dan kesiapan operasional per domain bisnis:
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
              {activeModulesCount} Modul Aktif
            </span>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 dark:bg-amber-950/40 px-3 py-1 text-xs font-semibold text-amber-700 dark:text-amber-300 border border-amber-200 dark:border-amber-800">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-500" />
              {pendingModulesCount} Menunggu Backend
            </span>
          </div>
        </div>

        {/* Category Filter Tabs */}
        <div className="px-5 py-3 bg-slate-50/40 dark:bg-slate-800/40 border-b border-slate-100 dark:border-slate-800 flex flex-wrap items-center gap-1.5">
          {categories.map((cat) => (
            <button
              key={cat}
              type="button"
              onClick={() => {
                setSelectedCategory(cat)
                setPage(1)
              }}
              className={`rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                selectedCategory === cat
                  ? 'bg-emerald-600 text-white shadow-2xs'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-200/60 dark:hover:bg-slate-700/60'
              }`}
            >
              {cat}
            </button>
          ))}
        </div>

        <div className="overflow-x-auto">
          <table className="min-w-full text-left text-sm data-table">
            <thead>
              <tr className="border-b border-slate-100 dark:border-slate-800">
                <th className="py-3 px-6 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-transparent">
                  AREA / MODUL ↑
                </th>
                <th className="py-3 px-6 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-transparent">
                  KATEGORI
                </th>
                <th className="py-3 px-6 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-transparent">
                  STATUS INTEGRASI ↕
                </th>
                <th className="py-3 px-6 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-transparent">
                  KESIAPAN API BACKEND
                </th>
                <th className="py-3 px-6 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-transparent">
                  ATURAN AKSES
                </th>
                <th className="py-3 px-6 text-[11px] font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider bg-transparent text-right">
                  AKSI
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {pagedModules.map((mod) => (
                <tr key={mod.slug} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors">
                  <td className="py-3.5 px-6">
                    <div className="font-bold text-slate-900 dark:text-slate-100">{mod.name}</div>
                    <div className="text-xs text-slate-500 dark:text-slate-400 line-clamp-1 mt-0.5">{mod.description}</div>
                  </td>
                  <td className="py-3.5 px-6 text-xs font-medium text-slate-600 dark:text-slate-300">
                    <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 border border-slate-200 dark:border-slate-700">
                      {mod.category}
                    </span>
                  </td>
                  <td className="py-3.5 px-6">
                    <StatusBadge status={mod.status} />
                  </td>
                  <td className="py-3.5 px-6 text-xs text-slate-600 dark:text-slate-300 max-w-xs truncate font-mono">
                    {mod.backendStatus}
                  </td>
                  <td className="py-3.5 px-6 text-xs font-mono text-slate-600 dark:text-slate-400">
                    {mod.slug === 'admin' ? 'users.view / units.view' : 'SAME_UNIT (fail-closed)'}
                  </td>
                  <td className="py-3.5 px-6 text-right">
                    {mod.slug === 'admin' ? (
                      <Link
                        to="/admin/users"
                        aria-label="Buka administrasi"
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-2xs"
                      >
                        Buka <IconChevronRight size={14} />
                      </Link>
                    ) : mod.slug === 'master-data' ? (
                      <Link
                        to="/master-data/materials"
                        aria-label="Buka master data"
                        className="inline-flex items-center gap-1 rounded-lg border border-emerald-300 dark:border-emerald-700 bg-emerald-50 dark:bg-emerald-950/40 px-3 py-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-100 shadow-2xs"
                      >
                        Buka <IconChevronRight size={14} />
                      </Link>
                    ) : (
                      <Link
                        to={`/modul/${mod.slug}`}
                        aria-label={`Detail modul ${mod.name}`}
                        className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-1 text-xs font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700 shadow-2xs"
                      >
                        Detail <IconChevronRight size={14} />
                      </Link>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <TableFooter
          itemCount={pagedModules.length}
          total={filteredModules.length}
          entityLabel="modul sistem"
          page={page}
          perPage={perPage}
          onPage={setPage}
          onPerPage={(n) => {
            setPerPage(n)
            setPage(1)
          }}
          perPageOptions={[5, 10, 20]}
        />
      </div>

      {/* Architecture & Security Notice Card */}
      <section className="rounded-xl border border-slate-200/90 dark:border-slate-800 bg-slate-50 dark:bg-slate-900/60 p-5">
        <div className="flex items-start gap-3">
          <div className="rounded-md bg-blue-100 dark:bg-blue-950/60 p-2 text-blue-700 dark:text-blue-400 shrink-0">
            <IconShield size={20} />
          </div>
          <div className="space-y-1 text-xs text-slate-600 dark:text-slate-300">
            <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-100">Prinsip Keamanan & Integritas Data Operasional</h3>
            <p>
              Platform DISTRIVA beroperasi di bawah prinsip <strong>Fail-Closed</strong>. Seluruh otorisasi, validasi data, dan pembatasan unit kerja dievaluasi pada server backend (Laravel ScopedAuthorizationService). Antarmuka pengguna tidak menampilkan data tiruan/palsu sebagai data nyata dan tidak menyediakan aksi approval sebelum endpoint resmi diverifikasi.
            </p>
          </div>
        </div>
      </section>
    </div>
  )
}
