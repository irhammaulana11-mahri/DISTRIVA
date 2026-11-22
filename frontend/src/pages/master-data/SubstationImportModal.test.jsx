import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import SubstationImportModal from './SubstationImportModal.jsx'
import { substationsApi, unitScopeApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  substationsApi: { stage: vi.fn(), rows: vi.fn(), confirm: vi.fn(), discard: vi.fn() },
  unitScopeApi: { get: vi.fn() },
}))

describe('Impor gardu: unit bawaan', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    unitScopeApi.get.mockResolvedValue({
      scope: 'GLOBAL',
      up3_units: [{ id: 'up3-1', code: 'UP3-A', name: 'UP3 Satu' }, { id: 'up3-2', code: 'UP3-B', name: 'UP3 Dua' }],
      ulp_units: [{ id: 'ulp-1', code: 'ULP-A', name: 'ULP Satu', parent_id: 'up3-1' }, { id: 'ulp-2', code: 'ULP-B', name: 'ULP Dua', parent_id: 'up3-2' }],
    })
    substationsApi.stage.mockResolvedValue({ data: { id: 'b-1', counts: { NEW: 1, REJECT: 0 } } })
    substationsApi.rows.mockResolvedValue({ data: [], meta: {} })
  })

  it('SYS_ADMIN memilih UP3 lalu ULP (dropdown dengan pencarian) dan unit_id ikut terkirim; boleh dikosongkan', async () => {
    render(<SubstationImportModal open asPage onClose={() => {}} units={[]} />)
    await userEvent.click(await screen.findByRole('combobox', { name: 'Unit bawaan UP3' }))
    await userEvent.click(await screen.findByRole('option', { name: /UP3 Dua/ }))
    await userEvent.click(screen.getByRole('combobox', { name: 'Unit bawaan' }))
    expect(screen.queryByRole('option', { name: /ULP Satu/ })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('option', { name: /ULP Dua/ }))

    await userEvent.upload(screen.getByLabelText('Berkas gardu'), new File(['KD_GARDU\nHD1'], 'gardu.csv', { type: 'text/csv' }))
    await userEvent.click(screen.getByRole('button', { name: /Periksa Berkas/ }))
    await waitFor(() => expect(substationsApi.stage).toHaveBeenCalledTimes(1))
    expect(substationsApi.stage.mock.calls[0][0].get('unit_id')).toBe('ulp-2')
  })

  it('tanpa memilih unit, unit_id tidak dikirim', async () => {
    render(<SubstationImportModal open asPage onClose={() => {}} units={[]} />)
    await screen.findByRole('combobox', { name: 'Unit bawaan' })
    await userEvent.upload(screen.getByLabelText('Berkas gardu'), new File(['KD_GARDU\nHD1'], 'gardu.csv', { type: 'text/csv' }))
    await userEvent.click(screen.getByRole('button', { name: /Periksa Berkas/ }))
    await waitFor(() => expect(substationsApi.stage).toHaveBeenCalledTimes(1))
    expect(substationsApi.stage.mock.calls[0][0].has('unit_id')).toBe(false)
  })
})
