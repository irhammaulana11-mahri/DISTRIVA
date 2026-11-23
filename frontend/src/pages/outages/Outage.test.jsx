import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import OutageSyncPage from './OutageSyncPage.jsx'
import OutageAnalysisPage from './OutageAnalysisPage.jsx'
import { outageApi, triggerFileDownload } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  outageApi: { sync: vi.fn(), saveSettings: vi.fn(), start: vi.fn(), run: vi.fn(), alias: vi.fn(), analysis: vi.fn(), feeder: vi.fn(), forecast: vi.fn(), downloadAnalysisXlsx: vi.fn() },
  unitScopeApi: { get: vi.fn().mockResolvedValue({ data: { units: [], up3s: [] } }) },
  triggerFileDownload: vi.fn(),
  notificationsApi: { list: vi.fn().mockResolvedValue({ data: [] }), markRead: vi.fn(), markAllRead: vi.fn() },
}))

function wrap(ui, can = { 'outages.view': true }) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 'u-1', name: 'Tester' }, status: 'authenticated' }}>
        <AccessContext.Provider value={{ can, isSysAdmin: false, createUnits: [], loading: false }}>
          <NotificationProvider>{ui}</NotificationProvider>
        </AccessContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const SETTINGS = { sheet_id_set: true, sheet_id_hint: 'abcd…wxyz', gids: [0], auto_enabled: true, auto_time: '02:00', saidi_min_minutes: 5, saidi_only_permanent: false, updated_at: null, last_run: { id: 'r1', trigger: 'AUTO', status: 'OK', counts: { read: 100, inserted: 3 }, message: null, created_at: '2026-11-20T02:00:00Z', finished_at: '2026-11-20T02:01:00Z' } }
const SYNC = {
  settings: SETTINGS,
  runs: [{ id: 'r1', trigger: 'AUTO', status: 'OK', counts: { read: 100, inserted: 3, updated: 1, removed: 0, invalid: 0 }, message: null, created_at: '2026-11-20T02:00:00Z' }],
  stats: { events: 7665, first_at: '2020-01-02T00:00:00Z', last_at: '2026-11-10T00:00:00Z', feeders: 129, unmatched_events: 4 },
  unmatched: [{ gi_name: 'GI X', feeder_name: 'PENYULANG BARU', events: 4, first_at: null, last_at: null }],
  feeders: [{ id: 'f-1', code: 'F1', name: 'Penyulang Satu', gi_name: 'GI X' }],
  can: { sync: true },
}

describe('OutageSyncPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('menampilkan status, pengaturan, riwayat dan penyulang belum terpetakan; alamat sheet tidak ditampilkan', async () => {
    outageApi.sync.mockResolvedValue({ data: SYNC })
    wrap(<OutageSyncPage />, { 'outages.view': true, 'outages.sync': true })
    expect(await screen.findByText('Data Gangguan (Sinkron)')).toBeInTheDocument()
    expect(screen.getByText('7.665')).toBeInTheDocument()
    expect(screen.getByText('PENYULANG BARU')).toBeInTheDocument()
    expect(screen.getByLabelText('Tautan Google Sheet')).toHaveValue('')
    expect(screen.getByRole('button', { name: /Sinkron sekarang/ })).toBeEnabled()
  })

  it('pembaca tanpa izin sinkron tidak melihat tombol atau formulir', async () => {
    outageApi.sync.mockResolvedValue({ data: { ...SYNC, feeders: [], can: { sync: false } } })
    wrap(<OutageSyncPage />)
    expect(await screen.findByText('Data Gangguan (Sinkron)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Sinkron sekarang/ })).toBeNull()
    expect(screen.queryByLabelText('Tautan Google Sheet')).toBeNull()
  })

  it('menyimpan pengaturan dan memetakan penyulang', async () => {
    outageApi.sync.mockResolvedValue({ data: SYNC })
    outageApi.saveSettings.mockResolvedValue({ data: { ...SETTINGS, saidi_min_minutes: 10 } })
    outageApi.alias.mockResolvedValue({ data: { updated_events: 4, unmatched: [] }, message: 'ok' })
    wrap(<OutageSyncPage />, { 'outages.view': true, 'outages.sync': true })
    const min = await screen.findByLabelText(/Ambang SAIDI/)
    await userEvent.clear(min)
    await userEvent.type(min, '10')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan pengaturan' }))
    await waitFor(() => expect(outageApi.saveSettings).toHaveBeenCalled())
    expect(outageApi.saveSettings.mock.calls[0][0]).toMatchObject({ saidi_min_minutes: 10, auto_enabled: true, auto_time: '02:00', gids: [0] })
    expect(outageApi.saveSettings.mock.calls[0][0].sheet_url).toBeUndefined()
  })

  it('sinkron manual memulai proses dan memantau hasilnya', async () => {
    outageApi.sync.mockResolvedValue({ data: SYNC })
    outageApi.start.mockResolvedValue({ data: { id: 'r2' } })
    outageApi.run.mockResolvedValue({ data: { id: 'r2', status: 'OK', counts: { read: 5, inserted: 1 }, message: null } })
    wrap(<OutageSyncPage />, { 'outages.view': true, 'outages.sync': true })
    await userEvent.click(await screen.findByRole('button', { name: /Sinkron sekarang/ }))
    await waitFor(() => expect(outageApi.start).toHaveBeenCalled())
    await waitFor(() => expect(outageApi.run).toHaveBeenCalledWith('r2'), { timeout: 4000 })
  })
})

