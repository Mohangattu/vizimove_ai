/**
 * ViziMove AI — API Authentication & Session/CSRF Security Module
 * 
 * Provides:
 * 1. Constant-time X-API-Key verification against server-side VIZIMOVE_API_KEY.
 * 2. Safe server-side Session + CSRF protection for same-origin React dashboard.
 * 3. Origin & Sec-Fetch-Site cross-site request forgery defense-in-depth.
 * 4. Safe failure modes when server secrets are missing (never fails open).
 * 5. Complete isolation preventing secret key exposure to browsers, Vite, or logs.
 */

import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

declare global {
  namespace Express {
    interface Request {
      auth?: {
        type: 'api_key' | 'session';
        sessionId?: string;
      };
    }
  }
}

export interface AuthSession {
  id: string;
  csrfToken: string;
  createdAt: number;
  lastActiveAt: number;
}

export interface AuthResult {
  authenticated: boolean;
  method?: 'api_key' | 'session';
  error?: string;
  code?: string;
  statusCode?: number;
}

// In-memory server session store (sessions expire after 24 hours of inactivity)
const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;
const sessions = new Map<string, AuthSession>();

// Cleanup expired sessions periodically
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [id, session] of sessions.entries()) {
    if (now - session.lastActiveAt > SESSION_MAX_AGE_MS) {
      sessions.delete(id);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) {
    // Perform dummy timing safe comparison against self to equalize execution time
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Checks whether the server environment has configured VIZIMOVE_API_KEY.
 */
export function isApiKeyConfigured(): boolean {
  const key = process.env.VIZIMOVE_API_KEY;
  return typeof key === 'string' && key.trim().length > 0;
}

/**
 * Retrieves the configured API key from environment, trimmed.
 */
export function getConfiguredApiKey(): string | undefined {
  const key = process.env.VIZIMOVE_API_KEY;
  if (!key || key.trim().length === 0) return undefined;
  return key.trim();
}

/**
 * Verifies an incoming X-API-Key against server-side VIZIMOVE_API_KEY.
 * Fails safely if the secret is not configured on the server.
 */
export function verifyApiKey(providedKey: string | undefined): AuthResult {
  const configuredKey = getConfiguredApiKey();

  // If server has not configured an API key, fail safely (never fail open)
  if (!configuredKey) {
    return {
      authenticated: false,
      statusCode: 503,
      code: 'API_KEY_NOT_CONFIGURED',
      error: 'API key authentication is not configured on the server. Please set VIZIMOVE_API_KEY in the server environment.',
    };
  }

  if (!providedKey || typeof providedKey !== 'string' || providedKey.trim().length === 0) {
    return {
      authenticated: false,
      statusCode: 401,
      code: 'MISSING_API_KEY',
      error: 'Missing X-API-Key header for protected mutation endpoint.',
    };
  }

  const isValid = timingSafeCompare(providedKey.trim(), configuredKey);
  if (!isValid) {
    return {
      authenticated: false,
      statusCode: 401,
      code: 'INVALID_API_KEY',
      error: 'Invalid API key provided in X-API-Key header.',
    };
  }

  return {
    authenticated: true,
    method: 'api_key',
  };
}

/**
 * Simple cookie header parser.
 */
export function parseCookies(cookieHeader?: string): Record<string, string> {
  if (!cookieHeader) return {};
  const cookies: Record<string, string> = {};
  cookieHeader.split(';').forEach((pair) => {
    const [name, ...rest] = pair.trim().split('=');
    if (name && rest.length > 0) {
      try {
        cookies[name] = decodeURIComponent(rest.join('='));
      } catch {
        cookies[name] = rest.join('=');
      }
    }
  });
  return cookies;
}

/**
 * Generates a new secure server session and CSRF token.
 */
export function createSession(): AuthSession {
  const session: AuthSession = {
    id: crypto.randomBytes(24).toString('hex'),
    csrfToken: crypto.randomBytes(32).toString('hex'),
    createdAt: Date.now(),
    lastActiveAt: Date.now(),
  };
  sessions.set(session.id, session);
  return session;
}

/**
 * Looks up an active session by ID, returning undefined if expired or missing.
 */
export function getSession(sessionId: string): AuthSession | undefined {
  if (!sessionId) return undefined;
  const session = sessions.get(sessionId);
  if (!session) return undefined;

  if (Date.now() - session.lastActiveAt > SESSION_MAX_AGE_MS) {
    sessions.delete(sessionId);
    return undefined;
  }

  session.lastActiveAt = Date.now();
  return session;
}

/**
 * Clears all active sessions (primarily for unit tests).
 */
export function clearAllSessions(): void {
  sessions.clear();
}

/**
 * Verifies same-origin request safety headers.
 */
export function isSameOriginRequest(req: Request): boolean {
  // Sec-Fetch-Site protection (browsers supporting Fetch Metadata)
  const secFetchSite = req.headers['sec-fetch-site'];
  if (secFetchSite && typeof secFetchSite === 'string') {
    if (!['same-origin', 'same-site', 'none'].includes(secFetchSite)) {
      return false;
    }
  }

  // Origin / Host verification
  const origin = req.headers.origin;
  const host = (req.headers['x-forwarded-host'] || req.headers.host) as string | undefined;

  if (origin && host) {
    try {
      const originUrl = new URL(origin);
      const hostWithoutPort = host.split(':')[0];
      const originWithoutPort = originUrl.hostname;

      if (
        originWithoutPort !== hostWithoutPort &&
        originWithoutPort !== 'localhost' &&
        originWithoutPort !== '127.0.0.1'
      ) {
        return false;
      }
    } catch {
      return false;
    }
  }

  return true;
}

/**
 * Verifies browser session + CSRF token pair.
 */
export function verifySessionCsrf(req: Request): AuthResult {
  // 1. Same-Origin verification
  if (!isSameOriginRequest(req)) {
    return {
      authenticated: false,
      statusCode: 403,
      code: 'CROSS_ORIGIN_BLOCKED',
      error: 'Cross-origin mutation request blocked.',
    };
  }

  // 2. Extract Session ID (from cookie or header)
  const cookies = parseCookies(req.headers.cookie);
  const sessionId = cookies['vizimove_session'] || (req.headers['x-session-id'] as string | undefined);

  // 3. Extract CSRF token (from header X-CSRF-Token or X-XSRF-TOKEN)
  const clientCsrfToken = (req.headers['x-csrf-token'] ||
    req.headers['x-xsrf-token'] ||
    cookies['XSRF-TOKEN']) as string | undefined;

  if (!sessionId || !clientCsrfToken) {
    return {
      authenticated: false,
      statusCode: 401,
      code: 'MISSING_SESSION_OR_CSRF',
      error: 'Missing session identifier or CSRF token for browser mutation.',
    };
  }

  const session = getSession(sessionId);
  if (!session) {
    return {
      authenticated: false,
      statusCode: 403,
      code: 'SESSION_EXPIRED',
      error: 'Session expired or not found. Please refresh your session.',
    };
  }

  const isCsrfValid = timingSafeCompare(clientCsrfToken.trim(), session.csrfToken);
  if (!isCsrfValid) {
    return {
      authenticated: false,
      statusCode: 403,
      code: 'CSRF_INVALID',
      error: 'Invalid CSRF token for current session.',
    };
  }

  return {
    authenticated: true,
    method: 'session',
  };
}

/**
 * Unified request authenticator.
 * Accepts either:
 * - A valid X-API-Key matching server-side VIZIMOVE_API_KEY (for machine/n8n/script requests), OR
 * - A valid same-origin Session + CSRF token pair (for the React dashboard).
 */
export function authenticateRequest(req: Request): AuthResult {
  const apiKeyHeader = req.headers['x-api-key'] as string | undefined;

  // Case 1: Machine client provided an API key
  if (apiKeyHeader !== undefined) {
    return verifyApiKey(apiKeyHeader);
  }

  // Case 2: Browser client providing Session + CSRF
  const cookies = parseCookies(req.headers.cookie);
  const hasSessionId = Boolean(cookies['vizimove_session'] || req.headers['x-session-id']);
  const hasCsrfToken = Boolean(
    req.headers['x-csrf-token'] || req.headers['x-xsrf-token'] || cookies['XSRF-TOKEN']
  );

  if (hasSessionId && hasCsrfToken) {
    return verifySessionCsrf(req);
  }

  // Case 3: Neither authentication method provided
  return {
    authenticated: false,
    statusCode: 401,
    code: 'UNAUTHORIZED',
    error: 'Authentication required. Provide a valid X-API-Key header or a valid session CSRF token.',
  };
}

/**
 * Express Middleware protecting mutating and operational routes.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const result = authenticateRequest(req);

  if (!result.authenticated) {
    res.status(result.statusCode || 401).json({
      error: result.error,
      code: result.code,
    });
    return;
  }

  req.auth = {
    type: result.method || 'api_key',
  };

  next();
}

/**
 * Handler for GET /api/auth/session
 * Bootstraps or returns the active same-origin session & CSRF token for the browser dashboard.
 */
export function handleGetSession(req: Request, res: Response): void {
  const cookies = parseCookies(req.headers.cookie);
  const existingSessionId = cookies['vizimove_session'] || (req.headers['x-session-id'] as string | undefined);
  let session = existingSessionId ? getSession(existingSessionId) : undefined;

  if (!session) {
    session = createSession();
  }

  const isProduction = process.env.NODE_ENV === 'production';
  const cookieFlags = `Path=/; SameSite=Lax${isProduction ? '; Secure' : ''}`;

  // Set HTTP-only session cookie and readable XSRF-TOKEN cookie
  res.setHeader('Set-Cookie', [
    `vizimove_session=${session.id}; HttpOnly; ${cookieFlags}`,
    `XSRF-TOKEN=${session.csrfToken}; ${cookieFlags}`,
  ]);

  res.json({
    success: true,
    sessionId: session.id,
    csrfToken: session.csrfToken,
    expiresInMs: SESSION_MAX_AGE_MS,
  });
}
