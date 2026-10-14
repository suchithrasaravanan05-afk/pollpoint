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
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Local network IP helper
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

// Default Settings
const defaultSettings = {
  departmentName: 'Department of Computer Science and Business Systems',
  defaultMeetingTitle: 'CSBS Parent–Teacher Meeting',
  academicYear: '2026',
  defaultLanguage: 'Bilingual (English & Tamil)',
  meetingDuration: '60',
  questionsPerMeeting: '5',
  allowAnswerChanges: true,
  showTamilTranslation: true,
  showProgressIndicator: true,
  allowParentReentry: true,
  requireYearSelection: true,
  showConfirmation: true,
  accentColor: '#4338ca',
  displayLanguage: 'en-ta',
  defaultExportFormat: 'csv',
  includeTamilResponses: true,
  includeYearCategory: true,
  includeTimestamps: true,
  yearGroups: ['1st Year', '2nd Year', '3rd Year', 'Final Year']
};

let settings = { ...defaultSettings };

// Meetings History helpers
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

// Load Settings
function loadSettings() {
  try {
    if (fs.existsSync(SETTINGS_FILE)) {
      const data = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8'));
      settings = { ...defaultSettings, ...data };
      return;
    }
  } catch (err) {
    console.error('Failed to parse settings.json:', err);
  }
  settings = { ...defaultSettings };
}

function persistSettings() {
  try {
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save settings.json:', err);
  }
}

// Session State Structure
let sessionState = {
  currentMeeting: {
    id: 'mtg_default_2026',
    title: 'Parent–Teacher Meeting 2026',
    academicYear: '2026',
    date: new Date().toISOString().slice(0, 10),
    description: 'CSBS Department Parent-Teacher Interaction Session',
    status: 'WAITING_FOR_PARENTS', // 'DRAFT' | 'WAITING_FOR_PARENTS' | 'READY' | 'QUESTION_LIVE' | 'QUESTION_CLOSED' | 'COMPLETED'
    currentQuestionIndex: 0,
    currentQuestionId: 'q1',
    questionStatus: 'idle', // 'idle' | 'live' | 'closed'
    selectedQuestionIds: ['q1', 'q2', 'q3', 'q4', 'q5'],
    createdAt: new Date().toISOString()
  },
  questions: [],
  participants: {}, // voterToken -> { participantId, meetingId, studentYear, joinedAt, lastSeen, socketId }
  responses: {} // key: `${meetingId}:${questionId}:${voterToken}` -> { id, meetingId, participantId, questionId, selectedOption, studentYear, submittedAt, updatedAt }
};

// Load default questions
function loadDefaultQuestions() {
  try {
    if (fs.existsSync(DEFAULT_FILE)) {
      const defaults = JSON.parse(fs.readFileSync(DEFAULT_FILE, 'utf8'));
      return defaults.questions || [];
    }
  } catch (e) {
    console.error('Failed to load default questions:', e);
  }
  return [];
}

// Load initial state
function loadState() {
  loadSettings();
  try {
    if (fs.existsSync(STATE_FILE)) {
      const saved = JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
      if (saved && typeof saved === 'object') {
        if (saved.currentMeeting) sessionState.currentMeeting = { ...sessionState.currentMeeting, ...saved.currentMeeting };
        if (Array.isArray(saved.questions) && saved.questions.length > 0) sessionState.questions = saved.questions;
        if (saved.participants) sessionState.participants = saved.participants;
        if (saved.responses) sessionState.responses = saved.responses;
        console.log('Loaded session state from session_state.json');
        return;
      }
    }
  } catch (err) {
    console.error('Error loading session_state.json:', err);
  }

  sessionState.questions = loadDefaultQuestions();
  if (sessionState.questions.length > 0) {
    sessionState.currentMeeting.selectedQuestionIds = sessionState.questions.map(q => q.id);
    sessionState.currentMeeting.currentQuestionId = sessionState.questions[0].id;
  }
}

loadState();

// State Persistence (Debounced)
let saveTimeout = null;
function persistState() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = setTimeout(() => {
    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(sessionState, null, 2), 'utf8');
    } catch (e) {
      console.error('Error persisting state:', e);
    }
  }, 300);
}

// Port and URL helpers
function getActivePort() {
  const addr = server.address();
  return addr && typeof addr === 'object' ? addr.port : currentPort;
}

function getActiveJoinUrl() {
  return `http://${localIp}:${getActivePort()}`;
}

// Attendance Calculation - Single Source of Truth from sessionState.participants
function getAttendanceStats(meetingId = sessionState.currentMeeting.id) {
  const yearCounts = {};
  settings.yearGroups.forEach(yg => { yearCounts[yg] = 0; });
  let total = 0;

  for (const token in sessionState.participants) {
    const p = sessionState.participants[token];
    if (p && p.meetingId === meetingId && p.studentYear) {
      if (yearCounts[p.studentYear] !== undefined) {
        yearCounts[p.studentYear]++;
        total++;
      }
    }
  }

  return {
    total,
    yearBreakdown: yearCounts
  };
}

