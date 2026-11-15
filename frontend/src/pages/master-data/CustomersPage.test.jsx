import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import CustomersPage from './CustomersPage.jsx'
import { connectionsApi, substationsApi, feedersApi, adminApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  connectionsApi: {
    list: vi.fn(),
    get: vi.fn(),
    link: vi.fn(),
    syncInfo: vi.fn(),
    syncStart: vi.fn(),
    syncRun: vi.fn(),
  },
  substationsApi: {
    list: vi.fn(),
  },
  feedersApi: {
    list: vi.fn(),
  },
  adminApi: {
    units: vi.fn(),
  },
}))

function renderPage({ can = { 'customers.view': true }, route = '/master-data/customers' } = {}) {
  const accessValue = {
    loading: false,
    can,
    canWrite: {},
    isSysAdmin: false,
  }

  return render(
    <AccessContext.Provider value={accessValue}>
      <NotificationProvider>
        <MemoryRouter initialEntries={[route]}>
          <CustomersPage />
        </MemoryRouter>
      </NotificationProvider>
    </AccessContext.Provider>
  )
}

const SAMPLE_CONNECTIONS = [
  {
    id: 'c-1',
    idpel: '514530761001',
    name: 'PT MAJU JAYA',
    name_masked: false,
    organizational_unit_id: 'u-ulp-1',
    unit_name: 'ULP Mojokerto Kota',
    tariff_code: 'I3',
    power_va: 345000,
    service_type: 'PASKABAYAR',
    phase_code: '3',
    meter_number: '987654321',
    energized_on: '2023-01-15',
    status: 'AKTIF',
    source: 'DIL',
    snapshot_month: '202210',
    substation_id: 'sub-1',
    substation_code: 'GD514530761',
    substation_name: 'Gardu Wates 01',
    feeder_id: 'f-1',
    feeder_code: 'WTGLH',
    link_source: 'DIL',
    kelurahan: 'Wates',
    kecamatan: 'Magersari',
    kabupaten: 'Mojokerto',
  },
  {
    id: 'c-2',
    idpel: '514530761002',
    name: 'BUD*****',
    name_masked: true,
    organizational_unit_id: 'u-ulp-1',
    unit_name: 'ULP Mojokerto Kota',
    tariff_code: 'R1',
    power_va: 900,
    service_type: 'PRABAYAR',
    phase_code: '1',
    meter_number: '123456789',
    energized_on: '2021-08-10',
    status: 'PROSES',
    source: 'APPLICATION',
    snapshot_month: null,
    gardu_ref: 'GD514530799',
    substation_id: null,
    substation_code: null,
    substation_name: null,
    feeder_id: null,
    feeder_code: null,
    link_source: null,
    kelurahan: 'Gedongan',
    kecamatan: 'Magersari',
    kabupaten: 'Mojokerto',
  },
]

