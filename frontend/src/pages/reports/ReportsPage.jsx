import { useState, useEffect, useCallback, useMemo } from 'react'
import { useSearchParams, useParams, useNavigate } from 'react-router-dom'
import { reportsApi, adminApi, triggerFileDownload } from '../../services/api.js'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import { resolveProfiles, visibleForProfiles } from '../../features/dashboard/profiles.js'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import StatusBadge from '../../components/StatusBadge.jsx'
import ReportSettingsDrawer from './ReportSettingsDrawer.jsx'
import {
  IconChart,
  IconDownload,
  IconRefresh,
  IconFileText,
  IconUsers,
  IconCheckCircle,
  IconWrench,
  IconBuilding,
  IconTruck,
  IconZap,
  IconClock,
  IconAlertCircle,
} from '../../components/icons.jsx'

const SLUG_TO_TAB_ID = {
  overview: 'overview',
  pipeline: 'pipeline',
  sla: 'sla',
  'cost-variance': 'costVariance',
  costVariance: 'costVariance',
  'critical-stock': 'criticalStock',
  criticalStock: 'criticalStock',
  'vendor-performance': 'vendorPerformance',
  vendorPerformance: 'vendorPerformance',
  'kkf-feasibility': 'kkfFeasibility',
  kkfFeasibility: 'kkfFeasibility',
  'erp-anomalies': 'erpAnomalies',
  erpAnomalies: 'erpAnomalies',
}

const TAB_ID_TO_SLUG = {
  overview: 'overview',
  pipeline: 'pipeline',
  sla: 'sla',
  costVariance: 'cost-variance',
  criticalStock: 'critical-stock',
  vendorPerformance: 'vendor-performance',
  kkfFeasibility: 'kkf-feasibility',
  erpAnomalies: 'erp-anomalies',
}

const REPORT_PAGE_INFO = {
  overview: {
    title: 'Ringkasan Eksekutif & KPI Operasional',
    subtitle: 'Ringkasan KPI operasional penyambungan (PB/PD), SLA siklus waktu, realisasi biaya investasi, dan evaluasi kelayakan.',
    crumb: 'Ringkasan Eksekutif & KPI',
  },
  pipeline: {
    title: 'Alur Pekerjaan per ULP (Pipeline Funnel)',
    subtitle: 'Pemantauan alur kerja penyambungan bertahap dari permohonan masuk, survei, gambar & MTO, hingga terbitnya WO & BASTP per ULP.',
    crumb: 'Alur Pekerjaan (Funnel)',
  },
  sla: {
    title: 'Siklus Waktu & SLA Pelayanan (Lead Time)',
    subtitle: 'Pengawasan kecepatan pemenuhan Tingkat Mutu Pelayanan (TMP/SLA) dan deteksi keterlambatan pekerjaan penyambungan (overdue).',
    crumb: 'Siklus Waktu & SLA',
  },
  costVariance: {
    title: 'Realisasi Biaya Konstruksi (RAB vs SPK)',
    subtitle: 'Analisis variansi nilai investasi RAB perencanaan terhadap SPK konstruksi vendor dan nilai realisasi akhir BASTP.',
    crumb: 'Realisasi Biaya (RAB vs SPK)',
  },
  criticalStock: {
    title: 'Stok Kritis & Buffer Material Distribusi',
    subtitle: 'Pemantauan saldo stok gudang, kebutuhan penyambungan aktif, buffer stock minimum, dan status cadangan darurat.',
    crumb: 'Stok Kritis & Material',
  },
  vendorPerformance: {
    title: 'Rapor Kinerja Mitra & Vendor Konstruksi',
    subtitle: 'Evaluasi kepatuhan SLA pelaksanaan fisik, tingkat keberhasilan penyelesaian SPK, dan bobot kinerja mitra kerja.',
    crumb: 'Rapor Kinerja Vendor',
  },
  kkfFeasibility: {
    title: 'Analisis Kelayakan Finansial (KKF)',
    subtitle: 'Evaluasi parameter kelayakan finansial permohonan perluasan jaringan (NPV, IRR, Payback Period) dan kebutuhan persetujuan khusus.',
    crumb: 'Analisis Kelayakan KKF',
  },
  erpAnomalies: {
    title: 'Anomali Integrasi & Rekonsiliasi ERP MIMS',
    subtitle: 'Pusat rekonsiliasi integrasi sistem logistik ERP MIMS, deteksi material belum terpetakan, dan penanganan kegagalan sinkronisasi.',
    crumb: 'Anomali & Rekonsiliasi ERP',
  },
}

