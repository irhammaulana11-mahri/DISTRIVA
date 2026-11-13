/**
 * Model dasbor per profil: murni (tanpa React) agar mudah diuji.
 * Sumber data = endpoint yang sudah ada: /reports/overview, /reports/pipeline, /work-orders, /material-requests,
 * /applications. Nilai `null` berarti data tidak tersedia (endpoint gagal / tidak berizin), tampil sebagai "–".
 */

const num = (v) => Number(v) || 0
const sum = (obj, keys) => keys.reduce((a, k) => a + num(obj?.[k]), 0)
const ELIGIBLE = ['APPROVED', 'PAID', 'PK_PRINTED']

export const formatRupiah = (v) =>
  v === null || v === undefined ? '–' : `Rp ${Math.round(num(v)).toLocaleString('id-ID')}`

function pipelineTotals(pipeline) {
  if (!Array.isArray(pipeline)) return null
  const t = {}
  for (const k of ['applications', 'with_survey', 'drawing_approved', 'mto_approved', 'rab_run', 'kkf_run', 'wo_issued', 'wo_completed', 'bastp_closed']) {
    t[k] = pipeline.reduce((a, r) => a + num(r[k]), 0)
  }
  return t
}

export function funnelStages(pipeline) {
  const t = pipelineTotals(pipeline)
  if (!t) return []
  return [
    { key: 'applications', label: 'Permohonan', value: t.applications },
    { key: 'with_survey', label: 'Disurvei', value: t.with_survey },
    { key: 'drawing_approved', label: 'Gambar disetujui', value: t.drawing_approved },
    { key: 'mto_approved', label: 'MTO disetujui', value: t.mto_approved },
    { key: 'rab_run', label: 'RAB dihitung', value: t.rab_run },
    { key: 'kkf_run', label: 'KKF dihitung', value: t.kkf_run },
    { key: 'wo_issued', label: 'SPK terbit', value: t.wo_issued },
    { key: 'wo_completed', label: 'SPK selesai', value: t.wo_completed },
    { key: 'bastp_closed', label: 'BASTP tutup', value: t.bastp_closed },
  ]
}

/** Ringkasan kelengkapan nomor pada daftar permohonan aktif (maks. halaman pertama yang dimuat). */
export function completenessOf(appRows) {
  if (!Array.isArray(appRows)) return null
  const hasIdpel = (a) =>
    Boolean(
      (Array.isArray(a.customer?.idpel) && a.customer.idpel.length > 0) ||
        (typeof a.customer?.idpel === 'string' && a.customer.idpel.trim()) ||
        a.idpel ||
        a.customer_idpel,
    )
  const hasAgenda = (a) => Boolean(a.agenda_number) && !a.missing_agenda
  const hasRegister = (a) => Boolean(a.register_number || a.payment_register_number)
  const rows = appRows.filter((a) => a.status !== 'CANCELLED')
  return {
    checked: rows.length,
    noAgenda: rows.filter((a) => !hasAgenda(a)).length,
    noRegister: rows.filter((a) => !hasRegister(a)).length,
    noIdpel: rows.filter((a) => !hasIdpel(a)).length,
  }
}

const kpi = (key, label, value, extra = {}) => ({ key, label, value: value ?? null, ...extra })

