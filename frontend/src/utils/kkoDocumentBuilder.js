import { phaseResult } from './kkoPhase.js'

/**
 * Ekstraksi rencana pengembangan jaringan langsung dari data paket gambar usulan & MTO.
 */
function extractPlanFromDrawing({ mtoPackage, drawing, kkoPlan }) {
  const items = mtoPackage?.items || []

  // Helper pencari panjang konduktor (dalam meter)
  const getConductorMeters = (groupCodes) => {
    const codes = Array.isArray(groupCodes) ? groupCodes : [groupCodes]
    const matched = items.filter((i) => codes.includes((i.group || '').toUpperCase()))
    if (!matched.length) return 0

    // Cari item kabel/konduktor utama
    const cable = matched.find((i) => {
      const c = (i.construction_code || '').toUpperCase()
      const l = (i.construction_label || '').toUpperCase()
      return (
        c.includes('-01') ||
        c.includes('KBL') ||
        c.includes('KABEL') ||
        l.includes('NFA2X') ||
        l.includes('AAAC') ||
        l.includes('XLPE') ||
        l.includes('TIC') ||
        l.includes('KABEL')
      )
    })

    if (cable && Number(cable.psg) > 0) {
      return Number(cable.psg)
    }

    // Jika tidak ada nama spesifik kabel, ambil nilai psg terbesar di grup saluran tersebut
    return Math.max(0, ...matched.map((i) => Number(i.psg) || 0))
  }

  // Helper pencari unit (bh / set)
  const getUnitCount = (groupCodes) => {
    const codes = Array.isArray(groupCodes) ? groupCodes : [groupCodes]
    const matched = items.filter((i) => codes.includes((i.group || '').toUpperCase()))
    return matched.reduce((sum, i) => sum + (Number(i.psg) || 0), 0)
  }

  // Helper pencari volume bongkar/rehabilitasi SUTR
  const getRehabMeters = () => {
    const sutrItems = items.filter((i) => (i.group || '').toUpperCase() === 'SUTR')
    const cableBkr = sutrItems.find((i) => {
      const c = (i.construction_code || '').toUpperCase()
      const l = (i.construction_label || '').toUpperCase()
      return c.includes('-01') || l.includes('NFA2X') || l.includes('KABEL')
    })
    if (cableBkr && Number(cableBkr.bkr) > 0) return Number(cableBkr.bkr)
    return sutrItems.reduce((sum, i) => sum + (Number(i.bkr) || 0), 0)
  }

  const sutmMeters = getConductorMeters(['SUTM'])
  const mvticMeters = getConductorMeters(['MVTIC'])
  const xlpeMeters = getConductorMeters(['SKTM'])
  const sutrMeters = getConductorMeters(['SUTR'])
  const gttUnits = getUnitCount(['GTT_UMUM', 'GTT_KHUSUS'])
  const mgmtUnits = getUnitCount(['KUBIKEL'])
  const rehabMeters = getRehabMeters()

  const formatDistance = (meters, fallbackKms = 0) => {
    if (meters > 0) {
      const kms = meters / 1000
      return `${kms.toLocaleString('id-ID', { maximumFractionDigits: 3 })} kms (${meters.toLocaleString('id-ID')} m)`
    }
    if (fallbackKms > 0) {
      return `${Number(fallbackKms).toLocaleString('id-ID', { maximumFractionDigits: 3 })} kms`
    }
    return '0 kms'
  }

  const formatCount = (count, unit, fallback = 0) => {
    if (count > 0) return `${count.toLocaleString('id-ID')} ${unit}`
    if (fallback > 0) return `${Number(fallback).toLocaleString('id-ID')} ${unit}`
    return `0 ${unit}`
  }

  // Rangkum item konstruksi terpasang di gambar
  const activeItems = items.filter((i) => Number(i.psg) > 0)
  const itemsSummary = activeItems.length > 0
    ? activeItems.map((i) => `${i.construction_code || ''} ${i.construction_label ? `(${i.construction_label})` : ''}: ${i.psg}`).join('; ')
    : null

  const drawingRef =
    drawing?.drawing_number ||
    (mtoPackage?.package_number ? `Paket MTO #${mtoPackage.package_number}` : null) ||
    'Gambar Teknik Usulan'

  return {
    sutm: formatDistance(sutmMeters, kkoPlan?.sutm_km),
    mvtic: formatDistance(mvticMeters, kkoPlan?.mvtic_km),
    xlpe: formatDistance(xlpeMeters, kkoPlan?.xlpe_km),
    mgmt: formatCount(mgmtUnits, 'set', kkoPlan?.trafo_mgmt_set),
    gtt: formatCount(gttUnits, 'bh', kkoPlan?.gtt_sisipan_bh),
    sutr: formatDistance(sutrMeters, kkoPlan?.sutr_km),
    rehab: formatDistance(rehabMeters, kkoPlan?.rehab_sutr_km),
    drawingRef,
    itemsSummary,
    hasDrawingItems: activeItems.length > 0,
  }
}

