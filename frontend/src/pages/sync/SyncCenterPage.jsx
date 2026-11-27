import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { syncApi } from '../../services/api.js'
import Button from '../../components/Button.jsx'
import EisSyncDrawer from '../applications/EisSyncDrawer.jsx'
import EisReportsPage from '../master-data/EisReportsPage.jsx'
import OutageSyncPage from '../outages/OutageSyncPage.jsx'
import DilSyncDrawer from '../master-data/DilSyncDrawer.jsx'
import MaximoSyncDrawer from '../master-data/MaximoSyncDrawer.jsx'
import MimsStockPullPage from '../master-data/MimsStockPullPage.jsx'
import { SyncUp3Selector, SyncRunMetaBadges } from './SyncRunStatusHelpers.jsx'
import { IconArrowLeft, IconRefresh } from '../../components/icons.jsx'

const SOURCE_TO_TAB = {
  eis: 'eis',
  apkt: 'eis',
  ap2t: 'eis',
  gangguan: 'gangguan',
  outage: 'gangguan',
  dil: 'dil',
  maximo: 'maximo',
  mims: 'mims',
}

const CARD = 'rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs'

export default function SyncCenterPage() {
  const { can } = useAccess()
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()

  const tabs = useMemo(
    () =>
      [
        {
          id: 'eis',
          label: 'EIS / APKT / AP2T',
          visible: Boolean(can?.['applications.sync'] || can?.['eis_reports.view'] || can?.['pengusahaan.view']),
        },
        {
          id: 'gangguan',
          label: 'Data Gangguan',
          visible: Boolean(can?.['outages.view']),
        },
        {
          id: 'dil',
          label: 'DIL Pelanggan',
          visible: Boolean(can?.['customers.view']),
        },
        {
          id: 'maximo',
          label: 'Pengukuran Maximo',
          visible: Boolean(can?.['substations.sync'] || can?.['substations.view']),
        },
        {
          id: 'mims',
          label: 'Stok MIMS',
          visible: Boolean(can?.['stock.import'] || can?.['master_data.view']),
        },
        {
          id: 'kelengkapan',
          label: 'Matriks & Upload Manual',
          visible: Boolean(can?.['eis_reports.view']),
        },
      ].filter((t) => t.visible),
    [can],
  )

  const requestedTab = searchParams.get('tab')
  const activeTab = tabs.some((t) => t.id === requestedTab) ? requestedTab : tabs[0]?.id || 'eis'

  const modeParam = searchParams.get('mode') || null
  const datasetParam = searchParams.get('dataset') || 'saidi-saifi'
  const up3Param = searchParams.get('up3_id') || ''
  const reportsRaw = searchParams.get('reports')
  const reportsParam = useMemo(
    () => (reportsRaw ? reportsRaw.split(',').filter(Boolean) : null),
    [reportsRaw],
  )

  const [up3s, setUp3s] = useState([])
  const [selectedUp3Id, setSelectedUp3Id] = useState(up3Param)
  const [liveFilterScope, setLiveFilterScope] = useState('all') // 'all' | 'selected'

  useEffect(() => {
    if (up3Param && up3Param !== selectedUp3Id) {
      setSelectedUp3Id(up3Param)
    }
  }, [up3Param, selectedUp3Id])

  const handleUp3Context = useCallback(({ up3Id, up3s: nextUp3s }) => {
    if (Array.isArray(nextUp3s) && nextUp3s.length > 0) {
      setUp3s((prev) => (prev.length === nextUp3s.length && prev.every((p, i) => p.id === nextUp3s[i].id) ? prev : nextUp3s))
    }
    if (up3Id) {
      setSelectedUp3Id((prev) => prev || up3Id)
    }
  }, [])

  const handleUp3Change = (nextUp3Id) => {
    setSelectedUp3Id(nextUp3Id)
    const next = new URLSearchParams(searchParams)
    next.set('tab', activeTab)
    if (nextUp3Id) next.set('up3_id', nextUp3Id)
    else next.delete('up3_id')
    setSearchParams(next)
  }

  const handleSelectTab = (tabId) => {
    const next = { tab: tabId }
    if (selectedUp3Id) next.up3_id = selectedUp3Id
    setSearchParams(next)
  }

  const handleBack = () => {
    if (window.history.length > 1) {
      navigate(-1)
    } else {
      navigate('/pengusahaan')
    }
  }

  const [activeRuns, setActiveRuns] = useState([])
  const loadActiveRuns = useCallback(async () => {
    if (!syncApi?.active) return
    try {
      const res = await syncApi.active()
      setActiveRuns(Array.isArray(res?.data) ? res.data : [])
    } catch {
      // Abaikan gangguan polling sementara
    }
  }, [])

  useEffect(() => {
    let timer = null
    let cancelled = false
    const tick = async () => {
      await loadActiveRuns()
      if (!cancelled) {
        timer = setTimeout(tick, activeRuns.length > 0 ? 5000 : 15000)
      }
    }
    tick()
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [loadActiveRuns, activeRuns.length])

  return (
    <div className="space-y-6 w-full">
      {/* Header Pusat Sinkronisasi */}
      <div className={`${CARD} p-5 sm:p-6 bg-linear-to-r from-white via-slate-50 to-indigo-50/40 dark:from-slate-900 dark:via-slate-900 dark:to-indigo-950/20`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-start gap-3.5">
            <div className="rounded-xl bg-indigo-600 p-2.5 text-white shadow-xs">
              <IconRefresh size={24} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-slate-900 dark:text-slate-100">
                  Pusat Sinkronisasi Data
                </h1>
                <span className="rounded-full bg-indigo-100 dark:bg-indigo-950 px-2.5 py-0.5 text-xs font-semibold text-indigo-700 dark:text-indigo-300">
                  Satu Pintu
                </span>
              </div>
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 max-w-2xl">
                Tarik data otomatis, unggah berkas manual, dan pantau kelengkapan seluruh sumber (EIS, APKT, AP2T, Gangguan, DIL, Maximo, dan MIMS) dalam satu halaman penuh.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2.5 shrink-0">
            <SyncUp3Selector up3Id={selectedUp3Id} up3s={up3s} onChange={handleUp3Change} />
            <Button type="button" variant="secondary" size="md" icon={IconArrowLeft} onClick={handleBack}>
              Kembali
            </Button>
          </div>
        </div>
      </div>

      {/* Live Status Bar dari GET /sync/active */}
      {activeRuns.length > 0 && (() => {
        const displayedRuns =
          liveFilterScope === 'selected' && selectedUp3Id
            ? activeRuns.filter((r) => !r.up3?.id || r.up3.id === selectedUp3Id)
            : activeRuns
        return (
          <div
            aria-label="Status Sinkronisasi Aktif"
            className={`${CARD} p-3.5 sm:p-4 border-indigo-200 dark:border-indigo-900 bg-indigo-50/40 dark:bg-indigo-950/20 space-y-2.5`}
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-xs font-bold text-indigo-800 dark:text-indigo-200">
                <span className="inline-block h-2 w-2 rounded-full bg-indigo-600 animate-pulse" />
                <span>Sedang Antre / Berjalan ({displayedRuns.length} proses)</span>
              </div>
              <div className="flex items-center gap-2">
                {up3s.length > 1 && selectedUp3Id && (
                  <div className="inline-flex rounded-lg border border-indigo-200 dark:border-indigo-800 bg-white dark:bg-slate-900 p-0.5 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setLiveFilterScope('all')}
                      className={`px-2 py-0.5 rounded-md font-medium cursor-pointer ${liveFilterScope === 'all' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
                    >
                      Semua UP3
                    </button>
                    <button
                      type="button"
                      onClick={() => setLiveFilterScope('selected')}
                      className={`px-2 py-0.5 rounded-md font-medium cursor-pointer ${liveFilterScope === 'selected' ? 'bg-indigo-600 text-white' : 'text-slate-600 dark:text-slate-300'}`}
                    >
                      UP3 Terpilih
                    </button>
                  </div>
                )}
                <button
                  type="button"
                  onClick={loadActiveRuns}
                  className="text-[11px] font-medium text-indigo-700 dark:text-indigo-300 hover:underline cursor-pointer"
                >
                  Segarkan
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-2">
              {displayedRuns.map((r) => {
                const targetTab = SOURCE_TO_TAB[r.source] || 'eis'
                return (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => handleSelectTab(targetTab)}
                    className="text-left rounded-xl border border-indigo-200/80 dark:border-indigo-900/70 bg-white dark:bg-slate-900 px-3 py-2 hover:border-indigo-400 transition cursor-pointer space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="font-semibold text-slate-800 dark:text-slate-100 uppercase">
                        {r.source || 'sync'}
                        {r.dataset ? ` · ${r.dataset}` : ''}
                      </span>
                      <span className="text-[10px] text-slate-400 font-mono">{r.id}</span>
                    </div>
                    <SyncRunMetaBadges run={r} />
                  </button>
                )
              })}
            </div>
          </div>
        )
      })()}

      {/* Tab Sumber Sinkronisasi */}
      {tabs.length > 0 && (
        <div role="tablist" aria-label="Sumber Sinkronisasi" className="flex flex-wrap items-center gap-1 border-b border-slate-200 dark:border-slate-800">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={activeTab === t.id}
              onClick={() => handleSelectTab(t.id)}
              className={`px-4 py-2 text-xs sm:text-sm font-semibold border-b-2 -mb-px transition cursor-pointer ${
                activeTab === t.id
                  ? 'border-indigo-600 text-indigo-700 dark:text-indigo-300'
                  : 'border-transparent text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* Konten Tab Aktif */}
      <div>
        {activeTab === 'eis' && (
          <EisSyncDrawer
            open
            asPage
            embedded
            selectedUp3Id={selectedUp3Id}
            onUp3Context={handleUp3Context}
            mode={modeParam}
            initialDataset={datasetParam}
            initialReports={reportsParam}
            onClose={handleBack}
            onSynced={() => {}}
          />
        )}
        {activeTab === 'kelengkapan' && <EisReportsPage embedded selectedUp3Id={selectedUp3Id} />}
        {activeTab === 'gangguan' && <OutageSyncPage embedded selectedUp3Id={selectedUp3Id} onUp3Context={handleUp3Context} />}
        {activeTab === 'dil' && <DilSyncDrawer open asPage embedded selectedUp3Id={selectedUp3Id} onUp3Context={handleUp3Context} onClose={handleBack} onFinished={() => {}} />}
        {activeTab === 'maximo' && <MaximoSyncDrawer open asPage embedded selectedUp3Id={selectedUp3Id} onUp3Context={handleUp3Context} onClose={handleBack} onSynced={() => {}} />}
        {activeTab === 'mims' && <MimsStockPullPage embedded selectedUp3Id={selectedUp3Id} />}
      </div>
    </div>
  )
}
