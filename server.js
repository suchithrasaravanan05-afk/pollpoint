const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const os = require('os');
const path = require('path');
const fs = require('fs');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' },
  pingTimeout: 30000,
  pingInterval: 15000
});

let currentPort = parseInt(process.env.PORT || 3000, 10);
const DATA_DIR = path.join(__dirname, 'data');
const STATE_FILE = path.join(DATA_DIR, 'session_state.json');
const DEFAULT_FILE = path.join(DATA_DIR, 'default_questions.json');
const HISTORY_FILE = path.join(DATA_DIR, 'meetings_history.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// History persistence helpers
function loadMeetingHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error('Failed to parse meetings_history.json:', err);
  }
  return [];
}

function saveMeetingHistory(history) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save meetings_history.json:', err);
  }
}

function archiveCurrentMeetingSnapshot() {
  if (!sessionState.questions || sessionState.questions.length === 0) return null;
  const history = loadMeetingHistory();
  const meetingId = 'mtg_' + Date.now();

  let totalVotes = 0;
  for (const qId in sessionState.responses) {
    totalVotes += Object.keys(sessionState.responses[qId] || {}).length;
  }

  const results = sessionState.questions.map(q => computeQuestionTallies(q.id));

  const archiveEntry = {
    id: meetingId,
    meetingTitle: sessionState.meetingTitle || 'Meeting Session',
    departmentName: sessionState.departmentName || 'Department of Computer Science and Business Systems',
    archivedAt: new Date().toISOString(),
    totalVotes,
    questionsCount: sessionState.questions.length,
    yearGroups: sessionState.yearGroups,
    questions: JSON.parse(JSON.stringify(sessionState.questions)),
    responses: JSON.parse(JSON.stringify(sessionState.responses)),
    results
  };

  history.unshift(archiveEntry);
  saveMeetingHistory(history);
  return archiveEntry;
}

// Network IP helper to facilitate mobile connections on venue Wi-Fi
function getLocalNetworkIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      const isIpv4 = iface.family === 'IPv4' || iface.family === 4;
      if (isIpv4 && !iface.internal) {
        return iface.address;
      }
    }
  }
  return 'localhost';
}

const localIp = getLocalNetworkIp();

// Session state structure
let sessionState = {
  departmentName: 'Department of Computer Science and Business Systems',
  meetingTitle: 'Annual Parent-Teacher Meeting 2026',
  customJoinUrl: '', // if overridden by admin
  meetingStatus: 'setup', // 'setup' | 'active'
  showYearToParents: true, // toggle whether parents see their year-group
  yearGroups: ['1st Year', '2nd Year', '3rd Year', 'Final Year'],
  questions: [],
  currentQuestionId: null,
  questionStatus: 'idle', // 'idle' | 'live' | 'closed'
  responses: {} // { [questionId]: { [voterToken]: { optionIndex, yearGroup, timestamp } } }
};

// Load initial state
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      sessionState = { ...sessionState, ...saved };
      console.log('Loaded existing session state from session_state.json');
      return;
    }
  } catch (err) {
    console.error('Failed to parse session_state.json, falling back to defaults:', err);
  }

  try {
    if (fs.existsSync(DEFAULT_FILE)) {
      const defaults = JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8'));
      sessionState.departmentName = defaults.departmentName || sessionState.departmentName;
      sessionState.meetingTitle = defaults.meetingTitle || sessionState.meetingTitle;
      sessionState.yearGroups = defaults.yearGroups || sessionState.yearGroups;
      sessionState.questions = defaults.questions || [];
      console.log(`Loaded ${sessionState.questions.length} default questions.`);
    }
  } catch (err) {
    console.error('Failed to load default questions:', err);
  }
}

loadState();

// Debounced save
let saveTimeout = null;
function persistState() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(sessionState, null, 2), 'utf8');
    } catch (e) {
      console.error('Error persisting state:', e);
    }
  }, 400);
}

