import { PHASES, phaseResult } from '../../utils/kkoPhase.js'

const cell = 'w-full px-2 py-1 text-base sm:text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-right'
const th = 'px-2 py-1.5 text-left text-[11px] font-bold text-slate-600 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/60'
const fmt = (v, d = 2) => (v === null || v === undefined ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d }))

export const emptyPhase = () => ({
  gtt: { jurusan_count: '', jurusan_length_km: '', conductor: '', loading_pattern: '', distance_gtt_km: '' },
  load: { r: '', s: '', t: '' },
  jurusan: [],
  base_voltage: { r: '', s: '', t: '' },
  existing_voltage: { r: '', s: '', t: '' },
  plan: { sutm_km: '', mvtic_km: '', xlpe_km: '', trafo_mgmt_set: '', gtt_sisipan_bh: '', sutr_km: '', rehab_sutr_km: '' },
  added: { r: '', s: '', t: '' },
  after_existing_voltage: { r: '', s: '', t: '' },
  notes: '',
})

/** Nilai dari record server (angka/null) menjadi isian formulir (string). */
export function phaseFrom(pd) {
  const base = emptyPhase()
  if (!pd) return base
  const s = (v) => (v === null || v === undefined ? '' : String(v))
  const grp = (o, keys) => Object.fromEntries(keys.map((k) => [k, s(o?.[k])]))
  return {
    gtt: grp(pd.gtt, Object.keys(base.gtt)),
    load: grp(pd.load, PHASES),
    jurusan: (pd.jurusan || []).map((j) => ({ name: j.name || '', ...grp(j, PHASES) })),
    base_voltage: grp(pd.base_voltage, PHASES),
    existing_voltage: grp(pd.existing_voltage, PHASES),
    plan: grp(pd.plan, Object.keys(base.plan)),
    added: grp(pd.added, PHASES),
    after_existing_voltage: grp(pd.after_existing_voltage, PHASES),
    notes: pd.notes || '',
  }
}

/** Isian terisi saja; kosong → null. Mengembalikan null bila tidak ada satu pun angka. */
export function phaseBody(p) {
  const n = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
  const grp = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, n(v)]))
  const any = [p.load, p.base_voltage, p.existing_voltage, p.added, p.plan].some((o) => Object.values(o).some((v) => v !== ''))
  if (!any && !p.jurusan.length) return null
  return {
    gtt: { ...grp({ jurusan_count: p.gtt.jurusan_count, jurusan_length_km: p.gtt.jurusan_length_km, distance_gtt_km: p.gtt.distance_gtt_km }), conductor: p.gtt.conductor || null, loading_pattern: p.gtt.loading_pattern || null },
    load: grp(p.load),
    jurusan: p.jurusan.map((j) => ({ name: j.name || null, ...grp({ r: j.r, s: j.s, t: j.t }) })),
    base_voltage: grp(p.base_voltage),
    existing_voltage: grp(p.existing_voltage),
    plan: grp(p.plan),
    added: grp(p.added),
    after_existing_voltage: grp(p.after_existing_voltage),
    notes: p.notes || null,
  }
}

function PhaseRow({ label, unit, value, onChange, readOnly, testId }) {
  return (
    <tr>
      <td className="px-2 py-1 text-xs align-middle">{label}</td>
      {PHASES.map((k) => (
        <td key={k} className="px-1 py-1 w-24">
          <div className="flex items-center gap-1">
            <span className="text-[10px] uppercase text-slate-400 w-3">{k}</span>
            {readOnly ? (
              <span className="text-xs font-semibold flex-1 text-right">{value?.[k] === '' || value?.[k] == null ? '-' : value[k]}</span>
            ) : (
              <input aria-label={`${label} ${k.toUpperCase()}`} data-testid={testId ? `${testId}-${k}` : undefined} type="number" step="any" min="0" className={cell} value={value?.[k] ?? ''} onChange={(e) => onChange(k, e.target.value)} />
            )}
          </div>
        </td>
      ))}
      <td className="px-2 py-1 text-[11px] text-slate-500">{unit}</td>
    </tr>
  )
}

/**
 * Formulir KKO seperti kertas (docs/82 §12): 1 Data pekerjaan · 2 Kondisi GTT eksisting · 3 Rencana · 4 Kondisi setelah operasi.
 * Data gardu (arus per fasa dan jurusan, tegangan pangkal) terisi otomatis dari master gardu; tegangan eksisting pelanggan diisi manual.
 */
