import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import { useAccess } from '../../features/admin/AccessContext.jsx'
import useAccountUnits from './useAccountUnits.js'

/** Kolom profil perusahaan vendor (sama dengan backend VendorService::PROFILE_FIELDS). */
export const PROFILE_FIELDS = [
  'npwp', 'nib', 'address', 'city', 'province', 'postal_code', 'phone', 'email', 'website',
  'pic_name', 'pic_position', 'pic_phone', 'pic_email',
  'sbu_classification', 'sbu_number', 'sbu_valid_until',
  'contract_number', 'contract_valid_from', 'contract_valid_until',
  'bank_name', 'bank_account_number', 'bank_account_name', 'notes', 'work_scope',
]

export function emptyVendorForm() {
  return { code: '', name: '', create_account: true, account_name: '', account_email: '', account_phone: '', account_unit: '', ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f, ''])), work_scope: 'KEDUANYA' }
}

export function vendorToForm(vendor) {
  return { ...emptyVendorForm(), code: vendor.code || '', name: vendor.name || '', ...Object.fromEntries(PROFILE_FIELDS.map((f) => [f, vendor.profile?.[f] ?? ''])), work_scope: vendor.profile?.work_scope || 'KEDUANYA' }
}

const inputCls = 'block w-full px-3 py-2 text-sm rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/40 focus:border-blue-500 transition-colors'

function Field({ label, required: req, hint, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="block text-xs font-medium text-slate-600 dark:text-slate-400 mb-1">
        {label}{req && <span className="text-red-500 ml-0.5">*</span>}
        {hint && <span className="font-normal text-slate-400 ml-1">({hint})</span>}
      </span>
      {children}
    </label>
  )
}

function Section({ title, hint, children }) {
  return (
    <fieldset className="rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden">
      <legend className="sr-only">{title}</legend>
      <div className="px-4 py-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
        <h4 className="text-xs font-semibold text-slate-700 dark:text-slate-300 uppercase tracking-wide">{title}</h4>
        {hint && <p className="text-[11px] text-slate-400 mt-0.5">{hint}</p>}
      </div>
      <div className="p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-4 gap-y-3">{children}</div>
    </fieldset>
  )
}

/**
 * Formulir profil lengkap vendor: identitas, alamat & kontak, penanggung jawab, kualifikasi usaha (SBU), kontrak/SPK, rekening.
 * `mode` = 'create' (kode bisa diisi) atau 'edit' (kode terkunci).
 */
