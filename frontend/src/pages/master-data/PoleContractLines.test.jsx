import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { PoleContractCreatePage, PoleContractEditPage } from './PoleContractFormPages.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import WarehousesPage from './WarehousesPage.jsx'
import WarehouseCreatePage from './WarehouseCreatePage.jsx'
import WarehouseSnapshotImportPage from './WarehouseSnapshotImportPage.jsx'
import PoleContractsPage from './PoleContractsPage.jsx'
import ApplicationAllocationPanel from '../applications/ApplicationAllocationPanel.jsx'
import { adminApi, masterDataApi, warehousesApi, poleContractsApi, allocationsApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  adminApi: { units: vi.fn() },
  masterDataApi: { khsList: vi.fn() },
  warehousesApi: {
    list: vi.fn(),
    create: vi.fn(),
    snapshots: vi.fn(),
    importSnapshot: vi.fn(),
    snapshotDetail: vi.fn(),
    position: vi.fn(),
  },
  poleContractsApi: {
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    close: vi.fn(),
  },
  allocationsApi: {
    listForApplication: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    putMaterials: vi.fn(),
    putPoles: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
  },
}))

function renderWithContext(ui, { can = {} } = {}) {
  return render(
    <MemoryRouter>
      <AccessContext.Provider value={{ can, isSysAdmin: false, loading: false }}>
        <NotificationProvider>
          <Routes>
          <Route path="/master-data/warehouses/baru" element={<WarehouseCreatePage />} />
          <Route path="/master-data/warehouses/:id/impor-stok" element={<WarehouseSnapshotImportPage />} />
          <Route path="/master-data/pole-contracts/baru" element={<PoleContractCreatePage />} />
          <Route path="/master-data/pole-contracts/:id/ubah" element={<PoleContractEditPage />} />
          <Route path="*" element={ui} />
        </Routes>
        </NotificationProvider>
      </AccessContext.Provider>
    </MemoryRouter>,
  )
}

const khsRows = [
  { id: 'khs-1', code: 'TIANG-9M', current: { name: 'Tiang Beton 9m' } },
  { id: 'khs-2', code: 'TIANG-11M', current: { name: 'Tiang Beton 11m' } },
]

const krWithLines = {
  id: 'kr-1',
  kr_number: 'KR/2026/009',
  description: 'KR berbaris',
  status: 'ACTIVE',
  tm: { total: 10, allocated: 4, remaining: 6 },
  tr: { total: 20, allocated: 0, remaining: 20 },
  lines: [
    { khs_item_id: 'khs-1', khs_code: 'TIANG-9M', khs_name: 'Tiang Beton 9m', pole_type: 'TM', total: 10, allocated: 4, remaining: 6, in_erp_stock: true },
    { khs_item_id: 'khs-2', khs_code: 'TIANG-11M', khs_name: 'Tiang Beton 11m', pole_type: 'TR', total: 20, allocated: 0, remaining: 20, in_erp_stock: false },
  ],
}

