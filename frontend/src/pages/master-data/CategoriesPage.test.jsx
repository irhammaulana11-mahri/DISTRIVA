import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import CategoriesPage from './CategoriesPage.jsx'
import MaterialsPage from './MaterialsPage.jsx'
import { masterDataApi } from '../../services/api.js'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'

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
  },
}))

const mockCategories = [
  // Level 1 Parents
  {
    id: 'cat-1',
    parent_id: null,
    code: 'TRAFO',
    name: 'Transformator Distribusi',
    description: 'Trafo distribusi 20kV',
    is_active: true,
    level: 1,
    children_count: 2,
    materials_count: 50,
  },
  {
    id: 'cat-2',
    parent_id: null,
    code: 'KUBIKEL',
    name: 'Kubikel 20 kV',
    description: 'Peralatan hubung 20kV',
    is_active: true,
    level: 1,
    children_count: 1,
    materials_count: 20,
  },
  {
    id: 'cat-old',
    parent_id: null,
    code: 'KWH_METER',
    name: 'KWH Meter Lama',
    description: 'Kategori lama nonaktif',
    is_active: false,
    level: 1,
    children_count: 0,
    materials_count: 0,
  },
  // Level 2 Subcategories
  {
    id: 'sub-1',
    parent_id: 'cat-1',
    code: 'TRF_1PH',
    name: 'Trafo 1 Fasa',
    description: 'Trafo 1 fasa tiang',
    is_active: true,
    level: 2,
    children_count: 0,
    materials_count: 30,
    parent_code: 'TRAFO',
  },
  {
    id: 'sub-2',
    parent_id: 'cat-1',
    code: 'TRF_3PH',
    name: 'Trafo 3 Fasa',
    description: 'Trafo 3 fasa gardu',
    is_active: true,
    level: 2,
    children_count: 0,
    materials_count: 20,
    parent_code: 'TRAFO',
  },
  {
    id: 'sub-3',
    parent_id: 'cat-2',
    code: 'KUB_IN',
    name: 'Kubikel Incoming',
    description: 'Incoming cell 20kV',
    is_active: true,
    level: 2,
    children_count: 0,
    materials_count: 20,
    parent_code: 'KUBIKEL',
  },
  {
    id: 'sub-inact',
    parent_id: 'cat-2',
    code: 'KUB_OBS',
    name: 'Kubikel Obsolete',
    description: 'Sel yang sudah tidak dipakai',
    is_active: false,
    level: 2,
    children_count: 0,
    materials_count: 0,
    parent_code: 'KUBIKEL',
  },
]

function renderWithProviders(ui, { can = { 'material_categories.manage': true } } = {}) {
  return render(
    <MemoryRouter>
      <AccessContext.Provider value={{ loading: false, can, canWrite: {}, isSysAdmin: false }}>
        <NotificationProvider>
          {ui}
        </NotificationProvider>
      </AccessContext.Provider>
    </MemoryRouter>
  )
}

