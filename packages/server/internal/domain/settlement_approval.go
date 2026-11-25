package domain

import (
	"regexp"
	"time"
)

// MaxSettlementApprovalsPerMember caps the approvals one member keeps in one
// space. Every change of the settlement terms is approved anew, so this is
// years of monthly changes; beyond it the endpoint is only good for filling
// the database.
const MaxSettlementApprovalsPerMember = 500

// settlementFingerprintPattern is a hex-encoded SHA-256 HMAC (lowercase).
var settlementFingerprintPattern = regexp.MustCompile(`^[0-9a-f]{64}$`)

// SettlementApproval is a member's consent to one version of a household
// settlement. The terms are end-to-end encrypted in the workspace; the
// fingerprint is an HMAC of them under a key only the members hold, so the
// server learns who agreed, not to what. UserID is always the member who made
// the request: nobody can approve (or revoke) for someone else.
type SettlementApproval struct {
	SpaceID     string    `json:"space_id"`
	UserID      string    `json:"user_id"`
	Fingerprint string    `json:"fingerprint"`
	CreatedAt   time.Time `json:"created_at"`
}

// IsValidSettlementFingerprint reports whether s is a lowercase hex SHA-256 digest.
func IsValidSettlementFingerprint(s string) bool {
	return settlementFingerprintPattern.MatchString(s)
}
