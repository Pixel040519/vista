// Firebase Cloud Messaging push-notification service.
// Initialised lazily so the API doesn't crash on boot when Firebase env vars
// are missing (dev environments, test runs, CI). If the creds aren't set, any
// send call becomes a no-op that logs and returns — a write that pushes should
// never fail because FCM is misconfigured.

const admin = require('firebase-admin');
const { query } = require('../config/database');

let initAttempted = false;
let initialized = false;

function ensureInit() {
  if (initAttempted) return initialized;
  initAttempted = true;

  const projectId   = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  if (!projectId || !clientEmail || !privateKeyRaw) {
    console.warn('[push] FIREBASE_* env vars not set — push notifications disabled.');
    return false;
  }

  const privateKey = privateKeyRaw.replace(/\\n/g, '\n');

  try {
    admin.initializeApp({
      credential: admin.credential.cert({ projectId, clientEmail, privateKey }),
    });
    initialized = true;
    console.log('[push] Firebase Admin initialized.');
  } catch (err) {
    console.error('[push] Firebase init failed:', err.message);
  }
  return initialized;
}

// Collect every FCM token registered for users, cleaning up dead ones that the
// gateway says are no longer registered. Returns the list of { token, platform }
// records — an empty list when nothing is registered or Firebase isn't set up.
async function tokensForUsers(userIds) {
  if (!Array.isArray(userIds) || userIds.length === 0) return [];
  const r = await query(
    `SELECT id, user_id, token, platform FROM device_tokens WHERE user_id = ANY($1)`,
    [userIds]
  );
  return r.rows;
}

async function removeDeadTokens(tokens) {
  if (!tokens.length) return;
  await query(`DELETE FROM device_tokens WHERE token = ANY($1)`, [tokens]);
}

// Send one message to many tokens and prune the ones FCM reports as gone.
async function multicast(message, rows) {
  const response = await admin.messaging().sendEachForMulticast(message);

  const dead = [];
  response.responses.forEach((resp, idx) => {
    if (!resp.success && resp.error) {
      const code = resp.error.code || '';
      if (code.includes('registration-token-not-registered') ||
          code.includes('invalid-argument')) {
        dead.push(rows[idx].token);
      }
    }
  });
  if (dead.length) await removeDeadTokens(dead);

  return { sent: response.successCount, failed: response.failureCount, cleaned: dead.length };
}

// FCM caps a multicast at 500 tokens.
const MULTICAST_LIMIT = 500;

// Push a school announcement to every given parent with a registered device.
// Caller: announcement.routes.js, after the transaction that wrote
// the notification rows has committed — the in-app list is the source of truth,
// the push is a best-effort nudge towards it. Its own Android channel keeps
// announcements separately mutable from any other alert the app shows.
async function sendAnnouncement(userIds, { id, title, summary }) {
  try {
    if (!ensureInit()) return { sent: 0, skipped: 'firebase-not-initialized' };

    const rows = await tokensForUsers(userIds);
    if (!rows.length) return { sent: 0, skipped: 'no-device-tokens' };

    const total = { sent: 0, failed: 0, cleaned: 0 };
    for (let i = 0; i < rows.length; i += MULTICAST_LIMIT) {
      const batch = rows.slice(i, i + MULTICAST_LIMIT);
      const r = await multicast({
        notification: { title, body: summary },
        data: { type: 'announcement', announcement_id: String(id) },
        android: { notification: { channelId: 'vista_announcements' } },
        tokens: batch.map(t => t.token),
      }, batch);
      total.sent += r.sent; total.failed += r.failed; total.cleaned += r.cleaned;
    }
    return total;
  } catch (err) {
    console.error('[push] sendAnnouncement failed:', err.message);
    return { sent: 0, error: err.message };
  }
}

module.exports = {
  sendAnnouncement,
};