// Question Tallies Calculation - Grouped by Year + All Years
function computeQuestionTallies(questionId, meetingId = sessionState.currentMeeting.id) {
  const question = sessionState.questions.find(q => q.id === questionId);
  if (!question) return null;

  const totalOptions = question.options.length;
  const breakdown = {
    'All Years': new Array(totalOptions).fill(0)
  };
  const yearTotals = {
    'All Years': 0
  };

  settings.yearGroups.forEach(yg => {
    breakdown[yg] = new Array(totalOptions).fill(0);
    yearTotals[yg] = 0;
  });

  let totalVotes = 0;

  // Search normalized responses
  for (const respKey in sessionState.responses) {
    const resp = sessionState.responses[respKey];
    if (resp && resp.meetingId === meetingId && resp.questionId === questionId) {
      const optIdx = resp.selectedOption;
      const yg = resp.studentYear;

      if (optIdx >= 0 && optIdx < totalOptions) {
        breakdown['All Years'][optIdx]++;
        yearTotals['All Years']++;
        totalVotes++;

        if (breakdown[yg]) {
          breakdown[yg][optIdx]++;
          yearTotals[yg]++;
        }
      }
    }
  }

  // Calculate percentages
  const percentages = {
    'All Years': breakdown['All Years'].map(count => totalVotes > 0 ? ((count / totalVotes) * 100).toFixed(1) : '0.0')
  };
  settings.yearGroups.forEach(yg => {
    const ygTotal = yearTotals[yg] || 0;
    percentages[yg] = breakdown[yg].map(count => ygTotal > 0 ? ((count / ygTotal) * 100).toFixed(1) : '0.0');
  });

  const attendance = getAttendanceStats(meetingId);
  const participationRate = attendance.total > 0 ? Math.round((totalVotes / attendance.total) * 100) : 0;

  return {
    questionId,
    questionText: question.text,
    questionTextTa: question.textTa || '',
    options: question.options,
    optionsTa: question.optionsTa || [],
    status: sessionState.currentMeeting.currentQuestionId === questionId ? sessionState.currentMeeting.questionStatus : 'closed',
    totalVotes,
    breakdown,
    yearTotals,
    percentages,
    participationRate
  };
}

// Compute comprehensive stats for Admin Overview
function getAdminStats() {
  const meeting = sessionState.currentMeeting;
  const attendance = getAttendanceStats(meeting.id);

  // Selected questions count & progress
  const selectedQuestions = sessionState.questions.filter(q =>
    (meeting.selectedQuestionIds || []).includes(q.id)
  );
  const totalQuestions = selectedQuestions.length;

  // Count distinct questions answered
  const answeredQuestionIds = new Set();
  let totalResponsesCount = 0;
  for (const key in sessionState.responses) {
    const r = sessionState.responses[key];
    if (r && r.meetingId === meeting.id) {
      answeredQuestionIds.add(r.questionId);
      totalResponsesCount++;
    }
  }

  // Current question index (1-based for UI)
  const currentIdx = selectedQuestions.findIndex(q => q.id === meeting.currentQuestionId);
  const activeQuestionIndex = currentIdx >= 0 ? currentIdx + 1 : 1;

  // Question tallies for current question
  const tallies = meeting.currentQuestionId ? computeQuestionTallies(meeting.currentQuestionId, meeting.id) : null;

  // Overall participation
  const expectedTotalPossible = attendance.total * (totalQuestions || 1);
  const overallParticipation = attendance.total > 0 && totalQuestions > 0
    ? Math.min(100, Math.round((totalResponsesCount / expectedTotalPossible) * 100))
    : 0;

  return {
    meeting: {
      id: meeting.id,
      title: meeting.title,
      academicYear: meeting.academicYear,
      date: meeting.date,
      description: meeting.description,
      status: meeting.status,
      currentQuestionId: meeting.currentQuestionId,
      currentQuestionIndex: activeQuestionIndex,
      questionStatus: meeting.questionStatus,
      totalQuestions
    },
    attendance: {
      total: attendance.total,
      yearBreakdown: attendance.yearBreakdown
    },
    progress: {
      questionsCompleted: answeredQuestionIds.size,
      totalQuestions,
      totalResponses: totalResponsesCount,
      overallParticipation
    },
    tallies
  };
}

