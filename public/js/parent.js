// ==========================================================================
// CSBS Parent–Teacher Meeting - Parent Mobile Client Logic
// Step-by-Step Flow: Welcome -> Select Year -> Waiting -> Live Question -> Review
// ==========================================================================

(function() {
  'use strict';

  // Session Token Initialization
  let voterToken = localStorage.getItem('ptm_voter_token');
  if (!voterToken) {
    voterToken = 'p_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    localStorage.setItem('ptm_voter_token', voterToken);
  }

  let selectedYear = localStorage.getItem('ptm_student_year') || null;
  let currentMeetingId = null;
  let currentQuestion = null;
  let currentQuestionStatus = 'idle'; // 'idle' | 'live' | 'closed'
  let meetingStatus = 'WAITING_FOR_PARENTS';

  // Answer tracking: questionId -> optionIndex
  let myAnswers = {};

  // DOM Elements
  const screens = {
    welcome: document.getElementById('screenWelcome'),
    selectYear: document.getElementById('screenSelectYear'),
    waiting: document.getElementById('screenWaiting'),
    question: document.getElementById('screenQuestion'),
    completed: document.getElementById('screenCompleted')
  };

  const pHeaderTitle = document.getElementById('pHeaderTitle');
  const pHeaderSubtitle = document.getElementById('pHeaderSubtitle');
  const pConnectionStatus = document.getElementById('pConnectionStatus');
  const pConnectionText = document.getElementById('pConnectionText');

  const pStudentYearBar = document.getElementById('pStudentYearBar');
  const pStudentYearVal = document.getElementById('pStudentYearVal');
  const pBtnChangeYear = document.getElementById('pBtnChangeYear');

  const btnJoinMeeting = document.getElementById('btnJoinMeeting');
  const pYearOptionsList = document.getElementById('pYearOptionsList');
  const btnContinueYear = document.getElementById('btnContinueYear');

  const pWaitingTitle = document.getElementById('pWaitingTitle');
  const pWaitingSubtitle = document.getElementById('pWaitingSubtitle');

  const pQuestionProgressLabel = document.getElementById('pQuestionProgressLabel');
  const pQuestionTextEn = document.getElementById('pQuestionTextEn');
  const pQuestionTextTa = document.getElementById('pQuestionTextTa');
  const pVoteStatusBanner = document.getElementById('pVoteStatusBanner');
  const pOptionsList = document.getElementById('pOptionsList');
  const btnSubmitVote = document.getElementById('btnSubmitVote');

  let pendingOptionSelection = null;

  // Socket Connection
  const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000
  });

  // Screen Switching Function
  function showScreen(screenKey) {
    Object.keys(screens).forEach(key => {
      if (screens[key]) {
        screens[key].classList.toggle('active', key === screenKey);
      }
    });
  }

  // Update Year Bar
  function updateYearBar() {
    if (selectedYear) {
      pStudentYearBar.style.display = 'flex';
      pStudentYearVal.textContent = selectedYear;
    } else {
      pStudentYearBar.style.display = 'none';
    }
  }

  // Determine which screen to display based on state
  function syncScreenState() {
    updateYearBar();

    if (meetingStatus === 'COMPLETED') {
      showScreen('completed');
      return;
    }

    // Must select year first before any questions
    if (!selectedYear) {
      showScreen('selectYear');
      return;
    }

    // If a question is live, show question screen
    if (currentQuestion && (currentQuestionStatus === 'live' || currentQuestionStatus === 'closed')) {
      showScreen('question');
      renderQuestion();
      return;
    }

    // Otherwise waiting room
    showScreen('waiting');
    if (meetingStatus === 'WAITING_FOR_PARENTS') {
      pWaitingTitle.textContent = 'Welcome to CSBS PTM!';
      pWaitingSubtitle.textContent = 'You are connected. Please wait for faculty to launch the meeting questions.';
    } else {
      pWaitingTitle.textContent = 'Ready for Questions';
      pWaitingSubtitle.textContent = 'Please wait for the faculty to launch the next question on the screen.';
    }
  }

  // -------------------------------------------------------------
  // Screen 1: Welcome / Join
  // -------------------------------------------------------------
  btnJoinMeeting?.addEventListener('click', () => {
    if (!selectedYear) {
      showScreen('selectYear');
    } else {
      syncScreenState();
    }
  });

  // -------------------------------------------------------------
  // Screen 2: Year Selection
  // -------------------------------------------------------------
  let tempSelectedYear = selectedYear;

  function renderYearSelectionChoices() {
    const buttons = pYearOptionsList.querySelectorAll('.year-choice-item');
    buttons.forEach(btn => {
      const yr = btn.getAttribute('data-year');
      btn.classList.toggle('selected', yr === tempSelectedYear);

      btn.onclick = () => {
        tempSelectedYear = yr;
        renderYearSelectionChoices();
        btnContinueYear.disabled = false;
      };
    });

    btnContinueYear.disabled = !tempSelectedYear;
  }

  renderYearSelectionChoices();

  btnContinueYear?.addEventListener('click', () => {
    if (!tempSelectedYear) return;
    selectedYear = tempSelectedYear;
    localStorage.setItem('ptm_student_year', selectedYear);

    // Notify server
    socket.emit('parent:select_year', {
      voterToken,
      yearGroup: selectedYear
    });

    syncScreenState();
  });

  pBtnChangeYear?.addEventListener('click', () => {
    tempSelectedYear = selectedYear;
    renderYearSelectionChoices();
    showScreen('selectYear');
  });

  // -------------------------------------------------------------
  // Screen 4: Question & Polling
  // -------------------------------------------------------------
  function renderQuestion() {
    if (!currentQuestion) return;

    pQuestionProgressLabel.textContent = `Question ${currentQuestion.index || 1} of ${currentQuestion.totalQuestions || 5}`;
    pQuestionTextEn.textContent = currentQuestion.text;

    if (currentQuestion.textTa && currentQuestion.textTa.trim()) {
      pQuestionTextTa.textContent = currentQuestion.textTa;
      pQuestionTextTa.style.display = 'block';
    } else {
      pQuestionTextTa.style.display = 'none';
    }

    // Previous vote for this question
    const existingVote = myAnswers[currentQuestion.id];
    if (existingVote !== undefined && existingVote !== null) {
      pendingOptionSelection = existingVote;
      showVoteFeedback(true);
    } else {
      pVoteStatusBanner.style.display = 'none';
      pendingOptionSelection = null;
    }

    renderOptionButtons();
  }

  function renderOptionButtons() {
    if (!currentQuestion || !currentQuestion.options) return;

    const isClosed = currentQuestionStatus === 'closed';
    const letters = ['A', 'B', 'C', 'D'];

    // Update poll status indicator
    const pollStatusTag = document.getElementById('pPollStatusTag');
    const pollStatusTagText = document.getElementById('pPollStatusTagText');
    if (pollStatusTag && pollStatusTagText) {
      if (isClosed) {
        pollStatusTag.className = 'poll-status-indicator closed';
        pollStatusTagText.textContent = 'Polling Closed';
      } else {
        pollStatusTag.className = 'poll-status-indicator open';
        pollStatusTagText.textContent = 'Polling Active';
      }
    }

    pOptionsList.innerHTML = currentQuestion.options.map((optText, index) => {
      const optTa = currentQuestion.optionsTa?.[index] || '';
      const isSelected = pendingOptionSelection === index;
      const letter = letters[index] || (index + 1);

      return `
        <button type="button" class="option-choice-item ${isSelected ? 'selected' : ''}" ${isClosed ? 'disabled' : ''} onclick="window.selectOption(${index})">
          <div class="option-letter-badge">${letter}</div>
          <div class="option-labels">
            <div class="option-label-en">${escapeHtml(optText)}</div>
            ${optTa ? `<div class="option-label-ta">${escapeHtml(optTa)}</div>` : ''}
          </div>
          <span class="option-selected-tag">✓ selected</span>
        </button>
      `;
    }).join('');

    // Enable/disable submit button
    if (isClosed) {
      btnSubmitVote.disabled = true;
      btnSubmitVote.textContent = 'Question Closed';
    } else {
      const existingVote = myAnswers[currentQuestion.id];
      if (existingVote !== undefined && existingVote !== null) {
        btnSubmitVote.disabled = false;
        btnSubmitVote.textContent = 'Update Answer';
      } else {
        btnSubmitVote.disabled = (pendingOptionSelection === null);
        btnSubmitVote.textContent = 'Submit & Continue';
      }
    }
  }

  window.selectOption = function(optionIndex) {
    if (currentQuestionStatus === 'closed') return;
    pendingOptionSelection = optionIndex;
    renderOptionButtons();
  };

  btnSubmitVote?.addEventListener('click', () => {
    if (pendingOptionSelection === null || !currentQuestion) return;

    // Submitting feedback state
    btnSubmitVote.disabled = true;
    btnSubmitVote.textContent = 'Submitting response...';

    // Send vote to server
    socket.emit('parent:vote', {
      voterToken,
      questionId: currentQuestion.id,
      optionIndex: pendingOptionSelection
    });

    myAnswers[currentQuestion.id] = pendingOptionSelection;
    setTimeout(() => {
      showVoteFeedback(false);
      renderOptionButtons();
    }, 150);
  });

  function showVoteFeedback(isExisting) {
    pVoteStatusBanner.style.display = 'flex';
    if (currentQuestionStatus === 'closed') {
      pVoteStatusBanner.className = 'feedback-banner info';
      pVoteStatusBanner.innerHTML = '<span>Poll closed. Your response was recorded.</span>';
    } else {
      pVoteStatusBanner.className = 'feedback-banner success';
      pVoteStatusBanner.innerHTML = '<span>✓ Response recorded! You can tap another option to update your choice.</span>';
    }
  }

  // -------------------------------------------------------------
  // Socket.io Lifecycle
  // -------------------------------------------------------------
  socket.on('connect', () => {
    pConnectionStatus.style.background = '#ecfdf5';
    pConnectionStatus.style.color = '#059669';
    pConnectionText.textContent = 'Live';

    // Join with voter token
    socket.emit('parent:join', {
      voterToken,
      yearGroup: selectedYear
    });

    // Fetch existing submitted answers
    socket.emit('parent:get_my_answers', { voterToken });
  });

  socket.on('disconnect', () => {
    pConnectionStatus.style.background = '#fef2f2';
    pConnectionStatus.style.color = '#dc2626';
    pConnectionText.textContent = 'Reconnecting...';
  });

  socket.on('session:state', (data) => {
    if (data.title) pHeaderTitle.textContent = data.title;
    if (data.departmentName) pHeaderSubtitle.textContent = data.departmentName;

    currentMeetingId = data.meetingId;
    meetingStatus = data.meetingStatus;
    currentQuestionStatus = data.questionStatus;
    currentQuestion = data.currentQuestion;

    if (data.myVote !== null && data.myVote !== undefined && currentQuestion) {
      myAnswers[currentQuestion.id] = data.myVote;
    }

    syncScreenState();
  });

  socket.on('question:live', (data) => {
    currentQuestion = data;
    currentQuestionStatus = 'live';
    syncScreenState();
  });

  socket.on('question:closed', () => {
    currentQuestionStatus = 'closed';
    renderOptionButtons();
    showVoteFeedback(true);
  });

  socket.on('question:reset', (data) => {
    if (currentQuestion && currentQuestion.id === data.questionId) {
      delete myAnswers[data.questionId];
      pendingOptionSelection = null;
      renderQuestion();
    }
  });

  socket.on('parent:vote_confirmed', (data) => {
    myAnswers[data.questionId] = data.optionIndex;
    showVoteFeedback(false);
    renderOptionButtons();
  });

  socket.on('parent:vote_error', (data) => {
    if (btnSubmitVote) {
      btnSubmitVote.disabled = false;
      btnSubmitVote.innerHTML = '<span>Submit Vote</span>';
    }
    if (pVoteStatusBanner) {
      pVoteStatusBanner.style.display = 'block';
      pVoteStatusBanner.className = 'feedback-banner warning';
      pVoteStatusBanner.innerHTML = `<span>⚠️ ${escapeHtml(data.message || 'Unable to record vote')}</span>`;
    }
  });

  socket.on('parent:answers_list', (answersMap) => {
    myAnswers = { ...myAnswers, ...(answersMap || {}) };
    if (currentQuestion && myAnswers[currentQuestion.id] !== undefined) {
      renderQuestion();
    }
  });

  socket.on('session:reset_for_new_meeting', (data) => {
    myAnswers = {};
    currentQuestion = null;
    currentQuestionStatus = 'idle';
    meetingStatus = data.status || 'WAITING_FOR_PARENTS';
    if (data.title) pHeaderTitle.textContent = data.title;
    syncScreenState();
  });

  socket.on('session:meeting_state', (data) => {
    meetingStatus = data.status;
    if (data.title) pHeaderTitle.textContent = data.title;
    syncScreenState();
  });

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Initial screen sync
  syncScreenState();
})();
