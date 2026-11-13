import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import SubstationsPage from './SubstationsPage.jsx'
import { substationsApi, feedersApi, adminApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  substationsApi: {
    list: vi.fn(),
    get: vi.fn(),
    update: vi.fn(),
    stage: vi.fn(),
    batch: vi.fn(),
    confirm: vi.fn(),
    discard: vi.fn(),
  },
  feedersApi: { list: vi.fn() },
  adminApi: { units: vi.fn() },
}))

const row = (over = {}) => ({
  id: 's1',
  code: 'HD0001',
  name: 'Gardu Satu',
  area_note: 'Dekat pasar',
  address: 'Jl. Merdeka No. 10, Jombang',
  unit_name: 'ULP Jombang',
  unit_code: '51453',
  feeder_code: 'JBG01',
  capacity_kva: 200,
  transformer_brand: 'TRAFINDO',
  transformer_year: 2018,
  transformer_age_years: 8,
  latitude: -7.5432,
  longitude: 112.2345,
  ownership: 'PLN',
  status: 'AKTIF',
  needs_review: false,
  pickable: true,
  ...over,
})

function renderPage(
  can = {
    'substations.view': true,
    'substations.import': true,
    'substations.manage': true,
    'feeders.view': true,
    'customers.view': true,
  },
  initialEntries = ['/master-data/substations']
) {
  return render(
    <AccessContext.Provider value={{ loading: false, can, canWrite: {}, isSysAdmin: false }}>
      <NotificationProvider>
        <MemoryRouter initialEntries={initialEntries}>
          <SubstationsPage />
        </MemoryRouter>
      </NotificationProvider>
    </AccessContext.Provider>
  )
}

