import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import KhsMaterialMapPage from './KhsMaterialMapPage.jsx'
import { khsMaterialMapApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  khsMaterialMapApi: {
    list: vi.fn(),
    workbench: vi.fn(),
    suggestions: vi.fn(),
    coverage: vi.fn(),
    create: vi.fn(),
    importCsv: vi.fn(),
    delete: vi.fn(),
    exempt: vi.fn(),
    liftExempt: vi.fn(),
  },
}))

const HINT_TEXT = /Hanya material berstatus PLN yang perlu SKU ERP/i

function renderPage(can = { 'khs.manage': true, 'master_data.view': true }) {
  return render(
    <AccessContext.Provider
      value={{ loading: false, can, canWrite: {}, isSysAdmin: false }}
    >
      <NotificationProvider>
        <MemoryRouter>
          <KhsMaterialMapPage />
        </MemoryRouter>
      </NotificationProvider>
    </AccessContext.Provider>,
  )
}

const rows = [
  { khs_code: '101', name: 'Trafo Distribusi 100 kVA', unit: 'BH', used_in_bom: true, material_status: 'PLN', sku_exempt: false, mapped: [] },
  { khs_code: '202', name: 'Konektor Vendor', unit: 'BH', used_in_bom: true, material_status: 'PRICED', sku_exempt: false, mapped: [] },
  { khs_code: '303', name: 'Item Tanpa Buku Harga', unit: 'BH', used_in_bom: true, material_status: null, sku_exempt: false, mapped: [] },
  { khs_code: '187', name: 'Kubikel Paket KHS 187', unit: 'SET', used_in_bom: true, material_status: 'PLN', sku_exempt: true, exempt_reason: 'Diminta setelah pelanggan bayar', mapped: [] },
]

