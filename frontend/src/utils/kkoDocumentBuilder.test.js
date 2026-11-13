import { describe, it, expect } from 'vitest'
import { buildKkoDocument } from './kkoDocumentBuilder.js'

describe('kkoDocumentBuilder (docs/82 §12 & gambar usulan)', () => {
  const mockKko = {
    record: {
      id: 'kko-101',
      substation_code: 'GD514530354',
      substation_name: 'HD0050 - JL GATOT SUBROTO',
      transformer_capacity_kva: 250,
      measured_load_kva: 166.38,
      measured_at: '2026-11-10',
      voltage_location_v: 221,
      decision: 'LAYAK',
      class_before: 'NORMAL',
      class_after: 'NORMAL',
      phase_detail: {
        gtt: { jurusan_count: 2, jurusan_length_km: 1.5, distance_gtt_km: 0.2, conductor: 'AAAC' },
        load: { r: 280, s: 269, t: 241 },
        base_voltage: { r: 224, s: 224, t: 225 },
        existing_voltage: { r: 221, s: 221, t: 221 },
        plan: {
          sutm_km: '',
          mvtic_km: '',
          xlpe_km: '',
          trafo_mgmt_set: '',
          gtt_sisipan_bh: '',
          sutr_km: '',
          rehab_sutr_km: '',
        },
        added: { r: 9.6, s: 9.6, t: 9.6 },
        after_existing_voltage: { r: 218, s: 218, t: 218 },
      },
    },
  }

  const mockProposal = {
    proposal_number: '00001/USULAN-PBPD/10-11/51453/2026',
    title: 'Usulan Pelanggan Jombang',
    members: [
      {
        customer_name: 'BUDI HARIYANTO',
        application_number: 'PBPD-51453-2026-00326',
        tariff_code: 'R1',
        power_va: 6600,
        application_type: 'PB',
      },
    ],
  }

  it('1. mengekstrak rencana pengembangan jaringan langsung dari item MTO gambar usulan', () => {
    const mockMto = {
      package_number: 'MTO-PBPD-51453-2026-00326-V1',
      items: [
        {
          group: 'SUTR',
          construction_code: 'SUTR-01',
          construction_label: 'SUTR (NFA2X-T;4X70)',
          psg: 110,
          bkr: 0,
        },
        {
          group: 'SUTR',
          construction_code: 'SUTR-02',
          construction_label: 'Tibet 9 / 200',
          psg: 3,
          bkr: 0,
        },
      ],
    }

    const doc = buildKkoDocument({
      kko: mockKko,
      proposal: mockProposal,
      mtoPackage: mockMto,
    })

    expect(doc.title).toBe('KAJIAN KELAYAKAN OPERASI (KKO)')
    expect(doc.conclusion).toBe('LAYAK')

    const sec3 = doc.sections.find((s) => s.heading.includes('RENCANA PENGEMBANGAN JARINGAN'))
    expect(sec3).toBeDefined()

    const pairsMap = Object.fromEntries(sec3.pairs)
    // SUTR 110 meter = 0,11 kms (110 m)
    expect(pairsMap['Penambahan Jaringan SUTR']).toContain('0,11 kms')
    expect(pairsMap['Penambahan Jaringan SUTR']).toContain('110 m')

    // SUTM tidak ada di gambar -> 0 kms
    expect(pairsMap['Penambahan Jaringan SUTM']).toBe('0 kms')

    // Rujukan paket gambar tercantum
    expect(pairsMap['Rujukan Gambar Usulan']).toContain('MTO-PBPD-51453-2026-00326-V1')
    expect(pairsMap['Rincian Konstruksi Terpasang']).toContain('SUTR-01')
  })

  it('2. jika belum ada gambar usulan, kembali ke nilai default 0 kms', () => {
    const doc = buildKkoDocument({
      kko: mockKko,
      proposal: mockProposal,
      mtoPackage: null,
    })

    const sec3 = doc.sections.find((s) => s.heading.includes('RENCANA PENGEMBANGAN JARINGAN'))
    const pairsMap = Object.fromEntries(sec3.pairs)
    expect(pairsMap['Penambahan Jaringan SUTR']).toBe('0 kms')
    expect(pairsMap['Penambahan Jaringan SUTM']).toBe('0 kms')
  })

  it('3. data pelanggan, lokasi, ULP, dan tarif/daya terisi lengkap seperti halnya KKF', () => {
    const mockApp = {
      id: 'app-326',
      application_number: 'PBPD-51453-2026-00326',
      service_address: 'Jl. Gatot Subroto No. 45, Jombang',
      new_tariff_code: 'R1',
      new_power_value: 6600,
      new_power_unit: 'VA',
      transaction_type: 'PASANG BARU',
      customer: {
        name: 'BUDI HARIYANTO',
        idpel: '514532072783',
      },
      unit: {
        name: 'ULP Jombang',
      },
    }

    const doc = buildKkoDocument({
      kko: mockKko,
      application: mockApp,
      proposal: mockProposal,
    })

    const metaMap = Object.fromEntries(doc.meta)
    expect(metaMap['NAMA PELANGGAN']).toBe('BUDI HARIYANTO')
    expect(metaMap['LOKASI']).toBe('Jl. Gatot Subroto No. 45, Jombang')
    expect(metaMap['ULP']).toBe('ULP JOMBANG')
    expect(metaMap['NO. PERMOHONAN']).toBe('PBPD-51453-2026-00326')
    expect(metaMap['TARIF / DAYA']).toBe('R1 / 6.600 VA')
    expect(metaMap['IDPEL']).toBe('514532072783')

    const sec1 = doc.sections.find((s) => s.heading.includes('1. DATA PEKERJAAN'))
    const p1Map = Object.fromEntries(sec1.pairs)
    expect(p1Map['Tarif / Daya']).toBe('R1 / 6.600 VA')
    expect(p1Map['Lokasi Sambungan']).toBe('Jl. Gatot Subroto No. 45, Jombang')
    expect(p1Map['Unit Layanan Pelanggan (ULP)']).toBe('ULP JOMBANG')
  })

  it('4. usulan dengan banyak pelanggan menampilkan tabel daftar anggota usulan', () => {
    const multiProposal = {
      ...mockProposal,
      members: [
        {
          customer_name: 'BUDI HARIYANTO',
          application_number: 'PBPD-51453-2026-00326',
          tariff: 'R1',
          power: 6600,
          idpel: '514532072783',
          is_representative: true,
        },
        {
          customer_name: 'SITI AMINAH',
          application_number: 'PBPD-51453-2026-00327',
          tariff: 'R1',
          power: 6600,
          idpel: '514532072784',
          is_representative: false,
        },
      ],
    }

    const doc = buildKkoDocument({
      kko: mockKko,
      proposal: multiProposal,
    })

    const memberSec = doc.sections.find((s) => s.heading.includes('PELANGGAN DALAM USULAN'))
    expect(memberSec).toBeDefined()
    expect(memberSec.rows.length).toBe(2)
    expect(memberSec.rows[0][2]).toBe('BUDI HARIYANTO')
    expect(memberSec.rows[1][2]).toBe('SITI AMINAH')
  })
})
