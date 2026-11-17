import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { applicationApi, drawingApi, eisSyncApi } from '../../services/api.js'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import ApplicationsPage from './ApplicationsPage.jsx'
import { ApplicationCreatePage, ApplicationDetailPage, ApplicationImportPage, EisSyncPage } from './ApplicationPages.jsx'

// Mock access context to simulate a user with applications permissions
let mockCan = {
  'applications.view': true,
  'applications.create': true,
  'applications.update': true,
  'applications.submit': true,
  'applications.cancel': true,
  'applications.import': true,
  'proposals.view': true,
  'proposals.manage': true,
  'surveys.view': true,
  'surveys.execute': true,
  'surveys.assign': true,
}

vi.mock('../../features/admin/AccessContext.jsx', () => ({
  useAccess: () => ({
    can: mockCan,
    canWrite: mockCan,
    createUnits: [
      { id: 'u-ulp-1', code: '51453', name: 'ULP Jombang' },
      { id: 'u-ulp-2', code: '51454', name: 'ULP Ploso' },
    ],
    isSysAdmin: false,
  }),
}))

vi.mock('../../services/api.js', () => ({
  eisSyncApi: { show: vi.fn().mockResolvedValue({ data: { settings: { eis_username: 'u', has_password: true, power_min: 0, power_max: 99999999, lookback_days: 180, auto_enabled: false, auto_time: '18:13' }, runs: [] } }), save: vi.fn(), start: vi.fn(), run: vi.fn() },
  applicationApi: {
    attention: vi.fn().mockResolvedValue({ data: [], meta: { level: 'UP3', limit: 100, min_days: 0 } }),
    units: vi.fn().mockResolvedValue({ scope: 'GLOBAL', up3_units: [{ id: 'up1', code: '51400', name: 'UP3 Nganjuk' }, { id: 'up2', code: '51500', name: 'UP3 Lain' }], ulp_units: [{ id: 'u1', code: '51453', name: 'ULP Jombang', parent_id: 'up1' }, { id: 'u2', code: '51454', name: 'ULP Mojoagung', parent_id: 'up1' }, { id: 'u3', code: '51501', name: 'ULP Lain', parent_id: 'up2' }] }),
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    submit: vi.fn(),
    cancel: vi.fn(),
    addReference: vi.fn(),
    uploadImport: vi.fn(),
    importBatchDetail: vi.fn(),
    confirmImport: vi.fn(),
    discardImport: vi.fn(),
  },
  proposalsApi: {
    selectable: vi.fn().mockResolvedValue({ data: [], meta: {} }),
    list: vi.fn().mockResolvedValue({ data: [] }),
    create: vi.fn(),
    get: vi.fn(),
    addMembers: vi.fn(),
    removeMember: vi.fn(),
    cancel: vi.fn(),
    kkfRuns: vi.fn().mockResolvedValue({ data: [] }),
    runKkf: vi.fn(),
  },
  drawingApi: {
    forApplication: vi.fn().mockResolvedValue({ data: null }),
    create: vi.fn(),
    authors: vi.fn().mockResolvedValue({ data: [] }),
  },
}))

// Daftar (laci hanya pratinjau) + halaman kerja: daftar baru, impor, sinkronisasi EIS, dan detail permohonan
function renderApp(path = '/permohonan') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider>
        <Routes>
          <Route path="/permohonan" element={<ApplicationsPage />} />
          <Route path="/permohonan/baru" element={<ApplicationCreatePage />} />
          <Route path="/permohonan/impor" element={<ApplicationImportPage />} />
          <Route path="/permohonan/sinkronisasi-eis" element={<EisSyncPage />} />
          <Route path="/permohonan/:applicationId" element={<ApplicationDetailPage />} />
        </Routes>
      </NotificationProvider>
    </MemoryRouter>
  )
}

