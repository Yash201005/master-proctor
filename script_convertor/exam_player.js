/**
 * ExamShield Client Testing Engine
 * Drives interactive MCQ test player with real-time question palette,
 * countdown clock, and script converter integration.
 */

(function () {
  'use strict';

  var state = {
    exam: null,
    currentIndex: 0,
    answers: {},            // questionId -> "A"|"B"|"C"|"D"
    markedReview: new Set(),// Set of questionId
    visited: new Set(),     // Set of questionId
    secondsRemaining: 30 * 60,
    timerInterval: null,
    isSubmitted: false
  };

  function $(id) { return document.getElementById(id); }

  // --- Network Ping Simulation ---
  function initNetworkPing() {
    setInterval(function () {
      var ping = Math.floor(35 + Math.random() * 30);
      var el = $('networkPingText');
      if (el) el.textContent = 'Network: Stable (' + ping + ' ms)';
    }, 4000);
  }

  // --- Timer ---
  function startTimer() {
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(function () {
      if (state.secondsRemaining <= 0) {
        clearInterval(state.timerInterval);
        alert('Time has expired! Submitting your examination.');
        submitExam();
        return;
      }
      state.secondsRemaining -= 1;
      updateTimerDisplay();
    }, 1000);
  }

  function updateTimerDisplay() {
    var m = Math.floor(state.secondsRemaining / 60);
    var s = state.secondsRemaining % 60;
    var str = (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    var el = $('examTimerText');
    if (el) el.textContent = str;
  }

  // --- Load Exam Paper ---
  function loadExam(examId) {
    var url = examId ? ('/api/convert/exam/' + examId) : '/api/convert/demo-exam';
    fetch(url)
      .then(function (res) {
        if (!res.ok) throw new Error('Could not load examination paper.');
        return res.json();
      })
      .then(function (data) {
        state.exam = data;
        state.currentIndex = 0;
        state.answers = {};
        state.markedReview.clear();
        state.visited.clear();
        state.isSubmitted = false;
        state.secondsRemaining = (data.duration_minutes || 30) * 60;

        $('examTitleHeader').textContent = data.title;
        $('examMainView').style.display = 'grid';
        $('resultsView').style.display = 'none';

        startTimer();
        renderCurrentQuestion();
        renderPalette();
      })
      .catch(function (err) {
        alert('Error loading exam: ' + err.message);
      });
  }

  // --- Render Question Viewport ---
  function renderCurrentQuestion() {
    if (!state.exam || !state.exam.questions || state.exam.questions.length === 0) return;
    
    var q = state.exam.questions[state.currentIndex];
    state.visited.add(q.id);

    $('questionNumTag').textContent = 'QUESTION ' + (state.currentIndex + 1) + ' OF ' + state.exam.questions.length;
    $('questionTitle').textContent = q.question;

    // Render 4 Options
    var optionsContainer = $('optionsList');
    optionsContainer.innerHTML = '';

    ['A', 'B', 'C', 'D'].forEach(function (letter) {
      var optText = q.options[letter] || '';
      var card = document.createElement('div');
      card.className = 'option-card' + (state.answers[q.id] === letter ? ' selected' : '');
      
      card.innerHTML = 
        '<div class="option-letter">' + letter + '</div>' +
        '<div class="option-text">' + optText + '</div>';

      card.onclick = function () {
        selectOption(q.id, letter);
      };

      optionsContainer.appendChild(card);
    });

    // Mark for review checkbox state
    $('chkMarkReview').checked = state.markedReview.has(q.id);

    // Navigation buttons state
    $('btnPrev').disabled = (state.currentIndex === 0);
    
    var isLast = (state.currentIndex === state.exam.questions.length - 1);
    if (isLast) {
      $('btnNext').textContent = 'Finish & Submit Exam';
      $('btnNext').className = 'btn-nav btn-submit-exam';
    } else {
      $('btnNext').innerHTML = '<span>Next</span> <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 12h14M12 5l7 7-7 7"/></svg>';
      $('btnNext').className = 'btn-nav btn-next';
    }

    renderPalette();
  }

  function selectOption(questionId, letter) {
    if (state.answers[questionId] === letter) {
      delete state.answers[questionId]; // Toggle deselect
    } else {
      state.answers[questionId] = letter;
    }
    renderCurrentQuestion();
  }

  // --- Render Question Palette ---
  function renderPalette() {
    if (!state.exam || !state.exam.questions) return;
    
    var grid = $('paletteGrid');
    grid.innerHTML = '';

    state.exam.questions.forEach(function (q, idx) {
      var btn = document.createElement('button');
      btn.type = 'button';
      btn.textContent = (idx + 1);

      var classes = ['palette-btn'];
      if (idx === state.currentIndex) {
        classes.push('current');
      }

      if (state.markedReview.has(q.id)) {
        classes.push('marked-review');
      } else if (state.answers[q.id]) {
        classes.push('answered');
      } else if (state.visited.has(q.id)) {
        classes.push('visited');
      } else {
        classes.push('not-visited');
      }

      btn.className = classes.join(' ');
      btn.onclick = function () {
        state.currentIndex = idx;
        renderCurrentQuestion();
      };

      grid.appendChild(btn);
    });
  }

  // --- Submit Exam ---
  function submitExam() {
    if (state.isSubmitted) return;
    if (!confirm('Are you sure you want to stop and submit your examination?')) return;

    state.isSubmitted = true;
    if (state.timerInterval) clearInterval(state.timerInterval);

    var totalTimeSpent = (state.exam.duration_minutes * 60) - state.secondsRemaining;

    fetch('/api/convert/exam/' + state.exam.id + '/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        answers: state.answers,
        time_spent_seconds: totalTimeSpent
      })
    })
      .then(function (res) { return res.json(); })
      .then(function (result) {
        showResults(result);
      })
      .catch(function (err) {
        alert('Submission error: ' + err.message);
      });
  }

  // --- Show Results View ---
  function showResults(data) {
    $('examMainView').style.display = 'none';
    $('resultsView').style.display = 'block';

    $('resScore').textContent = data.score + ' / ' + data.total;
    $('resPercentage').textContent = data.percentage + '%';
    
    var badge = $('resStatusBadge');
    if (data.passed) {
      badge.textContent = 'PASSED';
      badge.style.background = '#d1fae5';
      badge.style.color = '#065f46';
    } else {
      badge.textContent = 'NEEDS REVIEW';
      badge.style.background = '#fee2e2';
      badge.style.color = '#991b1b';
    }

    var reviewContainer = $('resultsReviewList');
    reviewContainer.innerHTML = '';

    (data.review || []).forEach(function (item) {
      var div = document.createElement('div');
      div.className = 'review-item ' + (item.is_correct ? 'correct' : 'incorrect');

      var html = '<div style="display:flex; justify-content:space-between; margin-bottom:8px;">' +
        '<strong>Question ' + item.number + '</strong>' +
        '<span style="font-size:0.8rem; font-weight:700; color:' + (item.is_correct ? '#059669' : '#dc2626') + '">' +
        (item.is_correct ? 'CORRECT' : 'INCORRECT') + '</span>' +
        '</div>';

      html += '<p style="margin-bottom:10px; font-weight:500;">' + item.question + '</p>';
      html += '<div style="font-size:0.88rem; margin-bottom:6px;">Your Answer: <strong>' + item.selected_answer + '</strong>' +
        (item.is_correct ? '' : (' | Correct Answer: <strong style="color:#059669">' + item.correct_answer + '</strong>')) +
        '</div>';

      if (item.explanation) {
        html += '<div style="font-size:0.82rem; background:#f8fafc; padding:8px 12px; border-radius:6px; margin-top:8px; color:#475569;">' +
          '<strong>Script Source (Page ' + (item.source_page || 'N/A') + '):</strong> ' + item.explanation + '</div>';
      }

      div.innerHTML = html;
      reviewContainer.appendChild(div);
    });

    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  // --- Script Upload / Generator Studio ---
  function initStudioModal() {
    $('btnOpenStudio').onclick = function () {
      $('studioModal').style.display = 'flex';
    };
    $('btnCloseStudio').onclick = function () {
      $('studioModal').style.display = 'none';
    };

    $('studioUploadForm').onsubmit = function (e) {
      e.preventDefault();
      var fileInput = $('scriptFileInput');
      var qCount = $('inputQCount').value || 10;
      var difficulty = $('selectDifficulty').value || 'Mixed';
      var customKey = ($('inputCustomKey').value || '').trim();

      var btn = $('btnGenerateStudio');
      btn.disabled = true;
      btn.textContent = 'Reading Script & Synthesizing MCQs (Gemini)...';

      if (fileInput.files.length > 0) {
        var formData = new FormData();
        formData.append('file', fileInput.files[0]);

        fetch('/api/convert/upload', {
          method: 'POST',
          body: formData
        })
          .then(function (res) { return res.json(); })
          .then(function (upData) {
            if (!upData.success) throw new Error(upData.error || 'Upload failed');
            return fetch('/api/convert/generate', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                doc_id: upData.doc_id,
                question_count: parseInt(qCount),
                difficulty: difficulty,
                api_key: customKey || undefined
              })
            });
          })
          .then(function (res) { return res.json(); })
          .then(function (genData) {
            btn.disabled = false;
            btn.textContent = 'Generate Exam Paper';
            $('studioModal').style.display = 'none';
            loadExam(genData.exam_id);
          })
          .catch(function (err) {
            btn.disabled = false;
            btn.textContent = 'Generate Exam Paper';
            alert('Generation error: ' + err.message);
          });
      } else {
        // Generate from current 25-page syllabus document
        fetch('/api/convert/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question_count: parseInt(qCount),
            difficulty: difficulty,
            api_key: customKey || undefined
          })
        })
          .then(function (res) { return res.json(); })
          .then(function (genData) {
            btn.disabled = false;
            btn.textContent = 'Generate Exam Paper';
            $('studioModal').style.display = 'none';
            loadExam(genData.exam_id);
          })
          .catch(function (err) {
            btn.disabled = false;
            btn.textContent = 'Generate Exam Paper';
            alert('Generation error: ' + err.message);
          });
      }
    };
  }

  // --- Event Bindings ---
  function initEvents() {
    $('btnNext').onclick = function () {
      if (state.currentIndex === state.exam.questions.length - 1) {
        submitExam();
      } else {
        state.currentIndex += 1;
        renderCurrentQuestion();
      }
    };

    $('btnPrev').onclick = function () {
      if (state.currentIndex > 0) {
        state.currentIndex -= 1;
        renderCurrentQuestion();
      }
    };

    $('chkMarkReview').onchange = function () {
      var q = state.exam.questions[state.currentIndex];
      if (this.checked) {
        state.markedReview.add(q.id);
      } else {
        state.markedReview.delete(q.id);
      }
      renderPalette();
    };

    $('btnStopExam').onclick = submitExam;

    $('btnRetakeExam').onclick = function () {
      loadExam(state.exam.id);
    };

    initNetworkPing();
    initStudioModal();
  }

  // --- Bootstrap ---
  document.addEventListener('DOMContentLoaded', function () {
    initEvents();
    // Load default demonstration exam
    loadExam();
  });

})();
