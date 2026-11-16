import { describe, it, expect, vi } from 'vitest'
import { createTabSession } from './tabSession.js'

/** Saluran siaran dalam memori: pesan sampai ke instans lain bernama sama (seperti BroadcastChannel antar tab), tidak ke pengirimnya. */
function makeBus() {
  const all = []
  return (name) => {
    const ch = {
      name, onmessage: null, closed: false,
      postMessage(data) { all.filter((o) => o !== ch && !o.closed && o.name === name).forEach((o) => queueMicrotask(() => o.onmessage?.({ data }))) },
      close() { ch.closed = true },
    }
    all.push(ch)
    return ch
  }
}
const memoryStore = (token = null) => ({ token, get() { return this.token }, set(t) { this.token = t }, clear() { this.token = null } })

describe('login bersama antar tab', () => {
  it('tab baru tanpa token meminta dari tab yang sudah login dan menyimpannya di tabnya sendiri', async () => {
    const bus = makeBus()
    const logged = createTabSession({ store: memoryStore('TOKEN-A'), channelFactory: bus })
    const fresh = memoryStore()
    const newTab = createTabSession({ store: fresh, channelFactory: bus })
    const stop = logged.startResponder(() => {})
    expect(await newTab.adopt(200)).toBe(true)
    expect(fresh.get()).toBe('TOKEN-A')
    stop()
  })

  it('tanpa tab lain yang login, tab baru tidak mendapat apa-apa dan tidak menunggu lama', async () => {
    const bus = makeBus()
    const other = createTabSession({ store: memoryStore(null), channelFactory: bus })      // tab lain terbuka tetapi belum login: tidak menjawab
    const stop = other.startResponder(() => {})
    const store = memoryStore()
    const started = Date.now()
    expect(await createTabSession({ store, channelFactory: bus }).adopt(60)).toBe(false)
    expect(store.get()).toBeNull()
    expect(Date.now() - started).toBeLessThan(500)
    stop()
  })

  it('token hanya diberikan kepada permintaan yang sedang menunggu: jawaban asing atau yang kedaluwarsa diabaikan', async () => {
    const bus = makeBus()
    const store = memoryStore()
    const tab = createTabSession({ store, channelFactory: bus })
    const pending = tab.adopt(80)
    const attacker = bus('distriva-auth')
    attacker.postMessage({ type: 'TOKEN', nonce: 'bukan-nonce-saya', token: 'PALSU' })      // nonce yang tidak cocok
    expect(await pending).toBe(false)
    expect(store.get()).toBeNull()
  })

  it('tab yang sudah punya token tidak meminta, dan logout di satu tab mengeluarkan tab lain', async () => {
    const bus = makeBus()
    const storeA = memoryStore('TOKEN-A')
    const storeB = memoryStore('TOKEN-A')
    const a = createTabSession({ store: storeA, channelFactory: bus })
    const b = createTabSession({ store: storeB, channelFactory: bus })
    expect(await b.adopt(20)).toBe(true)                                                    // sudah punya: langsung
    const onLogout = vi.fn()
    const stop = b.startResponder(onLogout)
    a.announceLogout()
    await new Promise((r) => setTimeout(r, 10))
    expect(onLogout).toHaveBeenCalledTimes(1)
    expect(storeB.get()).toBeNull()
    stop()
  })

  it('tanpa BroadcastChannel (peramban lama) semuanya aman: tidak ada yang berubah', async () => {
    const t = createTabSession({ store: memoryStore(), channelFactory: () => { throw new Error('tidak ada') } })
    expect(t.supported()).toBe(false)
    expect(await t.adopt(20)).toBe(false)
    expect(() => t.startResponder(() => {})()).not.toThrow()
    expect(() => t.announceLogout()).not.toThrow()
  })
})
