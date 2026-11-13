import { useEffect, useState } from 'react'
import { documentApi } from '../../services/api'

const SHEET_EXT = ['xlsx', 'xls', 'csv']
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp']

export function canPreview(doc) {
  const ext = String(doc?.extension || '').toLowerCase()
  return SHEET_EXT.includes(ext) || ext === 'pdf' || IMAGE_EXT.includes(ext)
}

/** Pratinjau berkas gambar langsung di halaman: tabel untuk Excel/CSV, penampil untuk PDF dan gambar. */
export default function DocumentPreview({ doc }) {
  const ext = String(doc?.extension || '').toLowerCase()
  const [state, setState] = useState({ loading: true, error: '', sheets: null, url: null })
  const [active, setActive] = useState(0)
  const [mode, setMode] = useState('gambar') // 'gambar' (render PDF seperti di Excel) | 'tabel'
  const [render, setRender] = useState({ status: 'idle', url: null, error: '' })

  useEffect(() => {
    let alive = true
    let objectUrl = null
    setState({ loading: true, error: '', sheets: null, url: null })
    setActive(0)
    ;(async () => {
      try {
        if (SHEET_EXT.includes(ext)) {
          const res = await documentApi.preview(doc.id)
          if (alive) setState({ loading: false, error: '', sheets: res.data?.sheets || [], renderAvailable: Boolean(res.data?.render_available), url: null })
        } else {
          const blob = await documentApi.downloadBlob(doc.id, { inline: true })
          objectUrl = URL.createObjectURL(blob)
          if (alive) setState({ loading: false, error: '', sheets: null, url: objectUrl })
        }
      } catch (err) {
        if (alive) setState({ loading: false, error: err.message || 'Pratinjau gagal dimuat; silakan unduh berkas.', sheets: null, url: null })
      }
    })()
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [doc?.id, ext])

  // Render ala Excel (bentuk, simbol, tata letak) lewat PDF; hanya dimuat bila server punya mesin render
  const renderOn = Boolean(state.sheets && state.renderAvailable && mode === 'gambar')
  useEffect(() => {
    if (!renderOn) return undefined
    let alive = true
    let objectUrl = null
    setRender({ status: 'loading', url: null, error: '' })
    documentApi.previewPdfBlob(doc.id)
      .then((blob) => {
        objectUrl = URL.createObjectURL(blob)
        if (alive) setRender({ status: 'ok', url: objectUrl, error: '' })
      })
      .catch((err) => {
        if (alive) {
          setRender({ status: 'error', url: null, error: err.message || 'Render gagal.' })
          setMode('tabel')
        }
      })
    return () => {
      alive = false
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [renderOn, doc?.id])

  if (state.loading) return <p className="text-xs text-slate-400 py-6 text-center">Memuat pratinjau…</p>
  if (state.error) return <p role="alert" className="text-xs text-rose-600 py-3">{state.error}</p>

  if (state.sheets) {
    const sheet = state.sheets[active]
    if (!sheet) return <p className="text-xs text-slate-400 py-3">Berkas tidak berisi data.</p>
    const toggle = state.renderAvailable && (
      <div className="inline-flex rounded-lg bg-slate-100 dark:bg-slate-800 p-0.5" role="group" aria-label="Mode pratinjau">
        {[['gambar', 'Tampilan Gambar'], ['tabel', 'Tabel']].map(([k, label]) => (
          <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)}
            className={`px-3 py-1 rounded-md text-[11px] font-semibold ${mode === k ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm' : 'text-slate-500'}`}>
            {label}
          </button>
        ))}
      </div>
    )
    if (renderOn) {
      return (
        <div className="space-y-2">
          {toggle}
          {render.status === 'ok' ? (
            <iframe title={`Pratinjau ${doc.original_name}`} src={render.url} className="w-full h-[32rem] rounded-lg border border-slate-200 dark:border-slate-700 bg-white" />
          ) : (
            <p className="text-xs text-slate-400 py-8 text-center">Menyiapkan tampilan gambar… (pertama kali bisa beberapa detik)</p>
          )}
        </div>
      )
    }
    return (
      <div className="space-y-2">
        {toggle}
        {render.status === 'error' && <p role="alert" className="text-[11px] text-amber-600">{render.error} Menampilkan tabel.</p>}
        {state.sheets.length > 1 && (
          <div className="flex flex-wrap gap-1" role="tablist" aria-label="Lembar kerja">
            {state.sheets.map((s, i) => (
              <button
                key={s.name + i}
                type="button"
                role="tab"
                aria-selected={i === active}
                onClick={() => setActive(i)}
                className={`px-2.5 py-1 rounded-md text-[11px] font-semibold border ${i === active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700'}`}
              >
                {s.name}
              </button>
            ))}
          </div>
        )}
        <div className="max-h-96 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="min-w-full text-[11px] border-collapse">
            <tbody>
              {sheet.rows.map((row, r) => (
                <tr key={r} className={r === 0 ? 'bg-slate-100 dark:bg-slate-800 font-semibold sticky top-0' : 'odd:bg-white even:bg-slate-50/60 dark:odd:bg-slate-900 dark:even:bg-slate-900/60'}>
                  <td className="px-2 py-1 text-slate-400 border border-slate-100 dark:border-slate-800 text-right select-none">{r + 1}</td>
                  {row.map((cell, c) => (
                    <td key={c} className="px-2 py-1 border border-slate-100 dark:border-slate-800 whitespace-nowrap text-slate-700 dark:text-slate-200">{cell}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {sheet.images?.length > 0 && (
          <div className="space-y-2">
            <p className="text-[11px] font-semibold text-slate-500">Gambar di dalam lembar ({sheet.images.length})</p>
            <div className="flex flex-wrap gap-3">
              {sheet.images.map((img, i) => (
                <img key={i} src={img.src} alt={img.name || `Gambar ${i + 1}`} title={img.cell ? `Posisi sel ${img.cell}` : undefined} className="max-h-72 max-w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-white" />
              ))}
            </div>
          </div>
        )}
        {sheet.truncated && (
          <p className="text-[10px] text-slate-400">
            Menampilkan sebagian ({sheet.rows.length} dari {sheet.total_rows} baris, maksimum 30 kolom). Unduh berkas untuk melihat seluruhnya.
          </p>
        )}
      </div>
    )
  }

  if (IMAGE_EXT.includes(ext)) {
    return <img src={state.url} alt={doc.title || doc.original_name} className="max-h-96 mx-auto rounded-lg border border-slate-200 dark:border-slate-700" />
  }
  return <iframe title={`Pratinjau ${doc.original_name}`} src={state.url} className="w-full h-96 rounded-lg border border-slate-200 dark:border-slate-700 bg-white" />
}
