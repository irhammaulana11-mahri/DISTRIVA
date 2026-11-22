import { useEffect, useState } from 'react'
import { whatsappSettingsApi } from '../../services/api.js'
import { useNotifications } from '../../features/notifications/NotificationContext.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import {
  IconBrandWhatsapp,
  IconRefresh,
  IconShield,
  IconKey,
  IconDatabase,
  IconHistory,
  IconSend,
  IconCheckCircle,
  IconAlertCircle,
} from '../../components/icons.jsx'

const INPUT = 'mt-1 block w-full rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 px-3.5 py-2 text-sm text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:border-blue-600 focus:outline-none focus:ring-1 focus:ring-blue-600 transition shadow-2xs'
const EVENT_LABEL = {
  SETTINGS_CHANGED: 'Pengaturan diubah',
  TEST_SENT: 'Uji kirim berhasil',
  TEST_FAILED: 'Uji kirim gagal',
}
const BODY_EXAMPLE = '{"target":"{phone}","message":"{message}"}'

function Row({ label, hint, error, children, htmlFor }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
        {label}
      </label>
      {children}
      {hint && <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600 font-medium">{error}</p>}
    </div>
  )
}

/**
 * Menu Pengaturan > Pengaturan WhatsApp: gateway untuk notifikasi dan OTP.
 * Khusus role SYS_ADMIN. Token disimpan terenkripsi dan tidak dikembalikan ke browser.
 */
