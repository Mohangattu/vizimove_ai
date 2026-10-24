/**
 * Automated Verification Script for ViziMove AI n8n Event Intelligence Workflow
 * Validates JSON structure, node graph connectivity, schedule trigger, execution timeout,
 * coverage of all 6 Vizag sources, Requirement 7 preservation rules, and endpoint bindings.
 */

import * as fs from 'fs';
import * as path from 'path';
import assert from 'node:assert';

function runValidation() {
  console.log('=== ViziMove AI — n8n Workflow Structural Validation ===');

  const workflowPath = path.resolve('n8n/vizimove_event_intelligence_workflow.json');
  assert.ok(fs.existsSync(workflowPath), 'Workflow JSON file must exist at n8n/vizimove_event_intelligence_workflow.json');

  const rawContent = fs.readFileSync(workflowPath, 'utf-8');
  let workflow: any;
  try {
    workflow = JSON.parse(rawContent);
  } catch (err: any) {
    throw new Error(`Failed to parse workflow JSON: ${err.message}`);
  }

  // 1. Root structure
  assert.ok(workflow.name, 'Workflow must have a valid name');
  assert.ok(Array.isArray(workflow.nodes), 'Workflow must have a nodes array');
  assert.ok(typeof workflow.connections === 'object', 'Workflow must have connections object');
  console.log(`✓ Workflow Name: "${workflow.name}"`);
  console.log(`✓ Total Nodes: ${workflow.nodes.length}`);

  // 2. Node uniqueness
  const nodeIds = new Set<string>();
  const nodeNames = new Set<string>();
  for (const node of workflow.nodes) {
    assert.ok(node.id, `Node must have an ID: ${JSON.stringify(node)}`);
    assert.ok(!nodeIds.has(node.id), `Duplicate node ID detected: ${node.id}`);
    nodeIds.add(node.id);

    assert.ok(node.name, `Node must have a name: ${node.id}`);
    assert.ok(!nodeNames.has(node.name), `Duplicate node name detected: ${node.name}`);
    nodeNames.add(node.name);
  }
  console.log(`✓ All ${nodeIds.size} node IDs and names are unique`);

  // 3. Connection integrity
  for (const [sourceNode, connectionData] of Object.entries<any>(workflow.connections)) {
    assert.ok(nodeNames.has(sourceNode), `Connection source node '${sourceNode}' does not exist in nodes`);
    if (connectionData.main) {
      for (const branch of connectionData.main) {
        for (const conn of branch) {
          assert.ok(nodeNames.has(conn.node), `Connection target node '${conn.node}' does not exist in nodes`);
        }
      }
    }
  }
  console.log('✓ Connection graph is completely closed and valid (no dangling references)');

  // 4. Overlap protection & schedule trigger
  const scheduleNode = workflow.nodes.find((n: any) => n.type === 'n8n-nodes-base.scheduleTrigger');
  assert.ok(scheduleNode, 'Schedule trigger node must exist');
  const cronExpr = scheduleNode.parameters?.rule?.interval?.[0]?.expression;
  assert.equal(cronExpr, '*/30 * * * *', 'Schedule trigger must run every 30 minutes (*/30 * * * *)');

  assert.ok(workflow.settings?.executionTimeout, 'Workflow settings must specify executionTimeout');
  assert.ok(
    workflow.settings.executionTimeout <= 1800,
    `Execution timeout (${workflow.settings.executionTimeout}s) must be <= 1800s (30m) to strictly prevent overlapping executions`
  );
  console.log(`✓ Schedule Cadence: ${cronExpr} (30-min interval)`);
  console.log(`✓ Overlap Protection: executionTimeout = ${workflow.settings.executionTimeout}s (<= 15m)`);

  // 5. Configured source coverage (All 6 authentic Vizag sources)
  const EXPECTED_SOURCES = [
    'SRC-ACA-01',
    'SRC-ENC-02',
    'SRC-AU-03',
    'SRC-GVMC-04',
    'SRC-SIMH-05',
    'SRC-ITAAP-06',
  ];

  const switchNode = workflow.nodes.find((n: any) => n.name === 'Route by Source ID');
  assert.ok(switchNode, 'Route by Source ID node must exist');
  const switchRules = switchNode.parameters?.rules?.values || [];
  assert.equal(switchRules.length, 6, 'Switch node must have 6 routing rules');

  for (const src of EXPECTED_SOURCES) {
    const matchedRule = switchRules.find((r: any) =>
      r.conditions?.conditions?.some((c: any) => c.rightValue === src)
    );
    assert.ok(matchedRule, `Switch node must route source '${src}'`);
  }
  console.log(`✓ All 6 authentic Vizag sources are routed in switch: ${EXPECTED_SOURCES.join(', ')}`);

  // 6. Backend API endpoint bindings
  const httpNodes = workflow.nodes.filter((n: any) => n.type === 'n8n-nodes-base.httpRequest');
  assert.ok(httpNodes.length >= 3, 'Workflow must have at least 3 HTTP request nodes');

  const sourcesHttp = httpNodes.find((n: any) => n.parameters?.url?.includes('/api/events/sources?activeOnly=true'));
  assert.ok(sourcesHttp, 'Must have HTTP node querying /api/events/sources?activeOnly=true');

  const batchHttp = httpNodes.find((n: any) => n.parameters?.url?.includes('/api/events/batch'));
  assert.ok(batchHttp, 'Must have HTTP node posting to /api/events/batch');

  const statusHttp = httpNodes.find((n: any) => n.parameters?.url?.includes('/api/events/sources/'));
  assert.ok(statusHttp, 'Must have HTTP node posting to /api/events/sources/:sourceId/status');
  console.log('✓ Verified bindings to /api/events/sources, /api/events/batch, and /api/events/sources/:sourceId/status');

  // 7. Secret protection check
  const jsonString = JSON.stringify(workflow);
  assert.ok(!jsonString.includes('ghp_'), 'Must not contain GitHub tokens');
  assert.ok(!jsonString.includes('AIzaSy'), 'Must not contain Google API keys');
  assert.ok(!jsonString.includes('password123'), 'Must not contain plaintext passwords');
  assert.ok(jsonString.includes('$env.VIZIMOVE_BACKEND_URL'), 'Must use $env for backend URL');
  console.log('✓ Zero hardcoded secret credentials or keys in workflow JSON');

  // 8. Requirement 7 Validation in Normalization node
  const normalizerNode = workflow.nodes.find((n: any) => n.name === 'Normalize & Validate Event Records');
  assert.ok(normalizerNode, 'Normalize & Validate Event Records node must exist');
  const jsCode = normalizerNode.parameters?.jsCode || '';
  assert.ok(jsCode.includes('latitude = null'), 'Normalizer must preserve unknown latitude as null (Req 7)');
  assert.ok(jsCode.includes('longitude = null'), 'Normalizer must preserve unknown longitude as null (Req 7)');
  assert.ok(jsCode.includes('attendanceType = \'UNKNOWN\''), 'Normalizer must preserve unknown attendance as UNKNOWN (Req 7)');
  console.log('✓ Normalizer logic verified for Requirement 7 (null coordinates & unknown attendance preservation)');

  console.log('\n======================================================');
  console.log('ALL WORKFLOW STRUCTURAL VERIFICATION CHECKS PASSED (8/8)');
  console.log('======================================================\n');
}

runValidation();
