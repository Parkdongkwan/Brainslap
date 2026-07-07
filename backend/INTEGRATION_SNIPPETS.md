# app.py / background.js에 붙여넣을 코드

팀원 깃허브의 `app.py`, `background.js`, `manifest.json`은 그대로 두고,
아래 스니펫만 해당 위치에 붙여넣으면 됩니다. (`manifest.json`은 수정 불필요)

---

## 1. `app.py`에 추가

### 1-1. 맨 위 import 구역에 추가

기존:
```python
import os
import requests
import json
from bs4 import BeautifulSoup
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from typing import List
```

**이 아래에 한 줄 추가:**
```python
# 🔽 추가
from nagging_service import generate_nagging
```

### 1-2. `CORS(app)` 아래에 상수 추가

기존:
```python
app = Flask(__name__)
CORS(app)
```

**이 아래에 추가:**
```python
# 🔽 추가: 딴짓 판정 기준 점수 (10점 만점, 이 미만이면 잔소리 생성)
# background.js의 score < 5 기준과 반드시 동일하게 유지
BLOCK_THRESHOLD = 5
```

### 1-3. `/analyze` 함수 내부 수정

기존 함수 시작 부분:
```python
@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    url = data.get('url')
    page_text = data.get('text')
    page_text = page_text[:1000]
    goal = data.get('goal')
```

**이렇게 바꾸세요 (title/persona/intensity 3줄 추가 + page_text None 방어):**
```python
@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    url = data.get('url')
    page_text = data.get('text')
    page_text = page_text[:1000] if page_text else page_text
    goal = data.get('goal')

    # 🔽 추가
    title = data.get('title', '')
    persona = data.get('persona', '교관')
    intensity = data.get('intensity', 3)
```

기존 함수 맨 끝 부분:
```python
    analysis_result = evaluate_with_langchain(final_text, goal)

    if analysis_result:
        return jsonify(analysis_result.model_dump()), 200
    else:
        return jsonify({"score": 10, "reason": "AI 분석 실패 (서버 에러)", "summary": []}), 500
```

**이렇게 바꾸세요:**
```python
    analysis_result = evaluate_with_langchain(final_text, goal)

    if not analysis_result:
        return jsonify({"score": 10, "reason": "AI 분석 실패 (서버 에러)", "summary": [], "nagging": None}), 500

    result_dict = analysis_result.model_dump()

    # 🔽 추가: 점수가 기준 미만이면 페르소나 잔소리 생성
    nagging_result = None
    if result_dict["score"] < BLOCK_THRESHOLD:
        nagging_result = generate_nagging(
            goal=goal,
            page_title=title or url,
            persona_input=persona,
            intensity=intensity,
            reason=result_dict["reason"],
        )

    result_dict["nagging"] = nagging_result
    return jsonify(result_dict), 200
```

그 위에 있는 "본문 텍스트를 아예 추출할 수 없는 경우" 분기에도 `"nagging": None` 한 줄만 추가해주세요:
```python
    if not final_text:
        return jsonify({
            "score": 10,
            "reason": "본문을 읽을 수 없는 특수 페이지 혹은 예외 상황입니다.",
            "summary": [],
            "nagging": None,  # 🔽 추가
        }), 200
```

### 1-4. 파일 맨 아래, `if __name__ == "__main__":` 위에 새 엔드포인트 추가

```python
# 🔽 추가: 캐시 적중 시 판정은 재사용하고 잔소리 텍스트만 새로 뽑는 경량 엔드포인트
@app.route('/nagging', methods=['POST'])
def nagging_only():
    data = request.json
    result = generate_nagging(
        goal=data.get('goal', ''),
        page_title=data.get('title') or data.get('url', ''),
        persona_input=data.get('persona', '교관'),
        intensity=data.get('intensity', 3),
        reason=data.get('reason', ''),
    )
    return jsonify(result), 200
```

---

## 2. `background.js`에 추가

### 2-1. 파일 맨 위, 캐시 선언 아래에 백엔드 주소 추가

기존:
```javascript
const urlCache = {};
let monitorTimers = {};
```

**아래 한 줄 추가:**
```javascript
const BACKEND_URL = 'http://localhost:5000'; // 🔽 추가
```

### 2-2. `chrome.storage.local.get(['currentGoal', 'isMonitoring'], ...)` 부분 수정

기존:
```javascript
chrome.storage.local.get(['currentGoal', 'isMonitoring'], async (storage) => {
  const targetGoal = storage.currentGoal;
  const isMonitoring = storage.isMonitoring;

  if (!isMonitoring || !targetGoal) return;
```

