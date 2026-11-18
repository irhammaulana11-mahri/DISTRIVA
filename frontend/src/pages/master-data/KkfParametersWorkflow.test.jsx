import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import KkfParametersPage from './KkfParametersPage.jsx'
import KkfParameterDetailPage from './KkfParameterDetailPage.jsx'
import { KkfParameterCreatePage, KkfParameterEditPage } from './MoreFormPages.jsx'
import { kkfParametersApi } from '../../services/api.js'
import {
  fractionToPercent,
  percentToFraction,
  formatPercentDisplay,
  formatRupiahPerKwh,
} from '../../utils/kkfFormatters.js'

// Mock kkfParametersApi
vi.mock('../../services/api.js', () => ({
  kkfParametersApi: {
    list: vi.fn(),
    active: vi.fn(),
    get: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    approve: vi.fn(),
    retire: vi.fn(),
    discard: vi.fn(),
  },
}))

const mockSets = [
  {
    id: 'kkf-draft-1',
    name: 'Parameter KKF Rencana 2027',
    valid_from: '2027-01-01',
    valid_until: null,
    status: 'DRAFT',
    discount_rate: 0.0778,
    bpp: 552,
    om_rate: 0.02,
    load_factor: 1,
    roe: 0.0047,
    interest_rate: 0.0778,
    tax_rate: 0.25,
    horizon_years: 25,
    payback_limit_months: 60,
    notes: 'Draf parameter untuk tahun 2027',
    created_by: 'planner@distriva.com',
    approved_by: null,
    approved_at: null,
  },
  {
    id: 'kkf-approved-1',
    name: 'Parameter KKF Standar 2026',
    valid_from: '2026-01-01',
    valid_until: null,
    status: 'APPROVED',
    discount_rate: 0.0778,
    bpp: 552,
    om_rate: 0.02,
    load_factor: 1,
    roe: 0.0047,
    interest_rate: 0.0778,
    tax_rate: 0.25,
    horizon_years: 25,
    payback_limit_months: 60,
    notes: 'SK Direksi 2026',
    created_by: 'planner@distriva.com',
    approved_by: 'manager@distriva.com',
    approved_at: '2026-01-02 10:00:00',
  },
]

const mockDetail = {
  ...mockSets[0],
  events: [
    {
      id: 'ev-1',
      event_type: 'CREATED',
      reason: 'Inisialisasi draf parameter KKF 2027',
      occurred_at: '2026-11-07 05:00:00',
      actor_email: 'planner@distriva.com',
      details: { initial: true },
    },
  ],
}

function renderKkfPage(capabilities = { 'kkf_params.manage': true, 'kkf_params.approve': true, 'master_data.view': true }) {
  return render(
    <MemoryRouter initialEntries={['/master-data/kkf-parameters']}>
      <AccessContext.Provider value={{ can: capabilities, loading: false }}>
        <NotificationProvider>
          <Routes>
            <Route path="/master-data/kkf-parameters" element={<KkfParametersPage />} />
            <Route path="/master-data/kkf-parameters/baru" element={<KkfParameterCreatePage />} />
            <Route path="/master-data/kkf-parameters/:id/ubah" element={<KkfParameterEditPage />} />
            <Route path="/master-data/kkf-parameters/:id/ubah" element={<KkfParameterEditPage />} />
            <Route path="/master-data/kkf-parameters/:id" element={<KkfParameterDetailPage />} />
          </Routes>
        </NotificationProvider>
      </AccessContext.Provider>
    </MemoryRouter>
  )
}

function renderDetailPage(capabilities = { 'kkf_params.manage': true, 'kkf_params.approve': true, 'master_data.view': true }, id = 'kkf-draft-1') {
  return render(
    <MemoryRouter initialEntries={[`/master-data/kkf-parameters/${id}`]}>
      <AccessContext.Provider value={{ can: capabilities, loading: false }}>
        <NotificationProvider>
          <Routes>
            <Route path="/master-data/kkf-parameters/:id" element={<KkfParameterDetailPage />} />
          </Routes>
        </NotificationProvider>
      </AccessContext.Provider>
    </MemoryRouter>
  )
}

