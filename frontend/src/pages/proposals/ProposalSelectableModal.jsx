import { useState, useEffect, useCallback, useRef } from 'react'
import { proposalsApi, surveyApi } from '../../services/api.js'
import { formatTariffPower } from '../applications/ApplicationsPage.jsx'
import Modal from '../../components/Modal.jsx'
import Alert from '../../components/Alert.jsx'
import Button from '../../components/Button.jsx'
import Spinner from '../../components/Spinner.jsx'
import TableFooter from '../../components/TableFooter.jsx'
import EmptyState from '../../components/EmptyState.jsx'
import {
  IconSearch,
  IconCheck,
  IconUser,
  IconUsers,
  IconArrowUp,
  IconX,
  IconAlertCircle,
  IconInfo,
} from '../../components/icons.jsx'

/**
 * ProposalSelectableModal (docs/62 §37 & docs/76)
 * Modal pemilihan pelanggan (semua daya, kecuali status Peremajaan) untuk:
 * 1. Membuat Usulan Baru (pelanggan pertama yang dipilih = pelanggan utama/perwakilan)
 * 2. Menambah Anggota ke Usulan yang sudah ada (memerlukan alasan audit)
 * 
 * Aturan Penting:
 * - Sebelum tombol "Buat Usulan" / modal ini dibuka, tidak ada tabel pelanggan yang ditampilkan.
 * - Pelanggan 1 fasa tidak ditampilkan (dihitung via blok SR-APP pada gambar).
 */
const DEFAULT_INITIAL_ITEMS = []

