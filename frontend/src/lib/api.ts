const API_BASE = "/api";

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number
  ) {
    super(message);
  }
}

async function request<T>(
  path: string,
  options: RequestInit = {},
  token?: string | null
): Promise<T> {
  const headers: HeadersInit = {
    "Content-Type": "application/json",
    ...(options.headers ?? {}),
  };

  if (token) {
    (headers as Record<string, string>)["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers,
  });

  const data = await res.json().catch(() => ({}));

  if (!res.ok) {
    throw new ApiError(data.error ?? "Request failed", res.status);
  }

  return data as T;
}

export const api = {
  health: () => request<{ status: string; database: string }>("/health"),

  login: (email: string, password: string) =>
    request<import("../types/auth").LoginResponse>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),

  me: (token: string) =>
    request<import("../types/auth").AuthUser>("/auth/me", {}, token),

  logout: (token: string) =>
    request<{ message: string }>(
      "/auth/logout",
      { method: "POST" },
      token
    ),

  listUsers: (token: string) =>
    request<{ users: unknown[] }>("/users", {}, token),

  listRoles: (token: string) =>
    request<{ roles: unknown[] }>("/roles", {}, token),
};

async function authRequest<T>(
  path: string,
  token: string,
  options: RequestInit = {}
): Promise<T> {
  return request<T>(path, options, token);
}

export interface CoilListResponse {
  coils: import("../types/coil").Coil[];
  total: number;
  limit?: number;
  offset?: number;
}

export interface CoilStatsResponse {
  stats: {
    total: number;
    active: number;
    archived: number;
    inTrace: number;
    withDocs: number;
  };
}

