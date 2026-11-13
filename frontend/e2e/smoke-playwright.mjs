// Smoke check that Playwright can drive the app. Usage: node e2e/smoke-playwright.mjs [url] [out.png]
import { chromium } from 'playwright'
const url = process.argv[2] ?? 'http://127.0.0.1:5173/login'
const out = process.argv[3] ?? 'smoke.png'
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } })
const errors = []
page.on('pageerror', (e) => errors.push(e.message))
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
await page.goto(url, { waitUntil: 'networkidle' })
console.log('title:', await page.title())
console.log('tombol Masuk terlihat:', await page.getByRole('button', { name: 'Masuk' }).isVisible())
console.log('galat konsol:', errors.length ? errors : 'tidak ada')
await page.screenshot({ path: out })
await browser.close()
