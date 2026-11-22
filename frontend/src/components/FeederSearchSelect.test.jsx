import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import FeederSearchSelect from './FeederSearchSelect.jsx'
import * as unitScope from '../utils/unitScope.js'
import { feedersApi } from '../services/api.js'

vi.mock('../services/api.js', () => ({
  feedersApi: {
    list: vi.fn(),
  },
}))

describe('FeederSearchSelect (Hierarchical Role-based Feeder SearchSelect)', () => {
  const mockFeeders = [
    {
      id: 'f-1',
      code: 'GDG',
      name: 'Gayam',
      owner_unit_id: 'up3-1',
      served_units: [{ id: 'ulp-1', code: '51451', name: 'ULP Mojokerto Kota' }],
    },
    {
      id: 'f-2',
      code: 'MNCLN',
      name: 'Mancilan',
      owner_unit_id: 'up3-1',
      served_units: [{ id: 'ulp-2', code: '51452', name: 'ULP Mojoagung' }],
    },
    {
      id: 'f-3',
      code: 'WRJ',
      name: 'Warujayeng',
      owner_unit_id: 'up3-2',
      served_units: [{ id: 'ulp-3', code: '51461', name: 'ULP Warujayeng' }],
    },
  ]

  beforeEach(() => {
    vi.clearAllMocks()
    feedersApi.list.mockResolvedValue({ data: mockFeeders })
  })

  it('1. Role ULP: terkunci ke ULP aktor dan hanya memuat penyulang di ULP tersebut', async () => {
    vi.spyOn(unitScope, 'useScopedUnits').mockReturnValue({
      scope: 'ULP',
      up3_units: [{ id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3' }],
      ulp_units: [{ id: 'ulp-1', name: 'ULP Mojokerto Kota', unit_type: 'ULP', parent_id: 'up3-1' }],
    })

    const onChange = vi.fn()
    render(
      <FeederSearchSelect
        permission="substations.view"
        up3Id=""
        unitId=""
        value=""
        onChange={onChange}
      />
    )

    await waitFor(() => {
      expect(feedersApi.list).toHaveBeenCalledWith(
        expect.objectContaining({
          serves_unit_id: 'ulp-1',
        })
      )
    })

    const combobox = screen.getByRole('combobox', { name: /Penyulang/i })
    await userEvent.click(combobox)

    // Hanya penyulang GDG (ULP 1) yang tampil
    expect(screen.getByRole('option', { name: /GDG/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /MNCLN/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /WRJ/i })).not.toBeInTheDocument()
  })

  it('2. Role UP3: memuat semua penyulang UP3 bila Semua ULP, dan menyempit ke ULP tertentu bila ULP dipilih', async () => {
    vi.spyOn(unitScope, 'useScopedUnits').mockReturnValue({
      scope: 'UP3',
      up3_units: [{ id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3' }],
      ulp_units: [
        { id: 'ulp-1', name: 'ULP Mojokerto Kota', unit_type: 'ULP', parent_id: 'up3-1' },
        { id: 'ulp-2', name: 'ULP Mojoagung', unit_type: 'ULP', parent_id: 'up3-1' },
      ],
    })

    const { rerender } = render(
      <FeederSearchSelect
        permission="substations.view"
        up3Id=""
        unitId=""
        value=""
        onChange={vi.fn()}
      />
    )

    // Ketika unitId kosong (Semua ULP): minta semua penyulang UP3
    await waitFor(() => {
      expect(feedersApi.list).toHaveBeenCalledWith(
        expect.objectContaining({
          up3_id: 'up3-1',
        })
      )
    })

    const combobox = screen.getByRole('combobox', { name: /Penyulang/i })
    await userEvent.click(combobox)
    expect(screen.getByRole('option', { name: /GDG/i })).toBeInTheDocument()
    expect(screen.getByRole('option', { name: /MNCLN/i })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /WRJ/i })).not.toBeInTheDocument() // Beda UP3

    // Ketika ULP dipilih (misal ULP Mojoagung / ulp-2):
    rerender(
      <FeederSearchSelect
        permission="substations.view"
        up3Id=""
        unitId="ulp-2"
        value=""
        onChange={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(feedersApi.list).toHaveBeenCalledWith(
        expect.objectContaining({
          serves_unit_id: 'ulp-2',
        })
      )
    })
  })

  it('3. Role SYS_ADMIN (GLOBAL): bisa Semua UP3, filter per UP3, dan filter per ULP', async () => {
    vi.spyOn(unitScope, 'useScopedUnits').mockReturnValue({
      scope: 'GLOBAL',
      up3_units: [
        { id: 'up3-1', name: 'UP3 Mojokerto', unit_type: 'UP3' },
        { id: 'up3-2', name: 'UP3 Madiun', unit_type: 'UP3' },
      ],
      ulp_units: [
        { id: 'ulp-1', name: 'ULP Mojokerto Kota', unit_type: 'ULP', parent_id: 'up3-1' },
        { id: 'ulp-2', name: 'ULP Mojoagung', unit_type: 'ULP', parent_id: 'up3-1' },
        { id: 'ulp-3', name: 'ULP Warujayeng', unit_type: 'ULP', parent_id: 'up3-2' },
      ],
    })

    const { rerender } = render(
      <FeederSearchSelect
        permission="substations.view"
        up3Id=""
        unitId=""
        value=""
        onChange={vi.fn()}
      />
    )

    // Semua UP3 & Semua ULP: tidak kirim up3_id atau serves_unit_id
    await waitFor(() => {
      expect(feedersApi.list).toHaveBeenCalledWith({ per_page: 500 })
    })

    // Pilih UP3 Mojokerto
    rerender(
      <FeederSearchSelect
        permission="substations.view"
        up3Id="up3-1"
        unitId=""
        value=""
        onChange={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(feedersApi.list).toHaveBeenCalledWith(
        expect.objectContaining({
          up3_id: 'up3-1',
        })
      )
    })

    // Tambah pilihan ULP Mojokerto Kota
    rerender(
      <FeederSearchSelect
        permission="substations.view"
        up3Id="up3-1"
        unitId="ulp-1"
        value=""
        onChange={vi.fn()}
      />
    )

    await waitFor(() => {
      expect(feedersApi.list).toHaveBeenCalledWith(
        expect.objectContaining({
          serves_unit_id: 'ulp-1',
        })
      )
    })
  })

  it('4. Mengosongkan pilihan (reset value) bila penyulang terpilih tidak ada pada daftar filter baru', async () => {
    vi.spyOn(unitScope, 'useScopedUnits').mockReturnValue({
      scope: 'GLOBAL',
      up3_units: [{ id: 'up3-1', name: 'UP3 Mojokerto' }],
      ulp_units: [{ id: 'ulp-1', name: 'ULP Mojokerto Kota', parent_id: 'up3-1' }],
    })

    feedersApi.list.mockResolvedValueOnce({
      data: [{ id: 'f-1', code: 'GDG', name: 'Gayam' }],
    })

    const onChange = vi.fn()
    const { rerender } = render(
      <FeederSearchSelect
        permission="substations.view"
        up3Id="up3-1"
        unitId=""
        value="f-nonexistent"
        onChange={onChange}
      />
    )

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith('')
    })
  })
})
