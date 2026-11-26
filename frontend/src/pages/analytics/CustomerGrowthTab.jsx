import React from 'react'

/**
 * Tab Pertumbuhan untuk Pelanggan dan Daya (docs/91 §3, docs/92 §6.1, Butir 51).
 *
 * Menampilkan:
 * (a) Batang rekonsiliasi bulanan (reconciliation[]) connected vs official dengan garis residual
 *     (label dari residual_label; untuk daya sisa bisa negatif karena tambahan di luar permohonan).
 * (b) Kartu lama sambung (lead_time: median & p90, "hampir semua tersambung dlm 30 hari")
 *     dan kartu antrean PB (queue: live_* sebagai antrean berjalan, stale terpisah sebagai kedaluwarsa,
 *     bukan potensi sambungan, in_network_proposal sebagai menunggu jaringan).
 * (c) Kartu proyeksi akhir bulan (month_projection jika tidak null: projected, connected_so_far,
 *     wajib menampilkan backtest runrate vs last_month).
 * (d) Tabel kecamatan (areas.rows) dan tabel gardu tumbuh cepat (gardu.rows) dengan lencana "perlu kapasitas" (capacity_watch).
 * (e) Tabel perubahan daya (power_changes.groups: naik, turun, sama per golongan).
 * (f) Catatan dari notes[]; jangan membuat prakiraan 3 sampai 6 bulan dari antrean.
 */
