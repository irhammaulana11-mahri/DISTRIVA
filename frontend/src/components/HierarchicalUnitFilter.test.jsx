import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import HierarchicalUnitFilter from './HierarchicalUnitFilter.jsx'
import { unitScopeApi } from '../services/api.js'

vi.mock('../services/api.js', () => ({
  unitScopeApi: { get: vi.fn() },
  adminApi: { units: vi.fn().mockResolvedValue({ data: [] }) },
}))

const ALL_UP3 = [
  { id: 'up3-1', code: '51MJK', name: 'UP3 Mojokerto' },
  { id: 'up3-2', code: '51SDA', name: 'UP3 Sidoarjo' },
]

const ALL_ULP = [
  { id: 'ulp-1', code: '51450', name: 'ULP Mojoagung', parent_id: 'up3-1' },
  { id: 'ulp-2', code: '51452', name: 'ULP Mojokerto', parent_id: 'up3-1' },
  { id: 'ulp-3', code: '51201', name: 'ULP Sidoarjo Kota', parent_id: 'up3-2' },
]

describe('HierarchicalUnitFilter & unitScope', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('1. peran ULP langsung mengunci dan menunjuk UP3 induk serta ULP miliknya', async () => {
    unitScopeApi.get.mockResolvedValue({
      scope: 'ULP',
      up3_units: [ALL_UP3[0]],
      ulp_units: [ALL_ULP[0]],
      default_up3_id: 'up3-1',
      default_unit_id: 'ulp-1',
    })
    const onUp3Change = vi.fn()
    const onUnitChange = vi.fn()

    render(<HierarchicalUnitFilter permission="applications.view" up3Id="" unitId="" onUp3Change={onUp3Change} onUnitChange={onUnitChange} />)

    const up3Input = await screen.findByRole('combobox', { name: 'Filter Unit UP3' })
    const ulpInput = screen.getByRole('combobox', { name: 'Unit' })

    await waitFor(() => {
      expect(up3Input).toBeDisabled()
      expect(ulpInput).toBeDisabled()
      expect(up3Input).toHaveValue('51MJK - UP3 Mojokerto')
      expect(ulpInput).toHaveValue('51450 - ULP Mojoagung')
      expect(onUp3Change).toHaveBeenCalledWith('up3-1')
      expect(onUnitChange).toHaveBeenCalledWith('ulp-1')
    })
  })

  it('2. peran UP3 mengunci UP3 miliknya dan menampilkan seluruh ULP di UP3 tersebut dengan pencarian', async () => {
    unitScopeApi.get.mockResolvedValue({
      scope: 'UP3',
      up3_units: [ALL_UP3[0]],
      ulp_units: ALL_ULP.slice(0, 2),
      default_up3_id: 'up3-1',
      default_unit_id: '',
    })
    const onUp3Change = vi.fn()
    const onUnitChange = vi.fn()
    const user = userEvent.setup()

    render(<HierarchicalUnitFilter permission="applications.view" up3Id="" unitId="" onUp3Change={onUp3Change} onUnitChange={onUnitChange} />)

    const up3Input = await screen.findByRole('combobox', { name: 'Filter Unit UP3' })
    const ulpInput = screen.getByRole('combobox', { name: 'Unit' })

    await waitFor(() => {
      expect(up3Input).toBeDisabled()
      expect(up3Input).toHaveValue('51MJK - UP3 Mojokerto')
      expect(onUp3Change).toHaveBeenCalledWith('up3-1')
    })
    expect(ulpInput).not.toBeDisabled()

    await user.click(ulpInput)
    await user.type(ulpInput, 'Mojoagung')
    expect(screen.getByRole('option', { name: /51450 - ULP Mojoagung/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /51452 - ULP Mojokerto/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('option', { name: /51450 - ULP Mojoagung/i }))
    expect(onUnitChange).toHaveBeenCalledWith('ulp-1')
  })

  it('3. SYS_ADMIN menampilkan semua UP3 & ULP, dan saat UP3 dipilih daftar ULP menyempit; fallback 422 tetap menjaga scope', async () => {
    unitScopeApi.get.mockImplementation(async (perm) => {
      if (perm === 'pengusahaan.view') {
        const err = new Error('Validation failed')
        err.status = 422
        throw err
      }
      return {
        scope: 'GLOBAL',
        up3_units: ALL_UP3,
        ulp_units: ALL_ULP,
      }
    })
    const user = userEvent.setup()

    function Harness() {
      return <HierarchicalUnitFilter permission="pengusahaan.view" up3Id="up3-2" unitId="" onUp3Change={() => {}} onUnitChange={() => {}} />
    }

    render(<Harness />)

    const up3Input = await screen.findByRole('combobox', { name: 'Filter Unit UP3' })
    const ulpInput = screen.getByRole('combobox', { name: 'Unit' })

    await waitFor(() => {
      expect(up3Input).toHaveValue('51SDA - UP3 Sidoarjo')
    })
    expect(up3Input).not.toBeDisabled()
    expect(ulpInput).not.toBeDisabled()

    await user.click(ulpInput)
    expect(screen.getByRole('option', { name: /51201 - ULP Sidoarjo Kota/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /51450 - ULP Mojoagung/i })).not.toBeInTheDocument()
  })
})