describe('Master Gardu — SubstationsPage (docs/80 §15)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminApi.units.mockResolvedValue({
      data: [{ id: 'u1', code: '51453', name: 'ULP Jombang', unit_type: 'ULP' }],
    })
    feedersApi.list.mockResolvedValue({
      data: [{ id: 'f1', code: 'JBG01', name: 'Jombang 01' }],
    })
    substationsApi.list.mockResolvedValue({
      data: [
        row(),
        row({
          id: 's2',
          code: 'HD0002',
          name: '',
          area_note: '',
          address: '',
          feeder_code: '',
          capacity_kva: null,
          transformer_brand: null,
          transformer_year: null,
          transformer_age_years: null,
          latitude: null,
          longitude: null,
          ownership: 'PELANGGAN',
          status: 'NONAKTIF',
          needs_review: true,
        }),
      ],
      meta: { total: 2, current_page: 1, last_page: 1, per_page: 25 },
    })
  })

  it('1. menampilkan kolom aset: alamat, merk, tahun + umur, koordinat peta, "-" bila kosong, penanda nonaktif & tanpa koordinat', async () => {
    renderPage()
    const rows = await screen.findAllByTestId('substation-row')
    expect(rows).toHaveLength(2)

    // Baris 1: Data aset lengkap
    expect(rows[0]).toHaveTextContent('HD0001')
    expect(rows[0]).toHaveTextContent('Gardu Satu')
    expect(rows[0]).toHaveTextContent('Jl. Merdeka No. 10, Jombang')
    expect(rows[0]).toHaveTextContent('ULP Jombang')
    expect(rows[0]).toHaveTextContent('JBG01')
    expect(rows[0]).toHaveTextContent('200')
    expect(rows[0]).toHaveTextContent('TRAFINDO')
    expect(rows[0]).toHaveTextContent('2018 (8 th)')
    expect(rows[0]).toHaveTextContent('-7.5432, 112.2345')

    // Link Google Maps
    const mapLink = screen.getByRole('link', { name: 'peta' })
    expect(mapLink).toHaveAttribute('href', 'https://www.google.com/maps?q=-7.5432,112.2345')
    expect(mapLink).toHaveAttribute('target', '_blank')

    // Baris 2: Nilai kosong ditampilkan "-" dan badge penanda
    expect(rows[1]).toHaveTextContent('HD0002')
    expect(rows[1]).toHaveTextContent('Pelanggan')
    expect(rows[1]).toHaveTextContent('Nonaktif')
    expect(rows[1]).toHaveTextContent('Perlu ditinjau')
    expect(rows[1]).toHaveTextContent('tanpa koordinat')

    // Kolom pembebanan dan tab analisis tidak ada lagi di halaman ini
    expect(screen.queryByText('Pembebanan (%)')).not.toBeInTheDocument()
    expect(screen.queryByText('Teg. ujung (V)')).not.toBeInTheDocument()
  })

  it('2. filter baru (merk, tahun, kapasitas, kecamatan, tanpa koordinat, perlu ditinjau) dan sort/dir dikirim ke server', async () => {
    renderPage()
    await screen.findAllByTestId('substation-row')

    // Filter merk
    await userEvent.type(screen.getByPlaceholderText('Merk trafo…'), 'TRAFINDO')
    // Filter tahun
    await userEvent.type(screen.getByPlaceholderText('Thn dari'), '2015')
    await userEvent.type(screen.getByPlaceholderText('Thn s/d'), '2020')
    // Filter kapasitas
    await userEvent.type(screen.getByPlaceholderText('kVA min'), '100')
    await userEvent.type(screen.getByPlaceholderText('kVA maks'), '250')
    // Filter kecamatan
    await userEvent.type(screen.getByPlaceholderText('Kecamatan…'), 'Diwek')
    // Filter tanpa koordinat
    await userEvent.click(screen.getByLabelText('Tanpa koordinat'))
    // Filter perlu ditinjau
    await userEvent.click(screen.getByLabelText('Perlu ditinjau'))

    await userEvent.click(screen.getByRole('button', { name: 'Cari' }))

    await waitFor(() => {
      expect(substationsApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          brand: 'TRAFINDO',
          year_from: '2015',
          year_to: '2020',
          capacity_min: '100',
          capacity_max: '250',
          kecamatan: 'Diwek',
          has_coordinates: 0,
          needs_review: 1,
        })
      )
    })

    // Klik kepala kolom untuk sorting server-side
    await userEvent.click(screen.getByText('Kode'))
    await waitFor(() => {
      expect(substationsApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sort: 'code',
          dir: 'asc',
        })
      )
    })

    await userEvent.click(screen.getByText('Tahun (Umur)'))
    await waitFor(() => {
      expect(substationsApi.list).toHaveBeenLastCalledWith(
        expect.objectContaining({
          sort: 'year',
          dir: 'asc',
        })
      )
    })
  })

  it('3. tombol impor hanya untuk yang berhak (substations.import)', async () => {
    const { unmount } = renderPage({ 'substations.view': true, 'substations.import': true })
    expect(await screen.findByRole('button', { name: /Impor Gardu/ })).toBeInTheDocument()
    unmount()

    renderPage({ 'substations.view': true, 'substations.import': false })
    await screen.findAllByTestId('substation-row')
    expect(screen.queryByRole('button', { name: /Impor Gardu/ })).not.toBeInTheDocument()
  })

  it('4. detail gardu: data induk lengkap, trafo, kartu pelanggan, riwayat perubahan, dan tombol "Lihat pengukuran"', async () => {
    substationsApi.get.mockResolvedValue({
      data: {
        substation: row({
          unit_code: '51453',
          transformer_count: 1,
          feeder_code: 'JBG01',
          asset_number: 'AST-001',
          location_code: 'LOK-99',
          gadis_number: 'GDS-123',
        }),
        transformers: [
          { slot: 1, capacity_kva: 200, brand: 'TRAFINDO', year_made: 2018, serial_number: 'SN-9988', phase_count: 3 },
        ],
        customers: {
          active_customers: 245,
          connected_va: 385000,
          connected_kva: 385,
          large_customers: 3,
        },
        history: [
          {
            action: 'UPDATED',
            reason: 'Penggantian nama gardu hasil survei lapangan',
            changed_by_name: 'Budi Santoso',
            created_at: '2026-11-09 10:00:00',
            before: { name: 'Gardu Lama' },
            after: { name: 'Gardu Satu' },
          },
        ],
      },
    })

    renderPage()
    const rows = await screen.findAllByTestId('substation-row')
    await userEvent.click(rows[0])

    const detail = await screen.findByTestId('substation-detail')
    expect(detail).toBeInTheDocument()

    // Tombol ke Pengukuran
    const linkPengukuran = screen.getByRole('link', { name: /Lihat pengukuran/i })
    expect(linkPengukuran).toBeInTheDocument()
    expect(linkPengukuran).toHaveAttribute('href', '/master-data/substation-measurements?open=s1')

    // Data induk
    expect(detail).toHaveTextContent('AST-001')
    expect(detail).toHaveTextContent('LOK-99')
    expect(detail).toHaveTextContent('GDS-123')

    // Trafo
    expect(detail).toHaveTextContent('Slot #1')
    expect(detail).toHaveTextContent('SN-9988')
    expect(detail).toHaveTextContent('3 Fasa')

    // Kartu Pelanggan
    expect(screen.getByTestId('substation-customers-card')).toBeInTheDocument()
    expect(screen.getByText('245')).toBeInTheDocument()
    expect(screen.getByText('385 kVA')).toBeInTheDocument()

    // Riwayat Perubahan
    expect(screen.getByTestId('substation-history-list')).toHaveTextContent('Budi Santoso')
    expect(screen.getByTestId('substation-history-list')).toHaveTextContent('Penggantian nama gardu hasil survei lapangan')

    // Tab Analisis & Form pembacaan TIDAK ADA di Master Gardu
    expect(screen.queryByRole('button', { name: 'Analisis' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('reading-form')).not.toBeInTheDocument()
  })

  it('5. form ubah data induk mewajibkan alasan (min 3 karakter), menampilkan pesan server, dan tersembunyi tanpa substations.manage', async () => {
    substationsApi.get.mockResolvedValue({
      data: {
        substation: row({ unit_code: '51453', transformer_count: 1 }),
        transformers: [],
        customers: null,
        history: [],
      },
    })

    // Case 1: Tanpa izin substations.manage
    const { unmount } = renderPage({ 'substations.view': true, 'substations.manage': false })
    await userEvent.click((await screen.findAllByTestId('substation-row'))[0])
    expect(await screen.findByTestId('substation-detail')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Ubah Data Induk/i })).not.toBeInTheDocument()
    unmount()

    // Case 2: Dengan izin substations.manage
    renderPage({ 'substations.view': true, 'substations.manage': true })
    await userEvent.click((await screen.findAllByTestId('substation-row'))[0])
    const btnUbah = await screen.findByRole('button', { name: /Ubah Data Induk/i })
    await userEvent.click(btnUbah)

    expect(screen.getByTestId('edit-substation-form')).toBeInTheDocument()

    // Submit tanpa alasan (< 3 karakter)
    const btnSimpan = screen.getByRole('button', { name: /Simpan Perubahan/i })
    await userEvent.click(btnSimpan)
    expect(screen.getByTestId('edit-substation-error')).toHaveTextContent(/Alasan perubahan wajib diisi/)

    // Galat 409 dari server ditampilkan apa adanya
    substationsApi.update.mockRejectedValueOnce(new Error('Tidak ada perubahan data gardu yang diajukan.'))
    await userEvent.type(screen.getByLabelText(/Alasan Perubahan/), 'Koreksi koordinat')
    await userEvent.click(btnSimpan)

    expect(await screen.findByTestId('edit-substation-error')).toHaveTextContent('Tidak ada perubahan data gardu yang diajukan.')

    // Berhasil simpan
    substationsApi.update.mockResolvedValueOnce({ data: { id: 's1' } })
    await userEvent.click(btnSimpan)

    await waitFor(() => {
      expect(substationsApi.update).toHaveBeenCalledWith(
        's1',
        expect.objectContaining({
          reason: 'Koreksi koordinat',
        })
      )
    })
  })

  it('6. parameter ?open=<id> otomatis membuka Drawer gardu saat dimuat', async () => {
    substationsApi.get.mockResolvedValue({
      data: {
        substation: row({ id: 's1', code: 'HD0001' }),
        transformers: [],
        history: [],
      },
    })

    renderPage(
      { 'substations.view': true, 'substations.manage': true },
      ['/master-data/substations?open=s1']
    )

    expect(await screen.findByTestId('substation-detail')).toBeInTheDocument()
    expect(substationsApi.get).toHaveBeenCalledWith('s1')
  })

  it('7. impor gardu tetap berfungsi di halaman ini', async () => {
    substationsApi.stage.mockResolvedValue({
      data: {
        id: 'b1',
        file_name: 'gardu.xlsx',
        total_rows: 5,
        counts: { NEW: 4, CHANGED: 1, UNCHANGED: 0, REJECT: 0 },
      },
    })
    substationsApi.batch.mockResolvedValue({ rows: [] })
    substationsApi.confirm.mockResolvedValue({
      data: { applied: { created: 4, updated: 1, readings: 3, review_marked: 0 } },
    })

    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: /Impor Gardu/ }))
    const file = new File(['mock'], 'gardu.xlsx', { type: 'application/octet-stream' })
    await userEvent.upload(screen.getByLabelText('Berkas gardu'), file)
    await userEvent.click(screen.getByRole('button', { name: /Periksa Berkas/ }))

    expect(await screen.findByTestId('import-count-NEW')).toHaveTextContent('4')
    await userEvent.click(screen.getByRole('button', { name: /Terapkan \(5 gardu\)/ }))
    expect(await screen.findByTestId('import-applied')).toHaveTextContent('4 gardu baru')
  })

  it('8. menampilkan GD514530146 sebagai Kode, HD0022 sebagai Nama, kombinasi kode dan nama penyulang, serta tombol Unduh Template CSV pada Impor Gardu', async () => {
    substationsApi.list.mockResolvedValue({
      data: [
        row({
          id: 's-custom',
          code: 'HD0022',
          gadis_number: 'GD514530146',
          name: 'Gardu Induk Mojokerto',
          feeder_code: 'JBG01',
        }),
      ],
      meta: { total: 1, current_page: 1, last_page: 1, per_page: 25 },
    })

    renderPage()
    const rows = await screen.findAllByTestId('substation-row')
    expect(rows).toHaveLength(1)

    // 1. GD514530146 menjadi kode gardu
    expect(rows[0]).toHaveTextContent('GD514530146')

    // 2. HD0022 menjadi nama gardu
    expect(rows[0]).toHaveTextContent('HD0022')

    // 3. Penyulang menampilkan kode dan nama penyulang (JBG01 - Jombang 01)
    expect(rows[0]).toHaveTextContent('JBG01 - Jombang 01')

    // Drawer Impor Gardu memiliki tombol Unduh Template CSV
    await userEvent.click(screen.getByRole('button', { name: /Impor Gardu/ }))
    expect(await screen.findByText('Format Berkas CSV Gardu')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Unduh Template CSV/i })).toBeInTheDocument()
  })
})
