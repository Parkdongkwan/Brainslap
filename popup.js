// 팝업이 열릴 때 기존 상태 로드
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.local.get(['currentGoal', 'isMonitoring'], (result) => {
    const statusBox = document.getElementById('statusMsg');
    
    if (result.currentGoal) {
      document.getElementById('userGoal').value = result.currentGoal;
    }

    if (result.isMonitoring && result.currentGoal) {
      statusBox.innerText = `🟢 감시 중인 목표:\n"${result.currentGoal}"`;
      statusBox.className = "status active-status";
    } else {
      statusBox.innerText = "🔴 현재 감시 기능이 꺼져 있습니다.";
      statusBox.className = "status inactive-status";
    }
  });
});

// [감시 시작] 버튼 클릭
document.getElementById('startBtn').addEventListener('click', () => {
  const goalVal = document.getElementById('userGoal').value.trim();
  const statusBox = document.getElementById('statusMsg');
  
  if (!goalVal) {
    alert("목표를 입력해주세요!");
    return;
  }

  // 목표 저장 및 활성화 스위치 ON
  chrome.storage.local.set({ currentGoal: goalVal, isMonitoring: true }, () => {
    statusBox.innerText = `🟢 감시 중인 목표:\n"${goalVal}"`;
    statusBox.className = "status active-status";
    alert("백그라운드 AI 감시를 시작합니다!");
  });
});

// [감시 중지] 버튼 클릭
document.getElementById('stopBtn').addEventListener('click', () => {
  const statusBox = document.getElementById('statusMsg');

  // 활성화 스위치만 OFF로 변경 (기존 목표 텍스트는 유지)
  chrome.storage.local.set({ isMonitoring: false }, () => {
    statusBox.innerText = "🔴 현재 감시 기능이 꺼져 있습니다.";
    statusBox.className = "status inactive-status";
    alert("AI 감시가 일시 중지되었습니다.");
  });
});