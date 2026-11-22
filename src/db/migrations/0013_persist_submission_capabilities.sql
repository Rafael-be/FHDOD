ALTER TABLE submission_sessions ADD COLUMN capability_hash bytea;
-- Local development has only disposable historical sessions; invalidate them
-- rather than storing a secret that was never issued by this implementation.
UPDATE submission_sessions
SET ended_at = coalesce(ended_at, now()), capability_hash = decode(repeat('00', 32), 'hex')
WHERE capability_hash IS NULL;
ALTER TABLE submission_sessions ALTER COLUMN capability_hash SET NOT NULL;
ALTER TABLE submission_sessions ADD CONSTRAINT submission_sessions_capability_hash_length_check CHECK (octet_length(capability_hash) = 32);