export default function ProposalSelectableModal({
  open = false,
  onClose,
  proposalId = null, // if provided, mode is "add members to existing proposal"
  proposalNumber = '',
  initialSelectedItems = DEFAULT_INITIAL_ITEMS,
  initialSearch = '', // mis. nomor permohonan dari drawer: daftar pilihan langsung tersaring ke pelanggan itu
  notice = '', // peringatan tambahan untuk mode tambah anggota (mis. KKF tersimpan perlu dihitung ulang)
  surveyMode = null, // 'any' | 'individual' | 'collective': tambah usulan SURVEI (survei langsung dimulai; nomor usulan terbit setelah hasil survei memerlukan perluasan)
  onSuccess,
}) {
  const isAddingMode = Boolean(proposalId)
  const individual = surveyMode === 'individual'
  const collective = surveyMode === 'collective'
  const either = surveyMode === 'any'               // satu tombol "Tambah Survei": satu pelanggan = survei perorangan, dua atau lebih = survei kolektif

  // Search & Pagination State
  const [search, setSearch] = useState(initialSearch)
  const [page, setPage] = useState(1)
  const [perPage, setPerPage] = useState(10)
  const [loading, setLoading] = useState(false)
  const [data, setData] = useState([])
  const [meta, setMeta] = useState(null)
  const [minPowerVa, setMinPowerVa] = useState(6600)
  const [error, setError] = useState('')

  // Form State
  const [title, setTitle] = useState('')
  const [reason, setReason] = useState('')
  const [selectedItems, setSelectedItems] = useState([]) // list of full objects in order
  const [submitting, setSubmitting] = useState(false)

  // Search input ref
  const searchInputRef = useRef(null)

  // Fetch selectable customers from GET /proposals/selectable
  const fetchSelectable = useCallback(async () => {
    if (!open) return
    setLoading(true)
    setError('')
    try {
      const res = await proposalsApi.selectable({
        q: search.trim() || undefined,
        page,
        per_page: perPage,
        for_survey: surveyMode ? 1 : undefined,
      })
      setData(res?.data || [])
      setMeta(res?.meta || null)
      if (res?.min_power_va) setMinPowerVa(res.min_power_va)
    } catch (err) {
      setError(err?.response?.data?.message || err?.message || 'Gagal memuat daftar pelanggan.')
      setData([])
    } finally {
      setLoading(false)
    }
  }, [open, search, page, perPage, surveyMode])

  const initialItemsRef = useRef(initialSelectedItems)
  useEffect(() => {
    initialItemsRef.current = initialSelectedItems
  }, [initialSelectedItems])

  useEffect(() => {
    if (open) {
      if (initialItemsRef.current && initialItemsRef.current.length > 0) {
        setSelectedItems(initialItemsRef.current)
      }
      fetchSelectable()
    } else {
      setSelectedItems([])
      setTitle('')
      setReason('')
      setSearch('')
      setPage(1)
      setError('')
    }
  }, [open, fetchSelectable])

  if (!open) return null

  // Selection handlers
  const isSelected = (id) => selectedItems.some((item) => item.id === id)

  const toggleSelect = (customer) => {
    if (isSelected(customer.id)) {
      setSelectedItems((prev) => prev.filter((item) => item.id !== customer.id))
    } else if (individual) {
      setSelectedItems([customer])
    } else {
      setSelectedItems((prev) => [...prev, customer])
    }
  }

  const makeRepresentative = (index) => {
    if (index === 0) return
    setSelectedItems((prev) => {
      const item = prev[index]
      const next = prev.filter((_, idx) => idx !== index)
      return [item, ...next]
    })
  }

  const removeItem = (id) => {
    setSelectedItems((prev) => prev.filter((item) => item.id !== id))
  }

  // Submit Handler
  const handleSubmit = async (e) => {
    e.preventDefault()
    if (selectedItems.length === 0) {
      setError('Pilih minimal satu pelanggan untuk usulan.')
      return
    }

    if (collective && selectedItems.length < 2) {
      setError('Survei kolektif memerlukan minimal dua pelanggan; untuk satu pelanggan pilih survei perorangan.')
      return
    }

    if (isAddingMode && !reason.trim()) {
      setError('Alasan penambahan anggota wajib diisi.')
      return
    }

    setSubmitting(true)
    setError('')
    try {
      const applicationIds = selectedItems.map((item) => item.id)
      const asIndividual = individual || (either && applicationIds.length === 1)
      const asCollective = collective || (either && applicationIds.length >= 2)

      if (asIndividual) {
        const res = await surveyApi.create(applicationIds[0], {})
        onSuccess?.(res?.data)
        onClose?.()
        return
      }

      if (isAddingMode) {
        await proposalsApi.addMembers(proposalId, {
          application_ids: applicationIds,
          reason: reason.trim(),
        })
      } else {
        const res = await proposalsApi.create({
          application_ids: applicationIds,
          title: title.trim() || undefined,
          start_survey: asCollective ? true : undefined,
        })
        onSuccess?.(res?.data)
        onClose?.()
        return
      }

      onSuccess?.()
      onClose?.()
    } catch (err) {
      // Tampilkan 403, 404, 409, 422 apa adanya
      setError(err?.response?.data?.message || err?.message || 'Gagal menyimpan usulan.')
    } finally {
      setSubmitting(false)
    }
  }

  const startLabel = either && selectedItems.length === 1 ? ' Perorangan' : either && selectedItems.length >= 2 ? ' Kolektif' : ''

  return (
    <Modal
      open={open ?? true}
      onClose={onClose}
      title={isAddingMode ? `Tambah Anggota Usulan ${proposalNumber}` : either ? 'Tambah Survei' : individual ? 'Tambah Survei Perorangan' : collective ? 'Tambah Survei Kolektif' : 'Buat Usulan Perluasan'}
      maxWidth="max-w-5xl"
    >
      <form onSubmit={handleSubmit} className="space-y-5 text-xs">
        {/* Banner Info */}
        <div className="p-3.5 rounded-xl bg-blue-50/80 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 text-blue-900 dark:text-blue-200 flex items-start gap-2.5">
          <IconInfo size={16} className="shrink-0 mt-0.5 text-blue-600 dark:text-blue-400" />
          <div className="space-y-0.5">
            <span className="font-bold block">
              {either ? 'Pilih satu atau beberapa pelanggan untuk disurvei' : individual ? 'Pilih satu pelanggan untuk disurvei' : collective ? 'Pilih beberapa pelanggan untuk satu survei kolektif' : 'Pilihan Pelanggan Usulan Perluasan'}
            </span>
            <p className="text-[11px] text-blue-800 dark:text-blue-300 leading-relaxed">
              {surveyMode
                ? `${either ? 'Satu pelanggan = survei perorangan; dua atau lebih = satu survei kolektif untuk semuanya. ' : ''}Survei langsung dimulai atas nama Anda. Nomor usulan baru terbit bila hasil survei memerlukan perluasan jaringan; bila tidak, pelanggan langsung siap pasang. Tabel memuat permohonan Disetujui, Bayar, atau Cetak PK pada ULP Anda yang belum punya survei aktif, berapa pun dayanya (permohonan berstatus Peremajaan tidak ditampilkan).`
                : 'Satu atau beberapa pelanggan dikaji dalam satu proses: survei, gambar, MTO, RAB, alokasi, SPK, dan KKF gabungan. Tabel ini memuat semua pelanggan berstatus mohon, disetujui, bayar, atau cetak PK, berapa pun daya dan tarifnya, pada ULP Anda yang belum masuk usulan aktif lainnya.'}
            </p>
          </div>
        </div>

        {error && (
          <Alert variant="danger">
            {error}
          </Alert>
        )}

        {/* Inputs (Title / Reason) */}
        {individual || (either && selectedItems.length < 2) ? null : !isAddingMode ? (
          <div className="space-y-1">
            <label htmlFor="proposal-title" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Judul Usulan <span className="text-slate-400 font-normal">(Opsional)</span>
            </label>
            <input
              id="proposal-title"
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Contoh: Perluasan JTM Kawasan Industri Ngoro Blok C"
              maxLength={200}
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        ) : (
          <div className="space-y-1">
            {notice && (
              <p className="text-[11px] text-amber-800 dark:text-amber-300 bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900 rounded-lg px-3 py-2 mb-2">
                {notice}
              </p>
            )}
            <label htmlFor="proposal-add-reason" className="block text-xs font-semibold text-slate-700 dark:text-slate-300">
              Alasan Penambahan Anggota <span className="text-rose-500">*</span>
            </label>
            <textarea
              id="proposal-add-reason"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Jelaskan alasan penambahan pelanggan ke dalam usulan ini..."
              required
              className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        )}

        {/* Search Bar */}
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none text-slate-400">
              <IconSearch size={14} />
            </span>
            <input
              ref={searchInputRef}
              type="text"
              value={search}
              onChange={(e) => {
                setSearch(e.target.value)
                setPage(1)
              }}
              placeholder="Cari nama pelanggan, IDPEL, nomor permohonan, atau alamat..."
              className="w-full pl-9 pr-3 py-2 text-xs rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          {search && (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => {
                setSearch('')
                setPage(1)
              }}
            >
              Reset
            </Button>
          )}
        </div>

        {/* Selectable Customer Table */}
        <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden bg-white dark:bg-slate-900 shadow-2xs">
          {data.length === 0 && !loading ? (
            <EmptyState
              icon={IconUsers}
              title={search ? 'Tidak ada pelanggan yang cocok' : 'Belum ada calon pelanggan'}
              description={
                search
                  ? 'Coba sesuaikan kata kunci pencarian nama atau IDPEL.'
                  : 'Tidak ada permohonan yang memenuhi syarat untuk dipilih saat ini (status Disetujui, Bayar, atau Cetak PK, belum punya survei aktif).'
              }
            />
          ) : (
            <div className="overflow-x-auto max-h-72 border border-slate-200 dark:border-slate-700 rounded-xl shadow-2xs">
              <table className="w-full text-left border-collapse text-xs">
                <thead className="sticky top-0 bg-slate-50 dark:bg-slate-800/90 backdrop-blur-xs text-[11px] font-bold uppercase tracking-wider text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700 z-10">
                  <tr>
                    <th className="py-2.5 px-3 w-12 text-center">Pilih</th>
                    <th className="py-2.5 px-3 w-44">No. Permohonan</th>
                    <th className="py-2.5 px-3 w-20 text-center">Jenis</th>
                    <th className="py-2.5 px-3 min-w-[180px]">Pelanggan & IDPEL</th>
                    <th className="py-2.5 px-3 w-36">Tarif & Daya Baru</th>
                    <th className="py-2.5 px-3 min-w-[200px]">Alamat Pelayanan</th>
                    <th className="py-2.5 px-3 w-28">ULP</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-sans">
                  {loading ? (
                    <tr>
                      <td colSpan={7} className="py-10 text-center text-slate-400">
                        <div className="flex flex-col items-center justify-center gap-2">
                          <Spinner size="sm" />
                          <span>Memuat data pelanggan...</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    data.map((row) => {
                      const selected = isSelected(row.id)
                      const isPb = row.application_type === 'PB'
                      return (
                        <tr
                          key={row.id}
                          onClick={() => toggleSelect(row)}
                          className={`transition cursor-pointer select-none ${
                            selected
                              ? 'bg-blue-50/80 dark:bg-blue-950/40'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800/50'
                          }`}
                        >
                          <td className="py-2.5 px-3 text-center" onClick={(e) => e.stopPropagation()}>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => toggleSelect(row)}
                              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                            />
                          </td>
                          <td className="py-2.5 px-3 font-mono font-semibold text-slate-900 dark:text-slate-100">
                            {row.application_number}
                          </td>
                          <td className="py-2.5 px-3 text-center">
                            <span
                              className={`inline-block px-2 py-0.5 rounded text-[10px] font-bold ${
                                isPb
                                  ? 'bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300'
                                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950/60 dark:text-amber-300'
                              }`}
                            >
                              {row.application_type}
                            </span>
                          </td>
                          <td className="py-2.5 px-3">
                            <span className="font-semibold text-slate-900 dark:text-slate-100 block truncate" title={row.customer_name}>
                              {row.customer_name}
                            </span>
                            <span className="text-[11px] text-slate-500 font-mono">
                              IDPEL: {row.idpel || '-'}
                            </span>
                          </td>
                          <td className="py-2.5 px-3 font-medium text-slate-800 dark:text-slate-200">
                            {formatTariffPower(row.new_tariff_code, row.new_power_value, row.new_power_unit)}
                          </td>
                          <td className="py-2.5 px-3 text-slate-600 dark:text-slate-400 max-w-xs truncate" title={row.service_address}>
                            {row.service_address || '-'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-500 font-mono text-[11px]">
                            {row.ulp_name || row.ulp_code || '-'}
                          </td>
                        </tr>
                      )
                    })
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Standardized Table Footer */}
          <TableFooter
            meta={meta}
            itemCount={data.length}
            total={meta?.total ?? data.length}
            entityLabel="calon pelanggan"
            page={page}
            perPage={perPage}
            onPage={setPage}
            onPerPage={(n) => {
              setPerPage(n)
              setPage(1)
            }}
            perPageOptions={[10, 25, 50, 100]}
          />
        </div>

        {/* Selected Customers Order Panel */}
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/60 dark:bg-slate-800/40 space-y-2.5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <IconUsers size={16} className="text-blue-600 dark:text-blue-400" />
              <span className="font-bold text-slate-900 dark:text-slate-100">
                Pelanggan Terpilih ({selectedItems.length})
              </span>
            </div>
            {!isAddingMode && selectedItems.length > 0 && (
              <span className="text-[11px] text-slate-500">
                Urutan pertama otomatis menjadi <strong>Pelanggan Utama (Perwakilan)</strong>.
              </span>
            )}
          </div>

          {selectedItems.length === 0 ? (
            <p className="text-[11px] text-slate-400 italic py-1">
              Belum ada pelanggan yang dipilih. Centang baris pada tabel di atas.
            </p>
          ) : (
            <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
              {selectedItems.map((item, idx) => {
                const isRep = idx === 0 && !isAddingMode
                return (
                  <div
                    key={item.id}
                    className={`flex items-center justify-between p-2 rounded-lg border text-xs transition ${
                      isRep
                        ? 'bg-blue-100/70 dark:bg-blue-900/30 border-blue-300 dark:border-blue-700'
                        : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="w-5 text-center font-bold text-slate-500 font-mono text-[11px]">
                        {idx + 1}.
                      </span>
                      {isRep && (
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-tight bg-blue-600 text-white shadow-2xs shrink-0">
                          Pelanggan Utama (Perwakilan)
                        </span>
                      )}
                      <div className="truncate">
                        <strong className="text-slate-900 dark:text-slate-100 mr-2">
                          {item.customer_name}
                        </strong>
                        <span className="text-[11px] text-slate-500 font-mono">
                          ({item.application_number} · IDPEL: {item.idpel || '-'} · {formatTariffPower(item.new_tariff_code, item.new_power_value, item.new_power_unit)})
                        </span>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 shrink-0 ml-2">
                      {!isAddingMode && idx > 0 && (
                        <button
                          type="button"
                          onClick={() => makeRepresentative(idx)}
                          className="px-2 py-1 text-[11px] font-semibold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded inline-flex items-center gap-1 transition"
                          title="Jadikan sebagai Pelanggan Utama"
                        >
                          <IconArrowUp size={12} />
                          <span>Jadikan Utama</span>
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeItem(item.id)}
                        className="p-1 text-slate-400 hover:text-rose-600 rounded transition"
                        title="Hapus dari daftar pilihan"
                      >
                        <IconX size={14} />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>

        {/* Modal Action Buttons */}
        <div className="flex items-center justify-end gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={submitting}
          >
            Batal
          </Button>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={selectedItems.length === 0}
            aria-label={
              surveyMode
                ? `Mulai Survei${startLabel} (${selectedItems.length})`
                : isAddingMode
                ? `Tambah ke Usulan (${selectedItems.length})`
                : `Simpan Usulan (${selectedItems.length}) - Simpan Usulan Perluasan (${selectedItems.length})`
            }
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {surveyMode ? `Mulai Survei${startLabel} (${selectedItems.length})` : isAddingMode ? `Tambah ke Usulan (${selectedItems.length})` : `Simpan Usulan Perluasan (${selectedItems.length})`}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
