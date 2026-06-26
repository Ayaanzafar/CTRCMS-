# CTRCMS Go API

Primary CTRCMS backend (Go + Echo + sqlc). Replaces the legacy Node/Express API on port **4000**.

Frontend dev server (`frontend`, port 5173) proxies `/api` → `http://localhost:4000`.

## Phase 0 endpoints

| Method | Path | Auth |
|--------|------|------|
| GET | `/` | Public |
| GET | `/api/health` | Public |
| POST | `/api/auth/login` | Public |
| GET | `/api/auth/me` | Bearer JWT |
| POST | `/api/auth/logout` | Bearer JWT |

## Phase 1 endpoints (Users & Roles)

| Method | Path | Access |
|--------|------|--------|
| GET | `/api/users` | users-roles READ |
| GET | `/api/users/:id` | users-roles READ |
| POST | `/api/users` | users-roles FULL |
| PUT | `/api/users/:id` | users-roles FULL |
| PATCH | `/api/users/:id/deactivate` | users-roles FULL |
| GET | `/api/roles/modules` | users-roles READ |
| GET | `/api/roles` | users-roles READ |
| GET | `/api/roles/:code/permissions` | users-roles READ |
| PUT | `/api/roles/:code/permissions` | users-roles FULL |
| POST | `/api/roles/:code/permissions/reset` | users-roles FULL |

## Phase 2 endpoints (Coil Master)

| Method | Path | Access |
|--------|------|--------|
| GET | `/api/coils` | coil-master READ |
| GET | `/api/coils/stats` | coil-master READ |
| GET | `/api/coils/:coilNumber` | coil-master READ |
| GET | `/api/coils/:coilNumber/usage` | coil-master READ |
| GET | `/api/coils/:coilNumber/audit-logs` | coil-master READ |
| POST | `/api/coils` | coil-master WRITE |
| PUT | `/api/coils/:coilNumber` | coil-master WRITE |
| PATCH | `/api/coils/:coilNumber/archive` | coil-master FULL |
| DELETE | `/api/coils/:coilNumber` | coil-master FULL |
| POST | `/api/coils/:coilNumber/documents` | coil-master WRITE (multipart) |
| GET | `/api/coils/documents/:documentId/file` | coil-master READ |
| DELETE | `/api/coils/documents/:documentId` | coil-master WRITE |

## Phase 3 endpoints (Slitting)

| Method | Path | Access |
|--------|------|--------|
| GET | `/api/slitting` | slitting READ |
| GET | `/api/slitting/preview-ids` | slitting WRITE |
| GET | `/api/slitting/:slitCoilId` | slitting READ |
| POST | `/api/slitting/batch` | slitting WRITE |
| PUT | `/api/slitting/:slitCoilId` | slitting WRITE |

## Phase 4 endpoints (Sunrack Receipt)

| Method | Path | Access |
|--------|------|--------|
| GET | `/api/sunrack-receipts` | sunrack-receipt READ |
| GET | `/api/sunrack-receipts/stats` | sunrack-receipt READ |
| GET | `/api/sunrack-receipts/pending` | sunrack-receipt READ |
| GET | `/api/sunrack-receipts/by-slit/:slitCoilId` | sunrack-receipt READ |
| GET | `/api/sunrack-receipts/:id` | sunrack-receipt READ |
| POST | `/api/sunrack-receipts` | sunrack-receipt WRITE |
| PUT | `/api/sunrack-receipts/:id` | sunrack-receipt WRITE |
| POST | `/api/sunrack-receipts/:id/photos` | sunrack-receipt WRITE (multipart) |
| GET | `/api/sunrack-receipts/photos/:photoId/file` | sunrack-receipt READ |

## Phase 5 endpoints (Production)

| Method | Path | Access |
|--------|------|--------|
| GET | `/api/production` | production READ |
| GET | `/api/production/stats` | production READ |
| GET | `/api/production/available-slit-coils` | production READ |
| GET | `/api/production/preview-batch-number` | production WRITE |
| GET | `/api/production/slit-coil/:slitCoilId/usage` | production READ |
| GET | `/api/production/:batchNumber` | production READ |
| POST | `/api/production` | production WRITE |
| POST | `/api/production/:batchNumber/issue` | production WRITE |
| PUT | `/api/production/:batchNumber` | production WRITE |

## Phase 6 endpoints (QC Inspection)

| Method | Path | Access |
|--------|------|--------|
| GET | `/api/qc` | qc-inspection READ |
| GET | `/api/qc/stats` | qc-inspection READ |
| GET | `/api/qc/pending-batches` | qc-inspection READ |
| GET | `/api/qc/dispatch-eligible-batches` | dispatch READ |
| GET | `/api/qc/batch/:batchNumber` | qc-inspection READ |
| GET | `/api/qc/:id` | qc-inspection READ |
| POST | `/api/qc` | qc-inspection WRITE |
| PUT | `/api/qc/:id` | qc-inspection WRITE |
| POST | `/api/qc/:id/photos` | qc-inspection WRITE (multipart) |
| GET | `/api/qc/photos/:photoId/file` | qc-inspection READ |

