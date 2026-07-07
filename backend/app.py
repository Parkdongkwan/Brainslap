import os
import requests
import json
from bs4 import BeautifulSoup
from flask import Flask, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv

# LangChain 컴포넌트
from langchain_openai import ChatOpenAI
from langchain_core.prompts import ChatPromptTemplate
from pydantic import BaseModel, Field
from typing import List

from nagging_service import generate_nagging

# ==========================================
# 0. 환경 변수 및 Flask 초기화
# ==========================================
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    raise ValueError("❌ [에러] .env 파일에서 OPENAI_API_KEY를 찾을 수 없습니다.")

app = Flask(__name__)
CORS(app)

# 🔽 추가: 딴짓 판정 기준 점수 (10점 만점, 이 미만이면 잔소리 생성)
# background.js의 score < 5 기준과 반드시 동일하게 유지
BLOCK_THRESHOLD = 5

# ==========================================
# 1. LangChain 구조화된 출력 스키마 정의 (Pydantic)
# ==========================================
class EvaluationResult(BaseModel):
    score: int = Field(description="사용자의 목표와 웹페이지 본문의 연관성 점수 (10점 만점 기준 정수)")
    reason: str = Field(description="목표와 연관지어 판단한 종합 한줄평 및 이유")
    summary: List[str] = Field(description="사용자의 목표 맞춤 핵심 요약 문장 리스트")

# LLM 설정
llm = ChatOpenAI(
    model="gpt-4o-mini", 
    temperature=0.1, 
    openai_api_key=OPENAI_API_KEY
)
structured_llm = llm.with_structured_output(EvaluationResult)

# ==========================================
# 2. 고속 웹 크롤링 함수 (확장프로그램 실패 시 백업용)
# ==========================================
def fast_crawl_webpage(url):
    print("\n" + "="*60)
    print(f"🌐 [백업 크롤링 가동] URL: {url}")
    print("="*60)
    
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        response = requests.get(url, headers=headers, timeout=5)
        print(f"📡 [응답 상태 코드]: {response.status_code}")
        response.raise_for_status()
        
        soup = BeautifulSoup(response.text, "html.parser")
        
        # 노이즈 제거
        for script in soup(["script", "style", "header", "footer", "nav"]):
            script.extract()
            
        raw_text = soup.get_text()
        cleaned_text = " ".join(raw_text.split())
        
        print(f"📝 [추출된 텍스트 총 글자 수]: {len(cleaned_text)} 자")
        return cleaned_text[:8000]
    except Exception as e:
        print(f"❌ [백업 크롤링마저 실패]: {e}")
        return None

