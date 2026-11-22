import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import ProposalsPage from './ProposalsPage.jsx'
import ProposalDetailPage from './ProposalDetailPage.jsx'
import ApplicationsPage, { ApplicationDetailDrawer } from '../applications/ApplicationsPage.jsx'
import { proposalsApi, applicationApi, surveyApi, drawingApi, documentApi, allocationsApi, unitScopeApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  unitScopeApi: { get: vi.fn() },
  proposalsApi: {
    selectable: vi.fn(),
    list: vi.fn(),
    create: vi.fn(),
    get: vi.fn(),
    addMembers: vi.fn(),
    removeMember: vi.fn(),
    cancel: vi.fn(),
    kkfRuns: vi.fn(),
    runKkf: vi.fn(),
  },
  applicationApi: {
    access: vi.fn(),
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    submit: vi.fn(),
    cancel: vi.fn(),
    addReference: vi.fn(),
    importBatches: vi.fn(),
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
  documentApi: {
    listForApplication: vi.fn(),
  },
  kkfRunsApi: {
    preview: vi.fn().mockResolvedValue({
      data: { ready: true, rab_run: { id: 'rab-1', run_number: 1 }, blockers: [] },
    }),
  },
  mtoApi: {
    forVersion: vi.fn().mockResolvedValue({ data: null }),
  },
  rabRunsApi: {
    listForPackage: vi.fn().mockResolvedValue({ data: [] }),
    run: vi.fn(),
  },
  allocationsApi: { listForApplication: vi.fn().mockResolvedValue({ data: [] }), get: vi.fn() },
  warehousesApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
  poleContractsApi: { list: vi.fn().mockResolvedValue({ data: [] }) },
  triggerFileDownload: vi.fn(),
}))

function renderWithProviders(ui, { can = {}, isSysAdmin = false, user = { id: 'u-1', email: 'teknik@pln.co.id', name: 'Petugas PLN' } } = {}) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user, status: 'authenticated' }}>
        <AccessContext.Provider
          value={{
            can,
            isSysAdmin,
            createUnits: [{ id: 'unit-ulp-1', code: '51543', name: 'ULP Mojokerto Kota' }],
            loading: false,
          }}
        >
          <NotificationProvider>
            {ui}
          </NotificationProvider>
        </AccessContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