export default function CustomerGrowthTab({ detail, metricCode }) {
  if (!detail || detail.kind !== 'customer_growth') {
    return (
      <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-500">
        Data wawasan pertumbuhan pelanggan/daya belum tersedia.
      </div>
    )
  }

  const {
    focus,
    month,
    partial = false,
    reconciliation = [],
    lead_time: leadTime = {},
    queue = {},
    month_projection: projection,
    areas = {},
    gardu = {},
    power_changes: powerChanges = {},
    notes = [],
  } = detail

  const isDaya = metricCode === 'daya' || focus === 'daya'
  const unitLabel = isDaya ? 'kVA' : 'pelanggan'

  const areaRows = areas.rows || []
  const garduRows = gardu.rows || []
  const powerGroups = powerChanges.groups || []

  return (
    <div className="space-y-6">
      {/* Header Info & Partial Notice */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700">
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-950/70 dark:text-blue-300">
              Pertumbuhan &amp; Dinamika Lapangan
            </span>
            <span className="text-xs text-slate-500 dark:text-slate-400">
              Bulan: <strong className="text-slate-700 dark:text-slate-200">{month}</strong>
            </span>
          </div>
          <p className="text-xs text-slate-600 dark:text-slate-400 mt-1">
            Rekonsiliasi realisasi permohonan tersambung vs posisi 309, kecepatan sambung, antrean berjalan vs kedaluwarsa,
            wilayah/gardu bertumbuh, dan dinamika perubahan daya.
          </p>
        </div>

        {partial && (
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 text-amber-800 dark:text-amber-300 text-xs font-medium">
            <svg className="w-4 h-4 shrink-0 text-amber-600" fill="currentColor" viewBox="0 0 20 20">
              <path fillRule="evenodd" d="M8.257 3.099c.765-1.36 2.722-1.36 3.486 0l5.58 9.92c.75 1.334-.213 2.98-1.742 2.98H4.42c-1.53 0-2.493-1.646-1.743-2.98l5.58-9.92zM11 13a1 1 0 11-2 0 1 1 0 012 0zm-1-8a1 1 0 00-1 1v3a1 1 0 002 0V6a1 1 0 00-1-1z" clipRule="evenodd" />
            </svg>
            <span>Bulan berjalan belum lengkap</span>
          </div>
        )}
      </div>

      {/* Proyeksi Akhir Bulan Berjalan (Bila ada) */}
      {projection && (
        <div className="p-5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs">
          <div className="flex flex-col md:flex-row md:items-start justify-between gap-4">
            <div className="space-y-1.5">
              <div className="flex items-center gap-2">
                <span className="text-sm font-bold text-slate-800 dark:text-slate-100">
                  Proyeksi Akhir Bulan Berjalan ({projection.month})
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300">
                  Hari ke-{projection.day} dari {projection.days_in_month}
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-400">
                {projection.note}
              </p>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 shrink-0">
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
                <div className="text-[10px] uppercase font-semibold text-slate-500">Tersambung s.d. Hari Ini</div>
                <div className="text-sm font-bold text-slate-800 dark:text-slate-100 font-mono">
                  {projection.connected_so_far?.toLocaleString('id-ID')}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
                <div className="text-[10px] uppercase font-semibold text-slate-500">Proyeksi Akhir Bulan</div>
                <div className="text-sm font-bold text-blue-600 dark:text-blue-400 font-mono">
                  {projection.projected?.toLocaleString('id-ID')}
                </div>
              </div>
              <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center col-span-2 sm:col-span-1">
                <div className="text-[10px] uppercase font-semibold text-slate-500">Bulan Lalu</div>
                <div className="text-sm font-bold text-slate-600 dark:text-slate-400 font-mono">
                  {projection.last_month?.toLocaleString('id-ID') || '-'}
                </div>
              </div>
            </div>
          </div>

          {/* Evaluasi Uji Mundur Proyeksi */}
          {projection.backtest && (
            <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-400">
              <div>
                <span className="font-semibold text-slate-700 dark:text-slate-300">Uji Mundur Tanggal Serupa ({projection.backtest.months || 0} bulan):</span>
                <span className="ml-1">
                  Kesalahan laju berjalan (MAPE) <strong>{projection.backtest.runrate_mape_pct !== null && projection.backtest.runrate_mape_pct !== undefined ? projection.backtest.runrate_mape_pct.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}%</strong> vs Memakai Angka Bulan Lalu <strong>{projection.backtest.last_month_mape_pct !== null && projection.backtest.last_month_mape_pct !== undefined ? projection.backtest.last_month_mape_pct.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 }) : '-'}%</strong>.
                </span>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Kartu Lama Sambung & Kartu Antrean PB */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Lama Sambung (Lead Time) */}
        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Kecepatan Penyambungan PB (Bayar Sampai Nyala)
            </h4>
            <span className="text-[11px] text-slate-400">12 Bulan Terakhir</span>
          </div>

          <div className="grid grid-cols-3 gap-2 pt-1">
            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
              <div className="text-[10px] uppercase font-semibold text-slate-500">Median Hari</div>
              <div className="text-lg font-bold text-slate-800 dark:text-slate-100 font-mono mt-0.5">
                {leadTime.median_days !== null && leadTime.median_days !== undefined ? `${leadTime.median_days.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : '-'}
              </div>
              <div className="text-[10px] text-slate-400">50% &le; waktu ini</div>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
              <div className="text-[10px] uppercase font-semibold text-slate-500">Persentil 90</div>
              <div className="text-lg font-bold text-slate-800 dark:text-slate-100 font-mono mt-0.5">
                {leadTime.p90_days !== null && leadTime.p90_days !== undefined ? `${leadTime.p90_days.toLocaleString('id-ID', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}` : '-'}
              </div>
              <div className="text-[10px] text-slate-400">P90 hari</div>
            </div>

            <div className="p-2.5 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-center">
              <div className="text-[10px] uppercase font-semibold text-slate-500">&le; 30 Hari</div>
              <div className="text-lg font-bold text-emerald-600 dark:text-emerald-400 font-mono mt-0.5">
                {leadTime.within_30_days_pct !== null && leadTime.within_30_days_pct !== undefined ? `${leadTime.within_30_days_pct.toFixed(1)}%` : '-'}
              </div>
              <div className="text-[10px] text-slate-400">Hampir semua sambung</div>
            </div>
          </div>
          <p className="text-[11px] text-slate-500 dark:text-slate-400 italic">
            * Dihitung dari {leadTime.n?.toLocaleString('id-ID') || 0} permohonan PB berbayar.
          </p>
        </div>

        {/* Antrean PB Hari Ini */}
        <div className="p-4 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-xs space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Antrean Permohonan PB Hari Ini
            </h4>
            <span className="text-[11px] text-slate-400">Potret per {queue.as_of}</span>
          </div>

          <div className="space-y-2">
            <div className="flex items-center justify-between p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs">
              <div>
                <span className="font-semibold text-slate-700 dark:text-slate-200">Antrean Berjalan (0&ndash;30 hari)</span>
                <span className="text-slate-400 ml-2">Umur 0-7: {queue.live_0_7 || 0}, 8-30: {queue.live_8_30 || 0}</span>
              </div>
              <div className="font-mono font-bold text-blue-600 dark:text-blue-400">
                {((queue.live_0_7 || 0) + (queue.live_8_30 || 0)).toLocaleString('id-ID')}
              </div>
            </div>

            <div className="flex items-center justify-between p-2 rounded-lg bg-amber-50/60 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs">
              <span className="font-semibold text-amber-800 dark:text-amber-300">Menunggu Usulan Jaringan (BASTP)</span>
              <div className="font-mono font-bold text-amber-700 dark:text-amber-300">
                {queue.in_network_proposal?.toLocaleString('id-ID') || 0}
              </div>
            </div>

            {/* Antrean Stale Kedaluwarsa */}
            <div className="p-2.5 rounded-lg bg-rose-50/70 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs space-y-1">
              <div className="flex items-center justify-between">
                <span className="font-bold text-rose-700 dark:text-rose-300">
                  Kedaluwarsa (&gt; {queue.live_days} hari)
                </span>
                <div className="font-mono font-bold text-rose-700 dark:text-rose-300">
                  {queue.stale?.toLocaleString('id-ID') || 0}
                </div>
              </div>
              <p className="text-[10px] text-rose-600 dark:text-rose-400">
                * Berlabel kedaluwarsa, bukan potensi sambungan (pemohon tidak aktif/batal fisik).
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Tabel Rekonsiliasi Bulanan (reconciliation) */}
      <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
        <div className="p-4 border-b border-slate-200 dark:border-slate-800">
          <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
            Rekonsiliasi Bulanan: Tambahan Permohonan vs Selisih Posisi 309
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Menghubungkan permohonan tersambung (tanggal nyala) dengan angka resmi 309; selisih mencakup pelanggan berhenti, bongkar, atau koreksi.
          </p>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
              <tr>
                <th className="py-2.5 px-3 font-semibold">Bulan</th>
                <th className="py-2.5 px-3 font-semibold text-right">Tersambung (Permohonan)</th>
                <th className="py-2.5 px-3 font-semibold text-right">Tambahan Bersih 309</th>
                <th className="py-2.5 px-3 font-semibold text-right">Selisih (Residual)</th>
                <th className="py-2.5 px-3 font-semibold">Keterangan Selisih</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {reconciliation.map((row) => (
                <tr key={row.month} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                  <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                    {row.month}
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-semibold text-blue-600 dark:text-blue-400">
                    {row.connected?.toLocaleString('id-ID')} {row.official_unit}
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                    {row.official !== null && row.official !== undefined ? `${row.official.toLocaleString('id-ID')} ${row.official_unit}` : '-'}
                  </td>
                  <td className="py-2 px-3 text-right font-mono font-semibold text-slate-800 dark:text-slate-100">
                    {row.residual !== null && row.residual !== undefined ? `${row.residual.toLocaleString('id-ID')} ${row.official_unit}` : '-'}
                  </td>
                  <td className="py-2 px-3 text-slate-500 dark:text-slate-400 text-[11px]">
                    {row.residual_label}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Tabel Kecamatan & Gardu Tumbuh Cepat */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Tabel Kecamatan */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Kecamatan Tumbuh Terbanyak (Tahun Berjalan)
            </h4>
            <span className="text-[11px] text-slate-400">Total: {areas.added_total?.toLocaleString('id-ID') || 0} plg</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2 px-3 font-semibold">Kecamatan</th>
                  <th className="py-2 px-3 font-semibold text-right">Tambahan (Thn Ini)</th>
                  <th className="py-2 px-3 font-semibold text-right">Thn Lalu</th>
                  <th className="py-2 px-3 font-semibold text-right">Porsi (%)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {areaRows.map((a) => (
                  <tr key={a.kecamatan} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                      {a.kecamatan}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-blue-600 dark:text-blue-400">
                      {a.added?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-500">
                      {a.added_prev_year?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {a.share_pct !== null && a.share_pct !== undefined ? `${a.share_pct.toFixed(1)}%` : '-'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* Tabel Gardu Tumbuh Cepat */}
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              Gardu Tumbuh Cepat &amp; Beban
            </h4>
            <span className="text-[11px] text-slate-400">Ambang waspada: &ge; {gardu.high_load_pct || 80}%</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2 px-3 font-semibold">Gardu</th>
                  <th className="py-2 px-3 font-semibold text-right">Tambah (Plg)</th>
                  <th className="py-2 px-3 font-semibold text-right">Kapasitas</th>
                  <th className="py-2 px-3 font-semibold text-right">Beban (%)</th>
                  <th className="py-2 px-3 font-semibold text-center">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {garduRows.map((g) => (
                  <tr key={g.substation_id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3">
                      <div className="font-mono font-medium text-slate-800 dark:text-slate-200">{g.code}</div>
                      <div className="text-[10px] text-slate-500">{g.name} &bull; {g.unit_name}</div>
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-emerald-600 dark:text-emerald-400">
                      +{g.added?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {g.capacity_kva || '-'} kVA
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-semibold text-slate-800 dark:text-slate-100">
                      {g.loading_pct !== null && g.loading_pct !== undefined ? `${g.loading_pct.toFixed(1)}%` : '-'}
                    </td>
                    <td className="py-2 px-3 text-center">
                      {g.capacity_watch ? (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-bold bg-rose-100 text-rose-800 dark:bg-rose-950/70 dark:text-rose-300">
                          Perlu kapasitas
                        </span>
                      ) : (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] text-slate-400 dark:text-slate-500">
                          Aman
                        </span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Tabel Perubahan Daya Menurut Golongan (powerChanges) */}
      {powerGroups.length > 0 && (
        <div className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 overflow-hidden shadow-xs">
          <div className="p-4 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-slate-800 dark:text-slate-100">
                Dinamika Perubahan Daya (PD) Menurut Golongan Tarif
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Total permohonan PD: {powerChanges.total?.toLocaleString('id-ID') || 0} kasus (Netto: +{powerChanges.net_kva?.toLocaleString('id-ID') || 0} kVA)
              </p>
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 border-b border-slate-200 dark:border-slate-700">
                <tr>
                  <th className="py-2.5 px-3 font-semibold">Golongan Tarif</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Kasus PD</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Porsi (%)</th>
                  <th className="py-2.5 px-3 font-semibold text-right text-emerald-600 dark:text-emerald-400">Naik Daya (n)</th>
                  <th className="py-2.5 px-3 font-semibold text-right text-rose-600 dark:text-rose-400">Turun Daya (n)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Daya Tambahan Netto (kVA)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {powerGroups.map((p) => (
                  <tr key={p.group} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                    <td className="py-2 px-3 font-medium text-slate-800 dark:text-slate-200">
                      {p.group_name} ({p.group})
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-700 dark:text-slate-300">
                      {p.count?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-slate-600 dark:text-slate-400">
                      {p.share_pct !== null && p.share_pct !== undefined ? `${p.share_pct.toFixed(1)}%` : '-'}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-emerald-600 dark:text-emerald-400">
                      {p.up?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2 px-3 text-right font-mono text-rose-600 dark:text-rose-400">
                      {p.down?.toLocaleString('id-ID')}
                    </td>
                    <td className="py-2 px-3 text-right font-mono font-bold text-slate-800 dark:text-slate-100">
                      {p.net_kva > 0 ? `+${p.net_kva.toLocaleString('id-ID')}` : p.net_kva.toLocaleString('id-ID')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Catatan Penjelas dari Backend */}
      {notes && notes.length > 0 && (
        <div className="p-4 bg-slate-50 dark:bg-slate-800/50 rounded-xl border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-400 space-y-1.5">
          <div className="font-semibold text-slate-700 dark:text-slate-300">Catatan Wawasan Pertumbuhan:</div>
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
