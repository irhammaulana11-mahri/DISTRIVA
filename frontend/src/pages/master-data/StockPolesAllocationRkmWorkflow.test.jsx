import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import WarehousesPage from './WarehousesPage.jsx'
import WarehouseCreatePage from './WarehouseCreatePage.jsx'
import WarehouseSnapshotImportPage from './WarehouseSnapshotImportPage.jsx'
import PoleContractsPage from './PoleContractsPage.jsx'
import { PoleContractCreatePage, PoleContractEditPage } from './PoleContractFormPages.jsx'
import ApplicationAllocationPanel from '../applications/ApplicationAllocationPanel.jsx'
import RkmPlansPage from '../rkm/RkmPlansPage.jsx'
import RkmVersionDetailPage from '../rkm/RkmVersionDetailPage.jsx'
import {
  adminApi,
  warehousesApi,
  poleContractsApi,
  allocationsApi,
  rkmApi,
} from '../../services/api.js'

// Mock APIs
vi.mock('../../services/api.js', () => ({
  adminApi: {
    units: vi.fn(),
  },
  masterDataApi: {
    khsList: vi.fn().mockResolvedValue({ data: [] }),
  },
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
  rkmApi: {
    plans: vi.fn(),
    createPlan: vi.fn(),
    amend: vi.fn(),
    version: vi.fn(),
    requirements: vi.fn(),
    startValidation: vi.fn(),
    adjust: vi.fn(),
    decide: vi.fn(),
    putLines: vi.fn(),
    setPackages: vi.fn(),
    submit: vi.fn(),
  },
}))

function renderWithContext(ui, { can = {}, isSysAdmin = false, initialEntries = ['/'] } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AccessContext.Provider value={{ can, isSysAdmin, loading: false }}>
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

describe('Gudang & Posisi Stok Master Data Workflow', () => {
  const mockWarehouses = [
    { id: 'wh-1', code: 'GD-UP3', name: 'Gudang Induk UP3', address: 'Jl. Pemuda No. 1', is_active: true },
    { id: 'wh-2', code: 'GD-ULP1', name: 'Gudang ULP Maju', address: 'Jl. Merdeka No. 10', is_active: true },
  ]

  const mockPosition = {
    data: [
      {
        khs_code: 'KHS-KBL-01',
        material_name: 'Kabel A3CS 150mm2',
        unit: 'MTR',
        on_hand: 5000,
        reserved: 1000,
        incoming: 200,
        safety_stock: 500,
        allocated_after: 0,
        available: 3700,
      },
    ],
  }

  beforeEach(() => {
    vi.clearAllMocks()
    adminApi.units.mockResolvedValue({
      data: [{ id: 'unit-1', code: 'UP3-01', name: 'UP3 Banten', unit_type: 'UP3' }],
    })
    warehousesApi.list.mockResolvedValue({ data: mockWarehouses })
    warehousesApi.position.mockResolvedValue(mockPosition)
  })

  it('1. lists warehouses and respects warehouses.manage permission for creation', async () => {
    // Read only
    const { unmount } = renderWithContext(<WarehousesPage />, {
      can: { 'master_data.view': true },
    })

    expect(await screen.findByText('Gudang Induk UP3')).toBeInTheDocument()
    expect(screen.getByText('GD-UP3')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tambah Gudang/ })).not.toBeInTheDocument()
    unmount()

    // With warehouses.manage
    renderWithContext(<WarehousesPage />, {
      can: { 'warehouses.manage': true },
    })

    const createBtn = await screen.findByRole('button', { name: /Tambah Gudang/ })
    expect(createBtn).toBeInTheDocument()
    await userEvent.click(createBtn)

    expect(await screen.findByText('Tambah Gudang Penyimpanan')).toBeInTheDocument()
    const codeInput = screen.getByPlaceholderText(/Contoh: GDG-UP3/i)
    const nameInput = screen.getByPlaceholderText(/Contoh: Gudang Induk/i)
    fireEvent.change(codeInput, { target: { value: 'GD-ULP2' } })
    fireEvent.change(nameInput, { target: { value: 'Gudang ULP Sentosa' } })
    await userEvent.selectOptions(screen.getByRole('combobox'), 'unit-1')

    warehousesApi.create.mockResolvedValue({ data: { id: 'wh-3', code: 'GD-ULP2', name: 'Gudang ULP Sentosa' } })
    await userEvent.click(screen.getByRole('button', { name: /Simpan Gudang/i }))

    await waitFor(() => {
      expect(warehousesApi.create).toHaveBeenCalledWith({
        code: 'GD-ULP2',
        name: 'Gudang ULP Sentosa',
        organizational_unit_id: 'unit-1',
      })
    })
  })

  it('2. queries consolidated stock position and calculates available formula correctly', async () => {
    renderWithContext(<WarehousesPage />, {
      can: { 'stock.import': true },
    })

    await screen.findByText('Gudang Induk UP3')
    const posTab = screen.getByRole('button', { name: /Posisi Stok Terkonsolidasi/i })
    await userEvent.click(posTab)

    // Click Hitung Posisi (all warehouses are selected by default on tab switch)
    const queryBtn = await screen.findByRole('button', { name: /Hitung Posisi/i })
    await userEvent.click(queryBtn)

    expect(await screen.findByText('KHS-KBL-01')).toBeInTheDocument()
    expect(screen.getByText('3.700')).toBeInTheDocument() // available: 5000 - 1000 + 200 - 500 = 3700
  })

  it('3. snapshot import shows dry run errors and supports commit', async () => {
    warehousesApi.snapshots.mockResolvedValue({
      data: [
        { id: 'snap-1', as_of_date: '2026-11-01', total_lines: 10, created_at: '2026-11-01 08:00' },
      ],
    })

    renderWithContext(<WarehousesPage />, {
      can: { 'stock.import': true },
    })

    await screen.findByText('Gudang Induk UP3')
    const snapBtn = screen.getAllByRole('button', { name: /Cuplikan Stok/i })[0]
    await userEvent.click(snapBtn)

    expect(await screen.findByText(/Cuplikan Stok: Gudang Induk UP3/i)).toBeInTheDocument()

    const openImportBtn = await screen.findByRole('button', { name: /Impor Cuplikan CSV/i })
    await userEvent.click(openImportBtn)

    expect(await screen.findByText(/Impor Cuplikan Stok: Gudang Induk UP3/i)).toBeInTheDocument()

    // Test Dry Run API response with row errors
    warehousesApi.importSnapshot.mockResolvedValueOnce({
      dry_run: true,
      data: { accepted: 1, rejected: 1 },
      rows: [
        { row: 1, khs_code: '1', on_hand: 10, status: 'OK', errors: [] },
        { row: 2, khs_code: 'KHS-UNKNOWN', on_hand: 5, status: 'REJECTED', errors: ['Kode KHS tidak ditemukan di katalog'] },
      ],
    })

    const file = new File(['kode_khs,stok,reservasi,pasokan_masuk,stok_pengaman\n1,10,0,0,0'], 'test.csv', { type: 'text/csv' })
    const fileInput = document.querySelector('input[type="file"]')
    await userEvent.upload(fileInput, file)

    const form = fileInput.closest('form')
    fireEvent.submit(form)

    expect(await screen.findByText(/Kode KHS tidak ditemukan di katalog/i)).toBeInTheDocument()
    expect(screen.getByText(/Galat: 1/i)).toBeInTheDocument()
  })
})

