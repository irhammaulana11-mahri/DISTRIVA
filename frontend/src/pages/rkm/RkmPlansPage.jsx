import { useEffect, useState, useCallback, useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { rkmApi, adminApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import Modal from '../../components/Modal.jsx'
import {
  IconPlus,
  IconRefresh,
  IconClock,
  IconChevronRight,
  IconCalendar,
  IconCheckCircle,
  IconAlertCircle,
  IconFileText,
} from '../../components/icons.jsx'
import { filterControlCls, filterSelectCls } from '../../components/filterStyles.js'

export default function RkmPlansPage() {
  const { can } = useAccess()
  const { notify } = useNotifications()
  const navigate = useNavigate()

  const canPlan = Boolean(can?.['rkm.plan'])
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Units list for UP3 selection
  const [up3Units, setUp3Units] = useState([])

  // Modal Create Plan
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [up3UnitId, setUp3UnitId] = useState('')
  const [periodType, setPeriodType] = useState('MONTH')
  const [periodStart, setPeriodStart] = useState(new Date().toISOString().slice(0, 7) + '-01')
  const [creating, setCreating] = useState(false)
  const [createError, setCreateError] = useState('')

  // Load UP3 Units
  useEffect(() => {
    adminApi
      .units()
      .then((res) => {
        const up3s = (res?.data || []).filter((u) => u.unit_type === 'UP3')
        setUp3Units(up3s)
        if (up3s.length > 0) setUp3UnitId(up3s[0].id)
      })
      .catch(() => setUp3Units([]))
  }, [])

  // Load Plans
  const loadPlans = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await rkmApi.plans()
      setPlans(res?.data || [])
    } catch (err) {
      setError(err?.message || 'Gagal memuat rencana RKM.')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadPlans()
  }, [loadPlans])

  // Handle Create Plan
  const handleCreatePlan = async (e) => {
    e.preventDefault()
    setCreating(true)
    setCreateError('')
    try {
      const res = await rkmApi.createPlan({
        up3_unit_id: up3UnitId,
        period_type: periodType,
        period_start: periodStart,
      })
      notify({
        type: 'success',
        title: 'Rencana RKM Dibuat',
        desc: 'Rencana Kerja & Material baru berhasil diinisiasi.',
        tag: 'RKM',
      })
      setCreateModalOpen(false)
      loadPlans()
      if (res?.data?.version_id) {
        navigate(`/rkm/versions/${res.data.version_id}`)
      }
    } catch (err) {
      setCreateError(err?.message || 'Gagal membuat rencana RKM.')
    } finally {
      setCreating(false)
    }
  }

  const stats = useMemo(() => {
    return {
      totalPlans: plans.length,
      totalVersions: plans.reduce((acc, p) => acc + (p.versions?.length || 0), 0),
      approvedVersions: plans.reduce((acc, p) => acc + (p.versions?.filter((v) => v.status === 'APPROVED').length || 0), 0),
      activeVersions: plans.reduce((acc, p) => acc + (p.versions?.filter((v) => v.status === 'VALIDATING' || v.status === 'DRAFT').length || 0), 0),
    }
  }, [plans])

  return (
    <div className="space-y-6">
      {/* Header Modul RKM Distribusi */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-linear-to-r from-white via-slate-50 to-blue-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-blue-950/20 p-5 sm:p-6 shadow-xs">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-blue-600 p-2.5 text-white shadow-xs">
              <IconCalendar className="h-6 w-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Rencana Kerja &amp; Material (RKM)
                </h1>
                <span className="rounded-full bg-blue-100 dark:bg-blue-950 px-2.5 py-0.5 text-xs font-semibold text-blue-700 dark:text-blue-300">
                  Perencanaan UP3
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl leading-relaxed">
                Konsolidasi usulan kebutuhan material distribusi per ULP, validasi perencanaan &amp; konstruksi UP3, dan perhitungan kebutuhan bersih.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="md"
              icon={IconRefresh}
              onClick={loadPlans}
              aria-label="Segarkan"
            >
              Segarkan
            </Button>
            {canPlan && (
              <Button
                variant="primary"
                size="md"
                icon={IconPlus}
                onClick={() => {
                  setCreateModalOpen(true)
                  setCreateError('')
                }}
              >
                Buat Rencana RKM
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* KPI Ringkasan Metrik RKM */}
      <dl className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-slate-500 dark:text-slate-400">Total Rencana RKM</dt>
            <div className="rounded-lg p-1.5 bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
              <IconCalendar className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
            {stats.totalPlans}
          </dd>
          <p className="mt-1 text-xs text-slate-400 dark:text-slate-500">Rencana aktif per UP3</p>
        </div>

        <div className="rounded-xl border border-blue-200 dark:border-blue-900/60 bg-blue-50/20 dark:bg-blue-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-blue-700 dark:text-blue-400">Total Versi</dt>
            <div className="rounded-lg p-1.5 bg-blue-100 dark:bg-blue-950 text-blue-600 dark:text-blue-400">
              <IconClock className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-blue-600 dark:text-blue-400">
            {stats.totalVersions}
          </dd>
          <p className="mt-1 text-xs text-blue-600/70 dark:text-blue-500/70">Putaran revisi terdaftar</p>
        </div>

        <div className="rounded-xl border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/20 dark:bg-emerald-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-emerald-700 dark:text-emerald-400">Versi Disetujui</dt>
            <div className="rounded-lg p-1.5 bg-emerald-100 dark:bg-emerald-950 text-emerald-600 dark:text-emerald-400">
              <IconCheckCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-emerald-600 dark:text-emerald-400">
            {stats.approvedVersions}
          </dd>
          <p className="mt-1 text-xs text-emerald-600/70 dark:text-emerald-500/70">Status APPROVED tuntas</p>
        </div>

        <div className="rounded-xl border border-amber-200 dark:border-amber-900/60 bg-amber-50/20 dark:bg-amber-950/10 p-4 shadow-xs">
          <div className="flex items-center justify-between">
            <dt className="text-xs font-medium text-amber-700 dark:text-amber-400">Dalam Proses</dt>
            <div className="rounded-lg p-1.5 bg-amber-100 dark:bg-amber-950 text-amber-600 dark:text-amber-400">
              <IconAlertCircle className="h-4 w-4" />
            </div>
          </div>
          <dd className="mt-2 text-2xl font-bold tracking-tight text-amber-600 dark:text-amber-400">
            {stats.activeVersions}
          </dd>
          <p className="mt-1 text-xs text-amber-600/70 dark:text-amber-500/70">Validasi / Draf berjalan</p>
        </div>
      </dl>

      {error && <Alert kind="error">{error}</Alert>}

      {/* Main List */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="py-20 text-center text-slate-500">
            <Spinner size="lg" label="Memuat rencana RKM..." />
          </div>
        ) : plans.length === 0 ? (
          <div className="p-12 text-center text-slate-400 text-xs">
            Belum ada rencana RKM terdaftar untuk unit Anda.
          </div>
        ) : (
          <div className="divide-y divide-slate-100 dark:divide-slate-800">
            {plans.map((p) => (
              <div
                key={p.id}
                className="p-5 hover:bg-slate-50/60 dark:hover:bg-slate-800/40 transition-colors space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-sm text-slate-900 dark:text-slate-100">
                        {p.plan_number}
                      </span>
                      <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300">
                        {p.period_type}
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 dark:text-slate-400 mt-0.5">
                      UP3: <strong className="text-slate-800 dark:text-slate-200">{p.up3_name}</strong> · Periode: {p.period_start} s/d {p.period_end}
                    </p>
                  </div>

                  <span className="text-[11px] text-slate-500">
                    {p.versions?.length || 0} Versi Terdaftar
                  </span>
                </div>

                {/* Versions Chips */}
                <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-slate-100 dark:border-slate-800/80">
                  <span className="text-[11px] font-semibold text-slate-500">Versi:</span>
                  {(p.versions || []).map((v) => (
                    <Link
                      key={v.id}
                      to={`/rkm/versions/${v.id}`}
                      className="px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:border-blue-500 hover:text-blue-600 text-xs font-semibold inline-flex items-center gap-2 transition shadow-2xs"
                    >
                      <span className="font-mono">v{v.version_number}</span>
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[9px] font-bold ${
                          v.status === 'APPROVED'
                            ? 'bg-emerald-100 text-emerald-800'
                            : v.status === 'VALIDATING'
                            ? 'bg-blue-100 text-blue-800'
                            : 'bg-amber-100 text-amber-800'
                        }`}
                      >
                        {v.status} (R{v.round})
                      </span>
                      <IconChevronRight size={12} className="text-slate-400" />
                    </Link>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* DRAWER: Create Plan */}
      <Modal
        open={createModalOpen}
        title="Buat Rencana RKM Baru"
        onClose={() => setCreateModalOpen(false)}
        size="max-w-lg"
      >
        <form onSubmit={handleCreatePlan} className="space-y-4 text-xs">
          {createError && <Alert kind="error">{createError}</Alert>}

          <div>
            <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
              Unit UP3 Induk *
            </label>
            <select
              required
              value={up3UnitId}
              onChange={(e) => setUp3UnitId(e.target.value)}
              className={`${filterSelectCls} w-full`}
            >
              {up3Units.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.code} - {u.name}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Tipe Periode *
              </label>
              <select
                value={periodType}
                onChange={(e) => setPeriodType(e.target.value)}
                className={`${filterSelectCls} w-full`}
              >
                <option value="MONTH">Bulanan (MONTH)</option>
                <option value="QUARTER">Triwulan (QUARTER)</option>
                <option value="SEMESTER">Semester (SEMESTER)</option>
                <option value="YEAR">Tahunan (YEAR)</option>
              </select>
            </div>
            <div>
              <label className="block font-semibold text-slate-700 dark:text-slate-300 mb-1">
                Tanggal Mulai Periode *
              </label>
              <input
                type="date"
                required
                value={periodStart}
                onChange={(e) => setPeriodStart(e.target.value)}
                className={`${filterControlCls} w-full`}
              />
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2 border-t border-slate-200 dark:border-slate-800">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setCreateModalOpen(false)}
            >
              Batal
            </Button>
            <Button type="submit" variant="primary" size="sm" loading={creating}>
              Inisiasi Rencana
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  )
}
