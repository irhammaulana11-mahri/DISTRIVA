import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import NkoPage from './NkoPage.jsx'
import { nkoApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  nkoApi: {
    definitions: vi.fn(),
    snapshots: vi.fn(),
    snapshot: vi.fn(),
    ranking: vi.fn(),
    inputs: vi.fn(),
    saveInputs: vi.fn(),
    calculate: vi.fn(),
  },
  unitScopeApi: {
    get: vi.fn().mockResolvedValue({
      data: {
        scope: 'GLOBAL',
        up3_units: [{ id: 'up3-1', code: '51450', name: 'UP3 Mojokerto' }],
        ulp_units: [{ id: 'u-1', code: '51453', name: 'ULP Jombang', parent_id: 'up3-1' }],
      },
    }),
  },
  notificationsApi: {
    list: vi.fn().mockResolvedValue({ data: [] }),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
}))

function wrap(ui, can = { 'nko.view': true }) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: 'usr-1', name: 'Tester' }, status: 'authenticated' }}>
        <AccessContext.Provider value={{ can, isSysAdmin: false, createUnits: [], loading: false }}>
          <NotificationProvider>{ui}</NotificationProvider>
        </AccessContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const MOCK_SNAPSHOT_SUMMARY = {
  data: [
    {
      id: 'snap-1',
      period: '2026-05',
      unit_id: 'u-1',
      unit_name: 'ULP Jombang',
      unit_type: 'ULP',
      total_nilai: 98.45,
      nko: 101.2,
      rank: 2,
      rank_of: 10,
      missing_count: 0,
      calculated_at: '2026-11-20T12:00:00Z',
    },
  ],
}

const MOCK_SNAPSHOT_DETAIL = {
  data: {
    id: 'snap-1',
    period: '2026-05',
    unit_id: 'u-1',
    unit_name: 'ULP Jombang',
    unit_type: 'ULP',
    total_nilai: 98.45,
    nko: 101.2,
    rank: 2,
    rank_of: 10,
    missing_count: 0,
    calculated_at: '2026-11-20T12:00:00Z',
    is_current: true,
    missing: [],
    values: [
      {
        code: 'GRP_KEANDALAN',
        number: '1',
        name: 'KEANDALAN DISTRIBUSI',
        level: 0,
        parent_code: null,
        polarity: null,
        unit_label: null,
        weight: 25,
        target: null,
        realisasi: null,
        source: null,
        pencapaian: 105,
        nilai: 26.25,
      },
      {
        code: 'SAIDI',
        number: '1.1',
        name: 'SAIDI (Menit/Pelanggan)',
        level: 1,
        parent_code: 'GRP_KEANDALAN',
        polarity: 1,
        unit_label: 'Menit/Plg',
        weight: 12.5,
        target: 120,
        realisasi: 95.5,
        source: 'SISTEM',
        pencapaian: 108.2,
        nilai: 13.52,
      },
    ],
  },
}

const MOCK_RANKING = {
  data: {
    ulp: [
      {
        id: 'snap-2',
        period: '2026-05',
        unit_id: 'u-2',
        unit_name: 'ULP Mojokerto Kota',
        unit_type: 'ULP',
        total_nilai: 99.1,
        nko: 103.4,
        rank: 1,
        rank_of: 10,
        complete: true,
        calculated_at: '2026-11-20T12:00:00Z',
      },
      {
        id: 'snap-1',
        period: '2026-05',
        unit_id: 'u-1',
        unit_name: 'ULP Jombang',
        unit_type: 'ULP',
        total_nilai: 98.45,
        nko: 101.2,
        rank: 2,
        rank_of: 10,
        complete: true,
        calculated_at: '2026-11-20T12:00:00Z',
      },
    ],
    up3: {
      id: 'snap-up3',
      period: '2026-05',
      unit_id: 'up3-1',
      unit_name: 'UP3 Mojokerto',
      unit_type: 'UP3',
      total_nilai: 97.8,
      nko: 100.5,
      rank: null,
      rank_of: null,
      complete: true,
      calculated_at: '2026-11-20T12:00:00Z',
    },
  },
}

describe('NkoPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. menampilkan hero card dan panduan awal pemilihan unit', async () => {
    nkoApi.snapshots.mockResolvedValue({ data: [] })

    wrap(<NkoPage />)

    expect(await screen.findByText('Nilai Kinerja Organisasi (NKO)')).toBeInTheDocument()
    expect(screen.getByText(/Pilih satu unit \(ULP atau UP3\)/i)).toBeInTheDocument()
  })

  it('2. tombol Hitung NKO hanya tampil bagi pemegang hak nko.calculate', async () => {
    nkoApi.snapshots.mockResolvedValue({ data: [] })

    // Tanpa izin calculate
    const { unmount } = wrap(<NkoPage />, { 'nko.view': true })
    expect(await screen.findByText('Nilai Kinerja Organisasi (NKO)')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Hitung NKO/i })).toBeNull()
    unmount()

    // Dengan izin calculate
    wrap(<NkoPage />, { 'nko.view': true, 'nko.calculate': true })
    expect(await screen.findByRole('button', { name: /Hitung NKO/i })).toBeInTheDocument()
  })

  it('3. menampilkan peringkat ULP pada tab Peringkat ULP', async () => {
    nkoApi.snapshots.mockResolvedValue({ data: [] })
    nkoApi.ranking.mockResolvedValue(MOCK_RANKING)

    const user = userEvent.setup()
    wrap(<NkoPage />)

    const rankingTab = await screen.findByRole('tab', { name: /Peringkat ULP/i })
    await user.click(rankingTab)

    expect(await screen.findByText('ULP Mojokerto Kota')).toBeInTheDocument()
    expect(screen.getByText('ULP Jombang')).toBeInTheDocument()
    expect(screen.getByText('#1')).toBeInTheDocument()
    expect(screen.getByText('#2')).toBeInTheDocument()
  })
})
