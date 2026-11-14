import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import MimsStockPullPage from './MimsStockPullPage.jsx'
import { warehousesApi } from '../../services/api.js'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'

vi.mock('../../services/api.js', () => ({
  warehousesApi: {
    list: vi.fn(),
    mimsTokenStatus: vi.fn(),
    mimsAutoSettings: vi.fn(),
    syncStock: vi.fn(),
  },
}))

describe('MimsStockPullPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    warehousesApi.list.mockResolvedValue({
      data: [
        { id: 'wh-1', code: 'GDG-01', name: 'Gudang Utama Mojokerto', plant: '5118', stor_loc: '2080' },
        { id: 'wh-2', code: 'GDG-02', name: 'Gudang Rayon Jombang', plant: '5118', stor_loc: '2810' },
      ],
    })
    warehousesApi.mimsTokenStatus.mockResolvedValue({
      data: { saved: false },
    })
    warehousesApi.mimsAutoSettings.mockResolvedValue({
      data: { auto_enabled: false },
    })
  })

  it('merender mode halaman penuh dengan header aman, filter gudang, dan form kredensial', async () => {
    render(
      <MemoryRouter>
        <NotificationProvider>
          <MimsStockPullPage asPage={true} />
        </NotificationProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /Tarik Stok dari MIMS/i })).toBeInTheDocument()
      expect(screen.getByText(/Koneksi Aman & Perlindungan Kredensial/i)).toBeInTheDocument()
      expect(screen.getByText(/Gudang Utama Mojokerto/i)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/Tempel token sesi MIMS Anda di sini/i)).toBeInTheDocument()
    })
  })

  it('dapat menampilkan dan menyembunyikan input kata sandi (toggle mask)', async () => {
    render(
      <MemoryRouter>
        <NotificationProvider>
          <MimsStockPullPage asPage={true} />
        </NotificationProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Tempel token sesi MIMS Anda di sini/i)).toBeInTheDocument()
    })

    const tokenInput = screen.getByPlaceholderText(/Tempel token sesi MIMS Anda di sini/i)
    expect(tokenInput).toHaveAttribute('type', 'password')

    const toggleBtn = screen.getByRole('button', { name: /Tampilkan token/i })
    await userEvent.click(toggleBtn)

    expect(tokenInput).toHaveAttribute('type', 'text')

    const hideBtn = screen.getByRole('button', { name: /Sembunyikan token/i })
    await userEvent.click(hideBtn)

    expect(tokenInput).toHaveAttribute('type', 'password')
  })

  it('merender KPI ringkasan dan tabel hasil saat penarikan stok berhasil pada mode halaman penuh', async () => {
    warehousesApi.syncStock.mockResolvedValueOnce({
      data: [
        {
          warehouse_id: 'wh-1',
          warehouse_code: 'GDG-01',
          warehouse_name: 'Gudang Utama Mojokerto',
          status: 'OK',
          total: 1254,
          mapped: 1100,
          snapshot_id: 'snap-1',
          message: 'Berhasil',
        },
      ],
    })

    render(
      <MemoryRouter>
        <NotificationProvider>
          <MimsStockPullPage asPage={true} />
        </NotificationProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Tempel token sesi MIMS Anda di sini/i)).toBeInTheDocument()
    })

    const tokenInput = screen.getByPlaceholderText(/Tempel token sesi MIMS Anda di sini/i)
    fireEvent.change(tokenInput, { target: { value: 'token-mims-valid-9988' } })

    const submitBtn = screen.getByRole('button', { name: /Tarik Stok Sekarang/i })
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText(/Hasil Penarikan Stok MIMS/i)).toBeInTheDocument()
      expect(screen.getByText(/Total SKU Material/i)).toBeInTheDocument()
      expect(screen.getByText(/SKU Terpetakan/i)).toBeInTheDocument()
      expect(screen.getAllByText(/Belum Terpetakan/i).length).toBeGreaterThan(0)
      expect(screen.getByText(/SKU Belum Terpetakan →/i)).toBeInTheDocument()
    })
  })
})
