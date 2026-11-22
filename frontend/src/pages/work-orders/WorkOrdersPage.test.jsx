import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import { MemoryRouter, Routes, Route } from 'react-router-dom'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import WorkOrdersPage from './WorkOrdersPage.jsx'
import WorkOrderAgendaPage from './WorkOrderAgendaPage.jsx'
import { workOrdersApi, applicationApi, unitScopeApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  workOrdersApi: { byAgenda: vi.fn(), create: vi.fn(), get: vi.fn() },
  applicationApi: { get: vi.fn() },
  bastpApi: { listForWorkOrder: vi.fn(), create: vi.fn() },
  unitScopeApi: { get: vi.fn() },
}))
vi.mock('./PoleWorkOrderDetailPage.jsx', () => ({ default: ({ woId, embedded }) => <div>{`detail wo tiang ${woId}${embedded ? ' (tab)' : ''}`}</div> }))
vi.mock('./MaterialRequestsPanel.jsx', () => ({
  default: ({ applicationId }) => <div data-testid="mr-panel">outbox {applicationId}</div>,
}))
vi.mock('../applications/ApplicationWorkOrdersPanel.jsx', () => ({
  default: ({ application, canCreate }) => <div data-testid="wo-panel">panel {application.application_number} create={String(canCreate)}</div>,
}))

const netRow = {
  application_id: 'a1', application_number: 'PB-001', agenda_number: '5145320260001', customer_name: 'Budi', unit_name: 'ULP Jombang', application_type: 'PB', application_status: 'APPROVED',
  network: { id: 'w1', wo_number: 'WO/PB-001/v1', version_number: 1, status: 'IN_PROGRESS', vendor_name: 'PT Jaringan', progress_percent: 40, pending_progress: 1, target_date: '2020-01-15' },
  network_creatable: false,
  poles: [{ id: 'p1', letter_number: 'AMS/TIANG/001', status: 'ISSUED', revision_number: 2, vendor_name: 'PT Tiang', quantity: 6, progress_percent: 25 }],
  poles_creatable_quantity: 0,
  material_request: { id: 'mr1', status: 'SENT', external_reference: 'ND-1', needs_followup: true, fulfilment: 'PARTIAL', ready_to_send: true, oversent: false, count: 1 },
}
const newRow = {
  application_id: 'a2', application_number: 'PB-002', agenda_number: null, customer_name: 'Sari', unit_name: 'ULP Mojokerto', application_type: 'PB', application_status: 'APPROVED',
  network: null, network_creatable: true, poles: [], poles_creatable_quantity: 4, material_request: null,
}

function mount(can, path = '/work-orders') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <AccessContext.Provider value={{ loading: false, can, canWrite: can, isSysAdmin: false, createUnits: [] }}>
        <NotificationProvider>
          <Routes>
            <Route path="/work-orders" element={<WorkOrdersPage />} />
            <Route path="/work-orders/:applicationId" element={<WorkOrderAgendaPage />} />
            <Route path="/wo-tiang/p1" element={<div>detail wo tiang</div>} />
            <Route path="/wo-tiang/new" element={<div>form wo tiang</div>} />
          </Routes>
        </NotificationProvider>
      </AccessContext.Provider>
    </MemoryRouter>,
  )
}

