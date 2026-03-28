# Site Survey App

Full-stack site survey platform with:

- Backend API in Express + TypeScript + PostgreSQL
- Frontend dashboard in React + Vite
- Mobile clients and shared modules in the repository

## Local Development

1. Install dependencies from the repo root:
   npm install
2. Start local development stack:
   npm run dev:local

## Mobile EAS Builds

The Expo project lives in `mobile/`, so EAS commands must run from that directory. If you run `eas build` from the repo root, EAS will try to read `/eas.json` and fail.

Use one of these repo-root commands instead:

- `npm run eas:build:configure`
- `npm run eas:build`
- `npm run eas:submit`

## Security Checklist

- Set a strong JWT secret in backend/.env before production deployment.
- Keep JWT expiration short enough for your risk profile.
- Restrict CORS origins to trusted frontend and mobile hosts only.
- Use HTTPS and secure reverse-proxy headers in production.
- Rotate secrets and credentials regularly.
- Monitor auth audit logs for repeated failures and lockouts.

## Auth and Rate-Limit Controls

Configured in backend/.env:

- JWT_SECRET
  - Secret used to sign and verify auth tokens.
- JWT_EXPIRES_IN
  - Token lifetime (example: 12h).

- SIGNIN_MAX_FAILURES
  - Number of invalid sign-in attempts allowed before lockout.
- SIGNIN_WINDOW_MINUTES
  - Rolling window used to count failures.
- SIGNIN_LOCK_MINUTES
  - Lockout duration once threshold is reached.

- USERS_REGISTER_MAX_REQUESTS
  - Max register requests allowed for a request key in the configured window.
- USERS_REGISTER_WINDOW_MINUTES
  - Window for register route throttling.

- USERS_ME_MAX_REQUESTS
  - Max requests allowed to GET /api/users/me per window.
- USERS_ME_WINDOW_MINUTES
  - Window for users/me route throttling.

## Auth Audit Logging

The backend emits structured auth audit logs for:

- Register attempts, conflicts, successes, and failures
- Sign-in attempts, failures, lockouts, successes, and failures
- Authenticated profile access via GET /api/users/me

Sensitive identifiers are redacted:

- Email values are logged as hashes with domain preserved.
- IP addresses are truncated.
