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
const LIBRARY_FILE = path.join(DATA_DIR, 'question_library.json');
const HISTORY_FILE = path.join(DATA_DIR, 'sessions_history.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// History persistence helpers
function loadSessionsHistory() {
  try {
    if (fs.existsSync(HISTORY_FILE)) {
      const data = JSON.parse(fs.readFileSync(HISTORY_FILE, 'utf8'));
      if (Array.isArray(data)) return data;
    }
  } catch (err) {
    console.error('Failed to parse sessions_history.json:', err);
  }
  return [];
}

function saveSessionsHistory(history) {
  try {
    fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save sessions_history.json:', err);
  }
}

// Question Library loader
function loadQuestionLibrary() {
  try {
    if (fs.existsSync(LIBRARY_FILE)) {
      return JSON.parse(fs.readFileSync(LIBRARY_FILE, 'utf8'));
    }
  } catch (err) {
    console.error('Failed to load question library:', err);
  }
  return { categories: [], templates: [] };
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
  sessionTitle: 'Live Interactive Poll',
  sessionTitleTa: 'நேரலை ஊடாடும் வாக்கெடுப்பு',
  sessionCode: 'POLL-2026',
  sessionStatus: 'draft', // 'draft' | 'live' | 'closed'
  customJoinUrl: '',
  questions: [],
  currentQuestionId: null,
  questionStatus: 'idle', // 'idle' | 'live' | 'closed'
  responses: {}, // { [questionId]: { [voterToken]: { optionIndex, textAnswer, timestamp } } }
  // Compatibility fallbacks:
  departmentName: 'Poll Point Live',
  meetingTitle: 'Live Interactive Poll',
  yearGroups: ['All Participants']
};

// Compute question tallies
function computeQuestionTallies(questionId) {
  const question = sessionState.questions.find(q => q.id === questionId);
  if (!question) return null;

  const qResponses = sessionState.responses[questionId] || {};
  const totalVotes = Object.keys(qResponses).length;
  const isShortAnswer = question.type === 'short_answer';

  if (isShortAnswer) {
    const textAnswers = Object.values(qResponses)
      .map(r => r.textAnswer)
      .filter(Boolean);
    return {
      questionId,
      type: 'short_answer',
      questionText: question.text,
      questionTextTa: question.textTa || '',
      options: [],
      optionsTa: [],
      status: sessionState.questionStatus,
      totalVotes,
      textAnswers,
      counts: [],
      percentages: []
    };
  }

  const totalOptions = question.options ? question.options.length : 0;
  const counts = new Array(totalOptions).fill(0);

  for (const voterToken in qResponses) {
    const { optionIndex } = qResponses[voterToken];
    if (typeof optionIndex === 'number' && optionIndex >= 0 && optionIndex < totalOptions) {
      counts[optionIndex]++;
    }
  }

  const percentages = counts.map(c => totalVotes > 0 ? Math.round((c / totalVotes) * 100) : 0);

  return {
    questionId,
    type: question.type || 'multiple_choice',
    questionText: question.text,
    questionTextTa: question.textTa || '',
    options: question.options || [],
    optionsTa: question.optionsTa || [],
    status: sessionState.questionStatus,
    totalVotes,
    counts,
    percentages,
    // Legacy breakdown format for backward compatibility
    breakdown: { 'All Years': counts },
    yearTotals: { 'All Years': totalVotes }
  };
}

function archiveCurrentSessionSnapshot() {
  if (!sessionState.questions || sessionState.questions.length === 0) return null;
  const history = loadSessionsHistory();
  const sessionId = 'poll_' + Date.now();

  let totalVotes = 0;
  for (const qId in sessionState.responses) {
    totalVotes += Object.keys(sessionState.responses[qId] || {}).length;
  }

  const results = sessionState.questions.map(q => computeQuestionTallies(q.id));

  const archiveEntry = {
    id: sessionId,
    sessionTitle: sessionState.sessionTitle || 'Poll Session',
    sessionTitleTa: sessionState.sessionTitleTa || '',
    sessionCode: sessionState.sessionCode || 'POLL',
    archivedAt: new Date().toISOString(),
    totalVotes,
    questionsCount: sessionState.questions.length,
    questions: JSON.parse(JSON.stringify(sessionState.questions)),
    responses: JSON.parse(JSON.stringify(sessionState.responses)),
    results
  };

  history.unshift(archiveEntry);
  saveSessionsHistory(history);
  return archiveEntry;
}

// Load initial state
function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      sessionState = { ...sessionState, ...saved };
      // Synchronize backward compat aliases
      sessionState.meetingTitle = sessionState.sessionTitle;
      sessionState.departmentName = 'Poll Point Live';
      console.log('Loaded existing session state from session_state.json');
      return;
    }
  } catch (err) {
    console.error('Failed to parse session_state.json, falling back to defaults:', err);
  }

  try {
    if (fs.existsSync(DEFAULT_FILE)) {
      const defaults = JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8'));
      sessionState.sessionTitle = defaults.sessionTitle || sessionState.sessionTitle;
      sessionState.sessionTitleTa = defaults.sessionTitleTa || sessionState.sessionTitleTa;
      sessionState.sessionCode = defaults.sessionCode || sessionState.sessionCode;
      sessionState.questions = defaults.questions || [];
      sessionState.currentQuestionId = sessionState.questions[0] ? sessionState.questions[0].id : null;
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
const connectedParticipants = new Map(); // socketId -> voterToken

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

// Compute general stats for admin
function getAdminStats() {
  const uniqueConnected = new Set(connectedParticipants.values());
  let totalVotesAllQuestions = 0;
  for (const qId in sessionState.responses) {
    totalVotesAllQuestions += Object.keys(sessionState.responses[qId] || {}).length;
  }

  const currentTallies = sessionState.currentQuestionId
    ? computeQuestionTallies(sessionState.currentQuestionId)
    : null;

  return {
    connectedCount: uniqueConnected.size,
    totalVotesAllQuestions,
    currentQuestionId: sessionState.currentQuestionId,
    questionStatus: sessionState.questionStatus,
    sessionStatus: sessionState.sessionStatus,
    sessionCode: sessionState.sessionCode,
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
        dark: '#4c1d95',
        light: '#ffffff'
      }
    });

    res.json({
      localIp,
      port,
      joinUrl,
      qrDataUrl,
      sessionTitle: sessionState.sessionTitle,
      sessionTitleTa: sessionState.sessionTitleTa,
      sessionCode: sessionState.sessionCode,
      sessionStatus: sessionState.sessionStatus,
      questionStatus: sessionState.questionStatus,
      questionsCount: sessionState.questions.length,
      // Compatibility aliases:
      meetingTitle: sessionState.sessionTitle,
      departmentName: 'Poll Point Live',
      yearGroups: ['All Participants']
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// API: Question Library
app.get('/api/library', (req, res) => {
  const library = loadQuestionLibrary();
  res.json(library);
});

// API: Sessions History
app.get('/api/sessions', (req, res) => {
  const history = loadSessionsHistory();
  res.json(history);
});

// Backward compatibility alias for meetings history
app.get('/api/meetings/history', (req, res) => {
  const history = loadSessionsHistory();
  res.json(history.map(item => ({
    id: item.id,
    meetingTitle: item.sessionTitle,
    departmentName: 'Poll Point Live',
    archivedAt: item.archivedAt,
    totalVotes: item.totalVotes || 0,
    questionsCount: item.questionsCount || 0
  })));
});

// API: Current Session Summary
app.get('/api/session/summary', (req, res) => {
  const results = sessionState.questions.map(q => computeQuestionTallies(q.id));
  res.json({
    sessionTitle: sessionState.sessionTitle,
    sessionTitleTa: sessionState.sessionTitleTa,
    sessionCode: sessionState.sessionCode,
    sessionStatus: sessionState.sessionStatus,
    generatedAt: new Date().toISOString(),
    results
  });
});

// API: CSV Export (Bilingual English & Tamil)
app.get('/api/export/csv', (req, res) => {
  const filename = `Poll_Point_Results_${sessionState.sessionCode || 'Session'}_${new Date().toISOString().slice(0, 10)}.csv`;
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  let csv = [];
  csv.push(`\uFEFF"Poll Point Live Polling Report"`);
  csv.push(`"Session Title:","${(sessionState.sessionTitle || '').replace(/"/g, '""')}"`);
  csv.push(`"Session Title (Tamil):","${(sessionState.sessionTitleTa || '').replace(/"/g, '""')}"`);
  csv.push(`"Session Code:","${sessionState.sessionCode || ''}"`);
  csv.push(`"Exported At:","${new Date().toLocaleString()}"`);
  csv.push('');

  const headers = ['Question #', 'Poll Type', 'Question (English)', 'Question (Tamil)', 'Option # / Response', 'Option (English)', 'Option (Tamil)', 'Vote Count', 'Percentage'];
  csv.push(headers.join(','));

  sessionState.questions.forEach((q, qIndex) => {
    const tallies = computeQuestionTallies(q.id);
    const totalQVotes = tallies.totalVotes;

    if (q.type === 'short_answer') {
      const answers = tallies.textAnswers || [];
      if (answers.length === 0) {
        csv.push([
          `"Q${qIndex + 1}"`,
          `"Short Answer"`,
          `"${(q.text || '').replace(/"/g, '""')}"`,
          `"${(q.textTa || '').replace(/"/g, '""')}"`,
          `"-"`,
          `"No responses submitted"`,
          `"-"`,
          0,
          `"0%"`
        ].join(','));
      } else {
        answers.forEach((ans, aIdx) => {
          csv.push([
            `"Q${qIndex + 1}"`,
            `"Short Answer"`,
            `"${(q.text || '').replace(/"/g, '""')}"`,
            `"${(q.textTa || '').replace(/"/g, '""')}"`,
            `"#${aIdx + 1}"`,
            `"${ans.replace(/"/g, '""')}"`,
            `"-"`,
            1,
            `"-"`
          ].join(','));
        });
      }
    } else {
      (q.options || []).forEach((opt, optIndex) => {
        const optTa = (q.optionsTa && q.optionsTa[optIndex]) || '';
        const optCount = tallies.counts[optIndex] || 0;
        const pct = totalQVotes > 0 ? ((optCount / totalQVotes) * 100).toFixed(1) : '0.0';

        const row = [
          `"Q${qIndex + 1}"`,
          `"${q.type || 'multiple_choice'}"`,
          `"${(q.text || '').replace(/"/g, '""')}"`,
          `"${(q.textTa || '').replace(/"/g, '""')}"`,
          `"${optIndex + 1}"`,
          `"${(opt || '').replace(/"/g, '""')}"`,
          `"${optTa.replace(/"/g, '""')}"`,
          optCount,
          `"${pct}%"`
        ];
        csv.push(row.join(','));
      });
    }
    csv.push(''); // blank line between questions
  });

  res.send(csv.join('\r\n'));
});

// WebSocket Handling
io.on('connection', (socket) => {
  let clientRole = 'participant';
  let clientVoterToken = null;

  // Participant join handler (with backward compatible parent:join alias)
  function handleParticipantJoin(data) {
    const { voterToken } = data || {};
    if (!voterToken) return;

    clientRole = 'participant';
    clientVoterToken = voterToken;
    connectedParticipants.set(socket.id, voterToken);

    const activeQuestion = sessionState.questions.find(q => q.id === sessionState.currentQuestionId);
    let myVote = null;
    if (activeQuestion && sessionState.responses[activeQuestion.id]) {
      const resp = sessionState.responses[activeQuestion.id][voterToken];
      myVote = resp ? (resp.optionIndex !== undefined ? resp.optionIndex : resp.textAnswer) : null;
    }

    socket.emit('session:state', {
      sessionTitle: sessionState.sessionTitle,
      sessionTitleTa: sessionState.sessionTitleTa,
      sessionCode: sessionState.sessionCode,
      sessionStatus: sessionState.sessionStatus,
      questionStatus: sessionState.questionStatus,
      currentQuestion: activeQuestion ? {
        id: activeQuestion.id,
        type: activeQuestion.type || 'multiple_choice',
        text: activeQuestion.text,
        textTa: activeQuestion.textTa || '',
        options: activeQuestion.options || [],
        optionsTa: activeQuestion.optionsTa || []
      } : null,
      myVote,
      // Backward compatibility fields:
      meetingTitle: sessionState.sessionTitle,
      departmentName: 'Poll Point Live',
      showYearToParents: false,
      yearGroups: ['All Participants']
    });

    // Notify admin
    io.to('admin-room').emit('admin:stats', getAdminStats());
  }

  socket.on('participant:join', handleParticipantJoin);
  socket.on('parent:join', handleParticipantJoin);

  // Participant vote handler (with backward compatible parent:vote alias)
  function handleParticipantVote(data) {
    const { voterToken, questionId, optionIndex, textAnswer } = data || {};
    if (!voterToken || !questionId) {
      return socket.emit('participant:vote_error', { message: 'Invalid vote parameters / தவறான அளவுருக்கள்' });
    }

    // Verify question is currently live
    if (sessionState.currentQuestionId !== questionId || sessionState.questionStatus !== 'live') {
      return socket.emit('participant:vote_error', { message: 'Polling is not active for this question / இந்த கேள்விக்கான வாக்கெடுப்பு மூடப்பட்டுள்ளது' });
    }

    const question = sessionState.questions.find(q => q.id === questionId);
    if (!question) {
      return socket.emit('participant:vote_error', { message: 'Question not found' });
    }

    if (!sessionState.responses[questionId]) {
      sessionState.responses[questionId] = {};
    }

    if (question.type === 'short_answer') {
      if (!textAnswer || !textAnswer.trim()) {
        return socket.emit('participant:vote_error', { message: 'Please enter your answer' });
      }
      sessionState.responses[questionId][voterToken] = {
        textAnswer: textAnswer.trim().slice(0, 500),
        timestamp: Date.now()
      };
    } else {
      if (typeof optionIndex !== 'number' || optionIndex < 0 || optionIndex >= (question.options?.length || 0)) {
        return socket.emit('participant:vote_error', { message: 'Invalid option selected' });
      }
      sessionState.responses[questionId][voterToken] = {
        optionIndex,
        timestamp: Date.now()
      };
    }

    persistState();

    // Confirm to voter
    socket.emit('participant:vote_confirmed', {
      questionId,
      optionIndex,
      textAnswer
    });
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
  }

  socket.on('participant:vote', handleParticipantVote);
  socket.on('parent:vote', handleParticipantVote);

  // Admin joins
  socket.on('admin:join', () => {
    clientRole = 'admin';
    socket.join('admin-room');

    socket.emit('admin:init', {
      sessionTitle: sessionState.sessionTitle,
      sessionTitleTa: sessionState.sessionTitleTa,
      sessionCode: sessionState.sessionCode,
      sessionStatus: sessionState.sessionStatus,
      questions: sessionState.questions,
      currentQuestionId: sessionState.currentQuestionId,
      questionStatus: sessionState.questionStatus,
      tallies: sessionState.currentQuestionId ? computeQuestionTallies(sessionState.currentQuestionId) : null,
      stats: getAdminStats(),
      joinUrl: getActiveJoinUrl(),
      library: loadQuestionLibrary(),
      // Legacy compatibility:
      departmentName: 'Poll Point Live',
      meetingTitle: sessionState.sessionTitle,
      meetingStatus: sessionState.sessionStatus === 'live' ? 'active' : 'setup',
      showYearToParents: false,
      yearGroups: ['All Participants']
    });
  });

  // Admin creates a new poll session
  socket.on('admin:create_session', (data) => {
    const { sessionTitle, sessionTitleTa, sessionCode, cloneQuestions, newQuestions } = data || {};

    // Auto-archive active session
    if (sessionState.questions && sessionState.questions.length > 0) {
      archiveCurrentSessionSnapshot();
    }

    if (sessionTitle) sessionState.sessionTitle = sessionTitle.trim();
    if (sessionTitleTa) sessionState.sessionTitleTa = sessionTitleTa.trim();
    sessionState.sessionCode = sessionCode ? sessionCode.trim().toUpperCase() : 'POLL-' + Math.floor(1000 + Math.random() * 9000);
    sessionState.meetingTitle = sessionState.sessionTitle;

    // Reset responses
    sessionState.responses = {};
    sessionState.sessionStatus = 'draft';
    sessionState.questionStatus = 'idle';

    if (Array.isArray(newQuestions) && newQuestions.length > 0) {
      sessionState.questions = newQuestions;
    } else if (!cloneQuestions) {
      // Reload defaults
      try {
        if (fs.existsSync(DEFAULT_FILE)) {
          const defaults = JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8'));
          sessionState.questions = defaults.questions || [];
        }
      } catch (e) {
        console.error('Error reloading defaults for new session:', e);
      }
    }

    sessionState.currentQuestionId = sessionState.questions.length > 0 ? sessionState.questions[0].id : null;
    persistState();

    // Reset connected participants
    io.emit('session:reset', {
      sessionTitle: sessionState.sessionTitle,
      sessionTitleTa: sessionState.sessionTitleTa,
      sessionCode: sessionState.sessionCode
    });

    // Notify admin
    io.to('admin-room').emit('admin:init', {
      sessionTitle: sessionState.sessionTitle,
      sessionTitleTa: sessionState.sessionTitleTa,
      sessionCode: sessionState.sessionCode,
      sessionStatus: sessionState.sessionStatus,
      questions: sessionState.questions,
      currentQuestionId: sessionState.currentQuestionId,
      questionStatus: sessionState.questionStatus,
      tallies: sessionState.currentQuestionId ? computeQuestionTallies(sessionState.currentQuestionId) : null,
      stats: getAdminStats(),
      joinUrl: getActiveJoinUrl(),
      library: loadQuestionLibrary(),
      departmentName: 'Poll Point Live',
      meetingTitle: sessionState.sessionTitle
    });
  });

  // Admin save questions (Builder)
  socket.on('admin:save_questions', (data) => {
    const { questions: newQuestions, sessionTitle, sessionTitleTa } = data || {};
    if (sessionTitle) sessionState.sessionTitle = sessionTitle.trim();
    if (sessionTitleTa) sessionState.sessionTitleTa = sessionTitleTa.trim();
    sessionState.meetingTitle = sessionState.sessionTitle;

    if (Array.isArray(newQuestions)) {
      sessionState.questions = newQuestions.map((q, idx) => {
        const type = q.type || 'multiple_choice';
        let options = [];
        let optionsTa = [];

        if (type === 'yes_no') {
          options = ['Yes', 'No'];
          optionsTa = ['ஆம்', 'இல்லை'];
        } else if (type === 'rating') {
          options = ['1 Star - Poor', '2 Stars - Fair', '3 Stars - Good', '4 Stars - Very Good', '5 Stars - Outstanding'];
          optionsTa = ['1 - குறைவு', '2 - சுமாரானது', '3 - நல்லது', '4 - மிக நன்று', '5 - மிகச் சிறப்பானது'];
        } else if (type === 'short_answer') {
          options = [];
          optionsTa = [];
        } else {
          // multiple_choice
          options = Array.isArray(q.options)
            ? q.options.map(o => (o || '').trim()).filter(Boolean).slice(0, 6)
            : ['Option 1', 'Option 2'];
          optionsTa = Array.isArray(q.optionsTa)
            ? q.optionsTa.map(o => (o || '').trim()).slice(0, 6)
            : [];
        }

        return {
          id: q.id || `q_${Date.now()}_${idx}`,
          type,
          text: (q.text || '').trim() || 'Untitled Question',
          textTa: (q.textTa || '').trim() || '',
          options,
          optionsTa
        };
      });

      if (!sessionState.questions.find(q => q.id === sessionState.currentQuestionId)) {
        sessionState.currentQuestionId = sessionState.questions.length > 0 ? sessionState.questions[0].id : null;
        sessionState.questionStatus = 'idle';
      }
    }

    persistState();

    io.to('admin-room').emit('admin:questions_saved', {
      sessionTitle: sessionState.sessionTitle,
      sessionTitleTa: sessionState.sessionTitleTa,
      questions: sessionState.questions,
      currentQuestionId: sessionState.currentQuestionId,
      tallies: sessionState.currentQuestionId ? computeQuestionTallies(sessionState.currentQuestionId) : null,
      stats: getAdminStats()
    });
  });

  // Admin imports template from library
  socket.on('admin:import_template', ({ templateId }) => {
    const library = loadQuestionLibrary();
    const tpl = library.templates.find(t => t.id === templateId);
    if (!tpl) return;

    const newQ = {
      id: `q_${Date.now()}_${Math.floor(Math.random()*1000)}`,
      type: tpl.type || 'multiple_choice',
      text: tpl.text,
      textTa: tpl.textTa || '',
      options: Array.isArray(tpl.options) ? [...tpl.options] : [],
      optionsTa: Array.isArray(tpl.optionsTa) ? [...tpl.optionsTa] : []
    };

    sessionState.questions.push(newQ);
    if (!sessionState.currentQuestionId) {
      sessionState.currentQuestionId = newQ.id;
    }
    persistState();

    io.to('admin-room').emit('admin:questions_saved', {
      sessionTitle: sessionState.sessionTitle,
      sessionTitleTa: sessionState.sessionTitleTa,
      questions: sessionState.questions,
      currentQuestionId: sessionState.currentQuestionId,
      tallies: sessionState.currentQuestionId ? computeQuestionTallies(sessionState.currentQuestionId) : null,
      stats: getAdminStats()
    });
  });

  // Admin launches question
  socket.on('admin:launch_question', ({ questionId }) => {
    const question = sessionState.questions.find(q => q.id === questionId);
    if (!question) return;

    sessionState.currentQuestionId = questionId;
    sessionState.sessionStatus = 'live';
    sessionState.questionStatus = 'live';
    if (!sessionState.responses[questionId]) {
      sessionState.responses[questionId] = {};
    }
    persistState();

    const payload = {
      id: question.id,
      type: question.type || 'multiple_choice',
      text: question.text,
      textTa: question.textTa || '',
      options: question.options || [],
      optionsTa: question.optionsTa || []
    };

    io.emit('question:live', payload);

    io.to('admin-room').emit('admin:state_change', {
      sessionStatus: 'live',
      currentQuestionId: questionId,
      questionStatus: 'live',
      tallies: computeQuestionTallies(questionId),
      stats: getAdminStats()
    });
  });

  // Admin pauses question
  socket.on('admin:pause_question', () => {
    sessionState.questionStatus = 'paused';
    persistState();

    io.emit('question:paused', {
      questionId: sessionState.currentQuestionId
    });

    io.to('admin-room').emit('admin:state_change', {
      sessionStatus: sessionState.sessionStatus,
      currentQuestionId: sessionState.currentQuestionId,
      questionStatus: 'paused',
      tallies: sessionState.currentQuestionId ? computeQuestionTallies(sessionState.currentQuestionId) : null,
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
      sessionStatus: sessionState.sessionStatus,
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
        type: question.type || 'multiple_choice',
        text: question.text,
        textTa: question.textTa || '',
        options: question.options || [],
        optionsTa: question.optionsTa || []
      });
    }

    io.to('admin-room').emit('admin:state_change', {
      sessionStatus: sessionState.sessionStatus,
      currentQuestionId: sessionState.currentQuestionId,
      questionStatus: 'live',
      tallies: computeQuestionTallies(sessionState.currentQuestionId),
      stats: getAdminStats()
    });
  });

  // Admin navigates questions (Next / Prev)
  socket.on('admin:next_question', () => {
    const qList = sessionState.questions;
    if (qList.length === 0) return;
    const curIdx = qList.findIndex(q => q.id === sessionState.currentQuestionId);
    if (curIdx < qList.length - 1) {
      const nextQ = qList[curIdx + 1];
      sessionState.currentQuestionId = nextQ.id;
      sessionState.questionStatus = 'idle';
      persistState();

      io.to('admin-room').emit('admin:state_change', {
        sessionStatus: sessionState.sessionStatus,
        currentQuestionId: nextQ.id,
        questionStatus: 'idle',
        tallies: computeQuestionTallies(nextQ.id),
        stats: getAdminStats()
      });
    }
  });

  socket.on('admin:prev_question', () => {
    const qList = sessionState.questions;
    if (qList.length === 0) return;
    const curIdx = qList.findIndex(q => q.id === sessionState.currentQuestionId);
    if (curIdx > 0) {
      const prevQ = qList[curIdx - 1];
      sessionState.currentQuestionId = prevQ.id;
      sessionState.questionStatus = 'idle';
      persistState();

      io.to('admin-room').emit('admin:state_change', {
        sessionStatus: sessionState.sessionStatus,
        currentQuestionId: prevQ.id,
        questionStatus: 'idle',
        tallies: computeQuestionTallies(prevQ.id),
        stats: getAdminStats()
      });
    }
  });

  // Admin ends entire poll session
  socket.on('admin:end_session', () => {
    sessionState.sessionStatus = 'closed';
    sessionState.questionStatus = 'closed';
    persistState();

    archiveCurrentSessionSnapshot();

    io.emit('session:ended', {
      sessionCode: sessionState.sessionCode
    });

    io.to('admin-room').emit('admin:state_change', {
      sessionStatus: 'closed',
      currentQuestionId: sessionState.currentQuestionId,
      questionStatus: 'closed',
      tallies: sessionState.currentQuestionId ? computeQuestionTallies(sessionState.currentQuestionId) : null,
      stats: getAdminStats()
    });
  });

  // Admin resets votes for a question
  socket.on('admin:reset_question', ({ questionId }) => {
    if (sessionState.responses[questionId]) {
      sessionState.responses[questionId] = {};
      persistState();

      io.to('admin-room').emit('poll:update', {
        questionId,
        tallies: computeQuestionTallies(questionId),
        stats: getAdminStats()
      });
    }
  });

  // Admin updates settings
  socket.on('admin:update_settings', ({ sessionTitle, sessionTitleTa, sessionCode, customJoinUrl }) => {
    if (sessionTitle) sessionState.sessionTitle = sessionTitle.trim();
    if (sessionTitleTa) sessionState.sessionTitleTa = sessionTitleTa.trim();
    if (sessionCode) sessionState.sessionCode = sessionCode.trim().toUpperCase();
    if (customJoinUrl !== undefined) sessionState.customJoinUrl = customJoinUrl.trim();
    sessionState.meetingTitle = sessionState.sessionTitle;
    persistState();

    io.to('admin-room').emit('admin:settings_updated', {
      sessionTitle: sessionState.sessionTitle,
      sessionTitleTa: sessionState.sessionTitleTa,
      sessionCode: sessionState.sessionCode,
      customJoinUrl: sessionState.customJoinUrl,
      joinUrl: getActiveJoinUrl()
    });
  });

  // Disconnect handling
  socket.on('disconnect', () => {
    if (clientRole === 'participant') {
      connectedParticipants.delete(socket.id);
      io.to('admin-room').emit('admin:stats', getAdminStats());
    }
  });
});

// Start server with automatic port retry if busy
function startServer(port) {
  server.listen(port, '0.0.0.0', () => {
    const actualPort = server.address().port;
    console.log(`====================================================`);
    console.log(`     Poll Point - Live Polling Web App Started     `);
    console.log(`====================================================`);
    console.log(`  Admin Dashboard:    http://localhost:${actualPort}/admin.html`);
    console.log(`  Participant URL:    http://${localIp}:${actualPort}`);
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
