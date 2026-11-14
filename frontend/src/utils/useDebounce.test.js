import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useDebounce } from './useDebounce.js'

describe('useDebounce', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('returns initial value immediately', () => {
    const { result } = renderHook(() => useDebounce('hello', 300))
    expect(result.current).toBe('hello')
  })

  it('updates debounced value after specified delay', () => {
    const { result, rerender } = renderHook(({ val }) => useDebounce(val, 300), {
      initialProps: { val: 'initial' },
    })

    expect(result.current).toBe('initial')

    rerender({ val: 'updated' })
    // Before delay elapsed
    expect(result.current).toBe('initial')

    // Advance halfway
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(result.current).toBe('initial')

    // Advance rest of delay
    act(() => {
      vi.advanceTimersByTime(150)
    })
    expect(result.current).toBe('updated')
  })

  it('resets timer if value changes rapidly', () => {
    const { result, rerender } = renderHook(({ val }) => useDebounce(val, 300), {
      initialProps: { val: 'a' },
    })

    rerender({ val: 'ab' })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    expect(result.current).toBe('a')

    rerender({ val: 'abc' })
    act(() => {
      vi.advanceTimersByTime(200)
    })
    // 400ms passed total, but last change was only 200ms ago
    expect(result.current).toBe('a')

    act(() => {
      vi.advanceTimersByTime(100)
    })
    expect(result.current).toBe('abc')
  })
})
