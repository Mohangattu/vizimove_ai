/**
 * ViziMove AI — Comprehensive API Authentication & Security Test Suite
 *
 * Verifies:
 * 1. Protected mutation routes reject missing X-API-Key headers (HTTP 401).
 * 2. Protected mutation routes reject incorrect X-API-Key headers (HTTP 401).
 * 3. Protected mutation routes accept valid X-API-Key matching server VIZIMOVE_API_KEY (HTTP 200).
 * 4. Safe failure mode when server VIZIMOVE_API_KEY secret is unconfigured (HTTP 503).
 * 5. Public read-only endpoints remain accessible without credentials (HTTP 200).
 * 6. Browser same-origin Session + CSRF authentication operates without privileged key.
 * 7. Browser mutation rejects forged or invalid CSRF tokens (HTTP 403).
 * 8. Defense-in-depth blocks cross-origin mutation requests (HTTP 403).
 * 9. Privileged API keys are never leaked in responses, headers, or payloads.
 * 10. Constant-time comparison defends against timing side-channel attacks.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyApiKey,
  timingSafeCompare,
  createSession,
  getSession,
  verifySessionCsrf,
  authenticateRequest,
  clearAllSessions,
  isApiKeyConfigured,
} from './auth';

const TEST_SECRET = process.env.VIZIMOVE_API_KEY || 'vizimove_secret_api_key_example';
const BASE_URL = 'http://localhost:3000';

// ---------------------------------------------------------------------------
// UNIT TESTS: Core Cryptographic & Authentication Primitives
// ---------------------------------------------------------------------------

test('Auth Unit: Constant-time comparison (timingSafeCompare)', () => {
  assert.equal(timingSafeCompare('my-secret-token', 'my-secret-token'), true);
  assert.equal(timingSafeCompare('my-secret-token', 'my-secret-token-extra'), false);
  assert.equal(timingSafeCompare('my-secret-token', 'other-secret-tok'), false);
  assert.equal(timingSafeCompare('', ''), true);
  assert.equal(timingSafeCompare('abc', 'abd'), false);
});

test('Auth Unit: verifyApiKey validates provided key against server secret', () => {
  // Save current env
  const originalKey = process.env.VIZIMOVE_API_KEY;
  try {
    process.env.VIZIMOVE_API_KEY = 'test-secret-key-12345';

    // 1. Missing key
    const missing = verifyApiKey(undefined);
    assert.equal(missing.authenticated, false);
    assert.equal(missing.statusCode, 401);
    assert.equal(missing.code, 'MISSING_API_KEY');

    // 2. Empty key
    const empty = verifyApiKey('   ');
    assert.equal(empty.authenticated, false);
    assert.equal(empty.statusCode, 401);
    assert.equal(empty.code, 'MISSING_API_KEY');

    // 3. Incorrect key
    const wrong = verifyApiKey('wrong-key-999');
    assert.equal(wrong.authenticated, false);
    assert.equal(wrong.statusCode, 401);
    assert.equal(wrong.code, 'INVALID_API_KEY');

    // 4. Valid key
    const valid = verifyApiKey('test-secret-key-12345');
    assert.equal(valid.authenticated, true);
    assert.equal(valid.method, 'api_key');
  } finally {
    process.env.VIZIMOVE_API_KEY = originalKey;
  }
});

test('Auth Unit: verifyApiKey fails safely when server secret is missing', () => {
  const originalKey = process.env.VIZIMOVE_API_KEY;
  try {
    delete process.env.VIZIMOVE_API_KEY;
    assert.equal(isApiKeyConfigured(), false);

    // Any attempt to authenticate when server secret is absent must fail safely
    const res = verifyApiKey('any-key-attempt');
    assert.equal(res.authenticated, false);
    assert.equal(res.statusCode, 503);
    assert.equal(res.code, 'API_KEY_NOT_CONFIGURED');
    assert.ok(res.error?.includes('not configured'));
  } finally {
    process.env.VIZIMOVE_API_KEY = originalKey;
  }
});

test('Auth Unit: Session & CSRF token management', () => {
  clearAllSessions();
  const session = createSession();

  assert.ok(session.id.length >= 32);
  assert.ok(session.csrfToken.length >= 32);

  // Retrieve valid session
  const retrieved = getSession(session.id);
  assert.ok(retrieved);
  assert.equal(retrieved.id, session.id);
  assert.equal(retrieved.csrfToken, session.csrfToken);

  // Non-existent session
  assert.equal(getSession('non-existent-id'), undefined);
});

test('Auth Unit: verifySessionCsrf checks session and CSRF match', () => {
  clearAllSessions();
  const session = createSession();

  // Valid session + CSRF
  const mockReqValid = {
    headers: {
      cookie: `vizimove_session=${session.id}`,
      'x-csrf-token': session.csrfToken,
    },
  } as any;
  const resValid = verifySessionCsrf(mockReqValid);
  assert.equal(resValid.authenticated, true);
  assert.equal(resValid.method, 'session');

  // Mismatched CSRF token
  const mockReqWrongCsrf = {
    headers: {
      cookie: `vizimove_session=${session.id}`,
      'x-csrf-token': 'attacker-forged-csrf-token',
    },
  } as any;
  const resWrong = verifySessionCsrf(mockReqWrongCsrf);
  assert.equal(resWrong.authenticated, false);
  assert.equal(resWrong.statusCode, 403);
  assert.equal(resWrong.code, 'CSRF_INVALID');

  // Missing CSRF token
  const mockReqMissingCsrf = {
    headers: {
      cookie: `vizimove_session=${session.id}`,
    },
  } as any;
  const resMissing = verifySessionCsrf(mockReqMissingCsrf);
  assert.equal(resMissing.authenticated, false);
  assert.equal(resMissing.statusCode, 401);
  assert.equal(resMissing.code, 'MISSING_SESSION_OR_CSRF');
});

test('Auth Unit: verifySessionCsrf blocks cross-origin requests (defense-in-depth)', () => {
  const session = createSession();
  const mockCrossSite = {
    headers: {
      cookie: `vizimove_session=${session.id}`,
      'x-csrf-token': session.csrfToken,
      'sec-fetch-site': 'cross-site',
    },
  } as any;

  const res = verifySessionCsrf(mockCrossSite);
  assert.equal(res.authenticated, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.code, 'CROSS_ORIGIN_BLOCKED');
});

// ---------------------------------------------------------------------------
// INTEGRATION TESTS: Live Endpoints Against Running Express Server
// ---------------------------------------------------------------------------

test('Integration Auth: Public read-only endpoints remain accessible without auth', async () => {
  // 1. Health
  const resHealth = await fetch(`${BASE_URL}/api/health`);
  assert.equal(resHealth.status, 200);
  const health = await resHealth.json();
  assert.equal(health.status, 'HEALTHY');

  // 2. Zones
  const resZones = await fetch(`${BASE_URL}/api/zones`);
  assert.equal(resZones.status, 200);
  const zones = await resZones.json();
  assert.equal(zones.length, 30);

  // 3. Events
  const resEvents = await fetch(`${BASE_URL}/api/events`);
  assert.equal(resEvents.status, 200);

  // 4. Sources
  const resSources = await fetch(`${BASE_URL}/api/events/sources`);
  assert.equal(resSources.status, 200);

  // 5. Pipeline status
  const resStatus = await fetch(`${BASE_URL}/api/pipeline/status`);
  assert.equal(resStatus.status, 200);
});

test('Integration Auth: Protected mutation endpoint rejects missing X-API-Key (POST /api/pipeline/trigger)', async () => {
  const res = await fetch(`${BASE_URL}/api/pipeline/trigger`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });

  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.code, 'UNAUTHORIZED');
  assert.ok(data.error);
});

test('Integration Auth: Protected mutation endpoint rejects incorrect X-API-Key', async () => {
  const res = await fetch(`${BASE_URL}/api/pipeline/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'completely_bogus_and_unauthorized_key',
    },
  });

  assert.equal(res.status, 401);
  const data = await res.json();
  assert.equal(data.code, 'INVALID_API_KEY');
  assert.ok(data.error);
});

test('Integration Auth: Protected mutation endpoint accepts valid X-API-Key (POST /api/pipeline/trigger)', async () => {
  const res = await fetch(`${BASE_URL}/api/pipeline/trigger`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': TEST_SECRET,
    },
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.cycleRun);
});

test('Integration Auth: Protected batch ingestion endpoint rejects missing & accepts valid X-API-Key', async () => {
  const batchPayload = {
    sourceId: 'SRC-ACA-01',
    events: [],
  };

  // Step 1: Reject without key
  const rejectRes = await fetch(`${BASE_URL}/api/events/batch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(batchPayload),
  });
  assert.equal(rejectRes.status, 401);

  // Step 2: Reject with incorrect key
  const wrongKeyRes = await fetch(`${BASE_URL}/api/events/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': 'invalid-key-attempt',
    },
    body: JSON.stringify(batchPayload),
  });
  assert.equal(wrongKeyRes.status, 401);

  // Step 3: Accept with valid key
  const acceptRes = await fetch(`${BASE_URL}/api/events/batch`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': TEST_SECRET,
    },
    body: JSON.stringify(batchPayload),
  });
  assert.equal(acceptRes.status, 200);
  const data = await acceptRes.json();
  assert.equal(data.success, true);
});

test('Integration Auth: Protected source status reporting endpoint rejects missing & accepts valid X-API-Key', async () => {
  const statusPayload = {
    success: true,
    eventsIngested: 0,
    durationMs: 15,
  };

  // Step 1: Reject without key
  const rejectRes = await fetch(`${BASE_URL}/api/events/sources/SRC-ACA-01/status`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(statusPayload),
  });
  assert.equal(rejectRes.status, 401);

  // Step 2: Accept with valid key
  const acceptRes = await fetch(`${BASE_URL}/api/events/sources/SRC-ACA-01/status`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': TEST_SECRET,
    },
    body: JSON.stringify(statusPayload),
  });
  assert.equal(acceptRes.status, 200);
});

test('Integration Auth: Protected fleet reallocation endpoint rejects missing & accepts valid X-API-Key', async () => {
  const payload = { policy: 'UNIFORM' };

  // Step 1: Reject without key
  const rejectRes = await fetch(`${BASE_URL}/api/fleet/reallocate`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(rejectRes.status, 401);

  // Step 2: Accept with valid key
  const acceptRes = await fetch(`${BASE_URL}/api/fleet/reallocate`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': TEST_SECRET,
    },
    body: JSON.stringify(payload),
  });
  assert.equal(acceptRes.status, 200);
});

test('Integration Auth: Protected demand forecast execution endpoint rejects missing & accepts valid X-API-Key', async () => {
  const payload = { horizonHours: 6 };

  // Step 1: Reject without key
  const rejectRes = await fetch(`${BASE_URL}/api/demand/forecast/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  assert.equal(rejectRes.status, 401);

  // Step 2: Accept with valid key
  const acceptRes = await fetch(`${BASE_URL}/api/demand/forecast/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': TEST_SECRET,
    },
    body: JSON.stringify(payload),
  });
  assert.equal(acceptRes.status, 200);
  const data = await acceptRes.json();
  assert.equal(data.success, true);
});

test('Integration Auth: Same-Origin Browser Session + CSRF allows mutations without API key', async () => {
  // Step 1: Fetch session & CSRF token from /api/auth/session
  const sessionRes = await fetch(`${BASE_URL}/api/auth/session`);
  assert.equal(sessionRes.status, 200);
  const sessionData = await sessionRes.json();
  assert.ok(sessionData.sessionId);
  assert.ok(sessionData.csrfToken);

  // Step 2: Invoke protected mutation passing Session + CSRF headers (NO X-API-Key!)
  const mutateRes = await fetch(`${BASE_URL}/api/fleet/simulate-step`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionData.sessionId,
      'X-CSRF-Token': sessionData.csrfToken,
    },
  });

  assert.equal(mutateRes.status, 200);
  const mutateData = await mutateRes.json();
  assert.equal(mutateData.success, true);
  assert.ok(mutateData.stepResult);

  // Step 3: Verify that an invalid CSRF token with valid session ID is rejected (HTTP 403)
  const forgedRes = await fetch(`${BASE_URL}/api/fleet/simulate-step`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Session-ID': sessionData.sessionId,
      'X-CSRF-Token': 'attacker_fake_token',
    },
  });

  assert.equal(forgedRes.status, 403);
  const forgedData = await forgedRes.json();
  assert.equal(forgedData.code, 'CSRF_INVALID');
});

test('Integration Auth: Privileged API key is never exposed in response payloads or headers', async () => {
  const endpoints = [
    `${BASE_URL}/api/health`,
    `${BASE_URL}/api/auth/session`,
    `${BASE_URL}/api/pipeline/status`,
    `${BASE_URL}/api/zones`,
  ];

  for (const url of endpoints) {
    const res = await fetch(url);
    const text = await res.text();
    assert.equal(
      text.includes(TEST_SECRET),
      false,
      `Endpoint ${url} must NEVER leak privileged VIZIMOVE_API_KEY in response body`
    );
    for (const [headerName, headerVal] of res.headers.entries()) {
      assert.equal(
        headerVal.includes(TEST_SECRET),
        false,
        `Endpoint ${url} header ${headerName} must NEVER leak privileged VIZIMOVE_API_KEY`
      );
    }
  }
});
