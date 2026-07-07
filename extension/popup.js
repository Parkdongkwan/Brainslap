// ═══════════════════════════════════════════════════════════════
// BrainSlap — popup.js  v1.2 (페르소나 파트 원본 + 개입 파트 병합)
// storage 키: currentGoal, isMonitoring, currentPersona, currentIntensity (페르소나 파트)
//            + interventionPool, poolMode, points, streak, sessionEndsAt (개입 파트 ★)
// ═══════════════════════════════════════════════════════════════

const goalInput = document.getElementById('goalInput');
const personaChips = document.querySelectorAll('#personaChips .chip');
const customPersonaInput = document.getElementById('customPersonaInput');
const intensitySlider = document.getElementById('intensitySlider');
const intensityValue = document.getElementById('intensityValue');
const toggleBtn = document.getElementById('toggleBtn');
const statusText = document.getElementById('statusText');

let selectedPersona = '교관';
let isMonitoring = false;

// ★ 개입 목록 (content/interventions.js 등록 id와 1:1 대응)
const INTERVENTIONS = [
  ['runaway-exit',     '도망가는 종료 버튼'],
  ['dm-nudge',         'DM식 집중 유도'],
  ['focus-fade',       '도파민 페이드'],
  ['alert-storm',      '알림 폭탄'],
  ['negotiation',      '집중 협상 테이블'],
  ['dopamine-receipt', '도파민 영수증'],
  ['fun-buffering',    '재미 버퍼링'],
  ['tilt-world',       '기울어진 세계'],
];
let sessionTicker = null;

// ★ 방해 요소 체크박스 생성
const poolList = document.getElementById('poolList');
INTERVENTIONS.forEach(([id, label]) => {
  const l = document.createElement('label');
  l.innerHTML = `<input type="checkbox" value="${id}" checked> ${label}`;
  l.querySelector('input').addEventListener('change', persistSettings);
  poolList.appendChild(l);
});
document.querySelectorAll('input[name="poolMode"]').forEach(r =>
  r.addEventListener('change', persistSettings));

// ============= 초기값 불러오기 =============
chrome.storage.local.get(
  ['currentGoal', 'isMonitoring', 'currentPersona', 'currentIntensity',
   'interventionPool', 'poolMode', 'points', 'streak', 'sessionEndsAt'], // ★ 키 추가
  (storage) => {
    if (storage.currentGoal) goalInput.value = storage.currentGoal;

    if (storage.currentPersona) {
      selectedPersona = storage.currentPersona;
      const isPreset = Array.from(personaChips).some(
        (c) => c.dataset.persona === selectedPersona
      );
      personaChips.forEach((c) => c.classList.remove('active'));
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

    // ★ 개입 파트 상태 복원
    if (Array.isArray(storage.interventionPool)) {
      poolList.querySelectorAll('input').forEach(i =>
        i.checked = storage.interventionPool.includes(i.value));
    }
    if (storage.poolMode === 'random') {
      document.querySelector('input[name="poolMode"][value="random"]').checked = true;
    }
    document.getElementById('statPoints').textContent = `${storage.points || 0}pt`;
    document.getElementById('statStreak').textContent = `${storage.streak || 1}일`;
    updateSessionButton(storage.sessionEndsAt);
  }
);

// ============= 페르소나 선택 (페르소나 파트 원본) =============
personaChips.forEach((chip) => {
  chip.addEventListener('click', () => {
    personaChips.forEach((c) => c.classList.remove('active'));
    chip.classList.add('active');
    const value = chip.dataset.persona;

    if (value === 'custom') {
      customPersonaInput.style.display = 'block';
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

// ============= 말투 강도 =============
intensitySlider.addEventListener('input', () => {
  intensityValue.textContent = intensitySlider.value;
  persistSettings();
});

// ============= 목표 입력 =============
goalInput.addEventListener('input', () => {
  persistSettings();
});

// ============= 감시 시작/종료 토글 =============
toggleBtn.addEventListener('click', () => {
  if (!goalInput.value.trim()) {
    alert('오늘의 목표를 먼저 입력해주세요.');
    return;
  }
  isMonitoring = !isMonitoring;
  updateToggleUI();
  persistSettings();
});

function updateToggleUI() {
  if (isMonitoring) {
    toggleBtn.textContent = '감시 종료하기';
    toggleBtn.classList.add('active');
    statusText.textContent = '현재 감시 중입니다';
  } else {
    toggleBtn.textContent = '감시 시작하기';
    toggleBtn.classList.remove('active');
    statusText.textContent = '현재 꺼져 있습니다';
  }
}

function persistSettings() {
  const pool = [...poolList.querySelectorAll('input:checked')].map(i => i.value); // ★
  const mode = document.querySelector('input[name="poolMode"]:checked').value;    // ★
  chrome.storage.local.set({
    currentGoal: goalInput.value.trim(),
    isMonitoring: isMonitoring,
    currentPersona: selectedPersona || '교관',
    currentIntensity: parseInt(intensitySlider.value, 10),
    interventionPool: pool, // ★
    poolMode: mode,         // ★
  });
}

// ============= ★ 집중 세션 (개입 파트) =============
function updateSessionButton(endsAt) {
  const btn = document.getElementById('sessionBtn');
  clearInterval(sessionTicker);
  if (endsAt && Date.now() < endsAt) {
    btn.classList.add('running');
    const tick = () => {
      const left = Math.max(0, endsAt - Date.now());
      const m = Math.floor(left / 60000), sec = Math.floor((left % 60000) / 1000);
      btn.textContent = `세션 포기 (${m}:${String(sec).padStart(2, '0')} 남음)`;
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
  btn.textContent = '집중 세션 시작';
}

document.getElementById('sessionBtn').addEventListener('click', () => {
  chrome.storage.local.get(['sessionEndsAt', 'currentGoal'], (s) => {
    if (s.sessionEndsAt && Date.now() < s.sessionEndsAt) {
      chrome.runtime.sendMessage({ type: 'BRAINSLAP_SESSION_CANCEL' });
      updateSessionButton(null);
      return;
    }
    if (!goalInput.value.trim()) { alert('오늘의 목표를 먼저 입력해주세요.'); return; }
    const minutes = Math.max(5, parseInt(document.getElementById('sessionMin').value) || 30);
    persistSettings(); // 세션 시작 시점 설정 확정
    chrome.runtime.sendMessage({ type: 'BRAINSLAP_SESSION_START', minutes });
    updateSessionButton(Date.now() + minutes * 60 * 1000);
  });
});
