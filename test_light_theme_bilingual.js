const http = require('http');
const { io } = require('socket.io-client');

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

async function runTests() {
  console.log('=== Starting Verification: Light Theme, Bilingual (Tamil/English), & Archives ===');

  // 1. Check API Info & CSBS Branding
  const infoRes = await fetchHttp('/api/info');
  const info = JSON.parse(infoRes.body);
  console.log(`[1] Department Name: "${info.departmentName}"`);
  if (!info.departmentName.includes('Computer Science and Business Systems')) {
    throw new Error('Department name should be CSBS');
  }

  // 2. Check Meetings History Endpoint
  const historyRes = await fetchHttp('/api/meetings/history');
  const history = JSON.parse(historyRes.body);
  console.log(`[2] Meetings History: ${history.length} archived meeting(s) found.`);
  if (!Array.isArray(history)) throw new Error('History should be an array');

  // 3. Check Bilingual CSV Export
  const csvRes = await fetchHttp('/api/export/csv');
  console.log(`[3] CSV Export: Status ${csvRes.status}, Headers present = ${csvRes.body.includes('Question (Tamil)')}`);
  if (!csvRes.body.includes('Question (Tamil)') || !csvRes.body.includes('Option (Tamil)')) {
    throw new Error('CSV should contain bilingual Tamil columns');
  }

  // 4. Connect Admin Socket and verify questions have Tamil
  const adminSocket = io(BASE_URL);
  let sessionData = null;
  await new Promise((resolve) => {
    adminSocket.on('connect', () => {
      adminSocket.emit('admin:join');
    });
    adminSocket.on('admin:init', (data) => {
      sessionData = data;
      console.log(`[4] Admin initialized: ${data.questions.length} questions loaded.`);
      const hasTamil = data.questions.some(q => q.textTa && q.textTa.length > 0);
      console.log(`    Tamil text present in questions: ${hasTamil}`);
      if (!hasTamil) throw new Error('Questions should contain Tamil translations');
      resolve();
    });
  });

  // 5. Connect Parent Socket and test bilingual receipt
  const parentSocket = io(BASE_URL);
  await new Promise((resolve) => {
    parentSocket.on('connect', () => {
      parentSocket.emit('parent:join', { voterToken: 'test_parent_v1', yearGroup: '2nd Year' });
    });
    parentSocket.on('session:state', (data) => {
      console.log(`[5] Parent joined successfully. Department: "${data.departmentName}"`);
      resolve();
    });
  });

  // 6. Launch Question and verify bilingual broadcast
  const qToLaunch = sessionData.questions[0];
  await new Promise((resolve) => {
    parentSocket.on('question:live', (data) => {
      console.log(`[6] Question live on parent client:`);
      console.log(`    EN: "${data.text.slice(0, 40)}..."`);
      console.log(`    TA: "${(data.textTa || '').slice(0, 40)}..."`);
      if (!data.textTa) throw new Error('Parent did not receive Tamil text');
      resolve();
    });

    adminSocket.emit('admin:launch_question', { questionId: qToLaunch.id });
  });

  // 7. Parent votes and verify tally
  await new Promise((resolve) => {
    adminSocket.on('poll:update', (data) => {
      if (data.questionId === qToLaunch.id) {
        console.log(`[7] Poll updated with live vote: Total votes = ${data.tallies.totalVotes}`);
        resolve();
      }
    });

    parentSocket.emit('parent:vote', {
      voterToken: 'test_parent_v1',
      questionId: qToLaunch.id,
      optionIndex: 0,
      yearGroup: '2nd Year'
    });
  });

  adminSocket.disconnect();
  parentSocket.disconnect();

  console.log('=== All Verification Checks PASSED Successfully! ===');
  process.exit(0);
}

runTests().catch(err => {
  console.error('Test Failed:', err);
  process.exit(1);
});
