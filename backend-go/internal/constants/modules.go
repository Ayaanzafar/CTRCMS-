package constants

type ModuleAccess string

const (
	AccessNone  ModuleAccess = "NONE"
	AccessRead  ModuleAccess = "READ"
	AccessWrite ModuleAccess = "WRITE"
	AccessFull  ModuleAccess = "FULL"
)

type ModuleCode string

const (
	ModuleDashboard        ModuleCode = "dashboard"
	ModuleCoilMaster       ModuleCode = "coil-master"
	ModuleSlitting         ModuleCode = "slitting"
	ModuleSunrackReceipt   ModuleCode = "sunrack-receipt"
	ModuleProduction       ModuleCode = "production"
	ModuleFinishedGoods    ModuleCode = "finished-goods"
	ModuleQCInspection     ModuleCode = "qc-inspection"
	ModuleDispatch         ModuleCode = "dispatch"
	ModuleSiteInstallation ModuleCode = "site-installation"
	ModuleComplaint        ModuleCode = "complaint"
	ModuleTraceability     ModuleCode = "traceability"
	ModuleDocuments        ModuleCode = "documents"
	ModuleUsersRoles       ModuleCode = "users-roles"
)

var AllModules = []ModuleCode{
	ModuleDashboard,
	ModuleCoilMaster,
	ModuleSlitting,
	ModuleSunrackReceipt,
	ModuleProduction,
	ModuleFinishedGoods,
	ModuleQCInspection,
	ModuleDispatch,
	ModuleSiteInstallation,
	ModuleComplaint,
	ModuleTraceability,
	ModuleDocuments,
	ModuleUsersRoles,
}

type ModuleDefinition struct {
	Code        ModuleCode `json:"code"`
	Name        string     `json:"name"`
	Description string     `json:"description"`
	Path        string     `json:"path"`
	Phase       int        `json:"phase"`
}

var ModuleDefinitions = []ModuleDefinition{
	{ModuleDashboard, "Dashboard", "Management overview, complaint analytics, and KPIs.", "/dashboard", 10},
	{ModuleCoilMaster, "Coil Master / Inward", "Original coil details received from AMNS at the slitter.", "/coil-master", 1},
	{ModuleSlitting, "Slitting Tracking", "Parent coil to slit coil mapping, slitting date, and yield.", "/slitting", 2},
	{ModuleSunrackReceipt, "Sunrack Receipt & Storage", "Receipt, storage, and inspection of slit coils at Sunrack.", "/sunrack-receipt", 3},
	{ModuleProduction, "Production Tracking", "Issue of slit coils to production orders and batch numbers.", "/production", 4},
	{ModuleFinishedGoods, "Finished Goods", "Finished product inventory — QC-passed batches available for dispatch.", "/finished-goods", 4},
	{ModuleQCInspection, "QC Inspection", "Quality sign-off on production batches before dispatch release.", "/qc-inspection", 5},
	{ModuleDispatch, "Dispatch", "Outbound shipment of finished goods to client project sites.", "/dispatch", 6},
	{ModuleSiteInstallation, "Site Installation", "Site receipt and installation at EPC/client locations.", "/site-installation", 7},
	{ModuleComplaint, "Complaint Management", "Rust/quality complaints with auto backward traceability.", "/complaints", 8},
	{ModuleTraceability, "Traceability Report", "Chronological timeline from coil to complaint (core feature).", "/traceability", 9},
	{ModuleDocuments, "Documents & Photos", "MTC, invoices, delivery notes, QC reports, and site photos.", "/documents", 11},
	{ModuleUsersRoles, "Users & Roles", "User management, role permissions, and approvals.", "/users-roles", 12},
}

func AccessRank(a ModuleAccess) int {
	switch a {
	case AccessRead:
		return 1
	case AccessWrite:
		return 2
	case AccessFull:
		return 3
	default:
		return 0
	}
}