describe('SPK / WO per No. Agenda', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    applicationApi.get.mockResolvedValue({ data: { id: 'a1', application_number: 'PB-001' } })
    workOrdersApi.byAgenda.mockImplementation((params) => Promise.resolve({ data: params?.application_id ? [netRow, newRow].filter((r) => r.application_id === params.application_id) : [netRow, newRow] }))
    workOrdersApi.get.mockResolvedValue({ data: { id: 'w1', tasks: [{ id: 't1', title: 'Pemasangan Tiang Beton', unit: 'Btg', volume: 4, verified_percent: 40 }], materials: Array.from({ length: 8 }, (_, i) => ({ khs_code: `K${i}`, khs_name: `Material ${i}`, unit: 'bh', quantity: i + 1 })) } })
  })

  it('filter UP3 dan ULP mengirim up3_id dan unit_id ke daftar SPK', async () => {
    unitScopeApi.get.mockResolvedValue({
      scope: 'GLOBAL',
      up3_units: [{ id: 'up3-1', code: 'UP3-A', name: 'UP3 Satu' }, { id: 'up3-2', code: 'UP3-B', name: 'UP3 Dua' }],
      ulp_units: [{ id: 'ulp-1', code: 'ULP-A', name: 'ULP Satu', parent_id: 'up3-1' }, { id: 'ulp-2', code: 'ULP-B', name: 'ULP Dua', parent_id: 'up3-2' }],
    })
    mount({ 'wo.view': true, 'pole_wo.view': true })
    await screen.findByText('5145320260001')

    fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Filter Unit UP3' }))
    fireEvent.click(screen.getByRole('combobox', { name: 'Filter Unit UP3' }))
    fireEvent.click(await screen.findByRole('option', { name: /UP3 Satu/ }))
    await waitFor(() => expect(workOrdersApi.byAgenda).toHaveBeenLastCalledWith(expect.objectContaining({ up3_id: 'up3-1' })))

    fireEvent.click(screen.getByRole('combobox', { name: 'Filter Unit ULP' }))
    expect(screen.queryByRole('option', { name: /ULP Dua/ })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('option', { name: /ULP Satu/ }))
    await waitFor(() => expect(workOrdersApi.byAgenda).toHaveBeenLastCalledWith(expect.objectContaining({ up3_id: 'up3-1', unit_id: 'ulp-1' })))
  })

  it('satu baris per agenda memuat WO jaringan dan WO tiang beserta status, vendor, progres, dan revisi', async () => {
    mount({ 'wo.view': true, 'pole_wo.view': true })
    const row = (await screen.findByText('5145320260001')).closest('tr')
    expect(within(row).getByText('WO/PB-001/v1')).toBeInTheDocument()
    expect(within(row).getByText('PT Jaringan')).toBeInTheDocument()
    expect(within(row).getByText(/Target .*2020 · lewat target/)).toBeInTheDocument()                // target selesai, ditandai bila sudah lewat dan SPK masih berjalan
    const progress = within(within(row).getByLabelText('Progres pekerjaan'))            // kolom Progres Pekerjaan tersendiri: jaringan dan tiang
    expect(progress.getByText('40%')).toBeInTheDocument()
    expect(progress.getByText('25%')).toBeInTheDocument()
    expect(within(row).getByText('AMS/TIANG/001')).toBeInTheDocument()
    expect(within(row).getByText('revisi 2')).toBeInTheDocument()
    expect(within(row).getByText(/PT Tiang · 6 tiang/)).toBeInTheDocument()
    expect(screen.getByText('Belum ada No. Agenda')).toBeInTheDocument()
  })

  it('tombol buat hanya muncul untuk role yang berwenang', async () => {
    const view = mount({ 'wo.view': true, 'pole_wo.view': true })
    await screen.findByText('5145320260001')
    expect(screen.queryByRole('button', { name: /Buat WO Jaringan/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Buat WO Tiang/i })).not.toBeInTheDocument()
    view.unmount()

    mount({ 'wo.view': true, 'wo.create': true })
    expect(await screen.findByRole('button', { name: /Buat WO Jaringan PB-002/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Buat WO Tiang/i })).not.toBeInTheDocument()
  })

  it('Perencanaan membuka formulir WO Tiang dari baris agenda', async () => {
    mount({ 'pole_wo.view': true, 'pole_wo.manage': true })
    fireEvent.click(await screen.findByRole('button', { name: /Buat WO Tiang PB-002/i }))
    expect(await screen.findByText('form wo tiang')).toBeInTheDocument()
  })

  it('Konstruksi membuat WO jaringan dari baris, lalu berpindah ke halaman agenda untuk memilih vendor', async () => {
    workOrdersApi.create.mockResolvedValue({ data: { id: 'w2' } })
    applicationApi.get.mockResolvedValue({ data: { id: 'a2', application_number: 'PB-002' } })
    mount({ 'wo.view': true, 'wo.create': true })
    fireEvent.click(await screen.findByRole('button', { name: /Buat WO Jaringan PB-002/i }))
    await waitFor(() => expect(workOrdersApi.create).toHaveBeenCalledWith('a2'))
    expect(await screen.findByTestId('wo-panel')).toHaveTextContent('panel PB-002 create=true')
    expect(screen.getByRole('heading', { name: /Permohonan PB-002/ })).toBeInTheDocument()
  })

  it('drawer hanya pratinjau: nama material (bukan kode), tanpa tombol kerja; halaman dibuka dari kolom Aksi', async () => {
    mount({ 'wo.view': true, 'wo.create': true, 'pole_wo.view': true })
    fireEvent.click(await screen.findByRole('button', { name: /Detail PB-001/i }))
    expect(await screen.findByText('Material 0')).toBeInTheDocument()
    expect(screen.queryByText('K0')).not.toBeInTheDocument()
    expect(screen.getByText('dan 2 material lain di halaman SPK / WO.')).toBeInTheDocument()
    expect(screen.getByText('Pemasangan Tiang Beton')).toBeInTheDocument()
    expect(screen.queryByTestId('wo-panel')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^(Ajukan|Terbitkan|Simpan Pilihan Vendor)/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Buka halaman SPK \/ WO/i })).not.toBeInTheDocument()   // tombol buka ada di kolom Aksi, bukan di drawer
    fireEvent.click(screen.getByRole('button', { name: /Buka halaman PB-001/i }))
    expect(await screen.findByTestId('wo-panel')).toHaveTextContent('panel PB-001')
  })

  it('halaman agenda: tab WO Tiang langsung menampilkan detail WO Tiang', async () => {
    applicationApi.get.mockResolvedValue({ data: { id: 'a1', application_number: 'PB-001' } })
    mount({ 'wo.view': true, 'pole_wo.view': true })
    fireEvent.click(await screen.findByRole('button', { name: /Buka halaman PB-001/i }))
    fireEvent.click(await screen.findByRole('tab', { name: /WO Tiang/i }))
    expect(await screen.findByText('detail wo tiang p1 (tab)')).toBeInTheDocument()             // detail WO tiang langsung tampil di tab, tanpa tombol buka halaman
    expect(screen.queryByRole('button', { name: /Buka WO Tiang/i })).not.toBeInTheDocument()
  })

  it('filter "Perlu dibuat" menyaring agenda yang masih bisa dibuatkan WO, dan tidak ada untuk vendor', async () => {
    const view = mount({ 'wo.view': true, 'wo.create': true })
    await screen.findByText('5145320260001')
    fireEvent.click(screen.getByRole('tab', { name: /Perlu dibuat/i }))
    expect(screen.queryByText('5145320260001')).not.toBeInTheDocument()
    expect(screen.getByText('PB-002')).toBeInTheDocument()
    view.unmount()

    mount({ 'vendor.portal': true })
    await screen.findByText('5145320260001')
    expect(screen.queryByRole('tab', { name: /Perlu dibuat/i })).not.toBeInTheDocument()
  })

  it('pencarian mencakup nomor surat tiang dan vendor', async () => {
    mount({ 'wo.view': true })
    await screen.findByText('5145320260001')
    fireEvent.change(screen.getByLabelText('Cari'), { target: { value: 'ams/tiang' } })
    expect(screen.getByText('5145320260001')).toBeInTheDocument()
    expect(screen.queryByText('PB-002')).not.toBeInTheDocument()
  })

  it('vendor tidak melihat nama vendor dan tombol buat; pratinjau tidak menampilkan vendor', async () => {
    mount({ 'vendor.portal': true })
    const row = (await screen.findByText('5145320260001')).closest('tr')
    expect(within(row).queryByText('PT Jaringan')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Buat WO/i })).not.toBeInTheDocument()
    fireEvent.click(within(row).getByRole('button', { name: /Detail PB-001/i }))
    expect(await screen.findByText(/Pemasangan Tiang Beton/)).toBeInTheDocument()   // pratinjau terbuka
    expect(screen.getByRole('button', { name: /Buka halaman PB-001/i })).toBeInTheDocument()
    expect(screen.queryByText(/Vendor:/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('wo-panel')).not.toBeInTheDocument()
  })

  it('daftar menampilkan status Outbox dan tanda tindak lanjut; filter menyaring agenda yang perlu tindak lanjut', async () => {
    mount({ 'wo.view': true, 'material_requests.view': true })
    const row = (await screen.findByText('5145320260001')).closest('tr')
    expect(within(row).getByText('Outbox: Diserahkan sebagian')).toBeInTheDocument()      // kelengkapan penyerahan
    expect(within(row).getByText('Siap serah')).toBeInTheDocument()                     // ada material baru teralokasi
    expect(within(row).getByText('Perlu tindak lanjut')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Outbox perlu tindak lanjut/i }))
    expect(screen.getByText('5145320260001')).toBeInTheDocument()
    expect(screen.queryByText('PB-002')).not.toBeInTheDocument()
  })

  it('tautan dari dashboard (?filter=followup) langsung memakai filter tindak lanjut', async () => {
    mount({ 'wo.view': true, 'material_requests.view': true }, '/work-orders?filter=followup')
    expect(await screen.findByText('5145320260001')).toBeInTheDocument()
    expect(screen.queryByText('PB-002')).not.toBeInTheDocument()
    expect(screen.getByRole('tab', { name: /Outbox perlu tindak lanjut/i })).toHaveAttribute('aria-selected', 'true')
  })

  it('halaman agenda: tab Permintaan Material memuat Outbox agenda itu, dapat dibuka langsung lewat ?tab=material', async () => {
    mount({ 'wo.view': true, 'material_requests.view': true }, '/work-orders/a1?tab=material')
    expect(await screen.findByTestId('mr-panel')).toHaveTextContent('outbox a1')
    fireEvent.click(screen.getByRole('tab', { name: /WO Jaringan/i }))
    expect(await screen.findByTestId('wo-panel')).toBeInTheDocument()
    expect(screen.queryByTestId('mr-panel')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('tab', { name: /Permintaan Material/i }))
    expect(await screen.findByTestId('mr-panel')).toBeInTheDocument()
  })

  it('tab Permintaan Material tidak ada tanpa izin melihat Outbox maupun bagi vendor', async () => {
    const view = mount({ 'wo.view': true }, '/work-orders/a1?tab=material')
    expect(await screen.findByRole('tab', { name: /WO Jaringan/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Permintaan Material/i })).not.toBeInTheDocument()
    expect(screen.queryByTestId('mr-panel')).not.toBeInTheDocument()   // ?tab=material diabaikan: kembali ke tab bawaan
    view.unmount()

    mount({ 'vendor.portal': true, 'material_requests.view': true }, '/work-orders/a1')
    expect(await screen.findByRole('tab', { name: /WO Jaringan/i })).toBeInTheDocument()
    expect(screen.queryByRole('tab', { name: /Permintaan Material/i })).not.toBeInTheDocument()
  })
})
