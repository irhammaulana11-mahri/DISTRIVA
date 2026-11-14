import { useCallback, useEffect, useState } from 'react'
import { warehousesApi } from '../../services/api.js'
import Alert from '../../components/Alert.jsx'
import Spinner from '../../components/Spinner.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import Button from '../../components/Button.jsx'
import { IconRefresh } from '../../components/icons.jsx'

const fmtDate = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('-') : '-')
const fmtQty = (n) => Number(n).toLocaleString('id-ID', { maximumFractionDigits: 3 })

/**
 * Penelusuran cermin MIMS (baca-saja): pengeluaran (riwayat pemakaian) atau penerimaan (barang sudah diterima di gudang).
 * Data hanya dibaca; ditarik lewat "Tarik Stok dari MIMS".
 */
export default function MimsMirrorTab({ kind, warehouses }) {
  const isIssues = kind === 'issues'
  const isReservations = kind === 'reservations'
  const [pending, setPending] = useState(false)
  const [warehouseId, setWarehouseId] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(25)
  const [rows, setRows] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [open, setOpen] = useState(null)

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim())
      setPage(1)
    }, 350)
    return () => clearTimeout(t)
  }, [search])

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await warehousesApi.mimsMirror(kind, { warehouse_id: warehouseId, from, to, search: query, page, per_page: perPage, pending: isReservations && pending ? 1 : undefined })
      setRows(res?.data || [])
      setTotal(res?.meta?.total ?? 0)
    } catch (err) {
      setError(err?.message || 'Gagal memuat data MIMS.')
    } finally {
      setLoading(false)
    }
  }, [kind, warehouseId, from, to, query, page, perPage, pending, isReservations])

  useEffect(() => {
    load()
  }, [load])

  const field = 'px-3 py-1.5 text-xs rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800'

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-slate-500">
        {isReservations
          ? 'Cermin baca-saja reservasi material di MIMS (termasuk yang belum dikeluarkan). Agenda pelanggan dicocokkan dengan permohonan DISTRIVA.'
          : isIssues
          ? 'Cermin baca-saja riwayat pengeluaran material dari MIMS. Dicocokkan dengan TUG 7 lewat nomor reservasi sehingga tidak terhitung dua kali.'
          : 'Cermin baca-saja penerimaan material di gudang dari MIMS (jumlah dikirim dan jumlah diterima).'}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <select aria-label="Gudang" value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPage(1) }} className={field}>
          <option value="">Semua Gudang</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.code} - {w.name}</option>
          ))}
        </select>
        <input aria-label="Dari tanggal" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1) }} className={field} />
        <span className="text-xs text-slate-500">s/d</span>
        <input aria-label="Sampai tanggal" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1) }} className={field} />
        {isReservations && (
          <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 dark:text-slate-300">
            <input type="checkbox" checked={pending} onChange={(e) => { setPending(e.target.checked); setPage(1) }} />
            Belum ada pengeluaran
          </label>
        )}
        <input
          aria-label="Cari"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={isReservations ? 'Cari reservasi, keterangan, agenda' : isIssues ? 'Cari dokumen, reservasi, material, agenda' : 'Cari pengiriman, permintaan, material'}
          className={`${field} min-w-64`}
        />
        <Button
          variant="secondary"
          size="sm"
          icon={IconRefresh}
          loading={loading}
          onClick={load}
          aria-label="Segarkan data MIMS"
        >
          Segarkan
        </Button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xs overflow-hidden">
        {loading ? (
          <div className="p-8 flex justify-center"><Spinner /></div>
        ) : rows.length === 0 ? (
          <EmptyState title={isReservations ? 'Belum ada data reservasi' : isIssues ? 'Belum ada data pengeluaran' : 'Belum ada data penerimaan'} description="Tarik data dari MIMS lewat tombol Tarik Stok dari MIMS, atau ubah filter." />
        ) : isReservations ? (
          <ReservationTable rows={rows} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
                  <th className="py-2 px-3">Gudang</th>
                  <th className="py-2 px-3">{isIssues ? 'Dokumen' : 'No Pengiriman'}</th>
                  <th className="py-2 px-3">{isIssues ? 'Reservasi' : 'Permintaan'}</th>
                  <th className="py-2 px-3">{isIssues ? 'Tanggal' : 'Dikirim'}</th>
                  <th className="py-2 px-3">{isIssues ? 'Jenis Pekerjaan' : 'Diterima'}</th>
                  <th className="py-2 px-3">{isIssues ? 'Pelanggan' : 'Status'}</th>
                  <th className="py-2 px-3 text-right">Material</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {rows.map((r) => {
                  const key = r.id
                  const isOpen = open === key
                  return [
                    <tr key={key} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 px-3">{r.warehouse_name}</td>
                      <td className="py-2 px-3 font-mono">{isIssues ? r.material_document : r.delivery_document}</td>
                      <td className="py-2 px-3 font-mono">{(isIssues ? r.reservation_no : r.request_document) || '-'}</td>
                      <td className="py-2 px-3">{fmtDate(isIssues ? r.issued_on : r.delivered_on)}</td>
                      <td className="py-2 px-3">{isIssues ? r.work_type_name || '-' : fmtDate(r.received_on)}</td>
                      <td className="py-2 px-3">
                        {isIssues
                          ? `${r.customers.length} (${r.customers.filter((c) => c.matched).length} cocok permohonan)`
                          : r.status}
                      </td>
                      <td className="py-2 px-3 text-right">
                        <button type="button" className="text-blue-600 hover:underline cursor-pointer" onClick={() => setOpen(isOpen ? null : key)}>
                          {r.lines.length} baris {isOpen ? '▲' : '▼'}
                        </button>
                      </td>
                    </tr>,
                    isOpen && (
                      <tr key={`${key}-d`} className="bg-slate-50/60 dark:bg-slate-800/30">
                        <td colSpan={7} className="py-2 px-3">
                          {r.lines.length === 0 ? (
                            <span className="text-slate-500">Belum ada baris material{isIssues ? '' : ' (pengiriman belum diterima)'}.</span>
                          ) : (
                            <table className="w-full text-[11px]">
                              <thead>
                                <tr className="text-slate-500">
                                  <th className="text-left py-1 pr-3">Material</th>
                                  <th className="text-left py-1 pr-3">Uraian</th>
                                  {isIssues ? <th className="text-right py-1 pr-3">Jumlah</th> : (
                                    <>
                                      <th className="text-right py-1 pr-3">Dikirim</th>
                                      <th className="text-right py-1 pr-3">Diterima</th>
                                    </>
                                  )}
                                  <th className="text-left py-1">Satuan</th>
                                </tr>
                              </thead>
                              <tbody>
                                {r.lines.map((l, i) => (
                                  <tr key={`${l.material_no}-${i}`}>
                                    <td className="py-0.5 pr-3 font-mono">{l.material_no}</td>
                                    <td className="py-0.5 pr-3">{l.material_name || '-'}</td>
                                    {isIssues ? <td className="py-0.5 pr-3 text-right">{fmtQty(l.quantity)}</td> : (
                                      <>
                                        <td className="py-0.5 pr-3 text-right">{fmtQty(l.quantity_sent)}</td>
                                        <td className="py-0.5 pr-3 text-right">{fmtQty(l.quantity_received)}</td>
                                      </>
                                    )}
                                    <td className="py-0.5">{l.unit || '-'}</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          )}
                          {isIssues && r.customers.length > 0 && (
                            <p className="mt-2 text-[11px] text-slate-500">
                              Agenda: {r.customers.map((c) => `${c.agenda_no}${c.matched ? ' ✓' : ''}`).join(', ')}
                            </p>
                          )}
                        </td>
                      </tr>
                    ),
                  ]
                })}
              </tbody>
            </table>
          </div>
        )}
        <TableFooter
          itemCount={rows.length}
          total={total}
          entityLabel="dokumen"
          page={page}
          perPage={perPage}
          onPage={setPage}
          onPerPage={(n) => { setPerPage(n); setPage(1) }}
          perPageOptions={[10, 25, 50, 100]}
        />
      </div>
    </div>
  )
}

function ReservationTable({ rows }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-xs border-collapse">
        <thead>
          <tr className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400">
            <th className="py-2 px-3">Gudang</th>
            <th className="py-2 px-3">Reservasi</th>
            <th className="py-2 px-3">Tanggal</th>
            <th className="py-2 px-3">Jenis Pekerjaan</th>
            <th className="py-2 px-3">Status MIMS</th>
            <th className="py-2 px-3">Pelanggan</th>
            <th className="py-2 px-3">Pengeluaran</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
          {rows.map((r) => (
            <tr key={r.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
              <td className="py-2 px-3">{r.warehouse_name}</td>
              <td className="py-2 px-3 font-mono">{r.reservation_no}</td>
              <td className="py-2 px-3">{fmtDate(r.reserved_on)}</td>
              <td className="py-2 px-3">{r.work_type_name || '-'}</td>
              <td className="py-2 px-3">{r.status || '-'}</td>
              <td className="py-2 px-3">
                {r.customers.length === 0
                  ? '-'
                  : r.customers.map((c) => `${c.agenda_no}${c.application_id ? ' ✓' : ''}`).join(', ')}
              </td>
              <td className="py-2 px-3">{r.issued ? 'Sudah' : 'Belum'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
