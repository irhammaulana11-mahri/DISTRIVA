import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import OutageSyncDrawer from './OutageSyncDrawer.jsx'
import { outageApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  outageApi: {
    sync: vi.fn(),
    saveSettings: vi.fn(),
    start: vi.fn(),
    run: vi.fn(),
    alias: vi.fn(),
    analysis: vi.fn(),
    feeder: vi.fn(),
    forecast: vi.fn(),
    downloadAnalysisXlsx: vi.fn(),
  },
  notificationsApi: { list: vi.fn().mockResolvedValue({ data: [] }), markRead: vi.fn(), markAllRead: vi.fn() },
}))

function wrap(ui, can = { 'outages.view': true, 'outages.sync': true }) {
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

const SETTINGS = {
  sheet_id_set: true,
  sheet_id_hint: '1a2b…3c4d',
  gids: [0],
  auto_enabled: true,
  auto_time: '02:00',
  saidi_min_minutes: 5,
  saidi_only_permanent: false,
  updated_at: null,
  last_run: {
    id: 'r1',
    trigger: 'AUTO',
    status: 'OK',
    counts: { read: 120, inserted: 5 },
    message: null,
    created_at: '2026-11-20T02:00:00Z',
    finished_at: '2026-11-20T02:01:00Z',
  },
}

const SYNC_DATA = {
  settings: SETTINGS,
  runs: [
    {
      id: 'r1',
      trigger: 'AUTO',
      status: 'OK',
      counts: { read: 120, inserted: 5, updated: 2, removed: 0, invalid: 0 },
      message: null,
      created_at: '2026-11-20T02:00:00Z',
    },
  ],
  stats: {
    events: 8500,
    first_at: '2020-01-02T00:00:00Z',
    last_at: '2026-11-10T00:00:00Z',
    feeders: 140,
    unmatched_events: 3,
  },
  unmatched: [
    { gi_name: 'GI Krian', feeder_name: 'FEEDER BARU', events: 3, first_at: null, last_at: null },
  ],
  feeders: [{ id: 'f-1', code: 'F1', name: 'Penyulang Krian 1', gi_name: 'GI Krian' }],
  can: { sync: true },
}

describe('OutageSyncDrawer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. menampilkan data status sinkronisasi, statistik, dan riwayat sinkronisasi gangguan', async () => {
    outageApi.sync.mockResolvedValue({ data: SYNC_DATA })

    wrap(<OutageSyncDrawer open={true} onClose={() => {}} />)

    expect(await screen.findByText('Sinkronisasi Data Gangguan')).toBeInTheDocument()
    expect(screen.getByText('Google Sheet')).toBeInTheDocument()
    expect(screen.getByText('8.500')).toBeInTheDocument()
    expect(screen.getByText('FEEDER BARU')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Sinkronkan Sekarang/i })).toBeInTheDocument()
  })

  it('2. dapat mengeksekusi penarikan sinkronisasi gangguan saat tombol diklik', async () => {
    const user = userEvent.setup()
    outageApi.sync.mockResolvedValue({ data: SYNC_DATA })
    outageApi.start.mockResolvedValue({ data: { id: 'r2', status: 'QUEUED' } })
    outageApi.run.mockResolvedValue({ data: { id: 'r2', status: 'OK', counts: { read: 10, inserted: 2 } } })

    const onSynced = vi.fn()
    wrap(<OutageSyncDrawer open={true} onClose={() => {}} onSynced={onSynced} />)

    const syncBtn = await screen.findByRole('button', { name: /Sinkronkan Sekarang/i })
    await user.click(syncBtn)

    expect(outageApi.start).toHaveBeenCalled()
  })
})
