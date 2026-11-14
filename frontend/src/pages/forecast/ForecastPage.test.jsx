import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import ForecastPage, { exceedText, pct } from './ForecastPage.jsx'
import { forecastApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  forecastApi: { schedule: vi.fn(), saveSchedule: vi.fn(), derived: vi.fn(), runs: vi.fn(), run: vi.fn(), substations: vi.fn(), series: vi.fn(), start: vi.fn(), review: vi.fn() },
  notificationsApi: { list: vi.fn().mockResolvedValue({ data: [] }), markRead: vi.fn(), markAllRead: vi.fn() },
}))

function renderPage(can = { 'forecast.view': true }) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 'u-1', name: 'Planner' }, status: 'authenticated' }}>
        <AccessContext.Provider value={{ can, isSysAdmin: false, createUnits: [], loading: false }}>
          <NotificationProvider><ForecastPage /></NotificationProvider>
        </AccessContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const runRow = { id: 'r-1', status: 'SUCCEEDED', started_at: '2026-11-14T08:00:00Z', review_status: 'DRAFT', counts: { forecast_substations: 5779 } }
const detail = {
  id: 'r-1', status: 'SUCCEEDED', started_by_name: 'Planner', data_cutoff: '2026-11-09', review_status: 'DRAFT', assumptions: 'Rekomendasi, bukan keputusan pengadaan.',
  model: { name: 'GRU-kuantil (ansambel)', version: '1' }, counts: { forecast_substations: 5779 },
  metrics: { all: { mae_pp: 11.9, coverage_p10_p90: 0.8, overload_recall_p90: 0.78, overload_recall_p50: 0.48, mae_gain_vs_persistence_pct: 7.4 } },
  summary: [{ unit_id: 'u-a', unit_code: '51453', unit_name: 'ULP Jombang', total: 100, kritis: 4, tinggi: 6, waspada: 9, stale: 1 }],
}
const gardu = {
  substation_id: 's-1', code: 'JB0001', name: 'Gardu Pasar', feeder_code: 'PNY1', unit_name: 'ULP Jombang', capacity_kva: 100, last_reading_on: '2026-09-01', last_ratio: 1.1, history_readings: 5, stale: false, risk: 'KRITIS',
  horizons: { 1: { p10: 1.0, p50: 1.15, p90: 1.3 }, 3: { p10: 1.1, p50: 1.2, p90: 1.4 }, 5: { p10: 1.1, p50: 1.3, p90: 1.5 } }, exceed_80: { state: 'already', date: '2026-09-01' }, exceed_100: { state: 'already', date: '2026-09-01' },
}

describe('helpers', () => {
  it('persen dan teks waktu lewat batas', () => {
    expect(pct(0.874)).toBe('87%')
    expect(pct(null)).toBe('-')
    expect(exceedText({ state: 'already' })).toBe('sudah')
    expect(exceedText({ state: 'none' })).toBe('tidak dalam 5 tahun')
    expect(exceedText({ state: 'forecast', date: '2028-03-01' })).toMatch(/^sekitar /)
  })
})

describe('Forecast Beban Gardu', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    forecastApi.runs.mockResolvedValue({ data: [runRow], can: { run: false, review: false } })
    forecastApi.run.mockResolvedValue({ data: detail })
    forecastApi.substations.mockResolvedValue({ data: [gardu], meta: { current_page: 1, last_page: 1, total: 1 } })
    forecastApi.start.mockResolvedValue({ message: 'Forecast dimulai.' })
    forecastApi.review.mockResolvedValue({})
  })

  it('menampilkan keterpercayaan, ringkasan per ULP, dan gardu berisiko dengan rentang prakiraan', async () => {
    renderPage()
    expect(await screen.findByText('JB0001 · Gardu Pasar')).toBeInTheDocument()
    expect(screen.getByText('11,9 poin')).toBeInTheDocument()
    expect(screen.getByText('80%')).toBeInTheDocument()
    expect(screen.getByText(/lebih baik 7,4%/)).toBeInTheDocument()
    expect(screen.getByText('51453 · ULP Jombang')).toBeInTheDocument()
    expect(screen.getByTitle(/Sudah lewat 100%/)).toHaveTextContent('Kritis')
    expect(screen.getByText(/rentang 100%–130%/)).toBeInTheDocument()
    expect(screen.getByText(/Rekomendasi, bukan keputusan pengadaan/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Jalankan forecast' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Tandai ditelaah' })).not.toBeInTheDocument()
  })

  it('perencana menjalankan forecast dan penelaah menandainya ditelaah', async () => {
    forecastApi.runs.mockResolvedValue({ data: [runRow], can: { run: true, review: true } })
    renderPage({ 'forecast.view': true, 'forecast.run': true, 'forecast.review': true })
    await userEvent.click(await screen.findByRole('button', { name: 'Jalankan forecast' }))
    expect(forecastApi.start).toHaveBeenCalled()

    await userEvent.click(await screen.findByRole('button', { name: 'Tandai ditelaah' }))
    await userEvent.type(await screen.findByRole('textbox'), 'Sesuai lapangan')
    const buttons = screen.getAllByRole('button', { name: 'Tandai ditelaah' })
    await userEvent.click(buttons[buttons.length - 1])
    await waitFor(() => expect(forecastApi.review).toHaveBeenCalledWith('r-1', 'Sesuai lapangan'))
  })

  it('menyaring daftar gardu menurut tingkat risiko', async () => {
    renderPage()
    await screen.findByText('JB0001 · Gardu Pasar')
    await userEvent.selectOptions(screen.getByLabelText('Tingkat risiko'), 'TINGGI')
    await waitFor(() => expect(forecastApi.substations).toHaveBeenLastCalledWith('r-1', expect.objectContaining({ risk: 'TINGGI' })))
  })
})

