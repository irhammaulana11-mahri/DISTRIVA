import { useState, useEffect, useCallback } from 'react'
import { rabRunsApi } from '../../services/api.js'
import Drawer from '../../components/Drawer.jsx'
import Button from '../../components/Button.jsx'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import {
  IconCalculator,
  IconDocument,
  IconLayers,
  IconRefresh,
  IconDownload,
} from '../../components/icons.jsx'

function formatRupiah(value) {
  if (value === null || value === undefined || isNaN(value)) return '-'
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value)
}

export default function RabRunDetailDrawer({
  runId,
  onClose,
  onOpenDoc,
}) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [run, setRun] = useState(null)
  const [filterGroup, setFilterGroup] = useState('ALL')
  const [filterCategory, setFilterCategory] = useState('ALL')
  const [search, setSearch] = useState('')
  const [linePage, setLinePage] = useState(1)
  const [linePerPage, setLinePerPage] = useState(25)

  const loadDetail = useCallback(async () => {
    if (!runId) return
    setLoading(true)
    setError('')
    try {
      const res = await rabRunsApi.get(runId)
      setRun(res.data)
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Gagal memuat detail run RAB.')
    } finally {
      setLoading(false)
    }
  }, [runId])

  useEffect(() => {
    loadDetail()
  }, [loadDetail])

  const groups = run?.groups || {}
  const groupKeys = Object.keys(groups)
  const lines = run?.lines || run?.items || []

  const filteredLines = lines.filter((l) => {
    if (filterGroup !== 'ALL' && (l.group || l.group_code) !== filterGroup) return false
    if (filterCategory !== 'ALL' && l.category !== filterCategory) return false
    if (!search.trim()) return true
    const q = search.toLowerCase()
    const code = l.khs_code || l.item_code || ''
    const name = l.khs_name || l.item_name || ''
    const desc = l.description || ''
    return (
      code.toLowerCase().includes(q) ||
      name.toLowerCase().includes(q) ||
      desc.toLowerCase().includes(q)
    )
  })

  return (
    <Drawer
      open={true}
      onClose={onClose}
      title={run ? `Rincian Kalkulasi RAB Run #${run.run_number}` : 'Rincian Run RAB'}
      subtitle={run ? `Berlaku: ${run.valid_on} · Zona UP3 ${run.zone} · Total: ${formatRupiah(run.grand_total)}` : ''}
      width="max-w-5xl"
      footer={
        <div className="flex items-center justify-between w-full">
          <div className="flex items-center gap-2">
            {run && onOpenDoc && (
              <>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpenDoc(run.id, 'rekap', `REKAP RAB #${run.run_number}`)}
                  className="inline-flex items-center gap-1.5"
                >
                  <IconDocument size={13} />
                  <span>Dokumen REKAP</span>
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onOpenDoc(run.id, 'rinci', `REKAP RINCI RAB #${run.run_number}`)}
                  className="inline-flex items-center gap-1.5"
                >
                  <IconDocument size={13} />
                  <span>Dokumen REKAP RINCI</span>
                </Button>
              </>
            )}
          </div>
          <Button variant="secondary" onClick={onClose}>
            Tutup
          </Button>
        </div>
      }
    >
      <div className="space-y-6 text-xs">
        {error && <Alert variant="danger">{error}</Alert>}
        {loading && <Spinner />}

        {run && (
          <>
            {/* Header Identity Card */}
            <div className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/50 space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Kalkulasi Anggaran Biaya (RAB)
                  </span>
                  <h3 className="text-base font-bold text-slate-900 dark:text-slate-100 font-mono mt-0.5">
                    Run #{run.run_number}
                  </h3>
                  <div className="flex items-center gap-3 font-mono text-[11px] text-slate-500 mt-1 flex-wrap">
                    <span>Tanggal: {run.valid_on}</span>
                    <span>Zona: {run.zone}</span>
                    <span>PPN: 11%</span>
                    <span>Asuransi: 0.3%</span>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider">Total RAB Keseluruhan</span>
                  <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 font-mono">
                    {formatRupiah(run.grand_total)}
                  </div>
                </div>
              </div>

              {/* Snapshot Hash */}
              <div className="pt-2 border-t border-slate-200 dark:border-slate-800 flex items-center justify-between text-[11px] font-mono text-slate-500">
                <span className="truncate max-w-md">Snapshot: {run.snapshot_hash}</span>
                <span className="text-slate-400">{new Date(run.created_at).toLocaleString('id-ID')}</span>
              </div>
            </div>

            {/* Summary by Groups */}
            <div className="space-y-2">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center gap-1.5">
                <IconLayers size={14} />
                <span>Ringkasan Kelompok Pekerjaan ({groupKeys.length})</span>
              </h4>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
                <table className="min-w-full text-left text-xs data-table">
                  <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-slate-500 font-semibold text-[11px]">
                    <tr>
                      <th className="py-2.5 px-3">Kelompok</th>
                      <th className="py-2.5 px-3 text-right">Material</th>
                      <th className="py-2.5 px-3 text-right">Jasa Pasang/Bongkar</th>
                      <th className="py-2.5 px-3 text-right">Commissioning</th>
                      <th className="py-2.5 px-3 text-right">K3L</th>
                      <th className="py-2.5 px-3 text-right">Asuransi</th>
                      <th className="py-2.5 px-3 text-right">Subtotal</th>
                      <th className="py-2.5 px-3 text-right">PPN 11%</th>
                      <th className="py-2.5 px-3 text-right font-bold text-slate-800 dark:text-slate-200">
                        Total
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                    {groupKeys.map((k) => {
                      const g = groups[k]
                      return (
                        <tr key={k} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                          <td className="py-2 px-3 font-sans font-bold text-slate-800 dark:text-slate-200">{k}</td>
                          <td className="py-2 px-3 text-right">
                            <div>{formatRupiah(g.material)}</div>
                            {Number(g.material_pln) > 0 && (
                              <div className="text-[10px] font-normal text-slate-500 font-sans" data-testid={`rab-material-pln-${k}`}>
                                termasuk material PLN/MDU {formatRupiah(g.material_pln)}
                              </div>
                            )}
                          </td>
                          <td className="py-2 px-3 text-right">{formatRupiah(g.service)}</td>
                          <td className="py-2 px-3 text-right">{formatRupiah(g.commissioning)}</td>
                          <td className="py-2 px-3 text-right">{formatRupiah(g.k3l)}</td>
                          <td className="py-2 px-3 text-right">{formatRupiah(g.insurance)}</td>
                          <td className="py-2 px-3 text-right font-semibold text-slate-700 dark:text-slate-300">
                            {formatRupiah(g.subtotal)}
                          </td>
                          <td className="py-2 px-3 text-right text-slate-500">{formatRupiah(g.ppn)}</td>
                          <td className="py-2 px-3 text-right font-bold text-blue-700 dark:text-blue-400">
                            {formatRupiah(g.total)}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Line Items Table (RAB Rinci) */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300">
                  Daftar Baris Komponen RAB ({lines.length} Baris)
                </h4>

                <div className="flex items-center gap-2 flex-wrap">
                  {/* Filter Kelompok */}
                  <select
                    value={filterGroup}
                    onChange={(e) => setFilterGroup(e.target.value)}
                    className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                  >
                    <option value="ALL">Semua Kelompok</option>
                    {groupKeys.map((g) => (
                      <option key={g} value={g}>
                        {g}
                      </option>
                    ))}
                  </select>

                  {/* Filter Kategori */}
                  <select
                    value={filterCategory}
                    onChange={(e) => setFilterCategory(e.target.value)}
                    className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300"
                  >
                    <option value="ALL">Semua Kategori</option>
                    <option value="ITEM">ITEM (Material & Jasa)</option>
                    <option value="COMMISSIONING">COMMISSIONING</option>
                    <option value="K3L">K3L</option>
                    <option value="INSURANCE">INSURANCE (Asuransi)</option>
                  </select>

                  <input
                    type="text"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Cari kode / uraian..."
                    className="px-2.5 py-1 text-xs rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100"
                  />
                </div>
              </div>

              <div className="rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden">
                {filteredLines.length === 0 ? (
                  <EmptyState
                    icon={IconLayers}
                    title="Belum ada baris rincian RAB"
                    description="Tidak ada baris komponen RAB yang cocok dengan filter pencarian atau kelompok yang dipilih."
                  />
                ) : (
                  <div className="overflow-x-auto max-h-96">
                    <table className="min-w-full text-left text-xs data-table">
                      <thead className="bg-slate-50 dark:bg-slate-800/60 border-b border-slate-200 dark:border-slate-700 text-slate-500 font-semibold text-[11px] sticky top-0 z-10">
                        <tr>
                          <th className="py-2 px-3">No</th>
                          <th className="py-2 px-3">Kelompok</th>
                          <th className="py-2 px-3">Kode KHS / Uraian</th>
                          <th className="py-2 px-3">Kategori</th>
                          <th className="py-2 px-3">Satuan</th>
                          <th className="py-2 px-3 text-right">Vol Mat</th>
                          <th className="py-2 px-3 text-right">Vol Pasang</th>
                          <th className="py-2 px-3 text-right">Vol Bongkar</th>
                          <th className="py-2 px-3 text-right">Harga Material</th>
                          <th className="py-2 px-3 text-right">Harga Pasang</th>
                          <th className="py-2 px-3 text-right">Biaya Mat</th>
                          <th className="py-2 px-3 text-right">Biaya Pasang</th>
                          <th className="py-2 px-3 text-right">Asuransi</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                        {filteredLines
                          .slice((linePage - 1) * linePerPage, linePage * linePerPage)
                          .map((l, idx) => (
                          <tr key={idx} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30">
                            <td className="py-1.5 px-3 text-slate-400">{(linePage - 1) * linePerPage + idx + 1}</td>
                            <td className="py-1.5 px-3 font-semibold font-sans text-slate-700 dark:text-slate-300">
                              {l.group || l.group_code || '-'}
                            </td>
                            <td className="py-1.5 px-3 font-sans">
                              <div className="font-semibold text-slate-800 dark:text-slate-200">
                                {(l.khs_code || l.item_code)
                                  ? `${l.khs_code || l.item_code} - ${l.khs_name || l.item_name || ''}`
                                  : (l.khs_name || l.item_name || l.description || '-')}
                              </div>
                              {l.material_status && (
                                <span className="text-[10px] text-slate-400 font-mono">
                                  Status: {l.material_status}
                                </span>
                              )}
                            </td>
                            <td className="py-1.5 px-3 text-slate-500 font-sans text-[10px]">
                              {l.category}
                            </td>
                            <td className="py-1.5 px-3 text-slate-500 font-sans">{l.unit_text || l.unit || '-'}</td>
                            <td className="py-1.5 px-3 text-right">{l.qty_material ?? l.quantity ?? '-'}</td>
                            <td className="py-1.5 px-3 text-right">{l.qty_install ?? '-'}</td>
                            <td className="py-1.5 px-3 text-right">{l.qty_remove ?? '-'}</td>
                            <td className="py-1.5 px-3 text-right">{formatRupiah(l.material_price ?? l.price)}</td>
                            <td className="py-1.5 px-3 text-right">{formatRupiah(l.install_price)}</td>
                            <td className="py-1.5 px-3 text-right font-medium text-slate-700 dark:text-slate-300">
                              {formatRupiah(l.material_cost ?? l.total)}
                            </td>
                            <td className="py-1.5 px-3 text-right font-medium text-slate-700 dark:text-slate-300">
                              {formatRupiah(l.install_cost)}
                            </td>
                            <td className="py-1.5 px-3 text-right text-slate-600 dark:text-slate-400">
                              {formatRupiah(l.insurance_cost)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}

                <TableFooter
                  itemCount={filteredLines.slice((linePage - 1) * linePerPage, linePage * linePerPage).length}
                  total={filteredLines.length}
                  entityLabel="baris rincian KHS"
                  page={linePage}
                  perPage={linePerPage}
                  onPage={setLinePage}
                  onPerPage={(n) => {
                    setLinePerPage(n)
                    setLinePage(1)
                  }}
                  perPageOptions={[10, 25, 50, 100]}
                />
              </div>
            </div>
          </>
        )}
      </div>
    </Drawer>
  )
}
