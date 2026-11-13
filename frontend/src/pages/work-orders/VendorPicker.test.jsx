import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { useState } from 'react'
import VendorPicker, { VendorPreview, vendorsForScope } from './VendorPicker.jsx'

const vendors = [
  { id: 'j1', code: 'JRG-1', name: 'PT Jaringan Satu', status: 'ACTIVE', profile: { work_scope: 'JARINGAN', city: 'Malang', pic_name: 'Budi' } },
  { id: 't1', code: 'TNG-1', name: 'PT Tiang Satu', status: 'ACTIVE', profile: { work_scope: 'TIANG' } },
  { id: 'k1', code: 'KDU-1', name: 'PT Dua Bidang', status: 'ACTIVE', profile: { work_scope: 'KEDUANYA' } },
  { id: 'n1', code: 'NOP-1', name: 'PT Tanpa Profil', status: 'ACTIVE' },
  { id: 'x1', code: 'OFF-1', name: 'PT Nonaktif', status: 'INACTIVE', profile: { work_scope: 'KEDUANYA' } },
]

function Harness({ scope, onChange = () => {} }) {
  const [value, setValue] = useState('')
  return <VendorPicker vendors={vendors} scope={scope} value={value} onChange={(v) => { setValue(v); onChange(v) }} ariaLabel="Pilih vendor uji" />
}

const open = () => fireEvent.click(screen.getByRole('combobox', { name: 'Pilih vendor uji' }))
const names = () => screen.getAllByRole('option').map((o) => o.textContent)

describe('VendorPicker', () => {
  it('menyaring vendor menurut jenis WO: jaringan, tiang, dan "keduanya"; vendor tanpa profil dianggap keduanya; nonaktif tidak tampil', () => {
    expect(vendorsForScope(vendors, 'JARINGAN').map((v) => v.id)).toEqual(['j1', 'k1', 'n1'])
    expect(vendorsForScope(vendors, 'TIANG').map((v) => v.id)).toEqual(['t1', 'k1', 'n1'])

    const view = render(<Harness scope="JARINGAN" />)
    open()
    expect(names().join('|')).toMatch(/PT Jaringan Satu/)
    expect(names().join('|')).not.toMatch(/PT Tiang Satu|PT Nonaktif/)
    expect(screen.getByText(/3 vendor aktif dengan lingkup jaringan/)).toBeInTheDocument()
    view.unmount()

    render(<Harness scope="TIANG" />)
    open()
    expect(names().join('|')).toMatch(/PT Tiang Satu/)
    expect(names().join('|')).not.toMatch(/PT Jaringan Satu/)
  })

  it('mencari menurut nama, kode, kota, dan PIC; menampilkan pesan bila tidak ada hasil', () => {
    render(<Harness scope="JARINGAN" />)
    open()
    const box = screen.getByRole('combobox', { name: 'Pilih vendor uji' })
    fireEvent.change(box, { target: { value: 'malang' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.change(box, { target: { value: 'budi' } })
    expect(screen.getAllByRole('option')).toHaveLength(1)
    fireEvent.change(box, { target: { value: 'kdu-1' } })
    expect(screen.getByRole('option', { name: /PT Dua Bidang/ })).toBeInTheDocument()
    fireEvent.change(box, { target: { value: 'zzz' } })
    expect(screen.getByText('Vendor tidak ditemukan.')).toBeInTheDocument()
  })

  it('memilih dengan klik atau keyboard (panah + Enter), lalu kotak menampilkan nama terpilih', () => {
    const onChange = vi.fn()
    render(<Harness scope="JARINGAN" onChange={onChange} />)
    open()
    fireEvent.click(screen.getByRole('option', { name: /PT Jaringan Satu/ }))
    expect(onChange).toHaveBeenLastCalledWith('j1')
    expect(screen.getByRole('combobox', { name: 'Pilih vendor uji' })).toHaveValue('PT Jaringan Satu')

    const box = screen.getByRole('combobox', { name: 'Pilih vendor uji' })
    fireEvent.focus(box)
    fireEvent.keyDown(box, { key: 'ArrowDown' })
    fireEvent.keyDown(box, { key: 'Enter' })
    expect(onChange).toHaveBeenLastCalledWith('k1')
  })

  it('Esc menutup daftar tanpa mengubah pilihan', () => {
    const onChange = vi.fn()
    render(<Harness scope="JARINGAN" onChange={onChange} />)
    open()
    expect(screen.getByRole('listbox')).toBeInTheDocument()
    fireEvent.keyDown(screen.getByRole('combobox', { name: 'Pilih vendor uji' }), { key: 'Escape' })
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
    expect(onChange).not.toHaveBeenCalled()
  })

  it('menjelaskan bila belum ada vendor untuk jenis pekerjaan itu', () => {
    render(<VendorPicker vendors={[vendors[1]]} scope="JARINGAN" value="" onChange={() => {}} />)
    expect(screen.getByText(/Belum ada vendor aktif untuk pekerjaan jaringan/)).toBeInTheDocument()
  })
})

describe('VendorPreview', () => {
  it('menampilkan profil ringkas dan menandai kontrak atau SBU yang kedaluwarsa', () => {
    render(<VendorPreview vendor={{ id: 'a', code: 'A-1', name: 'PT Contoh', status: 'ACTIVE', profile: { work_scope: 'JARINGAN', pic_name: 'Sari', pic_position: 'Manajer', pic_phone: '0812', city: 'Kediri', province: 'Jawa Timur', contract_number: 'SPK-9', contract_valid_until: '2020-01-01', sbu_number: 'SBU-1', sbu_valid_until: '2099-12-31' } }} />)
    expect(screen.getByText('PT Contoh')).toBeInTheDocument()
    expect(screen.getByText(/Sari/)).toBeInTheDocument()
    expect(screen.getByText('Kediri, Jawa Timur')).toBeInTheDocument()
    expect(screen.getAllByText(/kedaluwarsa/)).toHaveLength(1)   // hanya kontrak; SBU masih berlaku
  })

  it('tanpa vendor terpilih menampilkan petunjuk', () => {
    render(<VendorPreview vendor={undefined} />)
    expect(screen.getByText('Pilih vendor untuk melihat profilnya.')).toBeInTheDocument()
  })
})
