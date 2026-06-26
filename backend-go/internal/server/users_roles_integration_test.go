package server_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/labstack/echo/v4"

	"github.com/sunrack/ctrcms-go/internal/constants"
	"github.com/sunrack/ctrcms-go/internal/server"
)

const testUserEmail = "users-roles-test@sunrack.local"

func adminToken(t *testing.T, srv *server.Server) string {
	t.Helper()
	body := bytes.NewBufferString(`{"email":"admin@sunrack.local","password":"Admin@12345"}`)
	req := httptest.NewRequest(http.MethodPost, "/api/auth/login", body)
	req.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	rec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(rec, req)
	if rec.Code != http.StatusOK {
		t.Fatalf("admin login failed: %d %s", rec.Code, rec.Body.String())
	}
	var res struct {
		Token string `json:"token"`
	}
	_ = json.Unmarshal(rec.Body.Bytes(), &res)
	return res.Token
}

func TestUsersRolesAPI(t *testing.T) {
	srv, _, cleanup := testServer(t)
	defer cleanup()
	token := adminToken(t, srv)

	usersReq := httptest.NewRequest(http.MethodGet, "/api/users", nil)
	usersReq.Header.Set("Authorization", "Bearer "+token)
	usersRec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(usersRec, usersReq)
	if usersRec.Code != http.StatusOK {
		t.Fatalf("list users: %d %s", usersRec.Code, usersRec.Body.String())
	}
	var usersBody struct {
		Users []map[string]interface{} `json:"users"`
	}
	_ = json.Unmarshal(usersRec.Body.Bytes(), &usersBody)
	if len(usersBody.Users) == 0 {
		t.Fatal("expected users")
	}

	rolesReq := httptest.NewRequest(http.MethodGet, "/api/roles", nil)
	rolesReq.Header.Set("Authorization", "Bearer "+token)
	rolesRec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(rolesRec, rolesReq)
	if rolesRec.Code != http.StatusOK {
		t.Fatalf("list roles: %d %s", rolesRec.Code, rolesRec.Body.String())
	}
	var rolesBody struct {
		Roles []map[string]interface{} `json:"roles"`
	}
	_ = json.Unmarshal(rolesRec.Body.Bytes(), &rolesBody)
	if len(rolesBody.Roles) != 8 {
		t.Fatalf("expected 8 roles, got %d", len(rolesBody.Roles))
	}

	adminPermReq := httptest.NewRequest(http.MethodGet, "/api/roles/ADMIN/permissions", nil)
	adminPermReq.Header.Set("Authorization", "Bearer "+token)
	adminPermRec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(adminPermRec, adminPermReq)
	if adminPermRec.Code != http.StatusOK {
		t.Fatalf("admin permissions: %d %s", adminPermRec.Code, adminPermRec.Body.String())
	}
	var adminPermBody struct {
		Role struct {
			Permissions map[string]string `json:"permissions"`
		} `json:"role"`
		ModulesByPhase []map[string]interface{} `json:"modulesByPhase"`
	}
	_ = json.Unmarshal(adminPermRec.Body.Bytes(), &adminPermBody)
	if len(adminPermBody.ModulesByPhase) == 0 {
		t.Fatal("expected modulesByPhase")
	}
	for _, mod := range constants.AllModules {
		if adminPermBody.Role.Permissions[string(mod)] != "FULL" {
			t.Fatalf("admin should have FULL on %s", mod)
		}
	}

	// cleanup any prior test user via deactivate if exists - create fresh
	createBody := bytes.NewBufferString(fmt.Sprintf(
		`{"email":%q,"password":"Test@12345","fullName":"Users Roles Test","roleCode":"QC"}`,
		testUserEmail,
	))
	createReq := httptest.NewRequest(http.MethodPost, "/api/users", createBody)
	createReq.Header.Set("Authorization", "Bearer "+token)
	createReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	createRec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(createRec, createReq)
	if createRec.Code != http.StatusCreated && createRec.Code != http.StatusConflict {
		t.Fatalf("create user: %d %s", createRec.Code, createRec.Body.String())
	}

	var createdID string
	if createRec.Code == http.StatusCreated {
		var createRes struct {
			User struct {
				ID   string `json:"id"`
				Role struct {
					Code string `json:"code"`
				} `json:"role"`
			} `json:"user"`
		}
		_ = json.Unmarshal(createRec.Body.Bytes(), &createRes)
		createdID = createRes.User.ID
		if createRes.User.Role.Code != "QC" {
			t.Fatalf("expected QC role, got %s", createRes.User.Role.Code)
		}
	} else {
		// find existing user id from list
		for _, u := range usersBody.Users {
			if u["email"] == testUserEmail {
				createdID, _ = u["id"].(string)
				break
			}
		}
	}

	if createdID == "" {
		t.Fatal("missing created user id")
	}

	getReq := httptest.NewRequest(http.MethodGet, "/api/users/"+createdID, nil)
	getReq.Header.Set("Authorization", "Bearer "+token)
	getRec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(getRec, getReq)
	if getRec.Code != http.StatusOK {
		t.Fatalf("get user: %d %s", getRec.Code, getRec.Body.String())
	}

	updateBody := bytes.NewBufferString(`{"fullName":"Users Roles Updated","roleCode":"PRODUCTION"}`)
	updateReq := httptest.NewRequest(http.MethodPut, "/api/users/"+createdID, updateBody)
	updateReq.Header.Set("Authorization", "Bearer "+token)
	updateReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	updateRec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(updateRec, updateReq)
	if updateRec.Code != http.StatusOK {
		t.Fatalf("update user: %d %s", updateRec.Code, updateRec.Body.String())
	}
	var updateRes struct {
		User struct {
			FullName string `json:"fullName"`
			Role     struct {
				Code string `json:"code"`
			} `json:"role"`
			IsActive bool `json:"isActive"`
		} `json:"user"`
	}
	_ = json.Unmarshal(updateRec.Body.Bytes(), &updateRes)
	if updateRes.User.FullName != "Users Roles Updated" || updateRes.User.Role.Code != "PRODUCTION" {
		t.Fatalf("unexpected update result: %+v", updateRes.User)
	}

	deactReq := httptest.NewRequest(http.MethodPatch, "/api/users/"+createdID+"/deactivate", nil)
	deactReq.Header.Set("Authorization", "Bearer "+token)
	deactRec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(deactRec, deactReq)
	if deactRec.Code != http.StatusOK {
		t.Fatalf("deactivate user: %d %s", deactRec.Code, deactRec.Body.String())
	}
	_ = json.Unmarshal(deactRec.Body.Bytes(), &updateRes)
	if updateRes.User.IsActive {
		t.Fatal("expected inactive user")
	}

	qcPermReq := httptest.NewRequest(http.MethodGet, "/api/roles/QC/permissions", nil)
	qcPermReq.Header.Set("Authorization", "Bearer "+token)
	qcPermRec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(qcPermRec, qcPermReq)
	if qcPermRec.Code != http.StatusOK {
		t.Fatalf("qc permissions: %d %s", qcPermRec.Code, qcPermRec.Body.String())
	}
	var qcPermBody struct {
		Role struct {
			Permissions map[string]string `json:"permissions"`
		} `json:"role"`
	}
	_ = json.Unmarshal(qcPermRec.Body.Bytes(), &qcPermBody)
	updated := qcPermBody.Role.Permissions
	updated[string(constants.ModuleComplaint)] = "FULL"
	savePayload, _ := json.Marshal(map[string]interface{}{"permissions": updated})
	saveReq := httptest.NewRequest(http.MethodPut, "/api/roles/QC/permissions", bytes.NewReader(savePayload))
	saveReq.Header.Set("Authorization", "Bearer "+token)
	saveReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	saveRec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(saveRec, saveReq)
	if saveRec.Code != http.StatusOK {
		t.Fatalf("save permissions: %d %s", saveRec.Code, saveRec.Body.String())
	}
	var saveRes struct {
		Role struct {
			Permissions map[string]string `json:"permissions"`
		} `json:"role"`
	}
	_ = json.Unmarshal(saveRec.Body.Bytes(), &saveRes)
	if saveRes.Role.Permissions[string(constants.ModuleComplaint)] != "FULL" {
		t.Fatal("expected FULL complaint permission")
	}

	resetReq := httptest.NewRequest(http.MethodPost, "/api/roles/QC/permissions/reset", nil)
	resetReq.Header.Set("Authorization", "Bearer "+token)
	resetRec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(resetRec, resetReq)
	if resetRec.Code != http.StatusOK {
		t.Fatalf("reset permissions: %d %s", resetRec.Code, resetRec.Body.String())
	}
	_ = json.Unmarshal(resetRec.Body.Bytes(), &saveRes)
	if saveRes.Role.Permissions[string(constants.ModuleComplaint)] != "READ" {
		t.Fatalf("expected READ complaint after reset, got %s", saveRes.Role.Permissions[string(constants.ModuleComplaint)])
	}

	adminModBody := bytes.NewBufferString(fmt.Sprintf(`{"permissions":{%q:"READ"}}`, constants.ModuleCoilMaster))
	adminModReq := httptest.NewRequest(http.MethodPut, "/api/roles/ADMIN/permissions", adminModBody)
	adminModReq.Header.Set("Authorization", "Bearer "+token)
	adminModReq.Header.Set(echo.HeaderContentType, echo.MIMEApplicationJSON)
	adminModRec := httptest.NewRecorder()
	srv.Echo.ServeHTTP(adminModRec, adminModReq)
	if adminModRec.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for admin modify, got %d", adminModRec.Code)
	}
	var errBody struct {
		Error string `json:"error"`
	}
	_ = json.Unmarshal(adminModRec.Body.Bytes(), &errBody)
	if errBody.Error == "" {
		t.Fatal("expected error message")
	}
}
