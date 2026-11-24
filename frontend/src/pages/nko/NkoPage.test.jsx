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
    gaps: vi.fn(),
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

const MOCK_GAPS = {
  data: {
    year: 2026,
    month: 5,
    totals: {
      empty_count: 2,
      unvalidated_count: 1,
    },
    units: [
      {
        unit_id: 'u-1',
        unit_name: 'ULP Jombang',
        unit_type: 'ULP',
        total_indicators: 23,
        empty_count: 2,
        unvalidated_count: 1,
        items: [
          {
            code: 'SAIDI',
            name: 'SAIDI (Menit/Pelanggan)',
            group: 'KEANDALAN',
            status: 'KOSONG',
            system_source: true,
          },
          {
            code: 'GGN_TM',
            name: 'Gangguan TM',
            group: 'KEANDALAN',
            status: 'BELUM_TERVALIDASI',
            system_source: true,
          },
        ],
      },
      {
        unit_id: 'up3-1',
        unit_name: 'UP3 Mojokerto',
        unit_type: 'UP3',
        total_indicators: 25,
        empty_count: 0,
        unvalidated_count: 0,
        items: [],
      },
    ],
  },
}

const MOCK_INPUTS_WITH_AUXILIARY = {
  data: {
    unit_id: 'u-1',
    unit_name: 'ULP Jombang',
    year: 2026,
    month: 5,
    items: [
      {
        code: 'SUSUT',
        name: 'Susut Distribusi tanpa E-Min',
        group: 'EFISIENSI',
        unit_label: '%',
        polarity: 1,
        weight: 10,
        target: 6.5,
        editable: true,
        auxiliary: false,
        system_source: true,
        system_validated: false,
        value: 7.2,
        source: 'SISTEM',
        manual: null,
        system: 7.2,
        note: null,
      },
      {
        code: 'kwh-beli',
        name: 'kWh Beli (Kumulatif)',
        group: 'Masukan pembantu: Susut distribusi tanpa E-Min',
        unit_label: 'kWh',
        polarity: null,
        weight: null,
        target: null,
        editable: true,
        auxiliary: true,
        system_source: false,
        system_validated: true,
        value: 150000000,
        source: 'MANUAL',
        manual: 150000000,
        system: null,
        note: 'Data beli Mei',
      },
    ],
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

  it('4. menampilkan ringkasan kesiapan data dan daftar unit pada tab Kekurangan Realisasi (Gaps)', async () => {
    nkoApi.snapshots.mockResolvedValue({ data: [] })
    nkoApi.gaps.mockResolvedValue(MOCK_GAPS)

    const user = userEvent.setup()
    wrap(<NkoPage />)

    const gapsTab = await screen.findByRole('tab', { name: /Kekurangan Realisasi \(Gaps\)/i })
    await user.click(gapsTab)

    expect(await screen.findByText('Total Unit Terdata')).toBeInTheDocument()
    expect(screen.getByText('Indikator Kosong')).toBeInTheDocument()
    expect(screen.getByText('Belum Tervalidasi')).toBeInTheDocument()
    expect(screen.getByText('ULP Jombang')).toBeInTheDocument()
    expect(screen.getByText('UP3 Mojokerto')).toBeInTheDocument()
    expect(screen.getByText('Siap Dihitung')).toBeInTheDocument()
    expect(screen.getByText('Perlu Masukan')).toBeInTheDocument()
  })

  it('5. tombol Buka Masukan pada tab Gaps mengalihkan ke tab Masukan Realisasi Manual', async () => {
    nkoApi.snapshots.mockResolvedValue({ data: [] })
    nkoApi.gaps.mockResolvedValue(MOCK_GAPS)
    nkoApi.inputs.mockResolvedValue(MOCK_INPUTS_WITH_AUXILIARY)

    const user = userEvent.setup()
    wrap(<NkoPage />, { 'nko.view': true, 'nko.input': true })

    const gapsTab = await screen.findByRole('tab', { name: /Kekurangan Realisasi \(Gaps\)/i })
    await user.click(gapsTab)

    const bukaMasukanButtons = await screen.findAllByRole('button', { name: /Buka Masukan/i })
    expect(bukaMasukanButtons.length).toBeGreaterThan(0)
    await user.click(bukaMasukanButtons[0])

    // Seharusnya berpindah ke tab Masukan Realisasi Manual
    expect(await screen.findByText('Masukan Realisasi Kumulatif (YTD)')).toBeInTheDocument()
  })

  it('6. menampilkan badge Masukan Pembantu dan status Perlu Validasi Workbook pada tab Masukan Realisasi Manual', async () => {
    nkoApi.snapshots.mockResolvedValue({ data: [] })
    nkoApi.inputs.mockResolvedValue(MOCK_INPUTS_WITH_AUXILIARY)

    const user = userEvent.setup()
    wrap(<NkoPage />, { 'nko.view': true, 'nko.input': true })

    const inputsTab = await screen.findByRole('tab', { name: /Masukan Realisasi Manual/i })
    await user.click(inputsTab)

    expect(await screen.findByText('Susut Distribusi tanpa E-Min')).toBeInTheDocument()
    expect(screen.getByText('Perlu Validasi Workbook')).toBeInTheDocument()
    expect(screen.getByText('kWh Beli (Kumulatif)')).toBeInTheDocument()
    expect(screen.getByText('Masukan Pembantu')).toBeInTheDocument()
    expect(screen.getByText(/Komponen perhitungan susut distribusi kumulatif/i)).toBeInTheDocument()
  })
})
