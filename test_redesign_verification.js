const http = require('http');
const { io } = require('socket.io-client');
const fs = require('fs');

const PORT = 3000;
const BASE_URL = `http://localhost:${PORT}`;

function fetchHttp(urlPath) {
  return new Promise((resolve, reject) => {
    http.get(`${BASE_URL}${urlPath}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: data }));
    }).on('error', reject);
  });
}

function waitMs(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function runVerification() {
  console.log('====================================================');
  console.log('  STARTING CSBS REDESIGN COMPREHENSIVE TEST SUITE  ');
  console.log('====================================================\n');

  // 1. Verify Header & Landing Dashboard Requirements
  console.log('[Step 1] Verifying Header & Dashboard Structure...');
  const adminHtml = await fetchHttp('/admin.html');
  if (!adminHtml.body.includes('CSBS Parent–Teacher Meeting')) {
    throw new Error('Header title must be strictly "CSBS Parent–Teacher Meeting"');
  }
  if (adminHtml.body.includes('CSBS Parent–Teacher Meeting 2026') && adminHtml.body.includes('header-brand-title')) {
    throw new Error('Global header must NOT display 2026');
  }
  // Verify Dashboard does not have question elements
  if (adminHtml.body.includes('projector-question-text')) {
    throw new Error('Projector question must NOT be on landing dashboard');
  }
  console.log('✓ Header and Dashboard structure verified.\n');

  // 2. Connect Admin Socket
  console.log('[Step 2] Connecting Admin Socket & Initializing Meeting...');
  const adminSocket = io(BASE_URL);
  let adminInitData = null;

  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Admin init timeout')), 5000);
    adminSocket.on('connect', () => {
      adminSocket.emit('admin:join');
    });
    adminSocket.on('admin:init', (data) => {
      clearTimeout(timer);
      adminInitData = data;
      resolve();
    });
  });

  console.log(`✓ Admin connected. Meeting: "${adminInitData.stats.meeting.title}", Status: "${adminInitData.stats.meeting.status}"`);

  // Start fresh meeting to guarantee clean test state
  await new Promise((resolve) => {
    adminSocket.once('meeting:state_changed', (stats) => {
      resolve();
    });
    adminSocket.emit('admin:create_meeting', {
      title: 'CSBS Test Parent–Teacher Meeting 2026',
      academicYear: '2026',
      date: '2026-09-23',
      description: 'Automated Test Verification Session'
    });
  });
  console.log('✓ Clean meeting session created.\n');

  // 3. Connect 3 Parents:
  // Parent A -> 1st Year
  // Parent B -> 3rd Year
  // Parent C -> Final Year
  console.log('[Step 3] Connecting Parents and Selecting Years...');
  const parentASocket = io(BASE_URL);
  const parentBSocket = io(BASE_URL);
  const parentCSocket = io(BASE_URL);

  const tokenA = 'token_parent_A_' + Date.now();
  const tokenB = 'token_parent_B_' + Date.now();
  const tokenC = 'token_parent_C_' + Date.now();

  // Connect sockets
  await Promise.all([
    new Promise(r => parentASocket.on('connect', r)),
    new Promise(r => parentBSocket.on('connect', r)),
    new Promise(r => parentCSocket.on('connect', r))
  ]);

  // Verify parent receives state with no live question before admin launches
  let parentAInitialState = null;
  await new Promise((resolve) => {
    parentASocket.once('session:state', (st) => {
      parentAInitialState = st;
      resolve();
    });
    parentASocket.emit('parent:join', { voterToken: tokenA });
  });

  if (parentAInitialState.currentQuestion !== null) {
    throw new Error('Parent should NOT receive any question before admin launches!');
  }
  console.log('✓ Parent receives no questions before launch.');

  // Submit Years
  parentASocket.emit('parent:select_year', { voterToken: tokenA, yearGroup: '1st Year' });
  parentBSocket.emit('parent:select_year', { voterToken: tokenB, yearGroup: '3rd Year' });
  parentCSocket.emit('parent:select_year', { voterToken: tokenC, yearGroup: 'Final Year' });

  await waitMs(300);

  // Check attendance on server
  const currentMeetingRes = await fetchHttp('/api/meetings/current');
  const currentMeetingData = JSON.parse(currentMeetingRes.body);
  console.log('Attendance Verification:', currentMeetingData.attendance);

  if (currentMeetingData.attendance.total !== 3) {
    throw new Error(`Expected attendance 3, got ${currentMeetingData.attendance.total}`);
  }
  if (currentMeetingData.attendance.yearBreakdown['1st Year'] !== 1 ||
      currentMeetingData.attendance.yearBreakdown['3rd Year'] !== 1 ||
      currentMeetingData.attendance.yearBreakdown['Final Year'] !== 1) {
    throw new Error('Year breakdown does not match expected counts');
  }
  console.log('✓ Attendance by year correctly categorized and synchronized.\n');

  // Test Reconnect / Duplicate protection: Parent B reconnects with same token
  const parentBReconnect = io(BASE_URL);
  await new Promise(r => parentBReconnect.on('connect', r));
  parentBReconnect.emit('parent:join', { voterToken: tokenB, yearGroup: '3rd Year' });
  await waitMs(200);

  const checkDedup = JSON.parse((await fetchHttp('/api/meetings/current')).body);
  if (checkDedup.attendance.total !== 3) {
    throw new Error(`Duplicate participant detected on reconnect! Expected 3, got ${checkDedup.attendance.total}`);
  }
  console.log('✓ Reconnecting with same token does NOT increment attendance.\n');

  // 4. Admin previews Question 2 without launching
  console.log('[Step 4] Testing Question Preview Decoupling...');
  let parentReceivedPrematureQuestion = false;
  const prematureListener = () => { parentReceivedPrematureQuestion = true; };
  parentASocket.on('question:live', prematureListener);

  adminSocket.emit('admin:navigate_preview', { questionId: 'q2' });
  await waitMs(300);

  if (parentReceivedPrematureQuestion) {
    throw new Error('Admin preview navigation erroneously pushed question to parents!');
  }
  parentASocket.off('question:live', prematureListener);
  console.log('✓ Admin preview navigation does NOT affect live parent screen.\n');

  // 5. Admin Launches Question 1
  console.log('[Step 5] Admin launches Question 1...');
  let q1Received = false;
  parentASocket.once('question:live', (q) => {
    if (q.id === 'q1') q1Received = true;
  });

  adminSocket.emit('admin:launch_question', { questionId: 'q1' });
  await waitMs(400);

  if (!q1Received) throw new Error('Parent A did not receive live Question 1');
  console.log('✓ Parents received live Question 1 upon explicit launch.');

  // Votes for Question 1:
  // Parent A -> A (index 0)
  // Parent B -> B (index 1)
  // Parent C -> A (index 0)
  console.log('Submitting Q1 votes: A->A, B->B, C->A...');
  parentASocket.emit('parent:vote', { voterToken: tokenA, questionId: 'q1', optionIndex: 0 });
  parentBSocket.emit('parent:vote', { voterToken: tokenB, questionId: 'q1', optionIndex: 1 });
  parentCSocket.emit('parent:vote', { voterToken: tokenC, questionId: 'q1', optionIndex: 0 });

  await waitMs(400);

  let q1Stats = JSON.parse((await fetchHttp('/api/meetings/current')).body).tallies;
  console.log('Q1 Tallies after initial votes:');
  console.log('  All Years:', q1Stats.breakdown['All Years']);
  console.log('  1st Year:', q1Stats.breakdown['1st Year']);
  console.log('  3rd Year:', q1Stats.breakdown['3rd Year']);
  console.log('  Final Year:', q1Stats.breakdown['Final Year']);

  // Verify Initial tallies
  if (q1Stats.breakdown['All Years'][0] !== 2 || q1Stats.breakdown['All Years'][1] !== 1) {
    throw new Error('Q1 All Years tally incorrect');
  }
  if (q1Stats.breakdown['1st Year'][0] !== 1) throw new Error('1st Year tally incorrect');
  if (q1Stats.breakdown['3rd Year'][1] !== 1) throw new Error('3rd Year tally incorrect');
  if (q1Stats.breakdown['Final Year'][0] !== 1) throw new Error('Final Year tally incorrect');
  console.log('✓ Initial Q1 votes verified across all year groups.\n');

  // 6. Admin Launches Question 2
  console.log('[Step 6] Admin launches Question 2...');
  adminSocket.emit('admin:launch_question', { questionId: 'q2' });
  await waitMs(400);

  // Votes for Question 2:
  // Parent A -> C (index 2)
  // Parent B -> A (index 0)
  // Parent C -> D (index 3)
  console.log('Submitting Q2 votes: A->C, B->A, C->D...');
  parentASocket.emit('parent:vote', { voterToken: tokenA, questionId: 'q2', optionIndex: 2 });
  parentBSocket.emit('parent:vote', { voterToken: tokenB, questionId: 'q2', optionIndex: 0 });
  parentCSocket.emit('parent:vote', { voterToken: tokenC, questionId: 'q2', optionIndex: 3 });
  await waitMs(400);

  const q2Stats = JSON.parse((await fetchHttp('/api/meetings/current')).body).tallies;
  if (q2Stats.breakdown['All Years'][2] !== 1 || q2Stats.breakdown['All Years'][0] !== 1 || q2Stats.breakdown['All Years'][3] !== 1) {
    throw new Error('Q2 tallies incorrect');
  }
  console.log('✓ Q2 votes recorded successfully.\n');

  // 7. CRITICAL TEST: Parent B navigates back to Question 1 and changes answer from B (index 1) to C (index 2)
  console.log('[Step 7] Testing In-Place Answer Update for Parent B (Q1: B -> C)...');
  parentBSocket.emit('parent:vote', { voterToken: tokenB, questionId: 'q1', optionIndex: 2 });
  await waitMs(400);

  // Re-fetch current meeting state and session state
  const sessionState = JSON.parse(fs.readFileSync('data/session_state.json', 'utf8'));

  // Check response entries for Parent B on Q1
  const bResponses = Object.values(sessionState.responses).filter(
    r => r.participantId === tokenB && r.questionId === 'q1'
  );

  if (bResponses.length !== 1) {
    throw new Error(`Expected exactly 1 response record for Parent B on Q1, found ${bResponses.length}! Duplicate responses exist!`);
  }
  if (bResponses[0].selectedOption !== 2) {
    throw new Error(`Expected Parent B option to be updated to 2 (C), found ${bResponses[0].selectedOption}`);
  }
  console.log('✓ Exactly one response record exists for Parent B on Q1 (Option C). Zero duplicates.');

  // Verify updated tallies on Q1
  adminSocket.emit('admin:launch_question', { questionId: 'q1' });
  await waitMs(300);

  const q1Updated = JSON.parse((await fetchHttp('/api/meetings/current')).body).tallies;
  console.log('Q1 Updated Tallies:');
  console.log('  All Years (Option A: 2, Option B: 0, Option C: 1):', q1Updated.breakdown['All Years']);
  console.log('  3rd Year (Option B: 0, Option C: 1):', q1Updated.breakdown['3rd Year']);

  if (q1Updated.breakdown['All Years'][1] !== 0 || q1Updated.breakdown['All Years'][2] !== 1) {
    throw new Error('Q1 All Years did not properly deduct Option B and add Option C!');
  }
  if (q1Updated.breakdown['3rd Year'][1] !== 0 || q1Updated.breakdown['3rd Year'][2] !== 1) {
    throw new Error('Q1 3rd Year did not properly update from Option B to Option C!');
  }
  console.log('✓ Year-categorized tallies immediately and accurately updated.\n');

  // 8. Test Export CSV Data
  console.log('[Step 8] Verifying CSV Export API...');
  const csvRes = await fetchHttp('/api/export/csv');
  const csvText = csvRes.body;

  if (!csvText.includes('CSBS Parent-Teacher Meeting Polling Report')) {
    throw new Error('CSV report title missing');
  }
  if (!csvText.includes(tokenB)) {
    throw new Error('Parent B token missing in CSV');
  }

  // Ensure Parent B has only ONE entry for Q1 in the CSV and it contains Option C
  const lines = csvText.split('\r\n');
  const bLinesQ1 = lines.filter(l => l.includes(tokenB) && l.includes('"Q1"'));
  if (bLinesQ1.length !== 1) {
    throw new Error(`Expected 1 CSV row for Parent B on Q1, found ${bLinesQ1.length}`);
  }
  if (!bLinesQ1[0].includes('"C"')) {
    throw new Error(`Parent B CSV row should contain updated option "C", found: ${bLinesQ1[0]}`);
  }
  console.log('✓ CSV export contains latest answer only with zero duplicates.\n');

  // 9. Test Settings Persistence
  console.log('[Step 9] Verifying Settings API & Persistence...');
  const testSettingsUpdate = await new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      defaultMeetingTitle: 'CSBS Annual Academic PTM',
      allowAnswerChanges: true,
      showTamilTranslation: false
    });

    const req = http.request(`${BASE_URL}/api/settings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(JSON.parse(d)));
    });
    req.on('error', reject);
    req.write(postData);
    req.end();
  });

  if (!testSettingsUpdate.success || testSettingsUpdate.settings.defaultMeetingTitle !== 'CSBS Annual Academic PTM') {
    throw new Error('Settings update failed');
  }
  console.log('✓ Settings persisted and updated successfully.\n');

  // Cleanup connections
  adminSocket.disconnect();
  parentASocket.disconnect();
  parentBSocket.disconnect();
  parentCSocket.disconnect();
  parentBReconnect.disconnect();

  console.log('====================================================');
  console.log('  ALL COMPREHENSIVE VERIFICATION TESTS PASSED 100%  ');
  console.log('====================================================\n');
}

runVerification().catch(err => {
  console.error('\n❌ VERIFICATION TEST FAILED:', err);
  process.exit(1);
});