describe('KhsMaterialMapPage — filter Butuh SKU (material PLN)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    khsMaterialMapApi.coverage.mockResolvedValue({
      data: { sku_needed_total: 43, sku_needed_mapped: 5, sku_needed_percent: 11.6, khs_used_total: 196, khs_used_mapped: 20, khs_used_percent: 10.2 },
    })
    khsMaterialMapApi.workbench.mockResolvedValue({ data: rows, meta: { total: 3 } })
    khsMaterialMapApi.suggestions.mockResolvedValue({ data: [] })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('1. membuka dengan supply=pln, used=1, filter=unmapped', async () => {
    renderPage()
    await waitFor(() => expect(khsMaterialMapApi.workbench).toHaveBeenCalled())
    const args = khsMaterialMapApi.workbench.mock.calls[0][0]
    expect(args.supply).toBe('pln')
    expect(args.used).toBe(1)
    expect(args.filter).toBe('unmapped')
    expect(args.page).toBe(1)
  })

  it('2. mematikan filter PLN memanggil ulang tanpa supply dan kembali ke halaman 1', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Total 3 item')).toBeInTheDocument())

    await userEvent.click(screen.getByRole('checkbox', { name: /Butuh SKU \(material PLN\)/i }))

    await waitFor(() => {
      const last = khsMaterialMapApi.workbench.mock.calls.at(-1)[0]
      expect(last.supply).toBeUndefined()
      expect(last.page).toBe(1)
    })
  })

  it('3. kartu ringkasan menampilkan "5 dari 43" dan total 0 menjadi "0 dari 0"', async () => {
    const { unmount } = renderPage()
    await waitFor(() => {
      expect(screen.getByText('5 dari 43')).toBeInTheDocument()
      expect(screen.getByText('(11.6%)')).toBeInTheDocument()
      expect(screen.getByText(/Semua KHS dipakai BOM: 20 dari 196/i)).toBeInTheDocument()
    })
    unmount()

    khsMaterialMapApi.coverage.mockResolvedValue({
      data: { sku_needed_total: 0, sku_needed_mapped: 0, sku_needed_percent: 0 },
    })
    renderPage()
    await waitFor(() => expect(screen.getByText('0 dari 0')).toBeInTheDocument())
  })

  it('4. badge PLN/PRICED benar, null tanpa badge, dan catatan netral pada detail PRICED', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText('Konektor Vendor')).toBeInTheDocument())

    expect(screen.getAllByText(/PLN · Butuh SKU/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/PRICED · Tidak butuh SKU ERP/).length).toBe(1)

    // Baris null: sel Pasokan kosong
    const nullRow = screen.getByText('Item Tanpa Buku Harga').closest('tr')
    expect(nullRow.textContent).not.toMatch(/PLN|PRICED/)

    expect(screen.queryByText(/Material ini dibeli vendor/i)).not.toBeInTheDocument()
    await userEvent.click(screen.getByText('Konektor Vendor'))
    expect(
      await screen.findByText('Material ini dibeli vendor; pemetaan SKU biasanya tidak diperlukan.'),
    ).toBeInTheDocument()
  })

  it('5a. galat server 422 ditampilkan apa adanya', async () => {
    khsMaterialMapApi.workbench.mockRejectedValue({ status: 422, message: 'Nilai supply tidak valid.' })
    renderPage()
    expect(await screen.findByText('Nilai supply tidak valid.')).toBeInTheDocument()
  })

  it('5b. teks bantuan dapat ditutup dan pilihan tersimpan di localStorage', async () => {
    renderPage()
    expect(await screen.findByText(HINT_TEXT)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Tutup teks bantuan/i }))
    expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument()
    expect(window.localStorage.getItem('distriva.khs_map.hide_supply_hint.v1')).toBe('1')
  })

  it('5c. tidak merusak render bila localStorage melempar galat', async () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('blocked')
    })
    renderPage()
    expect(await screen.findByText(HINT_TEXT)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /Tutup teks bantuan/i }))
    expect(screen.queryByText(HINT_TEXT)).not.toBeInTheDocument()
  })

  it('6. dialog kecualikan/cabut mengirim alasan, menolak kosong, dan menampilkan 409 verbatim; tombol tidak muncul tanpa khs.manage', async () => {
    const { unmount: unmountManager } = renderPage()
    await waitFor(() => expect(screen.getAllByText('Trafo Distribusi 100 kVA').length).toBeGreaterThan(0))

    // 1. Kecualikan: buka dialog pada item 101
    const exemptBtn = screen.getByRole('button', { name: 'Kecualikan dari pemetaan' })
    await userEvent.click(exemptBtn)

    expect(screen.getByText(/Kecualikan KHS 101 dari Pemetaan/i)).toBeInTheDocument()
    const confirmBtn = screen.getByRole('button', { name: 'Kecualikan' })

    // Klik tanpa mengisi alasan -> ditolak dengan pesan wajib
    await userEvent.click(confirmBtn)
    expect(await screen.findByText('Alasan wajib diisi.')).toBeInTheDocument()
    expect(khsMaterialMapApi.exempt).not.toHaveBeenCalled()

    // Isi alasan
    const reasonInput = screen.getByPlaceholderText(/Masukkan alasan/i)
    await userEvent.type(reasonInput, 'Barang dipesan khusus setelah bayar')

    // Error 409 dari server tampil verbatim
    khsMaterialMapApi.exempt.mockRejectedValueOnce({ message: 'KHS sudah dikecualikan atau sudah punya pemetaan.' })
    await userEvent.click(confirmBtn)
    expect(await screen.findByText('KHS sudah dikecualikan atau sudah punya pemetaan.')).toBeInTheDocument()

    // Sukses mengecualikan
    khsMaterialMapApi.exempt.mockResolvedValueOnce({ data: { id: 'ex-101' } })
    await userEvent.click(confirmBtn)
    await waitFor(() => {
      expect(khsMaterialMapApi.exempt).toHaveBeenCalledWith({
        khs_code: '101',
        reason: 'Barang dipesan khusus setelah bayar',
      })
    })

    // 2. Cabut pengecualian pada item 187
    await userEvent.click(screen.getByText('Kubikel Paket KHS 187'))
    expect(screen.getAllByText('Dikecualikan').length).toBeGreaterThan(0)
    expect(screen.getAllByText(/Diminta setelah pelanggan bayar/i).length).toBeGreaterThan(0)

    const liftBtn = screen.getAllByRole('button', { name: 'Cabut pengecualian' })[0]
    await userEvent.click(liftBtn)

    expect(screen.getByText(/Cabut Pengecualian KHS 187/i)).toBeInTheDocument()
    const confirmLiftBtn = screen.getByRole('button', { name: 'Cabut Pengecualian' })

    // Validasi kosong
    await userEvent.click(confirmLiftBtn)
    expect(await screen.findByText('Alasan wajib diisi.')).toBeInTheDocument()
    expect(khsMaterialMapApi.liftExempt).not.toHaveBeenCalled()

    // Isi alasan cabut
    const liftReasonInput = screen.getByPlaceholderText(/Masukkan alasan/i)
    await userEvent.type(liftReasonInput, 'Kini perlu SKU ERP untuk logistik')

    // 409 tampil verbatim
    khsMaterialMapApi.liftExempt.mockRejectedValueOnce({ message: 'Pengecualian tidak ditemukan atau sudah dicabut.' })
    await userEvent.click(confirmLiftBtn)
    expect(await screen.findByText('Pengecualian tidak ditemukan atau sudah dicabut.')).toBeInTheDocument()

    // Sukses cabut
    khsMaterialMapApi.liftExempt.mockResolvedValueOnce({ message: 'Pengecualian dicabut.' })
    await userEvent.click(confirmLiftBtn)
    await waitFor(() => {
      expect(khsMaterialMapApi.liftExempt).toHaveBeenCalledWith('187', {
        reason: 'Kini perlu SKU ERP untuk logistik',
      })
    })

    unmountManager()

    // 3. User tanpa izin khs.manage: tombol kecualikan dan cabut tidak muncul
    const { unmount: unmountViewer } = renderPage({ 'khs.manage': false, 'master_data.view': true })
    await waitFor(() => expect(screen.getAllByText('Trafo Distribusi 100 kVA').length).toBeGreaterThan(0))
    expect(screen.queryByRole('button', { name: 'Kecualikan dari pemetaan' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Cabut pengecualian' })).not.toBeInTheDocument()
    unmountViewer()
  })

  it('7. filter "Tampilkan yang dikecualikan" memanggil tanpa supply dan dengan filter=unmapped', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByText(/Total \d+ item/)).toBeInTheDocument())

    const exemptCheckbox = screen.getByRole('checkbox', { name: /Tampilkan yang dikecualikan/i })
    await userEvent.click(exemptCheckbox)

    await waitFor(() => {
      const lastCall = khsMaterialMapApi.workbench.mock.calls.at(-1)[0]
      expect(lastCall.filter).toBe('unmapped')
      expect(lastCall.supply).toBeUndefined()
      expect(lastCall.page).toBe(1)
    })
  })
})