describe('Forecast permintaan (pelanggan, VA, material)', () => {
  const demandRun = { id: 'd-1', kind: 'DEMAND', status: 'SUCCEEDED', started_at: '2026-11-14T08:00:00Z', review_status: 'DRAFT', counts: {} }
  const demandDetail = {
    id: 'd-1', kind: 'DEMAND', status: 'SUCCEEDED', started_by_name: 'Planner', data_cutoff: '2026-10-01', assumptions: 'Material adalah pemakaian aktual, bukan kebutuhan pengadaan.',
    metrics: { all: { wape: 0.31, coverage_p10_p90: 0.78, wape_gain_vs_persistence_pct: 22.5 } }, counts: { series: 30, sufficient_series: 28 },
  }
  const months = Array.from({ length: 12 }, (_, i) => ({ month: `2026-${String(i + 1).padStart(2, '0')}`, p10: 8, p50: 10, p90: 14 }))
  const serie = (over) => ({ series_id: 's', kind: 'MATERIAL_ISSUE', unit_name: 'ULP Jombang', item_code: '3110025', item_label: 'Kabel TIC 3x70', history_months: 30, last_12_months: 118, months,
    totals: { 3: { p10: 24, p50: 30, p90: 42 }, 6: { p10: 48, p50: 60, p90: 84 }, 12: { p10: 96, p50: 120, p90: 168 } }, ...over })

  beforeEach(() => {
    vi.clearAllMocks()
    forecastApi.runs.mockImplementation((kind) => Promise.resolve(kind === 'DEMAND' ? { data: [demandRun], can: { run: true, review: false } } : { data: [], can: {} }))
    forecastApi.run.mockResolvedValue({ data: demandDetail })
    forecastApi.series.mockResolvedValue({ data: [serie({})], meta: { current_page: 1, last_page: 1, total: 1 } })
    forecastApi.start.mockResolvedValue({ message: 'Forecast dimulai.' })
  })

  it('tab Material menampilkan prakiraan 3, 6, dan 12 bulan dengan rentang dan keterbatasannya', async () => {
    renderPage({ 'forecast.view': true, 'forecast.run': true })
    await userEvent.click(screen.getByRole('tab', { name: 'Material' }))
    expect(await screen.findByText('3110025 · Kabel TIC 3x70')).toBeInTheDocument()
    expect(screen.getByText('31%')).toBeInTheDocument()
    expect(screen.getByText('28 dari 30')).toBeInTheDocument()
    expect(screen.getByText(/rentang 96–168/)).toBeInTheDocument()
    expect(screen.getByText(/pemakaian aktual, bukan kebutuhan pengadaan/)).toBeInTheDocument()
    expect(forecastApi.series).toHaveBeenCalledWith('d-1', expect.objectContaining({ kind: 'MATERIAL_ISSUE' }))
    await userEvent.click(screen.getByRole('button', { name: 'Jalankan forecast' }))
    expect(forecastApi.start).toHaveBeenCalledWith('DEMAND')
  })

  it('tab Pelanggan & daya memilih jenis yang diprakirakan', async () => {
    forecastApi.series.mockResolvedValue({ data: [serie({ kind: 'CUSTOMERS_ADDED', item_code: null, item_label: null })], meta: { current_page: 1, last_page: 1, total: 1 } })
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Pelanggan & daya (VA)' }))
    expect(await screen.findByText('Pelanggan baru (permohonan PB)', { selector: 'h3' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByLabelText('Yang diprakirakan'), 'VA_ADDED')
    await waitFor(() => expect(forecastApi.series).toHaveBeenLastCalledWith('d-1', expect.objectContaining({ kind: 'VA_ADDED' })))
  })

  it('riwayat yang kurang dijelaskan dengan cakupan data dan cara menambahnya, tanpa angka prakiraan', async () => {
    forecastApi.runs.mockImplementation((kind) => Promise.resolve(kind === 'DEMAND' ? { data: [{ ...demandRun, status: 'INSUFFICIENT' }], can: {} } : { data: [], can: {} }))
    forecastApi.run.mockResolvedValue({ data: { ...demandDetail, status: 'INSUFFICIENT', error: 'Riwayat belum cukup: butuh seri dengan minimal 24 bulan.', data_window: { coverage: { MATERIAL_ISSUE: { months: 3, series: 40, sufficient_series: 0, first_month: '2026-09' } } } } })
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Material' }))
    expect(await screen.findByText(/Riwayat belum cukup/)).toBeInTheDocument()
    expect(screen.getByText('Pemakaian material', { selector: 'td' })).toBeInTheDocument()
    expect(screen.getByText(/lookback/)).toBeInTheDocument()
    expect(forecastApi.series).not.toHaveBeenCalled()
    expect(screen.queryByRole('button', { name: 'Jalankan forecast' })).not.toBeInTheDocument()
  })
  it('tab Kebutuhan material PLN menampilkan trafo pengganti, material pelanggan baru, dan tiang', async () => {
    forecastApi.derived.mockResolvedValue({ data: {
      threshold: 0.8,
      gardu: { run_id: 'g-1', trigger_count: 12, without_capacity_step: 0, steps: [], without_bom: [{ kva: 315, count: 2 }] },
      customers: { run_id: 'd-1', status: 'SUCCEEDED', new_customers: { p10: 384, p50: 480, p90: 624 }, basis: 'SR 1 fasa' },
      materials: [{ code: 'JTMR625', name: 'Trafo Distribusi 20 KV 3 Phasa 160 KVA', unit: 'S', gardu: 10, customers: { p10: 0, p50: 0, p90: 0 }, total: { p10: 10, p50: 10, p90: 10 } },
        { code: 'JTMR949', name: 'kWh Meter Electronic 1 Phs', unit: 'BH', gardu: 0, customers: { p10: 384, p50: 480, p90: 624 }, total: { p10: 384, p50: 480, p90: 624 } }],
      poles: [{ unit_code: '1', unit_name: 'ULP Jombang', item_code: 'JTMR934', item_label: 'Tiang Beton 9m - 200 daN', last_12_months: 40, next_12_months: { p10: 30, p50: 45, p90: 60 } }],
      assumptions: ['Hanya material berstatus PLN pada buku harga yang berlaku hari ini.'],
    } })
    renderPage()
    await userEvent.click(screen.getByRole('tab', { name: 'Kebutuhan material PLN' }))
    expect(await screen.findByText('Trafo Distribusi 20 KV 3 Phasa 160 KVA')).toBeInTheDocument()
    expect(screen.getAllByText('480 (384-624)', { selector: 'td' })).toHaveLength(2)
    expect(screen.getByText('Tiang Beton 9m - 200 daN')).toBeInTheDocument()
    expect(screen.getByText(/315 kVA \(2 gardu\)/)).toBeInTheDocument()
    expect(screen.getByText(/Hanya material berstatus PLN/)).toBeInTheDocument()
  })
  it('menampilkan jadwal otomatis dan penjadwal dapat mengubahnya', async () => {
    forecastApi.schedule.mockResolvedValue({ data: { auto_enabled: false, day_of_month: 1, run_time: '03:00', updated_by_name: null, last_auto: {} } })
    forecastApi.saveSchedule.mockResolvedValue({ data: { auto_enabled: true, day_of_month: 5, run_time: '04:30', updated_by_name: 'Planner', last_auto: {} } })
    renderPage({ 'forecast.view': true, 'forecast.run': true })
    expect(await screen.findByText(/nonaktif/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Atur jadwal' }))
    await userEvent.click(screen.getByLabelText(/Jalankan otomatis tiap bulan/))
    fireEvent.change(screen.getByLabelText(/Tanggal/), { target: { value: '5' } })
    fireEvent.change(screen.getByLabelText('Jam'), { target: { value: '04:30' } })
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(forecastApi.saveSchedule).toHaveBeenCalledWith({ auto_enabled: true, day_of_month: 5, run_time: '04:30' }))
    expect(await screen.findByText(/aktif, tiap tanggal 5 pukul 04:30/)).toBeInTheDocument()
  })

  it('pembaca tanpa izin menjalankan hanya melihat jadwal, tanpa tombol atur', async () => {
    forecastApi.schedule.mockResolvedValue({ data: { auto_enabled: true, day_of_month: 1, run_time: '03:00', updated_by_name: 'Planner', last_auto: {} } })
    renderPage()
    expect(await screen.findByText(/aktif, tiap tanggal 1 pukul 03:00/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Atur jadwal' })).not.toBeInTheDocument()
  })
})
