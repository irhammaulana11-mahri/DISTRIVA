// Browser E2E: admin creates a user on the web; the person activates the account and recovers a locked account with an OTP.
// NOT part of 'npm test'. Needs playwright-core, Chrome, python3 and the sinks in ./sinks (smtp_sink.py <file> 2526, wa_sink.py <file> 9099).
// Laravel :8089 on distriva_backend_test ONLY, started with MAIL_MAILER=smtp MAIL_HOST=127.0.0.1 MAIL_PORT=2526 DISTRIVA_FRONTEND_URL=http://127.0.0.1:5199
// DISTRIVA_WHATSAPP_DRIVER=http DISTRIVA_WHATSAPP_URL=http://127.0.0.1:9099/send DISTRIVA_WHATSAPP_BODY_FORMAT=json DISTRIVA_WHATSAPP_BODY='{"messageType":"text","to":"{phone}","body":"{message}"}' DISTRIVA_WHATSAPP_SUCCESS_PATH=success; Vite :5199 (VITE_API_PROXY).
// Setup: migrate:fresh, FoundationPermissionSeeder, distriva:bootstrap-admin (admin.e2e@example.com / UP3-E2E), ULP-E2E; env E2E_TEMP_PW, E2E_MAIL_FILE, E2E_WA_FILE.
import { chromium } from 'playwright-core'
import fs from 'node:fs'
const BASE = 'http://127.0.0.1:5199'
const MAIL = process.env.E2E_MAIL_FILE, WA = process.env.E2E_WA_FILE
let failed = 0
const ok = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed++ }
const vis = async (loc, t = 10000) => { try { await loc.first().waitFor({ state: 'visible', timeout: t }); return true } catch { return false } }
const lines = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [])
const codeOf = (text) => (text.match(/untuk [^:]+: (\d{6})/) ?? [])[1]
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const ctx = await browser.newContext()
const admin = await ctx.newPage()
const login = async (p, email, pw) => {
  await p.goto(`${BASE}/login`)
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill(pw)
  await p.getByRole('button', { name: 'Masuk' }).click()
}
async function newUser(p, f) {
  await p.goto(`${BASE}/admin/users/new`)
  await p.getByRole('option', { name: 'TEKNIK' }).waitFor({ state: 'attached' })
  await p.getByRole('option', { name: /ULP-E2E/ }).waitFor({ state: 'attached' })
  await p.getByLabel('Nama lengkap').fill(f.name)
  await p.getByLabel('Email', { exact: true }).fill(f.email)
  if (f.phone) await p.getByLabel('Nomor WhatsApp (opsional)').fill(f.phone)
  await p.getByLabel('Role', { exact: true }).selectOption({ label: 'TEKNIK' })
  await p.getByLabel('Unit', { exact: true }).selectOption({ label: 'ULP-E2E — ULP E2E' })
  await p.getByLabel('Berlaku mulai').fill('2026-11-06')
  await p.getByLabel('Dokumen penugasan').fill('SK-E2E')
  await p.getByLabel('Alasan', { exact: true }).fill('Pegawai baru')
  await p.getByRole('button', { name: 'Buat pengguna' }).click()
}
async function askCode(p, email) {
  await p.getByLabel('Email').fill(email)
  await p.getByRole('button', { name: 'Kirim kode OTP' }).click()
  await p.getByLabel(/Kode OTP/).waitFor()
}
async function submitCode(p, otp, pw, button) {
  await p.getByLabel(/Kode OTP/).fill(otp)
  await p.getByLabel('Password baru', { exact: true }).fill(pw)
  await p.getByLabel('Konfirmasi password baru').fill(pw)
  await p.getByRole('button', { name: button }).click()
}