describe('ApplicationsPage (PB/PD Stage 1A)', () => {
  const sampleApps = [
    {
      id: 'app-uuid-1',
      application_number: 'APP-202611-0001',
      application_type: 'PB',
      transaction_type: 'PASANG BARU',
      status: 'DRAFT',
      service_address: 'Jl. KH Wahid Hasyim No. 12',
      delta_power_kva: 0.9,
      created_at: '2026-11-06T10:00:00Z',
      customer: { id: 'c-1', name: 'Siti Aminah' },
      unit: { id: 'u-ulp-1', code: '51453', name: 'ULP Jombang' },
    },
    {
      id: 'app-uuid-2',
      application_number: 'APP-202611-0002',
      application_type: 'PD',
      transaction_type: 'PERUBAHAN DAYA',
      status: 'SUBMITTED',
      service_address: 'Jl. Raya Mojoagung No. 45',
      delta_power_kva: 1.3,
      new_tariff_code: 'B2T',
      new_power_value: '13.2',
      new_power_unit: 'kVA',
      created_at: '2026-11-06T11:00:00Z',
      customer: { id: 'c-2', name: 'Budi Santoso' },
      unit: { id: 'u-ulp-1', code: '51453', name: 'ULP Jombang' },
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    mockCan = {
      'applications.view': true,
      'applications.create': true,
      'applications.update': true,
      'applications.submit': true,
      'applications.cancel': true,
      'applications.import': true,
      'proposals.view': true,
      'proposals.manage': true,
      'surveys.view': true,
      'surveys.execute': true,
      'surveys.assign': true,
    }
    applicationApi.list.mockResolvedValue({
      data: sampleApps,
      meta: { current_page: 1, per_page: 10, total: 2, last_page: 1 },
    })
  })

  it('renders application list with standardized headers, counts and badges', async () => {
    renderApp()

    expect(await screen.findByText('APP-202611-0001')).toBeInTheDocument()
    expect(screen.getByText('Siti Aminah')).toBeInTheDocument()
    expect(screen.getByText('APP-202611-0002')).toBeInTheDocument()
    expect(screen.getByText('Budi Santoso')).toBeInTheDocument()
    expect(screen.getByText('TARIF & DAYA BARU')).toBeInTheDocument()
    expect(screen.getByText('SELISIH DAYA')).toBeInTheDocument()
    expect(screen.getByText('B2T · 13,2 kVA')).toBeInTheDocument()
    expect(screen.getByText('Menampilkan 2 dari 2 permohonan')).toBeInTheDocument()
    expect(screen.getAllByText('Draf').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Diajukan').length).toBeGreaterThan(0)
  })

  it('filters applications by search query and type', async () => {
    renderApp()

    await screen.findByText('APP-202611-0001')

    const searchInput = screen.getByPlaceholderText(/Cari nomor agenda/i)
    await userEvent.type(searchInput, 'Siti')

    await waitFor(() => {
      expect(applicationApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ search: 'Siti' })
      )
    })

    const typeSelect = screen.getByLabelText('Filter Tipe Permohonan')
    await userEvent.selectOptions(typeSelect, 'PB')

    await waitFor(() => {
      expect(applicationApi.list).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'PB' })
      )
    })
  })

  it('tabel awal PB/PD hanya daya >= 6.600 VA (3 fasa) dan filter Daya bisa menampilkan semua daya, pilihan diingat', async () => {
    localStorage.removeItem('distriva.pbpd.power')
    renderApp()
    await screen.findByText('APP-202611-0001')
    expect(applicationApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ listing: 'pbpd', min_va: 6600 }))      // tampilan awal: 3 fasa
    const select = screen.getByLabelText('Filter Daya')
    expect(select).toHaveValue('3phase')

    await userEvent.selectOptions(select, 'all')
    await waitFor(() => expect(applicationApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ listing: 'pbpd', min_va: undefined })))
    expect(localStorage.getItem('distriva.pbpd.power')).toBe('all')                                                          // diingat untuk kunjungan berikutnya
    localStorage.removeItem('distriva.pbpd.power')
  })

  it('opens create drawer, validates input and submits new draft application', async () => {
    applicationApi.create.mockResolvedValue({
      data: {
        id: 'app-uuid-new',
        application_number: 'APP-202611-0003',
        status: 'DRAFT',
      },
    })

    renderApp()

    await screen.findByText('APP-202611-0001')

    // Click "+ Permohonan Baru"
    const newBtn = screen.getByRole('button', { name: /Permohonan Baru/i })
    await userEvent.click(newBtn)

    expect(await screen.findByText('Pendaftaran Permohonan PB/PD')).toBeInTheDocument()

    // Fill form
    const nameInput = screen.getByPlaceholderText(/Masukkan nama pemohon/i)
    await userEvent.type(nameInput, 'Ahmad Fauzi')

    const phoneInput = screen.getByPlaceholderText('081234567890')
    await userEvent.type(phoneInput, '081298765432')

    const addressInput = screen.getByPlaceholderText(/Nama jalan, nomor rumah/i)
    await userEvent.type(addressInput, 'Jl. Pattimura No. 8')

    // Save
    const saveBtn = screen.getByRole('button', { name: /Simpan sebagai Draf/i })
    await userEvent.click(saveBtn)

    await waitFor(() => {
      expect(applicationApi.create).toHaveBeenCalledWith(
        expect.objectContaining({
          application_type: 'PB',
          customer: expect.objectContaining({
            name: 'Ahmad Fauzi',
            phone: '081298765432',
          }),
          service_address: 'Jl. Pattimura No. 8',
        })
      )
    })
  })

  it('opens detail drawer and submits draft application to survey', async () => {
    applicationApi.get.mockResolvedValue({
      data: {
        ...sampleApps[0],
        new_power: { value: 900, unit: 'VA' },
        new_tariff_code: 'R1',
        customer: {
          id: 'c-1',
          name: 'Siti Aminah',
          phone: '081234567890',
          email: 'siti@example.com',
          idpel: [{ value: '514530011223' }],
        },
        external_references: [
          { id: 'ref-1', reference_type: 'AGENDA', reference_number: '5145320261106001', external_system: 'AP2T' },
        ],
        status_history: [
          { from_status: null, to_status: 'DRAFT', changed_at: '2026-11-06T10:00:00Z', changed_by_email: 'retail@pln.co.id' },
        ],
      },
    })
    applicationApi.submit.mockResolvedValue({ data: { id: 'app-uuid-1', status: 'SUBMITTED' } })

    renderApp()

    await screen.findByText('APP-202611-0001')

    // Click detail button for first item
    const detailButtons = screen.getAllByTitle('Lihat Detail Permohonan')
    await userEvent.click(detailButtons[0])

    expect(await screen.findByText('Permohonan APP-202611-0001')).toBeInTheDocument()   // laci: pratinjau baca-saja
    expect(screen.queryByRole('button', { name: /Ajukan ke Survei/i })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: /Buka halaman lengkap/i }))
    expect(await screen.findByText('5145320261106001')).toBeInTheDocument()

    // Click submit to survey button
    const submitBtn = screen.getByRole('button', { name: /Ajukan ke Survei/i })
    await userEvent.click(submitBtn)

    await waitFor(() => {
      expect(applicationApi.submit).toHaveBeenCalledWith('app-uuid-1')
    })
  })

  it('cancels draft application with audit reason', async () => {
    applicationApi.cancel.mockResolvedValue({ data: { id: 'app-uuid-1', status: 'CANCELLED' } })

    renderApp()

    await screen.findByText('APP-202611-0001')

    // Click cancel button on first row
    const cancelBtn = screen.getByTitle('Batalkan Permohonan')
    await userEvent.click(cancelBtn)

    expect(await screen.findByText(/Batalkan Permohonan APP-202611-0001/i)).toBeInTheDocument()

    const reasonInput = screen.getByLabelText('Alasan')
    await userEvent.type(reasonInput, 'Permintaan pemohon batal menyambung.')

    const confirmBtn = screen.getByRole('button', { name: 'Konfirmasi Pembatalan' })
    await userEvent.click(confirmBtn)

    await waitFor(() => {
      expect(applicationApi.cancel).toHaveBeenCalledWith(
        'app-uuid-1',
        { reason: 'Permintaan pemohon batal menyambung.' }
      )
    })
  })

  it('automatically calculates and displays power in kVA in create drawer', async () => {
    renderApp()

    await screen.findByText('APP-202611-0001')
    await userEvent.click(screen.getByRole('button', { name: /Permohonan Baru/i }))

    expect(await screen.findByText('Pendaftaran Permohonan PB/PD')).toBeInTheDocument()

    // 900 VA is the default input -> should display 0,9 kVA
    expect(screen.getByText(/0,9 kVA/)).toBeInTheDocument()
  })

  it('adds No. Agenda in detail drawer which approves application', async () => {
    applicationApi.get.mockResolvedValue({
      data: {
        ...sampleApps[0],
        external_references: [],
        status_history: [],
      },
    })
    applicationApi.addReference.mockResolvedValue({ data: { id: 'ref-new' } })

    renderApp()

    await screen.findByText('APP-202611-0001')
    const detailButtons = screen.getAllByTitle('Lihat Detail Permohonan')
    await userEvent.click(detailButtons[0])

    expect(await screen.findByText('Permohonan APP-202611-0001')).toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/Masukkan nomor referensi/i)).not.toBeInTheDocument()   // pratinjau: tanpa form tautkan referensi
    await userEvent.click(await screen.findByRole('button', { name: /Buka halaman lengkap/i }))
    expect(await screen.findByText(/Pengisian Nomor Agenda akan otomatis mengubah status/)).toBeInTheDocument()

    const refInput = screen.getByPlaceholderText(/Masukkan nomor referensi/i)
    await userEvent.type(refInput, '5145320261106099')

    const linkBtn = screen.getByRole('button', { name: 'Tautkan' })
    await userEvent.click(linkBtn)

    await waitFor(() => {
      expect(applicationApi.addReference).toHaveBeenCalledWith(
        'app-uuid-1',
        expect.objectContaining({
          reference_type: 'AGENDA',
          reference_number: '5145320261106099',
        })
      )
    })
  })

  it('opens EIS import drawer, uploads file and previews staging counts', async () => {
    applicationApi.uploadImport.mockResolvedValue({
      data: {
        id: 'batch-uuid-1',
        file_name: 'bot_daftung_20261106.csv',
        total_rows: 10,
        counts: { NEW: 7, MATCHED: 2, UNCHANGED: 1, REJECT: 0 },
      },
    })
    applicationApi.importBatchDetail.mockResolvedValue({
      data: {
        id: 'batch-uuid-1',
        file_name: 'bot_daftung_20261106.csv',
        total_rows: 10,
        counts: { NEW: 7, MATCHED: 2, UNCHANGED: 1, REJECT: 0 },
      },
      rows: [
        {
          row: 1,
          agenda: '51453001',
          name: 'PT Maju Terus',
          type: 'PB',
          unit_code: '51453',
          action: 'NEW',
          errors: [],
          warnings: [],
          changes: {},
        },
      ],
      meta: { current_page: 1, per_page: 100, total: 10, last_page: 1 },
    })

    renderApp()

    await screen.findByText('APP-202611-0001')

    // Impor EIS satu drawer dengan Permohonan Baru: buka dulu, lalu pilih "Via Upload (Impor EIS)"
    expect(screen.queryByRole('button', { name: /^Impor EIS$/i })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /^Permohonan Baru$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /Via Upload \(Impor EIS\)/i }))

    expect(await screen.findByText(/Impor Permohonan EIS/i)).toBeInTheDocument()
    expect(screen.getByText(/Prinsip Impor Staging Aman/i)).toBeInTheDocument()
  })

  it('1. Halaman Permohonan hanya memuat daftar PB/PD; Usulan Survei dan Usulan Perluasan kini menu sendiri di sidebar', async () => {
    render(
      <MemoryRouter initialEntries={['/permohonan']}>
        <NotificationProvider>
          <ApplicationsPage />
        </NotificationProvider>
      </MemoryRouter>
    )

    expect(await screen.findByRole('heading', { name: 'Permohonan Pelanggan (PB/PD)' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Usulan Perluasan$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Usulan Survei$/i })).not.toBeInTheDocument()
    expect(screen.queryByText('Usulan Pelanggan (3 Fasa)')).not.toBeInTheDocument()
  })

  it('menu Sinkronisasi EIS ada di halaman Permohonan hanya untuk yang berizin dan membuka pengaturannya', async () => {
    const view = renderApp()
    await screen.findByText('APP-202611-0001')
    expect(screen.queryByRole('button', { name: 'Sinkronisasi EIS' })).not.toBeInTheDocument()
    view.unmount()

    mockCan = { ...mockCan, 'eis_sync.manage': true }
    renderApp()
    await screen.findByText('APP-202611-0001')
    await userEvent.click(screen.getByRole('button', { name: 'Sinkronisasi EIS' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Pengaturan' }))
    expect(await screen.findByLabelText('User EIS')).toHaveValue('u')
  })

  it('2. "Permohonan Baru" mengikuti izin (impor EIS ada di halaman pendaftaran); keadaan kosong menampilkan tombol yang sesuai izin', async () => {
    // 1. Both buttons exist when user has both permissions
    const { unmount } = renderApp()
    expect(screen.getByRole('button', { name: /^Permohonan Baru$/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Impor EIS$/i })).not.toBeInTheDocument()
    unmount()

    // 2. Empty state displays both buttons and EIS scope explanation
    applicationApi.list.mockResolvedValueOnce({ data: [], meta: { total: 0 } })
    const { unmount: unmountEmpty } = renderApp()
    expect(await screen.findByText(/Sinkronisasi EIS memuat pelanggan semua daya dan semua status/i)).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /^Permohonan Baru$/i }).length).toBeGreaterThan(0)
    unmountEmpty()

    // 3. User with only import permission
    mockCan = { ...mockCan, 'applications.create': false }
    applicationApi.list.mockResolvedValueOnce({ data: [], meta: { total: 0 } })
    const { unmount: unmountOnlyImport } = renderApp()
    expect(screen.queryByRole('button', { name: /^Permohonan Baru$/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Impor EIS$/i })).not.toBeInTheDocument()
    unmountOnlyImport()

    // 4. User with neither permission
    mockCan = { ...mockCan, 'applications.create': false, 'applications.import': false }
    applicationApi.list.mockResolvedValueOnce({ data: [], meta: { total: 0 } })
    renderApp()
    expect(await screen.findByText(/Tidak ada permohonan penyambungan/i)).toBeInTheDocument()
  })

  it('3. Chip "Belum ada IDPEL/No. Agenda/No. Register" muncul bila kosong, "Lengkapi" mengirim endpoint yang benar dan chip hilang; 409 server tampil verbatim', async () => {
    applicationApi.addReference.mockResolvedValue({ data: { id: 'ref-new' } })
    applicationApi.update.mockResolvedValue({ data: { id: 'app-uuid-1' } })

    renderApp()

    await screen.findByText('APP-202611-0001')

    // Missing chips appear
    expect(screen.getAllByText('Belum ada No. Agenda').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Belum ada No. Register').length).toBeGreaterThan(0)
    expect(screen.getAllByText('Belum ada IDPEL').length).toBeGreaterThan(0)

    // Click "Lengkapi" on No. Agenda
    const lengkapiBtns = screen.getAllByRole('button', { name: 'Lengkapi' })
    await userEvent.click(lengkapiBtns[0])

    expect(await screen.findByText('Lengkapi Nomor Agenda')).toBeInTheDocument()
    const input = screen.getByPlaceholderText(/Contoh: 5145320261106001/i)
    await userEvent.type(input, '5145320261106099')

    const saveBtn = screen.getByRole('button', { name: 'Simpan' })
    await userEvent.click(saveBtn)

    await waitFor(() => {
      expect(applicationApi.addReference).toHaveBeenCalledWith(
        'app-uuid-1',
        expect.objectContaining({
          reference_type: 'AGENDA',
          reference_number: '5145320261106099',
        })
      )
    })

    // Click "Lengkapi" on No. Register
    const lengkapiRegister = screen.getAllByRole('button', { name: 'Lengkapi' })[1]
    await userEvent.click(lengkapiRegister)

    expect(await screen.findByText('Lengkapi No. Register')).toBeInTheDocument()
    const regInput = screen.getByPlaceholderText(/Contoh: 5145320261106099/i)
    await userEvent.type(regInput, 'REG-51453-999')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    await waitFor(() => {
      expect(applicationApi.addReference).toHaveBeenCalledWith(
        'app-uuid-1',
        expect.objectContaining({
          reference_type: 'PAYMENT_REGISTER',
          reference_number: 'REG-51453-999',
        })
      )
    })

    // Test 409 verbatim on IDPEL
    const lengkapiIdpel = screen.getAllByRole('button', { name: 'Lengkapi' })[2]
    await userEvent.click(lengkapiIdpel)

    expect(await screen.findByText('Lengkapi IDPEL')).toBeInTheDocument()
    applicationApi.update.mockRejectedValueOnce(
      new Error('Pelanggan ini sudah memiliki IDPEL 514500123456; perubahan IDPEL dilakukan administrator lewat rekonsiliasi.')
    )

    const idpelInput = screen.getByPlaceholderText(/Contoh: 514500123456/i)
    await userEvent.type(idpelInput, '514500999999')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))

    expect(
      await screen.findByText(/Pelanggan ini sudah memiliki IDPEL 514500123456/i)
    ).toBeInTheDocument()
  })

  it('4. Ringkasan batch menampilkan OUT_OF_SCOPE bila > 0 dan tidak error bila tidak ada', async () => {
    // 1. With OUT_OF_SCOPE > 0
    applicationApi.uploadImport.mockResolvedValueOnce({
      data: {
        id: 'batch-oos-1',
        file_name: 'bot_daftung_test.csv',
        total_rows: 15,
        counts: { NEW: 10, MATCHED: 2, UNCHANGED: 0, REJECT: 0, OUT_OF_SCOPE: 3 },
      },
    })
    applicationApi.importBatchDetail.mockResolvedValueOnce({
      data: {
        id: 'batch-oos-1',
        file_name: 'bot_daftung_test.csv',
        total_rows: 15,
        counts: { NEW: 10, MATCHED: 2, UNCHANGED: 0, REJECT: 0, OUT_OF_SCOPE: 3 },
      },
      rows: [],
      meta: { current_page: 1, per_page: 100, total: 15, last_page: 1 },
    })

    const { unmount } = renderApp()

    await screen.findByText('APP-202611-0001')
    await userEvent.click(screen.getByRole('button', { name: /^Permohonan Baru$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /Via Upload \(Impor EIS\)/i }))

    const file = new File(['dummy,content'], 'bot_daftung_test.csv', { type: 'text/csv' })
    const fileInput = document.querySelector('input[type="file"]')
    await userEvent.upload(fileInput, file)
    await userEvent.click(screen.getByRole('button', { name: /Mulai Pratinjau Staging/i }))

    expect(
      await screen.findByText(/3 di luar cakupan/i)
    ).toBeInTheDocument()
    expect(screen.getByText(/Permohonan yang sudah terdaftar pada sistem tetap diperbarui/i)).toBeInTheDocument()
    unmount()

    // 2. Without OUT_OF_SCOPE
    applicationApi.uploadImport.mockResolvedValueOnce({
      data: {
        id: 'batch-oos-2',
        file_name: 'clean.csv',
        total_rows: 5,
        counts: { NEW: 5, MATCHED: 0, UNCHANGED: 0, REJECT: 0, OUT_OF_SCOPE: 0 },
      },
    })
    applicationApi.importBatchDetail.mockResolvedValueOnce({
      data: {
        id: 'batch-oos-2',
        file_name: 'clean.csv',
        total_rows: 5,
        counts: { NEW: 5, MATCHED: 0, UNCHANGED: 0, REJECT: 0, OUT_OF_SCOPE: 0 },
      },
      rows: [],
      meta: { current_page: 1, per_page: 100, total: 5, last_page: 1 },
    })

    renderApp()

    await screen.findByText('APP-202611-0001')
    await userEvent.click(screen.getByRole('button', { name: /^Permohonan Baru$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /Via Upload \(Impor EIS\)/i }))

    const file2 = new File(['dummy,content'], 'clean.csv', { type: 'text/csv' })
    const fileInput2 = document.querySelector('input[type="file"]')
    await userEvent.upload(fileInput2, file2)
    await userEvent.click(screen.getByRole('button', { name: /Mulai Pratinjau Staging/i }))

    await screen.findByText('clean.csv')
    expect(screen.queryByText(/tidak diimpor \(di luar cakupan 3 fasa\)/i)).not.toBeInTheDocument()
  })

  it('5. Permohonan Draf/Diajukan tanpa No. Agenda: tindakan survei dan usulan nonaktif dengan alasan; setelah No. Agenda dilengkapi menjadi aktif', async () => {
    renderApp()

    await screen.findByText('APP-202611-0001')

    // Checkbox on DRAFT row (APP-202611-0001) is disabled with reason
    const checkbox1 = screen.getByLabelText('Pilih permohonan APP-202611-0001')
    expect(checkbox1).toBeDisabled()
    expect(checkbox1).toHaveAttribute('title', 'Survei dan usulan dapat dimulai setelah No. Agenda terbit.')

    // In the detail page surveys tab, survey action is disabled
    applicationApi.get.mockResolvedValue({
      data: {
        ...sampleApps[0],
        external_references: [],
      },
    })
    const detailBtns = screen.getAllByTitle('Lihat Detail Permohonan')
    await userEvent.click(detailBtns[0])

    await screen.findByText('Permohonan APP-202611-0001')
    expect(screen.queryByRole('button', { name: /Survei & Pengukuran/i })).not.toBeInTheDocument()   // pratinjau hanya memuat ringkasan
    await userEvent.click(await screen.findByRole('button', { name: /Buka halaman lengkap/i }))
    const surveysTabBtn = await screen.findByRole('button', { name: /Survei & Pengukuran/i })
    await userEvent.click(surveysTabBtn)

    const startSurveyBtn = await screen.findByRole('button', { name: /Mulai Survei/ })
    expect(startSurveyBtn).toBeDisabled()
    expect(screen.getByText('Survei dan usulan dapat dimulai setelah No. Agenda terbit.')).toBeInTheDocument()
  })

  it('6. Pembuatan usulan menerima satu pelanggan; tanda "Bagian dari usulan" tampil dan menaut', async () => {
    const appsWithProposal = [
      {
        ...sampleApps[0],
        id: 'app-with-prop',
        status: 'APPROVED',
        agenda_number: '5145320261106001',
        proposal_number: 'USUL-202611-0001',
      },
      {
        ...sampleApps[1],
        id: 'app-approved-free',
        status: 'APPROVED',
        agenda_number: '5145320261106002',
        proposal_number: null,
      },
    ]

    applicationApi.list.mockResolvedValue({
      data: appsWithProposal,
      meta: { current_page: 1, per_page: 10, total: 2, last_page: 1 },
    })

    renderApp()

    // "Bagian dari usulan {nomor}" appears and links
    const linkBadge = await screen.findByTitle('Bagian dari usulan USUL-202611-0001')
    expect(linkBadge).toBeInTheDocument()
    expect(linkBadge.textContent).toContain('Bagian dari usulan USUL-202611-0001')
    expect(linkBadge).toHaveAttribute('href', '/usulan/USUL-202611-0001')

    // Eligible row has enabled checkbox
    const freeCheckbox = screen.getByLabelText('Pilih permohonan APP-202611-0002')
    expect(freeCheckbox).not.toBeDisabled()
    await userEvent.click(freeCheckbox)

    // Button "Buat usulan dari yang dipilih" appears
    const createPropBtn = screen.getByRole('button', { name: /Buat usulan dari yang dipilih/i })
    expect(createPropBtn).toBeInTheDocument()
    await userEvent.click(createPropBtn)

    // Proposal modal accepts single customer
    expect(await screen.findByText('Buat Usulan Perluasan')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Simpan Usulan Perluasan \(1\)/i })).toBeInTheDocument()
  })

  it('7. Tab Gambar Teknik menampilkan pesan baru bahwa paket gambar dibuat setelah hasil survei menyatakan memerlukan gambar (docs/62 §48)', async () => {
    applicationApi.get.mockResolvedValue({
      data: {
        ...sampleApps[0],
        surveys: [],
        drawing: null,
        survey: { status: 'ACCEPTED', outcome: 'EXTENSION' },
        proposal: { id: 'p', proposal_number: '00001/USULAN-PBPD/10-11/51453/2026', issued: true, members_count: 1, is_representative: true, representative_application_id: 'APP-1' },
      },
    })
    drawingApi.forApplication.mockResolvedValue({ data: null })

    renderApp('/permohonan/app-uuid-1')                                   // pekerjaan per tab ada di halaman permohonan

    expect(await screen.findByText('Permohonan APP-202611-0001')).toBeInTheDocument()

    const drawingTab = screen.getByRole('button', { name: /Gambar Teknik/i })
    await userEvent.click(drawingTab)

    expect(
      await screen.findByText(
        'Paket gambar dibuat setelah hasil survei menyatakan memerlukan gambar; unggah sebelum Manager ULP menyetujui survei.'
      )
    ).toBeInTheDocument()
  })

  it('8. Daftar permohonan menampilkan kolom lama hari layanan (N hari kerja / -) dan survei (nomor, status, hasil outcome) (docs/82 §3)', async () => {
    applicationApi.list.mockResolvedValueOnce({
      data: [
        {
          ...sampleApps[0],
          service_days: 12,
          service_days_observed_at: '2026-11-09',
          survey_number: 'SRV-202611-0001',
          survey_status: 'ACCEPTED',
          survey_outcome: 'NO_EXTENSION',
          ready_to_install: true,
        },
        {
          ...sampleApps[1],
          service_days: null,
          survey_number: 'SRV-202611-0002',
          survey_status: 'UNDER_REVIEW',
          survey_outcome: 'EXTENSION',
          ready_to_install: false,
        },
      ],
      meta: { current_page: 1, per_page: 20, total: 2 },
    })

    renderApp()

    // Check service days: 12 hari kerja and "-" for null
    expect(await screen.findByText('12 hari kerja')).toBeInTheDocument()
    // Check survey info
    expect(screen.getByText('SRV-202611-0001')).toBeInTheDocument()
    expect(screen.getByText('Tanpa perluasan')).toBeInTheDocument()
    expect(screen.getByText('Perlu perluasan')).toBeInTheDocument()
    // Check ready_to_install badge
    const badge = screen.getByTestId('ready-to-install-badge')
    expect(badge).toHaveTextContent('Siap pasang')
    expect(badge).toHaveAttribute('title', 'Survei tanpa perluasan telah diterima; status selanjutnya mengikuti data EIS')
  })

  it('9. Filter disederhanakan: tanpa tab Aktif/Riwayat dan tanpa Siap Pasang; UP3 menyaring ULP; bulan-tahun dikirim ke server', async () => {
    applicationApi.list.mockResolvedValue({ data: sampleApps, meta: { current_page: 1, per_page: 20, total: 2 } })
    renderApp()
    await screen.findByText('APP-202611-0001')

    expect(screen.queryByRole('button', { name: 'Aktif' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Riwayat' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Siap Pasang/i })).not.toBeInTheDocument()
    expect(applicationApi.list).toHaveBeenLastCalledWith(expect.not.objectContaining({ lifecycle: expect.anything() }))

    await userEvent.click(screen.getByLabelText('Filter Unit UP3'))
    await userEvent.click(await screen.findByRole('option', { name: /UP3 Nganjuk/ }))
    await waitFor(() => expect(applicationApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ up3_id: 'up1' })))

    await userEvent.click(screen.getByLabelText('Filter Unit ULP'))
    expect(screen.queryByRole('option', { name: /ULP Lain/ })).not.toBeInTheDocument()          // ULP milik UP3 lain tidak ditawarkan
    await userEvent.click(await screen.findByRole('option', { name: /ULP Jombang/ }))
    await waitFor(() => expect(applicationApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ up3_id: 'up1', unit_id: 'u1' })))

    fireEvent.change(screen.getByLabelText('Filter Bulan dan Tahun'), { target: { value: '2026-03' } })
    await waitFor(() => expect(applicationApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ month: '2026-03' })))
  })

  it('role non-global melihat UP3 dan ULP unitnya saja dan tidak bisa mengubahnya', async () => {
    applicationApi.units.mockResolvedValueOnce({ scope: 'ULP', up3_units: [{ id: 'up1', code: '51400', name: 'UP3 Nganjuk' }], ulp_units: [{ id: 'u1', code: '51453', name: 'ULP Jombang', parent_id: 'up1' }] })
    applicationApi.list.mockResolvedValue({ data: sampleApps, meta: { current_page: 1, per_page: 20, total: 2 } })
    renderApp()
    await screen.findByText('APP-202611-0001')
    await waitFor(() => expect(screen.getByLabelText('Filter Unit UP3')).toBeDisabled())
    expect(screen.getByLabelText('Filter Unit UP3')).toHaveValue('51400 - UP3 Nganjuk')
    expect(screen.getByLabelText('Filter Unit ULP')).toBeDisabled()
    expect(screen.getByLabelText('Filter Unit ULP')).toHaveValue('51453 - ULP Jombang')
  })

  it('tab Pelanggan Perlu Perhatian menampilkan yang terlama, memakai filter 3 fasa bawaan, dan bisa dipersempit ke usulan perluasan', async () => {
    applicationApi.list.mockResolvedValue({ data: sampleApps, meta: { current_page: 1, per_page: 20, total: 2 } })
    applicationApi.attention.mockResolvedValue({
      data: [{ id: 'a1', application_number: 'PBPD-1', status: 'PAID', days: 41, new_tariff_code: 'B2', new_power_value: 6600, new_power_unit: 'VA', proposal_number: 'USL-0001', service_address: 'JL A', customer: { name: 'PELANGGAN LAMA' }, unit: { code: '51453', name: 'ULP Jombang' } }],
      meta: { level: 'ULP', limit: 50, min_days: 5 },
    })
    renderApp()
    await screen.findByText('APP-202611-0001')
    await userEvent.click(screen.getByRole('tab', { name: 'Pelanggan Perlu Perhatian' }))
    expect(await screen.findByText('PELANGGAN LAMA')).toBeInTheDocument()
    expect(screen.getByText('41 hari')).toBeInTheDocument()
    expect(screen.getByText('USL-0001')).toBeInTheDocument()
    expect(screen.getByText(/lebih dari 4 hari, paling lama 50 data/)).toBeInTheDocument()
    expect(applicationApi.attention).toHaveBeenLastCalledWith({ three_phase: 1, extension: undefined })

    await userEvent.click(screen.getByRole('button', { name: 'Usulan perluasan saja' }))
    await waitFor(() => expect(applicationApi.attention).toHaveBeenLastCalledWith({ three_phase: 1, extension: 1 }))
    await userEvent.click(screen.getByRole('button', { name: 'Hanya 3 fasa' }))
    await waitFor(() => expect(applicationApi.attention).toHaveBeenLastCalledWith({ three_phase: 0, extension: 1 }))
  })

  it('riwayat sinkronisasi EIS punya tab sendiri di halaman PB/PD', async () => {
    mockCan = { ...mockCan, 'eis_sync.manage': true }
    applicationApi.list.mockResolvedValue({ data: sampleApps, meta: { current_page: 1, per_page: 20, total: 2 } })
    eisSyncApi.show.mockResolvedValueOnce({ data: { settings: { lookback_days: 180 }, runs: [{ id: 'r1', status: 'OK', trigger: 'MANUAL', created_at: '2026-11-16T14:00:00Z', range_from: '2026-01-01', range_to: '2026-03-31', units: ['51453'], started_by: 'admin@distriva.com' }] } })
    renderApp()
    await screen.findByText('APP-202611-0001')
    await userEvent.click(screen.getByRole('tab', { name: 'Riwayat Sinkronisasi EIS' }))
    expect(await screen.findByText('2026-01-01 s/d 2026-03-31')).toBeInTheDocument()
    expect(screen.getByText('Selesai')).toBeInTheDocument()
    expect(screen.queryByLabelText('Filter Tipe Permohonan')).not.toBeInTheDocument()
  })

  it('10. Detail permohonan menampilkan rincian lama hari layanan per tanggal dan ringkasan survei (docs/82 §3)', async () => {
    applicationApi.list.mockResolvedValueOnce({
      data: [sampleApps[0]],
      meta: { current_page: 1, per_page: 20, total: 1 },
    })
    applicationApi.get.mockResolvedValueOnce({
      data: {
        ...sampleApps[0],
        service_days: 7,
        service_days_observed_at: '2026-11-08',
        ready_to_install: true,
        survey: {
          survey_number: 'SRV-202611-0009',
          status: 'ACCEPTED',
          outcome: 'NO_EXTENSION',
          accepted_at: '2026-11-08 14:00',
          ready_to_install: true,
        },
      },
    })

    renderApp()

    await screen.findByText('APP-202611-0001')
    const detailBtn = screen.getByTitle('Lihat Detail Permohonan')
    await userEvent.click(detailBtn)

    expect(await screen.findByText(/7 hari kerja/)).toBeInTheDocument()
    expect(screen.getByText(/\(per 2026-11-08\)/)).toBeInTheDocument()
    expect(screen.getByText('SRV-202611-0009')).toBeInTheDocument()
    expect(screen.getByText(/Survei tanpa perluasan telah diterima; status selanjutnya mengikuti data EIS/i)).toBeInTheDocument()
  })

  it('11. Ringkasan impor menampilkan rincian OUT_OF_SCOPE_STATUS dan OUT_OF_SCOPE_POWER bila bernilai; pratinjau perubahan baris MATCHED menampilkan Lama hari kerja (docs/82 §3)', async () => {
    applicationApi.list.mockResolvedValueOnce({
      data: sampleApps,
      meta: { current_page: 1, per_page: 20, total: 2 },
    })
    applicationApi.uploadImport.mockResolvedValueOnce({
      data: {
        id: 'batch-oos-detail',
        file_name: 'test_breakdown.csv',
        total_rows: 10,
        counts: {
          NEW: 4,
          MATCHED: 2,
          UNCHANGED: 0,
          REJECT: 0,
          OUT_OF_SCOPE: 4,
          OUT_OF_SCOPE_STATUS: 3,
          OUT_OF_SCOPE_POWER: 1,
        },
      },
    })
    applicationApi.importBatchDetail.mockResolvedValueOnce({
      data: {
        id: 'batch-oos-detail',
        file_name: 'test_breakdown.csv',
        total_rows: 10,
        counts: {
          NEW: 4,
          MATCHED: 2,
          UNCHANGED: 0,
          REJECT: 0,
          OUT_OF_SCOPE: 4,
          OUT_OF_SCOPE_STATUS: 3,
          OUT_OF_SCOPE_POWER: 1,
        },
      },
      rows: [
        {
          action: 'MATCHED',
          registration_number: 'APP-MATCH-1',
          customer_name: 'PT Maju Bersama',
          changes: {
            service_days: { from: 10, to: 15 },
          },
        },
      ],
      meta: { current_page: 1, per_page: 100, total: 10, last_page: 1 },
    })

    renderApp()

    await screen.findByText('APP-202611-0001')
    await userEvent.click(screen.getByRole('button', { name: /^Permohonan Baru$/i }))
    await userEvent.click(await screen.findByRole('button', { name: /Via Upload \(Impor EIS\)/i }))

    const file = new File(['dummy'], 'test_breakdown.csv', { type: 'text/csv' })
    const fileInput = document.querySelector('input[type="file"]')
    await userEvent.upload(fileInput, file)
    await userEvent.click(screen.getByRole('button', { name: /Mulai Pratinjau Staging/i }))

    // Breakdown list appears
    expect(await screen.findByText(/3 status baru belum Bayar\/Cetak PK/i)).toBeInTheDocument()
    expect(screen.getByText(/1 daya di bawah batas/i)).toBeInTheDocument()

    // MATCHED change shows "Lama hari kerja: 10 → 15"
    expect(screen.getByText('Lama hari kerja:')).toBeInTheDocument()
    expect(screen.getByText('15')).toBeInTheDocument()
  })
})
