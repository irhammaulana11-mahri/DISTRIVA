import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import WarehousesPage from '../master-data/WarehousesPage.jsx'
import KhsMaterialMapPage from '../master-data/KhsMaterialMapPage.jsx'
import MaterialRequestsPanel from '../work-orders/MaterialRequestsPanel.jsx'
import ReportsPage from './ReportsPage.jsx'
import RkmVersionDetailPage from '../rkm/RkmVersionDetailPage.jsx'
import {
  adminApi,
  warehousesApi,
  khsMaterialMapApi,
  materialRequestsApi,
  reportsApi,
  rkmApi,
  triggerFileDownload,
} from '../../services/api.js'

// Mock APIs
vi.mock('../../services/api.js', () => ({
  adminApi: {
    units: vi.fn(),
  },
  warehousesApi: {
    list: vi.fn(),
    create: vi.fn(),
    importErp: vi.fn(),
    snapshots: vi.fn(),
    importSnapshot: vi.fn(),
    snapshotDetail: vi.fn(),
    unmapped: vi.fn(),
    syncRuns: vi.fn(),
    syncStock: vi.fn(),
    mimsTokenStatus: vi.fn(),
    forgetMimsToken: vi.fn(),
    position: vi.fn(),
  },
  khsMaterialMapApi: {
    list: vi.fn(),
    workbench: vi.fn(),
    suggestions: vi.fn(),
    coverage: vi.fn(),
    create: vi.fn(),
    importCsv: vi.fn(),
    delete: vi.fn(),
  },
  materialRequestsApi: {
    list: vi.fn(),
    get: vi.fn(),
    export: vi.fn(),
    markSent: vi.fn(),
    cancel: vi.fn(),
  },
  reportsApi: {
    units: vi.fn(),
    overview: vi.fn(),
    downloadOverviewXlsx: vi.fn(),
    pipeline: vi.fn(),
    downloadPipelineXlsx: vi.fn(),
    sla: vi.fn(),
    downloadSlaXlsx: vi.fn(),
    costVariance: vi.fn(),
    downloadCostVarianceXlsx: vi.fn(),
    settings: vi.fn(),
    saveSettings: vi.fn(),
    vendorPerformance: vi.fn(),
    downloadVendorPerformanceXlsx: vi.fn(),
    criticalStock: vi.fn(),
    downloadCriticalStockXlsx: vi.fn(),
    kkfFeasibility: vi.fn(),
    downloadKkfFeasibilityXlsx: vi.fn(),
    erpAnomalies: vi.fn(),
    downloadErpAnomaliesXlsx: vi.fn(),
    rkm: vi.fn(),
    downloadRkmXlsx: vi.fn(),
  },
  rkmApi: {
    version: vi.fn(),
    requirements: vi.fn(),
    startValidation: vi.fn(),
    adjust: vi.fn(),
    decide: vi.fn(),
    amend: vi.fn(),
  },
  triggerFileDownload: vi.fn(),
  downloadBlob: vi.fn(),
}))

function renderWithProviders(ui, { can = {}, route = '/', path = '*' } = {}) {
  const accessValue = {
    loading: false,
    can,
    canWrite: {},
    isSysAdmin: Boolean(can['backups.view']),
  }

  return render(
    <AccessContext.Provider value={accessValue}>
      <NotificationProvider>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={ui} />
          </Routes>
        </MemoryRouter>
      </NotificationProvider>
    </AccessContext.Provider>
  )
}

