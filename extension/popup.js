// ─────────────────────────────────────────────
// [개발 미리보기 실드] 확장 밖(file://로 직접 열기)에서도 UI가 완전히
// 동작하도록 chrome API를 목업. 실제 확장 환경에선 이 블록은 무시됨.
// ─────────────────────────────────────────────
if (typeof chrome === 'undefined' || !chrome.storage) {
  window.chrome = {
    storage: { local: {
      get: (_keys, cb) => cb({ points: 120, streak: 3 }),  // 미리보기용 더미 값
      set: () => {},
    }},
    runtime: { sendMessage: () => {} },
  };
  console.log('[BrainSlap] 미리보기 모드 — chrome API 목업 사용 중');
}

// ═══════════════════════════════════════════════════════════════
// BrainSlap — popup.js  v2.0 (가로형 레이아웃 대응)
// storage 키(팀 합의 유지): currentGoal, isMonitoring, currentPersona,
//   currentIntensity, interventionPool, poolMode, points, streak, sessionEndsAt
// UI 변경: 방해요소 체크박스 → 토글 칩 / 추첨 모드 라디오 → 세그먼트 컨트롤
// ═══════════════════════════════════════════════════════════════

const goalInput = document.getElementById('goalInput');
const personaChips = document.querySelectorAll('#personaChips .chip');
const customPersonaInput = document.getElementById('customPersonaInput');
const intensitySlider = document.getElementById('intensitySlider');
const intensityValue = document.getElementById('intensityValue');
const toggleBtn = document.getElementById('toggleBtn');
const statusText = document.getElementById('statusText');
const ivChipsBox = document.getElementById('ivChips');
const segBox = document.getElementById('poolModeSeg');

let selectedPersona = '교관';
let isMonitoring = false;
let poolMode = 'pool';
let sessionTicker = null;

// 개입 목록 (content/interventions.js 등록 id와 1:1)
const INTERVENTIONS = [
  ['runaway-exit',     '도망 종료'],
  ['dm-nudge',         'DM 유도'],
  ['focus-fade',       '도파민 페이드'],
  ['alert-storm',      '알림 폭탄'],
  ['negotiation',      '협상 테이블'],
  ['dopamine-receipt', '도파민 영수증'],
  ['fun-buffering',    '재미 버퍼링'],
  ['tilt-world',       '기울어진 세계'],
];

// ── 방해 요소 토글 칩 생성 (다중 선택: 채움+테두리 전환) ──
INTERVENTIONS.forEach(([id, label]) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'ivchip on'; // 기본 전체 선택
  b.dataset.id = id;
  b.innerHTML = `<span class="tick">✓</span>${label}`;
  b.addEventListener('click', () => { b.classList.toggle('on'); persistSettings(); });
  ivChipsBox.appendChild(b);
});

// ── 추첨 모드 세그먼트 컨트롤 ──
segBox.querySelectorAll('button').forEach(btn => {
  btn.addEventListener('click', () => {
    segBox.querySelectorAll('button').forEach(x => x.classList.remove('on'));
    btn.classList.add('on');
    poolMode = btn.dataset.mode;
    persistSettings();
  });
});

// ============= 초기값 불러오기 =============
chrome.storage.local.get(
  ['currentGoal', 'isMonitoring', 'currentPersona', 'currentIntensity',
   'interventionPool', 'poolMode', 'points', 'streak', 'sessionEndsAt'],
  (storage) => {
    if (storage.currentGoal) goalInput.value = storage.currentGoal;

    if (storage.currentPersona) {
      selectedPersona = storage.currentPersona;
      const isPreset = Array.from(personaChips).some(c => c.dataset.persona === selectedPersona);
      personaChips.forEach(c => c.classList.remove('active'));
      if (isPreset) {
        document.querySelector(`.chip[data-persona="${selectedPersona}"]`).classList.add('active');
      } else {
        document.querySelector('.chip[data-persona="custom"]').classList.add('active');
        customPersonaInput.style.display = 'block';
        customPersonaInput.value = selectedPersona;
      }
    }

    if (storage.currentIntensity) {
      intensitySlider.value = storage.currentIntensity;
      intensityValue.textContent = storage.currentIntensity;
    }

    isMonitoring = !!storage.isMonitoring;
    updateToggleUI();

    // 방해 요소 칩 상태 복원
    if (Array.isArray(storage.interventionPool)) {
      ivChipsBox.querySelectorAll('.ivchip').forEach(c =>
        c.classList.toggle('on', storage.interventionPool.includes(c.dataset.id)));
    }
    if (storage.poolMode === 'random') {
      poolMode = 'random';
      segBox.querySelectorAll('button').forEach(x =>
        x.classList.toggle('on', x.dataset.mode === 'random'));
    }

    document.getElementById('statPoints').textContent = `${storage.points || 0}pt`;
    document.getElementById('statStreak').textContent = `${storage.streak || 1}일`;
    document.getElementById('sessionMin').value = storage.sessionMinutes || 30;
    updateSessionButton(storage.sessionEndsAt);
  }
);

