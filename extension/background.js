// ═══════════════════════════════════════════════════════════════
// BrainSlap — background.js  v1.2 (3파트 통합본)
// [판정 파트]    탭 감시·5초 체류·본문/제목 추출·/analyze 호출·캐시  — 원본 유지
// [페르소나 파트] persona/intensity 전달·캐시 적중 시 /nagging 재생성 — 원본 유지
// [개입 파트 ★]  triggerOverlay → dispatchIntervention (10종 개입 추첨·세션·보상)
// ═══════════════════════════════════════════════════════════════

// 1. 이미 검사한 URL과 점수를 기억할 로컬 캐시 객체 선언
const urlCache = {};

// 2. 사용자의 체류 시간을 체크하기 위한 타이머 보관 객체 선언
let monitorTimers = {};

const BACKEND_URL = 'http://127.0.0.1:5001'; // ★ macOS에서 localhost가 IPv6(::1)로 해석돼 Flask(IPv4 전용)와 연결 실패하는 문제 회피

/* ─────────────────────────────────────────────
 * ★ [수정] 감시 진입점 이원화 — SPA 대응
 * 유튜브·인스타 등은 영상/페이지 이동 시 전체 로드 없이 주소만 바뀌므로
 * (history.pushState) tabs.onUpdated의 'complete'가 발생하지 않는다.
 * → webNavigation.onHistoryStateUpdated 로 SPA 내부 이동까지 감지.
 * 두 진입점 모두 scheduleAnalysis()로 합류하며, 탭별 타이머가
 * 연속 이동을 자동 디바운스(마지막 이동 후 5초 체류만 판정)한다.
 * ───────────────────────────────────────────── */
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    scheduleAnalysis(tabId, tab.url, 'full-load');
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (details.frameId !== 0) return;                 // 메인 프레임만 (iframe 제외)
  if (!details.url.startsWith('http')) return;
  scheduleAnalysis(details.tabId, details.url, 'spa-nav');
});

function scheduleAnalysis(tabId, url, source) {
  {
    // 구글 검색 도중 발생하는 리디렉션 및 단순 검색 결과 페이지 필터링
    const urlObj = new URL(url);
    if (urlObj.hostname.includes('google.com')) {
      if (urlObj.pathname === '/url' || urlObj.pathname === '/search') {
        console.log(`[AI 감시 패스] 구글 시스템 페이지 제외: ${url}`);
        return;
      }
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

          // 로컬 캐시 확인 — 판정은 재사용, 잔소리 텍스트만 /nagging으로 새로 생성 (반복 방지)
          if (urlCache[url]) {
            console.log(`[AI 캐시 적중] 판정 API 호출 생략: ${url}`);
            const cachedData = urlCache[url];
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
                dispatchIntervention(tabId, tab, cachedData.score, targetGoal, cachedData.reason, naggingData, persona, intensity); // ★
              } catch (e) {
                console.error('[캐시 적중 후 잔소리 재생성 실패]', e);
                const tab = await chrome.tabs.get(tabId).catch(() => ({ url, title: '' }));
                dispatchIntervention(tabId, tab, cachedData.score, targetGoal, cachedData.reason, null, persona, intensity); // ★ 잔소리 없이도 개입은 발동
              }
            }
            return;
          }

          console.log(`[AI 감시 구동] 5초 체류 완료, 분석 시작: ${url}`);

          try {
            // 🛡️ [방어 코드 1] 본문 텍스트 + 제목 직접 추출 (네이버 블로그 iframe 대응 포함)
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
            console.log(`[본문 추출 완료] 제목: "${(pageTitle||'').slice(0,40)}" / 텍스트 ${pageText ? pageText.length : 0}자`);

            // 🛡️ [방어 코드 2] 텍스트가 없으면 서버 요청 생략
            if (!pageText || pageText.trim().length < 10) {
              console.log("[AI 감시 패스] 본문 텍스트가 없거나 읽을 수 없는 페이지입니다.");
              return;
            }

            // 백엔드로 URL/제목/본문/페르소나/강도를 함께 전송
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
              // ★ 진단: 서버가 에러를 반환한 경우 (가장 흔한 원인: OpenAI 키/크레딧 문제)
              const errBody = await response.text().catch(() => '(본문 없음)');
              console.error(`[서버 에러 응답] HTTP ${response.status} — 파이썬 터미널의 ❌ 로그를 확인하세요.`, errBody.slice(0, 300));
              return;
            }
            {
              const data = await response.json();
              console.log("[AI 서버 응답 데이터]:", data);

              const score = parseInt(data.score, 10);
              const reason = data.reason || "목표와 연관성이 떨어집니다.";
              const nagging = data.nagging || null;

              if (!isNaN(score)) {
                urlCache[url] = { score: score, reason: reason, title: pageTitle };
              }

              if (!isNaN(score) && score < 5) {
                const tab = await chrome.tabs.get(tabId).catch(() => ({ url, title: pageTitle }));
                dispatchIntervention(tabId, tab, score, targetGoal, reason, nagging, persona, intensity); // ★
              }
            }
          } catch (error) {
            console.error("백엔드 서버 통신 실패 또는 에러:", error);
          }
        }
      );

    }, 5000); // 5초 대기
  }
}

// ═══════════════════════════════════════════════════════════════
// ★★★ 이하: 개입(Intervention) 파트 영역 ★★★
// ═══════════════════════════════════════════════════════════════