**이렇게 바꾸세요 (persona/intensity 추가):**
```javascript
chrome.storage.local.get(
  ['currentGoal', 'isMonitoring', 'currentPersona', 'currentIntensity'],
  async (storage) => {
    const targetGoal = storage.currentGoal;
    const isMonitoring = storage.isMonitoring;
    const persona = storage.currentPersona || '교관';       // 🔽 추가
    const intensity = storage.currentIntensity || 3;         // 🔽 추가

    if (!isMonitoring || !targetGoal) return;
```
(콜백을 화살표 함수 밖으로 감싸는 괄호 개수가 하나 늘어나니, 이 블록의 맨 마지막 닫는 부분에 `}` `)` 하나씩 더 필요합니다 — 아래 2-6 참고)

### 2-3. 캐시 적중 분기 수정

기존:
```javascript
if (urlCache[tab.url]) {
  console.log(`[AI 캐시 적중] 이미 검사한 페이지입니다. 서버 호출 생략: ${tab.url}`);
  const cachedData = urlCache[tab.url];
  if (cachedData.score < 5) {
    triggerAlert(tabId, cachedData.score, targetGoal, cachedData.reason);
  }
  return;
}
```

**이렇게 바꾸세요:**
```javascript
if (urlCache[tab.url]) {
  console.log(`[AI 캐시 적중] 이미 검사한 페이지입니다. 판정 API 호출 생략: ${tab.url}`);
  const cachedData = urlCache[tab.url];
  if (cachedData.score < 5) {
    // 🔽 추가: 판정은 캐시 재사용, 잔소리 텍스트만 새로 받아서 반복 방지
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
      triggerOverlay(tabId, cachedData.score, targetGoal, cachedData.reason, naggingData);
    } catch (e) {
      console.error('[캐시 적중 후 잔소리 재생성 실패]', e);
    }
  }
  return;
}
```

### 2-4. 본문 추출 스크립트에 제목도 같이 추출하도록 수정

기존:
```javascript
const [{ result: pageText }] = await chrome.scripting.executeScript({
  target: { tabId: tabId },
  func: () => {
    const naverIframe = document.getElementById('mainFrame');
    if (naverIframe && naverIframe.contentWindow) {
      try { return naverIframe.contentWindow.document.body.innerText; } catch (e) {}
    }
    const bodyText = document.body.innerText || "";
    return bodyText.substring(0, 2000);
  }
}).catch(() => [{ result: "" }]);
```

**이렇게 바꾸세요:**
```javascript
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
      title: document.title,   // 🔽 추가
    };
  }
}).catch(() => [{ result: { text: "", title: "" } }]);

const pageText = pageInfo.text;   // 🔽 추가
const pageTitle = pageInfo.title; // 🔽 추가
```

(이후 코드에서 `pageText`를 참조하던 부분은 그대로 두면 됩니다. 변수명이 동일합니다.)

### 2-5. `/analyze` fetch 요청 본문 + 응답 처리 수정

기존:
```javascript
const response = await fetch('http://localhost:5000/analyze', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: tab.url,
    text: pageText,
    goal: targetGoal
  })
});

if (response.ok) {
  const data = await response.json();
  const score = parseInt(data.score, 10);
  const reason = data.reason || "목표와 연관성이 떨어집니다.";

  if (!isNaN(score)) {
    urlCache[tab.url] = { score: score, reason: reason };
  }

  if (!isNaN(score) && score < 5) {
    triggerAlert(tabId, score, targetGoal, reason);
  }
}
```

**이렇게 바꾸세요:**
```javascript
const response = await fetch(`${BACKEND_URL}/analyze`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    url: tab.url,
    text: pageText,
    goal: targetGoal,
    title: pageTitle,      // 🔽 추가
    persona: persona,      // 🔽 추가
    intensity: intensity,  // 🔽 추가
  })
});

if (response.ok) {
  const data = await response.json();
  const score = parseInt(data.score, 10);
  const reason = data.reason || "목표와 연관성이 떨어집니다.";
  const nagging = data.nagging || null;  // 🔽 추가

  if (!isNaN(score)) {
    urlCache[tab.url] = { score: score, reason: reason, title: pageTitle };  // 🔽 title 추가
  }

  if (!isNaN(score) && score < 5) {
    triggerOverlay(tabId, score, targetGoal, reason, nagging);  // 🔽 triggerAlert -> triggerOverlay
  }
}
```

### 2-6. 파일 맨 아래 `triggerAlert` 함수 전체를 아래로 교체

기존 함수를 통째로 지우고:
```javascript
function triggerAlert(tabId, score, goal, reason) {
  chrome.scripting.executeScript({
    target: { tabId: tabId },
    func: (s, g, r) => {
      alert(`⚠️ [AI 패널티 알림] ...`);
    },
    args: [score, goal, reason]
  }).catch(err => console.error("스크립트 주입 실패:", err));
}
```

