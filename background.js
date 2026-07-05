// 1. 이미 검사한 URL과 점수를 기억할 로컬 캐시 객체 선언
const urlCache = {};

// 2. 사용자의 체류 시간을 체크하기 위한 타이머 보관 객체 선언
let monitorTimers = {};

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    
    // 구글 검색 도중 발생하는 리디렉션 및 단순 검색 결과 페이지 필터링
    const urlObj = new URL(tab.url);
    if (urlObj.hostname.includes('google.com')) {
      if (urlObj.pathname === '/url' || urlObj.pathname === '/search') {
        console.log(`[AI 감시 패스] 구글 시스템 페이지 제외: ${tab.url}`);
        return;
      }
    }

    if (monitorTimers[tabId]) {
      clearTimeout(monitorTimers[tabId]);
    }

    console.log(`[AI 대기] 5초 체류 확인 중... URL: ${tab.url}`);
    
    monitorTimers[tabId] = setTimeout(() => {
      
      chrome.storage.local.get(['currentGoal', 'isMonitoring'], async (storage) => {
        const targetGoal = storage.currentGoal;
        const isMonitoring = storage.isMonitoring;
        
        if (!isMonitoring || !targetGoal) return;

        // 로컬 캐시 확인
        if (urlCache[tab.url]) {
          console.log(`[AI 캐시 적중] 이미 검사한 페이지입니다. 서버 호출 생략: ${tab.url}`);
          const cachedData = urlCache[tab.url];
          if (cachedData.score < 5) {
            triggerAlert(tabId, cachedData.score, targetGoal, cachedData.reason);
          }
          return;
        }

        console.log(`[AI 감시 구동] 5초 체류 완료, 분석 시작: ${tab.url}`);

        try {
          // 🛡️ [방어 코드 1] 브라우저 화면에서 본문 텍스트 직접 추출 (네이버 블로그 iframe 대응 포함)
          const [{ result: pageText }] = await chrome.scripting.executeScript({
            target: { tabId: tabId },
            func: () => {
              // 네이버 블로그 아이프레임 예외 처리
              const naverIframe = document.getElementById('mainFrame');
              if (naverIframe && naverIframe.contentWindow) {
                try { return naverIframe.contentWindow.document.body.innerText; } catch (e) {}
              }
              // ChatGPT, 노션 등 일반/동적 사이트 핵심 본문 타겟팅 후 글자 제한(토큰 절약)
              const bodyText = document.body.innerText || "";
              return bodyText.substring(0, 2000); 
            }
          }).catch(() => [{ result: "" }]); // 스크립트 주입 차단 페이지 대비 예외 처리

          // 🛡️ [방어 코드 2] 추출된 텍스트가 아예 없다면 서버에 무의미한 요청을 보내지 않고 패스
          if (!pageText || pageText.trim().length < 10) {
            console.log("[AI 감시 패스] 본문 텍스트가 없거나 읽을 수 없는 페이지입니다.");
            return;
          }

          // 백엔드로 URL과 함께 실제 긁어온 'text'를 전송
          const response = await fetch('http://localhost:5000/analyze', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              url: tab.url,
              text: pageText, // 👈 파이썬이 따로 크롤링할 필요 없게 본문을 직접 배달!
              goal: targetGoal
            })
          });

          if (response.ok) {
            const data = await response.json();
            console.log("[AI 서버 응답 데이터]:", data);

            const score = parseInt(data.score, 10);
            const reason = data.reason || "목표와 연관성이 떨어집니다.";

            if (!isNaN(score)) {
              urlCache[tab.url] = { score: score, reason: reason };
            }

            if (!isNaN(score) && score < 5) {
              triggerAlert(tabId, score, targetGoal, reason);
            }
          }
        } catch (error) {
          console.error("백엔드 서버 통신 실패 또는 에러:", error);
        }
      });

    }, 5000); // 5초 대기
  }
});

function triggerAlert(tabId, score, goal, reason) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (s, g, r) => {
      alert(`⚠️ [AI 패널티 알림] \n\n현재 페이지는 당신의 목표(${g})와 연관성이 낮습니다!\n\n■ AI 연관성 점수: ${s}점 / 10점\n■ 판단 이유: ${r}\n\n딴짓하지 말고 어서 하던 일에 집중하세요!`);
    },
    args: [score, goal, reason]
  }).catch(err => console.error("스크립트 주입 실패:", err));
}