// Archive Snapshot of Current Meeting
function archiveCurrentMeetingSnapshot() {
  const meeting = sessionState.currentMeeting;
  const attendance = getAttendanceStats(meeting.id);
  const history = loadMeetingHistory();

  const selectedQuestions = sessionState.questions.filter(q =>
    (meeting.selectedQuestionIds || []).includes(q.id)
  );

  const results = selectedQuestions.map(q => computeQuestionTallies(q.id, meeting.id));

  let totalVotes = 0;
  for (const k in sessionState.responses) {
    if (sessionState.responses[k]?.meetingId === meeting.id) totalVotes++;
  }

  const expectedTotal = attendance.total * (selectedQuestions.length || 1);
  const participationRate = attendance.total > 0 && selectedQuestions.length > 0
    ? Math.min(100, Math.round((totalVotes / expectedTotal) * 100))
    : 0;

  // Gather meeting responses
  const meetingResponses = {};
  for (const k in sessionState.responses) {
    if (sessionState.responses[k]?.meetingId === meeting.id) {
      meetingResponses[k] = sessionState.responses[k];
    }
  }

  const archiveEntry = {
    id: meeting.id,
    title: meeting.title,
    academicYear: meeting.academicYear,
    date: meeting.date,
    description: meeting.description,
    departmentName: settings.departmentName,
    archivedAt: new Date().toISOString(),
    status: 'COMPLETED',
    totalParents: attendance.total,
    yearBreakdown: attendance.yearBreakdown,
    totalVotes,
    questionsCount: selectedQuestions.length,
    participationRate,
    questions: selectedQuestions,
    results,
    responses: meetingResponses
  };

  // Replace if existing archive with same id exists, else unshift
  const existingIdx = history.findIndex(m => m.id === meeting.id);
  if (existingIdx >= 0) {
    history[existingIdx] = archiveEntry;
  } else {
    history.unshift(archiveEntry);
  }

  saveMeetingHistory(history);
  return archiveEntry;
}

// Express Middlewares
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// -------------------------------------------------------------
// REST APIs
// -------------------------------------------------------------

