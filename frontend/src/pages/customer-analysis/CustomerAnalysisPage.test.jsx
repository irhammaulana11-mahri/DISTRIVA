import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import CustomerAnalysisPage from './CustomerAnalysisPage.jsx'
import { buildInsights } from './insights.js'
import { reportsApi, pengusahaanApi, forecastApi, unitScopeApi, triggerFileDownload } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  reportsApi: { customerGrowth: vi.fn(), downloadCustomerGrowthXlsx: vi.fn() },
  pengusahaanApi: { metric: vi.fn() },
  forecastApi: { schedule: vi.fn(), saveSchedule: vi.fn(), derived: vi.fn(), runs: vi.fn(), run: vi.fn(), substations: vi.fn(), series: vi.fn(), start: vi.fn(), review: vi.fn() },
  unitScopeApi: { get: vi.fn() },
  triggerFileDownload: vi.fn(),
  notificationsApi: { list: vi.fn().mockResolvedValue({ data: [] }), markRead: vi.fn(), markAllRead: vi.fn() },
  warehousesApi: { materialDetail: vi.fn() },
}))

function renderPage(can = { 'reports.view': true, 'forecast.view': true }) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 'u-1', name: 'Planner' }, status: 'authenticated' }}>
        <AccessContext.Provider value={{ can, isSysAdmin: false, createUnits: [], loading: false }}>
          <NotificationProvider><CustomerAnalysisPage /></NotificationProvider>
        </AccessContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const month = (m, pb, kva, over = {}) => ({ month: m, partial: false, pb_count: pb, pb_kva: kva, pd_up_count: 2, pd_up_kva: 6, pd_down_count: 1, pd_down_kva: -2, pd_same_count: 3, pd_net_kva: 4, requests_pb: pb + 5, requests_pd: 4, cancelled: 1, refunded: 0, mom_pct: null, yoy_pct: null, avg_kva_per_pb: pb ? kva / pb : null, ...over })
const PAYLOAD = {
  filters: { from: null, to: null, units: 3 }, as_of: '2026-11-14',
  kpi: { last_full_month: '2026-10', partial_month: '2026-11', l12m: { pb_count: 400, pb_kva: 1200, pd_net_kva: 90 }, prev12m: { pb_count: 320, pb_kva: 900, pd_net_kva: 50 }, l12m_growth_pct: 25, ytd: { year: 2026, months: 10, pb_count: 330, pb_kva: 1000 }, ytd_prev: { year: 2025, months: 10, pb_count: 280, pb_kva: 800 }, ytd_growth_pct: 17.9, pb_total: 1500, pb_kva_total: 4000, avg_kva_per_pb: 2.67 },
  monthly: [month('2025-11', 30, 60), month('2025-12', 55, 150, { mom_pct: 83.3 }), month('2026-01', 28, 70, { yoy_pct: 5.0 }), month('2026-02', 10, 30, { partial: true })],
  yearly: [
    { year: 2025, months: 12, partial: false, pb_count: 320, pb_kva: 900, pd_up_kva: 70, pd_down_kva: -20, pd_net_kva: 50, requests_pb: 360, requests_pd: 200, cancelled: 20, refunded: 3, avg_kva_per_pb: 2.81, yoy_pct: null, yoy_kva_pct: null },
    { year: 2026, months: 3, partial: true, pb_count: 90, pb_kva: 250, pd_up_kva: 20, pd_down_kva: -5, pd_net_kva: 15, requests_pb: 100, requests_pd: 60, cancelled: 5, refunded: 1, avg_kva_per_pb: 2.78, yoy_pct: null, yoy_kva_pct: null },
  ],
  by_tariff: { groups: [{ group: 'Rumah tangga', count: 90, kva: 180, share_pct: 75, kva_share_pct: 60, avg_kva: 2 }, { group: 'Bisnis', count: 30, kva: 120, share_pct: 25, kva_share_pct: 40, avg_kva: 4 }], top_codes: [{ tariff: 'R1T', group: 'Rumah tangga', count: 60, kva: 120, share_pct: 50, kva_share_pct: 40, avg_kva: 2 }] },
  by_unit: [
    { unit_id: 'ulp-1', unit_code: '51', unit_name: 'ULP Jombang', up3_name: 'UP3 Mojokerto', pb_count: 70, pb_kva: 190, pd_net_kva: 10, by_year: [{ year: 2025, pb_count: 50, pb_kva: 140 }, { year: 2026, pb_count: 20, pb_kva: 50 }], avg_pb_per_year: 35, l12m_pb: 60, l12m_kva: 160, avg_kva_per_pb: 2.7, base_customers: 5000, base_kva: 12000, l12m_vs_base_pct: 1.2 },
    { unit_id: 'ulp-2', unit_code: '52', unit_name: 'ULP Nganjuk', up3_name: 'UP3 Mojokerto', pb_count: 50, pb_kva: 110, pd_net_kva: 5, by_year: [{ year: 2025, pb_count: 30, pb_kva: 70 }, { year: 2026, pb_count: 20, pb_kva: 40 }], avg_pb_per_year: 25, l12m_pb: 40, l12m_kva: 90, avg_kva_per_pb: 2.2, base_customers: 4000, base_kva: 9000, l12m_vs_base_pct: 1.0 },
  ],
  seasonality: { years: [2024, 2025], months: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, avg_pb_count: 30, index: i === 11 ? 1.4 : 0.95 })), note: null },
  anomalies: [{ month: '2025-12', pb_count: 55, expected: 28, z: 3.1, direction: 'NAIK' }],
  notes: ['Penambahan dihitung dari permohonan yang sudah tersambung (status PEREMAJAAN di EIS), bukan dari tanggal permohonan masuk.'],
}

