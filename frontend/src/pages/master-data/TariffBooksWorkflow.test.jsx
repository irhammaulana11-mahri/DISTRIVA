import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import TariffBooksPage from './TariffBooksPage.jsx'
import TariffBookDetailPage from './TariffBookDetailPage.jsx'
import { TariffBookImportPage } from './ImportPages.jsx'
import { tariffBooksApi } from '../../services/api.js'

// Mock tariffBooksApi
vi.mock('../../services/api.js', () => ({
  tariffBooksApi: {
    list: vi.fn(),
    get: vi.fn(),
    rows: vi.fn(),
    import: vi.fn(),
    approve: vi.fn(),
    retire: vi.fn(),
    discard: vi.fn(),
  },
}))

const mockBooks = [
  {
    id: 'tb-draft-1',
    name: 'Buku Tarif Listrik PLN 2026',
    valid_from: '2026-01-01',
    valid_until: null,
    status: 'DRAFT',
    source_reference: 'Permen ESDM 01/2026',
    rows_count: 50,
    created_by: 'engineer@pln.co.id',
    approved_by: null,
    approved_at: null,
  },
  {
    id: 'tb-approved-1',
    name: 'Buku Tarif Listrik PLN 2025',
    valid_from: '2025-01-01',
    valid_until: '2025-12-31',
    status: 'APPROVED',
    source_reference: 'Permen ESDM 12/2024',
    rows_count: 45,
    created_by: 'engineer@pln.co.id',
    approved_by: 'manager@pln.co.id',
    approved_at: '2025-01-02 09:00:00',
  },
]

const mockDetail = {
  id: 'tb-draft-1',
  name: 'Buku Tarif Listrik PLN 2026',
  valid_from: '2026-01-01',
  valid_until: null,
  status: 'DRAFT',
  source_reference: 'Permen ESDM 01/2026',
  rows_count: 50,
  created_by: 'engineer@pln.co.id',
  approved_by: null,
  approved_at: null,
  events: [
    {
      event_type: 'IMPORTED',
      reason: 'Impor berkas awal',
      details: { total: 50, accepted: 50 },
      occurred_at: '2026-01-01 10:00:00',
      actor_email: 'engineer@pln.co.id',
    },
  ],
}

const mockRows = {
  data: [
    { tariff: 'R1', power_va: 900, ulp_code: null, avg_price: 1352.0, jam_nyala: 100, ujl: 150 },
    { tariff: 'R1', power_va: 1300, ulp_code: null, avg_price: 1444.7, jam_nyala: 120, ujl: 150 },
    { tariff: 'B2', power_va: 6600, ulp_code: 'ULP-01', avg_price: 1520.0, jam_nyala: 200, ujl: 200 },
  ],
  meta: {
    current_page: 1,
    last_page: 1,
    total: 3,
    per_page: 50,
  },
}

function renderWithContext(ui, { can = {}, canWrite = {}, initialEntries = ['/'] } = {}) {
  return render(
    <MemoryRouter initialEntries={initialEntries}>
      <AccessContext.Provider value={{ can, canWrite, loading: false }}>
        <NotificationProvider>
          <Routes>
            <Route path="/master-data/tariff-books/impor" element={<TariffBookImportPage />} />
            <Route path="*" element={ui} />
          </Routes>
        </NotificationProvider>
      </AccessContext.Provider>
    </MemoryRouter>,
  )
}