export const coilApi = {
  list: (
    token: string,
    params?: {
      search?: string;
      grade?: string;
      supplier?: string;
      from?: string;
      to?: string;
      includeArchived?: boolean;
      quickFilter?: "hasDocs" | "inTrace" | "missingMtc";
      limit?: number;
      offset?: number;
      sortBy?: "createdAt" | "coilNumber" | "amnsDispatchDate" | "receiptDateSlitter" | "grade";
      sortOrder?: "asc" | "desc";
    }
  ) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.grade) q.set("grade", params.grade);
    if (params?.supplier) q.set("supplier", params.supplier);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    if (params?.includeArchived) q.set("includeArchived", "true");
    if (params?.quickFilter) q.set("quickFilter", params.quickFilter);
    if (params?.limit !== undefined) q.set("limit", String(params.limit));
    if (params?.offset !== undefined) q.set("offset", String(params.offset));
    if (params?.sortBy) q.set("sortBy", params.sortBy);
    if (params?.sortOrder) q.set("sortOrder", params.sortOrder);
    const qs = q.toString();
    return authRequest<CoilListResponse>(`/coils${qs ? `?${qs}` : ""}`, token);
  },

  stats: (token: string, includeArchived?: boolean) => {
    const q = includeArchived ? "?includeArchived=true" : "";
    return authRequest<CoilStatsResponse>(`/coils/stats${q}`, token);
  },

  auditLogs: (token: string, coilNumber: string, limit = 10) =>
    authRequest<{ logs: import("../types/dashboard").AuditLogEntry[] }>(
      `/coils/${encodeURIComponent(coilNumber)}/audit-logs?limit=${limit}`,
      token
    ),

  get: (token: string, coilNumber: string) =>
    authRequest<{ coil: import("../types/coil").Coil; usage: import("../types/coil").CoilUsage }>(
      `/coils/${coilNumber}`,
      token
    ),

  usage: (token: string, coilNumber: string) =>
    authRequest<{ usage: import("../types/coil").CoilUsage }>(
      `/coils/${coilNumber}/usage`,
      token
    ),

  create: (token: string, data: Record<string, unknown>) =>
    authRequest<{ coil: import("../types/coil").Coil }>("/coils", token, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (token: string, coilNumber: string, data: Record<string, unknown>) =>
    authRequest<{
      coil: import("../types/coil").Coil;
      usage: import("../types/coil").CoilUsage;
    }>(`/coils/${coilNumber}`, token, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  archive: (token: string, coilNumber: string) =>
    authRequest<{
      coil: import("../types/coil").Coil;
      usage: import("../types/coil").CoilUsage;
    }>(`/coils/${coilNumber}/archive`, token, { method: "PATCH" }),

  delete: (token: string, coilNumber: string) =>
    authRequest<{ message: string; coilNumber: string }>(`/coils/${coilNumber}`, token, {
      method: "DELETE",
    }),

  uploadDocument: async (
    token: string,
    coilNumber: string,
    file: File,
    documentType: "MTC" | "INVOICE"
  ) => {
    const form = new FormData();
    form.append("file", file);
    form.append("documentType", documentType);

    const res = await fetch(`/api/coils/${coilNumber}/documents`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    const data = await res.json();
    if (!res.ok) throw new ApiError(data.error ?? "Upload failed", res.status);
    return data;
  },

  documentUrl: (documentId: string, download = false) =>
    `/api/coils/documents/${documentId}/file${download ? "?download=true" : ""}`,

  openDocument: async (token: string, documentId: string) => {
    const res = await fetch(coilApi.documentUrl(documentId), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data.error ?? "Failed to open document", res.status);
    }
    const blob = await res.blob();
    window.open(URL.createObjectURL(blob), "_blank");
  },

  downloadDocument: async (token: string, documentId: string, filename: string) => {
    const res = await fetch(coilApi.documentUrl(documentId, true), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data.error ?? "Failed to download document", res.status);
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  },

  deleteDocument: (token: string, documentId: string) =>
    authRequest<{ message: string; documentId: string; coilNumber: string }>(
      `/coils/documents/${documentId}`,
      token,
      { method: "DELETE" }
    ),
};

export const slittingApi = {
  list: (
    token: string,
    params?: { search?: string; parentCoil?: string; from?: string; to?: string }
  ) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.parentCoil) q.set("parentCoil", params.parentCoil);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const qs = q.toString();
    return authRequest<{ records: import("../types/slitting").SlittingRecord[] }>(
      `/slitting${qs ? `?${qs}` : ""}`,
      token
    );
  },

  get: (token: string, slitCoilId: string) =>
    authRequest<{ record: import("../types/slitting").SlittingRecord }>(
      `/slitting/${slitCoilId}`,
      token
    ),

  createBatch: (token: string, data: Record<string, unknown>) =>
    authRequest<{ records: import("../types/slitting").SlittingRecord[] }>(
      "/slitting/batch",
      token,
      { method: "POST", body: JSON.stringify(data) }
    ),

  update: (token: string, slitCoilId: string, data: Record<string, unknown>) =>
    authRequest<{ record: import("../types/slitting").SlittingRecord }>(
      `/slitting/${slitCoilId}`,
      token,
      { method: "PUT", body: JSON.stringify(data) }
    ),

  previewIds: (token: string, parentCoilNumber: string, count: number) =>
    authRequest<{ slitCoilIds: string[] }>(
      `/slitting/preview-ids?parentCoilNumber=${encodeURIComponent(parentCoilNumber)}&count=${count}`,
      token
    ),
};

