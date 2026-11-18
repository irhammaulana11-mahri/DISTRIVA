import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import PriceBooksPage from './PriceBooksPage.jsx'
import PriceBookDetailPage from './PriceBookDetailPage.jsx'
import { PriceBookImportPage } from './ImportPages.jsx'
import { priceBookApi, adminApi } from '../../services/api.js'

// Mock priceBookApi and adminApi
vi.mock('../../services/api.js', () => ({
  priceBookApi: {
    list: vi.fn(),
    get: vi.fn(),
    items: vi.fn(),
    import: vi.fn(),
    setZone: vi.fn(),
    setInsured: vi.fn(),
    discard: vi.fn(),
    createFromActive: vi.fn(),
    approve: vi.fn(),
    retire: vi.fn(),
  },
  adminApi: {
    units: vi.fn(),
  },
}))

const mockBooks = [
  {
    id: 'f8d287b7-a07b-4f84-a67e-4f50b06f2759',
    name: 'Buku Harga Kontrak Jatim 2026',
    contract_reference: 'KTR-2026-001',
    valid_from: '2026-01-01',
    valid_until: null,
    status: 'DRAFT',
    items_count: 504,
    zones_count: 1,
    created_by: 'planner@distriva.com',
    approved_by: null,
    approved_at: null,
  },
  {
    id: 'book-approved-1',
    name: 'Buku Harga Kontrak Jatim 2025',
    contract_reference: 'KTR-2025-999',
    valid_from: '2025-01-01',
    valid_until: '2025-12-31',
    status: 'APPROVED',
    items_count: 480,
    zones_count: 4,
    created_by: 'planner@distriva.com',
    approved_by: 'manager@distriva.com',
    approved_at: '2025-01-02 10:00:00',
  },
]

const mockDetail = {
  id: 'f8d287b7-a07b-4f84-a67e-4f50b06f2759',
  name: 'Buku Harga Kontrak Jatim 2026',
  contract_reference: 'KTR-2026-001',
  valid_from: '2026-01-01',
  valid_until: null,
  status: 'DRAFT',
  items_count: 504,
  zones_count: 1,
  created_by: 'planner@distriva.com',
  approved_by: null,
  approved_at: null,
  available_zones: [1, 2, 3, 5],
  zones: [
    {
      up3_unit_id: 'unit-mojokerto-uuid',
      code: 'UP3-MJK',
      name: 'UP3 Mojokerto',
      zone: 2,
    },
  ],
  events: [
    {
      event_type: 'CREATED',
      reason: 'Inisialisasi buku harga kontrak baru 2026',
      occurred_at: '2026-11-07 05:00:00',
      actor_email: 'planner@distriva.com',
    },
  ],
}

const mockItemsResponse = {
  data: [
    {
      khs_code: '1',
      name: 'Tiang Beton 11 meter 200 daN',
      material_status: 'PLN',
      material_price: null,
      service: {
        '2': { install: 475000, remove: 160000 },
      },
    },
    {
      khs_code: '7',
      name: 'Arm Tie Band 10 inch HDG TM',
      material_status: 'PRICED',
      material_price: 125000,
      service: {
        '2': { install: 37000, remove: 13000 },
      },
    },
  ],
  meta: {
    current_page: 1,
    per_page: 50,
    total: 2,
    last_page: 1,
  },
}

function renderPriceBooksPage(capabilities = { 'prices.manage': true, 'prices.approve': true, 'master_data.view': true }) {
  return render(
    <MemoryRouter initialEntries={['/master-data/harga']}>
      <AccessContext.Provider value={{ can: capabilities, loading: false }}>
        <NotificationProvider>
          <Routes>
            <Route path="/master-data/harga" element={<PriceBooksPage />} />
            <Route path="/master-data/harga/impor" element={<PriceBookImportPage />} />
            <Route path="/master-data/harga/:id" element={<PriceBookDetailPage />} />
          </Routes>
        </NotificationProvider>
      </AccessContext.Provider>
    </MemoryRouter>
  )
}

