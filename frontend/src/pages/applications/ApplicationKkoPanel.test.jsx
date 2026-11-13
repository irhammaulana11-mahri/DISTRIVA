import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ApplicationKkoPanel from './ApplicationKkoPanel.jsx'
import { kkoApi, substationsApi } from '../../services/api.js'

vi.mock('../../services/api.js', () => ({
  kkoApi: { get: vi.fn(), record: vi.fn(), decide: vi.fn() },
  substationsApi: { list: vi.fn() },
}))

const context = {
  application_type: 'PB',
  added_power_kva: 20,
  new_power_kva: 20,
  load_factor_default: 0.8,
  dedicated_expected: false,
  thresholds: { underload_max: 40, normal_max: 80, overload_max: 100, min_voltage_v: 200 },
}
const empty = { data: { status: 'NOT_RECORDED', context, record: null, events: [] } }
const record = (over = {}) => ({
  id: 'k1', substation_code: 'HD0004', substation_name: 'Taman Merdeka', transformer_capacity_kva: 200, measured_load_kva: 190, measured_at: '2026-11-01',
  voltage_location_v: 195, dedicated_transformer: false, dedicated_transformer_kva: null, loading_before_pct: 95, loading_after_pct: 103.25,
  class_before: 'OVERLOAD', class_after: 'OVERBLAST', voltage_low: true, decision: null, decision_notes: null, improvement_proposal: null, ...over,
})
const app = { id: 'app-1' }

