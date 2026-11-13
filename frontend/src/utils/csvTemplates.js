/**
 * DISTRIVA - Standard CSV Templates for Master Data Imports
 * Contains predefined column headers and realistic PLN distribution sample rows.
 */

export function downloadCsv(filename, content) {
  // UTF-8 BOM (\uFEFF) ensures Microsoft Excel on Windows renders UTF-8 correctly
  const blob = new Blob(['\uFEFF' + content], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.setAttribute('href', url)
  link.setAttribute('download', filename)
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

// 1. Template Material ERP
export const MATERIAL_ERP_TEMPLATE = `code,name,unit,spec,category_code
TRF-50KVA-20KV,"Trafo Distribusi 50 kVA 20kV/400V",Unit,"Dyn5 20kV/400V 50Hz ONAN",TRAFO
TNG-BTN-11M-200DAN,"Tiang Beton 11m 200 daN",Batang,"Spun concrete pole 11 meter 200 daN standar PLN",TIANG
ISL-TR-TUMPU,"Isolator Tumpu TR",Buah,"Porcelain pin insulator low voltage",ISOLATOR
KBL-AAAC-70MM,"Kabel AAAC 70 mm2",Meter,"All Aluminium Alloy Conductor 70 mm2 SPLN 41-8",KABEL
`

// 2. Template Katalog KHS (518 Item)
export const KHS_CATALOG_TEMPLATE = `code,name,unit,description,category
1,"Tiang Beton 11 meter 200 daN",B,"Tiang beton pratekan standar distribusi PLN",MDU
2,"Tiang Beton 12 meter 350 daN",B,"Tiang beton distribusi SUTM sudut / percabangan",MDU
3,"Kabel Twisted Al 3x70 + 1x50 mm2",M,"Kabel pilin saluran udara tegangan rendah (SUTR)",MDU
4,"Trafo Distribusi 100 kVA 20 kV / 400 V",Unit,"Trafo distribusi 3 fasa 50 Hz ONAN Dyn5",MDU
5,"Konduktor AAAC 70 sqmm",M,"Konduktor aluminium paduan saluran udara 20 kV",MDU
`

// 3. Template Standar Tipe Konstruksi
export const CONSTRUCTION_TYPES_TEMPLATE = `group,code,label,description,reference_symbol,source_reference
SUTM,TM-1,"Tiang Tumpu Tunggal SUTM","Konstruksi tiang tumpu garis lurus sudut 0 - 5 derajat",T-1,"Standar Konstruksi Distribusi 2026"
SUTM,TM-2,"Tiang Sudut Tunggal SUTM","Konstruksi tiang sudut ganda 5 - 30 derajat",T-2,"Standar Konstruksi Distribusi 2026"
SUTR,TR-1,"Tiang Tumpu SUTR","Konstruksi tiang tumpu jaringan tegangan rendah",R-1,"Standar Konstruksi Distribusi 2026"
GTT_UMUM,GTT-1,"Gardu Trafo Tiang 1 Tiang Portal","Konstruksi gardu trafo cantol 1 tiang kapasitas s.d. 100 kVA",GT-1,"Buku Standar Gardu Distribusi"
`

// 4. Template Matriks Pemetaan KHS ke Konstruksi (BOM)
export const CONSTRUCTION_BOM_TEMPLATE = `group,code,label,khs_code,relation,note,source_reference
SUTM,TM-1,"Tiang Tumpu Tunggal SUTM",1,MDU,"Tiang beton 11m 200daN","Standar Konstruksi Distribusi 2026"
SUTM,TM-1,"Tiang Tumpu Tunggal SUTM",7,MDU,"Arm Tie Band 10 inch HDG TM","Standar Konstruksi Distribusi 2026"
SUTR,TR-1,"Tiang Tumpu SUTR",1,MDU,"Tiang beton 11m 200daN","Standar Konstruksi Distribusi 2026"
`

// 5. Template Buku Harga Per Kontrak (Tahap 5A)
export const PRICE_BOOK_TEMPLATE = `kode,nama,status_material,harga_material,z1_pasang,z1_bongkar,z2_pasang,z2_bongkar,z3_pasang,z3_bongkar,z5_pasang,z5_bongkar
1,"Tiang Beton 11 meter 200 daN",PLN,,450000,150000,475000,160000,500000,170000,550000,185000
2,"Tiang Beton 12 meter 350 daN",PLN,,550000,180000,580000,190000,610000,200000,670000,220000
3,"Kabel Twisted Al 3x70 + 1x50 mm2",PLN,,12500,4500,13200,4800,14000,5100,15500,5600
7,"Arm Tie Band 10 inch HDG TM",HARGA,125000,35000,12000,37000,13000,39000,14000,43000,15500
8,"Guy Wire TM Lengkap",HARGA,450000,95000,30000,100000,32000,105000,34000,115000,37500
`

// 6. Template Buku Tarif Listrik (Tahap 5C, docs/62 §26)
export const TARIFF_BOOK_TEMPLATE = `tarif,daya_va,harga_rata2,jam_nyala,ujl,ulp
R1,900,1352.00,100,150,
R1,1300,1444.70,120,150,
R1,2200,1444.70,120,150,
R2,3500,1699.53,140,150,
B1,450,1114.74,100,0,
I1,450,1114.74,100,0,
`

// 7. Template Cuplikan Stok Gudang (Tahap 6A, docs/62 §30)
export const STOCK_SNAPSHOT_TEMPLATE = `kode_khs,stok,reservasi,pasokan_masuk,stok_pengaman
1,150,20,50,15
2,75,10,30,10
3,12500,2000,5000,1000
7,450,50,100,50
8,200,30,50,20
`

// 8. Template Pemetaan SKU ERP ke KHS (Tahap 8, docs/79 §3)
export const KHS_MATERIAL_MAP_TEMPLATE = `kode_khs,no_material,catatan
1,0000001001,"Tiang Beton 11m 200 daN ERP"
2,0000001002,"Tiang Beton 12m 350 daN ERP"
3,0000002010,"Kabel Twisted Al 3x70+1x50 mm2"
`

// 10. Template Kategori Material (Master Data Referensi)
export const CATEGORIES_TEMPLATE = `code,name,description
BOX_APP,"Box APP","Kotak Alat Pengukur dan Pembatas pelanggan"
KUBIKEL,"Kubikel","Kubikel 20 kV gardu hubung dan distribusi"
KWH_METER,"KWH Meter","Alat pengukur energi listrik kWh meter 1 fasa dan 3 fasa"
MCB_1_PHASE,"MCB 1 Phase","Miniature Circuit Breaker 1 fasa pembatas arus"
MCB_3_PHASE,"MCB 3 Phase","Miniature Circuit Breaker 3 fasa pembatas arus"
PENGAMAN,"Pengaman","Peralatan proteksi jaringan distribusi (FCO, Arrester, NH Fuse)"
PENGHANTAR,"Penghantar","Kabel dan konduktor saluran udara / bawah tanah (AAAC, TIC, NYFGbY)"
PHBTR,"PHBTR","Perangkat Hubung Bagi Tegangan Rendah (LVC)"
TRAFO,"Trafo","Transformator distribusi 20 kV / 400 V"
`

// 11. Template Satuan Pengukuran / UoM (Master Data Referensi)
export const UNITS_TEMPLATE = `code,name,symbol
B,"Batang","Btg"
BH,"Buah","Bh"
M,"Meter","m"
SET,"Set","Set"
UNIT,"Unit","Unit"
LOT,"Lot","Lot"
KG,"Kilogram","kg"
ROLL,"Roll","Roll"
PLG,"Pelanggan","Plg"
`

// 12. Template Data Induk Master Gardu (docs/80)
export const SUBSTATION_MASTER_TEMPLATE = `KD_GARDU,NO_GADIS,LOKASI,ULP_CODE,KD_PYLG,KAP_TOTAL,JNS_GRD,TRFMILIK,STATUS,LATITUDEY,LONGITUDEX,MRKTRF1,THNTRF1
HD0022,GD514530146,"Jl. Raya Mojokerto No. 45",51181,JBG01,100,PORTAL,PLN,AKTIF,-7.47251,112.43819,TRAFINDO,2021
PL0015,GD514530147,"Ds. Ploso Kulon RT 02",51181,JBG02,50,CANTOL,PLN,AKTIF,-7.48123,112.44102,SINTRA,2019
`

// 13. Template Pengukuran / Beban Gardu (docs/80)
export const SUBSTATION_READING_TEMPLATE = `code,measured_on,loading_pct,load_kva,end_voltage_v,base_voltage_r_v,base_voltage_s_v,base_voltage_t_v,current_r_a,current_s_a,current_t_a,current_n_a
HD0022,2026-11-01,72.5,72.5,215,235,234,233,105,98,102,12
PL0015,2026-11-02,55.0,27.5,220,238,237,236,40,38,39,5
`



