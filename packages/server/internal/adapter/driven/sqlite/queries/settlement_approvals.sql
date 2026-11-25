-- name: ListSettlementApprovals :many
SELECT space_id, user_id, fingerprint, created_at
FROM settlement_approvals
WHERE space_id = ?
ORDER BY created_at ASC, user_id ASC, fingerprint ASC;

-- name: CountSettlementApprovalsForMember :one
SELECT COUNT(*) FROM settlement_approvals WHERE space_id = ? AND user_id = ?;

-- name: SettlementApprovalExists :one
SELECT COUNT(*) FROM settlement_approvals
WHERE space_id = ? AND user_id = ? AND fingerprint = ?;

-- name: InsertSettlementApproval :exec
INSERT INTO settlement_approvals (space_id, user_id, fingerprint, created_at)
VALUES (?, ?, ?, ?)
ON CONFLICT (space_id, user_id, fingerprint) DO NOTHING;

-- name: DeleteSettlementApproval :exec
DELETE FROM settlement_approvals WHERE space_id = ? AND user_id = ? AND fingerprint = ?;