describe('Proposals Workflow - Usulan Banyak Pelanggan 3 Fasa (docs/62 §37, docs/76 & docs/57)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    applicationApi.access.mockResolvedValue({
      can: { 'applications.view': true, 'proposals.view': true, 'proposals.manage': true },
      create_units: [{ id: 'unit-ulp-1', code: '51543', name: 'ULP Mojokerto Kota' }],
    })
    applicationApi.list.mockResolvedValue({ data: [], meta: { current_page: 1, last_page: 1, total: 0 } })
    surveyApi.access.mockResolvedValue({ can: {} })
    drawingApi.access.mockResolvedValue({ can: {} })
    surveyApi.listForApplication.mockResolvedValue({ data: [] })
    drawingApi.forApplication.mockResolvedValue({ data: null })
    documentApi.listForApplication.mockResolvedValue({ data: [] })
  })

  const mockSelectableCustomers = [
    {
      id: 'app-101',
      application_number: 'PBPD-202611-0001',
      application_type: 'PB',
      customer_name: 'PT Surya Gemilang Industri',
      idpel: '515430001111',
      new_tariff_code: 'I2',
      new_power_value: 33000,
      new_power_unit: 'VA',
      service_address: 'Kawasan Industri Ngoro Blok A1',
      ulp_code: '51543',
      ulp_name: 'ULP Mojokerto Kota',
    },
    {
      id: 'app-102',
      application_number: 'PBPD-202611-0002',
      application_type: 'PD',
      customer_name: 'CV Maju Lancar Sentosa',
      idpel: '515430002222',
      new_tariff_code: 'B2',
      new_power_value: 16500,
      new_power_unit: 'VA',
      service_address: 'Kawasan Industri Ngoro Blok A2',
      ulp_code: '51543',
      ulp_name: 'ULP Mojokerto Kota',
    },
    {
      id: 'app-103',
      application_number: 'PBPD-202611-0003',
      application_type: 'PB',
      customer_name: 'PT Prima Logam Nusantara',
      idpel: '515430003333',
      new_tariff_code: 'I3',
      new_power_value: 66000,
      new_power_unit: 'VA',
      service_address: 'Kawasan Industri Ngoro Blok B5',
      ulp_code: '51543',
      ulp_name: 'ULP Mojokerto Kota',
    },
  ]

  const mockProposalsList = [
    {
      id: 'prop-1',
      proposal_number: 'USL/U-51543/202611/0001',
      title: 'Perluasan JTM Kawasan Industri Ngoro',
      status: 'OPEN',
      ulp_name: 'ULP Mojokerto Kota',
      representative_application_id: 'app-101',
      representative_number: 'PBPD-202611-0001',
      created_at: '2026-11-07 10:00:00',
      members_count: 2,
    },
  ]

  const mockProposalDetail = {
    id: 'prop-1',
    proposal_number: 'USL/U-51543/202611/0001',
    title: 'Perluasan JTM Kawasan Industri Ngoro',
    status: 'OPEN',
    cancel_reason: null,
    ulp_unit_id: 'unit-ulp-1',
    representative_application_id: 'app-101',
    members: [
      {
        application_id: 'app-101',
        application_number: 'PBPD-202611-0001',
        application_type: 'PB',
        status: 'APPROVED',
        customer_name: 'PT Surya Gemilang Industri',
        idpel: '515430001111',
        tariff: 'I2',
        power: 33000,
        power_unit: 'VA',
        delta_power_kva: 33,
        total_cost: 31000000,
        sar_package: 'Pascabayar',
        is_representative: true,
      },
      {
        application_id: 'app-102',
        application_number: 'PBPD-202611-0002',
        application_type: 'PD',
        status: 'APPROVED',
        customer_name: 'CV Maju Lancar Sentosa',
        idpel: '515430002222',
        tariff: 'B2',
        power: 16500,
        power_unit: 'VA',
        delta_power_kva: 11,
        total_cost: 12500000,
        sar_package: 'Pascabayar',
        is_representative: false,
      },
    ],
    events: [
      {
        event_type: 'CREATED',
        reason: null,
        details: null,
        occurred_at: '2026-11-07 10:00:00',
        actor_name: 'Petugas PLN',
      },
    ],
  }

  const mockProposalKkfResult = {
    application_id: 'app-101',
    proposal_id: 'prop-1',
    valid_on: '2026-11-07',
    feasible: true,
    extended_required: false,
    snapshot_hash: 'abcdef1234567890abcdef1234567890',
    inputs: {
      investment: 85000000,
      connection_fee: 43500000,
      esthetic_fee: 0,
      power_kva: 44,
      jam_nyala: 260.5,
      avg_price: 1450.25,
      discount_rate: 0.0778,
      payback_limit_months: 60,
    },
    sources: {
      ujl_total: 3500000,
      members: [
        {
          application_id: 'app-101',
          application_number: 'PBPD-202611-0001',
          customer_name: 'PT Surya Gemilang Industri',
          idpel: '515430001111',
          tariff_code: 'I2',
          power_va: 33000,
          delta_kva: 33,
          jam_nyala: 280,
          avg_price: 1467,
          total_cost: 31000000,
          fee: 31000000,
          mode: 'PASCABAYAR',
        },
        {
          application_id: 'app-102',
          application_number: 'PBPD-202611-0002',
          customer_name: 'CV Maju Lancar Sentosa',
          idpel: '515430002222',
          tariff_code: 'B2',
          power_va: 16500,
          delta_kva: 11,
          jam_nyala: 202,
          avg_price: 1400,
          total_cost: 12500000,
          fee: 12500000,
          mode: 'PASCABAYAR',
        },
      ],
    },
    result: {
      feasible: true,
      npv: 124500000,
      irr_percent: 18.45,
      payback_months: 28,
      bp_ratio: 0.51,
      payback: { text: '2 Tahun 4 Bulan' },
    },
  }

  it('filter UP3 dan ULP di daftar usulan mengirim up3_id dan unit_id ke server', async () => {
    unitScopeApi.get.mockResolvedValue({
      scope: 'GLOBAL',
      up3_units: [{ id: 'up3-1', code: 'UP3-A', name: 'UP3 Satu' }, { id: 'up3-2', code: 'UP3-B', name: 'UP3 Dua' }],
      ulp_units: [{ id: 'ulp-1', code: 'ULP-A', name: 'ULP Satu', parent_id: 'up3-1' }, { id: 'ulp-2', code: 'ULP-B', name: 'ULP Dua', parent_id: 'up3-2' }],
    })
    proposalsApi.list.mockResolvedValue({ data: mockProposalsList })
    renderWithProviders(<ProposalsPage />, { can: { 'proposals.view': true } })
    await screen.findByText('USL/U-51543/202611/0001')

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter Unit UP3' }))
    await userEvent.click(await screen.findByRole('option', { name: /UP3 Dua/ }))
    await waitFor(() => expect(proposalsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ issued: 1, up3_id: 'up3-2' })))

    await userEvent.click(screen.getByRole('combobox', { name: 'Filter Unit ULP' }))
    expect(screen.queryByRole('option', { name: /ULP Satu/ })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('option', { name: /ULP Dua/ }))
    await waitFor(() => expect(proposalsApi.list).toHaveBeenLastCalledWith(expect.objectContaining({ up3_id: 'up3-2', unit_id: 'ulp-2' })))
  })

  it('1. tabel pilihan tidak menampilkan data pelanggan sebelum tombol Buat Usulan diklik', async () => {
    proposalsApi.list.mockResolvedValue({ data: mockProposalsList })
    proposalsApi.selectable.mockResolvedValue({ data: mockSelectableCustomers })

    renderWithProviders(<ProposalsPage />, {
      can: { 'proposals.view': true, 'proposals.manage': true },
    })

    await waitFor(() => {
      expect(screen.getByText('USL/U-51543/202611/0001')).toBeInTheDocument()
    })

    // Memastikan daftar usulan tampil, tetapi TABEL PILIHAN PELANGGAN BELUM TAMPIL
    expect(screen.queryByText('Pilihan Khusus Pelanggan 3 Fasa')).not.toBeInTheDocument()
    expect(screen.queryByText('PT Surya Gemilang Industri')).not.toBeInTheDocument()

    // proposalsApi.selectable tidak boleh dipanggil sebelum tombol Buat Usulan ditekan
    expect(proposalsApi.selectable).not.toHaveBeenCalled()
  })

  it('2. pencarian dan pemilihan pelanggan 3 fasa (≥ 6600 VA) setelah mulai membuat usulan', async () => {
    const user = userEvent.setup()
    proposalsApi.list.mockResolvedValue({ data: [] })
    proposalsApi.selectable.mockResolvedValue({
      data: mockSelectableCustomers,
      meta: { current_page: 1, last_page: 1, total: 3 },
      min_power_va: 6600,
    })

    renderWithProviders(<ProposalsPage />, {
      can: { 'proposals.view': true, 'proposals.manage': true },
    })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Buat Usulan Baru/i })).toBeInTheDocument()
    })

    // Klik tombol "Buat Usulan Baru"
    await user.click(screen.getByRole('button', { name: /Buat Usulan Baru/i }))

    // Layar pemilihan muncul dan tabel pelanggan dimuat dari GET /proposals/selectable
    await waitFor(() => {
      expect(proposalsApi.selectable).toHaveBeenCalled()
      expect(screen.getByText('PT Surya Gemilang Industri')).toBeInTheDocument()
    })

    expect(screen.getByText('CV Maju Lancar Sentosa')).toBeInTheDocument()
    expect(screen.getByText('PT Prima Logam Nusantara')).toBeInTheDocument()

    // Lakukan pencarian nama pelanggan
    const searchInput = screen.getByPlaceholderText(/Cari nama pelanggan, IDPEL, nomor permohonan/i)
    await user.type(searchInput, 'Surya')

    await waitFor(() => {
      expect(proposalsApi.selectable).toHaveBeenCalledWith(
        expect.objectContaining({ q: 'Surya' })
      )
    })
  })

  it('3. urutan pelanggan dan penentuan pelanggan utama (perwakilan) sebelum menyimpan usulan', async () => {
    const user = userEvent.setup()
    proposalsApi.list.mockResolvedValue({ data: [] })
    proposalsApi.selectable.mockResolvedValue({
      data: mockSelectableCustomers,
      meta: { current_page: 1, last_page: 1, total: 3 },
      min_power_va: 6600,
    })
    proposalsApi.create.mockResolvedValue({ data: { id: 'prop-new-101' } })

    renderWithProviders(<ProposalsPage />, {
      can: { 'proposals.view': true, 'proposals.manage': true },
    })

    await user.click(await screen.findByRole('button', { name: /Buat Usulan Baru/i }))

    await waitFor(() => {
      expect(screen.getByText('PT Surya Gemilang Industri')).toBeInTheDocument()
    })

    // Pilih pelanggan pertama (Customer A: Surya)
    const checkboxes = screen.getAllByRole('checkbox')
    await user.click(checkboxes[0])

    // Pelanggan pertama ditandai sebagai Pelanggan Utama (Perwakilan)
    await waitFor(() => {
      expect(screen.getAllByText('Pelanggan Utama (Perwakilan)').length).toBeGreaterThan(0)
    })

    // Pilih pelanggan kedua (Customer B: Maju Lancar)
    await user.click(checkboxes[1])

    // Ganti urutan: jadikan Maju Lancar sebagai Pelanggan Utama
    const makeRepBtn = screen.getByRole('button', { name: /Jadikan Utama/i })
    await user.click(makeRepBtn)

    // Isi judul usulan
    const titleInput = screen.getByLabelText(/Judul Usulan/i)
    await user.type(titleInput, 'Usulan Kawasan Ngoro Baru')

    // Klik Simpan Usulan
    const submitBtn = screen.getByRole('button', { name: /Simpan Usulan \(2\)/i })
    await user.click(submitBtn)

    // Memastikan perwakilan baru (Customer B: app-102) dikirim di indeks 0
    expect(proposalsApi.create).toHaveBeenCalledWith({
      application_ids: ['app-102', 'app-101'],
      title: 'Usulan Kawasan Ngoro Baru',
    })
  })

  it('4b. tombol Batalkan nonaktif dengan alasan saat WO terbit; peringatan KKF basi muncul di dialog keluarkan anggota; daftar anggota tidak dikunci', async () => {
    const user = userEvent.setup()
    proposalsApi.get.mockResolvedValue({ data: { ...mockProposalDetail, cancel_blocked_reason: 'WO usulan ini sudah diterbitkan; batalkan WO terlebih dahulu.', kkf_runs_count: 2 } })
    renderWithProviders(
      <ProposalDetailPage proposalId="prop-1" onBack={vi.fn()} />,
      { can: { 'proposals.view': true, 'proposals.manage': true } }
    )
    await waitFor(() => expect(screen.getByText('USL/U-51543/202611/0001')).toBeInTheDocument())

    const cancelBtn = screen.getByRole('button', { name: /Batalkan Usulan/i })
    expect(cancelBtn).toBeDisabled()
    expect(cancelBtn).toHaveAttribute('title', expect.stringMatching(/batalkan WO terlebih dahulu/i))

    // anggota tetap bisa ditambah/dikeluarkan (tidak dikunci), tetapi dengan peringatan KKF
    expect(screen.getByRole('button', { name: /Tambah Anggota/i })).toBeEnabled()
    await user.click(screen.getByRole('button', { name: /Keluarkan/i }))
    expect(await screen.findByText(/2 run KKF tersimpan/i)).toBeInTheDocument()
  })

  it('4c. paket gambar diambil sekali per halaman (rantai, riwayat, tab Gambar berbagi data) dan tidak diulang saat pindah tab', async () => {
    const user = userEvent.setup()
    proposalsApi.get.mockResolvedValue({ data: mockProposalDetail })
    drawingApi.forApplication.mockResolvedValue({ data: { id: 'drw-1' } })
    drawingApi.get.mockResolvedValue({ data: { id: 'drw-1', can: {}, versions: [{ id: 'v1', version_number: 1, status: 'SUBMITTED', stage: 'ULP_MANAGER', decisions: [], documents: [] }] } })
    renderWithProviders(
      <ProposalDetailPage proposalId="prop-1" onBack={vi.fn()} />,
      { can: { 'proposals.view': true, 'proposals.manage': true } }
    )
    await waitFor(() => expect(screen.getByText('USL/U-51543/202611/0001')).toBeInTheDocument())
    await screen.findByText(/Rantai Persetujuan Versi 1/i)

    await user.click(screen.getByRole('button', { name: /Riwayat & Keputusan/i }))
    await user.click(screen.getByRole('button', { name: /Gambar & Lampiran/i }))
    await user.click(screen.getByRole('button', { name: /Riwayat & Keputusan/i }))
    expect(drawingApi.forApplication).toHaveBeenCalledTimes(1)
  })

  it('4d. tab Alokasi Material ada di halaman usulan: dibuat di sini, dengan peringatan bila MTO belum disetujui', async () => {
    const user = userEvent.setup()
    proposalsApi.get.mockResolvedValue({ data: mockProposalDetail })
    renderWithProviders(
      <ProposalDetailPage proposalId="prop-1" onBack={vi.fn()} />,
      { can: { 'proposals.view': true, 'allocations.view': true, 'allocations.manage': true } }
    )
    await waitFor(() => expect(screen.getByText('USL/U-51543/202611/0001')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Alokasi Material/i }))
    expect(await screen.findByText(/Alokasi material memakai MTO usulan yang sudah disetujui/i)).toBeInTheDocument()
    expect(allocationsApi.listForApplication).toHaveBeenCalledWith('app-101')
    // peran material boleh membuka alokasi, tetapi tombolnya terkunci sampai MTO disetujui
    const create = await screen.findByRole('button', { name: /Buat Alokasi Material/i })
    expect(create).toBeDisabled()
    expect(create).toHaveAttribute('title', expect.stringMatching(/MTO usulan belum disetujui/i))
  })

  it('4f. peran Perencanaan (tiang) boleh membuka alokasi lewat tombol Buat Alokasi, tetapi terkunci sampai MTO disetujui', async () => {
    const user = userEvent.setup()
    proposalsApi.get.mockResolvedValue({ data: mockProposalDetail })
    renderWithProviders(<ProposalDetailPage proposalId="prop-1" onBack={vi.fn()} />, { can: { 'proposals.view': true, 'allocations.view': true, 'allocations.poles': true } })
    await waitFor(() => expect(screen.getByText('USL/U-51543/202611/0001')).toBeInTheDocument())
    await user.click(screen.getByRole('button', { name: /Alokasi Material/i }))
    const create = await screen.findByRole('button', { name: /^Buat Alokasi$/i })
    expect(create).toBeDisabled()
    expect(screen.queryByRole('button', { name: /Buat Alokasi Material/i })).not.toBeInTheDocument()
  })

  it('4e. tab Alokasi Material tidak muncul tanpa hak lihat alokasi', async () => {
    proposalsApi.get.mockResolvedValue({ data: mockProposalDetail })
    renderWithProviders(<ProposalDetailPage proposalId="prop-1" onBack={vi.fn()} />, { can: { 'proposals.view': true } })
    await waitFor(() => expect(screen.getByText('USL/U-51543/202611/0001')).toBeInTheDocument())
    expect(screen.queryByRole('button', { name: /Alokasi Material/i })).not.toBeInTheDocument()
  })

  it('4. detail usulan: daftar anggota, tambah anggota, keluarkan anggota (perwakilan ditolak), dan batalkan usulan', async () => {
    const user = userEvent.setup()
    proposalsApi.get.mockResolvedValue({ data: mockProposalDetail })
    proposalsApi.removeMember.mockResolvedValue({ message: 'Pelanggan dikeluarkan dari usulan.' })
    proposalsApi.cancel.mockResolvedValue({ message: 'Usulan dibatalkan.' })

    renderWithProviders(
      <ProposalDetailPage proposalId="prop-1" onBack={vi.fn()} />,
      { can: { 'proposals.view': true, 'proposals.manage': true } }
    )

    await waitFor(() => {
      expect(screen.getByText('USL/U-51543/202611/0001')).toBeInTheDocument()
    })

    // Cek daftar anggota
    expect(screen.getAllByText('PT Surya Gemilang Industri').length).toBeGreaterThan(0)
    expect(screen.getAllByText('CV Maju Lancar Sentosa').length).toBeGreaterThan(0)

    // Perwakilan memiliki penanda terkunci dan tidak dapat dikeluarkan
    expect(screen.getByText('Perwakilan (Terkunci)')).toBeInTheDocument()

    // Keluarkan anggota non-perwakilan (CV Maju Lancar)
    const removeBtn = screen.getByRole('button', { name: /Keluarkan/i })
    await user.click(removeBtn)

    // Dialog alasan wajib muncul
    await waitFor(() => {
      expect(screen.getByText(/Keluarkan Pelanggan dari Usulan/i)).toBeInTheDocument()
    })

    const reasonInput = screen.getByLabelText(/Alasan/i)
    await user.type(reasonInput, 'Pelanggan membatalkan permohonan secara mandiri.')

    await user.click(screen.getByRole('button', { name: /Keluarkan dari Usulan/i }))

    expect(proposalsApi.removeMember).toHaveBeenCalledWith(
      'prop-1',
      'app-102',
      { reason: 'Pelanggan membatalkan permohonan secara mandiri.' }
    )

    // Batalkan usulan dengan alasan audit
    const cancelPropBtn = screen.getByRole('button', { name: /Batalkan Usulan/i })
    await user.click(cancelPropBtn)

    await waitFor(() => {
      expect(screen.getByText(/Batalkan Usulan USL\/U-51543\/202611\/0001/i)).toBeInTheDocument()
    })

    const cancelReasonInput = screen.getByLabelText(/Alasan/i)
    await user.type(cancelReasonInput, 'Perubahan rencana jaringan dari PLN UP3.')

    await user.click(screen.getByRole('button', { name: /Batalkan Usulan Ini/i }))

    expect(proposalsApi.cancel).toHaveBeenCalledWith(
      'prop-1',
      { reason: 'Perubahan rencana jaringan dari PLN UP3.' }
    )
  })

  it('5b. drawer permohonan: tab Alokasi Material hanya pratinjau (tanpa tombol buat) dan mengarahkan ke halaman usulan', async () => {
    const user = userEvent.setup()
    applicationApi.get.mockResolvedValue({
      data: {
        id: 'app-101', application_number: 'PBPD-202611-0001', application_type: 'PB', transaction_type: 'PASANG BARU', status: 'APPROVED',
        service_address: 'Ngoro', customer: { name: 'PT Surya', idpel: [] }, unit: { id: 'unit-ulp-1', code: '51543', name: 'ULP' }, status_history: [],
        survey: { status: 'ACCEPTED', outcome: 'EXTENSION' },
        proposal: { id: 'prop-1', proposal_number: 'USL/U-51543/202611/0001', issued: true, members_count: 2, is_representative: true, representative_application_id: 'app-101' },
      },
    })
    renderWithProviders(
      <ApplicationDetailDrawer
        applicationId="app-101"
        canViewSurvey={true}
        canViewAllocations={true}
        canManageAllocations={true}
        canManageMaterials={true}
        canManagePoles={true}
        onClose={vi.fn()}
      />,
      { can: { 'allocations.view': true, 'allocations.manage': true } }
    )
    await user.click(await screen.findByRole('button', { name: /Alokasi Material/i }))
    expect(await screen.findByText(/Ini hanya pratinjau\. Alokasi material/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Buka Alokasi di Usulan/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Buat Alokasi/i })).not.toBeInTheDocument()
  })

  it('5. menampilkan banner usulan pada tahap lanjutan permohonan perwakilan dan menonaktifkan aksi pada non-perwakilan', async () => {
    const user = userEvent.setup()
    proposalsApi.list.mockResolvedValue({ data: mockProposalsList })
    proposalsApi.get.mockResolvedValue({ data: mockProposalDetail })

    // Skenario A: Membuka permohonan perwakilan (app-101)
    applicationApi.get.mockResolvedValue({
      data: {
        id: 'app-101',
        application_number: 'PBPD-202611-0001',
        application_type: 'PB',
        transaction_type: 'PASANG BARU',
        status: 'APPROVED',
        service_address: 'Kawasan Industri Ngoro',
        customer: { name: 'PT Surya Gemilang Industri', idpel: [] },
        unit: { id: 'unit-ulp-1', code: '51543', name: 'ULP Mojokerto Kota' },
        status_history: [],
        survey: { status: 'ACCEPTED', outcome: 'EXTENSION' },
        proposal: { id: 'prop-1', proposal_number: 'USL/U-51543/202611/0001', issued: true, members_count: 2, is_representative: true, representative_application_id: 'app-101' },
      },
    })

    const { unmount } = renderWithProviders(
      <ApplicationDetailDrawer
        applicationId="app-101"
        canViewSurvey={true}
        canAssignSurvey={true}
        onClose={vi.fn()}
      />,
      { can: { 'surveys.assign': true } }
    )

    // Banner perwakilan tampil
    await waitFor(() => {
      expect(screen.getByText(/Usulan USL\/U-51543\/202611\/0001: 2 pelanggan/i)).toBeInTheDocument()
    })
    expect(screen.getAllByText(/Pelanggan Utama/i).length).toBeGreaterThan(0)
    unmount()

    // Skenario B: Membuka permohonan non-perwakilan (app-102)
    applicationApi.get.mockResolvedValue({
      data: {
        id: 'app-102',
        application_number: 'PBPD-202611-0002',
        application_type: 'PD',
        transaction_type: 'PERUBAHAN DAYA',
        status: 'APPROVED',
        service_address: 'Kawasan Industri Ngoro',
        customer: { name: 'CV Maju Lancar Sentosa', idpel: [] },
        unit: { id: 'unit-ulp-1', code: '51543', name: 'ULP Mojokerto Kota' },
        status_history: [],
        survey: { status: 'ACCEPTED', outcome: 'EXTENSION' },
        proposal: { id: 'prop-1', proposal_number: 'USL/U-51543/202611/0001', issued: true, members_count: 2, is_representative: false, representative_application_id: 'app-101' },
      },
    })

    renderWithProviders(
      <ApplicationDetailDrawer
        applicationId="app-102"
        canViewSurvey={true}
        canAssignSurvey={true}
        onClose={vi.fn()}
      />,
      { can: { 'surveys.assign': true } }
    )

    // Alert banner non-perwakilan tampil
    await waitFor(() => {
      expect(screen.getByText(/Anggota Non-Perwakilan/i)).toBeInTheDocument()
    })
    expect(screen.getAllByText(/Pelanggan ini bagian dari usulan USL\/U-51543\/202611\/0001/i).length).toBeGreaterThan(0)

    // Pindah ke tab survei
    await user.click(screen.getByRole('button', { name: /Survei & Pengukuran/i }))

    // Tombol "+ Tugaskan Survei" sudah dihapus (Teknik ULP memulai sendiri); non-perwakilan hanya melihat peringatan
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: /\+ Tugaskan Survei/i })).not.toBeInTheDocument()
    })
    expect(screen.getAllByText(/Pelanggan ini bagian dari usulan USL\/U-51543\/202611\/0001; survey, gambar, MTO, RAB, WO dan BASTP dikerjakan lewat pelanggan utama usulan/i).length).toBeGreaterThan(0)
  })

  it('6. panel KKF usulan: hitung dry run, rincian per anggota dari sources.members[], dan riwayat run', async () => {
    const user = userEvent.setup()
    proposalsApi.get.mockResolvedValue({ data: mockProposalDetail })
    proposalsApi.kkfRuns.mockResolvedValue({
      data: [
        {
          id: 'kkf-run-101',
          document_number: '0001/KKF/51543/2026',
          run_number: 1,
          valid_on: '2026-11-07',
          feasible: true,
          extended_required: false,
          npv: 124500000,
          irr_percent: 18.45,
          payback_months: 28,
          created_by_name: 'Petugas PLN',
        },
      ],
    })
    proposalsApi.runKkf.mockResolvedValue({ data: mockProposalKkfResult })

    renderWithProviders(
      <ProposalDetailPage proposalId="prop-1" onBack={vi.fn()} />,
      { can: { 'proposals.view': true, 'proposals.manage': true, 'kkf.run': true, 'kkf.view': true } }
    )

    await waitFor(() => {
      expect(screen.getByText('USL/U-51543/202611/0001')).toBeInTheDocument()
    })

    // Buka tab KKF Usulan
    await user.click(screen.getByRole('button', { name: /Kelayakan Finansial \(KKF Usulan\)/i }))

    await waitFor(() => {
      expect(screen.getByText(/Simulasi & Hitung KKF Usulan Kelompok/i)).toBeInTheDocument()
    })

    // Klik tombol Hitung (Dry Run)
    const dryRunBtn = screen.getByRole('button', { name: /Hitung \(Dry Run\)/i })
    await user.click(dryRunBtn)

    expect(proposalsApi.runKkf).toHaveBeenCalledWith('prop-1', expect.objectContaining({
      dry_run: true,
    }))

    // Hasil kalkulasi tampil: metrik finansial gabungan
    await waitFor(() => {
      expect(screen.getByText('Hasil Perhitungan KKF Usulan')).toBeInTheDocument()
    })

    // Rincian per anggota dari sources.members[] tampil
    expect(screen.getByText('Rincian Perhitungan Per Anggota Usulan (2)')).toBeInTheDocument()
    expect(screen.getAllByText('PT Surya Gemilang Industri').length).toBeGreaterThan(0)
    expect(screen.getAllByText('CV Maju Lancar Sentosa').length).toBeGreaterThan(0)

    // Riwayat run KKF menampilkan run tersimpan
    expect(screen.getByText('0001/KKF/51543/2026')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^KKF$/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^HPE$/i })).toBeInTheDocument()
  })

  it('7. status COMPLETED_NO_EXTENSION: lencana hijau "Selesai tanpa perluasan", filter status, dan tanpa tombol ubah/batalkan', async () => {
    const mockCompletedProposal = {
      id: 'prop-completed',
      proposal_number: 'USL/U-51543/202611/0099',
      title: 'Usulan Penyambungan Kawasan Industri Lama',
      status: 'COMPLETED_NO_EXTENSION',
      ulp_code: '51543',
      ulp_name: 'ULP Mojokerto Kota',
      representative_number: 'PBPD-202611-0001',
      representative_application_id: 'app-101',
      members_count: 2,
      created_at: '2026-11-08T08:00:00Z',
      members: [
        {
          application_id: 'app-101',
          application_number: 'PBPD-202611-0001',
          customer_name: 'PT Surya Gemilang Industri',
          is_representative: true,
          tariff: 'I2',
          power: 33000,
          status: 'APPROVED',
        },
      ],
    }

    // List view test
    proposalsApi.list.mockResolvedValue({ data: [mockCompletedProposal] })

    const { unmount } = renderWithProviders(
      <ProposalsPage />,
      { can: { 'proposals.view': true, 'proposals.manage': true } }
    )

    await waitFor(() => {
      expect(screen.getByText('USL/U-51543/202611/0099')).toBeInTheDocument()
    })

    // Green badge "Selesai tanpa perluasan"
    expect(screen.getAllByText('Selesai tanpa perluasan').length).toBeGreaterThan(0)

    // Status filter includes COMPLETED_NO_EXTENSION option
    const statusSelect = screen.getByLabelText(/Status:/i)
    expect(statusSelect).toBeInTheDocument()
    expect(within(statusSelect).getByRole('option', { name: /Selesai tanpa perluasan/i })).toBeInTheDocument()

    unmount()

    // Detail view test
    proposalsApi.get.mockResolvedValue({ data: mockCompletedProposal })
    proposalsApi.kkfRuns.mockResolvedValue({ data: [] })

    renderWithProviders(
      <ProposalDetailPage proposalId="prop-completed" onBack={vi.fn()} />,
      { can: { 'proposals.view': true, 'proposals.manage': true } }
    )

    await waitFor(() => {
      expect(screen.getByText('USL/U-51543/202611/0099')).toBeInTheDocument()
    })

    // Green banner in detail view
    expect(screen.getByText(/Usulan Selesai Tanpa Perluasan/i)).toBeInTheDocument()
    expect(screen.getByText(/Survei menyatakan tidak memerlukan perluasan jaringan/i)).toBeInTheDocument()

    // No Tambah Anggota or Batalkan Usulan buttons
    expect(screen.queryByRole('button', { name: /Tambah Anggota/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Batalkan Usulan/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Lanjutkan ke Alur Teknis/i })).not.toBeInTheDocument()
  })
})