// Connected clients tracking
const connectedVoters = new Map(); // socketId -> { voterToken, yearGroup }

function getActivePort() {
  const addr = server.address();
  return addr && typeof addr === 'object' ? addr.port : currentPort;
}

function getActiveJoinUrl() {
  if (sessionState.customJoinUrl && sessionState.customJoinUrl.trim()) {
    return sessionState.customJoinUrl.trim();
  }
  return `http://${localIp}:${getActivePort()}`;
}

// Compute response tallies for a question
function computeQuestionTallies(questionId) {
  const question = sessionState.questions.find(q => q.id === questionId);
  if (!question) return null;

  const qResponses = sessionState.responses[questionId] || {};
  const totalOptions = question.options.length;

  // Breakdown by year group + All Years
  // structure: { "All Years": [counts], "1st Year": [counts], ... }
  const breakdown = {
    'All Years': new Array(totalOptions).fill(0)
  };
  const yearTotals = {
    'All Years': 0
  };

  sessionState.yearGroups.forEach(yg => {
    breakdown[yg] = new Array(totalOptions).fill(0);
    yearTotals[yg] = 0;
  });

  let totalVotes = 0;

  for (const voterToken in qResponses) {
    const { optionIndex, yearGroup } = qResponses[voterToken];
    if (optionIndex >= 0 && optionIndex < totalOptions) {
      breakdown['All Years'][optionIndex]++;
      totalVotes++;
      yearTotals['All Years']++;

      if (breakdown[yearGroup]) {
        breakdown[yearGroup][optionIndex]++;
        yearTotals[yearGroup]++;
      }
    }
  }

  return {
    questionId,
    questionText: question.text,
    questionTextTa: question.textTa || '',
    options: question.options,
    optionsTa: question.optionsTa || [],
    status: sessionState.questionStatus,
    totalVotes,
    breakdown,
    yearTotals
  };
}

// Compute general stats for admin
function getAdminStats() {
  const uniqueConnected = new Set();
  const yearGroupCounts = {};
  sessionState.yearGroups.forEach(yg => { yearGroupCounts[yg] = 0; });

  for (const { voterToken, yearGroup } of connectedVoters.values()) {
    if (!uniqueConnected.has(voterToken)) {
      uniqueConnected.add(voterToken);
      if (yearGroupCounts[yearGroup] !== undefined) {
        yearGroupCounts[yearGroup]++;
      }
    }
  }

  const currentTallies = sessionState.currentQuestionId
    ? computeQuestionTallies(sessionState.currentQuestionId)
    : null;

  return {
    connectedCount: uniqueConnected.size,
    yearGroupCounts,
    currentQuestionId: sessionState.currentQuestionId,
    questionStatus: sessionState.questionStatus,
    tallies: currentTallies
  };
}

