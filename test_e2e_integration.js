const http = require('http');
const { io } = require('socket.io-client');

const PORT = 3001;
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

async function runE2ETests() {
  console.log('--- Starting Comprehensive E2E Tests ---');

  // 1. Verify Parent HTML
  const parentRes = await fetchHttp('/');
  console.log(`[1] Parent Page: HTTP ${parentRes.status} (Length: ${parentRes.body.length} bytes)`);
  if (!parentRes.body.includes('PTM Live Polling - Parent Portal')) throw new Error('Parent page title missing');

  // 2. Verify Admin HTML
  const adminRes = await fetchHttp('/admin.html');
  console.log(`[2] Admin Dashboard: HTTP ${adminRes.status} (Length: ${adminRes.body.length} bytes)`);
  if (!adminRes.body.includes('HOD Projector & Admin Dashboard')) throw new Error('Admin page title missing');

  // 3. Verify API Info & QR Code
  const infoRes = await fetchHttp('/api/info');
  const info = JSON.parse(infoRes.body);
  console.log(`[3] API Info: Join URL = ${info.joinUrl}, QR Present = ${info.qrDataUrl.startsWith('data:image/png;base64')}`);
  if (!info.qrDataUrl) throw new Error('QR data URL missing');

  // 4. Verify Socket.io Polling & Real-time Flow
  const adminSocket = io(BASE_URL);
  const parentSocket = io(BASE_URL);

  let adminReceivedInit = false;
  let adminReceivedVoteUpdate = false;
  let parentReceivedQuestion = false;
  let parentVoteConfirmed = false;

  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Socket test timed out')), 8000);

    adminSocket.on('connect', () => {
      adminSocket.emit('admin:join');
    });

    adminSocket.on('admin:init', (data) => {
      adminReceivedInit = true;
      console.log(`[4] Admin Socket Connected & Initialized. Department: "${data.departmentName}"`);

      // Admin launches Question 2
      const targetQ = data.questions[1] || data.questions[0];
      adminSocket.emit('admin:launch_question', { questionId: targetQ.id });
    });

    parentSocket.on('connect', () => {
      // Parent joins as 2nd Year
      parentSocket.emit('parent:join', { voterToken: 'e2e_parent_token_001', yearGroup: '2nd Year' });
    });

    parentSocket.on('question:live', (q) => {
      parentReceivedQuestion = true;
      console.log(`[5] Parent received live question: "${q.text.slice(0, 45)}..."`);

      // Parent votes for Option 1 (index 1)
      parentSocket.emit('parent:vote', {
        voterToken: 'e2e_parent_token_001',
        questionId: q.id,
        optionIndex: 1,
        yearGroup: '2nd Year'
      });
    });

    parentSocket.on('parent:vote_confirmed', (res) => {
      parentVoteConfirmed = true;
      console.log(`[6] Parent vote confirmed for option index: ${res.optionIndex}`);
    });

    adminSocket.on('poll:update', (update) => {
      if (update.tallies && update.tallies.breakdown['2nd Year'][1] >= 1) {
        adminReceivedVoteUpdate = true;
        console.log(`[7] Admin live chart received vote update. Option 1 votes in 2nd Year: ${update.tallies.breakdown['2nd Year'][1]}`);
        clearTimeout(timeout);
        resolve();
      }
    });
  });

  // 5. Test Question Management: Add New Question
  await new Promise((resolve) => {
    adminSocket.on('admin:questions_updated', (data) => {
      const added = data.questions.find(q => q.text === 'E2E Test Question: Would you recommend this department?');
      if (added) {
        console.log(`[8] Admin Question Bank: Successfully added new question (${added.id})`);
        resolve();
      }
    });

    adminSocket.emit('admin:add_question', {
      text: 'E2E Test Question: Would you recommend this department?',
      options: ['Definitely Yes', 'Probably Yes', 'Uncertain', 'No']
    });
  });

  // 6. Verify Summary Report API
  const summaryRes = await fetchHttp('/api/session/summary');
  const summaryData = JSON.parse(summaryRes.body);
  console.log(`[9] Session Summary: ${summaryData.results.length} total questions in report`);
  if (!summaryData.results || summaryData.results.length === 0) throw new Error('Summary report empty');

  // 7. Verify CSV Export API
  const csvRes = await fetchHttp('/api/export/csv');
  console.log(`[10] CSV Export: Status ${csvRes.status}, Content-Type: ${csvRes.headers['content-type']}`);
  if (!csvRes.body.includes('Parent-Teachers Meeting Polling Report')) throw new Error('CSV content invalid');

  adminSocket.disconnect();
  parentSocket.disconnect();

  console.log('\n>>> ALL 10 E2E INTEGRATION TESTS PASSED WITH 100% SUCCESS! <<<\n');
}

runE2ETests().catch(err => {
  console.error('E2E Test Error:', err);
  process.exit(1);
});