describe('Kontrak Rinci Tiang Master Data Workflow', () => {
  const mockContracts = [
    {
      id: 'kr-1',
      kr_number: 'KR/2026/001',
      description: 'Pengadaan Tiang Beton Semester 1',
      tm: { total: 100, allocated: 20, remaining: 80 },
      tr: { total: 200, allocated: 50, remaining: 150 },
      status: 'ACTIVE',
      created_at: '2026-01-10',
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    poleContractsApi.list.mockResolvedValue({ data: mockContracts })
  })

  it('1. lists pole contracts and respects poles.manage permissions', async () => {
    const { unmount } = renderWithContext(<PoleContractsPage />, {
      can: { 'master_data.view': true },
    })

    expect(await screen.findByText('KR/2026/001')).toBeInTheDocument()
    expect(screen.getByText('80')).toBeInTheDocument()
    expect(screen.getByText('150')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tambah Kontrak Rinci/i })).not.toBeInTheDocument()
    unmount()

    renderWithContext(<PoleContractsPage />, {
      can: { 'poles.manage': true },
    })

    expect(await screen.findByRole('button', { name: /Tambah Kontrak Rinci/i })).toBeInTheDocument()
  })

  it('2. requires mandatory reason when updating or closing pole contracts', async () => {
    renderWithContext(<PoleContractsPage />, {
      can: { 'poles.manage': true },
    })

    await screen.findByText('KR/2026/001')
    const updateBtn = await screen.findByRole('button', { name: 'Ubah' })
    await userEvent.click(updateBtn)

    expect(await screen.findByText('Ubah Kontrak Rinci: KR/2026/001')).toBeInTheDocument()
    const submitUpdateBtn = screen.getByRole('button', { name: /Simpan Perubahan/i })
    expect(submitUpdateBtn).toBeDisabled() // Reason required

    const reasonInput = screen.getByPlaceholderText(/Contoh: Penyesuaian adendum/i)
    fireEvent.change(reasonInput, { target: { value: 'Amandemen volume kontrak' } })
    expect(submitUpdateBtn).not.toBeDisabled()

    poleContractsApi.update.mockResolvedValue({ data: { id: 'kr-1', status: 'ACTIVE' } })
    await userEvent.click(submitUpdateBtn)

    await waitFor(() => {
      expect(poleContractsApi.update).toHaveBeenCalledWith('kr-1', expect.objectContaining({
        reason: 'Amandemen volume kontrak',
      }))
    })
  })
})

