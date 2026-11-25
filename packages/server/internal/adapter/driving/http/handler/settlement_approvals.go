package handler

import (
	"net/http"

	"budgero-server/internal/adapter/driving/http/middleware"

	"github.com/labstack/echo/v4"
)

// Path parameters of the settlement approval routes.
const (
	spaceIDParam     = "spaceID"
	fingerprintParam = "fingerprint"
)

// Only the fingerprint comes from the client: the approving member is always
// the authenticated caller.
type settlementApprovalRequest struct {
	Fingerprint string `json:"fingerprint"`
}

// ListSettlementApprovals returns every settlement approval in the space.
func (h *Handlers) ListSettlementApprovals(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	spaceID := c.Param(spaceIDParam)
	if spaceID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "space id is required")
	}

	approvals, err := h.services.SettlementApproval.List(c.Request().Context(), userID, spaceID)
	if err != nil {
		return mapServiceError(err)
	}
	return c.JSON(http.StatusOK, approvals)
}

// ApproveSettlement records the caller's approval of a settlement fingerprint.
func (h *Handlers) ApproveSettlement(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	spaceID := c.Param(spaceIDParam)
	if spaceID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "space id is required")
	}
	var req settlementApprovalRequest
	if err := c.Bind(&req); err != nil {
		return echo.NewHTTPError(http.StatusBadRequest, "invalid request body")
	}

	approval, err := h.services.SettlementApproval.Approve(c.Request().Context(), userID, spaceID, req.Fingerprint)
	if err != nil {
		return mapServiceError(err)
	}
	return c.JSON(http.StatusCreated, approval)
}

// RevokeSettlementApproval removes the caller's approval of a settlement fingerprint.
func (h *Handlers) RevokeSettlementApproval(c echo.Context) error {
	userID := middleware.GetUserIDFromContext(c)
	if userID == "" {
		return echo.NewHTTPError(http.StatusUnauthorized, "user not authenticated")
	}
	spaceID := c.Param(spaceIDParam)
	if spaceID == "" {
		return echo.NewHTTPError(http.StatusBadRequest, "space id is required")
	}

	err := h.services.SettlementApproval.Revoke(c.Request().Context(), userID, spaceID, c.Param(fingerprintParam))
	if err != nil {
		return mapServiceError(err)
	}
	return c.JSON(http.StatusOK, map[string]any{"success": true})
}
