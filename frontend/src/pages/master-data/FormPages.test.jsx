import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import KhsMaterialMapImportPage from './KhsMaterialMapImportPage.jsx'
import WarehouseSnapshotImportPage from './WarehouseSnapshotImportPage.jsx'
import { KhsDraftEditPage, KhsImportPage } from './KhsPages.jsx'
import { MaterialEditPage } from './MaterialPages.jsx'
import { khsMaterialMapApi, warehousesApi, masterDataApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  khsMaterialMapApi: { create: vi.fn() },
  warehousesApi: { list: vi.fn(), importSnapshot: vi.fn() },
  masterDataApi: { khsItem: vi.fn(), updateKhsDraft: vi.fn(), importKhs: vi.fn(), material: vi.fn(), categories: vi.fn(), updateMaterial: vi.fn() },
}))

function mount(path, routes) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AccessContext.Provider value={{ loading: false, can: {}, canWrite: {}, isSysAdmin: false }}>
        <NotificationProvider>
          <Routes>
            {routes}
            <Route path="*" element={<div>DAFTAR</div>} />
          </Routes>
        </NotificationProvider>
      </AccessContext.Provider>
    </MemoryRouter>,
  )
}

describe('Halaman form Master Data (laci hanya pratinjau)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('pemetaan SKU↔KHS: tambah manual disimpan di halaman sendiri lalu kembali ke daftar', async () => {
    khsMaterialMapApi.create.mockResolvedValue({ data: { id: 'm1' } })
    mount('/master-data/mapping/impor', <Route path="/master-data/mapping/impor" element={<KhsMaterialMapImportPage />} />)
    await userEvent.click(await screen.findByRole('button', { name: /Tambah Manual/ }))
    await userEvent.type(screen.getByPlaceholderText('Contoh: KHS-KBL-01'), 'KHS-01')
    await userEvent.type(screen.getByPlaceholderText('Contoh: 1002389'), '3110025')
    await userEvent.click(screen.getByRole('button', { name: /Simpan Pemetaan/ }))
    await waitFor(() => expect(khsMaterialMapApi.create).toHaveBeenCalledWith({ khs_code: 'KHS-01', material_no: '3110025', note: undefined }))
    expect(await screen.findByText('DAFTAR')).toBeInTheDocument()
  })

  it('impor cuplikan stok: halaman memuat gudang dari id; gudang tak dikenal menampilkan galat', async () => {
    warehousesApi.list.mockResolvedValue({ data: [{ id: 'w1', code: 'GD-1', name: 'Gudang Satu' }] })
    mount('/master-data/warehouses/w1/impor-stok', <Route path="/master-data/warehouses/:id/impor-stok" element={<WarehouseSnapshotImportPage />} />)
    expect(await screen.findByText('Impor Cuplikan Stok: Gudang Satu')).toBeInTheDocument()
  })

  it('impor cuplikan stok: gudang tidak ditemukan', async () => {
    warehousesApi.list.mockResolvedValue({ data: [] })
    mount('/master-data/warehouses/zzz/impor-stok', <Route path="/master-data/warehouses/:id/impor-stok" element={<WarehouseSnapshotImportPage />} />)
    expect(await screen.findByText('Gudang tidak ditemukan.')).toBeInTheDocument()
  })

  it('koreksi draf KHS: dibangun dari versi DRAFT item; tanpa draf menampilkan galat', async () => {
    masterDataApi.khsItem.mockResolvedValueOnce({ data: { id: 'k1', code: '7', versions: [{ id: 'v2', status: 'DRAFT', version_number: 2, name: 'Tiang Beton 11m', unit_text: 'Btg', category: '', valid_from: '2026-11-01' }] } })
    mount('/master-data/khs/k1/koreksi', <Route path="/master-data/khs/:id/koreksi" element={<KhsDraftEditPage />} />)
    expect(await screen.findByText('Koreksi Draf KHS')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Tiang Beton 11m')).toBeInTheDocument()
  })

  it('koreksi draf KHS tanpa versi draf', async () => {
    masterDataApi.khsItem.mockResolvedValueOnce({ data: { id: 'k1', code: '7', versions: [{ id: 'v1', status: 'ACTIVE', version_number: 1 }] } })
    mount('/master-data/khs/k1/koreksi', <Route path="/master-data/khs/:id/koreksi" element={<KhsDraftEditPage />} />)
    expect(await screen.findByText(/tidak punya versi draf/)).toBeInTheDocument()
  })

  it('impor KHS dan ubah pemetaan material membuka halaman, bukan laci', async () => {
    mount('/master-data/khs/impor', <Route path="/master-data/khs/impor" element={<KhsImportPage />} />)
    expect(await screen.findByText(/Impor Katalog KHS/)).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('ubah pemetaan material: dimuat lewat id bersama kategori', async () => {
    masterDataApi.material.mockResolvedValue({ data: { id: 'mat-1', code: '1002389', name: 'Trafo', category: null, is_active: true } })
    masterDataApi.categories.mockResolvedValue({ data: [] })
    mount('/master-data/materials/mat-1/ubah', <Route path="/master-data/materials/:id/ubah" element={<MaterialEditPage />} />)
    expect(await screen.findByText('Ubah Pemetaan Material')).toBeInTheDocument()
  })
})