# ==========================================
# 3. LangChain 평가 함수
# ==========================================
def evaluate_with_langchain(text_content, user_goal):
    print("\n" + "-"*60)
    print(f"🤖 [2. LangChain 구동] 유저 목표: {user_goal}")
    print("-"*60)
    
    prompt_template = ChatPromptTemplate.from_messages([
    ("system", """너는 사용자의 브라우징 콘텐츠가 [사용자의 목표]와 연관이 있는지 '맥락과 프로세스' 중심으로 평가하는 지능형 필터링 에이전트야.
단순히 웹페이지에 목표 키워드가 있는지만 보는 1차원적 채점을 절대 금지하며, 아래의 [프로세스 중심 채점 기준]을 최우선으로 적용해라.

[프로세스 중심 채점 기준]
1. **탐색 및 도구 활용의 '진입 단계(시작 화면)' 인정:**
   - Google, ChatGPT, Gemini, Claude, Wikipedia, 혹은 각종 학습/커뮤니티 사이트의 **메인 화면이나 초기 진입 단계**는 본문에 목표 키워드가 없을 수밖에 없음.
   - 본문에 "무엇을 도와드릴까요?", "검색어를 입력하세요", 혹은 단순히 사이트 UI 텍스트만 있더라도, 이는 사용자가 목표를 위해 **정보를 탐색하려는 '준비 및 프로세스' 과정**이므로 절대 감점하지 말고 높은 점수(또는 통과 점수)를 부여해라.
2. **도구 활용 및 확장 학습 전면 허용:**
   - 사용자가 목표 달성을 위해 질문을 던지거나 지식을 정리하는 모든 생산성 툴(AI, 검색엔진, 메모 앱 등)은 수단으로서 무조건 인정함.
   - 목표 주변의 지식을 탐색하거나, 교차 검증을 위해 대체재를 알아보는 행위 역시 정당한 프로세스로 포용할 것.
3. **진짜 '목적 이탈(딴짓)'만 엄격하게 감점:**
   - 사용자가 무언가를 알아내려는 생산적인 탐색 흐름과 완전히 단절된, 순수 도파민성/유흥성 영역(예: 연예 가십 뉴스, 웹툰, 오락용 쇼핑, 순수 오락용 숏폼 등)에 빠졌을 때만 점수를 낮게(1~2점) 책정해라."""),
    
    ("user", """
제공된 [웹페이지 본문]이 [사용자의 목표]를 달성하는 '과정(Process)'에서 필요한 맥락인지 분석하고 채점해줘. 

특히, 본문 내용이 텅 비어 있거나 "무엇을 도와드릴까요?", "검색어 입력" 같은 **초기 도구 진입 화면인 경우, 이는 무언가를 알아내기 위해 도구를 켜는 필연적인 시작 단계**이므로 넓은 시각으로 융통성 있게 인정해 주어야 한다.

[사용자의 목표]
{goal}

[웹페이지 본문]
{text}
""")
])
    
    try:
        formatted_prompt = prompt_template.format(goal=user_goal, text=text_content)
        print("📊 [LLM 송신 프롬프트 검증 (상위 300자)]")
        print(formatted_prompt[:300] + "\n... (이하 본문 생략) ...")
        
        chain = prompt_template | structured_llm
        
        print("⏳ OpenAI API 호출 중... 답장을 기다리는 중...")
        result = chain.invoke({"goal": user_goal, "text": text_content})
        
        print("\n✨ [3. OpenAI 답장 수신 성공!]")
        print(json.dumps(result.model_dump(), indent=2, ensure_ascii=False))
        print("="*60 + "\n")
        
        return result
    except Exception as e:
        print(f"❌ [LangChain 실행 중 에러 발생]: {e}")
        return None

# ==========================================
# 4. API 엔드포인트 수정 및 완공 🛠️
# ==========================================
@app.route('/analyze', methods=['POST'])
def analyze():
    data = request.json
    url = data.get('url')
    page_text = data.get('text')
    page_text = page_text[:1000] if page_text else page_text
    goal = data.get('goal')

    title = data.get('title', '')
    persona = data.get('persona', '교관')
    intensity = data.get('intensity', 3)

    print(f"\n📥 [API 요청 수신] URL: {url}")
    print(f"🎯 유저 현재 목표: {goal}")

    # 1. 확장프로그램이 텍스트를 제대로 주었는지 검증
    if page_text and len(page_text.strip()) >= 10:
        print(f"✅ [안전] 확장프로그램이 직접 추출한 텍스트 사용 ({len(page_text)} 자)")
        final_text = page_text
    else:
        # 2. 만약 텍스트가 안 넘어왔다면 기존 서버 크롤링 함수로 백업 가동
        print("⚠️ [경고] 확장프로그램 텍스트 공백. 서버 자체 크롤링으로 백업 가동합니다.")
        final_text = fast_crawl_webpage(url)

    # 3. 텍스트가 최종적으로도 없다면 10점 처리해서 경고창 안 뜨게 패스시킴 (방어 코드)
    if not final_text:
        print("❌ [패스] 본문 텍스트를 아예 추출할 수 없어 검사를 건너뜁니다.")
        return jsonify({
            "score": 10,
            "reason": "본문을 읽을 수 없는 특수 페이지 혹은 예외 상황입니다.",
            "summary": [],
            "nagging": None,
        }), 200

    # 4. 정제된 텍스트로 LangChain 호출
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

# 캐시 적중 시 판정은 재사용하고 잔소리 텍스트만 새로 뽑는 경량 엔드포인트
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

if __name__ == "__main__":
    app.run(port=5001, debug=True)