const m = (month, p, t, over = {}) => ({ month, partial: false, events: p + t, permanent: p, temporary: t, minutes: 100, ens_kwh: 500, saifi: 0.1, saidi: 2, ...over })
const ANALYSIS = {
  filters: {}, as_of: '2026-11-14', settings: { saidi_min_minutes: 5, saidi_only_permanent: false }, base_customers: 1000,
  coverage: { events: 40, first_at: '2025-01-01', last_at: '2026-11-01', unmatched_feeder_events: 2, without_duration: 0, without_type: 0 },
  kpi: { last_full_month: '2026-10', partial_month: '2026-11', l12m: { events: 300, permanent: 100, temporary: 200, minutes: 1000, ens_kwh: 9000, saifi: 1.5, saidi: 30 }, prev12m: { events: 250, permanent: 90, temporary: 160, minutes: 900, ens_kwh: 8000, saifi: 1.2, saidi: 25 },
    change_pct: { events: 20, permanent: 11.1, temporary: 25, ens_kwh: 12.5, saifi: 25, saidi: 20 }, caidi_l12m: 20 },
  monthly: [m('2026-08', 5, 10), m('2026-09', 6, 9), m('2026-10', 4, 8), m('2026-11', 1, 2, { partial: true })],
  yearly: [{ year: 2026, months: 4, partial: true, events: 56, permanent: 16, temporary: 29, minutes: 400, ens_kwh: 2000, saifi: 0.4, saidi: 8, events_yoy_pct: null, ens_yoy_pct: null, saidi_yoy_pct: null }],
  by_cause: [{ label: 'Pohon', events: 20, share_pct: 50, permanent: 5, ens_kwh: 100, minutes: 200 }], by_weather: [{ label: 'Hujan', events: 10, share_pct: 25, permanent: 2, ens_kwh: 50, minutes: 80 }],
  by_device: [{ label: 'PMT', events: 30, share_pct: 75, permanent: 8, ens_kwh: 150, minutes: 300 }], by_hour: Array.from({ length: 24 }, (_, h) => ({ hour: h, events: h === 14 ? 5 : 1 })),
  by_unit: [{ unit_id: 'u1', unit_name: 'ULP Satu', up3_name: 'UP3 A', events: 40, permanent: 12, temporary: 28, ens_kwh: 600, minutes: 500, customers: 1000, saifi: 1.5, saidi: 30 }],
  by_feeder: [{ feeder_id: 'f-1', code: 'F1', name: 'Penyulang Satu', gi_name: 'GI X', matched: true, events: 20, permanent: 6, temporary: 14, minutes: 300, ens_kwh: 400, l12m_events: 18, prev12m_events: 12, trend_pct: 50, customers: 600, gardu: 30, gardu_kva: 3000, saifi_contribution: 0.5, saidi_contribution: 9 }],
  notes: ['Catatan uji.'],
}
const FEEDER = { feeder: { id: 'f-1', code: 'F1', name: 'Penyulang Satu', gi_name: 'GI X', owner: 'ULP Satu', customers: 600 }, monthly: [{ month: '2026-09', events: 3, permanent: 1, temporary: 2, ens_kwh: 10, minutes: 20 }],
  by_cause: [{ label: 'Pohon', events: 3, share_pct: 100, permanent: 1, ens_kwh: 10, minutes: 20 }], recent: [{ occurred_at: '2026-10-01T03:00:00Z', device: 'PMT', type: 'PERMANEN', minutes: 40, ens_kwh: 12, category: 'Pohon', cause: 'Pohon tumbang', weather: 'Hujan', fault_code: null }],
  gardu: { count: 30, measured: 10, avg_loading_pct: 62.5, at_80: 2, at_100: 1, items: [{ id: 'g1', code: 'GD001', name: 'Gardu 1', unit_name: 'ULP Satu', capacity_kva: 100, loading_pct: 105, measured_on: '2026-10-01' }] } }
