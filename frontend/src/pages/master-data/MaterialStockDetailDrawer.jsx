import { useState, useEffect, useCallback, useMemo } from 'react'
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
  IconSearch,
  IconFolder,
} from '../../components/icons.jsx'

/**
 * Drawer Detail Material & Riwayat Mutasi (Penerimaan & Pengeluaran)
 * Memuat data material lengkap, status stok konsolidasi & per gudang,
 * serta histori mutasi mingguan & bulanan dalam format visual chart maupun tabel rincian.
 */
export default function MaterialStockDetailDrawer({
  isOpen,
  onClose,
  materialSummary,
  warehouseIds = [],
  warehouses = [],
}) {
  const [activeTab, setActiveTab] = useState('movements') // 'movements' | 'warehouses' | 'transactions' | 'specs'
  const [periodType, setPeriodType] = useState('monthly') // 'monthly' | 'weekly'
  const [viewMode, setViewMode] = useState('chart') // 'chart' | 'table'
  const [transactionKind, setTransactionKind] = useState('issues') // 'issues' | 'receipts'
  const [hoveredIndex, setHoveredIndex] = useState(null)
  const [searchWh, setSearchWh] = useState('')

  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [detailData, setDetailData] = useState(null)

  const khsCode = materialSummary?.khs_code || ''

  const loadDetail = useCallback(async () => {
    if (!khsCode) return
    setLoading(true)
    setError('')
    try {
      const res = await warehousesApi.materialDetail(khsCode, warehouseIds, {
        period_months: 12,
        period_weeks: 16,
      })
      setDetailData(res?.data || null)
    } catch (err) {
      setError(err?.message || 'Gagal memuat rincian mutasi dan spesifikasi material.')
    } finally {
      setLoading(false)
    }
  }, [khsCode, warehouseIds])

  useEffect(() => {
    if (isOpen && khsCode) {
      loadDetail()
    } else if (!isOpen) {
      setDetailData(null)
      setError('')
      setActiveTab('movements')
      setHoveredIndex(null)
    }
  }, [isOpen, khsCode, loadDetail])

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

  return (
    <Drawer
      isOpen={isOpen}
      onClose={onClose}
      size="max-w-4xl"
      title={
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-mono text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/60 px-2.5 py-0.5 rounded text-sm font-bold border border-blue-200 dark:border-blue-900">
            {khsCode}
          </span>
          <span className="text-slate-900 dark:text-slate-100 font-bold text-base md:text-lg">
            {mat.khs_name || materialSummary?.khs_name || khsCode}
          </span>
        </div>
      }
      subtitle={
        <span className="flex items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400 flex-wrap">
          <span>Satuan: <strong className="text-slate-700 dark:text-slate-200">{mat.unit || materialSummary?.unit || '-'}</strong></span>
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
          <nav className="flex space-x-4 text-xs font-medium" aria-label="Tabs Detail Material">
            <button
              type="button"
              onClick={() => setActiveTab('movements')}
              className={`py-2 px-1 border-b-2 transition-colors flex items-center gap-1.5 ${
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
              className={`py-2 px-1 border-b-2 transition-colors flex items-center gap-1.5 ${
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
              className={`py-2 px-1 border-b-2 transition-colors flex items-center gap-1.5 ${
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
              className={`py-2 px-1 border-b-2 transition-colors flex items-center gap-1.5 ${
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
                            {i.date || i.issued_on}
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">{i.material_document}</div>
                            <div className="text-[10px] text-slate-400">Pemesanan: {i.reservation_no || '-'}</div>
                          </td>
                          <td className="py-2 px-3 font-sans text-slate-600 dark:text-slate-400 text-[11px]">
                            {i.warehouse_name || i.warehouse_code}
                          </td>
                          <td className="py-2 px-3 font-sans text-slate-600 dark:text-slate-400 max-w-xs truncate text-[11px]">
                            {i.work_type_name || i.text || i.wbs || '-'}
                          </td>
                          <td className="py-2 px-3 text-right font-bold text-rose-600 whitespace-nowrap">
                            -{(i.quantity || 0).toLocaleString('id-ID')} {i.unit || mat.unit}
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
                            {r.date || r.received_on || r.delivered_on}
                          </td>
                          <td className="py-2 px-3">
                            <div className="font-semibold text-slate-800 dark:text-slate-200">{r.delivery_document}</div>
                            <div className="text-[10px] text-slate-400">Penerimaan: {r.receipt_document || '-'}</div>
                          </td>
                          <td className="py-2 px-3 font-sans text-slate-600 dark:text-slate-400 text-[11px]">
                            {r.warehouse_name || r.warehouse_code}
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
                            +{(r.quantity || 0).toLocaleString('id-ID')} {r.unit || mat.unit}
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
                  to="/master-data/pemetaan-sku"
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
