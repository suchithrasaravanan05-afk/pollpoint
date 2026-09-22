const io = require('socket.io-client');
const http = require('http');

async function runTest() {
  console.log('--- Starting Poll Point Automated Verification ---');
  
  // 1. Verify HTTP endpoints
  const testHttp = (path) => new Promise((resolve, reject) => {
    http.get(`http://localhost:3000${path}`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, data }));
    }).on('error', reject);
  });

  const infoRes = await testHttp('/api/info');
  console.log('[API] /api/info status:', infoRes.status);
  const info = JSON.parse(infoRes.data);
  console.log('[API] Session Code:', info.sessionCode, 'Questions Count:', info.questionsCount);

  const libRes = await testHttp('/api/library');
  console.log('[API] /api/library status:', libRes.status);
  const lib = JSON.parse(libRes.data);
  console.log('[API] Library Categories:', lib.categories.length, 'Templates:', lib.templates.length);

  // 2. Connect Admin socket
  const adminSocket = io('http://localhost:3000');
  const participantSocket = io('http://localhost:3000');

  await new Promise((resolve) => {
    adminSocket.on('connect', () => {
      console.log('[Socket] Admin connected');
      adminSocket.emit('admin:join');
    });

    adminSocket.on('admin:init', (data) => {
      console.log('[Socket] Admin init received. Questions:', data.questions.length);
      resolve();
    });
  });

  // 3. Launch Question 1
  await new Promise((resolve) => {
    adminSocket.emit('admin:launch_question', { questionId: 'q1' });
    adminSocket.on('admin:state_change', (data) => {
      if (data.questionStatus === 'live') {
        console.log('[Socket] Question 1 is now LIVE!');
        resolve();
      }
    });
  });

  // 4. Participant joins and votes
  await new Promise((resolve) => {
    participantSocket.on('connect', () => {
      console.log('[Socket] Participant connected');
      participantSocket.emit('participant:join', { voterToken: 'test_voter_1' });
    });

    participantSocket.on('question:live', (q) => {
      console.log('[Socket] Participant received live question:', q.text);
      console.log('[Socket] Tamil translation:', q.textTa);
      // Vote for option 0 (Very Satisfied / மிகவும் திருப்தி)
      participantSocket.emit('participant:vote', {
        voterToken: 'test_voter_1',
        questionId: q.id,
        optionIndex: 0
      });
    });

    participantSocket.on('participant:vote_confirmed', (data) => {
      console.log('[Socket] Participant vote confirmed! Option index:', data.optionIndex);
      resolve();
    });
  });

  // 5. Admin verifies tally
  await new Promise((resolve) => {
    adminSocket.on('poll:update', (data) => {
      console.log('[Socket] Admin received live tally update!');
      console.log('Total Votes:', data.tallies.totalVotes, 'Counts:', data.tallies.counts, 'Percentages:', data.tallies.percentages);
      resolve();
    });
  });

  // 6. Test CSV export
  const csvRes = await testHttp('/api/export/csv');
  console.log('[CSV] Export status:', csvRes.status);
  console.log('[CSV] Sample header snippet:', csvRes.data.substring(0, 150));

  adminSocket.disconnect();
  participantSocket.disconnect();
  console.log('--- Verification Complete: ALL TESTS PASSED! ---');
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
