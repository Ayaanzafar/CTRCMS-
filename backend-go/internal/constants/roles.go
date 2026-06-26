package constants

type RoleCode string

const (
	RoleAdmin             RoleCode = "ADMIN"
	RolePurchaseWarehouse RoleCode = "PURCHASE_WAREHOUSE"
	RoleSlitterProcessing RoleCode = "SLITTER_PROCESSING"
	RoleProduction        RoleCode = "PRODUCTION"
	RoleQC                RoleCode = "QC"
	RoleDispatch          RoleCode = "DISPATCH"
	RoleSiteEPC           RoleCode = "SITE_EPC"
	RoleManagement        RoleCode = "MANAGEMENT"
)

type RoleDefinition struct {
	Code        RoleCode `json:"code"`
	Name        string   `json:"name"`
	Description string   `json:"description"`
}

var RoleDefinitions = []RoleDefinition{
	{RoleAdmin, "Admin", "Full access; manages users, roles, master data, and system configuration."},
	{RolePurchaseWarehouse, "Purchase / Warehouse Team", "Creates Coil Master records; uploads MTC/invoice; manages storage/inspection entries."},
	{RoleSlitterProcessing, "Slitter / Processing Team", "Records slitting events, slit coil generation, and dispatch to Sunrack."},
	{RoleProduction, "Production Team", "Records issue of slit coils to production, production orders, batch numbers, and quantities produced."},
	{RoleQC, "QC Team", "Records QC inspection results, remarks, and photos; approves/rejects batches."},
	{RoleDispatch, "Dispatch Team", "Creates dispatch records to project sites; manages vehicle/transporter details."},
	{RoleSiteEPC, "Site Team / EPC Coordinator", "Confirms site receipt and installation details; uploads installation photos."},
	{RoleManagement, "Management", "Read-only access to all modules; views dashboards, traceability reports, and complaint analytics."},
}

type PermissionMap map[ModuleCode]ModuleAccess

func nonePermissions() PermissionMap {
	m := make(PermissionMap, len(AllModules))
	for _, mod := range AllModules {
		m[mod] = AccessNone
	}
	return m
}

func fullPermissions() PermissionMap {
	m := make(PermissionMap, len(AllModules))
	for _, mod := range AllModules {
		m[mod] = AccessFull
	}
	return m
}

func readAllPermissions() PermissionMap {
	m := make(PermissionMap, len(AllModules))
	for _, mod := range AllModules {
		m[mod] = AccessRead
	}
	return m
}

func mergePermissions(base PermissionMap, overrides map[ModuleCode]ModuleAccess) PermissionMap {
	out := make(PermissionMap, len(base))
	for k, v := range base {
		out[k] = v
	}
	for k, v := range overrides {
		out[k] = v
	}
	return out
}

var DefaultRolePermissions = map[RoleCode]PermissionMap{
	RoleAdmin: fullPermissions(),
	RolePurchaseWarehouse: mergePermissions(nonePermissions(), map[ModuleCode]ModuleAccess{
		ModuleCoilMaster:     AccessWrite,
		ModuleSlitting:       AccessRead,
		ModuleSunrackReceipt: AccessWrite,
		ModuleDocuments:      AccessWrite,
		ModuleTraceability:   AccessRead,
		ModuleComplaint:      AccessRead,
	}),
	RoleSlitterProcessing: mergePermissions(nonePermissions(), map[ModuleCode]ModuleAccess{
		ModuleCoilMaster:   AccessRead,
		ModuleSlitting:     AccessWrite,
		ModuleDocuments:    AccessWrite,
		ModuleTraceability: AccessRead,
		ModuleComplaint:    AccessRead,
	}),
	RoleProduction: mergePermissions(nonePermissions(), map[ModuleCode]ModuleAccess{
		ModuleSlitting:       AccessRead,
		ModuleSunrackReceipt: AccessRead,
		ModuleProduction:     AccessWrite,
		ModuleFinishedGoods:  AccessWrite,
		ModuleDocuments:      AccessWrite,
		ModuleTraceability:   AccessRead,
		ModuleComplaint:      AccessRead,
	}),
	RoleQC: mergePermissions(nonePermissions(), map[ModuleCode]ModuleAccess{
		ModuleProduction:    AccessRead,
		ModuleFinishedGoods: AccessRead,
		ModuleQCInspection:  AccessWrite,
		ModuleDocuments:     AccessWrite,
		ModuleTraceability:  AccessRead,
		ModuleComplaint:     AccessRead,
	}),
	RoleDispatch: mergePermissions(nonePermissions(), map[ModuleCode]ModuleAccess{
		ModuleFinishedGoods: AccessRead,
		ModuleQCInspection:  AccessRead,
		ModuleDispatch:      AccessWrite,
		ModuleDocuments:     AccessWrite,
		ModuleTraceability:  AccessRead,
		ModuleComplaint:     AccessRead,
	}),
	RoleSiteEPC: mergePermissions(nonePermissions(), map[ModuleCode]ModuleAccess{
		ModuleDispatch:         AccessRead,
		ModuleSiteInstallation: AccessWrite,
		ModuleDocuments:        AccessWrite,
		ModuleTraceability:     AccessRead,
		ModuleComplaint:        AccessWrite,
	}),
	RoleManagement: mergePermissions(readAllPermissions(), map[ModuleCode]ModuleAccess{
		ModuleUsersRoles: AccessNone,
		ModuleDashboard:  AccessRead,
	}),
}
