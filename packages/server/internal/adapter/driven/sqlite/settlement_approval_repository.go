package sqlite

import (
	"context"
	"fmt"

	"budgero-server/internal/adapter/driven/sqlite/sqlc"
	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
)

// SettlementApprovalRepository implements repository.SettlementApprovalRepository using SQLite.
type SettlementApprovalRepository struct {
	queries *sqlc.Queries
}

// NewSettlementApprovalRepository creates a new SettlementApprovalRepository.
func NewSettlementApprovalRepository(queries *sqlc.Queries) *SettlementApprovalRepository {
	return &SettlementApprovalRepository{queries: queries}
}

var _ repository.SettlementApprovalRepository = (*SettlementApprovalRepository)(nil)

// List returns every approval in a space, oldest first.
func (r *SettlementApprovalRepository) List(ctx context.Context, spaceID string) ([]domain.SettlementApproval, error) {
	rows, err := r.queries.ListSettlementApprovals(ctx, spaceID)
	if err != nil {
		return nil, fmt.Errorf("failed to list settlement approvals: %w", err)
	}
	approvals := make([]domain.SettlementApproval, 0, len(rows))
	for _, row := range rows {
		approvals = append(approvals, domain.SettlementApproval{
			SpaceID:     row.SpaceID,
			UserID:      row.UserID,
			Fingerprint: row.Fingerprint,
			CreatedAt:   row.CreatedAt,
		})
	}
	return approvals, nil
}

// CountForMember counts the approvals one member keeps in a space.
func (r *SettlementApprovalRepository) CountForMember(ctx context.Context, spaceID, userID string) (int64, error) {
	return r.queries.CountSettlementApprovalsForMember(ctx, sqlc.CountSettlementApprovalsForMemberParams{
		SpaceID: spaceID,
		UserID:  userID,
	})
}

// Exists reports whether the member already approved the fingerprint.
func (r *SettlementApprovalRepository) Exists(ctx context.Context, spaceID, userID, fingerprint string) (bool, error) {
	count, err := r.queries.SettlementApprovalExists(ctx, sqlc.SettlementApprovalExistsParams{
		SpaceID:     spaceID,
		UserID:      userID,
		Fingerprint: fingerprint,
	})
	return count > 0, err
}

// Create stores an approval; storing one that exists changes nothing.
func (r *SettlementApprovalRepository) Create(ctx context.Context, approval *domain.SettlementApproval) error {
	return r.queries.InsertSettlementApproval(ctx, sqlc.InsertSettlementApprovalParams{
		SpaceID:     approval.SpaceID,
		UserID:      approval.UserID,
		Fingerprint: approval.Fingerprint,
		CreatedAt:   approval.CreatedAt,
	})
}

// Delete removes one approval of a member; a missing one is not an error.
func (r *SettlementApprovalRepository) Delete(ctx context.Context, spaceID, userID, fingerprint string) error {
	return r.queries.DeleteSettlementApproval(ctx, sqlc.DeleteSettlementApprovalParams{
		SpaceID:     spaceID,
		UserID:      userID,
		Fingerprint: fingerprint,
	})
}
