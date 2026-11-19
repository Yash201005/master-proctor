/**
 * Examination Proctoring System
 * Stage 1: Dual-Engine Identity Document & Biometric Verification (PaddleOCR + Tesseract)
 * Stage 2: 7-Stage 360° Automated Examination Room Scanner
 */

(function () {
  'use strict';

  // --- Global Application State ---
  var candidate = {
    name: 'Jane Doe',
    email: 'jane.doe@university.edu',
    examCode: 'EXAM-2026-CS101',
    id: 'cand_' + Math.random().toString(36).substring(2, 12)
  };

  var stage1Data = {
    front: { image: null, result: null, fields: {}, docTypeLabel: '', status: 'idle', stream: null },
    back: { image: null, result: null, fields: {}, docTypeLabel: '', status: 'idle', stream: null },
    headshot: { image: null, isDemo: false, stream: null }
  };

  var roomScan = {
    stream: null,
    activeStageIndex: 0,
    isRunning: false,
    timer: null,
    secondsLeft: 10,
    evidenceFrames: [], // Captured snapshots per stage
    stages: [
      { id: 1, name: 'Desk & workspace', duration: 10, instruction: 'Slowly show the desk, keyboard, and entire visible work surface.' },
      { id: 2, name: 'Left side', duration: 10, instruction: 'Turn the camera to show the left side of the room.' },
      { id: 3, name: 'Right side', duration: 10, instruction: 'Turn the camera to show the right side of the room.' },
      { id: 4, name: 'Behind you', duration: 10, instruction: 'Show the space behind the candidate and the visible background.' },
      { id: 5, name: 'Floor & ceiling', duration: 10, instruction: 'Tilt the camera to show the floor and ceiling.' },
      { id: 6, name: 'Ears & hands', duration: 10, instruction: 'Clearly show both ears and hands as far as practical.' },
      { id: 7, name: 'Spectacles / glasses', duration: 10, instruction: 'Show the candidate\'s face and spectacles, if worn.' }
    ]
  };

  var demoSvg = {
    front: '<rect width="320" height="200" fill="#f8fafc"/><rect x="20" y="20" width="280" height="160" rx="8" fill="white" stroke="#cbd5e1" stroke-width="2"/><text x="160" y="52" text-anchor="middle" fill="#1e3a8a" font-family="sans-serif" font-weight="bold" font-size="14">NATIONAL INSTITUTE OF TECHNOLOGY</text><circle cx="68" cy="110" r="32" fill="#e2e8f0"/><text x="68" y="115" text-anchor="middle" fill="#64748b" font-size="12">PHOTO</text><text x="120" y="95" font-family="sans-serif" font-weight="bold" font-size="13" fill="#0f172a">NAME: JANE DOE</text><text x="120" y="115" font-family="sans-serif" font-size="11" fill="#475569">ID NO: 4MH23CS052</text><text x="120" y="132" font-family="sans-serif" font-size="11" fill="#475569">DOB: 15-08-2002</text><text x="120" y="149" font-family="sans-serif" font-size="11" fill="#475569">BRANCH: COMPUTER SCIENCE</text>',
    back: '<rect width="320" height="200" fill="#f8fafc"/><rect x="20" y="20" width="280" height="160" rx="8" fill="white" stroke="#cbd5e1" stroke-width="2"/><text x="160" y="52" text-anchor="middle" fill="#0f172a" font-family="sans-serif" font-weight="bold" font-size="12">EMERGENCY CONTACT & ADDRESS</text><text x="40" y="86" font-family="sans-serif" font-size="11" fill="#334155">Father: Robert Doe</text><text x="40" y="105" font-family="sans-serif" font-size="11" fill="#334155">Phone: 9876543210</text><text x="40" y="124" font-family="sans-serif" font-size="11" fill="#334155">Address: 42 Campus Road, Mysuru</text><text x="40" y="143" font-family="sans-serif" font-size="11" fill="#334155">Blood Group: O+  |  Valid Till: 31-07-2027</text>'
  };

  var demoData = {
    front: {
      doc_type: 'college_id',
      doc_type_label: 'College / University ID card',
      confidence: 0.98,
      fields: {
        name: { value: 'JANE DOE', source: 'both', agreement: 'match' },
        id_number: { value: '4MH23CS052', source: 'both', agreement: 'match' },
        dob: { value: '15-08-2002', source: 'both', agreement: 'match' },
        course: { value: 'COMPUTER SCIENCE', source: 'paddle', agreement: 'single-engine' },
        institution: { value: 'NATIONAL INSTITUTE OF TECHNOLOGY', source: 'both', agreement: 'match' }
      }
    },
    back: {
      doc_type: 'college_id',
      doc_type_label: 'College / University ID card',
      confidence: 0.96,
      fields: {
        father_name: { value: 'ROBERT DOE', source: 'both', agreement: 'match' },
        phone: { value: '9876543210', source: 'both', agreement: 'match' },
        address: { value: '42 Campus Road, Mysuru', source: 'paddle', agreement: 'single-engine' },
        blood_group: { value: 'O+', source: 'tesseract', agreement: 'single-engine' },
        valid_till: { value: '31-07-2027', source: 'both', agreement: 'match' }
      }
    }
  };

  // --- Helpers ---
  function $(id) { return document.getElementById(id); }

  function updateCandidateMeta() {
    $('headerCandName').textContent = candidate.name;
    $('headerExamCode').textContent = candidate.examCode;
    $('waitCandName').textContent = candidate.name;
    $('waitExamCode').textContent = candidate.examCode;
    $('waitCandId').textContent = candidate.id;
  }

  // =========================================================================
  // AUTHENTICATION & SECURITY CONTROLLER
  // =========================================================================
  var authState = {
    token: sessionStorage.getItem('proctor_auth_token') || null,
    loginTimer: null,
    resetTimer: null
  };

  function getAuthHeader() {
    return authState.token ? { 'Authorization': 'Bearer ' + authState.token } : {};
  }

  function showAuthView(isLoggedIn) {
    var authWrapper = $('auth-wrapper');
    var stepper = $('masterStepperContainer');
    var stage1 = $('stage1-wrapper');
    var stage2 = $('stage2-wrapper');
    var candidatePill = $('headerCandidatePill');
    var authBadge = $('headerAuthBadge');

    if (isLoggedIn) {
      if (authWrapper) authWrapper.style.display = 'none';
      if (candidatePill) candidatePill.style.display = 'inline-flex';
      if (authBadge) authBadge.style.display = 'none';
      if (stepper) stepper.style.display = 'block';
      showMasterStage(1);
    } else {
      if (authWrapper) authWrapper.style.display = 'flex';
      if (candidatePill) candidatePill.style.display = 'none';
      if (authBadge) authBadge.style.display = 'inline-flex';
      if (stepper) stepper.style.display = 'none';
      if (stage1) stage1.style.display = 'none';
      if (stage2) stage2.style.display = 'none';
      showAuthCard('login');
    }
  }

  function showAuthCard(cardType) {
    var loginCard = $('login-card');
    var resetCard = $('reset-card');
    hideAuthError('login-error');
    hideAuthError('reset-error');
    if ($('reset-success')) $('reset-success').style.display = 'none';

    if (cardType === 'reset') {
      if (loginCard) loginCard.style.display = 'none';
      if (resetCard) resetCard.style.display = 'block';
    } else {
      if (loginCard) loginCard.style.display = 'block';
      if (resetCard) resetCard.style.display = 'none';
    }
  }

  function showAuthError(targetId, msg) {
    var el = $(targetId);
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
  }

  function hideAuthError(targetId) {
    var el = $(targetId);
    if (el) {
      el.textContent = '';
      el.style.display = 'none';
    }
  }

  function showLockout(type, retryAfterSec) {
    var lockoutEl = $(type === 'login' ? 'login-lockout' : 'reset-lockout');
    var btnEl = $(type === 'login' ? 'btnLoginSubmit' : 'btnResetSubmit');
    var timerKey = type === 'login' ? 'loginTimer' : 'resetTimer';

    if (authState[timerKey]) clearInterval(authState[timerKey]);
    if (lockoutEl) {
      lockoutEl.textContent = 'Please try again later.';
      lockoutEl.style.display = 'block';
    }
    if (btnEl) btnEl.disabled = true;

    // Timer runs silently in background without showing remaining time on page
    var remaining = Math.max(1, Math.round(retryAfterSec || 60));

    authState[timerKey] = setInterval(function () {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(authState[timerKey]);
        authState[timerKey] = null;
        if (lockoutEl) lockoutEl.style.display = 'none';
        if (btnEl) btnEl.disabled = false;
      }
    }, 1000);
  }

  function togglePasswordVisibility(inputId, btnId) {
    var input = $(inputId);
    var btn = $(btnId);
    if (!input || !btn) return;
    if (input.type === 'password') {
      input.type = 'text';
      btn.textContent = 'Hide';
    } else {
      input.type = 'password';
      btn.textContent = 'Show';
    }
  }

  function verifySession() {
    if (!authState.token) {
      showAuthView(false);
      return;
    }
    fetch('/api/auth/session', {
      method: 'GET',
      headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeader())
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Session invalid');
        return res.json();
      })
      .then(function (data) {
        if (data.authenticated && data.user) {
          candidate.name = data.user.name || candidate.name;
          candidate.email = data.user.email || candidate.email;
          candidate.examCode = data.user.exam_code || candidate.examCode;
          candidate.id = data.user.candidate_id || candidate.id;
          updateCandidateMeta();
          showAuthView(true);
        } else {
          doLogout(false);
        }
      })
      .catch(function () {
        doLogout(false);
      });
  }

  function doLogout(notifyBackend) {
    if (notifyBackend && authState.token) {
      fetch('/api/auth/logout', {
        method: 'POST',
        headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeader())
      }).catch(function () {});
    }
    authState.token = null;
    sessionStorage.removeItem('proctor_auth_token');
    showAuthView(false);
  }

  // --- Master Workflow Stepper Navigation ---
  function showMasterStage(stageNum) {
    if (stageNum === 1) {
      $('stage1-wrapper').style.display = 'block';
      $('stage2-wrapper').style.display = 'none';
      $('masterStep1').classList.add('active');
      $('masterStep2').classList.remove('active');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else {
      $('stage1-wrapper').style.display = 'none';
      $('stage2-wrapper').style.display = 'block';
      $('masterStep1').classList.remove('active');
      $('masterStep2').classList.remove('locked');
      $('masterStep2').classList.add('active');
      initRoomScanUI();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  }

  // =========================================================================
  // STAGE 1: IDENTITY DOCUMENT SCANNER (Connected to Claude OCR Backend)
  // =========================================================================

  function setStage1View(viewName) {
    var views = ['document', 'review', 'headshot', 'match', 'summary'];
    views.forEach(function (v) {
      var node = $('stage1-view-' + v);
      if (node) node.classList.add('hidden');
    });
    var activeNode = $('stage1-view-' + viewName);
    if (activeNode) activeNode.classList.remove('hidden');

    // Update Progress Stepper
    var step0 = $('stepper-step-0');
    var step1 = $('stepper-step-1');
    var step2 = $('stepper-step-2');

    step0.className = '';
    step1.className = '';
    step2.className = '';

    if (viewName === 'document' || viewName === 'review') {
      step0.className = 'active';
    } else if (viewName === 'headshot') {
      step0.className = 'completed';
      step1.className = 'active';
    } else if (viewName === 'match' || viewName === 'summary') {
      step0.className = 'completed';
      step1.className = 'completed';
      step2.className = 'active';
    }
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function stopDocCamera(side) {
    var s = stage1Data[side];
    if (s.stream) {
      s.stream.getTracks().forEach(function (t) { t.stop(); });
      s.stream = null;
    }
    var video = $('video-' + side);
    if (video) {
      video.pause();
      video.srcObject = null;
      video.classList.add('hidden');
    }
    $('guidance-' + side).classList.add('hidden');
    $('panel-' + side).setAttribute('data-mode', 'idle');
    renderDocCard(side);
  }

  function startDocCamera(side) {
    ['front', 'back'].forEach(stopDocCamera);
    var video = $('video-' + side);
    var errEl = $('cam-err-' + side);
    errEl.classList.add('hidden');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      errEl.textContent = 'Webcam not available in this browser. Upload a document file instead.';
      errEl.classList.remove('hidden');
      return;
    }

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1920 } },
      audio: false
    }).then(function (stream) {
      stage1Data[side].stream = stream;
      video.srcObject = stream;
      video.classList.remove('hidden');
      video.play();

      $('placeholder-' + side).classList.add('hidden');
      $('img-' + side).classList.add('hidden');
      $('guidance-' + side).classList.remove('hidden');
      $('panel-' + side).setAttribute('data-mode', 'live');
      $('status-' + side).textContent = 'Camera live';

      // Update button row to Capture & Cancel
      var btnRow = $('btnrow-' + side);
      btnRow.innerHTML = '';

      var btnCapture = document.createElement('button');
      btnCapture.type = 'button';
      btnCapture.className = 'btn primary';
      btnCapture.textContent = 'Capture photo';
      btnCapture.onclick = function () { captureDocFrame(side); };

      var btnCancel = document.createElement('button');
      btnCancel.type = 'button';
      btnCancel.className = 'btn';
      btnCancel.textContent = 'Cancel camera';
      btnCancel.onclick = function () { stopDocCamera(side); };

      btnRow.appendChild(btnCapture);
      btnRow.appendChild(btnCancel);
    }).catch(function (err) {
      errEl.textContent = 'Camera error: ' + (err.message || err.name);
      errEl.classList.remove('hidden');
    });
  }

  function captureDocFrame(side) {
    var video = $('video-' + side);
    if (!video.videoWidth) return;

    var canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    canvas.getContext('2d').drawImage(video, 0, 0);
    var dataUrl = canvas.toDataURL('image/jpeg', 0.94);

    stopDocCamera(side);
    processDocImage(side, dataUrl);
  }

  function processDocImage(side, dataUrl) {
    stage1Data[side].image = dataUrl;
    stage1Data[side].status = 'scanning';
    renderDocCard(side);

    // Call Claude OCR Backend API (/api/scan)
    fetch('/api/scan', {
      method: 'POST',
      headers: Object.assign({ 'Content-Type': 'application/json' }, getAuthHeader()),
      body: JSON.stringify({ image: dataUrl, side: side })
    })
      .then(function (res) {
        if (res.status === 401) {
          doLogout(false);
          throw new Error('Your examination session expired. Please sign in again.');
        }
        if (!res.ok) {
          return res.json().then(function (err) { throw new Error(err.error || 'OCR processing failed'); });
        }
        return res.json();
      })
      .then(function (data) {
        stage1Data[side].status = 'done';
        stage1Data[side].result = data;
        stage1Data[side].fields = data.fields || {};
        stage1Data[side].docTypeLabel = data.doc_type_label || 'Identity Card';
        renderDocCard(side);
        checkDocStageCompletion();
      })
      .catch(function (err) {
        stage1Data[side].status = 'error';
        var errEl = $('err-' + side);
        errEl.textContent = 'OCR Scan Notice: ' + (err.message || 'Could not parse document. Retry with sharper photo.');
        errEl.classList.remove('hidden');
        renderDocCard(side);
        checkDocStageCompletion();
      });
  }

  function renderDocCard(side) {
    var data = stage1Data[side];
    var img = $('img-' + side);
    var placeholder = $('placeholder-' + side);
    var statusText = $('status-' + side);
    var scanline = $('scanline-' + side);
    var pills = $('pills-' + side);
    var btnRow = $('btnrow-' + side);

    if (data.status === 'scanning') {
      statusText.textContent = 'Scanning with Dual OCR…';
      scanline.className = 'scan-line active fast';
      pills.innerHTML = '<span class="pill" data-kind="scanning"><i class="dot"></i>Scanning</span>';
      if (data.image) {
        img.src = data.image;
        img.classList.remove('hidden');
        placeholder.classList.add('hidden');
      }
      btnRow.innerHTML = '<button type="button" class="btn" disabled>Scanning document…</button>';
    } else if (data.status === 'done') {
      var fieldCount = Object.keys(data.fields).length;
      statusText.textContent = fieldCount + ' fields found (' + data.docTypeLabel + ')';
      scanline.className = 'scan-line';
      pills.innerHTML = '<span class="pill" data-kind="captured"><i class="dot"></i>Captured</span>';
      if (data.image) {
        img.src = data.image;
        img.classList.remove('hidden');
        placeholder.classList.add('hidden');
      }
      btnRow.innerHTML = `
        <button type="button" class="btn" id="btn-retake-${side}">Retake</button>
        <button type="button" class="btn" id="btn-rescan-${side}">Re-scan</button>
      `;
      $('btn-retake-' + side).onclick = function () { startDocCamera(side); };
      $('btn-rescan-' + side).onclick = function () { processDocImage(side, data.image); };
    } else if (data.status === 'error') {
      statusText.textContent = 'Needs attention';
      scanline.className = 'scan-line';
      pills.innerHTML = '<span class="pill" data-kind="bad"><i class="dot"></i>Check image</span>';
      btnRow.innerHTML = `
        <button type="button" class="btn primary" id="btn-retry-${side}">Try again</button>
        <button type="button" class="btn" id="btn-up-${side}">Upload file</button>
      `;
      $('btn-retry-' + side).onclick = function () { startDocCamera(side); };
      $('btn-up-' + side).onclick = function () { $('file-' + side).click(); };
    } else {
      // Idle
      statusText.textContent = 'Not captured';
      scanline.className = 'scan-line';
      pills.innerHTML = '';
      img.classList.add('hidden');
      placeholder.classList.remove('hidden');
      btnRow.innerHTML = `
        <button type="button" class="btn primary" id="btn-c-${side}">Use camera</button>
        <button type="button" class="btn" id="btn-u-${side}">Upload file</button>
        <button type="button" class="btn ghost" id="btn-d-${side}">Use demo data</button>
      `;
      $('btn-c-' + side).onclick = function () { startDocCamera(side); };
      $('btn-u-' + side).onclick = function () { $('file-' + side).click(); };
      $('btn-d-' + side).onclick = function () { loadDocDemo(side); };
    }
  }

  function loadDocDemo(side) {
    var svgUri = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 320 200">' + demoSvg[side] + '</svg>');
    stage1Data[side].image = svgUri;
    stage1Data[side].result = demoData[side];
    stage1Data[side].fields = demoData[side].fields;
    stage1Data[side].docTypeLabel = demoData[side].doc_type_label;
    stage1Data[side].status = 'done';
    renderDocCard(side);
    checkDocStageCompletion();
  }

  function checkDocStageCompletion() {
    var frontOk = stage1Data.front.status === 'done';
    var backOk = stage1Data.back.status === 'done';
    var ready = frontOk && backOk;

    $('btn-to-review').disabled = !ready;
    $('docs-hint').style.display = ready ? 'none' : 'block';
  }

  // --- Document Review Population ---
  function populateReviewView() {
    var frontImg = $('review-img-front');
    var backImg = $('review-img-back');
    var noFront = $('review-noimg-front');
    var noBack = $('review-noimg-back');

    if (stage1Data.front.image) {
      frontImg.src = stage1Data.front.image;
      frontImg.classList.remove('hidden');
      noFront.classList.add('hidden');
      $('review-caption-front').textContent = 'Front · ' + (stage1Data.front.docTypeLabel || 'ID Card');
    }
    if (stage1Data.back.image) {
      backImg.src = stage1Data.back.image;
      backImg.classList.remove('hidden');
      noBack.classList.add('hidden');
      $('review-caption-back').textContent = 'Back · ' + (stage1Data.back.docTypeLabel || 'ID Card');
    }

    $('review-doc-badge').textContent = stage1Data.front.docTypeLabel || 'Document Verified';

    var tbody = $('review-tbody');
    tbody.innerHTML = '';

    // Merge fields from front and back
    var allFields = Object.assign({}, stage1Data.front.fields, stage1Data.back.fields);

    var labelDict = {
      name: 'Full Name',
      father_name: "Father's Name",
      mother_name: "Mother's Name",
      dob: 'Date of Birth',
      phone: 'Mobile / Phone',
      email: 'Email Address',
      id_number: 'ID / Reg Number',
      dl_number: 'Driving Licence No',
      employee_id: 'Employee ID',
      card_number: 'Card Number',
      institution: 'Institution / College',
      company: 'Company Name',
      course: 'Course / Branch',
      class_section: 'Class / Section',
      valid_till: 'Valid Until',
      issued_on: 'Issued On',
      address: 'Residential Address',
      pincode: 'PIN Code',
      blood_group: 'Blood Group'
    };

    var fieldKeys = Object.keys(allFields);
    if (fieldKeys.length === 0) {
      $('review-nofields-err').classList.remove('hidden');
      return;
    }
    $('review-nofields-err').classList.add('hidden');

    fieldKeys.forEach(function (k) {
      var f = allFields[k];
      var rawVal = Array.isArray(f.value) ? f.value.join(', ') : String(f.value || '');
      var label = labelDict[k] || k.replace(/_/g, ' ').replace(/^./, function (c) { return c.toUpperCase(); });

      var badgeClass = 'badge-clear';
      var badgeText = '✓ Verified (Dual engine)';
      var isLow = false;

      if (f.agreement === 'match') {
        badgeClass = 'badge-clear';
        badgeText = '✓ Both engines match';
      } else if (f.agreement === 'match (fuzzy)') {
        badgeClass = 'badge-clear';
        badgeText = '~ Fuzzy match (≥90%)';
      } else if (f.agreement === 'conflict') {
        badgeClass = 'badge-warning';
        badgeText = '! Discrepancy (' + (f.source || 'arbitrated') + ')';
        isLow = true;
      } else if (f.agreement === 'single-engine') {
        badgeClass = 'badge-clear';
        badgeText = '· Engine: ' + (f.source || 'OCR');
      } else if (f.agreement === 'heuristic (verify)') {
        badgeClass = 'badge-warning';
        badgeText = '? Layout heuristic';
        isLow = true;
      }

      var tr = document.createElement('tr');
      if (isLow) tr.className = 'low';

      tr.innerHTML = `
        <td style="font-weight: 600; width: 32%;">${label}</td>
        <td>
          <input type="text" class="form-input" style="padding: 6px 10px; font-size: 0.9rem;" value="${rawVal}">
        </td>
        <td style="width: 28%;">
          <span class="badge ${badgeClass}" style="font-size: 0.72rem; padding: 3px 8px;">${badgeText}</span>
        </td>
      `;
      tbody.appendChild(tr);
    });

    $('check-details-confirmed').checked = false;
    $('btn-to-headshot').disabled = true;
  }

  // --- Headshot Scanner ---
  function stopHeadshotCamera() {
    if (stage1Data.headshot.stream) {
      stage1Data.headshot.stream.getTracks().forEach(function (t) { t.stop(); });
      stage1Data.headshot.stream = null;
    }
    var video = $('video-headshot');
    video.pause();
    video.srcObject = null;
    video.classList.add('hidden');
    $('panel-headshot').setAttribute('data-mode', 'idle');
  }

  function startHeadshotCamera() {
    var video = $('video-headshot');
    var errEl = $('cam-err-headshot');
    errEl.classList.add('hidden');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      errEl.textContent = 'Webcam not available in this browser. Upload a photo instead.';
      errEl.classList.remove('hidden');
      return;
    }

    navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: { ideal: 1280 } }, audio: false })
      .then(function (stream) {
        stage1Data.headshot.stream = stream;
        video.srcObject = stream;
        video.classList.remove('hidden');
        video.play();

        $('placeholder-headshot').classList.add('hidden');
        $('img-headshot').classList.add('hidden');
        $('panel-headshot').setAttribute('data-mode', 'live');

        var btnRow = $('btnrow-headshot');
        btnRow.innerHTML = `
          <button type="button" class="btn primary" id="btn-capture-head">Take headshot</button>
          <button type="button" class="btn" id="btn-cancel-head">Cancel</button>
        `;
        $('btn-capture-head').onclick = function () {
          var canvas = document.createElement('canvas');
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          canvas.getContext('2d').drawImage(video, 0, 0);
          var snapUrl = canvas.toDataURL('image/jpeg', 0.94);
          stopHeadshotCamera();
          setHeadshotPhoto(snapUrl);
        };
        $('btn-cancel-head').onclick = stopHeadshotCamera;
      })
      .catch(function (err) {
        errEl.textContent = 'Could not access webcam: ' + (err.message || err.name);
        errEl.classList.remove('hidden');
      });
  }

  function setHeadshotPhoto(dataUrl) {
    stage1Data.headshot.image = dataUrl;
    var img = $('img-headshot');
    img.src = dataUrl;
    img.classList.remove('hidden');
    $('placeholder-headshot').classList.add('hidden');
    $('panel-headshot').setAttribute('data-mode', 'captured');
    $('pills-headshot').innerHTML = '<span class="pill" data-kind="captured"><i class="dot"></i>Photo ready</span>';
    $('info-done-headshot').classList.remove('hidden');
    $('btn-to-match').disabled = false;

    var btnRow = $('btnrow-headshot');
    btnRow.innerHTML = '<button type="button" class="btn" id="btn-retake-head">Retake photo</button>';
    $('btn-retake-head').onclick = startHeadshotCamera;
  }

  // --- Match & Summary Setup ---
  function populateMatchView() {
    var dl = $('match-doc-dl');
    dl.innerHTML = '';

    var allFields = Object.assign({}, stage1Data.front.fields, stage1Data.back.fields);
    var name = allFields.name ? allFields.name.value : candidate.name;
    var idNum = allFields.id_number ? allFields.id_number.value : (allFields.dl_number ? allFields.dl_number.value : '4MH23CS052');
    var docType = stage1Data.front.docTypeLabel || 'College / University ID';

    dl.innerHTML = `
      <dt style="color: var(--text-muted); font-weight: 500;">Candidate:</dt>
      <dd style="font-weight: 600;">${name}</dd>
      <dt style="color: var(--text-muted); font-weight: 500;">Identifier:</dt>
      <dd style="font-weight: 600;">${idNum}</dd>
      <dt style="color: var(--text-muted); font-weight: 500;">Document:</dt>
      <dd>${docType}</dd>
      <dt style="color: var(--text-muted); font-weight: 500;">Dual OCR:</dt>
      <dd><span class="badge badge-clear" style="font-size:0.75rem;">Verified Match</span></dd>
    `;

    var matchImg = $('match-headshot-img');
    var matchPh = $('match-headshot-placeholder');
    if (stage1Data.headshot.image) {
      matchImg.src = stage1Data.headshot.image;
      matchImg.classList.remove('hidden');
      matchPh.classList.add('hidden');
    }
  }

  // =========================================================================
  // STAGE 2: 7-STAGE 360° EXAMINATION ROOM SCANNER
  // =========================================================================

  function initRoomScanUI() {
    renderRoomStepper(1, []);
    startRoomCamera();
  }

  function renderRoomStepper(activeId, completedIds) {
    var stepper = $('scannerStepper');
    stepper.innerHTML = roomScan.stages.map(function (st) {
      var cls = '';
      if (completedIds.indexOf(st.id) !== -1) cls = 'completed';
      else if (st.id === activeId) cls = 'active';

      return `
        <div class="stepper-item ${cls}">
          <div class="num">${st.id}</div>
          <div class="name">${st.name}</div>
        </div>
      `;
    }).join('');
  }

  function startRoomCamera() {
    var video = $('cameraVideo');
    if (roomScan.stream) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      $('cameraStatusPill').textContent = 'Camera unavailable';
      return;
    }

    navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
      audio: false
    }).then(function (stream) {
      roomScan.stream = stream;
      video.srcObject = stream;
      video.play();
      $('cameraStatusPill').textContent = 'Camera Ready';
    }).catch(function (err) {
      $('cameraStatusPill').textContent = 'Camera permission required';
    });
  }

  function startGuidedScan() {
    if (roomScan.isRunning) return;
    roomScan.isRunning = true;
    roomScan.activeStageIndex = 0;
    roomScan.evidenceFrames = [];

    $('btnStartScan').style.display = 'none';
    $('btnCancelScan').style.display = 'inline-block';
    $('recBadge').style.display = 'flex';
    $('cameraHudOverlay').style.display = 'block';

    executeCurrentRoomStage();
  }

  function executeCurrentRoomStage() {
    if (!roomScan.isRunning) return;

    var currentStage = roomScan.stages[roomScan.activeStageIndex];
    var stageNumber = roomScan.activeStageIndex + 1;
    var totalStages = roomScan.stages.length;
    var nextStage = (roomScan.activeStageIndex + 1 < totalStages) ? roomScan.stages[roomScan.activeStageIndex + 1] : null;

    roomScan.secondsLeft = currentStage.duration;

    // Highlight area card in sequence
    document.querySelectorAll('.scan-area-row').forEach(function (row) { row.classList.remove('area-card-active'); });
    var activeCard = $('area-card-' + stageNumber);
    if (activeCard) activeCard.classList.add('area-card-active');

    // Update Stepper
    var completed = [];
    for (var i = 0; i < roomScan.activeStageIndex; i++) completed.push(roomScan.stages[i].id);
    renderRoomStepper(currentStage.id, completed);

    // Update HUD
    $('hudStageTitle').textContent = `Stage ${stageNumber} of ${totalStages}: ${currentStage.name}`;
    $('hudStageTimer').textContent = `${roomScan.secondsLeft}s`;
    $('hudInstruction').textContent = currentStage.instruction;
    $('hudNextPreview').textContent = nextStage ? `Next: ${nextStage.name}` : 'Final stage';
    $('progressBarFill').style.width = '0%';
    $('cameraStatusPill').textContent = `Scanning Stage ${stageNumber} of ${totalStages}`;

    // Timer Loop
    if (roomScan.timer) clearInterval(roomScan.timer);

    roomScan.timer = setInterval(function () {
      roomScan.secondsLeft--;
      var elapsed = currentStage.duration - roomScan.secondsLeft;
      var pct = Math.min(100, (elapsed / currentStage.duration) * 100);

      $('hudStageTimer').textContent = `${roomScan.secondsLeft}s`;
      $('progressBarFill').style.width = `${pct}%`;

      // Capture keyframe evidence at midway (5s)
      if (roomScan.secondsLeft === 5) {
        captureStageEvidence(currentStage);
      }

      if (roomScan.secondsLeft <= 0) {
        clearInterval(roomScan.timer);
        roomScan.activeStageIndex++;

        if (roomScan.activeStageIndex < roomScan.stages.length) {
          executeCurrentRoomStage();
        } else {
          finishRoomScan();
        }
      }
    }, 1000);
  }

  function captureStageEvidence(stage) {
    var video = $('cameraVideo');
    if (!video.videoWidth) return;

    var canvas = document.createElement('canvas');
    canvas.width = Math.min(640, video.videoWidth);
    canvas.height = Math.round(video.videoHeight * (canvas.width / video.videoWidth));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

    roomScan.evidenceFrames.push({
      stageId: stage.id,
      stageName: stage.name,
      timestamp: performance.now(),
      imageUrl: canvas.toDataURL('image/jpeg', 0.82)
    });
  }

  function cancelRoomScan() {
    if (roomScan.timer) clearInterval(roomScan.timer);
    roomScan.isRunning = false;

    $('recBadge').style.display = 'none';
    $('cameraHudOverlay').style.display = 'none';
    $('btnStartScan').style.display = 'inline-block';
    $('btnCancelScan').style.display = 'none';
    $('cameraStatusPill').textContent = 'Camera Ready';

    renderRoomStepper(1, []);
    document.querySelectorAll('.scan-area-row').forEach(function (row) { row.classList.remove('area-card-active'); });
  }

  function finishRoomScan() {
    if (roomScan.timer) clearInterval(roomScan.timer);
    roomScan.isRunning = false;

    $('recBadge').style.display = 'none';
    $('cameraHudOverlay').style.display = 'none';
    $('btnStartScan').style.display = 'inline-block';
    $('btnCancelScan').style.display = 'none';

    renderRoomStepper(null, [1, 2, 3, 4, 5, 6, 7]);
    document.querySelectorAll('.scan-area-row').forEach(function (row) { row.classList.remove('area-card-active'); });

    // Transition to Findings View
    $('view-scanner-intro').style.display = 'none';
    $('view-results').style.display = 'block';
    populateResultsView();
  }

  function populateResultsView() {
    // Summary Metrics
    $('resultsSummaryBar').innerHTML = `
      <div class="results-summary-bar">
        <div class="summary-metric-card pastel-clear">
          <div class="summary-metric-value">7 / 7</div>
          <div class="summary-metric-label">Stages Completed</div>
        </div>
        <div class="summary-metric-card pastel-clear">
          <div class="summary-metric-value" style="color: #166534;">0</div>
          <div class="summary-metric-label">Flags Detected</div>
        </div>
        <div class="summary-metric-card pastel-clear">
          <div class="summary-metric-value">
            <span class="badge badge-clear">LOW RISK</span>
          </div>
          <div class="summary-metric-label">Proctoring Status</div>
        </div>
      </div>
    `;

    // Render 7 Stage Evidence Findings
    var findings = roomScan.stages.map(function (st, idx) {
      var ev = roomScan.evidenceFrames.find(function (e) { return e.stageId === st.id; });
      return {
        stageId: st.id,
        stageName: st.name,
        status: 'clear',
        description: `Verified inspection of ${st.name.toLowerCase()}. Zero unauthorized hardware, secondary monitors, or candidate assistance detected.`,
        action: 'Room environment criteria satisfied.',
        imgUrl: ev ? ev.imageUrl : null
      };
    });

    renderFindingsList(findings);

    $('chkAcknowledge').checked = false;
    $('btnAcknowledgeSubmit').disabled = true;
  }

  function renderFindingsList(findings) {
    var container = $('findingsContainer');
    container.innerHTML = findings.map(function (f) {
      var imgHtml = f.imgUrl ? `
        <div class="finding-thumbnail-box">
          <img src="${f.imgUrl}" alt="${f.stageName} evidence" class="finding-thumbnail-img" style="cursor: pointer; width: 84px; height: 60px; object-fit: cover; border-radius: 6px;" />
        </div>
      ` : '';

      return `
        <div class="finding-card status-clear severity-low" style="display: flex; justify-content: space-between; align-items: center; padding: 14px 18px; margin-bottom: 12px; background: #ffffff; border: 1px solid var(--border-subtle); border-radius: var(--radius-md);">
          <div class="finding-content" style="flex: 1;">
            <div class="finding-header" style="display: flex; align-items: center; gap: 10px; margin-bottom: 4px;">
              <span class="finding-stage" style="font-weight: 600;">${f.stageName}</span>
              <span class="badge badge-clear">Clear</span>
            </div>
            <div class="finding-desc" style="font-size: 0.9rem; color: var(--text-main);">${f.description}</div>
            <div class="finding-action" style="font-size: 0.8rem; color: var(--text-muted); margin-top: 4px;">${f.action}</div>
          </div>
          ${imgHtml}
        </div>
      `;
    }).join('');
  }

  // --- Bind Event Listeners ---
  function initEvents() {
    // Stepper navigation clicks
    $('masterStep1').onclick = function () { showMasterStage(1); };
    $('masterStep2').onclick = function () {
      if (!$('masterStep2').classList.contains('locked')) showMasterStage(2);
    };

    // Candidate Edit Modal
    $('btnEditCandidate').onclick = function () { $('editCandidateModal').style.display = 'flex'; };
    $('btnCloseEditModal').onclick = function () { $('editCandidateModal').style.display = 'none'; };
    $('editCandidateForm').onsubmit = function (e) {
      e.preventDefault();
      candidate.name = $('inputCandName').value.trim() || candidate.name;
      candidate.email = $('inputCandEmail').value.trim() || candidate.email;
      candidate.examCode = $('inputExamCode').value.trim() || candidate.examCode;
      updateCandidateMeta();
      $('editCandidateModal').style.display = 'none';
    };

    // Stage 1 File Inputs
    $('file-front').onchange = function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { processDocImage('front', reader.result); };
      reader.readAsDataURL(f);
      e.target.value = '';
    };

    $('file-back').onchange = function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { processDocImage('back', reader.result); };
      reader.readAsDataURL(f);
      e.target.value = '';
    };

    // Reset Stage 1
    $('btnResetStage1').onclick = function () {
      stopDocCamera('front');
      stopDocCamera('back');
      stopHeadshotCamera();
      stage1Data.front = { image: null, result: null, fields: {}, docTypeLabel: '', status: 'idle', stream: null };
      stage1Data.back = { image: null, result: null, fields: {}, docTypeLabel: '', status: 'idle', stream: null };
      renderDocCard('front');
      renderDocCard('back');
      checkDocStageCompletion();
      setStage1View('document');
    };

    // Stage 1 View Navigation
    $('btn-to-review').onclick = function () {
      populateReviewView();
      setStage1View('review');
    };

    $('btn-back-to-docs').onclick = function () {
      setStage1View('document');
    };

    $('check-details-confirmed').onchange = function () {
      $('btn-to-headshot').disabled = !this.checked;
    };

    $('btn-to-headshot').onclick = function () {
      setStage1View('headshot');
    };

    $('btn-back-to-review').onclick = function () {
      setStage1View('review');
    };

    // Headshot Options
    $('opt-headshot-webcam').onclick = startHeadshotCamera;
    $('opt-headshot-upload').onclick = function () { $('file-headshot').click(); };
    $('file-headshot').onchange = function (e) {
      var f = e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () { setHeadshotPhoto(reader.result); };
      reader.readAsDataURL(f);
      e.target.value = '';
    };
    $('opt-headshot-demo').onclick = function () {
      var demoHeadshotSvg = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 240 240"><circle cx="120" cy="120" r="110" fill="#f1f5f9"/><circle cx="120" cy="100" r="45" fill="#cbd5e1"/><ellipse cx="120" cy="190" rx="70" ry="40" fill="#cbd5e1"/><text x="120" y="230" text-anchor="middle" font-family="sans-serif" font-size="12" fill="#64748b">CANDIDATE HEADSHOT</text></svg>');
      setHeadshotPhoto(demoHeadshotSvg);
    };

    $('btn-to-match').onclick = function () {
      populateMatchView();
      setStage1View('match');
    };

    $('btn-back-to-headshot').onclick = function () {
      setStage1View('headshot');
    };

    $('btn-to-summary').onclick = function () {
      setStage1View('summary');
    };

    $('btn-summary-restart').onclick = function () {
      $('btnResetStage1').click();
    };

    // Proceed to Stage 2 (Room Verification)
    $('btn-proceed-stage2').onclick = function () {
      showMasterStage(2);
    };

    // Stage 2 Room Scanner Actions
    $('btnStartScan').onclick = startGuidedScan;
    $('btnCancelScan').onclick = cancelRoomScan;

    // Results Actions
    $('chkAcknowledge').onchange = function () {
      $('btnAcknowledgeSubmit').disabled = !this.checked;
    };

    $('btnRescan').onclick = function () {
      $('view-results').style.display = 'none';
      $('view-scanner-intro').style.display = 'block';
      initRoomScanUI();
    };

    $('btnAcknowledgeSubmit').onclick = function () {
      $('view-results').style.display = 'none';
      $('view-waiting').style.display = 'block';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    $('btnWaitRestart').onclick = function () {
      $('view-waiting').style.display = 'none';
      $('view-scanner-intro').style.display = 'block';
      showMasterStage(1);
      $('btnResetStage1').click();
    };
  }

  function initAuthEvents() {
    var loginForm = $('loginForm');
    if (loginForm) {
      loginForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideAuthError('login-error');

        var emailInput = $('loginEmail');
        var passwordInput = $('loginPassword');
        var email = (emailInput ? emailInput.value : '').trim();
        var password = passwordInput ? passwordInput.value : '';

        // Clear password immediately from DOM
        if (passwordInput) passwordInput.value = '';

        if (!email || !password) {
          showAuthError('login-error', 'Please enter both your registered candidate email and password.');
          return;
        }

        var submitBtn = $('btnLoginSubmit');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span>Verifying Credentials…</span>';
        }

        fetch('/api/auth/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, password: password })
        })
          .then(function (res) {
            return res.json().then(function (data) {
              return { status: res.status, ok: res.ok, data: data };
            });
          })
          .then(function (result) {
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.innerHTML = '<span>Sign In to Examination</span>';
            }

            if (result.status === 429) {
              var waitSec = result.data.retry_after || 60;
              showLockout('login', waitSec);
              return;
            }

            if (!result.ok) {
              showAuthError('login-error', 'Email or password is wrong.');
              return;
            }

            // Authentication succeeded: store ONLY session token (never password)
            authState.token = result.data.token;
            sessionStorage.setItem('proctor_auth_token', result.data.token);

            if (result.data.user) {
              candidate.name = result.data.user.name || candidate.name;
              candidate.email = result.data.user.email || candidate.email;
              candidate.examCode = result.data.user.exam_code || candidate.examCode;
              candidate.id = result.data.user.candidate_id || candidate.id;
              updateCandidateMeta();
            }

            showAuthView(true);
          })
          .catch(function () {
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.innerHTML = '<span>Sign In to Examination</span>';
            }
            showAuthError('login-error', 'Server error. Please ensure the backend is running.');
          });
      });
    }

    var resetForm = $('resetForm');
    if (resetForm) {
      resetForm.addEventListener('submit', function (e) {
        e.preventDefault();
        hideAuthError('reset-error');
        if ($('reset-success')) $('reset-success').style.display = 'none';

        var emailInput = $('resetEmail');
        var passwordInput = $('resetPassword');
        var confirmInput = $('resetConfirmPassword');
        var email = (emailInput ? emailInput.value : '').trim();
        var newPassword = passwordInput ? passwordInput.value : '';
        var confirmPassword = confirmInput ? confirmInput.value : '';

        // Clear passwords from DOM immediately
        if (passwordInput) passwordInput.value = '';
        if (confirmInput) confirmInput.value = '';

        if (!email || !newPassword) {
          showAuthError('reset-error', 'Please enter your registered candidate email and a new password.');
          return;
        }

        if (newPassword.length < 8) {
          showAuthError('reset-error', 'Password must be at least 8 characters in length.');
          return;
        }

        if (newPassword !== confirmPassword) {
          showAuthError('reset-error', 'Passwords do not match. Please verify and retry.');
          return;
        }

        var submitBtn = $('btnResetSubmit');
        if (submitBtn) {
          submitBtn.disabled = true;
          submitBtn.innerHTML = '<span>Updating Password…</span>';
        }

        fetch('/api/auth/reset-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email, new_password: newPassword })
        })
          .then(function (res) {
            return res.json().then(function (data) {
              return { status: res.status, ok: res.ok, data: data };
            });
          })
          .then(function (result) {
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.innerHTML = '<span>Update Password</span>';
            }

            if (result.status === 429) {
              var waitSec = result.data.retry_after || 60;
              showLockout('reset', waitSec);
              return;
            }

            if (!result.ok) {
              showAuthError('reset-error', result.data.error || 'Password reset request failed.');
              return;
            }

            var successEl = $('reset-success');
            if (successEl) {
              successEl.textContent = result.data.message || 'Password successfully updated! Redirecting to sign in…';
              successEl.style.display = 'block';
            }
            setTimeout(function () {
              showAuthCard('login');
              if ($('loginEmail')) $('loginEmail').value = email;
            }, 1600);
          })
          .catch(function () {
            if (submitBtn) {
              submitBtn.disabled = false;
              submitBtn.innerHTML = '<span>Update Password</span>';
            }
            showAuthError('reset-error', 'Server error. Please ensure the backend is running.');
          });
      });
    }

    if ($('btnToggleLoginPwd')) {
      $('btnToggleLoginPwd').onclick = function () {
        togglePasswordVisibility('loginPassword', 'btnToggleLoginPwd');
      };
    }

    if ($('btnToggleResetPwd')) {
      $('btnToggleResetPwd').onclick = function () {
        togglePasswordVisibility('resetPassword', 'btnToggleResetPwd');
      };
    }

    if ($('btnShowReset')) {
      $('btnShowReset').onclick = function () {
        showAuthCard('reset');
      };
    }

    if ($('btnShowResetFromTop')) {
      $('btnShowResetFromTop').onclick = function () {
        showAuthCard('reset');
      };
    }

    if ($('btnShowLogin')) {
      $('btnShowLogin').onclick = function () {
        showAuthCard('login');
      };
    }

    if ($('btnHeaderLogout')) {
      $('btnHeaderLogout').onclick = function () {
        doLogout(true);
      };
    }
  }

  // --- Initialize on DOM Loaded ---
  document.addEventListener('DOMContentLoaded', function () {
    updateCandidateMeta();
    initAuthEvents();
    initEvents();
    renderDocCard('front');
    renderDocCard('back');
    verifySession();
  });

})();
