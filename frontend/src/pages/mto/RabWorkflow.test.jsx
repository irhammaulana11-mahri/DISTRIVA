import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import MtoPackageDetailView from './MtoPackageDetailView.jsx'
import { rabRunsApi, mtoApi, masterDataApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  rabRunsApi: {
    listForPackage: vi.fn(),
    run: vi.fn(),
    get: vi.fn(),
    document: vi.fn(),
  },
  mtoApi: {
    get: vi.fn(),
    calculate: vi.fn(),
    extract: vi.fn(),
    verify: vi.fn(),
    decide: vi.fn(),
    updateItems: vi.fn(),
  },
  masterDataApi: {
    constructionTypes: vi.fn(),
  },
  documentApi: {
    downloadBlob: vi.fn(),
    remove: vi.fn(),
  },
}))

function renderWithProviders(ui, { can = {}, isSysAdmin = false, user = { id: 'u-1', email: 'planner@pln.co.id', name: 'Perencana Sistem' } } = {}) {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user, status: 'authenticated' }}>
        <AccessContext.Provider
          value={{
            can,
            isSysAdmin,
            roles: isSysAdmin ? ['SYS_ADMIN'] : ['PERENCANAAN'],
            loading: false,
          }}
        >
          <NotificationProvider>
            {ui}
          </NotificationProvider>
        </AccessContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>
  )
}