export const sunrackReceiptApi = {
  stats: (token: string) =>
    authRequest<{ stats: import("../types/sunrack-receipt").SunrackReceiptStats }>(
      "/sunrack-receipts/stats",
      token
    ),

  list: (
    token: string,
    params?: { search?: string; status?: string; from?: string; to?: string }
  ) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.status) q.set("status", params.status);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const qs = q.toString();
    return authRequest<{ receipts: import("../types/sunrack-receipt").SunrackReceipt[] }>(
      `/sunrack-receipts${qs ? `?${qs}` : ""}`,
      token
    );
  },

  pending: (token: string, search?: string) => {
    const q = search ? `?search=${encodeURIComponent(search)}` : "";
    return authRequest<{ pending: import("../types/sunrack-receipt").PendingSlitCoil[] }>(
      `/sunrack-receipts/pending${q}`,
      token
    );
  },

  get: (token: string, id: string) =>
    authRequest<{ receipt: import("../types/sunrack-receipt").SunrackReceipt }>(
      `/sunrack-receipts/${id}`,
      token
    ),

  getBySlitCoil: (token: string, slitCoilId: string) =>
    authRequest<{ receipt: import("../types/sunrack-receipt").SunrackReceipt }>(
      `/sunrack-receipts/by-slit/${slitCoilId}`,
      token
    ),

  create: (token: string, data: Record<string, unknown>) =>
    authRequest<{ receipt: import("../types/sunrack-receipt").SunrackReceipt }>(
      "/sunrack-receipts",
      token,
      { method: "POST", body: JSON.stringify(data) }
    ),

  update: (token: string, id: string, data: Record<string, unknown>) =>
    authRequest<{ receipt: import("../types/sunrack-receipt").SunrackReceipt }>(
      `/sunrack-receipts/${id}`,
      token,
      { method: "PUT", body: JSON.stringify(data) }
    ),

  uploadPhotos: async (token: string, receiptId: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append("photos", file);

    const res = await fetch(`/api/sunrack-receipts/${receiptId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });

    const data = await res.json();
    if (!res.ok) throw new ApiError(data.error ?? "Upload failed", res.status);
    return data as { photos: import("../types/sunrack-receipt").SunrackReceiptPhoto[] };
  },

  photoUrl: (photoId: string) => `/api/sunrack-receipts/photos/${photoId}/file`,
};

export const productionApi = {
  stats: (token: string) =>
    authRequest<{ stats: { totalBatches: number; slitCoilsWithReceipt: number } }>(
      "/production/stats",
      token
    ),

  list: (
    token: string,
    params?: { search?: string; productType?: string; from?: string; to?: string }
  ) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.productType) q.set("productType", params.productType);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const qs = q.toString();
    return authRequest<{ batches: import("../types/production").ProductionBatch[] }>(
      `/production${qs ? `?${qs}` : ""}`,
      token
    );
  },

  availableSlitCoils: (token: string, search?: string) => {
    const q = search ? `?search=${encodeURIComponent(search)}` : "";
    return authRequest<{ available: import("../types/production").AvailableSlitCoil[] }>(
      `/production/available-slit-coils${q}`,
      token
    );
  },

  previewBatchNumber: (token: string) =>
    authRequest<{ batchNumber: string }>("/production/preview-batch-number", token),

  get: (token: string, batchNumber: string) =>
    authRequest<{ batch: import("../types/production").ProductionBatch }>(
      `/production/${batchNumber}`,
      token
    ),

  create: (token: string, data: Record<string, unknown>) =>
    authRequest<{ batch: import("../types/production").ProductionBatch }>(
      "/production",
      token,
      { method: "POST", body: JSON.stringify(data) }
    ),

  issueSlitCoils: (token: string, batchNumber: string, data: Record<string, unknown>) =>
    authRequest<{ batch: import("../types/production").ProductionBatch }>(
      `/production/${batchNumber}/issue`,
      token,
      { method: "POST", body: JSON.stringify(data) }
    ),

  update: (token: string, batchNumber: string, data: Record<string, unknown>) =>
    authRequest<{ batch: import("../types/production").ProductionBatch }>(
      `/production/${batchNumber}`,
      token,
      { method: "PUT", body: JSON.stringify(data) }
    ),

  slitCoilUsage: (token: string, slitCoilId: string) =>
    authRequest<{
      slitCoilId: string;
      remainingQuantity: number;
      consumptions: import("../types/production").BatchSlitCoilConsumption[];
    }>(`/production/slit-coil/${slitCoilId}/usage`, token),
};

export const qcApi = {
  stats: (token: string) =>
    authRequest<{ stats: import("../types/qc").QcStats }>("/qc/stats", token),

  list: (
    token: string,
    params?: { search?: string; status?: string; from?: string; to?: string }
  ) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.status) q.set("status", params.status);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const qs = q.toString();
    return authRequest<{ inspections: import("../types/qc").QcInspection[] }>(
      `/qc${qs ? `?${qs}` : ""}`,
      token
    );
  },

  pendingBatches: (token: string) =>
    authRequest<{ pending: import("../types/qc").PendingQcBatch[] }>("/qc/pending-batches", token),

  dispatchEligible: (token: string) =>
    authRequest<{ batches: import("../types/production").ProductionBatch[] }>(
      "/qc/dispatch-eligible-batches",
      token
    ),

  get: (token: string, id: string) =>
    authRequest<{ inspection: import("../types/qc").QcInspection }>(`/qc/${id}`, token),

  getByBatch: (token: string, batchNumber: string) =>
    authRequest<{
      batchNumber: string;
      latestResult: import("../types/qc").QcResult | null;
      dispatchEligible: boolean;
      inspections: import("../types/qc").QcInspection[];
    }>(`/qc/batch/${batchNumber}`, token),

  create: (token: string, data: Record<string, unknown>) =>
    authRequest<{ inspection: import("../types/qc").QcInspection }>("/qc", token, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (token: string, id: string, data: Record<string, unknown>) =>
    authRequest<{ inspection: import("../types/qc").QcInspection }>(`/qc/${id}`, token, {
      method: "PUT",
      body: JSON.stringify(data),
    }),

  uploadPhotos: async (token: string, inspectionId: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append("photos", file);
    const res = await fetch(`/api/qc/${inspectionId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new ApiError(data.error ?? "Upload failed", res.status);
    return data as { photos: import("../types/qc").QcInspectionPhoto[] };
  },

  photoUrl: (photoId: string) => `/api/qc/photos/${photoId}/file`,
};

export const finishedGoodsApi = {
  stats: (token: string) =>
    authRequest<{ stats: import("../types/finished-goods").FinishedGoodsStats }>(
      "/finished-goods/stats",
      token
    ),

  list: (
    token: string,
    params?: { search?: string; productType?: string; availableOnly?: boolean }
  ) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.productType) q.set("productType", params.productType);
    if (params?.availableOnly) q.set("availableOnly", "true");
    const qs = q.toString();
    return authRequest<{ inventory: import("../types/finished-goods").FinishedGoodsItem[] }>(
      `/finished-goods${qs ? `?${qs}` : ""}`,
      token
    );
  },

  get: (token: string, batchNumber: string) =>
    authRequest<{ item: import("../types/finished-goods").FinishedGoodsItem }>(
      `/finished-goods/${batchNumber}`,
      token
    ),
};