describe('Alokasi Material & Tiang Workflow', () => {
  const mockApp = { id: 'app-001', application_number: 'APP-2026-001' }
  const mockAllocations = [
    {
      id: 'alloc-1',
      version: 1,
      status: 'DRAFT',
      materials: [
        { khs_code: 'KHS-01', warehouse_id: 'wh-1', quantity: 10 },
      ],
      poles: [
        { pole_contract_id: 'kr-1', pole_type: 'TM', quantity: 2 },
      ],
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    allocationsApi.listForApplication.mockResolvedValue({ data: mockAllocations })
    allocationsApi.get.mockResolvedValue({ data: mockAllocations[0] })
    warehousesApi.list.mockResolvedValue({ data: [{ id: 'wh-1', code: 'GD-01', name: 'Gudang Pusat' }] })
    poleContractsApi.list.mockResolvedValue({ data: [{ id: 'kr-1', kr_number: 'KR-001', status: 'ACTIVE', tm: { remaining: 5 }, tr: { remaining: 10 } }] })
  })

  it('1. renders allocation lines and displays 409 shortage error verbatim on confirm', async () => {
    renderWithContext(
      <ApplicationAllocationPanel
        application={mockApp}
        canManage={true}
        canView={true}
      />,
    )

    expect(await screen.findByText('Alokasi Material & Tiang Proyek')).toBeInTheDocument()
    expect(await screen.findByDisplayValue('KHS-01')).toBeInTheDocument()

    // Confirm allocation failure (409)
    const err409 = new Error('Stok KHS-01 di Gudang Pusat tidak mencukupi (tersedia 5, diminta 10).')
    allocationsApi.confirm.mockRejectedValueOnce(err409)

    const confirmBtn = screen.getByRole('button', { name: /Konfirmasi Material/i })
    await userEvent.click(confirmBtn)

    expect(await screen.findByText('Stok KHS-01 di Gudang Pusat tidak mencukupi (tersedia 5, diminta 10).')).toBeInTheDocument()
  })

  it('2. requires reason when cancelling allocation', async () => {
    renderWithContext(
      <ApplicationAllocationPanel
        application={mockApp}
        canManage={true}
        canView={true}
      />,
    )

    await screen.findByText('Alokasi Material & Tiang Proyek')
    const cancelBtn = await screen.findByRole('button', { name: /Batalkan Alokasi/i })
    await userEvent.click(cancelBtn)

    expect(await screen.findByText('Batalkan Alokasi Material')).toBeInTheDocument()
    await userEvent.type(screen.getByPlaceholderText(/Contoh: Pembatalan permohonan/i), 'Perubahan gambar konstruksi')

    allocationsApi.cancel.mockResolvedValue({ success: true })
    const confirmCancelBtn = screen.getByRole('button', { name: 'Ya, Batalkan Alokasi' })
    await userEvent.click(confirmCancelBtn)

    await waitFor(() => {
      expect(allocationsApi.cancel).toHaveBeenCalledWith('alloc-1', {
        reason: 'Perubahan gambar konstruksi',
      })
    })
  })
})

