// Browser E2E for the admin UI. NOT part of 'npm test'. Needs playwright-core, Chrome, Laravel :8089 + Vite :5199 (VITE_API_PROXY) on distriva_backend_test ONLY.
// Setup (see test-evidence/2026-11-06-admin-ui.md): migrate:fresh, FoundationPermissionSeeder, distriva:bootstrap-admin (admin.e2e@example.com / UP3-E2E),
// seed ULP-E2E, UP3-OTHER, staf1/staf2 (TEKNIK, must_change_password) and luar@example.com; pass E2E_TEMP_PW and E2E_STAFF_PW. Clean up with migrate:fresh on the test DB.
import { chromium } from 'playwright-core'
const BASE = 'http://127.0.0.1:5199'
const PW0 = process.env.E2E_TEMP_PW
const NEWPW = 'Kunci-Rahasia#2026'
const STAFF_PW = process.env.E2E_STAFF_PW
let failed = 0
const ok = (name, cond) => { console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}`); if (!cond) failed++ }
const vis = async (loc, t = 8000) => { try { await loc.first().waitFor({ state: 'visible', timeout: t }); return true } catch { return false } }
const gone = async (loc, t = 4000) => { try { await loc.first().waitFor({ state: 'hidden', timeout: t }); return true } catch { return false } }

const browser = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] })
const ctx = await browser.newContext()
const page = await ctx.newPage()
const login = async (p, email, pw) => {
  await p.goto(`${BASE}/login`)
  await p.getByLabel('Email').fill(email)
  await p.getByLabel('Password').fill(pw)
  await p.getByRole('button', { name: 'Masuk' }).click()
}

// --- first admin created by the console command: forced password change
await login(page, 'admin.e2e@example.com', PW0)
await page.waitForURL('**/ubah-password')
ok('bootstrap admin is forced to change the temporary password', await vis(page.getByText('harus mengubah password')))
await page.getByLabel('Password saat ini').fill(PW0)
await page.getByLabel('Password baru', { exact: true }).fill(NEWPW)
await page.getByLabel('Konfirmasi password baru').fill(NEWPW)
await page.getByRole('button', { name: 'Simpan' }).click()
await page.waitForURL(`${BASE}/`)

// --- navigation reflects server capabilities
ok('admin sees Pengguna menu', await vis(page.getByRole('link', { name: 'Pengguna' })))
ok('admin sees Unit organisasi menu', await vis(page.getByRole('link', { name: 'Unit organisasi' })))

// --- units: scope
await page.getByRole('link', { name: 'Unit organisasi' }).click()
ok('units: own UP3 listed', await vis(page.getByText('UP3-E2E')))
ok('units: child ULP listed', await vis(page.getByText('ULP-E2E')))
ok('units: other UP3 NOT listed', (await page.getByText('UP3-OTHER').count()) === 0)

// --- users: scope
await page.getByRole('link', { name: 'Pengguna' }).click()
ok('users: staff in scope listed', await vis(page.getByRole('link', { name: 'Staf Satu' })))
ok('users: outsider in other UP3 NOT listed', (await page.getByText('Orang Luar').count()) === 0)
await page.getByLabel('Cari nama / email').fill('satu')
await page.getByRole('button', { name: 'Terapkan' }).click()
ok('users: search filters the list', await gone(page.getByRole('link', { name: 'Admin E2E' })))

// --- detail: add assignment
await page.getByRole('link', { name: 'Staf Satu' }).click()
ok('detail: existing assignment shown', await vis(page.getByRole('cell', { name: 'TEKNIK' })))
await page.getByLabel('Role', { exact: true }).waitFor()
await page.getByRole('option', { name: 'VIEWER' }).waitFor({ state: 'attached' })
await page.getByLabel('Role', { exact: true }).selectOption({ label: 'VIEWER' })
await page.getByLabel('Unit', { exact: true }).selectOption({ label: 'ULP-E2E — ULP E2E' })
await page.getByLabel('Berlaku mulai').fill('2026-01-01')
await page.getByLabel('Alasan', { exact: true }).fill('Tugas tambahan')
await page.getByRole('button', { name: 'Tambah penugasan' }).click()
ok('detail: missing document is reported by the server', await vis(page.getByText(/assignment document field is required/i)))
await page.getByLabel('Dokumen penugasan').fill('SK-E2E-01')
await page.getByRole('button', { name: 'Tambah penugasan' }).click()
ok('detail: assignment added', await vis(page.getByText('Penugasan ditambahkan.')))
ok('detail: new VIEWER row visible', await vis(page.getByRole('cell', { name: 'VIEWER' })))
ok('detail: SYS_ADMIN/VENDOR are not offered as roles', (await page.getByRole('option', { name: 'SYS_ADMIN' }).count()) === 0 && (await page.getByRole('option', { name: 'VENDOR' }).count()) === 0)

// --- end assignment (reason required)
const viewerRow = page.getByRole('row').filter({ hasText: 'VIEWER' })
await viewerRow.getByRole('button', { name: 'Akhiri' }).click()
const dlg = page.getByRole('dialog', { name: 'Akhiri penugasan' })
await dlg.getByRole('button', { name: 'Akhiri penugasan' }).click()
ok('end: empty reason is refused client-side', await vis(dlg.getByText('Alasan wajib diisi.')))
await dlg.getByLabel('Alasan').fill('Tugas tambahan selesai')
await dlg.getByRole('button', { name: 'Akhiri penugasan' }).click()
ok('end: assignment ended', await vis(page.getByText('Penugasan diakhiri.')))
ok('end: row now shows Berakhir', await vis(page.getByRole('row').filter({ hasText: 'VIEWER' }).getByText('Berakhir')))

// --- change status
await page.getByLabel('Ubah status menjadi').selectOption('SUSPENDED')
await page.getByRole('button', { name: 'Ubah status…' }).click()
const sdlg = page.getByRole('dialog', { name: 'Ubah status akun' })
await sdlg.getByLabel('Alasan').fill('Cuti panjang')
await sdlg.getByRole('button', { name: 'Ubah status' }).click()
ok('status: updated', await vis(page.getByText('Status akun diperbarui.')))
ok('status: badge shows Ditangguhkan', await vis(page.locator('section').filter({ hasText: 'Staf Satu' }).getByText('Ditangguhkan', { exact: true })))

// --- suspended staff cannot log in; own status change is refused by the server
const p2 = await ctx.newPage()
await login(p2, 'staf1@example.com', STAFF_PW)
ok('suspended user cannot log in (generic error)', await vis(p2.getByRole('alert').filter({ hasText: 'Email atau password salah' })))
await p2.close()

await page.getByRole('link', { name: 'Pengguna' }).click()
await page.getByLabel('Cari nama / email').fill('')
await page.getByRole('button', { name: 'Terapkan' }).click()
await page.getByRole('link', { name: 'Admin E2E' }).click()
await page.getByLabel('Ubah status menjadi').selectOption('SUSPENDED')
await page.getByRole('button', { name: 'Ubah status…' }).click()
const self = page.getByRole('dialog', { name: 'Ubah status akun' })
await self.getByLabel('Alasan').fill('uji')
await self.getByRole('button', { name: 'Ubah status' }).click()
ok('self status change refused by the server (dialog stays open)', await vis(self.getByRole('alert').filter({ hasText: 'Tidak boleh mengubah status akun sendiri' })))
await self.getByRole('button', { name: 'Batal' }).click()

// --- a plain staff member has no admin UI and gets nothing from direct URLs
const p3 = await ctx.newPage()
await login(p3, 'staf2@example.com', STAFF_PW)
await p3.waitForURL('**/ubah-password')
await p3.getByLabel('Password saat ini').fill(STAFF_PW)
await p3.getByLabel('Password baru', { exact: true }).fill('Kunci-Dua#2026x')
await p3.getByLabel('Konfirmasi password baru').fill('Kunci-Dua#2026x')
await p3.getByRole('button', { name: 'Simpan' }).click()
await p3.waitForURL(`${BASE}/`)
ok('plain user: no Pengguna menu', (await p3.getByRole('link', { name: 'Pengguna' }).count()) === 0)
await p3.goto(`${BASE}/admin/users`)
ok('plain user: direct admin URL shows not found', await vis(p3.getByText('Halaman tidak ditemukan')))
const status = await p3.evaluate(async () => (await fetch('/api/admin/users', { headers: { Authorization: `Bearer ${sessionStorage.getItem('distriva.token')}`, Accept: 'application/json' } })).status)
ok('plain user: API itself answers 403', status === 403)

// --- mobile
await page.setViewportSize({ width: 390, height: 800 })
ok('mobile: menu button visible', await vis(page.getByRole('button', { name: 'Menu' })))

await browser.close()
console.log(failed === 0 ? 'ALL PASS' : `${failed} FAILED`)
process.exitCode = failed ? 1 : 0