export const dispatchApi = {
  stats: (token: string) =>
    authRequest<{ stats: import("../types/dispatch").DispatchStats }>("/dispatch/stats", token),

  list: (
    token: string,
    params?: { search?: string; projectName?: string; from?: string; to?: string }
  ) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.projectName) q.set("projectName", params.projectName);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const qs = q.toString();
    return authRequest<{ dispatches: import("../types/dispatch").SiteDispatch[] }>(
      `/dispatch${qs ? `?${qs}` : ""}`,
      token
    );
  },

  previewDispatchNote: (token: string) =>
    authRequest<{ dispatchNoteNumber: string }>("/dispatch/preview-dispatch-note", token),

  get: (token: string, dispatchNoteNumber: string) =>
    authRequest<{ dispatch: import("../types/dispatch").SiteDispatch }>(
      `/dispatch/${dispatchNoteNumber}`,
      token
    ),

  create: (token: string, data: Record<string, unknown>) =>
    authRequest<{ dispatch: import("../types/dispatch").SiteDispatch }>("/dispatch", token, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (token: string, dispatchNoteNumber: string, data: Record<string, unknown>) =>
    authRequest<{ dispatch: import("../types/dispatch").SiteDispatch }>(
      `/dispatch/${dispatchNoteNumber}`,
      token,
      { method: "PUT", body: JSON.stringify(data) }
    ),
};

