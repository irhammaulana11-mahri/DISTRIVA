import { describe, it, expect } from 'vitest'
import { resolveProfiles, visibleForProfiles } from './profiles.js'
import { buildDashboard, completenessOf, funnelStages, formatRupiah } from './dashboardModel.js'

describe('resolveProfiles', () => {
  it('SYS_ADMIN (MFA) selalu admin', () => {
    expect(resolveProfiles({ can: { 'wo.create': true }, isSysAdmin: true })).toEqual(['admin'])
  })

  it('akun mitra tanpa kunci SPK internal = vendor', () => {
    expect(resolveProfiles({ can: { 'vendor.portal': true } })).toEqual(['vendor'])
  })

  it('memetakan kapabilitas pembeda ke profil', () => {
    expect(resolveProfiles({ can: { 'surveys.execute': true, 'reports.view': true } })).toEqual(['teknik'])
    expect(resolveProfiles({ can: { 'surveys.assign': true, 'rkm.submit': true } })).toEqual(['mulp'])
    expect(resolveProfiles({ can: { 'applications.create': true } })).toEqual(['niaga'])
    expect(resolveProfiles({ can: { 'wo.create': true, 'material_requests.manage': true } })).toEqual(['konstruksi'])
    expect(resolveProfiles({ can: { 'rkm.plan': true, 'kkf.run': true } })).toEqual(['perencanaan'])
    expect(resolveProfiles({ can: { 'wo.issue': true, 'bastp.close': true } })).toEqual(['executive'])
  })

  it('pengguna dengan beberapa peran mendapat beberapa profil, utama sesuai prioritas', () => {
    expect(resolveProfiles({ can: { 'surveys.execute': true, 'applications.create': true } })).toEqual(['teknik', 'niaga'])
  })

  it('UP3_ADMIN (kelola pengguna tanpa kunci operasional) = admin', () => {
    expect(resolveProfiles({ can: { 'users.view': true, 'applications.view': true } })).toEqual(['admin'])
  })

  it('tanpa peran operasional: viewer bila boleh melihat laporan/master data, selain itu general', () => {
    expect(resolveProfiles({ can: { 'master_data.view': true } })).toEqual(['viewer'])
    expect(resolveProfiles({ can: {} })).toEqual(['general'])
  })
})

describe('visibleForProfiles', () => {
  const item = { profiles: ['perencanaan'] }
  it('item tanpa daftar profil terlihat oleh semua', () => {
    expect(visibleForProfiles({}, ['teknik'])).toBe(true)
  })
  it('menyaring menurut profil; admin dan pemantau melihat semua', () => {
    expect(visibleForProfiles(item, ['teknik'])).toBe(false)
    expect(visibleForProfiles(item, ['teknik', 'perencanaan'])).toBe(true)
    expect(visibleForProfiles(item, ['admin'])).toBe(true)
    expect(visibleForProfiles(item, ['viewer'])).toBe(true)
  })
})

describe('buildDashboard', () => {
  const overview = {
    applications: { total: 50, by_status: { DRAFT: 3, SUBMITTED: 4, APPROVED: 10, PAID: 5, PK_PRINTED: 2 } },
    surveys: { by_status: { ACTIVE: 6 } },
    drawings: { latest_version_by_status: { SUBMITTED: 2, UNDER_REVIEW: 4, DRAFT: 1, RETURNED: 1 } },
    mto: { by_status: { DRAFT: 2, VERIFIED: 3, APPROVED: 9 } },
    rab: { applications_with_run: 5, total_value: 1500000 },
    kkf: { not_feasible: 1, extended_required: 2 },
    work_orders: { by_status: { SUBMITTED: 2, ISSUED: 3, IN_PROGRESS: 4 } },
    bastp: { by_status: { DRAFT: 1, RETURNED: 1, SUBMITTED: 2, ACCEPTED: 1 } },
    material_requests: { needs_followup: 7 },
  }
  const pipeline = [
    { applications: 20, with_survey: 8, drawing_approved: 5, mto_approved: 4, rab_run: 3, kkf_run: 3, wo_issued: 2, wo_completed: 1, bastp_closed: 1 },
    { applications: 30, with_survey: 7, drawing_approved: 3, mto_approved: 2, rab_run: 2, kkf_run: 2, wo_issued: 1, wo_completed: 1, bastp_closed: 0 },
  ]
  const val = (m, key) => m.kpis.find((k) => k.key === key)?.value

  it('MULP: perkiraan menunggu survei = disetujui/bayar/PK dikurangi yang sudah disurvei', () => {
    const m = buildDashboard('mulp', { overview, pipeline })
    expect(val(m, 'unsurveyed')).toBe(2) // 17 - 15
    expect(val(m, 'drawings')).toBe(2)
    expect(val(m, 'mto')).toBe(3)
    expect(val(m, 'bastp')).toBe(2)
  })

  it('Teknik: gambar draf+dikembalikan dan BASTP draf+dikembalikan', () => {
    const m = buildDashboard('teknik', { overview, pipeline })
    expect(val(m, 'drawings')).toBe(2)
    expect(val(m, 'bastp')).toBe(2)
  })

  it('Konstruksi: SPK dari daftar WO, tindak lanjut material dari overview', () => {
    const workOrders = [
      { id: '1', wo_number: 'WO-1', status: 'DRAFT' },
      { id: '2', wo_number: 'WO-2', status: 'ISSUED' },
      { id: '3', wo_number: 'WO-3', status: 'IN_PROGRESS' },
    ]
    const m = buildDashboard('konstruksi', { overview, pipeline, workOrders })
    expect(val(m, 'wo_draft')).toBe(1)
    expect(val(m, 'wo_active')).toBe(2)
    expect(val(m, 'mr')).toBe(7)
    expect(m.orders.map((o) => o.id)).toEqual(['2', '3'])
  })

  it('Vendor: hanya SPK miliknya, tanpa funnel', () => {
    const workOrders = [
      { id: '1', status: 'ISSUED' },
      { id: '2', status: 'IN_PROGRESS' },
      { id: '3', status: 'COMPLETED' },
    ]
    const m = buildDashboard('vendor', { workOrders })
    expect([val(m, 'issued'), val(m, 'progress'), val(m, 'done')]).toEqual([1, 1, 1])
    expect(m.funnel).toEqual([])
  })

  it('Niaga: kelengkapan nomor dari baris permohonan', () => {
    const apps = [
      { status: 'APPROVED', agenda_number: 'A1', register_number: 'R1', customer: { idpel: ['123'] } },
      { status: 'DRAFT', agenda_number: null, customer: {} },
      { status: 'CANCELLED', agenda_number: null, customer: {} },
    ]
    expect(completenessOf(apps)).toEqual({ checked: 2, noAgenda: 1, noRegister: 1, noIdpel: 1 })
    const m = buildDashboard('niaga', { overview, apps })
    expect(val(m, 'draft')).toBe(3)
    expect(m.actions.find((a) => a.key === 'agenda').count).toBe(1)
  })

  it('data tidak tersedia ditampilkan sebagai null, bukan 0', () => {
    const m = buildDashboard('mulp', {})
    expect(m.kpis.every((k) => k.value === null)).toBe(true)
  })

  it('funnel menjumlahkan semua ULP; rupiah diformat', () => {
    const f = funnelStages(pipeline)
    expect(f[0]).toMatchObject({ key: 'applications', value: 50 })
    expect(f.at(-1)).toMatchObject({ key: 'bastp_closed', value: 1 })
    expect(formatRupiah(1500000)).toBe('Rp 1.500.000')
    expect(formatRupiah(null)).toBe('–')
  })
})
