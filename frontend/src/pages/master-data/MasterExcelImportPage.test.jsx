import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import MasterExcelImportPage from './MasterExcelImportPage.jsx'
import { masterExcelApi, adminApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  masterExcelApi: { list: vi.fn(), get: vi.fn(), upload: vi.fn(), recheck: vi.fn(), apply: vi.fn(), remove: vi.fn() },
  adminApi: { units: vi.fn() },
}))

const CAN = { rab: true, tariff: true, bom: true, price: true, tariffs: true }
const ready = {
  id: 'i-1', kind: 'RAB_KKF', file_name: 'MASTER RAB & KKF.xlsx', size_bytes: 25000000, status: 'READY', created_at: '2026-11-15T10:00:00Z', uploaded_by_name: 'Perencana', applied: {},
  report: {
    bom: { groups: [
      { group: 'SUTM', status: 'CHANGED', excel_lines: 608, current_lines: 608, changed: 2, added: 0, removed: 0, samples: [{ sequence: 12, before: 'H=2', after: 'H=3' }], problems: [], new_codes: [] },
      { group: 'SUTR', status: 'UNCHANGED', excel_lines: 131, current_lines: 131, changed: 0, added: 0, removed: 0, samples: [], problems: [], new_codes: [] },
    ] },
    price: { status: 'CHANGED', excel_rows: 504, current_rows: 523, changed_rows: 3, unchanged_rows: 500, added_in_excel: 0, new_codes: { count: 1, items: ['999'] }, book: 'Kontrak jasa dan material',
      samples: [{ code: 'JTMR1', name: 'Kabel A', fields: [{ field: 'z1_pasang', before: 100, after: 110 }] }], problems: [], note: 'Status PLN dipertahankan.' },
    new_khs: { count: 2, items: [], note: 'Impor lewat halaman KHS.' },
  },
}

function renderPage() {
  return render(<NotificationProvider><MemoryRouter><MasterExcelImportPage /></MemoryRouter></NotificationProvider>)
}

describe('Impor Master dari Excel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminApi.units.mockResolvedValue({ data: [{ id: 'u1', code: '51453', name: 'ULP Jombang', unit_type: 'ULP' }] })
    masterExcelApi.list.mockResolvedValue({ data: [{ ...ready, report: null }], can: CAN, limits: { max_mb: 60 } })
    masterExcelApi.get.mockResolvedValue({ data: ready })
  })

  it('mengunggah Excel, menunggu pemeriksaan, lalu menampilkan perbandingan dan menerapkan hanya yang berubah sebagai DRAFT', async () => {
    masterExcelApi.upload.mockResolvedValue({ data: { ...ready, status: 'PROCESSING', report: null } })
    masterExcelApi.apply.mockResolvedValue({ data: { status: 'OK', message: 'Buku harga DRAFT dibuat.' }, import: { ...ready, applied: { PRICE: { status: 'OK', message: 'Buku harga DRAFT dibuat.', link: '/master-data/harga' } } } })
    renderPage()
    const card = (await screen.findByRole('region', { name: 'Excel RAB & KKF' }))
    const file = new File(['x'.repeat(2000)], 'MASTER RAB & KKF.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    fireEvent.change(within(card).getByLabelText('Berkas Excel RAB & KKF'), { target: { files: [file] } })
    await userEvent.click(within(card).getByRole('button', { name: /Unggah & periksa/i }))
    await waitFor(() => expect(masterExcelApi.upload).toHaveBeenCalledTimes(1))
    const fd = masterExcelApi.upload.mock.calls[0][0]
    expect([fd.get('kind'), fd.get('file').name]).toEqual(['RAB_KKF', 'MASTER RAB & KKF.xlsx'])
    expect(await screen.findByText(/Membaca Excel dan membandingkan/)).toBeInTheDocument()
  })

  it('menampilkan hasil perbandingan per dataset dan menerapkan perubahan harga sebagai DRAFT setelah konfirmasi', async () => {
    masterExcelApi.apply.mockResolvedValue({ data: { status: 'OK', message: 'Buku harga DRAFT dibuat.' }, import: { ...ready, applied: { PRICE: { status: 'OK', message: 'Buku harga DRAFT dibuat (523 baris, 3 berubah).', link: '/master-data/harga' } } } })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Buka' }))
    expect(await screen.findByText('BOM (rumus volume)')).toBeInTheDocument()
    expect(screen.getAllByText('Ada perubahan')).toHaveLength(2)                      // SUTM and the price book
    expect(screen.getByText(/1 kode di Excel belum punya kode baru/)).toBeInTheDocument()
    expect(screen.getByText(/2 KHS baru di Excel tidak diimpor/)).toBeInTheDocument()
    expect(screen.getByLabelText('Terapkan SUTR')).toBeDisabled()                       // unchanged group: nothing to apply
    expect(screen.getByLabelText('Terapkan SUTM')).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'Buat buku harga DRAFT' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Terapkan sebagai DRAFT' }))
    await waitFor(() => expect(masterExcelApi.apply).toHaveBeenCalledTimes(1))
    expect(masterExcelApi.apply.mock.calls[0][0]).toBe('i-1')
    expect(masterExcelApi.apply.mock.calls[0][1]).toMatchObject({ dataset: 'PRICE' })
    expect(await screen.findByText(/Buku harga DRAFT dibuat \(523 baris/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /disetujui akun lain/ })).toHaveAttribute('href', '/master-data/harga')
  })

  it('akun tanpa izin tidak bisa menyiapkan data dan tombol terapkan nonaktif', async () => {
    masterExcelApi.list.mockResolvedValue({ data: [{ ...ready, report: null }], can: { rab: true, tariff: false, bom: false, price: false, tariffs: false }, limits: { max_mb: 60 } })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Buka' }))
    expect(await screen.findByRole('button', { name: 'Buat buku harga DRAFT' })).toBeDisabled()
    expect(screen.getByText(/memerlukan izin kelola harga/)).toBeInTheDocument()
    expect(screen.getByText('Akun Anda tidak berwenang menyiapkan data ini.')).toBeInTheDocument()
  })
})
