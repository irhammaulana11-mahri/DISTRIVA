import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import VendorsPage from '../master-data/VendorsPage.jsx'
import ApplicationWorkOrdersPanel from '../applications/ApplicationWorkOrdersPanel.jsx'
import WorkOrdersPage from './WorkOrdersPage.jsx'
import WorkOrderAgendaPage from './WorkOrderAgendaPage.jsx'
import { vendorsApi, workOrdersApi, adminApi } from '../../services/api.js'

// Mock APIs
vi.mock('../../services/api.js', () => ({
  vendorsApi: {
      update: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    setStatus: vi.fn(),
    linkAccount: vi.fn(),
    deactivateAccount: vi.fn(),
  },
  applicationApi: { get: vi.fn() },
  workOrdersApi: {
    list: vi.fn(),
    byAgenda: vi.fn(),
    listForApplication: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    setVendor: vi.fn(),
    setTargetDate: vi.fn(),
    submit: vi.fn(),
    decide: vi.fn(),
    submitProgress: vi.fn(),
    decideProgress: vi.fn(),
    cancel: vi.fn(),
    amend: vi.fn(),
  },
  bastpApi: {
    listForWorkOrder: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
  },
  adminApi: {
    users: vi.fn(),
  },
}))

function renderWithProviders(ui, { can = {}, isSysAdmin = false } = {}) {
  return render(
    <MemoryRouter>
      <AccessContext.Provider
        value={{
          loading: false,
          can,
          canWrite: can,
          isSysAdmin,
          createUnits: [],
        }}
      >
        <NotificationProvider>{ui}</NotificationProvider>
      </AccessContext.Provider>
    </MemoryRouter>
  )
}

function renderWorkOrderPages({ can = {} } = {}) {
  return render(
    <MemoryRouter initialEntries={['/work-orders']}>
      <AccessContext.Provider value={{ loading: false, can, canWrite: can, isSysAdmin: false, createUnits: [] }}>
        <NotificationProvider>
          <Routes>
            <Route path="/work-orders" element={<WorkOrdersPage />} />
            <Route path="/work-orders/:applicationId" element={<WorkOrderAgendaPage />} />
          </Routes>
        </NotificationProvider>
      </AccessContext.Provider>
    </MemoryRouter>,
  )
}

