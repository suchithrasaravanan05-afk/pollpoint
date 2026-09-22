/**
 * Poll Point - Modern Bilingual Live Polling Admin Dashboard
 * Handles Real-time Socket.io Sync, Question Builder, Library & Live Control
 */

(function () {
  'use strict';

  // --- State Variables ---
  let socket = null;
  let adminState = {
    sessionTitle: 'Live Interactive Poll',
    sessionTitleTa: 'நேரலை ஊடாடும் வாக்கெடுப்பு',
    sessionCode: 'POLL-2026',
    sessionStatus: 'draft',
    questionStatus: 'idle',
    currentQuestionId: null,
    questions: [],
    tallies: null,
    stats: { connectedCount: 0, totalVotesAllQuestions: 0 },
    joinUrl: window.location.origin,
    qrDataUrl: '',
    library: { categories: [], templates: [] },
    selectedCategory: 'all',
    searchQuery: '',
    sessionsHistory: []
  };

  // --- DOM Elements Cache ---
  const views = {
    overview: document.getElementById('view-overview'),
    builder: document.getElementById('view-builder'),
    library: document.getElementById('view-library'),
    live: document.getElementById('view-live'),
    qr: document.getElementById('view-qr'),
    sessions: document.getElementById('view-sessions')
  };

  const navTabBtns = document.querySelectorAll('.nav-tab-btn');

  // Overview DOM elements
  const dashSessionCode = document.getElementById('dashSessionCode');
  const dashSessionCodeTag = document.getElementById('dashSessionCodeTag');
  const dashStatusBadge = document.getElementById('dashStatusBadge');
  const dashStatusText = document.getElementById('dashStatusText');
  const dashSessionTitle = document.getElementById('dashSessionTitle');
  const dashSessionTitleTa = document.getElementById('dashSessionTitleTa');
  const dashParticipantCount = document.getElementById('dashParticipantCount');
  const dashTotalVotes = document.getElementById('dashTotalVotes');
  const dashQuestionsCount = document.getElementById('dashQuestionsCount');

  // Question Builder DOM elements
  const builderQuestionsList = document.getElementById('builderQuestionsList');
  const btnAddNewQuestion = document.getElementById('btnAddNewQuestion');
  const btnSaveAllQuestions = document.getElementById('btnSaveAllQuestions');

  // Question Library DOM elements
  const librarySearchInput = document.getElementById('librarySearchInput');
  const libraryCategoryPills = document.getElementById('libraryCategoryPills');
  const libraryTemplatesGrid = document.getElementById('libraryTemplatesGrid');

  // Live Results DOM elements
  const liveStage = document.getElementById('liveStage');
  const stageQIndexBadge = document.getElementById('stageQIndexBadge');
  const stageStatusBadge = document.getElementById('stageStatusBadge');
  const stageStatusText = document.getElementById('stageStatusText');
  const stageVotesCount = document.getElementById('stageVotesCount');
  const stageParticipantsCount = document.getElementById('stageParticipantsCount');
  const stageQuestionEn = document.getElementById('stageQuestionEn');
  const stageQuestionTa = document.getElementById('stageQuestionTa');
  const stageResultsGrid = document.getElementById('stageResultsGrid');
  const ctrlPrevBtn = document.getElementById('ctrlPrevBtn');
  const ctrlNextBtn = document.getElementById('ctrlNextBtn');
  const ctrlLaunchBtn = document.getElementById('ctrlLaunchBtn');
  const ctrlLaunchLabel = document.getElementById('ctrlLaunchLabel');
  const ctrlPauseBtn = document.getElementById('ctrlPauseBtn');
  const ctrlEndBtn = document.getElementById('ctrlEndBtn');
  const stageBtnReset = document.getElementById('stageBtnReset');

  // QR Join DOM elements
  const joinQrCodeImg = document.getElementById('joinQrCodeImg');
  const joinUrlText = document.getElementById('joinUrlText');
  const btnCopyJoinUrl = document.getElementById('btnCopyJoinUrl');
  const btnFullscreenQr = document.getElementById('btnFullscreenQr');

  // Modals DOM elements
  const createSessionModal = document.getElementById('createSessionModal');
  const createSessionBtn = document.getElementById('createSessionBtn');
  const btnCloseCreateModal = document.getElementById('btnCloseCreateModal');
  const btnCancelCreateModal = document.getElementById('btnCancelCreateModal');
  const createSessionForm = document.getElementById('createSessionForm');

  const settingsModal = document.getElementById('settingsModal');
  const openSettingsBtn = document.getElementById('openSettingsBtn');
  const btnCloseSettingsModal = document.getElementById('btnCloseSettingsModal');
  const btnCancelSettingsModal = document.getElementById('btnCancelSettingsModal');
  const settingsForm = document.getElementById('settingsForm');

  const appToast = document.getElementById('appToast');
  const toastText = document.getElementById('toastText');

  // --- Initialize App ---
  function init() {
    setupSocket();
    setupNavigation();
    setupOverviewButtons();
    setupBuilderEvents();
    setupLibraryEvents();
    setupLiveControls();
    setupModals();
    fetchSystemInfo();
    fetchQuestionLibrary();
    fetchSessionsHistory();
  }

  // --- Toast Notification ---
  let toastTimer = null;
  function showToast(message, duration = 3000) {
    if (toastTimer) clearTimeout(toastTimer);
    toastText.textContent = message;
    appToast.classList.add('show');
    toastTimer = setTimeout(() => {
      appToast.classList.remove('show');
    }, duration);
  }

  // --- View Switcher ---
  function switchView(viewName) {
    navTabBtns.forEach(btn => {
      btn.classList.toggle('active', btn.dataset.view === viewName);
    });

    Object.keys(views).forEach(key => {
      if (views[key]) {
        views[key].classList.toggle('active', key === viewName);
      }
    });

    // Refresh view data if needed
    if (viewName === 'builder') {
      renderQuestionBuilder();
    } else if (viewName === 'library') {
      renderLibraryTemplates();
    } else if (viewName === 'live') {
      renderLiveStage();
    } else if (viewName === 'sessions') {
      fetchSessionsHistory();
    }
  }

  function setupNavigation() {
    navTabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetView = btn.dataset.view;
        switchView(targetView);
      });
    });
  }

  // --- Socket.io Setup ---
  function setupSocket() {
    socket = io();

    socket.on('connect', () => {
      console.log('Connected to Poll Point server via Socket.io');
      socket.emit('admin:join');
    });

    socket.on('admin:init', (data) => {
      handleStateUpdate(data);
      if (data.library) {
        adminState.library = data.library;
        renderLibraryCategories();
        renderLibraryTemplates();
      }
    });

    socket.on('admin:stats', (stats) => {
      if (stats) {
        adminState.stats = stats;
        if (stats.tallies) {
          adminState.tallies = stats.tallies;
        }
        updateOverviewMetrics();
        renderLiveStage();
      }
    });

    socket.on('admin:state_change', (data) => {
      if (data.sessionStatus) adminState.sessionStatus = data.sessionStatus;
      if (data.currentQuestionId !== undefined) adminState.currentQuestionId = data.currentQuestionId;
      if (data.questionStatus) adminState.questionStatus = data.questionStatus;
      if (data.tallies) adminState.tallies = data.tallies;
      if (data.stats) adminState.stats = data.stats;

      updateOverviewMetrics();
      renderLiveStage();
      renderQuestionBuilder();
    });

    socket.on('poll:update', (data) => {
      if (data.tallies) {
        adminState.tallies = data.tallies;
      }
      if (data.stats) {
        adminState.stats = data.stats;
      }
      updateOverviewMetrics();
      renderLiveStage();
    });

    socket.on('admin:questions_saved', (data) => {
      if (data.questions) adminState.questions = data.questions;
      if (data.sessionTitle) adminState.sessionTitle = data.sessionTitle;
      if (data.sessionTitleTa) adminState.sessionTitleTa = data.sessionTitleTa;
      if (data.currentQuestionId !== undefined) adminState.currentQuestionId = data.currentQuestionId;
      if (data.tallies) adminState.tallies = data.tallies;

      updateOverviewMetrics();
      renderQuestionBuilder();
      renderLiveStage();
      showToast('Questions saved successfully! / கேள்விகள் சேமிக்கப்பட்டன!');
    });

    socket.on('admin:settings_updated', (data) => {
      if (data.sessionTitle) adminState.sessionTitle = data.sessionTitle;
      if (data.sessionTitleTa) adminState.sessionTitleTa = data.sessionTitleTa;
      if (data.sessionCode) adminState.sessionCode = data.sessionCode;
      if (data.joinUrl) adminState.joinUrl = data.joinUrl;

      updateOverviewMetrics();
      fetchSystemInfo();
      showToast('Settings updated! / அமைப்புகள் புதுப்பிக்கப்பட்டன!');
    });
  }

  function handleStateUpdate(data) {
    if (!data) return;
    adminState.sessionTitle = data.sessionTitle || adminState.sessionTitle;
    adminState.sessionTitleTa = data.sessionTitleTa || adminState.sessionTitleTa;
    adminState.sessionCode = data.sessionCode || adminState.sessionCode;
    adminState.sessionStatus = data.sessionStatus || 'draft';
    adminState.questionStatus = data.questionStatus || 'idle';
    adminState.questions = data.questions || [];
    adminState.currentQuestionId = data.currentQuestionId || (adminState.questions[0] ? adminState.questions[0].id : null);
    adminState.tallies = data.tallies || null;
    adminState.stats = data.stats || adminState.stats;
    adminState.joinUrl = data.joinUrl || adminState.joinUrl;

    updateOverviewMetrics();
    renderQuestionBuilder();
    renderLiveStage();
  }

  // --- Fetch System Info (QR Code & IP) ---
  async function fetchSystemInfo() {
    try {
      const res = await fetch('/api/info');
      const info = await res.json();
      if (info) {
        adminState.joinUrl = info.joinUrl;
        adminState.qrDataUrl = info.qrDataUrl;
        if (joinQrCodeImg && info.qrDataUrl) {
          joinQrCodeImg.src = info.qrDataUrl;
        }
        if (joinUrlText) {
          joinUrlText.textContent = info.joinUrl;
        }
      }
    } catch (e) {
      console.error('Failed to fetch info:', e);
    }
  }

  // --- Overview Panel Updates ---
  function updateOverviewMetrics() {
    if (dashSessionCode) dashSessionCode.textContent = adminState.sessionCode;
    if (dashSessionCodeTag) dashSessionCodeTag.textContent = adminState.sessionCode;
    if (dashSessionTitle) dashSessionTitle.textContent = adminState.sessionTitle;
    if (dashSessionTitleTa) dashSessionTitleTa.textContent = adminState.sessionTitleTa || '';

    // Status Badge
    if (dashStatusBadge && dashStatusText) {
      const isLive = adminState.sessionStatus === 'live' || adminState.questionStatus === 'live';
      const isClosed = adminState.sessionStatus === 'closed';

      dashStatusBadge.className = 'status-badge ' + (isLive ? 'live' : isClosed ? 'closed' : 'draft');
      dashStatusText.textContent = isLive ? 'Live Polling Active' : isClosed ? 'Session Closed' : 'Draft Mode';
    }

    if (dashParticipantCount) {
      dashParticipantCount.textContent = adminState.stats.connectedCount || 0;
    }
    if (dashTotalVotes) {
      dashTotalVotes.textContent = adminState.stats.totalVotesAllQuestions || 0;
    }
    if (dashQuestionsCount) {
      dashQuestionsCount.textContent = adminState.questions ? adminState.questions.length : 0;
    }
  }

  function setupOverviewButtons() {
    const dashBtnAddQ = document.getElementById('dashBtnAddQ');
    const dashBtnLibrary = document.getElementById('dashBtnLibrary');
    const dashBtnQr = document.getElementById('dashBtnQr');
    const dashBtnLaunch = document.getElementById('dashBtnLaunch');

    if (dashBtnAddQ) {
      dashBtnAddQ.addEventListener('click', () => {
        switchView('builder');
        addNewQuestion();
      });
    }

    if (dashBtnLibrary) {
      dashBtnLibrary.addEventListener('click', () => switchView('library'));
    }

    if (dashBtnQr) {
      dashBtnQr.addEventListener('click', () => switchView('qr'));
    }

    if (dashBtnLaunch) {
      dashBtnLaunch.addEventListener('click', () => {
        switchView('live');
        if (adminState.questions.length > 0) {
          const qId = adminState.currentQuestionId || adminState.questions[0].id;
          socket.emit('admin:launch_question', { questionId: qId });
        }
      });
    }

    if (btnCopyJoinUrl) {
      btnCopyJoinUrl.addEventListener('click', () => {
        if (navigator.clipboard && adminState.joinUrl) {
          navigator.clipboard.writeText(adminState.joinUrl);
          showToast('Join URL copied to clipboard! / இணைப்பு நகலெடுக்கப்பட்டது!');
        }
      });
    }

    if (btnFullscreenQr) {
      btnFullscreenQr.addEventListener('click', () => {
        openFullscreenQr();
      });
    }
  }

  function openFullscreenQr() {
    const w = window.open('', '_blank', 'width=800,height=800');
    w.document.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Scan to Join Poll Point</title>
        <style>
          body {
            margin: 0;
            background: #1e0b36;
            color: #ffffff;
            font-family: 'Plus Jakarta Sans', system-ui, sans-serif;
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            text-align: center;
            padding: 2rem;
            box-sizing: border-box;
          }
          h1 { font-size: 2.5rem; margin: 0 0 0.5rem; color: #ffffff; }
          .ta { font-size: 1.5rem; color: #c4b5fd; margin-bottom: 2rem; }
          img { width: 340px; height: 340px; border-radius: 20px; box-shadow: 0 10px 40px rgba(0,0,0,0.5); }
          .url { margin-top: 2rem; font-size: 1.5rem; font-weight: 800; background: rgba(255,255,255,0.1); padding: 0.8rem 1.8rem; border-radius: 9999px; }
        </style>
      </head>
      <body>
        <h1>Scan to Join Live Poll</h1>
        <div class="ta">நேரலை வாக்கெடுப்பில் சேர ஸ்கேன் செய்யுங்கள்</div>
        <img src="${adminState.qrDataUrl}" alt="QR">
        <div class="url">${adminState.joinUrl}</div>
      </body>
      </html>
    `);
  }

  // --- Question Builder Logic ---
  function setupBuilderEvents() {
    if (btnAddNewQuestion) {
      btnAddNewQuestion.addEventListener('click', () => {
        addNewQuestion();
      });
    }

    if (btnSaveAllQuestions) {
      btnSaveAllQuestions.addEventListener('click', () => {
        saveQuestionsToServer();
      });
    }
  }

  function addNewQuestion() {
    const newId = 'q_' + Date.now();
    const newQ = {
      id: newId,
      type: 'multiple_choice',
      text: 'What is your opinion on today\'s session?',
      textTa: 'இன்றைய அமர்வு குறித்து உங்கள் கருத்து என்ன?',
      options: ['Excellent / மிகச் சிறப்பானது', 'Good / நல்லது', 'Average / சுமாரானது'],
      optionsTa: ['மிகச் சிறப்பானது', 'நல்லது', 'சுமாரானது']
    };

    adminState.questions.push(newQ);
    renderQuestionBuilder();
    showToast('New bilingual question added! / புதிய கேள்வி சேர்க்கப்பட்டது!');

    // Scroll to the new card
    setTimeout(() => {
      const cards = builderQuestionsList.querySelectorAll('.question-card');
      if (cards.length > 0) {
        cards[cards.length - 1].scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }, 100);
  }

  function renderQuestionBuilder() {
    if (!builderQuestionsList) return;
    builderQuestionsList.innerHTML = '';

    if (adminState.questions.length === 0) {
      builderQuestionsList.innerHTML = `
        <div style="text-align: center; padding: 4rem 2rem; background: #ffffff; border-radius: 20px; border: 1px dashed var(--lavender-300);">
          <h3 style="color: var(--violet-900); font-size: 1.3rem; margin-bottom: 0.5rem;">No questions in this session yet</h3>
          <p style="color: var(--text-muted); margin-bottom: 1.5rem;">Create your first bilingual question or import pre-made templates from the Question Library.</p>
          <div style="display: flex; gap: 1rem; justify-content: center;">
            <button class="btn-add-question" id="emptyAddBtn">+ Add New Question</button>
            <button class="btn-action" id="emptyLibBtn">Browse Question Library</button>
          </div>
        </div>
      `;
      document.getElementById('emptyAddBtn')?.addEventListener('click', addNewQuestion);
      document.getElementById('emptyLibBtn')?.addEventListener('click', () => switchView('library'));
      return;
    }

    adminState.questions.forEach((q, index) => {
      const isCurrent = adminState.currentQuestionId === q.id;
      const card = document.createElement('div');
      card.className = `question-card ${isCurrent ? 'active-live' : ''}`;
      card.dataset.id = q.id;

      card.innerHTML = `
        <div class="question-card-top">
          <div class="q-meta-left">
            <span class="q-number-badge">Question ${index + 1} of ${adminState.questions.length}</span>
            <select class="q-type-select" data-action="change-type">
              <option value="multiple_choice" ${q.type === 'multiple_choice' ? 'selected' : ''}>Multiple Choice (பல்வேறு தெரிவுகள்)</option>
              <option value="yes_no" ${q.type === 'yes_no' ? 'selected' : ''}>Yes / No (ஆம் / இல்லை)</option>
              <option value="rating" ${q.type === 'rating' ? 'selected' : ''}>Rating Scale 1-5 (மதிப்பீடு 1-5 ⭐)</option>
              <option value="short_answer" ${q.type === 'short_answer' ? 'selected' : ''}>Short Answer (சுருக்கமான பதில்)</option>
            </select>
          </div>

          <div class="q-card-actions">
            <button class="btn-card-ctrl" data-action="move-up" title="Move Up" ${index === 0 ? 'disabled' : ''}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="18 15 12 9 6 15"></polyline></svg>
            </button>
            <button class="btn-card-ctrl" data-action="move-down" title="Move Down" ${index === adminState.questions.length - 1 ? 'disabled' : ''}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
            </button>
            <button class="btn-card-ctrl" data-action="duplicate" title="Duplicate Question">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            </button>
            <button class="btn-card-ctrl" data-action="launch" title="Launch Question to Live Poll" style="color: var(--live-green);">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
            </button>
            <button class="btn-card-ctrl danger" data-action="delete" title="Delete Question">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
          </div>
        </div>

        <!-- Question Prompt Fields -->
        <div class="q-fields-grid">
          <div class="field-group">
            <label>
              <span>Question Prompt (English)</span>
              <span class="lang-chip en">EN</span>
            </label>
            <input type="text" class="input-text q-text-en" value="${escapeHtml(q.text || '')}" placeholder="e.g. How satisfied are you with this event?">
          </div>

          <div class="field-group">
            <label>
              <span>கேள்வி விளக்கம் (Tamil)</span>
              <span class="lang-chip ta">தமிழ்</span>
            </label>
            <input type="text" class="input-text ta-input q-text-ta" value="${escapeHtml(q.textTa || '')}" placeholder="எ.கா. இந்த நிகழ்வில் நீங்கள் எவ்வளவு திருப்தியாக உள்ளீர்கள்?">
          </div>
        </div>

        <!-- Options Container for Question -->
        <div class="options-builder-block">
          ${renderOptionsBlock(q)}
        </div>
      `;

      // Attach event listeners to card
      attachQuestionCardEvents(card, index);
      builderQuestionsList.appendChild(card);
    });
  }

  function renderOptionsBlock(q) {
    if (q.type === 'short_answer') {
      return `
        <div style="font-size: 0.85rem; color: var(--text-muted); display: flex; align-items: center; gap: 0.5rem; padding: 0.5rem 0;">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
          <span>Short Answer: Participants submit free-form text responses / பங்கேற்பாளர்கள் தங்கள் கருத்துக்களை தட்டச்சு செய்வார்கள்.</span>
        </div>
      `;
    }

    if (q.type === 'yes_no') {
      return `
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">
          Standard Yes / No buttons with Tamil translations:
        </div>
        <div style="display: flex; gap: 1rem;">
          <div style="flex: 1; background: #ffffff; border: 1px solid var(--lavender-200); padding: 0.6rem 1rem; border-radius: 8px; font-weight: 700; color: var(--live-green);">
            ✓ Yes (ஆம்)
          </div>
          <div style="flex: 1; background: #ffffff; border: 1px solid var(--lavender-200); padding: 0.6rem 1rem; border-radius: 8px; font-weight: 700; color: var(--rose-danger);">
            ✕ No (இல்லை)
          </div>
        </div>
      `;
    }

    if (q.type === 'rating') {
      return `
        <div style="font-size: 0.85rem; color: var(--text-muted); margin-bottom: 0.5rem;">
          5-Star Rating Scale (1 = Poor / குறைவு, 5 = Outstanding / மிகச் சிறப்பானது):
        </div>
        <div style="display: flex; gap: 0.5rem; flex-wrap: wrap;">
          ${[1,2,3,4,5].map(n => `
            <div style="flex: 1; min-width: 60px; text-align: center; background: #ffffff; border: 1px solid var(--lavender-200); padding: 0.5rem; border-radius: 8px; font-weight: 700; color: var(--purple-600);">
              ${n} ⭐
            </div>
          `).join('')}
        </div>
      `;
    }

    // Default: multiple_choice options
    const options = q.options || [];
    const optionsTa = q.optionsTa || [];

    let rowsHtml = '';
    options.forEach((opt, oIdx) => {
      const optTa = optionsTa[oIdx] || '';
      rowsHtml += `
        <div class="option-row" data-opt-index="${oIdx}">
          <span class="opt-index-label">${String.fromCharCode(65 + oIdx)}</span>
          <input type="text" class="input-text opt-en-input" value="${escapeHtml(opt)}" placeholder="Option ${oIdx + 1} (English)">
          <input type="text" class="input-text ta-input opt-ta-input" value="${escapeHtml(optTa)}" placeholder="தெரிவு ${oIdx + 1} (தமிழ்)">
          <button type="button" class="btn-remove-opt" data-action="remove-opt" title="Remove option" ${options.length <= 2 ? 'disabled style="opacity:0.3;cursor:not-allowed;"' : ''}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </button>
        </div>
      `;
    });

    return `
      <div class="options-builder-top">
        <h4>Answer Options (பதில் தெரிவுகள்)</h4>
        <span style="font-size: 0.75rem; color: var(--text-muted);">(Min 2, Max 6 options)</span>
      </div>
      <div class="options-rows-list">
        ${rowsHtml}
      </div>
      ${options.length < 6 ? `
        <button type="button" class="btn-add-opt-row" data-action="add-opt">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          <span>Add Option (தெரிவு சேர்க்க)</span>
        </button>
      ` : ''}
    `;
  }

  function attachQuestionCardEvents(card, index) {
    const q = adminState.questions[index];

    // Inputs update state on change
    const enInput = card.querySelector('.q-text-en');
    const taInput = card.querySelector('.q-text-ta');
    if (enInput) {
      enInput.addEventListener('input', (e) => { q.text = e.target.value; });
    }
    if (taInput) {
      taInput.addEventListener('input', (e) => { q.textTa = e.target.value; });
    }

    // Type change
    const typeSelect = card.querySelector('[data-action="change-type"]');
    if (typeSelect) {
      typeSelect.addEventListener('change', (e) => {
        q.type = e.target.value;
        if (q.type === 'multiple_choice' && (!q.options || q.options.length < 2)) {
          q.options = ['Option 1', 'Option 2'];
          q.optionsTa = ['தெரிவு 1', 'தெரிவு 2'];
        }
        renderQuestionBuilder();
      });
    }

    // Card top action buttons
    card.addEventListener('click', (e) => {
      const btn = e.target.closest('button');
      if (!btn) return;
      const action = btn.dataset.action;

      if (action === 'move-up' && index > 0) {
        const temp = adminState.questions[index - 1];
        adminState.questions[index - 1] = adminState.questions[index];
        adminState.questions[index] = temp;
        renderQuestionBuilder();
      } else if (action === 'move-down' && index < adminState.questions.length - 1) {
        const temp = adminState.questions[index + 1];
        adminState.questions[index + 1] = adminState.questions[index];
        adminState.questions[index] = temp;
        renderQuestionBuilder();
      } else if (action === 'duplicate') {
        const cloned = JSON.parse(JSON.stringify(q));
        cloned.id = 'q_' + Date.now();
        cloned.text += ' (Copy)';
        adminState.questions.splice(index + 1, 0, cloned);
        renderQuestionBuilder();
        showToast('Question duplicated! / கேள்வி நகலெடுக்கப்பட்டது!');
      } else if (action === 'delete') {
        if (confirm(`Delete Question ${index + 1}? / இந்த கேள்வியை நீக்கவா?`)) {
          adminState.questions.splice(index, 1);
          if (adminState.currentQuestionId === q.id) {
            adminState.currentQuestionId = adminState.questions[0] ? adminState.questions[0].id : null;
          }
          renderQuestionBuilder();
          showToast('Question deleted / கேள்வி நீக்கப்பட்டது');
        }
      } else if (action === 'launch') {
        saveQuestionsToServer();
        adminState.currentQuestionId = q.id;
        socket.emit('admin:launch_question', { questionId: q.id });
        switchView('live');
        showToast('Question launched live! / கேள்வி நேரலையில் வெளியிடப்பட்டது!');
      } else if (action === 'add-opt') {
        if (!q.options) q.options = [];
        if (!q.optionsTa) q.optionsTa = [];
        q.options.push(`Option ${q.options.length + 1}`);
        q.optionsTa.push(`தெரிவு ${q.optionsTa.length + 1}`);
        renderQuestionBuilder();
      } else if (action === 'remove-opt') {
        const row = btn.closest('.option-row');
        const optIdx = parseInt(row.dataset.optIndex, 10);
        if (q.options && q.options.length > 2) {
          q.options.splice(optIdx, 1);
          if (q.optionsTa) q.optionsTa.splice(optIdx, 1);
          renderQuestionBuilder();
        }
      }
    });

    // Options input listeners
    card.querySelectorAll('.opt-en-input').forEach((input, optIdx) => {
      input.addEventListener('input', (e) => {
        if (!q.options) q.options = [];
        q.options[optIdx] = e.target.value;
      });
    });

    card.querySelectorAll('.opt-ta-input').forEach((input, optIdx) => {
      input.addEventListener('input', (e) => {
        if (!q.optionsTa) q.optionsTa = [];
        q.optionsTa[optIdx] = e.target.value;
      });
    });
  }

  function saveQuestionsToServer() {
    // Read current state from inputs if any active
    socket.emit('admin:save_questions', {
      sessionTitle: adminState.sessionTitle,
      sessionTitleTa: adminState.sessionTitleTa,
      questions: adminState.questions
    });
  }

  // --- Question Library Logic ---
  async function fetchQuestionLibrary() {
    try {
      const res = await fetch('/api/library');
      const data = await res.json();
      if (data && data.templates) {
        adminState.library = data;
        renderLibraryCategories();
        renderLibraryTemplates();
      }
    } catch (err) {
      console.error('Failed to load library:', err);
    }
  }

  function renderLibraryCategories() {
    if (!libraryCategoryPills) return;
    const cats = adminState.library.categories || [];

    libraryCategoryPills.innerHTML = cats.map(cat => `
      <button class="pill-filter ${adminState.selectedCategory === cat.id ? 'active' : ''}" data-category="${cat.id}">
        <span>${cat.nameEn}</span>
        <span class="pill-ta">${cat.nameTa}</span>
      </button>
    `).join('');

    libraryCategoryPills.querySelectorAll('.pill-filter').forEach(btn => {
      btn.addEventListener('click', () => {
        adminState.selectedCategory = btn.dataset.category;
        renderLibraryCategories();
        renderLibraryTemplates();
      });
    });
  }

  function setupLibraryEvents() {
    if (librarySearchInput) {
      librarySearchInput.addEventListener('input', (e) => {
        adminState.searchQuery = e.target.value.toLowerCase().trim();
        renderLibraryTemplates();
      });
    }
  }

  function renderLibraryTemplates() {
    if (!libraryTemplatesGrid) return;
    const templates = adminState.library.templates || [];
    const cat = adminState.selectedCategory;
    const q = adminState.searchQuery;

    const filtered = templates.filter(t => {
      const matchCat = cat === 'all' || t.category === cat;
      const matchQuery = !q ||
        (t.text && t.text.toLowerCase().includes(q)) ||
        (t.textTa && t.textTa.toLowerCase().includes(q)) ||
        (t.category && t.category.toLowerCase().includes(q));
      return matchCat && matchQuery;
    });

    if (filtered.length === 0) {
      libraryTemplatesGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #ffffff; border-radius: 20px; border: 1px solid var(--lavender-200);">
          <p style="color: var(--text-muted);">No question templates found matching your search.</p>
        </div>
      `;
      return;
    }

    libraryTemplatesGrid.innerHTML = filtered.map(t => {
      const typeLabel = t.type === 'yes_no' ? 'Yes / No' :
                        t.type === 'rating' ? 'Rating 1-5' :
                        t.type === 'short_answer' ? 'Short Answer' : 'Multiple Choice';

      return `
        <div class="template-card" data-template-id="${t.id}">
          <div>
            <div class="template-card-header">
              <span class="category-tag">${t.category}</span>
              <span class="type-tag">${typeLabel}</span>
            </div>

            <div class="template-q-content" style="margin-top: 0.75rem;">
              <h4>${escapeHtml(t.text)}</h4>
              <div class="ta-text">${escapeHtml(t.textTa || '')}</div>
            </div>

            <div class="template-options-preview">
              ${(t.options || []).slice(0, 3).map((opt, i) => `
                <div class="preview-opt-item">
                  <span>${escapeHtml(opt)}</span>
                  <span class="ta-text" style="color: var(--purple-600);">${escapeHtml((t.optionsTa && t.optionsTa[i]) || '')}</span>
                </div>
              `).join('')}
              ${t.options && t.options.length > 3 ? `<div style="font-size: 0.72rem; color: var(--text-light); text-align: center;">+ ${t.options.length - 3} more options</div>` : ''}
            </div>
          </div>

          <button class="btn-import-template" data-action="import-template" data-template-id="${t.id}">
            <span>+ Add to Poll Session</span>
            <span class="btn-sub-ta">+ அமர்வில் சேர்</span>
          </button>
        </div>
      `;
    }).join('');

    libraryTemplatesGrid.querySelectorAll('[data-action="import-template"]').forEach(btn => {
      btn.addEventListener('click', () => {
        const tId = btn.dataset.templateId;
        importTemplateToSession(tId);
      });
    });
  }

  function importTemplateToSession(templateId) {
    const tpl = adminState.library.templates.find(t => t.id === templateId);
    if (!tpl) return;

    const newQ = {
      id: 'q_' + Date.now() + '_' + Math.floor(Math.random() * 100),
      type: tpl.type || 'multiple_choice',
      text: tpl.text,
      textTa: tpl.textTa || '',
      options: Array.isArray(tpl.options) ? [...tpl.options] : [],
      optionsTa: Array.isArray(tpl.optionsTa) ? [...tpl.optionsTa] : []
    };

    adminState.questions.push(newQ);
    if (!adminState.currentQuestionId) {
      adminState.currentQuestionId = newQ.id;
    }

    saveQuestionsToServer();
    showToast(`Template added to active poll! / கேள்வி சேர்க்கப்பட்டது!`);
  }

  // --- Live Results & Projector View ---
  function setupLiveControls() {
    if (ctrlPrevBtn) {
      ctrlPrevBtn.addEventListener('click', () => {
        socket.emit('admin:prev_question');
      });
    }

    if (ctrlNextBtn) {
      ctrlNextBtn.addEventListener('click', () => {
        socket.emit('admin:next_question');
      });
    }

    if (ctrlLaunchBtn) {
      ctrlLaunchBtn.addEventListener('click', () => {
        if (adminState.questionStatus === 'live') {
          socket.emit('admin:pause_question');
        } else {
          if (adminState.currentQuestionId) {
            socket.emit('admin:launch_question', { questionId: adminState.currentQuestionId });
          } else if (adminState.questions.length > 0) {
            socket.emit('admin:launch_question', { questionId: adminState.questions[0].id });
          }
        }
      });
    }

    if (ctrlPauseBtn) {
      ctrlPauseBtn.addEventListener('click', () => {
        socket.emit('admin:pause_question');
      });
    }

    if (ctrlEndBtn) {
      ctrlEndBtn.addEventListener('click', () => {
        if (confirm('End this live polling session? / இந்த நேரலை வாக்கெடுப்பை முடிக்கவா?')) {
          socket.emit('admin:end_session');
          showToast('Poll session ended / வாக்கெடுப்பு முடிவடைந்தது');
        }
      });
    }

    if (stageBtnReset) {
      stageBtnReset.addEventListener('click', () => {
        if (adminState.currentQuestionId && confirm('Reset votes for this question? / இந்த கேள்விக்கான வாக்குகளை மீட்டமைக்கவா?')) {
          socket.emit('admin:reset_question', { questionId: adminState.currentQuestionId });
          showToast('Votes reset / வாக்குகள் மீட்டமைக்கப்பட்டன');
        }
      });
    }
  }

  function renderLiveStage() {
    if (!liveStage) return;

    const qList = adminState.questions || [];
    if (qList.length === 0) {
      stageQuestionEn.textContent = 'No questions available in this session';
      stageQuestionTa.textContent = 'இந்த அமர்வில் கேள்விகள் எதுவும் இல்லை';
      stageResultsGrid.innerHTML = `
        <div style="text-align: center; padding: 2rem; color: var(--text-muted);">
          Go to Question Builder or Library to add questions.
        </div>
      `;
      return;
    }

    const curQ = qList.find(q => q.id === adminState.currentQuestionId) || qList[0];
    const curIdx = qList.findIndex(q => q.id === curQ.id);

    // Update Question Info
    if (stageQIndexBadge) {
      stageQIndexBadge.textContent = `Question ${curIdx + 1} of ${qList.length}`;
    }

    // Status Badge & Controls
    const isLive = adminState.questionStatus === 'live';
    const isPaused = adminState.questionStatus === 'paused';
    const isClosed = adminState.questionStatus === 'closed' || adminState.sessionStatus === 'closed';

    if (stageStatusBadge && stageStatusText) {
      stageStatusBadge.className = 'status-badge ' + (isLive ? 'live' : isPaused ? 'draft' : 'closed');
      stageStatusText.textContent = isLive ? 'Live Voting' : isPaused ? 'Paused' : isClosed ? 'Closed' : 'Ready';
    }

    if (ctrlLaunchLabel) {
      ctrlLaunchLabel.textContent = isLive ? 'Pause Poll' : 'Launch Poll';
    }

    if (ctrlPrevBtn) ctrlPrevBtn.disabled = curIdx === 0;
    if (ctrlNextBtn) ctrlNextBtn.disabled = curIdx === qList.length - 1;

    stageQuestionEn.textContent = curQ.text;
    stageQuestionTa.textContent = curQ.textTa || '';

    // Render Tallies
    const tallies = adminState.tallies;
    const totalVotes = tallies ? (tallies.totalVotes || 0) : 0;
    const participants = adminState.stats.connectedCount || 0;

    if (stageVotesCount) stageVotesCount.textContent = totalVotes;
    if (stageParticipantsCount) stageParticipantsCount.textContent = participants;

    if (curQ.type === 'short_answer') {
      const textAnswers = tallies && tallies.textAnswers ? tallies.textAnswers : [];
      if (textAnswers.length === 0) {
        stageResultsGrid.innerHTML = `
          <div style="text-align: center; padding: 2.5rem; background: #ffffff; border-radius: 16px; border: 1px dashed var(--lavender-200); color: var(--text-muted);">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" style="margin-bottom: 0.5rem;"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>
            <div>Waiting for participant responses... / பதில்களுக்காக காத்திருக்கிறது...</div>
          </div>
        `;
      } else {
        stageResultsGrid.innerHTML = `
          <div style="display: flex; flex-direction: column; gap: 0.75rem;">
            ${textAnswers.map((ans, aIdx) => `
              <div style="background: #ffffff; border: 1px solid var(--lavender-200); border-radius: 12px; padding: 1rem 1.25rem; display: flex; align-items: flex-start; gap: 0.75rem;">
                <span style="font-size: 0.75rem; font-weight: 800; color: var(--purple-600); background: var(--lilac-50); padding: 0.2rem 0.5rem; border-radius: 6px;">#${aIdx + 1}</span>
                <span style="font-size: 1.05rem; color: var(--text-main); font-weight: 600;">${escapeHtml(ans)}</span>
              </div>
            `).join('')}
          </div>
        `;
      }
      return;
    }

    // Multiple choice, Yes/No, or Rating
    const options = curQ.options || [];
    const optionsTa = curQ.optionsTa || [];
    const counts = tallies && tallies.counts ? tallies.counts : new Array(options.length).fill(0);
    const percentages = tallies && tallies.percentages ? tallies.percentages : new Array(options.length).fill(0);

    // Find highest vote count to highlight leader
    const maxVotes = Math.max(...counts, 0);

    stageResultsGrid.innerHTML = options.map((opt, oIdx) => {
      const optTa = optionsTa[oIdx] || '';
      const voteCount = counts[oIdx] || 0;
      const pct = percentages[oIdx] || 0;
      const isLeader = totalVotes > 0 && voteCount === maxVotes && maxVotes > 0;
      const letter = String.fromCharCode(65 + oIdx);

      return `
        <div class="result-row ${isLeader ? 'leader' : ''}">
          <div class="result-row-bar" style="width: ${pct}%;"></div>
          <div class="result-row-content">
            <div class="result-label-group">
              <span class="opt-letter-chip">${letter}</span>
              <div class="result-text-titles">
                <span class="result-opt-en">${escapeHtml(opt)}</span>
                <span class="result-opt-ta ta-text">${escapeHtml(optTa)}</span>
              </div>
            </div>

            <div class="result-stats-group">
              <span class="result-percent">${pct}%</span>
              <span class="result-votes-count">(${voteCount} votes)</span>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }

  // --- Sessions History API ---
  async function fetchSessionsHistory() {
    try {
      const res = await fetch('/api/sessions');
      const list = await res.json();
      adminState.sessionsHistory = list || [];
      renderSessionsHistory();
    } catch (e) {
      console.error('Failed to load history:', e);
    }
  }

  function renderSessionsHistory() {
    const grid = document.getElementById('sessionsHistoryGrid');
    if (!grid) return;

    if (adminState.sessionsHistory.length === 0) {
      grid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; padding: 3rem; background: #ffffff; border-radius: 20px; border: 1px solid var(--lavender-200);">
          <p style="color: var(--text-muted);">No archived sessions found. New sessions will automatically be saved here.</p>
        </div>
      `;
      return;
    }

    grid.innerHTML = adminState.sessionsHistory.map(item => `
      <div class="template-card">
        <div>
          <div class="template-card-header">
            <span class="category-tag">${item.sessionCode || 'POLL'}</span>
            <span class="type-tag">${new Date(item.archivedAt).toLocaleDateString()}</span>
          </div>

          <div class="template-q-content" style="margin-top: 0.75rem;">
            <h4>${escapeHtml(item.sessionTitle || 'Poll Session')}</h4>
            <div class="ta-text">${escapeHtml(item.sessionTitleTa || '')}</div>
          </div>

          <div style="display: flex; gap: 1rem; font-size: 0.82rem; color: var(--text-muted); margin-top: 0.75rem;">
            <span><strong>${item.questionsCount || 0}</strong> Questions</span>
            <span><strong>${item.totalVotes || 0}</strong> Responses</span>
          </div>
        </div>
      </div>
    `).join('');
  }

  // --- Modals Setup ---
  function setupModals() {
    // Create Session Modal
    if (createSessionBtn) {
      createSessionBtn.addEventListener('click', () => {
        createSessionModal.classList.add('open');
      });
    }

    const btnNewSessionHistory = document.getElementById('btnNewSessionHistory');
    if (btnNewSessionHistory) {
      btnNewSessionHistory.addEventListener('click', () => {
        createSessionModal.classList.add('open');
      });
    }

    if (btnCloseCreateModal) {
      btnCloseCreateModal.addEventListener('click', () => createSessionModal.classList.remove('open'));
    }
    if (btnCancelCreateModal) {
      btnCancelCreateModal.addEventListener('click', () => createSessionModal.classList.remove('open'));
    }

    if (createSessionForm) {
      createSessionForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const title = document.getElementById('newSessionTitle').value;
        const titleTa = document.getElementById('newSessionTitleTa').value;
        const code = document.getElementById('newSessionCode').value;
        const source = document.querySelector('input[name="questionsSource"]:checked')?.value || 'default';

        socket.emit('admin:create_session', {
          sessionTitle: title,
          sessionTitleTa: titleTa,
          sessionCode: code,
          cloneQuestions: source === 'clone',
          newQuestions: source === 'blank' ? [] : null
        });

        createSessionModal.classList.remove('open');
        showToast('New Poll Session created! / புதிய வாக்கெடுப்பு உருவாக்கப்பட்டது!');
        switchView('overview');
      });
    }

    // Settings Modal
    if (openSettingsBtn) {
      openSettingsBtn.addEventListener('click', () => {
        document.getElementById('settingsTitle').value = adminState.sessionTitle;
        document.getElementById('settingsTitleTa').value = adminState.sessionTitleTa || '';
        document.getElementById('settingsCode').value = adminState.sessionCode;
        document.getElementById('settingsJoinUrl').value = adminState.joinUrl;
        settingsModal.classList.add('open');
      });
    }

    if (btnCloseSettingsModal) {
      btnCloseSettingsModal.addEventListener('click', () => settingsModal.classList.remove('open'));
    }
    if (btnCancelSettingsModal) {
      btnCancelSettingsModal.addEventListener('click', () => settingsModal.classList.remove('open'));
    }

    if (settingsForm) {
      settingsForm.addEventListener('submit', (e) => {
        e.preventDefault();
        const sessionTitle = document.getElementById('settingsTitle').value;
        const sessionTitleTa = document.getElementById('settingsTitleTa').value;
        const sessionCode = document.getElementById('settingsCode').value;
        const customJoinUrl = document.getElementById('settingsJoinUrl').value;

        socket.emit('admin:update_settings', {
          sessionTitle,
          sessionTitleTa,
          sessionCode,
          customJoinUrl
        });

        settingsModal.classList.remove('open');
      });
    }
  }

  // --- Utility Helpers ---
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // Initialize on DOM load
  document.addEventListener('DOMContentLoaded', init);
})();
