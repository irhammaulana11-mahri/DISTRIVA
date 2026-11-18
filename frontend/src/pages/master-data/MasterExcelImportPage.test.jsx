import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import MasterExcelImportPage from './MasterExcelImportPage.jsx'
import { masterExcelApi, adminApi, triggerFileDownload } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  masterExcelApi: { list: vi.fn(), get: vi.fn(), upload: vi.fn(), recheck: vi.fn(), apply: vi.fn(), remove: vi.fn(), template: vi.fn() },
  adminApi: { units: vi.fn() },
  triggerFileDownload: vi.fn(),
}))

const CAN = { rab: true, tariff: true, bom: true, price: true, tariffs: true, kkf: true }
const ready = {
  id: 'i-1', kind: 'RAB_KKF', file_name: 'MASTER RAB & KKF.xlsx', size_bytes: 25000000, status: 'READY', created_at: '2026-11-15T10:00:00Z', uploaded_by_name: 'Perencana', applied: {},
  report: {
    bom: { groups: [
      { group: 'SUTM', status: 'CHANGED', excel_lines: 608, current_lines: 608, changed: 2, added: 0, removed: 0, samples: [{ sequence: 12, before: 'H=2', after: 'H=3' }], problems: [], new_codes: [] },
      { group: 'SUTR', status: 'UNCHANGED', excel_lines: 131, current_lines: 131, changed: 0, added: 0, removed: 0, samples: [], problems: [], new_codes: [] },
    ] },
    price: { status: 'CHANGED', excel_rows: 504, current_rows: 523, changed_rows: 3, unchanged_rows: 500, added_in_excel: 0, new_codes: { count: 1, items: ['999'] }, book: 'Kontrak jasa dan material',
      samples: [{ code: 'JTMR1', name: 'Kabel A', fields: [{ field: 'z1_pasang', before: 100, after: 110 }] }], problems: [], note: 'Status PLN dipertahankan.' },
    new_khs: { count: 2, items: [], note: 'Impor lewat halaman KHS.' },
  },
}

function renderPage() {
  return render(<NotificationProvider><MemoryRouter><MasterExcelImportPage /></MemoryRouter></NotificationProvider>)
}

