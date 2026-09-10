const { onRequest } = require('firebase-functions/v2/https');
const { setGlobalOptions } = require('firebase-functions/v2');
const admin = require('firebase-admin');
const crypto = require('crypto');

admin.initializeApp();
setGlobalOptions({ region: 'us-east1', maxInstances: 10 });

const db = admin.firestore();

function cors(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  res.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
}

async function requireAdmin(req) {
  const header = req.get('Authorization') || '';
  if (!header.startsWith('Bearer ')) throw new Error('unauthenticated');
  const decoded = await admin.auth().verifyIdToken(header.slice(7));
  const snap = await db.doc(`users/${decoded.uid}`).get();
  if (!snap.exists || snap.data().role !== 'admin' || snap.data().status !== 'active') {
    throw new Error('permission-denied');
  }
  return decoded;
}

function makeTempPassword() {
  return `Coach!${crypto.randomBytes(12).toString('base64url')}A9`;
}

exports.adminUser = onRequest(async (req, res) => {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).send('');
  if (req.method !== 'POST') return res.status(405).json({ error: 'method-not-allowed' });

  try {
    const caller = await requireAdmin(req);
    const action = String(req.body?.action || '');

    if (action === 'invite') {
      const email = String(req.body?.email || '').trim().toLowerCase();
      const name = String(req.body?.name || '').trim() || email;
      const role = req.body?.role === 'admin' ? 'admin' : 'user';
      if (!email) return res.status(400).json({ error: 'email-required' });

      const tempPassword = makeTempPassword();
      let userRecord;
      let reused = false;

      try {
        userRecord = await admin.auth().getUserByEmail(email);
        reused = true;
        userRecord = await admin.auth().updateUser(userRecord.uid, {
          password: tempPassword,
          disabled: false
        });
      } catch (err) {
        if (err.code !== 'auth/user-not-found') throw err;
        userRecord = await admin.auth().createUser({
          email,
          password: tempPassword,
          disabled: false
        });
      }

      await db.doc(`users/${userRecord.uid}`).set({
        uid: userRecord.uid,
        name,
        email,
        role,
        status: 'invited',
        mustChangePassword: true,
        invitedBy: caller.uid,
        invitedAt: admin.firestore.FieldValue.serverTimestamp(),
        updatedAt: admin.firestore.FieldValue.serverTimestamp()
      }, { merge: true });

      await admin.auth().revokeRefreshTokens(userRecord.uid);

      return res.json({
        ok: true,
        uid: userRecord.uid,
        email,
        tempPassword,
        reused
      });
    }

    if (action === 'delete') {
      const uid = String(req.body?.uid || '').trim();
      if (!uid) return res.status(400).json({ error: 'uid-required' });
      if (uid === caller.uid) return res.status(400).json({ error: 'cannot-delete-self' });

      try {
        await admin.auth().deleteUser(uid);
      } catch (err) {
        if (err.code !== 'auth/user-not-found') throw err;
      }

      await db.doc(`users/${uid}`).delete().catch(() => {});
      return res.json({ ok: true });
    }

    return res.status(400).json({ error: 'unknown-action' });
  } catch (err) {
    console.error(err);
    const code = err.message === 'unauthenticated' ? 401 : err.message === 'permission-denied' ? 403 : 500;
    return res.status(code).json({ error: err.message || 'server-error' });
  }
});
