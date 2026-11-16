import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AccessContext, AccessProvider } from '../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../features/notifications/NotificationContext.jsx'
import App from '../App.jsx'
import ApplicationsPage from './applications/ApplicationsPage.jsx'
import ApplicationAllocationPanel from './applications/ApplicationAllocationPanel.jsx'
import ApplicationKkfPanel from './applications/ApplicationKkfPanel.jsx'
import HomePage from './HomePage.jsx'
import { MODULE_DOMAINS } from '../features/modules/moduleRegistry.js'
import {
  adminApi,
  masterDataApi,
  applicationApi,
  surveyApi,
  drawingApi,
  mtoApi,
  backupApi,
  planningApi,
  allocationsApi,
  workOrdersApi,
  bastpApi,
  proposalsApi,
  authApi,
  mfaApi,
} from '../services/api.js'

vi.mock('../services/api.js', () => ({
  adminApi: {
    access: vi.fn(),
    users: vi.fn(),
    roles: vi.fn(),
    units: vi.fn(),
  },
  masterDataApi: {
    access: vi.fn(),
  },
  applicationApi: {
    access: vi.fn(),
    units: vi.fn().mockResolvedValue({ scope: 'GLOBAL', up3_units: [], ulp_units: [] }),
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    submit: vi.fn(),
    cancel: vi.fn(),
    addReference: vi.fn(),
  },
  surveyApi: {
    access: vi.fn(),
    listForApplication: vi.fn(),
    surveyors: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
  },
  drawingApi: {
    access: vi.fn(),
    forApplication: vi.fn(),
    authors: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
  },
  mtoApi: {
    access: vi.fn(),
    forVersion: vi.fn(),
  },
  backupApi: {
    access: vi.fn(),
  },
  planningApi: {
    access: vi.fn(),
  },
  allocationsApi: {
    materialSuggestions: vi.fn(),
    listForApplication: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    putMaterials: vi.fn(),
    putPoles: vi.fn(),
    confirm: vi.fn(),
    cancel: vi.fn(),
  },
  workOrdersApi: {
    list: vi.fn(),
    listForApplication: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    setVendor: vi.fn(),
    submit: vi.fn(),
    decide: vi.fn(),
    submitProgress: vi.fn(),
    decideProgress: vi.fn(),
    cancel: vi.fn(),
    amend: vi.fn(),
  },
  bastpApi: {
    listForWorkOrder: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
  },
  proposalsApi: {
    selectable: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
  },
  warehousesApi: {
    list: vi.fn().mockResolvedValue({ data: [{ id: 'wh-1', code: 'GD-01', name: 'Gudang Utama' }] }),
  },
  poleContractsApi: {
    list: vi.fn().mockResolvedValue({ data: [{ id: 'kr-1', kr_number: 'KR-2026-001', tm: { remaining: 10 }, tr: { remaining: 20 } }] }),
  },
  kkfRunsApi: {
    listForApplication: vi.fn(),
  },
  authApi: {
    login: vi.fn(),
    logout: vi.fn(),
    me: vi.fn(),
  },
  mfaApi: {
    status: vi.fn(),
  },
  notificationsApi: {
    list: vi.fn().mockResolvedValue({ data: [], meta: { unread_count: 0 } }),
    markRead: vi.fn().mockResolvedValue({ data: { read: true } }),
    markAllRead: vi.fn().mockResolvedValue({ data: { marked: 0 } }),
  },
}))

vi.mock('../features/auth/AuthContext.jsx', () => ({
  useAuth: () => ({
    status: 'authenticated',
    user: { id: 'user-1', name: 'Petugas Teknik', email: 'teknik@distriva.id' },
    mustChangePassword: false,
    mfaState: { required: false },
  }),
}))