/* ★ [1] 개입 풀 — content/interventions.js 등록 id와 1:1 대응
 * (comeback-cheer·jackpot-roulette 는 보상형이라 딴짓 풀에서 제외) */
const ALL_INTERVENTIONS = [
  'runaway-exit', 'dm-nudge', 'focus-fade', 'alert-storm',
  'negotiation', 'dopamine-receipt', 'fun-buffering', 'tilt-world',
];

/* ★ [2] 개입 발동 — 페르소나 파트의 triggerOverlay 를 대체·확장.
 * nagging(백엔드 생성 잔소리)을 개입 UI의 메인 대사로 전달한다. */
function dispatchIntervention(tabId, tab, score, goal, reason, nagging, persona, intensity) {
  chrome.storage.local.get(
    ['interventionPool', 'poolMode', 'sessionEndsAt', 'distractLog'],
    (s) => {
      // ① 개입 추첨 (popup 설정: 선택 풀 랜덤 / 완전 랜덤)
      let pool = (s.poolMode === 'random')
        ? ALL_INTERVENTIONS
        : (s.interventionPool || []).filter(id => ALL_INTERVENTIONS.includes(id));
      if (!pool.length) pool = ALL_INTERVENTIONS;
      const interventionId = pool[Math.floor(Math.random() * pool.length)];
      console.log(`[개입 발동] ${interventionId} (점수 ${score}점) → 탭 ${tabId}`);

      // ② 도파민 영수증용 차단 기록 적재 (최근 20건)
      const log = s.distractLog || [];
      log.push({
        site: new URL(tab.url).hostname.replace('www.', ''),
        title: (tab.title || '').slice(0, 22),
        time: new Date().toTimeString().slice(0, 5),
      });
      chrome.storage.local.set({ distractLog: log.slice(-20) });

      // ③ 집중 세션 중이면 "딴짓 발생" 기록 (잭팟 무효)
      if (s.sessionEndsAt && Date.now() < s.sessionEndsAt) {
        chrome.storage.local.set({ sessionDirty: true });
        console.log('[세션] 딴짓 감지 — 이번 세션 잭팟 무효');
      }

      // ④ content script(정적 등록)로 개입 신호 전송
      const payload = {
        type: 'BRAINSLAP_BLOCK',
        interventionId, score, goal, reason,
        persona: persona || '교관',
        intensity: intensity || 3,
        nag: nagging ? nagging.text : null,       // 페르소나 파트 생성 잔소리
        toneTag: nagging ? nagging.tone_tag : 'neutral',
        title: tab.title || '',
      };
      chrome.tabs.sendMessage(tabId, payload).catch(() => {
        // 폴백: 확장 설치 전 열린 탭 등 — 동적 주입 후 재전송
        chrome.scripting.executeScript({
          target: { tabId }, files: ['content/interventions.js'],
        }).then(() => chrome.tabs.sendMessage(tabId, payload))
          .catch(err => console.error('[개입 주입 실패]', err));
      });
    }
  );
}

/* ★ [3] content script 발신 메시지 처리 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 딴짓 탭 종료 (페르소나 파트 CLOSE_TAB 프로토콜과 호환)
  if ((message.type === 'CLOSE_TAB' || message.type === 'BRAINSLAP_CLOSE_TAB')
      && sender.tab && sender.tab.id != null) {
    chrome.tabs.remove(sender.tab.id).catch(() => {});
  }
  // 개입 행동 로그 (TODO: 통계 파트 연동 지점)
  if (message.type === 'BRAINSLAP_EVENT') {
    console.log(`[개입 이벤트] ${message.id}:${message.action}`, message.payload || {});
  }
  // 읽씹 페널티 등 — 잔소리 재생성 요청 (히스토리 반복 방지는 페르소나 파트가 처리)
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
      }).then(r => r.json())
        .then(d => sendResponse({ ok: true, nagging: d }))
        .catch(() => sendResponse({ ok: false }));
    });
    return true; // 비동기 sendResponse 유지
  }
});

/* ★ [4] 집중 세션 — chrome.alarms 기반 (MV3 서비스워커 슬립에도 안전)
 * 무결점 완주: 시간 비례 보상(60분까지 분당 1pt, 이후 1.5pt),
 * 30분↑ 무결점은 12% 확률로 잭팟 룰렛 신호를 활성 탭에 전송. */
const JACKPOT_MIN = 30;
const JACKPOT_CHANCE = 0.12;
const timeReward = (min) => min <= 60 ? min : Math.round(60 + (min - 60) * 1.5);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === 'BRAINSLAP_SESSION_START') {
    const endsAt = Date.now() + msg.minutes * 60 * 1000;
    chrome.storage.local.set({
      sessionEndsAt: endsAt, sessionMinutes: msg.minutes,
      sessionDirty: false, negoBonusPaid: false, // 협상 복귀 보너스 1회권 리셋
    });
    chrome.alarms.create('brainslap-session', { when: endsAt });
    console.log(`[세션 시작] ${msg.minutes}분 — 무결점 완주 시 +${timeReward(msg.minutes)}pt`);
  }
  if (msg?.type === 'BRAINSLAP_SESSION_CANCEL') {
    chrome.alarms.clear('brainslap-session');
    chrome.storage.local.remove(['sessionEndsAt', 'sessionMinutes', 'sessionDirty']);
    console.log('[세션 취소]');
  }
});

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
      console.log(`[세션 종료] 무결점:${perfect} / 기본보상:+${base}pt / 잭팟:${jackpot}`);

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