// System Info
app.get('/api/info', async (req, res) => {
  const port = getActivePort();
  const joinUrl = getActiveJoinUrl();
  try {
    const qrDataUrl = await QRCode.toDataURL(joinUrl, {
      margin: 2,
      scale: 8,
      color: { dark: '#4338ca', light: '#ffffff' }
    });

    res.json({
      localIp,
      port,
      joinUrl,
      qrDataUrl,
      departmentName: settings.departmentName,
      meeting: sessionState.currentMeeting,
      settings
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR code' });
  }
});

// Settings GET & POST
app.get('/api/settings', (req, res) => {
  res.json(settings);
});

app.post('/api/settings', (req, res) => {
  const newSettings = req.body || {};
  settings = { ...settings, ...newSettings };
  persistSettings();
  io.emit('settings:updated', settings);
  res.json({ success: true, settings });
});

// Current Meeting Details & Stats
app.get('/api/meetings/current', (req, res) => {
  res.json(getAdminStats());
});

// Archived Meetings List
app.get('/api/meetings/history', (req, res) => {
  const history = loadMeetingHistory();
  const summaries = history.map(item => ({
    id: item.id,
    title: item.title,
    academicYear: item.academicYear || '',
    date: item.date || item.archivedAt?.slice(0, 10),
    archivedAt: item.archivedAt,
    questionsCount: item.questionsCount || (item.questions ? item.questions.length : 0),
    totalParents: item.totalParents || 0,
    participationRate: item.participationRate || 0,
    status: item.status || 'COMPLETED'
  }));
  res.json(summaries);
});

// Single Historical Meeting Details
app.get('/api/meetings/history/:id', (req, res) => {
  const history = loadMeetingHistory();
  const meeting = history.find(m => m.id === req.params.id);
  if (!meeting) return res.status(404).json({ error: 'Meeting not found' });
  res.json(meeting);
});

// Delete Historical Meeting
app.delete('/api/meetings/history/:id', (req, res) => {
  let history = loadMeetingHistory();
  const beforeCount = history.length;
  history = history.filter(m => m.id !== req.params.id);
  if (history.length === beforeCount) {
    return res.status(404).json({ error: 'Meeting not found' });
  }
  saveMeetingHistory(history);
  res.json({ success: true });
});

// Questions Bank APIs
app.get('/api/questions', (req, res) => {
  res.json(sessionState.questions);
});

app.post('/api/questions', (req, res) => {
  const { text, textTa, options, optionsTa } = req.body || {};
  if (!text || !options || options.length < 2) {
    return res.status(400).json({ error: 'Text and at least 2 options required' });
  }

  const newQ = {
    id: 'q_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
    text: text.trim(),
    textTa: (textTa || '').trim(),
    options: options.map(o => (o || '').trim()).filter(Boolean),
    optionsTa: Array.isArray(optionsTa) ? optionsTa.map(o => (o || '').trim()) : []
  };

  sessionState.questions.push(newQ);
  persistState();
  io.emit('questions:updated', sessionState.questions);
  res.json({ success: true, question: newQ });
});

app.put('/api/questions/:id', (req, res) => {
  const { id } = req.params;
  const { text, textTa, options, optionsTa } = req.body || {};
  const q = sessionState.questions.find(item => item.id === id);
  if (!q) return res.status(404).json({ error: 'Question not found' });

  if (text) q.text = text.trim();
  if (textTa !== undefined) q.textTa = textTa.trim();
  if (Array.isArray(options) && options.length >= 2) {
    q.options = options.map(o => (o || '').trim()).filter(Boolean);
  }
  if (Array.isArray(optionsTa)) {
    q.optionsTa = optionsTa.map(o => (o || '').trim());
  }

  persistState();
  io.emit('questions:updated', sessionState.questions);
  res.json({ success: true, question: q });
});

app.delete('/api/questions/:id', (req, res) => {
  const { id } = req.params;
  sessionState.questions = sessionState.questions.filter(item => item.id !== id);
  sessionState.currentMeeting.selectedQuestionIds = (sessionState.currentMeeting.selectedQuestionIds || []).filter(qId => qId !== id);

  // Clean responses for this question
  for (const k in sessionState.responses) {
    if (sessionState.responses[k]?.questionId === id) {
      delete sessionState.responses[k];
    }
  }

  if (sessionState.currentMeeting.currentQuestionId === id) {
    sessionState.currentMeeting.currentQuestionId = sessionState.questions[0] ? sessionState.questions[0].id : null;
    sessionState.currentMeeting.questionStatus = 'idle';
  }

  persistState();
  io.emit('questions:updated', sessionState.questions);
  res.json({ success: true });
});

app.post('/api/questions/reorder', (req, res) => {
  const { questionIds } = req.body || {};
  if (!Array.isArray(questionIds)) {
    return res.status(400).json({ error: 'questionIds array required' });
  }

  const newQuestions = [];
  questionIds.forEach(qId => {
    const found = sessionState.questions.find(q => q.id === qId);
    if (found) newQuestions.push(found);
  });

  // Append any missing questions to prevent data loss
  sessionState.questions.forEach(q => {
    if (!newQuestions.some(nq => nq.id === q.id)) {
      newQuestions.push(q);
    }
  });

  sessionState.questions = newQuestions;
  sessionState.currentMeeting.selectedQuestionIds = newQuestions.map(q => q.id);
  persistState();
  io.emit('questions:updated', sessionState.questions);
  res.json({ success: true, questions: sessionState.questions });
});

// Export CSV API - Responses
app.get('/api/export/csv', (req, res) => {
  const meeting = sessionState.currentMeeting;
  const filename = `PTM_${meeting.title.replace(/[^a-zA-Z0-9]/g, '_')}_Responses.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const csv = [];
  csv.push(`\uFEFF"CSBS Parent-Teacher Meeting Polling Report"`);
  csv.push(`"Department:","${(settings.departmentName || '').replace(/"/g, '""')}"`);
  csv.push(`"Meeting Title:","${(meeting.title || '').replace(/"/g, '""')}"`);
  csv.push(`"Academic Year:","${(meeting.academicYear || '').replace(/"/g, '""')}"`);
  csv.push(`"Meeting Date:","${meeting.date || ''}"`);
  csv.push(`"Exported At:","${new Date().toLocaleString()}"`);
  csv.push('');

  // Headers
  const headers = [
    'Participant ID',
    'Student Year',
    'Question Number',
    'Question (English)',
    'Question (Tamil)',
    'Selected Option',
    'Answer Text (English)',
    'Answer Text (Tamil)',
    'Timestamp'
  ];
  csv.push(headers.map(h => `"${h}"`).join(','));

  const selectedQuestions = sessionState.questions.filter(q =>
    (meeting.selectedQuestionIds || []).includes(q.id)
  );

  // Collect responses for current meeting
  const responsesList = [];
  for (const k in sessionState.responses) {
    const r = sessionState.responses[k];
    if (r && r.meetingId === meeting.id) {
      responsesList.push(r);
    }
  }

  // Sort by question and timestamp
  responsesList.sort((a, b) => a.questionId.localeCompare(b.questionId) || a.submittedAt - b.submittedAt);

  responsesList.forEach(resp => {
    const qIndex = selectedQuestions.findIndex(q => q.id === resp.questionId);
    const q = selectedQuestions[qIndex] || sessionState.questions.find(item => item.id === resp.questionId);
    const optLetter = ['A', 'B', 'C', 'D'][resp.selectedOption] || (resp.selectedOption + 1);
    const optTextEn = q ? (q.options[resp.selectedOption] || '') : '';
    const optTextTa = q ? (q.optionsTa?.[resp.selectedOption] || '') : '';

    const row = [
      `"${resp.participantId}"`,
      `"${resp.studentYear || 'Not Specified'}"`,
      `"Q${qIndex >= 0 ? qIndex + 1 : '-'}"`,
      `"${(q?.text || '').replace(/"/g, '""')}"`,
      `"${(q?.textTa || '').replace(/"/g, '""')}"`,
      `"${optLetter}"`,
      `"${optTextEn.replace(/"/g, '""')}"`,
      `"${optTextTa.replace(/"/g, '""')}"`,
      `"${new Date(resp.updatedAt || resp.submittedAt).toLocaleString()}"`
    ];
    csv.push(row.join(','));
  });

  res.send(csv.join('\r\n'));
});

