import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import { authApi, mfaApi, setUnauthorizedHandler, tokenStore } from '../../services/api.js'

export const AuthContext = createContext(null)

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [mustChangePassword, setMustChangePassword] = useState(false)
  const [mfaState, setMfaState] = useState(null)
  // 'loading' only while restoring a stored token.
  const [status, setStatus] = useState(tokenStore.get() ? 'loading' : 'guest')

  const reset = useCallback(() => {
    tokenStore.clear()
    setUser(null)
    setMustChangePassword(false)
    setMfaState(null)
    setStatus('guest')
  }, [])

  useEffect(() => {
    setUnauthorizedHandler(reset)
    if (!tokenStore.get()) return
    authApi.me()
      .then(async ({ user }) => {
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