describe('buildInsights', () => {
  it('menyusun temuan hanya dari angka yang ada dan tanpa klaim penyebab', () => {
    const texts = buildInsights({ ...PAYLOAD, yearly: [{ ...PAYLOAD.yearly[0], year: 2024, avg_kva_per_pb: 1.9, pb_count: 300, pb_kva: 570 }, PAYLOAD.yearly[0]] }).map((i) => i.text)
    expect(texts.some((t) => /12 bulan terakhir .*400 pelanggan baru, \+25,0%/.test(t))).toBe(true)
    expect(texts.some((t) => /puncak Desember \(indeks 1,40\)/.test(t))).toBe(true)
    expect(texts.some((t) => /ULP Jombang paling banyak menambah pelanggan baru dalam 12 bulan terakhir \(60 PB/.test(t))).toBe(true)
    expect(texts.some((t) => /Bulan menyimpang terbaru: Des 2025/.test(t) || /menyimpang terbaru/.test(t))).toBe(true)
  })
  it('tanpa data tidak menghasilkan apa pun', () => {
    expect(buildInsights(null)).toEqual([])
    expect(buildInsights({ kpi: { last_full_month: null } })).toEqual([])
  })
})

describe('Analisis Pelanggan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    reportsApi.customerGrowth.mockResolvedValue({ data: PAYLOAD })
    reportsApi.downloadCustomerGrowthXlsx.mockResolvedValue({ blob: new Blob(['x']), filename: 'ANALISIS.xlsx' })
    pengusahaanApi.metric.mockResolvedValue({
      data: {
        metric: { code: 'pelanggan' },
        summary: [{ key: 'pelanggan', month: '2026-10', value: 928450, formatted: '928.450', yoy_pct: 3.5 }],
        breakdown: [{ key: 'R', name: 'Rumah tangga', value: 800000, share_pct: 86.2 }],
      },
    })
    unitScopeApi.get.mockResolvedValue({
      scope: 'GLOBAL',
      up3_units: [{ id: 'up3-1', code: 'UP3-A', name: 'UP3 Satu' }, { id: 'up3-2', code: 'UP3-B', name: 'UP3 Dua' }],
      ulp_units: [{ id: 'ulp-1', code: 'ULP-A', name: 'ULP Satu', parent_id: 'up3-1' }, { id: 'ulp-2', code: 'ULP-B', name: 'ULP Dua', parent_id: 'up3-2' }],
    })
    const months = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, p10: 8, p50: 10, p90: 14 }))
    forecastApi.runs.mockImplementation((kind) => Promise.resolve(kind === 'DEMAND' ? { data: [{ id: 'd-1', kind: 'DEMAND', status: 'SUCCEEDED', started_at: '2026-11-14T08:00:00Z', review_status: 'DRAFT', counts: {} }], can: { run: true } } : { data: [], can: {} }))
    forecastApi.run.mockResolvedValue({ data: { id: 'd-1', kind: 'DEMAND', status: 'SUCCEEDED', started_by_name: 'Planner', data_cutoff: '2026-10-01', assumptions: 'Rekomendasi.', metrics: { all: { wape: 0.3, coverage_p10_p90: 0.8, wape_gain_vs_persistence_pct: 20 } }, counts: { series: 3, sufficient_series: 3 } } })
    forecastApi.series.mockResolvedValue({ data: [{ series_id: 's', kind: 'CUSTOMERS_ADDED', unit_name: 'ULP Jombang', item_code: null, item_label: null, history_months: 30, last_12_months: 118, months, totals: { 3: { p10: 24, p50: 30, p90: 42 }, 6: { p10: 48, p50: 60, p90: 84 }, 12: { p10: 96, p50: 120, p90: 168 } } }], meta: { current_page: 1, last_page: 1, total: 1 } })
  })

  it('menampilkan ringkasan, temuan, tabel tahunan, komposisi tarif, per ULP, anomali, dan catatan data', async () => {
    renderPage()
    expect(screen.getByText('Analisa & Tren Pelanggan')).toBeInTheDocument()
    expect(await screen.findByText('Pelanggan baru, 12 bulan terakhir')).toBeInTheDocument()
    expect(screen.getByText('400')).toBeInTheDocument()
    expect(screen.getByText('Jumlah pelanggan (Laporan 309)')).toBeInTheDocument()
    expect(screen.getByText('Rata-rata pasang baru bulanan')).toBeInTheDocument()
    expect(screen.getAllByText(/\+25,0%/).length).toBeGreaterThan(0)
    expect(screen.getByText('Delta pelanggan bulanan')).toBeInTheDocument()
    expect(screen.getByText('Temuan')).toBeInTheDocument()
    const yearly = screen.getByRole('table', { name: /Ringkasan penambahan pelanggan per tahun/ })
    expect(within(yearly).getByText('2026')).toBeInTheDocument()
    expect(within(yearly).getByText('(3 bulan)')).toBeInTheDocument()                          // an incomplete year says so
    expect(screen.getByText('Komposisi tarif pelanggan baru')).toBeInTheDocument()
    expect(screen.getAllByText('ULP Jombang').length).toBeGreaterThan(0)
    const perUlp = screen.getByRole('table', { name: /Penambahan pelanggan baru per ULP, per tahun/ })
    expect(within(perUlp).getByText('PB 2025')).toBeInTheDocument()                             // a year column per year, not a single grand total
    expect(within(perUlp).getByText('PB 2026 (3 bln)')).toBeInTheDocument()
    expect(within(perUlp).getByText('12 bulan terakhir')).toBeInTheDocument()
    expect(within(perUlp).getByText('1,20%')).toBeInTheDocument()                               // 12-month additions against the current base
    expect(screen.getByText('Bulan yang menyimpang')).toBeInTheDocument()
    expect(screen.getByText(/Penambahan dihitung dari permohonan yang sudah tersambung/)).toBeInTheDocument()
    expect(screen.getByText(/Bulan Nov 2026 masih berjalan/)).toBeInTheDocument()
    expect(screen.getByRole('img', { name: 'Grafik perbandingan tahunan pelanggan baru 12 bulan' })).toBeInTheDocument()
    expect(screen.getByRole('table', { name: /Penambahan pelanggan per bulan/, hidden: true })).toBeInTheDocument()   // the table view of the charts
  })

  it('filter periode dan unit dikirim ke server dan ULP menyempit ke UP3 terpilih', async () => {
    renderPage()
    await screen.findByText('Pelanggan baru, 12 bulan terakhir')
    await userEvent.click(screen.getByRole('combobox', { name: 'Filter Unit UP3' }))
    await userEvent.click(await screen.findByRole('option', { name: /UP3 Satu/ }))
    await waitFor(() => expect(reportsApi.customerGrowth).toHaveBeenLastCalledWith(expect.objectContaining({ up3_id: 'up3-1' })))
    await userEvent.click(screen.getByRole('combobox', { name: 'Filter Unit ULP' }))
    expect(screen.queryByRole('option', { name: /ULP Dua/ })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('option', { name: /ULP Satu/ }))
    await waitFor(() => expect(reportsApi.customerGrowth).toHaveBeenLastCalledWith(expect.objectContaining({ up3_id: 'up3-1', unit_id: 'ulp-1' })))
    await userEvent.type(screen.getByLabelText('Dari bulan'), '2025-03')
    await waitFor(() => expect(reportsApi.customerGrowth).toHaveBeenLastCalledWith(expect.objectContaining({ from: '2025-03-01' })))
    await userEvent.type(screen.getByLabelText('Sampai bulan'), '2026-02')
    await waitFor(() => expect(reportsApi.customerGrowth).toHaveBeenLastCalledWith(expect.objectContaining({ to: '2026-02-28' })))
  })

  it('ekspor Excel memakai filter yang sama', async () => {
    renderPage()
    await screen.findByText('Pelanggan baru, 12 bulan terakhir')
    await userEvent.click(screen.getByRole('button', { name: 'Ekspor Excel' }))
    await waitFor(() => expect(reportsApi.downloadCustomerGrowthXlsx).toHaveBeenCalled())
    expect(triggerFileDownload).toHaveBeenCalledWith(expect.any(Blob), 'ANALISIS.xlsx')
  })

  it('tab prakiraan memuat forecast pelanggan (pindahan dari menu Forecasting)', async () => {
    renderPage()
    await screen.findByText('Pelanggan baru, 12 bulan terakhir')
    await userEvent.click(screen.getByRole('tab', { name: 'Prakiraan pelanggan' }))
    expect(await screen.findByText('Pelanggan baru (permohonan PB)', { selector: 'h3' })).toBeInTheDocument()
  })

  it('tab mengikuti izin: hanya forecast.view membuka prakiraan, hanya reports.view membuka tren', async () => {
    const { unmount } = renderPage({ 'forecast.view': true })
    expect(screen.queryByRole('tab', { name: 'Tren & analisis' })).not.toBeInTheDocument()
    expect(await screen.findByText('Pelanggan baru (permohonan PB)', { selector: 'h3' })).toBeInTheDocument()
    expect(reportsApi.customerGrowth).not.toHaveBeenCalled()
    unmount()
    renderPage({ 'reports.view': true })
    expect(await screen.findByText('Pelanggan baru, 12 bulan terakhir')).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: 'Prakiraan pelanggan' })).not.toBeInTheDocument()
  })
})
