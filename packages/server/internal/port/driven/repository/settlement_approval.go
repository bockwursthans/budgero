package repository

import (
	"context"

	"budgero-server/internal/domain"
)

// SettlementApprovalRepository persists members' approvals of settlement terms.
type SettlementApprovalRepository interface {
	// List returns every approval in a space, oldest first.
	List(ctx context.Context, spaceID string) ([]domain.SettlementApproval, error)

	// CountForMember counts the approvals one member keeps in a space.
	CountForMember(ctx context.Context, spaceID, userID string) (int64, error)

	// Exists reports whether the member already approved the fingerprint.
	Exists(ctx context.Context, spaceID, userID, fingerprint string) (bool, error)

	// Create stores an approval; storing one that exists changes nothing.
	Create(ctx context.Context, approval *domain.SettlementApproval) error

	// Delete removes one approval of a member; a missing one is not an error.
	Delete(ctx context.Context, spaceID, userID, fingerprint string) error
}