describe('Frontend Audit Fixes (docs/77 A-H)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminApi.access.mockResolvedValue({ can: { 'admin.view': true } })
    masterDataApi.access.mockResolvedValue({ can: {} })
    applicationApi.access.mockResolvedValue({ can: { 'applications.view': true }, create_units: [] })
    surveyApi.access.mockResolvedValue({ can: { 'surveys.view': true } })
    drawingApi.access.mockResolvedValue({ can: { 'drawings.view': true } })
    mtoApi.access.mockResolvedValue({ can: {} })
    backupApi.access.mockResolvedValue({ can: {} })
    planningApi.access.mockResolvedValue({
      can: {
        'rab.view': true,
        'kkf.view': true,
        'allocations.manage': true,
        'allocations.poles': true,
        'wo.view': true,
        'vendor.portal': false,
      },
    })
    proposalsApi.list.mockResolvedValue({ data: [] })
  })

  it('A. AccessContext memanggil planningApi.access() dan menggabungkan kunci ke can', async () => {
    function TestConsumer() {
      const { can, loading } = React.useContext(AccessContext)
      if (loading) return <div>Memuat...</div>
      return (
        <div>
          <span>rab: {can['rab.view'] ? 'ada' : 'tidak'}</span>
          <span>alloc: {can['allocations.manage'] ? 'ada' : 'tidak'}</span>
        </div>
      )
    }
    const React = await import('react')

    render(
      <AccessProvider>
        <TestConsumer />
      </AccessProvider>
    )

    await waitFor(() => {
      expect(planningApi.access).toHaveBeenCalled()
      expect(screen.getByText('rab: ada')).toBeInTheDocument()
      expect(screen.getByText('alloc: ada')).toBeInTheDocument()
    })
  })

  it('B. Panel alokasi model baru: putMaterials & confirm materials terpisah dari tiang', async () => {
    const mockApp = { id: 'app-uuid-1', application_number: 'PBPD-001' }
    allocationsApi.listForApplication.mockResolvedValue({
      data: [{ id: 'alloc-1', version_number: 1, status: 'DRAFT' }],
    })
    allocationsApi.get.mockResolvedValue({
      data: {
        id: 'alloc-1',
        version_number: 1,
        status: 'DRAFT',
        materials_confirmed_at: null,
        poles_confirmed_at: null,
        materials: [{ khs_code: '1', warehouse_id: 'wh-1', warehouse_code: 'GD-01', quantity: 10 }],
        poles: [{ pole_contract_id: 'kr-1', kr_number: 'KR-2026-001', pole_type: 'TM', quantity: 5 }],
      },
    })
    allocationsApi.putMaterials.mockResolvedValue({ message: 'Baris material alokasi disimpan.' })
    allocationsApi.confirm.mockResolvedValue({ message: 'Bagian material dikonfirmasi.' })

    render(
      <MemoryRouter>
        <NotificationProvider>
          <ApplicationAllocationPanel
            application={mockApp}
            canManageMaterials={true}
            canManagePoles={false}
            canView={true}
          />
        </NotificationProvider>
      </MemoryRouter>
    )

    expect(await screen.findByText('1. Alokasi Material KHS & Gudang Sumber')).toBeInTheDocument()
    const saveMatBtn = await screen.findByRole('button', { name: /Simpan Material/i })
    fireEvent.click(saveMatBtn)

    await waitFor(() => {
      expect(allocationsApi.putMaterials).toHaveBeenCalledWith('alloc-1', expect.objectContaining({
        materials: [{ khs_code: '1', warehouse_id: 'wh-1', quantity: 10 }],
      }))
    })

    const confMatBtn = screen.getByRole('button', { name: /Konfirmasi Material/i })
    fireEvent.click(confMatBtn)

    await waitFor(() => {
      expect(allocationsApi.confirm).toHaveBeenCalledWith('alloc-1', 'materials')
    })
  })

  const suggestionData = {
    warehouses: [],
    rows: [
      { khs_code: 'V900', khs_name: 'Kabel tanah dari vendor', unit_text: 'm', need: 7, allocated: 0, remaining: 7, supplier: 'VENDOR', source_choice: false, candidates: [], suggestion: null },
      { khs_code: 'A100', supplier: 'PLN', khs_name: 'Kabel NFA2X 4x16', unit_text: 'm', need: 20, allocated: 0, remaining: 20, source_choice: false,
        candidates: [
          { warehouse_id: 'wh-ulp', warehouse_code: 'GD-ULP', warehouse_name: 'Gd Ry ULP', level: 'ULP', available: 50 },
          { warehouse_id: 'wh-up3', warehouse_code: 'GD-UP3', warehouse_name: 'PLN Area', level: 'UP3', available: 5 },
        ],
        suggestion: { warehouse_id: 'wh-ulp', level: 'ULP', quantity: 20, covered: true } },
      { khs_code: 'A200', khs_name: 'KWh meter 1 fasa', unit_text: 'bh', need: 2, allocated: 0, remaining: 2, source_choice: true,
        candidates: [
          { warehouse_id: 'wh-ulp', warehouse_code: 'GD-ULP', warehouse_name: 'Gd Ry ULP', level: 'ULP', available: 0 },
          { warehouse_id: 'wh-up3', warehouse_code: 'GD-UP3', warehouse_name: 'PLN Area', level: 'UP3', available: 10 },
        ],
        suggestion: { warehouse_id: 'wh-up3', level: 'UP3', quantity: 2, covered: true } },
      { khs_code: 'A300', khs_name: 'Isolator', unit_text: 'bh', need: 9, allocated: 0, remaining: 9, source_choice: false,
        candidates: [
          { warehouse_id: 'wh-ulp', warehouse_code: 'GD-ULP', warehouse_name: 'Gd Ry ULP', level: 'ULP', available: 3 },
          { warehouse_id: 'wh-up3', warehouse_code: 'GD-UP3', warehouse_name: 'PLN Area', level: 'UP3', available: 4 },
        ],
        suggestion: { warehouse_id: 'wh-ulp', level: 'ULP', quantity: 0, covered: false } },
    ],
  }

  function mountPanel(props = {}) {
    allocationsApi.listForApplication.mockResolvedValue({ data: [{ id: 'alloc-1', version_number: 1, status: 'DRAFT' }] })
    allocationsApi.get.mockResolvedValue({ data: { id: 'alloc-1', version_number: 1, status: 'DRAFT', materials_confirmed_at: null, poles_confirmed_at: null, materials: [], poles: [] } })
    allocationsApi.materialSuggestions.mockResolvedValue({ data: suggestionData })
    return render(
      <MemoryRouter>
        <NotificationProvider>
          <ApplicationAllocationPanel application={{ id: 'app-1' }} canView {...props} />
        </NotificationProvider>
      </MemoryRouter>
    )
  }

  it('G. alokasi yang sudah CONFIRMED tidak dibatalkan untuk material susulan: tombol Tambah Alokasi membuka alokasi tambahan', async () => {
    allocationsApi.listForApplication.mockResolvedValue({ data: [{ id: 'alloc-1', version_number: 1, status: 'CONFIRMED', is_addition: false }] })
    allocationsApi.get.mockResolvedValue({ data: { id: 'alloc-1', version_number: 1, status: 'CONFIRMED', materials_confirmed_at: '2026-11-12', poles_confirmed_at: '2026-11-12', materials: [], poles: [] } })
    allocationsApi.create.mockResolvedValue({ data: { id: 'alloc-2' } })
    render(
      <MemoryRouter>
        <NotificationProvider>
          <ApplicationAllocationPanel application={{ id: 'app-1' }} canView canManageMaterials />
        </NotificationProvider>
      </MemoryRouter>
    )
    fireEvent.click(await screen.findByRole('button', { name: /Tambah Alokasi/i }))
    await waitFor(() => expect(allocationsApi.create).toHaveBeenCalledWith('app-1', expect.objectContaining({ notes: expect.stringMatching(/Alokasi tambahan/i) })))
  })

  it('I. alokasi tiang melebihi sisa KR menjadi utang kerja: konfirmasi baru aktif setelah disetujui dan mengirim acceptDebt', async () => {
    allocationsApi.listForApplication.mockResolvedValue({ data: [{ id: 'alloc-1', version_number: 1, status: 'DRAFT', is_addition: false }] })
    allocationsApi.get.mockResolvedValue({ data: { id: 'alloc-1', version_number: 1, status: 'DRAFT', materials_confirmed_at: null, poles_confirmed_at: null, materials: [], poles: [{ pole_contract_id: 'kr-1', kr_number: 'KR-1', pole_type: 'TM', quantity: 3 }],
      pole_debts: [{ kr_number: 'KR-1', pole_type: 'TM', quantity: 3, remaining: 2, over: 1 }] } })
    allocationsApi.confirm.mockResolvedValue({ message: 'ok' })
    render(
      <MemoryRouter>
        <NotificationProvider>
          <ApplicationAllocationPanel application={{ id: 'app-1' }} canView canManagePoles />
        </NotificationProvider>
      </MemoryRouter>
    )
    expect(await screen.findByText(/Utang kerja: alokasi melebihi sisa Kontrak Rinci/i)).toBeInTheDocument()
    expect(screen.getByText(/kelebihan 1 batang/)).toBeInTheDocument()
    const confirm = screen.getByRole('button', { name: /Konfirmasi Tiang/i })
    expect(confirm).toBeDisabled()
    fireEvent.click(screen.getByRole('checkbox', { name: /Setujui kelebihan sebagai utang kerja/i }))
    expect(confirm).not.toBeDisabled()
    fireEvent.click(confirm)
    await waitFor(() => expect(allocationsApi.confirm).toHaveBeenCalledWith('alloc-1', 'poles', { acceptDebt: true }))
  })

  it('H. selama masih ada draf alokasi (dasar atau tambahan) tidak ada tombol buka alokasi baru', async () => {
    allocationsApi.listForApplication.mockResolvedValue({ data: [
      { id: 'alloc-2', version_number: 2, status: 'DRAFT', is_addition: true },
      { id: 'alloc-1', version_number: 1, status: 'CONFIRMED', is_addition: false },
    ] })
    allocationsApi.get.mockResolvedValue({ data: { id: 'alloc-2', version_number: 2, status: 'DRAFT', is_addition: true, materials_confirmed_at: null, poles_confirmed_at: null, materials: [], poles: [] } })
    render(
      <MemoryRouter>
        <NotificationProvider>
          <ApplicationAllocationPanel application={{ id: 'app-1' }} canView canManageMaterials />
        </NotificationProvider>
      </MemoryRouter>
    )
    expect(await screen.findByText(/Alokasi Tambahan #2/)).toBeInTheDocument()
    expect(screen.getByText(/Tambahan v2/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tambah Alokasi|Buat Alokasi/i })).not.toBeInTheDocument()
  })

  it('E. Tambah Material langsung mengisi semua kebutuhan MTO: penuh bila stok cukup, 0 bila kurang, dan SR APP bisa pilih UP3/ULP', async () => {
    mountPanel({ canManageMaterials: true })
    fireEvent.click(await screen.findByRole('button', { name: /Tambah Material/i }))

    // A100: stok ULP 50 >= 20 -> penuh di ULP; A200: stok ULP 0, UP3 10 -> penuh di UP3; A300: stok tak ada yang cukup -> 0
    await waitFor(() => expect(screen.getByDisplayValue('20')).toBeInTheDocument())
    expect(screen.getByDisplayValue('2')).toBeInTheDocument()
    expect(screen.getByDisplayValue('0')).toBeInTheDocument()
    expect(screen.getByText(/jumlah 0 dan tidak disimpan/i)).toBeInTheDocument()
    // material vendor tidak dialokasikan dari gudang: tidak ikut terisi, hanya terdaftar sebagai informasi
    expect(screen.getByText(/Material disediakan vendor \(1\)/i)).toBeInTheDocument()
    expect(screen.queryByDisplayValue('7')).not.toBeInTheDocument()

    // hanya material SR APP yang punya pilihan sumber UP3 / ULP
    const group = screen.getByRole('group', { name: /Sumber material SR APP/i })
    expect(screen.getAllByRole('group', { name: /Sumber material SR APP/i })).toHaveLength(1)
    expect(within(group).getByRole('button', { name: 'UP3' })).toHaveAttribute('aria-pressed', 'true')
    // pindah ke ULP (stok 0 < kebutuhan 2) -> jumlah otomatis 0
    fireEvent.click(within(group).getByRole('button', { name: 'ULP' }))
    await waitFor(() => expect(screen.queryByDisplayValue('2')).not.toBeInTheDocument())
    expect(within(group).getByRole('button', { name: 'ULP' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('F. Satu peran satu bagian: Perencanaan hanya melihat tiang, Konstruksi hanya material, peran lihat melihat keduanya', async () => {
    const { unmount } = mountPanel({ canManagePoles: true })
    expect(await screen.findByText(/2\. Alokasi Tiang/i)).toBeInTheDocument()
    expect(screen.queryByText(/1\. Alokasi Material/i)).not.toBeInTheDocument()
    unmount()

    const second = mountPanel({ canManageMaterials: true })
    expect(await screen.findByText(/1\. Alokasi Material/i)).toBeInTheDocument()
    expect(screen.queryByText(/2\. Alokasi Tiang/i)).not.toBeInTheDocument()
    second.unmount()

    mountPanel({})
    expect(await screen.findByText(/1\. Alokasi Material/i)).toBeInTheDocument()
    expect(screen.getByText(/2\. Alokasi Tiang/i)).toBeInTheDocument()
  })

  it('D. Drawer pratinjau: Mulai Survei dan Gambar & MTO mengarahkan ke halaman prosesnya, tanpa memanggil POST dari drawer', async () => {
    const user = userEvent.setup()
    surveyApi.create.mockResolvedValue({ data: { id: 'srv-1', survey_number: 'SRV-001' } })
    surveyApi.listForApplication.mockResolvedValue({ data: [] })
    drawingApi.create.mockResolvedValue({ data: { id: 'drw-1', drawing_number: 'DRW-001' } })
    drawingApi.forApplication.mockResolvedValue({ data: null })
    applicationApi.get.mockResolvedValue({
      data: {
        id: 'app-uuid-1',
        application_number: 'PBPD-001',
        application_type: 'PB',
        transaction_type: 'PASANG BARU',
        status: 'APPROVED',
        customer: { name: 'Pelanggan ULP' },
        unit: { id: 'u-1', code: '51543', name: 'ULP Mojokerto' },
        status_history: [],
        survey: { status: 'ACCEPTED', outcome: 'EXTENSION' },
        proposal: { id: 'p', proposal_number: '00001/USULAN-PBPD/10-11/51453/2026', issued: true, members_count: 1, is_representative: true, representative_application_id: 'app-uuid-1' },
      },
    })

    const { ApplicationDetailDrawer } = await import('./applications/ApplicationsPage.jsx')

    render(
      <MemoryRouter>
        <NotificationProvider>
          <ApplicationDetailDrawer
            applicationId="app-uuid-1"
            canViewSurvey={true}
            canExecuteSurvey={true}
            canViewDrawing={true}
            canExecuteDrawing={true}
            canAssignDrawing={true}
            onClose={vi.fn()}
          />
        </NotificationProvider>
      </MemoryRouter>
    )

    // Tab Survey: tombol "Mulai Survei" mengarahkan ke Usulan Survei (drawer hanya pratinjau)
    const surveyTabBtn = await screen.findByRole('button', { name: /Survei & Pengukuran/i })
    await user.click(surveyTabBtn)

    const startSurveyBtn = await screen.findByRole('button', { name: /Mulai Survei/i })
    await user.click(startSurveyBtn)
    expect(surveyApi.create).not.toHaveBeenCalled()

    // Tab Gambar: usulan sudah terbit, pekerjaan gambar dan MTO dibuka di halaman usulan
    const drawingTabBtn = screen.getByRole('button', { name: /Gambar Teknik/i })
    await user.click(drawingTabBtn)

    expect(await screen.findByRole('button', { name: /Buka Halaman Usulan/i })).toBeInTheDocument()
    expect(drawingApi.create).not.toHaveBeenCalled()
  })

  it('E. Halaman daftar PB/PD memanggil GET /applications?listing=pbpd dan menampilkan kolom SUMBER / USULAN', async () => {
    applicationApi.list.mockResolvedValue({
      data: [
        {
          id: 'app-1',
          application_number: 'PBPD-2026-0001',
          application_type: 'PB',
          transaction_type: 'PASANG BARU',
          status: 'APPROVED',
          source_type: 'MANUAL',
          proposal_number: 'USL/2026/001',
          customer: { id: 'c-1', name: 'PT Industri Terpadu' },
          unit: { id: 'u-1', code: '51543', name: 'ULP Mojokerto' },
          delta_power_kva: 197,
          created_at: '2026-11-07T10:00:00Z',
        },
      ],
      meta: { current_page: 1, per_page: 25, total: 1, last_page: 1 },
    })

    render(
      <MemoryRouter>
        <NotificationProvider>
          <ApplicationsPage />
        </NotificationProvider>
      </MemoryRouter>
    )

    await waitFor(() => {
      expect(applicationApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ listing: 'pbpd' })
      )
    })

    expect(await screen.findByText('SUMBER / USULAN')).toBeInTheDocument()
    expect(screen.getByText('USL/2026/001')).toBeInTheDocument()
  })

  it('F. Route /work-orders dapat diakses oleh pemegang vendor.portal', async () => {
    workOrdersApi.list.mockResolvedValue({ data: [] })

    render(
      <MemoryRouter initialEntries={['/work-orders']}>
        <AccessContext.Provider
          value={{
            loading: false,
            can: { 'vendor.portal': true },
          }}
        >
          <NotificationProvider>
            <App />
          </NotificationProvider>
        </AccessContext.Provider>
      </MemoryRouter>
    )

    expect(await screen.findByRole('heading', { name: /Surat Perintah Kerja \(SPK \/ WO\)/i })).toBeInTheDocument()
  })

  it('G. Panel KKF per permohonan menampilkan tautan ke usulan bila permohonan anggota usulan', async () => {
    const mockAppWithProposal = {
      id: 'app-uuid-1',
      application_number: 'PBPD-001',
      proposal_number: 'USL/U-51543/202611/0001',
      proposal_id: 'prop-uuid-99',
    }

    render(
      <MemoryRouter>
        <NotificationProvider>
          <ApplicationKkfPanel
            application={mockAppWithProposal}
            canView={true}
            canRun={true}
          />
        </NotificationProvider>
      </MemoryRouter>
    )

    expect(await screen.findByText(/Kajian Kelayakan Finansial \(KKF\) Usulan Kelompok/i)).toBeInTheDocument()
    expect(screen.getByText(/KKF dihitung pada usulan USL\/U-51543\/202611\/0001/i)).toBeInTheDocument()
  })

  it('H. moduleRegistry dan Beranda: rkm, rab-kkf, work-order status ACTIVE, ada bastp dan usulan, dan langkah 5-8 mengarah ke halaman nyata', () => {
    const rkm = MODULE_DOMAINS.find((m) => m.slug === 'rkm')
    const rabKkf = MODULE_DOMAINS.find((m) => m.slug === 'rab-kkf')
    const wo = MODULE_DOMAINS.find((m) => m.slug === 'work-order')
    const bastp = MODULE_DOMAINS.find((m) => m.slug === 'bastp')
    const usulan = MODULE_DOMAINS.find((m) => m.slug === 'usulan')

    expect(rkm?.status).toBe('ACTIVE')
    expect(rabKkf?.status).toBe('ACTIVE')
    expect(wo?.status).toBe('ACTIVE')
    expect(bastp?.status).toBe('ACTIVE')
    expect(usulan?.status).toBe('ACTIVE')

    // Render Beranda
    render(
      <MemoryRouter>
        <AccessContext.Provider value={{ loading: false, can: {} }}>
          <HomePage />
        </AccessContext.Provider>
      </MemoryRouter>
    )

    expect(screen.getByText('5. RAB & KKF')).toBeInTheDocument()
    expect(screen.getByText('6. RKM')).toBeInTheDocument()
    expect(screen.getByText('Rencana Kebutuhan Material')).toBeInTheDocument()
    expect(screen.getByText('7. SPK / WO')).toBeInTheDocument()
    expect(screen.getByText('8. BASTP')).toBeInTheDocument()
    expect(screen.getByText('Serah Terima Pekerjaan')).toBeInTheDocument()
  })
})
