-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ModuleAccess" AS ENUM ('NONE', 'READ', 'WRITE', 'FULL');

-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('COMPLAINT_CREATED', 'QC_FAILED');

-- CreateEnum
CREATE TYPE "CoilDocumentType" AS ENUM ('MTC', 'INVOICE', 'OTHER');

-- CreateEnum
CREATE TYPE "CoilStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InspectionResult" AS ENUM ('PENDING', 'PASS', 'CONDITIONAL', 'FAIL');

-- CreateEnum
CREATE TYPE "QcResult" AS ENUM ('PASS', 'FAIL', 'REWORK');

-- CreateEnum
CREATE TYPE "ResolutionStatus" AS ENUM ('OPEN', 'UNDER_INVESTIGATION', 'CLOSED');

-- CreateEnum
CREATE TYPE "ResponsibleStage" AS ENUM ('AMNS', 'SLITTER', 'SUNRACK_PRODUCTION', 'TRANSPORT', 'SITE_HANDLING');

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "roleId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RoleModulePermission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "access" "ModuleAccess" NOT NULL DEFAULT 'NONE',

    CONSTRAINT "RoleModulePermission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "oldValues" JSONB,
    "newValues" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemNotification" (
    "id" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "isRead" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemNotification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coil" (
    "coilNumber" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "coating" TEXT NOT NULL,
    "size" TEXT NOT NULL,
    "weight" DECIMAL(10,3) NOT NULL,
    "supplier" TEXT NOT NULL DEFAULT 'AMNS (Hazira Plant)',
    "mtcNumber" TEXT,
    "invoiceNumber" TEXT,
    "amnsDispatchDate" TIMESTAMP(3),
    "vehicleNumber" TEXT,
    "transporterName" TEXT,
    "receiptDateSlitter" TIMESTAMP(3),
    "receivingConditionRemarks" TEXT,
    "status" "CoilStatus" NOT NULL DEFAULT 'ACTIVE',
    "archivedAt" TIMESTAMP(3),
    "archivedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coil_pkey" PRIMARY KEY ("coilNumber")
);

-- CreateTable
CREATE TABLE "CoilDocument" (
    "id" TEXT NOT NULL,
    "coilNumber" TEXT NOT NULL,
    "documentType" "CoilDocumentType" NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CoilDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SlittingRecord" (
    "slitCoilId" TEXT NOT NULL,
    "parentCoilNumber" TEXT NOT NULL,
    "slitWidthSize" TEXT NOT NULL,
    "slittingDate" TIMESTAMP(3) NOT NULL,
    "slitCoilWeight" DECIMAL(10,3) NOT NULL,
    "slitterLocation" TEXT NOT NULL DEFAULT 'Shiv Sagar Slitter',
    "dispatchNote" TEXT,
    "vehicleNumber" TEXT,
    "transporterName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SlittingRecord_pkey" PRIMARY KEY ("slitCoilId")
);

-- CreateTable
CREATE TABLE "SunrackReceipt" (
    "id" TEXT NOT NULL,
    "slitCoilId" TEXT NOT NULL,
    "receiptDateSunrack" TIMESTAMP(3) NOT NULL,
    "storageLocationBin" TEXT NOT NULL,
    "inspectionResult" "InspectionResult" NOT NULL DEFAULT 'PENDING',
    "inspectionRemarks" TEXT,
    "confirmedDispatchNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SunrackReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SunrackReceiptPhoto" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SunrackReceiptPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProductionBatch" (
    "batchNumber" TEXT NOT NULL,
    "productionOrderNumber" TEXT NOT NULL,
    "productType" TEXT NOT NULL,
    "quantityProduced" DECIMAL(10,3) NOT NULL,
    "productionDate" TIMESTAMP(3) NOT NULL,
    "operatorShift" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductionBatch_pkey" PRIMARY KEY ("batchNumber")
);

