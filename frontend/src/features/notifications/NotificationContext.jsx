import { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { IconCheck, IconExclamation, IconX } from '../../components/icons.jsx'
import * as AuthModule from '../auth/AuthContext.jsx'
import * as ApiModule from '../../services/api.js'

const NotificationContext = createContext(null)

const LEGACY_STORAGE_KEY = 'distriva.notifications.v1'

function getNotificationsApi() {
  try {
    return ApiModule.notificationsApi || null
  } catch {
    return null
  }
}

export function formatRelativeTime(createdAt) {
  if (!createdAt) return 'Baru saja'
  const ts = new Date(createdAt).getTime()
  if (Number.isNaN(ts)) return String(createdAt)
  const diffSec = Math.max(0, Math.floor((Date.now() - ts) / 1000))
  if (diffSec < 60) return 'Baru saja'
  const diffMin = Math.floor(diffSec / 60)
  if (diffMin < 60) return `${diffMin} mnt lalu`
  const diffHour = Math.floor(diffMin / 60)
  if (diffHour < 24) return `${diffHour} jam lalu`
  const diffDay = Math.floor(diffHour / 24)
  return `${diffDay} hari lalu`
}

const hasUseAuth = (() => {
  try {
    return typeof AuthModule.useAuth === 'function'
  } catch {
    return false
  }
})()

const resolvedAuthContext = (() => {
  try {
    return AuthModule.AuthContext || null
  } catch {
    return null
  }
})()

export function NotificationProvider({ children, pollIntervalMs = 60000 }) {
  const authFromHook = hasUseAuth ? AuthModule.useAuth() : null
  const authFromCtx = resolvedAuthContext ? useContext(resolvedAuthContext) : null
  const auth = authFromHook ?? authFromCtx

  const isMfaPending = Boolean(
    auth?.mfaPending ?? (auth?.mfaState?.required && !auth?.mfaState?.verified)
  )
  const isAuthenticated = Boolean(
    auth &&
      auth.status === 'authenticated' &&
      !auth.mustChangePassword &&
      !isMfaPending
  )
  const authUserId = auth?.user?.id ?? auth?.user?.email ?? null

  const [items, setItems] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [toast, setToast] = useState(null)

  const itemsRef = useRef(items)
  itemsRef.current = items
  const seenIdsRef = useRef(new Set())
  const initialLoadedRef = useRef(false)
  const mountedRef = useRef(true)
  const sessionSeqRef = useRef(0)

  // Clean up legacy localStorage key once on mount
  useEffect(() => {
    try {
      if (typeof window !== 'undefined' && window.localStorage) {
        window.localStorage.removeItem(LEGACY_STORAGE_KEY)
      }
    } catch {
      // ignore storage errors
    }
  }, [])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  // Auto-dismiss active toast badge after 4.5 seconds
  useEffect(() => {
    if (!toast) return undefined
    const timer = setTimeout(() => {
      setToast(null)
    }, 4500)
    return () => clearTimeout(timer)
  }, [toast])

  const fetchNotifications = useCallback(async (isInitial = false) => {
    const reqSession = sessionSeqRef.current
    const api = getNotificationsApi()
    if (typeof api?.list !== 'function') {
      if (mountedRef.current && isInitial && reqSession === sessionSeqRef.current) {
        setLoading(false)
      }
      return
    }

    if (isInitial && mountedRef.current) {
      setLoading(true)
    }

    try {
      const res = await api.list({ per_page: 30 })
      if (!mountedRef.current || reqSession !== sessionSeqRef.current) return

      const list = Array.isArray(res?.data) ? res.data : []
      const serverUnread =
        typeof res?.meta?.unread_count === 'number'
          ? res.meta.unread_count
          : list.filter((n) => !n.read_at).length

      if (!initialLoadedRef.current) {
        list.forEach((n) => {
          if (n?.id) seenIdsRef.current.add(n.id)
        })
        initialLoadedRef.current = true
      } else {
        const newUnread = list.filter(
          (n) => n?.id && !n.read_at && !seenIdsRef.current.has(n.id)
        )
        list.forEach((n) => {
          if (n?.id) seenIdsRef.current.add(n.id)
        })
        if (newUnread.length > 0) {
          const newest = newUnread[0]
          setToast({
            id: `srv-${newest.id}`,
            title: newest.title || 'Notifikasi Baru',
            desc: newest.body || '',
            tag: newest.tag || 'Sistem',
            type: newest.level || 'info',
            link: newest.link || null,
          })
        }
      }

      setItems(list)
      setUnreadCount(serverUnread)
      setError(null)
    } catch (err) {
      if (!mountedRef.current || reqSession !== sessionSeqRef.current) return
      setError(err?.message || 'Gagal memuat notifikasi.')
    } finally {
      if (isInitial && mountedRef.current && reqSession === sessionSeqRef.current) {
        setLoading(false)
      }
    }
  }, [])

  // Load when authenticated and poll periodically (reset on logout or account switch)
  useEffect(() => {
    sessionSeqRef.current += 1

    if (!isAuthenticated) {
      setItems([])
      setUnreadCount(0)
      setError(null)
      setLoading(false)
      seenIdsRef.current.clear()
      initialLoadedRef.current = false
      return undefined
    }

    seenIdsRef.current.clear()
    initialLoadedRef.current = false
    setItems([])
    setUnreadCount(0)
    setError(null)

    fetchNotifications(true)

    if (!pollIntervalMs || pollIntervalMs <= 0) {
      return () => {
        sessionSeqRef.current += 1
      }
    }

    const intervalId = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState === 'hidden') {
        return
      }
      fetchNotifications(false)
    }, pollIntervalMs)

    const handleVisibilityChange = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        fetchNotifications(false)
      }
    }

    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', handleVisibilityChange)
    }

    return () => {
      sessionSeqRef.current += 1
      clearInterval(intervalId)
      if (typeof document !== 'undefined') {
        document.removeEventListener('visibilitychange', handleVisibilityChange)
      }
    }
  }, [isAuthenticated, authUserId, pollIntervalMs, fetchNotifications])

  // Toast-only action feedback (does NOT add to the bell list)
  const notify = useCallback((arg1, arg2 = 'success') => {
    const payload =
      typeof arg1 === 'string'
        ? {
            title:
              arg2 === 'error'
                ? 'Proses Gagal'
                : arg2 === 'warning'
                ? 'Peringatan'
                : 'Proses Berhasil',
            desc: arg1,
            tag: 'Sistem',
            type: arg2,
            link: null,
            showToast: true,
          }
        : {
            title:
              arg1?.title ||
              (arg1?.type === 'error' ? 'Proses Gagal' : 'Pemberitahuan'),
            desc: arg1?.desc ?? arg1?.body ?? '',
            tag: arg1?.tag || 'Sistem',
            type: arg1?.type || arg1?.level || 'success',
            link: arg1?.link || null,
            showToast: arg1?.showToast ?? true,
          }

    if (payload.showToast) {
      setToast({
        id: `toast-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`,
        title: payload.title,
        desc: payload.desc,
        tag: payload.tag,
        type: payload.type,
        link: payload.link,
      })
    }
  }, [])

  const markRead = useCallback(async (id) => {
    if (!id) return
    const target = itemsRef.current.find((item) => item.id === id)
    if (target && !target.read_at) {
      setUnreadCount((prev) => Math.max(0, prev - 1))
    }
    const nowIso = new Date().toISOString()
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, read_at: item.read_at || nowIso } : item
      )
    )

    const api = getNotificationsApi()
    if (typeof api?.markRead === 'function') {
      try {
        await api.markRead(id)
      } catch {
        // fail-safe: do not crash UI
      }
    }
  }, [])

  const markAllRead = useCallback(async () => {
    const nowIso = new Date().toISOString()
    setItems((prev) =>
      prev.map((item) => (item.read_at ? item : { ...item, read_at: nowIso }))
    )
    setUnreadCount(0)

    const api = getNotificationsApi()
    if (typeof api?.markAllRead === 'function') {
      try {
        await api.markAllRead()
      } catch {
        // fail-safe: do not crash UI
      }
    }
  }, [])

  const clearToast = useCallback(() => {
    setToast(null)
  }, [])

  const notifications = useMemo(
    () =>
      items.map((item) => ({
        id: item.id,
        level: item.level || 'info',
        type: item.level || item.type || 'info',
        title: item.title || '',
        body: item.body ?? item.desc ?? '',
        desc: item.body ?? item.desc ?? '',
        tag: item.tag || 'Sistem',
        link: item.link ?? null,
        read_at: item.read_at ?? null,
        unread: !item.read_at,
        created_at: item.created_at ?? null,
      })),
    [items]
  )

  const value = useMemo(
    () => ({
      notifications,
      unreadCount,
      loading,
      error,
      notify,
      markRead,
      toggleRead: markRead,
      markAllRead,
      markAllAsRead: markAllRead,
      refresh: () => fetchNotifications(false),
      clearToast,
    }),
    [notifications, unreadCount, loading, error, notify, markRead, markAllRead, fetchNotifications, clearToast]
  )

  return (
    <NotificationContext.Provider value={value}>
      {children}

      {/* Floating Toast Notification Badge (Top-Right) */}
      {toast && (
        <aside
          role="status"
          aria-live="polite"
          className="fixed top-20 right-4 sm:right-6 z-[100] max-w-sm w-full animate-in fade-in slide-in-from-top-4 duration-200"
        >
          <div
            className={`rounded-2xl border p-4 shadow-2xl flex items-start gap-3 ${
              toast.type === 'error'
                ? 'border-rose-300 dark:border-rose-800 bg-white dark:bg-slate-900 shadow-rose-900/15'
                : toast.type === 'warning'
                ? 'border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 shadow-amber-900/15'
                : 'border-slate-200/90 dark:border-slate-700/80 bg-white dark:bg-slate-900 shadow-slate-900/10'
            }`}
          >
            <div
              className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-xl ${
                toast.type === 'warning'
                  ? 'bg-amber-100 dark:bg-amber-950/60 text-amber-600 dark:text-amber-400'
                  : toast.type === 'error'
                  ? 'bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                  : toast.type === 'info'
                  ? 'bg-blue-100 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400'
                  : 'bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {toast.type === 'warning' || toast.type === 'error' ? (
                <IconExclamation size={16} />
              ) : (
                <IconCheck size={16} />
              )}
            </div>

            <div className="flex-1 min-w-0">
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider ${
                      toast.type === 'error'
                        ? 'bg-rose-600 text-white'
                        : toast.type === 'warning'
                        ? 'bg-amber-600 text-white'
                        : toast.type === 'info'
                        ? 'bg-blue-600 text-white'
                        : 'bg-emerald-600 text-white'
                    }`}
                  >
                    {toast.type === 'error'
                      ? 'GAGAL'
                      : toast.type === 'warning'
                      ? 'PERINGATAN'
                      : toast.type === 'info'
                      ? 'INFO'
                      : 'BERHASIL'}
                  </span>
                  <span className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                    {toast.title}
                  </span>
                </div>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 shrink-0">
                  {toast.tag}
                </span>
              </div>
              <p className="mt-1 text-xs text-slate-600 dark:text-slate-300 leading-snug">
                {toast.type === 'error' ? `[${toast.tag}] ${toast.desc}` : toast.desc}
              </p>
            </div>

            <button
              type="button"
              onClick={clearToast}
              aria-label="Tutup notifikasi"
              className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
            >
              <IconX size={15} />
            </button>
          </div>
        </aside>
      )}
    </NotificationContext.Provider>
  )
}

const fallbackContext = {
  notifications: [],
  unreadCount: 0,
  loading: false,
  error: null,
  notify: () => {},
  markRead: () => {},
  toggleRead: () => {},
  markAllRead: () => {},
  markAllAsRead: () => {},
  refresh: () => {},
  clearToast: () => {},
}

export function useNotifications() {
  const ctx = useContext(NotificationContext)
  return ctx || fallbackContext
}
