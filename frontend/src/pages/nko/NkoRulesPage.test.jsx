import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { AuthContext } from '../../features/auth/AuthContext.jsx'
import { AccessContext } from '../../features/admin/AccessContext.jsx'
import { NotificationProvider } from '../../features/notifications/NotificationContext.jsx'
import NkoRulesPage from './NkoRulesPage.jsx'
import { nkoApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
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
    uploadDefinitions: vi.fn(),
    decideDefinitionUpload: vi.fn(),
    cancelDefinitionUpload: vi.fn(),
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
            added: [{ code: 'item-baru', name: 'Item Baru', weight: 5, needs_realization: true, has_rule: false }],
            removed: [],
            possible_renames: [],
            changed: [{ code: 'saidi', name: 'SAIDI', fields: { weight: { from: 10, to: 15 } } }],
            targets_changed: { 'ULP Jombang': 3 },
          },
        ],
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
})
