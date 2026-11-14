import { useState, useEffect, useCallback } from 'react'
import { kkoApi, drawingApi, mtoApi } from '../../services/api.js'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import SubstationPicker from './SubstationPicker.jsx'
import KkoPhaseForm, { emptyPhase, phaseFrom, phaseBody } from './KkoPhaseForm.jsx'
import { phaseResult } from '../../utils/kkoPhase.js'
import OutputDocumentModal from '../../components/OutputDocumentModal.jsx'
import { buildKkoDocument } from '../../utils/kkoDocumentBuilder.js'

const inputCls =
  'w-full px-3 py-2 text-base sm:text-xs rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-blue-500'

const CLASS_STYLE = {
  UNDERLOAD: { label: 'Underload', cls: 'bg-sky-100 text-sky-800 dark:bg-sky-950/50 dark:text-sky-200' },
  NORMAL: { label: 'Normal', cls: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200' },
  OVERLOAD: { label: 'Overload', cls: 'bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200' },
  OVERBLAST: { label: 'Overblast (> 100%)', cls: 'bg-rose-100 text-rose-800 dark:bg-rose-950/50 dark:text-rose-200' },
}

const STATUS_LABEL = {
  NOT_RECORDED: 'Belum dicatat',
  RECORDED: 'Dicatat, menunggu keputusan Teknik',
  LAYAK: 'LAYAK',
  TIDAK_LAYAK: 'TIDAK LAYAK',
}

const num = (v) => (v === null || v === undefined || v === '' ? '' : String(v))
const fmt = (v, d = 2) => (v === null || v === undefined ? '-' : Number(v).toLocaleString('id-ID', { maximumFractionDigits: d }))

function ClassBadge({ value, testId }) {
  const s = CLASS_STYLE[value]
  if (!s) return <span className="text-slate-400">-</span>
  return (
    <span data-testid={testId} className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${s.cls}`}>
      {s.label}
    </span>
  )
}

function formFrom(record) {
  return {
    substation_id: record?.substation_id || '',
    substation_code: record?.substation_code || '',
    substation_name: record?.substation_name || '',
    transformer_capacity_kva: num(record?.transformer_capacity_kva),
    measured_load_kva: num(record?.measured_load_kva),
    measured_at: record?.measured_at || '',
    voltage_location_v: num(record?.voltage_location_v),
    dedicated_transformer: Boolean(record?.dedicated_transformer),
    dedicated_transformer_kva: num(record?.dedicated_transformer_kva),
    load_factor: '',
  }
}

/** Isian hanya yang terisi; kosong dikirim sebagai null supaya server tidak menebak. */
function bodyFrom(f, phase) {
  const n = (v) => (v === '' ? null : Number(v))
  const pd = phase ? phaseBody(phase) : null
  return {
    ...(pd ? { phase_detail: pd } : {}),
    substation_id: f.substation_id || null,
    substation_code: f.substation_code || null,
    substation_name: f.substation_name || null,
    transformer_capacity_kva: n(f.transformer_capacity_kva),
    measured_load_kva: n(f.measured_load_kva),
    measured_at: f.measured_at || null,
    voltage_location_v: n(f.voltage_location_v),
    dedicated_transformer: f.dedicated_transformer,
    dedicated_transformer_kva: f.dedicated_transformer ? n(f.dedicated_transformer_kva) : null,
    load_factor: f.load_factor === '' ? undefined : Number(f.load_factor),
  }
}

/**
 * KKO (docs/62 §51): pembebanan trafo sebelum/sesudah beban baru + tegangan lokasi pelanggan, dari hasil survei.
 * Teknik memutuskan LAYAK / TIDAK LAYAK (alasan wajib bila tidak layak; usulan perbaikan opsional). Tidak menghalangi alur permohonan.
 */
export default function ApplicationKkoPanel({ application, canRecord, canDecide, onSaved, onDraftChange, embedded = false }) {
  const [data, setData] = useState(null)
  const [form, setForm] = useState(formFrom(null))
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [ok, setOk] = useState('')
  const [customerLinkInfo, setCustomerLinkInfo] = useState('')
  const [decision, setDecision] = useState('LAYAK')
  const [notes, setNotes] = useState('')
  const [improvement, setImprovement] = useState('')
  const [pickNote, setPickNote] = useState(null)
  const [phase, setPhase] = useState(emptyPhase())
  const [phaseCode, setPhaseCode] = useState('')
  const [kkoDocOpen, setKkoDocOpen] = useState(false)
  const [drawingData, setDrawingData] = useState(null)
  const [mtoData, setMtoData] = useState(null)

  const handleOpenPrintKko = async () => {
    if (!application?.id) {
      setKkoDocOpen(true)
      return
    }
    try {
      if (typeof drawingApi?.forApplication === 'function') {
        const drwRes = await drawingApi.forApplication(application.id)
        if (drwRes?.data?.id) {
          setDrawingData(drwRes.data)
          const latestVer = drwRes.data.versions?.[0]
          if (latestVer?.id && typeof mtoApi?.forVersion === 'function') {
            const mtoRes = await mtoApi.forVersion(drwRes.data.id, latestVer.id)
            setMtoData(mtoRes?.data || null)
          }
        }
      }
    } catch {
      // ignore
    }
    setKkoDocOpen(true)
  }

  const load = useCallback(async () => {
    if (!application?.id) return
    setLoading(true)
    setError('')
    try {
      const res = await kkoApi.get(application.id)
      setData(res?.data || null)
      setForm(formFrom(res?.data?.record))
      setPhase(phaseFrom(res?.data?.record?.phase_detail))
    } catch (err) {
      setError(err?.message || 'Gagal memuat KKO.')
    } finally {
      setLoading(false)
    }
  }, [application?.id])

  useEffect(() => {
    load()
  }, [load])

  // Isian per fasa yang belum disimpan dibagikan ke pemanggil (rekomendasi perluasan di formulir survei membacanya).
  const draftCapacity = form.transformer_capacity_kva
  useEffect(() => {
    const pd = phaseBody(phase)
    const hasData = Boolean(form.substation_id || pd)
    onDraftChange?.({ phase: pd, capacity: draftCapacity === '' ? null : Number(draftCapacity), body: hasData ? bodyFrom(form, phase) : null })
  }, [phase, form, draftCapacity, onDraftChange])

  // Data gardu terisi otomatis begitu gardu dipilih: arus per fasa dan jurusan, tegangan pangkal RST, dan saran tambahan beban per fasa (docs/82 §12).
  const fillBaseline = async (substationId, code) => {
    if (!application?.id || !substationId || !kkoApi?.baseline) return
    try {
      const res = await kkoApi.baseline(application.id, substationId)
      const b = res?.data
      const rd = b?.reading
      const s = (v) => (v === null || v === undefined ? '' : String(v))
      setPhase((p) => ({
        ...p,
        gtt: { ...p.gtt, jurusan_count: s(rd?.feeders?.length || p.gtt.jurusan_count) },
        load: { r: s(rd?.current_r_a), s: s(rd?.current_s_a), t: s(rd?.current_t_a) },
        jurusan: (rd?.feeders || []).map((f) => ({ name: f.label || '', r: s(f.current_r_a), s: s(f.current_s_a), t: s(f.current_t_a) })),
        base_voltage: { r: s(rd?.base_voltage_r_v), s: s(rd?.base_voltage_s_v), t: s(rd?.base_voltage_t_v) },
        added: { r: s(b?.suggested_added?.r), s: s(b?.suggested_added?.s), t: s(b?.suggested_added?.t) },
      }))
      setPhaseCode(code || b?.substation?.code || '')
    } catch {
      /* data gardu tidak tersedia: isian per fasa dapat diisi manual */
    }
  }

  const handlePick = (values, note) => {
    // Tegangan hasil pengukuran saat survei diisi manual: tegangan ujung gardu tidak dipakai sebagai pengganti.
    setForm((f) => ({ ...f, ...Object.fromEntries(Object.entries({ ...values, voltage_location_v: '' }).map(([k, v]) => [k, v === null || v === undefined ? '' : String(v)])) }))
    setPickNote(note)
    fillBaseline(values.substation_id, values.substation_code)
  }
  const handleClear = () => {
    setForm((f) => ({ ...f, substation_id: '' }))
    setPickNote(null)
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value }))

  const save = async () => {
    setSaving(true)
    setError('')
    setOk('')
    setCustomerLinkInfo('')
    try {
      const res = await kkoApi.record(application.id, bodyFrom(form, phase))
      setData(res?.data || null)
      setForm(formFrom(res?.data?.record))
      setPhase(phaseFrom(res?.data?.record?.phase_detail))
      setOk('Hasil survei KKO tersimpan.')
      onSaved?.(res?.data || null)

      const link = res?.customer_link
      if (link?.result === 'linked' || link?.result === 'created') {
        setCustomerLinkInfo(`IDPEL ${link.idpel || ''} ditautkan ke gardu ini`)
      } else if (link?.result === 'kept_manual') {
        setCustomerLinkInfo('Tautan pelanggan yang diperbaiki manual dipertahankan')
      } else if (link?.result === 'ambiguous_idpel') {
        setCustomerLinkInfo('Pemohon punya lebih dari satu IDPEL: tautkan manual di Master Pelanggan')
      }
    } catch (err) {
      setError(err?.message || 'Gagal menyimpan KKO.')
    } finally {
      setSaving(false)
    }
  }

  const decide = async () => {
    setSaving(true)
    setError('')
    setOk('')
    try {
      const res = await kkoApi.decide(application.id, { decision, notes: notes || null, improvement_proposal: improvement || null })
      setData(res?.data || null)
      setOk('Keputusan KKO tersimpan.')
      onSaved?.(res?.data || null)
    } catch (err) {
      setError(err?.message || 'Gagal menyimpan keputusan.')
    } finally {
      setSaving(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="py-8 flex justify-center">
        <Spinner />
      </div>
    )
  }

  const ctx = data?.context || {}
  const rec = data?.record
  const status = data?.status || 'NOT_RECORDED'
  const th = ctx.thresholds || {}

  if (embedded && canRecord) {
    const cap = form.transformer_capacity_kva === '' ? null : Number(form.transformer_capacity_kva)
    const res = phaseResult(phaseBody(phase) || {}, cap)
    const setExisting = (k) => (e) => setPhase((p) => ({ ...p, existing_voltage: { ...p.existing_voltage, [k]: e.target.value } }))
    const roTriple = (o, testId) => (
      <div className="flex gap-3" data-testid={testId}>
        {['r', 's', 't'].map((k) => (
          <span key={k} className="flex-1 px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs text-center font-semibold" data-testid={testId ? `${testId}-${k}` : undefined}>
            <span className="uppercase text-[10px] text-slate-400 mr-1">{k}</span>
            {o?.[k] === '' || o?.[k] == null ? '-' : o[k]}
          </span>
        ))}
      </div>
    )
    const ro = (v) => <div className="px-2 py-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-xs font-semibold min-h-[30px]">{v === '' || v == null ? '-' : v}</div>
    const pct = (r) => (r?.loading_pct == null ? '-' : `${fmt(r.loading_pct)} %`)
    const imb = (r) => (r?.imbalance_pct == null ? '-' : `${fmt(r.imbalance_pct)} %`)
    return (
      <div className="space-y-3" data-testid="kko-embedded">
        {error && <Alert kind="error">{error}</Alert>}
        <SubstationPicker selectedId={form.substation_id} onPick={handlePick} onClear={handleClear} />
        {pickNote && (pickNote.none || pickNote.stale || pickNote.noLoad) && (
          <div data-testid="kko-pick-note">
            <Alert kind="warning" className="text-xs">
              {pickNote.none && 'Gardu ini belum punya pembacaan operasional.'}
              {pickNote.stale && `Pembacaan gardu sudah ${pickNote.age} hari (lewat batas 12 bulan): ukur ulang atau perbarui sebelum dipakai.`}
              {pickNote.noLoad && 'Pembacaan terakhir tidak memuat arus per fasa, jadi beban dan persentasenya tidak dapat dihitung.'}
            </Alert>
          </div>
        )}
        {form.substation_id ? (
          <>
            <p className="text-[11px] text-slate-500">
              Data gardu diambil dari pembacaan terakhir{form.measured_at ? ` (${form.measured_at})` : ''} dan tidak dapat diubah. Hanya tegangan hasil pengukuran saat survei yang diisi manual.
            </p>
            <div className="grid sm:grid-cols-2 gap-3 text-[11px] font-semibold">
              <div>Kode gardu{ro(form.substation_code)}</div>
              <div>Nama / lokasi gardu{ro(form.substation_name)}</div>
              <div>Kapasitas trafo (kVA){ro(form.transformer_capacity_kva)}</div>
              <div>Jurusan{ro(phase.gtt.jurusan_count)}</div>
              <div className="sm:col-span-2">Beban total R · S · T (A){roTriple(phase.load, 'kko-load')}</div>
              <div className="sm:col-span-2">Tegangan gardu R · S · T (V){roTriple(phase.base_voltage, 'kko-base')}</div>
              <div className="sm:col-span-2">
                Tegangan hasil pengukuran saat survei R · S · T (V) <span className="text-rose-500">*</span> <span className="font-normal text-slate-400">(diisi manual)</span>
                <div className="flex gap-3 mt-1">
                  {['r', 's', 't'].map((k) => (
                    <label key={k} className="flex-1 flex items-center gap-1">
                      <span className="uppercase text-[10px] text-slate-400">{k}</span>
                      <input aria-label={`Tegangan survei ${k.toUpperCase()}`} data-testid={`kko-existing-${k}`} type="number" step="any" min="0" className={inputCls} value={phase.existing_voltage[k]} onChange={setExisting(k)} />
                    </label>
                  ))}
                </div>
              </div>
              <div>
                Persentase beban trafo
                {ro(`${pct(res.before)}${res.after ? ` → ${pct(res.after)} setelah tambahan beban` : ''}`)}
              </div>
              <div>
                Ketidakseimbangan beban
                {ro(`${imb(res.before)}${res.after ? ` → ${imb(res.after)}` : ''}`)}
              </div>
            </div>
          </>
        ) : (
          <p className="text-[11px] text-slate-500">Pilih gardu pelanggan untuk menampilkan data trafo. Data tersimpan bersama Simpan Draf / Ajukan Hasil Survei.</p>
        )}
      </div>
    )
  }

  return (
    <div className="space-y-4" data-testid="kko-panel">
      {error && <Alert kind="error">{error}</Alert>}
      {ok && <Alert kind="success">{ok}</Alert>}
      {customerLinkInfo && (
        <div data-testid="kko-customer-link-info">
          <Alert kind="info">{customerLinkInfo}</Alert>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-3 text-xs">
        <span className="font-semibold text-slate-700 dark:text-slate-300">Status KKO:</span>
        <span data-testid="kko-status" className="px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold">
          {STATUS_LABEL[status] || status}
        </span>
        <span className="text-slate-500">
          Daya tambahan {fmt(ctx.added_power_kva)} kVA · faktor beban bawaan {fmt(ctx.load_factor_default)}
        </span>
      </div>

      <p className="text-[11px] text-slate-500">
        Batas pembebanan trafo: ≤ {th.underload_max}% underload, sampai {th.normal_max}% normal, sampai {th.overload_max}% overload, di atas itu overblast. Tegangan lokasi
        tidak boleh di bawah {th.min_voltage_v} V (220 V − 10 %). KKO tidak menghalangi alur permohonan.
      </p>

      {ctx.dedicated_expected && !rec?.dedicated_transformer && (
        <Alert kind="warning" className="text-xs" data-testid="kko-dedicated-hint">
          Pasang baru {fmt(ctx.new_power_kva)} kVA (53 kVA ke atas): lazimnya diusulkan trafo khusus sesuai ketentuan.
        </Alert>
      )}

      {canRecord ? (
        <div className="grid sm:grid-cols-2 gap-3">
          <SubstationPicker selectedId={form.substation_id} onPick={handlePick} onClear={handleClear} />
          {pickNote && (pickNote.none || pickNote.stale || pickNote.noLoad) && (
            <div className="sm:col-span-2" data-testid="kko-pick-note">
              <Alert kind="warning" className="text-xs">
                {pickNote.none && 'Gardu ini belum punya pembacaan operasional: isi beban terukur dari hasil ukur di lapangan.'}
                {pickNote.stale && `Pembacaan gardu sudah ${pickNote.age} hari (lewat batas 12 bulan): ukur ulang atau perbarui sebelum dipakai.`}
                {pickNote.noLoad && 'Pembacaan terakhir tidak memuat arus per fasa, jadi beban (kVA) tidak dapat dihitung: isi beban terukur secara manual.'}
              </Alert>
            </div>
          )}
          {(form.substation_id || phaseBody(phase)) && (
            <div className="sm:col-span-2">
              <KkoPhaseForm value={phase} onChange={setPhase} application={application} substationCode={form.substation_code || phaseCode} capacity={form.transformer_capacity_kva === '' ? null : Number(form.transformer_capacity_kva)} />
            </div>
          )}
          <label className="text-[11px] font-semibold">
            Kode gardu
            <input aria-label="Kode gardu" className={inputCls} value={form.substation_code} onChange={set('substation_code')} />
          </label>
          <label className="text-[11px] font-semibold">
            Nama / lokasi gardu
            <input aria-label="Nama gardu" className={inputCls} value={form.substation_name} onChange={set('substation_name')} />
          </label>
          <label className="text-[11px] font-semibold">
            Kapasitas trafo (kVA)
            <input aria-label="Kapasitas trafo" type="number" min="0" className={inputCls} value={form.transformer_capacity_kva} onChange={set('transformer_capacity_kva')} />
          </label>
          <label className="text-[11px] font-semibold">
            Beban terukur trafo (kVA)
            <input aria-label="Beban terukur" type="number" min="0" className={inputCls} value={form.measured_load_kva} onChange={set('measured_load_kva')} />
          </label>
          <label className="text-[11px] font-semibold">
            Tanggal ukur
            <input aria-label="Tanggal ukur" type="date" className={inputCls} value={form.measured_at} onChange={set('measured_at')} />
          </label>
          <label className="text-[11px] font-semibold">
            Tegangan di lokasi pelanggan (V)
            <input aria-label="Tegangan lokasi" type="number" min="0" className={inputCls} value={form.voltage_location_v} onChange={set('voltage_location_v')} />
          </label>
          <label className="text-[11px] font-semibold">
            Faktor beban (opsional)
            <input aria-label="Faktor beban KKO" type="number" min="0.01" max="1" step="0.05" placeholder={`Bawaan ${fmt(ctx.load_factor_default)}`} className={inputCls} value={form.load_factor} onChange={set('load_factor')} />
          </label>
          <div className="sm:col-span-2 flex flex-wrap items-center gap-4">
            <label className="text-[11px] font-semibold inline-flex items-center gap-2">
              <input aria-label="Diusulkan trafo khusus" type="checkbox" checked={form.dedicated_transformer} onChange={set('dedicated_transformer')} />
              Diusulkan trafo khusus
            </label>
            {form.dedicated_transformer && (
              <label className="text-[11px] font-semibold">
                Kapasitas trafo khusus (kVA)
                <input aria-label="Kapasitas trafo khusus" type="number" min="0" className={inputCls} value={form.dedicated_transformer_kva} onChange={set('dedicated_transformer_kva')} />
              </label>
            )}
          </div>
          <div className="sm:col-span-2">
            <Button onClick={save} disabled={saving}>
              {saving ? 'Menyimpan…' : 'Simpan Hasil Survei KKO'}
            </Button>
            {rec?.decision && <span className="ml-3 text-[11px] text-amber-700">Menyimpan ulang akan mereset keputusan Teknik.</span>}
          </div>
        </div>
      ) : (
        !rec && <p className="text-xs text-slate-500">Hasil survei KKO belum dicatat.</p>
      )}

      {rec && (
        <div className="rounded-xl border border-slate-200 dark:border-slate-800 p-3 text-xs space-y-2" data-testid="kko-result">
          <div className="flex items-center justify-between gap-2">
            <div className="font-semibold text-slate-700 dark:text-slate-300">
              Gardu {rec.substation_code || '-'} {rec.substation_name ? `— ${rec.substation_name}` : ''}
            </div>
            <button
              type="button"
              onClick={handleOpenPrintKko}
              className="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border border-slate-300 dark:border-slate-600 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer shadow-2xs"
              title="Pratinjau & Cetak Formulir Resmi KKO"
            >
              <span>🖨️</span>
              <span>Cetak KKO</span>
            </button>
          </div>
          {rec.dedicated_transformer ? (
            <div data-testid="kko-dedicated">Trafo khusus diusulkan {fmt(rec.dedicated_transformer_kva)} kVA; trafo PLN tidak dibebani.</div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div>Kapasitas: <b>{fmt(rec.transformer_capacity_kva)} kVA</b></div>
              <div>Beban terukur: <b>{fmt(rec.measured_load_kva)} kVA</b></div>
              <div>
                Pembebanan sebelum: <b data-testid="kko-before-pct">{fmt(rec.loading_before_pct)}%</b> <ClassBadge value={rec.class_before} testId="kko-before-class" />
              </div>
              <div>
                Pembebanan sesudah: <b data-testid="kko-after-pct">{fmt(rec.loading_after_pct)}%</b> <ClassBadge value={rec.class_after} testId="kko-after-class" />
              </div>
            </div>
          )}
          <div>
            Tegangan lokasi: <b>{fmt(rec.voltage_location_v)} V</b>
            {rec.voltage_low === true && (
              <span data-testid="kko-voltage-low" className="ml-2 px-2 py-0.5 rounded-full bg-rose-100 text-rose-800 text-[11px] font-semibold">
                Di bawah {th.min_voltage_v} V
              </span>
            )}
            {rec.voltage_low === false && <span className="ml-2 text-emerald-700">memenuhi</span>}
          </div>
          {rec.decision && (
            <div className="pt-1 border-t border-slate-100 dark:border-slate-800" data-testid="kko-decision">
              Keputusan Teknik: <b>{STATUS_LABEL[rec.decision]}</b> oleh {rec.decided_by_name || '-'}
              {rec.decision_notes && <div>Alasan: {rec.decision_notes}</div>}
              {rec.improvement_proposal && <div>Usulan perbaikan: {rec.improvement_proposal}</div>}
            </div>
          )}
        </div>
      )}

      {canDecide && rec && (
        <div className="rounded-xl border border-blue-200 dark:border-blue-900 p-3 space-y-2" data-testid="kko-decide-form">
          <div className="text-[11px] font-bold text-blue-900 dark:text-blue-300">Keputusan Teknik</div>
          <select aria-label="Keputusan KKO" className={inputCls} value={decision} onChange={(e) => setDecision(e.target.value)}>
            <option value="LAYAK">LAYAK</option>
            <option value="TIDAK_LAYAK">TIDAK LAYAK</option>
          </select>
          <textarea aria-label="Alasan keputusan" rows={2} placeholder={decision === 'TIDAK_LAYAK' ? 'Alasan (wajib)' : 'Catatan (opsional)'} className={inputCls} value={notes} onChange={(e) => setNotes(e.target.value)} />
          <textarea aria-label="Usulan perbaikan" rows={2} placeholder="Usulan perbaikan (opsional)" className={inputCls} value={improvement} onChange={(e) => setImprovement(e.target.value)} />
          <Button onClick={decide} disabled={saving || (decision === 'TIDAK_LAYAK' && !notes.trim())}>
            Simpan Keputusan
          </Button>
        </div>
      )}

      {/* Output Document Modal Cetak KKO */}
      {kkoDocOpen && rec && (
        <OutputDocumentModal
          open={kkoDocOpen}
          onClose={() => setKkoDocOpen(false)}
          runId={application?.id}
          type="kko"
          category="kko"
          title="Kajian Kelayakan Operasi (KKO)"
          customDoc={buildKkoDocument({
            kko: data,
            application,
            drawing: drawingData,
            mtoPackage: mtoData,
          })}
        />
      )}
    </div>
  )
}
