import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { masterDataApi } from '../../services/api.js'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import MaterialsPage from './MaterialsPage.jsx'
import KhsPage from './KhsPage.jsx'
import ConstructionsPage from './ConstructionsPage.jsx'
import CategoriesPage from './CategoriesPage.jsx'

vi.mock('../../services/api.js', () => ({
  masterDataApi: {
    categories: vi.fn(),
    createCategory: vi.fn(),
    updateCategory: vi.fn(),
    units: vi.fn(),
    createUnit: vi.fn(),
    updateUnit: vi.fn(),
    materials: vi.fn(),
    material: vi.fn(),
    updateMaterial: vi.fn(),
    khsList: vi.fn(),
    khsItem: vi.fn(),
    approveKhs: vi.fn(),
    constructionTypes: vi.fn(),
    approveConstructionTypes: vi.fn(),
    constructionType: vi.fn(),
    constructionMappings: vi.fn(),
  },
}))

describe('Master Data Pages', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    masterDataApi.categories.mockResolvedValue({
      data: [{ id: 'cat-1', code: 'TRAFO', name: 'Trafo Distribusi', is_active: true }],
    })
    masterDataApi.units.mockResolvedValue({
      data: [{ id: 'u-1', code: 'MTR', name: 'Meter', symbol: 'm', is_active: true }],
    })
  })

  describe('MaterialsPage', () => {
    it('renders materials list and supports viewing detail', async () => {
      masterDataApi.materials.mockResolvedValue({
        data: [
          {
            id: 'mat-1',
            code: 'TRF-001',
            name: 'Trafo 50 kVA 20kV',
            unit: 'Unit',
            spec: 'Dyn5 20kV/400V',
            category: { id: 'cat-1', code: 'TRAFO', name: 'Trafo Distribusi' },
            is_active: true,
          },
        ],
        meta: { current_page: 1, per_page: 25, total: 1, last_page: 1 },
      })
      masterDataApi.material.mockResolvedValue({
        data: {
          id: 'mat-1',
          code: 'TRF-001',
          name: 'Trafo 50 kVA 20kV',
          unit: 'Unit',
          spec: 'Dyn5 20kV/400V',
          category: { id: 'cat-1', code: 'TRAFO', name: 'Trafo Distribusi' },
          is_active: true,
          source_system: 'ERP',
          change_logs: [],
        },
      })

      render(
        <MemoryRouter>
          <NotificationProvider>
            <MaterialsPage />
          </NotificationProvider>
        </MemoryRouter>
      )

      expect(await screen.findByText('Trafo 50 kVA 20kV')).toBeInTheDocument()
      expect(screen.getByText('TRF-001')).toBeInTheDocument()
      expect(screen.getAllByText('Trafo Distribusi').length).toBeGreaterThan(0)

      // Open detail drawer
      const detailBtn = screen.getByTitle(/Lihat Detail/)
      await userEvent.click(detailBtn)

      expect(await screen.findByText('Detail Material ERP')).toBeInTheDocument()
      expect(screen.getAllByText(/TRF-001/).length).toBeGreaterThan(0)
    })
  })

  describe('KhsPage', () => {
    it('renders KHS items and shows draft indicator', async () => {
      masterDataApi.khsList.mockResolvedValue({
        data: [
          {
            id: 'khs-1',
            code: '1',
            current: { version_number: 1, name: 'Tiang Beton 11 meter 200 daN', unit_text: 'B', valid_from: '2026-01-01' },
            has_draft: true,
            draft: { id: 'v-2', version_number: 2, name: 'Tiang Beton 11 meter 200 daN (Revisi)', unit_text: 'B' },
          },
        ],
        meta: { current_page: 1, per_page: 25, total: 1, last_page: 1 },
      })

      render(
        <MemoryRouter>
          <NotificationProvider>
            <KhsPage />
          </NotificationProvider>
        </MemoryRouter>
      )

      expect(await screen.findByText('Tiang Beton 11 meter 200 daN')).toBeInTheDocument()
      expect(screen.getByText('Kode: 1')).toBeInTheDocument()
      expect(screen.getByText(/Menunggu Approval/)).toBeInTheDocument()
    })
  })

  describe('KhsPage — persetujuan massal', () => {
    const row = (n, draft = true) => ({
      id: `khs-${n}`, code: String(n),
      current: null,
      has_draft: draft,
      draft: draft ? { id: `v-${n}`, version_number: 1, name: `Item ${n}`, unit_text: 'M' } : null,
    })
    const renderPage = () => render(
      <MemoryRouter><NotificationProvider><KhsPage /></NotificationProvider></MemoryRouter>,
    )

    it('approves every ticked draft in ONE request with one reason', async () => {
      masterDataApi.khsList.mockResolvedValue({ data: [row(1), row(2), row(3, false)], meta: { current_page: 1, per_page: 25, total: 3, last_page: 1 } })
      masterDataApi.approveKhs.mockResolvedValue({ data: { approved: 2 } })
      renderPage()
      await userEvent.click(await screen.findByLabelText('Pilih semua draf di halaman ini'))
      expect(screen.getByText('2 draf dipilih')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Setujui 2 terpilih' }))
      await userEvent.type(await screen.findByLabelText(/Alasan persetujuan/), 'SK Manager No. 12/2026')
      await userEvent.click(screen.getByRole('button', { name: 'Setujui 2 Versi' }))
      await waitFor(() => expect(masterDataApi.approveKhs).toHaveBeenCalledTimes(1))
      expect(masterDataApi.approveKhs).toHaveBeenCalledWith({ version_ids: ['v-1', 'v-2'], reason: 'SK Manager No. 12/2026' })
    })

    it('selects every pending draft across pages (100 per page) and shows server refusal verbatim', async () => {
      const page = (n) => ({ data: n === 1 ? [row(1), row(2)] : [row(3)], meta: { current_page: n, per_page: 100, total: 3, last_page: 2 } })
      masterDataApi.khsList.mockImplementation(async (params) => (params.per_page === 100 ? page(params.page) : page(1)))
      masterDataApi.approveKhs.mockRejectedValue(new Error('Pembuat versi tidak dapat menyetujui versinya sendiri.'))
      renderPage()
      await userEvent.click(await screen.findByRole('button', { name: /Pilih semua draf tertunda \(semua halaman\)/ }))
      expect(await screen.findByText('3 draf dipilih')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Setujui 3 terpilih' }))
      await userEvent.type(await screen.findByLabelText(/Alasan persetujuan/), 'alasan')
      await userEvent.click(screen.getByRole('button', { name: 'Setujui 3 Versi' }))
      expect((await screen.findAllByText(/Pembuat versi tidak dapat menyetujui versinya sendiri/)).length).toBeGreaterThan(0)
      expect(masterDataApi.approveKhs.mock.calls[0][0].version_ids).toEqual(['v-1', 'v-2', 'v-3'])
    })
  })

  describe('ConstructionsPage — persetujuan massal', () => {
    const row = (n, draft = true) => ({
      id: `c-${n}`, group: 'SUTM', code: `SUTM-0${n}`, name: `Tipe ${n}`,
      current: null, draft: draft ? { id: `cv-${n}`, version_number: 1, mappings_count: 2 } : null,
    })

    it('approves every ticked draft in ONE request with one reason', async () => {
      masterDataApi.constructionTypes.mockResolvedValue({ data: [row(1), row(2), row(3, false)], meta: { current_page: 1, per_page: 25, total: 3, last_page: 1 } })
      masterDataApi.approveConstructionTypes.mockResolvedValue({ data: { approved: 2 } })
      render(<MemoryRouter><NotificationProvider><ConstructionsPage /></NotificationProvider></MemoryRouter>)
      await userEvent.click(await screen.findByLabelText('Pilih semua draf di halaman ini'))
      expect(screen.getByText('2 draf dipilih')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Setujui 2 terpilih' }))
      await userEvent.type(await screen.findByLabelText(/Nomor SK/), 'SK 7/2026')
      await userEvent.click(screen.getByRole('button', { name: 'Setujui 2 Versi' }))
      await waitFor(() => expect(masterDataApi.approveConstructionTypes).toHaveBeenCalledTimes(1))
      expect(masterDataApi.approveConstructionTypes).toHaveBeenCalledWith({ version_ids: ['cv-1', 'cv-2'], reason: 'SK 7/2026' })
    })
  })

  describe('ConstructionsPage', () => {
    it('renders construction types and group filters', async () => {
      masterDataApi.constructionTypes.mockResolvedValue({
        data: [
          {
            id: 'c-1',
            group: 'SUTM',
            code: 'TM-1',
            name: 'Tiang Tumpu Tunggal SUTM',
            is_active: true,
            current: { version_number: 1, valid_from: '2026-01-01', mappings_count: 5 },
          },
        ],
        meta: { current_page: 1, per_page: 25, total: 1, last_page: 1 },
      })

      render(
        <MemoryRouter>
          <NotificationProvider>
            <ConstructionsPage />
          </NotificationProvider>
        </MemoryRouter>
      )

      expect(await screen.findByText('Tiang Tumpu Tunggal SUTM')).toBeInTheDocument()
      expect(screen.getByText('TM-1')).toBeInTheDocument()
      expect(screen.getByText('5 Komponen KHS')).toBeInTheDocument()
    })

    it('displays construction type name in detail drawer', async () => {
      masterDataApi.constructionTypes.mockResolvedValue({
        data: [
          {
            id: 'c-1',
            group: 'SUTM',
            code: 'SUTM-01',
            name: 'A3C 150',
            is_active: true,
            current: { version_number: 1, valid_from: '2026-01-01', mappings_count: 3 },
          },
        ],
        meta: { current_page: 1, per_page: 25, total: 1, last_page: 1 },
      })

      masterDataApi.constructionType.mockResolvedValue({
        data: {
          id: 'c-1',
          group_code: 'SUTM',
          code: 'SUTM-01',
          is_active: true,
          versions: [
            {
              id: 'v-1',
              version_number: 1,
              name: 'A3C 150',
              status: 'APPROVED',
              mappings_count: 3,
            },
          ],
        },
      })

      masterDataApi.constructionMappings.mockResolvedValue({
        data: [
          { sequence: 1, khs_code: '2', khs_name: 'AAAC - 150 sqmm', khs_unit: 'M', relation: 'DIRECT' },
        ],
      })

      render(
        <MemoryRouter>
          <NotificationProvider>
            <ConstructionsPage />
          </NotificationProvider>
        </MemoryRouter>
      )

      expect(await screen.findByText('A3C 150')).toBeInTheDocument()

      // Click detail action button
      const viewBtn = screen.getByRole('button', { name: /Detail Konstruksi & BOM/i })
      await userEvent.click(viewBtn)

      // Detail drawer opens, verifies name is displayed
      expect(await screen.findByText('Standar Konstruksi & Pemetaan KHS (BOM)')).toBeInTheDocument()
      expect(screen.getByText('Nama Tipe Konstruksi')).toBeInTheDocument()
      expect(screen.getAllByText('A3C 150').length).toBeGreaterThanOrEqual(1)
      expect(screen.getByText('AAAC - 150 sqmm')).toBeInTheDocument()
    })
  })

  describe('CategoriesPage', () => {
    it('switches between categories and units tabs', async () => {
      render(
        <MemoryRouter>
          <NotificationProvider>
            <CategoriesPage />
          </NotificationProvider>
        </MemoryRouter>
      )

      expect(await screen.findByText('Trafo Distribusi')).toBeInTheDocument()
      expect(screen.getByText('TRAFO')).toBeInTheDocument()

      // Switch to units tab
      const unitTab = screen.getByRole('button', { name: /Satuan Pengukuran/ })
      await userEvent.click(unitTab)

      expect(await screen.findByText('Meter')).toBeInTheDocument()
      expect(screen.getByText('MTR')).toBeInTheDocument()
    })

    it('supports CSV upload with dry-run preview and apply for both categories and units', async () => {
      masterDataApi.createCategory.mockResolvedValue({ data: { id: 'cat-2' } })
      masterDataApi.updateCategory.mockResolvedValue({ data: { id: 'cat-1' } })
      masterDataApi.createUnit.mockResolvedValue({ data: { id: 'u-2' } })
      masterDataApi.updateUnit.mockResolvedValue({ data: { id: 'u-1' } })

      render(
        <MemoryRouter>
          <NotificationProvider>
            <CategoriesPage />
          </NotificationProvider>
        </MemoryRouter>
      )

      expect(await screen.findByText('Trafo Distribusi')).toBeInTheDocument()

      // 1. Open Category Drawer via single header button and switch to Via Upload (CSV)
      await userEvent.click(screen.getByRole('button', { name: /Tambah Kategori/i }))
      expect(await screen.findByText('Tambah Kategori Material')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /Via Upload \(CSV\)/i }))
      expect(await screen.findByText('Format Berkas CSV Kategori Material')).toBeInTheDocument()

      const catCsv = [
        'code,name,description',
        'TRAFO,"Trafo Distribusi 20kV","Transformator distribusi"',
        'KUBIKEL,"Kubikel 20 kV","Kubikel gardu"',
      ].join('\n')
      const catFile = new File([catCsv], 'kategori.csv', { type: 'text/csv' })
      const catInput = screen.getByLabelText('Berkas CSV Kategori')
      await userEvent.upload(catInput, catFile)

      await userEvent.click(screen.getByRole('button', { name: /Uji Validasi \(Dry Run\)/i }))
      expect(await screen.findByText('Hasil Validasi Pratinjau Kategori')).toBeInTheDocument()
      expect(screen.getByText('BARU')).toBeInTheDocument()
      expect(screen.getByText('PERBARUI')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: /Terapkan & Simpan Kategori \(2 Baris\)/i }))
      await waitFor(() => {
        expect(masterDataApi.updateCategory).toHaveBeenCalledWith('cat-1', {
          name: 'Trafo Distribusi 20kV',
          description: 'Transformator distribusi',
          is_active: true,
        })
        expect(masterDataApi.createCategory).toHaveBeenCalledWith({
          code: 'KUBIKEL',
          name: 'Kubikel 20 kV',
          description: 'Kubikel gardu',
        })
      })

      // 2. Switch to Units tab, open Unit Drawer via single header button and switch to Via Upload (CSV)
      await userEvent.click(screen.getByRole('button', { name: /Satuan Pengukuran/ }))
      await userEvent.click(screen.getByRole('button', { name: /Tambah Satuan/i }))
      expect(await screen.findByText('Tambah Satuan Pengukuran (UoM)')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /Via Upload \(CSV\)/i }))
      expect(await screen.findByText('Format Berkas CSV Satuan Pengukuran (UoM)')).toBeInTheDocument()

      const unitCsv = [
        'code,name,symbol',
        'MTR,"Meter Panjang","m"',
        'BH,"Buah","Bh"',
      ].join('\n')
      const unitFile = new File([unitCsv], 'satuan.csv', { type: 'text/csv' })
      const unitInput = screen.getByLabelText('Berkas CSV Satuan')
      await userEvent.upload(unitInput, unitFile)

      await userEvent.click(screen.getByRole('button', { name: /Uji Validasi \(Dry Run\)/i }))
      expect(await screen.findByText('Hasil Validasi Pratinjau Satuan (UoM)')).toBeInTheDocument()

      await userEvent.click(screen.getByRole('button', { name: /Terapkan & Simpan Satuan \(2 Baris\)/i }))
      await waitFor(() => {
        expect(masterDataApi.updateUnit).toHaveBeenCalledWith('u-1', {
          name: 'Meter Panjang',
          symbol: 'm',
          is_active: true,
        })
        expect(masterDataApi.createUnit).toHaveBeenCalledWith({
          code: 'BH',
          name: 'Buah',
          symbol: 'Bh',
        })
      })
    })
  })
})
