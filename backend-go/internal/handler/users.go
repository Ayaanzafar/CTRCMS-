package handler

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/mail"
	"strings"

	"github.com/google/uuid"
	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/labstack/echo/v4"
	"golang.org/x/crypto/bcrypt"

	"github.com/sunrack/ctrcms-go/internal/constants"
	"github.com/sunrack/ctrcms-go/internal/db"
	"github.com/sunrack/ctrcms-go/internal/middleware"
)

type UsersHandler struct {
	Queries *db.Queries
	Pool    *pgxpool.Pool
}

type createUserRequest struct {
	Email    string `json:"email"`
	Password string `json:"password"`
	FullName string `json:"fullName"`
	RoleCode string `json:"roleCode"`
}

type updateUserRequest struct {
	Email    *string `json:"email"`
	Password *string `json:"password"`
	FullName *string `json:"fullName"`
	RoleCode *string `json:"roleCode"`
	IsActive *bool   `json:"isActive"`
}

func (h *UsersHandler) List(c echo.Context) error {
	users, err := h.Queries.ListUsers(c.Request().Context())
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to list users"})
	}
	out := make([]map[string]interface{}, 0, len(users))
	for _, u := range users {
		out = append(out, userRowJSON(u.ID, u.Email, u.FullName, u.IsActive, u.CreatedAt, u.RoleCode, u.RoleName))
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"users": out})
}

func (h *UsersHandler) Get(c echo.Context) error {
	id := c.Param("id")
	user, err := h.Queries.GetUserPublicByID(c.Request().Context(), id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load user"})
	}
	return c.JSON(http.StatusOK, map[string]interface{}{"user": userRowJSON(user.ID, user.Email, user.FullName, user.IsActive, user.CreatedAt, user.RoleCode, user.RoleName)})
}

func (h *UsersHandler) Create(c echo.Context) error {
	var req createUserRequest
	if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}
	if !isValidEmail(req.Email) || len(req.Password) < 8 || len(req.FullName) < 2 || req.RoleCode == "" {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid user data"})
	}

	ctx := c.Request().Context()
	role, err := h.Queries.GetRoleByCode(ctx, req.RoleCode)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Unknown role: " + req.RoleCode})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to resolve role"})
	}

	if _, err := h.Queries.GetUserByEmail(ctx, strings.TrimSpace(req.Email)); err == nil {
		return c.JSON(http.StatusConflict, map[string]string{"error": "Email already registered"})
	} else if !errors.Is(err, pgx.ErrNoRows) {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to check email"})
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), 12)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to hash password"})
	}

	userID := uuid.New().String()
	created, err := h.Queries.CreateUser(ctx, db.CreateUserParams{
		ID:           userID,
		Email:        strings.TrimSpace(req.Email),
		PasswordHash: string(hash),
		FullName:     req.FullName,
		RoleID:       role.ID,
	})
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to create user"})
	}

	roleRow, _ := h.Queries.GetRoleByCode(ctx, req.RoleCode)
	if authUser, ok := middleware.GetUser(c); ok {
		newValues, _ := json.Marshal(map[string]string{
			"email":    created.Email,
			"roleCode": roleRow.Code,
		})
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     authUser.ID,
			Action:     "CREATE",
			EntityType: textPtr("User"),
			EntityID:   textPtr(created.ID),
			NewValues:  newValues,
		})
	}

	public, err := h.Queries.GetUserPublicByID(ctx, created.ID)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load created user"})
	}

	return c.JSON(http.StatusCreated, map[string]interface{}{
		"user": userRowJSON(public.ID, public.Email, public.FullName, public.IsActive, public.CreatedAt, public.RoleCode, public.RoleName),
	})
}

func (h *UsersHandler) Update(c echo.Context) error {
	return h.updateUser(c, nil)
}

func (h *UsersHandler) Deactivate(c echo.Context) error {
	falseVal := false
	return h.updateUser(c, &falseVal)
}

