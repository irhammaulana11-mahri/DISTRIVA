import { useState, useEffect } from 'react'

/**
 * useDebounce hook
 * Delays updating the debounced value until after the specified delay
 * has elapsed since the last time the input value changed.
 *
 * @template T
 * @param {T} value
 * @param {number} [delay=350]
 * @returns {T}
 */
export function useDebounce(value, delay = 350) {
  const [debouncedValue, setDebouncedValue] = useState(value)

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value)
    }, delay)

    return () => {
      clearTimeout(handler)
    }
  }, [value, delay])

  return debouncedValue
}

export default useDebounce