-- CreateTable
CREATE TABLE "BatchSlitCoilMap" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "slitCoilId" TEXT NOT NULL,
    "quantityConsumed" DECIMAL(10,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchSlitCoilMap_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QCInspection" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "qcResult" "QcResult" NOT NULL,
    "inspectorName" TEXT NOT NULL,
    "inspectionDate" TIMESTAMP(3) NOT NULL,
    "qcRemarks" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "QCInspection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QCInspectionPhoto" (
    "id" TEXT NOT NULL,
    "inspectionId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QCInspectionPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteDispatch" (
    "dispatchNoteNumber" TEXT NOT NULL,
    "dispatchDate" TIMESTAMP(3) NOT NULL,
    "vehicleNumber" TEXT,
    "transporterName" TEXT,
    "projectName" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "siteLocation" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteDispatch_pkey" PRIMARY KEY ("dispatchNoteNumber")
);

-- CreateTable
CREATE TABLE "DispatchBatchLine" (
    "id" TEXT NOT NULL,
    "dispatchNoteNumber" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "quantityDispatched" DECIMAL(10,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DispatchBatchLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteInstallation" (
    "id" TEXT NOT NULL,
    "dispatchNoteNumber" TEXT NOT NULL,
    "siteReceiptDate" TIMESTAMP(3) NOT NULL,
    "installationDate" TIMESTAMP(3) NOT NULL,
    "installerEpcPartner" TEXT NOT NULL,
    "quantityInstalled" DECIMAL(10,3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SiteInstallation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SiteInstallationPhoto" (
    "id" TEXT NOT NULL,
    "installationId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SiteInstallationPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Complaint" (
    "complaintId" TEXT NOT NULL,
    "complaintDate" TIMESTAMP(3) NOT NULL,
    "projectName" TEXT NOT NULL,
    "clientName" TEXT NOT NULL,
    "siteLocation" TEXT NOT NULL,
    "complaintDescription" TEXT NOT NULL,
    "rootCauseRemarks" TEXT,
    "resolutionStatus" "ResolutionStatus" NOT NULL DEFAULT 'OPEN',
    "resolutionDate" TIMESTAMP(3),
    "responsibleStage" "ResponsibleStage",
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Complaint_pkey" PRIMARY KEY ("complaintId")
);

-- CreateTable
CREATE TABLE "ComplaintBatchLine" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintBatchLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ComplaintPhoto" (
    "id" TEXT NOT NULL,
    "complaintId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimetype" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ComplaintPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_code_key" ON "Role"("code");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_roleId_idx" ON "User"("roleId");

-- CreateIndex
CREATE INDEX "RoleModulePermission_module_idx" ON "RoleModulePermission"("module");

-- CreateIndex
CREATE UNIQUE INDEX "RoleModulePermission_roleId_module_key" ON "RoleModulePermission"("roleId", "module");

-- CreateIndex
CREATE INDEX "AuditLog_userId_idx" ON "AuditLog"("userId");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "SystemNotification_createdAt_idx" ON "SystemNotification"("createdAt");

-- CreateIndex
CREATE INDEX "SystemNotification_isRead_idx" ON "SystemNotification"("isRead");

-- CreateIndex
CREATE INDEX "Coil_grade_idx" ON "Coil"("grade");

-- CreateIndex
CREATE INDEX "Coil_supplier_idx" ON "Coil"("supplier");

-- CreateIndex
CREATE INDEX "Coil_amnsDispatchDate_idx" ON "Coil"("amnsDispatchDate");

-- CreateIndex
CREATE INDEX "Coil_createdAt_idx" ON "Coil"("createdAt");

-- CreateIndex
CREATE INDEX "Coil_status_idx" ON "Coil"("status");

-- CreateIndex
CREATE INDEX "CoilDocument_coilNumber_idx" ON "CoilDocument"("coilNumber");

-- CreateIndex
CREATE INDEX "CoilDocument_documentType_idx" ON "CoilDocument"("documentType");

-- CreateIndex
CREATE INDEX "SlittingRecord_parentCoilNumber_idx" ON "SlittingRecord"("parentCoilNumber");

-- CreateIndex
CREATE INDEX "SlittingRecord_slittingDate_idx" ON "SlittingRecord"("slittingDate");

-- CreateIndex
CREATE INDEX "SlittingRecord_dispatchNote_idx" ON "SlittingRecord"("dispatchNote");

-- CreateIndex
CREATE UNIQUE INDEX "SunrackReceipt_slitCoilId_key" ON "SunrackReceipt"("slitCoilId");

-- CreateIndex
CREATE INDEX "SunrackReceipt_receiptDateSunrack_idx" ON "SunrackReceipt"("receiptDateSunrack");

-- CreateIndex
CREATE INDEX "SunrackReceipt_storageLocationBin_idx" ON "SunrackReceipt"("storageLocationBin");

-- CreateIndex
CREATE INDEX "SunrackReceipt_inspectionResult_idx" ON "SunrackReceipt"("inspectionResult");

-- CreateIndex
CREATE INDEX "SunrackReceiptPhoto_receiptId_idx" ON "SunrackReceiptPhoto"("receiptId");

-- CreateIndex
CREATE INDEX "ProductionBatch_productionOrderNumber_idx" ON "ProductionBatch"("productionOrderNumber");

-- CreateIndex
CREATE INDEX "ProductionBatch_productType_idx" ON "ProductionBatch"("productType");

-- CreateIndex
CREATE INDEX "ProductionBatch_productionDate_idx" ON "ProductionBatch"("productionDate");

-- CreateIndex
CREATE INDEX "BatchSlitCoilMap_slitCoilId_idx" ON "BatchSlitCoilMap"("slitCoilId");

-- CreateIndex
CREATE INDEX "BatchSlitCoilMap_batchNumber_idx" ON "BatchSlitCoilMap"("batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "BatchSlitCoilMap_batchNumber_slitCoilId_key" ON "BatchSlitCoilMap"("batchNumber", "slitCoilId");

-- CreateIndex
CREATE INDEX "QCInspection_batchNumber_idx" ON "QCInspection"("batchNumber");

-- CreateIndex
CREATE INDEX "QCInspection_inspectionDate_idx" ON "QCInspection"("inspectionDate");

-- CreateIndex
CREATE INDEX "QCInspection_qcResult_idx" ON "QCInspection"("qcResult");

-- CreateIndex
CREATE INDEX "QCInspectionPhoto_inspectionId_idx" ON "QCInspectionPhoto"("inspectionId");

-- CreateIndex
CREATE INDEX "SiteDispatch_dispatchDate_idx" ON "SiteDispatch"("dispatchDate");

-- CreateIndex
CREATE INDEX "SiteDispatch_projectName_idx" ON "SiteDispatch"("projectName");

-- CreateIndex
CREATE INDEX "SiteDispatch_clientName_idx" ON "SiteDispatch"("clientName");

-- CreateIndex
CREATE INDEX "DispatchBatchLine_batchNumber_idx" ON "DispatchBatchLine"("batchNumber");

-- CreateIndex
CREATE INDEX "DispatchBatchLine_dispatchNoteNumber_idx" ON "DispatchBatchLine"("dispatchNoteNumber");

-- CreateIndex
CREATE UNIQUE INDEX "DispatchBatchLine_dispatchNoteNumber_batchNumber_key" ON "DispatchBatchLine"("dispatchNoteNumber", "batchNumber");

-- CreateIndex
CREATE UNIQUE INDEX "SiteInstallation_dispatchNoteNumber_key" ON "SiteInstallation"("dispatchNoteNumber");

-- CreateIndex
CREATE INDEX "SiteInstallation_siteReceiptDate_idx" ON "SiteInstallation"("siteReceiptDate");

-- CreateIndex
CREATE INDEX "SiteInstallation_installationDate_idx" ON "SiteInstallation"("installationDate");

-- CreateIndex
CREATE INDEX "SiteInstallationPhoto_installationId_idx" ON "SiteInstallationPhoto"("installationId");

-- CreateIndex
CREATE INDEX "Complaint_complaintDate_idx" ON "Complaint"("complaintDate");

-- CreateIndex
CREATE INDEX "Complaint_resolutionStatus_idx" ON "Complaint"("resolutionStatus");

-- CreateIndex
CREATE INDEX "Complaint_projectName_idx" ON "Complaint"("projectName");

-- CreateIndex
CREATE INDEX "ComplaintBatchLine_batchNumber_idx" ON "ComplaintBatchLine"("batchNumber");

-- CreateIndex
CREATE INDEX "ComplaintBatchLine_complaintId_idx" ON "ComplaintBatchLine"("complaintId");

-- CreateIndex
CREATE UNIQUE INDEX "ComplaintBatchLine_complaintId_batchNumber_key" ON "ComplaintBatchLine"("complaintId", "batchNumber");

-- CreateIndex
CREATE INDEX "ComplaintPhoto_complaintId_idx" ON "ComplaintPhoto"("complaintId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoleModulePermission" ADD CONSTRAINT "RoleModulePermission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CoilDocument" ADD CONSTRAINT "CoilDocument_coilNumber_fkey" FOREIGN KEY ("coilNumber") REFERENCES "Coil"("coilNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SlittingRecord" ADD CONSTRAINT "SlittingRecord_parentCoilNumber_fkey" FOREIGN KEY ("parentCoilNumber") REFERENCES "Coil"("coilNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SunrackReceipt" ADD CONSTRAINT "SunrackReceipt_slitCoilId_fkey" FOREIGN KEY ("slitCoilId") REFERENCES "SlittingRecord"("slitCoilId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SunrackReceiptPhoto" ADD CONSTRAINT "SunrackReceiptPhoto_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "SunrackReceipt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchSlitCoilMap" ADD CONSTRAINT "BatchSlitCoilMap_batchNumber_fkey" FOREIGN KEY ("batchNumber") REFERENCES "ProductionBatch"("batchNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchSlitCoilMap" ADD CONSTRAINT "BatchSlitCoilMap_slitCoilId_fkey" FOREIGN KEY ("slitCoilId") REFERENCES "SlittingRecord"("slitCoilId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QCInspection" ADD CONSTRAINT "QCInspection_batchNumber_fkey" FOREIGN KEY ("batchNumber") REFERENCES "ProductionBatch"("batchNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QCInspectionPhoto" ADD CONSTRAINT "QCInspectionPhoto_inspectionId_fkey" FOREIGN KEY ("inspectionId") REFERENCES "QCInspection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchBatchLine" ADD CONSTRAINT "DispatchBatchLine_dispatchNoteNumber_fkey" FOREIGN KEY ("dispatchNoteNumber") REFERENCES "SiteDispatch"("dispatchNoteNumber") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DispatchBatchLine" ADD CONSTRAINT "DispatchBatchLine_batchNumber_fkey" FOREIGN KEY ("batchNumber") REFERENCES "ProductionBatch"("batchNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteInstallation" ADD CONSTRAINT "SiteInstallation_dispatchNoteNumber_fkey" FOREIGN KEY ("dispatchNoteNumber") REFERENCES "SiteDispatch"("dispatchNoteNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SiteInstallationPhoto" ADD CONSTRAINT "SiteInstallationPhoto_installationId_fkey" FOREIGN KEY ("installationId") REFERENCES "SiteInstallation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintBatchLine" ADD CONSTRAINT "ComplaintBatchLine_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("complaintId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintBatchLine" ADD CONSTRAINT "ComplaintBatchLine_batchNumber_fkey" FOREIGN KEY ("batchNumber") REFERENCES "ProductionBatch"("batchNumber") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ComplaintPhoto" ADD CONSTRAINT "ComplaintPhoto_complaintId_fkey" FOREIGN KEY ("complaintId") REFERENCES "Complaint"("complaintId") ON DELETE CASCADE ON UPDATE CASCADE;

