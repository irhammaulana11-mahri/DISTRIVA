import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import EisReportsPage from './EisReportsPage.jsx'
import { eisReportsApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  eisReportsApi: {
    list: vi.fn(),
    coverage: vi.fn(),
    lines: vi.fn(),
    importFiles: vi.fn(),
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

function wrap(ui, can = { 'eis_reports.view': true }) {
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

const MOCK_FILES = {
  data: [
    {
      id: 'f-1',
      family: '309',
      period: '2026-04',
      unit_id: 'u-1',
      unit_name: 'ULP Jombang',
      unit_type: 'ULP',
      original_name: '309-51453-042026.xls',
      status: 'AKTIF',
      line_count: 85,
      warnings: [],
      imported_at: '2026-11-20T10:00:00Z',
    },
    {
      id: 'f-2',
      family: 'DIFI',
      period: '2026-05',
      unit_id: 'u-1',
      unit_name: 'ULP Jombang',
      unit_type: 'ULP',
      original_name: 'DIFI-51453-052026.xlsx',
      status: 'AKTIF',
      line_count: 42,
      warnings: ['kode unit dipulihkan'],
      imported_at: '2026-11-21T10:00:00Z',
    },
  ],
  meta: {
    total: 2,
    per_page: 25,
    current_page: 1,
    last_page: 1,
  },
  families: ['309', '309EIS', 'DIFI', 'GGNALL', 'TAGSUS'],
}

const MOCK_LINES = {
  data: {
    file: {
      id: 'f-2',
      family: 'DIFI',
      period: '2026-05',
      unit_name: 'ULP Jombang',
      status: 'AKTIF',
      original_name: 'DIFI-51453-052026.xlsx',
      summary: { saidi: 12.5, saifi: 0.85, ens: 350.2 },
    },
    lines: [
      {
        line_no: 1,
        group_label: 'Penyebab Gangguan Internal',
        label: 'Komponen Rusak',
        code: 'INT01',
        values: { kali: 3, menit: 120 },
      },
    ],
  },
}

describe('EisReportsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. menampilkan daftar berkas laporan EIS dengan tombol aksi pratinjau', async () => {
    eisReportsApi.list.mockResolvedValue(MOCK_FILES)

    wrap(<EisReportsPage />)

    expect(await screen.findByText('Laporan Bulanan EIS / AP2T')).toBeInTheDocument()
    expect(screen.getByText('309-51453-042026.xls')).toBeInTheDocument()
    expect(screen.getByText('DIFI-51453-052026.xlsx')).toBeInTheDocument()
    expect(screen.getByText('kode unit dipulihkan')).toBeInTheDocument()
  })

  it('2. tombol unggah laporan hanya muncul jika memiliki izin eis_reports.import', async () => {
    eisReportsApi.list.mockResolvedValue(MOCK_FILES)

    // Tanpa izin import
    const { unmount } = wrap(<EisReportsPage />, { 'eis_reports.view': true })
    expect(await screen.findByText('Laporan Bulanan EIS / AP2T')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Unggah Laporan/i })).toBeNull()
    unmount()

    // Dengan izin import
    wrap(<EisReportsPage />, { 'eis_reports.view': true, 'eis_reports.import': true })
    expect(await screen.findByRole('button', { name: /Unggah Laporan/i })).toBeInTheDocument()
  })

  it('3. membuka drawer rincian baris isi laporan saat tombol Lihat Isi diklik', async () => {
    eisReportsApi.list.mockResolvedValue(MOCK_FILES)
    eisReportsApi.lines.mockResolvedValue(MOCK_LINES)

    const user = userEvent.setup()
    wrap(<EisReportsPage />)

    const viewButtons = await screen.findAllByRole('button', { name: /Lihat Isi/i })
    await user.click(viewButtons[1])

    expect(await screen.findByText('Ringkasan DIFI (Kepala Laporan)')).toBeInTheDocument()
    expect(screen.getByText('Komponen Rusak')).toBeInTheDocument()
  })
})
