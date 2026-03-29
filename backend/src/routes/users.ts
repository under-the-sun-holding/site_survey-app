import { createHash, randomBytes } from 'crypto';
import { Router, Request, Response } from 'express';
import { pool } from '../database';
import { signAuthToken } from '../utils/authToken';
import { requireAuth } from '../middleware/auth';
import { createRateLimiter } from '../middleware/rateLimit';
import { authAudit } from '../utils/authAudit';
import { sendPasswordResetEmail } from '../utils/passwordResetMailer';

const router = Router();
let usersTableReady = false;

interface AuthBody {
  identifier?: string;
  email?: string;
  password?: string;
  full_name?: string;
  token?: string;
  new_password?: string;
}

interface SignInAttemptState {
  failures: number;
  firstFailureAt: number;
  lockedUntil?: number;
}

interface PasswordResetState {
  tokenHash: string;
  expiresAt: number;
}

function getIntEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

const SIGNIN_MAX_FAILURES = getIntEnv('SIGNIN_MAX_FAILURES', 5);
const SIGNIN_WINDOW_MS = getIntEnv('SIGNIN_WINDOW_MINUTES', 15) * 60 * 1000;
const SIGNIN_LOCK_MS = getIntEnv('SIGNIN_LOCK_MINUTES', 15) * 60 * 1000;
const REGISTER_MAX_REQUESTS = getIntEnv('USERS_REGISTER_MAX_REQUESTS', 8);
const REGISTER_WINDOW_MS = getIntEnv('USERS_REGISTER_WINDOW_MINUTES', 15) * 60 * 1000;
const ME_MAX_REQUESTS = getIntEnv('USERS_ME_MAX_REQUESTS', 120);
const ME_WINDOW_MS = getIntEnv('USERS_ME_WINDOW_MINUTES', 1) * 60 * 1000;
const PASSWORD_RESET_TTL_MS = getIntEnv('PASSWORD_RESET_TTL_MINUTES', 30) * 60 * 1000;
const signInAttemptMap = new Map<string, SignInAttemptState>();
const passwordResetMap = new Map<string, PasswordResetState>();
const SUPPORTED_SOCIAL_PROVIDERS = new Set(['google', 'microsoft', 'apple']);

const ADMIN_USER = {
  id: 'admin-local-user',
  username: 'admin',
  email: 'admin@site-survey.local',
  fullName: 'Administrator',
  password: 'admin123!',
  role: 'admin' as const,
};

function getClientIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || 'unknown';
}

function attemptKey(req: Request, email: string): string {
  return `${getClientIp(req)}:${email}`;
}

function getSignInState(key: string): SignInAttemptState {
  const now = Date.now();
  const existing = signInAttemptMap.get(key);

  if (!existing) {
    const state: SignInAttemptState = { failures: 0, firstFailureAt: now };
    signInAttemptMap.set(key, state);
    return state;
  }

  if (existing.firstFailureAt + SIGNIN_WINDOW_MS < now) {
    const reset: SignInAttemptState = { failures: 0, firstFailureAt: now };
    signInAttemptMap.set(key, reset);
    return reset;
  }

  return existing;
}

function isSignInLocked(state: SignInAttemptState): boolean {
  return typeof state.lockedUntil === 'number' && state.lockedUntil > Date.now();
}

function recordSignInFailure(state: SignInAttemptState): void {
  state.failures += 1;
  if (state.failures >= SIGNIN_MAX_FAILURES) {
    state.lockedUntil = Date.now() + SIGNIN_LOCK_MS;
  }
}

function clearSignInFailures(key: string): void {
  signInAttemptMap.delete(key);
}

const registerRateLimit = createRateLimiter({
  maxRequests: REGISTER_MAX_REQUESTS,
  windowMs: REGISTER_WINDOW_MS,
  keyFn: (req) => {
    const body = req.body as AuthBody;
    return `register:${getClientIp(req)}:${cleanEmail(body.email)}`;
  },
  message: 'Too many registration attempts. Please try again later.',
});

