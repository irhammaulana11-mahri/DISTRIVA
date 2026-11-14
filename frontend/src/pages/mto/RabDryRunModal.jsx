import Button from '../../components/Button.jsx'
import Modal from '../../components/Modal.jsx'
import Alert from '../../components/Alert.jsx'
import {
  IconCalculator,
  IconCheck,
  IconAlertCircle,
  IconLayers,
} from '../../components/icons.jsx'

function formatRupiah(value) {
  if (value === null || value === undefined || isNaN(value)) return 'Rp 0'
  return new Intl.NumberFormat('id-ID', {
    style: 'currency',
    currency: 'IDR',
    maximumFractionDigits: 0,
  }).format(value)
}

export default function RabDryRunModal({
  open,
  onClose,
  data,
  isDryRun = true,
  canSave = false,
  saving = false,
  onSave,
}) {
  if (!open || !data) return null

  const rawGroups = data.groups || {}
  const groupEntries = Array.isArray(rawGroups)
    ? rawGroups.map((g) => [g.code || g.name, g])
    : Object.entries(rawGroups)
  const warnings = data.warnings || []

  return (
    <Modal
      open={open ?? true}
      onClose={onClose}
      title={isDryRun ? 'Hasil Kalkulasi RAB (Dry Run / Simulasi)' : `Hasil Kalkulasi RAB Run #${data.run_number || ''}`}
      maxWidth="max-w-5xl"
    >
      <div className="space-y-5 text-xs">
        {/* Banner Status */}
        <div className="p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
              {isDryRun ? 'Simulasi Perhitungan Tanpa Menyimpan' : 'Run RAB Tersimpan'}
            </span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                Buku Harga: {data.price_book?.name || data.price_book_name || '-'}
              </span>
              <span className="text-slate-400">·</span>
              <span className="font-semibold text-blue-600 dark:text-blue-400">
                Zona UP3 {data.zone || '-'}
              </span>
              <span className="text-slate-400">·</span>
              <span className="text-slate-500">
                Tanggal: {data.valid_on || '-'}
              </span>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[10px] text-slate-400 uppercase tracking-wider">Total RAB Keseluruhan</span>
            <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono">
              {formatRupiah(data.grand_total)}
            </div>
          </div>
        </div>

        {/* Warnings */}
        {warnings.length > 0 && (
          <div className="p-3 rounded-lg border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-300 space-y-1">
            <div className="flex items-center gap-1.5 font-bold">
              <IconAlertCircle size={14} />
              <span>Peringatan Kalkulasi RAB:</span>
            </div>
            <ul className="list-disc list-inside text-[11px] space-y-0.5 pl-2">
              {warnings.map((w, idx) => (
                <li key={idx}>
                  {w === 'NO_INSURED_VALUE'
                    ? 'Terdapat kode komponen dalam daftar asuransi BOM yang tidak memiliki nilai asuransi di buku harga (biaya asuransi dihitung Rp 0).'
                    : typeof w === 'string'
                      ? w
                      : w?.message
                        ? `${w.khs_code ? `KHS ${w.khs_code}` : ''}${w.group ? ` (${w.group})` : ''}${w.khs_code || w.group ? ': ' : ''}${w.message}`
                        : JSON.stringify(w)}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Breakdown Per Kelompok Pekerjaan */}
        <div>
          <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-2 flex items-center gap-1.5">
            <IconLayers size={14} />
            <span>Rincian Biaya Per Kelompok Pekerjaan</span>
          </h4>

          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-x-auto">
            <table className="w-full text-left text-xs border-collapse">
              <thead>
                <tr className="bg-slate-50 dark:bg-slate-800/60 font-semibold text-[11px] text-slate-600 dark:text-slate-400 border-b border-slate-200 dark:border-slate-800">
                  <th className="py-2.5 px-3">Kelompok</th>
                  <th className="py-2.5 px-3 text-right">Material</th>
                  <th className="py-2.5 px-3 text-right">Jasa Pasang/Bongkar</th>
                  <th className="py-2.5 px-3 text-right">Commissioning</th>
                  <th className="py-2.5 px-3 text-right">K3L</th>
                  <th className="py-2.5 px-3 text-right">Asuransi</th>
                  <th className="py-2.5 px-3 text-right">Subtotal</th>
                  <th className="py-2.5 px-3 text-right">PPN 11%</th>
                  <th className="py-2.5 px-3 text-right font-bold text-slate-800 dark:text-slate-200">
                    Total Kelompok
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-mono text-[11px]">
                {groupEntries.map(([k, g]) => {
                  return (
                    <tr key={k} className="hover:bg-slate-50/60 dark:hover:bg-slate-800/30">
                      <td className="py-2.5 px-3 font-bold font-sans text-slate-800 dark:text-slate-200">
                        <div>{k}</div>
                        {g?.name && g.name !== k && (
                          <div className="text-[10px] font-normal text-slate-500 font-sans">{g.name}</div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div>{formatRupiah(g?.material)}</div>
                        {Number(g?.material_pln) > 0 && (
                          <div className="text-[10px] font-normal text-slate-500 font-sans" data-testid={`rab-material-pln-${k}`}>
                            termasuk material PLN/MDU {formatRupiah(g.material_pln)}
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right">{formatRupiah(g?.service)}</td>
                      <td className="py-2.5 px-3 text-right">{formatRupiah(g?.commissioning)}</td>
                      <td className="py-2.5 px-3 text-right">{formatRupiah(g?.k3l)}</td>
                      <td className="py-2.5 px-3 text-right">{formatRupiah(g?.insurance)}</td>
                      <td className="py-2.5 px-3 text-right text-slate-700 dark:text-slate-300 font-semibold">
                        {formatRupiah(g?.subtotal)}
                      </td>
                      <td className="py-2.5 px-3 text-right text-slate-500">{formatRupiah(g?.ppn)}</td>
                      <td className="py-2.5 px-3 text-right font-bold text-blue-700 dark:text-blue-400">
                        {formatRupiah(g?.total)}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr className="bg-slate-100/75 dark:bg-slate-800/80 font-bold border-t-2 border-slate-300 dark:border-slate-700">
                  <td className="py-3 px-3 text-slate-900 dark:text-slate-100 font-sans" colSpan={8}>
                    TOTAL KESELURUHAN (GRAND TOTAL)
                  </td>
                  <td className="py-3 px-3 text-right font-mono text-sm text-emerald-600 dark:text-emerald-400">
                    {formatRupiah(data.grand_total)}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>

        {/* Snapshot Hash */}
        {data.snapshot_hash && (
          <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 text-[11px] font-mono text-slate-500 break-all">
            <span className="font-semibold text-slate-700 dark:text-slate-300">Kode Hash Validasi: </span>
            {data.snapshot_hash}
          </div>
        )}

        {/* Modal Footer Actions */}
        <div className="flex items-center justify-between pt-3 border-t border-slate-100 dark:border-slate-800">
          <Button type="button" variant="secondary" onClick={onClose}>
            Tutup
          </Button>

          {isDryRun && canSave && (
            <Button
              type="button"
              variant="primary"
              loading={saving}
              onClick={onSave}
              className="bg-blue-600 hover:bg-blue-700 text-white"
              icon={IconCheck}
            >
              Simpan Sebagai Run Resmi
            </Button>
          )}
        </div>
      </div>
    </Modal>
  )
}