describe('Gudang ERP, Pemetaan SKU↔KHS, Outbox & Laporan Workflow (docs/79, docs/57)', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    adminApi.units.mockResolvedValue({
      data: [
        { id: 'u-ulp-1', code: 'ULP-MJO', name: 'ULP Mojokerto Kota', unit_type: 'ULP' },
        { id: 'u-up3-1', code: 'UP3-MJK', name: 'UP3 Mojokerto', unit_type: 'UP3' },
      ],
    })

    reportsApi.units.mockResolvedValue({
      data: {
        scope: 'GLOBAL',
        up3_units: [
          { id: 'u-up3-1', code: 'UP3-MJK', name: 'UP3 Mojokerto' },
          { id: 'u-up3-2', code: 'UP3-SBY', name: 'UP3 Surabaya' },
        ],
        ulp_units: [
          { id: 'u-ulp-1', code: 'ULP-MJO', name: 'ULP Mojokerto Kota', parent_id: 'u-up3-1', parent_code: 'UP3-MJK', parent_name: 'UP3 Mojokerto' },
          { id: 'u-ulp-2', code: 'ULP-NGN', name: 'ULP Ngoro', parent_id: 'u-up3-1', parent_code: 'UP3-MJK', parent_name: 'UP3 Mojokerto' },
          { id: 'u-ulp-3', code: 'ULP-SBY', name: 'ULP Surabaya Selatan', parent_id: 'u-up3-2', parent_code: 'UP3-SBY', parent_name: 'UP3 Surabaya' },
        ],
        default_up3_id: '',
        default_unit_id: '',
      },
    })

    warehousesApi.list.mockResolvedValue({
      data: [
        {
          id: 'w-1',
          code: 'GDG-UP3',
          name: 'Gudang Area Mojokerto',
          is_active: true,
          plant: '5110',
          stor_loc: 'SL01',
          kind: 'GI',
          erp_unit_code: '51330',
          unit: { id: 'u-up3-1', code: 'UP3-MJK', name: 'UP3 Mojokerto' },
        },
      ],
    })

    reportsApi.overview.mockResolvedValue({
      data: {
        applications: { total: 0, by_status: {}, by_type: {}, by_source: {} },
        proposals: { open: 0, cancelled: 0 },
        rab: { applications_with_run: 0, total_value: 0 },
        kkf: { applications_with_run: 0, feasible: 0, not_feasible: 0, extended_required: 0 },
        work_orders: { by_status: {} },
        bastp: { by_status: {} },
        material_requests: { by_status: {}, needs_followup: 0 },
      },
    })
  })

  describe('1. Gudang & Cuplikan Stok ERP', () => {
    it('melakukan dry run impor daftar gudang ERP format JSON dan menerapkan perubahan', async () => {
      warehousesApi.importErp.mockResolvedValueOnce({
        data: { total: 1, created: 1, updated: 0, rejected: 0, dry_run: true },
        rows: [
          {
            plant: '5110',
            stor_loc: 'SL02',
            name: 'Gudang Penyangga Krian',
            unit: '51331',
            kind: 'GO',
            status: 'BARU',
            reason: null,
          },
        ],
      })

      warehousesApi.importErp.mockResolvedValueOnce({
        data: { total: 1, accepted: 1, dry_run: false },
      })

      renderWithProviders(<WarehousesPage />, {
        can: { 'warehouses.manage': true, 'master_data.view': true },
      })

      await waitFor(() => {
        expect(screen.getByText('GDG-UP3')).toBeInTheDocument()
      })

      // Verify new ERP columns
      expect(screen.getByText('5110')).toBeInTheDocument()
      expect(screen.getByText('SL01')).toBeInTheDocument()
      expect(screen.getByText('GI')).toBeInTheDocument()
      expect(screen.getByText('51330')).toBeInTheDocument()

      // Open unified warehouse drawer and switch to Via Upload (JSON ERP)
      const importBtn = screen.getByRole('button', { name: /Impor Gudang ERP/i })
      await userEvent.click(importBtn)
      await userEvent.click(screen.getByRole('button', { name: /Via Upload \(JSON ERP\)/i }))

      expect(screen.getByText(/Tempel payload JSON daftar gudang ERP/i)).toBeInTheDocument()

      const textarea = screen.getByPlaceholderText(/gudang/i)
      const testJson = JSON.stringify({
        gudang: {
          data: [
            { plant: '5110', stor_loc: 'SL02', stor_loc_name: 'Gudang Penyangga Krian', unit: '51331', jenis: 'GO' },
          ],
        },
      })
      fireEvent.change(textarea, { target: { value: testJson } })

      // Click Dry Run
      const dryRunBtn = screen.getByRole('button', { name: /Uji Validasi \(Dry Run\)/i })
      await userEvent.click(dryRunBtn)

      await waitFor(() => {
        expect(screen.getByText(/Hasil Validasi Pratinjau Gudang ERP/i)).toBeInTheDocument()
        expect(screen.getByText('Gudang Penyangga Krian')).toBeInTheDocument()
      })

      // Commit
      const commitBtn = screen.getByRole('button', { name: /Terapkan \(1 Gudang\)/i })
      await userEvent.click(commitBtn)

      await waitFor(() => {
        expect(warehousesApi.importErp).toHaveBeenCalledWith(
          expect.objectContaining({ dry_run: false })
        )
      })
    })

    it('menangani impor stok .xlsx dengan statistik terpetakan/belum dan membuka drawer SKU belum dipetakan', async () => {
      warehousesApi.snapshots.mockResolvedValue({
        data: [
          {
            id: 'snap-1',
            as_of: '2026-11-07',
            source_reference: 'SAP Monitoring Stock',
            lines: 15,
            materials_total: 20,
            materials_mapped: 15,
            created_by_name: 'Petugas Gudang',
          },
        ],
      })

      warehousesApi.unmapped.mockResolvedValue({
        data: [
          { material_no: '100455', name: 'KABEL NYFGBY 4X25 MM2', unit: 'MTR', stock_ready: 250 },
        ],
        meta: { total: 1 },
      })

      renderWithProviders(<WarehousesPage />, {
        can: { 'stock.import': true, 'master_data.view': true },
      })

      await waitFor(() => {
        expect(screen.getByText('GDG-UP3')).toBeInTheDocument()
      })

      // Open snapshots drawer
      await userEvent.click(screen.getByRole('button', { name: /Cuplikan Stok/i }))

      await waitFor(() => {
        expect(screen.getByText('15 baris KHS')).toBeInTheDocument()
        expect(screen.getByText('15 / 20 SKU terpetakan')).toBeInTheDocument()
      })

      // Click button SKU Belum Dipetakan
      const unmappedBtn = screen.getByRole('button', { name: /SKU Belum Dipetakan/i })
      await userEvent.click(unmappedBtn)

      await waitFor(() => {
        expect(screen.getByText('Daftar SKU ERP Belum Terpetakan')).toBeInTheDocument()
        expect(screen.getByText('100455')).toBeInTheDocument()
        expect(screen.getByText('KABEL NYFGBY 4X25 MM2')).toBeInTheDocument()
        expect(screen.getByText('250')).toBeInTheDocument()
      })
    })

    it('menampilkan riwayat sinkronisasi otomatis, spanduk bila sync_configured=false, dan tidak menampilkan token', async () => {
      warehousesApi.syncRuns.mockResolvedValue({
        data: [
          {
            id: 'run-1',
            warehouse_code: 'GDG-UP3',
            warehouse_name: 'Gudang Area Mojokerto',
            status: 'OK',
            message: 'Sinkronisasi stok 120 SKU selesai.',
            snapshot_id: 'snap-10',
            materials_total: 120,
            materials_mapped: 115,
            started_at: '2026-11-07T06:00:00Z',
            finished_at: '2026-11-07T06:02:00Z',
          },
          {
            id: 'run-2',
            warehouse_code: 'GDG-UP3',
            warehouse_name: 'Gudang Area Mojokerto',
            status: 'FAILED',
            message: 'Koneksi timeout ke server logistik MIMS.',
            snapshot_id: null,
            materials_total: 0,
            materials_mapped: 0,
            started_at: '2026-11-06T06:00:00Z',
            finished_at: '2026-11-06T06:01:00Z',
          },
        ],
        sync_configured: false,
      })

      renderWithProviders(<WarehousesPage />, {
        can: { 'master_data.view': true },
      })

      // Switch to Riwayat Sinkronisasi tab
      const syncTab = screen.getByRole('button', { name: /Riwayat Sinkronisasi/i })
      await userEvent.click(syncTab)

      await waitFor(() => {
        expect(screen.getByText(/Sinkronisasi otomatis belum dikonfigurasi di server/i)).toBeInTheDocument()
        expect(screen.getByText('Sinkronisasi stok 120 SKU selesai.')).toBeInTheDocument()
        expect(screen.getByText('Koneksi timeout ke server logistik MIMS.')).toBeInTheDocument()
      })

      // Security check: ensure no token or secret credential input exists in DOM
      expect(screen.queryByPlaceholderText(/token/i)).not.toBeInTheDocument()
      expect(screen.queryByText(/Bearer/i)).not.toBeInTheDocument()
    })

    it('Tarik stok MIMS: memilih token tersimpan (tanpa menempel), menyimpan token baru bila dicentang, dan menghapus token tersimpan', async () => {
      warehousesApi.mimsTokenStatus.mockResolvedValue({ data: { saved: true, saved_at: '2026-11-01T08:00:00Z', last_used_at: '2026-11-10T08:00:00Z', last_result: 'OK' } })
      warehousesApi.forgetMimsToken.mockResolvedValue({ message: 'ok' })
      warehousesApi.syncStock.mockResolvedValue({ data: [{ warehouse_id: 'w-1', warehouse_code: 'GDG-UP3', warehouse_name: 'Gudang', status: 'OK', message: 'ok', snapshot_id: 's1', total: 5, mapped: 5 }] })
      renderWithProviders(<WarehousesPage />, { can: { 'stock.import': true, 'master_data.view': true } })
      await screen.findByText('GDG-UP3')
      await userEvent.click(screen.getByRole('button', { name: /Tarik Stok dari MIMS/i }))

      const saved = await screen.findByRole('radio', { name: /Gunakan token tersimpan/i })
      await userEvent.click(saved)
      expect(screen.queryByPlaceholderText(/Tempel token sesi MIMS/i)).not.toBeInTheDocument()   // tidak perlu menempel
      await userEvent.click(screen.getByRole('button', { name: /Tarik Stok Sekarang/i }))
      await waitFor(() => expect(warehousesApi.syncStock).toHaveBeenCalledWith({ use_saved_token: true, warehouse_ids: undefined, date: undefined, dry_run: undefined }))

      await userEvent.click(screen.getByRole('button', { name: /Tarik Ulang/i }))
      await userEvent.click(await screen.findByRole('radio', { name: /Tempel token baru/i }))
      fireEvent.change(screen.getByPlaceholderText(/Tempel token sesi MIMS/i), { target: { value: 'token-baru-abcdef123456' } })
      await userEvent.click(screen.getByLabelText(/Simpan token ini untuk penarikan berikutnya/i))
      await userEvent.click(screen.getByRole('button', { name: /Tarik Stok Sekarang/i }))
      await waitFor(() => expect(warehousesApi.syncStock).toHaveBeenLastCalledWith(expect.objectContaining({ token: 'token-baru-abcdef123456', save_token: true })))
    })

    it('membuka dialog Tarik stok dari MIMS, mengirimkan token jenis password, segera mengosongkan token, dan menampilkan hasil per gudang', async () => {
      warehousesApi.syncStock.mockResolvedValueOnce({
        data: [
          {
            warehouse_id: 'w-1',
            warehouse_code: 'GDG-UP3',
            warehouse_name: 'Gudang Area Mojokerto',
            status: 'OK',
            message: 'Tarik stok 1254 SKU berhasil.',
            snapshot_id: 'snap-mims-1',
            total: 1254,
            mapped: 97,
          },
        ],
      })

      renderWithProviders(<WarehousesPage />, {
        can: { 'stock.import': true, 'master_data.view': true },
      })

      await waitFor(() => {
        expect(screen.getByText('GDG-UP3')).toBeInTheDocument()
      })

      // Click button Tarik Stok dari MIMS
      const mimsBtn = screen.getByRole('button', { name: /Tarik Stok dari MIMS/i })
      await userEvent.click(mimsBtn)

      // Dialog opens
      expect(screen.getByRole('heading', { name: /Tarik Stok dari MIMS/i })).toBeInTheDocument()

      const tokenInput = screen.getByPlaceholderText(/Tempel token sesi MIMS Anda di sini/i)
      expect(tokenInput).toHaveAttribute('type', 'password')

      // Fill in token
      fireEvent.change(tokenInput, { target: { value: 'mims-secret-token-abcdef123456' } })

      // Submit pull
      const submitBtn = screen.getByRole('button', { name: /Tarik Stok Sekarang/i })
      await userEvent.click(submitBtn)

      // Verify API was called with the token
      await waitFor(() => {
        expect(warehousesApi.syncStock).toHaveBeenCalledWith(
          expect.objectContaining({
            token: 'mims-secret-token-abcdef123456',
          })
        )
      })

      // Security check: token input is immediately cleared in memory/state
      expect(tokenInput.value).toBe('')

      // Verify results rendered and close/reset buttons are functional
      await waitFor(() => {
        expect(screen.getByText(/Hasil Penarikan Stok MIMS/i)).toBeInTheDocument()
        expect(screen.getByText('1.254')).toBeInTheDocument()
        expect(screen.getByText('97')).toBeInTheDocument()
        expect(screen.getByText('1.157')).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /SKU Belum Terpetakan/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Tutup \/ Selesai/i })).toBeInTheDocument()
        expect(screen.getByRole('button', { name: /Tarik Ulang/i })).toBeInTheDocument()
      })

      // Test "Tarik Ulang" clears results
      await userEvent.click(screen.getByRole('button', { name: /Tarik Ulang/i }))
      expect(screen.queryByText(/Hasil Penarikan Stok MIMS/i)).not.toBeInTheDocument()
      expect(screen.getByRole('heading', { name: /Tarik Stok dari MIMS/i })).toBeInTheDocument()

      // Close modal using "Batal"
      await userEvent.click(screen.getByRole('button', { name: /Batal/i }))
      await waitFor(() => {
        expect(screen.queryByRole('heading', { name: /Tarik Stok dari MIMS/i })).not.toBeInTheDocument()
      })
    })

    it('menampilkan petunjuk ambil token baru bila token MIMS ditolak atau kedaluwarsa', async () => {
      warehousesApi.syncStock.mockRejectedValueOnce(
        new Error('Token ditolak atau kedaluwarsa pada server MIMS.')
      )

      renderWithProviders(<WarehousesPage />, {
        can: { 'stock.import': true, 'master_data.view': true },
      })

      await waitFor(() => {
        expect(screen.getByText('GDG-UP3')).toBeInTheDocument()
      })

      const mimsBtn = screen.getByRole('button', { name: /Tarik Stok dari MIMS/i })
      await userEvent.click(mimsBtn)

      const tokenInput = screen.getByPlaceholderText(/Tempel token sesi MIMS Anda di sini/i)
      fireEvent.change(tokenInput, { target: { value: 'token-kedaluwarsa-9999' } })

      const submitBtn = screen.getByRole('button', { name: /Tarik Stok Sekarang/i })
      await userEvent.click(submitBtn)

      await waitFor(() => {
        expect(screen.getAllByText(/Token ditolak atau kedaluwarsa/i).length).toBeGreaterThan(0)
        expect(screen.getByText(/Silakan ambil token baru dari aplikasi MIMS/i)).toBeInTheDocument()
      })
    })
  })

  describe('2. Meja Kerja Pemetaan SKU↔KHS', () => {
    it('memuat meja kerja, metrik cakupan, saran kecocokan, dan memilih saran SKU', async () => {
      khsMaterialMapApi.coverage.mockResolvedValue({
        data: {
          khs_used_percent: 85,
          khs_used_mapped: 17,
          khs_used_total: 20,
          sku_needed_total: 43,
          sku_needed_mapped: 5,
          sku_needed_percent: 11.6,
          khs_mapped_count: 50,
          khs_total_count: 60,
          total_mappings: 55,
          last_snapshot_mapped_skus: 110,
          last_snapshot_total_skus: 125,
        },
      })

      khsMaterialMapApi.workbench.mockResolvedValue({
        data: [
          {
            khs_code: '101',
            name: 'Kabel Twisted AL 3x70 + 1x50 mm2',
            unit: 'MTR',
            used_in_bom: true,
            mapped: [],
          },
        ],
        meta: { total: 1 },
      })

      khsMaterialMapApi.suggestions.mockResolvedValue({
        data: [
          {
            material_no: '200192',
            material_name: 'LVTC 3X70+1X50 MM2 SPLN 42-10',
            unit: 'MTR',
            score: 0.94,
            source: 'KATALOG_ERP',
          },
        ],
      })

      khsMaterialMapApi.create.mockResolvedValue({
        data: { id: 'map-new-1' },
      })

      renderWithProviders(<KhsMaterialMapPage />, {
        can: { 'khs.manage': true, 'master_data.view': true },
      })

      await waitFor(() => {
        expect(screen.getByText(/KHS PLN terpetakan/i)).toBeInTheDocument()
        expect(screen.getByText('5 dari 43')).toBeInTheDocument()
        expect(screen.getByText(/Semua KHS dipakai BOM: 17 dari 20 \(85%\)/i)).toBeInTheDocument()
        expect(screen.getAllByText('Kabel Twisted AL 3x70 + 1x50 mm2').length).toBeGreaterThan(0)
      })

      // Verify disclaimer banner
      expect(screen.getByText(/Pemeriksaan Spesifikasi Wajib/i)).toBeInTheDocument()

      // Verify suggestion rendered
      await waitFor(() => {
        expect(screen.getByText('200192')).toBeInTheDocument()
        expect(screen.getByText(/LVTC 3X70\+1X50/i)).toBeInTheDocument()
        expect(screen.getByText('Skor: 94%')).toBeInTheDocument()
      })

      // Choose SKU suggestion
      const chooseBtn = screen.getByRole('button', { name: /Pilih SKU/i })
      await userEvent.click(chooseBtn)

      await waitFor(() => {
        expect(khsMaterialMapApi.create).toHaveBeenCalledWith({
          khs_code: '101',
          material_no: '200192',
        })
      })
    })

    it('menampilkan galat 409 apa adanya saat SKU sudah dipetakan ke KHS lain', async () => {
      khsMaterialMapApi.coverage.mockResolvedValue({ data: {} })
      khsMaterialMapApi.workbench.mockResolvedValue({
        data: [
          { khs_code: '101', name: 'Item KHS 101', unit: 'MTR', used_in_bom: false, mapped: [] },
        ],
      })
      khsMaterialMapApi.suggestions.mockResolvedValue({
        data: [{ material_no: '999999', material_name: 'Material Uji', unit: 'MTR', score: 0.8 }],
      })

      khsMaterialMapApi.create.mockRejectedValue({
        status: 409,
        message: 'Nomor material ERP 999999 sudah dipetakan ke kode KHS 105.',
      })

      renderWithProviders(<KhsMaterialMapPage />, {
        can: { 'khs.manage': true, 'master_data.view': true },
      })

      await waitFor(() => {
        expect(screen.getByText('999999')).toBeInTheDocument()
      })

      const chooseBtn = screen.getByRole('button', { name: /Pilih SKU/i })
      await userEvent.click(chooseBtn)

      await waitFor(() => {
        expect(
          screen.getByText('Nomor material ERP 999999 sudah dipetakan ke kode KHS 105.')
        ).toBeInTheDocument()
      })
    })
  })

  describe('3. Permintaan Material (Outbox)', () => {
    it('menampilkan daftar outbox, peringatan KHS belum terpetakan, dan melakukan ekspor, tandai diserahkan, serta batal', async () => {
      materialRequestsApi.list.mockResolvedValue({
        data: [
          {
            id: 'req-1',
            status: 'PENDING',
            needs_followup: true,
            external_reference: null,
            exported_at: null,
            sent_at: null,
            created_at: '2026-11-07T08:00:00Z',
            wo_number: 'WO-2026-001',
            application_number: 'PB-2026-001',
          },
        ],
        meta: { total: 1 },
      })

      materialRequestsApi.get.mockResolvedValue({
        data: {
          id: 'req-1',
          work_order_id: 'wo-1',
          idempotency_key: 'REQ-WO-2026-001',
          status: 'PENDING',
          needs_followup: true,
          external_reference: null,
          unmapped_khs: ['901-TIDAK-ADA'],
          position: {
            package_id: 'pkg-1', wo_package_id: 'pkg-1', vendor_count: 1, fulfilment: 'NONE', ready_to_send: true, oversent: false,
            materials: [
              { khs_item_id: 'k1', khs_code: '101', name: 'Kabel Twisted', unit: 'MTR', skus: ['200192'], need: 100, allocated: 60, shipped: 0, ready: 60, waiting: 40, oversent: 0, status: 'READY',
                allocation: [{ warehouse_id: 'w1', warehouse: 'Gd Ry Jombang', plant: '5118', stor_loc: '2810', allocated: 60, shipped: 0, ready: 60 }] },
              { khs_item_id: 'k2', khs_code: '901-TIDAK-ADA', name: 'Konektor Khusus', unit: 'BH', skus: [], need: 10, allocated: 0, shipped: 0, ready: 0, waiting: 10, oversent: 0, status: 'WAITING', allocation: [] },
            ],
          },
          shipments: [],
          payload: {
            wo_number: 'WO-2026-001',
            application_number: 'PB-2026-001',
            materials: [],
            poles: [],
          },
          events: [
            { event_type: 'CREATED', reason: 'WO diterbitkan', actor_name: 'Asman Konstruksi', occurred_at: '2026-11-07T08:00:00Z' },
          ],
        },
      })

      materialRequestsApi.export.mockResolvedValue({
        blob: new Blob(['mock-xlsx'], { type: 'application/vnd.openxmlformats' }),
        filename: 'KEBUTUHAN-MATERIAL.xlsx',
      })

      materialRequestsApi.markSent.mockResolvedValue({
        message: 'Permintaan ditandai diserahkan ke aplikasi material.',
      })

      materialRequestsApi.cancel.mockResolvedValue({
        message: 'Permintaan dibatalkan.',
      })

      renderWithProviders(<MaterialRequestsPanel applicationId="app-1" />, {
        can: { 'material_requests.view': true, 'material_requests.manage': true },
      })

      await waitFor(() => {
        expect(screen.getByText('WO-2026-001')).toBeInTheDocument()
        expect(screen.getAllByText(/PERLU TINDAK LANJUT/i).length).toBeGreaterThan(1)
      })
      expect(materialRequestsApi.list).toHaveBeenCalledWith(expect.objectContaining({ application_id: 'app-1' }))   // hanya permintaan agenda ini

      // Open Detail
      await userEvent.click(screen.getByRole('button', { name: /Rincian/i }))

      await waitFor(() => {
        expect(screen.getByText(/KHS Belum Terpetakan ke Nomor Material ERP/i)).toBeInTheDocument()
        expect(screen.getAllByText('901-TIDAK-ADA').length).toBeGreaterThan(0)
        expect(screen.getByText('200192')).toBeInTheDocument()
        expect(screen.getByText(/1 material vendor tidak termasuk/)).toBeInTheDocument()       // material vendor tidak ada di permintaan
        expect(screen.getByText(/Gd Ry Jombang/)).toBeInTheDocument()                          // gudang dari alokasi
        expect(screen.getByText(/1 material PLN dalam WO ini/)).toBeInTheDocument()            // peringatan SKU hanya menghitung material PLN
        expect(screen.getByText('Menunggu 10')).toBeInTheDocument()                            // belum ada alokasi sama sekali
        expect(screen.getByText('+ menunggu 40')).toBeInTheDocument()                          // sebagian siap, sisanya menunggu alokasi
      })
      expect(screen.queryByText('Tidak diperlukan')).not.toBeInTheDocument()
      expect(screen.getByText(/Belum ada penyerahan/)).toBeInTheDocument()

      // Test Export XLSX
      const exportBtn = screen.getByRole('button', { name: /Ekspor XLSX/i })
      await userEvent.click(exportBtn)
      await waitFor(() => {
        expect(materialRequestsApi.export).toHaveBeenCalledWith('req-1', 'xlsx')
      })

      // Test Mark Sent
      const markSentBtn = screen.getByRole('button', { name: /Tandai Diserahkan/i })
      await userEvent.click(markSentBtn)

      expect(screen.getByText('Tandai Permintaan Material Diserahkan')).toBeInTheDocument()
      const refInput = screen.getByPlaceholderText(/ND-LOG/i)
      fireEvent.change(refInput, { target: { value: 'ND-MIMS-9921' } })

      const submitSentBtn = screen.getByRole('button', { name: /Simpan & Tandai Diserahkan/i })
      await userEvent.click(submitSentBtn)

      await waitFor(() => {
        expect(materialRequestsApi.markSent).toHaveBeenCalledWith('req-1', {
          reference: 'ND-MIMS-9921',
        })
      })

      // Test Cancel
      const cancelBtn = screen.getByRole('button', { name: /Batalkan/i })
      await userEvent.click(cancelBtn)

      expect(screen.getByText('Batalkan Permintaan Material')).toBeInTheDocument()
      const reasonInput = screen.getByPlaceholderText(/Jelaskan alasan/i)
      fireEvent.change(reasonInput, { target: { value: 'Amandemen trase jaringan' } })

      const submitCancelBtn = screen.getByRole('button', { name: /Batalkan Permintaan/i })
      await userEvent.click(submitCancelBtn)

      await waitFor(() => {
        expect(materialRequestsApi.cancel).toHaveBeenCalledWith('req-1', {
          reason: 'Amandemen trase jaringan',
        })
      })
    })

    const stagedDetail = (over = {}) => ({
      data: {
        id: 'req-2', work_order_id: 'wo-1', idempotency_key: 'REQ-WO-2026-002', status: 'SENT', needs_followup: false, external_reference: 'ND-2', unmapped_khs: [], events: [],
        payload: { wo_number: 'WO-2026-002', application_number: 'PB-2026-002', materials: [], poles: [] },
        position: {
          package_id: 'pkg-2', wo_package_id: 'pkg-1', vendor_count: 3, fulfilment: 'PARTIAL', ready_to_send: true, oversent: true,
          materials: [
            { khs_item_id: 'k1', khs_code: '101', name: 'Kabel Twisted', unit: 'MTR', skus: ['200192'], need: 100, allocated: 100, shipped: 60, ready: 40, waiting: 0, oversent: 0, status: 'READY',
              allocation: [{ warehouse_id: 'w1', warehouse: 'Gd Ry Jombang', plant: '5118', stor_loc: '2810', allocated: 100, shipped: 60, ready: 40 }] },
            { khs_item_id: 'k3', khs_code: '105', name: 'Isolator Tarik', unit: 'BH', skus: ['300'], need: 2, allocated: 5, shipped: 5, ready: 0, waiting: 0, oversent: 3, status: 'OVERSENT',
              allocation: [{ warehouse_id: 'w1', warehouse: 'Gd Ry Jombang', plant: '5118', stor_loc: '2810', allocated: 5, shipped: 5, ready: 0 }] },
          ],
        },
        shipments: [{ sequence: 1, reference: 'ND-1', sent_at: '2026-11-08T08:00:00Z', sent_by_name: 'Konstruksi', lines: [{ khs_code: '101', name: 'Kabel Twisted', unit: 'MTR', warehouse: 'Gd Ry Jombang', plant: '5118', stor_loc: '2810', skus: ['200192'], quantity: 60 }, { khs_code: '105', name: 'Isolator Tarik', unit: 'BH', warehouse: 'Gd Ry Jombang', plant: '5118', stor_loc: '2810', skus: ['300'], quantity: 5 }, { khs_code: '110', name: 'Tiang Besi', unit: 'BH', warehouse: 'Gd Kediri', plant: '5119', stor_loc: '2811', skus: [], quantity: 2 }] }],
        handover_form: { company: ['PT. PLN (PERSERO)', 'UNIT INDUK'], wo_number: 'WO-2026-002', application_number: 'PB-2026-002', agenda_number: 'AG-77', customer_name: 'Budi', unit_name: 'ULP Jombang', vendor_name: 'CV Maju Jaya' },
        ...over,
      },
    })

    it('penyerahan bertahap: riwayat penyerahan, kelebihan diserahkan, MTO terbaru, dan tombol kirim hanya bila ada yang siap', async () => {
      materialRequestsApi.list.mockResolvedValue({ data: [{ id: 'req-2', status: 'SENT', needs_followup: false, fulfilment: 'PARTIAL', ready_to_send: true, oversent: true, external_reference: 'ND-2', exported_at: null, sent_at: '2026-11-08T08:00:00Z', created_at: '2026-11-07T08:00:00Z', wo_number: 'WO-2026-002', application_number: 'PB-2026-002' }], meta: { total: 1 } })
      materialRequestsApi.get.mockResolvedValue(stagedDetail())
      materialRequestsApi.markSent.mockResolvedValue({ message: 'Penyerahan ke-2 dicatat (1 baris material).', data: { sequence: 2, lines: 1, quantity: 40 } })

      renderWithProviders(<MaterialRequestsPanel applicationId="app-2" />, { can: { 'material_requests.view': true, 'material_requests.manage': true } })

      // daftar: kelengkapan, siap serah, dan kelebihan diserahkan ikut menandai tindak lanjut
      expect(await screen.findByText('Diserahkan sebagian')).toBeInTheDocument()
      expect(screen.getByText('Siap serah')).toBeInTheDocument()
      expect(screen.getAllByText(/PERLU TINDAK LANJUT/i).length).toBeGreaterThan(1)

      await userEvent.click(screen.getByRole('button', { name: /Rincian/i }))
      expect(await screen.findByText('Kelebihan Diserahkan')).toBeInTheDocument()
      expect(screen.getByText(/Isolator Tarik: kelebihan 3 BH/)).toBeInTheDocument()
      expect(screen.getByText(/Kebutuhan mengikuti MTO terbaru yang disetujui/)).toBeInTheDocument()
      expect(screen.getByText(/Penyerahan ke-1/)).toBeInTheDocument()
      expect(screen.getByText('ND-1')).toBeInTheDocument()
      expect(screen.getByText(/3 material vendor tidak termasuk/)).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Batalkan$/ })).not.toBeInTheDocument()     // sudah ada penyerahan: tidak bisa dibatalkan

      // tombol kirim aktif karena masih ada 40 MTR siap; dialog menyebut isi dan nomor penyerahan berikutnya
      const sendBtn = screen.getByRole('button', { name: /Tandai Diserahkan/i })
      expect(sendBtn).toBeEnabled()
      await userEvent.click(sendBtn)
      expect(screen.getByText('Tandai Permintaan Material Diserahkan')).toBeInTheDocument()
      expect(screen.getByText(/1 material akan dicatat sebagai penyerahan ke-2/)).toBeInTheDocument()
      fireEvent.change(screen.getByPlaceholderText(/ND-LOG/i), { target: { value: 'ND-2B' } })
      await userEvent.click(screen.getByRole('button', { name: /Simpan & Tandai Diserahkan/i }))
      await waitFor(() => expect(materialRequestsApi.markSent).toHaveBeenCalledWith('req-2', { reference: 'ND-2B' }))
    })

    it('mencetak form Perintah Penyerahan Barang (TUG 7) per gudang dari riwayat penyerahan', async () => {
      materialRequestsApi.list.mockResolvedValue({ data: [{ id: 'req-2', status: 'SENT', needs_followup: false, fulfilment: 'PARTIAL', ready_to_send: true, oversent: false, external_reference: 'ND-1', exported_at: null, sent_at: '2026-11-08T08:00:00Z', created_at: '2026-11-07T08:00:00Z', wo_number: 'WO-2026-002', application_number: 'PB-2026-002' }], meta: { total: 1 } })
      materialRequestsApi.get.mockResolvedValue(stagedDetail())
      const printSpy = vi.spyOn(window, 'print').mockImplementation(() => {})

      renderWithProviders(<MaterialRequestsPanel applicationId="app-2" />, { can: { 'material_requests.view': true, 'material_requests.manage': true } })
      await userEvent.click(await screen.findByRole('button', { name: /Rincian/i }))
      await userEvent.click(await screen.findByRole('button', { name: /Cetak Form Penyerahan \(TUG 7\)/i }))

      const dialog = await screen.findByRole('dialog', { name: /TUG 7/i })
      expect(within(dialog).getByText(/2 lembar/)).toBeInTheDocument()                      // satu lembar per gudang asal
      expect(within(dialog).getAllByText('PERINTAH PENYERAHAN BARANG')).toHaveLength(2)
      expect(within(dialog).getAllByText(/No\. ND-1/).length).toBeGreaterThan(0)
      expect(within(dialog).getAllByText(/Gd Ry Jombang — Plant 5118 · SLoc 2810/).length).toBeGreaterThan(0)
      expect(within(dialog).getByText('Kabel Twisted')).toBeInTheDocument()
      expect(within(dialog).getByText('200192')).toBeInTheDocument()
      expect(within(dialog).getAllByText(/CV Maju Jaya/).length).toBeGreaterThan(0)
      await userEvent.click(within(dialog).getByRole('button', { name: /Cetak \/ Simpan PDF/i }))
      expect(printSpy).toHaveBeenCalled()
      await userEvent.click(within(dialog).getByRole('button', { name: /Tutup/i }))
      expect(screen.queryByRole('dialog', { name: /TUG 7/i })).not.toBeInTheDocument()
      printSpy.mockRestore()
    })

    it('tombol Tandai Diserahkan nonaktif bila tidak ada material teralokasi yang belum diserahkan', async () => {
      materialRequestsApi.list.mockResolvedValue({ data: [{ id: 'req-3', status: 'PENDING', needs_followup: false, fulfilment: 'NONE', ready_to_send: false, oversent: false, external_reference: null, exported_at: null, sent_at: null, created_at: '2026-11-07T08:00:00Z', wo_number: 'WO-2026-003', application_number: 'PB-2026-003' }], meta: { total: 1 } })
      const detail = stagedDetail({ id: 'req-3', status: 'PENDING', shipments: [] })
      detail.data.position = { ...detail.data.position, ready_to_send: false, oversent: false, fulfilment: 'NONE', materials: [] }
      materialRequestsApi.get.mockResolvedValue(detail)

      renderWithProviders(<MaterialRequestsPanel applicationId="app-3" />, { can: { 'material_requests.view': true, 'material_requests.manage': true } })
      await userEvent.click(await screen.findByRole('button', { name: /Rincian/i }))
      expect(await screen.findByText(/Tidak ada material PLN pada paket ini/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Tandai Diserahkan/i })).toBeDisabled()
      expect(screen.getByRole('button', { name: /^Batalkan$/ })).toBeInTheDocument()            // belum ada penyerahan: masih bisa dibatalkan
    })
  })

  describe('4. Dashboard dan Laporan', () => {
    it('memuat ringkasan KPI overview, filter tanggal/ULP, dan unduhan XLSX', async () => {
      reportsApi.overview.mockResolvedValue({
        data: {
          applications: {
            total: 42,
            by_status: { COMPLETED: 10, IN_PROGRESS: 32 },
            by_type: { PASANG_BARU: 35, PERUBAHAN_DAYA: 7 },
            by_source: { MANUAL: 40, SIP3: 2 },
          },
          proposals: { open: 3, cancelled: 0 },
          rab: { applications_with_run: 25, total_value: 350000000 },
          kkf: { applications_with_run: 25, feasible: 20, not_feasible: 5, extended_required: 2 },
          work_orders: { by_status: { ISSUED: 15, COMPLETED: 10 } },
          bastp: { by_status: { CLOSED: 10 } },
          material_requests: { by_status: { SENT: 12, PENDING: 3 }, needs_followup: 1 },
        },
      })

      reportsApi.downloadOverviewXlsx.mockResolvedValue({
        blob: new Blob(['xlsx']),
        filename: 'RINGKASAN-OPERASIONAL.xlsx',
      })

      renderWithProviders(<ReportsPage />, {
        can: { 'reports.view': true },
      })

      await waitFor(() => {
        expect(screen.getByText('42')).toBeInTheDocument()
        expect(screen.getByText(/Rp 350.000.000/i)).toBeInTheDocument()
        expect(screen.getByText(/20 Layak/i)).toBeInTheDocument()
        expect(screen.getByText(/25 WO/i)).toBeInTheDocument()
      })

      // Test XLSX download
      const downloadBtn = screen.getByRole('button', { name: /Unduh XLSX/i })
      await userEvent.click(downloadBtn)

      await waitFor(() => {
        expect(reportsApi.downloadOverviewXlsx).toHaveBeenCalled()
        expect(triggerFileDownload).toHaveBeenCalled()
      })
    })

    it('memuat tabel alur pekerjaan per ULP (pipeline funnel)', async () => {
      reportsApi.pipeline.mockResolvedValue({
        data: [
          {
            unit_code: 'ULP-MJO',
            unit_name: 'ULP Mojokerto Kota',
            applications: 20,
            with_survey: 18,
            drawing_approved: 15,
            mto_approved: 14,
            rab_run: 14,
            kkf_run: 14,
            wo_issued: 10,
            wo_completed: 8,
            bastp_closed: 8,
          },
        ],
      })

      renderWithProviders(<ReportsPage />, {
        can: { 'reports.view': true },
      })

      // Switch to Funnel Tab
      const funnelTab = screen.getByRole('button', { name: /Alur Pekerjaan per ULP/i })
      await userEvent.click(funnelTab)

      await waitFor(() => {
        expect(screen.getByText('ULP-MJO')).toBeInTheDocument()
        expect(screen.getByText('ULP Mojokerto Kota')).toBeInTheDocument()
        expect(screen.getByText('18')).toBeInTheDocument()
      })
    })

    it('memuat tab SLA & Lead Time dan mengunduh XLSX', async () => {
      reportsApi.sla.mockResolvedValue({
        data: {
          summary: {
            total_applications: 10,
            active_applications: 5,
            overdue_count: 2,
            average_days_mohon_to_survey: 2.1,
            average_days_survey_to_drawing: 3.4,
            average_days_drawing_to_wo: 4.2,
            average_days_wo_to_nyala: 4.8,
            average_total_cycle_days: 14.5,
          },
          rows: [
            {
              id: 'app-01',
              application_number: 'APP-2026-001',
              customer_name: 'Pasang Baru PT Maju',
              unit_code: 'ULP-MJO',
              current_stage: 'Konstruksi Fisik',
              age_days: 14,
              t1_survey_days: 2.0,
              t2_drawing_days: 3.0,
              t3_wo_days: 4.0,
              t4_execution_days: 5.0,
              total_cycle_days: 14.0,
              sla_status: 'ON_TRACK',
            },
            {
              id: 'app-02',
              application_number: 'APP-2026-002',
              customer_name: 'Pasang Baru CV Lancar',
              unit_code: 'ULP-MJO',
              current_stage: 'Survei Lapangan',
              age_days: 28,
              t1_survey_days: null,
              t2_drawing_days: null,
              t3_wo_days: null,
              t4_execution_days: null,
              total_cycle_days: null,
              sla_status: 'OVERDUE',
            },
          ],
        },
      })

      reportsApi.downloadSlaXlsx.mockResolvedValue({
        blob: new Blob(['sla-xlsx']),
        filename: 'LAPORAN-SLA.xlsx',
      })

      renderWithProviders(<ReportsPage />, {
        can: { 'reports.view': true },
      })

      // Switch to SLA Tab
      const slaTab = screen.getByRole('button', { name: /Siklus Waktu & SLA/i })
      fireEvent.click(slaTab)

      await waitFor(() => {
        expect(reportsApi.sla).toHaveBeenCalled()
        expect(screen.getByText('APP-2026-001')).toBeInTheDocument()
        expect(screen.getByText('Pasang Baru PT Maju')).toBeInTheDocument()
        expect(screen.getByText('14.5')).toBeInTheDocument()
      })

      // Test XLSX download
      const downloadBtn = screen.getByRole('button', { name: /Unduh XLSX/i })
      await userEvent.click(downloadBtn)

      await waitFor(() => {
        expect(reportsApi.downloadSlaXlsx).toHaveBeenCalled()
        expect(triggerFileDownload).toHaveBeenCalled()
      })
    })

    it('memuat tab Variansi Biaya (RAB vs SPK vs BASTP) dan mengunduh XLSX', async () => {
      reportsApi.costVariance.mockResolvedValue({
        data: [
          {
            application_number: 'APP-COST-001',
            customer_name: 'Peluasan Jaringan Gardu 4',
            unit_code: 'ULP-MJO',
            rab_total: 50000000,
            wo_number: 'SPK-2026-01',
            wo_status: 'ISSUED',
            vendor_name: 'PT Mitra Listrik',
            bastp_number: 'BASTP-2026-01',
          },
        ],
      })

      reportsApi.downloadCostVarianceXlsx.mockResolvedValue({
        blob: new Blob(['cost-variance-xlsx']),
        filename: 'REALISASI-BIAYA-RAB-SPK.xlsx',
      })

      renderWithProviders(<ReportsPage />, {
        can: { 'reports.view': true },
      })

      // Switch to Cost Variance Tab
      const costTab = screen.getByRole('button', { name: /Realisasi Biaya/i })
      await userEvent.click(costTab)

      await waitFor(() => {
        expect(reportsApi.costVariance).toHaveBeenCalled()
        expect(screen.getByText('APP-COST-001')).toBeInTheDocument()
        expect(screen.getByText('Peluasan Jaringan Gardu 4')).toBeInTheDocument()
        expect(screen.getByText('PT Mitra Listrik')).toBeInTheDocument()
        expect(screen.getByText('SPK-2026-01')).toBeInTheDocument()
      })

      // Download XLSX
      const downloadBtn = screen.getByRole('button', { name: /Unduh XLSX/i })
      await userEvent.click(downloadBtn)

      await waitFor(() => {
        expect(reportsApi.downloadCostVarianceXlsx).toHaveBeenCalled()
        expect(triggerFileDownload).toHaveBeenCalled()
      })
    })

    it('memuat tab Rapor Kinerja Vendor dan mengunduh XLSX', async () => {
      reportsApi.settings.mockResolvedValue({
        data: {
          stock: { usage_months: 3, warning_factor: 1.5 },
          vendor: { weight_completion: 40, weight_timeliness: 20, weight_quality: 25, weight_discipline: 15, stale_days: 7, good_min: 80, fair_min: 60 },
          defaults: {
            stock: { usage_months: 3, warning_factor: 1.5 },
            vendor: { weight_completion: 40, weight_timeliness: 20, weight_quality: 25, weight_discipline: 15, stale_days: 7, good_min: 80, fair_min: 60 },
          },
          can_edit: true,
        },
      })
      reportsApi.saveSettings.mockResolvedValue({ data: { stock: { usage_months: 3, warning_factor: 1.5 }, vendor: { weight_completion: 30, weight_timeliness: 30, weight_quality: 25, weight_discipline: 15, stale_days: 7, good_min: 80, fair_min: 60 } } })
      reportsApi.vendorPerformance.mockResolvedValue({
        data: [
          {
            vendor_id: 'v-01',
            vendor_code: 'VEND-01',
            vendor_name: 'PT Mandiri Elektrik',
            total_wo: 15,
            completed_wo: 12,
            in_progress_wo: 3,
            cancelled_wo: 0,
            bastp_revision_count: 2,
            completion_rate: 80.0,
            on_time_rate: 50, late_wo: 1, overdue_wo: 1, score: 72, rating: 'CUKUP',
          },
        ],
      })

      reportsApi.downloadVendorPerformanceXlsx.mockResolvedValue({
        blob: new Blob(['vendor-perf-xlsx']),
        filename: 'RAPOR-KINERJA-VENDOR.xlsx',
      })

      renderWithProviders(<ReportsPage />, {
        can: { 'reports.view': true },
      })

      // Switch to Vendor Performance Tab
      const vendorTab = screen.getByRole('button', { name: /Rapor Kinerja/i })
      await userEvent.click(vendorTab)

      await waitFor(() => {
        expect(reportsApi.vendorPerformance).toHaveBeenCalled()
        expect(screen.getByText('PT Mandiri Elektrik')).toBeInTheDocument()
        expect(screen.getByText('VEND-01')).toBeInTheDocument()
        expect(screen.getByText('80%')).toBeInTheDocument()
        expect(screen.getByText('50%')).toBeInTheDocument()
        expect(screen.getByText(/72 · Cukup/)).toBeInTheDocument()
      })

      // Administrator mengatur bobot skor: jumlah harus 100
      await userEvent.click(await screen.findByRole('button', { name: 'Pengaturan' }))
      const timeliness = await screen.findByLabelText(/Ketepatan waktu/)
      fireEvent.change(timeliness, { target: { value: '30' } })
      expect(screen.getByText(/Jumlah bobot: 110%/)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Simpan' })).toBeDisabled()
      fireEvent.change(screen.getByLabelText(/Tingkat selesai/), { target: { value: '30' } })
      await userEvent.click(screen.getByRole('button', { name: 'Simpan' }))
      await waitFor(() => expect(reportsApi.saveSettings).toHaveBeenCalledWith(expect.objectContaining({ vendor: expect.objectContaining({ weight_completion: 30, weight_timeliness: 30 }) })))

      // Download XLSX
      const downloadBtn = screen.getByRole('button', { name: /Unduh XLSX/i })
      await userEvent.click(downloadBtn)

      await waitFor(() => {
        expect(reportsApi.downloadVendorPerformanceXlsx).toHaveBeenCalled()
        expect(triggerFileDownload).toHaveBeenCalled()
      })
    })

    it('memuat tab Stok Kritis & Buffer Material dan mengunduh XLSX', async () => {
      reportsApi.criticalStock.mockResolvedValue({
        data: {
          summary: {
            total_items: 2,
            critical_items: 1,
            warning_items: 0,
            safe_items: 1,
          },
          rows: [
            {
              khs_id: 'khs-01',
              khs_code: 'TM-9-200',
              khs_name: 'Tiang Beton 9m 200daN',
              unit: 'BATANG',
              on_hand: 5,
              reserved: 5,
              available: 0,
              monthly_usage: 6, min_stock: 6, incoming: 0, projected: 0, shortage: 6,
              stock_status: 'CRITICAL',
            },
            {
              khs_id: 'khs-02',
              khs_code: 'A3C-70',
              khs_name: 'Kabel Konduktor A3C 70mm',
              unit: 'METER',
              on_hand: 500,
              reserved: 100,
              available: 400,
              monthly_usage: 10, min_stock: 10, incoming: 0, projected: 400, shortage: 0,
              stock_status: 'SAFE',
            },
          ],
        },
      })

      reportsApi.downloadCriticalStockXlsx.mockResolvedValue({
        blob: new Blob(['crit-stock-xlsx']),
        filename: 'LAPORAN-STOK-KRITIS.xlsx',
      })

      renderWithProviders(<ReportsPage />, {
        can: { 'reports.view': true },
      })

      // Switch to Critical Stock Tab
      const critTab = screen.getByRole('button', { name: /Stok Kritis/i })
      fireEvent.click(critTab)

      await waitFor(() => {
        expect(reportsApi.criticalStock).toHaveBeenCalled()
        expect(screen.getByText('TM-9-200')).toBeInTheDocument()
        expect(screen.getByText('Tiang Beton 9m 200daN')).toBeInTheDocument()
        expect(screen.getByText('A3C-70')).toBeInTheDocument()
        expect(screen.getByText('KRITIS')).toBeInTheDocument()
      })

      // Download XLSX
      const downloadBtn = screen.getByRole('button', { name: /Unduh XLSX/i })
      await userEvent.click(downloadBtn)

      await waitFor(() => {
        expect(reportsApi.downloadCriticalStockXlsx).toHaveBeenCalled()
        expect(triggerFileDownload).toHaveBeenCalled()
      })
    })

    it('memuat tab Analisis Kelayakan KKF dan mengunduh XLSX', async () => {
      reportsApi.kkfFeasibility.mockResolvedValue({
        data: {
          summary: {
            total_applications_with_kkf: 2,
            feasible_count: 1,
            not_feasible_count: 1,
            extended_required_count: 1,
            total_capex_rab: 120000000,
            total_npv: 45000000,
            average_payback_months: 48.5,
            average_irr_percent: 14.2,
          },
          rows: [
            {
              id: 'kkf-app-1',
              application_number: 'APP-KKF-001',
              customer_name: 'PT Pabrik Gula',
              unit_code: 'ULP-MJO',
              tariff_power: 'I3 · 197.000 VA',
              capex_rab: 70000000,
              feasible: true,
              extended_required: false,
              payback_months: 36,
              payback_years: 3.0,
              npv: 30000000,
              irr_percent: 18.5,
              status_label: 'LAYAK',
            },
            {
              id: 'kkf-app-2',
              application_number: 'APP-KKF-002',
              customer_name: 'Perumahan Griya Indah',
              unit_code: 'ULP-MJO',
              tariff_power: 'R1 · 2.200 VA',
              capex_rab: 50000000,
              feasible: false,
              extended_required: true,
              payback_months: 72,
              payback_years: 6.0,
              npv: -5000000,
              irr_percent: 6.2,
              status_label: 'TIDAK LAYAK',
            },
          ],
        },
      })

      reportsApi.downloadKkfFeasibilityXlsx.mockResolvedValue({
        blob: new Blob(['kkf-feasibility-xlsx']),
        filename: 'ANALISIS-KELAYAKAN-KKF.xlsx',
      })

      renderWithProviders(<ReportsPage />, {
        can: { 'reports.view': true },
      })

      // Switch to KKF Feasibility Tab
      const kkfTab = screen.getByRole('button', { name: /Analisis Kelayakan KKF/i })
      fireEvent.click(kkfTab)

      await waitFor(() => {
        expect(reportsApi.kkfFeasibility).toHaveBeenCalled()
        expect(screen.getByText('APP-KKF-001')).toBeInTheDocument()
        expect(screen.getByText('PT Pabrik Gula')).toBeInTheDocument()
        expect(screen.getByText('LAYAK')).toBeInTheDocument()
        expect(screen.getByText('TIDAK LAYAK')).toBeInTheDocument()
        expect(screen.getByText(/Diperluas \(> 60 Bln\)/i)).toBeInTheDocument()
      })

      // Download XLSX
      const downloadBtn = screen.getByRole('button', { name: /Unduh XLSX/i })
      await userEvent.click(downloadBtn)

      await waitFor(() => {
        expect(reportsApi.downloadKkfFeasibilityXlsx).toHaveBeenCalled()
        expect(triggerFileDownload).toHaveBeenCalled()
      })
    })

    it('memuat tab Anomali & Rekonsiliasi ERP MIMS dan mengunduh XLSX', async () => {
      reportsApi.erpAnomalies.mockResolvedValue({
        data: {
          summary: {
            unmapped_skus_count: 1,
            unmapped_skus_total_qty: 25,
            recent_sync_failures_count: 1,
          },
          unmapped_materials: [
            {
              material_no: '000000000003110025',
              material_name: 'POLE CONCRETE 9M 200DAN',
              unit: 'PC',
              stock_ready: 25,
              warehouse_code: 'GDG-UP3',
              warehouse_name: 'Gudang Area Mojokerto',
              as_of: '2026-11-09',
            },
          ],
          sync_failures: [
            {
              warehouse_code: 'GDG-RY-JBG',
              warehouse_name: 'Gudang Rayon Jombang',
              status: 'FAILED',
              message: 'Token sesi MIMS kedaluwarsa (HTTP 401)',
              started_at: '2026-11-09 10:15:00',
            },
          ],
        },
      })

      reportsApi.downloadErpAnomaliesXlsx.mockResolvedValue({
        blob: new Blob(['erp-anomalies-xlsx']),
        filename: 'ANOMALI-SINKRONISASI-ERP.xlsx',
      })

      renderWithProviders(<ReportsPage />, {
        can: { 'reports.view': true },
      })

      // Switch to ERP Anomalies Tab
      const erpTab = screen.getByRole('button', { name: /Anomali & Rekonsiliasi ERP/i })
      fireEvent.click(erpTab)

      await waitFor(() => {
        expect(reportsApi.erpAnomalies).toHaveBeenCalled()
        expect(screen.getByText('000000000003110025')).toBeInTheDocument()
        expect(screen.getByText('POLE CONCRETE 9M 200DAN')).toBeInTheDocument()
        expect(screen.getByText('GDG-UP3')).toBeInTheDocument()
      })

      // Switch to Failures subtab
      const failuresSubtab = screen.getByRole('button', { name: /Log Kegagalan Sinkronisasi/i })
      fireEvent.click(failuresSubtab)

      await waitFor(() => {
        expect(screen.getByText('GDG-RY-JBG')).toBeInTheDocument()
        expect(screen.getByText('Gudang Rayon Jombang')).toBeInTheDocument()
        expect(screen.getByText(/Token sesi MIMS kedaluwarsa/i)).toBeInTheDocument()
      })

      // Download XLSX
      const downloadBtn = screen.getByRole('button', { name: /Unduh XLSX/i })
      await userEvent.click(downloadBtn)

      await waitFor(() => {
        expect(reportsApi.downloadErpAnomaliesXlsx).toHaveBeenCalled()
        expect(triggerFileDownload).toHaveBeenCalled()
      })
    })

    it('menampilkan tab Laporan RKM di halaman detail versi RKM dengan unduhan XLSX', async () => {
      rkmApi.version.mockResolvedValue({
        data: {
          id: 'v-10',
          version_number: 1,
          round: 1,
          status: 'APPROVED',
          plan_id: 'plan-1',
          plan_number: 'RKM/2026/01',
          proposals: [],
          decisions: [],
          adjustments: [],
        },
      })

      reportsApi.rkm.mockResolvedValue({
        data: {
          title: 'RKM PER ULP',
          header: { name: 'PT PLN (PERSERO)', sub: 'UID JAWA TIMUR' },
          meta: [['Rencana', 'RKM/2026/01'], ['Versi', '1 (APPROVED)']],
          sections: [
            {
              heading: 'Usulan per ULP',
              columns: ['ULP', 'KODE KHS', 'PEKERJAAN', 'PIPELINE', 'FORECAST', 'USULAN', 'SETELAH VALIDASI'],
              rows: [
                ['ULP-MJO', '101', 50, 10, 5, 65, 65],
              ],
            },
          ],
        },
      })

      reportsApi.downloadRkmXlsx.mockResolvedValue({
        blob: new Blob(['rkm-xlsx']),
        filename: 'RKM-per-ulp.xlsx',
      })

      renderWithProviders(<RkmVersionDetailPage />, {
        can: { 'rkm.view': true },
        route: '/rkm/versions/v-10',
        path: '/rkm/versions/:id',
      })

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Laporan RKM/i })).toBeInTheDocument()
      })

      // Click tab Laporan RKM
      await userEvent.click(screen.getByRole('button', { name: /Laporan RKM/i }))

      await waitFor(() => {
        expect(screen.getByText('RKM PER ULP')).toBeInTheDocument()
        expect(screen.getAllByText('Usulan per ULP').length).toBeGreaterThan(0)
        expect(screen.getByText('ULP-MJO')).toBeInTheDocument()
      })

      // Download XLSX
      const downloadBtn = screen.getByRole('button', { name: /Unduh XLSX/i })
      await userEvent.click(downloadBtn)

      await waitFor(() => {
        expect(reportsApi.downloadRkmXlsx).toHaveBeenCalledWith('v-10', 'per-ulp')
        expect(triggerFileDownload).toHaveBeenCalled()
      })
    })

    it('hierarkis peran GLOBAL: admin dapat memilih UP3 lalu memfilter opsi ULP yang bersesuaian', async () => {
      reportsApi.units.mockResolvedValue({
        data: {
          scope: 'GLOBAL',
          up3_units: [
            { id: 'u-up3-1', code: 'UP3-MJK', name: 'UP3 Mojokerto' },
            { id: 'u-up3-2', code: 'UP3-SBY', name: 'UP3 Surabaya' },
          ],
          ulp_units: [
            { id: 'u-ulp-1', code: 'ULP-MJO', name: 'ULP Mojokerto Kota', parent_id: 'u-up3-1' },
            { id: 'u-ulp-2', code: 'ULP-NGN', name: 'ULP Ngoro', parent_id: 'u-up3-1' },
            { id: 'u-ulp-3', code: 'ULP-SBY', name: 'ULP Surabaya Selatan', parent_id: 'u-up3-2' },
          ],
          default_up3_id: '',
          default_unit_id: '',
        },
      })

      renderWithProviders(<ReportsPage />, {
        can: { 'reports.view': true },
      })

      const up3Select = await screen.findByRole('combobox', { name: /Filter Unit UP3/i })
      const ulpSelect = screen.getByRole('combobox', { name: /Filter Unit ULP/i })

      expect(up3Select).toBeEnabled()
      expect(ulpSelect).toBeEnabled()

      // Initial state: "Semua UP3 (Seluruh Unit)" and "Semua ULP (Seluruh Wilayah)"
      expect(screen.getByText('Semua UP3 (Seluruh Unit)')).toBeInTheDocument()
      expect(screen.getByText('Semua ULP (Seluruh Wilayah)')).toBeInTheDocument()

      // Select UP3-MJK
      await userEvent.selectOptions(up3Select, 'u-up3-1')

      // Now ULP options should only contain ULP-MJO and ULP-NGN, but NOT ULP-SBY
      expect(screen.getByText(/Semua ULP di UP3 Mojokerto/i)).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /ULP Mojokerto Kota/i })).toBeInTheDocument()
      expect(screen.getByRole('option', { name: /ULP Ngoro/i })).toBeInTheDocument()
      expect(screen.queryByRole('option', { name: /ULP Surabaya Selatan/i })).not.toBeInTheDocument()

      // Select ULP-MJO
      await userEvent.selectOptions(ulpSelect, 'u-ulp-1')

      // Click "Terapkan Filter"
      const applyBtn = screen.getByRole('button', { name: /Terapkan Filter/i })
      await userEvent.click(applyBtn)

      await waitFor(() => {
        expect(reportsApi.overview).toHaveBeenCalledWith(
          expect.objectContaining({
            up3_id: 'u-up3-1',
            unit_id: 'u-ulp-1',
          })
        )
      })

      // Reset Filter
      const resetBtn = screen.getByRole('button', { name: /Reset Filter/i })
      await userEvent.click(resetBtn)

      expect(up3Select.value).toBe('')
      expect(ulpSelect.value).toBe('')
    })

    it('hierarkis peran UP3: UP3 terkunci dan ULP terbatas pada unit di bawahnya', async () => {
      reportsApi.units.mockResolvedValue({
        data: {
          scope: 'UP3',
          up3_units: [
            { id: 'u-up3-1', code: 'UP3-MJK', name: 'UP3 Mojokerto' },
          ],
          ulp_units: [
            { id: 'u-ulp-1', code: 'ULP-MJO', name: 'ULP Mojokerto Kota', parent_id: 'u-up3-1' },
            { id: 'u-ulp-2', code: 'ULP-NGN', name: 'ULP Ngoro', parent_id: 'u-up3-1' },
          ],
          default_up3_id: 'u-up3-1',
          default_unit_id: '',
        },
      })

      renderWithProviders(<ReportsPage />, {
        can: { 'reports.view': true },
      })

      const up3Select = await screen.findByRole('combobox', { name: /Filter Unit UP3/i })
      const ulpSelect = screen.getByRole('combobox', { name: /Filter Unit ULP/i })

      expect(up3Select).toBeDisabled()
      expect(ulpSelect).toBeEnabled()
      expect(screen.getByText(/UP3-MJK - UP3 Mojokerto \(UP3 Terkait\)/i)).toBeInTheDocument()
      expect(screen.getByText(/Semua ULP di UP3 Mojokerto/i)).toBeInTheDocument()

      await userEvent.selectOptions(ulpSelect, 'u-ulp-2')
      const applyBtn = screen.getByRole('button', { name: /Terapkan Filter/i })
      await userEvent.click(applyBtn)

      await waitFor(() => {
        expect(reportsApi.overview).toHaveBeenCalledWith(
          expect.objectContaining({
            up3_id: 'u-up3-1',
            unit_id: 'u-ulp-2',
          })
        )
      })
    })

    it('hierarkis peran ULP: UP3 dan ULP terkunci pada unit kerja yang ditugaskan', async () => {
      reportsApi.units.mockResolvedValue({
        data: {
          scope: 'ULP',
          up3_units: [
            { id: 'u-up3-1', code: 'UP3-MJK', name: 'UP3 Mojokerto' },
          ],
          ulp_units: [
            { id: 'u-ulp-1', code: 'ULP-MJO', name: 'ULP Mojokerto Kota', parent_id: 'u-up3-1' },
          ],
          default_up3_id: 'u-up3-1',
          default_unit_id: 'u-ulp-1',
        },
      })

      renderWithProviders(<ReportsPage />, {
        can: { 'reports.view': true },
      })

      const up3Select = await screen.findByRole('combobox', { name: /Filter Unit UP3/i })
      const ulpSelect = screen.getByRole('combobox', { name: /Filter Unit ULP/i })

      expect(up3Select).toBeDisabled()
      expect(ulpSelect).toBeDisabled()
      expect(screen.getByText(/UP3-MJK - UP3 Mojokerto \(UP3 Induk\)/i)).toBeInTheDocument()
      expect(screen.getByText(/ULP-MJO - ULP Mojokerto Kota \(Terkunci\)/i)).toBeInTheDocument()

      await waitFor(() => {
        expect(reportsApi.overview).toHaveBeenCalledWith(
          expect.objectContaining({
            up3_id: 'u-up3-1',
            unit_id: 'u-ulp-1',
          })
        )
      })
    })
  })
})
