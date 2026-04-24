-- Device tokens for Firebase Cloud Messaging push notifications.
-- Parents (and potentially guards) register their device's FCM token after login
-- via POST /api/devices/register, and unregister on logout via DELETE /api/devices/:token.

BEGIN;

CREATE TABLE IF NOT EXISTS device_tokens (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id      UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token        TEXT NOT NULL UNIQUE,
  platform     TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  created_at   TIMESTAMP NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS device_tokens_user_id_idx ON device_tokens(user_id);

COMMIT;
