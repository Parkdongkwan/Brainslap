// ═══════════════════════════════════════════════════════════════
// BrainSlap — background.js  v1.4 (캐싱 고도화 및 TTL 5분 추가)
// ═══════════════════════════════════════════════════════════════

// 1. 캐시 객체 선언 (구조: { "목표|URL": { score, reason, title, expireAt } })
const urlCache = {};
const CACHE_TTL = 5 * 60 * 1000; // 5분 (밀리초 단위)

let monitorTimers = {};
const BACKEND_URL = 'http://127.0.0.1:5001'; 

const ALL_INTERVENTIONS = [
  'runaway-exit', 'dm-nudge', 'focus-fade', 'alert-storm',
  'negotiation', 'dopamine-receipt', 'fun-buffering', 'tilt-world',
];

const JACKPOT_MIN = 30;
const JACKPOT_CHANCE = 0.12;
const timeReward = (min) => min <= 60 ? min : Math.round(60 + (min - 60) * 1.5);

// 감시 진입점 이원화 (SPA 대응)
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    scheduleAnalysis(tabId, tab.url, 'full-load');
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return; 
  if (!details.url.startsWith('http')) return;
  scheduleAnalysis(details.tabId, details.url, 'spa-nav');
});

function scheduleAnalysis(tabId, url, source) {
  try {
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('google.com')) {
      if (urlObj.pathname === '/url' || urlObj.pathname === '/search') {
        console.log(`[AI 감시 패스] 구글 시스템 페이지 제외: ${url}`);
        return;
      }
    }
  } catch (e) {
    return; 
  }

  if (monitorTimers[tabId]) {
    clearTimeout(monitorTimers[tabId]);
  }

  console.log(`[AI 대기] 5초 체류 확인 중... (${source}) URL: ${url}`);

  monitorTimers[tabId] = setTimeout(() => {
    chrome.storage.local.get(
      ['currentGoal', 'isMonitoring', 'currentPersona', 'currentIntensity'],
      async (storage) => {
        const targetGoal = storage.currentGoal;
        const isMonitoring = storage.isMonitoring;
        const persona = storage.currentPersona || '교관';
        const intensity = storage.currentIntensity || 3;

        if (!isMonitoring || !targetGoal) return;

        // ★ [고도화] 목표(Goal)와 URL을 조합한 고유 캐시 키 생성
        const cacheKey = `${targetGoal}|${url}`;
        const now = Date.now();

        // ★ [고도화] 캐시가 존재하고 만료 시간(TTL)이 지나지 않았는지 확인
        if (urlCache[cacheKey]) {
          if (now < urlCache[cacheKey].expireAt) {
            console.log(`[AI 캐시 적중] 목표 동일 + 5분 이내 판정 보존 -> API 호출 생략: ${url}`);
            const cachedData = urlCache[cacheKey];
            if (cachedData.score < 5) {
              try {
                const naggingRes = await fetch(`${BACKEND_URL}/nagging`, {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    goal: targetGoal,
                    title: cachedData.title,
                    persona: persona,
                    intensity: intensity,
                    reason: cachedData.reason,
                  }),
                });
                const naggingData = await naggingRes.json();
                const tab = await chrome.tabs.get(tabId).catch(() => ({ url, title: '' }));
                dispatchIntervention(tabId, tab, cachedData.score, targetGoal, cachedData.reason, naggingData, persona, intensity);
              } catch (e) {
                console.error('[캐시 적중 후 잔소리 재생성 실패]', e);
                const tab = await chrome.tabs.get(tabId).catch(() => ({ url, title: '' }));
                dispatchIntervention(tabId, tab, cachedData.score, targetGoal, cachedData.reason, null, persona, intensity);
              }
            }
            return;
          } else {
            // 5분이 지나 만료된 캐시는 삭제 후 재생성하도록 유도
            console.log(`[AI 캐시 만료] 5분이 경과하여 캐시를 폐기하고 재분석합니다: ${url}`);
            delete urlCache[cacheKey];
          }
        }

        console.log(`[AI 감시 구동] 5초 체류 완료, 분석 시작: ${url}`);

        try {
          // 본문 텍스트 추출 (네이버 블로그 대응)
          const [{ result: pageInfo }] = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
              const naverIframe = document.getElementById('mainFrame');
              if (naverIframe && naverIframe.contentWindow) {
                try {
                  return {
                    text: naverIframe.contentWindow.document.body.innerText,
                    title: document.title,
                  };
                } catch (e) {}
              }
              const bodyText = document.body.innerText || "";
              return {
                text: bodyText.substring(0, 2000),
                title: document.title,
              };
            }
          }).catch(() => [{ result: { text: "", title: "" } }]);

          const pageText = pageInfo.text;
          const pageTitle = pageInfo.title;

          if (!pageText || pageText.trim().length < 10) {
            console.log("[AI 감시 패스] 본문 텍스트가 없거나 읽을 수 없는 페이지입니다.");
            return;
          }

          const response = await fetch(`${BACKEND_URL}/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: url,
              text: pageText,
              goal: targetGoal,
              title: pageTitle,
              persona: persona,
              intensity: intensity,
            })
          });

          if (!response.ok) {
            const errBody = await response.text().catch(() => '(본문 없음)');
            console.error(`[서버 에러 응답] HTTP ${response.status}`, errBody.slice(0, 300));
            return;
          }

          const data = await response.json();
          const score = parseInt(data.score, 10);
          const reason = data.reason || "목표와 연관성이 떨어집니다.";
          const nagging = data.nagging || null;

          // ★ [고도화] 판정 성공 시 복합 키와 만료 시간(현재 시간 + 5분)을 함께 저장
          if (!isNaN(score)) {
            urlCache[cacheKey] = { 
              score: score, 
              reason: reason, 
              title: pageTitle,
              expireAt: Date.now() + CACHE_TTL // 만료 타임스탬프 설정
            };
          }

          if (!isNaN(score) && score < 5) {
            const tab = await chrome.tabs.get(tabId).catch(() => ({ url, title: pageTitle }));
            dispatchIntervention(tabId, tab, score, targetGoal, reason, nagging, persona, intensity);
          }
        } catch (error) {
          console.error("백엔드 서버 통신 실패 또는 에러:", error);
        }
      }
    );
  }, 5000);
}

// 개입 발동 함수
function dispatchIntervention(tabId, tab, score, goal, reason, nagging, persona, intensity) {
  chrome.storage.local.get(
    ['interventionPool', 'poolMode', 'sessionEndsAt', 'distractLog'],
    (s) => {
      let pool = (s.poolMode === 'random')
        ? ALL_INTERVENTIONS
        : (s.interventionPool || []).filter(id => ALL_INTERVENTIONS.includes(id));
      if (!pool.length) pool = ALL_INTERVENTIONS;
      const interventionId = pool[Math.floor(Math.random() * pool.length)];

      const log = s.distractLog || [];
      try {
        log.push({
          site: new URL(tab.url).hostname.replace('www.', ''),
          title: (tab.title || '').slice(0, 22),
          time: new Date().toTimeString().slice(0, 5),
        });
        chrome.storage.local.set({ distractLog: log.slice(-20) });
      } catch(e) {}

      if (s.sessionEndsAt && Date.now() < s.sessionEndsAt) {
        chrome.storage.local.set({ sessionDirty: true });
      }

      const payload = {
        type: 'BRAINSLAP_BLOCK',
        interventionId, score, goal, reason,
        persona: persona || '교관',
        intensity: intensity || 3,
        nag: nagging ? nagging.text : null,
        toneTag: nagging ? nagging.tone_tag : 'neutral',
        title: tab.title || '',
      };

      chrome.tabs.sendMessage(tabId, payload).catch(() => {
        chrome.scripting.executeScript({
          target: { tabId }, files: ['content/interventions.js'],
        }).then(() => chrome.tabs.sendMessage(tabId, payload))
          .catch(err => console.error('[개입 주입 실패]', err));
      });
    }
  );
}

// 통합 메시지 리스너 (포트 닫힘 예방 및 비동기 대응 완료)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if ((message.type === 'CLOSE_TAB' || message.type === 'BRAINSLAP_CLOSE_TAB') && sender.tab && sender.tab.id != null) {
    chrome.tabs.remove(sender.tab.id).catch(() => {});
    return false;
  }
  
  if (message.type === 'BRAINSLAP_EVENT') {
    console.log(`[개입 이벤트] ${message.id}:${message.action}`, message.payload || {});
    return false;
  }

  if (message.type === 'BRAINSLAP_REQUEST_NAG') {
    chrome.storage.local.get(['currentGoal', 'currentPersona', 'currentIntensity'], (s) => {
      fetch(`${BACKEND_URL}/nagging`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          goal: s.currentGoal || '',
          title: message.title || '',
          persona: s.currentPersona || '교관',
          intensity: Math.min(5, (s.currentIntensity || 3) + (message.intensityBoost || 0)),
          reason: message.reason || '',
        }),
      })
      .then(r => r.json())
      .then(d => sendResponse({ ok: true, nagging: d }))
      .catch(() => sendResponse({ ok: false }));
    });
    return true; // 비동기 채널 유지
  }

  if (message?.type === 'BRAINSLAP_SESSION_START') {
    const endsAt = Date.now() + message.minutes * 60 * 1000;
    chrome.storage.local.set({
      sessionEndsAt: endsAt, sessionMinutes: message.minutes,
      sessionDirty: false, negoBonusPaid: false,
    });
    chrome.alarms.create('brainslap-session', { when: endsAt });
    console.log(`[세션 시작] ${message.minutes}분`);
    return false;
  }

  if (message?.type === 'BRAINSLAP_SESSION_CANCEL') {
    chrome.alarms.clear('brainslap-session');
    chrome.storage.local.remove(['sessionEndsAt', 'sessionMinutes', 'sessionDirty']);
    console.log('[세션 취소]');
    return false;
  }
});

// 알람 기반 세션 완료 처리
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name !== 'brainslap-session') return;
  chrome.storage.local.get(
    ['sessionMinutes', 'sessionDirty', 'points', 'currentGoal', 'currentPersona'],
    (s) => {
      const min = s.sessionMinutes || 0;
      const perfect = !s.sessionDirty;
      const base = perfect ? (min >= JACKPOT_MIN ? timeReward(min) : 10) : 3;
      const jackpot = perfect && min >= JACKPOT_MIN && Math.random() < JACKPOT_CHANCE;
      chrome.storage.local.set({ points: Math.max(0, (s.points || 0) + base) });
      chrome.storage.local.remove(['sessionEndsAt', 'sessionMinutes', 'sessionDirty']);

      chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
        if (!tabs[0]?.id) return;
        chrome.tabs.sendMessage(tabs[0].id, {
          type: 'BRAINSLAP_SESSION_RESULT',
          perfect, minutes: min, baseReward: base, jackpot,
          goal: s.currentGoal, persona: s.currentPersona || '교관',
        }).catch(() => {});
      });
    }
  );
});