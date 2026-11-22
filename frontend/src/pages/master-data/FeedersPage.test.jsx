import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import FeedersPage from './FeedersPage.jsx'
import { feedersApi, substationsApi, adminApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  feedersApi: {
    list: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  substationsApi: {
    list: vi.fn(),
  },
  adminApi: {
    units: vi.fn(),
  },
}))

function renderPage({ can = { 'feeders.view': true }, isSysAdmin = false } = {}) {
  const accessValue = {
    loading: false,
    can,
    canWrite: {},
    isSysAdmin,
  }

  return render(
    <AccessContext.Provider value={accessValue}>
      <NotificationProvider>
        <MemoryRouter>
          <FeedersPage />
        </MemoryRouter>
      </NotificationProvider>
    </AccessContext.Provider>
  )
}

const SAMPLE_FEEDERS = [
  {
    id: 'f-1',
    code: 'WTGLH',
    name: 'Watesumpak',
    gi_code: 'GI-MJK',
    gi_name: 'KERTOSONO',
    gi_transformer_no: '1',
    owner_unit_id: 'u-up3-1',
    owner_unit_code: 'UP3-MJK',
    owner_unit_name: 'UP3 Mojokerto',
    served_units: [{ id: 'u-ulp-1', code: 'ULP-PLSO', name: 'ULP Ploso', substation_count: 40 }, { id: 'u-ulp-2', code: 'ULP-MJO', name: 'ULP Mojokerto Kota', substation_count: 80 }],
    substation_count: 120,
    capacity_kva: 18630,
    status: 'AKTIF',
    notes: 'Penyulang utama industri',
  },
  {
    id: 'f-2',
    code: 'PLOSO',
    name: 'Ploso Kota',
    gi_code: 'GI-JOM',
    gi_transformer_no: '2',
    owner_unit_id: 'u-ulp-1',
    owner_unit_code: 'ULP-PLSO',
    owner_unit_name: 'ULP Ploso',
    substation_count: 45,
    capacity_kva: 6300,
    status: 'NONAKTIF',
    notes: '',
  },
]

