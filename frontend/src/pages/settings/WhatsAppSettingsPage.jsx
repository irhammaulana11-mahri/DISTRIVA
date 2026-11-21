import { useEffect, useState } from 'react'
import { whatsappSettingsApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'

const INPUT = 'mt-1 block w-full rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3 py-2 text-sm focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600'
const EVENT_LABEL = { SETTINGS_CHANGED: 'Pengaturan diubah', TEST_SENT: 'Uji kirim berhasil', TEST_FAILED: 'Uji kirim gagal' }
const BODY_EXAMPLE = '{"target":"{phone}","message":"{message}"}'

function Row({ label, hint, error, children, htmlFor }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-medium text-slate-700 dark:text-slate-200">{label}</label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  )
}

/** Menu Pengaturan > WhatsApp: gateway untuk notifikasi dan OTP. Token tidak pernah dikembalikan server; kolom kosong berarti token tersimpan dipertahankan. */
export default function WhatsAppSettingsPage() {
  const { notify } = useNotifications()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [fieldErrors, setFieldErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [testing, setTesting] = useState(false)
  const [info, setInfo] = useState(null)
  const [events, setEvents] = useState([])
  const [form, setForm] = useState(null)
  const [token, setToken] = useState('')
  const [clearToken, setClearToken] = useState(false)
  const [phone, setPhone] = useState('')
  const [testResult, setTestResult] = useState(null)

  const apply = (s) => {
    setInfo(s)
    setForm({
      driver: s.driver || 'null', url: s.url || '', method: s.method || 'POST', auth_header: s.auth_header || 'Authorization', auth_prefix: s.auth_prefix || '',
      body_format: s.body_format || 'form', body: s.body || '', success_path: s.success_path || '', success_value: s.success_value || 'true',
      timeout: s.timeout || 10, default_country_code: s.default_country_code || '62',
    })
    setToken('')
    setClearToken(false)
  }

  useEffect(() => {
    let live = true
    whatsappSettingsApi.show()
      .then((r) => { if (live) { apply(r.data); setEvents(r.events || []) } })
      .catch((e) => { if (live) setError(e?.status === 403 ? `${e?.message || 'Tidak berwenang.'} Pengaturan WhatsApp hanya untuk SYS_ADMIN yang sudah lolos MFA.` : e?.message || 'Gagal memuat pengaturan WhatsApp.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setFieldErrors({})
    setSaving(true)
    try {
      const r = await whatsappSettingsApi.save({ ...form, timeout: Number(form.timeout) || 10, token: token || undefined, clear_token: clearToken || undefined })
      apply(r.data)
      setEvents(r.events || [])
      notify({ type: 'success', title: 'Pengaturan WhatsApp disimpan', desc: 'Berlaku untuk pengiriman berikutnya.', tag: 'Pengaturan' })
    } catch (err) {
      if (err?.data?.errors) setFieldErrors(err.data.errors)
      else setError(err?.message || 'Gagal menyimpan pengaturan WhatsApp.')
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async () => {
    setTestResult(null)
    setTesting(true)
    try {
      const r = await whatsappSettingsApi.test({ phone })
      setTestResult({ ok: true, text: r.data?.message || 'Pesan uji dikirim.' })
      setEvents(r.events || [])
    } catch (err) {
      setTestResult({ ok: false, text: err?.data?.errors?.phone?.[0] || err?.message || 'Uji kirim gagal.' })
    } finally {
      setTesting(false)
    }
  }

  if (loading) return <div className="p-12 text-center"><Spinner label="Memuat pengaturan WhatsApp..." /></div>
  if (!form) return <Alert kind="error">{error || 'Pengaturan tidak tersedia.'}</Alert>
  const err = (k) => fieldErrors[k]?.[0]
  const isHttp = form.driver === 'http'

  return (
    <div className="space-y-4 max-w-3xl">
      <div>
        <h1 className="text-xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">Pengaturan WhatsApp</h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">Gateway untuk pesan notifikasi dan kode OTP. Token API disimpan terenkripsi dan tidak pernah ditampilkan lagi.</p>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <Alert kind="info">
        {info.source === 'WEB'
          ? `Memakai pengaturan dari halaman ini${info.updated_by_email ? ` (terakhir diubah oleh ${info.updated_by_email})` : ''}.`
          : 'Belum diatur dari halaman ini: sistem masih memakai nilai dari berkas .env server. Menyimpan formulir ini memindahkan seluruh pengaturan ke sini.'}
      </Alert>

      <form onSubmit={submit} className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-4 sm:p-6 space-y-4">
        <Row label="Pengirim" htmlFor="wa-driver" error={err('driver')} hint="http = gateway sungguhan; log = uji pengembangan (tidak mengirim); null = WhatsApp dimatikan.">
          <select id="wa-driver" value={form.driver} onChange={set('driver')} className={INPUT}>
            <option value="http">http (gateway)</option>
            <option value="log">log (uji, tidak mengirim)</option>
            <option value="null">null (dimatikan)</option>
          </select>
        </Row>
        {isHttp && (
          <>
            <Row label="Alamat gateway (URL)" htmlFor="wa-url" error={err('url')} hint="Harus diawali https://.">
              <input id="wa-url" value={form.url} onChange={set('url')} className={INPUT} placeholder="https://..." autoComplete="off" />
            </Row>
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Metode" htmlFor="wa-method" error={err('method')}>
                <select id="wa-method" value={form.method} onChange={set('method')} className={INPUT}><option>POST</option><option>GET</option></select>
              </Row>
              <Row label="Format isi" htmlFor="wa-format" error={err('body_format')}>
                <select id="wa-format" value={form.body_format} onChange={set('body_format')} className={INPUT}><option value="form">form</option><option value="json">json</option></select>
              </Row>
              <Row label="Nama header otentikasi" htmlFor="wa-header" error={err('auth_header')}>
                <input id="wa-header" value={form.auth_header} onChange={set('auth_header')} className={INPUT} autoComplete="off" />
              </Row>
              <Row label="Awalan token" htmlFor="wa-prefix" error={err('auth_prefix')} hint='Contoh "Bearer " (dengan spasi); kosongkan bila tidak perlu.'>
                <input id="wa-prefix" value={form.auth_prefix} onChange={set('auth_prefix')} className={INPUT} autoComplete="off" />
              </Row>
            </div>
            <Row label="Token API" htmlFor="wa-token" error={err('token')}
              hint={info.has_token ? 'Token sudah tersimpan. Kosongkan kolom ini untuk mempertahankannya, atau isi untuk menggantinya.' : 'Belum ada token tersimpan.'}>
              <input id="wa-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} className={INPUT} placeholder={info.has_token ? '•••••••• (tersimpan)' : ''} autoComplete="new-password" />
              {info.has_token && (
                <label className="mt-2 flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300">
                  <input type="checkbox" checked={clearToken} onChange={(e) => setClearToken(e.target.checked)} /> Hapus token tersimpan
                </label>
              )}
            </Row>
            <Row label="Isi permintaan (JSON)" htmlFor="wa-body" error={err('body')} hint="Harus memuat {phone} (62812…) atau {phone_local} (0812…) dan {message}.">
              <textarea id="wa-body" rows={3} value={form.body} onChange={set('body')} className={`${INPUT} font-mono`} placeholder={BODY_EXAMPLE} />
            </Row>
            <div className="grid gap-4 sm:grid-cols-2">
              <Row label="Jalur penanda sukses (opsional)" htmlFor="wa-path" error={err('success_path')} hint='Contoh "status"; kosong = cukup HTTP 2xx.'>
                <input id="wa-path" value={form.success_path} onChange={set('success_path')} className={INPUT} autoComplete="off" />
              </Row>
              <Row label="Nilai sukses" htmlFor="wa-value" error={err('success_value')}>
                <input id="wa-value" value={form.success_value} onChange={set('success_value')} className={INPUT} autoComplete="off" />
              </Row>
              <Row label="Batas waktu (detik)" htmlFor="wa-timeout" error={err('timeout')}>
                <input id="wa-timeout" type="number" min={1} max={60} value={form.timeout} onChange={set('timeout')} className={INPUT} />
              </Row>
            </div>
          </>
        )}
        <Row label="Kode negara bawaan" htmlFor="wa-cc" error={err('default_country_code')} hint="Dipakai mengubah 08xx menjadi 62 8xx.">
          <input id="wa-cc" value={form.default_country_code} onChange={set('default_country_code')} className={`${INPUT} sm:w-32`} autoComplete="off" />
        </Row>
        <div className="flex justify-end pt-2"><Button type="submit" loading={saving}>Simpan pengaturan</Button></div>
      </form>

      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-4 sm:p-6 space-y-3">
        <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200">Uji kirim</h2>
        <p className="text-xs text-slate-500 dark:text-slate-400">Mengirim satu pesan uji dengan pengaturan yang sudah tersimpan. Simpan dulu bila baru mengubah formulir.</p>
        <div className="flex flex-col sm:flex-row gap-2 sm:items-end">
          <div className="flex-1">
            <label htmlFor="wa-phone" className="block text-sm font-medium text-slate-700 dark:text-slate-200">Nomor tujuan</label>
            <input id="wa-phone" value={phone} onChange={(e) => setPhone(e.target.value)} className={INPUT} placeholder="08xxxxxxxxxx" inputMode="tel" />
          </div>
          <Button variant="secondary" loading={testing} disabled={!phone.trim()} onClick={sendTest}>Kirim pesan uji</Button>
        </div>
        {testResult && <Alert kind={testResult.ok ? 'success' : 'error'}>{testResult.text}</Alert>}
      </div>

      {events.length > 0 && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-4 sm:p-6">
          <h2 className="text-sm font-bold text-slate-800 dark:text-slate-200 mb-2">Riwayat</h2>
          <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
            {events.map((ev, i) => (
              <li key={i} className="py-2 flex flex-wrap justify-between gap-2">
                <span className="text-slate-700 dark:text-slate-200">{EVENT_LABEL[ev.event_type] || ev.event_type}{ev.details?.changed_fields?.length ? `: ${ev.details.changed_fields.join(', ')}${ev.details.token_changed ? ', token' : ''}` : ''}</span>
                <span className="text-slate-500">{ev.actor_email || '-'} · {ev.occurred_at ? new Date(ev.occurred_at).toLocaleString('id-ID') : ''}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
