// ==========================================================================
// CSBS Parent–Teacher Meeting - Admin Application Controller
// Professional College Management Application
// ==========================================================================

(function() {
  'use strict';

  // Application State
  let state = {
    settings: {},
    currentMeeting: null,
    attendance: { total: 0, yearBreakdown: {} },
    progress: { questionsCompleted: 0, totalQuestions: 0, totalResponses: 0, overallParticipation: 0 },
    tallies: null,
    questions: [],
    history: [],
    joinUrl: '',
    qrDataUrl: '',
    previewQuestionId: null,
    activeYearFilter: 'All Years',
    ctrlCohortFilter: 'All Years',
    builderPreviewIndex: 0,
    mobilePreviewSelectedOption: null
  };

  // Socket Connection
  const socket = io({
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000
  });

  // DOM Elements - Router & Nav
  const navLinks = {
    dashboard: document.getElementById('navDashboard'),
    meetings: document.getElementById('navMeetings'),
    questions: document.getElementById('navQuestions'),
    reports: document.getElementById('navReports'),
    settings: document.getElementById('navSettings')
  };

  const views = {
    dashboard: document.getElementById('viewDashboard'),
    newMeeting: document.getElementById('viewNewMeeting'),
    meetingControl: document.getElementById('viewMeetingControl'),
    questions: document.getElementById('viewQuestions'),
    results: document.getElementById('viewResults'),
    attendance: document.getElementById('viewAttendance'),
    qr: document.getElementById('viewQr'),
    meetings: document.getElementById('viewMeetings'),
    reports: document.getElementById('viewReports'),
    export: document.getElementById('viewExport'),
    settings: document.getElementById('viewSettings')
  };

  // -------------------------------------------------------------
  // Router Logic (Hash-based)
  // -------------------------------------------------------------
  function handleRoute() {
    const rawHash = window.location.hash.slice(1) || 'dashboard';
    const [route] = rawHash.split('/');

    // Hide all views
    Object.values(views).forEach(view => {
      if (view) view.classList.remove('active');
    });

    // Reset active nav
    Object.values(navLinks).forEach(link => {
      if (link) link.classList.remove('active');
    });

    // Map route to view
    switch (route) {
      case 'new-meeting':
        if (views.newMeeting) views.newMeeting.classList.add('active');
        prepareNewMeetingForm();
        break;

      case 'meeting-control':
        if (views.meetingControl) views.meetingControl.classList.add('active');
        renderMeetingControl();
        break;

      case 'questions':
        if (views.questions) views.questions.classList.add('active');
        if (navLinks.questions) navLinks.questions.classList.add('active');
        renderQuestionsBank();
        break;

      case 'results':
        if (views.results) views.results.classList.add('active');
        renderResultsPage();
        break;

      case 'attendance':
        if (views.attendance) views.attendance.classList.add('active');
        renderAttendancePage();
        break;

      case 'qr':
        if (views.qr) views.qr.classList.add('active');
        renderQrPage();
        break;

      case 'meetings':
        if (views.meetings) views.meetings.classList.add('active');
        if (navLinks.meetings) navLinks.meetings.classList.add('active');
        renderArchivesPage();
        break;

      case 'reports':
        if (views.reports) views.reports.classList.add('active');
        if (navLinks.reports) navLinks.reports.classList.add('active');
        renderReportsSummary();
        break;

      case 'export':
        if (views.export) views.export.classList.add('active');
        break;

      case 'settings':
        if (views.settings) views.settings.classList.add('active');
        if (navLinks.settings) navLinks.settings.classList.add('active');
        populateSettingsForm();
        break;

      case 'dashboard':
      default:
        if (views.dashboard) views.dashboard.classList.add('active');
        if (navLinks.dashboard) navLinks.dashboard.classList.add('active');
        renderDashboard();
        break;
    }

    window.scrollTo(0, 0);
  }

  window.addEventListener('hashchange', handleRoute);

  // -------------------------------------------------------------
  // Socket.io Events
  // -------------------------------------------------------------
  socket.on('connect', () => {
    socket.emit('admin:join');
  });

  socket.on('admin:init', (data) => {
    state.settings = data.settings || {};
    state.questions = data.questions || [];
    state.joinUrl = data.joinUrl || '';
    state.history = data.historySummaries || [];
    if (data.stats) {
      applyAdminStats(data.stats);
    }
    fetchInfoAndQr();
    handleRoute();
  });

  socket.on('meeting:state_changed', (stats) => {
    applyAdminStats(stats);
    updateCurrentView();
  });

  socket.on('poll:update', (data) => {
    state.tallies = data.tallies;
    if (data.stats) applyAdminStats(data.stats);
    updateCurrentView();
  });

  socket.on('attendance:update', (att) => {
    state.attendance = att;
    updateCurrentView();
  });

  socket.on('questions:updated', (qs) => {
    state.questions = qs;
    if (views.questions.classList.contains('active')) renderQuestionsBank();
    if (views.newMeeting.classList.contains('active')) prepareNewMeetingForm();
    if (views.meetingControl.classList.contains('active')) renderMeetingControl();
  });

  socket.on('settings:updated', (s) => {
    state.settings = s;
    if (views.settings.classList.contains('active')) populateSettingsForm();
  });

  socket.on('admin:history_updated', (hist) => {
    state.history = hist;
    if (views.dashboard.classList.contains('active')) renderRecentMeetingsList();
    if (views.meetings.classList.contains('active')) renderArchivesPage();
  });

  function applyAdminStats(stats) {
    if (!stats) return;
    state.currentMeeting = stats.meeting;
    state.attendance = stats.attendance || state.attendance;
    state.progress = stats.progress || state.progress;
    if (stats.tallies) state.tallies = stats.tallies;
    if (!state.previewQuestionId && state.currentMeeting?.currentQuestionId) {
      state.previewQuestionId = state.currentMeeting.currentQuestionId;
    }
  }

  function updateCurrentView() {
    const rawHash = window.location.hash.slice(1) || 'dashboard';
    const [route] = rawHash.split('/');

    if (route === 'dashboard') renderDashboard();
    else if (route === 'meeting-control') renderMeetingControl();
    else if (route === 'results') renderResultsPage();
    else if (route === 'attendance') renderAttendancePage();
    else if (route === 'reports') renderReportsSummary();
  }

  async function fetchInfoAndQr() {
    try {
      const res = await fetch('/api/info');
      const data = await res.json();
      state.joinUrl = data.joinUrl;
      state.qrDataUrl = data.qrDataUrl;
      const qrImg = document.getElementById('qrCodeImage');
      if (qrImg) qrImg.src = data.qrDataUrl;
      const urlText = document.getElementById('qrJoinUrlText');
      if (urlText) urlText.textContent = data.joinUrl;
      const ctrlThumb = document.getElementById('ctrlQrThumbnail');
      if (ctrlThumb) ctrlThumb.src = data.qrDataUrl;
      const ctrlUrl = document.getElementById('ctrlQrJoinUrl');
      if (ctrlUrl) ctrlUrl.textContent = data.joinUrl;
    } catch (e) {
      console.error('Failed to load QR info:', e);
    }
  }

  // -------------------------------------------------------------
  // View 1: Dashboard Rendering (No Questions displayed)
  // -------------------------------------------------------------
  function renderDashboard() {
    const m = state.currentMeeting;
    const dashMeetingTitle = document.getElementById('dashMeetingTitle');
    const dashMeetingStatusBadge = document.getElementById('dashMeetingStatusBadge');

    if (m && dashMeetingTitle) {
      dashMeetingTitle.textContent = m.title || 'Parent–Teacher Meeting';
      if (dashMeetingStatusBadge) {
        dashMeetingStatusBadge.className = `status-badge ${getStatusBadgeClass(m.status)}`;
        dashMeetingStatusBadge.textContent = formatStatusLabel(m.status);
      }
    }

    // Parents Joined Overview
    const totalParents = state.attendance.total || 0;
    const yearCounts = state.attendance.yearBreakdown || {};
    document.getElementById('dashTotalParents').textContent = totalParents;
    document.getElementById('dashYear1').textContent = yearCounts['1st Year'] || 0;
    document.getElementById('dashYear2').textContent = yearCounts['2nd Year'] || 0;
    document.getElementById('dashYear3').textContent = yearCounts['3rd Year'] || 0;
    document.getElementById('dashYear4').textContent = yearCounts['Final Year'] || 0;

    // Meeting Progress
    const prog = state.progress;
    document.getElementById('dashQuestionsProgress').textContent =
      `${prog.questionsCompleted || 0} / ${prog.totalQuestions || 0} completed`;
    document.getElementById('dashResponsesCount').textContent =
      `${prog.totalResponses || 0} responses`;
    document.getElementById('dashParticipationPct').textContent =
      `${prog.overallParticipation || 0}%`;

    renderRecentMeetingsList();
  }

  function renderRecentMeetingsList() {
    const tbody = document.getElementById('dashRecentMeetingsList');
    if (!tbody) return;

    if (!state.history || state.history.length === 0) {
      tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 24px;">No archived meetings yet.</td></tr>`;
      return;
    }

    tbody.innerHTML = state.history.map(m => `
      <tr>
        <td class="cell-main">${escapeHtml(m.title)}</td>
        <td>${escapeHtml(m.date || m.archivedAt?.slice(0, 10) || '-')}</td>
        <td>${m.questionsCount || 0}</td>
        <td>${m.totalParents || 0}</td>
        <td>${m.participationRate || 0}%</td>
        <td><span class="status-badge completed">ARCHIVED</span></td>
        <td>
          <a href="#results" class="btn btn-secondary btn-sm" onclick="window.loadHistoricalResults('${m.id}')">Results</a>
        </td>
      </tr>
    `).join('');
  }

  // Dashboard Button Listeners
  document.getElementById('dashBtnOpenMeeting')?.addEventListener('click', () => {
    window.location.hash = '#meeting-control';
  });

  document.getElementById('dashBtnViewQr')?.addEventListener('click', () => {
    window.location.hash = '#qr';
  });

  // -------------------------------------------------------------
  // View 2: Create New Meeting
  // -------------------------------------------------------------
  function prepareNewMeetingForm() {
    const dateInput = document.getElementById('newMeetingDate');
    if (dateInput && !dateInput.value) {
      dateInput.value = new Date().toISOString().slice(0, 10);
    }

    const container = document.getElementById('newMeetingQuestionsList');
    if (!container) return;

    container.innerHTML = state.questions.map((q, idx) => `
      <label class="checkbox-item" style="padding: 6px 0; border-bottom: 1px solid var(--border);">
        <input type="checkbox" name="selectedQuestion" value="${q.id}" checked>
        <div>
          <span class="checkbox-title">Q${idx + 1}: ${escapeHtml(q.text)}</span>
        </div>
      </label>
    `).join('');

    const successCard = document.getElementById('newMeetingSuccessCard');
    if (successCard) successCard.style.display = 'none';
  }

  document.getElementById('formCreateMeeting')?.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = document.getElementById('newMeetingTitle').value.trim();
    const academicYear = document.getElementById('newAcademicYear').value.trim();
    const date = document.getElementById('newMeetingDate').value;
    const description = document.getElementById('newMeetingDesc').value.trim();

    const checkboxes = document.querySelectorAll('input[name="selectedQuestion"]:checked');
    const questionIds = Array.from(checkboxes).map(cb => cb.value);

    socket.emit('admin:create_meeting', {
      title,
      academicYear,
      date,
      description,
      questionIds
    });

    const successCard = document.getElementById('newMeetingSuccessCard');
    if (successCard) successCard.style.display = 'block';
  });

  document.getElementById('btnSuccessOpenMeeting')?.addEventListener('click', () => {
    window.location.hash = '#meeting-control';
  });

  document.getElementById('btnSuccessViewQr')?.addEventListener('click', () => {
    window.location.hash = '#qr';
  });

  // -------------------------------------------------------------
  // View 3: Meeting Control Page
  // -------------------------------------------------------------
  function renderMeetingControl() {
    const m = state.currentMeeting;
    if (!m) return;

    // Header info
    document.getElementById('ctrlMeetingTitle').textContent = m.title;
    document.getElementById('ctrlMeetingSubtitle').textContent =
      `Academic Year: ${m.academicYear || '2026'} • Date: ${m.date || ''}`;

    const badge = document.getElementById('ctrlStatusBadge');
    badge.className = `status-badge ${getStatusBadgeClass(m.status)}`;
    badge.textContent = formatStatusLabel(m.status);

    // Attendance breakdown
    const yearCounts = state.attendance.yearBreakdown || {};
    document.getElementById('ctrlAttendanceTotal').textContent = state.attendance.total || 0;
    document.getElementById('ctrlYear1').textContent = yearCounts['1st Year'] || 0;
    document.getElementById('ctrlYear2').textContent = yearCounts['2nd Year'] || 0;
    document.getElementById('ctrlYear3').textContent = yearCounts['3rd Year'] || 0;
    document.getElementById('ctrlYear4').textContent = yearCounts['Final Year'] || 0;

    // Agenda List
    const agendaList = document.getElementById('ctrlAgendaList');
    if (agendaList) {
      agendaList.innerHTML = state.questions.map((q, idx) => {
        const isSelected = q.id === state.previewQuestionId;
        const isLive = m.currentQuestionId === q.id && m.questionStatus === 'live';
        return `
          <button type="button" class="btn btn-secondary btn-sm" style="justify-content: space-between; width: 100%; text-align: left; ${isSelected ? 'border-color: var(--primary); background: var(--primary-subtle); color: var(--primary); font-weight: 700;' : ''}" onclick="window.selectPreviewQuestion('${q.id}')">
            <span>Q${idx + 1}: ${escapeHtml(q.text.slice(0, 32))}...</span>
            ${isLive ? '<span class="status-badge live" style="font-size: 0.68rem; padding: 2px 6px;">LIVE</span>' : ''}
          </button>
        `;
      }).join('');
    }

    // Preview Question Display
    const previewQ = state.questions.find(q => q.id === state.previewQuestionId) || state.questions[0];
    if (previewQ) {
      const idx = state.questions.findIndex(q => q.id === previewQ.id);
      document.getElementById('ctrlQuestionIndexTag').textContent = `Question ${idx + 1} of ${state.questions.length}`;

      const qStatusBadge = document.getElementById('ctrlQuestionStatusBadge');
      const isLive = m.currentQuestionId === previewQ.id && m.questionStatus === 'live';
      const isClosed = m.currentQuestionId === previewQ.id && m.questionStatus === 'closed';

      if (isLive) {
        qStatusBadge.className = 'status-badge live';
        qStatusText(qStatusBadge, 'LIVE');
        document.getElementById('ctrlBtnLaunchQ').style.display = 'none';
        document.getElementById('ctrlBtnCloseQ').style.display = 'inline-flex';
      } else if (isClosed) {
        qStatusBadge.className = 'status-badge closed';
        qStatusText(qStatusBadge, 'CLOSED');
        document.getElementById('ctrlBtnLaunchQ').style.display = 'inline-flex';
        document.getElementById('ctrlBtnCloseQ').style.display = 'none';
      } else {
        qStatusBadge.className = 'status-badge draft';
        qStatusText(qStatusBadge, 'READY TO LAUNCH');
        document.getElementById('ctrlBtnLaunchQ').style.display = 'inline-flex';
        document.getElementById('ctrlBtnCloseQ').style.display = 'none';
      }

      document.getElementById('ctrlQuestionTextEn').textContent = previewQ.text;
      const taEl = document.getElementById('ctrlQuestionTextTa');
      if (previewQ.textTa && state.settings.showTamilTranslation !== false) {
        taEl.textContent = previewQ.textTa;
        taEl.style.display = 'block';
      } else {
        taEl.style.display = 'none';
      }

      // Cohort filter pills
      const filterBtns = document.querySelectorAll('#ctrlCohortFilterPills .ctrl-filter-btn');
      filterBtns.forEach(btn => {
        const yr = btn.getAttribute('data-year');
        btn.classList.toggle('active', yr === (state.ctrlCohortFilter || 'All Years'));
        btn.onclick = () => {
          state.ctrlCohortFilter = yr;
          filterBtns.forEach(b => b.classList.toggle('active', b.getAttribute('data-year') === yr));
          renderBreakdownBars(previewQ);
        };
      });

      // Breakdown bars
      renderBreakdownBars(previewQ);
    }
  }

  function qStatusText(el, text) {
    el.innerHTML = `<span class="badge-dot"></span>${text}`;
  }

  function renderBreakdownBars(question) {
    const list = document.getElementById('ctrlBreakdownList');
    if (!list) return;

    const filterYear = state.ctrlCohortFilter || 'All Years';
    const tallies = (state.tallies && state.tallies.questionId === question.id) ? state.tallies : null;
    const isAll = filterYear === 'All Years';

    const totalVotes = isAll
      ? (tallies ? tallies.totalVotes : 0)
      : (tallies?.yearTotals?.[filterYear] || 0);

    const totalAudience = isAll
      ? (state.attendance.total || 0)
      : (state.attendance.yearBreakdown?.[filterYear] || 0);

    const pct = totalAudience > 0 ? Math.round((totalVotes / totalAudience) * 100) : 0;

    const statLabel = isAll
      ? `${totalVotes} Votes Cast (${pct}% participation)`
      : `${filterYear}: ${totalVotes} Votes (${pct}% participation)`;

    document.getElementById('ctrlLiveResponsesStat').textContent = statLabel;

    const options = question.options || [];
    const optionsTa = question.optionsTa || [];

    list.innerHTML = options.map((opt, idx) => {
      const optTa = (state.settings.showTamilTranslation !== false && optionsTa[idx]) ? optionsTa[idx] : '';
      const votesCount = tallies?.breakdown?.[filterYear]?.[idx] || 0;
      const optPct = totalVotes > 0 ? ((votesCount / totalVotes) * 100).toFixed(1) : '0.0';
      const letter = ['A', 'B', 'C', 'D'][idx] || (idx + 1);

      return `
        <div class="breakdown-bar-item">
          <div class="bar-label-row">
            <span class="bar-opt-text">
              <strong style="color: var(--primary); font-size: 1rem;">${letter}.</strong>
              <span style="font-weight: 700; color: var(--text-primary); margin-left: 4px;">${escapeHtml(opt)}</span>
              ${optTa ? `<span style="font-family: 'Noto Sans Tamil'; color: var(--text-muted); font-size: 0.88rem; margin-left: 8px;">(${escapeHtml(optTa)})</span>` : ''}
            </span>
            <span class="bar-opt-stat" style="font-weight: 800; color: var(--text-primary); font-size: 0.95rem;">
              ${votesCount} votes <span style="color: var(--primary);">(${optPct}%)</span>
            </span>
          </div>
          <div class="bar-track">
            <div class="bar-fill" style="width: ${optPct}%;"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  window.selectPreviewQuestion = function(qId) {
    state.previewQuestionId = qId;
    socket.emit('admin:navigate_preview', { questionId: qId });
    renderMeetingControl();
  };

  // Meeting Control Actions
  document.getElementById('ctrlBtnStartMeeting')?.addEventListener('click', () => {
    socket.emit('admin:start_meeting');
  });

  document.getElementById('ctrlBtnEditQuestions')?.addEventListener('click', () => {
    window.location.hash = '#questions';
  });

  document.getElementById('ctrlBtnViewQr')?.addEventListener('click', () => {
    window.location.hash = '#qr';
  });

  document.getElementById('ctrlBtnAttendance')?.addEventListener('click', () => {
    window.location.hash = '#attendance';
  });

  document.getElementById('ctrlBtnResults')?.addEventListener('click', () => {
    window.location.hash = '#results';
  });

  document.getElementById('ctrlBtnEndMeeting')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to end this meeting? A final report snapshot will be archived.')) {
      socket.emit('admin:end_meeting');
    }
  });

  // Question navigation buttons
  document.getElementById('ctrlBtnPrevQ')?.addEventListener('click', () => {
    const curIdx = state.questions.findIndex(q => q.id === state.previewQuestionId);
    if (curIdx > 0) {
      window.selectPreviewQuestion(state.questions[curIdx - 1].id);
    }
  });

  document.getElementById('ctrlBtnNextQ')?.addEventListener('click', () => {
    const curIdx = state.questions.findIndex(q => q.id === state.previewQuestionId);
    if (curIdx < state.questions.length - 1) {
      window.selectPreviewQuestion(state.questions[curIdx + 1].id);
    }
  });

  // Launch Question: Explicitly launches to parents
  document.getElementById('ctrlBtnLaunchQ')?.addEventListener('click', () => {
    if (!state.previewQuestionId) return;
    socket.emit('admin:launch_question', { questionId: state.previewQuestionId });
  });

  // Close Question
  document.getElementById('ctrlBtnCloseQ')?.addEventListener('click', () => {
    socket.emit('admin:close_question');
  });

  // Reset Question
  document.getElementById('ctrlBtnResetQ')?.addEventListener('click', () => {
    document.getElementById('resetConfirmModal')?.classList.remove('hidden');
  });

  document.getElementById('btnCloseResetConfirm')?.addEventListener('click', () => {
    document.getElementById('resetConfirmModal')?.classList.add('hidden');
  });

  document.getElementById('btnCancelResetConfirm')?.addEventListener('click', () => {
    document.getElementById('resetConfirmModal')?.classList.add('hidden');
  });

  document.getElementById('btnConfirmResetOperation')?.addEventListener('click', () => {
    if (state.previewQuestionId) {
      socket.emit('admin:reset_question', { questionId: state.previewQuestionId });
    }
    document.getElementById('resetConfirmModal')?.classList.add('hidden');
  });

  // -------------------------------------------------------------
  // View 4: Questions Management & Setup Builder
  // -------------------------------------------------------------
  function renderQuestionsBank() {
    const list = document.getElementById('questionsBankList');
    if (!list) return;

    // Update count pill
    const countPill = document.getElementById('builderQuestionsCount');
    if (countPill) {
      countPill.textContent = `${state.questions.length} Questions Configured`;
    }

    // Student year visibility & privacy toggle
    const toggleYear = document.getElementById('toggleShowYearToParents');
    const labelStatus = document.getElementById('labelShowYearStatus');
    if (toggleYear && labelStatus) {
      const isVisible = state.settings.requireYearSelection !== false;
      toggleYear.checked = isVisible;
      labelStatus.textContent = isVisible ? 'Cohort Visible to Parents' : 'Fully Anonymized Mode';

      toggleYear.onchange = async () => {
        const val = toggleYear.checked;
        state.settings.requireYearSelection = val;
        labelStatus.textContent = val ? 'Cohort Visible to Parents' : 'Fully Anonymized Mode';
        renderLiveMobilePreview();
        try {
          await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requireYearSelection: val })
          });
        } catch (e) {
          console.error(e);
        }
      };
    }

    if (!state.questions || state.questions.length === 0) {
      list.innerHTML = `
        <div class="empty-state-card" style="text-align: center; padding: 48px 24px; background: var(--surface); border: 1px dashed var(--border); border-radius: var(--radius-lg);">
          <div style="font-size: 2.2rem; margin-bottom: 10px;">📋</div>
          <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin-bottom: 6px;">No Questions Configured</h3>
          <p style="font-size: 0.9rem; color: var(--text-muted); margin-bottom: 18px;">Create questions for parents before starting the meeting.</p>
          <button class="btn btn-primary" onclick="document.getElementById('btnOpenAddQuestionModal').click()">+ Add First Question</button>
        </div>
      `;
      renderLiveMobilePreview();
      return;
    }

    // Clamp preview index
    if (state.builderPreviewIndex >= state.questions.length) {
      state.builderPreviewIndex = state.questions.length - 1;
    }
    if (state.builderPreviewIndex < 0) {
      state.builderPreviewIndex = 0;
    }

    list.innerHTML = state.questions.map((q, idx) => {
      const isSelected = idx === state.builderPreviewIndex;
      const isFirst = idx === 0;
      const isLast = idx === state.questions.length - 1;

      return `
        <div class="builder-q-card ${isSelected ? 'selected-for-preview' : ''}" data-index="${idx}" onclick="window.setBuilderPreview(${idx})">
          <div class="builder-q-top">
            <div style="display: flex; align-items: center; gap: 8px;">
              <span class="builder-q-num">Q${idx + 1}</span>
              ${isSelected ? '<span class="status-badge live" style="font-size: 0.72rem; padding: 2px 8px;">PREVIEWING</span>' : '<span class="status-badge draft" style="font-size: 0.72rem; padding: 2px 8px;">READY</span>'}
            </div>
            <div class="builder-reorder-group" onclick="event.stopPropagation()">
              <button type="button" class="btn-reorder" title="Move Up" ${isFirst ? 'disabled' : ''} onclick="window.moveQuestionUp(${idx})">↑</button>
              <button type="button" class="btn-reorder" title="Move Down" ${isLast ? 'disabled' : ''} onclick="window.moveQuestionDown(${idx})">↓</button>
            </div>
          </div>

          <div class="builder-q-en">${escapeHtml(q.text)}</div>
          ${q.textTa ? `<div class="builder-q-ta">${escapeHtml(q.textTa)}</div>` : ''}

          <div class="builder-options-grid">
            ${(q.options || []).map((opt, i) => {
              const optTa = q.optionsTa?.[i] || '';
              return `
                <div class="builder-opt-pill">
                  <span class="builder-opt-letter">${['A', 'B', 'C', 'D'][i] || (i + 1)}</span>
                  <div class="builder-opt-texts">
                    <span class="builder-opt-en">${escapeHtml(opt)}</span>
                    ${optTa ? `<span class="builder-opt-ta">${escapeHtml(optTa)}</span>` : ''}
                  </div>
                </div>
              `;
            }).join('')}
          </div>

          <div class="builder-q-actions" onclick="event.stopPropagation()">
            <button type="button" class="btn btn-secondary btn-sm" onclick="window.editQuestion('${q.id}')">✏️ Edit</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="window.duplicateQuestion('${q.id}')">📋 Duplicate</button>
            <button type="button" class="btn btn-danger btn-sm" onclick="window.deleteQuestion('${q.id}')">🗑️ Delete</button>
            <button type="button" class="btn btn-secondary btn-sm" onclick="window.setBuilderPreview(${idx})">👁️ Preview</button>
          </div>
        </div>
      `;
    }).join('');

    renderLiveMobilePreview();
  }

  // Render Synchronized Live Parent Mobile Preview
  function renderLiveMobilePreview() {
    const viewport = document.getElementById('previewPhoneViewport');
    if (!viewport) return;

    const q = state.questions[state.builderPreviewIndex] || state.questions[0];
    if (!q) {
      viewport.innerHTML = `
        <div style="padding: 40px 20px; text-align: center; color: var(--text-muted);">
          <div style="font-size: 2.2rem; margin-bottom: 8px;">📱</div>
          <div style="font-weight: 700; color: var(--text-primary);">No Question Selected</div>
          <div style="font-size: 0.85rem; margin-top: 4px;">Add or select a question to see live mobile preview</div>
        </div>
      `;
      return;
    }

    const showYear = state.settings.requireYearSelection !== false;
    const currentIdx = state.builderPreviewIndex;
    const totalCount = state.questions.length;
    const selectedOpt = state.mobilePreviewSelectedOption;

    viewport.innerHTML = `
      <div class="preview-phone-header">
        <div>
          <div class="preview-brand-title">CSBS Parent–Teacher Meeting</div>
          <div class="preview-dept-sub">Dept. of Computer Science & Business Systems</div>
        </div>
        <div class="preview-live-indicator">
          <span class="preview-dot"></span> Live
        </div>
      </div>

      ${showYear ? `
        <div class="preview-year-banner">
          <span>Student Year:</span>
          <span class="preview-year-tag">1st Year</span>
        </div>
      ` : ''}

      <div class="preview-poll-card">
        <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 6px;">
          <div class="preview-progress-label">Question ${currentIdx + 1} of ${totalCount}</div>
          <div class="preview-status-pill">● Polling Active</div>
        </div>

        <div class="preview-question-en">${escapeHtml(q.text)}</div>
        ${q.textTa ? `<div class="preview-question-ta">${escapeHtml(q.textTa)}</div>` : ''}

        ${selectedOpt !== null ? `
          <div class="preview-vote-banner">
            <span>✓ Response recorded! Tap another option to update.</span>
          </div>
        ` : ''}

        <div class="preview-options-container">
          ${(q.options || []).map((opt, i) => {
            const optTa = q.optionsTa?.[i] || '';
            const isOptSelected = selectedOpt === i;
            const letter = ['A', 'B', 'C', 'D'][i] || (i + 1);

            return `
              <div class="preview-mock-opt ${isOptSelected ? 'selected' : ''}" onclick="window.selectMobilePreviewOption(${i})">
                <div class="preview-mock-letter">${letter}</div>
                <div class="preview-mock-labels">
                  <div class="preview-mock-en">${escapeHtml(opt)}</div>
                  ${optTa ? `<div class="preview-mock-ta">${escapeHtml(optTa)}</div>` : ''}
                </div>
                ${isOptSelected ? '<span class="preview-mock-check">✓</span>' : ''}
              </div>
            `;
          }).join('')}
        </div>

        <button type="button" class="preview-mock-submit" ${selectedOpt === null ? 'disabled' : ''}>
          ${selectedOpt !== null ? 'Update Answer' : 'Submit & Continue'}
        </button>
      </div>
    `;
  }

  window.setBuilderPreview = function(idx) {
    state.builderPreviewIndex = idx;
    state.mobilePreviewSelectedOption = null;
    const cards = document.querySelectorAll('.builder-q-card');
    cards.forEach((c, i) => c.classList.toggle('selected-for-preview', i === idx));
    renderLiveMobilePreview();
  };

  window.selectMobilePreviewOption = function(optIndex) {
    state.mobilePreviewSelectedOption = optIndex;
    renderLiveMobilePreview();
  };

  window.moveQuestionUp = async function(idx) {
    if (idx <= 0 || idx >= state.questions.length) return;
    const item = state.questions[idx];
    state.questions.splice(idx, 1);
    state.questions.splice(idx - 1, 0, item);
    state.builderPreviewIndex = idx - 1;

    renderQuestionsBank();
    await saveQuestionOrder();
  };

  window.moveQuestionDown = async function(idx) {
    if (idx < 0 || idx >= state.questions.length - 1) return;
    const item = state.questions[idx];
    state.questions.splice(idx, 1);
    state.questions.splice(idx + 1, 0, item);
    state.builderPreviewIndex = idx + 1;

    renderQuestionsBank();
    await saveQuestionOrder();
  };

  async function saveQuestionOrder() {
    const questionIds = state.questions.map(q => q.id);
    try {
      await fetch('/api/questions/reorder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ questionIds })
      });
      socket.emit('admin:reorder_questions', { questionIds });
    } catch (e) {
      console.error('Failed to save question reorder:', e);
    }
  }

  // "Finish & Start Meeting" action
  document.getElementById('btnFinishAndStartMeeting')?.addEventListener('click', () => {
    if (!state.questions || state.questions.length === 0) {
      alert('Please add at least 1 question with at least 2 options before starting the meeting.');
      return;
    }
    const invalidQ = state.questions.find(q => !q.text || !q.options || q.options.filter(Boolean).length < 2);
    if (invalidQ) {
      alert('Every question must have question text and at least 2 answer options.');
      return;
    }

    socket.emit('admin:start_meeting');
    window.location.hash = '#meeting-control';
  });

  // Mobile preview toggle for small screens
  document.getElementById('btnToggleMobilePreviewPane')?.addEventListener('click', () => {
    const pane = document.getElementById('builderPreviewColumn');
    if (!pane) return;
    const isHidden = window.getComputedStyle(pane).display === 'none';
    pane.style.display = isHidden ? 'block' : 'none';
  });

  // Question Modal Handling & Autosave
  const qModal = document.getElementById('questionEditorModal');

  // Live Sync & Autosave draft setup
  function setupQuestionEditorLiveSync() {
    const enInput = document.getElementById('editQuestionEn');
    const taInput = document.getElementById('editQuestionTa');
    const optA = document.getElementById('editOptAEn');
    const optATa = document.getElementById('editOptATa');
    const optB = document.getElementById('editOptBEn');
    const optBTa = document.getElementById('editOptBTa');
    const optC = document.getElementById('editOptCEn');
    const optCTa = document.getElementById('editOptCTa');
    const optD = document.getElementById('editOptDEn');
    const optDTa = document.getElementById('editOptDTa');

    const inputs = [enInput, taInput, optA, optATa, optB, optBTa, optC, optCTa, optD, optDTa];

    inputs.forEach(inp => {
      inp?.addEventListener('input', () => {
        // Live preview sync
        const currentQ = state.questions[state.builderPreviewIndex];
        if (currentQ) {
          if (enInput.value) currentQ.text = enInput.value;
          currentQ.textTa = taInput.value;
          if (optA.value) currentQ.options[0] = optA.value;
          if (optB.value) currentQ.options[1] = optB.value;
          if (optC.value) currentQ.options[2] = optC.value;
          if (optD.value) currentQ.options[3] = optD.value;
          if (!currentQ.optionsTa) currentQ.optionsTa = [];
          currentQ.optionsTa[0] = optATa.value;
          currentQ.optionsTa[1] = optBTa.value;
          currentQ.optionsTa[2] = optCTa.value;
          currentQ.optionsTa[3] = optDTa.value;
          renderLiveMobilePreview();
        }

        // Save draft to localStorage
        const draft = {
          qId: document.getElementById('editQuestionId').value,
          text: enInput.value,
          textTa: taInput.value,
          optA: optA.value,
          optATa: optATa.value,
          optB: optB.value,
          optBTa: optBTa.value,
          optC: optC.value,
          optCTa: optCTa.value,
          optD: optD.value,
          optDTa: optDTa.value
        };
        localStorage.setItem('pollpoint_draft_question', JSON.stringify(draft));
      });
    });
  }

  setupQuestionEditorLiveSync();

  document.getElementById('btnOpenAddQuestionModal')?.addEventListener('click', () => {
    document.getElementById('questionEditorTitle').textContent = 'Add Question';
    document.getElementById('editQuestionId').value = '';
    document.getElementById('formQuestionEditor').reset();

    // Check for draft autosave
    const savedDraft = localStorage.getItem('pollpoint_draft_question');
    if (savedDraft) {
      try {
        const d = JSON.parse(savedDraft);
        if (d && !d.qId) {
          document.getElementById('editQuestionEn').value = d.text || '';
          document.getElementById('editQuestionTa').value = d.textTa || '';
          document.getElementById('editOptAEn').value = d.optA || '';
          document.getElementById('editOptATa').value = d.optATa || '';
          document.getElementById('editOptBEn').value = d.optB || '';
          document.getElementById('editOptBTa').value = d.optBTa || '';
          document.getElementById('editOptCEn').value = d.optC || '';
          document.getElementById('editOptCTa').value = d.optCTa || '';
          document.getElementById('editOptDEn').value = d.optD || '';
          document.getElementById('editOptDTa').value = d.optDTa || '';
        }
      } catch (e) {}
    }

    qModal.classList.remove('hidden');
  });

  document.getElementById('btnCloseQuestionEditor')?.addEventListener('click', () => {
    qModal.classList.add('hidden');
  });

  document.getElementById('btnCancelQuestionEditor')?.addEventListener('click', () => {
    qModal.classList.add('hidden');
  });

  window.editQuestion = function(qId) {
    const q = state.questions.find(item => item.id === qId);
    if (!q) return;

    const qIdx = state.questions.findIndex(item => item.id === qId);
    if (qIdx >= 0) window.setBuilderPreview(qIdx);

    document.getElementById('questionEditorTitle').textContent = 'Edit Question';
    document.getElementById('editQuestionId').value = q.id;
    document.getElementById('editQuestionEn').value = q.text || '';
    document.getElementById('editQuestionTa').value = q.textTa || '';

    document.getElementById('editOptAEn').value = q.options[0] || '';
    document.getElementById('editOptATa').value = q.optionsTa?.[0] || '';
    document.getElementById('editOptBEn').value = q.options[1] || '';
    document.getElementById('editOptBTa').value = q.optionsTa?.[1] || '';
    document.getElementById('editOptCEn').value = q.options[2] || '';
    document.getElementById('editOptCTa').value = q.optionsTa?.[2] || '';
    document.getElementById('editOptDEn').value = q.options[3] || '';
    document.getElementById('editOptDTa').value = q.optionsTa?.[3] || '';

    qModal.classList.remove('hidden');
  };

  window.duplicateQuestion = async function(qId) {
    const q = state.questions.find(item => item.id === qId);
    if (!q) return;

    const payload = {
      text: q.text + ' (Copy)',
      textTa: q.textTa ? q.textTa + ' (நகல்)' : '',
      options: [...q.options],
      optionsTa: [...(q.optionsTa || [])]
    };

    try {
      await fetch('/api/questions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
    } catch (e) {
      console.error(e);
    }
  };

  window.deleteQuestion = async function(qId) {
    if (!confirm('Are you sure you want to delete this question?')) return;
    try {
      await fetch(`/api/questions/${qId}`, { method: 'DELETE' });
    } catch (e) {
      console.error(e);
    }
  };

  document.getElementById('btnSaveQuestionEditor')?.addEventListener('click', async () => {
    const qId = document.getElementById('editQuestionId').value;
    const text = document.getElementById('editQuestionEn').value.trim();
    const textTa = document.getElementById('editQuestionTa').value.trim();

    const options = [
      document.getElementById('editOptAEn').value.trim(),
      document.getElementById('editOptBEn').value.trim(),
      document.getElementById('editOptCEn').value.trim(),
      document.getElementById('editOptDEn').value.trim()
    ].filter(Boolean);

    const optionsTa = [
      document.getElementById('editOptATa').value.trim(),
      document.getElementById('editOptBTa').value.trim(),
      document.getElementById('editOptCTa').value.trim(),
      document.getElementById('editOptDTa').value.trim()
    ];

    if (!text) {
      alert('Please provide the question text.');
      return;
    }
    if (options.length < 2) {
      alert('Please provide at least 2 answer options (e.g. Option A and Option B).');
      return;
    }

    try {
      if (qId) {
        await fetch(`/api/questions/${qId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, textTa, options, optionsTa })
        });
      } else {
        await fetch('/api/questions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, textTa, options, optionsTa })
        });
      }

      // Clear draft on successful save
      localStorage.removeItem('pollpoint_draft_question');
      qModal.classList.add('hidden');
    } catch (e) {
      console.error(e);
      alert('Failed to save question. Please try again.');
    }
  });

  // -------------------------------------------------------------
  // View 5: Results & Analysis (Categorized By Year)
  // -------------------------------------------------------------
  function renderResultsPage() {
    // Overall Stats
    const totalAudience = state.attendance.total || 0;
    const totalResponses = state.progress.totalResponses || 0;
    const totalExpected = totalAudience * (state.questions.length || 1);
    const overallPct = totalExpected > 0 ? Math.min(100, Math.round((totalResponses / totalExpected) * 100)) : 0;

    document.getElementById('resultsOverallStat').textContent = `${totalResponses} / ${totalExpected} (${overallPct}%)`;

    // Render questions list with breakdown for active year filter
    const container = document.getElementById('resultsQuestionsContainer');
    if (!container) return;

    container.innerHTML = state.questions.map((q, qIndex) => {
      return renderSingleQuestionResultCard(q, qIndex, state.activeYearFilter);
    }).join('');

    // Setup Year Filter buttons
    document.querySelectorAll('.year-filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.getAttribute('data-year') === state.activeYearFilter);
      btn.onclick = () => {
        state.activeYearFilter = btn.getAttribute('data-year');
        renderResultsPage();
      };
    });
  }

  function renderSingleQuestionResultCard(q, qIndex, selectedYear) {
    const isFiltered = selectedYear !== 'All Years';
    const yearGroups = ['1st Year', '2nd Year', '3rd Year', 'Final Year'];

    return `
      <div class="result-question-card">
        <div style="font-size: 0.85rem; font-weight: 700; color: var(--primary); text-transform: uppercase;">
          Question ${qIndex + 1}
        </div>
        <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-primary); margin: 4px 0 8px 0;">
          ${escapeHtml(q.text)}
        </h3>
        ${q.textTa ? `<div style="color: var(--text-muted); font-family: 'Noto Sans Tamil'; font-size: 0.95rem; margin-bottom: 16px;">${escapeHtml(q.textTa)}</div>` : ''}

        <!-- Primary Filtered View or All Years Grid -->
        ${!isFiltered ? `
          <div class="year-breakdown-grid">
            ${yearGroups.map(yg => `
              <div class="year-col-card">
                <div class="year-col-title">${yg}</div>
                ${renderYearDistributionLines(q, yg)}
              </div>
            `).join('')}
          </div>
        ` : `
          <div style="background: var(--bg-page); border: 1px solid var(--border); border-radius: var(--radius-md); padding: 16px;">
            <div style="font-weight: 700; margin-bottom: 12px; color: var(--primary);">${selectedYear} Distribution</div>
            ${renderYearDistributionLines(q, selectedYear)}
          </div>
        `}
      </div>
    `;
  }

  function renderYearDistributionLines(question, yearGroup) {
    // Check if we have tallies for this question
    const tallies = (state.tallies && state.tallies.questionId === question.id) ? state.tallies : null;
    const yearTotal = tallies?.yearTotals?.[yearGroup] || 0;
    const counts = tallies?.breakdown?.[yearGroup] || [];

    return question.options.map((opt, i) => {
      const count = counts[i] || 0;
      const pct = yearTotal > 0 ? ((count / yearTotal) * 100).toFixed(0) : '0';
      const letter = ['A', 'B', 'C', 'D'][i] || (i + 1);

      return `
        <div style="margin-bottom: 8px;">
          <div style="display: flex; justify-content: space-between; font-size: 0.82rem; margin-bottom: 2px;">
            <span><strong>${letter}.</strong> ${escapeHtml(opt.slice(0, 24))}</span>
            <span style="font-weight: 700;">${pct}% (${count})</span>
          </div>
          <div class="bar-track" style="height: 6px;">
            <div class="bar-fill" style="width: ${pct}%;"></div>
          </div>
        </div>
      `;
    }).join('');
  }

  // -------------------------------------------------------------
  // View 6: Attendance Screen
  // -------------------------------------------------------------
  function renderAttendancePage() {
    const total = state.attendance.total || 0;
    const yearCounts = state.attendance.yearBreakdown || {};

    document.getElementById('attTotalPill').textContent = `${total} Total`;
    document.getElementById('attYear1').textContent = yearCounts['1st Year'] || 0;
    document.getElementById('attYear2').textContent = yearCounts['2nd Year'] || 0;
    document.getElementById('attYear3').textContent = yearCounts['3rd Year'] || 0;
    document.getElementById('attYear4').textContent = yearCounts['Final Year'] || 0;
  }

  // -------------------------------------------------------------
  // View 7: Dedicated QR Page
  // -------------------------------------------------------------
  function renderQrPage() {
    document.getElementById('qrPageMeetingTitle').textContent = state.currentMeeting?.title || 'Parent–Teacher Meeting';
    const qrImg = document.getElementById('qrCodeImage');
    if (qrImg && state.qrDataUrl) qrImg.src = state.qrDataUrl;
    const urlText = document.getElementById('qrJoinUrlText');
    if (urlText) urlText.textContent = state.joinUrl;
  }

  document.getElementById('btnCopyJoinLink')?.addEventListener('click', () => {
    navigator.clipboard.writeText(state.joinUrl).then(() => alert('Join URL copied to clipboard!'));
  });

  document.getElementById('btnDownloadQr')?.addEventListener('click', () => {
    if (!state.qrDataUrl) return;
    const a = document.createElement('a');
    a.href = state.qrDataUrl;
    a.download = `CSBS_PTM_QR_${Date.now()}.png`;
    a.click();
  });

  document.getElementById('btnFullscreenQr')?.addEventListener('click', () => {
    const elem = document.getElementById('viewQr');
    if (elem.requestFullscreen) elem.requestFullscreen();
  });

  // -------------------------------------------------------------
  // View 8: Meeting Archives
  // -------------------------------------------------------------
  async function renderArchivesPage() {
    const tbody = document.getElementById('archivesTableBody');
    if (!tbody) return;

    try {
      const res = await fetch('/api/meetings/history');
      const archives = await res.json();
      state.history = archives;

      if (archives.length === 0) {
        tbody.innerHTML = `<tr><td colspan="7" style="text-align: center; color: var(--text-muted); padding: 30px;">No historical meetings found.</td></tr>`;
        return;
      }

      tbody.innerHTML = archives.map(m => `
        <tr>
          <td class="cell-main">${escapeHtml(m.title)}</td>
          <td>${escapeHtml(m.date || m.archivedAt?.slice(0, 10) || '-')}</td>
          <td>${m.questionsCount || 0}</td>
          <td>${m.totalParents || 0}</td>
          <td>${m.participationRate || 0}%</td>
          <td><span class="status-badge completed">${m.status || 'COMPLETED'}</span></td>
          <td>
            <div style="display: flex; gap: 6px;">
              <a href="#results" class="btn btn-secondary btn-sm" onclick="window.loadHistoricalResults('${m.id}')">Results</a>
              <a href="/api/export/csv" class="btn btn-secondary btn-sm">Export</a>
              <button class="btn btn-danger btn-sm" onclick="window.deleteHistoricalMeeting('${m.id}')">Delete</button>
            </div>
          </td>
        </tr>
      `).join('');
    } catch (e) {
      console.error(e);
    }
  }

  window.deleteHistoricalMeeting = async function(id) {
    if (!confirm('Are you sure you want to permanently delete this archived meeting record?')) return;
    try {
      await fetch(`/api/meetings/history/${id}`, { method: 'DELETE' });
      renderArchivesPage();
    } catch (e) {
      console.error(e);
    }
  };

  // -------------------------------------------------------------
  // View 9: Reports & Summary View
  // -------------------------------------------------------------
  async function renderReportsSummary() {
    const container = document.getElementById('summaryReportView');
    if (!container) return;

    try {
      const res = await fetch('/api/session/summary');
      const data = await res.json();

      document.getElementById('summaryHeaderTitle').textContent = `${data.meetingTitle} Summary Report`;

      container.innerHTML = `
        <div class="metrics-row" style="margin-bottom: 24px;">
          <div class="metric-card">
            <span class="metric-title">Total Parents</span>
            <div class="metric-total-pill">${data.totalParents}</div>
          </div>
          <div class="metric-card">
            <span class="metric-title">Total Questions</span>
            <div class="metric-total-pill">${data.totalQuestions}</div>
          </div>
          <div class="metric-card">
            <span class="metric-title">Participation Rate</span>
            <div class="metric-total-pill">${data.participationRate}%</div>
          </div>
        </div>

        <div class="recent-meetings-card" style="margin-bottom: 24px;">
          <h3 class="card-heading">Year Distribution</h3>
          <div class="metrics-row" style="margin-top: 14px;">
            <div class="stat-item-row"><span class="stat-item-label">1st Year</span><span class="stat-item-val">${data.yearBreakdown['1st Year'] || 0}</span></div>
            <div class="stat-item-row"><span class="stat-item-label">2nd Year</span><span class="stat-item-val">${data.yearBreakdown['2nd Year'] || 0}</span></div>
            <div class="stat-item-row"><span class="stat-item-label">3rd Year</span><span class="stat-item-val">${data.yearBreakdown['3rd Year'] || 0}</span></div>
            <div class="stat-item-row"><span class="stat-item-label">Final Year</span><span class="stat-item-val">${data.yearBreakdown['Final Year'] || 0}</span></div>
          </div>
        </div>

        <div class="recent-meetings-card">
          <h3 class="card-heading" style="margin-bottom: 16px;">Question Summaries</h3>
          ${(data.results || []).map((r, i) => `
            <div style="padding: 14px 0; border-bottom: 1px solid var(--border);">
              <div style="font-weight: 700; color: var(--text-primary);">Q${i + 1}: ${escapeHtml(r.questionText)}</div>
              <div style="font-size: 0.82rem; color: var(--text-muted); margin-top: 2px;">Total Votes: ${r.totalVotes} (${r.participationRate}% Participation)</div>
            </div>
          `).join('')}
        </div>
      `;
    } catch (e) {
      console.error(e);
    }
  }

  document.getElementById('btnPrintSummary')?.addEventListener('click', () => {
    window.print();
  });

  // -------------------------------------------------------------
  // View 10: Export View
  // -------------------------------------------------------------
  document.getElementById('btnExportResponsesCsv')?.addEventListener('click', () => {
    window.location.href = '/api/export/csv';
  });

  document.getElementById('btnExportAttendanceCsv')?.addEventListener('click', () => {
    window.location.href = '/api/export/attendance/csv';
  });

  document.getElementById('btnExportResponsesExcel')?.addEventListener('click', () => {
    window.location.href = '/api/export/csv';
  });

  document.getElementById('btnExportAttendanceExcel')?.addEventListener('click', () => {
    window.location.href = '/api/export/attendance/csv';
  });

  // -------------------------------------------------------------
  // View 11: Settings Page
  // -------------------------------------------------------------
  function populateSettingsForm() {
    const s = state.settings;
    if (!s) return;

    setVal('setMeetingTitle', s.defaultMeetingTitle || 'Parent–Teacher Meeting');
    setVal('setAcademicYear', s.academicYear || '2026');
    setVal('setDeptName', s.departmentName || 'Department of Computer Science and Business Systems');
    setVal('setDefaultLanguage', s.defaultLanguage || 'Bilingual');
    setVal('setDuration', s.meetingDuration || '60');

    setCheck('setAllowAnswerChanges', s.allowAnswerChanges !== false);
    setCheck('setShowTamilTranslation', s.showTamilTranslation !== false);
    setCheck('setShowProgressIndicator', s.showProgressIndicator !== false);
    setCheck('setRequireYearSelection', s.requireYearSelection !== false);
    setCheck('setShowConfirmation', s.showConfirmation !== false);
  }

  document.getElementById('formSettings')?.addEventListener('submit', async (e) => {
    e.preventDefault();

    const payload = {
      defaultMeetingTitle: getVal('setMeetingTitle'),
      academicYear: getVal('setAcademicYear'),
      departmentName: getVal('setDeptName'),
      defaultLanguage: getVal('setDefaultLanguage'),
      meetingDuration: getVal('setDuration'),
      allowAnswerChanges: getCheck('setAllowAnswerChanges'),
      showTamilTranslation: getCheck('setShowTamilTranslation'),
      showProgressIndicator: getCheck('setShowProgressIndicator'),
      requireYearSelection: getCheck('setRequireYearSelection'),
      showConfirmation: getCheck('setShowConfirmation')
    };

    try {
      const res = await fetch('/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      state.settings = data.settings;
      alert('Settings saved successfully!');
    } catch (err) {
      console.error(err);
      alert('Failed to save settings.');
    }
  });

  document.getElementById('btnHeaderSettings')?.addEventListener('click', () => {
    window.location.hash = '#settings';
  });

  // Helpers
  function setVal(id, v) {
    const el = document.getElementById(id);
    if (el) el.value = v;
  }
  function getVal(id) {
    const el = document.getElementById(id);
    return el ? el.value.trim() : '';
  }
  function setCheck(id, v) {
    const el = document.getElementById(id);
    if (el) el.checked = Boolean(v);
  }
  function getCheck(id) {
    const el = document.getElementById(id);
    return el ? el.checked : false;
  }

  function formatStatusLabel(status) {
    switch (status) {
      case 'DRAFT': return 'Draft';
      case 'WAITING_FOR_PARENTS': return 'Waiting for Parents';
      case 'READY': return 'Ready';
      case 'QUESTION_LIVE': return 'Live';
      case 'QUESTION_CLOSED': return 'Question Closed';
      case 'COMPLETED': return 'Completed';
      default: return status || 'Setup';
    }
  }

  function getStatusBadgeClass(status) {
    switch (status) {
      case 'DRAFT': return 'draft';
      case 'WAITING_FOR_PARENTS': return 'waiting';
      case 'READY': return 'draft';
      case 'QUESTION_LIVE': return 'live';
      case 'QUESTION_CLOSED': return 'closed';
      case 'COMPLETED': return 'completed';
      default: return 'draft';
    }
  }

  function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // Initial Route setup
  handleRoute();
})();
