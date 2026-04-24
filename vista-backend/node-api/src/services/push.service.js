// Firebase Cloud Messaging push-notification service.
// Initialised lazily so the API doesn't crash on boot when Firebase env vars
// are missing (dev environments, test runs, CI). If the creds aren't set, any
// send call becomes a no-op that logs and returns — the dismissal/verify hook
// should never fail because FCM is misconfigured.

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

// Send a pickup alert when a guard successfully releases a student at the gate.
// Caller: POST /api/dismissal/verify success branch. Silent failure is OK —
// the gate log is the source of truth, push is a best-effort convenience.
async function sendPickupAlert({ studentId, studentName, guardianName, scannedAt }) {
  try {
    if (!ensureInit()) return { sent: 0, skipped: 'firebase-not-initialized' };

    const parents = await query(
      `SELECT DISTINCT parent_id FROM parent_student
        WHERE student_id = $1 AND parent_id IS NOT NULL`,
      [studentId]
    );
    const parentIds = parents.rows.map(r => r.parent_id);
    if (!parentIds.length) return { sent: 0, skipped: 'no-linked-parents' };

    const rows = await tokensForUsers(parentIds);
    if (!rows.length) return { sent: 0, skipped: 'no-device-tokens' };

    const message = {
      notification: {
        title: `${studentName} has been picked up`,
        body: `${guardianName} just signed out ${studentName} at the gate.`,
      },
      data: {
        type: 'pickup',
        student_id: String(studentId),
        scanned_at: scannedAt ? new Date(scannedAt).toISOString() : new Date().toISOString(),
      },
      tokens: rows.map(r => r.token),
    };

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
  } catch (err) {
    console.error('[push] sendPickupAlert failed:', err.message);
    return { sent: 0, error: err.message };
  }
}

module.exports = {
  sendPickupAlert,
};