const meRateLimit = createRateLimiter({
  maxRequests: ME_MAX_REQUESTS,
  windowMs: ME_WINDOW_MS,
  keyFn: (req) => `me:${getClientIp(req)}:${req.authUser?.userId || 'anonymous'}`,
  message: 'Too many profile requests. Please try again later.',
});

function cleanEmail(email?: string): string {
  return (email || '').trim().toLowerCase();
}

function cleanIdentifier(identifier?: string): string {
  return (identifier || '').trim().toLowerCase();
}

function isAdminIdentifier(identifier: string): boolean {
  return identifier === ADMIN_USER.username || identifier === ADMIN_USER.email;
}

function buildAdminUser() {
  return {
    id: ADMIN_USER.id,
    username: ADMIN_USER.username,
    email: ADMIN_USER.email,
    fullName: ADMIN_USER.fullName,
    role: ADMIN_USER.role,
    createdAt: new Date(0).toISOString(),
  };
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function createPasswordResetToken(email: string): string {
  const token = randomBytes(24).toString('hex');
  passwordResetMap.set(email, {
    tokenHash: hashResetToken(token),
    expiresAt: Date.now() + PASSWORD_RESET_TTL_MS,
  });
  return token;
}

function isValidResetToken(email: string, token: string): boolean {
  const resetState = passwordResetMap.get(email);
  if (!resetState) return false;
  if (resetState.expiresAt <= Date.now()) {
    passwordResetMap.delete(email);
    return false;
  }
  return resetState.tokenHash === hashResetToken(token);
}

async function ensureUsersTable(): Promise<void> {
  if (usersTableReady) return;

  // crypt()/gen_salt()/gen_random_uuid() require pgcrypto.
  await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');

  await pool.query(
    `CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  );

  await pool.query('CREATE INDEX IF NOT EXISTS users_email_idx ON users (email)');
  usersTableReady = true;
}

// GET /api/users/me
router.get('/me', requireAuth, meRateLimit, async (req: Request, res: Response) => {
  try {
    if (req.authUser?.role === 'admin' || req.authUser?.userId === ADMIN_USER.id) {
      authAudit('users.me.success', req, ADMIN_USER.email, { status: 200, userId: ADMIN_USER.id });
      res.json({ user: buildAdminUser() });
      return;
    }

    await ensureUsersTable();

    const userId = req.authUser?.userId;
    if (!userId) {
      authAudit('users.me.unauthorized', req, req.authUser?.email, { status: 401, reason: 'missing-auth-user' });
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    const { rows } = await pool.query(
      `SELECT id, email, full_name, created_at
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [userId]
    );

    if (!rows[0]) {
      authAudit('users.me.not_found', req, req.authUser?.email, { status: 404, userId });
      res.status(404).json({ error: 'User not found' });
      return;
    }

    const user = rows[0];
    authAudit('users.me.success', req, user.email, { status: 200, userId });
    res.json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: 'user',
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error('GET /api/users/me error:', err);
    authAudit('users.me.error', req, req.authUser?.email, { status: 500 });
    res.status(500).json({ error: 'Failed to fetch current user' });
  }
});