// Export CSV API - Attendance
app.get('/api/export/attendance/csv', (req, res) => {
  const meeting = sessionState.currentMeeting;
  const filename = `PTM_${meeting.title.replace(/[^a-zA-Z0-9]/g, '_')}_Attendance.csv`;

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

  const csv = [];
  csv.push(`\uFEFF"CSBS Parent-Teacher Meeting Attendance Log"`);
  csv.push(`"Department:","${(settings.departmentName || '').replace(/"/g, '""')}"`);
  csv.push(`"Meeting:","${(meeting.title || '').replace(/"/g, '""')}"`);
  csv.push(`"Date:","${meeting.date || ''}"`);
  csv.push('');

  const headers = ['Participant ID', 'Student Year', 'Joined At', 'Total Questions Answered'];
  csv.push(headers.map(h => `"${h}"`).join(','));

  for (const token in sessionState.participants) {
    const p = sessionState.participants[token];
    if (p && p.meetingId === meeting.id) {
      let answeredCount = 0;
      for (const rk in sessionState.responses) {
        if (sessionState.responses[rk]?.meetingId === meeting.id && sessionState.responses[rk]?.participantId === token) {
          answeredCount++;
        }
      }

      const row = [
        `"${p.participantId}"`,
        `"${p.studentYear || 'Not Specified'}"`,
        `"${new Date(p.joinedAt).toLocaleString()}"`,
        answeredCount
      ];
      csv.push(row.join(','));
    }
  }

  res.send(csv.join('\r\n'));
});

// Summary Report API
app.get('/api/session/summary', (req, res) => {
  const meeting = sessionState.currentMeeting;
  const attendance = getAttendanceStats(meeting.id);
  const selectedQuestions = sessionState.questions.filter(q =>
    (meeting.selectedQuestionIds || []).includes(q.id)
  );

  const results = selectedQuestions.map(q => computeQuestionTallies(q.id, meeting.id));

  let totalVotes = 0;
  for (const k in sessionState.responses) {
    if (sessionState.responses[k]?.meetingId === meeting.id) totalVotes++;
  }

  const expectedTotal = attendance.total * (selectedQuestions.length || 1);
  const participationRate = attendance.total > 0 && selectedQuestions.length > 0
    ? Math.min(100, Math.round((totalVotes / expectedTotal) * 100))
    : 0;

  res.json({
    meetingTitle: meeting.title,
    departmentName: settings.departmentName,
    academicYear: meeting.academicYear,
    meetingDate: meeting.date,
    status: meeting.status,
    totalParents: attendance.total,
    yearBreakdown: attendance.yearBreakdown,
    totalQuestions: selectedQuestions.length,
    totalResponses: totalVotes,
    participationRate,
    results
  });
});

// -------------------------------------------------------------
// WebSocket Real-time Handlers
// -------------------------------------------------------------

