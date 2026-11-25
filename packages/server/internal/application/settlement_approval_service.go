package application

import (
	"context"
	"time"

	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
	"budgero-server/internal/port/driving"
)

// spaceAccess resolves a requested space for a user, or fails with
// domain.ErrSpaceAccessDenied when the user is not an accepted member.
type spaceAccess interface {
	ResolveSpaceID(ctx context.Context, userID, requestedSpaceID string) (string, error)
}

// SettlementApprovalService implements driving.SettlementApprovalService.
type SettlementApprovalService struct {
	repo   repository.SettlementApprovalRepository
	spaces spaceAccess
	now    func() time.Time
}

// NewSettlementApprovalService creates a new SettlementApprovalService.
func NewSettlementApprovalService(repo repository.SettlementApprovalRepository, spaces spaceAccess) *SettlementApprovalService {
	return &SettlementApprovalService{repo: repo, spaces: spaces, now: func() time.Time { return time.Now().UTC() }}
}

var _ driving.SettlementApprovalService = (*SettlementApprovalService)(nil)

// memberSpace is the space the caller asked for, when they are an accepted
// member of it. An empty id is refused: ResolveSpaceID would fall back to the
// caller's first space, and approvals must never land in another one.
func (s *SettlementApprovalService) memberSpace(ctx context.Context, userID, spaceID string) (string, error) {
	if userID == "" || spaceID == "" {
		return "", domain.ErrSpaceAccessDenied
	}
	return s.spaces.ResolveSpaceID(ctx, userID, spaceID)
}

// List returns every approval in the space.
func (s *SettlementApprovalService) List(ctx context.Context, userID, spaceID string) ([]domain.SettlementApproval, error) {
	resolved, err := s.memberSpace(ctx, userID, spaceID)
	if err != nil {
		return nil, err
	}
	return s.repo.List(ctx, resolved)
}

// Approve records the caller's approval of a fingerprint (idempotent).
func (s *SettlementApprovalService) Approve(ctx context.Context, userID, spaceID, fingerprint string) (*domain.SettlementApproval, error) {
	if !domain.IsValidSettlementFingerprint(fingerprint) {
		return nil, domain.ErrInvalidSettlementFingerprint
	}
	resolved, err := s.memberSpace(ctx, userID, spaceID)
	if err != nil {
		return nil, err
	}
	approval := &domain.SettlementApproval{
		SpaceID:     resolved,
		UserID:      userID,
		Fingerprint: fingerprint,
		CreatedAt:   s.now(),
	}
	exists, err := s.repo.Exists(ctx, resolved, userID, fingerprint)
	if err != nil {
		return nil, err
	}
	if exists {
		return approval, nil
	}
	count, err := s.repo.CountForMember(ctx, resolved, userID)
	if err != nil {
		return nil, err
	}
	if count >= domain.MaxSettlementApprovalsPerMember {
		return nil, domain.ErrSettlementApprovalLimitReached
	}
	if err := s.repo.Create(ctx, approval); err != nil {
		return nil, err
	}
	return approval, nil
}

// Revoke removes the caller's approval of a fingerprint (idempotent).
func (s *SettlementApprovalService) Revoke(ctx context.Context, userID, spaceID, fingerprint string) error {
	if !domain.IsValidSettlementFingerprint(fingerprint) {
		return domain.ErrInvalidSettlementFingerprint
	}
	resolved, err := s.memberSpace(ctx, userID, spaceID)
	if err != nil {
		return err
	}
	return s.repo.Delete(ctx, resolved, userID, fingerprint)
}
