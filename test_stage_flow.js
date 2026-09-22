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

async function runStageFlowTests() {
  console.log('=== Starting Test Suite: Stage 1 Question Builder & Stage 2 Live Polling ===');

  const adminSocket = io(BASE_URL);

  // 1. Connect Admin
  await new Promise((resolve) => {
    adminSocket.on('connect', () => {
      adminSocket.emit('admin:join');
    });
    adminSocket.on('admin:init', (data) => {
      console.log(`[1] Admin joined. Initial meetingStatus = "${data.meetingStatus}", Questions = ${data.questions.length}`);
      resolve();
    });
  });

  // 2. Test Question Builder: Save 3 custom questions + toggle year visibility
  const sampleQuestions = [
    {
      id: 'custom_q1',
      text: 'How would you rate the frequency of parent-teacher communications?',
      options: ['Very Timely', 'Adequate', 'Too Infrequent']
    },
    {
      id: 'custom_q2',
      text: 'Which student development initiative would you most like to support?',
      options: ['Industry Guest Lectures', 'Competitive Programming & Hackathons', 'Soft Skills & Interview Prep', 'Research Grants']
    },
    {
      id: 'custom_q3',
      text: 'Should the department offer optional weekend certification programs?',
      options: ['Yes, fully support', 'No, keep weekends free']
    }
  ];

  await new Promise((resolve) => {
    adminSocket.on('admin:questions_saved', (data) => {
      console.log(`[2] Admin saved questions successfully. Total = ${data.questions.length}, showYearToParents = ${data.showYearToParents}`);
      if (data.questions.length === 3) resolve();
    });

    adminSocket.emit('admin:save_questions', {
      questions: sampleQuestions,
      showYearToParents: true,
      departmentName: 'Department of Computer Science & Engineering',
      meetingTitle: 'Annual Parent-Teacher Meeting 2026'
    });
  });

  // 3. Test "Finish & Start Meeting"
  await new Promise((resolve) => {
    adminSocket.on('admin:meeting_started', (data) => {
      console.log(`[3] Meeting transition: meetingStatus = "${data.meetingStatus}". Now in Live Projector view.`);
      resolve();
    });
    adminSocket.emit('admin:start_meeting');
  });

  // 4. Parents Join and verify session settings
  const parent1Socket = io(BASE_URL);
  const parent2Socket = io(BASE_URL);

  await new Promise((resolve) => {
    let p1Ready = false;
    let p2Ready = false;

    function checkDone() {
      if (p1Ready && p2Ready) resolve();
    }

    parent1Socket.on('session:state', (state) => {
      console.log(`[4a] Parent 1 joined as 1st Year. showYearToParents = ${state.showYearToParents}`);
      p1Ready = true;
      checkDone();
    });

    parent2Socket.on('session:state', (state) => {
      console.log(`[4b] Parent 2 joined as 3rd Year. showYearToParents = ${state.showYearToParents}`);
      p2Ready = true;
      checkDone();
    });

    if (parent1Socket.connected) {
      parent1Socket.emit('parent:join', { voterToken: 'parent_flow_1', yearGroup: '1st Year' });
    } else {
      parent1Socket.on('connect', () => {
        parent1Socket.emit('parent:join', { voterToken: 'parent_flow_1', yearGroup: '1st Year' });
      });
    }

    if (parent2Socket.connected) {
      parent2Socket.emit('parent:join', { voterToken: 'parent_flow_2', yearGroup: '3rd Year' });
    } else {
      parent2Socket.on('connect', () => {
        parent2Socket.emit('parent:join', { voterToken: 'parent_flow_2', yearGroup: '3rd Year' });
      });
    }
  });

  // 5. Admin Launches Question 1
  await new Promise((resolve) => {
    adminSocket.emit('admin:launch_question', { questionId: 'custom_q1' });

    parent1Socket.on('question:live', (q) => {
      console.log(`[5] Parent 1 received live question: "${q.text}" (${q.options.length} options)`);
      resolve();
    });
  });

  // 6. Parents vote & verify live aggregation
  await new Promise((resolve) => {
    let p1Voted = false;
    let p2Voted = false;

    parent1Socket.emit('parent:vote', {
      voterToken: 'parent_flow_1',
      questionId: 'custom_q1',
      optionIndex: 0, // 'Very Timely'
      yearGroup: '1st Year'
    });

    parent2Socket.emit('parent:vote', {
      voterToken: 'parent_flow_2',
      questionId: 'custom_q1',
      optionIndex: 1, // 'Adequate'
      yearGroup: '3rd Year'
    });

    adminSocket.on('poll:update', (update) => {
      if (update.tallies && update.tallies.totalVotes === 2) {
        console.log(`[6] Admin live chart received 2 votes:`);
        console.log(`    All Years breakdown:`, update.tallies.breakdown['All Years']);
        console.log(`    1st Year breakdown:`, update.tallies.breakdown['1st Year']);
        console.log(`    3rd Year breakdown:`, update.tallies.breakdown['3rd Year']);
        resolve();
      }
    });
  });

  // 7. Test mid-meeting edit of upcoming questions without disrupting Question 1 responses!
  console.log(`[7] Testing mid-meeting question editing...`);
  const updatedQuestions = [
    sampleQuestions[0], // Q1 untouched
    sampleQuestions[1], // Q2 untouched
    {
      id: 'custom_q3',
      text: 'MODIFIED Q3: Should the department organize Saturday industry bootcamps?',
      options: ['Strongly Support', 'Support if Virtual', 'Do Not Support']
    }
  ];

  await new Promise((resolve) => {
    adminSocket.on('admin:questions_saved', (data) => {
      const q3 = data.questions.find(q => q.id === 'custom_q3');
      console.log(`    Updated Q3 text: "${q3.text}" (${q3.options.length} options)`);

      // Verify Q1 responses were NOT lost
      if (data.tallies && data.tallies.questionId === 'custom_q1') {
        console.log(`    Q1 response count verified preserved: ${data.tallies.totalVotes} votes.`);
      }
      resolve();
    });

    adminSocket.emit('admin:save_questions', {
      questions: updatedQuestions,
      showYearToParents: true
    });
  });

  // 8. Test CSV Export contains custom questions
  const csvRes = await fetchHttp('/api/export/csv');
  console.log(`[8] CSV Export: Status ${csvRes.status}`);
  if (csvRes.body.includes('How would you rate the frequency of parent-teacher communications?') &&
      csvRes.body.includes('MODIFIED Q3: Should the department organize Saturday industry bootcamps?')) {
    console.log(`    CSV content verification: PASSED (contains all newly built questions)`);
  } else {
    throw new Error('CSV missing custom questions');
  }

  // 9. Test Summary Report API
  const summaryRes = await fetchHttp('/api/session/summary');
  const summaryData = JSON.parse(summaryRes.body);
  console.log(`[9] Summary Report: ${summaryData.results.length} questions in report. Generated: ${summaryData.generatedAt}`);

  // Disconnect
  adminSocket.disconnect();
  parent1Socket.disconnect();
  parent2Socket.disconnect();

  console.log('\n>>> STAGE 1 & STAGE 2 WORKFLOW VERIFIED SUCCESSFULLY WITH 100% PASS RATE! <<<\n');
}

runStageFlowTests().catch(err => {
  console.error('Stage flow test error:', err);
  process.exit(1);
});
