-- +goose Up
-- A member's consent to one version of a household settlement. The terms
-- themselves live in the end-to-end encrypted workspace; the server only
-- keeps an opaque fingerprint (HMAC of the terms under a key the server never
-- sees) together with who approved it. user_id is always the authenticated
-- caller, so no member can approve or revoke for another one.
CREATE TABLE IF NOT EXISTS settlement_approvals (
    space_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    fingerprint TEXT NOT NULL CHECK (length(fingerprint) = 64),
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (space_id, user_id, fingerprint),
    FOREIGN KEY (space_id) REFERENCES budget_spaces(space_id) ON DELETE CASCADE ON UPDATE CASCADE,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_settlement_approvals_user ON settlement_approvals(user_id);

-- +goose Down
DROP INDEX IF EXISTS idx_settlement_approvals_user;
DROP TABLE IF EXISTS settlement_approvals;
