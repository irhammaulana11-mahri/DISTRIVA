/*
 * DISTRIVA — ambil laporan saldo piutang (pivot "mycube" EIS) per ULP per bulan menjadi satu ZIP.
 *
 * Laporan:
 *   GOLONGAN : Saldo Akhir Bulan > Saldo > Saldo Lancar > Saldo Bulan Lalu > per golongan   (jenis impor AKHIRBULAN_EIS)
 *   LEMBAR   : Saldo Akhir Bulan > ... > per lembar                                         (jenis impor UMURPIUTANG)
 *   KOGOL    : Saldo Akhir Periode > Saldo > Saldo Lancar > Saldo PAL tanggal 20 > kogol    (jenis impor AKHIEPERIODE_EIS)
 *   PRABAYAR : Piutang > Saldo > Saldo Prabayar Lancar > Saldo Bulan Lalu > per tarif       (jenis impor PIUTANGLPB_EIS)
 *
 * PAKAI (manual, sebulan sekali)
 *  1. Login ke EIS seperti biasa dan biarkan satu halaman EIS terbuka (alamat eis.ap2t.pln.co.id). Skrip ini TIDAK login dan TIDAK menyentuh password:
 *     ia memakai sesi peramban Anda yang sudah login, ke alamat EIS yang sama (same-origin). Jangan memakai akun yang sama di peramban lain selama berjalan.
 *  2. F12 -> tab Console -> tempel seluruh isi berkas ini -> Enter.
 *  3. Pertama kali berjalan dalam mode UJI (satu ULP, satu bulan, semua laporan aktif). Bila ZIP terunduh dan benar, ubah UJI menjadi false.
 *     Bawaan mode penuh: 12 bulan terakhir (sampai bulan lalu) untuk 10 ULP. Atur "dari"/"sampai" ('YYYY-MM') untuk rentang lain.
 *  4. Unggah ZIP di DISTRIVA (Master Data > Laporan EIS > Unggah). Folder "ULP/BULAN" dibaca otomatis; jenis laporan dikenali dari isi berkas.
 *
 * Hanya tempel skrip ini di konsol halaman EIS milik Anda sendiri. Skrip tidak mengirim apa pun ke luar EIS: hasilnya diunduh ke komputer Anda.
 */
