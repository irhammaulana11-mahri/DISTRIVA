import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import NkoRulesPage from './NkoRulesPage.jsx'
import { nkoApi, triggerFileDownload } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  triggerFileDownload: vi.fn(),
  nkoApi: {
    rules: vi.fn(),
    rulesCatalog: vi.fn(),
    rulesMapping: vi.fn(),
    previewRule: vi.fn(),
    ruleProposals: vi.fn(),
    proposeRule: vi.fn(),
    decideRuleProposal: vi.fn(),
    cancelRuleProposal: vi.fn(),
    definitionSets: vi.fn(),
    definitionUploads: vi.fn(),
    definitionUpload: vi.fn(),
    definitionTemplate: vi.fn(),
    checkDefinitionUpload: vi.fn(),
    uploadDefinitions: vi.fn(),
    decideDefinitionUpload: vi.fn(),
    cancelDefinitionUpload: vi.fn(),
    targetTemplate: vi.fn(),
    checkTargetUpload: vi.fn(),
    targetUploads: vi.fn(),
    targetUpload: vi.fn(),
    uploadTargets: vi.fn(),
    decideTargetUpload: vi.fn(),
    cancelTargetUpload: vi.fn(),
  },
  notificationsApi: {
    list: vi.fn().mockResolvedValue({ data: [] }),
    markRead: vi.fn(),
    markAllRead: vi.fn(),
  },
}))

function wrap(ui, can = { 'nko.view': true }, userId = 'usr-1') {
  return render(
    <MemoryRouter>
      <AuthContext.Provider value={{ user: { id: userId, name: 'Tester' }, status: 'authenticated' }}>
        <AccessContext.Provider value={{ can, isSysAdmin: false, createUnits: [], loading: false }}>
          <NotificationProvider>{ui}</NotificationProvider>
        </AccessContext.Provider>
      </AuthContext.Provider>
    </MemoryRouter>,
  )
}

const MOCK_CATALOG = {
  data: {
    quantities: [
      { name: 'kwh_jual', label: 'kWh Jual Kumulatif', unit_label: 'kWh', up3_aggregation: 'JUMLAH' },
      { name: 'kwh_jual_tahun_lalu', label: 'kWh Jual Tahun Lalu', unit_label: 'kWh', up3_aggregation: 'JUMLAH' },
    ],
    functions: [
      { name: 'abs', min_args: 1, max_args: 1 },
      { name: 'atau', min_args: 2, max_args: 2 },
    ],
    operators: ['+', '-', '*', '/', '(', ')'],
    modes: ['SISTEM_BOLEH_KOREKSI', 'SISTEM', 'MANUAL'],
  },
}

const MOCK_RULES = {
  data: {
    year: 2026,
    month: 5,
    items: [
      {
        definition_code: 'penjualan-tenaga-listrik',
        name: 'Penjualan Tenaga Listrik',
        unit_label: 'GWh',
        levels: ['UP3', 'ULP'],
        has_rule: true,
        mode: 'SISTEM_BOLEH_KOREKSI',
        formula: 'penjualan_selisih',
        inputs: [],
        is_validated: true,
        flag_when_negative: true,
        effective_from: '2000-01',
        replaces_code: null,
      },
      {
        definition_code: 'indikator-baru',
        name: 'Indikator Baru Tanpa Aturan',
        unit_label: '%',
        levels: ['ULP'],
        has_rule: false,
        mode: null,
        formula: null,
        inputs: [],
        is_validated: null,
        flag_when_negative: null,
        effective_from: null,
        replaces_code: null,
      },
    ],
  },
}

const MOCK_MAPPING_WITH_ORPHAN = {
  data: {
    year: 2026,
    changes: {},
    orphaned: [
      {
        code: 'kode-lama-saidi',
        name: 'SAIDI Lama',
        formula: 'saidi_menit',
        manual_inputs: 3,
        linked_menus: ['saidi-saifi'],
        suggestions: [
          { code: 'saidi-baru', name: 'SAIDI Baru', level: 'ULP', score: 0.92 },
        ],
      },
    ],
    unmapped: [{ code: 'indikator-baru', name: 'Indikator Baru Tanpa Aturan', levels: ['ULP'] }],
  },
}

