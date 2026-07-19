#!/usr/bin/env node

/**
 * Smoke Test Script for Nandibaag Backend
 * 
 * Runs against the LOCAL running backend and validates all critical endpoints.
 * Uses built-in fetch (Node 18+). No external test framework needed.
 * 
 * Usage: npm run smoke-test
 * Prerequisites: Backend must be running on the configured PORT
 */

require('dotenv').config();

const BASE_URL = `http://localhost:${process.env.PORT || 7000}`;
const ADMIN_EMAIL = process.env.ADMIN_DEFAULT_EMAIL;
const ADMIN_PASSWORD = process.env.ADMIN_DEFAULT_PASSWORD;

// ── Test Results Tracking ──────────────────────────────────────────────
const results = [];

function record(name, passed, detail = '') {
  results.push({ name, passed, detail });
  const icon = passed ? '✅' : '❌';
  const suffix = detail ? ` — ${detail}` : '';
  console.log(`  ${icon} ${name}${suffix}`);
}

// ── Helper: fetch with timeout ─────────────────────────────────────────
async function safeFetch(url, options = {}, timeoutMs = 10000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...options, signal: controller.signal });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ── Individual Tests ───────────────────────────────────────────────────

async function testHealthEndpoint() {
  try {
    const res = await safeFetch(`${BASE_URL}/health`);
    const body = await res.json();
    const ok = res.status === 200 && body.status === 'ok';
    record('GET /health → 200 + {status:"ok"}', ok, `status=${res.status}, body.status="${body.status}"`);
    return ok;
  } catch (err) {
    record('GET /health → 200 + {status:"ok"}', false, err.message);
    return false;
  }
}

async function testLoginSuccess() {
  try {
    const res = await safeFetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: ADMIN_PASSWORD })
    });
    const body = await res.json();
    const hasToken = typeof body.token === 'string' && body.token.length > 0;
    const ok = res.status === 200 && body.success === true && hasToken;
    record('POST /api/auth/login (valid creds) → 200 + token', ok, `status=${res.status}, hasToken=${hasToken}`);
    return ok ? body.token : null;
  } catch (err) {
    record('POST /api/auth/login (valid creds) → 200 + token', false, err.message);
    return null;
  }
}

async function testAuthMe(token) {
  try {
    const res = await safeFetch(`${BASE_URL}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await res.json();
    const ok = res.status === 200 && body.success === true && body.user && body.user.email === ADMIN_EMAIL;
    record('GET /api/auth/me → admin user', ok, `status=${res.status}, email=${body.user?.email || 'N/A'}`);
    return ok;
  } catch (err) {
    record('GET /api/auth/me → admin user', false, err.message);
    return false;
  }
}

async function testDashboardStats(token) {
  try {
    const res = await safeFetch(`${BASE_URL}/api/dashboard/stats`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await res.json();
    const ok = res.status === 200 && body.success === true;
    record('GET /api/dashboard/stats → 200', ok, `status=${res.status}`);
    return ok;
  } catch (err) {
    record('GET /api/dashboard/stats → 200', false, err.message);
    return false;
  }
}

async function testWhatsappSessions(token) {
  try {
    const res = await safeFetch(`${BASE_URL}/api/whatsapp/sessions`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await res.json();
    const ok = res.status === 200 && body.success === true;
    record('GET /api/whatsapp/sessions → 200', ok, `status=${res.status}`);
    return ok;
  } catch (err) {
    record('GET /api/whatsapp/sessions → 200', false, err.message);
    return false;
  }
}

async function testSettings(token) {
  try {
    const res = await safeFetch(`${BASE_URL}/api/settings`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    const body = await res.json();
    const ok = res.status === 200 && body.success === true;
    record('GET /api/settings → 200', ok, `status=${res.status}`);
    return ok;
  } catch (err) {
    record('GET /api/settings → 200', false, err.message);
    return false;
  }
}

async function testLoginWrongPassword() {
  try {
    const res = await safeFetch(`${BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ADMIN_EMAIL, password: 'WRONG_PASSWORD_12345' })
    });
    const body = await res.json();
    const ok = res.status === 401 && body.success === false;
    record('POST /api/auth/login (wrong password) → 401', ok, `status=${res.status}`);
    return ok;
  } catch (err) {
    record('POST /api/auth/login (wrong password) → 401', false, err.message);
    return false;
  }
}

async function testRateLimiting() {
  // The authLimiter allows 5 requests per 15 min window.
  // We already used up some attempts in earlier tests (1 success + 1 wrong password).
  // Send enough rapid wrong-password requests to exceed the limit.
  // We'll send 6 rapid attempts with wrong creds; at least one should get 429.
  
  console.log('\n  ⏳ Rate-limit test: sending 6 rapid wrong-password requests...');
  
  const statuses = [];
  for (let i = 0; i < 6; i++) {
    try {
      const res = await safeFetch(`${BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: ADMIN_EMAIL, password: `WRONG_${i}` })
      });
      statuses.push(res.status);
    } catch (err) {
      statuses.push(`ERROR: ${err.message}`);
    }
  }
  
  const has429 = statuses.includes(429);
  record(
    'Rate-limit: rapid login attempts → at least one 429',
    has429,
    `statuses: [${statuses.join(', ')}]`
  );
  return has429;
}

// ── Main ───────────────────────────────────────────────────────────────

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════════╗');
  console.log('║          🏨 Nandibaag Backend — Smoke Test Suite            ║');
  console.log('╚══════════════════════════════════════════════════════════════╝');
  console.log(`  Target: ${BASE_URL}`);
  console.log(`  Admin:  ${ADMIN_EMAIL}`);
  console.log('');

  // Pre-flight: check server is reachable
  try {
    await safeFetch(`${BASE_URL}/health`, {}, 5000);
  } catch {
    console.log('  ❌ Cannot reach server at ' + BASE_URL);
    console.log('     Make sure the backend is running: npm run dev');
    console.log('');
    process.exit(1);
  }

  console.log('── Endpoint Tests ──────────────────────────────────────────');
  console.log('');

  // 1. Health
  await testHealthEndpoint();

  // 2. Login (valid)
  const token = await testLoginSuccess();
  if (!token) {
    console.log('\n  ⛔ Cannot proceed without a valid token. Remaining tests skipped.\n');
    printSummary();
    process.exit(1);
  }

  // 3. Auth me
  await testAuthMe(token);

  // 4. Dashboard stats
  await testDashboardStats(token);

  // 5. WhatsApp sessions
  await testWhatsappSessions(token);

  // 6. Settings
  await testSettings(token);

  // 7. Wrong password → 401
  await testLoginWrongPassword();

  // 8. Rate limiting
  await testRateLimiting();

  console.log('');
  printSummary();
}

function printSummary() {
  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log('── Summary ─────────────────────────────────────────────────');
  console.log('');
  console.log(`  Total: ${total}  |  ✅ Passed: ${passed}  |  ❌ Failed: ${failed}`);
  console.log('');

  if (failed > 0) {
    console.log('  Failed tests:');
    results.filter(r => !r.passed).forEach(r => {
      console.log(`    ❌ ${r.name}  →  ${r.detail}`);
    });
    console.log('');
  }

  const exitCode = failed > 0 ? 1 : 0;
  console.log(failed === 0
    ? '  🎉 All smoke tests passed! Backend is healthy.\n'
    : '  ⚠️  Some tests failed. Fix the issues above before proceeding.\n'
  );
  process.exit(exitCode);
}

main().catch(err => {
  console.error('Fatal error in smoke test:', err);
  process.exit(1);
});
