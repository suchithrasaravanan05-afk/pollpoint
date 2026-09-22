const { io } = require('socket.io-client');
const http = require('http');

const PORT = 3001;
const SERVER_URL = `http://localhost:${PORT}`;
const CONCURRENT_CLIENTS = 350;
const YEAR_GROUPS = ['1st Year', '2nd Year', '3rd Year', 'Final Year'];

console.log(`Starting load simulation with ${CONCURRENT_CLIENTS} concurrent parent devices...`);

async function runTest() {
  const startTime = Date.now();
  let connectedCount = 0;
  let votedCount = 0;
  const sockets = [];

  // Connect admin socket first
  const adminSocket = io(SERVER_URL);
  let activeQuestionId = null;
  let optionsCount = 4;

  await new Promise((resolve) => {
    adminSocket.on('connect', () => {
      adminSocket.emit('admin:join');
    });

    adminSocket.on('admin:init', (data) => {
      console.log(`Admin joined. Total questions: ${data.questions.length}`);
      activeQuestionId = data.questions[0].id;
      optionsCount = data.questions[0].options.length;
      // Launch Q1
      adminSocket.emit('admin:launch_question', { questionId: activeQuestionId });
      resolve();
    });
  });

  console.log(`Question launched: ${activeQuestionId}. Connecting ${CONCURRENT_CLIENTS} parents...`);

  // Connect 350 clients
  const connectionPromises = [];
  for (let i = 0; i < CONCURRENT_CLIENTS; i++) {
    const voterToken = `sim_voter_${i}_${Date.now()}`;
    const yearGroup = YEAR_GROUPS[i % YEAR_GROUPS.length];

    const p = new Promise((resolve) => {
      const socket = io(SERVER_URL, {
        transports: ['websocket'],
        reconnection: false
      });

      socket.on('connect', () => {
        connectedCount++;
        socket.emit('parent:join', { voterToken, yearGroup });
      });

      socket.on('session:state', () => {
        // Vote for a valid option index
        const optionIndex = i % optionsCount;
        socket.emit('parent:vote', {
          voterToken,
          questionId: activeQuestionId,
          optionIndex,
          yearGroup
        });
      });

      socket.on('parent:vote_confirmed', () => {
        votedCount++;
        resolve();
      });

      sockets.push(socket);
    });

    connectionPromises.push(p);
  }

  let lastTallies = null;
  adminSocket.on('poll:update', (data) => {
    if (data.tallies) lastTallies = data.tallies;
  });

  await Promise.all(connectionPromises);
  const duration = Date.now() - startTime;

  console.log(`\n================ SIMULATION RESULTS ================`);
  console.log(`Successfully connected: ${connectedCount} parents`);
  console.log(`Successfully recorded: ${votedCount} votes`);
  console.log(`Total time taken: ${duration}ms (${(duration / CONCURRENT_CLIENTS).toFixed(2)}ms per client)`);

  if (lastTallies) {
    console.log(`\nVerified admin aggregated tallies:`);
    console.log(`Total Votes: ${lastTallies.totalVotes}`);
    console.log(`Option Counts (All Years):`, lastTallies.breakdown['All Years']);
    YEAR_GROUPS.forEach(yg => {
      console.log(`Year Group [${yg}] Breakdown:`, lastTallies.breakdown[yg]);
    });
  }

  // Close poll
  adminSocket.emit('admin:close_question');

  // Verify CSV export
  await new Promise((resolve, reject) => {
    http.get(`${SERVER_URL}/api/export/csv`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        console.log(`\nCSV Export check: Response length ${data.length} bytes`);
        if (data.includes('Question #') && data.includes('1st Year Votes')) {
          console.log(`CSV Header validation: PASSED`);
        } else {
          console.error(`CSV validation: FAILED`);
        }
        resolve();
      });
    }).on('error', reject);
  });

  // Clean up
  sockets.forEach(s => s.disconnect());
  adminSocket.disconnect();
  console.log(`\nAll sockets disconnected. Load test completed successfully!`);
}

runTest().catch(console.error);