// Express middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// API: System Info & Join URL
app.get('/api/info', async (req, res) => {
  const port = getActivePort();
  const joinUrl = getActiveJoinUrl();
  try {
    const qrDataUrl = await QRCode.toDataURL(joinUrl, {
      margin: 2,
      scale: 8,
      color: {
        dark: '#4a148c',
        light: '#ffffff'
      }
    });

    res.json({
      localIp,
      port,
      joinUrl,
      qrDataUrl,
      departmentName: sessionState.departmentName,
      meetingTitle: sessionState.meetingTitle,
      meetingStatus: sessionState.meetingStatus,
      showYearToParents: sessionState.showYearToParents,
      yearGroups: sessionState.yearGroups
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// API: Session summary for printable view
app.get('/api/session/summary', (req, res) => {
  const results = sessionState.questions.map(q => {
    return computeQuestionTallies(q.id);
  });
  res.json({
    departmentName: sessionState.departmentName,
    meetingTitle: sessionState.meetingTitle,
    generatedAt: new Date().toISOString(),
    yearGroups: sessionState.yearGroups,
    results
  });
});

// API: Meetings History List
app.get('/api/meetings/history', (req, res) => {
  const history = loadMeetingHistory();
  const summaries = history.map(item => ({
    id: item.id,
    meetingTitle: item.meetingTitle,
    departmentName: item.departmentName,
    archivedAt: item.archivedAt,
    totalVotes: item.totalVotes || 0,
    questionsCount: item.questionsCount || (item.questions ? item.questions.length : 0)
  }));
  res.json(summaries);
});

// API: Single Meeting History Details
app.get('/api/meetings/history/:id', (req, res) => {
  const history = loadMeetingHistory();
  const meeting = history.find(m => m.id === req.params.id);
  if (!meeting) {
    return res.status(404).json({ error: 'Meeting not found' });
  }
  res.json(meeting);
});

// API: CSV Export for a specific historical meeting
app.get('/api/meetings/history/:id/csv', (req, res) => {
  const history = loadMeetingHistory();
  const meeting = history.find(m => m.id === req.params.id);
  if (!meeting) {
    return res.status(404).send('Meeting not found');
  }

  const filename = `PTM_Historical_${meeting.id}_Results.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  let csv = [];
  csv.push(`\uFEFF"Parent-Teachers Meeting Historical Polling Report"`);
  csv.push(`"Department:","${(meeting.departmentName || '').replace(/"/g, '""')}"`);
  csv.push(`"Meeting:","${(meeting.meetingTitle || '').replace(/"/g, '""')}"`);
  csv.push(`"Archived At:","${new Date(meeting.archivedAt).toLocaleString()}"`);
  csv.push('');

  const headers = ['Question #', 'Question (English)', 'Question (Tamil)', 'Option #', 'Option (English)', 'Option (Tamil)'];
  (meeting.yearGroups || sessionState.yearGroups).forEach(yg => headers.push(`"${yg} Votes"`));
  headers.push('"Total Votes"', '"Overall %"');
  csv.push(headers.join(','));

  const results = meeting.results || [];
  results.forEach((resItem, qIndex) => {
    const totalQVotes = resItem.totalVotes || 0;
    (resItem.options || []).forEach((opt, optIndex) => {
      const optTa = (resItem.optionsTa && resItem.optionsTa[optIndex]) || '';
      const row = [
        `"Q${qIndex + 1}"`,
        `"${(resItem.questionText || '').replace(/"/g, '""')}"`,
        `"${(resItem.questionTextTa || '').replace(/"/g, '""')}"`,
        `"${optIndex + 1}"`,
        `"${(opt || '').replace(/"/g, '""')}"`,
        `"${optTa.replace(/"/g, '""')}"`
      ];

      (meeting.yearGroups || sessionState.yearGroups).forEach(yg => {
        const ygCount = resItem.breakdown && resItem.breakdown[yg] ? resItem.breakdown[yg][optIndex] : 0;
        row.push(ygCount);
      });

      const optTotal = resItem.breakdown && resItem.breakdown['All Years'] ? resItem.breakdown['All Years'][optIndex] : 0;
      const pct = totalQVotes > 0 ? ((optTotal / totalQVotes) * 100).toFixed(1) : '0.0';

      row.push(optTotal);
      row.push(`"${pct}%"`);
      csv.push(row.join(','));
    });
    csv.push('');
  });

  res.send(csv.join('\r\n'));
});

// API: Current Session CSV Export (Bilingual with English and Tamil)
app.get('/api/export/csv', (req, res) => {
  const filename = `PTM_CSBS_Polling_Results_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  let csv = [];
  csv.push(`\uFEFF"Parent-Teachers Meeting Polling Report"`);
  csv.push(`"Department:","${sessionState.departmentName.replace(/"/g, '""')}"`);
  csv.push(`"Meeting:","${sessionState.meetingTitle.replace(/"/g, '""')}"`);
  csv.push(`"Exported At:","${new Date().toLocaleString()}"`);
  csv.push('');

  // Header row with Tamil and English columns
  const headers = ['Question #', 'Question (English)', 'Question (Tamil)', 'Option #', 'Option (English)', 'Option (Tamil)'];
  sessionState.yearGroups.forEach(yg => headers.push(`"${yg} Votes"`));
  headers.push('"Total Votes"', '"Overall %"');
  csv.push(headers.join(','));

  sessionState.questions.forEach((q, qIndex) => {
    const tallies = computeQuestionTallies(q.id);
    const totalQVotes = tallies.totalVotes;

    q.options.forEach((opt, optIndex) => {
      const optTa = (q.optionsTa && q.optionsTa[optIndex]) || '';
      const row = [
        `"Q${qIndex + 1}"`,
        `"${q.text.replace(/"/g, '""')}"`,
        `"${(q.textTa || '').replace(/"/g, '""')}"`,
        `"${optIndex + 1}"`,
        `"${opt.replace(/"/g, '""')}"`,
        `"${optTa.replace(/"/g, '""')}"`
      ];

      // Votes per year group
      sessionState.yearGroups.forEach(yg => {
        const ygCount = tallies.breakdown[yg] ? tallies.breakdown[yg][optIndex] : 0;
        row.push(ygCount);
      });

      const optTotal = tallies.breakdown['All Years'][optIndex];
      const pct = totalQVotes > 0 ? ((optTotal / totalQVotes) * 100).toFixed(1) : '0.0';

      row.push(optTotal);
      row.push(`"${pct}%"`);
      csv.push(row.join(','));
    });
    csv.push(''); // blank line between questions
  });

  res.send(csv.join('\r\n'));
});

// WebSocket Handling
io.on('connection', (socket) => {
  let clientRole = 'parent';
  let clientVoterToken = null;

  // Parent joins
  socket.on('parent:join', (data) => {
    const { voterToken, yearGroup } = data || {};
    if (!voterToken) return;

    clientRole = 'parent';
    clientVoterToken = voterToken;
    connectedVoters.set(socket.id, { voterToken, yearGroup: yearGroup || '1st Year' });

    // Send current session state to this parent
    const activeQuestion = sessionState.questions.find(q => q.id === sessionState.currentQuestionId);
    let myVote = null;
    if (activeQuestion && sessionState.responses[activeQuestion.id]) {
      myVote = sessionState.responses[activeQuestion.id][voterToken]?.optionIndex ?? null;
    }

    socket.emit('session:state', {
      departmentName: sessionState.departmentName,
      meetingTitle: sessionState.meetingTitle,
      yearGroups: sessionState.yearGroups,
      meetingStatus: sessionState.meetingStatus,
      showYearToParents: sessionState.showYearToParents !== false,
      questionStatus: sessionState.questionStatus,
      currentQuestion: activeQuestion ? {
        id: activeQuestion.id,
        text: activeQuestion.text,
        textTa: activeQuestion.textTa || '',
        options: activeQuestion.options,
        optionsTa: activeQuestion.optionsTa || []
      } : null,
      myVote
    });

    // Notify admin of updated audience stats
    io.to('admin-room').emit('admin:stats', getAdminStats());
  });

  // Parent changes year group
  socket.on('parent:change_year', (data) => {
    const { voterToken, yearGroup } = data || {};
    if (voterToken && connectedVoters.has(socket.id)) {
      connectedVoters.set(socket.id, { voterToken, yearGroup });

      // Update any previous votes recorded for this voter to new yearGroup
      for (const qId in sessionState.responses) {
        if (sessionState.responses[qId][voterToken]) {
          sessionState.responses[qId][voterToken].yearGroup = yearGroup;
        }
      }
      persistState();

      io.to('admin-room').emit('admin:stats', getAdminStats());
      socket.emit('parent:year_updated', { yearGroup });
    }
  });

  // Parent casts vote
  socket.on('parent:vote', (data) => {
    const { voterToken, questionId, optionIndex, yearGroup } = data || {};

    if (!voterToken || !questionId || optionIndex === undefined) {
      return socket.emit('parent:vote_error', { message: 'Invalid vote parameters' });
    }

    // Verify question is currently live
    if (sessionState.currentQuestionId !== questionId || sessionState.questionStatus !== 'live') {
      return socket.emit('parent:vote_error', { message: 'Polling is not active for this question' });
    }

    const question = sessionState.questions.find(q => q.id === questionId);
    if (!question || optionIndex < 0 || optionIndex >= question.options.length) {
      return socket.emit('parent:vote_error', { message: 'Invalid option selected' });
    }

    // Record response
    if (!sessionState.responses[questionId]) {
      sessionState.responses[questionId] = {};
    }

    const existingYear = connectedVoters.get(socket.id)?.yearGroup || yearGroup || '1st Year';
    sessionState.responses[questionId][voterToken] = {
      optionIndex,
      yearGroup: existingYear,
      timestamp: Date.now()
    };

    persistState();

    // Confirm to voter
    socket.emit('parent:vote_confirmed', {
      questionId,
      optionIndex
    });

    // Broadcast live tally update to admin
    const updatedTallies = computeQuestionTallies(questionId);
    io.to('admin-room').emit('poll:update', {
      questionId,
      tallies: updatedTallies,
      stats: getAdminStats()
    });
  });

  // Admin joins
  socket.on('admin:join', () => {
    clientRole = 'admin';
    socket.join('admin-room');

    socket.emit('admin:init', {
      departmentName: sessionState.departmentName,
      meetingTitle: sessionState.meetingTitle,
      meetingStatus: sessionState.meetingStatus || 'setup',
      showYearToParents: sessionState.showYearToParents !== false,
      yearGroups: sessionState.yearGroups,
      questions: sessionState.questions,
      currentQuestionId: sessionState.currentQuestionId,
      questionStatus: sessionState.questionStatus,
      tallies: sessionState.currentQuestionId ? computeQuestionTallies(sessionState.currentQuestionId) : null,
      stats: getAdminStats(),
      joinUrl: getActiveJoinUrl()
    });
  });

  // Admin starts meeting from Question Builder
  socket.on('admin:start_meeting', () => {
    sessionState.meetingStatus = 'active';
    if (!sessionState.currentQuestionId && sessionState.questions.length > 0) {
      sessionState.currentQuestionId = sessionState.questions[0].id;
    }
    persistState();

    io.to('admin-room').emit('admin:meeting_started', {
      meetingStatus: 'active',
      currentQuestionId: sessionState.currentQuestionId,
      tallies: sessionState.currentQuestionId ? computeQuestionTallies(sessionState.currentQuestionId) : null,
      stats: getAdminStats()
    });

    io.emit('session:settings', {
      showYearToParents: sessionState.showYearToParents !== false
    });
  });

  // Admin returns to Question Builder setup
  socket.on('admin:return_to_setup', () => {
    sessionState.meetingStatus = 'setup';
    persistState();

    io.to('admin-room').emit('admin:returned_to_setup', {
      meetingStatus: 'setup'
    });
  });

  // Admin creates a new meeting (Archives previous meeting data and allows altering questions)
  socket.on('admin:create_new_meeting', (data) => {
    const { meetingTitle: newTitle, departmentName: newDept, cloneQuestions, newQuestions } = data || {};

    // Auto-archive current session before starting fresh
    if (sessionState.questions && sessionState.questions.length > 0) {
      archiveCurrentMeetingSnapshot();
    }

    if (newDept) sessionState.departmentName = newDept.trim();
    if (newTitle) sessionState.meetingTitle = newTitle.trim();

    // Reset responses
    sessionState.responses = {};
    sessionState.questionStatus = 'idle';

    if (Array.isArray(newQuestions) && newQuestions.length > 0) {
      sessionState.questions = newQuestions;
    } else if (!cloneQuestions) {
      // Load default bilingual questions
      try {
        if (fs.existsSync(DEFAULT_FILE)) {
          const defaults = JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8'));
          sessionState.questions = defaults.questions || [];
        }
      } catch (e) {
        console.error('Error reloading defaults for new meeting:', e);
      }
    }
    // If cloneQuestions was true, current questions are retained so admin can alter them!

    sessionState.currentQuestionId = sessionState.questions.length > 0 ? sessionState.questions[0].id : null;
    sessionState.meetingStatus = 'setup';
    persistState();

    // Reset connected parents
    io.emit('session:reset_for_new_meeting', {
      departmentName: sessionState.departmentName,
      meetingTitle: sessionState.meetingTitle
    });

    // Notify admin
    io.to('admin-room').emit('admin:init', {
      departmentName: sessionState.departmentName,
      meetingTitle: sessionState.meetingTitle,
      meetingStatus: sessionState.meetingStatus,
      showYearToParents: sessionState.showYearToParents !== false,
      yearGroups: sessionState.yearGroups,
      questions: sessionState.questions,
      currentQuestionId: sessionState.currentQuestionId,
      questionStatus: sessionState.questionStatus,
      tallies: sessionState.currentQuestionId ? computeQuestionTallies(sessionState.currentQuestionId) : null,
      stats: getAdminStats(),
      joinUrl: getActiveJoinUrl()
    });
  });

  // Explicit manual archive snapshot
  socket.on('admin:archive_current_meeting', () => {
    const archived = archiveCurrentMeetingSnapshot();
    io.to('admin-room').emit('admin:meeting_archived', { archive: archived });
  });

  // Admin clones/restores questions from an archived meeting to alter them
  socket.on('admin:restore_meeting_questions', ({ meetingId }) => {
    const history = loadMeetingHistory();
    const archived = history.find(m => m.id === meetingId);
    if (!archived || !Array.isArray(archived.questions)) return;

    sessionState.questions = archived.questions.map((q, idx) => ({
      id: `q_${Date.now()}_${idx}`,
      text: q.text || '',
      textTa: q.textTa || '',
      options: Array.isArray(q.options) ? [...q.options] : [],
      optionsTa: Array.isArray(q.optionsTa) ? [...q.optionsTa] : []
    }));

    sessionState.currentQuestionId = sessionState.questions[0] ? sessionState.questions[0].id : null;
    sessionState.questionStatus = 'idle';
    persistState();

    io.to('admin-room').emit('admin:questions_saved', {
      questions: sessionState.questions,
      showYearToParents: sessionState.showYearToParents,
      departmentName: sessionState.departmentName,
      meetingTitle: sessionState.meetingTitle,
      currentQuestionId: sessionState.currentQuestionId,
      tallies: sessionState.currentQuestionId ? computeQuestionTallies(sessionState.currentQuestionId) : null,
      stats: getAdminStats()
    });
  });

  // Admin batch saves questions from Question Builder (Bilingual support)
  socket.on('admin:save_questions', (data) => {
    const { questions: newQuestions, showYearToParents, departmentName, meetingTitle } = data || {};
    if (departmentName) sessionState.departmentName = departmentName.trim();
    if (meetingTitle) sessionState.meetingTitle = meetingTitle.trim();
    if (showYearToParents !== undefined) sessionState.showYearToParents = Boolean(showYearToParents);

    if (Array.isArray(newQuestions)) {
      sessionState.questions = newQuestions.map((q, idx) => {
        return {
          id: q.id || `q_${Date.now()}_${idx}`,
          text: (q.text || '').trim(),
          textTa: (q.textTa || '').trim(),
          options: Array.isArray(q.options)
            ? q.options.map(o => (o || '').trim()).filter(Boolean).slice(0, 4)
            : [],
          optionsTa: Array.isArray(q.optionsTa)
            ? q.optionsTa.map(o => (o || '').trim()).slice(0, 4)
            : []
        };
      });

      // If currentQuestionId is not valid anymore, update it
      if (!sessionState.questions.find(q => q.id === sessionState.currentQuestionId)) {
        sessionState.currentQuestionId = sessionState.questions.length > 0 ? sessionState.questions[0].id : null;
        sessionState.questionStatus = 'idle';
      }
    }

    persistState();

    io.to('admin-room').emit('admin:questions_saved', {
      questions: sessionState.questions,
      showYearToParents: sessionState.showYearToParents,
      departmentName: sessionState.departmentName,
      meetingTitle: sessionState.meetingTitle,
      currentQuestionId: sessionState.currentQuestionId,
      tallies: sessionState.currentQuestionId ? computeQuestionTallies(sessionState.currentQuestionId) : null,
      stats: getAdminStats()
    });

    io.emit('session:settings', {
      showYearToParents: sessionState.showYearToParents !== false,
      departmentName: sessionState.departmentName,
      meetingTitle: sessionState.meetingTitle
    });
  });

  // Admin launches question
  socket.on('admin:launch_question', ({ questionId }) => {
    const question = sessionState.questions.find(q => q.id === questionId);
    if (!question) return;

    sessionState.currentQuestionId = questionId;
    sessionState.questionStatus = 'live';
    if (!sessionState.responses[questionId]) {
      sessionState.responses[questionId] = {};
    }
    persistState();

    // Broadcast bilingual question to parents
    io.emit('question:live', {
      id: question.id,
      text: question.text,
      textTa: question.textTa || '',
      options: question.options,
      optionsTa: question.optionsTa || []
    });

    // Notify admin
    io.to('admin-room').emit('admin:state_change', {
      currentQuestionId: questionId,
      questionStatus: 'live',
      tallies: computeQuestionTallies(questionId),
      stats: getAdminStats()
    });
  });

  // Admin closes question
  socket.on('admin:close_question', () => {
    sessionState.questionStatus = 'closed';
    persistState();

    io.emit('question:closed', {
      questionId: sessionState.currentQuestionId
    });

    io.to('admin-room').emit('admin:state_change', {
      currentQuestionId: sessionState.currentQuestionId,
      questionStatus: 'closed',
      tallies: sessionState.currentQuestionId ? computeQuestionTallies(sessionState.currentQuestionId) : null,
      stats: getAdminStats()
    });
  });

  // Admin reopens question
  socket.on('admin:reopen_question', () => {
    if (!sessionState.currentQuestionId) return;
    sessionState.questionStatus = 'live';
    persistState();

    const question = sessionState.questions.find(q => q.id === sessionState.currentQuestionId);
    if (question) {
      io.emit('question:live', {
        id: question.id,
        text: question.text,
        textTa: question.textTa || '',
        options: question.options,
        optionsTa: question.optionsTa || []
      });
    }

    io.to('admin-room').emit('admin:state_change', {
      currentQuestionId: sessionState.currentQuestionId,
      questionStatus: 'live',
      tallies: computeQuestionTallies(sessionState.currentQuestionId),
      stats: getAdminStats()
    });
  });

  // Admin resets votes for a question
  socket.on('admin:reset_question', ({ questionId }) => {
    if (sessionState.responses[questionId]) {
      sessionState.responses[questionId] = {};
      persistState();
    }

    io.emit('question:reset', { questionId });

    io.to('admin-room').emit('admin:state_change', {
      currentQuestionId: sessionState.currentQuestionId,
      questionStatus: sessionState.questionStatus,
      tallies: sessionState.currentQuestionId ? computeQuestionTallies(sessionState.currentQuestionId) : null,
      stats: getAdminStats()
    });
  });

  // Question bank management: Add question
  socket.on('admin:add_question', ({ text, textTa, options, optionsTa }) => {
    if (!text || !options || options.length < 2) return;
    const newQ = {
      id: 'q_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      text: text.trim(),
      textTa: (textTa || '').trim(),
      options: options.map(o => o.trim()).filter(Boolean),
      optionsTa: Array.isArray(optionsTa) ? optionsTa.map(o => o.trim()) : []
    };
    sessionState.questions.push(newQ);
    persistState();

    io.to('admin-room').emit('admin:questions_updated', {
      questions: sessionState.questions
    });
  });

  // Question bank management: Update question
  socket.on('admin:update_question', ({ id, text, textTa, options, optionsTa }) => {
    const q = sessionState.questions.find(item => item.id === id);
    if (!q) return;
    q.text = text.trim();
    if (textTa !== undefined) q.textTa = textTa.trim();
    q.options = options.map(o => o.trim()).filter(Boolean);
    if (Array.isArray(optionsTa)) q.optionsTa = optionsTa.map(o => o.trim());
    persistState();

    io.to('admin-room').emit('admin:questions_updated', {
      questions: sessionState.questions
    });
  });

  // Question bank management: Delete question
  socket.on('admin:delete_question', ({ id }) => {
    sessionState.questions = sessionState.questions.filter(item => item.id !== id);
    delete sessionState.responses[id];
    if (sessionState.currentQuestionId === id) {
      sessionState.currentQuestionId = null;
      sessionState.questionStatus = 'idle';
      io.emit('question:closed', { questionId: id });
    }
    persistState();

    io.to('admin-room').emit('admin:questions_updated', {
      questions: sessionState.questions,
      currentQuestionId: sessionState.currentQuestionId,
      questionStatus: sessionState.questionStatus,
      tallies: sessionState.currentQuestionId ? computeQuestionTallies(sessionState.currentQuestionId) : null,
      stats: getAdminStats()
    });
  });

  // Question bank management: Reorder questions
  socket.on('admin:reorder_questions', ({ orderedIds }) => {
    if (!Array.isArray(orderedIds)) return;
    const idMap = new Map(sessionState.questions.map(q => [q.id, q]));
    const reordered = [];
    orderedIds.forEach(id => {
      if (idMap.has(id)) reordered.push(idMap.get(id));
    });
    sessionState.questions.forEach(q => {
      if (!reordered.find(r => r.id === q.id)) reordered.push(q);
    });
    sessionState.questions = reordered;
    persistState();

    io.to('admin-room').emit('admin:questions_updated', {
      questions: sessionState.questions
    });
  });

  // Admin updates settings (Dept title, Join URL override, Year groups)
  socket.on('admin:update_settings', ({ departmentName, meetingTitle, customJoinUrl, yearGroups }) => {
    if (departmentName) sessionState.departmentName = departmentName.trim();
    if (meetingTitle) sessionState.meetingTitle = meetingTitle.trim();
    if (customJoinUrl !== undefined) sessionState.customJoinUrl = customJoinUrl.trim();
    if (Array.isArray(yearGroups) && yearGroups.length > 0) {
      sessionState.yearGroups = yearGroups.map(y => y.trim()).filter(Boolean);
    }
    persistState();

    io.to('admin-room').emit('admin:settings_updated', {
      departmentName: sessionState.departmentName,
      meetingTitle: sessionState.meetingTitle,
      customJoinUrl: sessionState.customJoinUrl,
      yearGroups: sessionState.yearGroups,
      joinUrl: getActiveJoinUrl()
    });
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    if (clientRole === 'parent') {
      connectedVoters.delete(socket.id);
      io.to('admin-room').emit('admin:stats', getAdminStats());
    }
  });
});

// Start server with automatic port retry if busy
function startServer(port) {
  server.listen(port, '0.0.0.0', () => {
    const actualPort = server.address().port;
    console.log(`====================================================`);
    console.log(`  PTM Live Polling Web App Started Successfully!   `);
    console.log(`====================================================`);
    console.log(`  Local Admin URL:    http://localhost:${actualPort}/admin.html`);
    console.log(`  Venue Wi-Fi Parent Join URL: http://${localIp}:${actualPort}`);
    console.log(`====================================================`);
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${currentPort} in use, trying port ${currentPort + 1}...`);
    currentPort++;
    setTimeout(() => {
      server.listen(currentPort, '0.0.0.0');
    }, 200);
  } else {
    console.error('Server error:', err);
  }
});

startServer(currentPort);
