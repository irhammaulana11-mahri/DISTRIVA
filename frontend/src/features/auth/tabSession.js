/**
 * Login yang dipakai bersama antar tab, tanpa menyimpan token di tempat yang tahan lama.
 *
 * Token tetap di sessionStorage (terpisah per tab, hilang saat tab ditutup). Tab baru yang belum punya token MEMINTANYA lewat BroadcastChannel dari tab DISTRIVA lain yang
 * sudah login; tab yang punya token menjawab, dan hanya kepada permintaan yang sedang menunggu. Selama minimal satu tab masih terbuka, tab baru langsung masuk; setelah semua tab
 * ditutup, login hilang seperti sebelumnya. BroadcastChannel hanya menjangkau halaman dengan origin yang sama. Logout di satu tab mengeluarkan tab lain.
 */
const CHANNEL = 'distriva-auth'
const WAIT_MS = 350

const newNonce = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`

export function createTabSession({ store, channelFactory } = {}) {
  const open = () => {
    try {
      return channelFactory ? channelFactory(CHANNEL) : (typeof BroadcastChannel !== 'undefined' ? new BroadcastChannel(CHANNEL) : null)
    } catch {
      return null
    }
  }
  const supported = () => {
    const ch = open()
    ch?.close?.()
    return Boolean(ch)
  }

  /** Meminta token dari tab lain; true bila diterima dan disimpan pada tab ini. */
  const adopt = (waitMs = WAIT_MS) => new Promise((resolve) => {
    if (store.get()) { resolve(true); return }
    const ch = open()
    if (!ch) { resolve(false); return }
    const nonce = newNonce()
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      clearTimeout(timer)
      try { ch.close() } catch { /* sudah tertutup */ }
      resolve(ok)
    }
    const timer = setTimeout(() => finish(false), waitMs)
    ch.onmessage = (e) => {
      const m = e?.data
      if (m && m.type === 'TOKEN' && m.nonce === nonce && typeof m.token === 'string' && m.token !== '') {
        store.set(m.token)
        finish(true)
      }
    }
    ch.postMessage({ type: 'REQUEST', nonce })
  })

  /** Menjawab permintaan tab lain (hanya bila tab ini punya token) dan menerima logout dari tab lain. Mengembalikan fungsi penutup. */
  const startResponder = (onRemoteLogout) => {
    const ch = open()
    if (!ch) return () => {}
    ch.onmessage = (e) => {
      const m = e?.data
      if (!m) return
      if (m.type === 'REQUEST' && typeof m.nonce === 'string') {
        const token = store.get()
        if (token) ch.postMessage({ type: 'TOKEN', nonce: m.nonce, token })
      } else if (m.type === 'LOGOUT') {
        store.clear()
        onRemoteLogout?.()
      }
    }
    return () => { try { ch.close() } catch { /* sudah tertutup */ } }
  }

  /** Memberi tahu tab lain bahwa pengguna keluar. */
  const announceLogout = () => {
    const ch = open()
    if (!ch) return
    try { ch.postMessage({ type: 'LOGOUT' }) } finally { ch.close() }
  }

  return { adopt, startResponder, announceLogout, supported }
}
