import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Link } from 'react-router-dom'
import Drawer from '../../components/Drawer.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import Alert from '../../components/Alert.jsx'
import { warehousesApi } from '../../services/api.js'
import {
  IconRefresh,
  IconChart,
  IconDocument,
  IconBuilding,
  IconTruck,
  IconCheckCircle,
  IconAlertCircle,
  IconSearch,
  IconFolder,
  IconActivity,
  IconZap,
  IconClock,
} from '../../components/icons.jsx'

/**
 * Drawer Detail Material & Riwayat Mutasi (Penerimaan & Pengeluaran)
 * Serta Grafik dan Tabel Proyeksi Kebutuhan (Forecasting).
 * Memuat data material lengkap, status stok konsolidasi & per gudang,
 * histori mutasi mingguan & bulanan, serta proyeksi kebutuhan AI masa depan.
 */
export default function MaterialStockDetailDrawer({
  isOpen,
  onClose,
  materialSummary,
  warehouseIds = [],
  warehouses = [],
  initialTab = 'movements',
  forecastData = null,
}) {
  const [activeTab, setActiveTab] = useState(initialTab || 'movements') // 'forecast' | 'movements' | 'warehouses' | 'transactions' | 'specs'
  const [periodType, setPeriodType] = useState('monthly') // 'monthly' | 'weekly'
  const [viewMode, setViewMode] = useState('chart') // 'chart' | 'table'
  const [forecastViewMode, setForecastViewMode] = useState('chart') // 'chart' | 'table'
  const [transactionKind, setTransactionKind] = useState('issues') // 'issues' | 'receipts'
  const [hoveredIndex, setHoveredIndex] = useState(null)
  const [hoveredForecastMonth, setHoveredForecastMonth] = useState(null)
  const [searchWh, setSearchWh] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailData, setDetailData] = useState(null)

  const khsCode = materialSummary?.khs_code || materialSummary?.code || materialSummary?.item_code || ''
  const warehouseKey = useMemo(() => (warehouseIds || []).join(','), [warehouseIds])

  const loadDetail = useCallback(async () => {
    if (!khsCode) return
    setLoading(true)
    setError('')
    try {
      const selectedWhIds = warehouseKey ? warehouseKey.split(',') : []
      const res = await warehousesApi.materialDetail(khsCode, selectedWhIds, {
        period_months: 12,
        period_weeks: 16,
      })
      setDetailData(res?.data || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat rincian mutasi dan spesifikasi material.')
    } finally {
      setLoading(false)
    }
  }, [khsCode, warehouseKey])

  const prevOpenRef = useRef(false)
  useEffect(() => {
    if (isOpen && !prevOpenRef.current) {
      setActiveTab(initialTab || 'movements')
      if (khsCode) {
        loadDetail()
      }
    } else if (!isOpen && prevOpenRef.current) {
      setDetailData(null)
      setError('')
      setHoveredIndex(null)
      setHoveredForecastMonth(null)
    }
    prevOpenRef.current = isOpen
  }, [isOpen, khsCode, initialTab, loadDetail])

  // Material attributes (merge summary & detailed backend data)
  const mat = detailData?.material || {}
  const position = detailData?.position || {
    on_hand: materialSummary?.on_hand ?? 0,
    reserved: materialSummary?.reserved ?? 0,
    incoming: materialSummary?.incoming ?? 0,
    safety: materialSummary?.safety ?? 0,
    allocated_after: materialSummary?.allocated_after ?? 0,
    kr_supply: materialSummary?.kr_supply ?? 0,
    available: materialSummary?.available ?? 0,
    available_with_kr: materialSummary?.available_with_kr ?? 0,
  }

  const movements = detailData?.movements || {}
  const monthlyBuckets = movements.monthly || []
  const weeklyBuckets = movements.weekly || []
  const summary = movements.summary || {
    total_in: 0,
    total_out: 0,
    net_total: 0,
    avg_monthly_out: 0,
    avg_weekly_out: 0,
  }

  const currentBuckets = periodType === 'monthly' ? monthlyBuckets : weeklyBuckets

  // Forecast normalization and stock runway calculation
  const effectiveForecast = useMemo(() => {
    if (forecastData) {
      let totals = forecastData.totals
      let months = forecastData.months
      if (!totals && forecastData.total) {
        const t = forecastData.total
        totals = {
          '3': { p10: Math.round(t.p10 * 0.25), p50: Math.round(t.p50 * 0.25), p90: Math.round(t.p90 * 0.25) },
          '6': { p10: Math.round(t.p10 * 0.5), p50: Math.round(t.p50 * 0.5), p90: Math.round(t.p90 * 0.5) },
          '12': t,
        }
      }
      if ((!months || months.length === 0) && totals?.['12']) {
        const m12 = totals['12']
        const now = new Date()
        months = Array.from({ length: 12 }, (_, i) => {
          const d = new Date(now.getFullYear(), now.getMonth() + i + 1, 1)
          const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
          return {
            month: ym,
            p10: Math.round(((m12.p10 || 0) / 12) * 10) / 10,
            p50: Math.round(((m12.p50 || 0) / 12) * 10) / 10,
            p90: Math.round(((m12.p90 || 0) / 12) * 10) / 10,
          }
        })
      }
      return {
        ...forecastData,
        totals: totals || {},
        months: months || [],
      }
    }
    return detailData?.forecast || null
  }, [forecastData, detailData?.forecast])

  const forecastAnalysis = useMemo(() => {
    if (!effectiveForecast) return null
    const months = effectiveForecast.months || []
    const totals = effectiveForecast.totals || {}
    const availableStock = position.available ?? position.on_hand ?? 0

    let cum = 0
    let deficitMonthIndex = null
    const monthlyList = months.map((m, idx) => {
      const p50 = Number(m.p50) || 0
      cum += p50
      const remaining = availableStock - cum
      if (remaining < 0 && deficitMonthIndex === null) {
        deficitMonthIndex = idx + 1
      }
      let monthLabel = `M+${idx + 1}`
      if (m.month) {
        try {
          const parts = m.month.split('-')
          if (parts.length === 2) {
            const d = new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, 1)
            monthLabel = d.toLocaleDateString('id-ID', { month: 'short', year: '2-digit' })
          }
        } catch {
          // fallback to M+
        }
      }
      return {
        ...m,
        index: idx + 1,
        monthLabel,
        p10: Number(m.p10) || 0,
        p50,
        p90: Number(m.p90) || 0,
        cumulativeDemand: Math.round(cum * 10) / 10,
        remainingStock: Math.round(remaining * 10) / 10,
        isDeficit: remaining < 0,
      }
    })

    let status = 'SAFE'
    let label = 'Stok Aman'
    let desc = 'Stok mencukupi kebutuhan proyeksi 12 bulan ke depan'
    let badgeCls = 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800'

    if (availableStock <= 0) {
      status = 'CRITICAL'
      label = 'Stok Habis / Kosong'
      desc = 'Tidak ada stok fisik tersedia saat ini'
      badgeCls = 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
    } else if (deficitMonthIndex === 1) {
      status = 'CRITICAL'
      label = 'Kritis (< 1 Bulan)'
      desc = 'Stok diperkirakan habis pada bulan pertama proyeksi'
      badgeCls = 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
    } else if (deficitMonthIndex !== null && deficitMonthIndex <= 3) {
      status = 'CRITICAL'
      label = `Kritis (~${deficitMonthIndex - 1} Bulan)`
      desc = `Stok diperkirakan defisit pada bulan ke-${deficitMonthIndex}`
      badgeCls = 'bg-rose-100 text-rose-800 border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800'
    } else if (deficitMonthIndex !== null && deficitMonthIndex <= 6) {
      status = 'WARNING'
      label = `Waspada (~${deficitMonthIndex - 1} Bulan)`
      desc = `Stok mencukupi s.d. bulan ke-${deficitMonthIndex - 1}, butuh pengadaan sebelum bulan ke-${deficitMonthIndex}`
      badgeCls = 'bg-amber-100 text-amber-800 border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800'
    } else if (deficitMonthIndex !== null) {
      status = 'SAFE'
      label = `Cukup (~${deficitMonthIndex - 1} Bulan)`
      desc = `Stok mencukupi untuk ${deficitMonthIndex - 1} bulan ke depan`
      badgeCls = 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800'
    }

    return {
      monthlyList,
      totals,
      availableStock,
      deficitMonthIndex,
      status,
      label,
      desc,
      badgeCls,
    }
  }, [effectiveForecast, position.available, position.on_hand])

  // Chart calculations
  const chartMax = useMemo(() => {
    if (!currentBuckets || currentBuckets.length === 0) return 10
    const maxVal = Math.max(
      ...currentBuckets.map((b) => Math.max(b.qty_in || 0, b.qty_out || 0)),
      1
    )
    return Math.ceil(maxVal * 1.15) || 10
  }, [currentBuckets])

  const warehouseBreakdown = useMemo(() => {
    const list = detailData?.warehouse_breakdown || []
    if (!searchWh) return list
    const q = searchWh.toLowerCase()
    return list.filter(
      (w) =>
        (w.warehouse_code || '').toLowerCase().includes(q) ||
        (w.warehouse_name || '').toLowerCase().includes(q) ||
        (w.unit_name || '').toLowerCase().includes(q)
    )
  }, [detailData?.warehouse_breakdown, searchWh])

  const recentTransactions = detailData?.recent_transactions || { receipts: [], issues: [] }

  const materialCode = mat.khs_code || khsCode
  const candidateName = mat.khs_name || materialSummary?.khs_name || materialSummary?.item_label || ''
  const hasDistinctName = candidateName && String(candidateName).trim().toLowerCase() !== String(materialCode).trim().toLowerCase()
  const materialName = hasDistinctName ? candidateName : ''
  const ulpName = materialSummary?.ulp_name || materialSummary?.forecast?.unit_name || null
  const realUnit = mat.unit || (materialSummary?.unit && materialSummary?.unit !== ulpName ? materialSummary?.unit : null) || '-'

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      size="max-w-4xl"
      title={
        <div className="flex items-center gap-2.5 flex-wrap">
          <span className="font-mono text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-0.5 rounded text-sm font-bold border border-blue-200 dark:border-blue-900">
            {materialCode}
          </span>
          {materialName ? (
            <span className="text-slate-900 dark:text-slate-100 font-bold text-base md:text-lg">
              {materialName}
            </span>
          ) : null}
        </div>
      }
      subtitle={
        <span className="flex items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
          <span>Satuan: <strong className="text-slate-700 dark:text-slate-200">{realUnit}</strong></span>
          {ulpName && (
            <>
              <span>•</span>
              <span>Unit Kerja: <strong className="text-slate-700 dark:text-slate-200">{ulpName}</strong></span>
            </>
          )}
          <span>•</span>
          <span>Kategori: <strong className="text-slate-700 dark:text-slate-200">{mat.category || 'Standar PLN'}</strong></span>
          <span>•</span>
          <span>Versi: <strong className="text-slate-700 dark:text-slate-200">v{mat.version_number || 1}</strong></span>
          {mat.is_exempt ? (
            <span className="bg-amber-100 text-amber-800 text-[10px] font-semibold px-2 py-0.5 rounded">
              Dikecualikan dari SKU
            </span>
          ) : (
            <span className="bg-emerald-100 text-emerald-800 text-[10px] font-semibold px-2 py-0.5 rounded">
              {(mat.mapped_skus || []).length > 0
                ? `${mat.mapped_skus.length} SKU ERP Terpetakan`
                : 'Belum Ada Pemetaan SKU'}
            </span>
          )}
        </span>
      }
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="text-[11px] text-slate-500">
            Data mutasi disinkronkan dari riwayat transaksi MIMS (Penerimaan & Pengeluaran).
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              icon={IconRefresh}
              loading={loading}
              onClick={loadDetail}
            >
              Segarkan
            </Button>
            <Button variant="primary" size="sm" onClick={onClose}>
              Tutup
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-5 pb-6">
        {error && (
          <Alert variant="danger" title="Gagal Memuat Detail">
            {error}
          </Alert>
        )}

        {/* Top KPI Cards Grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2.5">
          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40">
            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Stok Fisik
            </div>
            <div className="text-lg font-bold font-mono text-slate-800 dark:text-slate-100 mt-1">
              {(position.on_hand ?? 0).toLocaleString('id-ID')}
            </div>
            <div className="text-[10px] text-slate-400">On Hand ERP</div>
          </div>

          <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-900/60 bg-amber-50/50 dark:bg-amber-950/20">
            <div className="text-[10px] uppercase font-bold text-amber-700 dark:text-amber-400 tracking-wider">
              Reservasi
            </div>
            <div className="text-lg font-bold font-mono text-amber-600 dark:text-amber-400 mt-1">
              {(position.reserved ?? 0).toLocaleString('id-ID')}
            </div>
            <div className="text-[10px] text-amber-600/70">Terikat Agenda/WO</div>
          </div>

          <div className="p-3 rounded-lg border border-emerald-200 dark:border-emerald-900/60 bg-emerald-50/50 dark:bg-emerald-950/20">
            <div className="text-[10px] uppercase font-bold text-emerald-700 dark:text-emerald-400 tracking-wider">
              Pasokan Masuk
            </div>
            <div className="text-lg font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-1">
              {(position.incoming ?? 0).toLocaleString('id-ID')}
            </div>
            <div className="text-[10px] text-emerald-600/70">Dalam Transit/PO</div>
          </div>

          <div className="p-3 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40">
            <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
              Stok Pengaman
            </div>
            <div className="text-lg font-bold font-mono text-slate-600 dark:text-slate-300 mt-1">
              {(position.safety ?? 0).toLocaleString('id-ID')}
            </div>
            <div className="text-[10px] text-slate-400">Safety Buffer</div>
          </div>

          <div className="p-3 rounded-lg border border-purple-200 dark:border-purple-900/60 bg-purple-50/50 dark:bg-purple-950/20">
            <div className="text-[10px] uppercase font-bold text-purple-700 dark:text-purple-400 tracking-wider">
              Pasokan KR
            </div>
            <div className="text-lg font-bold font-mono text-purple-600 dark:text-purple-400 mt-1">
              {(position.kr_supply ?? 0).toLocaleString('id-ID')}
            </div>
            <div className="text-[10px] text-purple-600/70">Kontrak Rinci Tiang</div>
          </div>

          <div className="p-3 rounded-lg border-2 border-blue-500/80 bg-blue-50/80 dark:bg-blue-950/50 shadow-sm">
            <div className="text-[10px] uppercase font-bold text-blue-800 dark:text-blue-300 tracking-wider">
              Stok Tersedia
            </div>
            <div className={`text-lg font-bold font-mono mt-1 ${position.available > 0 ? 'text-blue-700 dark:text-blue-300' : 'text-rose-600'}`}>
              {(position.available ?? 0).toLocaleString('id-ID')}
            </div>
            <div className="text-[10px] text-blue-700 dark:text-blue-400 font-medium">
              +KR: {(position.available_with_kr ?? position.available ?? 0).toLocaleString('id-ID')}
            </div>
          </div>
        </div>

        {/* Tab Selection */}
        <div className="border-b border-slate-200 dark:border-slate-800">
          <nav className="flex space-x-4 text-xs font-medium overflow-x-auto" aria-label="Tabs Detail Material">
            <button
              type="button"
              onClick={() => setActiveTab('forecast')}
              className={`py-2 px-1 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'forecast'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <IconActivity size={16} />
              <span>Proyeksi Kebutuhan (Forecast)</span>
              {effectiveForecast && (
                <span className="ml-1 inline-flex items-center px-1.5 py-0.2 rounded-full text-[10px] font-semibold bg-blue-100 text-blue-700 dark:bg-blue-900/60 dark:text-blue-300">
                  AI
                </span>
              )}
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('movements')}
              className={`py-2 px-1 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'movements'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <IconChart size={16} />
              Mutasi Penerimaan & Pengeluaran
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('warehouses')}
              className={`py-2 px-1 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'warehouses'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <IconBuilding size={16} />
              Stok per Gudang ({warehouseBreakdown.length})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('transactions')}
              className={`py-2 px-1 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'transactions'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <IconDocument size={16} />
              Dokumen Transaksi MIMS
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('specs')}
              className={`py-2 px-1 border-b-2 transition-colors flex items-center gap-1.5 whitespace-nowrap ${
                activeTab === 'specs'
                  ? 'border-blue-600 text-blue-600 dark:text-blue-400 font-semibold'
                  : 'border-transparent text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <IconFolder size={16} />
              Spesifikasi & SKU ERP
            </button>
          </nav>
        </div>

        {/* TAB FORECAST: GRAFIK & TABEL PROYEKSI KEBUTUHAN */}
        {activeTab === 'forecast' && (
          <div className="space-y-4">
            {!effectiveForecast ? (
              <div className="p-8 text-center rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50/50 dark:bg-slate-900/30 space-y-3">
                <div className="mx-auto w-12 h-12 rounded-full bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center">
                  <IconActivity size={24} />
                </div>
                <h4 className="font-semibold text-slate-900 dark:text-slate-100">
                  Belum Ada Hasil Forecast untuk Material Ini
                </h4>
                <p className="text-xs text-slate-500 dark:text-slate-400 max-w-md mx-auto">
                  Model deep learning belum memproses proyeksi untuk nomor material ini, atau riwayat transaksi material MIMS belum mencukupi ambang batas latihan (minimal 24 bulan).
                </p>
                <div className="pt-2">
                  <Link
                    to="/forecast"
                    className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition"
                  >
                    <span>Buka Menu Forecast Beban & Kebutuhan</span>
                    <IconZap size={14} />
                  </Link>
                </div>
              </div>
            ) : (
              <>
                {/* KPI Cards Ringkasan Proyeksi & Analisis Kecukupan Stok */}
                <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  <div className="p-3.5 rounded-xl border border-blue-200/90 dark:border-blue-900/60 bg-blue-50/60 dark:bg-blue-950/30 flex flex-col justify-between">
                    <div className="text-[10px] uppercase font-bold text-blue-700 dark:text-blue-300 tracking-wider">
                      Proyeksi 3 Bulan (p50)
                    </div>
                    <div className="text-2xl font-bold font-mono text-blue-900 dark:text-blue-100 mt-1">
                      {(forecastAnalysis.totals?.['3']?.p50 ?? 0).toLocaleString('id-ID')}
                      <span className="text-xs font-normal text-blue-600 dark:text-blue-400 ml-1">
                        {mat.unit || materialSummary?.unit || ''}
                      </span>
                    </div>
                    <div className="text-[11px] text-blue-700/80 dark:text-blue-300/80 mt-1">
                      Rentang: {(forecastAnalysis.totals?.['3']?.p10 ?? 0).toLocaleString('id-ID')} – {(forecastAnalysis.totals?.['3']?.p90 ?? 0).toLocaleString('id-ID')}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl border border-indigo-200/90 dark:border-indigo-900/60 bg-indigo-50/60 dark:bg-indigo-950/30 flex flex-col justify-between">
                    <div className="text-[10px] uppercase font-bold text-indigo-700 dark:text-indigo-300 tracking-wider">
                      Proyeksi 6 Bulan (p50)
                    </div>
                    <div className="text-2xl font-bold font-mono text-indigo-900 dark:text-indigo-100 mt-1">
                      {(forecastAnalysis.totals?.['6']?.p50 ?? 0).toLocaleString('id-ID')}
                      <span className="text-xs font-normal text-indigo-600 dark:text-indigo-400 ml-1">
                        {mat.unit || materialSummary?.unit || ''}
                      </span>
                    </div>
                    <div className="text-[11px] text-indigo-700/80 dark:text-indigo-300/80 mt-1">
                      Rentang: {(forecastAnalysis.totals?.['6']?.p10 ?? 0).toLocaleString('id-ID')} – {(forecastAnalysis.totals?.['6']?.p90 ?? 0).toLocaleString('id-ID')}
                    </div>
                  </div>

                  <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex flex-col justify-between">
                    <div className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                      Proyeksi 12 Bulan (p50)
                    </div>
                    <div className="text-2xl font-bold font-mono text-slate-900 dark:text-slate-100 mt-1">
                      {(forecastAnalysis.totals?.['12']?.p50 ?? 0).toLocaleString('id-ID')}
                      <span className="text-xs font-normal text-slate-500 ml-1">
                        {mat.unit || materialSummary?.unit || ''}
                      </span>
                    </div>
                    <div className="text-[11px] text-slate-500 mt-1">
                      Rentang: {(forecastAnalysis.totals?.['12']?.p10 ?? 0).toLocaleString('id-ID')} – {(forecastAnalysis.totals?.['12']?.p90 ?? 0).toLocaleString('id-ID')}
                    </div>
                  </div>

                  {/* Kartu Kecukupan Stok / Stock Runway */}
                  <div className={`p-3.5 rounded-xl border flex flex-col justify-between ${
                    forecastAnalysis.status === 'CRITICAL'
                      ? 'border-rose-300 dark:border-rose-800/80 bg-rose-50/70 dark:bg-rose-950/40'
                      : forecastAnalysis.status === 'WARNING'
                      ? 'border-amber-300 dark:border-amber-800/80 bg-amber-50/70 dark:bg-amber-950/40'
                      : 'border-emerald-300 dark:border-emerald-800/80 bg-emerald-50/70 dark:bg-emerald-950/40'
                  }`}>
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-slate-600 dark:text-slate-300">
                        Kecukupan Stok (Runway)
                      </span>
                      <span className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold ${forecastAnalysis.badgeCls}`}>
                        {forecastAnalysis.label}
                      </span>
                    </div>
                    <div className="mt-2 text-xs leading-relaxed text-slate-700 dark:text-slate-200">
                      {forecastAnalysis.desc}
                    </div>
                    <div className="mt-2 pt-2 border-t border-slate-200/60 dark:border-slate-800/60 flex items-center justify-between text-[11px] text-slate-500 dark:text-slate-400">
                      <span>Stok Tersedia:</span>
                      <span className="font-bold font-mono text-slate-800 dark:text-slate-200">
                        {(forecastAnalysis.availableStock).toLocaleString('id-ID')} {mat.unit || materialSummary?.unit || ''}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Sub-toolbar: Toggle Grafik vs Tabel Proyeksi */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
                  <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-300">
                    <IconActivity className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="font-semibold">Proyeksi 12 Bulan ke Depan:</span>
                    <span className="text-slate-500 dark:text-slate-400 text-[11px]">
                      Pita rentang p10–p90 &amp; nilai tengah (p50)
                    </span>
                  </div>

                  <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-0.5 rounded-md border border-slate-200 dark:border-slate-700 shadow-sm text-xs">
                    <button
                      type="button"
                      onClick={() => setForecastViewMode('chart')}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                        forecastViewMode === 'chart'
                          ? 'bg-blue-600 text-white font-semibold shadow-xs'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      Grafik Visual
                    </button>
                    <button
                      type="button"
                      onClick={() => setForecastViewMode('table')}
                      className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                        forecastViewMode === 'table'
                          ? 'bg-blue-600 text-white font-semibold shadow-xs'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                      }`}
                    >
                      Tabel Rincian
                    </button>
                  </div>
                </div>

                {/* Mode Tampilan: Grafik Proyeksi (Chart) */}
                {forecastViewMode === 'chart' && (
                  <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
                    {/* SVG Chart Proyeksi */}
                    {(() => {
                      const list = forecastAnalysis.monthlyList
                      const maxDemand = Math.max(...list.map((m) => m.p90 || 0), 1)
                      const maxScale = Math.max(maxDemand * 1.15, (forecastAnalysis.availableStock > 0 ? forecastAnalysis.availableStock * 1.05 : 0), 10)
                      const svgW = 740
                      const svgH = 240
                      const padLeft = 55
                      const padRight = 25
                      const padTop = 25
                      const padBottom = 40
                      const chartW = svgW - padLeft - padRight
                      const chartH = svgH - padTop - padBottom

                      const getX = (idx) => padLeft + (idx / Math.max(list.length - 1, 1)) * chartW
                      const getY = (val) => padTop + chartH - Math.min(Math.max((val / maxScale) * chartH, 0), chartH)

                      const upperPoints = list.map((m, idx) => `${getX(idx)},${getY(m.p90)}`).join(' ')
                      const lowerPoints = [...list].reverse().map((m, idx) => {
                        const originalIdx = list.length - 1 - idx
                        return `${getX(originalIdx)},${getY(m.p10)}`
                      }).join(' ')
                      const polygonPoints = `${upperPoints} ${lowerPoints}`
                      const p50LinePoints = list.map((m, idx) => `${getX(idx)},${getY(m.p50)}`).join(' ')

                      const yStock = forecastAnalysis.availableStock > 0 ? getY(forecastAnalysis.availableStock) : null

                      return (
                        <div className="relative">
                          <svg
                            viewBox={`0 0 ${svgW} ${svgH}`}
                            className="w-full h-64 overflow-visible"
                            role="img"
                            aria-label="Grafik Proyeksi Kebutuhan Material 12 Bulan"
                          >
                            {/* Garis Grid Horizontal */}
                            {[0.25, 0.5, 0.75, 1.0].map((ratio) => {
                              const y = padTop + chartH - ratio * chartH
                              const val = Math.round(maxScale * ratio)
                              return (
                                <g key={ratio}>
                                  <line
                                    x1={padLeft}
                                    y1={y}
                                    x2={svgW - padRight}
                                    y2={y}
                                    stroke="currentColor"
                                    className="text-slate-100 dark:text-slate-800"
                                    strokeDasharray="3 3"
                                  />
                                  <text
                                    x={padLeft - 8}
                                    y={y + 3}
                                    textAnchor="end"
                                    fontSize="10"
                                    className="fill-slate-400 font-mono"
                                  >
                                    {val.toLocaleString('id-ID')}
                                  </text>
                                </g>
                              )
                            })}

                            {/* Garis Referensi Stok Tersedia */}
                            {yStock !== null && yStock >= padTop && yStock <= padTop + chartH && (
                              <g>
                                <line
                                  x1={padLeft}
                                  y1={yStock}
                                  x2={svgW - padRight}
                                  y2={yStock}
                                  stroke="#10b981"
                                  strokeWidth="1.8"
                                  strokeDasharray="4 3"
                                  opacity="0.9"
                                />
                                <text
                                  x={svgW - padRight}
                                  y={yStock - 5}
                                  textAnchor="end"
                                  fontSize="9.5"
                                  fill="#059669"
                                  fontWeight="bold"
                                >
                                  Stok Tersedia Saat Ini ({(forecastAnalysis.availableStock).toLocaleString('id-ID')})
                                </text>
                              </g>
                            )}

                            {/* Area Pita Rentang Kepercayaan (p10–p90) */}
                            <polygon
                              points={polygonPoints}
                              fill="rgba(59, 130, 246, 0.18)"
                              className="dark:fill-blue-500/20"
                            />

                            {/* Garis Tren Median p50 */}
                            <polyline
                              points={p50LinePoints}
                              fill="none"
                              stroke="#2563eb"
                              strokeWidth="2.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                            />

                            {/* Titik Interaktif per Bulan & Label Sumbu X */}
                            {list.map((m, idx) => {
                              const x = getX(idx)
                              const y = getY(m.p50)
                              const isHovered = hoveredForecastMonth === idx

                              return (
                                <g key={m.month || idx}>
                                  {/* Sumbu X Label */}
                                  <text
                                    x={x}
                                    y={svgH - padBottom + 16}
                                    textAnchor="middle"
                                    fontSize="10"
                                    className={`font-medium ${isHovered ? 'fill-blue-600 dark:fill-blue-400 font-bold' : 'fill-slate-500 dark:fill-slate-400'}`}
                                  >
                                    {m.monthLabel}
                                  </text>

                                  {/* Hover Area Vertikal */}
                                  <rect
                                    x={x - (chartW / list.length) / 2}
                                    y={padTop}
                                    width={chartW / list.length}
                                    height={chartH}
                                    fill="transparent"
                                    className="cursor-pointer"
                                    onMouseEnter={() => setHoveredForecastMonth(idx)}
                                    onMouseLeave={() => setHoveredForecastMonth(null)}
                                  />

                                  {/* Garis Bantu Hover Vertikal */}
                                  {isHovered && (
                                    <line
                                      x1={x}
                                      y1={padTop}
                                      x2={x}
                                      y2={padTop + chartH}
                                      stroke="#3b82f6"
                                      strokeWidth="1.2"
                                      strokeDasharray="2 2"
                                      opacity="0.7"
                                    />
                                  )}

                                  {/* Lingkaran Titik p50 */}
                                  <circle
                                    cx={x}
                                    cy={y}
                                    r={isHovered ? 5.5 : 3.5}
                                    fill={isHovered ? '#1d4ed8' : '#2563eb'}
                                    stroke="#ffffff"
                                    strokeWidth="1.8"
                                    className="transition-all"
                                  />
                                </g>
                              )
                            })}
                          </svg>

                          {/* Tooltip Card Saat Titik Bulan Di-hover */}
                          {hoveredForecastMonth !== null && list[hoveredForecastMonth] && (
                            <div className="mt-2 p-3 rounded-lg bg-slate-900 text-white text-xs shadow-lg flex flex-wrap items-center justify-between gap-4">
                              <div className="flex items-center gap-2">
                                <span className="font-bold text-blue-400">
                                  Bulan: {list[hoveredForecastMonth].monthLabel} ({list[hoveredForecastMonth].month || `Bulan ke-${hoveredForecastMonth + 1}`})
                                </span>
                              </div>
                              <div className="flex items-center gap-4 text-xs font-mono">
                                <div>
                                  <span className="text-slate-400 font-sans">Kebutuhan (p50): </span>
                                  <strong className="text-emerald-400">{(list[hoveredForecastMonth].p50).toLocaleString('id-ID')}</strong>
                                </div>
                                <div>
                                  <span className="text-slate-400 font-sans">Rentang p10–p90: </span>
                                  <span>{(list[hoveredForecastMonth].p10).toLocaleString('id-ID')} – {(list[hoveredForecastMonth].p90).toLocaleString('id-ID')}</span>
                                </div>
                                <div>
                                  <span className="text-slate-400 font-sans">Akumulasi s.d. Bulan Ini: </span>
                                  <strong className="text-amber-300">{(list[hoveredForecastMonth].cumulativeDemand).toLocaleString('id-ID')}</strong>
                                </div>
                                <div>
                                  <span className="text-slate-400 font-sans">Estimasi Sisa Stok: </span>
                                  <strong className={list[hoveredForecastMonth].remainingStock < 0 ? 'text-rose-400' : 'text-blue-300'}>
                                    {(list[hoveredForecastMonth].remainingStock).toLocaleString('id-ID')}
                                  </strong>
                                </div>
                              </div>
                            </div>
                          )}

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] text-slate-500 dark:text-slate-400 border-t border-slate-100 dark:border-slate-800">
                            <div className="flex items-center gap-4">
                              <span className="flex items-center gap-1.5">
                                <span className="w-3 h-0.5 bg-blue-600 rounded"></span>
                                Nilai Tengah (p50)
                              </span>
                              <span className="flex items-center gap-1.5">
                                <span className="w-3 h-2 bg-blue-500/20 border border-blue-400/40 rounded-xs"></span>
                                Rentang Ketidakpastian (p10–p90)
                              </span>
                              {forecastAnalysis.availableStock > 0 && (
                                <span className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400">
                                  <span className="w-3 h-0.5 border-t border-dashed border-emerald-500"></span>
                                  Garis Stok Tersedia Saat Ini
                                </span>
                              )}
                            </div>
                            <div>Arahkan kursor ke titik grafik untuk rincian per bulan.</div>
                          </div>
                        </div>
                      )
                    })()}
                  </div>
                )}

                {/* Mode Tampilan: Tabel Rincian Proyeksi */}
                {forecastViewMode === 'table' && (
                  <div className="overflow-x-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                    <table className="w-full text-left text-xs">
                      <thead className="bg-slate-50/90 dark:bg-slate-850 text-slate-500 dark:text-slate-400 font-semibold uppercase tracking-wider border-b border-slate-200 dark:border-slate-800">
                        <tr>
                          <th className="px-4 py-3">Periode Bulan</th>
                          <th className="px-3 py-3 text-right">Nilai Tengah (p50)</th>
                          <th className="px-3 py-3 text-right">Rentang Bawah (p10)</th>
                          <th className="px-3 py-3 text-right">Rentang Atas (p90)</th>
                          <th className="px-3 py-3 text-right">Kebutuhan Kumulatif</th>
                          <th className="px-3 py-3 text-right">Estimasi Sisa Stok</th>
                          <th className="px-4 py-3 text-center">Status Stok</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                        {forecastAnalysis.monthlyList.map((m) => (
                          <tr key={m.index} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition">
                            <td className="px-4 py-3 font-medium text-slate-900 dark:text-slate-100">
                              <span>{m.monthLabel}</span>
                              {m.month && (
                                <span className="ml-1.5 text-[11px] text-slate-400 font-mono">
                                  ({m.month})
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-3 text-right font-bold text-blue-600 dark:text-blue-400 font-mono">
                              {(m.p50).toLocaleString('id-ID')}
                            </td>
                            <td className="px-3 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">
                              {(m.p10).toLocaleString('id-ID')}
                            </td>
                            <td className="px-3 py-3 text-right text-slate-600 dark:text-slate-400 font-mono">
                              {(m.p90).toLocaleString('id-ID')}
                            </td>
                            <td className="px-3 py-3 text-right font-semibold text-slate-700 dark:text-slate-300 font-mono">
                              {(m.cumulativeDemand).toLocaleString('id-ID')}
                            </td>
                            <td className={`px-3 py-3 text-right font-bold font-mono ${
                              m.isDeficit ? 'text-rose-600 dark:text-rose-400' : 'text-slate-900 dark:text-slate-100'
                            }`}>
                              {(m.remainingStock).toLocaleString('id-ID')}
                            </td>
                            <td className="px-4 py-3 text-center whitespace-nowrap">
                              {m.isDeficit ? (
                                <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800">
                                  Defisit / Habis
                                </span>
                              ) : (
                                <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/60 dark:text-emerald-300 dark:border-emerald-800">
                                  Tercukupi
                                </span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot className="bg-slate-50 dark:bg-slate-850 font-semibold border-t-2 border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200">
                        <tr>
                          <td className="px-4 py-3">Total Proyeksi 12 Bulan</td>
                          <td className="px-3 py-3 text-right font-mono text-blue-700 dark:text-blue-300">
                            {(forecastAnalysis.totals?.['12']?.p50 ?? 0).toLocaleString('id-ID')}
                          </td>
                          <td className="px-3 py-3 text-right font-mono">
                            {(forecastAnalysis.totals?.['12']?.p10 ?? 0).toLocaleString('id-ID')}
                          </td>
                          <td className="px-3 py-3 text-right font-mono">
                            {(forecastAnalysis.totals?.['12']?.p90 ?? 0).toLocaleString('id-ID')}
                          </td>
                          <td className="px-3 py-3 text-right font-mono" colSpan="3">
                            Stok Saat Ini: {(forecastAnalysis.availableStock).toLocaleString('id-ID')} {mat.unit || materialSummary?.unit || ''}
                          </td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* TAB 1: MUTASI PENERIMAAN & PENGELUARAN */}
        {activeTab === 'movements' && (
          <div className="space-y-4">
            {/* Toolbar Filters: Periode (Bulan / Minggu) & Tampilan (Chart / Table) */}
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 dark:bg-slate-900/60 p-2.5 rounded-lg border border-slate-200 dark:border-slate-800">
              <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-0.5 rounded-md border border-slate-200 dark:border-slate-700 shadow-sm text-xs">
                <span className="text-[11px] font-semibold text-slate-500 px-2">Agregasi:</span>
                <button
                  type="button"
                  onClick={() => { setPeriodType('monthly'); setHoveredIndex(null) }}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    periodType === 'monthly'
                      ? 'bg-blue-600 text-white font-semibold shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  Per Bulan (12 Bulan)
                </button>
                <button
                  type="button"
                  onClick={() => { setPeriodType('weekly'); setHoveredIndex(null) }}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    periodType === 'weekly'
                      ? 'bg-blue-600 text-white font-semibold shadow-xs'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  Per Minggu (16 Minggu)
                </button>
              </div>

              <div className="flex items-center gap-1 bg-white dark:bg-slate-800 p-0.5 rounded-md border border-slate-200 dark:border-slate-700 shadow-sm text-xs">
                <span className="text-[11px] font-semibold text-slate-500 px-2">Format:</span>
                <button
                  type="button"
                  onClick={() => setViewMode('chart')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    viewMode === 'chart'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  Grafik Visual
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode('table')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    viewMode === 'table'
                      ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 font-semibold'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-700'
                  }`}
                >
                  Tabel Rincian
                </button>
              </div>
            </div>

            {/* Aggregation Summary Banner */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="p-2.5 rounded-lg border border-emerald-200 dark:border-emerald-900/50 bg-emerald-50/40 dark:bg-emerald-950/10">
                <div className="text-[10px] text-emerald-800 dark:text-emerald-400 font-semibold uppercase">Total Masuk (Penerimaan)</div>
                <div className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                  +{(summary.total_in || 0).toLocaleString('id-ID')} {mat.unit || ''}
                </div>
              </div>
              <div className="p-2.5 rounded-lg border border-rose-200 dark:border-rose-900/50 bg-rose-50/40 dark:bg-rose-950/10">
                <div className="text-[10px] text-rose-800 dark:text-rose-400 font-semibold uppercase">Total Keluar (Pengeluaran)</div>
                <div className="text-base font-bold font-mono text-rose-600 dark:text-rose-400 mt-0.5">
                  -{(summary.total_out || 0).toLocaleString('id-ID')} {mat.unit || ''}
                </div>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/40">
                <div className="text-[10px] text-slate-500 font-semibold uppercase">Selisih Bersih (Net)</div>
                <div className={`text-base font-bold font-mono mt-0.5 ${summary.net_total >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {summary.net_total > 0 ? '+' : ''}{(summary.net_total || 0).toLocaleString('id-ID')} {mat.unit || ''}
                </div>
              </div>
              <div className="p-2.5 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-900/40">
                <div className="text-[10px] text-slate-500 font-semibold uppercase">
                  Rata-rata Keluar / {periodType === 'monthly' ? 'Bulan' : 'Minggu'}
                </div>
                <div className="text-base font-bold font-mono text-slate-700 dark:text-slate-200 mt-0.5">
                  {(periodType === 'monthly' ? summary.avg_monthly_out : summary.avg_weekly_out || 0).toLocaleString('id-ID')} {mat.unit || ''}
                </div>
              </div>
            </div>

            {loading ? (
              <div className="flex flex-col items-center justify-center p-12 text-slate-500">
                <Spinner size="lg" />
                <span className="mt-3 text-xs">Menghitung data mutasi penerimaan & pengeluaran...</span>
              </div>
            ) : viewMode === 'chart' ? (
              /* VIEW MODE: SVG BAR & NET TREND CHART */
              <div className="border border-slate-200 dark:border-slate-800 rounded-lg p-4 bg-white dark:bg-slate-900">
                <div className="flex items-center justify-between mb-2">
                  <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                    Grafik Komparasi Penerimaan vs Pengeluaran ({periodType === 'monthly' ? 'Bulanan' : 'Mingguan'})
                  </div>
                  <div className="flex items-center gap-4 text-[11px]">
                    <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400">
                      <span className="w-3 h-3 bg-emerald-500 rounded-xs" />
                      Penerimaan (Masuk)
                    </span>
                    <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400">
                      <span className="w-3 h-3 bg-rose-500 rounded-xs" />
                      Pengeluaran (Keluar)
                    </span>
                  </div>
                </div>

                {/* Interactive SVG Chart */}
                <div className="relative w-full overflow-x-auto">
                  <svg
                    viewBox="0 0 720 220"
                    className="w-full min-w-[620px] h-60 select-none"
                    style={{ overflow: 'visible' }}
                  >
                    {/* Horizontal Grid lines */}
                    {[0, 0.25, 0.5, 0.75, 1].map((pct, idx) => {
                      const y = 180 - pct * 150
                      const val = Math.round(chartMax * pct)
                      return (
                        <g key={idx}>
                          <line
                            x1="50"
                            y1={y}
                            x2="710"
                            y2={y}
                            stroke="currentColor"
                            strokeDasharray={pct === 0 ? 'none' : '3 3'}
                            className="text-slate-200 dark:text-slate-800"
                            strokeWidth="1"
                          />
                          <text
                            x="45"
                            y={y + 3}
                            textAnchor="end"
                            className="text-[9px] fill-slate-400 font-mono"
                          >
                            {val.toLocaleString('id-ID')}
                          </text>
                        </g>
                      )
                    })}

                    {/* Bars and labels */}
                    {currentBuckets.map((b, i) => {
                      const totalBars = currentBuckets.length
                      const groupWidth = 640 / totalBars
                      const barWidth = Math.min(Math.max(groupWidth * 0.35, 6), 16)
                      const groupX = 60 + i * groupWidth + groupWidth / 2

                      const hIn = ((b.qty_in || 0) / chartMax) * 150
                      const hOut = ((b.qty_out || 0) / chartMax) * 150

                      const isHovered = hoveredIndex === i

                      return (
                        <g
                          key={b.period_key || i}
                          onMouseEnter={() => setHoveredIndex(i)}
                          onMouseLeave={() => setHoveredIndex(null)}
                          className="cursor-pointer transition-opacity"
                        >
                          {/* Hover backdrop pill */}
                          {isHovered && (
                            <rect
                              x={groupX - groupWidth / 2 + 2}
                              y="20"
                              width={groupWidth - 4}
                              height="170"
                              className="fill-blue-500/10 dark:fill-blue-400/10 rx-sm"
                            />
                          )}

                          {/* Inbound bar (Emerald) */}
                          <rect
                            x={groupX - barWidth - 1}
                            y={180 - hIn}
                            width={barWidth}
                            height={Math.max(hIn, 0)}
                            rx="2"
                            className={`fill-emerald-500 transition-all ${
                              isHovered ? 'fill-emerald-600 filter drop-shadow-sm' : ''
                            }`}
                          />

                          {/* Outbound bar (Rose) */}
                          <rect
                            x={groupX + 1}
                            y={180 - hOut}
                            width={barWidth}
                            height={Math.max(hOut, 0)}
                            rx="2"
                            className={`fill-rose-500 transition-all ${
                              isHovered ? 'fill-rose-600 filter drop-shadow-sm' : ''
                            }`}
                          />

                          {/* Period Label on X-Axis */}
                          <text
                            x={groupX}
                            y="198"
                            textAnchor="middle"
                            className={`text-[9px] font-sans transition-colors ${
                              isHovered
                                ? 'fill-blue-600 dark:fill-blue-400 font-bold'
                                : 'fill-slate-500'
                            }`}
                          >
                            {b.period_label?.split(' ')[0] || b.period_key}
                          </text>

                          {/* Secondary sub-label (Year or Week dates) */}
                          <text
                            x={groupX}
                            y="209"
                            textAnchor="middle"
                            className="text-[8px] fill-slate-400 font-mono"
                          >
                            {b.period_label?.split(' ')[1] || ''}
                          </text>
                        </g>
                      )
                    })}
                  </svg>

                  {/* Floating Tooltip Box */}
                  {hoveredIndex !== null && currentBuckets[hoveredIndex] && (
                    <div className="absolute top-2 right-4 bg-slate-900/95 dark:bg-slate-800/95 text-white p-2.5 rounded-lg shadow-lg border border-slate-700 text-xs z-10 pointer-events-none min-w-44">
                      <div className="font-semibold text-slate-200 border-b border-slate-700/80 pb-1 mb-1.5 flex items-center justify-between">
                        <span>{currentBuckets[hoveredIndex].period_label}</span>
                        <span className="text-[10px] text-slate-400 font-normal">
                          {currentBuckets[hoveredIndex].start_date} s/d {currentBuckets[hoveredIndex].end_date}
                        </span>
                      </div>
                      <div className="space-y-1 font-mono text-[11px]">
                        <div className="flex justify-between items-center text-emerald-400">
                          <span>Masuk (Penerimaan):</span>
                          <strong>+{(currentBuckets[hoveredIndex].qty_in || 0).toLocaleString('id-ID')} {mat.unit}</strong>
                        </div>
                        <div className="flex justify-between items-center text-rose-400">
                          <span>Keluar (Pengeluaran):</span>
                          <strong>-{(currentBuckets[hoveredIndex].qty_out || 0).toLocaleString('id-ID')} {mat.unit}</strong>
                        </div>
                        <div className="flex justify-between items-center border-t border-slate-800 pt-1 text-slate-300">
                          <span>Selisih Bersih (Net):</span>
                          <strong className={currentBuckets[hoveredIndex].net_change >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
                            {currentBuckets[hoveredIndex].net_change > 0 ? '+' : ''}
                            {(currentBuckets[hoveredIndex].net_change || 0).toLocaleString('id-ID')} {mat.unit}
                          </strong>
                        </div>
                        <div className="flex justify-between items-center text-[10px] text-slate-400 pt-0.5">
                          <span>Aktivitas Dokumen:</span>
                          <span>
                            {currentBuckets[hoveredIndex].receipt_docs_count || 0} Masuk / {currentBuckets[hoveredIndex].issue_docs_count || 0} Keluar
                          </span>
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                <div className="mt-2 text-[11px] text-slate-400 text-center italic">
                  Arahkan kursor pada batang periode untuk melihat rincian angka penerimaan dan pengeluaran material.
                </div>
              </div>
            ) : (
              /* VIEW MODE: TABULAR DATA TABLE */
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold">
                      <th className="py-2 px-3">Periode</th>
                      <th className="py-2 px-3">Rentang Tanggal</th>
                      <th className="py-2 px-3 text-right text-emerald-700 dark:text-emerald-400">Penerimaan (Masuk)</th>
                      <th className="py-2 px-3 text-right text-rose-700 dark:text-rose-400">Pengeluaran (Keluar)</th>
                      <th className="py-2 px-3 text-right">Selisih Bersih (Net)</th>
                      <th className="py-2 px-3 text-right">Dokumen MIMS</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono text-[11px]">
                    {currentBuckets.map((b, idx) => (
                      <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                        <td className="py-2 px-3 font-sans font-medium text-slate-800 dark:text-slate-200">
                          {b.period_label}
                        </td>
                        <td className="py-2 px-3 font-sans text-slate-500 text-[10px]">
                          {b.start_date} s/d {b.end_date}
                        </td>
                        <td className="py-2 px-3 text-right text-emerald-600 font-semibold">
                          {(b.qty_in || 0) > 0 ? `+${(b.qty_in || 0).toLocaleString('id-ID')}` : '0'}
                        </td>
                        <td className="py-2 px-3 text-right text-rose-600 font-semibold">
                          {(b.qty_out || 0) > 0 ? `-${(b.qty_out || 0).toLocaleString('id-ID')}` : '0'}
                        </td>
                        <td className={`py-2 px-3 text-right font-bold ${
                          (b.net_change || 0) > 0
                            ? 'text-emerald-600'
                            : (b.net_change || 0) < 0
                            ? 'text-rose-600'
                            : 'text-slate-400'
                        }`}>
                          {(b.net_change || 0) > 0 ? '+' : ''}{(b.net_change || 0).toLocaleString('id-ID')}
                        </td>
                        <td className="py-2 px-3 text-right font-sans text-slate-500 text-[10px]">
                          {(b.receipt_docs_count || 0) + (b.issue_docs_count || 0) > 0 ? (
                            <span className="bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 rounded text-[10px]">
                              {b.receipt_docs_count || 0} Masuk · {b.issue_docs_count || 0} Keluar
                            </span>
                          ) : (
                            '-'
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-100/80 dark:bg-slate-800/80 font-bold text-[11px] border-t border-slate-200 dark:border-slate-700">
                      <td colSpan={2} className="py-2 px-3 font-sans text-slate-800 dark:text-slate-200">
                        Total Seluruh Periode
                      </td>
                      <td className="py-2 px-3 text-right text-emerald-600 font-mono">
                        +{(summary.total_in || 0).toLocaleString('id-ID')}
                      </td>
                      <td className="py-2 px-3 text-right text-rose-600 font-mono">
                        -{(summary.total_out || 0).toLocaleString('id-ID')}
                      </td>
                      <td className={`py-2 px-3 text-right font-mono ${
                        (summary.net_total || 0) >= 0 ? 'text-emerald-600' : 'text-rose-600'
                      }`}>
                        {(summary.net_total || 0) > 0 ? '+' : ''}{(summary.net_total || 0).toLocaleString('id-ID')}
                      </td>
                      <td className="py-2 px-3 text-right font-sans text-[10px] text-slate-500">
                        {mat.unit || ''}
                      </td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: STOK PER GUDANG */}
        {activeTab === 'warehouses' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs font-semibold text-slate-700 dark:text-slate-300">
                Sebaran Fisik & Ketersediaan di Gudang ERP
              </div>
              <div className="relative w-56">
                <input
                  type="text"
                  placeholder="Cari gudang..."
                  value={searchWh}
                  onChange={(e) => setSearchWh(e.target.value)}
                  className="w-full text-xs px-2.5 py-1.5 pl-8 rounded border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900"
                />
                <IconSearch size={14} className="absolute left-2.5 top-2 text-slate-400 pointer-events-none" />
              </div>
            </div>

            <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
              <table className="w-full text-left text-xs border-collapse">
                <thead>
                  <tr className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold">
                    <th className="py-2 px-3">Gudang ERP</th>
                    <th className="py-2 px-3">Unit Organisasi</th>
                    <th className="py-2 px-3 text-right">Stok Fisik</th>
                    <th className="py-2 px-3 text-right text-amber-600">Reservasi</th>
                    <th className="py-2 px-3 text-right text-emerald-600">Pasokan Masuk</th>
                    <th className="py-2 px-3 text-right text-slate-500">Stok Pengaman</th>
                    <th className="py-2 px-3 text-right text-blue-700 dark:text-blue-300">Stok Tersedia</th>
                    <th className="py-2 px-3 text-center">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono text-[11px]">
                  {warehouseBreakdown.length === 0 ? (
                    <tr>
                      <td colSpan={8} className="py-6 text-center text-slate-400 font-sans">
                        Tidak ada data gudang yang cocok.
                      </td>
                    </tr>
                  ) : (
                    warehouseBreakdown.map((w, idx) => {
                      const isLow = (w.available || 0) < (w.safety || 0) && (w.safety || 0) > 0
                      const isEmpty = (w.on_hand || 0) <= 0
                      return (
                        <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                          <td className="py-2 px-3 font-sans">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">{w.warehouse_name}</div>
                            <div className="text-[10px] text-slate-400 font-mono">
                              {w.warehouse_code} {w.plant ? `(${w.plant}/${w.stor_loc})` : ''}
                            </div>
                          </td>
                          <td className="py-2 px-3 font-sans text-slate-600 dark:text-slate-400 text-[11px]">
                            {w.unit_name || w.unit_code || '-'}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-700 dark:text-slate-300 font-semibold">
                            {(w.on_hand || 0).toLocaleString('id-ID')}
                          </td>
                          <td className="py-2 px-3 text-right text-amber-600">
                            {(w.reserved || 0).toLocaleString('id-ID')}
                          </td>
                          <td className="py-2 px-3 text-right text-emerald-600">
                            {(w.incoming || 0).toLocaleString('id-ID')}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-500">
                            {(w.safety || 0).toLocaleString('id-ID')}
                          </td>
                          <td className={`py-2 px-3 text-right font-bold ${
                            (w.available || 0) > 0 ? 'text-blue-700 dark:text-blue-300' : 'text-rose-600'
                          }`}>
                            {(w.available || 0).toLocaleString('id-ID')}
                          </td>
                          <td className="py-2 px-3 text-center font-sans">
                            {isEmpty ? (
                              <span className="bg-slate-100 text-slate-600 text-[10px] px-2 py-0.5 rounded font-medium">
                                Kosong
                              </span>
                            ) : isLow ? (
                              <span className="bg-amber-100 text-amber-800 text-[10px] px-2 py-0.5 rounded font-medium">
                                Di Bawah Safety
                              </span>
                            ) : (
                              <span className="bg-emerald-100 text-emerald-800 text-[10px] px-2 py-0.5 rounded font-medium">
                                Aman
                              </span>
                            )}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* TAB 3: DOKUMEN TRANSAKSI MIMS */}
        {activeTab === 'transactions' && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1 bg-slate-100 dark:bg-slate-800 p-0.5 rounded-md text-xs">
                <button
                  type="button"
                  onClick={() => setTransactionKind('issues')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    transactionKind === 'issues'
                      ? 'bg-white dark:bg-slate-700 shadow-xs text-rose-600 font-semibold'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Pengeluaran Terakhir ({recentTransactions.issues?.length || 0})
                </button>
                <button
                  type="button"
                  onClick={() => setTransactionKind('receipts')}
                  className={`px-3 py-1 rounded text-xs font-medium transition-colors ${
                    transactionKind === 'receipts'
                      ? 'bg-white dark:bg-slate-700 shadow-xs text-emerald-600 font-semibold'
                      : 'text-slate-600 dark:text-slate-300'
                  }`}
                >
                  Penerimaan Terakhir ({recentTransactions.receipts?.length || 0})
                </button>
              </div>
              <span className="text-[11px] text-slate-400">Menampilkan hingga 15 catatan terakhir</span>
            </div>

            {transactionKind === 'issues' ? (
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold">
                      <th className="py-2 px-3">Tanggal</th>
                      <th className="py-2 px-3">Dokumen Material / Pemesanan</th>
                      <th className="py-2 px-3">Gudang</th>
                      <th className="py-2 px-3">Uraian / Tipe Pekerjaan</th>
                      <th className="py-2 px-3 text-right text-rose-600">Qty Keluar</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono text-[11px]">
                    {!recentTransactions.issues || recentTransactions.issues.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400 font-sans">
                          Belum ada catatan mutasi pengeluaran barang di server mirror MIMS untuk material ini.
                        </td>
                      </tr>
                    ) : (
                      recentTransactions.issues.map((i, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                          <td className="py-2 px-3 font-sans text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {i.date || i.issued_on || '-'}
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">
                              {i.material_document || i.reservation_no || '-'}
                            </div>
                            <div className="text-[10px] text-slate-400">Pemesanan: {i.reservation_no || '-'}</div>
                          </td>
                          <td className="py-2 px-3 font-sans text-slate-600 dark:text-slate-400 text-[11px]">
                            {i.warehouse_name || i.warehouse_code || 'Gudang MIMS'}
                          </td>
                          <td className="py-2 px-3 font-sans text-slate-600 dark:text-slate-400 max-w-xs truncate text-[11px]">
                            {i.work_type_name || i.text || i.wbs || '-'}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-rose-600 whitespace-nowrap">
                            -{(i.quantity || 0).toLocaleString('id-ID')} {i.unit || mat.unit || ''}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="overflow-x-auto border border-slate-200 dark:border-slate-800 rounded-lg">
                <table className="w-full text-left text-xs border-collapse">
                  <thead>
                    <tr className="bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-800 text-[11px] font-semibold">
                      <th className="py-2 px-3">Tanggal Diterima</th>
                      <th className="py-2 px-3">No. Pengiriman / Penerimaan</th>
                      <th className="py-2 px-3">Gudang Penerima</th>
                      <th className="py-2 px-3">Asal Pengirim / Status</th>
                      <th className="py-2 px-3 text-right text-emerald-600">Qty Masuk</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800/80 font-mono text-[11px]">
                    {!recentTransactions.receipts || recentTransactions.receipts.length === 0 ? (
                      <tr>
                        <td colSpan={5} className="py-8 text-center text-slate-400 font-sans">
                          Belum ada catatan mutasi penerimaan barang di server mirror MIMS untuk material ini.
                        </td>
                      </tr>
                    ) : (
                      recentTransactions.receipts.map((r, idx) => (
                        <tr key={idx} className="hover:bg-slate-50/80 dark:hover:bg-slate-800/40">
                          <td className="py-2 px-3 font-sans text-slate-600 dark:text-slate-300 whitespace-nowrap">
                            {r.date || r.received_on || r.delivered_on || '-'}
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">
                              {r.delivery_document || r.receipt_document || '-'}
                            </div>
                            <div className="text-[10px] text-slate-400">Penerimaan: {r.receipt_document || '-'}</div>
                          </td>
                          <td className="py-2 px-3 font-sans text-slate-600 dark:text-slate-400 text-[11px]">
                            {r.warehouse_name || r.warehouse_code || 'Gudang MIMS'}
                          </td>
                          <td className="py-2 px-3 font-sans text-slate-600 dark:text-slate-400 text-[11px]">
                            {r.origin_name || '-'}
                            {r.status && (
                              <span className="ml-1.5 bg-emerald-50 text-emerald-700 text-[10px] px-1.5 py-0.2 rounded font-medium">
                                {r.status}
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-emerald-600 whitespace-nowrap">
                            +{(r.quantity || 0).toLocaleString('id-ID')} {r.unit || mat.unit || ''}
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* TAB 4: SPESIFIKASI & PEMETAAN SKU */}
        {activeTab === 'specs' && (
          <div className="space-y-4 text-xs">
            <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-900/40 space-y-3">
              <h4 className="font-semibold text-slate-800 dark:text-slate-200">
                Spesifikasi & Informasi Master KHS
              </h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-slate-600 dark:text-slate-300">
                <div>
                  <span className="text-slate-400 block text-[11px]">Kode KHS:</span>
                  <span className="font-mono font-bold text-slate-900 dark:text-slate-100">{khsCode}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Nama Standar KHS:</span>
                  <span className="font-medium text-slate-900 dark:text-slate-100">{mat.khs_name || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Satuan Unit:</span>
                  <span className="font-mono">{mat.unit || '-'}</span>
                </div>
                <div>
                  <span className="text-slate-400 block text-[11px]">Kategori Material:</span>
                  <span>{mat.category || 'Standar PLN'}</span>
                </div>
                {mat.description && (
                  <div className="sm:col-span-2">
                    <span className="text-slate-400 block text-[11px]">Deskripsi / Rincian Teknis:</span>
                    <p className="mt-0.5 text-slate-700 dark:text-slate-300">{mat.description}</p>
                  </div>
                )}
                {mat.source_reference && (
                  <div className="sm:col-span-2">
                    <span className="text-slate-400 block text-[11px]">Referensi Sumber:</span>
                    <span className="font-mono text-[11px] text-slate-500">{mat.source_reference}</span>
                  </div>
                )}
              </div>
            </div>

            <div className="p-4 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 space-y-3">
              <div className="flex items-center justify-between">
                <div>
                  <h4 className="font-semibold text-slate-800 dark:text-slate-200">
                    Nomor Material ERP / SKU MIMS yang Terpetakan
                  </h4>
                  <p className="text-[11px] text-slate-500 mt-0.5">
                    Transaksi mutasi MIMS dihitung berdasarkan keterkaitan nomor material ERP di bawah ini.
                  </p>
                </div>
                <Link
                  to={`/master-data/mapping${materialCode ? `?search=${encodeURIComponent(materialCode)}` : ''}`}
                  onClick={onClose}
                  className="text-xs text-blue-600 hover:text-blue-800 dark:text-blue-400 font-semibold hover:underline"
                >
                  Buka Meja Kerja Pemetaan →
                </Link>
              </div>

              {mat.is_exempt ? (
                <div className="p-3 bg-amber-50 dark:bg-amber-950/30 rounded border border-amber-200 dark:border-amber-900 text-amber-800 dark:text-amber-300">
                  <div className="font-semibold">Material ini dikecualikan dari pemetaan SKU:</div>
                  <div className="mt-1 text-[11px] italic">"{mat.exemption_reason || 'Pengecualian khusus non-stok'}"</div>
                </div>
              ) : !mat.mapped_skus || mat.mapped_skus.length === 0 ? (
                <div className="p-4 text-center bg-slate-50 dark:bg-slate-800/40 rounded border border-slate-200 dark:border-slate-800 text-slate-500">
                  <p>Material ini belum dipetakan ke nomor material ERP mana pun.</p>
                  <p className="text-[11px] text-slate-400 mt-1">
                    Petakan nomor SKU ERP melalui menu <strong>Master Data &gt; Pemetaan Material (SKU↔KHS)</strong> agar data mutasi penerimaan dan pengeluaran MIMS terhubung otomatis.
                  </p>
                </div>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800 border border-slate-200 dark:border-slate-800 rounded-md">
                  {mat.mapped_skus.map((sku, idx) => (
                    <div key={idx} className="p-2.5 flex items-center justify-between text-xs">
                      <div>
                        <span className="font-mono font-bold text-slate-900 dark:text-slate-100">
                          {sku.material_no}
                        </span>
                        {sku.note && (
                          <span className="ml-2 text-slate-500 text-[11px]">
                            ({sku.note})
                          </span>
                        )}
                      </div>
                      <span className="text-[10px] text-slate-400 font-mono">
                        ID: {sku.id?.slice(0, 8)}...
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </Drawer>
  )
}