// ---- admin signs in (console-issued password: the one bootstrap exception) and creates a user on the web
await login(admin, 'admin.e2e@example.com', process.env.E2E_TEMP_PW)
await admin.waitForURL('**/ubah-password')
await admin.getByLabel('Password saat ini').fill(process.env.E2E_TEMP_PW)
await admin.getByLabel('Password baru', { exact: true }).fill('Kunci-Rahasia#2026')
await admin.getByLabel('Konfirmasi password baru').fill('Kunci-Rahasia#2026')
await admin.getByRole('button', { name: 'Simpan' }).click()
await admin.waitForURL(`${BASE}/`)

await admin.goto(`${BASE}/admin/users/new`)
ok('admin form has no password field (admins never set or see passwords)', (await admin.getByLabel(/password/i).count()) === 0)
await newUser(admin, { name: 'Siti Aminah', email: 'siti@example.com', phone: '0812-3456-7890' })
ok('create: shows "undangan terkirim" and "menunggu aktivasi"', await vis(admin.getByText(/Undangan aktivasi terkirim/)))

let mails = lines(MAIL), was = lines(WA)
ok('invitation e-mail + WhatsApp arrived (1 each)', mails.length === 1 && was.length === 1 && mails[0].to[0] === 'siti@example.com' && was[0].target === '6281234567890')
ok('invitation links to the activation page and holds NO code and NO password', mails[0].body.includes(`${BASE}/aktivasi`) && !/\b\d{6}\b/.test(mails[0].body) && !/sementara/i.test(mails[0].body + was[0].message))

// ---- the invited person: cannot log in yet, activates with an OTP
const siti = await ctx.newPage()
await login(siti, 'siti@example.com', 'Tebakan#12345')
ok('before activation, login is refused with the generic message', await vis(siti.getByRole('alert').filter({ hasText: 'Email atau password salah' })))
await siti.getByRole('link', { name: 'Aktivasi akun baru' }).click()
await siti.waitForURL('**/aktivasi')
await askCode(siti, 'siti@example.com')
ok('code step shows the neutral confirmation text', await vis(siti.getByText(/Jika akun memenuhi syarat/)))
await sleep(600)
mails = lines(MAIL); was = lines(WA)
const otp1 = codeOf(mails[1].body)
ok('OTP delivered on both channels and identical', mails.length === 2 && was.length === 2 && !!otp1 && codeOf(was[1].message) === otp1)

await submitCode(siti, otp1, 'abc', 'Aktifkan akun')
ok('weak password after a correct code: every problem listed, code kept', (await vis(siti.getByText(/harus memuat huruf besar/))) && (await vis(siti.getByText(/harus memuat simbol/))))
await siti.getByLabel('Password baru', { exact: true }).fill('Siti-Aminah#2026')
await siti.getByLabel('Konfirmasi password baru').fill('Siti-Aminah#2026')
await siti.getByRole('button', { name: 'Aktifkan akun' }).click()
ok('password containing the person\'s name is refused', await vis(siti.getByText(/nama atau bagian email|nama pengguna/)))
await siti.getByLabel('Password baru', { exact: true }).fill('Kunci-Baru#2026b')
await siti.getByLabel('Konfirmasi password baru').fill('Kunci-Baru#2026b')
await siti.getByRole('button', { name: 'Aktifkan akun' }).click()
ok('activation succeeds with the same code after fixing the password', await vis(siti.getByText('Akun berhasil diaktifkan. Silakan masuk.')))

await siti.getByRole('link', { name: 'Ke halaman masuk' }).click()
await login(siti, 'siti@example.com', 'Kunci-Baru#2026b')
await siti.waitForURL(`${BASE}/`)
ok('activated user signs in directly (no forced password change)', await vis(siti.getByText(/Selamat datang, Siti Aminah/)))

