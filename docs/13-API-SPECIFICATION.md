# 13 — API Specification (Draft)

## 1. Konvensi

- Prefix: `/api/v1`.
- JSON request/response.
- Sanctum authentication.
- UUID pada resource.
- Pagination untuk collection.
- Validasi dan otorisasi dilakukan di Laravel.
- Error response konsisten dengan HTTP status dan error code.
- Endpoint di bawah adalah rancangan awal, bukan kontrak final.

## 2. Endpoint utama

### Auth and profile
- `POST /auth/login`
- `POST /auth/logout`
- `GET /me`
- `GET /me/permissions`

### Organization
- `GET /up3`
- `GET /ulps`
- `GET /users`

### Customers and applications
- `GET /customers`
- `POST /customers`
- `POST /customers/sync`
- `GET /applications`
- `POST /applications`
- `GET /applications/{id}`
- `PATCH /applications/{id}`
- `POST /applications/{id}/submit`
- `POST /applications/{id}/notes`

### Survey and drawing
- `POST /applications/{id}/surveys`
- `POST /applications/{id}/drawings`
- `POST /drawings/{id}/versions`
- `GET /drawings/{id}/versions`
- `POST /drawing-versions/{id}/submit`
- `POST /drawing-versions/{id}/review`

### Calculation
- `POST /applications/{id}/calculations`
- `GET /applications/{id}/calculations`
- `GET /calculations/{id}`
- `POST /calculations/{id}/export`

### Approval and work
- `POST /applications/{id}/approval-requests`
- `POST /approval-requests/{id}/decisions`
- `POST /applications/{id}/vendor-assignments`
- `POST /applications/{id}/work-orders`
- `POST /work-orders/{id}/progress`

### Master data
- `GET /materials`
- `POST /materials`
- `GET /construction-types`
- `GET /bom-versions`
- `POST /imports/tariffs/preview`
- `POST /imports/sales-309/preview`
- `POST /imports/contracts/preview`
- `POST /imports/{id}/commit`

### Inventory
- `GET /warehouses`
- `GET /warehouses/{id}/balances`
- `POST /warehouses/{id}/receipts`
- `POST /warehouses/{id}/issues`
- `POST /material-allocations`
- `POST /material-allocations/{id}/approve`
- `GET /stock-movements`

### Forecast and RKM
- `POST /forecasts`
- `GET /forecasts/{id}`
- `GET /forecasts/{id}/results`
- `POST /forecasts/{id}/evaluate`
- `POST /rkm-plans`
- `POST /rkm-plans/{id}/submit`
- `POST /rkm-plans/{id}/validate`
- `POST /rkm-plans/{id}/approve`
- `GET /rkm-plans/{id}/report`

## 3. Contoh aturan API stok ULP

Sebelum `POST /warehouses/{id}/receipts` atau `/issues`:
1. Pastikan warehouse benar-benar milik ULP pengguna.
2. Pastikan pengguna memiliki permission.
3. Pastikan material memenuhi `ulp_stock_allowed`.
4. Pastikan satuan dan kuantitas valid.
5. Pastikan dokumen sumber tersedia.
6. Cegah saldo negatif sesuai kebijakan.
7. Simpan movement dan update balance dalam satu transaksi.
8. Tulis audit log.

## 4. Response pattern

```json
{
  "data": {},
  "meta": {
    "request_id": "uuid",
    "timestamp": "2026-11-04T00:00:00Z"
  }
}
```

Error:

```json
{
  "error": {
    "code": "MATERIAL_NOT_ALLOWED_IN_ULP_WAREHOUSE",
    "message": "Material ini tidak dapat dikelola sebagai stok gudang ULP.",
    "details": {}
  }
}
```

## 5. API contract lanjutan

Sebelum implementasi, tetapkan:
- field request/response per endpoint;
- status code;
- filter dan sort;
- idempotency;
- file upload limits;
- rate limit;
- error codes;
- API versioning;
- autentikasi service Python dan integrasi eksternal.

## Addendum batas integrasi

Semua integrasi eksternal melalui Laravel Integration Service. Kontrak API Bot Daftung, EIS AP2T, payment, ERP, aplikasi material, email, dan WhatsApp belum tersedia/ditetapkan di pembahasan; endpoint, auth, payload, dan response di dokumen ini hanya contoh konseptual bila belum dinyatakan resmi. Python Auto MTO dan Forecasting berkomunikasi melalui API Laravel dan tidak mengakses PostgreSQL produksi secara langsung. Aplikasi material eksternal adalah source of truth stok; DISTRIVA mengirim kebutuhan WO approved dan menerima snapshot/status read-only.


## API internal Auto MTO — rancangan konseptual v3.2
Laravel menjadi broker akses file bagi Python. API menerbitkan token sementara yang dibatasi pada job, file-version, operasi download, dan waktu kedaluwarsa; yang disimpan di database hanya hash token. Callback hasil harus idempotent dan mengikat attempt yang benar. Endpoint, payload, metode autentikasi service, dan timeout final belum ditetapkan karena kontrak integrasi Python belum dibekukan.