describe('NkoRulesPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    nkoApi.rulesCatalog.mockResolvedValue(MOCK_CATALOG)
    nkoApi.rules.mockResolvedValue(MOCK_RULES)
    nkoApi.rulesMapping.mockResolvedValue({ data: { year: 2026, changes: {}, orphaned: [], unmapped: [] } })
    nkoApi.ruleProposals.mockResolvedValue({ data: [] })
    nkoApi.definitionSets.mockResolvedValue({ data: [] })
    nkoApi.definitionUploads.mockResolvedValue({ data: [] })
    nkoApi.definitionTemplate.mockResolvedValue({ blob: new Blob(['xlsx']), filename: 'definisi.xlsx' })
    nkoApi.targetUploads.mockResolvedValue({ data: [] })
    nkoApi.targetTemplate.mockResolvedValue({ blob: new Blob(['xlsx']), filename: 'target.xlsx' })
  })

  it('1. menampilkan daftar aturan, item tanpa aturan, dan peringatan item berganti nama', async () => {
    nkoApi.rulesMapping.mockResolvedValue(MOCK_MAPPING_WITH_ORPHAN)
    wrap(<NkoRulesPage />, { 'nko.view': true, 'nko.rules.propose': true })

    expect(await screen.findByText('Pengaturan Aturan Realisasi NKO')).toBeInTheDocument()
    expect(await screen.findByText('Penjualan Tenaga Listrik')).toBeInTheDocument()
    expect(screen.getByText('Indikator Baru Tanpa Aturan')).toBeInTheDocument()
    expect(screen.getByText('Tanpa Aturan (Manual)')).toBeInTheDocument()
    expect(screen.getByText(/Peringatan Item Berganti Nama/i)).toBeInTheDocument()
    expect(screen.getByText(/Pakai: SAIDI Baru \(92%\)/i)).toBeInTheDocument()
  })

  it('2. penyusun rumus menyisipkan besaran katalog, menjalankan pratinjau workbook, dan mengajukan usulan', async () => {
    nkoApi.previewRule.mockResolvedValue({
      data: {
        summary: { with_value: 2, compared: 2, matched: 2, tolerance_pct: 0.5 },
        rows: [
          {
            unit_id: 'u-1',
            unit_name: 'ULP Jombang',
            unit_type: 'ULP',
            month: 5,
            proposed: 12.5,
            current: 12.5,
            reference: 12.5,
            matches: true,
          },
        ],
      },
    })
    nkoApi.proposeRule.mockResolvedValue({ message: 'Usulan tersimpan', data: { id: 'prop-1' } })

    const user = userEvent.setup()
    wrap(<NkoRulesPage />, { 'nko.view': true, 'nko.rules.propose': true })

    const createBtn = await screen.findByRole('button', { name: /Buat Aturan/i })
    await user.click(createBtn)

    // Sisipkan besaran dari katalog
    const qtyBtn = await screen.findByRole('button', { name: 'kwh_jual' })
    await user.click(qtyBtn)
    expect(screen.getByLabelText('Rumus Realisasi')).toHaveValue('kwh_jual')

    // Jalankan pratinjau banding workbook
    await user.click(screen.getByRole('button', { name: /Pratinjau Banding Workbook/i }))
    expect(await screen.findByText('ULP Jombang')).toBeInTheDocument()
    expect(screen.getByText('Cocok')).toBeInTheDocument()
    expect(nkoApi.previewRule).toHaveBeenCalledTimes(1)

    // Isi alasan dan ajukan usulan
    await user.type(screen.getByLabelText('Alasan Pengajuan'), 'Menambahkan rumus otomatis')
    await user.click(screen.getByRole('button', { name: /Ajukan Usulan/i }))

    await waitFor(() => {
      expect(nkoApi.proposeRule).toHaveBeenCalledWith(
        expect.objectContaining({
          definition_code: 'indikator-baru',
          formula: 'kwh_jual',
          reason: 'Menambahkan rumus otomatis',
        }),
      )
    })
  })

  it('3. menyetujui, menolak (alasan wajib), dan membatalkan usulan sesuai peran', async () => {
    nkoApi.ruleProposals.mockResolvedValue({
      data: [
        {
          id: 'prop-other',
          definition_code: 'penjualan-tenaga-listrik',
          definition_name: 'Penjualan Tenaga Listrik',
          mode: 'SISTEM',
          formula: 'penjualan_selisih',
          effective_from: '2026-06',
          reason: 'Kunci masukan manual',
          status: 'MENUNGGU',
          proposed_by: { id: 'usr-other', name: 'Perencana' },
          proposed_at: '2026-11-26T10:00:00Z',
        },
        {
          id: 'prop-own',
          definition_code: 'indikator-baru',
          definition_name: 'Indikator Baru Tanpa Aturan',
          mode: 'MANUAL',
          formula: null,
          effective_from: '2026-06',
          reason: 'Usulan sendiri',
          status: 'MENUNGGU',
          proposed_by: { id: 'usr-1', name: 'Tester' },
          proposed_at: '2026-11-26T11:00:00Z',
        },
      ],
    })
    nkoApi.decideRuleProposal.mockResolvedValue({ message: 'Usulan ditolak.', data: { status: 'DITOLAK' } })
    nkoApi.cancelRuleProposal.mockResolvedValue({ message: 'Usulan dibatalkan.' })

    const user = userEvent.setup()
    wrap(<NkoRulesPage />, { 'nko.view': true, 'nko.rules.propose': true, 'nko.rules.approve': true }, 'usr-1')

    const proposalsTab = await screen.findByRole('tab', { name: /Daftar Usulan/i })
    await user.click(proposalsTab)

    expect(await screen.findByText('Pengusul tidak dapat memutus usulannya sendiri')).toBeInTheDocument()

    // Tolak usulan milik orang lain: alasan wajib
    await user.click(screen.getByRole('button', { name: /^Tolak$/i }))
    await user.click(screen.getByRole('button', { name: /Tolak Usulan/i }))
    expect(await screen.findByText('Alasan penolakan wajib diisi.')).toBeInTheDocument()

    await user.type(screen.getByLabelText('Catatan Keputusan'), 'Rumus belum sesuai')
    await user.click(screen.getByRole('button', { name: /Tolak Usulan/i }))

    await waitFor(() => {
      expect(nkoApi.decideRuleProposal).toHaveBeenCalledWith('prop-other', {
        decision: 'reject',
        note: 'Rumus belum sesuai',
      })
    })

    // Batalkan usulan milik sendiri
    await user.click(screen.getByRole('button', { name: /Batalkan/i }))
    await waitFor(() => {
      expect(nkoApi.cancelRuleProposal).toHaveBeenCalledWith('prop-own')
    })
  })

  it('4. tab Versi Workbook menampilkan versi, rincian changes[], menolak (alasan wajib), dan menyetujui mengarahkan ke Perubahan Item', async () => {
    nkoApi.definitionSets.mockResolvedValue({
      data: [
        {
          id: 'set-1',
          year: 2026,
          unit_level: 'ULP',
          version: 1,
          status: 'AKTIF',
          source_name: 'nko-2026-v1.xlsx',
          total_weight: 100,
          warnings: [],
          imported_at: '2026-11-20T10:00:00Z',
          imported_by: null,
        },
      ],
    })
    nkoApi.definitionUploads.mockResolvedValue({
      data: [
        {
          id: 'up-1',
          year: 2026,
          source_name: 'nko-2026-v2.xlsx',
          note: 'Pembaruan target Q4',
          status: 'MENUNGGU',
          uploaded_by: { id: 'usr-other', name: 'Perencana' },
          uploaded_at: '2026-11-27T01:00:00Z',
        },
      ],
    })
    nkoApi.definitionUpload.mockResolvedValue({
      data: {
        id: 'up-1',
        year: 2026,
        source_name: 'nko-2026-v2.xlsx',
        status: 'MENUNGGU',
        uploaded_by: { id: 'usr-other', name: 'Perencana' },
        changes: [
          {
            level: 'ULP',
            status: 'DIGANTIKAN',
            compared_with: '2026 v1',
            total_rule_changed: false,
            warnings: ['Total bobot berubah'],
            alerts: ['Jumlah indikator turun lebih dari 20%'],
            added: [{ code: 'item-baru', name: 'Item Baru', weight: 5, needs_realization: true, has_rule: false }],
            removed: [],
            possible_renames: [],
            changed: [{ code: 'saidi', name: 'SAIDI', fields: { weight: { from: 10, to: 15 } } }],
            targets_changed: { 'ULP Jombang': 3 },
          },
        ],
        check: {
          year: 2026,
          year_found: 2026,
          can_upload: true,
          errors: [],
          warnings: [],
          tabs: [
            { sheet: 'ULP Jombang', status: 'DIKENALI', level: 'ULP', unit_name: 'ULP Jombang', unit_found: true, items: 20, total_weight: 100, errors: [], warnings: [] },
          ],
        },
      },
    })
    nkoApi.decideDefinitionUpload.mockResolvedValue({
      message: 'Definisi baru aktif.',
      data: {
        status: 'DISETUJUI',
        sets: [],
        mapping: {
          year: 2026,
          changes: {},
          orphaned: [],
          unmapped: [{ code: 'item-baru', name: 'Item Baru', levels: ['ULP'] }],
        },
      },
    })

    const user = userEvent.setup()
    wrap(<NkoRulesPage />, { 'nko.view': true, 'nko.rules.propose': true, 'nko.rules.approve': true }, 'usr-1')

    await user.click(await screen.findByRole('tab', { name: /Versi Workbook/i }))
    expect(await screen.findByText('nko-2026-v1.xlsx')).toBeInTheDocument()
    expect(screen.getByText('nko-2026-v2.xlsx')).toBeInTheDocument()

    // Lihat perubahan
    await user.click(screen.getByRole('button', { name: /Lihat Perubahan/i }))
    expect(await screen.findByText(/Rincian Perubahan Workbook: nko-2026-v2.xlsx/i)).toBeInTheDocument()
    expect(screen.getByText('Total bobot berubah')).toBeInTheDocument()
    expect(screen.getByText('Jumlah indikator turun lebih dari 20%')).toBeInTheDocument()
    expect(screen.getByText(/Laporan Pemeriksaan Saat Unggah/i)).toBeInTheDocument()
    expect(screen.getByText(/ULP Jombang \(3 target\)/i)).toBeInTheDocument()

    // Setujui unggahan -> otomatis pindah ke tab Perubahan Item
    await user.click(screen.getByRole('button', { name: /^Setujui$/i }))
    await user.click(screen.getByRole('button', { name: /Setujui & Aktifkan/i }))

    await waitFor(() => {
      expect(nkoApi.decideDefinitionUpload).toHaveBeenCalledWith('up-1', {
        decision: 'approve',
        note: null,
      })
    })
    expect(await screen.findByText(/Item Baru Tanpa Aturan Realisasi/i)).toBeInTheDocument()
    expect(screen.getByText('Item Baru')).toBeInTheDocument()
  })

  it('5. tab Versi Workbook mendukung unduh template dan pemeriksaan workbook yang menonaktifkan unggah bila gagal (Butir 63)', async () => {
    globalThis.URL.createObjectURL = vi.fn(() => 'blob:mock')
    globalThis.URL.revokeObjectURL = vi.fn()
    nkoApi.checkDefinitionUpload.mockResolvedValue({
      data: {
        year: 2026,
        year_found: 2026,
        can_upload: false,
        errors: ['Bobot total tidak 100'],
        warnings: [],
        tabs: [
          { sheet: 'PETUNJUK', status: 'DILEWATI', level: null, unit_name: null, unit_found: null, reason: 'Tab petunjuk', items: null, total_weight: null, errors: [], warnings: [] },
          { sheet: 'ULP Jombang', status: 'GALAT', level: 'ULP', unit_name: 'ULP Jombang', unit_found: true, items: 10, total_weight: 90, errors: ['Total bobot 90'], warnings: [] },
        ],
      },
    })

    const user = userEvent.setup()
    wrap(<NkoRulesPage />, { 'nko.view': true, 'nko.rules.propose': true })

    await user.click(await screen.findByRole('tab', { name: /Versi Workbook/i }))

    // Unduh template definisi (format=definisi) & workbook lengkap
    await user.click(await screen.findByRole('button', { name: /Template definisi/i }))
    await waitFor(() => {
      expect(nkoApi.definitionTemplate).toHaveBeenCalledWith({ year: 2026, format: 'definisi' })
    })
    await user.click(screen.getByRole('button', { name: /Workbook lengkap/i }))
    await waitFor(() => {
      expect(nkoApi.definitionTemplate).toHaveBeenCalledWith({ year: 2026 })
    })
    await waitFor(() => expect(triggerFileDownload).toHaveBeenCalledWith(expect.any(Blob), 'definisi.xlsx'))

    // Pilih berlaku mulai bulan & berkas lalu klik Periksa
    await user.selectOptions(screen.getByLabelText('Berlaku mulai bulan'), '7')
    const file = new File(['dummy'], 'nko-test.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
    const fileInput = screen.getByLabelText(/Berkas Excel/i)
    await user.upload(fileInput, file)

    await user.click(screen.getByRole('button', { name: /^Periksa$/i }))

    expect(await screen.findByText(/Tidak Lolos \(Perbaiki Galat\)/i)).toBeInTheDocument()
    expect(screen.getByText('Bobot total tidak 100')).toBeInTheDocument()
    expect(screen.getByText('PETUNJUK')).toBeInTheDocument()
    expect(screen.getByText('Total bobot 90')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Unggah Workbook/i })).toBeDisabled()
  })

  it('6. kartu Target mendukung unduh template target, rincian perubahan sel per unit, dan persetujuan target (Butir 64)', async () => {
    nkoApi.targetUploads.mockResolvedValue({
      data: [
        {
          id: 'tup-1',
          year: 2026,
          source_name: 'target-ulp-2026.xlsx',
          note: 'Revisi target semester 2',
          status: 'MENUNGGU',
          uploaded_by: { id: 'usr-other', name: 'Perencana' },
          uploaded_at: '2026-11-27T09:00:00Z',
        },
      ],
    })
    nkoApi.targetUpload.mockResolvedValue({
      data: {
        id: 'tup-1',
        year: 2026,
        source_name: 'target-ulp-2026.xlsx',
        status: 'MENUNGGU',
        uploaded_by: { id: 'usr-other', name: 'Perencana' },
        changes: [
          {
            level: 'ULP',
            unit_name: 'ULP Jombang',
            compared_with: '2026 v1',
            cells: 1,
            items: [{ code: 'saidi', name: 'SAIDI', months: { '7': { from: 40, to: 38 } } }],
          },
        ],
      },
    })
    nkoApi.decideTargetUpload.mockResolvedValue({
      message: 'Target diperbarui. Hitung ulang NKO untuk memperbarui nilai.',
      data: { status: 'DISETUJUI', cells: 1 },
    })

    const user = userEvent.setup()
    wrap(<NkoRulesPage />, { 'nko.view': true, 'nko.rules.propose': true, 'nko.rules.approve': true }, 'usr-1')

    await user.click(await screen.findByRole('tab', { name: /Versi Workbook/i }))

    // Unduh template target
    await user.selectOptions(screen.getByLabelText('Tingkat Template Target'), 'UP3')
    await user.click(screen.getByRole('button', { name: /Unduh Template Target/i }))
    await waitFor(() => {
      expect(nkoApi.targetTemplate).toHaveBeenCalledWith({ year: 2026, level: 'UP3' })
    })
    await waitFor(() => expect(triggerFileDownload).toHaveBeenCalledWith(expect.any(Blob), 'target.xlsx'))

    // Lihat perubahan target
    await user.click(screen.getByRole('button', { name: /Lihat Perubahan Target/i }))
    expect(await screen.findByText(/Rincian Perubahan Target: target-ulp-2026.xlsx/i)).toBeInTheDocument()
    expect(screen.getByText('SAIDI')).toBeInTheDocument()
    expect(screen.getByText('40')).toBeInTheDocument()
    expect(screen.getByText('38')).toBeInTheDocument()

    // Setujui target
    await user.click(screen.getByRole('button', { name: /Setujui Target/i }))
    await user.click(screen.getByRole('button', { name: /Setujui & Simpan Target/i }))
    await waitFor(() => {
      expect(nkoApi.decideTargetUpload).toHaveBeenCalledWith('tup-1', { decision: 'approve', note: null })
    })
  })
})
