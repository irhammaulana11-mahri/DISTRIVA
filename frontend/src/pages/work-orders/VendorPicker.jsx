import { useMemo } from 'react'
import SearchSelect from '../../components/SearchSelect.jsx'
import { IconAlertCircle } from '../../components/icons.jsx'

export const SCOPE_LABEL = { JARINGAN: 'Jaringan', TIANG: 'Tiang', KEDUANYA: 'Jaringan & Tiang' }
const SCOPE_CLS = {
  JARINGAN: 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300',
  TIANG: 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300',
  KEDUANYA: 'bg-violet-100 text-violet-800 dark:bg-violet-950/60 dark:text-violet-300',
}

const scopeOf = (v) => v.profile?.work_scope || 'KEDUANYA'

/** Vendor aktif yang boleh menerima WO jenis ini: JARINGAN (WO Jaringan) atau TIANG (WO Tiang); lingkup KEDUANYA cocok dengan keduanya. */
export function vendorsForScope(vendors, scope) {
  return (vendors || []).filter((v) => v.status === 'ACTIVE' && [scope, 'KEDUANYA'].includes(scopeOf(v)))
}

export function ScopeBadge({ scope }) {
  return <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${SCOPE_CLS[scope] || SCOPE_CLS.KEDUANYA}`}>{SCOPE_LABEL[scope] || SCOPE_LABEL.KEDUANYA}</span>
}

const dateId = (v) => new Date(v).toLocaleDateString('id-ID', { day: '2-digit', month: 'short', year: 'numeric' })
const expired = (v) => Boolean(v) && new Date(v) < new Date(new Date().toDateString())

/** Pemilih vendor dengan pencarian, disaring menurut jenis WO (`scope`: JARINGAN | TIANG). */
export default function VendorPicker({ vendors, scope, value, onChange, required = false, disabled = false, ariaLabel }) {
  const list = useMemo(() => vendorsForScope(vendors, scope), [vendors, scope])
  const options = useMemo(() => list.map((v) => {
    const p = v.profile || {}
    return {
      value: v.id,
      label: v.name,
      description: [v.code, p.city, p.pic_name && `PIC ${p.pic_name}`].filter(Boolean).join(' · '),
      badge: <ScopeBadge scope={scopeOf(v)} />,
      search: [v.code, p.city, p.pic_name, p.npwp].filter(Boolean).join(' '),
    }
  }), [list])

  return (
    <div className="space-y-1.5">
      <SearchSelect options={options} value={value} onChange={onChange} placeholder="Cari nama atau kode vendor…" ariaLabel={ariaLabel || 'Pilih vendor'} required={required} disabled={disabled} emptyText="Vendor tidak ditemukan." />
      <p className="text-[11px] text-slate-500">
        {list.length > 0
          ? `${list.length} vendor aktif dengan lingkup ${SCOPE_LABEL[scope].toLowerCase()} (termasuk yang menangani keduanya).`
          : `Belum ada vendor aktif untuk pekerjaan ${SCOPE_LABEL[scope].toLowerCase()}. Tambahkan atau ubah lingkupnya di Master Data → Mitra & Vendor.`}
      </p>
    </div>
  )
}

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[88px_1fr] gap-2 py-1.5">
      <dt className="text-[11px] text-slate-400 uppercase font-semibold pt-0.5">{label}</dt>
      <dd className="text-xs text-slate-800 dark:text-slate-200 min-w-0 break-words">{children || <span className="text-slate-400">-</span>}</dd>
    </div>
  )
}

/** Profil ringkas vendor terpilih: membantu memastikan pilihan, termasuk masa berlaku kontrak dan SBU. */
export function VendorPreview({ vendor }) {
  if (!vendor) {
    return <div className="h-full min-h-32 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center p-4 text-xs text-slate-400 text-center">Pilih vendor untuk melihat profilnya.</div>
  }
  const p = vendor.profile || {}
  const validity = (date) => date && (
    <span className={expired(date) ? 'text-rose-600 dark:text-rose-400 font-semibold' : ''}>
      s.d. {dateId(date)}{expired(date) && <span className="inline-flex items-center gap-0.5 ml-1.5"><IconAlertCircle size={11} />kedaluwarsa</span>}
    </span>
  )
  return (
    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 p-4" aria-label="Profil vendor terpilih">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-sm font-bold text-slate-900 dark:text-slate-100 break-words">{vendor.name}</div>
          <div className="font-mono text-[11px] text-slate-500 mt-0.5">{vendor.code}</div>
        </div>
        <ScopeBadge scope={scopeOf(vendor)} />
      </div>
      <dl className="mt-2 divide-y divide-slate-200/70 dark:divide-slate-700/60">
        <Row label="PIC">{p.pic_name && <>{p.pic_name}{p.pic_position && <span className="text-slate-500"> · {p.pic_position}</span>}{p.pic_phone && <div className="text-slate-500">{p.pic_phone}</div>}</>}</Row>
        <Row label="Alamat">{[p.city, p.province].filter(Boolean).join(', ') || p.address}</Row>
        <Row label="Kontrak">{p.contract_number && <>{p.contract_number}{p.contract_valid_until && <div>{validity(p.contract_valid_until)}</div>}</>}</Row>
        <Row label="SBU">{(p.sbu_number || p.sbu_valid_until) && <>{p.sbu_number}{p.sbu_valid_until && <div>{validity(p.sbu_valid_until)}</div>}</>}</Row>
      </dl>
    </div>
  )
}
