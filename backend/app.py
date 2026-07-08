from flask import Flask, request, jsonify
from flask_cors import CORS

from nagging_service import generate_nagging
from evaluation_service import fast_crawl_webpage, evaluate_with_langchain
from evaluation_cache import evaluation_cache, make_cache_key

# ==========================================
# 0. Flask 초기화
# ==========================================
app = Flask(__name__)
CORS(app)

# 🔽 딴짓 판정 기준 점수 (10점 만점, 이 미만이면 잔소리 생성)
# background.js의 score < 5 기준과 반드시 동일하게 유지
BLOCK_THRESHOLD = 5

# ==========================================
# 1. API 엔드포인트
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

    print(f"\n📥 [API 요청 수신] URL: {url}")
    print(f"🎯 유저 현재 목표: {goal}")

    # 0. (goal, url) 조합으로 캐시 확인 -> 히트 시 LLM 호출 없이 재사용
    cache_key = make_cache_key(goal, url)
    cached_result = evaluation_cache.get(cache_key)

    if cached_result:
        print(f"⚡ [캐시 적중] 평가를 재사용합니다. key={cache_key[:8]}... score={cached_result.get('score')}")
        result_dict = dict(cached_result)
    else:
        print(f"🆕 [캐시 미스] 새로 평가합니다. key={cache_key[:8]}...")
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
        evaluation_cache.set(cache_key, result_dict)

    # 🔽 점수가 기준 미만이면 페르소나 잔소리 생성
    # intensity(1~5)는 score(0~4, BLOCK_THRESHOLD 미만 구간)에 반비례하게 계산:
    # score가 낮을수록(더 심하게 딴짓 중) 더 세게 잔소리
    nagging_result = None
    if result_dict["score"] < BLOCK_THRESHOLD:
        intensity = max(1, min(5, 5 - result_dict["score"]))
        print(f"🗯️ [잔소리 생성] score={result_dict['score']} -> intensity={intensity}")
        nagging_result = generate_nagging(
            goal=goal,
            page_title=title or url,
            persona_input=persona,
            intensity=intensity,
            reason=result_dict["reason"],
        )
    else:
        print(f"✅ [통과] score={result_dict['score']} (BLOCK_THRESHOLD={BLOCK_THRESHOLD} 이상) -> 잔소리 없음")

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