describe('ApplicationKkoPanel (docs/62 §51)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    kkoApi.get.mockResolvedValue(empty)
  })

  it('1. belum dicatat: menampilkan status, batas, dan formulir bagi yang berhak mencatat', async () => {
    render(<ApplicationKkoPanel application={app} canRecord canDecide={false} />)
    expect(await screen.findByTestId('kko-status')).toHaveTextContent('Belum dicatat')
    expect(screen.getByText(/KKO tidak menghalangi alur permohonan/)).toBeInTheDocument()
    expect(screen.getByLabelText('Kapasitas trafo')).toBeInTheDocument()
    expect(screen.queryByTestId('kko-decide-form')).not.toBeInTheDocument()
  })

  it('2. menyimpan hasil survei dan menampilkan pembebanan sesudah dengan kelas dan tanda tegangan', async () => {
    kkoApi.record.mockResolvedValue({ data: { status: 'RECORDED', context, record: record(), events: [] } })
    render(<ApplicationKkoPanel application={app} canRecord canDecide={false} />)
    await screen.findByTestId('kko-status')
    await userEvent.type(screen.getByLabelText('Kapasitas trafo'), '200')
    await userEvent.type(screen.getByLabelText('Beban terukur'), '190')
    await userEvent.type(screen.getByLabelText('Tegangan lokasi'), '195')
    await userEvent.click(screen.getByRole('button', { name: /Simpan Hasil Survei KKO/ }))
    await waitFor(() => expect(kkoApi.record).toHaveBeenCalled())
    const body = kkoApi.record.mock.calls[0][1]
    expect(body.transformer_capacity_kva).toBe(200)
    expect(body.measured_load_kva).toBe(190)
    expect(body.voltage_location_v).toBe(195)
    expect(body.load_factor).toBeUndefined()      // kosong = bawaan server
    expect(await screen.findByTestId('kko-after-class')).toHaveTextContent('Overblast')
    expect(screen.getByTestId('kko-before-class')).toHaveTextContent('Overload')
    expect(screen.getByTestId('kko-voltage-low')).toBeInTheDocument()
  })

  it('3. trafo khusus: tidak ada pembebanan, hanya kapasitas yang diusulkan; petunjuk 53 kVA ke atas', async () => {
    kkoApi.get.mockResolvedValue({ data: { status: 'RECORDED', context: { ...context, dedicated_expected: true, new_power_kva: 66 }, events: [],
      record: record({ dedicated_transformer: true, dedicated_transformer_kva: 100, loading_before_pct: null, loading_after_pct: null, class_before: null, class_after: null }) } })
    render(<ApplicationKkoPanel application={app} canRecord={false} canDecide={false} />)
    expect(await screen.findByTestId('kko-dedicated')).toHaveTextContent('100')
    expect(screen.queryByTestId('kko-after-pct')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kko-dedicated-hint')).not.toBeInTheDocument()   // sudah diusulkan
  })

  it('4. Teknik: TIDAK LAYAK wajib beralasan, usulan perbaikan opsional dan tampil di keputusan', async () => {
    kkoApi.get.mockResolvedValue({ data: { status: 'RECORDED', context, record: record(), events: [] } })
    kkoApi.decide.mockResolvedValue({ data: { status: 'TIDAK_LAYAK', context, events: [],
      record: record({ decision: 'TIDAK_LAYAK', decision_notes: 'Trafo overbeban.', improvement_proposal: 'Uprating trafo.', decided_by_name: 'Budi' }) } })
    render(<ApplicationKkoPanel application={app} canRecord={false} canDecide />)
    await screen.findByTestId('kko-decide-form')
    await userEvent.selectOptions(screen.getByLabelText('Keputusan KKO'), 'TIDAK_LAYAK')
    const save = screen.getByRole('button', { name: /Simpan Keputusan/ })
    expect(save).toBeDisabled()                                      // alasan wajib
    await userEvent.type(screen.getByLabelText('Alasan keputusan'), 'Trafo overbeban.')
    await userEvent.type(screen.getByLabelText('Usulan perbaikan'), 'Uprating trafo.')
    await userEvent.click(save)
    await waitFor(() => expect(kkoApi.decide).toHaveBeenCalledWith('app-1', { decision: 'TIDAK_LAYAK', notes: 'Trafo overbeban.', improvement_proposal: 'Uprating trafo.' }))
    expect(await screen.findByTestId('kko-decision')).toHaveTextContent('Usulan perbaikan: Uprating trafo.')
    expect(screen.getByTestId('kko-status')).toHaveTextContent('TIDAK LAYAK')
  })

  it('5. galat server tampil apa adanya', async () => {
    kkoApi.record.mockRejectedValue(new Error('Kapasitas trafo khusus yang diusulkan wajib diisi.'))
    render(<ApplicationKkoPanel application={app} canRecord canDecide={false} />)
    await screen.findByTestId('kko-status')
    await userEvent.click(screen.getByRole('button', { name: /Simpan Hasil Survei KKO/ }))
    expect(await screen.findByText(/wajib diisi/)).toBeInTheDocument()
  })

  describe('pilih gardu master (docs/80)', () => {
    const gardu = (over = {}) => ({
      id: 'g1', code: 'HD0004', name: 'Taman Merdeka', area_note: null, kelurahan: null, capacity_kva: 200, reading_status: 'FRESH',
      reading: { measured_on: '2026-11-01', age_days: 9, load_kva: 120, loading_pct: 60, end_voltage_v: 215 }, ...over,
    })

    it('P1. memilih gardu mengisi formulir dan mengirim substation_id', async () => {
      substationsApi.list.mockResolvedValue({ data: [gardu()] })
      kkoApi.record.mockResolvedValue({ data: { status: 'RECORDED', context, record: record(), events: [] } })
      render(<ApplicationKkoPanel application={app} canRecord canDecide={false} />)
      await screen.findByTestId('kko-status')
      await userEvent.type(screen.getByLabelText('Cari gardu master'), 'HD00')
      await userEvent.click(await screen.findByRole('option', { name: /HD0004/ }))
      expect(screen.getByLabelText('Kapasitas trafo')).toHaveValue(200)
      expect(screen.getByLabelText('Beban terukur')).toHaveValue(120)
      expect(screen.getByLabelText('Tegangan lokasi')).toHaveValue(null)                       // tegangan eksisting pelanggan diisi manual (16 Nov 2026), bukan dari tegangan ujung gardu
      expect(screen.queryByTestId('kko-pick-note')).not.toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: /Simpan Hasil Survei KKO/ }))
      await waitFor(() => expect(kkoApi.record).toHaveBeenCalled())
      const body = kkoApi.record.mock.calls[0][1]
      expect(body.substation_id).toBe('g1')
      expect(body.measured_load_kva).toBe(120)
    })

    it('P1c. hasil pencarian menampilkan nama gardu; isian kode gardu memakai No. GADIS bila ada', async () => {
      substationsApi.list.mockResolvedValue({ data: [gardu({ display_code: 'GD514530003' })] })
      kkoApi.record.mockResolvedValue({ data: { status: 'RECORDED', context, record: record(), events: [] } })
      render(<ApplicationKkoPanel application={app} canRecord canDecide={false} />)
      await screen.findByTestId('kko-status')
      await userEvent.type(screen.getByLabelText('Cari gardu master'), 'HD00')
      const option = await screen.findByRole('option', { name: /HD0004/ })
      expect(option).toHaveTextContent('Taman Merdeka')                       // the search result shows the NAME of the gardu, not the GADIS number
      expect(option).not.toHaveTextContent('GD514530003')
      await userEvent.click(option)
      expect(screen.getByLabelText('Kode gardu')).toHaveValue('GD514530003')     // the form's code is the GADIS number
      expect(screen.getByLabelText('Nama gardu')).toHaveValue('HD0004 - Taman Merdeka')
    })

    it('P1b. memilih gardu mengisi arus per fasa, jurusan, tegangan pangkal RST dan saran tambahan beban; hasil dihitung seperti formulir kertas', async () => {
      substationsApi.list.mockResolvedValue({ data: [gardu({ capacity_kva: 250 })] })
      kkoApi.baseline = vi.fn().mockResolvedValue({
        data: {
          substation: { id: 'g1', code: 'HD0004', name: 'X', capacity_kva: 250 },
          reading: { current_r_a: 199, current_s_a: 200, current_t_a: 235, base_voltage_r_v: 235, base_voltage_s_v: 236, base_voltage_t_v: 236, feeders: [{ label: 'A', current_r_a: 125, current_s_a: 85, current_t_a: 112 }] },
          suggested_added: { r: 0, s: 50, t: 0 },
        },
      })
      kkoApi.record.mockResolvedValue({ data: { status: 'RECORDED', context, record: record(), events: [] } })
      render(<ApplicationKkoPanel application={app} canRecord canDecide={false} />)
      await screen.findByTestId('kko-status')
      await userEvent.type(screen.getByLabelText('Cari gardu master'), 'HD00')
      await userEvent.click(await screen.findByRole('option', { name: /HD0004/ }))
      await waitFor(() => expect(screen.getByTestId('kko-load-t')).toHaveValue(235))
      expect(screen.getByTestId('kko-base-s')).toHaveValue(236)
      expect(screen.getByTestId('kko-added-s')).toHaveValue(50)
      expect(screen.getByTestId('kko-existing-r')).toHaveValue(null)                            // manual
      expect(screen.getByTestId('kko-loading-before')).toHaveTextContent('66,55')
      expect(screen.getByTestId('kko-loading-after')).toHaveTextContent('70,8')
      await userEvent.type(screen.getByTestId('kko-existing-r'), '209')
      await userEvent.click(screen.getByRole('button', { name: /Simpan Hasil Survei KKO/ }))
      await waitFor(() => expect(kkoApi.record).toHaveBeenCalled())
      const body = kkoApi.record.mock.calls[0][1]
      expect(body.phase_detail.load).toEqual({ r: 199, s: 200, t: 235 })
      expect(body.phase_detail.existing_voltage.r).toBe(209)
      expect(body.phase_detail.jurusan[0]).toEqual({ name: 'A', r: 125, s: 85, t: 112 })
    })

    it('P2. pembacaan kedaluwarsa atau tanpa kVA diberi peringatan; beban dibiarkan kosong untuk diisi petugas', async () => {
      substationsApi.list.mockResolvedValue({ data: [gardu({ reading_status: 'STALE', reading: { measured_on: '2025-01-01', age_days: 400, load_kva: null, loading_pct: null, end_voltage_v: null } })] })
      render(<ApplicationKkoPanel application={app} canRecord canDecide={false} />)
      await screen.findByTestId('kko-status')
      await userEvent.type(screen.getByLabelText('Cari gardu master'), 'HD00')
      await userEvent.click(await screen.findByRole('option', { name: /HD0004/ }))
      expect(screen.getByTestId('kko-pick-note')).toHaveTextContent(/400 hari/)
      expect(screen.getByTestId('kko-pick-note')).toHaveTextContent(/tidak dapat dihitung/)
      expect(screen.getByLabelText('Beban terukur')).toHaveValue(null)
    })

    it('P3. melepas gardu menghapus substation_id dari isian', async () => {
      substationsApi.list.mockResolvedValue({ data: [gardu()] })
      render(<ApplicationKkoPanel application={app} canRecord canDecide={false} />)
      await screen.findByTestId('kko-status')
      await userEvent.type(screen.getByLabelText('Cari gardu master'), 'HD00')
      await userEvent.click(await screen.findByRole('option', { name: /HD0004/ }))
      await userEvent.click(screen.getByRole('button', { name: 'Lepas' }))
      expect(screen.queryByTestId('substation-picked')).not.toBeInTheDocument()
    })

    it('P4. menampilkan info tautan pelanggan sesuai customer_link dari respons server', async () => {
      // 1. linked
      kkoApi.record.mockResolvedValueOnce({
        data: { status: 'RECORDED', context, record: record(), events: [] },
        customer_link: { result: 'linked', idpel: '514530761001' },
      })
      const { unmount } = render(<ApplicationKkoPanel application={app} canRecord canDecide={false} />)
      await screen.findByTestId('kko-status')
      await userEvent.click(screen.getByRole('button', { name: /Simpan Hasil Survei KKO/ }))
      await waitFor(() => {
        expect(screen.getByText(/IDPEL 514530761001 ditautkan ke gardu ini/i)).toBeInTheDocument()
      })
      unmount()

      // 2. kept_manual
      kkoApi.record.mockResolvedValueOnce({
        data: { status: 'RECORDED', context, record: record(), events: [] },
        customer_link: { result: 'kept_manual', idpel: '514530761001' },
      })
      const r2 = render(<ApplicationKkoPanel application={app} canRecord canDecide={false} />)
      await r2.findByTestId('kko-status')
      await userEvent.click(r2.getByRole('button', { name: /Simpan Hasil Survei KKO/ }))
      await waitFor(() => {
        expect(r2.getByText(/Tautan pelanggan yang diperbaiki manual dipertahankan/i)).toBeInTheDocument()
      })
      r2.unmount()

      // 3. ambiguous_idpel
      kkoApi.record.mockResolvedValueOnce({
        data: { status: 'RECORDED', context, record: record(), events: [] },
        customer_link: { result: 'ambiguous_idpel' },
      })
      const r3 = render(<ApplicationKkoPanel application={app} canRecord canDecide={false} />)
      await r3.findByTestId('kko-status')
      await userEvent.click(r3.getByRole('button', { name: /Simpan Hasil Survei KKO/ }))
      await waitFor(() => {
        expect(r3.getByText(/Pemohon punya lebih dari satu IDPEL: tautkan manual di Master Pelanggan/i)).toBeInTheDocument()
      })
      r3.unmount()

      // 4. no_customer / null
      kkoApi.record.mockResolvedValueOnce({
        data: { status: 'RECORDED', context, record: record(), events: [] },
        customer_link: null,
      })
      const r4 = render(<ApplicationKkoPanel application={app} canRecord canDecide={false} />)
      await r4.findByTestId('kko-status')
      await userEvent.click(r4.getByRole('button', { name: /Simpan Hasil Survei KKO/ }))
      await waitFor(() => {
        expect(r4.getByText(/Hasil survei KKO tersimpan/i)).toBeInTheDocument()
        expect(r4.queryByTestId('kko-customer-link-info')).not.toBeInTheDocument()
      })
    })
  })
})
