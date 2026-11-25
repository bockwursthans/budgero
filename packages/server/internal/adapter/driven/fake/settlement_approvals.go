package fake

import (
	"context"
	"sort"
	"sync"

	"budgero-server/internal/domain"
	"budgero-server/internal/port/driven/repository"
)

var _ repository.SettlementApprovalRepository = (*SettlementApprovalRepository)(nil)

type settlementApprovalKey struct {
	spaceID, userID, fingerprint string
}

// SettlementApprovalRepository is a fake in-memory implementation of the settlement approval repository for testing.
type SettlementApprovalRepository struct {
	mu        sync.RWMutex
	approvals map[settlementApprovalKey]domain.SettlementApproval
}

// NewSettlementApprovalRepository creates a new fake SettlementApprovalRepository.
func NewSettlementApprovalRepository() *SettlementApprovalRepository {
	return &SettlementApprovalRepository{approvals: map[settlementApprovalKey]domain.SettlementApproval{}}
}

// List returns every approval in a space, oldest first.
func (r *SettlementApprovalRepository) List(_ context.Context, spaceID string) ([]domain.SettlementApproval, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	result := []domain.SettlementApproval{}
	for key, approval := range r.approvals {
		if key.spaceID == spaceID {
			result = append(result, approval)
		}
	}
	sort.Slice(result, func(i, j int) bool {
		if !result[i].CreatedAt.Equal(result[j].CreatedAt) {
			return result[i].CreatedAt.Before(result[j].CreatedAt)
		}
		if result[i].UserID != result[j].UserID {
			return result[i].UserID < result[j].UserID
		}
		return result[i].Fingerprint < result[j].Fingerprint
	})
	return result, nil
}

// CountForMember counts the approvals one member keeps in a space.
func (r *SettlementApprovalRepository) CountForMember(_ context.Context, spaceID, userID string) (int64, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	var count int64
	for key := range r.approvals {
		if key.spaceID == spaceID && key.userID == userID {
			count++
		}
	}
	return count, nil
}

// Exists reports whether the member already approved the fingerprint.
func (r *SettlementApprovalRepository) Exists(_ context.Context, spaceID, userID, fingerprint string) (bool, error) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	_, ok := r.approvals[settlementApprovalKey{spaceID, userID, fingerprint}]
	return ok, nil
}

// Create stores an approval; storing one that exists changes nothing.
func (r *SettlementApprovalRepository) Create(_ context.Context, approval *domain.SettlementApproval) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	key := settlementApprovalKey{approval.SpaceID, approval.UserID, approval.Fingerprint}
	if _, ok := r.approvals[key]; !ok {
		r.approvals[key] = *approval
	}
	return nil
}

// Delete removes one approval of a member; a missing one is not an error.
func (r *SettlementApprovalRepository) Delete(_ context.Context, spaceID, userID, fingerprint string) error {
	r.mu.Lock()
	defer r.mu.Unlock()
	delete(r.approvals, settlementApprovalKey{spaceID, userID, fingerprint})
	return nil
}
