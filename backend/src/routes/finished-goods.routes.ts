import { Router } from "express";
import { authenticate } from "../middleware/auth.js";
import { requireModuleAccess } from "../middleware/rbac.js";
import { MODULES } from "../constants/modules.js";
import {
  listFinishedGoodsInventory,
  getFinishedGoodsStats,
  getFinishedGoodsItem,
} from "../controllers/finished-goods.controller.js";

export const finishedGoodsRouter = Router();

finishedGoodsRouter.use(authenticate);

finishedGoodsRouter.get(
  "/stats",
  requireModuleAccess(MODULES.FINISHED_GOODS, "READ"),
  getFinishedGoodsStats
);
finishedGoodsRouter.get(
  "/",
  requireModuleAccess(MODULES.FINISHED_GOODS, "READ"),
  listFinishedGoodsInventory
);
finishedGoodsRouter.get(
  "/:batchNumber",
  requireModuleAccess(MODULES.FINISHED_GOODS, "READ"),
  getFinishedGoodsItem
);
