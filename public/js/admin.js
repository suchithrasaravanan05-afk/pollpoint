// HOD Admin: Stage 1 (Question Builder) + Stage 2 (Live Polling Dashboard)
(function() {
  // Navigation & Branding Elements
  const navDeptBadge = document.getElementById('navDeptBadge');
  const navDeptText = document.getElementById('navDeptText');
  const navMeetingTitle = document.getElementById('navMeetingTitle');
  const liveConnectedPill = document.getElementById('liveConnectedPill');
  const navConnectedCount = document.getElementById('navConnectedCount');
  const setupNavActions = document.getElementById('setupNavActions');
  const liveNavActions = document.getElementById('liveNavActions');
  const btnEditQuestionsNav = document.getElementById('btnEditQuestionsNav');
  const btnGoToLiveIfStarted = document.getElementById('btnGoToLiveIfStarted');
  const btnPreviewToggleMobile = document.getElementById('btnPreviewToggleMobile');

  // Views
  const setupView = document.getElementById('setupView');
  const liveDashboardView = document.getElementById('liveDashboardView');

  // Stage 1: Question Builder Elements
  const builderDeptNameInput = document.getElementById('builderDeptNameInput');
  const builderMeetingTitleInput = document.getElementById('builderMeetingTitleInput');
  const toggleShowYearToParents = document.getElementById('toggleShowYearToParents');
  const autoSaveIndicator = document.getElementById('autoSaveIndicator');
  const builderQuestionsList = document.getElementById('builderQuestionsList');
  const btnAddQuestionCard = document.getElementById('btnAddQuestionCard');
  const previewColumn = document.getElementById('previewColumn');
  const previewPhoneContent = document.getElementById('previewPhoneContent');
  const builderValidCount = document.getElementById('builderValidCount');
  const btnFinishAndStartMeeting = document.getElementById('btnFinishAndStartMeeting');

  // Stage 2: Live Dashboard Elements
  const displayQuestionIndex = document.getElementById('displayQuestionIndex');
  const displayStatusBadge = document.getElementById('displayStatusBadge');
  const displayStatusText = document.getElementById('displayStatusText');
  const displayQuestionText = document.getElementById('displayQuestionText');
  const btnPrevQuestion = document.getElementById('btnPrevQuestion');
  const btnNextQuestion = document.getElementById('btnNextQuestion');
  const btnLaunchPoll = document.getElementById('btnLaunchPoll');
  const btnClosePoll = document.getElementById('btnClosePoll');
  const btnResetPoll = document.getElementById('btnResetPoll');
  const filterPillsContainer = document.getElementById('filterPillsContainer');
  const chartVoteSummary = document.getElementById('chartVoteSummary');
  const chartBarsList = document.getElementById('chartBarsList');
  const sideQrImg = document.getElementById('sideQrImg');
  const sideJoinUrl = document.getElementById('sideJoinUrl');
  const btnBigQr = document.getElementById('btnBigQr');
  const btnOpenQrModal = document.getElementById('btnOpenQrModal');
  const audienceTotalPill = document.getElementById('audienceTotalPill');
  const audienceBreakdownList = document.getElementById('audienceBreakdownList');
  const qCountPill = document.getElementById('qCountPill');
  const questionNavList = document.getElementById('questionNavList');

  // Modals
  const qrModal = document.getElementById('qrModal');
  const modalQrImg = document.getElementById('modalQrImg');
  const modalJoinUrl = document.getElementById('modalJoinUrl');
  const btnCloseQrModal = document.getElementById('btnCloseQrModal');

  const summaryModal = document.getElementById('summaryModal');
  const btnSummaryReport = document.getElementById('btnSummaryReport');
  const btnCloseSummary = document.getElementById('btnCloseSummary');
  const summaryReportContent = document.getElementById('summaryReportContent');
  const btnPrintReport = document.getElementById('btnPrintReport');
  const btnDownloadCsvFromSummary = document.getElementById('btnDownloadCsvFromSummary');
  const btnExportCsv = document.getElementById('btnExportCsv');

  const settingsModal = document.getElementById('settingsModal');
  const btnSettings = document.getElementById('btnSettings');
  const btnCloseSettings = document.getElementById('btnCloseSettings');
  const btnCancelSettings = document.getElementById('btnCancelSettings');
  const btnSaveSettings = document.getElementById('btnSaveSettings');
  const settingDeptName = document.getElementById('settingDeptName');
  const settingMeetingTitle = document.getElementById('settingMeetingTitle');
  const settingJoinUrl = document.getElementById('settingJoinUrl');
  const settingYearGroups = document.getElementById('settingYearGroups');
  const btnSwitchToSetupFromSettings = document.getElementById('btnSwitchToSetupFromSettings');

  // Application State
  let currentStage = 'setup'; // 'setup' | 'live'
  let meetingStatus = 'setup'; // 'setup' | 'active'
  let departmentName = 'Department of Computer Science & Engineering';
  let meetingTitle = 'Annual Parent-Teacher Meeting 2026';
  let showYearToParents = true;
  let yearGroups = ['1st Year', '2nd Year', '3rd Year', 'Final Year'];
  let questions = [];
  let previewQuestionIndex = 0;
  let currentQuestionId = null;
  let questionStatus = 'idle'; // 'idle' | 'live' | 'closed'
  let currentTallies = null;
  let stats = { connectedCount: 0, yearGroupCounts: {} };
  let selectedYearFilter = 'All Years';
  let joinUrl = '';

  const optionLetters = ['A', 'B', 'C', 'D'];

  // Socket Connection
  const socket = io();

  socket.on('connect', () => {
    socket.emit('admin:join');
  });

  socket.on('admin:init', (data) => {
    departmentName = data.departmentName || departmentName;
    meetingTitle = data.meetingTitle || meetingTitle;
    meetingStatus = data.meetingStatus || 'setup';
    showYearToParents = data.showYearToParents !== false;
    yearGroups = data.yearGroups || yearGroups;
    questions = (data.questions && data.questions.length > 0) ? data.questions : getFallbackQuestions();
    currentQuestionId = data.currentQuestionId || (questions[0] ? questions[0].id : null);
    questionStatus = data.questionStatus || 'idle';
    currentTallies = data.tallies;
    stats = data.stats || stats;
    joinUrl = data.joinUrl || '';

    // If meeting was already active, jump to live view; otherwise stay in setup
    if (meetingStatus === 'active') {
      switchView('live');
    } else {
      switchView('setup');
    }

    initSetupForm();
    renderBuilderQuestions();
    renderMobilePreview();
    updateBranding();
    renderFilterPills();
    renderQuestionNavigator();
    renderAudienceBreakdown();
    updateQuestionDisplay();
    renderChart();
    loadQrInfo();
  });

  socket.on('admin:meeting_started', (data) => {
    meetingStatus = 'active';
    if (data.currentQuestionId) currentQuestionId = data.currentQuestionId;
    if (data.tallies) currentTallies = data.tallies;
    if (data.stats) stats = data.stats;

    switchView('live');
    updateQuestionDisplay();
    renderChart();
    renderFilterPills();
    renderQuestionNavigator();
  });

  socket.on('admin:returned_to_setup', () => {
    meetingStatus = 'setup';
    switchView('setup');
  });

  socket.on('admin:questions_saved', (data) => {
    questions = data.questions;
    showYearToParents = data.showYearToParents !== false;
    if (data.departmentName) departmentName = data.departmentName;
    if (data.meetingTitle) meetingTitle = data.meetingTitle;
    if (data.currentQuestionId) currentQuestionId = data.currentQuestionId;
    if (data.tallies) currentTallies = data.tallies;
    if (data.stats) stats = data.stats;

    showAutoSaveConfirmation();
    updateBranding();
    renderFilterPills();
    renderQuestionNavigator();
    updateQuestionDisplay();
    renderChart();
  });

  socket.on('admin:state_change', (data) => {
    currentQuestionId = data.currentQuestionId;
    questionStatus = data.questionStatus;
    currentTallies = data.tallies;
    if (data.stats) stats = data.stats;

    updateQuestionDisplay();
    renderChart();
    renderQuestionNavigator();
  });

  socket.on('poll:update', (data) => {
    if (data.questionId === currentQuestionId) {
      currentTallies = data.tallies;
    }
    if (data.stats) stats = data.stats;

    renderChart();
    renderAudienceBreakdown();
  });

  socket.on('admin:stats', (data) => {
    stats = data;
    renderAudienceBreakdown();
    renderChart();
  });

  // Switch between Setup View and Live View
  function switchView(viewName) {
    currentStage = viewName;
    if (viewName === 'setup') {
      setupView.classList.add('active');
      liveDashboardView.classList.remove('active');
      liveConnectedPill.style.display = 'none';
      setupNavActions.style.display = 'flex';
      liveNavActions.style.display = 'none';
      navMeetingTitle.textContent = 'Set Up Meeting';

      // If meeting has already been started, show button to jump back to live
      if (meetingStatus === 'active') {
        btnGoToLiveIfStarted.style.display = 'inline-flex';
      } else {
        btnGoToLiveIfStarted.style.display = 'none';
      }
    } else {
      setupView.classList.remove('active');
      liveDashboardView.classList.add('active');
      liveConnectedPill.style.display = 'inline-flex';
      setupNavActions.style.display = 'none';
      liveNavActions.style.display = 'flex';
      navMeetingTitle.textContent = meetingTitle || 'Live Meeting';
    }
  }

  btnGoToLiveIfStarted.addEventListener('click', () => switchView('live'));
  btnEditQuestionsNav.addEventListener('click', () => {
    switchView('setup');
    renderBuilderQuestions();
    renderMobilePreview();
  });

  // Mobile preview column toggle (for smaller screens)
  btnPreviewToggleMobile.addEventListener('click', () => {
    if (previewColumn.style.display === 'none') {
      previewColumn.style.display = 'flex';
    } else {
      previewColumn.style.display = 'none';
    }
  });

  // =========================================================================
  // QUESTION BUILDER LOGIC
  // =========================================================================
  function getFallbackQuestions() {
    return [
      {
        id: 'q1',
        text: 'How satisfied are you with the academic progress and curriculum delivery so far?',
        options: ['Highly Satisfied', 'Satisfied', 'Needs Improvement', 'Dissatisfied']
      },
      {
        id: 'q2',
        text: 'Which area should the department prioritize for enhanced student support this semester?',
        options: ['Industry Internships & Placements', 'Coding Workshops', 'Individual Mentorship', 'Competitive Exams (GATE/GRE)']
      }
    ];
  }

  function initSetupForm() {
    builderDeptNameInput.value = departmentName;
    builderMeetingTitleInput.value = meetingTitle;
    toggleShowYearToParents.checked = showYearToParents;

    builderDeptNameInput.addEventListener('input', () => {
      departmentName = builderDeptNameInput.value.trim();
      updateBranding();
      debouncedSaveQuestions();
    });

    builderMeetingTitleInput.addEventListener('input', () => {
      meetingTitle = builderMeetingTitleInput.value.trim();
      if (currentStage === 'live') navMeetingTitle.textContent = meetingTitle;
      debouncedSaveQuestions();
    });

    toggleShowYearToParents.addEventListener('change', () => {
      showYearToParents = toggleShowYearToParents.checked;
      renderMobilePreview();
      debouncedSaveQuestions();
    });
  }

  function renderBuilderQuestions() {
    builderQuestionsList.innerHTML = '';

    questions.forEach((q, qIdx) => {
      const card = document.createElement('div');
      card.className = `builder-q-card ${qIdx === previewQuestionIndex ? 'selected-for-preview' : ''}`;
      card.dataset.index = qIdx;

      // Header: Question number & reorder/delete controls
      const header = document.createElement('div');
      header.className = 'builder-q-header';
      header.innerHTML = `
        <div class="builder-q-num-badge">Question ${qIdx + 1}</div>
        <div class="builder-q-actions">
          <button type="button" class="btn-icon" title="Move Up" ${qIdx === 0 ? 'disabled style="opacity:0.3;"' : ''} data-action="up">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="18 15 12 9 6 15"></polyline></svg>
          </button>
          <button type="button" class="btn-icon" title="Move Down" ${qIdx === questions.length - 1 ? 'disabled style="opacity:0.3;"' : ''} data-action="down">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"></polyline></svg>
          </button>
          <button type="button" class="btn-icon delete" title="Delete Question" data-action="delete">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
        </div>
      `;

      // Event listeners for reorder and delete
      header.querySelector('[data-action="up"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        moveQuestion(qIdx, -1);
      });
      header.querySelector('[data-action="down"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        moveQuestion(qIdx, 1);
      });
      header.querySelector('[data-action="delete"]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteQuestion(qIdx);
      });

      // Question Textarea
      const textarea = document.createElement('textarea');
      textarea.className = 'builder-q-textarea';
      textarea.rows = 2;
      textarea.placeholder = 'Enter your question prompt here...';
      textarea.value = q.text || '';
      textarea.addEventListener('input', (e) => {
        q.text = e.target.value;
        renderMobilePreview();
        debouncedSaveQuestions();
        validateSetup();
      });
      textarea.addEventListener('focus', () => {
        setPreviewQuestion(qIdx);
      });

      // Options Container
      const optionsContainer = document.createElement('div');
      optionsContainer.className = 'builder-options-container';

      q.options.forEach((optText, optIdx) => {
        const optRow = document.createElement('div');
        optRow.className = 'builder-option-row';

        const optLabel = document.createElement('div');
        optLabel.className = `builder-option-label opt-color-${optIdx}`;
        optLabel.textContent = optionLetters[optIdx] || (optIdx + 1);

        const optInput = document.createElement('input');
        optInput.type = 'text';
        optInput.className = 'builder-option-input';
        optInput.placeholder = `Option ${optionLetters[optIdx] || (optIdx + 1)}...`;
        optInput.value = optText || '';
        optInput.addEventListener('input', (e) => {
          q.options[optIdx] = e.target.value;
          renderMobilePreview();
          debouncedSaveQuestions();
          validateSetup();
        });
        optInput.addEventListener('focus', () => {
          setPreviewQuestion(qIdx);
        });

        // Remove option button (only if > 2 options)
        const btnRemove = document.createElement('button');
        btnRemove.type = 'button';
        btnRemove.className = 'btn-remove-option';
        btnRemove.title = 'Remove Option';
        btnRemove.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>`;
        btnRemove.disabled = q.options.length <= 2;
        btnRemove.style.opacity = q.options.length <= 2 ? '0.2' : '1';
        btnRemove.addEventListener('click', (e) => {
          e.stopPropagation();
          if (q.options.length > 2) {
            q.options.splice(optIdx, 1);
            renderBuilderQuestions();
            renderMobilePreview();
            debouncedSaveQuestions();
            validateSetup();
          }
        });

        optRow.appendChild(optLabel);
        optRow.appendChild(optInput);
        optRow.appendChild(btnRemove);
        optionsContainer.appendChild(optRow);
      });

      // Footer: Add Option button
      const optFooter = document.createElement('div');
      optFooter.className = 'builder-options-footer';
      if (q.options.length < 4) {
        const btnAddOpt = document.createElement('button');
        btnAddOpt.type = 'button';
        btnAddOpt.className = 'btn-add-option';
        btnAddOpt.innerHTML = `<span>+ Add Option (${optionLetters[q.options.length]})</span>`;
        btnAddOpt.addEventListener('click', (e) => {
          e.stopPropagation();
          q.options.push('');
          renderBuilderQuestions();
          renderMobilePreview();
          debouncedSaveQuestions();
          validateSetup();
        });
        optFooter.appendChild(btnAddOpt);
      } else {
        const limitNote = document.createElement('span');
        limitNote.className = 'option-limit-note';
        limitNote.textContent = 'Maximum 4 options reached';
        optFooter.appendChild(limitNote);
      }

      card.appendChild(header);
      card.appendChild(textarea);
      card.appendChild(optionsContainer);
      card.appendChild(optFooter);

      card.addEventListener('click', () => {
        setPreviewQuestion(qIdx);
      });

      builderQuestionsList.appendChild(card);
    });

    validateSetup();
  }

  function setPreviewQuestion(idx) {
    previewQuestionIndex = idx;
    document.querySelectorAll('.builder-q-card').forEach((c, i) => {
      c.classList.toggle('selected-for-preview', i === idx);
    });
    renderMobilePreview();
  }

  function moveQuestion(index, direction) {
    const target = index + direction;
    if (target < 0 || target >= questions.length) return;
    const temp = questions[index];
    questions[index] = questions[target];
    questions[target] = temp;
    previewQuestionIndex = target;
    renderBuilderQuestions();
    renderMobilePreview();
    debouncedSaveQuestions();
  }

  function deleteQuestion(index) {
    if (questions.length <= 1) {
      alert('You must have at least one question for the meeting.');
      return;
    }
    if (confirm(`Delete Question ${index + 1}?`)) {
      questions.splice(index, 1);
      if (previewQuestionIndex >= questions.length) {
        previewQuestionIndex = questions.length - 1;
      }
      renderBuilderQuestions();
      renderMobilePreview();
      debouncedSaveQuestions();
      validateSetup();
    }
  }

  btnAddQuestionCard.addEventListener('click', () => {
    const newId = 'q_' + Date.now() + '_' + Math.random().toString(36).substr(2, 4);
    questions.push({
      id: newId,
      text: '',
      options: ['', '']
    });
    previewQuestionIndex = questions.length - 1;
    renderBuilderQuestions();
    renderMobilePreview();
    debouncedSaveQuestions();
    validateSetup();

    // Scroll to new question card
    setTimeout(() => {
      const cards = builderQuestionsList.querySelectorAll('.builder-q-card');
      const lastCard = cards[cards.length - 1];
      if (lastCard) lastCard.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  });

  // Render Mobile Mockup Preview
  function renderMobilePreview() {
    const q = questions[previewQuestionIndex] || questions[0];
    if (!q) {
      previewPhoneContent.innerHTML = '<div style="color:var(--text-muted); text-align:center; padding:40px;">No question to preview</div>';
      return;
    }

    const yearDisplayHtml = showYearToParents
      ? `<span>Joined as: <strong style="color: #a5b4fc;">2nd Year</strong></span>`
      : `<span>Participation: <strong style="color: #34d399;">Anonymous</strong></span>`;

    let optionsHtml = '';
    q.options.forEach((optText, i) => {
      optionsHtml += `
        <div class="preview-opt-item">
          <span class="preview-opt-letter opt-color-${i}">${optionLetters[i] || (i + 1)}</span>
          <span>${escapeHtml(optText || `Option ${optionLetters[i] || (i + 1)}`)}</span>
        </div>
      `;
    });

    previewPhoneContent.innerHTML = `
      <div style="font-size:0.7rem; color:#818cf8; font-weight:700; text-transform:uppercase;">
        ${escapeHtml(departmentName || 'Department of CSE')}
      </div>
      <div class="preview-parent-badge">
        ${yearDisplayHtml}
        <span style="font-size:0.68rem; color:#10b981; font-weight:700;">● Live</span>
      </div>
      <div class="preview-parent-question">
        ${escapeHtml(q.text || 'Question text will appear here...')}
      </div>
      <div class="preview-options-list">
        ${optionsHtml}
      </div>
      <div style="font-size:0.68rem; color:#64748b; text-align:center; margin-top:auto; padding-top:12px;">
        Tap option to answer • No login required
      </div>
    `;
  }

  // Validate Questions & Enable/Disable Finish Button
  function validateSetup() {
    let validCount = 0;
    questions.forEach(q => {
      const hasText = (q.text || '').trim().length > 0;
      const validOptions = (q.options || []).filter(o => (o || '').trim().length > 0);
      if (hasText && validOptions.length >= 2) {
        validCount++;
      }
    });

    builderValidCount.textContent = `${validCount} of ${questions.length} questions`;

    if (validCount >= 1) {
      btnFinishAndStartMeeting.disabled = false;
    } else {
      btnFinishAndStartMeeting.disabled = true;
    }
  }

  // Auto-Save Questions with Debouncing
  let autoSaveTimeout = null;
  function debouncedSaveQuestions() {
    autoSaveIndicator.innerHTML = `
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" style="animation:spin 1s linear infinite;"><line x1="12" y1="2" x2="12" y2="6"></line><line x1="12" y1="18" x2="12" y2="22"></line><line x1="4.93" y1="4.93" x2="7.76" y2="7.76"></line><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"></line><line x1="2" y1="12" x2="6" y2="12"></line><line x1="18" y1="12" x2="22" y2="12"></line><line x1="4.93" y1="19.07" x2="7.76" y2="16.24"></line><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"></line></svg>
      <span>Saving...</span>
    `;

    if (autoSaveTimeout) clearTimeout(autoSaveTimeout);
    autoSaveTimeout = setTimeout(() => {
      saveQuestionsToServer();
    }, 500);
  }

  function saveQuestionsToServer() {
    const payload = {
      questions,
      showYearToParents,
      departmentName,
      meetingTitle
    };

    localStorage.setItem('ptm_draft_questions', JSON.stringify(payload));
    socket.emit('admin:save_questions', payload);
  }

  function showAutoSaveConfirmation() {
    autoSaveIndicator.innerHTML = `
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>
      <span>Draft Auto-Saved</span>
    `;
  }

  // Finish & Start Meeting Action
  btnFinishAndStartMeeting.addEventListener('click', () => {
    // Filter out invalid questions before starting
    const cleanedQuestions = questions.filter(q => {
      const hasText = (q.text || '').trim().length > 0;
      const validOptions = (q.options || []).filter(o => (o || '').trim().length > 0);
      return hasText && validOptions.length >= 2;
    });

    if (cleanedQuestions.length === 0) {
      alert('Please add at least 1 question with at least 2 options.');
      return;
    }

    questions = cleanedQuestions;
    saveQuestionsToServer();
    socket.emit('admin:start_meeting');
  });

  // =========================================================================
  // STAGE 2: LIVE POLLING DASHBOARD LOGIC
  // =========================================================================
  function loadQrInfo() {
    fetch('/api/info')
      .then(res => res.json())
      .then(info => {
        joinUrl = info.joinUrl;
        sideQrImg.src = info.qrDataUrl;
        modalQrImg.src = info.qrDataUrl;
        sideJoinUrl.textContent = info.joinUrl;
        modalJoinUrl.textContent = info.joinUrl;
      })
      .catch(err => console.error('Failed to load QR info:', err));
  }

  function updateBranding() {
    navDeptText.textContent = departmentName || 'Department of CSE';
    if (currentStage === 'live') {
      navMeetingTitle.textContent = meetingTitle || 'Live Meeting';
    }
  }

  function renderFilterPills() {
    filterPillsContainer.innerHTML = '';
    const allFilters = ['All Years', ...yearGroups];

    allFilters.forEach(filterName => {
      const pill = document.createElement('button');
      pill.type = 'button';
      pill.className = `filter-pill ${selectedYearFilter === filterName ? 'active' : ''}`;

      const count = filterName === 'All Years'
        ? stats.connectedCount
        : (stats.yearGroupCounts && stats.yearGroupCounts[filterName] || 0);

      pill.innerHTML = `
        <span>${escapeHtml(filterName)}</span>
        <span class="pill-count">${count}</span>
      `;

      pill.addEventListener('click', () => {
        selectedYearFilter = filterName;
        renderFilterPills();
        renderChart();
      });

      filterPillsContainer.appendChild(pill);
    });
  }

  function renderAudienceBreakdown() {
    // Smooth number transition for connected count
    animateNumber(navConnectedCount, stats.connectedCount || 0);
    audienceTotalPill.textContent = `${stats.connectedCount || 0} Total`;

    audienceBreakdownList.innerHTML = '';
    if ((stats.connectedCount || 0) === 0) {
      audienceBreakdownList.innerHTML = `
        <div style="font-size:0.8rem; color:var(--text-dim); text-align:center; padding:8px 0;">
          No parents connected yet — display the QR code to begin.
        </div>
      `;
      return;
    }

    yearGroups.forEach(yg => {
      const count = (stats.yearGroupCounts && stats.yearGroupCounts[yg]) || 0;
      const row = document.createElement('div');
      row.className = 'audience-row';
      row.innerHTML = `
        <span style="color: var(--text-muted); font-weight: 500;">${escapeHtml(yg)}</span>
        <span style="font-weight: 700; color: #a5b4fc;">${count}</span>
      `;
      audienceBreakdownList.appendChild(row);
    });
  }

  function getCurrentQuestion() {
    return questions.find(q => q.id === currentQuestionId) || questions[0] || null;
  }

  function updateQuestionDisplay() {
    const q = getCurrentQuestion();
    const qIndex = questions.findIndex(item => item.id === (q ? q.id : ''));

    if (!q) {
      displayQuestionIndex.textContent = 'No Questions Configured';
      displayQuestionText.textContent = 'Click "Edit Questions" to add questions.';
      displayStatusBadge.className = 'q-status-badge idle';
      displayStatusText.textContent = 'Empty';
      btnLaunchPoll.disabled = true;
      btnClosePoll.style.display = 'none';
      btnResetPoll.disabled = true;
      return;
    }

    displayQuestionIndex.textContent = `Question ${qIndex + 1} of ${questions.length}`;
    displayQuestionText.textContent = q.text;

    if (questionStatus === 'live') {
      displayStatusBadge.className = 'q-status-badge live';
      displayStatusText.textContent = '● Live Polling Active';
      btnLaunchPoll.style.display = 'none';
      btnClosePoll.style.display = 'inline-flex';
      btnResetPoll.disabled = false;
    } else if (questionStatus === 'closed') {
      displayStatusBadge.className = 'q-status-badge closed';
      displayStatusText.textContent = 'Poll Closed';
      btnLaunchPoll.style.display = 'inline-flex';
      btnLaunchPoll.querySelector('span').textContent = 'Reopen Poll';
      btnClosePoll.style.display = 'none';
      btnResetPoll.disabled = false;
    } else {
      displayStatusBadge.className = 'q-status-badge idle';
      displayStatusText.textContent = 'Ready to Launch';
      btnLaunchPoll.style.display = 'inline-flex';
      btnLaunchPoll.querySelector('span').textContent = 'Launch Poll to Parents';
      btnClosePoll.style.display = 'none';
      btnResetPoll.disabled = false;
    }

    btnPrevQuestion.disabled = qIndex <= 0;
    btnNextQuestion.disabled = qIndex >= questions.length - 1;
  }

  function renderQuestionNavigator() {
    qCountPill.textContent = `${questions.length} Questions`;
    questionNavList.innerHTML = '';

    questions.forEach((q, idx) => {
      const item = document.createElement('div');
      item.className = `q-nav-item ${q.id === currentQuestionId ? 'active' : ''}`;
      item.innerHTML = `
        <div class="q-nav-info">
          <span class="q-nav-num">Question ${idx + 1}</span>
          <span class="q-nav-title">${escapeHtml(q.text || 'Untitled Question')}</span>
        </div>
        ${q.id === currentQuestionId && questionStatus === 'live' ? '<span style="color:#ef4444; font-size: 0.7rem; font-weight:700;">LIVE</span>' : ''}
      `;

      item.addEventListener('click', () => {
        if (q.id !== currentQuestionId) {
          switchToQuestion(q.id);
        }
      });

      questionNavList.appendChild(item);
    });
  }

  function switchToQuestion(qId) {
    currentQuestionId = qId;
    questionStatus = 'idle';
    socket.emit('admin:launch_question', { questionId: qId });
  }

  // Animated Live Bar Chart
  function renderChart() {
    const q = getCurrentQuestion();
    if (!q) {
      chartBarsList.innerHTML = '<div class="empty-chart-state">No question loaded.</div>';
      chartVoteSummary.textContent = '0 Votes Cast';
      return;
    }

    const options = q.options || [];
    let filterCounts = [];
    let totalFilterVotes = 0;

    if (currentTallies && currentTallies.breakdown) {
      const breakdown = currentTallies.breakdown[selectedYearFilter] || new Array(options.length).fill(0);
      filterCounts = breakdown;
      totalFilterVotes = filterCounts.reduce((acc, v) => acc + v, 0);
    } else {
      filterCounts = new Array(options.length).fill(0);
    }

    const audienceTotal = selectedYearFilter === 'All Years'
      ? stats.connectedCount
      : (stats.yearGroupCounts && stats.yearGroupCounts[selectedYearFilter] || 0);

    const participationPct = audienceTotal > 0
      ? Math.round((totalFilterVotes / audienceTotal) * 100)
      : 0;

    chartVoteSummary.textContent = `${totalFilterVotes} Votes Cast (${participationPct}% participation · ${audienceTotal} in ${selectedYearFilter})`;

    // Check if question has 0 votes and is not launched yet
    if (totalFilterVotes === 0 && questionStatus === 'idle') {
      chartBarsList.innerHTML = `
        <div class="empty-chart-state">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
          <div style="font-weight:700; color:#f1f5f9;">Question Ready to Launch</div>
          <div style="font-size:0.88rem;">Click "Launch Poll to Parents" above to start receiving live votes.</div>
        </div>
      `;
      return;
    }

    // Check if bars need structure rebuild
    const existingBars = chartBarsList.querySelectorAll('.bar-row');
    if (existingBars.length !== options.length) {
      chartBarsList.innerHTML = '';
      options.forEach((optText, i) => {
        const row = document.createElement('div');
        row.className = 'bar-row';
        row.dataset.index = i;

        row.innerHTML = `
          <div class="bar-label-line">
            <div class="bar-option-info">
              <span class="option-badge opt-color-${i}">${optionLetters[i] || (i + 1)}</span>
              <span class="bar-option-title">${escapeHtml(optText)}</span>
            </div>
            <div class="bar-metrics">
              <span class="bar-count">0 votes</span>
              <span class="bar-percent">(0%)</span>
            </div>
          </div>
          <div class="bar-track">
            <div class="bar-fill bar-fill-${i}" style="width: 0%"></div>
          </div>
        `;
        chartBarsList.appendChild(row);
      });
    }

    // Smoothly animate existing bars
    options.forEach((optText, i) => {
      const row = chartBarsList.querySelector(`.bar-row[data-index="${i}"]`);
      if (!row) return;

      const titleEl = row.querySelector('.bar-option-title');
      const countEl = row.querySelector('.bar-count');
      const percentEl = row.querySelector('.bar-percent');
      const fillEl = row.querySelector('.bar-fill');

      titleEl.textContent = optText;

      const votes = filterCounts[i] || 0;
      const pct = totalFilterVotes > 0 ? ((votes / totalFilterVotes) * 100).toFixed(1) : '0.0';

      countEl.textContent = `${votes} ${votes === 1 ? 'vote' : 'votes'}`;
      percentEl.textContent = `(${pct}%)`;

      const barWidth = totalFilterVotes > 0 ? (votes / totalFilterVotes) * 100 : 0;
      fillEl.style.width = `${barWidth}%`;
    });
  }

  // Question Navigation Actions
  btnPrevQuestion.addEventListener('click', () => {
    const idx = questions.findIndex(q => q.id === currentQuestionId);
    if (idx > 0) switchToQuestion(questions[idx - 1].id);
  });

  btnNextQuestion.addEventListener('click', () => {
    const idx = questions.findIndex(q => q.id === currentQuestionId);
    if (idx >= 0 && idx < questions.length - 1) switchToQuestion(questions[idx + 1].id);
  });

  btnLaunchPoll.addEventListener('click', () => {
    if (!currentQuestionId && questions.length > 0) currentQuestionId = questions[0].id;
    if (currentQuestionId) socket.emit('admin:launch_question', { questionId: currentQuestionId });
  });

  btnClosePoll.addEventListener('click', () => {
    socket.emit('admin:close_question');
  });

  btnResetPoll.addEventListener('click', () => {
    if (!currentQuestionId) return;
    if (confirm('Are you sure you want to reset all responses for this question?')) {
      socket.emit('admin:reset_question', { questionId: currentQuestionId });
    }
  });

  // QR Modals
  function openQrModal() { qrModal.classList.remove('hidden'); }
  function closeQrModal() { qrModal.classList.add('hidden'); }
  btnBigQr.addEventListener('click', openQrModal);
  btnOpenQrModal.addEventListener('click', openQrModal);
  btnCloseQrModal.addEventListener('click', closeQrModal);

  // CSV Export
  btnExportCsv.addEventListener('click', () => { window.location.href = '/api/export/csv'; });
  btnDownloadCsvFromSummary.addEventListener('click', () => { window.location.href = '/api/export/csv'; });

  // Summary Report Modal
  btnSummaryReport.addEventListener('click', () => {
    fetch('/api/session/summary')
      .then(res => res.json())
      .then(data => {
        renderSummaryReport(data);
        summaryModal.classList.remove('hidden');
      });
  });

  btnCloseSummary.addEventListener('click', () => summaryModal.classList.add('hidden'));
  btnPrintReport.addEventListener('click', () => window.print());

  function renderSummaryReport(data) {
    let html = `
      <div style="border-bottom: 2px solid var(--border); padding-bottom: 16px; margin-bottom: 20px;">
        <h2 style="font-size: 1.4rem; color: #ffffff;">${escapeHtml(data.meetingTitle)}</h2>
        <p style="color: #a5b4fc; font-weight: 600;">${escapeHtml(data.departmentName)}</p>
        <span style="font-size: 0.8rem; color: var(--text-dim);">Generated on ${new Date(data.generatedAt).toLocaleString()}</span>
      </div>
    `;

    data.results.forEach((res, qIdx) => {
      if (!res) return;
      html += `
        <div style="background: var(--bg-card); border-radius: 8px; border: 1px solid var(--border); padding: 18px; margin-bottom: 16px;">
          <h4 style="font-size: 1.05rem; font-weight: 700; margin-bottom: 12px; color: #ffffff;">
            Q${qIdx + 1}: ${escapeHtml(res.questionText)}
          </h4>
          <table style="width: 100%; border-collapse: collapse; font-size: 0.88rem;">
            <thead>
              <tr style="border-bottom: 1px solid var(--border); text-align: left; color: var(--text-muted);">
                <th style="padding: 8px 6px;">Option</th>
                ${data.yearGroups.map(yg => `<th style="padding: 8px 6px; text-align: right;">${escapeHtml(yg)}</th>`).join('')}
                <th style="padding: 8px 6px; text-align: right;">Total</th>
                <th style="padding: 8px 6px; text-align: right;">%</th>
              </tr>
            </thead>
            <tbody>
      `;

      res.options.forEach((opt, optIdx) => {
        const total = res.breakdown['All Years'][optIdx];
        const pct = res.totalVotes > 0 ? ((total / res.totalVotes) * 100).toFixed(1) : '0.0';

        html += `
          <tr style="border-bottom: 1px solid rgba(255,255,255,0.05);">
            <td style="padding: 8px 6px; font-weight: 600;">
              <span style="color: #818cf8; margin-right: 6px;">${optionLetters[optIdx]}.</span> ${escapeHtml(opt)}
            </td>
            ${data.yearGroups.map(yg => {
              const val = res.breakdown[yg] ? res.breakdown[yg][optIdx] : 0;
              return `<td style="padding: 8px 6px; text-align: right; color: var(--text-muted);">${val}</td>`;
            }).join('')}
            <td style="padding: 8px 6px; text-align: right; font-weight: 700; color: #ffffff;">${total}</td>
            <td style="padding: 8px 6px; text-align: right; font-weight: 700; color: #34d399;">${pct}%</td>
          </tr>
        `;
      });

      html += `
            </tbody>
          </table>
          <div style="margin-top: 10px; font-size: 0.8rem; color: var(--text-muted); text-align: right;">
            Total responses: <strong style="color: #ffffff;">${res.totalVotes}</strong>
          </div>
        </div>
      `;
    });

    summaryReportContent.innerHTML = html;
  }

  // Settings Modal Handlers
  btnSettings.addEventListener('click', () => {
    settingDeptName.value = departmentName;
    settingMeetingTitle.value = meetingTitle;
    settingJoinUrl.value = joinUrl.includes(window.location.host) ? '' : joinUrl;
    settingYearGroups.value = yearGroups.join(', ');
    settingsModal.classList.remove('hidden');
  });

  btnCloseSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));
  btnCancelSettings.addEventListener('click', () => settingsModal.classList.add('hidden'));

  btnSaveSettings.addEventListener('click', () => {
    const newDept = settingDeptName.value.trim();
    const newTitle = settingMeetingTitle.value.trim();
    const newJoinUrl = settingJoinUrl.value.trim();
    const newYears = settingYearGroups.value.split(',').map(s => s.trim()).filter(Boolean);

    socket.emit('admin:update_settings', {
      departmentName: newDept,
      meetingTitle: newTitle,
      customJoinUrl: newJoinUrl,
      yearGroups: newYears.length > 0 ? newYears : undefined
    });

    settingsModal.classList.add('hidden');
  });

  btnSwitchToSetupFromSettings.addEventListener('click', () => {
    settingsModal.classList.add('hidden');
    switchView('setup');
    renderBuilderQuestions();
    renderMobilePreview();
  });

  // Smooth number interpolation helper
  function animateNumber(element, targetNumber) {
    const currentNumber = parseInt(element.textContent || '0', 10) || 0;
    if (currentNumber === targetNumber) return;

    const startTime = performance.now();
    const duration = 400; // ms

    function update(time) {
      const elapsed = time - startTime;
      const progress = Math.min(elapsed / duration, 1);
      const val = Math.round(currentNumber + (targetNumber - currentNumber) * progress);
      element.textContent = val;
      if (progress < 1) {
        requestAnimationFrame(update);
      } else {
        element.textContent = targetNumber;
      }
    }
    requestAnimationFrame(update);
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