describe('Impor Master dari Excel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    adminApi.units.mockResolvedValue({ data: [{ id: 'u1', code: '51453', name: 'ULP Jombang', unit_type: 'ULP' }] })
    masterExcelApi.list.mockResolvedValue({ data: [{ ...ready, report: null }], can: CAN, limits: { max_mb: 60 } })
    masterExcelApi.get.mockResolvedValue({ data: ready })
  })

  it('mengunggah Excel, menunggu pemeriksaan, lalu menampilkan perbandingan dan menerapkan hanya yang berubah sebagai DRAFT', async () => {
    masterExcelApi.upload.mockResolvedValue({ data: { ...ready, status: 'PROCESSING', report: null } })
    masterExcelApi.apply.mockResolvedValue({ data: { status: 'OK', message: 'Buku harga DRAFT dibuat.' }, import: { ...ready, applied: { PRICE: { status: 'OK', message: 'Buku harga DRAFT dibuat.', link: '/master-data/harga' } } } })
    renderPage()
    const card = (await screen.findByRole('region', { name: 'Excel RAB & KKF' }))
    const file = new File(['x'.repeat(2000)], 'MASTER RAB & KKF.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    fireEvent.change(within(card).getByLabelText('Berkas Excel RAB & KKF'), { target: { files: [file] } })
    await userEvent.click(within(card).getByRole('button', { name: /Unggah & periksa/i }))
    await waitFor(() => expect(masterExcelApi.upload).toHaveBeenCalledTimes(1))
    const fd = masterExcelApi.upload.mock.calls[0][0]
    expect([fd.get('kind'), fd.get('file').name]).toEqual(['RAB_KKF', 'MASTER RAB & KKF.xlsx'])
    expect(await screen.findByText(/Membaca Excel dan membandingkan/)).toBeInTheDocument()
  })

  it('menampilkan hasil perbandingan per dataset dan menerapkan perubahan harga sebagai DRAFT setelah konfirmasi', async () => {
    masterExcelApi.apply.mockResolvedValue({ data: { status: 'OK', message: 'Buku harga DRAFT dibuat.' }, import: { ...ready, applied: { PRICE: { status: 'OK', message: 'Buku harga DRAFT dibuat (523 baris, 3 berubah).', link: '/master-data/harga' } } } })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Buka' }))
    expect(await screen.findByText('BOM (rumus volume)')).toBeInTheDocument()
    expect(screen.getAllByText('Ada perubahan')).toHaveLength(2)                      // SUTM and the price book
    expect(screen.getByText(/1 kode di Excel belum punya kode baru/)).toBeInTheDocument()
    expect(screen.getByText(/2 KHS baru di Excel tidak diimpor/)).toBeInTheDocument()
    expect(screen.getByLabelText('Terapkan SUTR')).toBeDisabled()                       // unchanged group: nothing to apply
    expect(screen.getByLabelText('Terapkan SUTM')).toBeChecked()

    await userEvent.click(screen.getByRole('button', { name: 'Buat buku harga DRAFT' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Terapkan sebagai DRAFT' }))
    await waitFor(() => expect(masterExcelApi.apply).toHaveBeenCalledTimes(1))
    expect(masterExcelApi.apply.mock.calls[0][0]).toBe('i-1')
    expect(masterExcelApi.apply.mock.calls[0][1]).toMatchObject({ dataset: 'PRICE' })
    expect(await screen.findByText(/Buku harga DRAFT dibuat \(523 baris/)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /disetujui akun lain/ })).toHaveAttribute('href', '/master-data/harga')
  })

  it('kartu tarif menunjukkan ULP mana yang sudah punya jam nyala dan hasil pemeriksaan menunjukkan cakupan setelah diterapkan', async () => {
    masterExcelApi.list.mockResolvedValue({ data: [{ ...ready, kind: 'TARIF', report: null }], can: CAN, limits: { max_mb: 60 },
      tariff_coverage: [{ code: '51453', name: 'ULP Jombang', rows: 204 }, { code: '51452', name: 'ULP Mojokerto', rows: 0 }] })
    masterExcelApi.get.mockResolvedValue({ data: { ...ready, kind: 'TARIF', ulp_code: '51452', report: { tariff: { status: 'CHANGED', excel_rows: 200, current_rows: 204, changed_rows: 0, added_rows: 200, unchanged_rows: 0, samples: [], problems: [], warnings: [],
      coverage_after: [{ code: '51453', name: 'ULP Jombang', rows: 204 }, { code: '51452', name: 'ULP Mojokerto', rows: 200 }, { code: '51454', name: 'ULP Ngoro', rows: 0 }] } } } })
    renderPage()
    const card = await screen.findByRole('region', { name: 'Excel Tarif & Jam Nyala' })
    expect(within(card).getByText('ULP Jombang · 204 baris')).toBeInTheDocument()
    expect(within(card).getByText('ULP Mojokerto · belum ada')).toBeInTheDocument()
    await userEvent.click(await screen.findByRole('button', { name: 'Buka' }))
    expect(await screen.findByText(/Setelah diterapkan: ULP Jombang 204 baris, ULP Mojokerto 200 baris\. Belum ada: ULP Ngoro\./)).toBeInTheDocument()
  })

  it('akun tanpa izin tidak bisa menyiapkan data dan tombol terapkan nonaktif', async () => {
    masterExcelApi.list.mockResolvedValue({ data: [{ ...ready, report: null }], can: { rab: true, tariff: false, bom: false, price: false, tariffs: false }, limits: { max_mb: 60 } })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Buka' }))
    expect(await screen.findByRole('button', { name: 'Buat buku harga DRAFT' })).toBeDisabled()
    expect(screen.getByText(/memerlukan izin kelola harga/)).toBeInTheDocument()
    expect(screen.getAllByText('Akun Anda tidak berwenang menyiapkan data ini.')).toHaveLength(2)      // kartu Tarif dan kartu Template MASTER DISTRIVA (tanpa izin BOM)
  })
  const distriva = {
    ...ready, id: 'i-9', kind: 'DISTRIVA', file_name: 'MASTER-DISTRIVA-20261118.xlsx',
    report: { blocked: false, layout_problems: [], layout_problem_count: 0, meta: { template_version: '1', valid_from: '2026-12-01', basis: 'Surat 123/XYZ' },
      bom: { groups: [
        { group: 'SUTM', status: 'CHANGED', excel_lines: 608, current_lines: 608, changed: 1, added: 0, removed: 0, samples: [], problems: [], new_codes: [], parity: { checked: 2402, no_stored_value: 0, mismatch_count: 0, mismatches: [] } },
        { group: 'SUTR', status: 'BLOCKED', excel_lines: 131, current_lines: 131, changed: 1, added: 0, removed: 0, samples: [], problems: ['3 sel hasil hitung Excel berbeda dengan hitungan DISTRIVA.'], new_codes: [], parity: { checked: 513, no_stored_value: 0, mismatch_count: 3, mismatches: [] } },
      ] } },
  }

  it('template MASTER DISTRIVA: mengunduh template dari BOM berlaku', async () => {
    masterExcelApi.template.mockResolvedValue({ blob: new Blob(['x']), filename: 'MASTER-DISTRIVA-20261118.xlsx' })
    renderPage()
    const card = await screen.findByRole('region', { name: /MASTER DISTRIVA \(template untuk unit induk\)/ })
    await userEvent.click(within(card).getByRole('button', { name: 'Unduh template' }))
    await waitFor(() => expect(triggerFileDownload).toHaveBeenCalledWith(expect.any(Blob), 'MASTER-DISTRIVA-20261118.xlsx'))
  })

  it('hasil pemeriksaan template: kecocokan hitung per kelompok, tanggal berlaku terisi dari berkas, dan hanya kelompok yang cocok bisa diterapkan', async () => {
    masterExcelApi.list.mockResolvedValue({ data: [{ ...distriva, report: null }], can: CAN, limits: { max_mb: 60 } })
    masterExcelApi.get.mockResolvedValue({ data: distriva })
    masterExcelApi.apply.mockResolvedValue({ data: { status: 'OK', message: '1 kelompok BOM dibuat sebagai DRAFT (SUTM).' }, import: { ...distriva, applied: { BOM: { status: 'OK', message: '1 kelompok BOM dibuat sebagai DRAFT (SUTM).', link: '/master-data/bom' } } } })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Buka' }))
    expect(await screen.findByText('Surat 123/XYZ')).toBeInTheDocument()
    expect(screen.getByText('Hasil hitung cocok (2402 sel diuji)')).toBeInTheDocument()
    expect(screen.getByText('Hasil hitung berbeda di 3 sel')).toBeInTheDocument()
    expect(screen.getByLabelText('Terapkan SUTR')).toBeDisabled()                       // Excel and engine disagree: blocked
    expect(screen.getByLabelText('Berlaku mulai')).toHaveValue('2026-12-01')

    await userEvent.click(screen.getByRole('button', { name: 'Terapkan BOM terpilih' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Terapkan sebagai DRAFT' }))
    await waitFor(() => expect(masterExcelApi.apply).toHaveBeenCalledTimes(1))
    expect(masterExcelApi.apply.mock.calls[0][1]).toMatchObject({ dataset: 'BOM', valid_from: '2026-12-01', groups: ['SUTM'] })
  })

  it('harga: selisih nilai MDU hanya ditampilkan, tidak ditimpa', async () => {
    const full = { ...distriva, report: { ...distriva.report,
      price: { status: 'UNCHANGED', excel_rows: 504, current_rows: 523, changed_rows: 0, unchanged_rows: 504, added_in_excel: 0, new_codes: { count: 0, items: [] }, book: 'Kontrak jasa', samples: [], problems: [],
        mdu_differences: { count: 1, items: [{ code: 'A496', name: 'Lemari APP 80A', current: 16748000, excel: 17166500 }] } } } }
    masterExcelApi.list.mockResolvedValue({ data: [{ ...full, report: null }], can: CAN, limits: { max_mb: 60 } })
    masterExcelApi.get.mockResolvedValue({ data: full })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Buka' }))
    const box = await screen.findByTestId('mdu-differences')
    expect(box).toHaveTextContent(/berbeda dari buku yang berlaku pada 1 barang/)
    expect(box).toHaveTextContent('Lemari APP 80A')
    expect(box).toHaveTextContent('16.748.000')
    expect(box).toHaveTextContent('17.166.500')
    expect(screen.getByRole('button', { name: 'Buat buku harga DRAFT' })).toBeDisabled()        // MDU alone never creates a draft
  })

  it('template: harga dan tarif ikut dibandingkan dan diterapkan terpisah dengan tanggal berlaku dari berkas', async () => {
    const full = { ...distriva, report: { ...distriva.report,
      price: { status: 'CHANGED', excel_rows: 504, current_rows: 504, changed_rows: 2, unchanged_rows: 502, added_in_excel: 0, new_codes: { count: 0, items: [] }, book: 'Kontrak jasa', samples: [], problems: [] },
      tariff: { status: 'CHANGED', excel_rows: 30, current_rows: 30, changed_rows: 1, added_rows: 0, unchanged_rows: 29, samples: [], problems: [], warnings: [], coverage_after: [] } } }
    masterExcelApi.list.mockResolvedValue({ data: [{ ...full, report: null }], can: CAN, limits: { max_mb: 60 } })
    masterExcelApi.get.mockResolvedValue({ data: full })
    masterExcelApi.apply.mockResolvedValue({ data: { status: 'OK', message: 'Buku tarif DRAFT dibuat (30 baris).' }, import: { ...full, applied: { TARIFF: { status: 'OK', message: 'Buku tarif DRAFT dibuat (30 baris).', link: '/master-data/tariff-books' } } } })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Buka' }))
    expect(await screen.findByText('Buku harga')).toBeInTheDocument()
    expect(screen.getByText('Buku tarif, jam nyala, dan UJL')).toBeInTheDocument()
    expect(screen.getByText(/Setiap baris membawa kode ULP-nya sendiri/)).toBeInTheDocument()
    expect(screen.getAllByLabelText('Berlaku mulai').map((i) => i.value)).toEqual(['2026-12-01', '2026-12-01', '2026-12-01'])   // BOM, harga, tarif: tanggal dari lembar INFO
    await userEvent.click(screen.getByRole('button', { name: 'Buat buku tarif DRAFT' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Terapkan sebagai DRAFT' }))
    await waitFor(() => expect(masterExcelApi.apply).toHaveBeenCalledTimes(1))
    expect(masterExcelApi.apply.mock.calls[0][1]).toMatchObject({ dataset: 'TARIFF', valid_from: '2026-12-01' })
  })

  it('template: parameter KKF yang berubah dan hasil contoh dari Excel ditampilkan, aturan tetap yang berbeda hanya diperingatkan', async () => {
    const full = { ...distriva, report: { ...distriva.report,
      rules: { status: 'DIFFERENT', differences: [{ rule: 'ppn_rate', label: 'PPN pada RAB', workbook: '0.12', distriva: '0.11' }] },
      kkf: { status: 'CHANGED', set: 'Parameter 2026', values: { bpp: 600 }, changes: [{ field: 'bpp', label: 'BPP / biaya pokok penyediaan (Rp per kWh)', before: 552, after: 600 }], problems: [], cases: { checked: 7, skipped: 0, mismatch_count: 0, mismatches: [] } } } }
    masterExcelApi.list.mockResolvedValue({ data: [{ ...full, report: null }], can: CAN, limits: { max_mb: 60 } })
    masterExcelApi.get.mockResolvedValue({ data: full })
    masterExcelApi.apply.mockResolvedValue({ data: { status: 'OK', message: 'Set parameter KKF DRAFT dibuat (1 nilai berubah).' }, import: { ...full, applied: { KKF: { status: 'OK', message: 'Set parameter KKF DRAFT dibuat (1 nilai berubah).', link: '/master-data/kkf-parameters' } } } })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Buka' }))
    expect(await screen.findByText('Parameter KKF')).toBeInTheDocument()
    expect(screen.getByText('Hasil contoh cocok (7 nilai diuji)')).toBeInTheDocument()
    expect(screen.getByText(/BPP \/ biaya pokok penyediaan/)).toBeInTheDocument()
    expect(screen.getByText(/Aturan tetap di berkas berbeda dengan program DISTRIVA: PPN pada RAB \(Excel 0.12, DISTRIVA 0.11\)/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Buat set parameter KKF DRAFT' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Terapkan sebagai DRAFT' }))
    await waitFor(() => expect(masterExcelApi.apply).toHaveBeenCalledTimes(1))
    expect(masterExcelApi.apply.mock.calls[0][1]).toMatchObject({ dataset: 'KKF', valid_from: '2026-12-01' })
  })

  it('template: uji pembulatan RAB yang berbeda hanya diperingatkan, yang cocok ditandai cocok', async () => {
    const mismatch = { ...distriva, report: { ...distriva.report, rab: { status: 'MISMATCH', checked: 6, mismatch_count: 1, mismatches: [{ cell: 'UJI_RAB!D5', case: 'Contoh 1', excel: 13703600, distriva: 13703800 }] } } }
    masterExcelApi.list.mockResolvedValue({ data: [{ ...mismatch, report: null }], can: CAN, limits: { max_mb: 60 } })
    masterExcelApi.get.mockResolvedValue({ data: mismatch })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Buka' }))
    expect(await screen.findByText(/Pembulatan RAB di Excel berbeda dengan aturan DISTRIVA di 1 sel \(UJI_RAB!D5: Excel 13703600, DISTRIVA 13703800\)/)).toBeInTheDocument()
  })

  it('template: uji pembulatan RAB yang cocok ditandai cocok', async () => {
    const match = { ...distriva, report: { ...distriva.report, rab: { status: 'MATCH', checked: 6, mismatch_count: 0, mismatches: [] } } }
    masterExcelApi.list.mockResolvedValue({ data: [{ ...match, report: null }], can: CAN, limits: { max_mb: 60 } })
    masterExcelApi.get.mockResolvedValue({ data: match })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Buka' }))
    expect(await screen.findByText('Uji pembulatan RAB cocok (6 nilai diuji).')).toBeInTheDocument()
  })

  it('masalah susunan berkas ditampilkan per sel dan tidak ada yang dibandingkan', async () => {
    const bad = { ...distriva, report: { blocked: true, layout_problem_count: 2, layout_problems: ['SUTM!J10: isi "banyak" bukan angka maupun rumus.', 'SUTM!A11: nomor baris 99 tidak sama dengan baris Excel 11.'], meta: { template_version: '1', valid_from: '2026-12-01', basis: null }, bom: { groups: [] } } }
    masterExcelApi.list.mockResolvedValue({ data: [{ ...bad, report: null }], can: CAN, limits: { max_mb: 60 } })
    masterExcelApi.get.mockResolvedValue({ data: bad })
    renderPage()
    await userEvent.click(await screen.findByRole('button', { name: 'Buka' }))
    expect(await screen.findByText(/2 masalah pada susunan berkas/)).toBeInTheDocument()
    expect(screen.getByText(/SUTM!J10/)).toBeInTheDocument()
    expect(screen.queryByText('BOM (rumus volume)')).not.toBeInTheDocument()
  })
})