export default function WhatsAppSettingsPage() {
  const { notify } = useNotifications()
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
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
  const [activeTab, setActiveTab] = useState('config')

  const apply = (s) => {
    setInfo(s)
    setForm({
      driver: s.driver || 'null',
      url: s.url || '',
      method: s.method || 'POST',
      auth_header: s.auth_header || 'Authorization',
      auth_prefix: s.auth_prefix || '',
      body_format: s.body_format || 'form',
      body: s.body || '',
      success_path: s.success_path || '',
      success_value: s.success_value || 'true',
      timeout: s.timeout || 10,
      default_country_code: s.default_country_code || '62',
    })
    setToken('')
    setClearToken(false)
  }

  const loadSettings = async (isManualRefresh = false) => {
    if (isManualRefresh) setRefreshing(true)
    else setLoading(true)
    setError('')
    try {
      const r = await whatsappSettingsApi.show()
      apply(r.data)
      setEvents(r.events || [])
    } catch (e) {
      setError(
        e?.status === 403
          ? `${e?.message || 'Tidak berwenang.'} Pengaturan WhatsApp hanya untuk SYS_ADMIN yang sudah lolos MFA.`
          : e?.message || 'Gagal memuat pengaturan WhatsApp.'
      )
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  useEffect(() => {
    loadSettings()
  }, [])

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const submit = async (e) => {
    e.preventDefault()
    setError('')
    setFieldErrors({})
    setSaving(true)
    try {
      const r = await whatsappSettingsApi.save({
        ...form,
        timeout: Number(form.timeout) || 10,
        token: token || undefined,
        clear_token: clearToken || undefined,
      })
      apply(r.data)
      setEvents(r.events || [])
      notify({
        type: 'success',
        title: 'Pengaturan WhatsApp disimpan',
        desc: 'Berlaku untuk pengiriman notifikasi & OTP berikutnya.',
        tag: 'Pengaturan',
      })
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
      setTestResult({
        ok: false,
        text: err?.data?.errors?.phone?.[0] || err?.message || 'Uji kirim gagal.',
      })
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <div className="p-12 text-center">
        <Spinner label="Memuat pengaturan WhatsApp..." />
      </div>
    )
  }

  if (!form) {
    return (
      <div className="space-y-4 w-full">
        <Alert kind="error">{error || 'Pengaturan tidak tersedia.'}</Alert>
      </div>
    )
  }

  const err = (k) => fieldErrors[k]?.[0]
  const isHttp = form.driver === 'http'

  const showConfig = activeTab === 'config'
  const showTest = activeTab === 'test'
  const showHistory = activeTab === 'history'

  return (
    <div className="space-y-5 w-full">
      {/* 1. Hero Header Card Standar DISTRIVA (Bersih tanpa duplikasi breadcrumb) */}
      <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-5 sm:p-6">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div className="flex items-start gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-600 flex items-center justify-center text-white shadow-xs shrink-0">
              <IconBrandWhatsapp size={26} />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-slate-100 tracking-tight">
                  Pengaturan WhatsApp
                </h1>
                <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                  Gateway & OTP
                </span>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                  <IconShield size={12} />
                  SYS_ADMIN
                </span>
              </div>
              <p className="mt-1 text-xs sm:text-sm text-slate-500 dark:text-slate-400 max-w-2xl">
                Gateway untuk pesan notifikasi dan kode OTP. Token API disimpan terenkripsi dan tidak pernah ditampilkan lagi.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 self-start md:self-auto shrink-0">
            <Button
              variant="secondary"
              onClick={() => loadSettings(true)}
              loading={refreshing}
              icon={IconRefresh}
            >
              Segarkan
            </Button>
          </div>
        </div>
      </div>

      {/* 2. KPI Cards Metrics (4 Kolom Seragam) */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 sm:gap-4">
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium">Status Driver</span>
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                form.driver === 'http'
                  ? 'bg-emerald-500 ring-2 ring-emerald-200 dark:ring-emerald-900'
                  : form.driver === 'log'
                  ? 'bg-amber-500 ring-2 ring-amber-200 dark:ring-amber-900'
                  : 'bg-slate-400 ring-2 ring-slate-200 dark:ring-slate-800'
              }`}
            />
          </div>
          <div className="mt-2 text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
            {form.driver === 'http' ? 'HTTP Gateway' : form.driver === 'log' ? 'Log Uji (Dev)' : 'Null (Mati)'}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {form.driver === 'http' ? 'Aktif kirim gateway' : form.driver === 'log' ? 'Catat ke log' : 'Pengiriman mati'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium">Sumber Konfigurasi</span>
            <IconDatabase size={16} className="text-blue-500" />
          </div>
          <div className="mt-2 text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
            {info.source === 'WEB' ? 'Basis Data (WEB)' : 'Berkas .env'}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {info.source === 'WEB' ? (info.updated_by_email ? info.updated_by_email : 'Tersimpan di DB') : 'Bawaan server .env'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium">Status Token API</span>
            <IconKey size={16} className="text-amber-500" />
          </div>
          <div className="mt-2 text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100 truncate">
            {info.has_token ? 'Tersimpan Aman' : 'Belum Diatur'}
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400 truncate">
            {info.has_token ? 'Enkripsi AES-256' : 'Token masih kosong'}
          </p>
        </div>

        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-xs">
          <div className="flex items-center justify-between text-slate-500 dark:text-slate-400">
            <span className="text-xs font-medium">Riwayat Aktivitas</span>
            <IconHistory size={16} className="text-indigo-500" />
          </div>
          <div className="mt-2 text-lg sm:text-xl font-bold text-slate-900 dark:text-slate-100">
            {events.length} Catatan
          </div>
          <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
            Audit perubahan & uji kirim
          </p>
        </div>
      </div>

      {/* 3. Alerts */}
      {error && <Alert kind="error">{error}</Alert>}
      <Alert kind="info">
        {info.source === 'WEB'
          ? `Memakai pengaturan dari halaman ini${info.updated_by_email ? ` (terakhir diubah oleh ${info.updated_by_email})` : ''}.`
          : 'Belum diatur dari halaman ini: sistem masih memakai nilai dari berkas .env server. Menyimpan formulir ini memindahkan seluruh pengaturan ke sini.'}
      </Alert>

      {/* 4. Tab Navigasi Standar Underline */}
      <div className="border-b border-slate-200 dark:border-slate-800 flex items-center gap-6 overflow-x-auto">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'config'}
          onClick={() => setActiveTab('config')}
          className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            activeTab === 'config'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          Konfigurasi Gateway
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'test'}
          onClick={() => setActiveTab('test')}
          className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            activeTab === 'test'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          Uji Kirim Pesan
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'history'}
          onClick={() => setActiveTab('history')}
          className={`pb-3 text-sm font-semibold whitespace-nowrap border-b-2 transition-colors cursor-pointer ${
            activeTab === 'history'
              ? 'border-blue-600 text-blue-600 dark:text-blue-400'
              : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
          }`}
        >
          Riwayat & Audit ({events.length})
        </button>
      </div>

      {/* 5. Formulir Konfigurasi Gateway */}
      {showConfig && (
        <form
          onSubmit={submit}
          className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-5 sm:p-6 space-y-5"
        >
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
                Parameter Gerbang WhatsApp
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Tentukan mode driver, alamat endpoint API, skema payload, dan parameter keamanan.
              </p>
            </div>
            <span className="text-xs font-mono px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
              Driver: {form.driver}
            </span>
          </div>

          <Row
            label="Pengirim"
            htmlFor="wa-driver"
            error={err('driver')}
            hint="http = gateway sungguhan; log = uji pengembangan (tidak mengirim); null = WhatsApp dimatikan."
          >
            <select id="wa-driver" value={form.driver} onChange={set('driver')} className={INPUT}>
              <option value="http">http (gateway)</option>
              <option value="log">log (uji, tidak mengirim)</option>
              <option value="null">null (dimatikan)</option>
            </select>
          </Row>

          {isHttp && (
            <>
              <Row
                label="Alamat gateway (URL)"
                htmlFor="wa-url"
                error={err('url')}
                hint="Boleh http:// atau https://. http:// mengirim token tanpa enkripsi: pakai hanya untuk gateway di server atau jaringan sendiri."
              >
                <input
                  id="wa-url"
                  value={form.url}
                  onChange={set('url')}
                  className={INPUT}
                  placeholder="https://... atau http://..."
                  autoComplete="off"
                />
              </Row>

              <div className="grid gap-4 sm:grid-cols-2">
                <Row label="Metode" htmlFor="wa-method" error={err('method')}>
                  <select id="wa-method" value={form.method} onChange={set('method')} className={INPUT}>
                    <option>POST</option>
                    <option>GET</option>
                  </select>
                </Row>
                <Row label="Format isi" htmlFor="wa-format" error={err('body_format')}>
                  <select id="wa-format" value={form.body_format} onChange={set('body_format')} className={INPUT}>
                    <option value="form">form</option>
                    <option value="json">json</option>
                  </select>
                </Row>
                <Row label="Nama header otentikasi" htmlFor="wa-header" error={err('auth_header')}>
                  <input
                    id="wa-header"
                    value={form.auth_header}
                    onChange={set('auth_header')}
                    className={INPUT}
                    autoComplete="off"
                  />
                </Row>
                <Row
                  label="Awalan token"
                  htmlFor="wa-prefix"
                  error={err('auth_prefix')}
                  hint='Contoh "Bearer " (dengan spasi); kosongkan bila tidak perlu.'
                >
                  <input
                    id="wa-prefix"
                    value={form.auth_prefix}
                    onChange={set('auth_prefix')}
                    className={INPUT}
                    autoComplete="off"
                  />
                </Row>
              </div>

              <Row
                label="Token API"
                htmlFor="wa-token"
                error={err('token')}
                hint={
                  info.has_token
                    ? 'Token sudah tersimpan. Kosongkan kolom ini untuk mempertahankannya, atau isi untuk menggantinya.'
                    : 'Belum ada token tersimpan.'
                }
              >
                <input
                  id="wa-token"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className={INPUT}
                  placeholder={info.has_token ? '•••••••• (tersimpan)' : ''}
                  autoComplete="new-password"
                />
                {info.has_token && (
                  <label className="mt-2.5 inline-flex items-center gap-2 text-xs text-slate-600 dark:text-slate-300 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={clearToken}
                      onChange={(e) => setClearToken(e.target.checked)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span>Hapus token tersimpan</span>
                  </label>
                )}
              </Row>

              <Row
                label="Isi permintaan (JSON)"
                htmlFor="wa-body"
                error={err('body')}
                hint="Harus memuat {phone} (62812…) atau {phone_local} (0812…) dan {message}."
              >
                <textarea
                  id="wa-body"
                  rows={3}
                  value={form.body}
                  onChange={set('body')}
                  className={`${INPUT} font-mono text-xs`}
                  placeholder={BODY_EXAMPLE}
                />
              </Row>

              <div className="grid gap-4 sm:grid-cols-3">
                <Row
                  label="Jalur penanda sukses (opsional)"
                  htmlFor="wa-path"
                  error={err('success_path')}
                  hint='Contoh "status"; kosong = cukup HTTP 2xx.'
                >
                  <input
                    id="wa-path"
                    value={form.success_path}
                    onChange={set('success_path')}
                    className={INPUT}
                    autoComplete="off"
                  />
                </Row>
                <Row label="Nilai sukses" htmlFor="wa-value" error={err('success_value')}>
                  <input
                    id="wa-value"
                    value={form.success_value}
                    onChange={set('success_value')}
                    className={INPUT}
                    autoComplete="off"
                  />
                </Row>
                <Row label="Batas waktu (detik)" htmlFor="wa-timeout" error={err('timeout')}>
                  <input
                    id="wa-timeout"
                    type="number"
                    min={1}
                    max={60}
                    value={form.timeout}
                    onChange={set('timeout')}
                    className={INPUT}
                  />
                </Row>
              </div>
            </>
          )}

          <Row
            label="Kode negara bawaan"
            htmlFor="wa-cc"
            error={err('default_country_code')}
            hint="Dipakai mengubah 08xx menjadi 62 8xx."
          >
            <input
              id="wa-cc"
              value={form.default_country_code}
              onChange={set('default_country_code')}
              className={`${INPUT} sm:w-36`}
              autoComplete="off"
            />
          </Row>

          <div className="flex justify-end pt-3 border-t border-slate-100 dark:border-slate-800">
            <Button type="submit" loading={saving}>
              Simpan pengaturan
            </Button>
          </div>
        </form>
      )}

      {/* 6. Kotak Uji Kirim */}
      {showTest && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-5 sm:p-6 space-y-4">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Uji Kirim Pesan
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Mengirim satu pesan uji dengan pengaturan yang sudah tersimpan. Simpan dulu bila baru mengubah formulir.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row gap-3 sm:items-end">
            <div className="flex-1">
              <label htmlFor="wa-phone" className="block text-sm font-semibold text-slate-700 dark:text-slate-200">
                Nomor tujuan
              </label>
              <input
                id="wa-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className={INPUT}
                placeholder="08xxxxxxxxxx"
                inputMode="tel"
              />
            </div>
            <Button
              variant="secondary"
              loading={testing}
              disabled={!phone.trim()}
              onClick={sendTest}
              icon={IconSend}
            >
              Kirim pesan uji
            </Button>
          </div>
          {testResult && (
            <Alert kind={testResult.ok ? 'success' : 'error'}>
              {testResult.text}
            </Alert>
          )}
        </div>
      )}

      {/* 7. Riwayat & Log Aktivitas */}
      {showHistory && (
        <div className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-xs p-5 sm:p-6">
          <div className="border-b border-slate-100 dark:border-slate-800 pb-3 mb-3">
            <h2 className="text-base font-bold text-slate-900 dark:text-slate-100">
              Riwayat Aktivitas & Perubahan
            </h2>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Catatan audit konfigurasi dan riwayat uji kirim yang dilakukan oleh administrator.
            </p>
          </div>
          {events.length > 0 ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800 text-xs">
              {events.map((ev, i) => (
                <li key={i} className="py-2.5 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-2 h-2 rounded-full ${
                        ev.event_type === 'TEST_FAILED'
                          ? 'bg-rose-500'
                          : ev.event_type === 'TEST_SENT'
                          ? 'bg-emerald-500'
                          : 'bg-blue-500'
                      }`}
                    />
                    <span className="font-medium text-slate-800 dark:text-slate-200">
                      {EVENT_LABEL[ev.event_type] || ev.event_type}
                      {ev.details?.changed_fields?.length
                        ? `: ${ev.details.changed_fields.join(', ')}${
                            ev.details.token_changed ? ', token' : ''
                          }`
                        : ''}
                    </span>
                  </div>
                  <span className="text-slate-500 dark:text-slate-400 font-mono text-[11px]">
                    {ev.actor_email || '-'} ·{' '}
                    {ev.occurred_at ? new Date(ev.occurred_at).toLocaleString('id-ID') : ''}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-slate-500 dark:text-slate-400 py-4 text-center">
              Belum ada riwayat aktivitas atau pengujian yang tercatat.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
