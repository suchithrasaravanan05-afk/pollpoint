// Parent Mobile Client Logic
// Department of Computer Science and Business Systems (CSBS)
(function() {
  // Elements
  const deptNameEl = document.getElementById('deptName');
  const meetingTitleEl = document.getElementById('meetingTitle');
  const connectionPill = document.getElementById('connectionStatus');
  const connectionText = document.getElementById('connectionText');
  const yearBadgeBar = document.getElementById('yearBadgeBar');
  const currentYearDisplay = document.getElementById('currentYearDisplay');
  const changeYearBtn = document.getElementById('changeYearBtn');
  const yearModal = document.getElementById('yearModal');
  const yearOptionsGrid = document.getElementById('yearOptionsGrid');
  const waitingState = document.getElementById('waitingState');
  const waitingSubtitle = document.getElementById('waitingSubtitle');
  const questionState = document.getElementById('questionState');
  const qStatusBadge = document.getElementById('qStatusBadge');
  const qStatusText = document.getElementById('qStatusText');
  const questionText = document.getElementById('questionText');
  const questionTextTa = document.getElementById('questionTextTa');
  const optionsContainer = document.getElementById('optionsContainer');
  const voteStatusBanner = document.getElementById('voteStatusBanner');
  const voteBannerText = document.getElementById('voteBannerText');

  // Client State
  let voterToken = localStorage.getItem('ptm_voter_token');
  if (!voterToken) {
    voterToken = 'v_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('ptm_voter_token', voterToken);
  }

  let selectedYearGroup = localStorage.getItem('ptm_year_group') || null;
  let availableYearGroups = ['1st Year', '2nd Year', '3rd Year', 'Final Year'];
  let currentQuestion = null;
  let currentQuestionStatus = 'idle';
  let mySelectedOptionIndex = null;

  // Initialize Socket
  const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    timeout: 10000
  });

  // Setup Year Group Modal
  function renderYearOptions() {
    yearOptionsGrid.innerHTML = '';
    availableYearGroups.forEach(yg => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `year-choice-btn ${selectedYearGroup === yg ? 'selected' : ''}`;
      btn.innerHTML = `
        <span>${escapeHtml(yg)}</span>
        <svg class="check-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;

      btn.addEventListener('click', () => {
        selectYearGroup(yg);
      });

      yearOptionsGrid.appendChild(btn);
    });
  }

  function openYearModal() {
    renderYearOptions();
    yearModal.classList.remove('hidden');
  }

  function closeYearModal() {
    yearModal.classList.add('hidden');
  }

  function selectYearGroup(yearGroup) {
    const isChange = selectedYearGroup !== null && selectedYearGroup !== yearGroup;
    selectedYearGroup = yearGroup;
    localStorage.setItem('ptm_year_group', yearGroup);
    currentYearDisplay.textContent = yearGroup;
    updateYearBadge();
    closeYearModal();

    if (socket.connected) {
      if (isChange) {
        socket.emit('parent:change_year', { voterToken, yearGroup });
      } else {
        socket.emit('parent:join', { voterToken, yearGroup });
      }
    }
  }

  changeYearBtn.addEventListener('click', openYearModal);

  let showYearToParents = true;

  function updateYearBadge() {
    if (selectedYearGroup) {
      yearBadgeBar.style.display = 'flex';
      const labelEl = yearBadgeBar.querySelector('.year-info span');
      if (showYearToParents) {
        if (labelEl) labelEl.textContent = 'Joined as:';
        currentYearDisplay.textContent = selectedYearGroup;
      } else {
        if (labelEl) labelEl.textContent = 'Participation:';
        currentYearDisplay.textContent = 'Anonymous';
      }
    }
  }

  // If no year group chosen yet, prompt user immediately
  if (!selectedYearGroup) {
    openYearModal();
  } else {
    updateYearBadge();
    closeYearModal();
  }

  // Socket Lifecycle
  socket.on('connect', () => {
    connectionPill.style.background = '#ecfdf5';
    connectionPill.style.color = '#059669';
    connectionText.textContent = 'Live';

    if (selectedYearGroup) {
      socket.emit('parent:join', { voterToken, yearGroup: selectedYearGroup });
    }
  });

  socket.on('disconnect', () => {
    connectionPill.style.background = '#fff1f2';
    connectionPill.style.color = '#e11d48';
    connectionText.textContent = 'Reconnecting...';
  });

  // Receive Full Session State on Join
  socket.on('session:state', (data) => {
    if (data.departmentName) deptNameEl.textContent = data.departmentName;
    if (data.meetingTitle) meetingTitleEl.textContent = data.meetingTitle;
    if (data.yearGroups && Array.isArray(data.yearGroups)) {
      availableYearGroups = data.yearGroups;
      renderYearOptions();
    }
    if (data.showYearToParents !== undefined) {
      showYearToParents = data.showYearToParents;
      updateYearBadge();
    }

    currentQuestionStatus = data.questionStatus;
    currentQuestion = data.currentQuestion;
    mySelectedOptionIndex = data.myVote;

    updateUI();
  });

  socket.on('session:settings', (data) => {
    if (data.departmentName) deptNameEl.textContent = data.departmentName;
    if (data.meetingTitle) meetingTitleEl.textContent = data.meetingTitle;
    if (data.showYearToParents !== undefined) {
      showYearToParents = data.showYearToParents;
      updateYearBadge();
    }
  });

  // New Meeting Reset
  socket.on('session:reset_for_new_meeting', (data) => {
    if (data.departmentName) deptNameEl.textContent = data.departmentName;
    if (data.meetingTitle) meetingTitleEl.textContent = data.meetingTitle;
    currentQuestion = null;
    currentQuestionStatus = 'idle';
    mySelectedOptionIndex = null;
    updateUI();
  });

  // Live Question Launched by HOD
  socket.on('question:live', (data) => {
    currentQuestion = data;
    currentQuestionStatus = 'live';
    mySelectedOptionIndex = null;
    updateUI();
  });

  // Question Closed by HOD
  socket.on('question:closed', () => {
    currentQuestionStatus = 'closed';
    updateQuestionStatusUI();
  });

  // Question Reset
  socket.on('question:reset', (data) => {
    if (currentQuestion && currentQuestion.id === data.questionId) {
      mySelectedOptionIndex = null;
      updateUI();
    }
  });

  // Vote Confirmed
  socket.on('parent:vote_confirmed', (data) => {
    mySelectedOptionIndex = data.optionIndex;
    renderOptions();
    showVoteConfirmation();
  });

  // Update Main UI based on current question & status
  function updateUI() {
    if (!currentQuestion || currentQuestionStatus === 'idle') {
      waitingState.classList.add('active');
      questionState.classList.remove('active');
      waitingSubtitle.textContent = 'Please wait for the department faculty to launch the next question on the projector.';
      return;
    }

    waitingState.classList.remove('active');
    questionState.classList.add('active');
    questionText.textContent = currentQuestion.text;

    if (currentQuestion.textTa && currentQuestion.textTa.trim()) {
      questionTextTa.textContent = currentQuestion.textTa;
      questionTextTa.style.display = 'block';
    } else {
      questionTextTa.style.display = 'none';
    }

    updateQuestionStatusUI();
    renderOptions();

    if (mySelectedOptionIndex !== null) {
      showVoteConfirmation();
    } else {
      voteStatusBanner.className = 'vote-status-banner';
    }
  }

  function updateQuestionStatusUI() {
    if (currentQuestionStatus === 'live') {
      qStatusBadge.className = 'status-badge live';
      qStatusText.textContent = 'Live Poll';
      voteBannerText.textContent = 'Your vote is recorded! Tap another option to change.';
    } else if (currentQuestionStatus === 'closed') {
      qStatusBadge.className = 'status-badge closed';
      qStatusText.textContent = 'Poll Closed';
      if (mySelectedOptionIndex !== null) {
        voteStatusBanner.className = 'vote-status-banner closed';
        voteBannerText.textContent = 'Poll has ended. Your answer was recorded.';
      } else {
        voteStatusBanner.className = 'vote-status-banner closed';
        voteBannerText.textContent = 'Poll has ended by the department faculty.';
      }
    }
  }

  const optionLetters = ['A', 'B', 'C', 'D'];

  function renderOptions() {
    optionsContainer.innerHTML = '';
    if (!currentQuestion || !currentQuestion.options) return;

    const isClosed = currentQuestionStatus === 'closed';

    currentQuestion.options.forEach((optText, index) => {
      const optTa = (currentQuestion.optionsTa && currentQuestion.optionsTa[index]) || '';
      const isSelected = mySelectedOptionIndex === index;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = `option-btn ${isSelected ? 'selected' : ''}`;
      btn.disabled = isClosed;

      const letter = optionLetters[index] || (index + 1);

      btn.innerHTML = `
        <div class="option-letter">${letter}</div>
        <div class="option-text-group">
          <div class="option-text-label-en">${escapeHtml(optText)}</div>
          ${optTa ? `<div class="option-text-label-ta">${escapeHtml(optTa)}</div>` : ''}
        </div>
        <svg class="option-check" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="20 6 9 17 4 12"></polyline>
        </svg>
      `;

      btn.addEventListener('click', () => {
        if (isClosed) return;
        submitVote(index);
      });

      optionsContainer.appendChild(btn);
    });
  }

  function submitVote(optionIndex) {
    if (!selectedYearGroup) {
      openYearModal();
      return;
    }
    if (currentQuestionStatus !== 'live' || !currentQuestion) return;

    mySelectedOptionIndex = optionIndex;
    renderOptions();
    showVoteConfirmation();

    socket.emit('parent:vote', {
      voterToken,
      questionId: currentQuestion.id,
      optionIndex,
      yearGroup: selectedYearGroup
    });
  }

  function showVoteConfirmation() {
    if (currentQuestionStatus === 'live') {
      voteStatusBanner.className = 'vote-status-banner recorded';
      voteBannerText.textContent = 'Response recorded! You can tap another option to change.';
    } else {
      voteStatusBanner.className = 'vote-status-banner closed';
      voteBannerText.textContent = 'Poll closed. Your response was successfully logged.';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }
})();