const metric = (key, label) => ({ key, label, history: [{ month: '2026-09', value: 5 }, { month: '2026-10', value: 6 }], forecast: [{ month: '2026-11', p10: 3, p50: 5, p90: 8 }], next12m: { p10: 50, p50: 70, p90: 90 }, last12m: 60, quality: { wape: 0.3, naive_wape: 0.4, gain_vs_naive_pct: 25, backtest_points: 20 } })
const FORECAST = { status: 'OK', history_months: 30, last_full_month: '2026-10', seasonal_years: 2, metrics: [metric('permanent', 'Gangguan permanen'), metric('saidi', 'SAIDI (menit)')],
  feeders: [{ feeder_id: 'f-1', name: 'Penyulang Satu', gi_name: 'GI X', customers: 600, l12m_events: 18, prev12m_events: 12, expected_12m: 25, p10: 20, p90: 30, expected_permanent_12m: 8, risk: 'KRITIS' }], notes: [] }

describe('OutageAnalysisPage', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('menampilkan KPI, grafik dan tabel tren', async () => {
    outageApi.analysis.mockResolvedValue({ data: ANALYSIS })
    wrap(<OutageAnalysisPage />)
    expect(await screen.findByText('Gangguan 12 bln terakhir')).toBeInTheDocument()
    expect(screen.getByText('SAIFI (kali/plg)')).toBeInTheDocument()
    expect(screen.getByText('SAIDI (menit/plg)')).toBeInTheDocument()
    expect(screen.getByLabelText('Gangguan permanen dan temporer per bulan')).toBeInTheDocument()
    expect(screen.getByText('ULP Satu')).toBeInTheDocument()
    expect(screen.getByText('Catatan uji.')).toBeInTheDocument()
  })

  it('tab penyulang membuka rincian penyulang dengan gardu', async () => {
    outageApi.analysis.mockResolvedValue({ data: ANALYSIS })
    outageApi.feeder.mockResolvedValue({ data: FEEDER })
    wrap(<OutageAnalysisPage />)
    await screen.findByText('Gangguan 12 bln terakhir')
    await userEvent.click(screen.getByRole('tab', { name: 'Penyulang & gardu' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Penyulang Satu' }))
    expect(await screen.findByText('GD001')).toBeInTheDocument()
    expect(screen.getByText(/1 gardu ≥ 100%/)).toBeInTheDocument()
    expect(outageApi.feeder).toHaveBeenCalledWith('f-1', expect.any(Object))
  })

  it('tab prakiraan menampilkan kualitas dan risiko penyulang', async () => {
    outageApi.analysis.mockResolvedValue({ data: ANALYSIS })
    outageApi.forecast.mockResolvedValue({ data: FORECAST })
    wrap(<OutageAnalysisPage />)
    await screen.findByText('Gangguan 12 bln terakhir')
    await userEvent.click(screen.getByRole('tab', { name: 'Prakiraan' }))
    expect(await screen.findByText('Galat backtest (WAPE)')).toBeInTheDocument()
    expect(screen.getByText('KRITIS')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('tab', { name: 'SAIDI (menit)' }))
    expect(screen.getByLabelText('Prakiraan SAIDI (menit)')).toBeInTheDocument()
  })

  it('riwayat belum cukup ditampilkan sebagai informasi, dan ekspor memicu unduhan', async () => {
    outageApi.analysis.mockResolvedValue({ data: ANALYSIS })
    outageApi.forecast.mockResolvedValue({ data: { status: 'INSUFFICIENT', message: 'Riwayat belum cukup: butuh minimal 24 bulan lengkap (10 tersedia).', metrics: [], feeders: [], notes: [] } })
    outageApi.downloadAnalysisXlsx.mockResolvedValue({ blob: new Blob(['x']), filename: 'A.xlsx' })
    wrap(<OutageAnalysisPage />)
    await screen.findByText('Gangguan 12 bln terakhir')
    await userEvent.click(screen.getByRole('button', { name: /Ekspor Excel/ }))
    await waitFor(() => expect(triggerFileDownload).toHaveBeenCalled())
    await userEvent.click(screen.getByRole('tab', { name: 'Prakiraan' }))
    expect(await screen.findByText(/butuh minimal 24 bulan/)).toBeInTheDocument()
  })

  it('tanpa data menampilkan petunjuk sinkronisasi', async () => {
    outageApi.analysis.mockResolvedValue({ data: { ...ANALYSIS, coverage: { ...ANALYSIS.coverage, events: 0 } } })
    wrap(<OutageAnalysisPage />)
    expect(await screen.findByText(/Belum ada data gangguan/)).toBeInTheDocument()
  })
})