/**
 * Membangun objek dokumen KKO resmi untuk OutputDocumentModal
 * berdasarkan data KKO tersimpan (docs/62 §51 & docs/82 §12)
 * dan rencana pengembangan jaringan dari gambar usulan (MTO).
 */
export function buildKkoDocument({ kko, application, proposal, run, mtoPackage, drawing }) {
  const rec = kko?.record || {}
  const pd = rec?.phase_detail || {}
  const gtt = pd?.gtt || {}
  const load = pd?.load || {}
  const bVolt = pd?.base_voltage || {}
  const eVolt = pd?.existing_voltage || {}
  const plan = pd?.plan || {}
  const added = pd?.added || {}
  const afterVolt = pd?.after_existing_voltage || {}
  const pResult = rec?.phase_result || phaseResult(pd, rec?.transformer_capacity_kva)

  // Ekstraksi rencana pengembangan jaringan dari gambar usulan
  const drawingPlan = extractPlanFromDrawing({
    mtoPackage,
    drawing,
    kkoPlan: plan,
  })

  // Ekstraksi data pelanggan & usulan (seperti halnya KKF)
  const allMembers = proposal?.members || run?.sources?.members || []
  const repMember =
    allMembers.find((m) => m.is_representative) ||
    allMembers[0] ||
    null

  const custName =
    application?.customer?.name ||
    repMember?.customer_name ||
    proposal?.title ||
    'Pelanggan'

  const appNum =
    application?.application_number ||
    repMember?.application_number ||
    proposal?.representative_number ||
    proposal?.proposal_number ||
    '-'

  const rawType =
    application?.transaction_type ||
    application?.application_type ||
    repMember?.application_type ||
    'PB'
  const transType =
    rawType === 'PB' || String(rawType).toUpperCase().includes('BARU')
      ? 'PASANG BARU'
      : rawType === 'PD' || String(rawType).toUpperCase().includes('DAYA')
        ? 'PERUBAHAN DAYA'
        : String(rawType)

  const tariff =
    application?.new_tariff_code ||
    repMember?.tariff ||
    repMember?.tariff_code ||
    ''

  const powerVal =
    application?.new_power_value ??
    repMember?.power ??
    repMember?.power_va ??
    (repMember?.delta_power_kva ? repMember.delta_power_kva * 1000 : null) ??
    (kko?.context?.new_power_kva ? kko.context.new_power_kva * 1000 : null)

  const powerUnit = application?.new_power_unit || repMember?.power_unit || 'VA'

  let powerText = '-'
  if (powerVal != null && Number(powerVal) > 0) {
    const formattedPower = `${Number(powerVal).toLocaleString('id-ID')} ${powerUnit}`
    powerText = tariff ? `${tariff} / ${formattedPower}` : formattedPower
  } else if (tariff) {
    powerText = tariff
  }

  const idpel =
    application?.customer?.idpel ||
    application?.idpel ||
    repMember?.idpel ||
    (Array.isArray(application?.customer?.idpel) ? application.customer.idpel[0] : null) ||
    null

  let address =
    application?.service_address ||
    repMember?.service_address ||
    proposal?.service_address ||
    null
  if (!address || address === '-') {
    if (kko?.record?.substation_name) {
      address = `Wilayah Gardu ${kko.record.substation_code || ''} (${kko.record.substation_name})`
    } else {
      address = 'Wilayah Kerja ULP'
    }
  }

  let rawUlp =
    application?.unit?.name ||
    application?.ulp_name ||
    proposal?.ulp_name ||
    null
  if (!rawUlp || rawUlp.trim().toUpperCase() === 'ULP') {
    if (proposal?.ulp_unit_id || (typeof appNum === 'string' && appNum.includes('51453'))) {
      rawUlp = 'ULP JOMBANG'
    } else {
      rawUlp = 'ULP'
    }
  }
  const ulpDisplay = rawUlp.toUpperCase().startsWith('ULP') ? rawUlp.toUpperCase() : `ULP ${rawUlp.toUpperCase()}`

  const fmt = (v, d = 2) =>
    v === null || v === undefined || v === '' ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d })

  const loadingBefore = pResult?.before?.loading_pct ?? rec?.loading_before_pct
  const loadingAfter = pResult?.after?.loading_pct ?? rec?.loading_after_pct
  const imbalanceBefore = pResult?.before?.imbalance_pct
  const imbalanceAfter = pResult?.after?.imbalance_pct

  const planPairs = [
    ['Penambahan Jaringan SUTM', drawingPlan.sutm],
    ['Penambahan Jaringan MVTIC', drawingPlan.mvtic],
    ['Penambahan Jaringan XLPE', drawingPlan.xlpe],
    ['Manajemen Trafo', drawingPlan.mgmt],
    ['Penambahan GTT Sisipan', drawingPlan.gtt],
    ['Penambahan Jaringan SUTR', drawingPlan.sutr],
    ['Rehabilitasi Jaringan SUTR', drawingPlan.rehab],
  ]

  if (drawingPlan.drawingRef) {
    planPairs.push(['Rujukan Gambar Usulan', drawingPlan.drawingRef])
  }
  if (drawingPlan.itemsSummary) {
    planPairs.push(['Rincian Konstruksi Terpasang', drawingPlan.itemsSummary])
  }

  const metaItems = [
    ['NAMA PELANGGAN', custName],
    ['LOKASI', address],
    ['ULP', ulpDisplay],
    ['NO. PERMOHONAN', appNum],
    ['TARIF / DAYA', powerText],
    ['STATUS KKO', rec?.decision || 'LAYAK'],
  ]
  if (idpel && idpel !== '-') {
    metaItems.push(['IDPEL', idpel])
  }

  const dataPekerjaanPairs = [
    ['Nama Pelanggan', custName],
    ['Nomor Permohonan / Usulan', appNum],
    ['Jenis Pengajuan', transType],
    ['Tarif / Daya', powerText],
    ['Lokasi Sambungan', address],
    ['Unit Layanan Pelanggan (ULP)', ulpDisplay],
  ]
  if (idpel && idpel !== '-') {
    dataPekerjaanPairs.push(['IDPEL Pelanggan', idpel])
  }
  if (allMembers.length > 1) {
    dataPekerjaanPairs.push(['Kelompok Usulan', `${allMembers.length} Pelanggan (Pelanggan Utama: ${custName})`])
  }

  const memberSection = allMembers.length > 1 ? [{
    heading: 'PELANGGAN DALAM USULAN',
    columns: ['NO', 'NO. PERMOHONAN', 'NAMA PELANGGAN', 'IDPEL', 'TARIF', 'DAYA (VA)'],
    rows: allMembers.map((m, i) => [
      i + 1,
      m.application_number || '-',
      m.customer_name || '-',
      m.idpel || '-',
      m.tariff || m.tariff_code || '-',
      `${Number(m.power || m.power_va || (m.delta_power_kva ? m.delta_power_kva * 1000 : 0)).toLocaleString('id-ID')}`,
    ]),
  }] : []

  return {
    title: 'KAJIAN KELAYAKAN OPERASI (KKO)',
    document_number: rec?.id ? `KKO-${rec.id.slice(0, 8).toUpperCase()}` : run?.document_number || null,
    header: [
      'PT PLN (PERSERO)',
      'DISTRIBUSI JAWA TIMUR',
      ulpDisplay,
    ],
    meta: metaItems,
    conclusion: rec?.decision || (rec?.voltage_low ? 'TIDAK LAYAK' : 'LAYAK'),
    sections: [
      {
        heading: '1. DATA PEKERJAAN',
        pairs: dataPekerjaanPairs,
      },
      ...memberSection,
      {
        heading: '2. KONDISI GTT EKSISTING (SEBELUM PENAMBAHAN BEBAN)',
        pairs: [
          ['Nomor Gardu (GTT)', rec?.substation_code || '-'],
          ['Nama Gardu / Lokasi', rec?.substation_name || '-'],
          ['Kapasitas Trafo', rec?.transformer_capacity_kva ? `${fmt(rec.transformer_capacity_kva, 0)} kVA` : '-'],
          ['Jurusan', `${gtt.jurusan_count || '-'} Jurusan · Panjang: ${gtt.jurusan_length_km || '-'} kms`],
          ['Penghantar & Jarak GTT', `${gtt.conductor || '-'} · Jarak: ${gtt.distance_gtt_km || '-'} kms`],
          ['Beban Total Arus R · S · T', `R: ${load.r || '-'} A · S: ${load.s || '-'} A · T: ${load.t || '-'} A`],
          ['Tegangan Pangkal Gardu R · S · T', `R: ${bVolt.r || '-'} V · S: ${bVolt.s || '-'} V · T: ${bVolt.t || '-'} V`],
          ['Tegangan Eksisting Pelanggan R · S · T', `R: ${eVolt.r || '-'} V · S: ${eVolt.s || '-'} V · T: ${eVolt.t || '-'} V`],
          ['Persentase Beban Trafo (Sebelum)', `${fmt(loadingBefore)} % (${rec?.class_before || 'NORMAL'})`],
          ['Ketidakseimbangan Beban (Sebelum)', `${fmt(imbalanceBefore)} %`],
        ],
      },
      {
        heading: '3. RENCANA PENGEMBANGAN JARINGAN (BILA DIPERLUKAN)',
        pairs: planPairs,
      },
      {
        heading: '4. KONDISI SETELAH OPERASI (SIMULASI BEBAN BARU)',
        pairs: [
          ['Tambahan Arus Beban Baru R · S · T', `R: ${added.r || 0} A · S: ${added.s || 0} A · T: ${added.t || 0} A`],
          ['Beban Total Arus Sesudah R · S · T', pResult?.after?.loads ? `R: ${fmt(pResult.after.loads.r)} A · S: ${fmt(pResult.after.loads.s)} A · T: ${fmt(pResult.after.loads.t)} A` : '-'],
          ['Tegangan Eksisting Sesudah R · S · T', `R: ${afterVolt.r || '-'} V · S: ${afterVolt.s || '-'} V · T: ${afterVolt.t || '-'} V`],
          ['Persentase Beban Trafo (Sesudah)', `${fmt(loadingAfter)} % (${rec?.class_after || 'NORMAL'})`],
          ['Ketidakseimbangan Beban (Sesudah)', `${fmt(imbalanceAfter)} %`],
          ['Tegangan Lokasi Pelanggan Terukur', `${fmt(rec?.voltage_location_v)} V ${rec?.voltage_low ? '(Di bawah ambang 198 V)' : '(Memenuhi)'}`],
        ],
      },
      {
        heading: '5. KESIMPULAN & KEPUTUSAN TEKNIK',
        pairs: [
          ['Keputusan Kelayakan Operasi', rec?.decision || 'LAYAK'],
          ['Catatan / Alasan', rec?.decision_notes || '-'],
          ['Usulan Perbaikan', rec?.improvement_proposal || '-'],
        ],
      },
    ],
    place_date: `${ulpDisplay}, ${rec?.measured_at || new Date().toISOString().slice(0, 10)}`,
    signatures: [
      { title: 'SURVEYOR / PENCATAT KKO', name: rec?.recorded_by_name || 'Petugas Survei' },
      { title: 'SPV TEKNIK / PEJABAT PEMUTUS', name: rec?.decided_by_name || 'Spv Teknik ULP' },
    ],
  }
}