**아래 코드로 교체하세요:**
```javascript
function triggerOverlay(tabId, score, goal, reason, nagging) {
  const payload = {
    score: score,
    goal: goal,
    reason: reason,
    text: nagging ? nagging.text : `현재 페이지는 목표(${goal})와 연관성이 낮습니다. (${reason})`,
    toneTag: nagging ? nagging.tone_tag : 'neutral',
    persona: nagging ? nagging.persona : '교관',
  };

  chrome.scripting.insertCSS({
    target: { tabId: tabId },
    files: ['content.css'],
  }).catch((e) => console.error('[content.css 삽입 실패]', e));

  chrome.scripting.executeScript({
    target: { tabId: tabId },
    files: ['content.js'],
  }).then(() => {
    chrome.tabs.sendMessage(tabId, { type: 'SHOW_NAGGING_OVERLAY', payload: payload });
  }).catch((err) => console.error('[content.js 삽입 실패]', err));
}

// 🔽 추가: content.js의 "창 닫고 일하러 가기" 버튼 클릭 시 탭을 닫기 위한 리스너
chrome.runtime.onMessage.addListener((message, sender) => {
  if (message.type === 'CLOSE_TAB' && sender.tab && sender.tab.id) {
    chrome.tabs.remove(sender.tab.id);
  }
});
```

### 2-7. 괄호 짝 확인 (중요)

2-2에서 `chrome.storage.local.get(...)`의 콜백 함수를 화살표 함수로 감쌌기 때문에,
파일 맨 아래 `}, 5000);` 바로 위, 원래 `});`로 끝나던 자리가 `}\n);`로 한 겹 더 감싸져야 합니다.
수정 후 VSCode에서 괄호 색깔이 서로 맞는지(매칭되는지) 꼭 확인해주세요.

---

## 3. 새로 추가하는 파일 (같은 폴더에 넣기)

아래 파일들은 통째로 새로 추가하시면 됩니다 (수정 없이 그대로 사용):

- `content.js`, `content.css`: 팀원분의 Lock-In 데모 중 **"DM식 집중 유도" 모듈**을 실제 웹페이지에 주입되도록 이식한 버전. 하단에서 카톡풍 채팅창이 슬라이드업되고, 타이핑 인디케이터 후 실제 백엔드가 생성한 잔소리가 표시됨. `say()` 로컬 템플릿 대신 `payload.text`(실제 `/nagging` 응답)를 그대로 사용
- `personas.py`, `prompt_builder.py`, `llm_client.py`, `nagging_service.py`, `history_store.py`, `config.py`: 페르소나 잔소리 생성 모듈 (app.py와 같은 폴더에 두면 됨)
- `popup.html`, `popup.js`: 목표/페르소나(5종)/강도 입력 화면
- `test_persona_only.py`: app.py 없이 잔소리 생성 부분만 테스트하는 스크립트

### 페르소나 5종 (팀원 Lock-In 데모와 이름 통일)

| 키 | 표시 | 비고 |
|---|---|---|
| `교관` | 🎖️ | |
| `엄마` | 🍳 | |
| `사극_왕장군` | ⚔️ | 제가 원래 추가했던 페르소나 (팀원 데모엔 없음) |
| `면접관` | 🧐 | 팀원 데모의 `interviewer` |
| `츤데레` | 😤 | 팀원 데모의 `tsundere` |

팀원 데모에는 이 5개 중 `사극_왕장군`이 없고, 저는 원래 `면접관`/`츤데레`가 없었는데, 이번에 서로 합쳐서 5종 전체를 지원하도록 맞췄습니다.

### 아직 연결 안 한 부분 (팀원 데모의 나머지 6개 모듈)

팀원 Lock-In 데모에는 이 외에도 "도망가는 종료 버튼", "도파민 페이드(흑백 처리)", "죄책감 스크롤", "협상 테이블(포인트로 휴식권 구매)", "도파민 영수증", "복귀 세리머니(콘페티)"가 있습니다. 이번엔 **DM식 집중 유도 하나만** 실제로 연결했고, 나머지는 아직 손 안 댔습니다. 포인트/스트릭 같은 보상 시스템도 아직 백엔드에 없어서, 나중에 연결하려면:
1. 각 모듈의 `say()` 호출 부분을 실제 `/nagging` 응답으로 교체
2. `state.points`/`state.streak`를 `chrome.storage`에 연동
3. 판정 점수 구간(예: 30~60점은 소프트 개입, 5점 미만은 강한 개입)에 따라 어떤 모듈을 트리거할지 `background.js`에서 분기



## 4. `.env` 확인

```dotenv
LLM_PROVIDER=openai
OPENAI_MODEL=gpt-4o-mini
```

팀원의 `app.py`가 이미 `OPENAI_API_KEY`를 요구하고 있으니, 같은 키를 그대로 재사용하면 됩니다.
`.env`는 절대 GitHub에 올리지 마세요 (`.gitignore`에 포함되어 있는지 확인).
