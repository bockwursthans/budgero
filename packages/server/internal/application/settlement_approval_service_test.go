package application_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"budgero-server/internal/adapter/driven/fake"
	"budgero-server/internal/application"
	"budgero-server/internal/domain"
)

const (
	approvalSpace   = "space1"
	approvalOwner   = "owner1"
	approvalMember  = "member1"
	approvalPending = "pending1"
	approvalOutside = "outsider"
)

var (
	fingerprintA = strings.Repeat("a", 64)
	fingerprintB = strings.Repeat("b", 64)
)

func newApprovalService(ctx context.Context, t *testing.T) (*application.SettlementApprovalService, *fake.SettlementApprovalRepository) {
	t.Helper()
	spaces := fake.NewSpaceRepository()
	_ = spaces.Create(ctx, &domain.Space{SpaceID: approvalSpace, OwnerUserID: approvalOwner})
	_ = spaces.CreateMember(ctx, &domain.SpaceMember{SpaceID: approvalSpace, UserID: approvalOwner, InvitationStatus: domain.InvitationAccepted, Role: domain.RoleOwner})
	_ = spaces.CreateMember(ctx, &domain.SpaceMember{SpaceID: approvalSpace, UserID: approvalMember, InvitationStatus: domain.InvitationAccepted, Role: domain.RoleMember})
	_ = spaces.CreateMember(ctx, &domain.SpaceMember{SpaceID: approvalSpace, UserID: approvalPending, InvitationStatus: domain.InvitationPending, Role: domain.RoleMember})
	approvals := fake.NewSettlementApprovalRepository()
	return application.NewSettlementApprovalService(approvals, application.NewSpaceService(spaces)), approvals
}

func TestSettlementApprovalService_OnlyAcceptedMembers(t *testing.T) {
	ctx := context.Background()
	tests := []struct {
		name    string
		userID  string
		spaceID string
		wantErr error
	}{
		{name: "owner", userID: approvalOwner, spaceID: approvalSpace},
		{name: "member", userID: approvalMember, spaceID: approvalSpace},
		{name: "pending member", userID: approvalPending, spaceID: approvalSpace, wantErr: domain.ErrSpaceAccessDenied},
		{name: "outsider", userID: approvalOutside, spaceID: approvalSpace, wantErr: domain.ErrSpaceAccessDenied},
		{name: "no space id", userID: approvalOwner, spaceID: "", wantErr: domain.ErrSpaceAccessDenied},
		{name: "no user", userID: "", spaceID: approvalSpace, wantErr: domain.ErrSpaceAccessDenied},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			svc, _ := newApprovalService(ctx, t)

			_, approveErr := svc.Approve(ctx, tt.userID, tt.spaceID, fingerprintA)
			_, listErr := svc.List(ctx, tt.userID, tt.spaceID)
			revokeErr := svc.Revoke(ctx, tt.userID, tt.spaceID, fingerprintA)

			for _, err := range []error{approveErr, listErr, revokeErr} {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("err = %v, want %v", err, tt.wantErr)
				}
			}
		})
	}
}

func TestSettlementApprovalService_RecordsTheCallerOnly(t *testing.T) {
	ctx := context.Background()
	svc, _ := newApprovalService(ctx, t)

	approval, err := svc.Approve(ctx, approvalMember, approvalSpace, fingerprintA)
	if err != nil {
		t.Fatalf("Approve: %v", err)
	}
	if approval.UserID != approvalMember || approval.SpaceID != approvalSpace {
		t.Fatalf("approval = %+v, want the caller in the space", approval)
	}

	// The owner revoking the same fingerprint removes only their own approval (none).
	if err = svc.Revoke(ctx, approvalOwner, approvalSpace, fingerprintA); err != nil {
		t.Fatalf("Revoke by owner: %v", err)
	}
	approvals, err := svc.List(ctx, approvalOwner, approvalSpace)
	if err != nil {
		t.Fatalf("List: %v", err)
	}
	if len(approvals) != 1 || approvals[0].UserID != approvalMember {
		t.Fatalf("approvals = %+v, want the member's approval to stay", approvals)
	}

	if err := svc.Revoke(ctx, approvalMember, approvalSpace, fingerprintA); err != nil {
		t.Fatalf("Revoke by member: %v", err)
	}
	approvals, _ = svc.List(ctx, approvalMember, approvalSpace)
	if len(approvals) != 0 {
		t.Fatalf("approvals = %+v, want none after revoking", approvals)
	}
}

func TestSettlementApprovalService_IsIdempotent(t *testing.T) {
	ctx := context.Background()
	svc, _ := newApprovalService(ctx, t)

	for range 2 {
		if _, err := svc.Approve(ctx, approvalOwner, approvalSpace, fingerprintA); err != nil {
			t.Fatalf("Approve: %v", err)
		}
	}
	approvals, _ := svc.List(ctx, approvalOwner, approvalSpace)
	if len(approvals) != 1 {
		t.Fatalf("approvals = %d, want 1", len(approvals))
	}
	if err := svc.Revoke(ctx, approvalOwner, approvalSpace, fingerprintB); err != nil {
		t.Fatalf("Revoke of an unknown fingerprint: %v", err)
	}
}

func TestSettlementApprovalService_RejectsMalformedFingerprints(t *testing.T) {
	ctx := context.Background()
	svc, _ := newApprovalService(ctx, t)

	for _, fingerprint := range []string{"", "abc", strings.Repeat("A", 64), strings.Repeat("g", 64), strings.Repeat("a", 65)} {
		if _, err := svc.Approve(ctx, approvalOwner, approvalSpace, fingerprint); !errors.Is(err, domain.ErrInvalidSettlementFingerprint) {
			t.Fatalf("Approve(%q) err = %v, want ErrInvalidSettlementFingerprint", fingerprint, err)
		}
		if err := svc.Revoke(ctx, approvalOwner, approvalSpace, fingerprint); !errors.Is(err, domain.ErrInvalidSettlementFingerprint) {
			t.Fatalf("Revoke(%q) err = %v, want ErrInvalidSettlementFingerprint", fingerprint, err)
		}
	}
}

func TestSettlementApprovalService_CapsApprovalsPerMember(t *testing.T) {
	ctx := context.Background()
	svc, approvals := newApprovalService(ctx, t)
	for i := range domain.MaxSettlementApprovalsPerMember {
		fingerprint := strings.Repeat("0", 60) + hex4(i)
		_ = approvals.Create(ctx, &domain.SettlementApproval{SpaceID: approvalSpace, UserID: approvalOwner, Fingerprint: fingerprint})
	}

	if _, err := svc.Approve(ctx, approvalOwner, approvalSpace, fingerprintA); !errors.Is(err, domain.ErrSettlementApprovalLimitReached) {
		t.Fatalf("err = %v, want ErrSettlementApprovalLimitReached", err)
	}
	// Approving one that is already there still succeeds at the cap.
	existing := strings.Repeat("0", 60) + hex4(0)
	if _, err := svc.Approve(ctx, approvalOwner, approvalSpace, existing); err != nil {
		t.Fatalf("re-approve at the cap: %v", err)
	}
	// Other members have their own allowance.
	if _, err := svc.Approve(ctx, approvalMember, approvalSpace, fingerprintA); err != nil {
		t.Fatalf("member approve: %v", err)
	}
}

func hex4(n int) string {
	const digits = "0123456789abcdef"
	out := make([]byte, 4)
	for i := 3; i >= 0; i-- {
		out[i] = digits[n%16]
		n /= 16
	}
	return string(out)
}
