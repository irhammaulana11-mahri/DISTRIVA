import React from 'react'

/**
 * Tab Tunggakan & Pelunasan untuk Piutang Prabayar (docs/91 §3, docs/92 §6.4, Butir 52).
 *
 * Menampilkan:
 * (a) Batang bulanan bertumpuk (monthly: baru, berjalan, tunggakan) dengan garis pelunasan (definisi NKO)
 *     dan efektivitas pelunasan %.
 * (b) Kartu "Tunggakan Beku" dari frozen ("Rp X tidak bergerak N bulan, Y% dari total"; tampilkan hanya bila frozen.frozen: true).
 * (c) Tabel per ULP (ulps) dan per tarif (tariffs) dengan arrears_share_pct.
 * (d) Peringatan data anomali dari anomalies[] ("piutang baru bulan ini jauh di atas/bawah biasanya; periksa cakupan laporan").
 * (e) Kartu prakiraan tunggakan (forecast) dengan backtest wajib tampil, label "petunjuk" bila reliable: false.
 * (f) Catatan teknis dari notes[]; tanpa roll-rate / calon PRR untuk prabayar.
 */
export default function PrepaidReceivableTab({ detail, metricCode }) {
  if (!detail || detail.kind !== 'prepaid_receivable') {
    return (
      <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500">
        Data wawasan piutang prabayar belum tersedia.
      </div>
    )
  }

  const {
    month,
    monthly = [],
    frozen = {},
    ulps = [],
    tariffs = [],
    anomalies = [],
    forecast = {},
    notes = [],
  } = detail

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-100 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300">
            Tunggakan &amp; Pelunasan Piutang Prabayar
          </span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Bulan: <strong className="text-slate-700 dark:text-slate-200">{month}</strong>
          </span>
        </div>
        <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
          Memantau saldo piutang prabayar (baru, berjalan, tunggakan), pelunasan berbasis NKO, identifikasi tunggakan beku,
          dan deteksi anomali cakupan laporan.
        </p>
      </div>

      {/* Peringatan Anomali Data Piutang Baru (anomalies[]) */}
      {anomalies.length > 0 && (
        <div className="p-4 bg-amber-50 dark:bg-amber-950/50 rounded-xl border border-amber-200 dark:border-amber-800 text-xs text-amber-900 dark:text-amber-200 space-y-2">
          <div className="flex items-center gap-2 font-bold text-amber-800 dark:text-amber-300">
            <svg className="w-4 h-4 text-amber-600 shrink-0" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>Peringatan Data Anomali Piutang Baru:</span>
          </div>
          <ul className="list-disc pl-5 space-y-1">
            {anomalies.map((a, idx) => (
              <li key={idx}>
                Bulan <strong>{a.month}</strong>: Piutang baru (Rp {(a.baru / 1e6).toFixed(1)} Juta) menyimpang jauh {a.direction} dari median 12 bulan sebelumnya (Rp {(a.median_prev_12m / 1e6).toFixed(1)} Juta).
                {a.top_ulp && ` Penyumbang utama: ${a.top_ulp.unit_name} (Rp ${(a.top_ulp.baru / 1e6).toFixed(1)} Juta).`}
                <span className="italic text-amber-700 dark:text-amber-400 block sm:inline sm:ml-1">
                  * Periksa cakupan laporan; bukan cerminan langsung kinerja penagihan ULP.
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Kartu Tunggakan Beku & Kartu Prakiraan Tunggakan */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Kartu Tunggakan Beku (hanya tampil bila frozen: true) */}
        {frozen && frozen.frozen && (
          <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                Tunggakan Beku (Tidak Bergerak)
              </h4>
              <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                {frozen.stable_months} Bulan Statis
              </span>
            </div>
            <div className="text-2xl font-bold text-slate-800 dark:text-slate-100 font-mono">
              Rp {(frozen.arrears / 1e6).toLocaleString('id-ID')} Juta
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Menyumbang <strong>{frozen.share_of_total_pct?.toFixed(1) || '-'}%</strong> dari total piutang prabayar.
              Saldo tidak bergerak dalam batas toleransi &plusmn;{frozen.tolerance_pct}% selama {frozen.stable_months} bulan berturut-turut.
            </p>
            <p className="text-[11px] text-slate-400 italic">
              * Kandidat penagihan khusus lapangan atau evaluasi usulan penghapusan piutang.
            </p>
          </div>
        )}

        {/* Kartu Prakiraan Tunggakan Bulan Depan */}
        {forecast && forecast.available && (
          <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-2">
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
                Prakiraan Saldo Tunggakan ({forecast.month})
              </h4>
              {forecast.reliable ? (
                <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                  Model Andal
                </span>
              ) : (
                <span className="text-[10px] px-2 py-0.5 rounded font-bold bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300">
                  Petunjuk
                </span>
              )}
            </div>
            <div className="text-2xl font-bold text-blue-600 dark:text-blue-400 font-mono">
              Rp {(forecast.arrears / 1e6).toLocaleString('id-ID')} Juta
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Tunggakan prabayar cenderung persisten (metode nilai terakhir).
            </p>
            {forecast.backtest && (
              <div className="pt-2 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
                Uji mundur ({forecast.backtest.months} bulan): Kesalahan (MAPE) <strong>{forecast.backtest.naive_mape_pct?.toFixed(1) || '-'}%</strong> vs Rata-rata 3 Bulan <strong>{forecast.backtest.mean3_mape_pct?.toFixed(1) || '-'}%</strong>.
              </div>
            )}
          </div>
        )}
      </div>

      {/* Riwayat Bulanan Komposisi & Pelunasan (monthly) */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Riwayat Komposisi Piutang Prabayar &amp; Pelunasan
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Pelunasan dihitung sesuai formula NKO antar bulan dengan jumlah ULP identik.
              </p>
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400 bg-slate-50 dark:bg-slate-800/80 px-2.5 py-1.5 rounded-lg border border-slate-200/80 dark:border-slate-700">
              <span className="font-semibold text-slate-700 dark:text-slate-300">Catatan Piutang Baru:</span> Hampir seluruhnya angsuran BP (pasang baru dicicil). Angsuran P2TL adalah sisa cicilan pelanggan tetap (berkurang satu/bln), bukan piutang baru yang terbit.
            </div>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-2.5 px-3 font-semibold">Bulan</th>
                <th className="py-2.5 px-3 font-semibold text-right" title="Total piutang yang terbit pada bulan itu">
                  Total Baru (Rp)
                </th>
                <th className="py-2.5 px-3 font-semibold text-right text-indigo-600 dark:text-indigo-400" title="Angsuran Biaya Penyambungan (pasang baru dicicil)">
                  Angsuran BP (Rp)
                </th>
                <th className="py-2.5 px-3 font-semibold text-right text-amber-600 dark:text-amber-400" title="Angsuran P2TL: sisa cicilan kelompok pelanggan tetap yang berkurang satu per bulan, bukan piutang baru terbit">
                  Angsuran P2TL (Rp)*
                </th>
                <th className="py-2.5 px-3 font-semibold text-right text-slate-500" title="Sisa komponen baru lainnya">
                  Baru Lainnya (Rp)
                </th>
                <th className="py-2.5 px-3 font-semibold text-right">Berjalan (Rp)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Tunggakan (Rp)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Total Saldo (Rp)</th>
                <th className="py-2.5 px-3 font-semibold text-right text-emerald-600 dark:text-emerald-400">Pelunasan NKO (Rp)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Efektivitas (%)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {monthly.map((row) => {
                const hasBreakdown = row.baru_angsuran_bp !== undefined || row.baru_angsuran_p2tl !== undefined || row.baru_lainnya !== undefined
                return (
                  <tr key={row.month} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                      {row.month}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-slate-800 dark:text-slate-100">
                      Rp {(row.baru / 1e6).toFixed(1)} Jt
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-indigo-600 dark:text-indigo-400">
                      {hasBreakdown && row.baru_angsuran_bp !== undefined ? `Rp ${(row.baru_angsuran_bp / 1e6).toFixed(1)} Jt` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-amber-600 dark:text-amber-400">
                      {hasBreakdown && row.baru_angsuran_p2tl !== undefined ? `Rp ${(row.baru_angsuran_p2tl / 1e6).toFixed(1)} Jt` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-500 dark:text-slate-400">
                      {hasBreakdown && row.baru_lainnya !== undefined ? `Rp ${(row.baru_lainnya / 1e6).toFixed(1)} Jt` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      Rp {(row.berjalan / 1e6).toFixed(1)} Jt
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      Rp {(row.tunggakan / 1e6).toFixed(1)} Jt
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-100">
                      Rp {(row.total / 1e6).toFixed(1)} Jt
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                      {row.pelunasan !== null && row.pelunasan !== undefined ? `Rp ${(row.pelunasan / 1e6).toFixed(1)} Jt` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-medium text-blue-600 dark:text-blue-400">
                      {row.effectiveness_pct !== null && row.effectiveness_pct !== undefined ? `${row.effectiveness_pct.toFixed(1)}%` : '-'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <div className="p-3 bg-slate-50/50 dark:bg-slate-800/30 border-t border-slate-100 dark:border-slate-800 text-[11px] text-slate-500 dark:text-slate-400">
          <span className="font-semibold text-amber-700 dark:text-amber-400">* Keterangan Angsuran P2TL:</span> Pada kolom BARU, komponen angsuran P2TL merupakan sisa cicilan kelompok pelanggan tetap yang berkurang satu cicilan per bulan, bukan merupakan piutang baru yang terbit di bulan berjalan.
        </div>
      </div>

      {/* Tabel Per ULP & Per Golongan Tarif */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tabel Per ULP */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Posisi Per ULP ({month})
            </h4>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2 px-3 font-semibold">ULP</th>
                  <th className="py-2 px-3 font-semibold text-right">Tunggakan (Rp)</th>
                  <th className="py-2 px-3 font-semibold text-right">Porsi (%)</th>
                  <th className="py-2 px-3 font-semibold text-right">Pelanggan</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {ulps.map((u) => (
                  <tr key={u.unit_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                      {u.unit_name}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-slate-800 dark:text-slate-100">
                      Rp {(u.tunggakan / 1e6).toFixed(1)} Jt
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {u.arrears_share_pct !== null && u.arrears_share_pct !== undefined ? `${u.arrears_share_pct.toFixed(1)}%` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {u.customers?.toLocaleString('id-ID')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tabel Per Tarif */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Tunggakan Per Golongan Tarif ({month})
            </h4>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2 px-3 font-semibold">Tarif</th>
                  <th className="py-2 px-3 font-semibold text-right">Tunggakan (Rp)</th>
                  <th className="py-2 px-3 font-semibold text-right">Porsi (%)</th>
                  <th className="py-2 px-3 font-semibold text-right">Baru (Rp)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {tariffs.map((t) => (
                  <tr key={t.tariff} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-semibold text-slate-800 dark:text-slate-200">
                      {t.tariff}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-slate-800 dark:text-slate-100">
                      Rp {(t.tunggakan / 1e6).toFixed(1)} Jt
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {t.arrears_share_pct !== null && t.arrears_share_pct !== undefined ? `${t.arrears_share_pct.toFixed(1)}%` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      Rp {(t.baru / 1e6).toFixed(1)} Jt
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Catatan Penjelas dari Backend */}
      {notes && notes.length > 0 && (
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
          <div className="font-semibold text-slate-700 dark:text-slate-300">Catatan Analisa Piutang Prabayar:</div>
          <ul className="list-disc pl-5 space-y-1">
            {notes.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