export default function KkoPhaseForm({ value, onChange, readOnly = false, application, substationCode, capacity }) {
  const p = value
  const res = phaseResult(phaseBody(p) || {}, capacity)
  const setGroup = (g) => (k, v) => onChange({ ...p, [g]: { ...p[g], [k]: v } })
  const setGtt = (k) => (e) => onChange({ ...p, gtt: { ...p.gtt, [k]: e.target.value } })
  const setJ = (i, k, v) => onChange({ ...p, jurusan: p.jurusan.map((j, idx) => (idx === i ? { ...j, [k]: v } : j)) })
  const unitLabel = application?.unit?.name || ''
  const power = application?.new_power_value != null ? `${Number(application.new_power_value).toLocaleString('id-ID')} ${application.new_power_unit || 'VA'}` : '-'

  const resultRow = (testId, label, b, unit) => (
    <tr className="bg-slate-50/60 dark:bg-slate-800/40">
      <td className="px-2 py-1 text-xs font-semibold">{label}</td>
      <td colSpan={3} className="px-2 py-1 text-xs text-right font-bold" data-testid={testId}>{b ?? '-'}</td>
      <td className="px-2 py-1 text-[11px] text-slate-500">{unit}</td>
    </tr>
  )

  return (
    <div className="space-y-4" data-testid="kko-phase-form">
      <section className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <h5 className={th}>1. Data pekerjaan</h5>
        <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-1 px-3 py-2 text-xs">
          <div><dt className="inline text-slate-500">Nama: </dt><dd className="inline font-semibold">{application?.customer?.name || '-'}</dd></div>
          <div><dt className="inline text-slate-500">Jenis pengajuan: </dt><dd className="inline font-semibold">{application?.transaction_type || application?.application_type || '-'}</dd></div>
          <div><dt className="inline text-slate-500">Tarif / daya: </dt><dd className="inline font-semibold">{application?.new_tariff_code || '-'} · {power}</dd></div>
          <div><dt className="inline text-slate-500">Lokasi: </dt><dd className="inline font-semibold">{application?.service_address || '-'}</dd></div>
          <div><dt className="inline text-slate-500">ULP: </dt><dd className="inline font-semibold">{unitLabel || '-'}</dd></div>
        </dl>
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
        <h5 className={th}>2. Kondisi GTT eksisting (sebelum penambahan)</h5>
        <table className="w-full text-xs">
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            <tr><td className="px-2 py-1">Nomor GTT</td><td colSpan={3} className="px-2 py-1 font-semibold text-right">{substationCode || '-'}</td><td /></tr>
            <tr><td className="px-2 py-1">kVA</td><td colSpan={3} className="px-2 py-1 font-semibold text-right">{fmt(capacity, 0)}</td><td className="px-2 text-[11px] text-slate-500">kVA</td></tr>
            <tr>
              <td className="px-2 py-1">Jurusan</td>
              <td colSpan={3} className="px-1 py-1">{readOnly ? <span className="block text-right font-semibold">{p.gtt.jurusan_count || '-'}</span> : <input aria-label="Jumlah jurusan" type="number" min="0" className={cell} value={p.gtt.jurusan_count} onChange={setGtt('jurusan_count')} />}</td><td />
            </tr>
            <tr>
              <td className="px-2 py-1">Panjang jurusan</td>
              <td colSpan={3} className="px-1 py-1">{readOnly ? <span className="block text-right font-semibold">{p.gtt.jurusan_length_km || '-'}</span> : <input aria-label="Panjang jurusan" type="number" step="any" min="0" className={cell} value={p.gtt.jurusan_length_km} onChange={setGtt('jurusan_length_km')} />}</td>
              <td className="px-2 text-[11px] text-slate-500">kms</td>
            </tr>
            <PhaseRow label="Beban total" unit="A" value={p.load} onChange={setGroup('load')} readOnly={readOnly} testId="kko-load" />
            {p.jurusan.map((j, i) => (
              <PhaseRow key={i} label={`Beban jurusan ${j.name || i + 1}`} unit="A" value={j} onChange={(k, v) => setJ(i, k, v)} readOnly={readOnly} />
            ))}
            <tr>
              <td className="px-2 py-1">Penghantar</td>
              <td colSpan={3} className="px-1 py-1">{readOnly ? <span className="block text-right font-semibold">{p.gtt.conductor || '-'}</span> : <input aria-label="Penghantar" className={cell} placeholder="BDC 4x70" value={p.gtt.conductor} onChange={setGtt('conductor')} />}</td>
              <td className="px-2 text-[11px] text-slate-500">mm²</td>
            </tr>
            <tr>
              <td className="px-2 py-1">Pembebanan</td>
              <td colSpan={3} className="px-1 py-1">{readOnly ? <span className="block text-right font-semibold">{p.gtt.loading_pattern || '-'}</span> : <input aria-label="Pola pembebanan" className={cell} placeholder="Merata dan seimbang" value={p.gtt.loading_pattern} onChange={setGtt('loading_pattern')} />}</td><td />
            </tr>
            <tr>
              <td className="px-2 py-1">Jarak GTT ke existing</td>
              <td colSpan={3} className="px-1 py-1">{readOnly ? <span className="block text-right font-semibold">{p.gtt.distance_gtt_km || '-'}</span> : <input aria-label="Jarak GTT ke existing" type="number" step="any" min="0" className={cell} value={p.gtt.distance_gtt_km} onChange={setGtt('distance_gtt_km')} />}</td>
              <td className="px-2 text-[11px] text-slate-500">kms</td>
            </tr>
            <PhaseRow label="Tegangan pangkal" unit="V" value={p.base_voltage} onChange={setGroup('base_voltage')} readOnly={readOnly} testId="kko-base" />
            <PhaseRow label="Tegangan eksisting pelanggan" unit="V" value={p.existing_voltage} onChange={setGroup('existing_voltage')} readOnly={readOnly} testId="kko-existing" />
            {resultRow('kko-loading-before', 'Beban trafo', res.before ? fmt(res.before.loading_pct) : null, '%')}
            {resultRow('kko-imbalance-before', 'Ketidakseimbangan beban', res.before ? fmt(res.before.imbalance_pct) : null, '%')}
          </tbody>
        </table>
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-hidden">
        <h5 className={th}>3. Rencana</h5>
        <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 px-3 py-2">
          {[['sutm_km', 'Penambahan SUTM', 'kms'], ['mvtic_km', 'Penambahan MVTIC', 'kms'], ['xlpe_km', 'Penambahan XLPE', 'kms'], ['trafo_mgmt_set', 'Manajemen trafo', 'set'],
            ['gtt_sisipan_bh', 'Penambahan GTT sisipan', 'bh'], ['sutr_km', 'Penambahan SUTR', 'kms'], ['rehab_sutr_km', 'Rehabilitasi SUTR', 'kms']].map(([k, label, unit]) => (
            <label key={k} className="flex items-center gap-2 text-xs">
              <span className="flex-1">{label}</span>
              {readOnly ? <b>{p.plan[k] || 0}</b> : <input aria-label={label} type="number" step="any" min="0" className={`${cell} w-24`} value={p.plan[k]} onChange={(e) => onChange({ ...p, plan: { ...p.plan, [k]: e.target.value } })} />}
              <span className="text-[11px] text-slate-500 w-8">{unit}</span>
            </label>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-slate-200 dark:border-slate-700 overflow-x-auto">
        <h5 className={th}>4. Kondisi setelah operasi</h5>
        <table className="w-full text-xs">
          <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
            <PhaseRow label="Tambahan beban" unit="A" value={p.added} onChange={setGroup('added')} readOnly={readOnly} testId="kko-added" />
            <PhaseRow label="Beban total" unit="A" value={res.after ? res.after.loads : { r: '', s: '', t: '' }} onChange={() => {}} readOnly />
            <PhaseRow label="Tegangan eksisting (setelah)" unit="V" value={p.after_existing_voltage} onChange={setGroup('after_existing_voltage')} readOnly={readOnly} />
            {resultRow('kko-loading-after', 'Beban trafo', res.after ? fmt(res.after.loading_pct) : null, '%')}
            {resultRow('kko-imbalance-after', 'Ketidakseimbangan beban', res.after ? fmt(res.after.imbalance_pct) : null, '%')}
          </tbody>
        </table>
        <p className="px-3 py-1.5 text-[11px] text-slate-500">Beban trafo = 3 × tegangan pangkal × arus terbesar ÷ kVA. Ketidakseimbangan = rata-rata selisih arus fasa ÷ rata-rata arus.</p>
      </section>
    </div>
  )
}
