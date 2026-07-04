chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  // 로딩 상태가 'complete'가 되었을 때 딱 한 번만 실행되도록 보장
  if (changeInfo.status === 'complete' && tab.url && tab.url.startsWith('http')) {
    
    // 🚨 [추가] 구글 검색 도중 발생하는 리디렉션 및 단순 검색 결과 페이지 필터링
    const urlObj = new URL(tab.url);
    if (urlObj.hostname.includes('google.com')) {
      // /url (리디렉션 지연 페이지) 또는 /search (단순 검색어 입력 결과 페이지)는 제외
      if (urlObj.pathname === '/url' || urlObj.pathname === '/search') {
        console.log(`[AI 감시 패스] 구글 시스템 페이지 제외: ${tab.url}`);
        return;
      }
    }

    chrome.storage.local.get(['currentGoal', 'isMonitoring'], async (storage) => {
      const targetGoal = storage.currentGoal;
      const isMonitoring = storage.isMonitoring;
      
      if (!isMonitoring || !targetGoal) return;

      console.log(`[AI 감시 구동] URL: ${tab.url}`);

      try {
        const response = await fetch('http://localhost:5000/analyze', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            url: tab.url,
            goal: targetGoal
          })
        });

        if (response.ok) {
          const data = await response.json();
          console.log("[AI 서버 응답 데이터]:", data);

          // 정규식 대신 파이썬이 준 깔끔한 숫자 점수(data.score)를 그대로 읽음
          const score = parseInt(data.score, 10);
          const reason = data.reason || "목표와 연관성이 떨어집니다.";

          if (!isNaN(score) && score < 5) {
            // 경고창이 더 확실하게 뜨도록 탭 상태를 한 번 더 체크하고 주입
            chrome.scripting.executeScript({
              target: { tabId: tabId },
              func: (s, g, r) => {
                alert(`⚠️ [AI 패널티 알림] \n\n현재 페이지는 당신의 목표(${g})와 연관성이 낮습니다!\n\n■ AI 연관성 점수: ${s}점 / 10점\n■ 판단 이유: ${r}\n\n딴짓하지 말고 어서 하던 일에 집중하세요!`);
              },
              args: [score, targetGoal, reason]
            }).catch(err => console.error("스크립트 주입 실패 (크롬 내부 페이지 등):", err));
          }
        }
      } catch (error) {
        console.error("백엔드 서버 통신 실패 또는 에러:", error);
      }
    });
  }
});