describe('Master Penyulang Page (docs/81)', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    adminApi.units.mockResolvedValue({
      data: [
        { id: 'u-up3-1', code: 'UP3-MJK', name: 'UP3 Mojokerto', unit_type: 'UP3' },
        { id: 'u-ulp-1', code: 'ULP-PLSO', name: 'ULP Ploso', unit_type: 'ULP', parent_id: 'u-up3-1' },
        { id: 'u-ulp-2', code: 'ULP-MJO', name: 'ULP Mojokerto Kota', unit_type: 'ULP' },
      ],
    })

    feedersApi.list.mockResolvedValue({
      data: SAMPLE_FEEDERS,
      meta: { current_page: 1, per_page: 25, total: 2, last_page: 1 },
    })

    substationsApi.list.mockResolvedValue({
      data: [
        {
          id: 'sub-1',
          code: 'GD514530761',
          name: 'Gardu Wates 01',
          unit_code: 'ULP-MJO',
          unit_name: 'ULP Mojokerto Kota',
          capacity_kva: 200,
          reading: { loading_pct: 68.5 },
        },
      ],
      meta: { total: 1 },
    })

    feedersApi.get.mockResolvedValue({
      data: {
        feeder: SAMPLE_FEEDERS[0],
        customers: {
          active_customers: 15420,
          connected_va: 26361000,
          connected_kva: 26361,
          large_customers: 142,
        },
        served_units: [
          { id: 'u-ulp-1', code: 'ULP-PLSO', name: 'ULP Ploso', substation_count: 40, capacity_kva: 6630 },
          { id: 'u-ulp-2', code: 'ULP-MJO', name: 'ULP Mojokerto Kota', substation_count: 80, capacity_kva: 12000 },
        ],
        loading: {
          measured_substations: 95,
          load_kva: 13879.35,
          capacity_kva: 18630,
          loading_pct: 74.5,
        },
        history: [
          {
            action: 'CREATED',
            reason: 'Inisialisasi sistem',
            before: null,
            after: { code: 'WTGLH', owner_unit_id: 'u-up3-1' },
            created_at: '2026-11-12 10:00:00',
            changed_by_name: 'Administrator Sistem',
          },
        ],
      },
    })
  })

  it('1. menampilkan daftar penyulang dengan kode, nama, GI, unit yang dilayani (nama saja), kapasitas, dan status', async () => {
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('WTGLH')).toBeInTheDocument()
      expect(screen.getByText('Watesumpak')).toBeInTheDocument()
      expect(screen.getByText('PLOSO')).toBeInTheDocument()
      expect(screen.getByText('Ploso Kota')).toBeInTheDocument()
      expect(screen.getAllByTestId('feeder-units')[0]).toHaveTextContent('ULP Ploso, ULP Mojokerto Kota')          // nama unit yang dilayani saja, tanpa kode dan tanpa cabang
      expect(screen.getAllByTestId('feeder-units')[0]).not.toHaveTextContent(/UP3/)
      expect(screen.getAllByTestId('feeder-units')[1]).toHaveTextContent('-')                                       // belum ada gardu
      expect(screen.getByText(/18.630/i)).toBeInTheDocument()
    })
  })

  it('1b. nama GI tampil bersama kodenya (nama dari daftar pemilik); tanpa nama tampil kode', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('WTGLH')).toBeInTheDocument())
    expect(screen.getAllByText(/KERTOSONO/).length).toBeGreaterThan(0)
    expect(screen.getByText('(GI-MJK)')).toBeInTheDocument()
    expect(screen.getAllByText(/GI-JOM/).length).toBeGreaterThan(0)
  })

  it('2. mengirim parameter filter (q, owner_unit_id, serves_unit_id, gi_code, status) ke server', async () => {
    const user = userEvent.setup()
    renderPage()

    await waitFor(() => {
      expect(screen.getByText('WTGLH')).toBeInTheDocument()
    })

    const searchInput = screen.getByRole('textbox', { name: /Cari penyulang/i })
    await user.type(searchInput, 'Wates')

    const ownerSelect = screen.getByRole('combobox', { name: /^Cabang$/i })
    await user.click(ownerSelect)
    await user.click(screen.getByRole('option', { name: /UP3 Mojokerto/i }))

    const servesSelect = screen.getByRole('combobox', { name: /^Unit$/i })
    await user.click(servesSelect)
    await user.click(screen.getByRole('option', { name: /ULP Ploso/i }))

    const statusSelect = screen.getByRole('combobox', { name: /Status/i })
    await user.selectOptions(statusSelect, 'AKTIF')

    await waitFor(() => {
      expect(feedersApi.list).toHaveBeenCalledWith(
        expect.objectContaining({
          q: 'Wates',
          owner_unit_id: 'u-up3-1',
          serves_unit_id: 'u-ulp-1',
          status: 'AKTIF',
        })
      )
    })
  })

  it('3. tombol tambah penyulang hanya tampil bila pengguna memiliki hak feeders.manage', async () => {
    // Tanpa feeders.manage
    const { unmount } = renderPage({ can: { 'feeders.view': true } })
    expect(screen.queryByRole('button', { name: /Tambah Penyulang/i })).not.toBeInTheDocument()
    unmount()

    // Dengan feeders.manage
    renderPage({ can: { 'feeders.view': true, 'feeders.manage': true } })
    expect(screen.getByRole('button', { name: /Tambah Penyulang/i })).toBeInTheDocument()
  })

  it('4. membuka detail penyulang dalam drawer: ULP yang dilayani, pembebanan, pelanggan, gardu, dan riwayat', async () => {
    const user = userEvent.setup()
    renderPage({ can: { 'feeders.view': true, 'feeders.manage': true, 'customers.view': true } })

    await waitFor(() => {
      expect(screen.getByText('WTGLH')).toBeInTheDocument()
    })

    // Klik baris penyulang WTGLH
    const row = screen.getByText('WTGLH')
    await user.click(row)

    await waitFor(() => {
      expect(feedersApi.get).toHaveBeenCalledWith('f-1')
      expect(screen.getByTestId('feeder-detail')).toBeInTheDocument()
      // Tandai bila lebih dari 1 ULP ("Melintasi N ULP")
      expect(screen.getByText(/Melintasi 2 ULP/i)).toBeInTheDocument()
      // Pembebanan penyulang
      expect(screen.getByText(/74,5%/i)).toBeInTheDocument()
      expect(screen.getByText(/dari 95 gardu yang punya beban terukur/i)).toBeInTheDocument()
      // Pelanggan aktif dan daya tersambung
      expect(screen.getByText(/15.420/i)).toBeInTheDocument()
      expect(screen.getByText(/26.361 kVA/i)).toBeInTheDocument()
      // Catatan kecil docs/81 §4
      expect(screen.getByText(/Daya tersambung bukan beban dan tidak dibandingkan dengan kapasitas trafo/i)).toBeInTheDocument()
      // Tautan ke master pelanggan
      expect(screen.getByRole('link', { name: /Lihat pelanggan penyulang ini/i })).toBeInTheDocument()
      // Riwayat perubahan
      expect(screen.getByText('Inisialisasi sistem')).toBeInTheDocument()
      expect(screen.getByText('Administrator Sistem')).toBeInTheDocument()
    })
  })

  it('5. menampilkan "belum ada beban terukur" bila loading_pct bernilai null dan tidak mengarang angka', async () => {
    const user = userEvent.setup()
    feedersApi.get.mockResolvedValueOnce({
      data: {
        feeder: SAMPLE_FEEDERS[1],
        customers: { active_customers: 0, connected_va: 0, connected_kva: 0, large_customers: 0 },
        served_units: [],
        loading: {
          measured_substations: 0,
          load_kva: 0,
          capacity_kva: 0,
          loading_pct: null,
        },
        history: [],
      },
    })

    renderPage()

    await waitFor(() => {
      expect(screen.getByText('PLOSO')).toBeInTheDocument()
    })

    await user.click(screen.getByText('PLOSO'))

    await waitFor(() => {
      expect(screen.getByText(/belum ada beban terukur/i)).toBeInTheDocument()
      expect(screen.queryByText(/0,0%/i)).not.toBeInTheDocument()
    })
  })

  it('6. formulir tambah penyulang mewajibkan alasan min 3 karakter dan menampilkan galat 409 dari server apa adanya', async () => {
    const user = userEvent.setup()
    renderPage({ can: { 'feeders.view': true, 'feeders.manage': true } })

    const addBtn = screen.getByRole('button', { name: /Tambah Penyulang/i })
    await user.click(addBtn)

    expect(screen.getByText('Tambah Penyulang Baru')).toBeInTheDocument()

    const codeInput = screen.getByPlaceholderText(/Misal: WTGLH/i)
    await user.type(codeInput, 'BARU01')

    const reasonInput = screen.getByPlaceholderText(/wajib min\. 3 karakter/i)

    // Coba simpan dengan alasan kosong / < 3 karakter
    await user.type(reasonInput, 'ab')
    const submitBtn = screen.getAllByRole('button', { name: /Tambah Penyulang/i }).slice(-1)[0]
    await user.click(submitBtn)

    expect(screen.getByText(/Alasan perubahan wajib diisi \(minimal 3 karakter\)/i)).toBeInTheDocument()

    // Mock server mengembalikan 409 "Penyulang BARU01 sudah ada."
    feedersApi.create.mockRejectedValueOnce(new Error('Penyulang BARU01 sudah ada.'))

    await user.clear(reasonInput)
    await user.type(reasonInput, 'Penambahan penyulang ekspansi industri')
    await user.click(submitBtn)

    await waitFor(() => {
      expect(screen.getByText('Penyulang BARU01 sudah ada.')).toBeInTheDocument()
    })
  })
})