export const siteInstallationApi = {
  stats: (token: string) =>
    authRequest<{ stats: import("../types/site-installation").SiteInstallationStats }>(
      "/site-installation/stats",
      token
    ),

  pendingDispatches: (token: string) =>
    authRequest<{ pending: import("../types/site-installation").PendingSiteDispatch[] }>(
      "/site-installation/pending-dispatches",
      token
    ),

  list: (token: string, params?: { search?: string; from?: string; to?: string }) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const qs = q.toString();
    return authRequest<{ installations: import("../types/site-installation").SiteInstallation[] }>(
      `/site-installation${qs ? `?${qs}` : ""}`,
      token
    );
  },

  get: (token: string, id: string) =>
    authRequest<{ installation: import("../types/site-installation").SiteInstallation }>(
      `/site-installation/${id}`,
      token
    ),

  getByDispatch: (token: string, dispatchNoteNumber: string) =>
    authRequest<{ installation: import("../types/site-installation").SiteInstallation }>(
      `/site-installation/by-dispatch/${dispatchNoteNumber}`,
      token
    ),

  create: (token: string, data: Record<string, unknown>) =>
    authRequest<{ installation: import("../types/site-installation").SiteInstallation }>(
      "/site-installation",
      token,
      { method: "POST", body: JSON.stringify(data) }
    ),

  update: (token: string, id: string, data: Record<string, unknown>) =>
    authRequest<{ installation: import("../types/site-installation").SiteInstallation }>(
      `/site-installation/${id}`,
      token,
      { method: "PUT", body: JSON.stringify(data) }
    ),

  uploadPhotos: async (token: string, installationId: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append("photos", file);
    const res = await fetch(`/api/site-installation/${installationId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new ApiError(data.error ?? "Upload failed", res.status);
    return data as { photos: import("../types/site-installation").SiteInstallationPhoto[] };
  },

  photoUrl: (photoId: string) => `/api/site-installation/photos/${photoId}/file`,
};

export const complaintApi = {
  stats: (token: string) =>
    authRequest<{ stats: import("../types/complaint").ComplaintStats }>(
      "/complaints/stats",
      token
    ),

  eligibleBatches: (token: string) =>
    authRequest<{ batches: import("../types/complaint").EligibleComplaintBatch[] }>(
      "/complaints/eligible-batches",
      token
    ),

  resolveTrace: (token: string, batchNumbers: string[]) =>
    authRequest<{ traceability: import("../types/complaint").ComplaintTraceability }>(
      "/complaints/resolve-trace",
      token,
      { method: "POST", body: JSON.stringify({ batchNumbers }) }
    ),

  previewComplaintId: (token: string) =>
    authRequest<{ complaintId: string }>("/complaints/preview-complaint-id", token),

  list: (
    token: string,
    params?: { search?: string; status?: string; from?: string; to?: string }
  ) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.status) q.set("status", params.status);
    if (params?.from) q.set("from", params.from);
    if (params?.to) q.set("to", params.to);
    const qs = q.toString();
    return authRequest<{ complaints: import("../types/complaint").Complaint[] }>(
      `/complaints${qs ? `?${qs}` : ""}`,
      token
    );
  },

  get: (token: string, complaintId: string) =>
    authRequest<{ complaint: import("../types/complaint").Complaint }>(
      `/complaints/${complaintId}`,
      token
    ),

  create: (token: string, data: Record<string, unknown>) =>
    authRequest<{ complaint: import("../types/complaint").Complaint }>("/complaints", token, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  update: (token: string, complaintId: string, data: Record<string, unknown>) =>
    authRequest<{ complaint: import("../types/complaint").Complaint }>(
      `/complaints/${complaintId}`,
      token,
      { method: "PUT", body: JSON.stringify(data) }
    ),

  uploadPhotos: async (token: string, complaintId: string, files: File[]) => {
    const form = new FormData();
    for (const file of files) form.append("photos", file);
    const res = await fetch(`/api/complaints/${complaintId}/photos`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: form,
    });
    const data = await res.json();
    if (!res.ok) throw new ApiError(data.error ?? "Upload failed", res.status);
    return data as { photos: import("../types/complaint").ComplaintPhoto[] };
  },

  photoUrl: (photoId: string) => `/api/complaints/photos/${photoId}/file`,
};

export const traceabilityApi = {
  search: (token: string, q: string) =>
    authRequest<{ hits: import("../types/traceability").TraceabilitySearchHit[] }>(
      `/traceability/search?q=${encodeURIComponent(q)}`,
      token
    ),

  timeline: (token: string, q: string) =>
    authRequest<{ timeline: import("../types/traceability").TraceabilityTimeline }>(
      `/traceability/timeline?q=${encodeURIComponent(q)}`,
      token
    ),

  exportPdf: async (token: string, q: string) => {
    const res = await fetch(
      `/api/traceability/export/pdf?q=${encodeURIComponent(q)}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new ApiError(data.error ?? "PDF export failed", res.status);
    }
    return res.blob();
  },
};