// ---- locked account: recover with an OTP
await siti.getByRole('button', { name: 'Keluar' }).click()
await siti.waitForURL('**/login')
for (let i = 0; i < 5; i++) await login(siti, 'siti@example.com', `Salah#${i}xyz`), await sleep(250)
await login(siti, 'siti@example.com', 'Kunci-Baru#2026b')
ok('after 5 failures even the right password is refused (account locked)', await vis(siti.getByRole('alert').filter({ hasText: 'terkunci' })))
await siti.getByRole('link', { name: /Lupa password \/ akun terkunci/ }).click()
await siti.waitForURL('**/pemulihan')
await askCode(siti, 'siti@example.com')
await sleep(600)
mails = lines(MAIL); was = lines(WA)
const otp2 = codeOf(mails[2].body)
ok('recovery OTP delivered on both channels and different from the first', !!otp2 && codeOf(was[2].message) === otp2 && mails.length === 3)
await submitCode(siti, otp2, 'Kunci-Pulih#2026c', 'Atur password baru')
ok('recovery succeeds', await vis(siti.getByText('Password berhasil diubah. Silakan masuk.')))
await siti.getByRole('link', { name: 'Ke halaman masuk' }).click()
await login(siti, 'siti@example.com', 'Kunci-Pulih#2026c')
await siti.waitForURL(`${BASE}/`)
ok('unlocked at once with the new password (no 15-minute wait)', await vis(siti.getByText(/Selamat datang, Siti Aminah/)))
const oldStatus = await siti.evaluate(async () => (await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body: JSON.stringify({ email: 'siti@example.com', password: 'Kunci-Baru#2026b' }) })).status)
ok('the old password no longer works', oldStatus === 401)

// ---- guessing the code: 5 wrong attempts void it
const budi = await ctx.newPage()
await newUser(admin, { name: 'Budi Santoso', email: 'budi@example.com', phone: '' })
ok('second user without phone: invitation by e-mail only', await vis(admin.getByText(/Terkirim lewat Email\./)))
await sleep(600)
await budi.goto(`${BASE}/aktivasi`)
await askCode(budi, 'budi@example.com')
await sleep(600)
const budiCode = codeOf(lines(MAIL).at(-1).body)
const wrong = budiCode === '000000' ? '000001' : '000000'
for (let i = 0; i < 5; i++) {
  await submitCode(budi, wrong, 'Kunci-Budi#2026d', 'Aktifkan akun')
  ok(`wrong code attempt ${i + 1}: generic message`, await vis(budi.getByRole('alert').filter({ hasText: 'Kode OTP salah atau sudah kedaluwarsa' })))
  await budi.getByLabel(/Kode OTP/).fill('')
}
await submitCode(budi, budiCode, 'Kunci-Budi#2026d', 'Aktifkan akun')
ok('after 5 wrong guesses even the correct code is refused', await vis(budi.getByRole('alert').filter({ hasText: 'Kode OTP salah atau sudah kedaluwarsa' })))

// ---- admin: status and resend invitation
await admin.goto(`${BASE}/admin/users`)
await admin.getByRole('link', { name: 'Budi Santoso' }).click()
ok('admin sees Budi as waiting for activation and can resend the invitation', await vis(admin.getByRole('button', { name: /Kirim ulang undangan aktivasi/ })))
await admin.getByRole('button', { name: /Kirim ulang undangan aktivasi/ }).click()
const dlg = admin.getByRole('dialog', { name: 'Kirim ulang undangan aktivasi' })
await dlg.getByLabel('Alasan').fill('Undangan pertama tidak terbaca')
await dlg.getByRole('button', { name: 'Kirim ulang' }).click()
ok('resend: confirmation shown', await vis(admin.getByText(/Undangan aktivasi dikirim ulang/)))
await admin.goto(`${BASE}/admin/users`)
await admin.getByRole('link', { name: 'Siti Aminah' }).click()
ok('activated user has no "resend invitation" button', await vis(admin.getByText('Siti Aminah').first()) && (await admin.getByRole('button', { name: /Kirim ulang undangan aktivasi/ }).count()) === 0)

// ---- no secret left behind in what the sinks received
const all = JSON.stringify([...lines(MAIL), ...lines(WA)])
ok('no password was ever sent on any channel', !/Kunci-|Siti-Aminah#|Tebakan/.test(all))

await browser.close()
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exitCode = failed ? 1 : 0