export default function VendorProfileForm({ mode = 'create', form, onChange, onSubmit, onCancel, saving = false, error = '' }) {
  const { isSysAdmin } = useAccess()
  const units = useAccountUnits(isSysAdmin && mode === 'create')
  const set = (k) => (e) => onChange({ ...form, [k]: k === 'code' ? e.target.value.toUpperCase() : e.target.value })
  const txt = (k, props = {}) => <input type="text" value={form[k]} onChange={set(k)} className={inputCls} {...props} />
  const date = (k) => <input type="date" value={form[k] || ''} onChange={set(k)} className={inputCls} />

  return (
    <form onSubmit={onSubmit} className="space-y-5 text-xs">
      {error && <Alert kind="error">{error}</Alert>}

      <Section title="Identitas perusahaan">
        <Field label="Kode Vendor" required hint="huruf, angka, titik, strip">
          <input type="text" required disabled={mode === 'edit'} value={form.code} onChange={set('code')} placeholder="Contoh: VND-001, PT-KARYA-01" className={`${inputCls} font-mono uppercase disabled:opacity-50 disabled:cursor-not-allowed`} />
        </Field>
        <Field label="Nama Perusahaan Vendor" required>
          <input type="text" required value={form.name} onChange={set('name')} placeholder="Contoh: PT. Citra Konstruksi Distribusi" className={inputCls} />
        </Field>
        <Field label="Lingkup Pekerjaan" required>
          <select value={form.work_scope} onChange={set('work_scope')} className={inputCls}>
            <option value="JARINGAN">Pekerjaan jaringan (WO Jaringan)</option>
            <option value="TIANG">Pekerjaan tiang (WO Tiang)</option>
            <option value="KEDUANYA">Jaringan &amp; Tiang (Keduanya)</option>
          </select>
        </Field>
        <Field label="NPWP">{txt('npwp', { placeholder: '00.000.000.0-000.000', inputMode: 'numeric' })}</Field>
        <Field label="NIB (Nomor Induk Berusaha)">{txt('nib')}</Field>
      </Section>

      <Section title="Alamat & Kontak Perusahaan">
        <Field label="Alamat" className="sm:col-span-2 lg:col-span-3">
          <textarea rows={3} value={form.address} onChange={set('address')} className={`${inputCls} resize-none`} />
        </Field>
        <Field label="Kota / Kabupaten">{txt('city')}</Field>
        <Field label="Provinsi">{txt('province')}</Field>
        <Field label="Kode Pos">{txt('postal_code', { inputMode: 'numeric', maxLength: 10 })}</Field>
        <Field label="Nomor Telepon">{txt('phone', { type: 'tel' })}</Field>
        <Field label="Email Perusahaan"><input type="email" value={form.email} onChange={set('email')} className={inputCls} /></Field>
        <Field label="Situs Web">{txt('website', { placeholder: 'https://' })}</Field>
      </Section>

      <Section title="Penanggung Jawab (PIC)" hint="Kontak yang dihubungi untuk WO dan koordinasi pekerjaan.">
        <Field label="Nama PIC">{txt('pic_name')}</Field>
        <Field label="Jabatan / Posisi">{txt('pic_position')}</Field>
        <Field label="Telepon / WhatsApp PIC">{txt('pic_phone', { type: 'tel' })}</Field>
        <Field label="Email PIC"><input type="email" value={form.pic_email} onChange={set('pic_email')} className={inputCls} /></Field>
      </Section>

      <Section title="Kualifikasi Usaha (SBU)">
        <Field label="Bidang / Klasifikasi SBU" className="sm:col-span-2 lg:col-span-3">{txt('sbu_classification', { placeholder: 'Contoh: Instalasi tenaga listrik tegangan menengah' })}</Field>
        <Field label="Nomor SBU / Sertifikat">{txt('sbu_number')}</Field>
        <Field label="Berlaku Sampai">{date('sbu_valid_until')}</Field>
      </Section>

      <Section title="Kontrak / SPK">
        <Field label="Nomor Kontrak / SPK" className="sm:col-span-2 lg:col-span-3">{txt('contract_number')}</Field>
        <Field label="Berlaku Mulai">{date('contract_valid_from')}</Field>
        <Field label="Berlaku Sampai">{date('contract_valid_until')}</Field>
      </Section>

      {mode === 'create' && (
        <Section title="Akun Pelaksana (Bagian Administrasi)" hint="Akun login vendor untuk melaporkan progres pekerjaan di portal. Undangan aktivasi dikirim ke email ini; akun otomatis tertaut ke vendor.">
          <label className="sm:col-span-2 lg:col-span-3 flex items-center gap-2 text-xs text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={Boolean(form.create_account)} onChange={(e) => onChange({ ...form, create_account: e.target.checked })} />
            Buat akun Pelaksana sekarang
          </label>
          {form.create_account && (
            <>
              <Field label="Nama Petugas Administrasi" required>{txt('account_name', { required: true })}</Field>
              <Field label="Email Login" required hint="menerima undangan aktivasi"><input type="email" required value={form.account_email} onChange={set('account_email')} className={inputCls} /></Field>
              <Field label="Telepon / WhatsApp">{txt('account_phone', { type: 'tel' })}</Field>
              {isSysAdmin && (
                <Field label="Unit Penugasan Akun" hint="kosong = unit penugasan Anda sendiri">
                  <select value={form.account_unit || ''} onChange={set('account_unit')} className={inputCls} aria-label="Unit Penugasan Akun">
                    <option value="">-- Unit saya --</option>
                    {units.map((u) => <option key={u.id} value={u.id}>{u.name}{u.unit_type ? ` (${u.unit_type})` : ''}</option>)}
                  </select>
                </Field>
              )}
            </>
          )}
        </Section>
      )}

      <Section title="Rekening Pembayaran">
        <Field label="Nama Bank">{txt('bank_name')}</Field>
        <Field label="Nomor Rekening">{txt('bank_account_number', { inputMode: 'numeric' })}</Field>
        <Field label="Atas Nama" className="sm:col-span-2 lg:col-span-3">{txt('bank_account_name')}</Field>
      </Section>

      <Section title="Catatan Internal">
        <Field label="Catatan" className="sm:col-span-2 lg:col-span-3">
          <textarea rows={3} value={form.notes} onChange={set('notes')} className={`${inputCls} resize-none`} />
        </Field>
      </Section>

      <div className="sticky bottom-0 z-10 flex justify-end gap-3 py-3 px-5 rounded-xl border border-slate-200 dark:border-slate-700 bg-white/95 dark:bg-slate-900/95 backdrop-blur shadow-sm">
        <Button type="button" variant="ghost" onClick={onCancel}>Batal</Button>
        <Button type="submit" variant="primary" loading={saving} disabled={!form.code.trim() || !form.name.trim()}>
          {mode === 'edit' ? 'Simpan Profil' : 'Simpan Vendor'}
        </Button>
      </div>
    </form>
  )
}
