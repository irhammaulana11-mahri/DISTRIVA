import { useState, useEffect, useCallback, useId } from 'react'
import { createPortal } from 'react-dom'
import { rabRunsApi, kkfRunsApi, bastpApi, triggerFileDownload } from '../services/api.js'
import { formatRupiah, formatNumber } from '../utils/kkfFormatters.js'
import Spinner from './Spinner.jsx'
import {
  IconX,
  IconDownload,
  IconDocument,
  IconAlertCircle,
  IconCheckCircle,
} from './icons.jsx'

/**
 * OutputDocumentModal (docs/70 & docs/57)
 * Generic document viewer, printer, and XLSX downloader for PLN output documents:
 * - REKAP & REKAP RINCI (from RAB run)
 * - KKF & HPE (from KKF run)
 * Rendered from generic JSON: header, title, meta, sections (pairs / tables), terbilang, signatures.
 */
export default function OutputDocumentModal({
  open = false,
  onClose,
  runId,
  type = 'rekap', // 'rekap' | 'rinci' | 'kkf' | 'hpe' | 'kko'
  category = 'rab', // 'rab' | 'kkf' | 'bastp' | 'kko'
  title = '',
  customDoc = null,
}) {
  const [loading, setLoading] = useState(false)
  const [downloading, setDownloading] = useState(false)
  const [error, setError] = useState('')
  const [doc, setDoc] = useState(null)
  const modalId = useId()

  const loadDocument = useCallback(async () => {
    if (!open) return
    if (customDoc) {
      setDoc(customDoc)
      setLoading(false)
      setError('')
      return
    }
    if (!runId) return
    setLoading(true)
    setError('')
    try {
      let res
      if (category === 'bastp') {
        res = await bastpApi.document(runId, 'json')
      } else {
        const api = category === 'rab' ? rabRunsApi : kkfRunsApi
        res = await api.document(runId, type, 'json')
      }
      setDoc(res?.data || null)
    } catch (err) {
      // Verbatim display of 403, 404, 422
      setError(err?.message || 'Gagal memuat dokumen keluaran.')
    } finally {
      setLoading(false)
    }
  }, [runId, open, type, category, customDoc])

  useEffect(() => {
    if (open) {
      loadDocument()
    } else {
      setDoc(null)
      setError('')
    }
  }, [open, loadDocument])

  // Handle Print via window.print()
  const handlePrint = () => {
    if (typeof window !== 'undefined') {
      window.print()
    }
  }

  // Handle Download XLSX with Bearer auth token
  const handleDownloadXlsx = async () => {
    if (!runId && !doc) return
    setDownloading(true)
    setError('')
    try {
      if (category === 'kko' || customDoc) {
        // Ekspor representasi data tabular KKO sebagai CSV bila tidak melalui endpoint generator server
        const activeDoc = doc || customDoc
        const lines = [
          `"${activeDoc.title || 'DOKUMEN'}"`,
          `"Nomor: ${activeDoc.document_number || '-'}"`,
          '',
        ]
        if (Array.isArray(activeDoc.meta)) {
          activeDoc.meta.forEach(([k, v]) => lines.push(`"${k}","${v}"`))
          lines.push('')
        }
        if (Array.isArray(activeDoc.sections)) {
          activeDoc.sections.forEach((sec) => {
            if (sec.heading) lines.push(`"${sec.heading}"`)
            if (Array.isArray(sec.pairs)) {
              sec.pairs.forEach(([k, v]) => lines.push(`"${k}","${v}"`))
            }
            if (Array.isArray(sec.columns) && Array.isArray(sec.rows)) {
              lines.push(sec.columns.map((c) => `"${c}"`).join(','))
              sec.rows.forEach((r) => lines.push(r.map((c) => `"${c}"`).join(',')))
            }
            lines.push('')
          })
        }
        const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
        const filename = `${(activeDoc.title || 'DOKUMEN').replace(/[^a-zA-Z0-9_-]/g, '_')}.csv`
        triggerFileDownload(blob, filename)
        return
      }

      let blob, filename
      if (category === 'bastp') {
        const res = await bastpApi.document(runId, 'xlsx')
        blob = res.blob
        filename = res.filename || `BASTP-${runId.slice(0, 8)}.xlsx`
      } else {
        const api = category === 'rab' ? rabRunsApi : kkfRunsApi
        const res = await api.document(runId, type, 'xlsx')
        blob = res.blob
        filename = res.filename || `${type.toUpperCase()}-${runId.slice(0, 8)}.xlsx`
      }
      triggerFileDownload(blob, filename)
    } catch (err) {
      setError(err?.message || 'Gagal mengunduh berkas XLSX.')
    } finally {
      setDownloading(false)
    }
  }

  if (!open) return null

  // Generic cell formatter
  const formatCell = (val, colName = '') => {
    if (val === null || val === undefined || val === '') return '-'
    if (typeof val === 'boolean') return val ? 'Ya' : 'Tidak'
    if (typeof val === 'number') {
      const colUpper = String(colName).toUpperCase()
      if (
        colUpper.includes('%') ||
        colUpper.includes('IRR') ||
        colUpper.includes('RATE') ||
        colUpper.includes('RWACC')
      ) {
        return `${val} %`
      }
      if (
        colUpper.includes('BIAYA') ||
        colUpper.includes('TOTAL') ||
        colUpper.includes('SUB') ||
        colUpper.includes('MATERIAL') ||
        colUpper.includes('JASA') ||
        colUpper.includes('COMMISSIONING') ||
        colUpper.includes('K3L') ||
        colUpper.includes('ASURANSI') ||
        colUpper.includes('BP') ||
        colUpper.includes('RAB') ||
        colUpper.includes('NET') ||
        colUpper.includes('KUMULATIF') ||
        colUpper.includes('PENDAPATAN')
      ) {
        return formatNumber(Math.round(val))
      }
      // General number
      return val.toLocaleString('id-ID')
    }
    return String(val)
  }

  const isLandscape = type === 'rekap' || type === 'rinci' || type === 'kkf'

  const modalContent = (
    <div
      id="output-doc-portal"
      role="dialog"
      aria-modal="true"
      aria-labelledby={`output-doc-title-${modalId}`}
      className="output-doc-modal-backdrop fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-900/70 backdrop-blur-xs overflow-y-auto"
    >
      {/* CSS Print Styles */}
      <style>{`
        @media print {
          @page {
            size: ${isLandscape ? 'A4 landscape' : 'A4 portrait'};
            margin: 10mm;
          }

          /* Force exact print colors for backgrounds, badges, and borders */
          *, *::before, *::after {
            -webkit-print-color-adjust: exact !important;
            print-color-adjust: exact !important;
          }

          /* Reset root HTML & Body */
          html, body {
            margin: 0 !important;
            padding: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            height: auto !important;
            min-height: 0 !important;
            overflow: visible !important;
          }

          /* Hide all application elements except this modal portal */
          body > *:not(#output-doc-portal) {
            display: none !important;
          }

          .no-print {
            display: none !important;
          }

          /* Unconstrain modal backdrop & dialog for print */
          #output-doc-portal,
          .output-doc-modal-backdrop {
            position: static !important;
            inset: auto !important;
            z-index: auto !important;
            display: block !important;
            padding: 0 !important;
            margin: 0 !important;
            background: transparent !important;
            backdrop-filter: none !important;
            overflow: visible !important;
            height: auto !important;
            min-height: 0 !important;
            max-height: none !important;
            width: 100% !important;
            box-shadow: none !important;
          }

          .output-doc-modal-card {
            position: static !important;
            display: block !important;
            max-width: 100% !important;
            max-height: none !important;
            height: auto !important;
            margin: 0 !important;
            padding: 0 !important;
            border: none !important;
            box-shadow: none !important;
            background: transparent !important;
            overflow: visible !important;
            border-radius: 0 !important;
          }

          .output-doc-modal-content {
            overflow: visible !important;
            max-height: none !important;
            height: auto !important;
            padding: 0 !important;
            margin: 0 !important;
            display: block !important;
          }

          .overflow-x-auto,
          .overflow-y-auto {
            overflow: visible !important;
          }

          /* Printable document area */
          #output-document-print-area {
            position: static !important;
            display: block !important;
            width: 100% !important;
            max-width: 100% !important;
            padding: 0 !important;
            margin: 0 !important;
            background: #ffffff !important;
            color: #000000 !important;
            border: none !important;
            box-shadow: none !important;
            border-radius: 0 !important;
            font-size: 8.5pt !important;
            line-height: 1.35 !important;
          }

          /* Sharp and clean print tables */
          .table-print {
            border-collapse: collapse !important;
            width: 100% !important;
            page-break-inside: auto !important;
            break-inside: auto !important;
          }

          .table-print thead {
            display: table-header-group !important;
          }

          .table-print tfoot {
            display: table-footer-group !important;
          }

          .table-print tr {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }

          .table-print th, .table-print td {
            border: 1px solid #334155 !important;
            padding: 3.5px 5px !important;
            font-size: 8pt !important;
            color: #000000 !important;
          }

          .table-print th {
            background-color: #f1f5f9 !important;
            font-weight: 700 !important;
          }

          /* Avoid breaking critical sections */
          .print-avoid-break {
            page-break-inside: avoid !important;
            break-inside: avoid !important;
          }
        }
      `}</style>

      <div className="output-doc-modal-card relative w-full max-w-5xl max-h-[92vh] flex flex-col bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
        {/* Top Action Bar (No-Print) */}
        <div className="no-print flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-4 py-3 sm:px-5 sm:py-3.5 border-b border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-blue-100 dark:bg-blue-900/40 text-blue-600 dark:text-blue-400 shrink-0">
              <IconDocument size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <h3
                id={`output-doc-title-${modalId}`}
                className="text-sm font-bold text-slate-800 dark:text-slate-100 truncate"
              >
                {doc?.title || title || `Dokumen ${type.toUpperCase()}`}
              </h3>
              <p className="text-[11px] text-slate-500 truncate">
                Pratinjau formulir resmi PLN · Siap cetak & unduh Excel
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-1.5 sm:gap-2">
            <button
              type="button"
              onClick={handlePrint}
              disabled={loading || !doc}
              className="px-2.5 sm:px-3 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition inline-flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
            >
              <span>🖨️</span>
              <span>Cetak Formulir</span>
            </button>

            <button
              type="button"
              onClick={handleDownloadXlsx}
              disabled={loading || downloading || !doc}
              className="px-3 sm:px-3.5 py-1.5 rounded-lg text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 active:bg-blue-800 transition inline-flex items-center gap-1.5 shadow-xs disabled:opacity-50 cursor-pointer"
            >
              {downloading ? (
                <Spinner size="xs" />
              ) : (
                <IconDownload size={14} />
              )}
              <span>Unduh XLSX</span>
            </button>

            <button
              type="button"
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition cursor-pointer"
              title="Tutup"
            >
              <IconX size={18} />
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="output-doc-modal-content flex-1 overflow-y-auto p-4 sm:p-8">
          {loading && (
            <div className="py-20 flex flex-col items-center justify-center gap-3 text-slate-500">
              <Spinner size="lg" />
              <p className="text-xs">Memuat dokumen keluaran dari server...</p>
            </div>
          )}

          {error && !loading && (
            <div className="p-4 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-300 text-xs flex items-start gap-2.5">
              <IconAlertCircle size={18} className="shrink-0 mt-0.5 text-rose-600" />
              <div>
                <p className="font-bold">Gagal Menampilkan Dokumen</p>
                <p className="mt-0.5 whitespace-pre-wrap">{error}</p>
              </div>
            </div>
          )}

          {!loading && doc && (
            <div
              id="output-document-print-area"
              className="bg-white text-slate-900 p-6 sm:p-10 border border-slate-200 shadow-xs rounded-xl font-sans text-xs leading-relaxed max-w-4xl mx-auto"
            >
              {/* Kop Surat PLN */}
              <div className="border-b-2 border-slate-900 pb-3 mb-4">
                <div className="flex justify-between items-start">
                  <div>
                    {Array.isArray(doc.header) &&
                      doc.header.map((line, idx) => (
                        <p
                          key={idx}
                          className={`uppercase tracking-wide ${
                            idx === 0
                              ? 'text-sm font-extrabold text-blue-900'
                              : 'text-xs font-bold text-slate-800'
                          }`}
                        >
                          {line}
                        </p>
                      ))}
                  </div>
                  <div className="text-right">
                    <span className="inline-block px-2 py-0.5 text-[10px] font-mono font-bold bg-slate-100 border border-slate-300 rounded text-slate-700">
                      FORMULIR RESMI PLN
                    </span>
                  </div>
                </div>
              </div>

              {/* Judul & Nomor Dokumen */}
              <div className="text-center my-4 space-y-1">
                <h2 className="text-base font-extrabold uppercase tracking-wide text-slate-900">
                  {doc.title}
                </h2>
                <p className="text-xs text-slate-600">
                  Nomor:{' '}
                  {doc.document_number ? (
                    <span className="font-mono font-bold text-slate-800">
                      {doc.document_number}
                    </span>
                  ) : (
                    <span className="italic text-slate-500">
                      Nomor belum ditetapkan
                    </span>
                  )}
                </p>
              </div>

              {/* Warning: Infeasible or Extended Approval Required */}
              {(doc.conclusion === 'TIDAK LAYAK' || doc.extended_required) && (
                <div className="my-4 p-3.5 rounded-lg bg-rose-50 border-2 border-rose-500 text-rose-900 flex items-start gap-2.5 print-avoid-break">
                  <span className="text-lg">⚠️</span>
                  <div className="text-xs">
                    <p className="font-bold uppercase tracking-wider text-rose-700">
                      Peringatan: {doc.conclusion === 'TIDAK LAYAK' ? 'TIDAK LAYAK' : 'Persetujuan Diperpanjang'}
                    </p>
                    <p className="mt-0.5 text-[11px] leading-normal text-rose-800">
                      Dokumen KKF ini memerlukan rantai persetujuan diperpanjang (Extended Approval) oleh pejabat berwenang:
                      <strong> ASMAN NIAGA</strong> dan <strong>UP3 MANAGER</strong>.
                    </p>
                  </div>
                </div>
              )}

              {/* Metadata Dokumen (meta) */}
              {Array.isArray(doc.meta) && doc.meta.length > 0 && (
                <div className="my-4 p-3 rounded-lg bg-slate-50 border border-slate-200">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-xs">
                    {doc.meta.map(([lbl, val], idx) => (
                      <div key={idx} className="flex items-baseline gap-2">
                        <span className="w-32 shrink-0 text-slate-500 font-medium">
                          {lbl}
                        </span>
                        <span className="text-slate-400">:</span>
                        <span className="font-semibold text-slate-800 truncate">
                          {formatCell(val, lbl)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Sections */}
              {Array.isArray(doc.sections) &&
                doc.sections.map((sec, sIdx) => (
                  <div key={sIdx} className="my-5 space-y-2">
                    {/* Heading */}
                    {sec.heading && (
                      <h4 className="text-xs font-bold uppercase tracking-wider text-slate-800 pb-1 border-b border-slate-300">
                        {sec.heading}
                      </h4>
                    )}

                    {/* Key-Value Pairs */}
                    {Array.isArray(sec.pairs) && sec.pairs.length > 0 && (
                      <div className="p-3 bg-slate-50/70 border border-slate-200 rounded-lg space-y-1 text-xs">
                        {sec.pairs.map(([lbl, val], pIdx) => (
                          <div
                            key={pIdx}
                            className="flex items-baseline justify-between py-0.5 border-b border-dotted border-slate-200 last:border-0"
                          >
                            <span className="text-slate-600 font-medium">
                              {lbl}
                            </span>
                            <span className="font-semibold text-slate-800 font-mono text-[11px]">
                              {formatCell(val, lbl)}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}

                    {/* Table (Columns, Rows, Footer) */}
                    {Array.isArray(sec.columns) && sec.columns.length > 0 && (
                      <div className="overflow-x-auto border border-slate-300 rounded-lg">
                        <table className="table-print w-full text-left border-collapse text-[11px]">
                          <thead>
                            <tr className="bg-slate-100 text-slate-800 font-bold border-b border-slate-300">
                              {sec.columns.map((col, cIdx) => (
                                <th
                                  key={cIdx}
                                  className="py-2 px-2.5 border-r border-slate-300 last:border-r-0 whitespace-nowrap text-center"
                                >
                                  {col}
                                </th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-200">
                            {Array.isArray(sec.rows) && sec.rows.length > 0 ? (
                              sec.rows.map((row, rIdx) => (
                                <tr
                                  key={rIdx}
                                  className="hover:bg-slate-50/60 transition-colors"
                                >
                                  {row.map((cell, cIdx) => {
                                    const colName = sec.columns[cIdx] || ''
                                    const isNumeric = typeof cell === 'number'
                                    return (
                                      <td
                                        key={cIdx}
                                        className={`py-1.5 px-2.5 border-r border-slate-200 last:border-r-0 ${
                                          isNumeric
                                            ? 'text-right font-mono'
                                            : cIdx === 0
                                            ? 'text-center'
                                            : ''
                                        }`}
                                      >
                                        {formatCell(cell, colName)}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))
                            ) : (
                              <tr>
                                <td
                                  colSpan={sec.columns.length}
                                  className="py-4 text-center text-slate-400 italic"
                                >
                                  Tidak ada baris data
                                </td>
                              </tr>
                            )}
                          </tbody>
                          {Array.isArray(sec.footer) && sec.footer.length > 0 && (
                            <tfoot>
                              <tr className="bg-slate-100/90 font-bold text-slate-900 border-t-2 border-slate-300">
                                {sec.footer.map((fCell, fIdx) => {
                                  const colName = sec.columns[fIdx] || ''
                                  const isNumeric = typeof fCell === 'number'
                                  return (
                                    <td
                                      key={fIdx}
                                      className={`py-2 px-2.5 border-r border-slate-300 last:border-r-0 ${
                                        isNumeric
                                          ? 'text-right font-mono'
                                          : fIdx === 1 || fIdx === 2
                                          ? 'text-center uppercase tracking-wider'
                                          : ''
                                      }`}
                                    >
                                      {formatCell(fCell, colName)}
                                    </td>
                                  )
                                })}
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    )}
                  </div>
                ))}

              {/* Total & Terbilang */}
              {(doc.grand_total != null || doc.terbilang) && (
                <div className="my-5 p-4 rounded-lg bg-slate-50 border border-slate-300 space-y-1.5 print-avoid-break">
                  {doc.grand_total != null && (
                    <div className="flex items-center justify-between text-xs font-bold text-slate-900">
                      <span>JUMLAH TOTAL:</span>
                      <span className="font-mono text-sm">
                        {formatRupiah(doc.grand_total)}
                      </span>
                    </div>
                  )}
                  {doc.terbilang && (
                    <p className="text-xs text-slate-700 italic">
                      <span className="font-semibold not-italic">Terbilang: </span>
                      &ldquo;{doc.terbilang}&rdquo;
                    </p>
                  )}
                </div>
              )}

              {/* Kesimpulan Kelayakan (jika ada conclusion) */}
              {doc.conclusion && (
                <div className="my-4 flex items-center justify-between p-3 rounded-lg border border-slate-200 bg-slate-50 print-avoid-break">
                  <span className="text-xs font-bold uppercase text-slate-700">
                    KESIMPULAN KELAYAKAN:
                  </span>
                  <span
                    className={`px-3 py-1 rounded-full text-xs font-extrabold uppercase tracking-wider ${
                      doc.conclusion === 'LAYAK'
                        ? 'bg-emerald-100 text-emerald-800 border border-emerald-300'
                        : 'bg-rose-100 text-rose-800 border border-rose-300'
                    }`}
                  >
                    {doc.conclusion}
                  </span>
                </div>
              )}

              {/* Tanggal & Tanda Tangan */}
              <div className="mt-8 pt-4 border-t border-slate-300 print-avoid-break">
                {doc.place_date && (
                  <p className="text-right text-xs font-semibold text-slate-800 mb-4">
                    {doc.place_date}
                  </p>
                )}

                {Array.isArray(doc.signatures) && doc.signatures.length > 0 && (
                  <div
                    className={`grid gap-8 text-center text-xs ${
                      doc.signatures.length === 1
                        ? 'grid-cols-1 max-w-xs ml-auto'
                        : doc.signatures.length === 2
                        ? 'grid-cols-2'
                        : 'grid-cols-3'
                    }`}
                  >
                    {doc.signatures.map((sig, idx) => (
                      <div key={idx} className="space-y-4">
                        <p className="font-bold uppercase tracking-wider text-slate-800">
                          {sig.title}
                        </p>
                        {sig.electronic ? (
                          <div className="py-2 px-1 text-[10px] font-mono text-emerald-800 bg-emerald-50 rounded border border-emerald-200">
                            <div className="font-bold">TTE DISTRIVA</div>
                            <div className="text-[9px] text-slate-500">{sig.signed_at}</div>
                            <div className="font-semibold text-emerald-700">Sidik Jari: {sig.signature}</div>
                          </div>
                        ) : (
                          <div className="h-12" />
                        )}
                        <div>
                          <p className="font-bold underline text-slate-900 uppercase">
                            ( {sig.name || ' .................................... '} )
                          </p>
                          {sig.role && <p className="text-[10px] text-slate-500 font-mono mt-0.5">{sig.role}</p>}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {doc.electronic_signature_note && (
                  <div className="mt-6 p-2.5 rounded border border-slate-200 bg-slate-50 text-[10px] text-slate-500 italic text-left">
                    {doc.electronic_signature_note}
                  </div>
                )}
              </div>

              {/* Source Audit Trail Footnote */}
              {doc.source && (
                <div className="mt-10 pt-2 border-t border-dotted border-slate-300 text-[10px] text-slate-400 flex flex-wrap items-center justify-between gap-2 font-mono">
                  <span>
                    Run #{doc.source.run_number || '-'}{' '}
                    {doc.source.rab_run_number ? `• Ref RAB #${doc.source.rab_run_number}` : ''}
                  </span>
                  <span>Hash: {doc.source.snapshot_hash || '-'}</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer (No-Print) */}
        <div className="no-print flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/60">
          <span className="text-[11px] text-slate-500">
            Dikeluarkan oleh sistem DISTRIVA berbasis data snapshot tervalidasi.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg text-xs font-semibold text-slate-700 dark:text-slate-200 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-700 transition cursor-pointer"
          >
            Tutup
          </button>
        </div>
      </div>
    </div>
  )

  if (typeof document !== 'undefined' && document.body) {
    return createPortal(modalContent, document.body)
  }
  return modalContent
}