function renderDetailPage(capabilities = { 'prices.manage': true, 'prices.approve': true, 'master_data.view': true }, bookId = 'f8d287b7-a07b-4f84-a67e-4f50b06f2759') {
  return render(
    <MemoryRouter initialEntries={[`/master-data/harga/${bookId}`]}>
      <AccessContext.Provider value={{ can: capabilities, loading: false }}>
        <NotificationProvider>
          <Routes>
            <Route path="/master-data/harga/:id" element={<PriceBookDetailPage />} />
          </Routes>
        </NotificationProvider>
      </AccessContext.Provider>
    </MemoryRouter>
  )
}

describe('Buku Harga Kontrak Workflow (Tahap 5A - docs/67)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    priceBookApi.list.mockResolvedValue({ data: mockBooks })
    priceBookApi.get.mockResolvedValue({ data: mockDetail })
    priceBookApi.items.mockResolvedValue(mockItemsResponse)
    adminApi.units.mockResolvedValue({
      data: [
        { id: 'unit-mojokerto-uuid', code: 'UP3-MJK', name: 'UP3 Mojokerto', unit_type: 'UP3' },
        { id: 'unit-surabaya-uuid', code: 'UP3-SBY', name: 'UP3 Surabaya Barat', unit_type: 'UP3' },
      ],
    })
  })

  it('1. renders price books list, attention banner for pending draft, and filters by status', async () => {
    renderPriceBooksPage()

    // Header & Attention Banner
    expect(await screen.findByText('Buku Harga Kontrak')).toBeInTheDocument()
    expect(screen.getByText(/Terdapat 1 Draf Buku Harga Menunggu Persetujuan/i)).toBeInTheDocument()

    // Draft book row
    expect(screen.getAllByText('Buku Harga Kontrak Jatim 2026')[0]).toBeInTheDocument()
    expect(screen.getByText('504')).toBeInTheDocument()
    expect(screen.getByText('1 UP3')).toBeInTheDocument()

    // Filter by APPROVED
    const approvedTab = screen.getByRole('button', { name: /Disetujui \(Aktif\)/i })
    await userEvent.click(approvedTab)

    expect(priceBookApi.list).toHaveBeenCalledWith({ status: 'APPROVED' })
  })

  it('2. performs CSV import: dry run validation, preview table, and commit apply', async () => {
    priceBookApi.import
      .mockResolvedValueOnce({
        data: {
          total_rows: 2,
          accepted_rows: 2,
          rejected_rows: 0,
          priced: 1,
          pln: 1,
          zones: [1, 2, 3, 5],
          dry_run: true,
        },
        rows: [
          { row: 1, code: '1', name: 'Tiang Beton 11m', status: 'PLN', zones: [1, 2, 3, 5], messages: [] },
          { row: 2, code: '7', name: 'Arm Tie Band', status: 'HARGA', zones: [1, 2, 3, 5], messages: [] },
        ],
      })
      .mockResolvedValueOnce({
        data: { id: 'new-book-id', name: 'Buku Harga Baru 2026' },
      })

    renderPriceBooksPage()

    const importBtn = await screen.findByRole('button', { name: /Impor Buku Harga/i })
    await userEvent.click(importBtn)

    // Modal opens
    expect(screen.getByText('Impor Buku Harga Satuan Kontrak (CSV)')).toBeInTheDocument()

    // Fill form
    const nameInput = screen.getByPlaceholderText(/Contoh: KHS Distribusi Jatim 2026/i)
    await userEvent.type(nameInput, 'Buku Harga Uji 2026')

    // Attach dummy CSV file
    const file = new File(['kode,status_material\n1,PLN'], 'harga.csv', { type: 'text/csv' })
    const fileInput = document.querySelector('input[type="file"]')
    await userEvent.upload(fileInput, file)

    // Submit Dry Run
    const dryRunBtn = screen.getByRole('button', { name: /Lanjutkan Uji Coba \(Dry Run\)/i })
    await userEvent.click(dryRunBtn)

    // Verification of dry run call
    await waitFor(() => {
      expect(priceBookApi.import).toHaveBeenCalled()
    })

    // Shows preview step
    expect(await screen.findByText('Pratinjau Hasil Validasi (Dry Run)')).toBeInTheDocument()
    expect(screen.getByText('1 PRICED / 1 PLN')).toBeInTheDocument()
    expect(screen.getByText('Tiang Beton 11m')).toBeInTheDocument()

    // Commit Apply
    const applyBtn = screen.getByRole('button', { name: /Terapkan & Buat Draf/i })
    await userEvent.click(applyBtn)

    await waitFor(() => {
      expect(priceBookApi.import).toHaveBeenCalledTimes(2)
    })
  })

  it('3. handles 409 conflict during CSV import and displays problematic rows', async () => {
    const error409 = new Error('Terdapat baris data yang bermasalah.')
    error409.status = 409
    error409.data = {
      data: { total_rows: 1, accepted_rows: 0, rejected_rows: 1 },
      rows: [
        {
          row: 1,
          code: 'UNKNOWN_99',
          name: 'Item Tidak Dikenal',
          status: 'REJECTED',
          zones: [],
          messages: ['Kode KHS tidak ditemukan pada versi aktif.'],
        },
      ],
    }
    priceBookApi.import.mockRejectedValueOnce(error409)

    renderPriceBooksPage()

    const importBtn = await screen.findByRole('button', { name: /Impor Buku Harga/i })
    await userEvent.click(importBtn)

    expect(await screen.findByText('Impor Buku Harga Satuan Kontrak (CSV)')).toBeInTheDocument()

    const nameInput = screen.getByPlaceholderText(/Contoh: KHS Distribusi Jatim 2026/i)
    await userEvent.type(nameInput, 'Buku Harga Rusak')

    const file = new File(['kode,status_material\nUNKNOWN_99,HARGA'], 'rusak.csv', { type: 'text/csv' })
    const fileInput = document.querySelector('input[type="file"]')
    await userEvent.upload(fileInput, file)

    const dryRunBtn = screen.getByRole('button', { name: /Lanjutkan Uji Coba \(Dry Run\)/i })
    await userEvent.click(dryRunBtn)

    expect(await screen.findByText('Kode KHS tidak ditemukan pada versi aktif.')).toBeInTheDocument()
    // Apply button must be disabled
    const applyBtn = screen.getByRole('button', { name: /Terapkan & Buat Draf/i })
    expect(applyBtn).toBeDisabled()
  })

  it('creates a DRAFT as a copy of the book in force with a mandatory reason and opens it', async () => {
    priceBookApi.createFromActive.mockResolvedValueOnce({ data: { id: 'f8d287b7-a07b-4f84-a67e-4f50b06f2759', items: 504 } })
    renderPriceBooksPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Buat Draf dari Buku Berlaku' }))
    await userEvent.click(screen.getByRole('button', { name: 'Buat Draf' }))
    expect(await screen.findByText(/wajib diisi/)).toBeInTheDocument()                          // no reason, nothing sent
    expect(priceBookApi.createFromActive).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText(/Alasan/), 'Selaras Excel revisi')
    await userEvent.click(screen.getByRole('button', { name: 'Buat Draf' }))
    await waitFor(() => expect(priceBookApi.createFromActive).toHaveBeenCalledTimes(1))
    expect(priceBookApi.createFromActive.mock.calls[0][0]).toMatchObject({ reason: 'Selaras Excel revisi' })
    expect(await screen.findByText('Buku Harga Kontrak Jatim 2026')).toBeInTheDocument()       // navigated to the new draft
  })

  it('discards a wrong DRAFT price book with a mandatory reason and sends POST /discard', async () => {
    priceBookApi.discard.mockResolvedValueOnce({ message: 'Draf buku harga dibatalkan.' })
    renderPriceBooksPage()
    await userEvent.click((await screen.findAllByRole('button', { name: /^Batalkan$/ }))[0])
    expect(await screen.findByText(/Batalkan Draf Buku Harga: Buku Harga Kontrak Jatim 2026/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Batalkan Draf' }))
    expect(await screen.findByText('Alasan wajib diisi.')).toBeInTheDocument()                   // no reason, nothing sent
    expect(priceBookApi.discard).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText(/Alasan/), 'Harga salah, unggah ulang.')
    await userEvent.click(screen.getByRole('button', { name: 'Batalkan Draf' }))
    await waitFor(() => expect(priceBookApi.discard).toHaveBeenCalledWith('f8d287b7-a07b-4f84-a67e-4f50b06f2759', { reason: 'Harga salah, unggah ulang.' }))
  })

  it('lists discarded drafts under the Dibatalkan filter', async () => {
    renderPriceBooksPage()
    await userEvent.click(await screen.findByText('Dibatalkan'))
    await waitFor(() => expect(priceBookApi.list).toHaveBeenCalledWith({ status: 'DISCARDED' }))
  })

  it('discards a DRAFT price book from its detail page with a mandatory reason', async () => {
    priceBookApi.discard.mockResolvedValueOnce({ message: 'Draf buku harga dibatalkan.' })
    renderDetailPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Batalkan Draf' }))
    expect(await screen.findByText(/Batalkan Draf Buku Harga: Buku Harga Kontrak Jatim 2026/)).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/Alasan/), 'Harga salah.')
    await userEvent.click(screen.getAllByRole('button', { name: 'Batalkan Draf' }).at(-1))
    await waitFor(() => expect(priceBookApi.discard).toHaveBeenCalledWith('f8d287b7-a07b-4f84-a67e-4f50b06f2759', { reason: 'Harga salah.' }))
  })

  it('changes the MDU value of one item of a DRAFT book with a mandatory reason', async () => {
    priceBookApi.setInsured.mockResolvedValueOnce({ message: 'Nilai MDU diperbarui.' })
    renderDetailPage()
    await userEvent.click(await screen.findByRole('button', { name: /Item KHS & Tarif Jasa/i }))
    expect(await screen.findByText('Nilai MDU')).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: /^Ubah nilai MDU/ })[0])
    expect(await screen.findByText(/Perubahan hanya berlaku pada draf ini/)).toBeInTheDocument()
    const value = screen.getByLabelText('Nilai MDU (Rp)')
    await userEvent.clear(value)
    await userEvent.type(value, '1500000')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan Nilai MDU' }))
    expect(await screen.findByText('Alasan wajib diisi.')).toBeInTheDocument()                  // no reason, nothing sent
    expect(priceBookApi.setInsured).not.toHaveBeenCalled()

    await userEvent.type(screen.getByLabelText(/Alasan/), 'Selaras Excel revisi')
    await userEvent.click(screen.getByRole('button', { name: 'Simpan Nilai MDU' }))
    await waitFor(() => expect(priceBookApi.setInsured).toHaveBeenCalledTimes(1))
    expect(priceBookApi.setInsured.mock.calls[0][2]).toEqual({ insured_value: 1500000, reason: 'Selaras Excel revisi' })
  })

  it('4. displays detail page, items table with formatted prices, and assigns UP3 zone', async () => {
    priceBookApi.setZone.mockResolvedValueOnce({ message: 'Zona ditetapkan.' })

    renderDetailPage()

    // Header & details
    expect(await screen.findByText('Buku Harga Kontrak Jatim 2026')).toBeInTheDocument()
    expect(screen.getByText('UP3 Mojokerto')).toBeInTheDocument()
    expect(screen.getByText('Zona 2')).toBeInTheDocument()

    // Switch to Items Tab
    const itemsTab = screen.getByRole('button', { name: /Item KHS & Tarif Jasa/i })
    await userEvent.click(itemsTab)

    expect(priceBookApi.items).toHaveBeenCalled()
    expect(await screen.findByText('Tiang Beton 11 meter 200 daN')).toBeInTheDocument()
    expect(screen.getByText('Material PLN (Non-RAB)')).toBeInTheDocument()
    expect(screen.getByText('Arm Tie Band 10 inch HDG TM')).toBeInTheDocument()
    // Formatted rupiah
    expect(screen.getByText(/Rp\s*125\.000/i)).toBeInTheDocument()

    // Switch back to Zones Tab and set a new zone
    const zonesTab = screen.getByRole('button', { name: /Zona per UP3/i })
    await userEvent.click(zonesTab)

    const setZoneBtn = screen.getByRole('button', { name: /Tetapkan \/ Ubah Zona UP3/i })
    await userEvent.click(setZoneBtn)

    // Select unit & zone
    await waitFor(() => {
      expect(adminApi.units).toHaveBeenCalled()
    })
    const unitSelect = screen.getByRole('combobox', { name: 'Pilih Unit UP3' })
    const zoneSelect = screen.getByRole('combobox', { name: 'Pilih Zona Tarif' })
    await userEvent.selectOptions(unitSelect, 'unit-surabaya-uuid')
    await userEvent.selectOptions(zoneSelect, '3')

    const reasonInput = screen.getByPlaceholderText(/Jelaskan dasar surat penetapan/i)
    await userEvent.type(reasonInput, 'Surat Keputusan Penetapan Zona Tarif Wilayah Surabaya')

    const saveZoneBtn = screen.getByRole('button', { name: /Simpan Penetapan Zona/i })
    await userEvent.click(saveZoneBtn)

    await waitFor(() => {
      expect(priceBookApi.setZone).toHaveBeenCalledWith(
        'f8d287b7-a07b-4f84-a67e-4f50b06f2759',
        expect.objectContaining({
          up3_unit_id: 'unit-surabaya-uuid',
          zone: 3,
          reason: 'Surat Keputusan Penetapan Zona Tarif Wilayah Surabaya',
        })
      )
    })
  })

  it('5. approves price book with mandatory reason and handles approval errors (403/409)', async () => {
    priceBookApi.approve.mockResolvedValueOnce({
      approved: ['f8d287b7-a07b-4f84-a67e-4f50b06f2759'],
      auto_closed: ['book-approved-1'],
    })

    renderDetailPage()

    const approveBtn = await screen.findByRole('button', { name: /Setujui Buku Harga/i })
    await userEvent.click(approveBtn)

    // Dialog appears
    expect(screen.getByText(/Persetujuan Buku Harga: Buku Harga Kontrak Jatim 2026/i)).toBeInTheDocument()

    const reasonInput = screen.getByLabelText(/Alasan/i)
    await userEvent.type(reasonInput, 'Disetujui sesuai Berita Acara Kesepakatan Kontrak 2026.')

    const confirmBtn = screen.getByRole('button', { name: /Setujui Sekarang/i })
    await userEvent.click(confirmBtn)

    await waitFor(() => {
      expect(priceBookApi.approve).toHaveBeenCalledWith({
        book_ids: ['f8d287b7-a07b-4f84-a67e-4f50b06f2759'],
        reason: 'Disetujui sesuai Berita Acara Kesepakatan Kontrak 2026.',
      })
    })
  })

  it('6. respects capabilities: hides import and approval buttons without permissions', async () => {
    // Render with only view permission
    renderPriceBooksPage({ 'master_data.view': true, 'prices.manage': false, 'prices.approve': false })

    expect(await screen.findByText('Buku Harga Kontrak')).toBeInTheDocument()

    // Import button must not be present
    expect(screen.queryByRole('button', { name: /Impor Buku Harga/i })).not.toBeInTheDocument()

    // Quick approve button must not be present
    expect(screen.queryByRole('button', { name: /^Setujui$/i })).not.toBeInTheDocument()
  })
})