describe('Master Pelanggan Page (docs/81)', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    adminApi.units.mockResolvedValue({
      data: [
        { id: 'u-ulp-1', code: 'ULP-MJO', name: 'ULP Mojokerto Kota', unit_type: 'ULP' },
        { id: 'u-ulp-2', code: 'ULP-PLSO', name: 'ULP Ploso', unit_type: 'ULP' },
      ],
    })

    feedersApi.list.mockResolvedValue({
      data: [{ id: 'f-1', code: 'WTGLH', name: 'Watesumpak' }],
    })

    connectionsApi.list.mockResolvedValue({
      data: SAMPLE_CONNECTIONS,
      meta: { current_page: 1, per_page: 25, total: 2, last_page: 1 },
    })

    connectionsApi.get.mockResolvedValue({
      data: {
        connection: SAMPLE_CONNECTIONS[1],
        applications: [
          {
            id: 'app-1',
            application_number: 'PB-2026-0001',
            application_type: 'PASANG_BARU',
            current_status: 'SURVEY_SCHEDULED',
            created_at: '2026-11-01',
          },
        ],
      },
    })

    substationsApi.list.mockResolvedValue({
      data: [
        {
          id: 'sub-2',
          code: 'GD514530799',
          name: 'Gardu Gedongan 01',
          capacity_kva: 160,
          organizational_unit_id: 'u-ulp-1',
        },
      ],
    })
  })

  it('1. menampilkan daftar pelanggan dengan IDPEL, nama, tarif, daya (VA), status, gardu, penyulang, dan kelurahan', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('514530761001')).toBeInTheDocument()
      expect(screen.getByText('PT MAJU JAYA')).toBeInTheDocument()
      expect(screen.getByText('345.000')).toBeInTheDocument()
      expect(screen.getByText('WTGLH')).toBeInTheDocument()
      expect(screen.getByText('Wates')).toBeInTheDocument()
    })
  })

  it('2. nama tersamar (name_masked: true) menampilkan nama bertopeng apa adanya dengan lencana Tersamar', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('BUD*****')).toBeInTheDocument()
      expect(screen.getByTestId('badge-masked')).toHaveTextContent('Tersamar')
    })
  })

  it('3. mengirim parameter filter (q, organizational_unit_id, feeder_id, tariff_code, status, service_type, linked=0) ke server', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('514530761001')).toBeInTheDocument()
    })

    const searchInput = screen.getByRole('textbox', { name: /Cari pelanggan/i })
    await user.type(searchInput, '51453')

    const unitSelect = screen.getByRole('combobox', { name: /Unit ULP/i })
    await user.selectOptions(unitSelect, 'u-ulp-1')

    const feederSelect = screen.getByRole('combobox', { name: /Penyulang/i })
    await user.selectOptions(feederSelect, 'f-1')

    const tariffInput = screen.getByRole('textbox', { name: /Tarif/i })
    await user.type(tariffInput, 'R1')

    const statusSelect = screen.getByRole('combobox', { name: /Status Pelanggan/i })
    await user.selectOptions(statusSelect, 'AKTIF')

    const serviceSelect = screen.getByRole('combobox', { name: /Jenis Layanan/i })
    await user.selectOptions(serviceSelect, 'PRABAYAR')

    const unlinkedCheckbox = screen.getByRole('checkbox', { name: /Belum tertaut ke gardu/i })
    await user.click(unlinkedCheckbox)

    const searchBtn = screen.getByRole('button', { name: /Cari/i })
    await user.click(searchBtn)

    await waitFor(() => {
      expect(connectionsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: '51453',
          organizational_unit_id: 'u-ulp-1',
          feeder_id: 'f-1',
          tariff_code: 'R1',
          status: 'AKTIF',
          service_type: 'PRABAYAR',
          linked: 0,
        })
      )
    })
  })

  it('4. membuka detail pelanggan dalam drawer: semua isian, status gardu ref, dan permohonan terkait', async () => {
    const user = userEvent.setup()
    renderPage({ can: { 'customers.view': true, 'customers.manage': true } })

    await waitFor(() => {
      expect(screen.getByText('514530761002')).toBeInTheDocument()
    })

    await user.click(screen.getByText('514530761002'))

    await waitFor(() => {
      expect(connectionsApi.get).toHaveBeenCalledWith('c-2')
      expect(screen.getByTestId('customer-detail')).toBeInTheDocument()
      expect(screen.getByText(/Belum tertaut ke gardu master/i)).toBeInTheDocument()
      expect(screen.getByText(/menunggu gardu masuk master/i)).toBeInTheDocument()
      expect(screen.getByText('PB-2026-0001')).toBeInTheDocument()
      expect(screen.getByTestId('fix-link-section')).toBeInTheDocument()
    })
  })

  it('5. perbaikan tautan gardu hanya mencari gardu se-ULP dan mengirim substation_id ke server', async () => {
    const user = userEvent.setup()
    renderPage({ can: { 'customers.view': true, 'customers.manage': true } })

    await waitFor(() => {
      expect(screen.getByText('514530761002')).toBeInTheDocument()
    })

    await user.click(screen.getByText('514530761002'))

    await waitFor(() => {
      expect(screen.getByTestId('fix-link-section')).toBeInTheDocument()
    })

    // Ketik pencarian gardu
    const garduInput = screen.getByRole('textbox', { name: /Cari gardu se-ULP/i })
    await user.type(garduInput, 'GD514530799')

    await waitFor(() => {
      expect(substationsApi.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'GD514530799',
          organizational_unit_id: 'u-ulp-1', // Harus ULP yang sama!
        })
      )
      expect(screen.getByText('Gardu Gedongan 01')).toBeInTheDocument()
    })

    // Pilih gardu dari hasil pencarian
    await user.click(screen.getByText('Gardu Gedongan 01'))

    // Klik tombol tautkan
    const linkBtn = screen.getByRole('button', { name: /Tautkan ke Gardu Ini/i })
    await user.click(linkBtn)

    await waitFor(() => {
      expect(connectionsApi.link).toHaveBeenCalledWith('c-2', { substation_id: 'sub-2' })
    })
  })

  it('6. tombol lepas tautan mengirim substation_id: null', async () => {
    const user = userEvent.setup()
    connectionsApi.get.mockResolvedValueOnce({
      data: {
        connection: SAMPLE_CONNECTIONS[0], // c-1 sudah tertaut ke sub-1
        applications: [],
      },
    })

    renderPage({ can: { 'customers.view': true, 'customers.manage': true } })

    await waitFor(() => {
      expect(screen.getByText('514530761001')).toBeInTheDocument()
    })

    await user.click(screen.getByText('514530761001'))

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Lepas Tautan Gardu/i })).toBeInTheDocument()
    })

    await user.click(screen.getByRole('button', { name: /Lepas Tautan Gardu/i }))

    await waitFor(() => {
      expect(connectionsApi.link).toHaveBeenCalledWith('c-1', { substation_id: null })
    })
  })

  it('7. menampilkan galat 409 bila server menolak tautan gardu beda ULP', async () => {
    const user = userEvent.setup()
    renderPage({ can: { 'customers.view': true, 'customers.manage': true } })

    await waitFor(() => {
      expect(screen.getByText('514530761002')).toBeInTheDocument()
    })

    await user.click(screen.getByText('514530761002'))

    await waitFor(() => {
      expect(screen.getByTestId('fix-link-section')).toBeInTheDocument()
    })

    const garduInput = screen.getByRole('textbox', { name: /Cari gardu se-ULP/i })
    await user.type(garduInput, 'GD514530799')

    await waitFor(() => {
      expect(screen.getByText('Gardu Gedongan 01')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Gardu Gedongan 01'))

    // Mock 409 error dari server
    connectionsApi.link.mockRejectedValueOnce(
      new Error('Gardu harus berada di ULP yang sama dengan pelanggan.')
    )

    const linkBtn = screen.getByRole('button', { name: /Tautkan ke Gardu Ini/i })
    await user.click(linkBtn)

    await waitFor(() => {
      expect(screen.getByText('Gardu harus berada di ULP yang sama dengan pelanggan.')).toBeInTheDocument()
    })
  })

  it('kartu statistik memakai total seluruh data dari server, bukan baris pada halaman ini', async () => {
    connectionsApi.list.mockResolvedValue({
      data: SAMPLE_CONNECTIONS,
      meta: { current_page: 1, per_page: 25, total: 1429072, last_page: 57163 },
      summary: { total: 1429072, active: 1411323, active_va: 2779063650, unlinked: 6631 },
    })
    renderPage()
    expect(await screen.findByText('1.429.072')).toBeInTheDocument()
    expect(screen.getByText('1.411.323')).toBeInTheDocument()
    expect(screen.getByText('2.779.064')).toBeInTheDocument()                      // kVA
    expect(screen.getByText('6.631')).toBeInTheDocument()
    expect(screen.queryByText(/halaman ini/i)).not.toBeInTheDocument()
  })

  it('tombol Sinkron DIL hanya untuk yang boleh impor, menampilkan cara peletakan berkas dan memulai sinkron', async () => {
    connectionsApi.syncInfo.mockResolvedValue({ data: { inbox: 'backend/storage/app/dil-inbox', naming: 'DIL_SALDO_MASK_UP_<YYYYMM>_<kode ULP>.mdb', mdbtools: true, needs_mdbtools: true, active: null, recent: [],
      files: [{ name: 'DIL_SALDO_MASK_UP_202603_51453.mdb', size: 397185024, modified: '2026-11-15T10:00:00+07:00', kind: 'mdb', ulp_code: '51453', month: '202603' }] } })
    connectionsApi.syncStart.mockResolvedValue({ data: { id: 'run-1', status: 'QUEUED', files: [{ name: 'DIL_SALDO_MASK_UP_202603_51453.mdb', size: 397185024 }], results: [], rows_done: 0, started_by_name: 'Admin' } })
    connectionsApi.syncRun.mockResolvedValue({ data: { id: 'run-1', status: 'RUNNING', files: [{ name: 'x', size: 1 }], results: [], rows_done: 1000 } })

    const { unmount } = renderPage()
    await screen.findByText('514530761001')
    expect(screen.queryByRole('button', { name: 'Sinkron DIL' })).not.toBeInTheDocument()
    unmount()

    renderPage({ can: { 'customers.view': true, 'customers.import': true } })
    await userEvent.click(await screen.findByRole('button', { name: 'Sinkron DIL' }))
    expect(await screen.findByText('Cara meletakkan berkas')).toBeInTheDocument()
    expect(screen.getAllByText(/backend\/storage\/app\/dil-inbox/).length).toBeGreaterThan(0)
    expect(await screen.findByText('DIL_SALDO_MASK_UP_202603_51453.mdb')).toBeInTheDocument()
    expect(screen.getByText('379 MB')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: /Mulai sinkron/i }))
    await waitFor(() => expect(connectionsApi.syncStart).toHaveBeenCalledTimes(1))
    expect(await screen.findByText('Sedang berjalan')).toBeInTheDocument()
  })
})