export default function ReportsPage() {
  const { reportType } = useParams()
  const navigate = useNavigate()
  const { can, isSysAdmin } = useAccess()
  const canViewReports = Boolean(can?.['reports.view'])
  const userProfiles = resolveProfiles({ can, isSysAdmin })

  // Master definition of tabs with role profiles
  const ALL_REPORT_TABS = useMemo(() => [
    { id: 'overview', label: 'Ringkasan Operasional (Overview)', profiles: ['executive', 'mulp', 'admin', 'viewer'] },
    { id: 'pipeline', label: 'Alur Pekerjaan per ULP (Funnel)', profiles: ['executive', 'mulp', 'teknik', 'niaga', 'admin', 'viewer'] },
    { id: 'sla', label: 'Siklus Waktu & SLA (Lead Time)', profiles: ['executive', 'mulp', 'teknik', 'niaga', 'admin', 'viewer'] },
    { id: 'costVariance', label: 'Realisasi Biaya (RAB vs SPK)', profiles: ['executive', 'perencanaan', 'admin', 'viewer'] },
    { id: 'vendorPerformance', label: 'Rapor Kinerja Mitra / Vendor', anyOf: ['reports.view', 'vendor.portal'], profiles: ['executive', 'konstruksi', 'vendor', 'admin', 'viewer'] },
    { id: 'criticalStock', label: 'Stok Kritis & Buffer Material', profiles: ['executive', 'konstruksi', 'admin', 'viewer'] },
    { id: 'kkfFeasibility', label: 'Analisis Kelayakan KKF', profiles: ['executive', 'perencanaan', 'admin', 'viewer'] },
    { id: 'erpAnomalies', label: 'Anomali & Rekonsiliasi ERP', profiles: ['perencanaan', 'admin', 'viewer'] },
  ], [])

  const visibleTabs = useMemo(() => {
    return ALL_REPORT_TABS.filter((t) => visibleForProfiles(t, userProfiles))
  }, [ALL_REPORT_TABS, userProfiles])

  // Tabs sync with URL search params or route params
  const [searchParams, setSearchParams] = useSearchParams()
  const tabParam = searchParams.get('tab')

  const routeTabId = reportType ? SLUG_TO_TAB_ID[reportType] : null
  const showTabs = !routeTabId && !tabParam

  const currentEffectiveTab = useMemo(() => {
    if (routeTabId && visibleTabs.some((t) => t.id === routeTabId)) {
      return routeTabId
    }
    if (tabParam && visibleTabs.some((t) => t.id === tabParam)) {
      return tabParam
    }
    return visibleTabs[0]?.id || 'overview'
  }, [routeTabId, tabParam, visibleTabs])

  const [activeTab, setActiveTabState] = useState(currentEffectiveTab)

  // Sync if route or tabParam changes
  useEffect(() => {
    if (currentEffectiveTab) {
      setActiveTabState(currentEffectiveTab)
    }
  }, [currentEffectiveTab])

  const setActiveTab = (newTab) => {
    setActiveTabState(newTab)
    if (reportType) {
      const slug = TAB_ID_TO_SLUG[newTab] || newTab
      navigate(`/reports/${slug}`)
    } else {
      setSearchParams((prev) => {
        const next = new URLSearchParams(prev)
        if (newTab === 'overview') {
          next.delete('tab')
        } else {
          next.set('tab', newTab)
        }
        return next
      })
    }
  }

  // Hierarchical Scope & Units
  const [scopeInfo, setScopeInfo] = useState({
    scope: 'GLOBAL',
    up3_units: [],
    ulp_units: [],
    default_up3_id: '',
    default_unit_id: '',
  })

  // Filters
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [up3Id, setUp3Id] = useState('')
  const [unitId, setUnitId] = useState('')

  // 1. Overview Data
  const [overviewData, setOverviewData] = useState(null)
  const [loadingOverview, setLoadingOverview] = useState(false)
  const [overviewError, setOverviewError] = useState('')

  // 2. Pipeline Data
  const [pipelineData, setPipelineData] = useState([])
  const [loadingPipeline, setLoadingPipeline] = useState(false)
  const [pipelineError, setPipelineError] = useState('')
  const [pipePage, setPipePage] = useState(1)
  const [pipePerPage, setPipePerPage] = useState(10)

  // 3. SLA Data
  const [slaData, setSlaData] = useState({ summary: {}, rows: [] })
  const [loadingSla, setLoadingSla] = useState(false)
  const [slaError, setSlaError] = useState('')
  const [slaPage, setSlaPage] = useState(1)
  const [slaPerPage, setSlaPerPage] = useState(10)
  const [slaFilterStatus, setSlaFilterStatus] = useState('ALL') // ALL | OVERDUE | ON_TRACK

  // 4. Cost Variance Data
  const [costData, setCostData] = useState([])
  const [loadingCost, setLoadingCost] = useState(false)
  const [costError, setCostError] = useState('')
  const [costPage, setCostPage] = useState(1)
  const [costPerPage, setCostPerPage] = useState(10)

  // 5. Vendor Performance Data
  const [reportSettings, setReportSettings] = useState(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [vendorData, setVendorData] = useState([])
  const [loadingVendor, setLoadingVendor] = useState(false)
  const [vendorError, setVendorError] = useState('')
  const [vendorPage, setVendorPage] = useState(1)
  const [vendorPerPage, setVendorPerPage] = useState(10)

  // 6. Critical Stock Data
  const [criticalStockData, setCriticalStockData] = useState({ summary: {}, rows: [] })
  const [loadingCriticalStock, setLoadingCriticalStock] = useState(false)
  const [criticalStockError, setCriticalStockError] = useState('')
  const [criticalPage, setCriticalPage] = useState(1)
  const [criticalPerPage, setCriticalPerPage] = useState(10)
  const [criticalFilterStatus, setCriticalFilterStatus] = useState('ALL') // ALL | CRITICAL | WARNING | SAFE

  // 7. KKF Feasibility Data
  const [kkfData, setKkfData] = useState({ summary: {}, rows: [] })
  const [loadingKkf, setLoadingKkf] = useState(false)
  const [kkfError, setKkfError] = useState('')
  const [kkfPage, setKkfPage] = useState(1)
  const [kkfPerPage, setKkfPerPage] = useState(10)
  const [kkfFilterStatus, setKkfFilterStatus] = useState('ALL') // ALL | FEASIBLE | NOT_FEASIBLE | EXTENDED

  // 8. ERP Anomalies Data
  const [anomaliesData, setAnomaliesData] = useState({ summary: {}, unmapped_materials: [], sync_failures: [] })
  const [loadingAnomalies, setLoadingAnomalies] = useState(false)
  const [anomaliesError, setAnomaliesError] = useState('')
  const [anomalySubTab, setAnomalySubTab] = useState('UNMAPPED') // UNMAPPED | FAILURES
  const [anomalyPage, setAnomalyPage] = useState(1)
  const [anomalyPerPage, setAnomalyPerPage] = useState(10)

  // Download state
  const [downloading, setDownloading] = useState(false)

  // Load accessible hierarchical units based on active role
  useEffect(() => {
    reportsApi
      .units()
      .then((res) => {
        const d = res?.data || {}
        const up3s = Array.isArray(d.up3_units) ? d.up3_units : []
        const ulps = Array.isArray(d.ulp_units) ? d.ulp_units : []
        setScopeInfo({
          scope: d.scope || 'GLOBAL',
          up3_units: up3s,
          ulp_units: ulps,
          default_up3_id: d.default_up3_id || '',
          default_unit_id: d.default_unit_id || '',
        })
        if (d.default_up3_id) {
          setUp3Id(d.default_up3_id)
        }
        if (d.default_unit_id) {
          setUnitId(d.default_unit_id)
        }
      })
      .catch(() => {
        adminApi
          .units()
          .then((res) => {
            const ulps = (res?.data || []).filter((u) => u.unit_type === 'ULP')
            setScopeInfo((prev) => ({ ...prev, ulp_units: ulps }))
          })
          .catch(() => {})
      })
  }, [])

  // Filtered ULPs based on selected UP3
  const filteredUlps = useMemo(() => {
    if (scopeInfo.scope === 'ULP') {
      return scopeInfo.ulp_units
    }
    if (up3Id) {
      return scopeInfo.ulp_units.filter((u) => String(u.parent_id) === String(up3Id))
    }
    return scopeInfo.ulp_units
  }, [scopeInfo.scope, scopeInfo.ulp_units, up3Id])

  // Selected UP3 details for labels
  const selectedUp3 = useMemo(() => {
    return scopeInfo.up3_units.find((u) => String(u.id) === String(up3Id)) || null
  }, [scopeInfo.up3_units, up3Id])

  const handleUp3Change = (newUp3Id) => {
    setUp3Id(newUp3Id)
    if (!newUp3Id) {
      setUnitId('')
    } else {
      const stillValid = scopeInfo.ulp_units.some(
        (u) => String(u.id) === String(unitId) && String(u.parent_id) === String(newUp3Id)
      )
      if (!stillValid) {
        setUnitId('')
      }
    }
  }

  const handleResetFilters = () => {
    setFrom('')
    setTo('')
    if (scopeInfo.scope === 'GLOBAL') {
      setUp3Id('')
      setUnitId('')
    } else if (scopeInfo.scope === 'UP3') {
      setUp3Id(scopeInfo.default_up3_id)
      setUnitId('')
    } else {
      setUp3Id(scopeInfo.default_up3_id)
      setUnitId(scopeInfo.default_unit_id)
    }
  }

  const canReset = Boolean(
    from ||
      to ||
      (scopeInfo.scope === 'GLOBAL' && (up3Id || unitId)) ||
      (scopeInfo.scope === 'UP3' && (up3Id !== scopeInfo.default_up3_id || unitId)) ||
      (scopeInfo.scope === 'ULP' &&
        (up3Id !== scopeInfo.default_up3_id || unitId !== scopeInfo.default_unit_id))
  )

  // Load Overview Data
  const loadOverview = useCallback(async () => {
    setLoadingOverview(true)
    setOverviewError('')
    try {
      const res = await reportsApi.overview({
        from: from || undefined,
        to: to || undefined,
        up3_id: up3Id || undefined,
        unit_id: unitId || undefined,
      })
      setOverviewData(res?.data || null)
    } catch (err) {
      setOverviewError(err?.message || 'Gagal memuat ringkasan laporan operasional.')
    } finally {
      setLoadingOverview(false)
    }
  }, [from, to, up3Id, unitId])

  // Load Pipeline Data
  const loadPipeline = useCallback(async () => {
    setLoadingPipeline(true)
    setPipelineError('')
    try {
      const res = await reportsApi.pipeline({
        from: from || undefined,
        to: to || undefined,
        up3_id: up3Id || undefined,
        unit_id: unitId || undefined,
      })
      setPipelineData(res?.data || [])
    } catch (err) {
      setPipelineError(err?.message || 'Gagal memuat funnel alur pekerjaan per ULP.')
    } finally {
      setLoadingPipeline(false)
    }
  }, [from, to, up3Id, unitId])

  // Load SLA Data
  const loadSla = useCallback(async () => {
    setLoadingSla(true)
    setSlaError('')
    try {
      const res = await reportsApi.sla({
        from: from || undefined,
        to: to || undefined,
        up3_id: up3Id || undefined,
        unit_id: unitId || undefined,
      })
      setSlaData(res?.data || { summary: {}, rows: [] })
    } catch (err) {
      setSlaError(err?.message || 'Gagal memuat data siklus SLA.')
    } finally {
      setLoadingSla(false)
    }
  }, [from, to, up3Id, unitId])

  // Load Cost Variance Data
  const loadCost = useCallback(async () => {
    setLoadingCost(true)
    setCostError('')
    try {
      const res = await reportsApi.costVariance({
        from: from || undefined,
        to: to || undefined,
        up3_id: up3Id || undefined,
        unit_id: unitId || undefined,
      })
      setCostData(res?.data || [])
    } catch (err) {
      setCostError(err?.message || 'Gagal memuat realisasi biaya RAB vs SPK.')
    } finally {
      setLoadingCost(false)
    }
  }, [from, to, up3Id, unitId])

  useEffect(() => {
    Promise.resolve(reportsApi.settings()).then((res) => setReportSettings(res?.data || null)).catch(() => {})
  }, [])

  // Load Vendor Performance Data
  const loadVendor = useCallback(async () => {
    setLoadingVendor(true)
    setVendorError('')
    try {
      const res = await reportsApi.vendorPerformance({ from: from || undefined, to: to || undefined, up3_id: up3Id || undefined, unit_id: unitId || undefined })
      setVendorData(res?.data || [])
    } catch (err) {
      setVendorError(err?.message || 'Gagal memuat rapor kinerja mitra vendor.')
    } finally {
      setLoadingVendor(false)
    }
  }, [from, to, up3Id, unitId])

  // Load Critical Stock Data
  const loadCriticalStock = useCallback(async () => {
    setLoadingCriticalStock(true)
    setCriticalStockError('')
    try {
      const res = await reportsApi.criticalStock({
        up3_id: up3Id || undefined,
        unit_id: unitId || undefined,
      })
      setCriticalStockData(res?.data || { summary: {}, rows: [] })
    } catch (err) {
      setCriticalStockError(err?.message || 'Gagal memuat status stok kritis material.')
    } finally {
      setLoadingCriticalStock(false)
    }
  }, [up3Id, unitId])

  // Load KKF Feasibility Data
  const loadKkf = useCallback(async () => {
    setLoadingKkf(true)
    setKkfError('')
    try {
      const res = await reportsApi.kkfFeasibility({
        from: from || undefined,
        to: to || undefined,
        up3_id: up3Id || undefined,
        unit_id: unitId || undefined,
      })
      setKkfData(res?.data || { summary: {}, rows: [] })
    } catch (err) {
      setKkfError(err?.message || 'Gagal memuat analisis kelayakan KKF.')
    } finally {
      setLoadingKkf(false)
    }
  }, [from, to, up3Id, unitId])

  // Load ERP Anomalies Data
  const loadAnomalies = useCallback(async () => {
    setLoadingAnomalies(true)
    setAnomaliesError('')
    try {
      const res = await reportsApi.erpAnomalies({
        up3_id: up3Id || undefined,
        unit_id: unitId || undefined,
      })
      setAnomaliesData(res?.data || { summary: {}, unmapped_materials: [], sync_failures: [] })
    } catch (err) {
      setAnomaliesError(err?.message || 'Gagal memuat anomali sinkronisasi ERP.')
    } finally {
      setLoadingAnomalies(false)
    }
  }, [up3Id, unitId])

  useEffect(() => {
    if (activeTab === 'overview') {
      loadOverview()
    } else if (activeTab === 'pipeline') {
      loadPipeline()
    } else if (activeTab === 'sla') {
      loadSla()
    } else if (activeTab === 'costVariance') {
      loadCost()
    } else if (activeTab === 'vendorPerformance') {
      loadVendor()
    } else if (activeTab === 'criticalStock') {
      loadCriticalStock()
    } else if (activeTab === 'kkfFeasibility') {
      loadKkf()
    } else if (activeTab === 'erpAnomalies') {
      loadAnomalies()
    }
  }, [activeTab, loadOverview, loadPipeline, loadSla, loadCost, loadVendor, loadCriticalStock, loadKkf, loadAnomalies])

  const refreshCurrentTab = () => {
    if (activeTab === 'overview') loadOverview()
    else if (activeTab === 'pipeline') loadPipeline()
    else if (activeTab === 'sla') loadSla()
    else if (activeTab === 'costVariance') loadCost()
    else if (activeTab === 'vendorPerformance') loadVendor()
    else if (activeTab === 'criticalStock') loadCriticalStock()
    else if (activeTab === 'kkfFeasibility') loadKkf()
    else if (activeTab === 'erpAnomalies') loadAnomalies()
  }

  // Handle Download XLSX
  const handleDownloadXlsx = async () => {
    setDownloading(true)
    try {
      if (activeTab === 'overview') {
        const { blob, filename } = await reportsApi.downloadOverviewXlsx({
          from: from || undefined,
          to: to || undefined,
          up3_id: up3Id || undefined,
          unit_id: unitId || undefined,
        })
        triggerFileDownload(blob, filename || 'RINGKASAN-OPERASIONAL.xlsx')
      } else if (activeTab === 'pipeline') {
        const { blob, filename } = await reportsApi.downloadPipelineXlsx({
          from: from || undefined,
          to: to || undefined,
          up3_id: up3Id || undefined,
          unit_id: unitId || undefined,
        })
        triggerFileDownload(blob, filename || 'ALUR-PEKERJAAN.xlsx')
      } else if (activeTab === 'sla') {
        const { blob, filename } = await reportsApi.downloadSlaXlsx({
          from: from || undefined,
          to: to || undefined,
          up3_id: up3Id || undefined,
          unit_id: unitId || undefined,
        })
        triggerFileDownload(blob, filename || 'LAPORAN-SLA.xlsx')
      } else if (activeTab === 'costVariance') {
        const { blob, filename } = await reportsApi.downloadCostVarianceXlsx({
          from: from || undefined,
          to: to || undefined,
          up3_id: up3Id || undefined,
          unit_id: unitId || undefined,
        })
        triggerFileDownload(blob, filename || 'REALISASI-BIAYA-RAB-SPK.xlsx')
      } else if (activeTab === 'vendorPerformance') {
        const { blob, filename } = await reportsApi.downloadVendorPerformanceXlsx({ from: from || undefined, to: to || undefined, up3_id: up3Id || undefined, unit_id: unitId || undefined })
        triggerFileDownload(blob, filename || 'RAPOR-KINERJA-VENDOR.xlsx')
      } else if (activeTab === 'criticalStock') {
        const { blob, filename } = await reportsApi.downloadCriticalStockXlsx({
          up3_id: up3Id || undefined,
          unit_id: unitId || undefined,
        })
        triggerFileDownload(blob, filename || 'LAPORAN-STOK-KRITIS.xlsx')
      } else if (activeTab === 'kkfFeasibility') {
        const { blob, filename } = await reportsApi.downloadKkfFeasibilityXlsx({
          from: from || undefined,
          to: to || undefined,
          up3_id: up3Id || undefined,
          unit_id: unitId || undefined,
        })
        triggerFileDownload(blob, filename || 'ANALISIS-KELAYAKAN-KKF.xlsx')
      } else if (activeTab === 'erpAnomalies') {
        const { blob, filename } = await reportsApi.downloadErpAnomaliesXlsx({
          up3_id: up3Id || undefined,
          unit_id: unitId || undefined,
        })
        triggerFileDownload(blob, filename || 'ANOMALI-SINKRONISASI-ERP.xlsx')
      }
    } catch (err) {
      alert(err?.message || 'Gagal mengunduh berkas laporan XLSX.')
    } finally {
      setDownloading(false)
    }
  }

  const appStats = overviewData?.applications || {}
  const proposalStats = overviewData?.proposals || {}
  const rabStats = overviewData?.rab || {}
  const kkfStats = overviewData?.kkf || {}
  const woStats = overviewData?.work_orders || {}
  const bastpStats = overviewData?.bastp || {}
  const requestStats = overviewData?.material_requests || {}

  // Filtered SLA Rows
  const filteredSlaRows = useMemo(() => {
    const rows = Array.isArray(slaData?.rows) ? slaData.rows : (Array.isArray(slaData?.records) ? slaData.records : [])
    if (slaFilterStatus === 'OVERDUE') return rows.filter((r) => r.sla_status === 'OVERDUE')
    if (slaFilterStatus === 'ON_TRACK') return rows.filter((r) => r.sla_status === 'ON_TRACK')
    return rows
  }, [slaData, slaFilterStatus])

  const safeCostList = useMemo(() => {
    if (Array.isArray(costData)) return costData
    if (Array.isArray(costData?.rows)) return costData.rows
    if (Array.isArray(costData?.records)) return costData.records
    return []
  }, [costData])

  const safeVendorList = useMemo(() => {
    if (Array.isArray(vendorData)) return vendorData
    if (Array.isArray(vendorData?.vendors)) return vendorData.vendors
    if (Array.isArray(vendorData?.rows)) return vendorData.rows
    return []
  }, [vendorData])

  // Filtered Critical Stock Rows
  const filteredCriticalRows = useMemo(() => {
    const rows = Array.isArray(criticalStockData?.rows) ? criticalStockData.rows : []
    if (criticalFilterStatus === 'CRITICAL') return rows.filter((r) => r.stock_status === 'CRITICAL')
    if (criticalFilterStatus === 'WARNING') return rows.filter((r) => r.stock_status === 'WARNING')
    if (criticalFilterStatus === 'SAFE') return rows.filter((r) => r.stock_status === 'SAFE')
    return rows
  }, [criticalStockData, criticalFilterStatus])

  // Filtered KKF Feasibility Rows
  const filteredKkfRows = useMemo(() => {
    const rows = Array.isArray(kkfData?.rows) ? kkfData.rows : []
    if (kkfFilterStatus === 'FEASIBLE') return rows.filter((r) => r.feasible === true)
    if (kkfFilterStatus === 'NOT_FEASIBLE') return rows.filter((r) => r.feasible === false)
    if (kkfFilterStatus === 'EXTENDED') return rows.filter((r) => r.extended_required === true)
    return rows
  }, [kkfData, kkfFilterStatus])

  const pageInfo = REPORT_PAGE_INFO[activeTab] || REPORT_PAGE_INFO.overview

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <nav className="text-xs text-slate-500 mb-1">
            <span>DISTRIVA</span>
            <span className="mx-1.5">/</span>
            <span>Laporan & Monitoring</span>
            {pageInfo?.crumb && (
              <>
                <span className="mx-1.5">/</span>
                <span className="text-slate-800 dark:text-slate-200 font-medium">{pageInfo.crumb}</span>
              </>
            )}
          </nav>
          <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">
            {pageInfo?.title || 'Pusat Laporan & Analitika Eksekutif'}
          </h1>
          <p className="text-xs text-slate-500 mt-0.5">
            {pageInfo?.subtitle || 'Ringkasan KPI operasional penyambungan (PB/PD), SLA siklus waktu, realisasi biaya, dan evaluasi kinerja vendor.'}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {(activeTab === 'vendorPerformance' || activeTab === 'criticalStock') && reportSettings && (
            <Button variant="secondary" size="sm" onClick={() => setSettingsOpen(true)}>Pengaturan</Button>
          )}
          <Button
            variant="secondary"
            size="sm"
            icon={IconDownload}
            loading={downloading}
            onClick={handleDownloadXlsx}
          >
            Unduh XLSX
          </Button>
          <Button
            variant="ghost"
            size="sm"
            icon={IconRefresh}
            onClick={refreshCurrentTab}
          >
            Segarkan
          </Button>
        </div>
      </div>

      {/* Filter Bar */}
      {true && (
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-600 dark:text-slate-400">Dari:</span>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-600 dark:text-slate-400">Sampai:</span>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
              />
            </div>

            {/* Filter UP3 */}
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-600 dark:text-slate-400">Unit UP3:</span>
              <select
                aria-label="Filter Unit UP3"
                value={up3Id}
                disabled={scopeInfo.scope === 'UP3' || scopeInfo.scope === 'ULP'}
                onChange={(e) => handleUp3Change(e.target.value)}
                className={`px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 max-w-xs ${
                  scopeInfo.scope !== 'GLOBAL'
                    ? 'opacity-80 cursor-not-allowed bg-slate-100 dark:bg-slate-800/60'
                    : ''
                }`}
              >
                {scopeInfo.scope === 'GLOBAL' ? (
                  <>
                    <option value="">Semua UP3 (Seluruh Unit)</option>
                    {scopeInfo.up3_units.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code} - {u.name}
                      </option>
                    ))}
                  </>
                ) : scopeInfo.scope === 'UP3' ? (
                  <option value={scopeInfo.default_up3_id}>
                    {scopeInfo.up3_units[0]
                      ? `${scopeInfo.up3_units[0].code} - ${scopeInfo.up3_units[0].name} (UP3 Terkait)`
                      : 'UP3 Terkait'}
                  </option>
                ) : (
                  <option value={scopeInfo.default_up3_id}>
                    {scopeInfo.up3_units[0]
                      ? `${scopeInfo.up3_units[0].code} - ${scopeInfo.up3_units[0].name} (UP3 Induk)`
                      : 'UP3 Induk'}
                  </option>
                )}
              </select>
            </div>

            {/* Filter ULP */}
            <div className="flex items-center gap-1.5">
              <span className="font-semibold text-slate-600 dark:text-slate-400">Unit ULP:</span>
              <select
                aria-label="Filter Unit ULP"
                value={unitId}
                disabled={scopeInfo.scope === 'ULP'}
                onChange={(e) => setUnitId(e.target.value)}
                className={`px-2.5 py-1 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 max-w-xs ${
                  scopeInfo.scope === 'ULP'
                    ? 'opacity-80 cursor-not-allowed bg-slate-100 dark:bg-slate-800/60'
                    : ''
                }`}
              >
                {scopeInfo.scope === 'ULP' ? (
                  <option value={scopeInfo.default_unit_id}>
                    {scopeInfo.ulp_units[0]
                      ? `${scopeInfo.ulp_units[0].code} - ${scopeInfo.ulp_units[0].name} (Terkunci)`
                      : 'ULP Terkait'}
                  </option>
                ) : (
                  <>
                    <option value="">
                      {up3Id
                        ? `Semua ULP di ${selectedUp3 ? selectedUp3.name : 'UP3 Terpilih'}`
                        : 'Semua ULP (Seluruh Wilayah)'}
                    </option>
                    {filteredUlps.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.code} - {u.name}
                      </option>
                    ))}
                  </>
                )}
              </select>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {canReset && (
              <button
                type="button"
                onClick={handleResetFilters}
                className="text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 text-xs underline cursor-pointer"
              >
                Reset Filter
              </button>
            )}
            <Button
              variant="primary"
              size="sm"
              onClick={refreshCurrentTab}
            >
              Terapkan Filter
            </Button>
          </div>
        </div>
      )}

      {/* Tabs Nav (Hanya ditampilkan pada mode all-in-one / fallback testing; saat diakses mandiri dari sub-halaman sidebar, tab redundan disembunyikan) */}
      {showTabs && (
        <div className="flex items-center gap-1.5 sm:gap-2 border-b border-slate-200 dark:border-slate-800 pb-2 overflow-x-auto -mx-1 px-1 sm:mx-0 sm:px-0">
          {visibleTabs.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setActiveTab(t.id)}
              className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold transition cursor-pointer shrink-0 ${
                activeTab === t.id
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}

      {/* TAB 1: OVERVIEW */}
      {activeTab === 'overview' && (
        <div className="space-y-5">
          {overviewError && <Alert kind="error">{overviewError}</Alert>}

          {loadingOverview ? (
            <div className="py-20 text-center text-slate-500">
              <Spinner size="lg" label="Memuat ringkasan KPI operasional..." />
            </div>
          ) : !overviewData ? (
            <div className="p-12 text-center text-slate-400 text-xs">
              Tidak ada data ringkasan untuk parameter filter yang dipilih.
            </div>
          ) : (
            <div className="space-y-5">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Total Permohonan
                  </span>
                  <div className="text-3xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                    {appStats.total ?? 0}
                  </div>
                  <div className="flex items-center gap-2 mt-2 text-[11px] text-slate-500">
                    <span>PB: {appStats.by_type?.PASANG_BARU ?? 0}</span>
                    <span>·</span>
                    <span>PD: {appStats.by_type?.PERUBAHAN_DAYA ?? 0}</span>
                  </div>
                </div>

                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Total Nilai Investasi (RAB)
                  </span>
                  <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mt-1">
                    Rp {Math.round(rabStats.total_value ?? 0).toLocaleString('id-ID')}
                  </div>
                  <div className="text-[11px] text-slate-500 mt-2">
                    {rabStats.applications_with_run ?? 0} permohonan telah dihitung RAB
                  </div>
                </div>

                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Total SPK Konstruksi (WO)
                  </span>
                  <div className="text-3xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                    {Object.values(woStats.by_status || {}).reduce((a, b) => a + Number(b), 0)} WO
                  </div>
                  <div className="text-[11px] text-slate-500 mt-2">
                    Aktif: {(woStats.by_status?.ISSUED ?? 0) + (woStats.by_status?.IN_PROGRESS ?? 0)} · Selesai: {woStats.by_status?.COMPLETED ?? 0}
                  </div>
                </div>

                <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs">
                  <span className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider block">
                    Evaluasi Kelayakan (KKF)
                  </span>
                  <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 mt-1 flex items-baseline gap-2">
                    <span className="text-emerald-600">{kkfStats.feasible ?? 0} Layak</span>
                    <span className="text-xs text-slate-400">/</span>
                    <span className="text-rose-600">{kkfStats.not_feasible ?? 0} Tidak</span>
                  </div>
                  <div className="text-[11px] text-amber-600 mt-2">
                    {kkfStats.extended_required ?? 0} butuh persetujuan khusus
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* TAB 2: PIPELINE FUNNEL */}
      {activeTab === 'pipeline' && (
        <div className="space-y-4">
          {pipelineError && <Alert kind="error">{pipelineError}</Alert>}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
            {loadingPipeline ? (
              <div className="py-20 text-center text-slate-500">
                <Spinner size="lg" label="Menghitung funnel per ULP..." />
              </div>
            ) : pipelineData.length === 0 ? (
              <EmptyState
                icon={IconChart}
                title="Belum ada data alur pekerjaan"
                description="Tidak ada data pekerjaan untuk parameter filter yang dipilih."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                      <th className="py-3 px-3">Kode</th>
                      <th className="py-3 px-3">Unit ULP</th>
                      <th className="py-3 px-3 text-right">Permohonan</th>
                      <th className="py-3 px-3 text-right">Survei</th>
                      <th className="py-3 px-3 text-right">Gambar ACC</th>
                      <th className="py-3 px-3 text-right">MTO ACC</th>
                      <th className="py-3 px-3 text-right">RAB Run</th>
                      <th className="py-3 px-3 text-right">KKF Run</th>
                      <th className="py-3 px-3 text-right">WO Terbit</th>
                      <th className="py-3 px-3 text-right">WO Selesai</th>
                      <th className="py-3 px-3 text-right">BASTP Ditutup</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono text-[11px]">
                    {pipelineData
                      .slice((pipePage - 1) * pipePerPage, pipePage * pipePerPage)
                      .map((row, idx) => (
                        <tr
                          key={idx}
                          className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40 transition-colors"
                        >
                          <td className="py-2.5 px-3 font-bold text-slate-900 dark:text-slate-100">
                            {row.unit_code}
                          </td>
                          <td className="py-2.5 px-3 font-sans font-medium text-slate-800 dark:text-slate-200">
                            {row.unit_name}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-slate-900 dark:text-slate-100">
                            {row.applications ?? 0}
                          </td>
                          <td className="py-2.5 px-3 text-right">{row.with_survey ?? 0}</td>
                          <td className="py-2.5 px-3 text-right">{row.drawing_approved ?? 0}</td>
                          <td className="py-2.5 px-3 text-right">{row.mto_approved ?? 0}</td>
                          <td className="py-2.5 px-3 text-right">{row.rab_run ?? 0}</td>
                          <td className="py-2.5 px-3 text-right">{row.kkf_run ?? 0}</td>
                          <td className="py-2.5 px-3 text-right">{row.wo_issued ?? 0}</td>
                          <td className="py-2.5 px-3 text-right text-emerald-600 font-semibold">{row.wo_completed ?? 0}</td>
                          <td className="py-2.5 px-3 text-right text-blue-600 font-bold">{row.bastp_closed ?? 0}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            <TableFooter
              itemCount={pipelineData.slice((pipePage - 1) * pipePerPage, pipePage * pipePerPage).length}
              total={pipelineData.length}
              entityLabel="unit ULP"
              page={pipePage}
              perPage={pipePerPage}
              onPage={setPipePage}
              onPerPage={(n) => {
                setPipePerPage(n)
                setPipePage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          </div>
        </div>
      )}

      {/* TAB 3: SLA & LEAD TIME */}
      {activeTab === 'sla' && (
        <div className="space-y-4">
          {slaError && <Alert kind="error">{slaError}</Alert>}

          {/* SLA KPI Summary Cards */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
              <span className="text-[10px] font-semibold text-slate-500 uppercase block">Rata-rata Mohon → Survei</span>
              <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {slaData.summary?.average_days_mohon_to_survey ?? 0} <span className="text-xs font-normal text-slate-500">Hari</span>
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
              <span className="text-[10px] font-semibold text-slate-500 uppercase block">Rata-rata Survei → Gambar</span>
              <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {slaData.summary?.average_days_survey_to_drawing ?? 0} <span className="text-xs font-normal text-slate-500">Hari</span>
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
              <span className="text-[10px] font-semibold text-slate-500 uppercase block">Rata-rata Gambar → SPK</span>
              <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {slaData.summary?.average_days_drawing_to_wo ?? 0} <span className="text-xs font-normal text-slate-500">Hari</span>
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
              <span className="text-[10px] font-semibold text-slate-500 uppercase block">Rata-rata SPK → Nyala</span>
              <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {slaData.summary?.average_days_wo_to_nyala ?? 0} <span className="text-xs font-normal text-slate-500">Hari</span>
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
              <span className="text-[10px] font-semibold text-slate-500 uppercase block">Total Rata-rata Siklus</span>
              <div className="text-xl font-bold text-blue-600 dark:text-blue-400 mt-1">
                {slaData.summary?.average_total_cycle_days ?? 0} <span className="text-xs font-normal text-slate-500">Hari</span>
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/40 bg-rose-50/20 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-rose-600 uppercase block">Lewat Batas SLA</span>
              <div className="text-xl font-bold text-rose-600 mt-1">
                {slaData.summary?.overdue_count ?? 0} <span className="text-xs font-normal text-rose-500">Pelanggan</span>
              </div>
            </div>
          </div>

          {/* Filter Status SLA */}
          <div className="flex items-center gap-2">
            {['ALL', 'OVERDUE', 'ON_TRACK'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => {
                  setSlaFilterStatus(st)
                  setSlaPage(1)
                }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition ${
                  slaFilterStatus === st
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                {st === 'ALL' && `Semua Status (${slaData.rows?.length || 0})`}
                {st === 'OVERDUE' && `Lewat Batas SLA (${slaData.summary?.overdue_count || 0})`}
                {st === 'ON_TRACK' && 'Tepat Waktu (On Track)'}
              </button>
            ))}
          </div>

          {/* SLA Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
            {loadingSla ? (
              <div className="py-20 text-center text-slate-500">
                <Spinner size="lg" label="Menghitung lead time dan status SLA..." />
              </div>
            ) : filteredSlaRows.length === 0 ? (
              <EmptyState
                icon={IconClock}
                title="Belum ada data SLA siklus waktu"
                description="Tidak ada data permohonan yang sesuai kriteria filter SLA."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                      <th className="py-3 px-3">No. Agenda / Permohonan</th>
                      <th className="py-3 px-3">Pelanggan</th>
                      <th className="py-3 px-3">ULP</th>
                      <th className="py-3 px-3">Tahapan Saat Ini</th>
                      <th className="py-3 px-3 text-right">Umur (Hari)</th>
                      <th className="py-3 px-3 text-right" title="T1: Mohon s.d. Survei Disetujui">T1 (Hari)</th>
                      <th className="py-3 px-3 text-right" title="T2: Survei s.d. Gambar Disetujui">T2 (Hari)</th>
                      <th className="py-3 px-3 text-right" title="T3: Gambar s.d. SPK Terbit">T3 (Hari)</th>
                      <th className="py-3 px-3 text-right" title="T4: SPK Terbit s.d. BASTP Tutup">T4 (Hari)</th>
                      <th className="py-3 px-3 text-center">Status SLA</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                    {filteredSlaRows
                      .slice((slaPage - 1) * slaPerPage, slaPage * slaPerPage)
                      .map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                            {row.application_number}
                            <div className="text-[10px] text-slate-500 font-sans font-normal">{row.created_at}</div>
                          </td>
                          <td className="py-2.5 px-3">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">{row.customer_name}</div>
                            <div className="text-[11px] text-slate-500">{row.tariff_power}</div>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-700 dark:text-slate-300">
                            {row.unit_code}
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-700 dark:text-slate-300">
                            {row.current_stage}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-slate-900 dark:text-slate-100">
                            {row.age_days}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">{row.t1_survey_days ?? '-'}</td>
                          <td className="py-2.5 px-3 text-right font-mono">{row.t2_drawing_days ?? '-'}</td>
                          <td className="py-2.5 px-3 text-right font-mono">{row.t3_wo_days ?? '-'}</td>
                          <td className="py-2.5 px-3 text-right font-mono">{row.t4_execution_days ?? '-'}</td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                row.sla_status === 'OVERDUE'
                                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              }`}
                            >
                              {row.sla_status === 'OVERDUE' ? 'Lewat Batas' : 'On Track'}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            <TableFooter
              itemCount={filteredSlaRows.slice((slaPage - 1) * slaPerPage, slaPage * slaPerPage).length}
              total={filteredSlaRows.length}
              entityLabel="permohonan SLA"
              page={slaPage}
              perPage={slaPerPage}
              onPage={setSlaPage}
              onPerPage={(n) => {
                setSlaPerPage(n)
                setSlaPage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          </div>
        </div>
      )}

      {/* TAB 4: COST VARIANCE (RAB VS SPK) */}
      {activeTab === 'costVariance' && (
        <div className="space-y-4">
          {costError && <Alert kind="error">{costError}</Alert>}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
            {loadingCost ? (
              <div className="py-20 text-center text-slate-500">
                <Spinner size="lg" label="Memuat realisasi biaya RAB vs SPK..." />
              </div>
            ) : safeCostList.length === 0 ? (
              <EmptyState
                icon={IconZap}
                title="Belum ada data realisasi biaya"
                description="Belum ada data permohonan yang telah dihitung RAB pada periode ini."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                      <th className="py-3 px-3">No. Permohonan</th>
                      <th className="py-3 px-3">Pelanggan</th>
                      <th className="py-3 px-3">ULP</th>
                      <th className="py-3 px-3 text-right">Estimasi Biaya RAB</th>
                      <th className="py-3 px-3">No. SPK / WO</th>
                      <th className="py-3 px-3">Mitra Pelaksana</th>
                      <th className="py-3 px-3">Status SPK</th>
                      <th className="py-3 px-3">No. BASTP</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                    {safeCostList
                      .slice((costPage - 1) * costPerPage, costPage * costPerPage)
                      .map((row) => (
                        <tr key={row.application_number} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                            {row.application_number}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                            {row.customer_name}
                          </td>
                          <td className="py-2.5 px-3 font-mono">{row.unit_code}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600">
                            Rp {Math.round(row.rab_total || 0).toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-3 font-mono">{row.wo_number}</td>
                          <td className="py-2.5 px-3">{row.vendor_name}</td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-semibold bg-slate-100 dark:bg-slate-800">
                              {row.wo_status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-600 dark:text-slate-400">
                            {row.bastp_number}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            <TableFooter
              itemCount={safeCostList.slice((costPage - 1) * costPerPage, costPage * costPerPage).length}
              total={safeCostList.length}
              entityLabel="permohonan berbiaya"
              page={costPage}
              perPage={costPerPage}
              onPage={setCostPage}
              onPerPage={(n) => {
                setCostPerPage(n)
                setCostPage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          </div>
        </div>
      )}

      {/* TAB 5: VENDOR PERFORMANCE */}
      {activeTab === 'vendorPerformance' && (
        <div className="space-y-4">
          {vendorError && <Alert kind="error">{vendorError}</Alert>}
          <p className="text-[11px] text-slate-500">
            Skor 0–100 = {reportSettings?.vendor?.weight_completion ?? 40}% tingkat selesai + {reportSettings?.vendor?.weight_timeliness ?? 20}% ketepatan waktu (selesai sebelum target SPK; SPK tanpa target tidak dinilai) + {reportSettings?.vendor?.weight_quality ?? 25}% kualitas (semakin sedikit revisi BASTP) + {reportSettings?.vendor?.weight_discipline ?? 15}% disiplin laporan (SPK berjalan dilaporkan dalam {reportSettings?.vendor?.stale_days ?? 7} hari terakhir).
            Periode dihitung dari tanggal SPK diterbitkan. Baik ≥ {reportSettings?.vendor?.good_min ?? 80}, Cukup ≥ {reportSettings?.vendor?.fair_min ?? 60}.
          </p>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
            {loadingVendor ? (
              <div className="py-20 text-center text-slate-500">
                <Spinner size="lg" label="Memuat rapor evaluasi vendor..." />
              </div>
            ) : safeVendorList.length === 0 ? (
              <EmptyState
                icon={IconUsers}
                title="Belum ada rapor kinerja vendor"
                description="Belum ada mitra vendor terdaftar atau memiliki riwayat SPK."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                      <th className="py-3 px-3">Kode Vendor</th>
                      <th className="py-3 px-3">Nama Badan Usaha / Rekanan</th>
                      <th className="py-3 px-3 text-right">Total SPK</th>
                      <th className="py-3 px-3 text-right">SPK Selesai</th>
                      <th className="py-3 px-3 text-right">Dalam Pengerjaan</th>
                      <th className="py-3 px-3 text-right">Dibatalkan</th>
                      <th className="py-3 px-3 text-right">Revisi BASTP</th>
                      <th className="py-3 px-3 text-right">Tingkat Selesai (%)</th>
                      <th className="py-3 px-3 text-right">Rata-rata Progres</th>
                      <th className="py-3 px-3 text-right" title="SPK berjalan tanpa laporan progres lebih dari 7 hari">Tanpa Laporan &gt;7 Hari</th>
                      <th className="py-3 px-3 text-right">Laporan Ditolak</th>
                      <th className="py-3 px-3 text-right">Rata-rata Hari Selesai</th>
                      <th className="py-3 px-3 text-right" title="SPK selesai sebelum/pada target dibanding yang terlambat atau sedang berjalan melewati target">Tepat Waktu</th>
                      <th className="py-3 px-3 text-right">Terlambat / Lewat Target</th>
                      <th className="py-3 px-3 text-center">Skor</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                    {safeVendorList
                      .slice((vendorPage - 1) * vendorPerPage, vendorPage * vendorPerPage)
                      .map((vnd) => (
                      <tr key={vnd.vendor_id || vnd.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                          {vnd.vendor_code || vnd.company_code}
                        </td>
                        <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                          {vnd.vendor_name || vnd.company_name}
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold">{vnd.total_wo}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-emerald-600 font-semibold">{vnd.completed_wo}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-blue-600">{vnd.in_progress_wo}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-rose-500">{vnd.cancelled_wo}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-amber-600">{vnd.bastp_revision_count}</td>
                        <td className="py-2.5 px-3 text-right font-mono font-bold">
                          {vnd.completion_rate ?? vnd.completion_rate_pct}%
                        </td>
                        <td className="py-2.5 px-3 text-right font-mono">{vnd.avg_progress == null ? '-' : `${vnd.avg_progress}%`}</td>
                        <td className={`py-2.5 px-3 text-right font-mono ${vnd.stale_wo > 0 ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>{vnd.stale_wo ?? 0}</td>
                        <td className="py-2.5 px-3 text-right font-mono text-amber-600">{vnd.rejected_progress ?? 0}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{vnd.avg_days_to_complete ?? '-'}</td>
                        <td className="py-2.5 px-3 text-right font-mono">{vnd.on_time_rate == null ? '-' : `${vnd.on_time_rate}%`}</td>
                        <td className={`py-2.5 px-3 text-right font-mono ${(vnd.late_wo + vnd.overdue_wo) > 0 ? 'text-rose-600 font-bold' : 'text-slate-400'}`}>{(vnd.late_wo ?? 0) + (vnd.overdue_wo ?? 0)}</td>
                        <td className="py-2.5 px-3 text-center">
                          {vnd.score == null ? <span className="text-slate-400">-</span> : (
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                vnd.rating === 'BAIK'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : vnd.rating === 'CUKUP'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                              }`}
                            >
                              {vnd.score} · {vnd.rating === 'BAIK' ? 'Baik' : vnd.rating === 'CUKUP' ? 'Cukup' : 'Perlu pembinaan'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <TableFooter
              itemCount={safeVendorList.slice((vendorPage - 1) * vendorPerPage, vendorPage * vendorPerPage).length}
              total={safeVendorList.length}
              entityLabel="mitra vendor"
              page={vendorPage}
              perPage={vendorPerPage}
              onPage={setVendorPage}
              onPerPage={(n) => {
                setVendorPerPage(n)
                setVendorPage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          </div>
        </div>
      )}

      {/* TAB 6: CRITICAL STOCK & MATERIAL BUFFER */}
      {activeTab === 'criticalStock' && (
        <div className="space-y-4">
          {criticalStockError && <Alert kind="error">{criticalStockError}</Alert>}

          {/* Critical Stock KPI Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
              <span className="text-[10px] font-semibold text-slate-500 uppercase block">Total Item KHS</span>
              <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {criticalStockData.summary?.total_items ?? 0} <span className="text-xs font-normal text-slate-500">Item</span>
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/40 bg-rose-50/20 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-rose-600 uppercase block">Stok Kritis / Habis</span>
              <div className="text-xl font-bold text-rose-600 mt-1">
                {criticalStockData.summary?.critical_items ?? 0} <span className="text-xs font-normal text-rose-500">Item</span>
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/40 bg-amber-50/20 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-amber-600 uppercase block">Peringatan Stok Menipis</span>
              <div className="text-xl font-bold text-amber-600 mt-1">
                {criticalStockData.summary?.warning_items ?? 0} <span className="text-xs font-normal text-amber-500">Item</span>
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/20 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-emerald-600 uppercase block">Stok Aman / Tercukupi</span>
              <div className="text-xl font-bold text-emerald-600 mt-1">
                {criticalStockData.summary?.safe_items ?? 0} <span className="text-xs font-normal text-emerald-500">Item</span>
              </div>
            </div>
          </div>

          <p className="text-[11px] text-slate-500">
            Stok minimum = rata-rata pemakaian {criticalStockData.summary?.usage_months ?? 3} bulan terakhir (penyerahan material TUG 7; bila belum ada, alokasi terkonfirmasi) atau safety stock ERP bila lebih tinggi.
            Kritis bila tersedia + kedatangan 1 bulan masih di bawah stok minimum; peringatan bila baru tercukupi oleh kedatangan atau kurang dari {reportSettings?.stock?.warning_factor ?? 1.5}× stok minimum.
            {criticalStockData.summary?.snapshot_newest && <> Data stok per {criticalStockData.summary.snapshot_newest}{criticalStockData.summary.snapshot_oldest !== criticalStockData.summary.snapshot_newest && <> (gudang tertua {criticalStockData.summary.snapshot_oldest})</>}.</>}
          </p>

          {/* Filter Status */}
          <div className="flex items-center gap-2">
            {['ALL', 'CRITICAL', 'WARNING', 'SAFE'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => {
                  setCriticalFilterStatus(st)
                  setCriticalPage(1)
                }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition ${
                  criticalFilterStatus === st
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                {st === 'ALL' && `Semua Status (${criticalStockData.rows?.length || 0})`}
                {st === 'CRITICAL' && `Kritis (${criticalStockData.summary?.critical_items || 0})`}
                {st === 'WARNING' && `Peringatan (${criticalStockData.summary?.warning_items || 0})`}
                {st === 'SAFE' && `Aman (${criticalStockData.summary?.safe_items || 0})`}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
            {loadingCriticalStock ? (
              <div className="py-20 text-center text-slate-500">
                <Spinner size="lg" label="Memeriksa ketersediaan dan buffer stok material..." />
              </div>
            ) : filteredCriticalRows.length === 0 ? (
              <EmptyState
                icon={IconBuilding}
                title="Belum ada data stok kritis"
                description="Tidak ada item material yang memenuhi kriteria filter stok."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                      <th className="py-3 px-3">Kode KHS</th>
                      <th className="py-3 px-3">Nama Material KHS</th>
                      <th className="py-3 px-3">Satuan</th>
                      <th className="py-3 px-3 text-right">Stok Fisik Gudang</th>
                      <th className="py-3 px-3 text-right">Teralokasi (Reserved)</th>
                      <th className="py-3 px-3 text-right">Tersedia Saat Ini</th>
                      <th className="py-3 px-3 text-right">Pemakaian / Bulan</th>
                      <th className="py-3 px-3 text-right">Stok Minimum</th>
                      <th className="py-3 px-3 text-right">Datang (1 Bulan)</th>
                      <th className="py-3 px-3 text-right">Proyeksi</th>
                      <th className="py-3 px-3 text-right">Kekurangan</th>
                      <th className="py-3 px-3 text-center">Status</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                    {filteredCriticalRows
                      .slice((criticalPage - 1) * criticalPerPage, criticalPage * criticalPerPage)
                      .map((row) => (
                        <tr key={row.khs_id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                            {row.khs_code}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                            {row.khs_name}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 font-mono text-[11px]">
                            {row.unit}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold">
                            {row.on_hand?.toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-amber-600">
                            {row.reserved?.toLocaleString('id-ID')}
                          </td>
                          <td className={`py-2.5 px-3 text-right font-mono font-bold ${
                            row.stock_status === 'CRITICAL' ? 'text-rose-600' : 'text-slate-900 dark:text-slate-100'
                          }`}>
                            {row.available?.toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-500">
                            {(row.monthly_usage ?? 0).toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-slate-500" title={row.min_basis === 'SAFETY' ? 'Dari safety stock ERP' : row.min_basis === 'USAGE' ? 'Dari rata-rata pemakaian' : 'Belum ada riwayat pemakaian'}>
                            {(row.min_stock ?? 0).toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono text-blue-600">
                            {(row.incoming ?? 0).toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold">
                            {(row.projected ?? 0).toLocaleString('id-ID')}
                          </td>
                          <td className={`py-2.5 px-3 text-right font-mono font-bold ${row.shortage > 0 ? 'text-rose-600' : 'text-slate-400'}`}>
                            {row.shortage > 0 ? row.shortage.toLocaleString('id-ID') : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                row.stock_status === 'CRITICAL'
                                  ? 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                                  : row.stock_status === 'WARNING'
                                  ? 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                                  : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                              }`}
                            >
                              {row.stock_status === 'CRITICAL' ? 'KRITIS' : row.stock_status === 'WARNING' ? 'PERINGATAN' : 'AMAN'}
                            </span>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            <TableFooter
              itemCount={filteredCriticalRows.slice((criticalPage - 1) * criticalPerPage, criticalPage * criticalPerPage).length}
              total={filteredCriticalRows.length}
              entityLabel="material"
              page={criticalPage}
              perPage={criticalPerPage}
              onPage={setCriticalPage}
              onPerPage={(n) => {
                setCriticalPerPage(n)
                setCriticalPage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          </div>
        </div>
      )}

      {/* TAB 7: KKF FEASIBILITY */}
      {activeTab === 'kkfFeasibility' && (
        <div className="space-y-4">
          {kkfError && <Alert kind="error">{kkfError}</Alert>}

          {/* KKF KPI Summary */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
              <span className="text-[10px] font-semibold text-slate-500 uppercase block">Total Dihitung KKF</span>
              <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {kkfData.summary?.total_applications_with_kkf ?? 0} <span className="text-xs font-normal text-slate-500">Permohonan</span>
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/40 bg-emerald-50/20 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-emerald-600 uppercase block">Layak Investasi</span>
              <div className="text-xl font-bold text-emerald-600 mt-1">
                {kkfData.summary?.feasible_count ?? 0} <span className="text-xs font-normal text-emerald-500">Permohonan</span>
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/40 bg-rose-50/20 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-rose-600 uppercase block">Tidak Layak</span>
              <div className="text-xl font-bold text-rose-600 mt-1">
                {kkfData.summary?.not_feasible_count ?? 0} <span className="text-xs font-normal text-rose-500">Permohonan</span>
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-purple-200 dark:border-purple-900/40 bg-purple-50/20 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-purple-600 uppercase block">PBP &gt; 60 Bulan (Diperluas)</span>
              <div className="text-xl font-bold text-purple-600 mt-1">
                {kkfData.summary?.extended_required_count ?? 0} <span className="text-xs font-normal text-purple-500">Permohonan</span>
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
              <span className="text-[10px] font-semibold text-slate-500 uppercase block">Total Capex RAB</span>
              <div className="text-lg font-bold text-emerald-600 mt-1">
                Rp {Math.round(kkfData.summary?.total_capex_rab || 0).toLocaleString('id-ID')}
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
              <span className="text-[10px] font-semibold text-slate-500 uppercase block">Rata-rata Payback</span>
              <div className="text-xl font-bold text-blue-600 mt-1">
                {kkfData.summary?.average_payback_months ?? 0} <span className="text-xs font-normal text-slate-500">Bulan</span>
              </div>
            </div>
          </div>

          {/* Filter Status */}
          <div className="flex items-center gap-2">
            {['ALL', 'FEASIBLE', 'NOT_FEASIBLE', 'EXTENDED'].map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => {
                  setKkfFilterStatus(st)
                  setKkfPage(1)
                }}
                className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition ${
                  kkfFilterStatus === st
                    ? 'bg-blue-600 text-white'
                    : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
                }`}
              >
                {st === 'ALL' && `Semua Status (${kkfData.rows?.length || 0})`}
                {st === 'FEASIBLE' && `Layak (${kkfData.summary?.feasible_count || 0})`}
                {st === 'NOT_FEASIBLE' && `Tidak Layak (${kkfData.summary?.not_feasible_count || 0})`}
                {st === 'EXTENDED' && `Perluasan PBP > 60 Bln (${kkfData.summary?.extended_required_count || 0})`}
              </button>
            ))}
          </div>

          {/* Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
            {loadingKkf ? (
              <div className="py-20 text-center text-slate-500">
                <Spinner size="lg" label="Memuat kalkulasi kelayakan KKF dan proyeksi investasi..." />
              </div>
            ) : filteredKkfRows.length === 0 ? (
              <EmptyState
                icon={IconChart}
                title="Belum ada data analisis kelayakan KKF"
                description="Tidak ada permohonan yang sesuai kriteria filter KKF."
              />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                      <th className="py-3 px-3">No. Permohonan</th>
                      <th className="py-3 px-3">Pelanggan</th>
                      <th className="py-3 px-3">ULP</th>
                      <th className="py-3 px-3">Tarif & Daya</th>
                      <th className="py-3 px-3 text-right">Capex RAB</th>
                      <th className="py-3 px-3 text-center">Status Kelayakan</th>
                      <th className="py-3 px-3 text-right">PBP (Bulan)</th>
                      <th className="py-3 px-3 text-right">NPV (Rp)</th>
                      <th className="py-3 px-3 text-right">IRR (%)</th>
                      <th className="py-3 px-3 text-center">Rantai Persetujuan</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                    {filteredKkfRows
                      .slice((kkfPage - 1) * kkfPerPage, kkfPage * kkfPerPage)
                      .map((row) => (
                        <tr key={row.id} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                            {row.application_number}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                            {row.customer_name}
                          </td>
                          <td className="py-2.5 px-3 font-mono">{row.unit_code}</td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400">{row.tariff_power}</td>
                          <td className="py-2.5 px-3 text-right font-mono font-bold text-emerald-600">
                            Rp {Math.round(row.capex_rab || 0).toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                                row.feasible
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                  : 'bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
                              }`}
                            >
                              {row.status_label}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">
                            {row.payback_months ? `${row.payback_months} bln (${row.payback_years} th)` : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono">
                            Rp {Math.round(row.npv || 0).toLocaleString('id-ID')}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono font-semibold">
                            {row.irr_percent !== null ? `${row.irr_percent}%` : '-'}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            {row.extended_required ? (
                              <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300">
                                Diperluas (&gt; 60 Bln)
                              </span>
                            ) : (
                              <span className="text-[11px] text-slate-500 font-mono">Standar</span>
                            )}
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}

            <TableFooter
              itemCount={filteredKkfRows.slice((kkfPage - 1) * kkfPerPage, kkfPage * kkfPerPage).length}
              total={filteredKkfRows.length}
              entityLabel="permohonan"
              page={kkfPage}
              perPage={kkfPerPage}
              onPage={setKkfPage}
              onPerPage={(n) => {
                setKkfPerPage(n)
                setKkfPage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          </div>
        </div>
      )}

      {/* TAB 8: ERP ANOMALIES */}
      {activeTab === 'erpAnomalies' && (
        <div className="space-y-4">
          {anomaliesError && <Alert kind="error">{anomaliesError}</Alert>}

          {/* ERP KPI Summary */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-900/40 bg-amber-50/20 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-amber-600 uppercase block">SKU MIMS Belum Terpetakan</span>
              <div className="text-xl font-bold text-amber-600 mt-1">
                {anomaliesData.summary?.unmapped_skus_count ?? 0} <span className="text-xs font-normal text-amber-500">Material</span>
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-xs">
              <span className="text-[10px] font-semibold text-slate-500 uppercase block">Total Kuantitas SKU Tanpa KHS</span>
              <div className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                {anomaliesData.summary?.unmapped_skus_total_qty?.toLocaleString('id-ID') ?? 0} <span className="text-xs font-normal text-slate-500">Unit</span>
              </div>
            </div>
            <div className="p-3 bg-white dark:bg-slate-900 border border-rose-200 dark:border-rose-900/40 bg-rose-50/20 rounded-xl shadow-xs">
              <span className="text-[10px] font-bold text-rose-600 uppercase block">Kegagalan Sinkronisasi Tarik Stok</span>
              <div className="text-xl font-bold text-rose-600 mt-1">
                {anomaliesData.summary?.recent_sync_failures_count ?? 0} <span className="text-xs font-normal text-rose-500">Insiden</span>
              </div>
            </div>
          </div>

          {/* Subtab Switcher */}
          <div className="flex items-center gap-2 border-b border-slate-200 dark:border-slate-800 pb-2">
            <button
              type="button"
              onClick={() => {
                setAnomalySubTab('UNMAPPED')
                setAnomalyPage(1)
              }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition ${
                anomalySubTab === 'UNMAPPED'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              SKU Belum Dipetakan ({anomaliesData.unmapped_materials?.length || 0})
            </button>
            <button
              type="button"
              onClick={() => {
                setAnomalySubTab('FAILURES')
                setAnomalyPage(1)
              }}
              className={`px-3 py-1 rounded-lg text-xs font-semibold cursor-pointer transition ${
                anomalySubTab === 'FAILURES'
                  ? 'bg-blue-600 text-white'
                  : 'bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-400'
              }`}
            >
              Log Kegagalan Sinkronisasi ({anomaliesData.sync_failures?.length || 0})
            </button>
          </div>

          {/* Table Container */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
            {loadingAnomalies ? (
              <div className="py-20 text-center text-slate-500">
                <Spinner size="lg" label="Memeriksa rekonsiliasi integrasi ERP MIMS..." />
              </div>
            ) : anomalySubTab === 'UNMAPPED' ? (
              (anomaliesData.unmapped_materials || []).length === 0 ? (
                <EmptyState
                  icon={IconCheckCircle}
                  title="Tidak ada anomali SKU"
                  description="Seluruh material MIMS telah terpetakan ke item KHS."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                        <th className="py-3 px-3">SKU ERP MIMS</th>
                        <th className="py-3 px-3">Nama Material MIMS</th>
                        <th className="py-3 px-3">Satuan</th>
                        <th className="py-3 px-3 text-right">Stok Siap</th>
                        <th className="py-3 px-3">Gudang</th>
                        <th className="py-3 px-3">Tanggal Cuplikan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                      {(anomaliesData.unmapped_materials || [])
                        .slice((anomalyPage - 1) * anomalyPerPage, anomalyPage * anomalyPerPage)
                        .map((row, idx) => (
                          <tr key={`${row.material_no}-${idx}`} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                            <td className="py-2.5 px-3 font-mono font-bold text-amber-600">
                              {row.material_no}
                            </td>
                            <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                              {row.material_name || '-'}
                            </td>
                            <td className="py-2.5 px-3 font-mono text-[11px] text-slate-500">{row.unit || '-'}</td>
                            <td className="py-2.5 px-3 text-right font-mono font-bold">
                              {row.stock_ready?.toLocaleString('id-ID')}
                            </td>
                            <td className="py-2.5 px-3">
                              <span className="font-mono text-xs">{row.warehouse_code}</span> - {row.warehouse_name}
                            </td>
                            <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                              {row.as_of}
                            </td>
                          </tr>
                        ))}
                    </tbody>
                  </table>
                </div>
              )
            ) : (
              (anomaliesData.sync_failures || []).length === 0 ? (
                <EmptyState
                  icon={IconCheckCircle}
                  title="Tidak ada kegagalan sinkronisasi"
                  description="Semua penarikan stok otomatis dari ERP MIMS berhasil tanpa insiden."
                />
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs border-collapse">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b">
                        <th className="py-3 px-3">Kode Gudang</th>
                        <th className="py-3 px-3">Nama Gudang</th>
                        <th className="py-3 px-3">Status</th>
                        <th className="py-3 px-3">Pesan Kesalahan</th>
                        <th className="py-3 px-3">Waktu Penarikan</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 text-xs">
                      {(anomaliesData.sync_failures || [])
                        .slice((anomalyPage - 1) * anomalyPerPage, anomalyPage * anomalyPerPage)
                        .map((f, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                          <td className="py-2.5 px-3 font-mono font-bold text-slate-900 dark:text-slate-100">
                            {f.warehouse_code}
                          </td>
                          <td className="py-2.5 px-3 font-semibold text-slate-800 dark:text-slate-200">
                            {f.warehouse_name}
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300">
                              {f.status}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 text-rose-600 text-xs font-mono">
                            {f.message || 'Gagal berkomunikasi dengan MIMS API'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                            {f.started_at}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}

            <TableFooter
              itemCount={
                anomalySubTab === 'UNMAPPED'
                  ? (anomaliesData.unmapped_materials || []).slice((anomalyPage - 1) * anomalyPerPage, anomalyPage * anomalyPerPage).length
                  : (anomaliesData.sync_failures || []).slice((anomalyPage - 1) * anomalyPerPage, anomalyPage * anomalyPerPage).length
              }
              total={
                anomalySubTab === 'UNMAPPED'
                  ? (anomaliesData.unmapped_materials || []).length
                  : (anomaliesData.sync_failures || []).length
              }
              entityLabel={anomalySubTab === 'UNMAPPED' ? 'SKU belum terpetakan' : 'kegagalan sinkronisasi'}
              page={anomalyPage}
              perPage={anomalyPerPage}
              onPage={setAnomalyPage}
              onPerPage={(n) => {
                setAnomalyPerPage(n)
                setAnomalyPage(1)
              }}
              perPageOptions={[10, 25, 50, 100]}
            />
          </div>
        </div>
      )}
      <ReportSettingsDrawer
        open={settingsOpen}
        section={activeTab === 'criticalStock' ? 'stock' : 'vendor'}
        settings={reportSettings}
        onClose={() => setSettingsOpen(false)}
        onSaved={(data) => {
          setReportSettings((prev) => ({ ...prev, ...data }))
          refreshCurrentTab()
        }}
      />
    </div>
  )
}
