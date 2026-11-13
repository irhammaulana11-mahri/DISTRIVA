import { useCallback, useEffect, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { applicationApi, workOrdersApi } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import ApplicationWorkOrdersPanel from '../applications/ApplicationWorkOrdersPanel.jsx'
import { AgendaFacts, OutboxBadge } from './AgendaParts.jsx'
import MaterialRequestsPanel from './MaterialRequestsPanel.jsx'
import PoleWorkOrderDetailPage from './PoleWorkOrderDetailPage.jsx'
import { VendorWorkOrderView } from './VendorWorkOrdersPage.jsx'
import { IconArrowLeft, IconPlus, IconRefresh } from '../../components/icons.jsx'

/** Halaman kerja satu No. Agenda: WO Jaringan (buat, vendor, ajukan, terbitkan, progres, BASTP) dan WO Tiang. Drawer di daftar hanya pratinjau. */
export default function WorkOrderAgendaPage() {
  const { applicationId } = useParams()
  const navigate = useNavigate()
  const { can, isSysAdmin } = useAccess()
  const [row, setRow] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [params, setParams] = useSearchParams()
  const [app, setApp] = useState(null)

  const isVendor = Boolean(can['vendor.portal'])
  const canViewMaterial = !isVendor && Boolean(can['material_requests.view'] || isSysAdmin)
  const perms = {
    create: Boolean(can['wo.create'] || isSysAdmin),
    issue: Boolean(can['wo.issue'] || isSysAdmin),
    submitProgress: false, // progres pekerjaan hanya dilaporkan akun Pelaksana (portal vendor); internal memverifikasi
    verifyProgress: Boolean(can['wo.progress_verify'] || isSysAdmin),
    complete: Boolean(can['wo.complete'] || isSysAdmin),
    managePoles: Boolean(can['pole_wo.manage'] || isSysAdmin),
  }

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await workOrdersApi.byAgenda({ application_id: applicationId })
      const found = (res?.data || [])[0] || null
      setRow(found)
      if (!found) setError('Agenda tidak ditemukan atau Anda tidak berwenang melihatnya.')
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Gagal memuat agenda.')
    } finally {
      setLoading(false)
    }
  }, [applicationId])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (isVendor) return undefined
    let alive = true
    applicationApi.get(applicationId).then((res) => alive && setApp(res?.data || null)).catch(() => alive && setApp(null))
    return () => { alive = false }
  }, [applicationId, isVendor])

  const tabs = row ? [
    { key: 'network', label: 'WO Jaringan', badge: row.network ? `v${row.network.version_number}` : null },
    { key: 'poles', label: 'WO Tiang', badge: row.poles.length || null },
    ...(canViewMaterial ? [{ key: 'material', label: 'Permintaan Material', badge: row.material_request?.needs_followup ? '!' : row.material_request?.ready_to_send ? 'siap' : row.material_request?.count || null, alert: Boolean(row.material_request?.needs_followup) }] : []),
  ] : []
  const requested = params.get('tab')
  const tab = row && tabs.some((t) => t.key === requested)
    ? requested
    : (row?.network || row?.network_creatable || !row?.poles.length ? 'network' : 'poles')
  const setTab = (key) => setParams({ tab: key }, { replace: true })

  return (
    <div className="space-y-5">
      <div>
        <nav className="text-xs text-slate-500 mb-1">
          <Link to="/work-orders" className="hover:underline">SPK / WO</Link>
          <span className="mx-1.5">/</span>
          <span className="font-mono text-slate-800 dark:text-slate-200 font-medium">{row?.agenda_number || row?.application_number || 'Agenda'}</span>
        </nav>
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={() => navigate('/work-orders')} aria-label="Kembali ke daftar SPK / WO" className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
            <IconArrowLeft size={16} />
          </button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{row?.agenda_number ? `Agenda ${row.agenda_number}` : row ? `Permohonan ${row.application_number}` : 'Agenda SPK / WO'}</h1>
            {row && <p className="text-xs text-slate-500 mt-0.5">{row.customer_name} · {row.unit_name}</p>}
          </div>
          <div className="flex items-center gap-2 flex-wrap sm:ml-auto">
            {row?.network && <StatusBadge status={row.network.status} />}
            {canViewMaterial && <OutboxBadge request={row?.material_request} />}
            <button type="button" onClick={load} aria-label="Muat ulang" title="Muat ulang" className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer">
              <IconRefresh size={15} />
            </button>
          </div>
        </div>
      </div>

      {loading && !row && <div className="py-20 text-center"><Spinner size="lg" label="Memuat agenda..." /></div>}
      {error && <Alert kind="error">{error}</Alert>}

      {row && (
        <>
          <AgendaFacts row={row} />

          <div role="tablist" className="flex gap-1 border-b border-slate-200 dark:border-slate-800">
            {tabs.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} onClick={() => setTab(t.key)}
                className={`px-4 py-2 -mb-px text-sm font-semibold border-b-2 transition cursor-pointer ${tab === t.key ? 'border-blue-600 text-blue-700 dark:text-blue-300' : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'}`}>
                {t.label}
                {t.badge != null && <span className={`ml-1.5 px-1.5 py-0.5 rounded-full text-[10px] ${t.alert ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300 font-bold' : 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'}`}>{t.badge}</span>}
              </button>
            ))}
          </div>

          {tab === 'network' && (
            isVendor ? (
              row.network ? <VendorWorkOrderView workOrderId={row.network.id} isVendor onUpdated={load} /> : <p className="text-xs text-slate-500 italic">Belum ada WO jaringan untuk agenda ini.</p>
            ) : (
              <ApplicationWorkOrdersPanel
                application={app || { id: row.application_id, application_number: row.application_number }}
                canCreate={perms.create}
                canIssue={perms.issue}
                canSubmitProgress={perms.submitProgress}
                canVerifyProgress={perms.verifyProgress}
                canComplete={perms.complete}
              />
            )
          )}

          {tab === 'material' && canViewMaterial && <MaterialRequestsPanel applicationId={applicationId} />}

          {tab === 'poles' && (
            <div className="space-y-3 text-xs">
              {row.poles.length === 0 && <p className="text-slate-500 italic">Belum ada WO tiang untuk agenda ini.{row.poles_creatable_quantity === 0 && ' WO tiang dapat dibuat setelah alokasi tiang dikonfirmasi oleh Perencanaan.'}</p>}
              {row.poles.map((p) => <PoleWorkOrderDetailPage key={p.id} woId={p.id} embedded />)}
              {row.poles_creatable_quantity > 0 && perms.managePoles && (
                <div className="rounded-xl border border-dashed border-blue-300 dark:border-blue-800 bg-blue-50/50 dark:bg-blue-950/20 p-4 flex items-center justify-between gap-3 flex-wrap">
                  <span className="text-slate-700 dark:text-slate-300">{row.poles_creatable_quantity} tiang pada agenda ini sudah dialokasikan dan belum masuk surat WO tiang.</span>
                  <Button variant="primary" onClick={() => navigate('/wo-tiang/new')}><IconPlus size={12} /><span>Buat WO Tiang</span></Button>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