describe('Kontrak Rinci berbaris', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    masterDataApi.khsList.mockResolvedValue({ data: khsRows })
    poleContractsApi.list.mockResolvedValue({ data: [krWithLines] })
  })

  async function fillLine(index, { materialId, type, qty }) {
    const box = screen.getAllByLabelText('Material tiang KHS')[index]
    await userEvent.click(box)
    const code = khsRows.find((r) => r.id === materialId).code
    const option = await waitFor(() => {
      const found = [...document.querySelectorAll('[role="listbox"] [role="option"]')].find((o) => o.textContent.includes(code))
      expect(found).toBeTruthy()
      return found
    })
    fireEvent.mouseDown(option)
    fireEvent.change(screen.getAllByLabelText('Tipe tiang')[index], { target: { value: type } })
    fireEvent.change(screen.getAllByLabelText('Jumlah tiang')[index], { target: { value: String(qty) } })
  }

  it('1. create mengirim lines tanpa qty_tm/qty_tr, total dari baris, 409 verbatim', async () => {
    renderWithContext(<PoleContractsPage />, { can: { 'poles.manage': true } })
    await userEvent.click(await screen.findByRole('button', { name: /Tambah Kontrak Rinci/i }))

    fireEvent.change(screen.getByPlaceholderText(/KR-2026-MJK-01/), { target: { value: 'KR-NEW' } })
    await userEvent.click(screen.getByRole('button', { name: /Tambah Baris/i }))
    await userEvent.click(screen.getByRole('button', { name: /Tambah Baris/i }))
    await fillLine(0, { materialId: 'khs-1', type: 'TM', qty: 7 })
    await fillLine(1, { materialId: 'khs-2', type: 'TR', qty: 3 })

    expect(screen.getByTestId('kr-total-tm')).toHaveTextContent('7')
    expect(screen.getByTestId('kr-total-tr')).toHaveTextContent('3')

    poleContractsApi.create.mockRejectedValueOnce(new Error('Material TIANG-9M ganda dalam satu Kontrak Rinci.'))
    await userEvent.click(screen.getByRole('button', { name: /Simpan Kontrak Rinci/i }))

    expect(await screen.findByText('Material TIANG-9M ganda dalam satu Kontrak Rinci.')).toBeInTheDocument()
    const body = poleContractsApi.create.mock.calls[0][0]
    expect(body.lines).toEqual([
      { khs_item_id: 'khs-1', pole_type: 'TM', quantity: 7 },
      { khs_item_id: 'khs-2', pole_type: 'TR', quantity: 3 },
    ])
    expect(body).not.toHaveProperty('qty_tm')
    expect(body).not.toHaveProperty('qty_tr')
  })

  it('2. sunting mengirim seluruh baris + alasan; ditolak tanpa alasan; 409 verbatim', async () => {
    renderWithContext(<PoleContractsPage />, { can: { 'poles.manage': true } })
    await userEvent.click(await screen.findByRole('button', { name: 'Ubah' }))

    const submit = await screen.findByRole('button', { name: /Simpan Perubahan/i })
    expect(submit).toBeDisabled()

    fireEvent.change(screen.getByPlaceholderText(/Contoh: Penyesuaian adendum/i), {
      target: { value: 'Adendum volume' },
    })
    expect(submit).not.toBeDisabled()

    poleContractsApi.update.mockRejectedValueOnce(
      new Error('Jumlah TIANG-9M tidak boleh di bawah yang sudah dialokasikan (4).'),
    )
    await userEvent.click(submit)

    expect(
      await screen.findByText('Jumlah TIANG-9M tidak boleh di bawah yang sudah dialokasikan (4).'),
    ).toBeInTheDocument()
    const [id, body] = poleContractsApi.update.mock.calls[0]
    expect(id).toBe('kr-1')
    expect(body.reason).toBe('Adendum volume')
    expect(body.lines).toEqual([
      { khs_item_id: 'khs-1', pole_type: 'TM', quantity: 10 },
      { khs_item_id: 'khs-2', pole_type: 'TR', quantity: 20 },
    ])
    expect(body).not.toHaveProperty('qty_tm')
  })

  it('3. detail menampilkan sisa per baris dan badge hanya bila in_erp_stock', async () => {
    poleContractsApi.get.mockResolvedValue({ data: { ...krWithLines, events: [] } })
    renderWithContext(<PoleContractsPage />, { can: { 'master_data.view': true } })
    await userEvent.click(await screen.findByRole('button', { name: /Detail/i }))

    expect(await screen.findByText('Baris Material Tiang')).toBeInTheDocument()
    expect(screen.getAllByText('Sudah masuk stok ERP')).toHaveLength(1)
    const row11 = screen.getByText('TIANG-11M').closest('tr')
    expect(row11).not.toHaveTextContent('Sudah masuk stok ERP')
    expect(row11).toHaveTextContent('20')
    const row9 = screen.getByText('TIANG-9M').closest('tr')
    expect(row9).toHaveTextContent('Sudah masuk stok ERP')
    expect(row9).toHaveTextContent('6')
  })
})

describe('Plotting tiang per material', () => {
  const mockApp = { id: 'app-001', application_number: 'APP-2026-001' }
  const krLegacy = {
    id: 'kr-old',
    kr_number: 'KR-OLD',
    status: 'ACTIVE',
    tm: { remaining: 5 },
    tr: { remaining: 5 },
    lines: [],
  }

  function setup(poles, contracts) {
    const alloc = { id: 'alloc-1', version: 1, status: 'DRAFT', materials: [], poles }
    allocationsApi.listForApplication.mockResolvedValue({ data: [alloc] })
    allocationsApi.get.mockResolvedValue({ data: alloc })
    warehousesApi.list.mockResolvedValue({ data: [{ id: 'wh-1', code: 'GD-01', name: 'Gudang Pusat' }] })
    poleContractsApi.list.mockResolvedValue({ data: contracts })
    renderWithContext(<ApplicationAllocationPanel application={mockApp} canManage canView />)
  }

  beforeEach(() => vi.clearAllMocks())

  it('4a. KR berbaris mewajibkan material tiang dan mengirim khs_item_id + warehouse_id', async () => {
    setup([{ pole_contract_id: 'kr-1', pole_type: 'TM', quantity: 2, khs_item_id: '' }], [krWithLines])

    const material = await screen.findByLabelText('Material tiang')
    await userEvent.click(screen.getByRole('button', { name: /Simpan Tiang/i }))
    expect(await screen.findByText(/Pilih material tiang untuk Kontrak Rinci KR\/2026\/009/)).toBeInTheDocument()
    expect(allocationsApi.putPoles).not.toHaveBeenCalled()

    fireEvent.change(material, { target: { value: 'khs-2' } })
    fireEvent.change(screen.getByLabelText('Keterangan gudang asal'), { target: { value: 'wh-1' } })
    allocationsApi.putPoles.mockResolvedValue({ data: {} })
    await userEvent.click(screen.getByRole('button', { name: /Simpan Tiang/i }))

    await waitFor(() => expect(allocationsApi.putPoles).toHaveBeenCalled())
    expect(allocationsApi.putPoles.mock.calls[0][1].poles).toEqual([
      { pole_contract_id: 'kr-1', pole_type: 'TR', quantity: 2, khs_item_id: 'khs-2', warehouse_id: 'wh-1' },
    ])
  })

  it('4b. KR tanpa baris tidak mewajibkan material tiang', async () => {
    setup([{ pole_contract_id: 'kr-old', pole_type: 'TM', quantity: 1 }], [krLegacy])

    await screen.findByRole('button', { name: /Simpan Tiang/i })
    allocationsApi.putPoles.mockResolvedValue({ data: {} })
    await userEvent.click(screen.getByRole('button', { name: /Simpan Tiang/i }))

    await waitFor(() => expect(allocationsApi.putPoles).toHaveBeenCalled())
    expect(allocationsApi.putPoles.mock.calls[0][1].poles).toEqual([
      { pole_contract_id: 'kr-old', pole_type: 'TM', quantity: 1 },
    ])
  })
})

