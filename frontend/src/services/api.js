// Thin API client. The backend remains the only authority for authentication
// and authorization; the UI only reflects what the server returns.
const BASE = '/api'
const TOKEN_KEY = 'distriva.token'

export class ApiError extends Error {
  constructor(status, message, errors = null, data = null) {
    super(message)
    this.status = status
    this.errors = errors
    this.data = data
  }
}

// sessionStorage (cleared when the tab closes). May be unavailable: never assume.
export const tokenStore = {
  get() {
    try { return sessionStorage.getItem(TOKEN_KEY) } catch { return null }
  },
  set(token) {
    try { sessionStorage.setItem(TOKEN_KEY, token) } catch { /* ignore */ }
  },
  clear() {
    try { sessionStorage.removeItem(TOKEN_KEY) } catch { /* ignore */ }
  },
}

let onUnauthorized = () => {}
export const setUnauthorizedHandler = (fn) => { onUnauthorized = fn }

export async function downloadBlob(path) {
  const headers = {}
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`

  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method: 'GET',
      headers,
    })
  } catch {
    throw new ApiError(0, 'Tidak dapat terhubung ke server.')
  }

  if (!res.ok) {
    if (res.status === 401 && token) onUnauthorized()
    const errData = await res.json().catch(() => null)
    throw new ApiError(res.status, errData?.message ?? 'Gagal mengunduh berkas.', errData?.errors ?? null, errData)
  }

  const blob = await res.blob()
  const disposition = res.headers.get('content-disposition') || ''
  let filename = 'dokumen.xlsx'
  const match = disposition.match(/filename="?([^";]+)"?/)
  if (match?.[1]) {
    filename = match[1]
  }
  return { blob, filename }
}

export function triggerFileDownload(blob, filename = 'dokumen.xlsx') {
  if (typeof window === 'undefined') return
  const url = window.URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  window.URL.revokeObjectURL(url)
  document.body.removeChild(a)
}

export async function request(path, { method = 'GET', body } = {}) {
  const headers = { Accept: 'application/json' }
  const token = tokenStore.get()
  if (token) headers.Authorization = `Bearer ${token}`
  const isFormData = typeof FormData !== 'undefined' && body instanceof FormData
  if (body !== undefined && !isFormData) headers['Content-Type'] = 'application/json'

  let res
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: isFormData ? body : (body === undefined ? undefined : JSON.stringify(body)),
    })
  } catch {
    throw new ApiError(0, 'Tidak dapat terhubung ke server.')
  }

  const data = await res.json().catch(() => null)

  if (!res.ok) {
    // A 401 on a request that carried a token means the session is gone.
    if (res.status === 401 && token) onUnauthorized()
    throw new ApiError(res.status, data?.message ?? 'Terjadi kesalahan.', data?.errors ?? null, data)
  }
  return data
}

export const authApi = {
  login: (email, password) => request('/auth/login', { method: 'POST', body: { email, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/me'),
  otpRequest: (email, purpose) => request('/auth/otp/request', { method: 'POST', body: { email, purpose } }),
  otpVerify: (body) => request('/auth/otp/verify', { method: 'POST', body }),
  changePassword: (payload) => request('/me/password', { method: 'POST', body: payload }),
}

export const mfaApi = {
  status: () => request('/auth/mfa'),
  enroll: () => request('/auth/mfa/enroll', { method: 'POST' }),
  confirm: (code) => request('/auth/mfa/confirm', { method: 'POST', body: { code } }),
  verify: (code) => request('/auth/mfa/verify', { method: 'POST', body: { code } }),
}

const qs = (params = {}) => {
  const q = new URLSearchParams()
  Object.entries(params).forEach(([k, v]) => { if (v !== '' && v != null) q.set(k, v) })
  const text = q.toString()
  return text ? `?${text}` : ''
}

// Every call is re-authorized by the server; `access` only decides what the UI offers.
export const adminApi = {
  access: () => request('/admin/access'),
  roles: () => request('/admin/roles'),
  units: (params) => request(`/admin/organizational-units${qs(params)}`),
  unit: (id) => request(`/admin/organizational-units/${id}`),
  createUnit: (body) => request('/admin/organizational-units', { method: 'POST', body }),
  updateUnit: (id, body) => request(`/admin/organizational-units/${id}`, { method: 'POST', body }),
  users: (params) => request(`/admin/users${qs(params)}`),
  user: (id) => request(`/admin/users/${id}`),
  assignments: (id) => request(`/admin/users/${id}/assignments`),
  createUser: (body) => request('/admin/users', { method: 'POST', body }),
  resendInvitation: (id, reason) => request(`/admin/users/${id}/resend-invitation`, { method: 'POST', body: { reason } }),
  assign: (body) => request('/admin/role-assignments', { method: 'POST', body }),
  endAssignment: (id, reason) => request(`/admin/role-assignments/${id}/end`, { method: 'POST', body: { reason } }),
  updateUser: (id, body) => request(`/admin/users/${id}`, { method: 'PATCH', body }),
  changeStatus: (id, status, reason) => request(`/admin/users/${id}/status`, { method: 'POST', body: { status, reason } }),
}

// Master Data & Construction Standards API
export const masterDataApi = {
  access: () => request('/master-data/access'),
  categories: () => request('/master-data/categories'),
  createCategory: (body) => request('/master-data/categories', { method: 'POST', body }),
  updateCategory: (id, body) => request(`/master-data/categories/${id}`, { method: 'PATCH', body }),
  units: () => request('/master-data/units'),
  createUnit: (body) => request('/master-data/units', { method: 'POST', body }),
  updateUnit: (id, body) => request(`/master-data/units/${id}`, { method: 'PATCH', body }),
  materials: (params) => request(`/master-data/materials${qs(params)}`),
  material: (id) => request(`/master-data/materials/${id}`),
  updateMaterial: (id, body) => request(`/master-data/materials/${id}`, { method: 'PATCH', body }),
  materialImports: (params) => request(`/master-data/materials/imports${qs(params)}`),
  stageMaterialImport: (formData) => request('/master-data/materials/imports', { method: 'POST', body: formData }),
  materialImportBatch: (batchId, params) => request(`/master-data/materials/imports/${batchId}${qs(params)}`),
  confirmMaterialImport: (batchId, body) => request(`/master-data/materials/imports/${batchId}/confirm`, { method: 'POST', body }),
  cancelMaterialImport: (batchId) => request(`/master-data/materials/imports/${batchId}/cancel`, { method: 'POST' }),
  khsList: (params) => request(`/master-data/khs${qs(params)}`),
  khsItem: (id) => request(`/master-data/khs/${id}`),
  importKhs: (formData) => request('/master-data/khs/import', { method: 'POST', body: formData }),
  updateKhsDraft: (versionId, body) => request(`/master-data/khs/versions/${versionId}`, { method: 'PATCH', body }),
  approveKhs: (body) => request('/master-data/khs/versions/approve', { method: 'POST', body }),
  retireKhs: (versionId, body) => request(`/master-data/khs/versions/${versionId}/retire`, { method: 'POST', body }),
  constructionTypes: (params) => request(`/master-data/construction-types${qs(params)}`),
  constructionType: (id) => request(`/master-data/construction-types/${id}`),
  constructionMappings: (versionId, params) => request(`/master-data/construction-types/versions/${versionId}/mappings${qs(params)}`),
  importConstructionTypes: (formData) => request('/master-data/construction-types/import', { method: 'POST', body: formData }),
  importConstructionMappings: (formData) => request('/master-data/construction-types/mappings/import', { method: 'POST', body: formData }),
  approveConstructionTypes: (body) => request('/master-data/construction-types/versions/approve', { method: 'POST', body }),
  updateConstructionDraft: (versionId, body) => request(`/master-data/construction-types/versions/${versionId}`, { method: 'PATCH', body }),
  retireConstruction: (versionId, body) => request(`/master-data/construction-types/versions/${versionId}/retire`, { method: 'POST', body }),
  boms: (params) => request(`/master-data/bom${qs(params)}`),
  bom: (id) => request(`/master-data/bom/${id}`),
  bomLines: (id, params) => request(`/master-data/bom/${id}/lines${qs(params)}`),
  importBom: (formData) => request('/master-data/bom/import', { method: 'POST', body: formData }),
  updateBomDraft: (id, body) => request(`/master-data/bom/${id}`, { method: 'PATCH', body }),
  approveBom: (body) => request('/master-data/bom/versions/approve', { method: 'POST', body }),
  retireBom: (id, body) => request(`/master-data/bom/${id}/retire`, { method: 'POST', body }),
  calculateBom: (id, body) => request(`/master-data/bom/${id}/calculate`, { method: 'POST', body }),
  priceBooks: (params) => request(`/master-data/price-books${qs(params)}`),
  priceBook: (id) => request(`/master-data/price-books/${id}`),
  priceBookItems: (id, params) => request(`/master-data/price-books/${id}/items${qs(params)}`),
  importPriceBook: (formData) => request('/master-data/price-books/import', { method: 'POST', body: formData }),
  setPriceBookZone: (id, body) => request(`/master-data/price-books/${id}/zones`, { method: 'PUT', body }),
  approvePriceBooks: (body) => request('/master-data/price-books/approve', { method: 'POST', body }),
  retirePriceBook: (id, body) => request(`/master-data/price-books/${id}/retire`, { method: 'POST', body }),
  tariffBooks: (params) => request(`/master-data/tariff-books${qs(params)}`),
  tariffBook: (id) => request(`/master-data/tariff-books/${id}`),
  tariffBookRows: (id, params) => request(`/master-data/tariff-books/${id}/rows${qs(params)}`),
  importTariffBook: (formData) => request('/master-data/tariff-books/import', { method: 'POST', body: formData }),
  approveTariffBooks: (body) => request('/master-data/tariff-books/approve', { method: 'POST', body }),
  retireTariffBook: (id, body) => request(`/master-data/tariff-books/${id}/retire`, { method: 'POST', body }),
}

export const planningApi = {
  access: () => request('/planning/access'),
}

export const bomApi = {
  list: (params = {}) => request(`/master-data/bom${qs(params)}`),
  get: (id) => request(`/master-data/bom/${id}`),
  lines: (id, params = {}) => request(`/master-data/bom/${id}/lines${qs(params)}`),
  import: (formData) => request('/master-data/bom/import', { method: 'POST', body: formData }),
  updateDraft: (id, body) => request(`/master-data/bom/${id}`, { method: 'PATCH', body }),
  approve: (body) => request('/master-data/bom/versions/approve', { method: 'POST', body }),
  retire: (id, body) => request(`/master-data/bom/${id}/retire`, { method: 'POST', body }),
  discard: (id, body) => request(`/master-data/bom/${id}/discard`, { method: 'POST', body }),
  calculate: (id, body) => request(`/master-data/bom/${id}/calculate`, { method: 'POST', body }),
}

export const priceBookApi = {
  list: (params = {}) => request(`/master-data/price-books${qs(params)}`),
  get: (id) => request(`/master-data/price-books/${id}`),
  items: (id, params = {}) => request(`/master-data/price-books/${id}/items${qs(params)}`),
  import: (formData) => request('/master-data/price-books/import', { method: 'POST', body: formData }),
  setZone: (id, body) => request(`/master-data/price-books/${id}/zones`, { method: 'PUT', body }),
  createFromActive: (body) => request('/master-data/price-books/from-active', { method: 'POST', body }),
  setInsured: (id, code, body) => request(`/master-data/price-books/${id}/items/${encodeURIComponent(code)}/insured`, { method: 'PATCH', body }),
  approve: (body) => request('/master-data/price-books/approve', { method: 'POST', body }),
  retire: (id, body) => request(`/master-data/price-books/${id}/retire`, { method: 'POST', body }),
  discard: (id, body) => request(`/master-data/price-books/${id}/discard`, { method: 'POST', body }),
}

export const kkfParametersApi = {
  list: (params = {}) => request(`/master-data/kkf-parameters${qs(params)}`),
  active: (params = {}) => request(`/master-data/kkf-parameters/active${qs(params)}`),
  get: (id) => request(`/master-data/kkf-parameters/${id}`),
  create: (body) => request('/master-data/kkf-parameters', { method: 'POST', body }),
  update: (id, body) => request(`/master-data/kkf-parameters/${id}`, { method: 'PUT', body }),
  approve: (body) => request('/master-data/kkf-parameters/approve', { method: 'POST', body }),
  retire: (id, body) => request(`/master-data/kkf-parameters/${id}/retire`, { method: 'POST', body }),
  discard: (id, body) => request(`/master-data/kkf-parameters/${id}/discard`, { method: 'POST', body }),
}

// Excel master dari layar: unggah, periksa terhadap data berlaku, terapkan perubahan sebagai DRAFT
export const masterExcelApi = {
  list: () => request('/master-data/excel-imports'),
  get: (id) => request(`/master-data/excel-imports/${id}`),
  upload: (formData) => request('/master-data/excel-imports', { method: 'POST', body: formData }),
  recheck: (id) => request(`/master-data/excel-imports/${id}/recheck`, { method: 'POST' }),
  apply: (id, body) => request(`/master-data/excel-imports/${id}/apply`, { method: 'POST', body }),
  remove: (id) => request(`/master-data/excel-imports/${id}`, { method: 'DELETE' }),
  template: () => downloadBlob('/master-data/excel-imports/template'),   // MASTER DISTRIVA.xlsx dari BOM yang berlaku
}

export const tariffBooksApi = {
  list: (params = {}) => request(`/master-data/tariff-books${qs(params)}`),
  get: (id) => request(`/master-data/tariff-books/${id}`),
  rows: (id, params = {}) => request(`/master-data/tariff-books/${id}/rows${qs(params)}`),
  import: (formData) => request('/master-data/tariff-books/import', { method: 'POST', body: formData }),
  approve: (body) => request('/master-data/tariff-books/approve', { method: 'POST', body }),
  retire: (id, body) => request(`/master-data/tariff-books/${id}/retire`, { method: 'POST', body }),
  discard: (id, body) => request(`/master-data/tariff-books/${id}/discard`, { method: 'POST', body }),
}

// KKO (docs/62 §51): pembebanan trafo + tegangan lokasi, keputusan Teknik; tidak menghalangi alur
export const kkoApi = {
  get: (appId) => request(`/applications/${appId}/kko`),
  record: (appId, body) => request(`/applications/${appId}/kko`, { method: 'PUT', body }),
  decide: (appId, body) => request(`/applications/${appId}/kko/decision`, { method: 'POST', body }),
  baseline: (appId, substationId) => request(`/applications/${appId}/kko/baseline${qs({ substation_id: substationId })}`),
}

// Master gardu (docs/80). Reads need substations.view; writes are re-authorized by the server (scope + MFA for SYS_ADMIN).
export const substationsApi = {
  list: (params) => request(`/master-data/substations${qs(params)}`),
  get: (id) => request(`/master-data/substations/${id}`),
  analysis: (id, params) => request(`/master-data/substations/${id}/analysis${qs(params)}`),
  update: (id, body) => request(`/master-data/substations/${id}`, { method: 'PATCH', body }),
  addReading: (id, body) => request(`/master-data/substations/${id}/readings`, { method: 'POST', body }),
  bulkReadings: (items) => request('/master-data/substations/readings/bulk', { method: 'POST', body: { items } }),
  stage: (formData) => request('/master-data/substations/imports', { method: 'POST', body: formData }),
  batch: (batchId, params) => request(`/master-data/substations/imports/${batchId}${qs(params)}`),
  confirm: (batchId) => request(`/master-data/substations/imports/${batchId}/confirm`, { method: 'POST' }),
  discard: (batchId) => request(`/master-data/substations/imports/${batchId}`, { method: 'DELETE' }),
}

// Master penyulang (docs/81). Reads need feeders.view; writes need feeders.manage (reason is mandatory).
export const feedersApi = {
  list: (params) => request(`/master-data/feeders${qs(params)}`),
  get: (id) => request(`/master-data/feeders/${id}`),
  create: (body) => request('/master-data/feeders', { method: 'POST', body }),
  update: (id, body) => request(`/master-data/feeders/${id}`, { method: 'PATCH', body }),
}

// Master pelanggan (docs/81). Reads need customers.view; link corrections need customers.manage.
export const connectionsApi = {
  list: (params) => request(`/master-data/customer-connections${qs(params)}`),
  get: (id) => request(`/master-data/customer-connections/${id}`),
  link: (id, body) => request(`/master-data/customer-connections/${id}/link`, { method: 'PATCH', body }),
  // Sinkron DIL dari folder di server: info folder + berkas, mulai, dan pantau satu run
  syncInfo: (params = {}) => request(`/master-data/customer-connections/sync${qs(params)}`),
  syncStart: (body) => request('/master-data/customer-connections/sync/runs', { method: 'POST', body }),
  syncRun: (id) => request(`/master-data/customer-connections/sync/runs/${id}`),
}

export const kkfRunsApi = {
  listForApplication: (appId) => request(`/applications/${appId}/kkf-runs`),
  run: (appId, body) => request(`/applications/${appId}/kkf-runs`, { method: 'POST', body }),
  // BP sesudah UJL (meter pascabayar) dan syarat yang masih menghalangi (mis. belum ada run RAB), sebelum dry run
  preview: (appId, params) => request(`/applications/${appId}/kkf-preview${qs(params)}`),
  get: (runId) => request(`/kkf-runs/${runId}`),
  document: (runId, type = 'kkf', format = 'json') => {
    if (format === 'xlsx' || format === 'pdf') {
      return downloadBlob(`/kkf-runs/${runId}/documents/${type}?format=${format}`)
    }
    return request(`/kkf-runs/${runId}/documents/${type}?format=json`)
  },
}

export const rabRunsApi = {
  listForPackage: (packageId) => request(`/mto/${packageId}/rab-runs`),
  run: (packageId, body = {}) => request(`/mto/${packageId}/rab-runs`, { method: 'POST', body }),
  get: (runId) => request(`/rab-runs/${runId}`),
  document: (runId, type = 'rekap', format = 'json') => {
    if (format === 'xlsx' || format === 'pdf') {
      return downloadBlob(`/rab-runs/${runId}/documents/${type}?format=${format}`)
    }
    return request(`/rab-runs/${runId}/documents/${type}?format=json`)
  },
}

export const warehousesApi = {
  list: (params = {}) => request(`/master-data/warehouses${qs(params)}`),
  create: (body) => request('/master-data/warehouses', { method: 'POST', body }),
  importErp: (body) => request('/master-data/warehouses/import', { method: 'POST', body }),
  snapshots: (warehouseId) => request(`/master-data/warehouses/${warehouseId}/stock-snapshots`),
  importSnapshot: (warehouseId, formData) => request(`/master-data/warehouses/${warehouseId}/stock-snapshots`, { method: 'POST', body: formData }),
  snapshotDetail: (snapshotId) => request(`/master-data/stock-snapshots/${snapshotId}`),
  unmapped: (snapshotId, params = {}) => {
    const q = new URLSearchParams()
    if (params.search) q.append('search', params.search)
    if (params.per_page) q.append('per_page', params.per_page)
    const s = q.toString()
    return request(`/master-data/stock-snapshots/${snapshotId}/unmapped${s ? '?' + s : ''}`)
  },
  mimsMirror: (kind, params = {}) => {
    const q = new URLSearchParams()
    for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') q.append(k, v)
    const s = q.toString()
    return request(`/master-data/${{ issues: 'mims-issues', receipts: 'mims-receipts', reservations: 'mims-reservations' }[kind]}${s ? '?' + s : ''}`)
  },
  syncRuns: (params = {}) => {
    const q = new URLSearchParams()
    for (const k of ['kind', 'warehouse_id', 'trigger', 'status', 'month', 'page', 'per_page']) if (params[k]) q.append(k, params[k])
    const s = q.toString()
    return request(`/master-data/stock-sync-runs${s ? '?' + s : ''}`)
  },
  // Hari tiap bulan yang sudah/belum punya cuplikan stok per gudang (month = YYYY-MM).
  stockCoverage: (month, kind) => {
    const q = new URLSearchParams()
    month && q.append('month', month)
    kind && kind !== 'stock' && q.append('kind', kind)
    const s = q.toString()
    return request(`/master-data/stock-coverage${s ? '?' + s : ''}`)
  },
  // Penarikan MIMS berjalan sebagai proses latar belakang di server: mulai, lalu pantau hasil per gudang sampai selesai.
  // Mengembalikan { data: [hasil per gudang] }; onProgress(rows) dipanggil setiap hasil bertambah.
  syncStock: async (body, onProgress) => {
    const started = await request('/master-data/stock-sync/runs', { method: 'POST', body })
    return warehousesApi.watchMimsRun(started?.data, onProgress)
  },
  // Penarikan yang sedang berjalan (atau null), agar halaman yang dibuka belakangan tetap menampilkan kemajuannya.
  mimsRunActive: (params = {}) => request(`/master-data/stock-sync/runs/active${qs(params)}`),
  watchMimsRun: async (first, onProgress) => {
    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
    let run = first
    const id = run?.id
    if (typeof onProgress === 'function' && run) onProgress(run.results || [], run)
    const deadline = Date.now() + 3 * 60 * 60 * 1000
    while (run && (run.status === 'QUEUED' || run.status === 'RUNNING')) {
      if (Date.now() > deadline) throw new Error('Penarikan MIMS belum selesai setelah 3 jam; periksa riwayat sinkronisasi nanti.')
      await sleep(2500)
      run = (await request(`/master-data/stock-sync/runs/${id}`))?.data
      if (typeof onProgress === 'function' && run) onProgress(run.results || [], run)
    }
    const rows = run?.results || []
    if (run?.status === 'FAILED' && rows.length === 0) throw new Error(run.message || 'Penarikan MIMS gagal.')
    return { data: rows }
  },
  mimsTokenStatus: () => request('/master-data/stock-sync/token'),
  mimsAutoSettings: (params = {}) => request(`/master-data/stock-sync/settings${qs(params)}`),
  saveMimsAutoSettings: (body) => request('/master-data/stock-sync/settings', { method: 'PUT', body }),
  forgetMimsToken: () => request('/master-data/stock-sync/token', { method: 'DELETE' }),
  position: (params) => {
    // support array warehouse_ids: ?warehouse_ids[]=id1&warehouse_ids[]=id2
    const query = new URLSearchParams()
    if (params?.warehouse_ids) {
      params.warehouse_ids.forEach((id) => query.append('warehouse_ids[]', id))
    }
    if (params?.date) {
      query.append('date', params.date)
    }
    const qStr = query.toString()
    return request(`/master-data/stock-position${qStr ? '?' + qStr : ''}`)
  },
  materialDetail: (khsCode, warehouseIds = [], options = {}) => {
    const query = new URLSearchParams()
    query.append('khs_code', khsCode)
    if (Array.isArray(warehouseIds) && warehouseIds.length > 0) {
      warehouseIds.forEach((id) => query.append('warehouse_ids[]', id))
    }
    if (options?.period_months) {
      query.append('period_months', options.period_months)
    }
    if (options?.period_weeks) {
      query.append('period_weeks', options.period_weeks)
    }
    return request(`/master-data/stock-material-detail?${query.toString()}`)
  },
}

export const khsMaterialMapApi = {
  list: (params = {}) => {
    const q = new URLSearchParams()
    if (params.search) q.append('search', params.search)
    if (params.per_page) q.append('per_page', params.per_page)
    const s = q.toString()
    return request(`/master-data/khs-material-map${s ? '?' + s : ''}`)
  },
  workbench: (params = {}) => {
    const q = new URLSearchParams()
    if (params.filter) q.append('filter', params.filter)
    if (params.used !== undefined && params.used !== null) {
      const usedFlag = params.used === true || params.used === 1 || params.used === '1'
      q.append('used', usedFlag ? '1' : '0')
    }
    if (params.supply) q.append('supply', params.supply)
    if (params.search) q.append('search', params.search)
    if (params.page) q.append('page', params.page)
    if (params.per_page) q.append('per_page', params.per_page)
    const s = q.toString()
    return request(`/master-data/khs-material-map/workbench${s ? '?' + s : ''}`)
  },
  suggestions: (khsCode, limit = 10) => {
    const q = new URLSearchParams({ khs_code: khsCode, limit: String(limit) })
    return request(`/master-data/khs-material-map/suggestions?${q.toString()}`)
  },
  coverage: () => request('/master-data/khs-material-map/coverage'),
  create: (body) => request('/master-data/khs-material-map', { method: 'POST', body }),
  importCsv: (formData) => request('/master-data/khs-material-map/import', { method: 'POST', body: formData }),
  delete: (id) => request(`/master-data/khs-material-map/${id}`, { method: 'DELETE' }),
  exempt: (body) => request('/master-data/khs-material-map/exemptions', { method: 'POST', body }),
  liftExempt: (khsCode, body) => request(`/master-data/khs-material-map/exemptions/${encodeURIComponent(khsCode)}/lift`, { method: 'POST', body }),
}

export const poleContractsApi = {
  list: (params = {}) => request(`/master-data/pole-contracts${qs(params)}`),
  create: (body) => request('/master-data/pole-contracts', { method: 'POST', body }),
  get: (id) => request(`/master-data/pole-contracts/${id}`),
  update: (id, body) => request(`/master-data/pole-contracts/${id}`, { method: 'PUT', body }),
  close: (id, body) => request(`/master-data/pole-contracts/${id}/close`, { method: 'POST', body }),
}

export const allocationsApi = {
  listForApplication: (appId) => request(`/applications/${appId}/allocations`),
  create: (appId, body = {}) => request(`/applications/${appId}/allocations`, { method: 'POST', body }),
  get: (id) => request(`/allocations/${id}`),
  materialSuggestions: (id) => request(`/allocations/${id}/material-suggestions`),
  putMaterials: (id, body) => request(`/allocations/${id}/materials`, { method: 'PUT', body }),
  putPoles: (id, body) => request(`/allocations/${id}/poles`, { method: 'PUT', body }),
  confirm: (id, part, opts = {}) => request(`/allocations/${id}/confirm`, { method: 'POST', body: { part, ...(opts.acceptDebt ? { accept_debt: true } : {}) } }),
  cancel: (id, body) => request(`/allocations/${id}/cancel`, { method: 'POST', body }),
}

export const rkmApi = {
  plans: () => request('/rkm/plans'),
  createPlan: (body) => request('/rkm/plans', { method: 'POST', body }),
  amend: (planId, body) => request(`/rkm/plans/${planId}/amend`, { method: 'POST', body }),
  version: (versionId) => request(`/rkm/versions/${versionId}`),
  requirements: (versionId, date) => request(`/rkm/versions/${versionId}/requirements${date ? '?date=' + date : ''}`),
  startValidation: (versionId) => request(`/rkm/versions/${versionId}/start-validation`, { method: 'POST' }),
  adjust: (versionId, body) => request(`/rkm/versions/${versionId}/adjust`, { method: 'POST', body }),
  decide: (versionId, body) => request(`/rkm/versions/${versionId}/decision`, { method: 'POST', body }),
  putLines: (proposalId, body) => request(`/rkm/proposals/${proposalId}/lines`, { method: 'PUT', body }),
  setPackages: (proposalId, body) => request(`/rkm/proposals/${proposalId}/packages`, { method: 'PUT', body }),
  submit: (proposalId) => request(`/rkm/proposals/${proposalId}/submit`, { method: 'POST' }),
}

export const vendorsApi = {
  list: () => request('/master-data/vendors'),
  create: (body) => request('/master-data/vendors', { method: 'POST', body }),
  update: (id, body) => request(`/master-data/vendors/${id}`, { method: 'PUT', body }),
  setStatus: (id, status) => request(`/master-data/vendors/${id}/status`, { method: 'POST', body: { status } }),
  linkAccount: (id, userIdOrBody) => request(`/master-data/vendors/${id}/accounts`, { method: 'POST', body: typeof userIdOrBody === 'string' ? { user_id: userIdOrBody } : userIdOrBody }),
  deactivateAccount: (accountId) => request(`/master-data/vendor-accounts/${accountId}/deactivate`, { method: 'POST' }),
}

export const workOrdersApi = {
  list: () => request('/work-orders'),
  byAgenda: (params) => request(`/work-orders/by-agenda${qs(params)}`),
  listForApplication: (appId) => request(`/applications/${appId}/work-orders`),
  create: (appId) => request(`/applications/${appId}/work-orders`, { method: 'POST' }),
  get: (id) => request(`/work-orders/${id}`),
  setVendor: (id, body) => request(`/work-orders/${id}/vendor`, { method: 'PUT', body }),
  setTargetDate: (id, body) => request(`/work-orders/${id}/target-date`, { method: 'PUT', body }),
  submit: (id) => request(`/work-orders/${id}/submit`, { method: 'POST' }),
  decide: (id, body) => request(`/work-orders/${id}/decision`, { method: 'POST', body }),
  submitProgress: (id, body) => request(`/work-orders/${id}/progress`, { method: 'POST', body }),
  decideProgress: (progressId, body) => request(`/work-progress/${progressId}/decision`, { method: 'POST', body }),
  cancel: (id, body) => request(`/work-orders/${id}/cancel`, { method: 'POST', body }),
  amend: (id, body) => request(`/work-orders/${id}/amend`, { method: 'POST', body }),
}

export const poleWorkOrdersApi = {
  list: () => request('/pole-work-orders'),
  candidates: () => request('/pole-work-orders/candidates'),
  create: (body) => request('/pole-work-orders', { method: 'POST', body }),
  update: (id, body) => request(`/pole-work-orders/${id}`, { method: 'PUT', body }),
  get: (id) => request(`/pole-work-orders/${id}`),
  issue: (id) => request(`/pole-work-orders/${id}/issue`, { method: 'POST' }),
  amend: (id, body) => request(`/pole-work-orders/${id}/amend`, { method: 'POST', body }),
  cancel: (id, body) => request(`/pole-work-orders/${id}/cancel`, { method: 'POST', body }),
  uploadLetter: (id, file) => {
    const formData = new FormData()
    formData.append('file', file)
    return request(`/pole-work-orders/${id}/letter`, { method: 'POST', body: formData })
  },
  letterBlob: (id) => downloadBlob(`/pole-work-orders/${id}/letter`),
  submitProgress: (id, body) => request(`/pole-work-orders/${id}/progress`, { method: 'POST', body }),
  decideProgress: (progressId, body) => request(`/pole-wo-progress/${progressId}/decision`, { method: 'POST', body }),
  prepareBastp: (id, body) => request(`/pole-work-orders/${id}/bastp`, { method: 'POST', body }),
  decideBastp: (bastpId, body) => request(`/pole-wo-bastp/${bastpId}/decision`, { method: 'POST', body }),
}

export const bastpApi = {
  listForWorkOrder: (woId) => request(`/work-orders/${woId}/bastp`),
  create: (woId) => request(`/work-orders/${woId}/bastp`, { method: 'POST' }),
  get: (bastpId) => request(`/bastp/${bastpId}`),
  putMaterials: (bastpId, body) => request(`/bastp/${bastpId}/materials`, { method: 'PUT', body }),
  putMeters: (bastpId, body) => request(`/bastp/${bastpId}/meters`, { method: 'PUT', body }),
  uploadPhoto: (bastpId, meterId, file, title) => {
    const formData = new FormData()
    formData.append('file', file)
    if (title) formData.append('title', title)
    return request(`/bastp/${bastpId}/meters/${meterId}/photos`, { method: 'POST', body: formData })
  },
  submit: (bastpId, body) => request(`/bastp/${bastpId}/submit`, { method: 'POST', body }),
  accept: (bastpId, body) => request(`/bastp/${bastpId}/accept`, { method: 'POST', body }),
  sign: (bastpId, body) => request(`/bastp/${bastpId}/sign`, { method: 'POST', body }),
  close: (bastpId, body) => request(`/bastp/${bastpId}/close`, { method: 'POST', body }),
  return: (bastpId, body) => request(`/bastp/${bastpId}/return`, { method: 'POST', body }),
  document: (bastpId, format = 'json') => {
    if (format === 'xlsx' || format === 'pdf') {
      return downloadBlob(`/bastp/${bastpId}/document?format=${format}`)
    }
    return request(`/bastp/${bastpId}/document?format=json`)
  },
}

export const materialRequestsApi = {
  list: (params = {}) => {
    const q = new URLSearchParams()
    if (params.status) q.append('status', params.status)
    if (params.followup) q.append('followup', '1')
    if (params.search) q.append('search', params.search)
    if (params.per_page) q.append('per_page', params.per_page)
    const s = q.toString()
    return request(`/material-requests${s ? '?' + s : ''}`)
  },
  get: (id) => request(`/material-requests/${id}`),
  export: (id, format = 'csv') => {
    if (format === 'json') {
      return request(`/material-requests/${id}/export?format=json`)
    }
    return downloadBlob(`/material-requests/${id}/export?format=${format}`)
  },
  markSent: (id, body) => request(`/material-requests/${id}/mark-sent`, { method: 'POST', body }),
  cancel: (id, body) => request(`/material-requests/${id}/cancel`, { method: 'POST', body }),
}

export const reportsApi = {
  units: () => request('/reports/units'),
  overview: (params = {}) => {
    const q = new URLSearchParams()
    if (params.from) q.append('from', params.from)
    if (params.to) q.append('to', params.to)
    if (params.up3_id) q.append('up3_id', params.up3_id)
    if (params.unit_id) q.append('unit_id', params.unit_id)
    const s = q.toString()
    return request(`/reports/overview${s ? '?' + s : ''}`)
  },
  downloadOverviewXlsx: (params = {}) => {
    const q = new URLSearchParams()
    if (params.from) q.append('from', params.from)
    if (params.to) q.append('to', params.to)
    if (params.up3_id) q.append('up3_id', params.up3_id)
    if (params.unit_id) q.append('unit_id', params.unit_id)
    q.append('format', 'xlsx')
    return downloadBlob(`/reports/overview?${q.toString()}`)
  },
  pipeline: (params = {}) => {
    const q = new URLSearchParams()
    if (params.from) q.append('from', params.from)
    if (params.to) q.append('to', params.to)
    if (params.up3_id) q.append('up3_id', params.up3_id)
    if (params.unit_id) q.append('unit_id', params.unit_id)
    const s = q.toString()
    return request(`/reports/pipeline${s ? '?' + s : ''}`)
  },
  downloadPipelineXlsx: (params = {}) => {
    const q = new URLSearchParams()
    if (params.from) q.append('from', params.from)
    if (params.to) q.append('to', params.to)
    if (params.up3_id) q.append('up3_id', params.up3_id)
    if (params.unit_id) q.append('unit_id', params.unit_id)
    q.append('format', 'xlsx')
    return downloadBlob(`/reports/pipeline?${q.toString()}`)
  },
  rkm: (versionId, type, params = {}) => {
    const q = new URLSearchParams()
    if (params.format) q.append('format', params.format)
    const s = q.toString()
    return request(`/rkm/versions/${versionId}/reports/${type}${s ? '?' + s : ''}`)
  },
  downloadRkmXlsx: (versionId, type) => {
    return downloadBlob(`/rkm/versions/${versionId}/reports/${type}?format=xlsx`)
  },
  sla: (params = {}) => {
    const q = new URLSearchParams()
    if (params.from) q.append('from', params.from)
    if (params.to) q.append('to', params.to)
    if (params.up3_id) q.append('up3_id', params.up3_id)
    if (params.unit_id) q.append('unit_id', params.unit_id)
    const s = q.toString()
    return request(`/reports/sla${s ? '?' + s : ''}`)
  },
  downloadSlaXlsx: (params = {}) => {
    const q = new URLSearchParams()
    if (params.from) q.append('from', params.from)
    if (params.to) q.append('to', params.to)
    if (params.up3_id) q.append('up3_id', params.up3_id)
    if (params.unit_id) q.append('unit_id', params.unit_id)
    q.append('format', 'xlsx')
    return downloadBlob(`/reports/sla?${q.toString()}`)
  },
  costVariance: (params = {}) => {
    const q = new URLSearchParams()
    if (params.from) q.append('from', params.from)
    if (params.to) q.append('to', params.to)
    if (params.up3_id) q.append('up3_id', params.up3_id)
    if (params.unit_id) q.append('unit_id', params.unit_id)
    const s = q.toString()
    return request(`/reports/cost-variance${s ? '?' + s : ''}`)
  },
  downloadCostVarianceXlsx: (params = {}) => {
    const q = new URLSearchParams()
    if (params.from) q.append('from', params.from)
    if (params.to) q.append('to', params.to)
    if (params.up3_id) q.append('up3_id', params.up3_id)
    if (params.unit_id) q.append('unit_id', params.unit_id)
    q.append('format', 'xlsx')
    return downloadBlob(`/reports/cost-variance?${q.toString()}`)
  },
  settings: () => request('/reports/settings'),
  saveSettings: (body) => request('/reports/settings', { method: 'PUT', body }),
  vendorPerformance: (params = {}) => {
    const q = new URLSearchParams()
    for (const k of ['from', 'to', 'up3_id', 'unit_id']) if (params[k]) q.append(k, params[k])
    const s = q.toString()
    return request(`/reports/vendor-performance${s ? '?' + s : ''}`)
  },
  downloadVendorPerformanceXlsx: (params = {}) => {
    const q = new URLSearchParams()
    for (const k of ['from', 'to', 'up3_id', 'unit_id']) if (params[k]) q.append(k, params[k])
    q.append('format', 'xlsx')
    return downloadBlob(`/reports/vendor-performance?${q.toString()}`)
  },
  customerGrowth: (params = {}) => {
    const q = new URLSearchParams()
    for (const k of ['from', 'to', 'up3_id', 'unit_id']) if (params[k]) q.append(k, params[k])
    const s = q.toString()
    return request(`/reports/customer-growth${s ? '?' + s : ''}`)
  },
  downloadCustomerGrowthXlsx: (params = {}) => {
    const q = new URLSearchParams()
    for (const k of ['from', 'to', 'up3_id', 'unit_id']) if (params[k]) q.append(k, params[k])
    q.append('format', 'xlsx')
    return downloadBlob(`/reports/customer-growth?${q.toString()}`)
  },
  criticalStock: (params = {}) => {
    const q = new URLSearchParams()
    if (params.up3_id) q.append('up3_id', params.up3_id)
    if (params.unit_id) q.append('unit_id', params.unit_id)
    const s = q.toString()
    return request(`/reports/critical-stock${s ? '?' + s : ''}`)
  },
  downloadCriticalStockXlsx: (params = {}) => {
    const q = new URLSearchParams()
    if (params.up3_id) q.append('up3_id', params.up3_id)
    if (params.unit_id) q.append('unit_id', params.unit_id)
    q.append('format', 'xlsx')
    return downloadBlob(`/reports/critical-stock?${q.toString()}`)
  },
  kkfFeasibility: (params = {}) => {
    const q = new URLSearchParams()
    if (params.from) q.append('from', params.from)
    if (params.to) q.append('to', params.to)
    if (params.up3_id) q.append('up3_id', params.up3_id)
    if (params.unit_id) q.append('unit_id', params.unit_id)
    const s = q.toString()
    return request(`/reports/kkf-feasibility${s ? '?' + s : ''}`)
  },
  downloadKkfFeasibilityXlsx: (params = {}) => {
    const q = new URLSearchParams()
    if (params.from) q.append('from', params.from)
    if (params.to) q.append('to', params.to)
    if (params.up3_id) q.append('up3_id', params.up3_id)
    if (params.unit_id) q.append('unit_id', params.unit_id)
    q.append('format', 'xlsx')
    return downloadBlob(`/reports/kkf-feasibility?${q.toString()}`)
  },
  erpAnomalies: (params = {}) => {
    const q = new URLSearchParams()
    if (params.up3_id) q.append('up3_id', params.up3_id)
    if (params.unit_id) q.append('unit_id', params.unit_id)
    const s = q.toString()
    return request(`/reports/erp-anomalies${s ? '?' + s : ''}`)
  },
  downloadErpAnomaliesXlsx: (params = {}) => {
    const q = new URLSearchParams()
    if (params.up3_id) q.append('up3_id', params.up3_id)
    if (params.unit_id) q.append('unit_id', params.unit_id)
    q.append('format', 'xlsx')
    return downloadBlob(`/reports/erp-anomalies?${q.toString()}`)
  },
  dashboardSummary: () => request('/dashboard/summary'),
}

export const proposalsApi = {
  selectable: (params = {}) => request(`/proposals/selectable${qs(params)}`),
  list: (params = {}) => request(`/proposals${qs(params)}`),
  create: (body) => request('/proposals', { method: 'POST', body }),
  issue: (applicationId) => request('/proposals/issue', { method: 'POST', body: { application_id: applicationId } }),
  get: (id) => request(`/proposals/${id}`),
  addMembers: (id, body) => request(`/proposals/${id}/members`, { method: 'POST', body }),
  removeMember: (id, applicationId, body) => request(`/proposals/${id}/members/${applicationId}/remove`, { method: 'POST', body }),
  cancel: (id, body) => request(`/proposals/${id}/cancel`, { method: 'POST', body }),
  kkfRuns: (id) => request(`/proposals/${id}/kkf-runs`),
  runKkf: (id, body = {}) => request(`/proposals/${id}/kkf-runs`, { method: 'POST', body }),
}

export const applicationApi = {
  access: () => request('/applications/access'),
  units: () => request('/applications/units'),
  attention: (params) => request(`/applications/attention${qs(params)}`),
  list: (params) => request(`/applications${qs(params)}`),
  get: (id) => request(`/applications/${id}`),
  create: (body) => request('/applications', { method: 'POST', body }),
  update: (id, body) => request(`/applications/${id}`, { method: 'PATCH', body }),
  submit: (id) => request(`/applications/${id}/submit`, { method: 'POST' }),
  cancel: (id, body) => request(`/applications/${id}/cancel`, { method: 'POST', body }),
  addReference: (id, body) => request(`/applications/${id}/external-references`, { method: 'POST', body }),
  // EIS Import
  importBatches: (params) => request(`/applications/imports${qs(params)}`),
  uploadImport: (file) => {
    const formData = new FormData()
    formData.append('file', file)
    return request('/applications/imports', { method: 'POST', body: formData })
  },
  importBatchDetail: (batchId, params) => request(`/applications/imports/${batchId}${qs(params)}`),
  confirmImport: (batchId) => request(`/applications/imports/${batchId}/confirm`, { method: 'POST' }),
  discardImport: (batchId) => request(`/applications/imports/${batchId}/discard`, { method: 'POST' }),
}

export const eisSyncApi = {
  show: (params = {}) => request(`/eis-sync${qs(params)}`),
  save: (body) => request('/eis-sync/settings', { method: 'PUT', body }),
  start: (body = {}) => request('/eis-sync/runs', { method: 'POST', body }),
  run: (id) => request(`/eis-sync/runs/${id}`),
  apktTokenStatus: () => request('/eis-sync/apkt-token'),
  deleteApktToken: () => request('/eis-sync/apkt-token', { method: 'DELETE' }),
}

export const whatsappSettingsApi = {
  show: () => request('/settings/whatsapp'),
  save: (body) => request('/settings/whatsapp', { method: 'PUT', body }),
  test: (body) => request('/settings/whatsapp/test', { method: 'POST', body }),
}

export const outageApi = {
  sync: (params = {}) => request(`/outages/sync${qs(params)}`),
  saveSettings: (body) => request('/outages/sync/settings', { method: 'PUT', body }),
  start: (body = {}) => request('/outages/sync/runs', { method: 'POST', body }),
  run: (id) => request(`/outages/sync/runs/${id}`),
  alias: (body) => request('/outages/sync/aliases', { method: 'POST', body }),
  analysis: (params = {}) => request(`/outages/analysis${qs(params)}`),
  feeder: (id, params = {}) => request(`/outages/analysis/feeders/${id}${qs(params)}`),
  forecast: (params = {}) => request(`/outages/forecast${qs(params)}`),
  downloadAnalysisXlsx: (params = {}) => downloadBlob(`/outages/analysis${qs({ ...params, format: 'xlsx' })}`),
}

export const surveyApi = {
  access: () => request('/surveys/access'),
  list: (params = {}) => request(`/surveys${qs(params)}`),
  listForApplication: (appId) => request(`/applications/${appId}/surveys`),
  surveyors: (appId) => request(`/applications/${appId}/surveys/surveyors`),
  create: (appId, body) => request(`/applications/${appId}/surveys`, { method: 'POST', body }),
  get: (id) => request(`/surveys/${id}`),
  reassign: (id, body) => request(`/surveys/${id}/reassign`, { method: 'POST', body }),
  cancel: (id, body) => request(`/surveys/${id}/cancel`, { method: 'POST', body }),
  updateDraft: (id, version, body) => request(`/surveys/${id}/versions/${version}`, { method: 'PATCH', body }),
  submit: (id, version, body) => request(`/surveys/${id}/versions/${version}/submit`, { method: 'POST', body }),
  decide: (id, version, body) => request(`/surveys/${id}/versions/${version}/decisions`, { method: 'POST', body }),
}

export const documentApi = {
  listForApplication: (appId) => request(`/applications/${appId}/documents`),
  get: (id) => request(`/documents/${id}`),
  preview: (id) => request(`/documents/${id}/preview`),
  previewPdfBlob: async (id) => (await downloadBlob(`/documents/${id}/preview-pdf`)).blob,
  uploadToSurvey: (surveyId, version, file, title) => {
    const formData = new FormData()
    formData.append('file', file)
    if (title) formData.append('title', title)
    return request(`/surveys/${surveyId}/versions/${version}/documents`, { method: 'POST', body: formData })
  },
  remove: (id) => request(`/documents/${id}/remove`, { method: 'POST' }),
  downloadBlob: async (id, { version, inline = false } = {}) => {
    const params = {}
    if (version) params.version = version
    if (inline) params.inline = 1
    const token = tokenStore.get()
    const headers = { Accept: '*/*' }
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`${BASE}/documents/${id}/download${qs(params)}`, {
      method: 'GET',
      headers,
    })
    if (!res.ok) {
      const errJson = await res.json().catch(() => null)
      throw new ApiError(res.status, errJson?.message || 'Gagal mengunduh dokumen.')
    }
    return await res.blob()
  },
}

export const drawingApi = {
  access: () => request('/drawings/access'),
  forApplication: (appId) => request(`/applications/${appId}/drawing`),
  authors: (appId) => request(`/applications/${appId}/drawing/authors`),
  create: (appId, body) => request(`/applications/${appId}/drawing`, { method: 'POST', body }),
  get: (id) => request(`/drawings/${id}`),
  reassign: (id, body) => request(`/drawings/${id}/reassign`, { method: 'POST', body }),
  revise: (id) => request(`/drawings/${id}/versions`, { method: 'POST' }),
  updateDraft: (id, version, body) => request(`/drawings/${id}/versions/${version}`, { method: 'PATCH', body }),
  uploadDocument: (id, version, file, { role = 'MAIN', title } = {}) => {
    const formData = new FormData()
    formData.append('file', file)
    formData.append('role', role)
    if (title) formData.append('title', title)
    return request(`/drawings/${id}/versions/${version}/documents`, { method: 'POST', body: formData })
  },
  submit: (id, version) => request(`/drawings/${id}/versions/${version}/submit`, { method: 'POST' }),
  escalate: (id, version, body) => request(`/drawings/${id}/versions/${version}/escalate`, { method: 'POST', body }),
  decide: (id, version, body) => request(`/drawings/${id}/versions/${version}/decisions`, { method: 'POST', body }),
}

export const mtoApi = {
  access: () => request('/mto/access'),
  forVersion: (drawingId, versionId) => request(`/drawings/${drawingId}/versions/${versionId}/mto`),
  create: (drawingId, versionId, copyFromPrevious = false) =>
    request(`/drawings/${drawingId}/versions/${versionId}/mto`, {
      method: 'POST',
      body: { copy_from_previous: Boolean(copyFromPrevious) },
    }),
  get: (packageId) => request(`/mto/${packageId}`),
  updateItems: (packageId, body) => request(`/mto/${packageId}/items`, { method: 'PUT', body }),
  extract: (packageId, body = {}) => request(`/mto/${packageId}/extract`, { method: 'POST', body }),
  calculate: (packageId) => request(`/mto/${packageId}/calculate`, { method: 'POST' }),
  verify: (packageId) => request(`/mto/${packageId}/verify`, { method: 'POST' }),
  decide: (packageId, body) => request(`/mto/${packageId}/decision`, { method: 'POST', body }),
}

export const backupApi = {
  access: () => request('/backups/access'),
  status: () => request('/backups/status'),
  list: (params = {}) => request(`/backups${qs(params)}`),
  get: (id) => request(`/backups/${id}`),
  create: (body = {}) => request('/backups', { method: 'POST', body }),
  verify: (id) => request(`/backups/${id}/verify`, { method: 'POST' }),
  restore: (id, body) => request(`/backups/${id}/restore`, { method: 'POST', body }),
  restores: (params = {}) => request(`/backups/restores${qs(params)}`),
  getRestore: (id) => request(`/backups/restores/${id}`),
  remove: (id, body) => request(`/backups/${id}/remove`, { method: 'POST', body }),
  settings: () => request('/backups/settings'),
  updateSettings: (body) => request('/backups/settings', { method: 'PUT', body }),
  downloadBlob: async (id, fileType = 'database') => {
    const token = tokenStore.get()
    const headers = { Accept: '*/*' }
    if (token) headers.Authorization = `Bearer ${token}`
    const res = await fetch(`${BASE}/backups/${id}/download?file=${encodeURIComponent(fileType)}`, {
      method: 'GET',
      headers,
    })
    if (!res.ok) {
      const errJson = await res.json().catch(() => null)
      throw new ApiError(res.status, errJson?.message || 'Gagal mengunduh berkas cadangan.')
    }
    const blob = await res.blob()
    const disposition = res.headers.get('Content-Disposition') || ''
    let filename = fileType === 'database' ? `backup_${id}.dump` : `backup_docs_${id}.tar.gz`
    const match = disposition.match(/filename="?([^";]+)"?/i)
    if (match && match[1]) {
      filename = match[1]
    }
    return { blob, filename }
  },
}

// Forecast beban gardu (docs/11; deep learning)
export const forecastApi = {
  runs: (kind) => request(`/forecast/runs${qs({ kind })}`),
  run: (id) => request(`/forecast/runs/${id}`),
  substations: (id, params = {}) => request(`/forecast/runs/${id}/substations${qs(params)}`),
  series: (id, params = {}) => request(`/forecast/runs/${id}/series${qs(params)}`),
  derived: () => request('/forecast/derived'),
  schedule: () => request('/forecast/schedule'),
  saveSchedule: (body) => request('/forecast/schedule', { method: 'PUT', body }),
  start: (kind) => request('/forecast/runs', { method: 'POST', body: kind ? { kind } : undefined }),
  review: (id, note) => request(`/forecast/runs/${id}/review`, { method: 'POST', body: { note: note || null } }),
}

// Tugas permohonan dan SLA internal (docs/24 §8)
export const tasksApi = {
  list: (params = {}) => request(`/tasks${qs(params)}`),
  summary: () => request('/tasks/summary'),
  get: (id) => request(`/tasks/${id}`),
  forApplication: (appId) => request(`/applications/${appId}/tasks`),
  assignees: (appId) => request(`/applications/${appId}/tasks/assignees`),
  create: (appId, body) => request(`/applications/${appId}/tasks`, { method: 'POST', body }),
  step: (id, step, body = {}) => request(`/tasks/${id}/${step}`, { method: 'POST', body }),
}

export const serviceSlaApi = {
  list: (params = {}) => request(`/service-sla${qs(params)}`),
  summary: () => request('/service-sla/summary'),
  forApplication: (appId) => request(`/applications/${appId}/service-sla`),
  addNote: (appId, note) => request(`/applications/${appId}/service-sla/notes`, { method: 'POST', body: { note } }),
}

export const slaApi = {
  configurations: () => request('/sla/configurations'),
  update: (type, body) => request(`/sla/configurations/${type}`, { method: 'PUT', body }),
  holidays: (params = {}) => request(`/sla/holidays${qs(params)}`),
  addHoliday: (body) => request('/sla/holidays', { method: 'POST', body }),
  removeHoliday: (date) => request(`/sla/holidays/${date}`, { method: 'DELETE' }),
}

export const notificationsApi = {
  list: (params = {}) => request(`/notifications${qs(params)}`),
  markRead: (id) => request(`/notifications/${id}/read`, { method: 'POST' }),
  markAllRead: () => request('/notifications/read-all', { method: 'POST' }),
}


/** Pilihan UP3 / ULP untuk filter unit sebuah halaman, menurut peran dan cakupan pengguna pada izin halaman itu (GET /scoped-units). */
export const unitScopeApi = {
  get: (permission) => request(`/scoped-units${qs({ permission })}`),
}

/** Sinkronisasi Maximo dari DISTRIVA (WO inspeksi gardu -> pembacaan): pengaturan, sesi, dan riwayat. */
export const maximoSyncApi = {
  show: (params = {}) => request(`/maximo-sync${qs(params)}`),
  save: (body) => request('/maximo-sync/settings', { method: 'PUT', body }),
  runs: (params = {}) => request(`/maximo-sync/runs${qs(params)}`),
  start: (body = {}) => request('/maximo-sync/runs', { method: 'POST', body }),
  run: (id) => request(`/maximo-sync/runs/${id}`),
}

/** Pusat Sinkronisasi multi-UP3 & manajemen akun per ULP (docs/94). */
export const syncApi = {
  active: (params = {}) => request(`/sync/active${qs(params)}`),
  accounts: (params = {}) => request(`/sync/accounts${qs(params)}`),
  saveAccount: (body) => request('/sync/accounts', { method: 'PUT', body }),
  deleteAccount: (source, unitId) => request(`/sync/accounts/${source}/${unitId}`, { method: 'DELETE' }),
}

/** Laporan bulanan EIS/AP2T (309, DIFI, GGN, KLH, Piutang, TAGSUS): daftar, kelengkapan, isi, dan impor (docs/88). */
export const eisReportsApi = {
  list: (params = {}) => request(`/eis-reports${qs(params)}`),
  coverage: (params = {}) => request(`/eis-reports/coverage${qs(params)}`),
  lines: (id) => request(`/eis-reports/${id}/lines`),
  importFiles: (formData) => request('/eis-reports/import', { method: 'POST', body: formData }),
}

/** Nilai Kinerja Organisasi (NKO/KPI): definisi, snapshot, peringkat, masukan manual, hitung, dan aturan realisasi (docs/90, docs/93). */
export const nkoApi = {
  definitions: (params = {}) => request(`/nko/definitions${qs(params)}`),
  snapshots: (params = {}) => request(`/nko/snapshots${qs(params)}`),
  snapshot: (id) => request(`/nko/snapshots/${id}`),
  ranking: (params = {}) => request(`/nko/ranking${qs(params)}`),
  inputs: (params = {}) => request(`/nko/inputs${qs(params)}`),
  gaps: (params = {}) => request(`/nko/gaps${qs(params)}`),
  saveInputs: (body) => request('/nko/inputs', { method: 'PUT', body }),
  calculate: (body) => request('/nko/calculate', { method: 'POST', body }),
  rules: (params = {}) => request(`/nko/rules${qs(params)}`),
  rulesCatalog: () => request('/nko/rules/catalog'),
  rulesMapping: (params = {}) => request(`/nko/rules/mapping${qs(params)}`),
  previewRule: (body) => request('/nko/rules/preview', { method: 'POST', body }),
  ruleProposals: (params = {}) => request(`/nko/rule-proposals${qs(params)}`),
  proposeRule: (body) => request('/nko/rule-proposals', { method: 'POST', body }),
  decideRuleProposal: (id, body) => request(`/nko/rule-proposals/${id}/decision`, { method: 'POST', body }),
  cancelRuleProposal: (id) => request(`/nko/rule-proposals/${id}`, { method: 'DELETE' }),
  definitionSets: (params = {}) => request(`/nko/definition-sets${qs(params)}`),
  definitionUploads: (params = {}) => request(`/nko/definition-uploads${qs(params)}`),
  definitionUpload: (id) => request(`/nko/definition-uploads/${id}`),
  definitionTemplate: (params = {}) => downloadBlob(`/nko/definition-template${qs(params)}`),
  checkDefinitionUpload: (formData) => request('/nko/definition-uploads/check', { method: 'POST', body: formData }),
  uploadDefinitions: (formData) => request('/nko/definition-uploads', { method: 'POST', body: formData }),
  decideDefinitionUpload: (id, body) => request(`/nko/definition-uploads/${id}/decision`, { method: 'POST', body }),
  cancelDefinitionUpload: (id) => request(`/nko/definition-uploads/${id}`, { method: 'DELETE' }),
  targetTemplate: (params = {}) => downloadBlob(`/nko/target-template${qs(params)}`),
  checkTargetUpload: (formData) => request('/nko/target-uploads/check', { method: 'POST', body: formData }),
  targetUploads: (params = {}) => request(`/nko/target-uploads${qs(params)}`),
  targetUpload: (id) => request(`/nko/target-uploads/${id}`),
  uploadTargets: (formData) => request('/nko/target-uploads', { method: 'POST', body: formData }),
  decideTargetUpload: (id, body) => request(`/nko/target-uploads/${id}/decision`, { method: 'POST', body }),
  cancelTargetUpload: (id) => request(`/nko/target-uploads/${id}`, { method: 'DELETE' }),
}

/** Analisa dan Tren Pengusahaan (docs/91): katalog metrik dan tren per ULP / UP3. */
export const pengusahaanApi = {
  metrics: () => request('/pengusahaan/metrics'),
  metric: (code, params = {}) => request(`/pengusahaan/metrics/${code}${qs(params)}`),
  forecast: (code, params = {}) => request(`/pengusahaan/metrics/${code}/forecast${qs(params)}`),
  history: (code, params = {}) => request(`/pengusahaan/metrics/${code}/history${qs(params)}`),
  export: (code, params = {}) => downloadBlob(`/pengusahaan/metrics/${code}/export${qs(params)}`),
  inputs: (params = {}) => request(`/pengusahaan/inputs${qs(params)}`),
  saveInputs: (body) => request('/pengusahaan/inputs', { method: 'PUT', body }),
  template: (params = {}) => downloadBlob(`/pengusahaan/inputs/template${qs(params)}`),
  importInputs: (formData) => request('/pengusahaan/inputs/import', { method: 'POST', body: formData }),
}