describe('TariffBooks Master Data Workflow', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    tariffBooksApi.list.mockResolvedValue({ data: mockBooks })
    tariffBooksApi.get.mockResolvedValue({ data: mockDetail })
    tariffBooksApi.rows.mockResolvedValue(mockRows)
  })

  it('1. renders tariff books list, filters by status tabs, and enforces permission gates', async () => {
    // Read only user
    const { rerender } = renderWithContext(<TariffBooksPage />, {
      can: { 'master_data.view': true },
    })

    expect(await screen.findByText('Buku Tarif Listrik')).toBeInTheDocument()
    expect(screen.getByText('Buku Tarif Listrik PLN 2026')).toBeInTheDocument()
    expect(screen.getByText('Buku Tarif Listrik PLN 2025')).toBeInTheDocument()

    // Import button should NOT be visible without tariffs.manage
    expect(screen.queryByRole('button', { name: /Impor Buku Tarif/ })).not.toBeInTheDocument()

    // Approve / Retire button should NOT be visible without tariffs.approve
    expect(screen.queryByRole('button', { name: /Setujui/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Nonaktifkan/ })).not.toBeInTheDocument()

    // Filter by DRAFT
    const draftTab = screen.getByRole('button', { name: 'Draf (Menunggu Persetujuan)' })
    await userEvent.click(draftTab)
    expect(tariffBooksApi.list).toHaveBeenCalledWith({ status: 'DRAFT' })

    // Re-render with tariffs.manage and tariffs.approve
    rerender(
      <MemoryRouter initialEntries={['/']}>
        <AccessContext.Provider
          value={{
            can: {
              'master_data.view': true,
              'tariffs.manage': true,
              'tariffs.approve': true,
            },
            canWrite: {},
            loading: false,
          }}
        >
          <NotificationProvider>
            <TariffBooksPage />
          </NotificationProvider>
        </AccessContext.Provider>
      </MemoryRouter>,
    )

    // Now buttons are visible
    expect(await screen.findByRole('button', { name: /Impor Buku Tarif/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Setujui/ })).toBeInTheDocument()
  })

  it('2. performs dry run CSV import and shows per-row errors table (all-or-nothing guard)', async () => {
    tariffBooksApi.import.mockResolvedValueOnce({
      data: {
        total: 2,
        accepted: 1,
        rejected: 1,
        dry_run: true,
        tariff_book_id: null,
      },
      rows: [
        { row: 1, tariff: 'R1', power_va: 900, ulp: null, status: 'OK', errors: [] },
        {
          row: 2,
          tariff: 'INVALID',
          power_va: -100,
          ulp: null,
          status: 'REJECTED',
          errors: ['Daya VA harus berupa angka bulat positif.'],
        },
      ],
    })

    renderWithContext(<TariffBooksPage />, {
      can: { 'master_data.view': true, 'tariffs.manage': true },
    })

    const importBtn = await screen.findByRole('button', { name: /Impor Buku Tarif/ })
    await userEvent.click(importBtn)

    expect(await screen.findByText('Impor Buku Tarif Listrik')).toBeInTheDocument()
    expect(screen.getByText('Format Berkas CSV Buku Tarif Listrik')).toBeInTheDocument()

    // Fill form
    await userEvent.type(screen.getByLabelText(/Nama Buku Tarif/), 'Draf Tarif Uji Coba')
    const file = new File(['tarif,daya_va,harga_rata2,jam_nyala\nR1,900,1352,100'], 'tarif.csv', {
      type: 'text/csv',
    })
    const fileInput = document.querySelector('input[type="file"]')
    await userEvent.upload(fileInput, file)

    // Click Dry Run
    const dryRunBtn = screen.getByRole('button', { name: /Uji Validasi \(Dry Run\)/ })
    await userEvent.click(dryRunBtn)

    // Check preview summary & per-row errors
    expect(await screen.findByText('Aturan All-or-Nothing: Impor Ditolak')).toBeInTheDocument()
    expect(screen.getByText('Daya VA harus berupa angka bulat positif.')).toBeInTheDocument()
    expect(screen.getByText('DITOLAK')).toBeInTheDocument()
    expect(screen.getByText('OK')).toBeInTheDocument()

    // Apply button must NOT be present when rejected > 0
    expect(screen.queryByRole('button', { name: /Terapkan & Simpan Draf/ })).not.toBeInTheDocument()
  })

  it('3. performs valid dry run and applies/stores draft tariff book', async () => {
    tariffBooksApi.import
      .mockResolvedValueOnce({
        data: {
          total: 2,
          accepted: 2,
          rejected: 0,
          dry_run: true,
          tariff_book_id: null,
        },
        rows: [
          { row: 1, tariff: 'R1', power_va: 900, ulp: null, status: 'OK', errors: [] },
          { row: 2, tariff: 'R1', power_va: 1300, ulp: null, status: 'OK', errors: [] },
        ],
      })
      .mockResolvedValueOnce({
        data: {
          total: 2,
          accepted: 2,
          rejected: 0,
          dry_run: false,
          tariff_book_id: 'new-book-uuid',
        },
        rows: [],
      })

    renderWithContext(<TariffBooksPage />, {
      can: { 'master_data.view': true, 'tariffs.manage': true },
    })

    await userEvent.click(await screen.findByRole('button', { name: /Impor Buku Tarif/ }))
    await userEvent.type(screen.getByLabelText(/Nama Buku Tarif/), 'Draf Valid 2026')
    const file = new File(['dummy'], 'valid.csv', { type: 'text/csv' })
    await userEvent.upload(document.querySelector('input[type="file"]'), file)

    await userEvent.click(screen.getByRole('button', { name: /Uji Validasi \(Dry Run\)/ }))

    // All rows accepted
    expect(await screen.findByText(/Seluruh baris \(2 item\) telah tervalidasi/)).toBeInTheDocument()

    // Commit button is available
    const applyBtn = screen.getByRole('button', { name: /Terapkan & Simpan Draf/ })
    await userEvent.click(applyBtn)

    await waitFor(() => {
      expect(tariffBooksApi.import).toHaveBeenCalledTimes(2)
    })
  })

  it('lists discarded drafts under the Dibatalkan filter and discards a draft from its detail page', async () => {
    tariffBooksApi.discard.mockResolvedValueOnce({ message: 'Draf buku tarif dibatalkan.' })
    const { unmount } = renderWithContext(<TariffBooksPage />, { can: { 'master_data.view': true, 'tariffs.manage': true } })
    await userEvent.click(await screen.findByText('Dibatalkan'))
    await waitFor(() => expect(tariffBooksApi.list).toHaveBeenCalledWith({ status: 'DISCARDED' }))
    unmount()

    renderWithContext(
      <Routes>
        <Route path="/master-data/tariff-books/:id" element={<TariffBookDetailPage />} />
      </Routes>,
      { can: { 'master_data.view': true, 'tariffs.manage': true }, initialEntries: ['/master-data/tariff-books/tb-draft-1'] },
    )
    await userEvent.click(await screen.findByRole('button', { name: 'Batalkan Draf' }))
    await userEvent.type(await screen.findByLabelText(/Alasan/), 'Jam nyala salah.')
    await userEvent.click(screen.getAllByRole('button', { name: 'Batalkan Draf' }).at(-1))
    await waitFor(() => expect(tariffBooksApi.discard).toHaveBeenCalledWith('tb-draft-1', { reason: 'Jam nyala salah.' }))
  })

  it('4. views tariff book detail with rows pagination, tariff code filter, and audit trail', async () => {
    renderWithContext(
      <Routes>
        <Route path="/master-data/tariff-books/:id" element={<TariffBookDetailPage />} />
      </Routes>,
      {
        can: { 'master_data.view': true },
        initialEntries: ['/master-data/tariff-books/tb-draft-1'],
      },
    )

    expect(await screen.findByText('Buku Tarif Listrik PLN 2026')).toBeInTheDocument()
    expect(screen.getByText('Permen ESDM 01/2026')).toBeInTheDocument()

    // Check rows table
    const r1Items = await screen.findAllByText('R1')
    expect(r1Items.length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('B2')).toBeInTheDocument()
    expect(screen.getByText('ULP-01')).toBeInTheDocument()

    // Check audit trail
    expect(screen.getByText('Riwayat & Audit Trail Buku Tarif')).toBeInTheDocument()
    expect(screen.getByText('IMPORTED')).toBeInTheDocument()
    expect(screen.getByText(/Impor berkas awal/)).toBeInTheDocument()

    // Filter rows by tariff
    const searchInput = screen.getByPlaceholderText(/Cari tarif/)
    await userEvent.type(searchInput, 'R1')
    await userEvent.click(screen.getByRole('button', { name: 'Cari' }))

    expect(tariffBooksApi.rows).toHaveBeenCalledWith(
      'tb-draft-1',
      expect.objectContaining({ tariff: 'R1' }),
    )
  })

  it('discards a wrong DRAFT tariff book with a mandatory reason and sends POST /discard', async () => {
    tariffBooksApi.discard.mockResolvedValueOnce({ message: 'Draf buku tarif dibatalkan.' })
    renderWithContext(<TariffBooksPage />, { can: { 'master_data.view': true, 'tariffs.manage': true, 'tariffs.approve': true } })
    await userEvent.click((await screen.findAllByRole('button', { name: /^Batalkan$/ }))[0])
    expect(await screen.findByText(/Batalkan Draf Buku Tarif: Buku Tarif Listrik PLN 2026/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Batalkan Draf' }))
    expect(await screen.findByText('Alasan wajib diisi.')).toBeInTheDocument()
    expect(tariffBooksApi.discard).not.toHaveBeenCalled()
    await userEvent.type(screen.getByLabelText(/Alasan/), 'Jam nyala salah.')
    await userEvent.click(screen.getByRole('button', { name: 'Batalkan Draf' }))
    await waitFor(() => expect(tariffBooksApi.discard).toHaveBeenCalledWith('tb-draft-1', { reason: 'Jam nyala salah.' }))
  })

  it('5. approves draft book and retires active book with required audit reason', async () => {
    tariffBooksApi.approve.mockResolvedValueOnce({ data: { approved: 1 } })
    tariffBooksApi.retire.mockResolvedValueOnce({ message: 'Buku tarif dinonaktifkan.' })

    renderWithContext(<TariffBooksPage />, {
      can: { 'master_data.view': true, 'tariffs.approve': true },
    })

    // Click Setujui on draft
    const approveBtn = await screen.findByRole('button', { name: /Setujui/ })
    await userEvent.click(approveBtn)

    expect(await screen.findByRole('heading', { name: /Setujui Buku Tarif/ })).toBeInTheDocument()

    // Confirm dialog requires reason
    const confirmBtn = screen.getByRole('button', { name: 'Setujui Buku Tarif' })
    await userEvent.click(confirmBtn)
    expect(screen.getByText('Alasan wajib diisi.')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText(/Alasan/), 'Penetapan resmi SK 2026')
    await userEvent.click(confirmBtn)

    await waitFor(() => {
      expect(tariffBooksApi.approve).toHaveBeenCalledWith({
        book_ids: ['tb-draft-1'],
        reason: 'Penetapan resmi SK 2026',
      })
    })

    // Click Nonaktifkan on approved
    const retireBtn = screen.getByRole('button', { name: /Nonaktifkan/ })
    await userEvent.click(retireBtn)

    expect(await screen.findByRole('heading', { name: /Nonaktifkan Buku Tarif/ })).toBeInTheDocument()
    await userEvent.type(screen.getByLabelText(/Alasan/), 'Digantikan buku 2026')
    await userEvent.click(screen.getByRole('button', { name: 'Nonaktifkan Buku Tarif' }))

    await waitFor(() => {
      expect(tariffBooksApi.retire).toHaveBeenCalledWith('tb-approved-1', {
        reason: 'Digantikan buku 2026',
      })
    })
  })

  it('6. allows downloading tariff book CSV template inside the drawer', async () => {
    renderWithContext(<TariffBooksPage />, {
      can: { 'master_data.view': true, 'tariffs.manage': true },
    })

    await userEvent.click(await screen.findByRole('button', { name: /Impor Buku Tarif/ }))
    const downloadBtn = await screen.findByRole('button', { name: /Unduh Templat CSV/ })
    expect(downloadBtn).toBeInTheDocument()
  })
})