describe('CategoriesPage & MaterialsPage — Two-Level Categories', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    masterDataApi.categories.mockResolvedValue({ data: mockCategories })
    masterDataApi.units.mockResolvedValue({ data: [] })
    masterDataApi.materials.mockResolvedValue({ data: [], meta: { current_page: 1, per_page: 25, total: 0 } })
  })

  it('1. renders categories tree from parent_id with collapsed state and expands on toggle', async () => {
    renderWithProviders(<CategoriesPage />)

    // Parents should be in document
    expect(await screen.findByText('Transformator Distribusi')).toBeInTheDocument()
    expect(screen.getByText('Kubikel 20 kV')).toBeInTheDocument()

    // Top summary cards
    expect(screen.getByText('Total Kategori Aktif')).toBeInTheDocument()
    expect(screen.getByText('Total Subkategori Aktif')).toBeInTheDocument()

    // Subcategories count on parent row
    expect(screen.getAllByText('2 Subkategori').length).toBeGreaterThan(0)
    expect(screen.getAllByText('1 Subkategori').length).toBeGreaterThan(0)

    // Total material count from server on parent row
    const trafoRow = screen.getByText('Transformator Distribusi').closest('tr')
    expect(within(trafoRow).getByText('50')).toBeInTheDocument()

    // By default, tree is collapsed: subcategories are not visible yet
    expect(screen.queryByText('Trafo 1 Fasa')).not.toBeInTheDocument()
    expect(screen.queryByText('Trafo 3 Fasa')).not.toBeInTheDocument()

    // Click chevron button to expand Transformator Distribusi
    const trafoToggle = within(trafoRow).getByRole('button', { name: /Buka subkategori/i })
    await userEvent.click(trafoToggle)

    // Subcategories should now be rendered with their code and material counts
    expect(await screen.findByText('Trafo 1 Fasa')).toBeInTheDocument()
    expect(screen.getByText('TRF_1PH')).toBeInTheDocument()
    const trf1Row = screen.getByText('Trafo 1 Fasa').closest('tr')
    expect(within(trf1Row).getByText('30')).toBeInTheDocument()

    expect(screen.getByText('Trafo 3 Fasa')).toBeInTheDocument()
    expect(screen.getByText('TRF_3PH')).toBeInTheDocument()
    const trf3Row = screen.getByText('Trafo 3 Fasa').closest('tr')
    expect(within(trf3Row).getByText('20')).toBeInTheDocument()
  })

  it('2. filters by search retaining parent and auto-expanding; toggles inactive categories', async () => {
    renderWithProviders(<CategoriesPage />)
    expect(await screen.findByText('Transformator Distribusi')).toBeInTheDocument()

    // Inactive category (KWH_METER) and inactive subcategory (KUB_OBS) should be hidden by default
    expect(screen.queryByText('KWH Meter Lama')).not.toBeInTheDocument()
    expect(screen.queryByText('Kubikel Obsolete')).not.toBeInTheDocument()

    // Search for subcategory "1 Fasa"
    const searchInput = screen.getByPlaceholderText(/Cari kode atau nama kategori/i)
    await userEvent.type(searchInput, '1 Fasa')

    // Parent TRAFO should remain visible and auto-expanded, showing "Trafo 1 Fasa"
    expect(await screen.findByText('Transformator Distribusi')).toBeInTheDocument()
    expect(screen.getByText('Trafo 1 Fasa')).toBeInTheDocument()
    // KUBIKEL does not match, so it should not be in the document
    expect(screen.queryByText('Kubikel 20 kV')).not.toBeInTheDocument()

    // Clear search
    await userEvent.clear(searchInput)
    expect(await screen.findByText('Kubikel 20 kV')).toBeInTheDocument()

    // Turn ON "Tampilkan nonaktif" toggle
    const toggleInactive = screen.getByLabelText(/Tampilkan nonaktif/i)
    await userEvent.click(toggleInactive)

    // Inactive category should now appear
    expect(await screen.findByText('KWH Meter Lama')).toBeInTheDocument()

    // Expand KUBIKEL to verify inactive subcategory shows
    const kubikelRow = screen.getByText('Kubikel 20 kV').closest('tr')
    const kubikelToggle = within(kubikelRow).getByRole('button', { name: /Buka subkategori/i })
    await userEvent.click(kubikelToggle)

    expect(await screen.findByText('Kubikel Obsolete')).toBeInTheDocument()
  })

  it('3. "Tambah Subkategori" sends parent_id and displays 422 server error verbatim', async () => {
    masterDataApi.createCategory.mockRejectedValueOnce(
      new Error('Kategori induk tidak valid atau telah mencapai batas kedalaman.')
    )

    renderWithProviders(<CategoriesPage />)
    expect(await screen.findByText('Transformator Distribusi')).toBeInTheDocument()

    // Click "Tambah Subkategori" on TRAFO parent row
    const trafoRow = screen.getByText('Transformator Distribusi').closest('tr')
    const addSubcategoryBtn = within(trafoRow).getByRole('button', { name: /Tambah Subkategori/i })
    await userEvent.click(addSubcategoryBtn)

    // Drawer should open with parent displayed
    expect(await screen.findByText('Tambah Subkategori Material')).toBeInTheDocument()
    expect(screen.getAllByText(/TRAFO - Transformator Distribusi/).length).toBeGreaterThan(0)

    // Fill form
    const codeInput = screen.getByPlaceholderText(/Contoh: TRF_1PH/i)
    const nameInput = screen.getByPlaceholderText(/Contoh: Trafo 1 Fasa/i)
    await userEvent.type(codeInput, 'TRF_NEW')
    await userEvent.type(nameInput, 'Trafo Varian Baru')

    // Submit
    const submitBtn = screen.getByRole('button', { name: /Simpan Subkategori/i })
    await userEvent.click(submitBtn)

    // Should call API with parent_id: 'cat-1'
    expect(masterDataApi.createCategory).toHaveBeenCalledWith({
      code: 'TRF_NEW',
      name: 'Trafo Varian Baru',
      description: undefined,
      parent_id: 'cat-1',
    })

    // Error from server should be displayed verbatim
    expect(
      await screen.findByText('Kategori induk tidak valid atau telah mencapai batas kedalaman.')
    ).toBeInTheDocument()
  })

  it('4. MaterialsPage category filter sends category_id, and edit drawer offers only active leaf subcategories', async () => {
    masterDataApi.materials.mockResolvedValue({
      data: [
        {
          id: 'mat-10',
          code: '1002389',
          name: 'TRF DIS;;20kV/231V;1P;25kVA;;OD',
          unit: 'U',
          spec: '25 kVA 1P',
          category: { id: 'sub-1', code: 'TRF_1PH', name: 'Trafo 1 Fasa' },
          is_active: true,
        },
      ],
      meta: { current_page: 1, per_page: 25, total: 1 },
    })

    renderWithProviders(<MaterialsPage />)

    // Verify row display has hierarchy: parent name above, subcategory name below
    expect(await screen.findByText('1002389')).toBeInTheDocument()
    expect(screen.getByText('Transformator Distribusi ›')).toBeInTheDocument()
    expect(screen.getByText('Trafo 1 Fasa')).toBeInTheDocument()

    // Test Category Filter dropdown
    const filterSelect = screen.getByLabelText(/Filter Kategori Material/i)
    expect(filterSelect).toBeInTheDocument()

    // Filter by selecting parent TRAFO
    await userEvent.selectOptions(filterSelect, 'cat-1')
    await waitFor(() => {
      expect(masterDataApi.materials).toHaveBeenCalledWith(
        expect.objectContaining({ category_id: 'cat-1' })
      )
    })

    // Open Edit Material Drawer
    const editBtn = screen.getByTitle(/Ubah Pemetaan Kategori & Status/i)
    await userEvent.click(editBtn)

    expect(await screen.findByText('Ubah Pemetaan Material')).toBeInTheDocument()

    // The category dropdown in edit drawer
    const catSelect = screen.getByLabelText(/Kategori Material Standar/i)
    expect(catSelect).toBeInTheDocument()

    // Active subcategories should be present
    expect(within(catSelect).getByText('TRF_1PH - Trafo 1 Fasa')).toBeInTheDocument()
    expect(within(catSelect).getByText('TRF_3PH - Trafo 3 Fasa')).toBeInTheDocument()
    expect(within(catSelect).getByText('KUB_IN - Kubikel Incoming')).toBeInTheDocument()

    // Inactive subcategories and parent categories with children should NOT be selectable options
    expect(within(catSelect).queryByText(/Kubikel Obsolete/i)).not.toBeInTheDocument()
    expect(within(catSelect).queryByText(/KWH Meter Lama/i)).not.toBeInTheDocument()

    // Submit with reason to verify server rejection display
    masterDataApi.updateMaterial.mockRejectedValueOnce(
      new Error('Kategori terpilih tidak boleh berupa kategori induk yang memiliki subkategori.')
    )
    const reasonInput = screen.getByLabelText(/Alasan Perubahan/i)
    await userEvent.type(reasonInput, 'Pembaruan kategori')
    await userEvent.click(screen.getByRole('button', { name: /Simpan Perubahan/i }))

    expect(
      await screen.findByText('Kategori terpilih tidak boleh berupa kategori induk yang memiliki subkategori.')
    ).toBeInTheDocument()
  })

  it('5. action buttons are hidden when user lacks material_categories.manage capability', async () => {
    // Render without material_categories.manage permission
    renderWithProviders(<CategoriesPage />, { can: { 'material_categories.manage': false } })

    expect(await screen.findByText('Transformator Distribusi')).toBeInTheDocument()

    // Header "+ Tambah Kategori" button should not exist
    expect(screen.queryByRole('button', { name: /Tambah Kategori/i })).not.toBeInTheDocument()

    // Row action buttons (Tambah Subkategori, Ubah, Nonaktifkan) should not exist
    expect(screen.queryByRole('button', { name: /Tambah Subkategori/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Edit Kategori/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Nonaktifkan/i })).not.toBeInTheDocument()
  })
})
