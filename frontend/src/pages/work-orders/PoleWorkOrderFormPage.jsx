import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { poleWorkOrdersApi, vendorsApi } from '../../services/api.js'
import VendorPicker from './VendorPicker.jsx'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import { IconArrowLeft } from '../../components/icons.jsx'

const inputCls = 'block w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-500 transition disabled:opacity-60'
const labelCls = 'block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5'

/** Halaman buat / ubah WO Tiang: nomor surat (AMS), vendor tiang, dan lokasi (baris tiang alokasi yang terkonfirmasi). */
export default function PoleWorkOrderFormPage({ mode = 'edit' }) {
  const { id } = useParams()
  const revising = mode === 'revise'
  const editing = Boolean(id) && !revising
  const navigate = useNavigate()
  const { notify } = useNotifications()

  const [reason, setReason] = useState('')
  const [locked, setLocked] = useState(() => new Set()) // baris yang sudah punya progres: tidak boleh dicoret saat revisi
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [saving, setSaving] = useState(false)
  const [candidates, setCandidates] = useState([])
  const [vendors, setVendors] = useState([])
  const [letterNumber, setLetterNumber] = useState('')
  const [letterDate, setLetterDate] = useState(new Date().toISOString().slice(0, 10))
  const [vendorId, setVendorId] = useState('')
  const [notes, setNotes] = useState('')
  const [selected, setSelected] = useState(() => new Set())
  const [lineMeta, setLineMeta] = useState({}) // { [allocation_pole_line_id]: { condition, note } }

  useEffect(() => {
    let alive = true
    ;(async () => {
      try {
        const [cand, vend, wo] = await Promise.all([
          poleWorkOrdersApi.candidates(),
          vendorsApi.list(),
          id ? poleWorkOrdersApi.get(id) : Promise.resolve(null),
        ])
        if (!alive) return
        let list = cand?.data || []
        if (wo?.data) {
          const w = wo.data
          setLetterNumber(w.letter_number || '')
          setLetterDate(w.letter_date || letterDate)
          setVendorId(w.vendor_company_id || '')
          setNotes(w.notes || '')
          // baris WO ini sendiri tidak muncul sebagai kandidat; tampilkan sebagai terpilih
          const own = (w.lines || []).map((l) => ({ allocation_pole_line_id: l.allocation_pole_line_id || l.id, application_number: l.application_number, customer_name: l.customer_name, kr_number: l.kr_number, kr_vendor_id: l.kr_vendor_id, pole_type: l.pole_type, quantity: l.quantity, own: true }))
          list = [...own, ...list]
          if (revising) {
            const withProgress = new Set((w.progress || []).map((p) => p.line_id))
            setLocked(new Set((w.lines || []).filter((l) => withProgress.has(l.id)).map((l) => l.allocation_pole_line_id || l.id)))
          }
          setSelected(new Set(own.map((o) => o.allocation_pole_line_id)))
          setLineMeta(Object.fromEntries((w.lines || []).map((l) => [l.allocation_pole_line_id || l.id, { condition: l.pole_condition || 'BARU', note: l.origin_note || '' }])))
        }
        setCandidates(list)
        setVendors((vend?.data || []))
      } catch (err) {
        if (alive) setError(err?.message || 'Gagal memuat data.')
      } finally {
        if (alive) setLoading(false)
      }
    })()
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, editing, revising])

  const grouped = useMemo(() => {
    const m = new Map()
    candidates.forEach((c) => {
      const key = c.application_number
      if (!m.has(key)) m.set(key, { application_number: key, customer_name: c.customer_name, unit_name: c.unit_name, lines: [] })
      m.get(key).lines.push(c)
    })
    return [...m.values()]
  }, [candidates])

  const setMeta = (lineId, patch) => setLineMeta((prev) => ({ ...prev, [lineId]: { condition: 'BARU', note: '', ...(prev[lineId] || {}), ...patch } }))
  const toggle = (lineId) => locked.has(lineId) ? undefined : setSelected((prev) => {
    const next = new Set(prev)
    if (next.has(lineId)) next.delete(lineId)
    else next.add(lineId)
    return next
  })
  const toggleApp = (group) => setSelected((prev) => {
    const next = new Set(prev)
    const all = group.lines.every((l) => next.has(l.allocation_pole_line_id))
    group.lines.forEach((l) => { if (all && !locked.has(l.allocation_pole_line_id)) next.delete(l.allocation_pole_line_id); else if (!all) next.add(l.allocation_pole_line_id) })
    return next
  })

  // Vendor mengikuti Kontrak Rinci: bila KR terpilih punya vendor, vendor WO otomatis; KR beda vendor tidak boleh satu surat.
  const selectedLines = candidates.filter((c) => selected.has(c.allocation_pole_line_id))
  const krVendorIds = [...new Set(selectedLines.map((c) => c.kr_vendor_id).filter(Boolean))]
  const mixedVendors = krVendorIds.length > 1
  const missingKrVendor = krVendorIds.length === 1 && selectedLines.some((c) => !c.kr_vendor_id)
  const derivedVendor = krVendorIds.length === 1 ? (vendors.find((v) => v.id === krVendorIds[0])?.name || selectedLines.find((c) => c.kr_vendor_name)?.kr_vendor_name || 'vendor Kontrak Rinci') : null
  const totalPoles = candidates.filter((c) => selected.has(c.allocation_pole_line_id)).reduce((a, c) => a + Number(c.quantity || 0), 0)
  const back = () => navigate(id ? `/wo-tiang/${id}` : '/work-orders')

  const submit = async (e) => {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const body = { letter_number: letterNumber.trim(), letter_date: letterDate, vendor_company_id: vendorId, notes: notes.trim(), line_ids: [...selected], line_meta: Object.fromEntries([...selected].map((lid) => [lid, { condition: lineMeta[lid]?.condition || 'BARU', note: (lineMeta[lid]?.note || '').trim() }])) }
      if (krVendorIds.length === 1) delete body.vendor_company_id
      let woId = id
      if (revising) {
        await poleWorkOrdersApi.amend(id, { reason: reason.trim(), line_ids: body.line_ids, line_meta: body.line_meta })
        notify({ type: 'success', title: 'WO Tiang Direvisi', desc: `Surat ${letterNumber.trim()} direvisi; vendor diberi tahu.`, tag: 'WO TIANG' })
        navigate(`/wo-tiang/${id}`)
        return
      }
      if (editing) await poleWorkOrdersApi.update(id, body)
      else woId = (await poleWorkOrdersApi.create(body))?.data?.id
      notify({ type: 'success', title: editing ? 'WO Tiang Diperbarui' : 'WO Tiang Dibuat', desc: `Surat ${letterNumber.trim()} disimpan sebagai draf.`, tag: 'WO TIANG' })
      navigate(`/wo-tiang/${woId}`)
    } catch (err) {
      setError(err?.message || 'Gagal menyimpan WO Tiang.')
    } finally {
      setSaving(false)
    }
  }

  const vendorName = derivedVendor || vendors.find((v) => v.id === vendorId)?.name || null

  return (
    <div className="space-y-5">
      <div>
        <nav className="text-xs text-slate-500 mb-1">
          <Link to="/work-orders" className="hover:underline">SPK / WO</Link><span className="mx-1.5">/</span>
          <span className="text-slate-800 dark:text-slate-200 font-medium">{revising ? 'Revisi' : editing ? 'Ubah' : 'Buat'}</span>
        </nav>
        <div className="flex items-center gap-3">
          <button type="button" onClick={back} aria-label="Kembali" className="p-1.5 rounded-lg border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"><IconArrowLeft size={16} /></button>
          <div>
            <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100">{revising ? 'Revisi WO Tiang' : editing ? 'Ubah WO Tiang' : 'Buat WO Tiang'}</h1>
            <p className="text-xs text-slate-500 mt-0.5">Satu surat permintaan (nomor dari AMS) dapat memuat beberapa lokasi.</p>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="py-16 text-center"><Spinner size="lg" label="Memuat..." /></div>
      ) : (
        <form onSubmit={submit} className="space-y-5 text-xs">
          {error && <Alert kind="error">{error}</Alert>}

          <div className="grid grid-cols-1 xl:grid-cols-3 gap-5 items-start">
            <aside className="order-1 xl:order-2 space-y-5 xl:sticky xl:top-4">
              <section className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-4">Data surat</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-4">
                  <label className="block"><span className={labelCls}>Nomor surat (dari AMS) *</span>
                    <input required disabled={revising} value={letterNumber} onChange={(e) => setLetterNumber(e.target.value)} className={`${inputCls} font-mono`} /></label>
                  <label className="block"><span className={labelCls}>Tanggal surat *</span>
                    <input required disabled={revising} type="date" value={letterDate} onChange={(e) => setLetterDate(e.target.value)} className={inputCls} /></label>
                  {derivedVendor ? (
                    <div className="block sm:col-span-2 xl:col-span-1"><span className={labelCls}>Vendor tiang</span>
                      <div className="px-3 py-2 text-sm rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 font-semibold">{derivedVendor}</div>
                      <span className="text-[11px] text-slate-500">Mengikuti vendor Kontrak Rinci.</span></div>
                  ) : (
                    <div className="block sm:col-span-2 xl:col-span-1"><span className={labelCls}>Vendor tiang *</span>
                      <VendorPicker vendors={vendors} scope="TIANG" value={vendorId} onChange={setVendorId} required ariaLabel="Vendor tiang" />
                      <span className="text-[11px] text-slate-500">Kontrak Rinci terpilih belum memiliki vendor.</span></div>
                  )}
                  {revising && (
                    <label className="block sm:col-span-2 xl:col-span-1"><span className={labelCls}>Alasan revisi *</span>
                      <textarea required rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Contoh: lokasi dipindah ke KR lain karena KR sebelumnya habis" className={inputCls} />
                      <span className="text-[11px] text-slate-500">Nomor surat tetap. Hanya rincian lokasi yang dikirim ke vendor yang berubah; vendor diberi tahu.</span></label>
                  )}
                  <label className="block sm:col-span-2 xl:col-span-1"><span className={labelCls}>Catatan</span>
                    <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} className={`${inputCls} resize-none`} /></label>
                </div>
              </section>

              <section className="p-4 sm:p-5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40" aria-label="Ringkasan surat">
                <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100 mb-3">Ringkasan</h2>
                <dl className="grid grid-cols-3 xl:grid-cols-1 gap-3 xl:gap-0 xl:divide-y xl:divide-slate-200 dark:xl:divide-slate-700">
                  <div className="xl:py-2"><dt className="text-[10px] text-slate-400 uppercase font-semibold">Lokasi</dt><dd className="text-base font-bold font-mono text-slate-900 dark:text-slate-100">{selected.size}</dd></div>
                  <div className="xl:py-2"><dt className="text-[10px] text-slate-400 uppercase font-semibold">Total tiang</dt><dd className="text-base font-bold font-mono text-slate-900 dark:text-slate-100">{totalPoles} <span className="text-xs font-normal text-slate-500">batang</span></dd></div>
                  <div className="xl:py-2"><dt className="text-[10px] text-slate-400 uppercase font-semibold">Vendor</dt><dd className="text-xs font-semibold text-slate-800 dark:text-slate-200 break-words">{vendorName || <span className="text-slate-400 font-normal">belum dipilih</span>}</dd></div>
                </dl>
              </section>
            </aside>

            <section className="order-2 xl:order-1 xl:col-span-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs overflow-hidden">
              <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-1.5">
                <div>
                  <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">Lokasi dalam surat</h2>
                  <p className="text-[11px] text-slate-500 mt-0.5">Hanya lokasi yang bagian tiang alokasinya sudah terkonfirmasi dan belum ada di WO Tiang lain. Satu surat hanya untuk satu UP3.</p>
                </div>
                <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 whitespace-nowrap">{selected.size} baris · {totalPoles} batang</span>
              </div>
              {grouped.length === 0 ? (
                <p className="p-8 text-center text-slate-400">Belum ada lokasi yang siap. Perencanaan perlu mengonfirmasi bagian tiang alokasi terlebih dahulu.</p>
              ) : (
                <div className="divide-y divide-slate-100 dark:divide-slate-800">
                  {grouped.map((g) => (
                    <div key={g.application_number} className="px-4 sm:px-5 py-3.5">
                      <label className="flex flex-wrap items-center gap-x-2 gap-y-0.5 font-semibold text-slate-800 dark:text-slate-200 cursor-pointer">
                        <input type="checkbox" aria-label={`Pilih semua baris ${g.application_number}`} checked={g.lines.every((l) => selected.has(l.allocation_pole_line_id))} onChange={() => toggleApp(g)} />
                        <span className="font-mono text-sm">{g.application_number}</span>
                        <span className="font-normal text-slate-500">{g.customer_name || ''}{g.unit_name ? ` · ${g.unit_name}` : ''}</span>
                      </label>
                      <div className="mt-2.5 sm:ml-6 space-y-2">
                        {g.lines.map((l) => {
                          const on = selected.has(l.allocation_pole_line_id)
                          return (
                            <div key={l.allocation_pole_line_id} className={`rounded-lg border p-2.5 flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between transition ${on ? 'border-blue-200 dark:border-blue-900 bg-blue-50/40 dark:bg-blue-950/20' : 'border-slate-100 dark:border-slate-800'}`}>
                              <label className="flex flex-wrap items-center gap-x-2 gap-y-1 cursor-pointer min-w-0">
                                <input type="checkbox" disabled={locked.has(l.allocation_pole_line_id)} checked={on} onChange={() => toggle(l.allocation_pole_line_id)} aria-label={`${g.application_number} ${l.kr_number} ${l.pole_type}`} />
                                <span className="font-mono">{l.kr_number}</span>
                                <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 font-semibold">Tiang {l.pole_type}</span>
                                <span className="font-mono">{l.quantity} batang</span>
                                {l.khs_code && <span className="text-slate-400">KHS {l.khs_code}</span>}
                                {l.kr_vendor_name && <span className="text-slate-400">{l.kr_vendor_name}</span>}
                                {locked.has(l.allocation_pole_line_id) && <span className="text-[10px] text-slate-500">sudah ada progres — tidak dapat dicoret</span>}
                                {l.from_other_up3 && <span className="px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300 text-[10px] font-semibold" title={`Kontrak Rinci milik UP3 ${l.kr_up3_name || 'lain'}`}>Limpahan dari {l.kr_up3_name || 'UP3 lain'}</span>}
                              </label>
                              {on && (
                                <span className="flex flex-col sm:flex-row gap-1.5 lg:w-[26rem] lg:shrink-0">
                                  <select aria-label={`Kondisi tiang ${g.application_number} ${l.kr_number} ${l.pole_type}`} value={lineMeta[l.allocation_pole_line_id]?.condition || 'BARU'} onChange={(e) => setMeta(l.allocation_pole_line_id, { condition: e.target.value })} className="px-2 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 sm:w-28">
                                    <option value="BARU">Baru</option><option value="BEKAS">Bekas</option><option value="RELOKASI">Relokasi</option>
                                  </select>
                                  <input aria-label={`Asal tiang ${g.application_number} ${l.kr_number} ${l.pole_type}`} maxLength={255} placeholder="Asal / catatan (mis. limpahan dari Madiun)" value={lineMeta[l.allocation_pole_line_id]?.note || ''} onChange={(e) => setMeta(l.allocation_pole_line_id, { note: e.target.value })} className="w-full sm:flex-1 px-2 py-1.5 text-xs rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 placeholder:text-slate-400" />
                                </span>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>
          </div>

          {mixedVendors && <Alert kind="error">Lokasi yang dipilih berasal dari Kontrak Rinci milik vendor berbeda. Satu surat hanya untuk satu vendor; pisahkan menjadi surat terpisah.</Alert>}
          {missingKrVendor && <Alert kind="error">Ada Kontrak Rinci tanpa vendor di antara lokasi yang dipilih. Lengkapi vendor Kontrak Rinci itu atau pilih lokasi lain.</Alert>}

          <div className="sticky bottom-0 z-10 flex items-center justify-between gap-3 py-3 px-4 sm:px-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-sm">
            <span className="font-mono text-[11px] text-slate-600 dark:text-slate-300 truncate">{selected.size} lokasi · {totalPoles} batang</span>
            <div className="flex items-center gap-2 shrink-0">
              <Button type="button" variant="ghost" onClick={back}>Batal</Button>
              <Button type="submit" variant="primary" loading={saving} disabled={!letterNumber.trim() || (!derivedVendor && !vendorId) || selected.size === 0 || mixedVendors || missingKrVendor || (revising && !reason.trim())}>
                {revising ? 'Simpan Revisi' : editing ? 'Simpan Perubahan' : 'Simpan sebagai Draf'}
              </Button>
            </div>
          </div>
        </form>
      )}
    </div>
  )
}