(async () => {
  const CONFIG = {
    UJI: true,                       // true = hanya ULP "uji" pada bulan "sampai"; false = semua ULP pada rentang bulan
    uji: '51453',                    // ULP untuk mode uji
    dari: null,                      // 'YYYY-MM'; null = 11 bulan sebelum "sampai" (12 bulan)
    sampai: null,                    // 'YYYY-MM'; null = bulan lalu
    pakai: ['GOLONGAN', 'LEMBAR', 'KOGOL', 'PRABAYAR'],   // laporan yang diambil
    up3: '51MJK', upi: '51',         // kode AP (UP3) dan UPI pada parameter laporan saldo prabayar
    minByte: 2000,                   // Excel lebih kecil dari ini dianggap kosong (biasanya sesi habis)
    jedaMs: 1000,                    // jeda antar permintaan supaya tidak membebani EIS
    ulp: { '51450': 'MOJOAGUNG', '51452': 'MOJOKERTO', '51453': 'JOMBANG', '51454': 'NGORO', '51455': 'PLOSO', '51456': 'MOJOSARI', '51457': 'PACET', '51458': 'KERTOSONO', '51459': 'WARUJAYENG', '51460': 'NGANJUK' },
  };

  // Tiap laporan: halaman pivot (jenis) dan parameter alamatnya. Parameter ditulis fungsi supaya menu lain boleh berbeda bentuk.
  const LAPORAN = {
    GOLONGAN: { jenis: 'saldo_lalu_eis', parameter: (ulp, ym) => `'${ulp}';'${ym}';'PERGOLONGAN'` },   // terverifikasi dari tangkapan jaringan
    LEMBAR: { jenis: 'saldo_lalu_eis_lbr', parameter: (ulp, ym) => `'${ulp}';'${ym}';'PERLEMBAR'` },    // dari alamat menu per lembar
    PRABAYAR: { jenis: 'saldo_lalu_ap3t_tarif_up', parameter: (ulp, ym) => `'${ulp}';'${CONFIG.up3}';'${CONFIG.upi}';'${ym}'` },   // terverifikasi dari tangkapan jaringan
    // KOGOL: halaman saldo_pal_20.aspx tanpa parameter alamat; unit dan bulan dipilih lewat bilah atas EIS (lihat fetchKogol di bawah)
  };

  const BASE = `${location.origin}/eis/mycube.aspx`;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const pad = (n) => String(n).padStart(2, '0');
  const lastMonth = () => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`; };
  const shiftMonth = (ym, delta) => { let [y, m] = ym.split('-').map(Number); m += delta; while (m < 1) { m += 12; y--; } while (m > 12) { m -= 12; y++; } return `${y}-${pad(m)}`; };
  const monthsBetween = (from, to) => {
    const out = []; let [y, m] = from.split('-').map(Number); const [ty, tm] = to.split('-').map(Number);
    while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${pad(m)}`); if (++m > 12) { m = 1; y++; } }
    return out;
  };

  // ---- ZIP tanpa kompresi (cukup untuk .xls, tanpa pustaka luar) ----
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  const crc32 = (u8) => { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
  const makeZip = (files) => {
    const enc = new TextEncoder(); const parts = []; const central = []; let offset = 0;
    for (const f of files) {
      const name = enc.encode(f.name); const crc = crc32(f.data); const size = f.data.length;
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(12, 0x21, true);
      lh.setUint32(14, crc, true); lh.setUint32(18, size, true); lh.setUint32(22, size, true); lh.setUint16(26, name.length, true);
      parts.push(new Uint8Array(lh.buffer), name, f.data);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(14, 0x21, true);
      ch.setUint32(16, crc, true); ch.setUint32(20, size, true); ch.setUint32(24, size, true); ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
      central.push(new Uint8Array(ch.buffer), name);
      offset += 30 + name.length + size;
    }
    const cdSize = central.reduce((a, p) => a + p.length, 0);
    const end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
  };

  // ---- isian form ASP.NET: kumpulkan semua isian halaman (termasuk __VIEWSTATE dan keadaan pivot) ----
  const formFields = (form) => {
    const body = new URLSearchParams();
    for (const el of form.querySelectorAll('input[name], select[name], textarea[name]')) {
      const tag = el.tagName.toLowerCase(); const type = (el.getAttribute('type') || 'text').toLowerCase();
      if (['submit', 'button', 'image', 'reset', 'file'].includes(type)) continue;
      if ((type === 'checkbox' || type === 'radio') && !el.checked) continue;
      if (tag === 'select') {
        const opt = el.querySelector('option[selected]') || el.querySelector('option');
        body.append(el.name, opt ? (opt.getAttribute('value') ?? opt.textContent) : '');
      } else {
        body.append(el.name, el.value ?? el.getAttribute('value') ?? '');
      }
    }
    return body;
  };

  const fetchOne = async (spec, ulpCode, ym) => {
    const param = spec.parameter(ulpCode, ym.replace('-', ''));
    const url = `${BASE}?jenis=${spec.jenis}&parameter=${encodeURIComponent(param).replace(/'/g, '%27')}`;
    const page = await fetch(url, { credentials: 'same-origin' });
    const html = await page.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = doc.querySelector('form');
    if (!page.ok || !form || !doc.querySelector('[name="__VIEWSTATE"]')) {
      const ada = ['form', '__VIEWSTATE'].map((k) => `${k}=${k === 'form' ? !!form : !!doc.querySelector(`[name="${k}"]`)}`).join(' ');
      throw new Error(`halaman laporan tidak dimuat (HTTP ${page.status}, alamat akhir ${page.url}, ${html.length} karakter, ${ada}); sesi EIS habis atau alamat berubah. Awal jawaban: ${html.replace(/\s+/g, ' ').slice(0, 700)}`);
    }
    const body = formFields(form);
    body.set('__EVENTTARGET', ''); body.set('__EVENTARGUMENT', '');
    body.set('listExportFormatx', 'Excel'); body.set('ASPxPopupControl1$DropDownList2', 'Excel'); body.set('btnSave', 'Save');
    const rep = await fetch(new URL(form.getAttribute('action') || url, url).href, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString(),
    });
    const data = new Uint8Array(await rep.arrayBuffer());
    const xls = data[0] === 0xD0 && data[1] === 0xCF && data[2] === 0x11 && data[3] === 0xE0;   // Excel biner lama
    const xlsx = data[0] === 0x50 && data[1] === 0x4B;                                         // xlsx (zip)
    if (!rep.ok || !(xls || xlsx)) {
      throw new Error(`hasil bukan Excel (HTTP ${rep.status}, ${rep.headers.get('content-type')}): ${new TextDecoder().decode(data.slice(0, 200)).replace(/\s+/g, ' ')}`);
    }
    if (data.length < CONFIG.minByte) throw new Error(`berkas hanya ${data.length} byte (kemungkinan kosong): pastikan sudah login di EIS`);

    return { data, ext: xlsx ? 'xlsx' : 'xls' };
  };


  // ---- KOGOL (saldo_pal_20.aspx): unit dan bulan mengikuti bilah atas EIS, jadi dipilih dulu seperti klik kotak UP dan Blth Mutasi ----
  const NAMA_BLN_EIS = ['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  const EIS = `${location.origin}/eis/`;
  const topbar = { unit: null, ym: null };

  const getForm = async (url) => {
    const res = await fetch(url, { credentials: 'same-origin' });
    const html = await res.text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const form = doc.querySelector('form');
    if (!res.ok || !form || !doc.querySelector('[name="__VIEWSTATE"]')) {
      throw new Error(`halaman ${url.replace(EIS, '')} tidak dimuat (HTTP ${res.status}, ${html.length} karakter); sesi EIS habis atau alamat berubah: ${html.replace(/\s+/g, ' ').slice(0, 300)}`);
    }
    return { doc, form, html };
  };

  // Kejadian AJAX Coolite pada default.aspx (setTahun, setBulan, finalUP) dengan seluruh isian formnya, seperti yang dikirim kotak di bilah atas.
  const ajaxBilahAtas = async (metode, nilai, ganti) => {
    const { form } = await getForm(`${EIS}default.aspx`);
    const body = formFields(form);
    for (const [k, v] of Object.entries(ganti)) body.set(k, v);
    body.set('submitAjaxEventConfig', JSON.stringify({ config: { extraParams: { xxx: nilai } } }));
    body.set('__EVENTTARGET', 'ScriptManager1'); body.set('__EVENTARGUMENT', `-|public|${metode}`);
    const r = await fetch(`${EIS}default.aspx`, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8', 'X-Coolite': 'delta=true', 'X-Requested-With': 'XMLHttpRequest' },
      body: body.toString(),
    });
    await r.text();   // jawabannya JSON galat konversi walau berhasil; keberhasilan dinilai dari judul halaman laporan
    if (!r.ok) throw new Error(`pemilihan ${metode} ditolak EIS (HTTP ${r.status})`);
  };

  const pilihBilahAtas = async (ulpCode, ym) => {
    const [tahun, bulan] = ym.split('-');
    if (topbar.ym !== ym) {
      if (!topbar.ym || topbar.ym.slice(0, 4) !== tahun) {
        await ajaxBilahAtas('setTahun', tahun, { cboTahun_Value: tahun, cboTahun: tahun, cboTahun_SelIndex: '-1' });
      }
      await ajaxBilahAtas('setBulan', bulan, { cboBLN_Value: bulan, cboBLN: NAMA_BLN_EIS[Number(bulan) - 1], cboBLN_SelIndex: String(Number(bulan) - 1), cboTahun_Value: tahun, cboTahun: tahun });
      topbar.ym = ym;
    }
    if (topbar.unit !== ulpCode) {
      const nama = `${ulpCode} - ${CONFIG.ulp[ulpCode] || ulpCode}`;
      await ajaxBilahAtas('finalUP', ulpCode, { cboUP_Value: nama, cboUP: nama, cboUP_SelIndex: '-1' });
      topbar.unit = ulpCode;
    }
  };

  const fetchKogol = async (ulpCode, ym) => {
    try {
      await pilihBilahAtas(ulpCode, ym);
      const url = `${EIS}saldo_pal_20.aspx`;
      const kirim = async (form, sasaran) => {
        const body = formFields(form);
        body.set('__EVENTTARGET', sasaran); body.set('__EVENTARGUMENT', '');
        body.set('cbojenis_Value', 'KOGOL'); body.set('cbojenis', 'KOGOL'); body.set('cbojenis_SelIndex', '0');
        return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() });
      };
      const awal = await getForm(url);
      const load = await kirim(awal.form, 'btnLoad');
      const html = await load.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');
      const kepala = /UP\s*:\s*(\d+)\s*\(\s*MUTASI\s*:\s*(\d{2})\/(\d{4})/i.exec(doc.body ? doc.body.textContent : html);
      if (!load.ok || !doc.querySelector('form')) throw new Error(`Load Data gagal (HTTP ${load.status}): ${html.replace(/\s+/g, ' ').slice(0, 300)}`);
      if (!kepala) throw new Error(`judul laporan tidak ditemukan setelah Load Data (sesi habis?): ${html.replace(/\s+/g, ' ').slice(0, 300)}`);
      const [tahun, bulan] = ym.split('-');
      if (kepala[1] !== ulpCode || kepala[2] !== bulan || kepala[3] !== tahun) {
        throw new Error(`EIS menampilkan unit ${kepala[1]} bulan ${kepala[2]}/${kepala[3]}, bukan ${ulpCode} ${bulan}/${tahun} (akun mungkin tidak boleh berpindah unit atau bulan)`);
      }
      const rep = await kirim(doc.querySelector('form'), 'btnExport');
      const data = new Uint8Array(await rep.arrayBuffer());
      const xls = data[0] === 0xD0 && data[1] === 0xCF && data[2] === 0x11 && data[3] === 0xE0;
      const xlsx = data[0] === 0x50 && data[1] === 0x4B;
      if (!rep.ok || !(xls || xlsx)) {
        throw new Error(`hasil bukan Excel (HTTP ${rep.status}, ${rep.headers.get('content-type')}): ${new TextDecoder().decode(data.slice(0, 200)).replace(/\s+/g, ' ')}`);
      }
      if (data.length < CONFIG.minByte) throw new Error(`berkas hanya ${data.length} byte (kemungkinan kosong): pastikan sudah login di EIS`);

      return { data, ext: xlsx ? 'xlsx' : 'xls' };
    } catch (e) {
      topbar.unit = null; topbar.ym = null;   // keadaan bilah atas tidak pasti; pilih ulang pada percobaan berikutnya
      throw e;
    }
  };
  LAPORAN.KOGOL = { ambil: fetchKogol };

  const specs = CONFIG.pakai.filter((k) => LAPORAN[k]);
  const belum = CONFIG.pakai.filter((k) => !LAPORAN[k]);
  if (belum.length) console.warn(`Dilewati (alamat halaman belum diketahui): ${belum.join(', ')}`);
  if (!specs.length) { console.error('Tidak ada laporan yang bisa diambil.'); return; }

  const to = CONFIG.sampai || lastMonth();
  const from = CONFIG.UJI ? to : (CONFIG.dari || shiftMonth(to, -11));
  const ulps = CONFIG.UJI ? [CONFIG.uji] : Object.keys(CONFIG.ulp);
  const months = monthsBetween(from, to);
  console.log(`Mulai: ${specs.length} laporan x ${ulps.length} ULP x ${months.length} bulan (${from} s.d. ${to})${CONFIG.UJI ? ' [MODE UJI]' : ''}`);

  const files = []; const gagal = [];
  for (const ym of months) {
    for (const code of ulps) {
      for (const key of specs) {
        const label = `${key} ${CONFIG.ulp[code] || code} ${ym}`;
        try {
          const spec = LAPORAN[key];
          const { data, ext } = await (spec.ambil ? spec.ambil(code, ym) : fetchOne(spec, code, ym));
          files.push({ name: `${CONFIG.ulp[code] || code}/${ym}/${key}.${ext}`, data });
          console.log(`OK     ${label} (${data.length} byte)`);
        } catch (e) {
          gagal.push(label);
          console.error(`GAGAL  ${label}: ${e.message}`);
        }
        await sleep(CONFIG.jedaMs);
      }
    }
  }

  if (!files.length) { console.error('Tidak ada berkas yang berhasil; ZIP tidak dibuat.'); return; }
  const nameZip = `eis-piutang-${from}${to !== from ? `_${to}` : ''}${CONFIG.UJI ? '-uji' : ''}.zip`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(makeZip(files)); a.download = nameZip;
  document.body.appendChild(a); a.click(); a.remove();
  console.log(`Selesai: ${files.length} berkas masuk ${nameZip}${gagal.length ? `; GAGAL ${gagal.length}: ${gagal.join(', ')}` : ''}.`);
})();
