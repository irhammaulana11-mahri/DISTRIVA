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
    mimsRunActive: vi.fn(),
    watchMimsRun: vi.fn(),
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
    warehousesApi.mimsRunActive.mockResolvedValue({ data: null })
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
  it('status gudang mengikuti dokumen yang ditarik, bukan DILEWATI saat stok tidak dipilih', async () => {
    const skippedStock = { status: 'SKIPPED', message: 'Stok tidak ditarik (tidak dipilih).', total: 0, mapped: 0, snapshot_id: null }
    warehousesApi.syncStock.mockResolvedValueOnce({
      data: [
        { warehouse_id: 'wh-1', warehouse_code: '5118-2810', warehouse_name: 'Gd Ry Jombang', ...skippedStock, receipts: { status: 'OK', documents_new: 47, lines: 133 }, issues: { status: 'OK', documents_new: 78, lines: 440 } },
        { warehouse_id: 'wh-2', warehouse_code: '5118-2820', warehouse_name: 'Gd Ry Ngoro', ...skippedStock, receipts: { status: 'OK', documents_new: 3, lines: 9 }, issues: { status: 'FAILED', message: 'waktu tunggu habis' } },
        { warehouse_id: 'wh-3', warehouse_code: '5118-2830', warehouse_name: 'Gd Ry Ploso', ...skippedStock, receipts: { status: 'FAILED', message: 'waktu tunggu habis' } },
        { warehouse_id: 'wh-4', warehouse_code: '5118-2080', warehouse_name: 'PLN Area Mojokerto', ...skippedStock },
      ],
    })
    render(
      <MemoryRouter>
        <NotificationProvider>
          <MimsStockPullPage asPage={true} />
        </NotificationProvider>
      </MemoryRouter>
    )
    fireEvent.change(await screen.findByPlaceholderText(/Tempel token sesi MIMS Anda di sini/i), { target: { value: 'token-mims-valid-9988' } })
    await userEvent.click(screen.getByRole('button', { name: /Tarik Stok Sekarang/i }))

    await waitFor(() => expect(screen.getByText(/Hasil Penarikan Stok MIMS/i)).toBeInTheDocument())
    expect(screen.getByText('SELESAI')).toBeInTheDocument()
    expect(screen.getByText('SEBAGIAN')).toBeInTheDocument()
    expect(screen.getByText('GAGAL')).toBeInTheDocument()
    expect(screen.getAllByText('DILEWATI')).toHaveLength(1)                       // only the warehouse where nothing was pulled
    expect(screen.queryByText(/Stok tidak ditarik/i)).not.toBeInTheDocument()
  })

  it('menampilkan kemajuan penarikan yang sudah berjalan: gudang ke berapa, langkah, dan perkiraan sisa waktu', async () => {
    const run = {
      id: 'run-1', status: 'RUNNING', warehouses_total: 11, warehouses_done: 4, current_warehouse: '5118-2810 - Gd Ry Jombang', current_step: 'ISSUES',
      started_at: new Date(Date.now() - 120000).toISOString(),
      results: [{ warehouse_id: 'wh-1', warehouse_code: '5118-2080', warehouse_name: 'PLN Area Mojokerto', status: 'OK' }],
    }
    warehousesApi.mimsRunActive.mockResolvedValue({ data: run })
    warehousesApi.watchMimsRun.mockImplementation((first, onProgress) => { onProgress(first.results, first); return new Promise(() => {}) })
    render(
      <MemoryRouter>
        <NotificationProvider>
          <MimsStockPullPage asPage={true} />
        </NotificationProvider>
      </MemoryRouter>
    )
    expect(await screen.findByText('Penarikan MIMS sedang berjalan')).toBeInTheDocument()
    expect(screen.getByText('4 dari 11 gudang selesai')).toBeInTheDocument()
    expect(screen.getByText('5118-2810 - Gd Ry Jombang')).toBeInTheDocument()
    expect(screen.getByText(/menarik pengeluaran/)).toBeInTheDocument()
    expect(screen.getByText(/Perkiraan sisa/)).toBeInTheDocument()
    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '36')
    expect(screen.getByRole('button', { name: /Menarik Stok/i })).toBeDisabled()
  })
})
