import { createPortal } from 'react-dom'
import Button from '../../components/Button.jsx'

const qty = (n) => Number(n || 0).toLocaleString('id-ID', { maximumFractionDigits: 3 })
const ROWS_PER_PAGE = 22

/** Bagi baris penyerahan per gudang (satu lembar TUG 7 per gudang asal), dipecah lagi bila melebihi satu halaman. */
export function handoverSheets(shipment) {
  const byWarehouse = new Map()
  for (const l of shipment.lines || []) {
    const key = l.warehouse
    if (!byWarehouse.has(key)) byWarehouse.set(key, { warehouse: l.warehouse, plant: l.plant, stor_loc: l.stor_loc, lines: [] })
    byWarehouse.get(key).lines.push(l)
  }
  const sheets = []
  for (const g of byWarehouse.values()) {
    for (let i = 0; i < g.lines.length; i += ROWS_PER_PAGE) sheets.push({ ...g, lines: g.lines.slice(i, i + ROWS_PER_PAGE), offset: i })
  }
  return sheets
}

const PRINT_CSS = `
#tug7-print { font-family: Calibri, Arial, sans-serif; }
#tug7-print .tug7-sheet { background:#fff; color:#000; width:210mm; min-height:297mm; padding:14mm 14mm 12mm; box-sizing:border-box; margin:0 auto 16px; box-shadow:0 1px 8px rgba(0,0,0,.25); font-size:10.5px; }
#tug7-print table { width:100%; border-collapse:collapse; }
#tug7-print th, #tug7-print td { border:1px solid #000; padding:2px 5px; }
#tug7-print .dots { border-bottom:1px dotted #000; display:inline-block; min-width:60%; }
@media print {
  @page { size: A4 portrait; margin: 0; }
  html, body { background:#fff !important; }
  body > *:not(#tug7-print) { display:none !important; }
  #tug7-print { position:static !important; background:#fff !important; overflow:visible !important; padding:0 !important; }
  #tug7-print .tug7-toolbar { display:none !important; }
  #tug7-print .tug7-sheet { margin:0 !important; box-shadow:none !important; page-break-after:always; break-after:page; }
  #tug7-print .tug7-sheet:last-child { page-break-after:auto; break-after:auto; }
}
`

