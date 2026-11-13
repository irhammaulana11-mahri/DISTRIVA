import { describe, it, expect, vi, afterEach } from 'vitest'
import { documentApi } from './api.js'

describe('documentApi.previewPdfBlob', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('returns a Blob that URL.createObjectURL can use (not the {blob, filename} wrapper)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200, headers: new Headers(), blob: async () => new Blob(['%PDF'], { type: 'application/pdf' }) }))
    const blob = await documentApi.previewPdfBlob('doc-1')
    expect(blob).toBeInstanceOf(Blob)
    expect(fetch.mock.calls[0][0]).toContain('/documents/doc-1/preview-pdf')
  })
})