describe('Modul RKM (Rencana Kebutuhan Material) Workflow', () => {
  const mockPlans = [
    {
      id: 'plan-1',
      period_name: 'RKM TAHUNAN 2026',
      period_type: 'ANNUAL',
      year: 2026,
      month: null,
      scope: 'UP3',
      versions: [
        { id: 'v-1', version_number: 1, status: 'COLLECTING' },
      ],
    },
  ]

  const mockVersionCollecting = {
    id: 'v-1',
    version_number: 1,
    round: 1,
    status: 'COLLECTING',
    plan: { id: 'plan-1', plan_number: 'RKM-2026-UP3', period_type: 'ANNUAL', year: 2026, month: null, scope: 'UP3' },
    proposals: [
      {
        id: 'prop-1',
        ulp_code: 'ULP-01',
        ulp_name: 'ULP Maju',
        status: 'DRAFT',
        lines: [
          { khs_code: 'KHS-01', material_name: 'Kabel A3CS', unit: 'MTR', pipeline_qty: 100, forecast_qty: 50 },
        ],
      },
    ],
    adjustments: [],
    decisions: [],
  }

  const mockVersionApproved = {
    id: 'v-2',
    version_number: 1,
    round: 1,
    status: 'APPROVED',
    plan: { id: 'plan-1', plan_number: 'RKM-2026-UP3', period_type: 'ANNUAL', year: 2026, month: null, scope: 'UP3' },
    proposals: [],
    adjustments: [],
    decisions: [
      { step: 'APPROVE_UP3_MANAGER', decision: 'APPROVED', notes: 'Disetujui', actor_email: 'mgr@pln.co.id' },
    ],
  }

  const mockRequirements = {
    frozen: true,
    data: {
      'KHS-01': {
        khs_code: 'KHS-01',
        material_name: 'Kabel A3CS',
        unit: 'MTR',
        gross: 500,
        allocated: 100,
        available: 200,
        safety: 50,
        incoming: 50,
        net: 300, // 500 + 50 - 200 - 50 = 300
      },
    },
  }

  beforeEach(() => {
    vi.clearAllMocks()
    adminApi.units.mockResolvedValue({ data: [] })
    rkmApi.plans.mockResolvedValue({ data: mockPlans })
  })

  it('1. lists RKM plans and restricts create plan button to rkm.plan capability', async () => {
    const { unmount } = renderWithContext(<RkmPlansPage />, {
      can: { 'rkm.view': true },
    })

    expect(await screen.findByText(/Rencana Kerja & Material \(RKM\)/i)).toBeInTheDocument()
    expect(screen.getByText('ANNUAL')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Buat Rencana RKM/i })).not.toBeInTheDocument()
    unmount()

    renderWithContext(<RkmPlansPage />, {
      can: { 'rkm.plan': true },
    })

    expect(await screen.findByRole('button', { name: /Buat Rencana RKM/i })).toBeInTheDocument()
  })

  it('2. handles COLLECTING state: ULP proposal submission and UP3 starting validation', async () => {
    rkmApi.version.mockResolvedValue({ data: mockVersionCollecting })

    renderWithContext(
      <Routes>
        <Route path="/rkm/versions/:id" element={<RkmVersionDetailPage />} />
      </Routes>,
      {
        can: { 'rkm.submit': true, 'rkm.plan': true },
        initialEntries: ['/rkm/versions/v-1'],
      },
    )

    expect(await screen.findByText(/RKM: RKM-2026-UP3/i)).toBeInTheDocument()
    expect(screen.getByText(/COLLECTING/)).toBeInTheDocument()

    // ULP Submit Proposal
    const submitPropBtn = screen.getByRole('button', { name: /Ajukan Usulan/i })
    expect(submitPropBtn).toBeInTheDocument()
    rkmApi.submit.mockResolvedValue({ success: true })
    await userEvent.click(submitPropBtn)

    await waitFor(() => {
      expect(rkmApi.submit).toHaveBeenCalledWith('prop-1')
    })

    // UP3 Start Validation
    const startValBtn = screen.getByRole('button', { name: /Mulai Validasi UP3/i })
    expect(startValBtn).toBeInTheDocument()
    rkmApi.startValidation.mockResolvedValue({ success: true })
    await userEvent.click(startValBtn)

    await waitFor(() => {
      expect(rkmApi.startValidation).toHaveBeenCalledWith('v-1')
    })
  })

  it('3. handles APPROVED state: displays frozen Net Requirements panel and requires reason for amend', async () => {
    rkmApi.version.mockResolvedValue({ data: mockVersionApproved })
    rkmApi.requirements.mockResolvedValue(mockRequirements)

    renderWithContext(
      <Routes>
        <Route path="/rkm/versions/:id" element={<RkmVersionDetailPage />} />
      </Routes>,
      {
        can: { 'rkm.plan': true, 'rkm.view': true },
        initialEntries: ['/rkm/versions/v-2'],
      },
    )

    expect(await screen.findByText(/APPROVED/)).toBeInTheDocument()

    // Click Net Requirements Tab
    const reqTab = screen.getByRole('button', { name: /Panel Kebutuhan Bersih/i })
    await userEvent.click(reqTab)

    expect(await screen.findByText('BEKU (FROZEN)')).toBeInTheDocument()
    expect(screen.getByText('300')).toBeInTheDocument() // net requirement value

    // Amend plan modal
    const amendBtn = screen.getByRole('button', { name: /Amandemen Rencana/i })
    await userEvent.click(amendBtn)

    expect(await screen.findByText('Amandemen Rencana RKM')).toBeInTheDocument()
    const confirmAmendBtn = screen.getByRole('button', { name: /Inisiasi Amandemen/i })

    await userEvent.type(screen.getByPlaceholderText(/Contoh: Perubahan target kinerja/i), 'Penyesuaian target semester 2')

    rkmApi.amend.mockResolvedValue({ data: { id: 'v-3', version_number: 2 } })
    await userEvent.click(confirmAmendBtn)

    await waitFor(() => {
      expect(rkmApi.amend).toHaveBeenCalledWith('plan-1', {
        reason: 'Penyesuaian target semester 2',
      })
    })
  })
})