describe('RAB Workflow (docs/62 §21, docs/57, docs/74); SR 1 fasa kini kelompok BOM SR1PH (docs/62 §52)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  const mockApprovedMto = {
    id: 'mto-pkg-approved-1',
    package_number: 'MTO-202611-0088',
    status: 'APPROVED',
    valid_on: '2026-11-07',
    snapshot_hash: 'abc123hash',
    params: { 'COMMISSIONING:SUTM': 2.5 },
    declared_params: [],
    drawing_version: {
      id: 'dv-88',
      drawing_id: 'drw-88',
      version_number: 2,
      status: 'APPROVED',
    },
    application: {
      id: 'app-88',
      application_number: 'PB-2026-0088',
      customer_name: 'PT Industri Terpadu',
    },
    created_by_user: { id: 'u-1', name: 'Perencana Sistem', email: 'planner@pln.co.id' },
    verified_by_user: { id: 'u-2', name: 'Asman Jaringan', email: 'asman@pln.co.id' },
    approved_by_user: { id: 'u-3', name: 'Manager ULP', email: 'manager@pln.co.id' },
    items: [
      {
        construction_code: 'TM-1',
        construction_label: 'Tiang Awal TM',
        group: 'SUTM',
        psg: 2,
        bkr: 0,
        source: 'EXTRACTED',
      },
    ],
    can: {
      edit: false,
      verify: false,
      decide: false,
    },
  }

  const mockDryRunResult = {
    stored: false,
    valid_on: '2026-11-07',
    zone: 2,
    price_book_id: 'pb-uuid-1',
    price_book_name: 'Buku Harga Kontrak Jatim 2026',
    snapshot_hash: 'snap-hash-999',
    warnings: ['NO_INSURED_VALUE'],
    sub_totals: {
      material: 12500000,
      service: 3500000,
      commissioning: 500000,
      k3l: 250000,
      insurance: 0,
    },
    groups: {
      SUTM: {
        name: 'Saluran Udara Tegangan Menengah',
        material: 12500000,
        material_pln: 3000000,
        service: 3500000,
        commissioning: 500000,
        k3l: 250000,
        insurance: 0,
        subtotal: 16750000,
        ppn: 1842500,
        total: 18592500,
      },
      SR1PH: {
        name: 'SR-APP 1 Fasa (SDES-1 dan SDES-2)',
        material: 800000,
        service: 400000,
        commissioning: 0,
        k3l: 0,
        insurance: 0,
        subtotal: 1200000,
        ppn: 132000,
        total: 1332000,
      },
    },
    grand_total: 19924500,
  }

  const mockSavedRuns = [
    {
      id: 'rab-run-101',
      mto_package_id: 'mto-pkg-approved-1',
      run_number: 1,
      valid_on: '2026-11-07',
      zone: 2,
      price_book_id: 'pb-uuid-1',
      price_book_name: 'Buku Harga Kontrak Jatim 2026',
      grand_total: 19924500,
      snapshot_hash: 'snap-hash-999',
      created_by_name: 'Perencana Sistem',
      created_at: '2026-11-07 14:00:00',
    },
  ]

  const mockRunDetail = {
    id: 'rab-run-101',
    run_number: 1,
    valid_on: '2026-11-07',
    zone: 2,
    price_book_name: 'Buku Harga Kontrak Jatim 2026',
    grand_total: 19924500,
    snapshot_hash: 'snap-hash-999',
    groups: mockDryRunResult.groups,
    items: [
      {
        id: 'ri-1',
        category: 'MATERIAL',
        item_code: 'MAT-POLE-12M',
        item_name: 'Tiang Beton 12 Meter 350 daN',
        unit: 'BTG',
        quantity: 2,
        price: 4500000,
        total: 9000000,
        group_code: 'SUTM',
      },
      {
        id: 'ri-2',
        category: 'SERVICE',
        item_code: 'JAS-POLE-12M',
        item_name: 'Ereksi Tiang Beton 12 Meter',
        unit: 'TITIK',
        quantity: 2,
        price: 750000,
        total: 1500000,
        group_code: 'SUTM',
      },
    ],
  }

  describe('Panel RAB pada Paket MTO Disetujui', () => {
    it('tidak menampilkan riwayat run RAB di halaman MTO (RAB ada di tab KKF usulan)', async () => {
      mtoApi.get.mockResolvedValue({ data: mockApprovedMto })
      rabRunsApi.listForPackage.mockResolvedValue({ data: [] })
      renderWithProviders(<MtoPackageDetailView packageId="mto-pkg-approved-1" />, { can: { 'rab.run': true } })
      await waitFor(() => expect(mtoApi.get).toHaveBeenCalled())
      await screen.findByText(/MTO-PBPD|Penyusun/i)
      expect(screen.queryByText(/Kalkulasi & Riwayat Run RAB/i)).not.toBeInTheDocument()
      expect(rabRunsApi.listForPackage).not.toHaveBeenCalled()
    })

    it('menampilkan tombol Hitung RAB (dry run) dan Simpan run sesuai hak akses can[rab.run]', async () => {
      mtoApi.get.mockResolvedValue({ data: mockApprovedMto })
      rabRunsApi.listForPackage.mockResolvedValue({ data: [] })

      // User tanpa izin rab.run
      const { unmount } = renderWithProviders(
        <MtoPackageDetailView showRabRuns packageId="mto-pkg-approved-1" />,
        { can: { 'rab.run': false } }
      )

      await waitFor(() => {
        expect(screen.getByText(/Kalkulasi & Riwayat Run RAB/i)).toBeInTheDocument()
      })

      // Hitung RAB (Dry Run) selalu tampil untuk MTO APPROVED
      expect(screen.getByRole('button', { name: /Hitung RAB \(Dry Run\)/i })).toBeInTheDocument()
      // Simpan Run RAB tidak muncul karena tidak punya hak akses rab.run
      expect(screen.queryByRole('button', { name: /Simpan Run RAB/i })).not.toBeInTheDocument()

      unmount()

      // User dengan izin rab.run
      renderWithProviders(
        <MtoPackageDetailView showRabRuns packageId="mto-pkg-approved-1" />,
        { can: { 'rab.run': true } }
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Simpan Run RAB/i })).toBeInTheDocument()
      })
    })

    it('menjalankan dry run RAB dan menampilkan modal hasil perhitungan tanpa menambah riwayat', async () => {
      const user = userEvent.setup()
      mtoApi.get.mockResolvedValue({ data: mockApprovedMto })
      rabRunsApi.listForPackage.mockResolvedValue({ data: [] })
      rabRunsApi.run.mockResolvedValue({ data: mockDryRunResult })

      renderWithProviders(
        <MtoPackageDetailView showRabRuns packageId="mto-pkg-approved-1" />,
        { can: { 'rab.run': true } }
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Hitung RAB \(Dry Run\)/i })).toBeInTheDocument()
      })

      // Klik Hitung RAB (Dry Run)
      await user.click(screen.getByRole('button', { name: /Hitung RAB \(Dry Run\)/i }))

      expect(rabRunsApi.run).toHaveBeenCalledWith('mto-pkg-approved-1', {
        dry_run: true,
        date: undefined,
      })

      // Modal dry run terbuka dan menampilkan ringkasan
      await waitFor(() => {
        expect(screen.getByText(/Hasil Kalkulasi RAB/i)).toBeInTheDocument()
      })

      // Cek elemen breakdown dan format rupiah
      expect(screen.getByText(/Buku Harga Kontrak Jatim 2026/i)).toBeInTheDocument()
      expect(screen.getAllByText(/19\.924\.500/).length).toBeGreaterThan(0)
      expect(screen.getByText('Saluran Udara Tegangan Menengah')).toBeInTheDocument()
      expect(screen.getByText('SR-APP 1 Fasa (SDES-1 dan SDES-2)')).toBeInTheDocument()
      // Material PLN/MDU ikut dihitung dan ditandai sebagai bagian dari material (keputusan pemilik 9 Nov)
      expect(screen.getByTestId('rab-material-pln-SUTM')).toHaveTextContent(/termasuk material PLN\/MDU.*3\.000\.000/)
      expect(screen.queryByTestId('rab-material-pln-SR1PH')).not.toBeInTheDocument()
      // Peringatan NO_INSURED_VALUE tampil
      expect(screen.getByText(/tidak memiliki nilai asuransi di buku harga/i)).toBeInTheDocument()

      // Tutup modal
      await user.click(screen.getByRole('button', { name: /^Tutup$/i }))

      // Riwayat tetap kosong
      expect(screen.getByText(/Belum ada run RAB yang tersimpan/i)).toBeInTheDocument()
    })

    it('menampilkan galat 409 apa adanya jika buku harga atau zona tidak ditemukan', async () => {
      const user = userEvent.setup()
      mtoApi.get.mockResolvedValue({ data: mockApprovedMto })
      rabRunsApi.listForPackage.mockResolvedValue({ data: [] })

      const error409 = {
        response: {
          status: 409,
          data: {
            message: 'Buku harga aktif untuk zona UP3 Mojokerto tidak ditemukan pada tanggal acuan.',
          },
        },
      }
      rabRunsApi.run.mockRejectedValue(error409)

      renderWithProviders(
        <MtoPackageDetailView showRabRuns packageId="mto-pkg-approved-1" />,
        { can: { 'rab.run': true } }
      )

      await waitFor(() => {
        expect(screen.getByRole('button', { name: /Hitung RAB \(Dry Run\)/i })).toBeInTheDocument()
      })

      await user.click(screen.getByRole('button', { name: /Hitung RAB \(Dry Run\)/i }))

      await waitFor(() => {
        expect(
          screen.getByText('Buku harga aktif untuk zona UP3 Mojokerto tidak ditemukan pada tanggal acuan.')
        ).toBeInTheDocument()
      })
    })

    it('dapat membuka drawer detail run dari daftar riwayat tersimpan', async () => {
      const user = userEvent.setup()
      mtoApi.get.mockResolvedValue({ data: mockApprovedMto })
      rabRunsApi.listForPackage.mockResolvedValue({ data: mockSavedRuns })
      rabRunsApi.get.mockResolvedValue({ data: mockRunDetail })

      renderWithProviders(
        <MtoPackageDetailView showRabRuns packageId="mto-pkg-approved-1" />,
        { can: { 'rab.run': true, 'rab.view': true } }
      )

      await waitFor(() => {
        expect(screen.getByText('#1')).toBeInTheDocument()
      })

      expect(screen.getByText('Rp 19.924.500')).toBeInTheDocument()
      expect(screen.getByText('Zona 2')).toBeInTheDocument()

      // Klik tombol Detail pada baris run
      const detailBtn = screen.getByRole('button', { name: /Detail/i })
      await user.click(detailBtn)

      expect(rabRunsApi.get).toHaveBeenCalledWith('rab-run-101')

      await waitFor(() => {
        expect(screen.getByText(/Rincian.*Run #1/i)).toBeInTheDocument()
      })

      // Periksa item rincian KHS
      expect(screen.getByText(/Tiang Beton 12 Meter 350 daN/i)).toBeInTheDocument()
      expect(screen.getByText(/Ereksi Tiang Beton 12 Meter/i)).toBeInTheDocument()
      expect(screen.getByText('Rp 9.000.000')).toBeInTheDocument()
    })
  })
})
