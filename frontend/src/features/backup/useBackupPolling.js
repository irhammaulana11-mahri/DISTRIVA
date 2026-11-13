import { useEffect, useRef } from 'react'

/**
 * Custom hook to manage polling intervals with auto-pause on document hidden
 * and automatic cleanup on unmount.
 */
export function useBackupPolling(callback, intervalMs = 5000, enabled = true) {
  const savedCallback = useRef(callback)
  savedCallback.current = callback

  useEffect(() => {
    if (!enabled) return undefined

    let timerId = null

    const tick = () => {
      if (document.visibilityState === 'visible') {
        savedCallback.current?.()
      }
    }

    const startTimer = () => {
      if (!timerId && document.visibilityState === 'visible') {
        timerId = setInterval(tick, intervalMs)
      }
    }

    const stopTimer = () => {
      if (timerId) {
        clearInterval(timerId)
        timerId = null
      }
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        // Run immediately when re-focused and restart interval
        tick()
        startTimer()
      } else {
        stopTimer()
      }
    }

    startTimer()
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      stopTimer()
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [intervalMs, enabled])
}