export const dashboardApi = {
  overview: (token: string) =>
    authRequest<{ overview: import("../types/dashboard").DashboardOverview }>(
      "/dashboard/overview",
      token
    ),

  auditLogs: (
    token: string,
    params?: { limit?: number; offset?: number; entityType?: string; action?: string }
  ) => {
    const q = new URLSearchParams();
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    if (params?.entityType) q.set("entityType", params.entityType);
    if (params?.action) q.set("action", params.action);
    const qs = q.toString();
    return authRequest<{
      logs: import("../types/dashboard").AuditLogEntry[];
      total: number;
      limit: number;
      offset: number;
    }>(`/dashboard/audit-logs${qs ? `?${qs}` : ""}`, token);
  },

  notifications: (token: string, unreadOnly?: boolean) => {
    const qs = unreadOnly ? "?unreadOnly=true" : "";
    return authRequest<{
      notifications: import("../types/dashboard").SystemNotification[];
      unreadCount: number;
    }>(`/dashboard/notifications${qs}`, token);
  },

  markNotificationRead: (token: string, id: string) =>
    authRequest<{ unreadCount: number }>(`/dashboard/notifications/${id}/read`, token, {
      method: "PATCH",
    }),

  markAllNotificationsRead: (token: string) =>
    authRequest<{ unreadCount: number }>("/dashboard/notifications/read", token, {
      method: "PATCH",
      body: JSON.stringify({}),
    }),
};

export const documentsApi = {
  stats: (token: string) =>
    authRequest<{ stats: import("../types/documents").DocumentStats }>(
      "/documents/stats",
      token
    ),

  list: (
    token: string,
    params?: {
      search?: string;
      category?: string;
      kind?: string;
      limit?: number;
      offset?: number;
    }
  ) => {
    const q = new URLSearchParams();
    if (params?.search) q.set("search", params.search);
    if (params?.category) q.set("category", params.category);
    if (params?.kind) q.set("kind", params.kind);
    if (params?.limit) q.set("limit", String(params.limit));
    if (params?.offset) q.set("offset", String(params.offset));
    const qs = q.toString();
    return authRequest<{
      documents: import("../types/documents").DocumentItem[];
      total: number;
      limit: number;
      offset: number;
    }>(`/documents${qs ? `?${qs}` : ""}`, token);
  },

  byReference: (token: string, q: string) =>
    authRequest<{
      query: string;
      documents: import("../types/documents").DocumentItem[];
      total: number;
    }>(`/documents/by-reference?q=${encodeURIComponent(q)}`, token),
};

export const usersRolesApi = {
  listUsers: (token: string) =>
    authRequest<{ users: import("../types/users-roles").UserRecord[] }>(
      "/users",
      token
    ),

  getUser: (token: string, id: string) =>
    authRequest<{ user: import("../types/users-roles").UserRecord }>(
      `/users/${id}`,
      token
    ),

  createUser: (
    token: string,
    data: {
      email: string;
      password: string;
      fullName: string;
      roleCode: string;
    }
  ) =>
    authRequest<{ user: import("../types/users-roles").UserRecord }>(
      "/users",
      token,
      { method: "POST", body: JSON.stringify(data) }
    ),

  updateUser: (
    token: string,
    id: string,
    data: {
      email?: string;
      password?: string;
      fullName?: string;
      roleCode?: string;
      isActive?: boolean;
    }
  ) =>
    authRequest<{ user: import("../types/users-roles").UserRecord }>(
      `/users/${id}`,
      token,
      { method: "PUT", body: JSON.stringify(data) }
    ),

  deactivateUser: (token: string, id: string) =>
    authRequest<{ user: import("../types/users-roles").UserRecord }>(
      `/users/${id}/deactivate`,
      token,
      { method: "PATCH", body: JSON.stringify({}) }
    ),

  listRoles: (token: string) =>
    authRequest<{
      roles: import("../types/users-roles").RoleRecord[];
      definitions: Array<{ code: string; name: string; description: string }>;
    }>("/roles", token),

  getRolePermissions: (token: string, roleCode: string) =>
    authRequest<import("../types/users-roles").RolePermissionsResponse>(
      `/roles/${roleCode}/permissions`,
      token
    ),

  updateRolePermissions: (
    token: string,
    roleCode: string,
    permissions: Record<string, import("../types/users-roles").ModuleAccessLevel>
  ) =>
    authRequest<{
      role: {
        code: string;
        name: string;
        permissions: Record<string, import("../types/users-roles").ModuleAccessLevel>;
      };
    }>(`/roles/${roleCode}/permissions`, token, {
      method: "PUT",
      body: JSON.stringify({ permissions }),
    }),

  resetRolePermissions: (token: string, roleCode: string) =>
    authRequest<{
      role: {
        code: string;
        name: string;
        permissions: Record<string, import("../types/users-roles").ModuleAccessLevel>;
      };
    }>(`/roles/${roleCode}/permissions/reset`, token, { method: "POST" }),
};
