import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { authApi, mfaApi, setUnauthorizedHandler, tokenStore } from '../../services/api.js'
import { createTabSession } from './tabSession.js'

const tabSession = createTabSession({ store: { get: () => tokenStore.get(), set: (t) => tokenStore.set(t), clear: () => tokenStore.clear() } })      // lazy: tokenStore is read when used

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [mfaState, setMfaState] = useState(null)
  // 'loading' only while restoring a stored token, or while a new tab asks the other tabs for theirs (a fraction of a second).
  const [status, setStatus] = useState(() => (tokenStore.get() || tabSession.supported() ? 'loading' : 'guest'))

  const reset = useCallback(() => {
    tokenStore.clear()
    setUser(null)
    setMustChangePassword(false)
    setMfaState(null)
    setStatus('guest')
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(reset)
    let cancelled = false
    const stop = tabSession.startResponder(reset)         // another tab asks for the login, or logs out
    const restore = () => authApi.me()
      .then(async ({ user }) => {
        if (cancelled) return
        setUser(user)
        setMustChangePassword(Boolean(user.must_change_password))
        try {
          const mfaRes = await mfaApi.status()
          setMfaState(mfaRes?.mfa ?? { required: false, enrolled: false, verified: true })
        } catch (err) {
          if (err?.data?.mfa) {
            setMfaState(err.data.mfa)
          } else {
            setMfaState({ required: false, enrolled: false, verified: true })
          }
        }
        setStatus('authenticated')
      })
      .catch(reset)
    if (tokenStore.get()) {
      restore()
    } else {
      tabSession.adopt().then((got) => { if (cancelled) return; if (got) restore(); else setStatus((st) => (st === 'loading' ? 'guest' : st)) })      // a login made meanwhile is not undone
    }
    return () => { cancelled = true; stop() }
  }, [reset])

  const login = useCallback(async (email, password) => {
    const data = await authApi.login(email, password)
    tokenStore.set(data.token)
    setUser(data.user)
    setMustChangePassword(Boolean(data.must_change_password))
    setMfaState(data.mfa ?? { required: false, enrolled: false, verified: true })
    setStatus('authenticated')
    return data
  }, [])

  const logout = useCallback(async () => {
    try { await authApi.logout() } catch { /* token is dropped locally either way */ }
    reset()
    tabSession.announceLogout()                          // the other tabs hold the same (now revoked) token: sign them out too
  }, [reset])

  const passwordChanged = useCallback(() => setMustChangePassword(false), [])

  const setMfaVerified = useCallback((mfa) => {
    setMfaState(mfa ?? { required: true, enrolled: true, verified: true })
  }, [])

  const refreshMfaStatus = useCallback(async () => {
    try {
      const res = await mfaApi.status()
      const state = res?.mfa ?? { required: false, enrolled: false, verified: true }
      setMfaState(state)
      return state
    } catch (err) {
      if (err?.data?.mfa) {
        setMfaState(err.data.mfa)
        return err.data.mfa
      }
      return null
    }
  }, [])

  const mfaPending = Boolean(mfaState?.required && !mfaState?.verified)

  const value = useMemo(
    () => ({
      user,
      status,
      mustChangePassword,
      mfaState,
      mfaPending,
      login,
      logout,
      passwordChanged,
      setMfaVerified,
      refreshMfaStatus,
    }),
    [user, status, mustChangePassword, mfaState, mfaPending, login, logout, passwordChanged, setMfaVerified, refreshMfaStatus],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export const useAuth = () => {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    return {
      user: null,
      status: 'guest',
      login: async () => {},
      logout: async () => {},
      mustChangePassword: false,
      mfaState: null,
    }
  }
  return ctx
}