// POST /api/users/register
router.post('/register', registerRateLimit, async (req: Request, res: Response) => {
  const { email, password, full_name } = req.body as AuthBody;
  const normalizedEmail = cleanEmail(email);
  const displayName = (full_name || '').trim();

  authAudit('users.register.attempt', req, normalizedEmail);

  if (!normalizedEmail || !password || !displayName) {
    authAudit('users.register.reject', req, normalizedEmail, { status: 400, reason: 'missing-fields' });
    res.status(400).json({ error: 'Email, password, and full name are required' });
    return;
  }

  if (password.length < 8) {
    authAudit('users.register.reject', req, normalizedEmail, { status: 400, reason: 'password-too-short' });
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  try {
    await ensureUsersTable();

    const existing = await pool.query('SELECT id FROM users WHERE email = $1', [normalizedEmail]);
    if (existing.rowCount && existing.rowCount > 0) {
      authAudit('users.register.conflict', req, normalizedEmail, { status: 409, reason: 'email-exists' });
      res.status(409).json({ error: 'An account with this email already exists' });
      return;
    }

    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name)
       VALUES ($1, crypt($2, gen_salt('bf')), $3)
       RETURNING id, email, full_name, created_at`,
      [normalizedEmail, password, displayName]
    );

    const user = rows[0];
    const token = signAuthToken({ userId: user.id, email: user.email });
  authAudit('users.register.success', req, user.email, { status: 201, userId: user.id });

    res.status(201).json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: 'user',
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error('POST /api/users/register error:', err);
    authAudit('users.register.error', req, normalizedEmail, { status: 500 });
    res.status(500).json({ error: 'Failed to register user' });
  }
});

// POST /api/users/signin
router.post('/signin', async (req: Request, res: Response) => {
  const { identifier, email, password } = req.body as AuthBody;
  const normalizedIdentifier = cleanIdentifier(identifier || email);

  authAudit('users.signin.attempt', req, normalizedIdentifier);

  if (!normalizedIdentifier || !password) {
    authAudit('users.signin.reject', req, normalizedIdentifier, { status: 400, reason: 'missing-fields' });
    res.status(400).json({ error: 'Email or username and password are required' });
    return;
  }

  try {
    const key = attemptKey(req, normalizedIdentifier);
    const state = getSignInState(key);

    if (isSignInLocked(state)) {
      authAudit('users.signin.locked', req, normalizedIdentifier, { status: 429, reason: 'active-lockout' });
      res.status(429).json({ error: 'Too many sign-in attempts. Please try again later.' });
      return;
    }

    if (isAdminIdentifier(normalizedIdentifier) && password === ADMIN_USER.password) {
      clearSignInFailures(key);
      const token = signAuthToken({
        userId: ADMIN_USER.id,
        username: ADMIN_USER.username,
        email: ADMIN_USER.email,
        role: ADMIN_USER.role,
      });

      authAudit('users.signin.success', req, ADMIN_USER.email, { status: 200, userId: ADMIN_USER.id });
      res.json({ token, user: buildAdminUser() });
      return;
    }

    await ensureUsersTable();

    const { rows } = await pool.query(
      `SELECT id, email, full_name, created_at
       FROM users
       WHERE email = $1 AND password_hash = crypt($2, password_hash)
       LIMIT 1`,
      [normalizedIdentifier, password]
    );

    if (!rows[0]) {
      recordSignInFailure(state);
      if (isSignInLocked(state)) {
        authAudit('users.signin.locked', req, normalizedIdentifier, { status: 429, reason: 'lockout-threshold-reached' });
        res.status(429).json({ error: 'Too many sign-in attempts. Please try again later.' });
        return;
      }
      authAudit('users.signin.failure', req, normalizedIdentifier, { status: 401, reason: 'invalid-credentials' });
      res.status(401).json({ error: 'Invalid email, username, or password' });
      return;
    }

    const user = rows[0];
    clearSignInFailures(key);
    const token = signAuthToken({ userId: user.id, email: user.email });
    authAudit('users.signin.success', req, user.email, { status: 200, userId: user.id });

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: 'user',
        createdAt: user.created_at,
      },
    });
  } catch (err) {
    console.error('POST /api/users/signin error:', err);
    authAudit('users.signin.error', req, normalizedIdentifier, { status: 500 });
    res.status(500).json({ error: 'Failed to sign in' });
  }
});

// POST /api/users/forgot-password
router.post('/forgot-password', async (req: Request, res: Response) => {
  const { email } = req.body as AuthBody;
  const normalizedEmail = cleanEmail(email);

  if (!normalizedEmail) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  authAudit('users.forgot-password.attempt', req, normalizedEmail);

  try {
    const genericMessage = 'If that email exists, password reset instructions have been sent.';
    await ensureUsersTable();

    const { rows } = await pool.query('SELECT id FROM users WHERE email = $1 LIMIT 1', [normalizedEmail]);
    if (rows[0]) {
      const resetToken = createPasswordResetToken(normalizedEmail);
      let delivery = 'sent';

      try {
        await sendPasswordResetEmail(normalizedEmail, resetToken);
      } catch (mailErr) {
        delivery = 'failed';
        console.error('Password reset email delivery error:', mailErr);
      }

      authAudit('users.forgot-password.success', req, normalizedEmail, { status: 200, userId: rows[0].id });
      res.json({
        message: genericMessage,
        delivery,
        resetToken: process.env.NODE_ENV === 'production' ? undefined : resetToken,
        expiresInMinutes: Math.floor(PASSWORD_RESET_TTL_MS / 60000),
      });
      return;
    }

    authAudit('users.forgot-password.success', req, normalizedEmail, { status: 200, reason: 'generic-response' });
    res.json({ message: genericMessage });
  } catch (err) {
    console.error('POST /api/users/forgot-password error:', err);
    authAudit('users.forgot-password.error', req, normalizedEmail, { status: 500 });
    res.status(500).json({ error: 'Failed to create password reset token' });
  }
});

// POST /api/users/reset-password
router.post('/reset-password', async (req: Request, res: Response) => {
  const { email, token, new_password } = req.body as AuthBody;
  const normalizedEmail = cleanEmail(email);
  const nextPassword = (new_password || '').trim();

  if (!normalizedEmail || !token || !nextPassword) {
    res.status(400).json({ error: 'Email, token, and new password are required' });
    return;
  }

  if (nextPassword.length < 8) {
    res.status(400).json({ error: 'Password must be at least 8 characters' });
    return;
  }

  authAudit('users.reset-password.attempt', req, normalizedEmail);

  try {
    await ensureUsersTable();

    if (!isValidResetToken(normalizedEmail, token)) {
      authAudit('users.reset-password.reject', req, normalizedEmail, { status: 400, reason: 'invalid-token' });
      res.status(400).json({ error: 'Invalid or expired reset token' });
      return;
    }

    const { rows } = await pool.query(
      `UPDATE users
       SET password_hash = crypt($2, gen_salt('bf')),
           updated_at = NOW()
       WHERE email = $1
       RETURNING id`,
      [normalizedEmail, nextPassword]
    );

    passwordResetMap.delete(normalizedEmail);

    if (!rows[0]) {
      authAudit('users.reset-password.reject', req, normalizedEmail, { status: 404, reason: 'user-not-found' });
      res.status(404).json({ error: 'User not found' });
      return;
    }

    authAudit('users.reset-password.success', req, normalizedEmail, { status: 200, userId: rows[0].id });
    res.json({ message: 'Password reset successful. You can now sign in with your new password.' });
  } catch (err) {
    console.error('POST /api/users/reset-password error:', err);
    authAudit('users.reset-password.error', req, normalizedEmail, { status: 500 });
    res.status(500).json({ error: 'Failed to reset password' });
  }
});

// POST /api/users/oauth/:provider
router.post('/oauth/:provider', (req: Request, res: Response) => {
  const provider = String(req.params.provider || '').toLowerCase();

  if (!SUPPORTED_SOCIAL_PROVIDERS.has(provider)) {
    res.status(400).json({ error: 'Unsupported social provider' });
    return;
  }

  authAudit('users.oauth.placeholder', req, provider, { status: 501, reason: `${provider}-not-configured` });
  res.status(501).json({ error: `${provider[0].toUpperCase()}${provider.slice(1)} sign-in is not configured yet.` });
});

export default router;