describe('Vendor & Work Orders Workflow (docs/72, docs/62 §32)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('Master Data Vendor (/master-data/vendors)', () => {
    const mockVendors = [
      {
        id: 'vnd-1',
        code: 'VND-SAR-01',
        name: 'PT Sinar Abadi Raya',
        status: 'ACTIVE',
        accounts_count: 1,
        active_accounts_count: 1,
        accounts: [
          {
            id: 'acc-1',
            user_id: 'usr-v-1',
            name: 'Budi Teknisi Vendor',
            email: 'budi@sinarabadi.co.id',
            user_nip: 'VND001',
            is_active: true,
          },
        ],
      },
      {
        id: 'vnd-2',
        code: 'VND-ME-02',
        name: 'CV Mandiri Elektrik',
        status: 'SUSPENDED',
        accounts_count: 0,
        active_accounts_count: 0,
        accounts: [],
      },
    ]

    it('1. renders vendor list with active and suspended badges when user has vendors.manage', async () => {
      vendorsApi.list.mockResolvedValueOnce({ data: mockVendors })

      renderWithProviders(<VendorsPage />, { can: { 'vendors.manage': true } })

      await waitFor(() => {
        expect(screen.getByText('PT Sinar Abadi Raya')).toBeInTheDocument()
        expect(screen.getByText('CV Mandiri Elektrik')).toBeInTheDocument()
      })

      expect(screen.getByText('VND-SAR-01')).toBeInTheDocument()
      expect(screen.getByText('VND-ME-02')).toBeInTheDocument()
      expect(screen.getByText('1 Akun Aktif')).toBeInTheDocument()
      expect(screen.getByText('0 Akun Aktif')).toBeInTheDocument()
    })

    it('2. Tambah Vendor dan Ubah profil membuka halaman formulir (bukan drawer); drawer hanya pratinjau', async () => {
      vendorsApi.list.mockResolvedValue({ data: [{ ...mockVendors[0], profile: { pic_name: 'Budi', city: 'Malang', npwp: '012345678901000', contract_number: 'SPK-1', contract_valid_until: '2020-01-01' } }, mockVendors[1]] })
      render(
        <MemoryRouter initialEntries={['/master-data/vendors']}>
          <AccessContext.Provider value={{ loading: false, can: { 'vendors.manage': true }, canWrite: {}, isSysAdmin: false, createUnits: [] }}>
            <NotificationProvider>
              <Routes>
                <Route path="/master-data/vendors" element={<VendorsPage />} />
                <Route path="/master-data/vendors/new" element={<div>HALAMAN TAMBAH</div>} />
                <Route path="/master-data/vendors/:id/edit" element={<div>HALAMAN UBAH</div>} />
              </Routes>
            </NotificationProvider>
          </AccessContext.Provider>
        </MemoryRouter>
      )
      await waitFor(() => expect(screen.getByText('PT Sinar Abadi Raya')).toBeInTheDocument())

      // pratinjau: laci hanya baca, tanpa kolom isian; kontrak yang lewat tanggal ditandai
      fireEvent.click(screen.getAllByRole('button', { name: 'Lihat profil' })[0])
      expect(await screen.findByText('Malang')).toBeInTheDocument()
      expect(screen.getByText('012345678901000')).toBeInTheDocument()
      expect(screen.getAllByText('Sudah berakhir').length).toBeGreaterThan(0)
      expect(screen.queryByPlaceholderText(/Contoh: VND-001/i)).not.toBeInTheDocument()
      fireEvent.click(screen.getByRole('button', { name: 'Ubah Profil' }))
      expect(await screen.findByText('HALAMAN UBAH')).toBeInTheDocument()
    })

    it('2a. tombol Tambah Vendor membuka halaman tambah', async () => {
      vendorsApi.list.mockResolvedValue({ data: mockVendors })
      render(
        <MemoryRouter initialEntries={['/master-data/vendors']}>
          <AccessContext.Provider value={{ loading: false, can: { 'vendors.manage': true }, canWrite: {}, isSysAdmin: false, createUnits: [] }}>
            <NotificationProvider>
              <Routes>
                <Route path="/master-data/vendors" element={<VendorsPage />} />
                <Route path="/master-data/vendors/new" element={<div>HALAMAN TAMBAH</div>} />
              </Routes>
            </NotificationProvider>
          </AccessContext.Provider>
        </MemoryRouter>
      )
      await waitFor(() => expect(screen.getByText('PT Sinar Abadi Raya')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: /tambah vendor/i }))
      expect(await screen.findByText('HALAMAN TAMBAH')).toBeInTheDocument()
    })

    it('3. manages vendor accounts: links active user and deactivates account link', async () => {
      vendorsApi.list.mockResolvedValue({ data: mockVendors })
      adminApi.users.mockResolvedValueOnce({
        data: [
          {
            id: 'usr-v-2',
            name: 'Andi Lapangan',
            email: 'andi@sinarabadi.co.id',
            nip: 'VND002',
            roles: [{ name: 'VENDOR' }],
          },
        ],
      })
      vendorsApi.linkAccount.mockResolvedValueOnce({ message: 'Akun ditautkan.' })
      vendorsApi.deactivateAccount.mockResolvedValueOnce({ message: 'Tautan akun dinonaktifkan.' })

      renderWithProviders(<VendorsPage />, { can: { 'vendors.manage': true } })

      await waitFor(() => {
        expect(screen.getByText('PT Sinar Abadi Raya')).toBeInTheDocument()
      })

      // Click Kelola Akun on first row
      const accountBtns = screen.getAllByRole('button', { name: /kelola akun/i })
      fireEvent.click(accountBtns[0])

      await waitFor(() => {
        expect(screen.getByText(/Akun Vendor: PT Sinar Abadi Raya/i)).toBeInTheDocument()
      })

      // Existing linked account displayed
      expect(screen.getByText('Budi Teknisi Vendor')).toBeInTheDocument()
      expect(screen.getByText('budi@sinarabadi.co.id')).toBeInTheDocument()

      // Click Nonaktifkan on existing account
      const deactBtn = screen.getByRole('button', { name: /nonaktifkan/i })
      fireEvent.click(deactBtn)

      await waitFor(() => {
        expect(vendorsApi.deactivateAccount).toHaveBeenCalledWith('acc-1')
      })
    })
  })

  describe('Internal Work Orders Panel on Application (ApplicationWorkOrdersPanel)', () => {
    const mockApp = {
      id: 'app-uuid-1',
      application_number: 'PB-2026-0001',
      external_status: 'DALAM_PROSES',
    }

    const mockWoDraft = {
      id: 'wo-uuid-1',
      wo_number: 'WO-2026-0001-v1',
      application_id: 'app-uuid-1',
      version_number: 1,
      status: 'DRAFT',
      vendor_company_id: null,
      vendor_note: null,
      amended_from_id: null,
      amendment_reason: null,
      return_reason: null,
      issued_at: null,
      completed_at: null,
      cancel_reason: null,
      tasks: [
        {
          id: 'task-1',
          sequence: 1,
          group_code: 'SUTM',
          title: 'Pemasangan Tiang Beton 12m',
          unit: 'Btg',
          volume: 5,
          amount: 15000000,
          verified_percent: 0,
        },
      ],
      materials: [{ khs_code: 'TG-12-350', quantity: 5 }],
      progress: [],
      events: [
        {
          event_type: 'CREATED',
          reason: 'Pembuatan draf WO',
          details: null,
          occurred_at: '2026-11-07T10:00:00Z',
          actor_name: 'Staf Konstruksi',
        },
      ],
    }

    const mockWoIssued = {
      ...mockWoDraft,
      status: 'ISSUED',
      vendor_company_id: 'vnd-1',
      issued_at: '2026-11-07T11:00:00Z',
      tasks: [
        {
          id: 'task-1',
          sequence: 1,
          group_code: 'SUTM',
          title: 'Pemasangan Tiang Beton 12m',
          unit: 'Btg',
          volume: 5,
          amount: 15000000,
          verified_percent: 50,
        },
      ],
      progress: [
        {
          id: 'prog-1',
          task_id: 'task-1',
          cumulative_percent: 50,
          status: 'SUBMITTED',
          notes: 'Tiang 1-3 terpasang tegak',
          submitted_by_name: 'Vendor Budi',
          submitted_at: '2026-11-07T12:00:00Z',
          decided_at: null,
          return_reason: null,
        },
      ],
    }

    it('1. allows creating WO draft when canCreate is true', async () => {
      workOrdersApi.listForApplication.mockResolvedValueOnce({ data: [] })
      workOrdersApi.create.mockResolvedValueOnce({ data: { id: 'wo-uuid-new' } })

      renderWithProviders(
        <ApplicationWorkOrdersPanel
          application={mockApp}
          canCreate={true}
          canView={true}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Belum ada SPK / Work Order untuk permohonan ini.')).toBeInTheDocument()
      })

      const createBtn = screen.getByRole('button', { name: /buat spk/i })
      fireEvent.click(createBtn)

      await waitFor(() => {
        expect(workOrdersApi.create).toHaveBeenCalledWith('app-uuid-1')
      })
    })

    it('2. assigns vendor, submits WO, and handles ASMAN issue/return decision', async () => {
      workOrdersApi.listForApplication.mockResolvedValue({
        data: [{ id: 'wo-uuid-1', wo_number: 'WO-2026-0001-v1', status: 'DRAFT', version_number: 1 }],
      })
      workOrdersApi.get.mockResolvedValue({ data: mockWoDraft })
      vendorsApi.list.mockResolvedValue({
        data: [{ id: 'vnd-1', code: 'VND-SAR-01', name: 'PT Sinar Abadi Raya', status: 'ACTIVE' }],
      })
      workOrdersApi.setVendor.mockResolvedValueOnce({ message: 'Vendor dipilih.' })
      workOrdersApi.submit.mockResolvedValueOnce({ message: 'WO diajukan.' })

      renderWithProviders(
        <ApplicationWorkOrdersPanel
          application={mockApp}
          canCreate={true}
          canIssue={true}
          canView={true}
        />
      )

      await waitFor(() => {
        expect(screen.getAllByText('WO-2026-0001-v1').length).toBeGreaterThan(0)
        expect(screen.getByText('Pemasangan Tiang Beton 12m')).toBeInTheDocument()
      })

      // Select vendor in inline form
      fireEvent.click(screen.getByRole('combobox', { name: /pilih vendor mitra/i }))
      fireEvent.click(await screen.findByRole('option', { name: /PT Sinar Abadi Raya/ }))

      fireEvent.change(screen.getByLabelText(/target selesai pekerjaan/i), { target: { value: '2026-12-31' } })
      const saveVendorBtn = screen.getByRole('button', { name: /simpan pilihan vendor/i })
      fireEvent.click(saveVendorBtn)

      await waitFor(() => {
        expect(workOrdersApi.setVendor).toHaveBeenCalledWith(
          'wo-uuid-1',
          expect.objectContaining({
            vendor_company_id: 'vnd-1',
            target_date: '2026-12-31',
          })
        )
      })
    })

    it('3. displays verified progress and handles progress verification & BASTP completion pathway', async () => {
      workOrdersApi.listForApplication.mockResolvedValue({
        data: [{ id: 'wo-uuid-1', wo_number: 'WO-2026-0001-v1', status: 'ISSUED', version_number: 1 }],
      })
      workOrdersApi.get.mockResolvedValue({ data: mockWoIssued })
      vendorsApi.list.mockResolvedValue({
        data: [{ id: 'vnd-1', code: 'VND-SAR-01', name: 'PT Sinar Abadi Raya', status: 'ACTIVE' }],
      })
      workOrdersApi.decideProgress.mockResolvedValueOnce({ message: 'Keputusan progres dicatat.' })

      renderWithProviders(
        <ApplicationWorkOrdersPanel
          application={mockApp}
          canVerifyProgress={true}
          canComplete={true}
          canView={true}
        />
      )

      await waitFor(() => {
        expect(screen.getByText('Tiang 1-3 terpasang tegak')).toBeInTheDocument()
        expect(screen.getAllByText('DALAM_PROSES').length).toBeGreaterThan(0)
      })

      // Verify progress
      const verifyBtn = screen.getByRole('button', { name: /verifikasi/i })
      fireEvent.click(verifyBtn)

      await waitFor(() => {
        expect(workOrdersApi.decideProgress).toHaveBeenCalledWith('prog-1', {
          decision: 'VERIFIED',
        })
      })
    })
  })

  describe('Vendor Portal (/work-orders)', () => {
    const mockVendorOrders = [
      {
        application_id: 'app-uuid-10',
        application_number: 'PB-2026-0010',
        agenda_number: '5145320260010',
        customer_name: 'Budi Santoso',
        unit_name: 'ULP Jombang',
        application_type: 'PB',
        application_status: 'APPROVED',
        network: { id: 'wo-uuid-10', wo_number: 'WO-2026-0010-v1', version_number: 1, status: 'ISSUED', vendor_name: 'PT Vendor', progress_percent: 20, pending_progress: 0 },
        network_creatable: false,
        poles: [],
        poles_creatable_quantity: 0,
      },
    ]

    const openVendorDetail = async () => {
      await waitFor(() => expect(screen.getByText('WO-2026-0010-v1')).toBeInTheDocument())
      fireEvent.click(screen.getByRole('button', { name: /buka halaman pb-2026-0010/i }))
    }

    const mockVendorWoDetail = {
      id: 'wo-uuid-10',
      wo_number: 'WO-2026-0010-v1',
      application_id: 'app-uuid-10',
      version_number: 1,
      status: 'ISSUED',
      vendor_company_id: 'vnd-1',
      vendor_note: null, // suppressed
      issued_at: '2026-11-07T09:30:00Z',
      completed_at: null,
      return_reason: null,
      tasks: [
        {
          id: 'task-10',
          sequence: 1,
          group_code: 'SUTM',
          title: 'Pemasangan Tiang Beton 12m',
          unit: 'Btg',
          volume: 10,
          amount: null, // CRITICAL: suppressed for vendor
          verified_percent: 20,
        },
      ],
      materials: [{ khs_code: 'TG-12-350', khs_name: 'Tiang Beton 12m 350 daN', unit: 'Btg', quantity: 10 }],
      progress: [],
      events: [], // suppressed for vendor
    }

    it('1. lists orders and opens detail drawer WITHOUT displaying RAB monetary values (amount)', async () => {
      workOrdersApi.byAgenda.mockResolvedValue({ data: mockVendorOrders })
      workOrdersApi.get.mockResolvedValue({ data: mockVendorWoDetail })

      renderWorkOrderPages({ can: { 'vendor.portal': true } })

      await openVendorDetail()

      await waitFor(() => {
        expect(screen.getByText('Daftar Pekerjaan / Tugas Lapangan (1)')).toBeInTheDocument()
        expect(screen.getByText('Pemasangan Tiang Beton 12m')).toBeInTheDocument()
      })

      expect(screen.getByText('Tiang Beton 12m 350 daN')).toBeInTheDocument()   // material dibaca dengan nama
      expect(screen.queryByText('TG-12-350')).not.toBeInTheDocument()            // bukan kode KHS

      // Verify RAB amounts / currency symbols do not appear in table
      expect(screen.queryByText(/Rp/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/RAB/i)).not.toBeInTheDocument()
    })

    it('2. submits cumulative progress with unique submission_key and handles idempotency replay', async () => {
      workOrdersApi.byAgenda.mockResolvedValue({ data: mockVendorOrders })
      workOrdersApi.get.mockResolvedValue({ data: mockVendorWoDetail })
      workOrdersApi.submitProgress.mockResolvedValueOnce({
        data: { id: 'prog-new-1' },
        replayed: true, // Idempotency replay simulation
      })

      renderWorkOrderPages({ can: { 'vendor.portal': true } })

      await openVendorDetail()

      await waitFor(() => {
        expect(screen.getByText('Laporkan Progres Fisik')).toBeInTheDocument()
      })

      fireEvent.click(screen.getByRole('button', { name: /laporkan progres fisik/i }))

      expect(screen.getByText('Laporkan Progres Fisik Lapangan')).toBeInTheDocument()

      const percentInput = screen.getByPlaceholderText('Contoh: 45.5')
      const notesInput = screen.getByPlaceholderText(/Catatan pengerjaan lapangan/i)

      fireEvent.change(percentInput, { target: { value: '45.5' } })
      fireEvent.change(notesInput, { target: { value: 'Pemasangan pondasi dan tiang selesai 4 btg.' } })

      const submitBtn = screen.getByRole('button', { name: /kirim pengajuan progres/i })
      fireEvent.click(submitBtn)

      await waitFor(() => {
        expect(workOrdersApi.submitProgress).toHaveBeenCalledWith(
          'wo-uuid-10',
          expect.objectContaining({
            task_id: 'task-10',
            cumulative_percent: 45.5,
            notes: 'Pemasangan pondasi dan tiang selesai 4 btg.',
            submission_key: expect.any(String),
          })
        )
      })
    })
  })
})
