import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import PoleWorkOrderFormPage from './PoleWorkOrderFormPage.jsx'
import PoleWorkOrderDetailPage from './PoleWorkOrderDetailPage.jsx'
import { poleWorkOrdersApi, vendorsApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  poleWorkOrdersApi: { list: vi.fn(), candidates: vi.fn(), create: vi.fn(), update: vi.fn(), amend: vi.fn(), get: vi.fn(), issue: vi.fn(), cancel: vi.fn(), uploadLetter: vi.fn(), letterBlob: vi.fn(), submitProgress: vi.fn(), decideProgress: vi.fn(), prepareBastp: vi.fn(), decideBastp: vi.fn() },
  vendorsApi: { list: vi.fn() },
}))

function mount(path, can) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AccessContext.Provider value={{ loading: false, can, canWrite: {}, isSysAdmin: false, createUnits: [] }}>
        <NotificationProvider>
          <Routes>
            <Route path="/wo-tiang/new" element={<PoleWorkOrderFormPage />} />
            <Route path="/wo-tiang/:id/revisi" element={<PoleWorkOrderFormPage mode="revise" />} />
            <Route path="/wo-tiang/:id" element={<PoleWorkOrderDetailPage />} />
          </Routes>
        </NotificationProvider>
      </AccessContext.Provider>
    </MemoryRouter>
  )
}

const lineA = { id: 'l1', allocation_pole_line_id: 'apl1', application_id: 'a1', application_number: 'PB-001', customer_name: 'Budi', kr_number: 'KR-1', pole_type: 'TM', quantity: 4, khs_code: '9', verified_percent: 0 }
const lineB = { ...lineA, id: 'l2', allocation_pole_line_id: 'apl2', application_id: 'a2', application_number: 'PB-002', pole_type: 'TR', quantity: 2 }
const detail = (over = {}) => ({ data: { id: 'w1', letter_number: 'AMS/001', letter_date: '2026-11-12', status: 'ISSUED', vendor_name: 'PT Tiang', vendor_code: 'T1', has_letter: false, lines: [lineA, lineB], progress: [], bastp: [], events: [], ...over } })