/** @returns {{kpis: object[], actions: object[], funnel: object[], orders: object[], notes: string[]}} */
export function buildDashboard(profile, data = {}) {
  const { overview, pipeline, workOrders, followup, apps } = data
  const byApp = overview?.applications?.by_status
  const by = (section, key = 'by_status') => overview?.[section]?.[key]
  const has = Boolean(overview)
  const t = pipelineTotals(pipeline)
  const eligible = has ? sum(byApp, ELIGIBLE) : null
  const unsurveyed = has && t ? Math.max(0, eligible - t.with_survey) : null

  const wos = Array.isArray(workOrders) ? workOrders : null
  const woCount = (statuses) => (wos ? wos.filter((o) => statuses.includes(o.status)).length : null)
  const activeOrders = wos ? wos.filter((o) => ['ISSUED', 'IN_PROGRESS'].includes(o.status)).slice(0, 6) : []

  const out = { kpis: [], actions: [], funnel: funnelStages(pipeline), orders: [], notes: [] }

  switch (profile) {
    case 'niaga': {
      const c = completenessOf(apps)
      out.kpis = [
        kpi('draft', 'Draf belum diajukan', has ? num(byApp?.DRAFT) : null, { to: '/permohonan', tone: 'amber' }),
        kpi('submitted', 'Diajukan, menunggu No. Agenda', has ? num(byApp?.SUBMITTED) : null, { to: '/permohonan' }),
        kpi('approved', 'Disetujui', has ? num(byApp?.APPROVED) : null, { to: '/permohonan' }),
        kpi('paid', 'Sudah bayar', has ? num(byApp?.PAID) : null, { to: '/permohonan' }),
        kpi('pk', 'Cetak PK', has ? num(byApp?.PK_PRINTED) : null, { to: '/permohonan' }),
      ]
      out.actions = c
        ? [
            { key: 'agenda', label: 'Permohonan belum punya No. Agenda', count: c.noAgenda, to: '/permohonan', desc: 'Lengkapi lewat sunting permohonan.' },
            { key: 'register', label: 'Permohonan belum punya No. Register', count: c.noRegister, to: '/permohonan', desc: 'Isi setelah pelanggan membayar.' },
            { key: 'idpel', label: 'Permohonan belum punya IDPEL', count: c.noIdpel, to: '/permohonan', desc: 'Isi setelah IDPEL terbit.' },
          ]
        : []
      if (c) out.notes.push(`Kelengkapan nomor dihitung dari ${c.checked} permohonan aktif yang dimuat (halaman pertama).`)
      break
    }
    case 'mulp':
      out.kpis = [
        kpi('unsurveyed', 'Permohonan menunggu survei (≈)', unsurveyed, { to: '/permohonan', tone: 'amber', hint: 'Disetujui/bayar/PK dikurangi yang sudah punya survei' }),
        kpi('surveys', 'Survei berjalan', has ? num(by('surveys')?.ACTIVE) : null, { to: '/permohonan' }),
        kpi('drawings', 'Gambar menunggu persetujuan Anda', has ? num(by('drawings', 'latest_version_by_status')?.SUBMITTED) : null, { to: '/permohonan', tone: 'amber' }),
        kpi('mto', 'MTO menunggu persetujuan Anda', has ? num(by('mto')?.VERIFIED) : null, { to: '/permohonan', tone: 'amber' }),
        kpi('bastp', 'BASTP menunggu diterima', has ? num(by('bastp')?.SUBMITTED) : null, { to: '/work-orders', tone: 'amber' }),
      ]
      out.actions = [
        { key: 'drawings', label: 'Gambar siap disetujui', count: has ? num(by('drawings', 'latest_version_by_status')?.SUBMITTED) : null, to: '/permohonan', desc: 'Buka permohonan → tab Gambar.' },
        { key: 'mto', label: 'MTO terverifikasi siap disetujui', count: has ? num(by('mto')?.VERIFIED) : null, to: '/permohonan', desc: 'Syarat persetujuan gambar.' },
        { key: 'bastp', label: 'BASTP diajukan, menunggu penerimaan', count: has ? num(by('bastp')?.SUBMITTED) : null, to: '/work-orders', desc: 'Terima atau kembalikan.' },
      ]
      break
    case 'teknik':
      out.kpis = [
        kpi('unsurveyed', 'Menunggu survei (≈)', unsurveyed, { to: '/permohonan', tone: 'amber', hint: 'Seluruh ULP Anda' }),
        kpi('surveys', 'Survei berjalan', has ? num(by('surveys')?.ACTIVE) : null, { to: '/permohonan' }),
        kpi('drawings', 'Gambar draf / dikembalikan', has ? sum(by('drawings', 'latest_version_by_status'), ['DRAFT', 'RETURNED']) : null, { to: '/permohonan', tone: 'amber' }),
        kpi('mto', 'MTO draf', has ? num(by('mto')?.DRAFT) : null, { to: '/permohonan' }),
        kpi('bastp', 'BASTP draf / dikembalikan', has ? sum(by('bastp'), ['DRAFT', 'RETURNED']) : null, { to: '/work-orders', tone: 'amber' }),
      ]
      out.actions = [
        { key: 'survey', label: 'Permohonan menunggu hasil survei', count: unsurveyed, to: '/permohonan', desc: 'Simpan hasil survei dan tandai kebutuhan gambar.' },
        { key: 'drawing', label: 'Gambar perlu diunggah / diperbaiki', count: has ? sum(by('drawings', 'latest_version_by_status'), ['DRAFT', 'RETURNED']) : null, to: '/permohonan', desc: 'Buka permohonan → tab Gambar.' },
        { key: 'bastp', label: 'BASTP perlu dilengkapi', count: has ? sum(by('bastp'), ['DRAFT', 'RETURNED']) : null, to: '/work-orders', desc: 'Lengkapi lalu ajukan ke Manager ULP.' },
      ]
      break
    case 'konstruksi':
      out.kpis = [
        kpi('wo_draft', 'SPK draf / dikembalikan', woCount(['DRAFT', 'RETURNED']), { to: '/work-orders', tone: 'amber' }),
        kpi('wo_submitted', 'SPK menunggu persetujuan Asman', woCount(['SUBMITTED']), { to: '/work-orders' }),
        kpi('wo_active', 'SPK berjalan', woCount(['ISSUED', 'IN_PROGRESS']), { to: '/work-orders' }),
        kpi('bastp', 'BASTP dalam proses', has ? sum(by('bastp'), ['SUBMITTED', 'ACCEPTED', 'SIGNED']) : null, { to: '/work-orders', tone: 'amber' }),
        kpi('mr', 'Permintaan material perlu tindak lanjut', has ? num(overview?.material_requests?.needs_followup) : null, { to: '/work-orders?filter=followup', tone: 'rose' }),
      ]
      out.actions = [
        { key: 'mr', label: 'Permintaan material perlu tindak lanjut', count: has ? num(overview?.material_requests?.needs_followup) : (followup?.meta?.total ?? null), to: '/work-orders?filter=followup', desc: 'Ekspor/kirim permintaan ke aplikasi material.' },
        { key: 'wo', label: 'SPK draf menunggu diajukan', count: woCount(['DRAFT', 'RETURNED']), to: '/work-orders', desc: 'Pilih mitra lalu ajukan ke Asman.' },
        { key: 'bastp', label: 'BASTP menunggu tanda tangan Konstruksi', count: has ? sum(by('bastp'), ['ACCEPTED']) : null, to: '/work-orders', desc: 'Setelah diterima Manager ULP.' },
      ]
      out.orders = activeOrders
      break
    case 'vendor':
      out.kpis = [
        kpi('issued', 'SPK diterima (belum dikerjakan)', woCount(['ISSUED']), { to: '/work-orders', tone: 'amber' }),
        kpi('progress', 'Dalam pengerjaan', woCount(['IN_PROGRESS']), { to: '/work-orders' }),
        kpi('done', 'Selesai', woCount(['COMPLETED']), { to: '/work-orders' }),
      ]
      out.actions = [
        { key: 'issued', label: 'SPK baru siap dikerjakan', count: woCount(['ISSUED']), to: '/work-orders', desc: 'Laporkan progres fisik dan unggah foto.' },
        { key: 'progress', label: 'SPK dalam pengerjaan', count: woCount(['IN_PROGRESS']), to: '/work-orders', desc: 'Perbarui progres dan susun BASTP.' },
      ]
      out.orders = activeOrders
      out.funnel = []
      break
    case 'perencanaan':
      out.kpis = [
        kpi('drawings', 'Gambar dalam review UP3', has ? num(by('drawings', 'latest_version_by_status')?.UNDER_REVIEW) : null, { to: '/permohonan', tone: 'amber' }),
        kpi('mto', 'MTO disetujui', has ? num(by('mto')?.APPROVED) : null, { to: '/permohonan' }),
        kpi('rab', 'Permohonan sudah dihitung RAB', has ? num(overview?.rab?.applications_with_run) : null, { to: '/permohonan' }),
        kpi('kkf_ng', 'KKF tidak layak', has ? num(overview?.kkf?.not_feasible) : null, { to: '/permohonan', tone: 'rose' }),
        kpi('kkf_ext', 'KKF butuh persetujuan diperluas', has ? num(overview?.kkf?.extended_required) : null, { to: '/permohonan', tone: 'amber' }),
      ]
      out.actions = [
        { key: 'drawings', label: 'Gambar menunggu review Perencanaan', count: has ? num(by('drawings', 'latest_version_by_status')?.UNDER_REVIEW) : null, to: '/permohonan', desc: 'Review bersama Konstruksi UP3.' },
        { key: 'rab', label: 'MTO disetujui, belum dihitung RAB', count: has ? Math.max(0, num(by('mto')?.APPROVED) - num(overview?.rab?.applications_with_run)) : null, to: '/permohonan', desc: 'Jalankan RAB lalu KKF.' },
        { key: 'mr', label: 'Permintaan material perlu tindak lanjut', count: has ? num(overview?.material_requests?.needs_followup) : null, to: '/work-orders?filter=followup', desc: 'Pantau kecukupan stok.' },
      ]
      break
    case 'executive':
      out.kpis = [
        kpi('apps', 'Total permohonan', has ? num(overview?.applications?.total) : null, { to: '/permohonan' }),
        kpi('review', 'Gambar dalam review / menunggu Asman', has ? num(by('drawings', 'latest_version_by_status')?.UNDER_REVIEW) : null, { to: '/permohonan', tone: 'amber' }),
        kpi('wo_submitted', 'SPK menunggu persetujuan', woCount(['SUBMITTED']) ?? (has ? num(by('work_orders')?.SUBMITTED) : null), { to: '/work-orders', tone: 'amber' }),
        kpi('wo_active', 'SPK berjalan', has ? sum(by('work_orders'), ['ISSUED', 'IN_PROGRESS']) : null, { to: '/work-orders' }),
        kpi('rab', 'Nilai RAB dihitung', has ? formatRupiah(overview?.rab?.total_value) : null, { to: '/reports' }),
        kpi('kkf_ng', 'KKF tidak layak', has ? num(overview?.kkf?.not_feasible) : null, { to: '/reports', tone: 'rose' }),
      ]
      out.actions = [
        { key: 'drawings', label: 'Gambar menunggu persetujuan UP3/Asman', count: has ? num(by('drawings', 'latest_version_by_status')?.UNDER_REVIEW) : null, to: '/permohonan', desc: 'Buka permohonan → tab Gambar.' },
        { key: 'wo', label: 'SPK menunggu persetujuan', count: has ? num(by('work_orders')?.SUBMITTED) : null, to: '/work-orders', desc: 'WO dan mitra diputuskan sekali.' },
        { key: 'bastp', label: 'BASTP dalam proses penutupan', count: has ? sum(by('bastp'), ['SUBMITTED', 'ACCEPTED', 'SIGNED']) : null, to: '/work-orders', desc: 'Tanda tangan elektronik berjenjang.' },
      ]
      break
    default:
      out.kpis = [
        kpi('apps', 'Total permohonan', has ? num(overview?.applications?.total) : null, { to: '/permohonan' }),
        kpi('wo_active', 'SPK berjalan', has ? sum(by('work_orders'), ['ISSUED', 'IN_PROGRESS']) : null),
        kpi('bastp', 'BASTP tutup', t ? t.bastp_closed : null),
      ]
  }
  return out
}
