// Browser E2E for the auth shell. NOT part of 'npm test'. Needs: playwright-core (npm i --no-save playwright-core),
// Google Chrome, Laravel on :8089 using DB distriva_backend_test only, Vite on :5199 with VITE_API_PROXY=http://127.0.0.1:8089,
// and a seeded ACTIVE user browser@example.com / Initial-pass-1 with must_change_password=true. Delete the user afterwards.
import { chromium } from 'playwright-core'
const BASE = 'http://127.0.0.1:5199'
const out = []
const vis = async (loc) => { try { await loc.waitFor({ state: 'visible', timeout: 8000 }); return true } catch { return false } }
const ok = (name, cond) => { console.log(`${cond ? "PASS" : "FAIL"}  ${name}`); if (!cond) process.exitCode = 1 }

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const page = await browser.newPage()

await page.goto(`${BASE}/profil`)
await page.waitForURL('**/login')
ok('guest on /profil is redirected to /login', true)

await page.getByLabel('Email').fill('browser@example.com')
await page.getByLabel('Password').fill('wrong-password')
await page.getByRole('button', { name: 'Masuk' }).click()
ok('wrong password shows generic error', await vis(page.getByRole('alert').filter({ hasText: 'Email atau password salah' })))

await page.getByLabel('Password').fill('Initial-pass-1')
await page.getByRole('button', { name: 'Masuk' }).click()
await page.waitForURL('**/ubah-password')
ok('must_change_password forces /ubah-password', await vis(page.getByText('harus mengubah password')))
ok('menu limited while forced (page rendered, no Profil link)', (await vis(page.getByRole('link', { name: 'Ubah password' }))) && (await page.getByRole('link', { name: 'Profil' }).count()) === 0)

const tok = await page.evaluate(() => ({ s: !!sessionStorage.getItem('distriva.token'), l: localStorage.getItem('distriva.token') }))
ok('token in sessionStorage, not localStorage', tok.s && tok.l === null)

await page.getByLabel('Password saat ini').fill('Initial-pass-1')
await page.getByLabel('Password baru', { exact: true }).fill('abc')
await page.getByLabel('Konfirmasi password baru').fill('abc')
await page.getByRole('button', { name: 'Simpan' }).click()
ok('weak password: all violations shown', (await vis(page.getByText('harus memuat huruf besar'))) && (await vis(page.getByText('harus memuat simbol'))))
ok('weak password: still on change page', page.url().endsWith('/ubah-password'))
await page.getByLabel('Password saat ini').fill('Initial-pass-1')
await page.getByLabel('Password baru', { exact: true }).fill('Changed-Pass#2')
await page.getByLabel('Konfirmasi password baru').fill('Changed-Pass#2')
await page.getByRole('button', { name: 'Simpan' }).click()
await page.waitForURL(`${BASE}/`)
ok('after password change lands on home', await vis(page.getByText('Selamat datang, Browser User')))

await page.getByRole('link', { name: 'Profil' }).click()
await page.waitForURL('**/profil')
ok('profile shows email', await vis(page.getByText('browser@example.com')))

await page.reload()
ok('session restored after reload', await vis(page.getByText('browser@example.com')))

const saved = await page.evaluate(() => sessionStorage.getItem('distriva.token'))
await page.getByRole('button', { name: 'Keluar' }).click()
await page.waitForURL('**/login')
ok('logout returns to /login', true)
ok('token cleared on logout', (await page.evaluate(() => sessionStorage.getItem('distriva.token'))) === null)

const status = await page.evaluate(async (t) => (await fetch('/api/me', { headers: { Authorization: `Bearer ${t}`, Accept: 'application/json' } })).status, saved)
ok('revoked token rejected by server (401)', status === 401)

await page.evaluate((t) => sessionStorage.setItem('distriva.token', t), saved)
await page.goto(`${BASE}/profil`)
await page.waitForURL('**/login')
ok('stale stored token -> back to login', (await page.evaluate(() => sessionStorage.getItem('distriva.token'))) === null)

await page.getByLabel('Email').fill('browser@example.com')
await page.getByLabel('Password').fill('Changed-Pass#2')
await page.getByRole('button', { name: 'Masuk' }).click()
try { await page.waitForURL('**/profil'); ok('login with new password returns to originally requested page', await vis(page.getByText('browser@example.com'))) }
catch { ok('login with new password works', false); console.log('URL', page.url(), '|', (await page.locator('body').innerText()).slice(0, 300).replace(/\n/g, ' / ')) }

await page.setViewportSize({ width: 390, height: 800 })
ok('mobile: menu button visible', await page.getByRole('button', { name: 'Menu' }).isVisible())

await browser.close()

