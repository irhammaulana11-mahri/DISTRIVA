import { createContext, useContext, useEffect, useMemo, useState } from 'react'
import { adminApi, masterDataApi, applicationApi, surveyApi, drawingApi, mtoApi, backupApi, planningApi } from '../../services/api.js'
import { useAuth } from '../auth/AuthContext.jsx'

export const AccessContext = createContext({ loading: true, can: {}, canWrite: {}, createUnits: [], isSysAdmin: false })

// Loads what the signed-in user may do in administration and master data. UI hint only; the server enforces.
export function AccessProvider({ children }) {
  const { status, mustChangePassword, mfaState } = useAuth()
  const isSysAdmin = Boolean(mfaState?.required)
  const [state, setState] = useState({ loading: true, can: {}, canWrite: {}, isSysAdmin: false })

  useEffect(() => {
    if (status !== 'authenticated' || mustChangePassword) {
      setState({ loading: status === 'loading', can: {}, canWrite: {}, isSysAdmin })
      return undefined
    }
    let live = true
    Promise.allSettled([
      adminApi.access(),
      masterDataApi.access(),
      applicationApi.access(),
      surveyApi.access(),
      drawingApi.access(),
      mtoApi.access(),
      backupApi.access(),
      planningApi.access(),
    ])
      .then(([adminRes, mdRes, appRes, surveyRes, drawingRes, mtoRes, backupRes, planningRes]) => {
        if (!live) return
        const adminData = adminRes.status === 'fulfilled' ? adminRes.value : {}
        const mdData = mdRes.status === 'fulfilled' ? mdRes.value : {}
        const appData = appRes.status === 'fulfilled' ? appRes.value : {}
        const surveyData = surveyRes.status === 'fulfilled' ? surveyRes.value : {}
        const drawingData = drawingRes.status === 'fulfilled' ? drawingRes.value : {}
        const mtoData = mtoRes.status === 'fulfilled' ? mtoRes.value : {}
        const backupData = backupRes.status === 'fulfilled' ? backupRes.value : {}
        const planningData = planningRes.status === 'fulfilled' ? planningRes.value : {}

        const mergedCan = {
          ...(adminData.can ?? {}),
          ...(mdData.can ?? {}),
          ...(appData.can ?? {}),
          ...(surveyData.can ?? {}),
          ...(drawingData.can ?? {}),
          ...(mtoData.can ?? {}),
          ...(backupData.can ?? {}),
          ...(planningData.can ?? {}),
        }
        // Admin convenience: users with users.view / unit access can also view master data, applications, surveys, drawings, mto
        if (adminData.can?.['users.view'] || adminData.can?.['organizational_units.view']) {
          mergedCan['master_data.view'] = true
          mergedCan['applications.view'] = true
          mergedCan['surveys.view'] = true
          mergedCan['drawings.view'] = true
          mergedCan['mto.view'] = true
        }

        const mergedCanWrite = {
          ...(adminData.can_write ?? {}),
          ...(mdData.can ?? {}), // for master data, permissions in mdData.can are actions
          ...(appData.can ?? {}),
          ...(surveyData.can ?? {}),
          ...(drawingData.can ?? {}),
          ...(mtoData.can ?? {}),
          ...(backupData.can ?? {}),
          ...(planningData.can ?? {}),
        }

        setState({
          loading: false,
          can: mergedCan,
          canWrite: mergedCanWrite,
          createUnits: appData.create_units ?? [],
          isSysAdmin,
        })
      })
      .catch(() => live && setState({ loading: false, can: {}, canWrite: {}, createUnits: [], isSysAdmin }))
    return () => {
      live = false
    }
  }, [status, mustChangePassword, isSysAdmin])

  const value = useMemo(() => state, [state])
  return <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
}

export const useAccess = () => useContext(AccessContext)