func (h *UsersHandler) updateUser(c echo.Context, forceInactive *bool) error {
	id := c.Param("id")
	var req updateUserRequest
	if forceInactive != nil {
		req.IsActive = forceInactive
	} else if err := c.Bind(&req); err != nil {
		return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid request body"})
	}

	ctx := c.Request().Context()
	existing, err := h.Queries.GetUserWithRoleByID(ctx, id)
	if err != nil {
		if errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusNotFound, map[string]string{"error": "User not found"})
		}
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load user"})
	}

	authUser, _ := middleware.GetUser(c)
	if req.IsActive != nil && !*req.IsActive {
		if authUser.ID == existing.ID {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "You cannot deactivate your own account"})
		}
		if existing.RoleCode == string(constants.RoleAdmin) {
			count, err := h.Queries.CountActiveAdminsExcept(ctx, existing.ID)
			if err != nil {
				return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to validate admin count"})
			}
			if count == 0 {
				return c.JSON(http.StatusBadRequest, map[string]string{"error": "Cannot deactivate the last active admin"})
			}
		}
	}

	var roleID pgtype.Text
	if req.RoleCode != nil && *req.RoleCode != "" {
		role, err := h.Queries.GetRoleByCode(ctx, *req.RoleCode)
		if err != nil {
			if errors.Is(err, pgx.ErrNoRows) {
				return c.JSON(http.StatusBadRequest, map[string]string{"error": "Unknown role: " + *req.RoleCode})
			}
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to resolve role"})
		}
		roleID = textPtr(role.ID)
	}

	if req.Email != nil && *req.Email != "" {
		if !isValidEmail(*req.Email) {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid email"})
		}
		if _, err := h.Queries.FindUserIDByEmailExcluding(ctx, db.FindUserIDByEmailExcludingParams{
			Email:     *req.Email,
			ExcludeID: id,
		}); err == nil {
			return c.JSON(http.StatusConflict, map[string]string{"error": "Email already registered"})
		} else if !errors.Is(err, pgx.ErrNoRows) {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to check email"})
		}
	}

	params := db.UpdateUserParams{ID: id}
	if req.Email != nil && *req.Email != "" {
		params.Email = optionalEmail(strings.ToLower(strings.TrimSpace(*req.Email)))
	}
	if req.FullName != nil && *req.FullName != "" {
		if len(*req.FullName) < 2 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Invalid full name"})
		}
		params.FullName = optionalText(*req.FullName)
	}
	if req.IsActive != nil {
		params.IsActive = optionalBoolPtr(req.IsActive)
	}
	if roleID.Valid {
		params.RoleID = roleID
	}
	if req.Password != nil && *req.Password != "" {
		if len(*req.Password) < 8 {
			return c.JSON(http.StatusBadRequest, map[string]string{"error": "Password must be at least 8 characters"})
		}
		hash, err := bcrypt.GenerateFromPassword([]byte(*req.Password), 12)
		if err != nil {
			return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to hash password"})
		}
		params.PasswordHash = optionalText(string(hash))
	}

	if _, err := h.Queries.UpdateUser(ctx, params); err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to update user"})
	}

	public, err := h.Queries.GetUserPublicByID(ctx, id)
	if err != nil {
		return c.JSON(http.StatusInternalServerError, map[string]string{"error": "Failed to load updated user"})
	}

	if authUser, ok := middleware.GetUser(c); ok {
		oldValues, _ := json.Marshal(map[string]interface{}{
			"email":    existing.Email,
			"fullName": existing.FullName,
			"isActive": existing.IsActive,
			"roleCode": existing.RoleCode,
		})
		newValues, _ := json.Marshal(map[string]interface{}{
			"email":    public.Email,
			"fullName": public.FullName,
			"isActive": public.IsActive,
			"roleCode": public.RoleCode,
		})
		_, _ = h.Queries.CreateAuditLogWithValues(ctx, db.CreateAuditLogWithValuesParams{
			ID:         uuid.New().String(),
			UserID:     authUser.ID,
			Action:     "UPDATE",
			EntityType: textPtr("User"),
			EntityID:   textPtr(public.ID),
			OldValues:  oldValues,
			NewValues:  newValues,
		})
	}

	return c.JSON(http.StatusOK, map[string]interface{}{
		"user": userRowJSON(public.ID, public.Email, public.FullName, public.IsActive, public.CreatedAt, public.RoleCode, public.RoleName),
	})
}

func userRowJSON(id, email, fullName string, isActive bool, createdAt pgtype.Timestamp, roleCode, roleName string) map[string]interface{} {
	return map[string]interface{}{
		"id":        id,
		"email":     email,
		"fullName":  fullName,
		"isActive":  isActive,
		"createdAt": formatTimestamp(createdAt),
		"role": map[string]string{
			"code": roleCode,
			"name": roleName,
		},
	}
}

func isValidEmail(email string) bool {
	_, err := mail.ParseAddress(strings.TrimSpace(email))
	return err == nil
}
