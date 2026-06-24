import express from "express";
import cors from "cors";
import { env } from "./config/env.js";
import { ensureUploadDirectories } from "./config/storage.js";
import { healthRouter } from "./routes/health.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { rolesRouter } from "./routes/roles.routes.js";
import { usersRouter } from "./routes/users.routes.js";
import { uploadsRouter } from "./routes/uploads.routes.js";
import { coilsRouter } from "./routes/coils.routes.js";
import { slittingRouter } from "./routes/slitting.routes.js";
import { sunrackReceiptRouter } from "./routes/sunrack-receipt.routes.js";
import { productionRouter } from "./routes/production.routes.js";
import { qcRouter } from "./routes/qc.routes.js";
import { finishedGoodsRouter } from "./routes/finished-goods.routes.js";
import { dispatchRouter } from "./routes/dispatch.routes.js";
import { siteInstallationRouter } from "./routes/site-installation.routes.js";
import { complaintRouter } from "./routes/complaint.routes.js";
import { traceabilityRouter } from "./routes/traceability.routes.js";
import { dashboardRouter } from "./routes/dashboard.routes.js";
import { documentsRouter } from "./routes/documents.routes.js";

export function createApp() {
  const app = express();

  ensureUploadDirectories();

  app.use(
    cors({
      origin: env.CORS_ORIGIN,
      credentials: true,
    })
  );
  app.use(express.json({ limit: "2mb" }));

  app.get("/", (_req, res) => {
    res.json({
      name: "CTRCMS API",
      version: "0.1.0",
      phase: 12,
      description: "Coil Traceability & Rust Complaint Management System",
    });
  });

  app.use("/api/health", healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/roles", rolesRouter);
  app.use("/api/users", usersRouter);
  app.use("/api/uploads", uploadsRouter);
  app.use("/api/coils", coilsRouter);
  app.use("/api/slitting", slittingRouter);
  app.use("/api/sunrack-receipts", sunrackReceiptRouter);
  app.use("/api/production", productionRouter);
  app.use("/api/qc", qcRouter);
  app.use("/api/finished-goods", finishedGoodsRouter);
  app.use("/api/dispatch", dispatchRouter);
  app.use("/api/site-installation", siteInstallationRouter);
  app.use("/api/complaints", complaintRouter);
  app.use("/api/traceability", traceabilityRouter);
  app.use("/api/dashboard", dashboardRouter);
  app.use("/api/documents", documentsRouter);

  app.use(
    (
      err: Error,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction
    ) => {
      console.error(err);
      res.status(500).json({ error: "Internal server error" });
    }
  );

  return app;
}

export const app = createApp();
