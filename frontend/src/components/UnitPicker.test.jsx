import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import UnitPicker from './UnitPicker.jsx'
import { unitScopeApi } from '../services/api.js'

vi.mock('../services/api.js', () => ({ unitScopeApi: { get: vi.fn() } }))

const GLOBAL = {
  scope: 'GLOBAL',
  up3_units: [{ id: 'up3-1', code: 'UP3-A', name: 'UP3 Satu' }, { id: 'up3-2', code: 'UP3-B', name: 'UP3 Dua' }],
  ulp_units: [
    { id: 'ulp-1', code: 'ULP-A', name: 'ULP Satu', parent_id: 'up3-1' },
    { id: 'ulp-2', code: 'ULP-B', name: 'ULP Dua', parent_id: 'up3-2' },
  ],
}

function Host({ level = 'ulp', initial = '', spy }) {
  const [value, setValue] = useState(initial)
  return <UnitPicker permission="x.create" level={level} value={value} onChange={(v) => { spy?.(v); setValue(v) }} />
}

describe('UnitPicker', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    unitScopeApi.get.mockResolvedValue(GLOBAL)
  })

  it('ULP menyempit ke UP3 terpilih dan nilai selalu sebuah ULP', async () => {
    const spy = vi.fn()
    render(<Host spy={spy} />)
    await userEvent.click(await screen.findByRole('combobox', { name: 'UP3' }))
    await userEvent.click(await screen.findByRole('option', { name: /UP3 Dua/ }))
    await userEvent.click(screen.getByRole('combobox', { name: 'ULP' }))
    expect(screen.queryByRole('option', { name: /ULP Satu/ })).not.toBeInTheDocument()
    await userEvent.click(await screen.findByRole('option', { name: /ULP Dua/ }))
    expect(spy).toHaveBeenLastCalledWith('ulp-2')
  })

  it('pencarian di dropdown ULP menyaring pilihan', async () => {
    render(<Host />)
    await userEvent.click(await screen.findByRole('combobox', { name: 'ULP' }))
    await userEvent.keyboard('Satu')
    expect(await screen.findByRole('option', { name: /ULP Satu/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /ULP Dua/ })).not.toBeInTheDocument()
  })

  it('mengganti UP3 mengosongkan ULP yang tidak berada di bawahnya', async () => {
    const spy = vi.fn()
    render(<Host initial="ulp-1" spy={spy} />)
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'UP3' })).toHaveValue('UP3-A - UP3 Satu'))
    await userEvent.click(screen.getByRole('combobox', { name: 'UP3' }))
    await userEvent.click(await screen.findByRole('option', { name: /UP3 Dua/ }))
    expect(spy).toHaveBeenLastCalledWith('')
  })

  it('level any: memilih UP3 saja menghasilkan UP3, memilih ULP menghasilkan ULP', async () => {
    const spy = vi.fn()
    render(<Host level="any" spy={spy} />)
    await userEvent.click(await screen.findByRole('combobox', { name: 'UP3' }))
    await userEvent.click(await screen.findByRole('option', { name: /UP3 Satu/ }))
    expect(spy).toHaveBeenLastCalledWith('up3-1')
    await userEvent.click(screen.getByRole('combobox', { name: 'ULP' }))
    await userEvent.click(await screen.findByRole('option', { name: /ULP Satu/ }))
    expect(spy).toHaveBeenLastCalledWith('ulp-1')
    await userEvent.click(screen.getByRole('combobox', { name: 'ULP' }))
    await userEvent.click(await screen.findByRole('option', { name: /Tingkat UP3/ }))
    expect(spy).toHaveBeenLastCalledWith('up3-1')
  })

  it('peran ULP: UP3 dan ULP terkunci dan nilai diisi otomatis', async () => {
    unitScopeApi.get.mockResolvedValue({ scope: 'ULP', up3_units: [GLOBAL.up3_units[0]], ulp_units: [GLOBAL.ulp_units[0]] })
    const spy = vi.fn()
    render(<Host spy={spy} />)
    await waitFor(() => expect(spy).toHaveBeenCalledWith('ulp-1'))
    expect(screen.getByRole('combobox', { name: 'UP3' })).toBeDisabled()
    expect(screen.getByRole('combobox', { name: 'ULP' })).toBeDisabled()
  })

  it('cakupan gagal dimuat: memakai daftar cadangan dari halaman', async () => {
    unitScopeApi.get.mockRejectedValue(new Error('x'))
    const spy = vi.fn()
    render(<UnitPicker permission="x" value="" onChange={spy} units={[{ id: 'u9', code: 'ULP-9', name: 'ULP Sembilan' }]} />)
    await userEvent.click(await screen.findByRole('combobox', { name: 'ULP' }))
    await userEvent.click(await screen.findByRole('option', { name: /ULP Sembilan/ }))
    expect(spy).toHaveBeenLastCalledWith('u9', expect.objectContaining({ id: 'u9', code: 'ULP-9' }))
  })
})
