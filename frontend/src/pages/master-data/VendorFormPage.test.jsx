import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import VendorFormPage from './VendorFormPage.jsx'
import { vendorsApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  vendorsApi: { list: vi.fn(), create: vi.fn(), update: vi.fn() },
}))

function mount(path) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <NotificationProvider>
        <Routes>
          <Route path="/master-data/vendors" element={<div>DAFTAR VENDOR</div>} />
          <Route path="/master-data/vendors/new" element={<VendorFormPage />} />
          <Route path="/master-data/vendors/:id/edit" element={<VendorFormPage />} />
        </Routes>
      </NotificationProvider>
    </MemoryRouter>
  )
}

describe('VendorFormPage (halaman profil vendor)', () => {
  beforeEach(() => vi.clearAllMocks())

  it('tambah: kode di-uppercase, hanya kolom terisi yang dikirim, lalu kembali ke daftar', async () => {
    vendorsApi.create.mockResolvedValueOnce({ data: { id: 'v9' } })
    mount('/master-data/vendors/new')
    const code = screen.getByPlaceholderText(/Contoh: VND-001/i)
    fireEvent.change(code, { target: { value: 'vnd-9' } })
    expect(code.value).toBe('VND-9')
    fireEvent.change(screen.getByPlaceholderText(/Contoh: PT\. Citra Konstruksi/i), { target: { value: 'PT Lengkap' } })
    fireEvent.change(screen.getByLabelText(/^Nama PIC/i), { target: { value: 'Budi' } })
    fireEvent.change(screen.getByLabelText(/^Kota/i), { target: { value: 'Malang' } })
    fireEvent.change(screen.getByLabelText(/^Nomor kontrak/i), { target: { value: 'SPK-1' } })
    fireEvent.click(screen.getByLabelText(/Buat akun Pelaksana sekarang/i))                       // tanpa akun: tidak ada kolom akun yang dikirim
    fireEvent.click(screen.getByRole('button', { name: /simpan vendor/i }))
    await waitFor(() => expect(vendorsApi.create).toHaveBeenCalledWith({ code: 'VND-9', name: 'PT Lengkap', pic_name: 'Budi', city: 'Malang', contract_number: 'SPK-1', work_scope: 'KEDUANYA' }))
    expect(await screen.findByText('DAFTAR VENDOR')).toBeInTheDocument()
  })

  it('tambah: akun Pelaksana (administrasi) dibuat dan ditautkan bersama data vendor', async () => {
    vendorsApi.create.mockResolvedValueOnce({ data: { id: 'v10', account: { id: 'a1', email: 'admin@pt.test' } } })
    mount('/master-data/vendors/new')
    fireEvent.change(screen.getByPlaceholderText(/Contoh: VND-001/i), { target: { value: 'vnd-10' } })
    fireEvent.change(screen.getByPlaceholderText(/Contoh: PT\. Citra Konstruksi/i), { target: { value: 'PT Akun' } })
    expect(screen.getByLabelText(/Buat akun Pelaksana sekarang/i)).toBeChecked()                  // bawaan: akun dibuat
    fireEvent.change(screen.getByLabelText(/^Nama Petugas Administrasi/i), { target: { value: 'Sari' } })
    fireEvent.change(screen.getByLabelText(/^Email Login/i), { target: { value: 'admin@pt.test' } })
    fireEvent.click(screen.getByRole('button', { name: /simpan vendor/i }))
    await waitFor(() => expect(vendorsApi.create).toHaveBeenCalledWith(expect.objectContaining({ code: 'VND-10', name: 'PT Akun', account: { name: 'Sari', email: 'admin@pt.test' } })))
  })

  it('ubah: data dimuat, kode terkunci, kolom yang dikosongkan ikut terkirim', async () => {
    vendorsApi.list.mockResolvedValue({ data: [{ id: 'v1', code: 'VND-1', name: 'PT Lama', status: 'ACTIVE', accounts: [], profile: { city: 'Malang', pic_name: 'Budi' } }] })
    vendorsApi.update.mockResolvedValueOnce({ message: 'ok' })
    mount('/master-data/vendors/v1/edit')
    expect(await screen.findByDisplayValue('PT Lama')).toBeInTheDocument()
    expect(screen.getByPlaceholderText(/Contoh: VND-001/i)).toBeDisabled()
    fireEvent.change(screen.getByLabelText(/^Kota/i), { target: { value: '' } })
    fireEvent.click(screen.getByRole('button', { name: /simpan profil/i }))
    await waitFor(() => expect(vendorsApi.update).toHaveBeenCalledWith('v1', expect.objectContaining({ name: 'PT Lama', city: '', pic_name: 'Budi' })))
    expect(await screen.findByText('DAFTAR VENDOR')).toBeInTheDocument()
  })

  it('ubah vendor yang tidak ada menampilkan pesan galat', async () => {
    vendorsApi.list.mockResolvedValue({ data: [] })
    mount('/master-data/vendors/zzz/edit')
    expect(await screen.findByText(/tidak ditemukan/i)).toBeInTheDocument()
  })
})