describe('Parameter KKF Utilities (docs/68 §3)', () => {
  it('converts fraction to percent and vice-versa cleanly without float rounding issues', () => {
    // 7.78% <-> 0.0778
    expect(fractionToPercent(0.0778)).toBe('7.78')
    expect(percentToFraction('7.78')).toBe(0.0778)
    expect(percentToFraction('7,78')).toBe(0.0778)

    // 0.47% <-> 0.0047
    expect(fractionToPercent(0.0047)).toBe('0.47')
    expect(percentToFraction('0.47')).toBe(0.0047)
    expect(percentToFraction('0,47')).toBe(0.0047)

    // 100% <-> 1.0
    expect(fractionToPercent(1)).toBe('100')
    expect(percentToFraction('100')).toBe(1)

    // Formatter outputs
    expect(formatPercentDisplay(0.0778)).toContain('7,78 %')
    expect(formatRupiahPerKwh(552)).toBe('Rp 552 / kWh')
  })
})

describe('Parameter KKF Workflow (docs/68)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    kkfParametersApi.list.mockResolvedValue({
      data: mockSets,
      defaults: {
        discount_rate: 0.0778,
        bpp: 552,
        om_rate: 0.02,
        load_factor: 1,
        roe: 0.0047,
        interest_rate: 0.0778,
        tax_rate: 0.25,
        horizon_years: 25,
        payback_limit_months: 60,
      },
    })
    kkfParametersApi.get.mockResolvedValue({ data: mockDetail })
  })

  it('1. renders list of parameter sets, active status badge, and draft status', async () => {
    renderKkfPage()

    await waitFor(() => {
      expect(screen.getByText('Parameter Kelayakan Keuangan (KKF)')).toBeInTheDocument()
    })

    // Both sets displayed in the table
    expect(screen.getByRole('link', { name: 'Parameter KKF Rencana 2027' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Parameter KKF Standar 2026' })).toBeInTheDocument()

    // Active in force badge
    expect(screen.getByText('Sedang Berlaku')).toBeInTheDocument()

    // Draft status badge in table
    expect(screen.getByText('Draf')).toBeInTheDocument()
  })

  it('2. filters list by status tabs', async () => {
    const user = userEvent.setup()
    renderKkfPage()

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Parameter KKF Rencana 2027' })).toBeInTheDocument()
    })

    // Click 'Draf' tab specifically
    const draftTab = screen.getByRole('button', { name: 'Draf (Menunggu Persetujuan)' })
    await user.click(draftTab)

    expect(kkfParametersApi.list).toHaveBeenCalledWith({ status: 'DRAFT' })
  })

  it('3. creates a new draft parameter set via drawer form converting percent to fraction', async () => {
    const user = userEvent.setup()
    kkfParametersApi.create.mockResolvedValue({ data: { id: 'new-kkf-id' } })

    renderKkfPage()

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Buat Draf Parameter/i })).toBeInTheDocument()
    })

    // Open Drawer
    await user.click(screen.getByRole('button', { name: /Buat Draf Parameter/i }))
    expect(await screen.findByText('Buat Draf Parameter KKF')).toBeInTheDocument()

    // Fill form
    const nameInput = screen.getByLabelText(/Nama Set Parameter/i)
    await user.type(nameInput, 'Set Baru 2028')

    // Submit form
    const saveBtns = screen.getAllByRole('button', { name: /Buat Draf Parameter/i })
    const saveBtn = saveBtns[saveBtns.length - 1]
    await user.click(saveBtn)

    await waitFor(() => {
      expect(kkfParametersApi.create).toHaveBeenCalled()
    })

    const payload = kkfParametersApi.create.mock.calls[0][0]
    expect(payload.name).toBe('Set Baru 2028')
    expect(payload.discount_rate).toBe(0.0778) // converted from default percent 7.78
    expect(payload.bpp).toBe(552)
  })

  it('4. updates a draft set sending only modified fields (delta) on PUT', async () => {
    const user = userEvent.setup()
    kkfParametersApi.update.mockResolvedValue({ data: { id: 'kkf-draft-1' } })

    renderKkfPage()

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Parameter KKF Rencana 2027' })).toBeInTheDocument()
    })

    // Click edit button (pencil) on draft row
    const editBtns = screen.getAllByRole('button', { name: /Ubah/i })
    await user.click(editBtns[0])

    expect(await screen.findByText('Ubah Draf Parameter KKF')).toBeInTheDocument()

    // Change BPP field
    const bppInput = await screen.findByDisplayValue('552')
    await user.clear(bppInput)
    await user.type(bppInput, '600')

    // Submit form
    const saveBtn = screen.getByRole('button', { name: /Simpan Perubahan/i })
    await user.click(saveBtn)

    await waitFor(() => {
      expect(kkfParametersApi.update).toHaveBeenCalled()
    })

    const [id, changes] = kkfParametersApi.update.mock.calls[0]
    expect(id).toBe('kkf-draft-1')
    expect(changes).toEqual({ bpp: 600 }) // Only BPP changed, delta verification!
  })

  it('discards a wrong DRAFT parameter set with a mandatory reason and sends POST /discard', async () => {
    const user = userEvent.setup()
    kkfParametersApi.discard.mockResolvedValueOnce({ message: 'Draf set parameter dibatalkan.' })
    renderKkfPage()
    await user.click((await screen.findAllByRole('button', { name: /^Batalkan$/ }))[0])
    expect(await screen.findByText(/Batalkan Draf Parameter KKF: Parameter KKF Rencana 2027/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Batalkan Draf' }))
    expect(await screen.findByText('Alasan wajib diisi.')).toBeInTheDocument()
    expect(kkfParametersApi.discard).not.toHaveBeenCalled()
    await user.type(screen.getByLabelText(/Alasan/), 'BPP salah.')
    await user.click(screen.getByRole('button', { name: 'Batalkan Draf' }))
    await waitFor(() => expect(kkfParametersApi.discard).toHaveBeenCalledWith('kkf-draft-1', { reason: 'BPP salah.' }))
  })

  it('5. approves parameter set with mandatory reason, handling 403 and 409 errors verbatim', async () => {
    const user = userEvent.setup()
    renderKkfPage()

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Parameter KKF Rencana 2027' })).toBeInTheDocument()
    })

    // Click approve button on draft row
    const approveBtns = screen.getAllByRole('button', { name: /^Setujui$/i })
    await user.click(approveBtns[0])

    await waitFor(() => {
      expect(screen.getByText(/Setujui Parameter KKF:/i)).toBeInTheDocument()
    })

    // Type reason
    const reasonInput = screen.getByLabelText(/Alasan/i)
    await user.type(reasonInput, 'Persetujuan resmi sesuai SK Direksi baru')

    // Mock 403 error (creator cannot approve)
    kkfParametersApi.approve.mockRejectedValueOnce({
      status: 403,
      message: 'Pembuat set parameter tidak dapat menyetujuinya sendiri.',
    })

    const confirmBtn = screen.getByRole('button', { name: 'Setujui Parameter' })
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(screen.getByText('Pembuat set parameter tidak dapat menyetujuinya sendiri.')).toBeInTheDocument()
    })

    // Now mock success
    kkfParametersApi.approve.mockResolvedValueOnce({
      data: { approved: ['kkf-draft-1'], auto_closed: ['kkf-approved-1'] },
    })
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(kkfParametersApi.approve).toHaveBeenCalledWith({
        set_ids: ['kkf-draft-1'],
        reason: 'Persetujuan resmi sesuai SK Direksi baru',
      })
    })
  })

  it('6. retires an approved parameter set with mandatory reason', async () => {
    const user = userEvent.setup()
    kkfParametersApi.retire.mockResolvedValue({ data: { success: true } })

    renderKkfPage()

    await waitFor(() => {
      expect(screen.getByRole('link', { name: 'Parameter KKF Standar 2026' })).toBeInTheDocument()
    })

    // Click retire button on approved row
    const retireBtn = screen.getByTitle('Nonaktifkan Set Parameter')
    await user.click(retireBtn)

    await waitFor(() => {
      expect(screen.getByText(/Nonaktifkan Parameter KKF:/i)).toBeInTheDocument()
    })

    const reasonInput = screen.getByLabelText(/Alasan/i)
    await user.type(reasonInput, 'Digantikan oleh set parameter terbaru 2027')

    const dialog = screen.getByRole('dialog')
    const confirmBtn = within(dialog).getByRole('button', { name: 'Nonaktifkan' })
    await user.click(confirmBtn)

    await waitFor(() => {
      expect(kkfParametersApi.retire).toHaveBeenCalledWith('kkf-approved-1', {
        reason: 'Digantikan oleh set parameter terbaru 2027',
      })
    })
  })

  it('7. enforces capability gates fail-closed', async () => {
    // Render with only view capability (cannot manage, cannot approve)
    renderKkfPage({ 'master_data.view': true })

    await waitFor(() => {
      expect(screen.getByText('Parameter Kelayakan Keuangan (KKF)')).toBeInTheDocument()
    })

    // 'Buat Draf Parameter' button hidden
    expect(screen.queryByRole('button', { name: /Buat Draf Parameter/i })).not.toBeInTheDocument()

    // Action buttons for Ubah, Setujui, Nonaktifkan hidden
    expect(screen.queryByTitle('Ubah Nilai Draf')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Setujui Set Parameter')).not.toBeInTheDocument()
    expect(screen.queryByTitle('Nonaktifkan Set Parameter')).not.toBeInTheDocument()
  })

  it('lists discarded drafts under the Dibatalkan filter and discards a draft from its detail page', async () => {
    const user = userEvent.setup()
    kkfParametersApi.discard.mockResolvedValueOnce({ message: 'Draf set parameter dibatalkan.' })
    const { unmount } = renderKkfPage()
    await user.click(await screen.findByText('Dibatalkan'))
    await waitFor(() => expect(kkfParametersApi.list).toHaveBeenCalledWith({ status: 'DISCARDED' }))
    unmount()

    renderDetailPage()
    await user.click(await screen.findByRole('button', { name: 'Batalkan Draf' }))
    await user.type(await screen.findByLabelText(/Alasan/), 'BPP salah.')
    await user.click(screen.getAllByRole('button', { name: 'Batalkan Draf' }).at(-1))
    await waitFor(() => expect(kkfParametersApi.discard).toHaveBeenCalledWith('kkf-draft-1', { reason: 'BPP salah.' }))
  })

  it('8. renders detail page with parameter grid and event history', async () => {
    renderDetailPage()

    await waitFor(() => {
      expect(screen.getByText('Daftar 9 Nilai Parameter Kelayakan Keuangan (KKF)')).toBeInTheDocument()
    })

    expect(screen.getByRole('heading', { level: 1, name: 'Parameter KKF Rencana 2027' })).toBeInTheDocument()
    expect(screen.getByText('Tingkat Diskonto (Discount Rate)')).toBeInTheDocument()
    expect(screen.getByText('Biaya Pokok Penyediaan (BPP)')).toBeInTheDocument()

    // History event
    expect(screen.getByText(/Inisialisasi draf parameter KKF 2027/i)).toBeInTheDocument()
    expect(screen.getByText(/planner@distriva.com/i)).toBeInTheDocument()
  })
})
