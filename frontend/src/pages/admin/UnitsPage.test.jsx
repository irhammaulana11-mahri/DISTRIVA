import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import UnitsPage from './UnitsPage.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import { adminApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  adminApi: {
    access: vi.fn(),
    units: vi.fn(),
    unit: vi.fn(),
    createUnit: vi.fn(),
    updateUnit: vi.fn(),
  },
}))

vi.mock('../../features/auth/AuthContext.jsx', () => ({
  useAuth: () => ({
    status: 'guest',
    user: null,
    mustChangePassword: false,
    mfaState: null,
  }),
}))

function renderUnitsPage() {
  return render(
    <MemoryRouter>
      <NotificationProvider>
        <UnitsPage />
      </NotificationProvider>
    </MemoryRouter>
  )
}

describe('UnitsPage — UP3-first collapse & lazy-load child ULP on expand', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminApi.access.mockResolvedValue({
      can: { 'organizational_units.view': true },
      can_write: { 'organizational_units.create': true, 'organizational_units.update': true },
    })
  })

  it('memuat data UP3 saja saat awal dalam kondisi collapse dan baru mengambil data ULP saat UP3 di-expand', async () => {
    adminApi.units.mockResolvedValue({
      data: [
        { id: 'up3-1', code: '51MJK', name: 'UP3 Mojokerto', unit_type: 'UP3', address: null, is_active: true },
        { id: 'up3-2', code: '51SDA', name: 'UP3 Sidoarjo', unit_type: 'UP3', address: null, is_active: true },
      ],
      meta: { current_page: 1, per_page: 10, total: 2, last_page: 1 },
    })
    adminApi.unit.mockResolvedValue({
      data: {
        id: 'up3-1',
        code: '51MJK',
        name: 'UP3 Mojokerto',
        unit_type: 'UP3',
        is_active: true,
        children: [
          { id: 'ulp-2', code: '51452', name: 'ULP Mojokerto', unit_type: 'ULP', is_active: true },
          { id: 'ulp-1', code: '51458', name: 'ULP Mojoagung', unit_type: 'ULP', is_active: true },
        ],
        histories: [],
      },
    })

    renderUnitsPage()

    // Initial fetch requests unit_type: 'UP3' only
    await waitFor(() => {
      expect(adminApi.units).toHaveBeenCalledWith({
        page: 1,
        per_page: 10,
        search: '',
        unit_type: 'UP3',
      })
    })
    expect(adminApi.unit).not.toHaveBeenCalled()

    // Both UP3 branches rendered collapsed
    expect(await screen.findByText('UP3 Mojokerto')).toBeInTheDocument()
    expect(screen.getByText('UP3 Sidoarjo')).toBeInTheDocument()
    expect(screen.queryByText('ULP Mojokerto')).not.toBeInTheDocument()
    expect(screen.queryByText('ULP Mojoagung')).not.toBeInTheDocument()

    const expandBtns = screen.getAllByRole('button', { name: 'Buka cabang unit' })
    expect(expandBtns).toHaveLength(2)
    expect(expandBtns[0]).toHaveAttribute('aria-expanded', 'false')

    // Expand UP3 Mojokerto -> triggers lazy fetch adminApi.unit('up3-1')
    await userEvent.click(expandBtns[0])

    await waitFor(() => {
      expect(adminApi.unit).toHaveBeenCalledWith('up3-1')
    })

    // Children rendered under UP3 Mojokerto + badge '2 ULP'
    expect(await screen.findByText('ULP Mojokerto')).toBeInTheDocument()
    expect(screen.getByText('ULP Mojoagung')).toBeInTheDocument()
    expect(screen.getByText('2 ULP')).toBeInTheDocument()

    // Collapse hides children again without extra API call
    const collapseBtn = screen.getByRole('button', { name: 'Tutup cabang unit' })
    expect(collapseBtn).toHaveAttribute('aria-expanded', 'true')
    await userEvent.click(collapseBtn)

    expect(screen.queryByText('ULP Mojokerto')).not.toBeInTheDocument()
    expect(screen.queryByText('ULP Mojoagung')).not.toBeInTheDocument()
    expect(adminApi.unit).toHaveBeenCalledTimes(1)

    // Re-expand uses cached data cleanly without redundant call
    await userEvent.click(screen.getAllByRole('button', { name: 'Buka cabang unit' })[0])
    expect(await screen.findByText('ULP Mojokerto')).toBeInTheDocument()
    expect(adminApi.unit).toHaveBeenCalledTimes(1)
  })

  it('menampilkan pesan galat saat expand UP3 gagal dan mendukung muat ulang (Coba Lagi)', async () => {
    adminApi.units.mockResolvedValue({
      data: [{ id: 'up3-1', code: '51MJK', name: 'UP3 Mojokerto', unit_type: 'UP3', is_active: true }],
      meta: { current_page: 1, per_page: 10, total: 1, last_page: 1 },
    })
    adminApi.unit
      .mockRejectedValueOnce(new Error('Gagal mengambil unit anak.'))
      .mockResolvedValueOnce({
        data: {
          id: 'up3-1',
          code: '51MJK',
          name: 'UP3 Mojokerto',
          unit_type: 'UP3',
          is_active: true,
          children: [{ id: 'ulp-1', code: '51452', name: 'ULP Mojokerto', unit_type: 'ULP', is_active: true }],
        },
      })

    renderUnitsPage()
    const expandBtn = await screen.findByRole('button', { name: 'Buka cabang unit' })
    await userEvent.click(expandBtn)

    expect(await screen.findByText('Gagal mengambil unit anak.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Coba Lagi' }))

    expect(await screen.findByText('ULP Mojokerto')).toBeInTheDocument()
  })

  it('saat mencari kata kunci unit, pencarian tidak dipaksa unit_type UP3 agar ULP ikut ditemukan', async () => {
    const allUnits = [
      { id: 'up3-1', code: '51MJK', name: 'UP3 Mojokerto', unit_type: 'UP3', is_active: true },
      {
        id: 'ulp-9',
        code: '51458',
        name: 'ULP Mojoagung',
        unit_type: 'ULP',
        parent_id: 'up3-1',
        parent_name: 'UP3 Mojokerto',
        is_active: true,
      },
    ]

    adminApi.units.mockImplementation(({ search = '', unit_type = '' }) => {
      const term = search.toLowerCase()
      const matched = allUnits.filter((u) => {
        const matchType = !unit_type || u.unit_type === unit_type
        const matchSearch = !term || u.name.toLowerCase().includes(term) || u.code.toLowerCase().includes(term)
        return matchType && matchSearch
      })
      return Promise.resolve({
        data: matched,
        meta: { current_page: 1, per_page: 10, total: matched.length, last_page: 1 },
      })
    })

    renderUnitsPage()
    expect(await screen.findByText('UP3 Mojokerto')).toBeInTheDocument()

    const searchInput = screen.getByPlaceholderText('Cari kode atau nama unit…')
    await userEvent.type(searchInput, 'Mojoagung')

    await waitFor(() => {
      expect(adminApi.units).toHaveBeenLastCalledWith({
        page: 1,
        per_page: 10,
        search: 'Mojoagung',
        unit_type: '',
      })
    })
    expect(await screen.findByText('ULP Mojoagung')).toBeInTheDocument()
  })
})
