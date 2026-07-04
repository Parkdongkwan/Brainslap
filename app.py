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

# ==========================================
# 0. 환경 변수 및 Flask 초기화
# ==========================================
load_dotenv()
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY")

if not OPENAI_API_KEY:
    raise ValueError("❌ [에러] .env 파일에서 OPENAI_API_KEY를 찾을 수 없습니다.")

app = Flask(__name__)
CORS(app)

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
# 2. 고속 웹 크롤링 함수 (디버깅 프린트 추가)
# ==========================================
def fast_crawl_webpage(url):
    print("\n" + "="*60)
    print(f"🌐 [1. 크롤링 스타트] URL: {url}")
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
        print(f"🔍 [텍스트 앞부분 200자 미리보기]:\n{cleaned_text[:200]}...")
        
        return cleaned_text[:8000]
    except Exception as e:
        print(f"❌ [크롤링 실패 에러 발생]: {e}")
        return None

# ==========================================
# 3. LangChain 평가 함수 (프롬프트 추적 로그 추가)
# ==========================================
def evaluate_with_langchain(text_content, user_goal):
    print("\n" + "-"*60)
    print(f"🤖 [2. LangChain 구동] 유저 목표: {user_goal}")
    print("-"*60)
    
    prompt_template = ChatPromptTemplate.from_messages([
        ("system", "너는 사용자의 목적에 맞춰 웹 콘텐츠를 필터링하고 채점하는 전문 AI 에이전트야. 반드시 주어진 스키마 요구사항에 맞춰 정밀하게 채점해라."),
        ("user", """
제공된 [웹페이지 본문]이 사용자가 이루고자 하는 [사용자의 목표]와 얼마나 일치하고 유용한지 분석해줘.

[사용자의 목표]
{goal}

[웹페이지 본문]
{text}
""")
    ])
    
    try:
        # 🔍 디버깅용: LLM으로 날아가기 직전 완성된 프롬프트 조립 상태를 확인
        formatted_prompt = prompt_template.format(goal=user_goal, text=text_content)
        print("📊 [LLM 송신 프롬프트 검증 (상위 300자)]")
        print(formatted_prompt[:300] + "\n... (이하 본문 생략) ...")
        
        chain = prompt_template | structured_llm
        
        print("⏳ OpenAI API 호출 중... 답장을 기다리는 중...")
        result = chain.invoke({"goal": user_goal, "text": text_content})
        
        print("\n✨ [3. OpenAI 답장 수신 성공!]")
        # Pydantic 객체를 직관적인 JSON 형태로 변환해 터미널에 출력
        print(json.dumps(result.model_dump(), indent=2, ensure_ascii=False))
        print("="*60 + "\n")
        
        return result
    except Exception as e:
        print(f"❌ [LangChain 실행 중 에러 발생]: {e}")
        return None

# ==========================================
# 4. API 엔드포인트 (크롬 요청 수신 로그 추가)
# ==========================================
@app.route('/analyze', methods=['POST'])
def analyze():
    print("\n📥 [크롬 확장 프로그램으로부터 POST 요청 인입]")
    data = request.get_json()
    
    # 전달받은 raw 데이터 출력
    print(f"  - 수신된 JSON 데이터: {data}")
    
    url = data.get('url')
    goal = data.get('goal')
    
    if not url or not goal:
        print("❌ [경고] 크롬이 URL이나 GOAL 데이터 중 일부를 누락하고 보냈습니다.")
        return jsonify({"error": "URL과 목표를 모두 입력해주세요."}), 400
        
    page_text = fast_crawl_webpage(url)
    
    if not page_text or len(page_text) < 30:
        print("⚠️ [주의] 본문이 비어있어 방어용 가짜 텍스트로 대체합니다.")
        page_text = f"이 페이지는 본문 텍스트가 거의 없거나 읽을 수 없는 구조입니다. 주소는 {url} 입니다."
    
    analysis_result = evaluate_with_langchain(page_text, goal)
    
    if analysis_result:
        return jsonify(analysis_result.model_dump())
    else:
        print("❌ [최종 에러] LLM 연산 결과가 넘어오지 않아 500 에러를 리턴합니다.")
        return jsonify({"error": "LLM 분석 실패"}), 500

if __name__ == "__main__":
    app.run(port=5000, debug=True)