io.on('connection', (socket) => {
  let role = 'guest';
  let clientVoterToken = null;

  // ---------------- ADMIN SOCKET EVENTS ----------------
  socket.on('admin:join', () => {
    role = 'admin';
    socket.join('admin-room');

    socket.emit('admin:init', {
      settings,
      stats: getAdminStats(),
      questions: sessionState.questions,
      joinUrl: getActiveJoinUrl(),
      historySummaries: loadMeetingHistory().slice(0, 5)
    });
  });

  // Admin opens meeting
  socket.on('admin:open_meeting', () => {
    sessionState.currentMeeting.status = 'WAITING_FOR_PARENTS';
    persistState();

    io.to('admin-room').emit('meeting:state_changed', getAdminStats());
    io.emit('session:meeting_state', {
      status: sessionState.currentMeeting.status,
      title: sessionState.currentMeeting.title,
      departmentName: settings.departmentName
    });
  });

  // Admin starts meeting (moves from waiting to ready for questions)
  socket.on('admin:start_meeting', () => {
    sessionState.currentMeeting.status = 'READY';
    if (!sessionState.currentMeeting.currentQuestionId && sessionState.questions.length > 0) {
      sessionState.currentMeeting.currentQuestionId = sessionState.questions[0].id;
    }
    persistState();

    io.to('admin-room').emit('meeting:state_changed', getAdminStats());
    io.to('admin-room').emit('admin:meeting_started', { meetingStatus: 'READY' });
    io.emit('session:meeting_state', {
      status: sessionState.currentMeeting.status,
      title: sessionState.currentMeeting.title,
      departmentName: settings.departmentName
    });
  });

  // Admin previews/navigates question (DOES NOT LAUNCH TO PARENTS)
  socket.on('admin:navigate_preview', ({ questionId }) => {
    const q = sessionState.questions.find(item => item.id === questionId);
    if (!q) return;

    // We only update the admin's active preview, but do not change the live question for parents unless launched!
    const tallies = computeQuestionTallies(questionId, sessionState.currentMeeting.id);
    socket.emit('admin:preview_updated', {
      question: q,
      tallies
    });
  });

  // Admin launches question to parents
  socket.on('admin:launch_question', ({ questionId }) => {
    const q = sessionState.questions.find(item => item.id === questionId);
    if (!q) return;

    sessionState.currentMeeting.currentQuestionId = questionId;
    sessionState.currentMeeting.status = 'QUESTION_LIVE';
    sessionState.currentMeeting.questionStatus = 'live';

    // Update current question index
    const selectedQuestions = sessionState.questions.filter(item =>
      (sessionState.currentMeeting.selectedQuestionIds || []).includes(item.id)
    );
    const idx = selectedQuestions.findIndex(item => item.id === questionId);
    sessionState.currentMeeting.currentQuestionIndex = idx >= 0 ? idx + 1 : 1;

    persistState();

    // Broadcast question to parents
    io.emit('question:live', {
      id: q.id,
      index: sessionState.currentMeeting.currentQuestionIndex,
      totalQuestions: selectedQuestions.length || sessionState.questions.length,
      text: q.text,
      textTa: settings.showTamilTranslation ? (q.textTa || '') : '',
      options: q.options,
      optionsTa: settings.showTamilTranslation ? (q.optionsTa || []) : []
    });

    // Notify admin
    io.to('admin-room').emit('meeting:state_changed', getAdminStats());
    io.to('admin-room').emit('poll:update', {
      questionId,
      tallies: computeQuestionTallies(questionId, sessionState.currentMeeting.id),
      stats: getAdminStats()
    });
  });

  // Admin closes question
  socket.on('admin:close_question', () => {
    sessionState.currentMeeting.questionStatus = 'closed';
    sessionState.currentMeeting.status = 'QUESTION_CLOSED';
    persistState();

    io.emit('question:closed', {
      questionId: sessionState.currentMeeting.currentQuestionId
    });

    io.to('admin-room').emit('meeting:state_changed', getAdminStats());
    if (sessionState.currentMeeting.currentQuestionId) {
      io.to('admin-room').emit('poll:update', {
        questionId: sessionState.currentMeeting.currentQuestionId,
        tallies: computeQuestionTallies(sessionState.currentMeeting.currentQuestionId, sessionState.currentMeeting.id),
        stats: getAdminStats()
      });
    }
  });

  // Admin ends meeting
  socket.on('admin:end_meeting', () => {
    sessionState.currentMeeting.status = 'COMPLETED';
    sessionState.currentMeeting.questionStatus = 'closed';
    archiveCurrentMeetingSnapshot();
    persistState();

    io.emit('session:meeting_state', {
      status: 'COMPLETED',
      title: sessionState.currentMeeting.title,
      departmentName: settings.departmentName
    });

    io.to('admin-room').emit('meeting:state_changed', getAdminStats());
    io.to('admin-room').emit('admin:history_updated', loadMeetingHistory().slice(0, 5));
  });

  // Admin creates new meeting
  socket.on('admin:create_meeting', (data) => {
    const { title, academicYear, date, description, questionIds } = data || {};

    // Auto-archive current session before resetting
    if (sessionState.currentMeeting && sessionState.currentMeeting.status !== 'DRAFT') {
      archiveCurrentMeetingSnapshot();
    }

    const meetingId = 'mtg_' + Date.now();
    const validQIds = Array.isArray(questionIds) && questionIds.length > 0
      ? questionIds
      : sessionState.questions.slice(0, 5).map(q => q.id);

    sessionState.currentMeeting = {
      id: meetingId,
      title: (title || settings.defaultMeetingTitle || 'CSBS Parent–Teacher Meeting').trim(),
      academicYear: (academicYear || settings.academicYear || '2026').trim(),
      date: date || new Date().toISOString().slice(0, 10),
      description: (description || '').trim(),
      status: 'WAITING_FOR_PARENTS',
      currentQuestionIndex: 0,
      currentQuestionId: validQIds[0] || null,
      questionStatus: 'idle',
      selectedQuestionIds: validQIds,
      createdAt: new Date().toISOString()
    };

    // Reset responses and participant registrations for new meeting
    sessionState.responses = {};
    sessionState.participants = {};
    persistState();

    // Broadcast reset to all parents
    io.emit('session:reset_for_new_meeting', {
      meetingId,
      title: sessionState.currentMeeting.title,
      departmentName: settings.departmentName,
      status: sessionState.currentMeeting.status
    });

    io.to('admin-room').emit('meeting:state_changed', getAdminStats());
    io.to('admin-room').emit('admin:history_updated', loadMeetingHistory().slice(0, 5));
  });

  // Admin resets votes for a question
  socket.on('admin:reset_question', ({ questionId }) => {
    const meetingId = sessionState.currentMeeting.id;
    for (const k in sessionState.responses) {
      if (sessionState.responses[k]?.meetingId === meetingId && sessionState.responses[k]?.questionId === questionId) {
        delete sessionState.responses[k];
      }
    }
    persistState();

    io.emit('question:reset', { questionId });
    io.to('admin-room').emit('poll:update', {
      questionId,
      tallies: computeQuestionTallies(questionId, meetingId),
      stats: getAdminStats()
    });
  });

  // Admin adds question via socket
  socket.on('admin:add_question', ({ text, textTa, options, optionsTa }) => {
    if (!text || !options || options.length < 2) return;
    const newQ = {
      id: 'q_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      text: text.trim(),
      textTa: (textTa || '').trim(),
      options: options.map(o => (o || '').trim()).filter(Boolean),
      optionsTa: Array.isArray(optionsTa) ? optionsTa.map(o => (o || '').trim()) : []
    };
    sessionState.questions.push(newQ);
    persistState();
    io.emit('questions:updated', sessionState.questions);
    io.to('admin-room').emit('admin:questions_updated', { questions: sessionState.questions });
  });

  // Admin saves question builder set
  socket.on('admin:save_questions', (data) => {
    const { questions, showYearToParents, departmentName, meetingTitle } = data || {};
    if (Array.isArray(questions)) {
      sessionState.questions = questions;
      sessionState.currentMeeting.selectedQuestionIds = questions.map(q => q.id);
    }
    if (showYearToParents !== undefined) {
      settings.requireYearSelection = Boolean(showYearToParents);
      persistSettings();
    }
    if (departmentName) settings.departmentName = departmentName;
    if (meetingTitle) sessionState.currentMeeting.title = meetingTitle;
    persistState();

    const tallies = sessionState.currentMeeting.currentQuestionId
      ? computeQuestionTallies(sessionState.currentMeeting.currentQuestionId)
      : null;

    io.emit('questions:updated', sessionState.questions);
    io.to('admin-room').emit('admin:questions_saved', {
      questions: sessionState.questions,
      showYearToParents: settings.requireYearSelection,
      tallies
    });
  });

  // Admin reorders questions
  socket.on('admin:reorder_questions', ({ questionIds }) => {
    if (!Array.isArray(questionIds)) return;
    const reordered = [];
    questionIds.forEach(id => {
      const q = sessionState.questions.find(item => item.id === id);
      if (q) reordered.push(q);
    });
    sessionState.questions.forEach(q => {
      if (!reordered.some(item => item.id === q.id)) reordered.push(q);
    });
    sessionState.questions = reordered;
    sessionState.currentMeeting.selectedQuestionIds = reordered.map(q => q.id);
    persistState();
    io.emit('questions:updated', sessionState.questions);
  });

  // ---------------- PARENT SOCKET EVENTS ----------------

  // Parent joins
  socket.on('parent:join', (data) => {
    const { voterToken, yearGroup } = data || {};
    if (!voterToken) return;

    role = 'parent';
    clientVoterToken = voterToken;

    const meetingId = sessionState.currentMeeting.id;

    // Check if participant exists
    let p = sessionState.participants[voterToken];
    if (!p) {
      p = {
        participantId: voterToken,
        meetingId,
        studentYear: yearGroup || null,
        joinedAt: Date.now(),
        lastSeen: Date.now(),
        socketId: socket.id
      };
      sessionState.participants[voterToken] = p;
    } else {
      p.lastSeen = Date.now();
      p.socketId = socket.id;
      if (yearGroup) p.studentYear = yearGroup;
      if (p.meetingId !== meetingId) p.meetingId = meetingId;
    }

    persistState();

    // Current active question
    const activeQ = sessionState.questions.find(q => q.id === sessionState.currentMeeting.currentQuestionId);
    const selectedQuestions = sessionState.questions.filter(item =>
      (sessionState.currentMeeting.selectedQuestionIds || []).includes(item.id)
    );
    const activeIdx = selectedQuestions.findIndex(item => item.id === sessionState.currentMeeting.currentQuestionId);

    // Fetch this parent's previous response for current question
    const respKey = `${meetingId}:${sessionState.currentMeeting.currentQuestionId}:${voterToken}`;
    const myVote = sessionState.responses[respKey]?.selectedOption ?? null;

    // Send state to parent
    socket.emit('session:state', {
      meetingId,
      title: sessionState.currentMeeting.title,
      departmentName: settings.departmentName,
      meetingStatus: sessionState.currentMeeting.status,
      questionStatus: sessionState.currentMeeting.questionStatus,
      selectedYear: p.studentYear,
      yearGroups: settings.yearGroups,
      allowAnswerChanges: settings.allowAnswerChanges,
      showTamilTranslation: settings.showTamilTranslation,
      currentQuestion: (sessionState.currentMeeting.questionStatus === 'live' || sessionState.currentMeeting.questionStatus === 'closed') && activeQ ? {
        id: activeQ.id,
        index: activeIdx >= 0 ? activeIdx + 1 : 1,
        totalQuestions: selectedQuestions.length || sessionState.questions.length,
        text: activeQ.text,
        textTa: settings.showTamilTranslation ? (activeQ.textTa || '') : '',
        options: activeQ.options,
        optionsTa: settings.showTamilTranslation ? (activeQ.optionsTa || []) : []
      } : null,
      myVote
    });

    // Notify admin of real-time attendance
    io.to('admin-room').emit('attendance:update', getAttendanceStats(meetingId));
    io.to('admin-room').emit('admin:stats', getAdminStats());
  });

  // Parent selects/changes student year
  socket.on('parent:select_year', (data) => {
    const { voterToken, yearGroup } = data || {};
    if (!voterToken || !yearGroup) return;

    const meetingId = sessionState.currentMeeting.id;
    if (!sessionState.participants[voterToken]) {
      sessionState.participants[voterToken] = {
        participantId: voterToken,
        meetingId,
        studentYear: yearGroup,
        joinedAt: Date.now(),
        lastSeen: Date.now(),
        socketId: socket.id
      };
    } else {
      sessionState.participants[voterToken].studentYear = yearGroup;
      sessionState.participants[voterToken].lastSeen = Date.now();
    }

    // Update any existing responses from this voter to reflect the new student year
    for (const rKey in sessionState.responses) {
      if (sessionState.responses[rKey]?.participantId === voterToken && sessionState.responses[rKey]?.meetingId === meetingId) {
        sessionState.responses[rKey].studentYear = yearGroup;
      }
    }

    persistState();

    socket.emit('parent:year_confirmed', { studentYear: yearGroup });

    // Notify admin
    io.to('admin-room').emit('attendance:update', getAttendanceStats(meetingId));
    io.to('admin-room').emit('admin:stats', getAdminStats());

    // Update tallies for active question if live
    if (sessionState.currentMeeting.currentQuestionId) {
      io.to('admin-room').emit('poll:update', {
        questionId: sessionState.currentMeeting.currentQuestionId,
        tallies: computeQuestionTallies(sessionState.currentMeeting.currentQuestionId, meetingId),
        stats: getAdminStats()
      });
    }
  });

  // Parent casts / updates vote
  socket.on('parent:vote', (data) => {
    const { voterToken, questionId, optionIndex } = data || {};

    if (!voterToken || !questionId || optionIndex === undefined) {
      return socket.emit('parent:vote_error', { message: 'Invalid vote submission' });
    }

    const meetingId = sessionState.currentMeeting.id;
    const participant = sessionState.participants[voterToken];

    if (!participant || !participant.studentYear) {
      return socket.emit('parent:vote_error', { message: 'Please select student year before voting' });
    }

    const question = sessionState.questions.find(q => q.id === questionId);
    if (!question || optionIndex < 0 || optionIndex >= question.options.length) {
      return socket.emit('parent:vote_error', { message: 'Invalid option selected' });
    }

    // Uniqueness key: `${meetingId}:${questionId}:${voterToken}`
    const respKey = `${meetingId}:${questionId}:${voterToken}`;
    const isUpdate = Boolean(sessionState.responses[respKey]);

    sessionState.responses[respKey] = {
      id: 'resp_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4),
      meetingId,
      participantId: voterToken,
      questionId,
      selectedOption: optionIndex,
      studentYear: participant.studentYear,
      submittedAt: sessionState.responses[respKey]?.submittedAt || Date.now(),
      updatedAt: Date.now()
    };

    persistState();

    // Confirm to parent
    socket.emit('parent:vote_confirmed', {
      questionId,
      optionIndex,
      isUpdate
    });

    // Broadcast updated tallies to admin
    const tallies = computeQuestionTallies(questionId, meetingId);
    io.to('admin-room').emit('poll:update', {
      questionId,
      tallies,
      stats: getAdminStats()
    });
  });

  // Parent queries previous answers
  socket.on('parent:get_my_answers', ({ voterToken }) => {
    if (!voterToken) return;
    const meetingId = sessionState.currentMeeting.id;
    const myAnswers = {};

    for (const rKey in sessionState.responses) {
      const r = sessionState.responses[rKey];
      if (r && r.meetingId === meetingId && r.participantId === voterToken) {
        myAnswers[r.questionId] = r.selectedOption;
      }
    }

    socket.emit('parent:answers_list', myAnswers);
  });

  // Disconnect
  socket.on('disconnect', () => {
    if (role === 'parent' && clientVoterToken && sessionState.participants[clientVoterToken]) {
      sessionState.participants[clientVoterToken].lastSeen = Date.now();
    }
  });
});

// Start Server with auto port retry
function startServer(port) {
  server.listen(port, '0.0.0.0', () => {
    const actualPort = server.address().port;
    console.log('====================================================');
    console.log('  CSBS Parent–Teacher Meeting Portal Active');
    console.log(`  Admin Dashboard: http://localhost:${actualPort}/admin.html`);
    console.log(`  Parent Portal:   http://${localIp}:${actualPort}`);
    console.log('====================================================');
  });
}

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.log(`Port ${currentPort} busy, trying ${currentPort + 1}...`);
    currentPort++;
    setTimeout(() => {
      server.listen(currentPort, '0.0.0.0');
    }, 200);
  } else {
    console.error('Server error:', err);
  }
});

startServer(currentPort);