describe('WO Tiang', () => {
  beforeEach(() => vi.clearAllMocks())

  it('formulir: satu surat memuat beberapa lokasi dan hanya vendor non-jaringan yang bisa dipilih', async () => {
    poleWorkOrdersApi.candidates.mockResolvedValue({ data: [
      { allocation_pole_line_id: 'apl1', application_number: 'PB-001', customer_name: 'Budi', kr_number: 'KR-1', pole_type: 'TM', quantity: 4 },
      { allocation_pole_line_id: 'apl2', application_number: 'PB-002', customer_name: 'Sari', kr_number: 'KR-1', pole_type: 'TR', quantity: 2 },
    ] })
    vendorsApi.list.mockResolvedValue({ data: [
      { id: 'v1', code: 'T1', name: 'PT Tiang', status: 'ACTIVE', profile: { work_scope: 'TIANG' } },
      { id: 'v2', code: 'J1', name: 'PT Jaringan', status: 'ACTIVE', profile: { work_scope: 'JARINGAN' } },
    ] })
    poleWorkOrdersApi.create.mockResolvedValue({ data: { id: 'w9' } })
    poleWorkOrdersApi.get.mockResolvedValue(detail({ status: 'DRAFT' }))
    mount('/wo-tiang/new', { 'pole_wo.manage': true })
    expect(await screen.findByText('PB-001')).toBeInTheDocument()
    expect(screen.queryByText(/PT Jaringan/)).not.toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Nomor surat/i), { target: { value: 'AMS/777' } })
    fireEvent.click(screen.getByRole('combobox', { name: /Vendor tiang/i }))
    expect(screen.queryByRole('option', { name: /PT Jaringan/ })).not.toBeInTheDocument()   // vendor jaringan tidak ditawarkan
    fireEvent.click(screen.getByRole('option', { name: /PT Tiang/ }))
    fireEvent.click(screen.getByLabelText('Pilih semua baris PB-001'))
    fireEvent.click(screen.getByLabelText('Pilih semua baris PB-002'))
    fireEvent.click(screen.getByRole('button', { name: /Simpan sebagai Draf/i }))
    await waitFor(() => expect(poleWorkOrdersApi.create).toHaveBeenCalledWith(expect.objectContaining({ letter_number: 'AMS/777', vendor_company_id: 'v1', line_ids: expect.arrayContaining(['apl1', 'apl2']) })))
    expect((await screen.findAllByText('AMS/001')).length).toBeGreaterThan(0) // pindah ke halaman detail
  })

  it('formulir: vendor mengikuti Kontrak Rinci, KR beda vendor ditolak, dan KR UP3 lain ditandai limpahan', async () => {
    poleWorkOrdersApi.candidates.mockResolvedValue({ data: [
      { allocation_pole_line_id: 'apl1', application_number: 'PB-001', kr_number: 'KR-1', kr_vendor_id: 'v1', kr_vendor_name: 'PT Tiang', from_other_up3: true, kr_up3_name: 'UP3 Madiun', pole_type: 'TM', quantity: 4 },
      { allocation_pole_line_id: 'apl2', application_number: 'PB-002', kr_number: 'KR-2', kr_vendor_id: 'v2', kr_vendor_name: 'PT Lain', pole_type: 'TR', quantity: 2 },
    ] })
    vendorsApi.list.mockResolvedValue({ data: [{ id: 'v1', code: 'T1', name: 'PT Tiang', status: 'ACTIVE', profile: { work_scope: 'TIANG' } }, { id: 'v2', code: 'T2', name: 'PT Lain', status: 'ACTIVE', profile: { work_scope: 'TIANG' } }] })
    poleWorkOrdersApi.create.mockResolvedValue({ data: { id: 'w9' } })
    poleWorkOrdersApi.get.mockResolvedValue(detail({ status: 'DRAFT' }))
    mount('/wo-tiang/new', { 'pole_wo.manage': true })
    expect(await screen.findByText(/Limpahan dari UP3 Madiun/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText(/Nomor surat/i), { target: { value: 'AMS/9' } })
    fireEvent.click(screen.getByLabelText('Pilih semua baris PB-001'))
    expect(await screen.findByText('Mengikuti vendor Kontrak Rinci.')).toBeInTheDocument()   // vendor follows the KR, no vendor select
    expect(screen.queryByLabelText(/Vendor tiang \*/i)).not.toBeInTheDocument()
    fireEvent.click(screen.getByLabelText('Pilih semua baris PB-002'))
    expect(await screen.findByText(/milik vendor berbeda/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Simpan sebagai Draf/i })).toBeDisabled()
    fireEvent.click(screen.getByLabelText('Pilih semua baris PB-002'))
    fireEvent.click(screen.getByRole('button', { name: /Simpan sebagai Draf/i }))
    await waitFor(() => expect(poleWorkOrdersApi.create).toHaveBeenCalledWith(expect.not.objectContaining({ vendor_company_id: expect.anything() })))
  })

  it('formulir: kondisi tiang dan asal dicatat per baris terpilih dan ikut terkirim', async () => {
    poleWorkOrdersApi.candidates.mockResolvedValue({ data: [{ allocation_pole_line_id: 'apl1', application_number: 'PB-001', kr_number: 'KR-1', pole_type: 'TM', quantity: 4 }] })
    vendorsApi.list.mockResolvedValue({ data: [{ id: 'v1', code: 'T1', name: 'PT Tiang', status: 'ACTIVE', profile: { work_scope: 'TIANG' } }] })
    poleWorkOrdersApi.create.mockResolvedValue({ data: { id: 'w9' } })
    poleWorkOrdersApi.get.mockResolvedValue(detail({ status: 'DRAFT' }))
    mount('/wo-tiang/new', { 'pole_wo.manage': true })
    expect(await screen.findByText('PB-001')).toBeInTheDocument()
    expect(screen.queryByLabelText(/Kondisi tiang PB-001/i)).not.toBeInTheDocument()   // only for selected rows
    fireEvent.change(screen.getByLabelText(/Nomor surat/i), { target: { value: 'AMS/5' } })
    fireEvent.click(screen.getByRole('combobox', { name: /Vendor tiang/i }))
    fireEvent.click(screen.getByRole('option', { name: /PT Tiang/ }))
    fireEvent.click(screen.getByLabelText('Pilih semua baris PB-001'))
    fireEvent.change(await screen.findByLabelText(/Kondisi tiang PB-001/i), { target: { value: 'BEKAS' } })
    fireEvent.change(screen.getByLabelText(/Asal tiang PB-001/i), { target: { value: 'pakai tiang bekas Handal' } })
    fireEvent.click(screen.getByRole('button', { name: /Simpan sebagai Draf/i }))
    await waitFor(() => expect(poleWorkOrdersApi.create).toHaveBeenCalledWith(expect.objectContaining({ line_meta: { apl1: { condition: 'BEKAS', note: 'pakai tiang bekas Handal' } } })))
  })

  it('revisi: nomor surat terkunci, lokasi ber-progres tidak bisa dicoret, alasan wajib, lalu amend dikirim', async () => {
    poleWorkOrdersApi.get.mockResolvedValue(detail({ status: 'IN_PROGRESS', revision_number: 0, vendor_company_id: 'v1', progress: [{ id: 'p1', line_id: 'l1', cumulative_percent: 50, status: 'VERIFIED' }],
      lines: [{ ...lineA, verified_percent: 50, pole_condition: 'BARU' }, { ...lineB, pole_condition: 'BARU' }] }))
    poleWorkOrdersApi.candidates.mockResolvedValue({ data: [{ allocation_pole_line_id: 'apl3', application_number: 'PB-003', kr_number: 'KR-1', pole_type: 'TM', quantity: 1 }] })
    vendorsApi.list.mockResolvedValue({ data: [{ id: 'v1', code: 'T1', name: 'PT Tiang', status: 'ACTIVE', profile: { work_scope: 'TIANG' } }] })
    poleWorkOrdersApi.amend.mockResolvedValue({ data: { revision_number: 1 } })
    mount('/wo-tiang/w1/revisi', { 'pole_wo.manage': true })
    expect(await screen.findByText('PB-003')).toBeInTheDocument()
    expect(screen.getByLabelText(/Nomor surat \(dari AMS\)/i)).toBeDisabled()                                   // the letter number never changes
    expect(screen.getByLabelText('PB-001 KR-1 TM')).toBeDisabled()                                 // a location with progress is locked
    expect(screen.getByText(/sudah ada progres/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Simpan Revisi/i })).toBeDisabled()                  // the reason is required
    fireEvent.click(screen.getByLabelText('PB-002 KR-1 TR'))                                       // drop the second location
    fireEvent.click(screen.getByLabelText('PB-003 KR-1 TM'))                                       // add a new one
    fireEvent.change(screen.getByLabelText(/Alasan revisi/i), { target: { value: 'KR habis, lokasi dipindah' } })
    fireEvent.click(screen.getByRole('button', { name: /Simpan Revisi/i }))
    await waitFor(() => expect(poleWorkOrdersApi.amend).toHaveBeenCalledWith('w1', expect.objectContaining({ reason: 'KR habis, lokasi dipindah', line_ids: expect.arrayContaining(['apl1', 'apl3']) })))
    expect(poleWorkOrdersApi.amend.mock.calls[0][1].line_ids).not.toContain('apl2')
  })

  it('detail: tombol Revisi hanya untuk Perencanaan pada WO berjalan tanpa BASTP menunggu; badge revisi dan riwayat tampil', async () => {
    poleWorkOrdersApi.get.mockResolvedValue(detail({ status: 'IN_PROGRESS', revision_number: 2, revisions: [{ revision_number: 1, reason: 'lokasi dicoret', added: 0, removed: 1, changed: 0, created_at: '2026-11-13T00:00:00Z', actor_name: 'Rina' }] }))
    const first = mount('/wo-tiang/w1', { 'vendor.portal': true })
    expect(await screen.findByText('Revisi 2')).toBeInTheDocument()
    expect(screen.getByText(/lokasi dicoret/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Revisi' })).not.toBeInTheDocument()               // the vendor cannot revise
    first.unmount()
    mount('/wo-tiang/w1', { 'pole_wo.manage': true })
    expect(await screen.findByRole('button', { name: 'Revisi' })).toBeInTheDocument()
  })

  it('detail (Perencanaan): tidak bisa melaporkan progres atas nama pabrikan, hanya memverifikasi', async () => {
    poleWorkOrdersApi.get.mockResolvedValue(detail({ status: 'IN_PROGRESS' }))
    mount('/wo-tiang/w1', { 'pole_wo.manage': true })
    expect(await screen.findByText('PB-001')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Laporkan progres/i })).not.toBeInTheDocument()
  })

  it('detail (vendor): melaporkan progres dengan tanggal; vendor tidak melihat tombol verifikasi', async () => {
    poleWorkOrdersApi.get.mockResolvedValue(detail())
    poleWorkOrdersApi.submitProgress.mockResolvedValue({ data: { id: 'p1' } })
    mount('/wo-tiang/w1', { 'vendor.portal': true })
    expect(await screen.findByText('PB-001')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Terbitkan|Batalkan|Verifikasi/i })).not.toBeInTheDocument()
    fireEvent.click(screen.getAllByRole('button', { name: /Laporkan progres/i })[0])
    fireEvent.change(screen.getByLabelText(/Progres kumulatif/i), { target: { value: '100' } })
    fireEvent.click(screen.getByRole('button', { name: 'Simpan' }))
    await waitFor(() => expect(poleWorkOrdersApi.submitProgress).toHaveBeenCalledWith('w1', expect.objectContaining({ line_id: 'l1', cumulative_percent: 100, work_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), submission_key: expect.any(String) })))
  })

  it('detail (Perencanaan): memverifikasi progres menunggu; BASTP baru muncul setelah semua lokasi 100%', async () => {
    const pending = { id: 'p1', line_id: 'l1', cumulative_percent: 100, work_date: '2026-11-12', status: 'SUBMITTED' }
    poleWorkOrdersApi.get.mockResolvedValueOnce(detail({ status: 'IN_PROGRESS', progress: [pending] }))
    poleWorkOrdersApi.decideProgress.mockResolvedValue({ message: 'ok' })
    mount('/wo-tiang/w1', { 'pole_wo.manage': true, 'pole_wo.view': true })
    expect(await screen.findByText(/Menunggu verifikasi: 100%/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Buat BASTP/i })).not.toBeInTheDocument()
    poleWorkOrdersApi.get.mockResolvedValue(detail({ status: 'IN_PROGRESS', lines: [{ ...lineA, verified_percent: 100 }, { ...lineB, verified_percent: 100 }] }))
    fireEvent.click(screen.getByRole('button', { name: 'Verifikasi' }))
    await waitFor(() => expect(poleWorkOrdersApi.decideProgress).toHaveBeenCalledWith('p1', { decision: 'VERIFIED' }))
    expect(await screen.findByRole('button', { name: /Buat BASTP/i })).toBeInTheDocument()
  })

  it('detail: hanya Asman Perencanaan (pole_wo.close) yang bisa menutup BASTP', async () => {
    const bastp = [{ id: 'b1', bastp_number: 'BASTP-1', bastp_date: '2026-11-12', status: 'SUBMITTED', prepared_by_name: 'Rina' }]
    poleWorkOrdersApi.get.mockResolvedValue(detail({ status: 'IN_PROGRESS', bastp, lines: [{ ...lineA, verified_percent: 100 }] }))
    const { unmount } = mount('/wo-tiang/w1', { 'pole_wo.manage': true })
    expect(await screen.findByText('BASTP-1')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Tutup BASTP/i })).not.toBeInTheDocument()
    unmount()
    poleWorkOrdersApi.decideBastp.mockResolvedValue({ message: 'ok' })
    mount('/wo-tiang/w1', { 'pole_wo.close': true })
    fireEvent.click(await screen.findByRole('button', { name: /Tutup BASTP/i }))
    await waitFor(() => expect(poleWorkOrdersApi.decideBastp).toHaveBeenCalledWith('b1', { decision: 'CLOSE' }))
  })
})
