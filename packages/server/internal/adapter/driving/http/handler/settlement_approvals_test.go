package handler_test

import (
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"budgero-server/internal/domain"
	"budgero-server/internal/testkit"

	"github.com/labstack/echo/v4"
)

var testFingerprint = strings.Repeat("c", 64)

func settlementContext(e *echo.Echo, method, spaceID, body, userID string) (echo.Context, *httptest.ResponseRecorder) {
	req := httptest.NewRequest(method, "/api/v1/budget-spaces/"+spaceID+"/settlement-approvals", strings.NewReader(body))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	c := e.NewContext(req, rec)
	c.SetParamNames("spaceID")
	c.SetParamValues(spaceID)
	setUserContext(c, userID)
	return c, rec
}

func httpStatus(t *testing.T, err error) int {
	t.Helper()
	var httpErr *echo.HTTPError
	if !errors.As(err, &httpErr) {
		t.Fatalf("expected *echo.HTTPError, got %v", err)
	}
	return httpErr.Code
}

func TestSettlementApprovals_MemberApprovesForThemselves(t *testing.T) {
	h, e, tc := setupSelfHostHandler(t)
	ownerID := testkit.SeedUser(t, tc.Queries, "owner@example.com")
	memberID := testkit.SeedUser(t, tc.Queries, "member@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, ownerID, "Household")
	testkit.SeedMembership(t, tc.Queries, spaceID, memberID, domain.RoleMember)

	// A user_id in the body is ignored: the approval is always the caller's.
	body := `{"fingerprint":"` + testFingerprint + `","user_id":"` + ownerID + `"}`
	c, rec := settlementContext(e, http.MethodPost, spaceID, body, memberID)
	if err := h.ApproveSettlement(c); err != nil {
		t.Fatalf("ApproveSettlement: %v", err)
	}
	if rec.Code != http.StatusCreated {
		t.Fatalf("status = %d, want 201", rec.Code)
	}

	c, rec = settlementContext(e, http.MethodGet, spaceID, "", ownerID)
	if err := h.ListSettlementApprovals(c); err != nil {
		t.Fatalf("ListSettlementApprovals: %v", err)
	}
	var approvals []domain.SettlementApproval
	if err := json.Unmarshal(rec.Body.Bytes(), &approvals); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if len(approvals) != 1 || approvals[0].UserID != memberID || approvals[0].Fingerprint != testFingerprint {
		t.Fatalf("approvals = %+v, want the member's approval", approvals)
	}
}

func TestSettlementApprovals_OutsidersAreDenied(t *testing.T) {
	h, e, tc := setupTestHandler(t)
	ownerID := testkit.SeedUser(t, tc.Queries, "owner@example.com")
	outsiderID := testkit.SeedUser(t, tc.Queries, "outsider@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, ownerID, "Household")

	c, _ := settlementContext(e, http.MethodPost, spaceID, `{"fingerprint":"`+testFingerprint+`"}`, outsiderID)
	if code := httpStatus(t, h.ApproveSettlement(c)); code != http.StatusForbidden {
		t.Fatalf("approve status = %d, want 403", code)
	}
	c, _ = settlementContext(e, http.MethodGet, spaceID, "", outsiderID)
	if code := httpStatus(t, h.ListSettlementApprovals(c)); code != http.StatusForbidden {
		t.Fatalf("list status = %d, want 403", code)
	}
}

func TestSettlementApprovals_RejectsBadInput(t *testing.T) {
	h, e, tc := setupSelfHostHandler(t)
	ownerID := testkit.SeedUser(t, tc.Queries, "owner@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, ownerID, "Household")

	c, _ := settlementContext(e, http.MethodPost, spaceID, `{"fingerprint":"nope"}`, ownerID)
	if code := httpStatus(t, h.ApproveSettlement(c)); code != http.StatusBadRequest {
		t.Fatalf("status = %d, want 400", code)
	}
	c, _ = settlementContext(e, http.MethodPost, spaceID, `{"fingerprint":`, ownerID)
	if code := httpStatus(t, h.ApproveSettlement(c)); code != http.StatusBadRequest {
		t.Fatalf("malformed body status = %d, want 400", code)
	}
	c, _ = settlementContext(e, http.MethodPost, spaceID, `{"fingerprint":"`+testFingerprint+`"}`, "")
	if code := httpStatus(t, h.ApproveSettlement(c)); code != http.StatusUnauthorized {
		t.Fatalf("unauthenticated status = %d, want 401", code)
	}
}

func TestSettlementApprovals_RevokeRemovesOnlyOwnApproval(t *testing.T) {
	h, e, tc := setupSelfHostHandler(t)
	ownerID := testkit.SeedUser(t, tc.Queries, "owner@example.com")
	memberID := testkit.SeedUser(t, tc.Queries, "member@example.com")
	spaceID := testkit.SeedSpace(t, tc.DB, tc.Queries, ownerID, "Household")
	testkit.SeedMembership(t, tc.Queries, spaceID, memberID, domain.RoleMember)

	c, _ := settlementContext(e, http.MethodPost, spaceID, `{"fingerprint":"`+testFingerprint+`"}`, memberID)
	if err := h.ApproveSettlement(c); err != nil {
		t.Fatalf("ApproveSettlement: %v", err)
	}

	revoke := func(userID string) {
		c, rec := settlementContext(e, http.MethodDelete, spaceID, "", userID)
		c.SetParamNames("spaceID", "fingerprint")
		c.SetParamValues(spaceID, testFingerprint)
		if err := h.RevokeSettlementApproval(c); err != nil {
			t.Fatalf("RevokeSettlementApproval: %v", err)
		}
		if rec.Code != http.StatusOK {
			t.Fatalf("status = %d, want 200", rec.Code)
		}
	}
	count := func() int {
		c, rec := settlementContext(e, http.MethodGet, spaceID, "", ownerID)
		if err := h.ListSettlementApprovals(c); err != nil {
			t.Fatalf("ListSettlementApprovals: %v", err)
		}
		var approvals []domain.SettlementApproval
		_ = json.Unmarshal(rec.Body.Bytes(), &approvals)
		return len(approvals)
	}

	revoke(ownerID)
	if got := count(); got != 1 {
		t.Fatalf("after the owner's revoke: %d approvals, want 1", got)
	}
	revoke(memberID)
	if got := count(); got != 0 {
		t.Fatalf("after the member's revoke: %d approvals, want 0", got)
	}
}
