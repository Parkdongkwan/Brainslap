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
    page_text = data.get('text')  # 👈 확장프로그램이 안전하게 긁어다 준 텍스트
    page_text = page_text[:1000]
    goal = data.get('goal')

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
            "summary": []
        }), 200

    # 4. 정제된 텍스트로 LangChain 호출
    analysis_result = evaluate_with_langchain(final_text, goal)

    if analysis_result:
        # Pydantic 객체를 딕셔너리로 변환하여 전송 (JSON 직렬화 가능)
        return jsonify(analysis_result.model_dump()), 200
    else:
        return jsonify({"score": 10, "reason": "AI 분석 실패 (서버 에러)", "summary": []}), 500

if __name__ == "__main__":
    app.run(port=5000, debug=True)