function Sheet({ form, shipment, sheet, index, total }) {
  const filler = Math.max(0, ROWS_PER_PAGE - sheet.lines.length)
  const place = [sheet.warehouse, [sheet.plant && `Plant ${sheet.plant}`, sheet.stor_loc && `SLoc ${sheet.stor_loc}`].filter(Boolean).join(' · ')].filter(Boolean).join(' — ')
  return (
    <section className="tug7-sheet" aria-label={`Lembar TUG 7 ${index + 1}`}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontWeight: 700 }}>
        <span style={{ fontSize: 13 }}>{(form.company || [])[0] || 'PT PLN (PERSERO)'}</span>
        <span>TUG 7</span>
      </div>
      <div style={{ textAlign: 'right', marginTop: 4 }}>
        {shipment.sent_at ? new Date(shipment.sent_at).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '................, ............ 20....'}
      </div>
      <div style={{ textAlign: 'center', marginTop: 4 }}>
        <div style={{ fontSize: 14, fontWeight: 700, textDecoration: 'underline' }}>PERINTAH PENYERAHAN BARANG</div>
        <div style={{ fontSize: 15 }}>DELIVERY ORDER</div>
        <div style={{ fontWeight: 700 }}>No. {shipment.reference}{total > 1 ? ` (lembar ${index + 1}/${total})` : ''}</div>
      </div>
      <table style={{ border: 'none', margin: '10px 0 6px' }} aria-label="Identitas penyerahan">
        <tbody>
          {[
            ['Kepada', place],
            ['Untuk', [form.vendor_name, form.customer_name].filter(Boolean).join(' / ') || '-'],
            ['Berdasarkan', `WO ${form.wo_number || '-'} · Agenda ${form.agenda_number || '-'} · Permohonan ${form.application_number || '-'}`],
            ['Atas beban rekening', ''],
          ].map(([k, v]) => (
            <tr key={k}>
              <td style={{ border: 'none', width: '22%', padding: '3px 0' }}>{k}</td>
              <td style={{ border: 'none', padding: '3px 0' }}>: <span className="dots" style={{ width: '95%' }}>{v}&nbsp;</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ margin: '4px 0 6px' }}>
        Dengan penyerahan lembar asli dari pada Perintah penyerahan ini harap menyerahkan/mengirimkan dari persediaan gudang kealamat tersebut diatas, barang-barang/Spare parts sbb :
      </p>
      <table aria-label="Daftar barang">
        <thead>
          <tr style={{ textAlign: 'center' }}>
            <th rowSpan={2} style={{ width: '6%' }}>No.<br />Urut</th>
            <th rowSpan={2}>Nama barang/Spare part</th>
            <th rowSpan={2} style={{ width: '17%' }}>Nomor<br />Norm./part</th>
            <th rowSpan={2} style={{ width: '6%' }}>Stn.</th>
            <th rowSpan={2} style={{ width: '9%' }}>Banyaknya</th>
            <th colSpan={2}>Harga</th>
            <th rowSpan={2} style={{ width: '14%' }}>Keterangan</th>
          </tr>
          <tr style={{ textAlign: 'center' }}>
            <th style={{ width: '7%' }}>Stn.</th>
            <th style={{ width: '8%' }}>Jumlah</th>
          </tr>
        </thead>
        <tbody>
          {sheet.lines.map((l, i) => (
            <tr key={i}>
              <td style={{ textAlign: 'center' }}>{sheet.offset + i + 1}</td>
              <td>{l.name || l.khs_code}</td>
              <td style={{ fontFamily: 'monospace' }}>{(l.skus || []).join(', ')}</td>
              <td style={{ textAlign: 'center' }}>{l.unit}</td>
              <td style={{ textAlign: 'right' }}>{qty(l.quantity)}</td>
              <td />
              <td />
              <td>{l.khs_code}</td>
            </tr>
          ))}
          {Array.from({ length: filler }).map((_, i) => (
            <tr key={`f${i}`} aria-hidden="true">{Array.from({ length: 8 }).map((__, j) => <td key={j} style={{ height: 17 }}>&nbsp;</td>)}</tr>
          ))}
        </tbody>
      </table>
      <table style={{ marginTop: -1 }} aria-label="Perintah kerja dan akun">
        <tbody>
          <tr>
            <td style={{ width: '35%' }}>Perintah Kerja :<br />{form.wo_number}</td>
            <td style={{ width: '30%' }}>Kode Akun :<br />&nbsp;</td>
            <td>Fungsi :<br />&nbsp;</td>
          </tr>
        </tbody>
      </table>
      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 18, textAlign: 'center' }}>
        {[['Yang memerintahkan', ''], ['Yang menyerahkan (Gudang)', ''], ['Yang menerima', form.vendor_name || '']].map(([t, n]) => (
          <div key={t} style={{ width: '31%' }}>
            <div>{t}</div>
            <div style={{ height: 52 }} />
            <div style={{ borderTop: '1px solid #000', paddingTop: 2 }}>{n || 'Nama / Tanda tangan'}</div>
          </div>
        ))}
      </div>
      <div style={{ marginTop: 10, fontSize: 9, color: '#444' }}>Penyerahan ke-{shipment.sequence} · dicatat oleh {shipment.sent_by_name} melalui DISTRIVA. DISTRIVA tidak mengubah stok; pengurangan stok dilakukan di aplikasi material (ERP/MIMS).</div>
    </section>
  )
}

/** Form Perintah Penyerahan Barang (TUG 7) untuk satu penyerahan material: pratinjau + cetak / simpan sebagai PDF lewat dialog cetak peramban. */
export default function HandoverForm({ form, shipment, onClose }) {
  const sheets = handoverSheets(shipment)
  return createPortal(
    <div id="tug7-print" role="dialog" aria-modal="true" aria-label="Form Perintah Penyerahan Barang (TUG 7)" style={{ position: 'fixed', inset: 0, zIndex: 80, background: '#2b2b2b', overflow: 'auto', padding: '0 0 24px' }}>
      <style>{PRINT_CSS}</style>
      <div className="tug7-toolbar" style={{ position: 'sticky', top: 0, zIndex: 1, background: '#111', color: '#fff', padding: '8px 16px', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', marginBottom: 16 }}>
        <span style={{ fontWeight: 600, marginRight: 'auto' }}>TUG 7 · Penyerahan ke-{shipment.sequence} · {sheets.length} lembar</span>
        <Button size="sm" onClick={() => window.print()}>Cetak / Simpan PDF</Button>
        <Button size="sm" variant="secondary" onClick={onClose}>Tutup</Button>
      </div>
      {sheets.map((sheet, i) => <Sheet key={i} form={form} shipment={shipment} sheet={sheet} index={i} total={sheets.length} />)}
    </div>,
    document.body,
  )
}
