/**
 * Poll Point - Participant Mobile Client Logic
 * Modern, responsive, bilingual voting interface
 */

(function () {
  'use strict';

  // Elements
  const sessionHeaderTitle = document.getElementById('sessionHeaderTitle');
  const connectionStatus = document.getElementById('connectionStatus');
  const connectionText = document.getElementById('connectionText');
  const waitingState = document.getElementById('waitingState');
  const waitingSubtitle = document.getElementById('waitingSubtitle');
  const questionState = document.getElementById('questionState');
  const qStatusBadge = document.getElementById('qStatusBadge');
  const qStatusText = document.getElementById('qStatusText');
  const qIndexBadge = document.getElementById('qIndexBadge');
  const questionText = document.getElementById('questionText');
  const questionTextTa = document.getElementById('questionTextTa');
  const optionsContainer = document.getElementById('optionsContainer');
  const voteStatusBanner = document.getElementById('voteStatusBanner');

  // Voter State
  let voterToken = localStorage.getItem('pollpoint_voter_token');
  if (!voterToken) {
    voterToken = 'v_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
    localStorage.setItem('pollpoint_voter_token', voterToken);
  }

  let activeQuestion = null;
  let activeQuestionStatus = 'idle';
  let myVote = null;

  // Initialize Socket.io
  const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    timeout: 10000
  });

  // Socket Events
  socket.on('connect', () => {
    connectionStatus.style.background = '#ecfdf5';
    connectionStatus.style.color = '#059669';
    connectionText.textContent = 'Live';

    // Register with server
    socket.emit('participant:join', { voterToken });
  });

  socket.on('disconnect', () => {
    connectionStatus.style.background = '#fff1f2';
    connectionStatus.style.color = '#e11d48';
    connectionText.textContent = 'Reconnecting...';
  });

  socket.on('session:state', (data) => {
    if (!data) return;
    if (data.sessionTitleTa) {
      sessionHeaderTitle.textContent = data.sessionTitleTa;
    } else if (data.sessionTitle) {
      sessionHeaderTitle.textContent = data.sessionTitle;
    }

    activeQuestionStatus = data.questionStatus;
    myVote = data.myVote;

    if (data.currentQuestion && (activeQuestionStatus === 'live' || activeQuestionStatus === 'paused')) {
      showLiveQuestion(data.currentQuestion, myVote);
    } else {
      showWaitingScreen();
    }
  });

  socket.on('question:live', (q) => {
    activeQuestionStatus = 'live';
    // Check if we previously voted on this question
    const storedVote = localStorage.getItem('pollpoint_vote_' + q.id);
    const prevVote = storedVote !== null ? JSON.parse(storedVote) : null;
    showLiveQuestion(q, prevVote);
  });

  socket.on('question:paused', () => {
    activeQuestionStatus = 'paused';
    if (qStatusBadge && qStatusText) {
      qStatusBadge.className = 'status-badge draft';
      qStatusText.textContent = 'Poll Paused / தற்காலிகமாக நிறுத்தப்பட்டது';
    }
  });

  socket.on('question:closed', () => {
    activeQuestionStatus = 'closed';
    if (qStatusBadge && qStatusText) {
      qStatusBadge.className = 'status-badge closed';
      qStatusText.textContent = 'Poll Closed / வாக்கெடுப்பு முடிந்தது';
    }
  });

  socket.on('session:reset', () => {
    activeQuestion = null;
    activeQuestionStatus = 'idle';
    showWaitingScreen();
  });

  socket.on('session:ended', () => {
    activeQuestion = null;
    activeQuestionStatus = 'closed';
    showWaitingScreen('Thank you for participating! This live poll session has ended. / நேரலை வாக்கெடுப்பில் பங்கேற்றதற்கு நன்றி!');
  });

  socket.on('participant:vote_confirmed', (data) => {
    if (voteStatusBanner) {
      voteStatusBanner.classList.add('show');
    }
  });

  socket.on('participant:vote_error', (data) => {
    alert(data.message || 'Error recording vote');
  });

  // Render Waiting Screen
  function showWaitingScreen(customMessage) {
    waitingState.classList.add('active');
    questionState.classList.remove('active');
    if (customMessage && waitingSubtitle) {
      waitingSubtitle.textContent = customMessage;
    }
  }

  // Render Live Question
  function showLiveQuestion(q, currentVote) {
    activeQuestion = q;
    myVote = currentVote;

    waitingState.classList.remove('active');
    questionState.classList.add('active');

    // Status Badge
    if (qStatusBadge && qStatusText) {
      qStatusBadge.className = 'status-badge live';
      qStatusText.textContent = 'Live Poll • நேரலை';
    }

    // Prompts
    questionText.textContent = q.text || '';
    if (q.textTa && q.textTa.trim()) {
      questionTextTa.textContent = q.textTa;
      questionTextTa.style.display = 'block';
    } else {
      questionTextTa.style.display = 'none';
    }

    // Render Options Container
    renderOptions(q, currentVote);

    // Confirmation Banner
    if (currentVote !== null && currentVote !== undefined) {
      voteStatusBanner.classList.add('show');
    } else {
      voteStatusBanner.classList.remove('show');
    }
  }

  function renderOptions(q, currentVote) {
    optionsContainer.innerHTML = '';
    const type = q.type || 'multiple_choice';

    if (type === 'short_answer') {
      const box = document.createElement('div');
      box.className = 'short-answer-box';
      box.innerHTML = `
        <textarea class="short-answer-textarea" id="shortAnswerInput" placeholder="Type your response here / உங்கள் பதிலை இங்கே உள்ளிடுங்கள்...">${typeof currentVote === 'string' ? escapeHtml(currentVote) : ''}</textarea>
        <button type="button" class="btn-submit-answer" id="btnSubmitShortAnswer">
          <span>Submit Response</span>
          <span class="sub-ta">பதிலை சமர்ப்பிக்கவும்</span>
        </button>
      `;

      box.querySelector('#btnSubmitShortAnswer').addEventListener('click', () => {
        const text = box.querySelector('#shortAnswerInput').value.trim();
        if (!text) {
          alert('Please enter your response / உங்கள் பதிலை உள்ளிடவும்');
          return;
        }
        submitVote(q.id, null, text);
      });

      optionsContainer.appendChild(box);
      return;
    }

    if (type === 'yes_no') {
      const grid = document.createElement('div');
      grid.className = 'yes-no-grid';

      const yesBtn = createOptionButton(0, 'Yes', 'ஆம்', currentVote === 0, 'btn-yes');
      const noBtn = createOptionButton(1, 'No', 'இல்லை', currentVote === 1, 'btn-no');

      grid.appendChild(yesBtn);
      grid.appendChild(noBtn);
      optionsContainer.appendChild(grid);
      return;
    }

    if (type === 'rating') {
      const list = document.createElement('div');
      list.className = 'rating-grid';

      const ratingLabelsEn = ['1 Star - Poor', '2 Stars - Fair', '3 Stars - Good', '4 Stars - Very Good', '5 Stars - Outstanding'];
      const ratingLabelsTa = ['1 - குறைவு', '2 - சுமாரானது', '3 - நல்லது', '4 - மிக நன்று', '5 - மிகச் சிறப்பானது'];

      for (let i = 0; i < 5; i++) {
        const btn = createOptionButton(i, ratingLabelsEn[i], ratingLabelsTa[i], currentVote === i, '');
        list.appendChild(btn);
      }

      optionsContainer.appendChild(list);
      return;
    }

    // Default: Multiple Choice
    const options = q.options || [];
    const optionsTa = q.optionsTa || [];

    options.forEach((opt, idx) => {
      const optTa = optionsTa[idx] || '';
      const isSelected = currentVote === idx;
      const btn = createOptionButton(idx, opt, optTa, isSelected, '');
      optionsContainer.appendChild(btn);
    });
  }

  function createOptionButton(index, textEn, textTa, isSelected, extraClass) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `option-btn ${extraClass} ${isSelected ? 'selected' : ''}`;
    const letter = String.fromCharCode(65 + index);

    btn.innerHTML = `
      <span class="opt-badge">${letter}</span>
      <div class="opt-labels">
        <span class="opt-text-en">${escapeHtml(textEn)}</span>
        ${textTa ? `<span class="opt-text-ta ta-text">${escapeHtml(textTa)}</span>` : ''}
      </div>
    `;

    btn.addEventListener('click', () => {
      if (activeQuestionStatus !== 'live') {
        alert('Voting is currently not live for this question / இந்த கேள்விக்கான வாக்கெடுப்பு இப்போது நேரலையில் இல்லை');
        return;
      }
      submitVote(activeQuestion.id, index, null);
    });

    return btn;
  }

  function submitVote(questionId, optionIndex, textAnswer) {
    myVote = optionIndex !== null ? optionIndex : textAnswer;

    // Update UI highlights
    const allBtns = optionsContainer.querySelectorAll('.option-btn');
    allBtns.forEach((b, idx) => {
      b.classList.toggle('selected', idx === optionIndex);
    });

    // Save vote locally to prevent duplicate votes
    localStorage.setItem('pollpoint_vote_' + questionId, JSON.stringify(myVote));

    // Emit to server
    socket.emit('participant:vote', {
      voterToken,
      questionId,
      optionIndex,
      textAnswer
    });

    // Show confirmation banner
    if (voteStatusBanner) {
      voteStatusBanner.classList.add('show');
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

})();