describe('Posisi stok: Pasokan KR', () => {
  it('5. menampilkan kr_supply dan available_with_kr tanpa mengubah available', async () => {
    adminApi.units.mockResolvedValue({ data: [] })
    warehousesApi.list.mockResolvedValue({ data: [{ id: 'wh-1', code: 'GD-UP3', name: 'Gudang Induk', is_active: true }] })
    warehousesApi.position.mockResolvedValue({
      data: [
        {
          khs_code: 'TIANG-9M',
          on_hand: 0,
          reserved: 0,
          incoming: 0,
          safety: 0,
          allocated_after: 0,
          available: 111,
          kr_supply: 222,
          available_with_kr: 333,
        },
      ],
    })
    renderWithContext(<WarehousesPage />, { can: { 'master_data.view': true } })

    await userEvent.click(await screen.findByRole('button', { name: /Posisi Stok Terkonsolidasi/i }))
    const calc = await screen.findByRole('button', { name: /Hitung Posisi/i })
    await userEvent.click(calc)

    expect(await screen.findByText('TIANG-9M')).toBeInTheDocument()
    expect(screen.getByText('Pasokan KR')).toBeInTheDocument()
    expect(screen.getByText('Tersedia + KR')).toBeInTheDocument()
    const row = screen.getByText('TIANG-9M').closest('tr')
    expect(row).toHaveTextContent('111')
    expect(row).toHaveTextContent('222')
    expect(row).toHaveTextContent('333')
  })

  it('material tiang dipilih lewat kotak pencarian: saran tiang beton saat kosong, mengetik mencari ke server, Enter memilih', async () => {
    renderWithContext(<PoleContractsPage />, { can: { 'poles.manage': true } })
    await userEvent.click(await screen.findByRole('button', { name: /Tambah Kontrak Rinci/i }))
    await userEvent.click(screen.getByRole('button', { name: /Tambah Baris/i }))
    const box = screen.getByRole('combobox', { name: 'Material tiang KHS' })
    await userEvent.click(box)
    await waitFor(() => expect(masterDataApi.khsList).toHaveBeenCalledWith(expect.objectContaining({ search: 'tiang beton' })))
    expect(await screen.findByText(/Saran: tiang beton/)).toBeInTheDocument()
    await userEvent.type(box, '11m')
    await waitFor(() => expect(masterDataApi.khsList).toHaveBeenCalledWith(expect.objectContaining({ search: '11m' })))
    await waitFor(() => expect(screen.getAllByRole('option').length).toBeGreaterThan(0))
    await userEvent.keyboard('{Enter}')
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument())
    expect(screen.getByRole('combobox', { name: 'Material tiang KHS' }).value).toMatch(/—/)
  })

  it('galat saat memuat material ditampilkan di daftar, bukan "tidak ada material yang cocok"', async () => {
    masterDataApi.khsList.mockRejectedValue(new Error('Too Many Attempts.'))
    renderWithContext(<PoleContractsPage />, { can: { 'poles.manage': true } })
    await userEvent.click(await screen.findByRole('button', { name: /Tambah Kontrak Rinci/i }))
    await userEvent.click(screen.getByRole('button', { name: /Tambah Baris/i }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Material tiang KHS' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Too Many Attempts.')
    expect(screen.queryByText(/Tidak ada material yang cocok/)).not.toBeInTheDocument()
  })
})
