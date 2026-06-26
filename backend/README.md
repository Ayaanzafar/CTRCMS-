# CTRCMS Node backend (legacy)

**Deprecated.** The primary API is now the Go backend in [`backend-go`](../backend-go) on port **4000**.

This package is retained for:

- **Prisma schema** and `prisma db push` / migrations
- **Database seed** (`npm run db:seed`)
- **Legacy reference** during migration review

Do not run `npm run dev` for normal development. Use from repo root:

```bash
npm run backend:dev    # Go API
npm run frontend:dev   # Vite on :5173
```

One-time database setup:

```bash
npm run db:setup
```
