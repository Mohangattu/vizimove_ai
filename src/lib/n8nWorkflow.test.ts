/**
 * Automated Verification Suite for n8n Workflow & Ingestion API Integration
 * Runs natively via Node.js test runner (`node --test`).
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { persistentStore } from '../db/store.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const WORKFLOW_PATH = path.resolve(__dirname, '../../n8n/vizimove_event_intelligence_workflow.json');
const PAYLOADS_PATH = path.resolve(__dirname, '../../n8n/example_payloads.json');

test('n8n Workflow: JSON file exists and parses as valid JSON', () => {
  assert.ok(fs.existsSync(WORKFLOW_PATH), 'Workflow JSON must exist at n8n/vizimove_event_intelligence_workflow.json');
  const raw = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
  const parsed = JSON.parse(raw);
  assert.equal(typeof parsed, 'object');
  assert.equal(parsed.name, 'ViziMove AI — Automated Event Intelligence Ingestion Pipeline (30-Minute)');
});

test('n8n Workflow: Structural integrity, nodes, connections, and overlap prevention settings', () => {
  const raw = fs.readFileSync(WORKFLOW_PATH, 'utf-8');
  const wf = JSON.parse(raw);

  // Settings
  assert.equal(wf.settings.executionTimeout, 900, 'Execution timeout must be 900 seconds (15 min) to prevent overlapping 30-min runs');
  assert.equal(wf.active, false, 'Workflow must be inactive by default until activated in live n8n instance');

  // Node existence
  const nodeNames = wf.nodes.map((n: any) => n.name);
  assert.ok(nodeNames.includes('Every 30 Minutes Schedule Trigger'));
  assert.ok(nodeNames.includes('Fetch Enabled Sources'));
  assert.ok(nodeNames.includes('Route by Source ID'));
  assert.ok(nodeNames.includes('Normalize & Validate Event Records'));
  assert.ok(nodeNames.includes('POST Validated Batch to Backend'));
  assert.ok(nodeNames.includes('Report Source Status & Health'));

  // All 6 sources represented
  assert.ok(nodeNames.includes('Collect ACA Fixtures (SRC-ACA-01)'));
  assert.ok(nodeNames.includes('Collect ENC Releases (SRC-ENC-02)'));
  assert.ok(nodeNames.includes('Collect AU Gazette (SRC-AU-03)'));
  assert.ok(nodeNames.includes('Collect GVMC Trade Expos (SRC-GVMC-04)'));
  assert.ok(nodeNames.includes('Collect Simhachalam Bulletin (SRC-SIMH-05)'));
  assert.ok(nodeNames.includes('Collect ITAAP Conclaves (SRC-ITAAP-06)'));

  // Connection integrity: every connected node must exist in nodes array
  const nodeNameSet = new Set(nodeNames);
  for (const [sourceNode, targets] of Object.entries(wf.connections)) {
    assert.ok(nodeNameSet.has(sourceNode), `Connection source node '${sourceNode}' must exist in nodes`);
    const mainOutputs = (targets as any).main || [];
    for (const outputGroup of mainOutputs) {
      for (const target of outputGroup) {
        assert.ok(nodeNameSet.has(target.node), `Connection target node '${target.node}' must exist in nodes`);
      }
    }
  }

  // Security: No hardcoded secrets or credentials
  assert.ok(!raw.includes('secret_'), 'Must not contain hardcoded secret tokens');
  assert.ok(!raw.includes('password'), 'Must not contain hardcoded passwords');
  assert.ok(raw.includes('$env.VIZIMOVE_BACKEND_URL'), 'Must use environment variables for backend URL');
});

test('n8n Payloads: Example payloads file exists and conforms to contract', () => {
  assert.ok(fs.existsSync(PAYLOADS_PATH));
  const raw = fs.readFileSync(PAYLOADS_PATH, 'utf-8');
  const payloads = JSON.parse(raw);
  assert.ok(Array.isArray(payloads.sources));
  assert.ok(payloads.sources.length >= 4);

  // Check Requirement 7 preservation in example payloads
  const gvmcPayload = payloads.sources.find((s: any) => s.sourceId === 'SRC-GVMC-04');
  assert.ok(gvmcPayload);
  assert.equal(gvmcPayload.normalizedContract.latitude, null, 'Coordinates must be null when unknown');
  assert.equal(gvmcPayload.normalizedContract.longitude, null, 'Coordinates must be null when unknown');
  assert.equal(gvmcPayload.normalizedContract.estimatedAttendance, null, 'Attendance must be null when unknown');
  assert.equal(gvmcPayload.normalizedContract.attendanceType, 'UNKNOWN');
});

test('Backend Ingestion API: Batch ingestion endpoint (/api/events/batch) handles n8n payload correctly', async () => {
  const sampleBatch = {
    sourceId: 'SRC-ACA-01',
    events: [
      {
        sourceEventId: 'T20-VIZAG-CHAMPIONSHIP-2026',
        name: 'Andhra Premier League T20 Finals',
        venueName: 'ACA-VDCA International Cricket Stadium',
        eventType: 'Sports',
        latitude: 17.8085,
        longitude: 83.3542,
        associatedZoneId: 'VZ-06',
        startTime: '2026-11-25T18:30:00.000Z',
        endTime: '2026-11-25T22:30:00.000Z',
        estimatedAttendance: 25000,
        attendanceType: 'CONFIRMED',
        status: 'UPCOMING',
        radiusKm: 6.5,
        peakDemandMultiplier: 1.6,
      },
    ],
    metadata: {
      workflowExecutionId: 'SIMULATED-N8N-EXEC-01',
      ingestedVia: 'n8n-automated-test',
    },
  };

  // Direct fetch against local backend with valid X-API-Key header
  const apiKey = process.env.VIZIMOVE_API_KEY || 'vizimove_secret_api_key_example';
  const res = await fetch('http://localhost:3000/api/events/batch', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(sampleBatch),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.equal(data.sourceId, 'SRC-ACA-01');
  assert.equal(data.totalProcessed, 1);
  assert.ok(data.eventsIngested >= 0);
  assert.ok(Array.isArray(data.processedEvents));

  // Verify persistence via server API
  const getRes = await fetch('http://localhost:3000/api/events/EVT-SRC-ACA-01-T20-VIZAG-CHAMPIONSHIP-2026');
  assert.equal(getRes.status, 200);
  const getPayload = await getRes.json();
  assert.ok(getPayload.event);
  assert.equal(getPayload.event.name, 'Andhra Premier League T20 Finals');
  assert.equal(getPayload.event.associatedZoneId, 'VZ-06');
});

test('Backend Ingestion API: Source status update endpoint (/api/events/sources/:sourceId/status)', async () => {
  const statusPayload = {
    success: true,
    eventsIngested: 1,
    eventsUpdated: 0,
    eventsSkipped: 0,
    durationMs: 420,
    errors: [],
  };

  const apiKey = process.env.VIZIMOVE_API_KEY || 'vizimove_secret_api_key_example';
  const res = await fetch('http://localhost:3000/api/events/sources/SRC-ACA-01/status', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': apiKey,
    },
    body: JSON.stringify(statusPayload),
  });

  assert.equal(res.status, 200);
  const data = await res.json();
  assert.equal(data.success, true);
  assert.ok(data.source);
  assert.equal(data.source.sourceId, 'SRC-ACA-01');
  assert.ok(data.source.lastCheckedAt);
  assert.equal(data.source.failureCount, 0);
});
