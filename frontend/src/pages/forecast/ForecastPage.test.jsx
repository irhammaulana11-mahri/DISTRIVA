import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import ForecastPage, { exceedText, pct } from './ForecastPage.jsx'
import { forecastApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  forecastApi: { runs: vi.fn(), run: vi.fn(), substations: vi.fn(), start: vi.fn(), review: vi.fn() },
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