// ============= 페르소나 (단일 선택 · 테두리 강조) =============
personaChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    personaChips.forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    const value = chip.dataset.persona;
    if (value === 'custom') {
      customPersonaInput.style.display = 'block';
      customPersonaInput.focus();
      selectedPersona = customPersonaInput.value.trim() || '';
    } else {
      customPersonaInput.style.display = 'none';
      selectedPersona = value;
    }
    persistSettings();
  });
});
customPersonaInput.addEventListener('input', () => {
  selectedPersona = customPersonaInput.value.trim();
  persistSettings();
});

// ============= 말투 강도 / 목표 =============
intensitySlider.addEventListener('input', () => {
  intensityValue.textContent = intensitySlider.value;
  persistSettings();
});
goalInput.addEventListener('input', persistSettings);

// ============= 감시 시작/종료 (상단 메인 버튼) =============
toggleBtn.addEventListener('click', () => {
  if (!goalInput.value.trim()) { alert('오늘의 목표를 먼저 입력해주세요.'); return; }
  isMonitoring = !isMonitoring;
  updateToggleUI();
  persistSettings();
});

function updateToggleUI() {
  if (isMonitoring) {
    toggleBtn.textContent = '⏹ 감시 종료하기';
    toggleBtn.classList.add('active');
    statusText.textContent = '● 현재 감시 중입니다';
    statusText.classList.add('on');
  } else {
    toggleBtn.textContent = '👁 감시 시작하기';
    toggleBtn.classList.remove('active');
    statusText.textContent = '현재 꺼져 있습니다';
    statusText.classList.remove('on');
  }
}

function persistSettings() {
  const pool = [...ivChipsBox.querySelectorAll('.ivchip.on')].map(c => c.dataset.id);
  chrome.storage.local.set({
    currentGoal: goalInput.value.trim(),
    isMonitoring: isMonitoring,
    currentPersona: selectedPersona || '교관',
    currentIntensity: parseInt(intensitySlider.value, 10),
    interventionPool: pool,
    poolMode: poolMode,
  });
}

// ============= 집중 세션 (하단 서브 버튼) =============
function updateSessionButton(endsAt) {
  const btn = document.getElementById('sessionBtn');
  clearInterval(sessionTicker);
  if (endsAt && Date.now() < endsAt) {
    btn.classList.add('running');
    const tick = () => {
      const left = Math.max(0, endsAt - Date.now());
      const m = Math.floor(left / 60000), s = Math.floor((left % 60000) / 1000);
      btn.textContent = `⏹ 세션 포기 (${m}:${String(s).padStart(2, '0')} 남음)`;
      if (left <= 0) { clearInterval(sessionTicker); resetSessionButton(); }
    };
    tick();
    sessionTicker = setInterval(tick, 1000);
  } else {
    resetSessionButton();
  }
}
function resetSessionButton() {
  const btn = document.getElementById('sessionBtn');
  btn.classList.remove('running');
  btn.textContent = '🎯 집중 세션 시작';
}

document.getElementById('sessionBtn').addEventListener('click', () => {
  chrome.storage.local.get(['sessionEndsAt'], (s) => {
    if (s.sessionEndsAt && Date.now() < s.sessionEndsAt) {
      chrome.runtime.sendMessage({ type: 'BRAINSLAP_SESSION_CANCEL' });
      updateSessionButton(null);
      return;
    }
    if (!goalInput.value.trim()) { alert('오늘의 목표를 먼저 입력해주세요.'); return; }
    const minutes = Math.max(5, parseInt(document.getElementById('sessionMin').value) || 30);
    persistSettings();
    chrome.runtime.sendMessage({ type: 'BRAINSLAP_SESSION_START', minutes });
    updateSessionButton(Date.now() + minutes * 60 * 1000);
  });
});