## Phase 7 endpoints (Finished Goods)

| Method | Path | Access |
|--------|------|--------|
| GET | `/api/finished-goods` | finished-goods READ |
| GET | `/api/finished-goods/stats` | finished-goods READ |
| GET | `/api/finished-goods/:batchNumber` | finished-goods READ |

## Phase 8 endpoints (Dispatch)

| Method | Path | Access |
|--------|------|--------|
| GET | `/api/dispatch` | dispatch READ |
| GET | `/api/dispatch/stats` | dispatch READ |
| GET | `/api/dispatch/preview-dispatch-note` | dispatch WRITE |
| GET | `/api/dispatch/:dispatchNoteNumber` | dispatch READ |
| POST | `/api/dispatch` | dispatch WRITE |
| PUT | `/api/dispatch/:dispatchNoteNumber` | dispatch WRITE |

## Phase 9 endpoints (Site Installation)

| Method | Path | Access |
|--------|------|--------|
| GET | `/api/site-installation` | site-installation READ |
| GET | `/api/site-installation/stats` | site-installation READ |
| GET | `/api/site-installation/pending-dispatches` | site-installation READ |
| GET | `/api/site-installation/by-dispatch/:dispatchNoteNumber` | site-installation READ |
| GET | `/api/site-installation/:id` | site-installation READ |
| POST | `/api/site-installation` | site-installation WRITE |
| PUT | `/api/site-installation/:id` | site-installation WRITE |
| POST | `/api/site-installation/:id/photos` | site-installation WRITE (multipart) |
| GET | `/api/site-installation/photos/:photoId/file` | site-installation READ |

## Phase 10 endpoints (Complaints)

| Method | Path | Access |
|--------|------|--------|
| GET | `/api/complaints` | complaint READ |
| GET | `/api/complaints/stats` | complaint READ |
| GET | `/api/complaints/eligible-batches` | complaint READ |
| POST | `/api/complaints/resolve-trace` | complaint READ |
| GET | `/api/complaints/preview-complaint-id` | complaint WRITE |
| GET | `/api/complaints/:complaintId` | complaint READ |
| POST | `/api/complaints` | complaint WRITE |
| PUT | `/api/complaints/:complaintId` | complaint WRITE |
| POST | `/api/complaints/:complaintId/photos` | complaint WRITE (multipart) |
| GET | `/api/complaints/photos/:photoId/file` | complaint READ |

## Phase 11 endpoints (Traceability Report)

| Method | Path | Access |
|--------|------|--------|
| GET | `/api/traceability/search` | traceability READ |
| GET | `/api/traceability/timeline` | traceability READ |
| GET | `/api/traceability/export/pdf` | traceability READ |

## Phase 12 endpoints (Dashboard + Documents)

| Method | Path | Access |
|--------|------|--------|
| GET | `/api/dashboard/overview` | dashboard READ |
| GET | `/api/dashboard/audit-logs` | dashboard READ |
| GET | `/api/dashboard/notifications` | dashboard READ |
| PATCH | `/api/dashboard/notifications/read` | dashboard READ |
| PATCH | `/api/dashboard/notifications/:id/read` | dashboard READ |
| GET | `/api/documents/stats` | documents READ |
| GET | `/api/documents` | documents READ |
| GET | `/api/documents/by-reference` | documents READ |

## Prerequisites

- Go 1.22+
- PostgreSQL: `docker compose up -d` from repo root
- Database schema + seed (one-time): `npm run db:setup` from repo root (uses Prisma in `backend/`)

## Setup

```bash
cd backend-go
cp .env.example .env
go mod tidy
make sqlc   # regenerate after query changes
```

## Run

```bash
make run
# http://localhost:4000
```

From repo root:

```bash
npm run backend:dev
```

## Test

```bash
go test ./...
```

Integration tests skip automatically if Postgres is unavailable.

## Project layout

```
backend-go/
├── cmd/server/          # Entry point
├── db/schema/           # PostgreSQL DDL (from Prisma)
├── db/queries/          # sqlc SQL queries
├── internal/db/         # sqlc generated code
├── internal/config/     # Env + upload dirs
├── internal/constants/  # Modules, roles, permissions
├── internal/middleware/ # JWT auth + RBAC
├── internal/handler/    # HTTP handlers
└── internal/server/     # Echo router wiring + integration tests
```

## Legacy Node backend

The Express API in `backend/` is deprecated. Keep it only for Prisma schema management and seeds. See `backend/README.md`.
