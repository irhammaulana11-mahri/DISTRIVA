import React, { useState } from 'react'
import {
  IconAlertCircle,
  IconClock,
  IconChart,
  IconCalendar,
  IconBuilding,
  IconInfo,
  IconCheck,
  IconChevronRight,
  IconUsers,
} from '../../components/icons.jsx'

/**
 * Format helper numbers & rupiah
 */
const fmtFloat = (v, digits = 1) => {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('id-ID', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

const fmtInt = (v) => {
  if (v === null || v === undefined) return '-'
  return Number(v).toLocaleString('id-ID')
}

const fmtRp = (v) => {
  if (v === null || v === undefined) return '-'
  const num = Number(v)
  if (Math.abs(num) >= 1e9) {
    return `Rp ${fmtFloat(num / 1e9, 2)} M`
  }
  if (Math.abs(num) >= 1e6) {
    return `Rp ${fmtFloat(num / 1e6, 2)} jt`
  }
  return `Rp ${fmtInt(num)}`
}

const fmtPct = (v) => {
  if (v === null || v === undefined) return '-'
  const sign = v > 0 ? '+' : ''
  return `${sign}${fmtFloat(v, 1)}%`
}

const fmtMonth = (m) => {
  if (!m) return '-'
  const [y, mon] = m.split('-')
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des']
  const idx = parseInt(mon, 10) - 1
  return `${months[idx] || mon} ${y?.slice(-2) || ''}`
}

/**
 * Komponen Tab "Umur & Calon PRR" (docs/92 §6.4 & §6.5, Butir 39):
 * Menangani:
 * 1. detail.kind === 'receivable_aging' (Umur Piutang & Piutang Pascabayar)
 * 2. detail.kind === 'repayment_age' (Pelunasan PRR & Pelunasan Ex PRR)
 */
export default function ReceivableAgingTab({ detail, metricCode }) {
  if (!detail) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400">
        Data rincian umur piutang belum tersedia untuk periode atau unit yang dipilih.
      </div>
    )
  }

  // Jika detail adalah pelunasan menurut umur BLTH (Pelunasan PRR / Ex PRR)
  if (detail.kind === 'repayment_age') {
    return <RepaymentAgeSection detail={detail} metricCode={metricCode} />
  }

  // Default: receivable_aging
  if (detail.kind !== 'receivable_aging') {
    return null
  }

  if (detail.available === false) {
    return (
      <div className="rounded-xl border border-amber-200 bg-amber-50 dark:bg-amber-950/20 dark:border-amber-900/40 p-6 text-amber-900 dark:text-amber-200">
        <div className="flex items-start gap-3">
          <IconAlertCircle className="w-5 h-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
          <div>
            <h4 className="font-semibold text-sm">Wawasan Umur Piutang Tidak Tersedia</h4>
            <p className="text-xs text-amber-800 dark:text-amber-300/90 mt-1">
              {detail.reason || 'Belum ada laporan umur tunggakan (UMURPIUTANG) pada cakupan ini.'}
            </p>
          </div>
        </div>
      </div>
    )
  }

  const {
    as_of_month,
    target_month,
    buckets = [],
    rp_total = 0,
    plg_total = 0,
    rp_over_3_months = 0,
    over_3_pct = 0,
    snapshot = [],
    history = [],
    rates,
    forecast,
    units = [],
    notes = [],
  } = detail

  // Hitung selisih tahun lalu untuk tunggakan > 3 bulan
  // Kelas > 3 bulan di snapshot: indeks 3 s.d. selesai (4-6 bln, 7-12 bln, >12 bln)
  const over3Buckets = snapshot.slice(3)
  const over3RpLastYear = over3Buckets.reduce((acc, row) => acc + (row.same_month_last_year || 0), 0)
  const hasLastYear = over3Buckets.some((row) => row.same_month_last_year !== null && row.same_month_last_year !== undefined)
  const over3YoyDiff = hasLastYear ? rp_over_3_months - over3RpLastYear : null
  const over3YoyPct = hasLastYear && over3RpLastYear > 0 ? (rp_over_3_months / over3RpLastYear - 1) * 100 : null

  // Warna aksen untuk kelas umur
  const bucketColors = [
    'bg-emerald-500 text-white',
    'bg-teal-500 text-white',
    'bg-amber-500 text-white',
    'bg-orange-500 text-white',
    'bg-rose-500 text-white',
    'bg-red-700 text-white',
  ]
  const bucketBgHex = ['#10b981', '#14b8a6', '#f59e0b', '#f97316', '#f43f5e', '#b91c1c']

  return (
    <div className="space-y-6" data-testid="receivable-aging-tab">
      {/* Header Info As of Month */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/40 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700/60">
        <div className="flex items-center gap-2">
          <IconClock className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <span className="text-xs text-slate-600 dark:text-slate-300">
            Kondisi per: <strong className="text-slate-900 dark:text-white">{fmtMonth(as_of_month)}</strong>
          </span>
          <span className="text-slate-400">•</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Total Tunggakan: <strong className="text-slate-800 dark:text-slate-200">{fmtRp(rp_total)}</strong> ({fmtInt(plg_total)} pelanggan)
          </span>
        </div>
        <div className="text-xs text-slate-500 dark:text-slate-400">
          Target Prakiraan: <span className="font-semibold text-blue-600 dark:text-blue-400">{fmtMonth(target_month)}</span>
        </div>
      </div>

      {/* Grid: (a) Kartu Tunggakan > 3 Bulan & (d) Kartu Prakiraan Bulan Depan (Pelanggan) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* (a) Kartu Tunggakan > 3 Bulan (Calon PRR) */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-rose-600 animate-pulse" />
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Tunggakan Lebih Dari 3 Bulan (Calon PRR)
              </h3>
            </div>
            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800">
              {fmtFloat(over_3_pct, 2)}% dari total
            </span>
          </div>

          <div className="mt-2">
            <div className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
              {fmtRp(rp_over_3_months)}
            </div>
            <div className="flex items-center gap-2 mt-1 text-xs text-slate-500 dark:text-slate-400">
              <span>Lawan bulan yang sama tahun lalu:</span>
              {hasLastYear ? (
                <span className={`font-semibold ${over3YoyDiff > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                  {over3YoyDiff > 0 ? '+' : ''}{fmtRp(over3YoyDiff)} ({fmtPct(over3YoyPct)})
                </span>
              ) : (
                <span className="text-slate-400 font-mono">-</span>
              )}
            </div>
          </div>

          {/* Rincian kelas calon PRR (4-6 bln, 7-12 bln, >12 bln) */}
          <div className="mt-4 pt-4 border-t border-slate-100 dark:border-slate-700/60 grid grid-cols-3 gap-2">
            {over3Buckets.map((b, idx) => (
              <div key={b.key} className="p-2 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/40">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 truncate" title={b.key}>
                  {b.key}
                </div>
                <div className="text-xs font-bold text-slate-900 dark:text-white mt-0.5">
                  {fmtRp(b.rp)}
                </div>
                <div className="text-[10px] text-slate-500 dark:text-slate-400 flex items-center justify-between mt-1">
                  <span>{fmtInt(b.plg)} plg</span>
                  <span className="font-semibold text-rose-600 dark:text-rose-400">{fmtFloat(b.share_pct, 1)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* (d) Kartu Prakiraan Bulan Depan (Pelanggan) */}
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm flex flex-col justify-between">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <IconUsers className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                  Prakiraan Bulan Depan (Pelanggan)
                </h3>
              </div>
              <div className="flex items-center gap-1.5">
                {forecast?.available && !forecast?.reliable && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800" title={forecast?.reliability_note}>
                    Petunjuk
                  </span>
                )}
                {forecast?.available && forecast?.reliable && (
                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800">
                    Model Andal
                  </span>
                )}
                <span className="text-xs font-bold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-950/40 px-2 py-0.5 rounded border border-blue-200 dark:border-blue-900">
                  {fmtMonth(forecast?.month || target_month)}
                </span>
              </div>
            </div>

            {!forecast?.available ? (
              <div className="py-6 text-center text-xs text-slate-400">
                Prakiraan tidak tersedia: {forecast?.reason || 'Riwayat transisi belum cukup.'}
              </div>
            ) : (
              <div>
                <div className="flex items-baseline gap-3">
                  <span className="text-2xl font-extrabold text-slate-900 dark:text-white tracking-tight">
                    {fmtInt(forecast.total)} <span className="text-sm font-normal text-slate-500">pelanggan</span>
                  </span>
                  {forecast.over_3_change_pct !== null && (
                    <span className={`text-xs font-semibold ${forecast.over_3_change_pct > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                      Calon PRR {forecast.over_3_change_pct > 0 ? '+' : ''}{fmtFloat(forecast.over_3_change_pct, 1)}%
                    </span>
                  )}
                </div>
                <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Prakiraan calon PRR (&gt;3 bln): <strong className="text-slate-800 dark:text-slate-200">{fmtInt(forecast.over_3_months)} pelanggan</strong>
                </div>

                {/* Grid per bucket forecast */}
                <div className="mt-3 grid grid-cols-3 sm:grid-cols-6 gap-1.5 text-center">
                  {(forecast.by_bucket || []).map((b) => (
                    <div key={b.key} className="p-1.5 rounded bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/50">
                      <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate" title={b.key}>{b.key}</div>
                      <div className="text-xs font-bold text-slate-900 dark:text-white mt-0.5">{fmtInt(b.value)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Backtest Uji Mundur (Wajib Ditampilkan) */}
          {forecast?.backtest && (
            <div className="mt-4 pt-3 border-t border-slate-100 dark:border-slate-700/60 bg-slate-50/50 dark:bg-slate-850/50 -mx-5 -mb-5 p-4 rounded-b-xl text-xs">
              <div className="flex items-center justify-between text-[11px] font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                <span>Evaluasi Uji Mundur ({forecast.backtest.months} bulan)</span>
                <span className="text-[10px] font-normal text-slate-500">Dasar Pelanggan</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[11px]">
                <div className="p-1.5 rounded bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60">
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">Total Pelanggan MAPE:</div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="font-bold text-slate-900 dark:text-white">Model: {fmtFloat(forecast.backtest.total_mape_pct, 1)}%</span>
                    <span className="text-slate-500">Naif: {fmtFloat(forecast.backtest.total_naive_mape_pct, 1)}%</span>
                  </div>
                </div>
                <div className="p-1.5 rounded bg-white dark:bg-slate-800 border border-slate-200/60 dark:border-slate-700/60">
                  <div className="text-[10px] text-slate-500 dark:text-slate-400">Calon PRR (&gt;3 bln) MAPE:</div>
                  <div className="flex items-center justify-between mt-0.5">
                    <span className="font-bold text-slate-900 dark:text-white">Model: {fmtFloat(forecast.backtest.over_3_mape_pct, 1)}%</span>
                    <span className="text-slate-500">Naif: {fmtFloat(forecast.backtest.over_3_naive_mape_pct, 1)}%</span>
                  </div>
                </div>
              </div>
              <div className="text-[10px] text-slate-500 dark:text-slate-400 mt-2 leading-tight">
                * {forecast.reliability_note || 'Hanya jumlah pelanggan yang diprakirakan; prakiraan rupiah tidak ditampilkan karena bias pelanggan besar.'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* (b) Batang Bertumpuk Umur Tunggakan & Tren Riwayat 12 Bulan */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-5">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-white text-sm mb-1">
            Komposisi Umur Tunggakan (Potret {fmtMonth(as_of_month)})
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Proporsi nominal rupiah dan jumlah pelanggan menurut kelas umur tunggakan.
          </p>
        </div>

        {/* Stacked Bar Visual */}
        <div className="space-y-2">
          <div className="h-7 w-full flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shadow-inner">
            {snapshot.map((row, idx) => {
              const widthPct = row.share_pct || 0
              if (widthPct <= 0) return null
              return (
                <div
                  key={row.key}
                  style={{ width: `${widthPct}%`, backgroundColor: bucketBgHex[idx % bucketBgHex.length] }}
                  className="h-full relative group transition-all cursor-pointer flex items-center justify-center text-[10px] font-bold text-white overflow-hidden px-1"
                  title={`${row.key}: ${fmtRp(row.rp)} (${fmtFloat(row.share_pct, 1)}%) - ${fmtInt(row.plg)} plg`}
                >
                  {widthPct > 7 && `${fmtFloat(widthPct, 1)}%`}
                </div>
              )
            })}
          </div>

          {/* Legenda Stacked Bar */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 pt-1 text-xs text-slate-600 dark:text-slate-300">
            {snapshot.map((row, idx) => (
              <div key={row.key} className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-sm" style={{ backgroundColor: bucketBgHex[idx % bucketBgHex.length] }} />
                <span className="text-[11px]">
                  {row.key}: <strong className="text-slate-900 dark:text-white">{fmtRp(row.rp)}</strong> ({fmtFloat(row.share_pct, 1)}%)
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Riwayat 12 Bulan: Total Rp vs Porsi > 3 Bulan (over_3_pct) */}
        {history.length > 0 && (
          <div className="pt-4 border-t border-slate-100 dark:border-slate-700/60">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 mb-3">
              Riwayat 12 Bulan: Pergerakan Porsi Tunggakan &gt; 3 Bulan
            </h4>
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                    <th className="py-2 pr-3 font-semibold">Bulan</th>
                    <th className="py-2 px-3 font-semibold text-right">Total Piutang</th>
                    <th className="py-2 px-3 font-semibold text-right">&gt; 3 Bulan (Rp)</th>
                    <th className="py-2 px-3 font-semibold text-right">Porsi &gt; 3 Bulan</th>
                    <th className="py-2 pl-3 font-semibold">Grafik Tren Porsi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                  {history.map((h) => (
                    <tr key={h.month} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-1.5 pr-3 font-medium whitespace-nowrap text-slate-900 dark:text-white">
                        {fmtMonth(h.month)}
                      </td>
                      <td className="py-1.5 px-3 text-right font-mono whitespace-nowrap">{fmtRp(h.rp_total)}</td>
                      <td className="py-1.5 px-3 text-right font-mono whitespace-nowrap text-rose-600 dark:text-rose-400">
                        {fmtRp(h.rp_over_3_months)}
                      </td>
                      <td className="py-1.5 px-3 text-right font-semibold whitespace-nowrap">
                        {fmtFloat(h.over_3_pct, 2)}%
                      </td>
                      <td className="py-1.5 pl-3 w-40">
                        <div className="h-2 w-full bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-rose-500 rounded-full"
                            style={{ width: `${Math.min(100, (h.over_3_pct || 0) * 1.5)}%` }}
                          />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* (c) Tabel Roll-Rate Pelanggan */}
      {rates?.rows && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                Laju Perpindahan Umur Tunggakan (Roll-Rate Pelanggan)
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Rata-rata {rates.transitions_averaged || 6} transisi bulanan terakhir. Kelas pertama memakai tingkat pelanggan, kelas selanjutnya adalah laju naik kelas umur.
              </p>
            </div>
            <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300">
              Basis: Pelanggan Menunggak
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-4 font-semibold">Kelas Umur</th>
                  <th className="py-2.5 px-4 font-semibold">Jenis Laju</th>
                  <th className="py-2.5 px-4 font-semibold">Asal Perpindahan</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Laju Rata-rata</th>
                  <th className="py-2.5 px-4 font-semibold text-right">Bulan Terakhir</th>
                  <th className="py-2.5 pl-4 font-semibold">Keterangan / Dinamika</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                {rates.rows.map((row, idx) => {
                  const isLevel = row.kind === 'level'
                  const isOld = idx >= 3
                  return (
                    <tr key={row.key} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 pr-4 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {row.key}
                      </td>
                      <td className="py-2 px-4 whitespace-nowrap">
                        <span className={`px-2 py-0.5 rounded text-[10px] font-semibold ${
                          isLevel
                            ? 'bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/40 dark:text-blue-300 dark:border-blue-800'
                            : isOld
                            ? 'bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800'
                            : 'bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800'
                        }`}>
                          {isLevel ? 'Tingkat' : isOld ? 'Persistensi / Laju Tua' : 'Laju Naik Kelas'}
                        </span>
                      </td>
                      <td className="py-2 px-4 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {row.from ? `${row.from} + ${row.key}` : 'Baru menunggak'}
                      </td>
                      <td className="py-2 px-4 text-right font-mono font-bold whitespace-nowrap">
                        {isLevel ? fmtInt(row.rate) : `${fmtFloat(row.rate * 100, 2)}%`}
                      </td>
                      <td className="py-2 px-4 text-right font-mono whitespace-nowrap text-slate-500 dark:text-slate-400">
                        {row.rate_last !== null && row.rate_last !== undefined
                          ? isLevel
                            ? fmtInt(row.rate_last)
                            : `${fmtFloat(row.rate_last * 100, 2)}%`
                          : '-'}
                      </td>
                      <td className="py-2 pl-4 text-slate-500 dark:text-slate-400 text-[11px]">
                        {isLevel
                          ? 'Jumlah rata-rata pelanggan baru menunggak 1 bulan'
                          : isOld
                          ? 'Tunggakan lama cenderung sudah diputus; persistensi tidak bayar'
                          : 'Porsi pelanggan menunggak yang bergeser ke kelas ini'}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* (e) Peringkat ULP Menurut Porsi Lebih Dari 3 Bulan (Khusus UP3) */}
      {units.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-3">
          <div>
            <h3 className="font-bold text-slate-900 dark:text-white text-sm">
              Peringkat ULP Berdasarkan Porsi Tunggakan &gt; 3 Bulan
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
              Diurutkan dari ULP dengan porsi calon piutang ragu-ragu tertinggi.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                  <th className="py-2.5 pr-3 font-semibold">Peringkat</th>
                  <th className="py-2.5 px-3 font-semibold">Unit Pelaksana (ULP)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Total Piutang</th>
                  <th className="py-2.5 px-3 font-semibold text-right">&gt; 3 Bulan (Rp)</th>
                  <th className="py-2.5 px-3 font-semibold text-right">Porsi &gt; 3 Bulan</th>
                  <th className="py-2.5 pl-3 font-semibold text-right">Perubahan YoY</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                {units.map((u, idx) => (
                  <tr key={u.unit_id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="py-2 pr-3 font-mono text-slate-500">{idx + 1}</td>
                    <td className="py-2 px-3 font-bold text-slate-900 dark:text-white whitespace-nowrap">
                      {u.unit_name || u.unit_id}
                    </td>
                    <td className="py-2 px-3 text-right font-mono whitespace-nowrap">{fmtRp(u.rp_total)}</td>
                    <td className="py-2 px-3 text-right font-mono font-semibold whitespace-nowrap text-rose-600 dark:text-rose-400">
                      {fmtRp(u.rp_over_3_months)}
                    </td>
                    <td className="py-2 px-3 text-right font-bold whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded bg-rose-50 dark:bg-rose-950/40 text-rose-700 dark:text-rose-300">
                        {fmtFloat(u.over_3_pct, 2)}%
                      </span>
                    </td>
                    <td className="py-2 pl-3 text-right font-mono whitespace-nowrap">
                      {u.over_3_yoy_pct !== null && u.over_3_yoy_pct !== undefined ? (
                        <span className={u.over_3_yoy_pct > 0 ? 'text-rose-600 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}>
                          {fmtPct(u.over_3_yoy_pct)}
                        </span>
                      ) : (
                        <span className="text-slate-400">-</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Catatan Teknis (notes[]) */}
      {notes.length > 0 && (
        <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700 p-4 text-xs space-y-1.5">
          <div className="flex items-center gap-2 font-semibold text-slate-800 dark:text-slate-200">
            <IconInfo className="w-4 h-4 text-blue-600 dark:text-blue-400" />
            <span>Catatan Penjelasan Teknis Model:</span>
          </div>
          <ul className="list-disc list-inside space-y-1 text-slate-600 dark:text-slate-400 leading-relaxed pl-1">
            {notes.map((note, idx) => (
              <li key={idx}>{note}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/**
 * Komponen Rincian Pelunasan menurut Umur BLTH (Pelunasan PRR & Ex PRR)
 */
function RepaymentAgeSection({ detail, metricCode }) {
  const {
    available,
    period,
    files = 0,
    rp_total = 0,
    rows = [],
    monthly = [],
    recovery = null,
    notes = [],
  } = detail

  if (!available) {
    return (
      <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-8 text-center text-slate-500 dark:text-slate-400">
        Belum ada berkas pelunasan AP2T untuk periode ini.
      </div>
    )
  }

  const ageColors = ['#10b981', '#06b6d4', '#3b82f6', '#f59e0b', '#f43f5e']
  const isPrr = metricCode === 'pelunasan-prr'
  const isExPrr = metricCode === 'pelunasan-ex-prr'

  return (
    <div className="space-y-6" data-testid="repayment-age-section">
      {/* Header Info */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 bg-slate-50 dark:bg-slate-800/40 px-4 py-3 rounded-lg border border-slate-200 dark:border-slate-700/60">
        <div className="flex items-center gap-2">
          <IconCalendar className="w-4 h-4 text-slate-500 dark:text-slate-400" />
          <span className="text-xs text-slate-600 dark:text-slate-300">
            Periode: <strong className="text-slate-900 dark:text-white">{period?.from} s.d. {period?.to}</strong>
          </span>
          <span className="text-slate-400">•</span>
          <span className="text-xs text-slate-500 dark:text-slate-400">
            Total Pelunasan: <strong className="text-slate-800 dark:text-slate-200">{fmtRp(rp_total)}</strong> ({files} berkas laporan)
          </span>
        </div>
      </div>

      {/* Bagian Tingkat Pemulihan PRR (Butir 55: docs/91 recovery, docs/92 §6.5) - khusus pelunasan-prr */}
      {isPrr && (
        <div className="space-y-4" data-testid="prr-recovery-section">
          {recovery && !recovery.available ? (
            <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900/40 p-4 text-xs space-y-1 text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-2 font-semibold">
                <IconInfo className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>Tingkat Pemulihan PRR Belum Tersedia:</span>
              </div>
              <p className="text-amber-800 dark:text-amber-300">
                {recovery.reason || 'Laporan Daftar PRR (saldo) belum ditarik untuk cakupan ini. Tarik lewat tombol Tarik AP2T, opsi "Saldo PRR (Daftar PRR)".'}
              </p>
            </div>
          ) : recovery?.available ? (
            <div className="space-y-4">
              {/* Kartu Ringkasan Saldo & Pemulihan */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-4 shadow-sm">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                    <span>Saldo PRR Terakhir</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {fmtMonth(recovery.latest_month)}
                    </span>
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 dark:text-white">
                    {fmtRp(recovery.saldo_rp)}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    {fmtInt(recovery.customers)} pelanggan tercatat di Daftar PRR
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-4 shadow-sm">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                    <span>Pemulihan Bulan Terakhir</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {fmtMonth(recovery.latest_month)}
                    </span>
                  </div>
                  {(() => {
                    const latestRow = recovery.monthly?.find((m) => m.month === recovery.latest_month) || null
                    const pct = latestRow?.recovery_pct
                    return (
                      <div>
                        <div className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
                          {pct !== null && pct !== undefined ? `${fmtFloat(pct, 2)}%` : '-'}
                        </div>
                        <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                          {latestRow?.repaid_rp !== null ? fmtRp(latestRow?.repaid_rp) : '-'} dari saldo bulan lalu ({latestRow?.opening_rp !== null ? fmtRp(latestRow?.opening_rp) : '-'})
                        </div>
                      </div>
                    )
                  })()}
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-4 shadow-sm">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                    <span>Pemulihan Kumulatif YTD</span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">Tahun {recovery.latest_month?.slice(0, 4)}</span>
                  </div>
                  {recovery.ytd ? (
                    <div>
                      <div className="text-xl font-extrabold text-indigo-600 dark:text-indigo-400">
                        {fmtFloat(recovery.ytd.recovery_pct, 2)}%
                      </div>
                      <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                        Pelunasan YTD: {fmtRp(recovery.ytd.repaid_rp)} (basis saldo Des: {fmtRp(recovery.ytd.opening_rp)})
                      </div>
                    </div>
                  ) : (
                    <div className="text-xs text-slate-400 pt-1">
                      Saldo Desember tahun lalu belum ditarik untuk evaluasi YTD.
                    </div>
                  )}
                </div>
              </div>

              {/* Tabel Riwayat Saldo per Bulan & Tingkat Pemulihan (monthly[]) */}
              {recovery.monthly && recovery.monthly.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                        Saldo PRR dan Tingkat Pemulihan Bulanan
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Pemulihan bulanan = Pelunasan bulan berjalan ÷ Saldo akhir bulan sebelumnya.
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                          <th className="py-2 pr-3 font-semibold">Bulan</th>
                          <th className="py-2 px-3 font-semibold text-right">Saldo PRR</th>
                          <th className="py-2 px-3 font-semibold text-right">Pelanggan</th>
                          <th className="py-2 px-3 font-semibold text-right">Saldo Bulan Lalu</th>
                          <th className="py-2 px-3 font-semibold text-right">Pelunasan Bulan Ini</th>
                          <th className="py-2 pl-3 font-semibold text-right">Tingkat Pemulihan (%)</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                        {recovery.monthly.map((m) => (
                          <tr key={m.month} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-2.5 pr-3 font-sans font-bold text-slate-900 dark:text-white whitespace-nowrap">
                              {fmtMonth(m.month)}
                              {m.partial && (
                                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 font-medium">
                                  Bulan berjalan
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-slate-900 dark:text-white">
                              {fmtRp(m.saldo_rp)}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {fmtInt(m.customers)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-500">
                              {m.opening_rp !== null ? fmtRp(m.opening_rp) : '-'}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-800 dark:text-slate-200">
                              {m.repaid_rp !== null ? fmtRp(m.repaid_rp) : '-'}
                            </td>
                            <td className="py-2.5 pl-3 text-right font-bold">
                              {m.recovery_pct !== null && m.recovery_pct !== undefined ? (
                                <span className="text-emerald-600 dark:text-emerald-400">
                                  {fmtFloat(m.recovery_pct, 2)}%
                                </span>
                              ) : (
                                <span className="text-slate-400 font-normal">-</span>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tabel Saldo menurut Tahun Tagihan (by_billing_year[]) */}
              {recovery.by_billing_year && recovery.by_billing_year.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                        Distribusi Saldo PRR Menurut Tahun Tagihan (BLTH)
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Potret saldo pada bulan {fmtMonth(recovery.latest_month)} berdasarkan tahun rekening listrik.
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                          <th className="py-2 pr-3 font-semibold">Tahun Tagihan</th>
                          <th className="py-2 px-3 font-semibold text-right">Saldo PRR</th>
                          <th className="py-2 px-3 font-semibold text-right">Jumlah Rekening (Baris)</th>
                          <th className="py-2 px-3 font-semibold text-right">Porsi Saldo (%)</th>
                          <th className="py-2 pl-3 font-semibold text-right">Pelunasan YTD</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                        {recovery.by_billing_year.map((row) => (
                          <tr key={row.year} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-2.5 pr-3 font-sans font-bold text-slate-900 dark:text-white whitespace-nowrap">
                              {row.year}
                            </td>
                            <td className="py-2.5 px-3 text-right font-bold text-slate-900 dark:text-white">
                              {fmtRp(row.saldo_rp)}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {fmtInt(row.rows)}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {row.share_pct !== null && row.share_pct !== undefined ? `${fmtFloat(row.share_pct, 2)}%` : '-'}
                            </td>
                            <td className="py-2.5 pl-3 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                              {fmtRp(row.repaid_ytd_rp)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Catatan Teknis Recovery */}
              {recovery.notes && recovery.notes.length > 0 && (
                <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60 p-4 text-xs space-y-1 text-slate-600 dark:text-slate-400">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                    <IconInfo className="w-4 h-4 text-slate-500" />
                    <span>Catatan Perhitungan Tingkat Pemulihan:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 pt-1 text-[11px] leading-relaxed">
                    {recovery.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Bagian Perkiraan Saldo & Pemulihan Ex PRR (Butir 57: docs/91, docs/92 §6.5) - khusus pelunasan-ex-prr */}
      {isExPrr && (
        <div className="space-y-4" data-testid="exprr-recovery-section">
          {recovery && !recovery.available ? (
            <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900/40 p-4 text-xs space-y-1 text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-2 font-semibold">
                <IconInfo className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
                <span>Perkiraan Saldo & Pemulihan Ex PRR Belum Tersedia:</span>
              </div>
              <p className="text-amber-800 dark:text-amber-300">
                {recovery.reason || 'Laporan Penghapusan PRR belum ditarik untuk cakupan ini. Tarik lewat tombol Tarik AP2T, opsi "Penghapusan PRR".'}
              </p>
            </div>
          ) : recovery?.available ? (
            <div className="space-y-4">
              {/* Kartu Ringkasan Perkiraan Saldo & Pemulihan Ex PRR */}
              <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-4 shadow-sm">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                    <span className="flex items-center gap-1">
                      <span>Saldo Ex PRR</span>
                      <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 font-semibold">Perkiraan</span>
                    </span>
                    <span className="font-semibold text-slate-700 dark:text-slate-300">
                      {fmtMonth(recovery.latest_month)}
                    </span>
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 dark:text-white">
                    {fmtRp(recovery.estimated_balance_rp)}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Penghapusan - Pelunasan kumulatif
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-4 shadow-sm">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                    <span>Penghapusan Kumulatif</span>
                    <span className="text-[11px] text-slate-400">Sejak {fmtMonth(recovery.since_month)}</span>
                  </div>
                  <div className="text-xl font-extrabold text-slate-900 dark:text-white">
                    {fmtRp(recovery.cumulative_written_off_rp)}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Total piutang dihapus (masuk Ex PRR)
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-4 shadow-sm">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                    <span>Pelunasan Kumulatif</span>
                    <span className="text-[11px] text-slate-400">Sejak {fmtMonth(recovery.since_month)}</span>
                  </div>
                  <div className="text-xl font-extrabold text-emerald-600 dark:text-emerald-400">
                    {fmtRp(recovery.cumulative_repaid_rp)}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Total pembayaran Ex PRR diterima
                  </div>
                </div>

                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-4 shadow-sm">
                  <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400 mb-1">
                    <span>Tingkat Pemulihan</span>
                    <span className="text-[11px] text-slate-400">Kumulatif</span>
                  </div>
                  <div className="text-xl font-extrabold text-indigo-600 dark:text-indigo-400">
                    {recovery.recovery_pct !== null && recovery.recovery_pct !== undefined ? `${fmtFloat(recovery.recovery_pct, 2)}%` : '-'}
                  </div>
                  <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
                    Pelunasan ÷ Penghapusan kumulatif
                  </div>
                </div>
              </div>

              {/* Tabel Riwayat Bulanan Penghapusan, Pelunasan, dan Perkiraan Saldo */}
              {recovery.monthly && recovery.monthly.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white text-sm flex items-center gap-2">
                        <span>Riwayat Bulanan Penghapusan & Perkiraan Saldo Ex PRR</span>
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 font-semibold">Perkiraan</span>
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Aliran masuk (penghapusan) lawan aliran keluar (pelunasan) sejak bulan {fmtMonth(recovery.since_month)}.
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                          <th className="py-2 pr-3 font-semibold">Bulan</th>
                          <th className="py-2 px-3 font-semibold text-right">Penghapusan (Bulan Ini)</th>
                          <th className="py-2 px-3 font-semibold text-right">Pelanggan Dihapus</th>
                          <th className="py-2 px-3 font-semibold text-right">Pelunasan (Bulan Ini)</th>
                          <th className="py-2 px-3 font-semibold text-right">Penghapusan Kumulatif</th>
                          <th className="py-2 px-3 font-semibold text-right">Pelunasan Kumulatif</th>
                          <th className="py-2 pl-3 font-semibold text-right">Perkiraan Saldo</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                        {recovery.monthly.map((m) => (
                          <tr key={m.month} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-2.5 pr-3 font-sans font-bold text-slate-900 dark:text-white whitespace-nowrap">
                              {fmtMonth(m.month)}
                              {m.partial && (
                                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-amber-50 text-amber-700 border border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800 font-medium">
                                  Bulan berjalan
                                </span>
                              )}
                            </td>
                            <td className="py-2.5 px-3 text-right text-rose-600 dark:text-rose-400 font-semibold">
                              {fmtRp(m.written_off_rp)}
                            </td>
                            <td className="py-2.5 px-3 text-right">
                              {fmtInt(m.written_off_customers)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-emerald-600 dark:text-emerald-400 font-semibold">
                              {fmtRp(m.repaid_rp)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-400">
                              {fmtRp(m.cumulative_written_off_rp)}
                            </td>
                            <td className="py-2.5 px-3 text-right text-slate-600 dark:text-slate-400">
                              {fmtRp(m.cumulative_repaid_rp)}
                            </td>
                            <td className="py-2.5 pl-3 text-right font-bold text-slate-900 dark:text-white">
                              {fmtRp(m.estimated_balance_rp)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Tabel Distribusi Penghapusan Menurut Tahun Tagihan */}
              {recovery.by_billing_year && recovery.by_billing_year.length > 0 && (
                <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-3">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-bold text-slate-900 dark:text-white text-sm">
                        Distribusi Penghapusan PRR Menurut Tahun Tagihan (BLTH)
                      </h3>
                      <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                        Rekapitulasi nilai piutang yang dihapus berdasarkan tahun rekening listrik.
                      </p>
                    </div>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs text-left">
                      <thead>
                        <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                          <th className="py-2 pr-3 font-semibold">Tahun Tagihan</th>
                          <th className="py-2 pl-3 font-semibold text-right">Penghapusan PRR</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                        {recovery.by_billing_year.map((row) => (
                          <tr key={row.year} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                            <td className="py-2.5 pr-3 font-sans font-bold text-slate-900 dark:text-white whitespace-nowrap">
                              {row.year}
                            </td>
                            <td className="py-2.5 pl-3 text-right font-bold text-slate-900 dark:text-white">
                              {fmtRp(row.written_off_rp)}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* Catatan Teknis Recovery Ex PRR */}
              {recovery.notes && recovery.notes.length > 0 && (
                <div className="bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200 dark:border-slate-700/60 p-4 text-xs space-y-1 text-slate-600 dark:text-slate-400">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-800 dark:text-slate-200">
                    <IconInfo className="w-4 h-4 text-slate-500" />
                    <span>Catatan Perhitungan Perkiraan Saldo & Pemulihan:</span>
                  </div>
                  <ul className="list-disc list-inside space-y-0.5 pt-1 text-[11px] leading-relaxed">
                    {recovery.notes.map((n, i) => (
                      <li key={i}>{n}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          ) : null}
        </div>
      )}

      {/* Porsi Pelunasan Menurut Umur BLTH */}
      <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-4">
        <div>
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">
            Porsi Pelunasan Menurut Umur Bulan Tagihan (BLTH)
          </h3>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Selisih bulan pembayaran dengan bulan tagihan yang dilunasi.
          </p>
        </div>

        {/* Stacked bar */}
        <div className="h-7 w-full flex rounded-lg overflow-hidden border border-slate-200 dark:border-slate-700 shadow-inner">
          {rows.map((row, idx) => {
            const widthPct = row.share_pct || 0
            if (widthPct <= 0) return null
            return (
              <div
                key={row.key}
                style={{ width: `${widthPct}%`, backgroundColor: ageColors[idx % ageColors.length] }}
                className="h-full relative group transition-all cursor-pointer flex items-center justify-center text-[10px] font-bold text-white overflow-hidden px-1"
                title={`${row.key}: ${fmtRp(row.rp)} (${fmtFloat(row.share_pct, 1)}%)`}
              >
                {widthPct > 8 && `${fmtFloat(widthPct, 1)}%`}
              </div>
            )
          })}
        </div>

        {/* Grid Kartu Umur Pelunasan */}
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 pt-2">
          {rows.map((row, idx) => (
            <div key={row.key} className="p-3 rounded-lg bg-slate-50 dark:bg-slate-800/60 border border-slate-200/60 dark:border-slate-700/60">
              <div className="flex items-center gap-1.5 mb-1">
                <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: ageColors[idx % ageColors.length] }} />
                <span className="text-xs font-semibold text-slate-700 dark:text-slate-300 truncate" title={row.key}>
                  {row.key}
                </span>
              </div>
              <div className="text-sm font-bold text-slate-900 dark:text-white">
                {fmtRp(row.rp)}
              </div>
              <div className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                {fmtFloat(row.share_pct, 1)}% dari total
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Rincian Bulanan (monthly[]) */}
      {monthly.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700/80 p-5 shadow-sm space-y-3">
          <h3 className="font-bold text-slate-900 dark:text-white text-sm">
            Tren Pelunasan Menurut Umur BLTH per Bulan
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Bulan Bayar</th>
                  <th className="py-2 px-2 font-semibold text-right">0-3 Bln</th>
                  <th className="py-2 px-2 font-semibold text-right">4-6 Bln</th>
                  <th className="py-2 px-2 font-semibold text-right">7-12 Bln</th>
                  <th className="py-2 px-2 font-semibold text-right">13-24 Bln</th>
                  <th className="py-2 px-2 font-semibold text-right">&gt;24 Bln</th>
                  <th className="py-2 pl-3 font-semibold text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300 font-mono">
                {monthly.map((m) => {
                  const totalMonth =
                    (m['0 sampai 3 bulan'] || 0) +
                    (m['4 sampai 6 bulan'] || 0) +
                    (m['7 sampai 12 bulan'] || 0) +
                    (m['13 sampai 24 bulan'] || 0) +
                    (m['lebih dari 24 bulan'] || 0)
                  return (
                    <tr key={m.month} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                      <td className="py-2 pr-3 font-sans font-bold text-slate-900 dark:text-white whitespace-nowrap">
                        {fmtMonth(m.month)}
                      </td>
                      <td className="py-2 px-2 text-right">{fmtRp(m['0 sampai 3 bulan'])}</td>
                      <td className="py-2 px-2 text-right">{fmtRp(m['4 sampai 6 bulan'])}</td>
                      <td className="py-2 px-2 text-right">{fmtRp(m['7 sampai 12 bulan'])}</td>
                      <td className="py-2 px-2 text-right">{fmtRp(m['13 sampai 24 bulan'])}</td>
                      <td className="py-2 px-2 text-right text-rose-600 dark:text-rose-400">{fmtRp(m['lebih dari 24 bulan'])}</td>
                      <td className="py-2 pl-3 text-right font-bold text-slate-900 dark:text-white">{fmtRp(totalMonth)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Catatan Peluang Pelunasan Menunggu Saldo PRR */}
      <div className="bg-amber-50 dark:bg-amber-950/20 rounded-xl border border-amber-200 dark:border-amber-900/40 p-4 text-xs space-y-1.5 text-amber-900 dark:text-amber-200">
        <div className="flex items-center gap-2 font-semibold">
          <IconInfo className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0" />
          <span>Catatan Peluang Pelunasan Menurut Umur:</span>
        </div>
        <p className="text-amber-800 dark:text-amber-300 leading-relaxed">
          Peluang pelunasan menurut umur (vintage) dan tingkat pemulihan saat ini menunggu data saldo PRR per umur, yang belum tersedia di DISTRIVA (keputusan terbuka docs/92 §10).
        </p>
        {notes.length > 0 && (
          <ul className="list-disc list-inside space-y-0.5 text-amber-800/90 dark:text-amber-300/80 pt-1">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
