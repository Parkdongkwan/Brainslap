from flask import Flask, request, jsonify
from flask_cors import CORS

from nagging_service import generate_nagging
from evaluation_service import fast_crawl_webpage, evaluate_with_langchain
from evaluation_cache import evaluation_cache, make_cache_key

app = Flask(__name__)
CORS(app)

BLOCK_THRESHOLD = 5

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

    # 🟢 [2번 캐시 확인] 목표와 URL 조합으로 기존 랭체인 결과가 있는지 체크
    cache_key = make_cache_key(goal, url)
    cached_result = evaluation_cache.get(cache_key)

    if cached_result:
        # 🔥 중요: 2번 캐시는 오직 무거운 AI "평가(점수)" 분석 비용을 아끼기 위함임!
        print(f"⚡ [2번 평가 캐시 적중] LangChain 웹 분석을 스킵합니다. score={cached_result.get('score')}")
        result_dict = dict(cached_result) # 점수와 이유 데이터 스냅샷만 그대로 복사
    else:
        print(f"🆕 [2번 평가 캐시 미스] 랭체인으로 신규 분석을 진행합니다.")
        
        # 텍스트 검증 및 서버 자체 크롤링 백업 가동
        if page_text and len(page_text.strip()) >= 10:
            print(f"✅ [안전] 확장프로그램 추출 텍스트 사용 ({len(page_text)} 자)")
            final_text = page_text
        else:
            print("⚠️ [경고] 확장프로그램 텍스트 공백. 서버 자체 크롤링 백업 가동.")
            final_text = fast_crawl_webpage(url)

        if not final_text:
            print("❌ [패스] 본문 텍스트 추출 실패로 검사를 건너뜁니다.")
            return jsonify({
                "score": 10,
                "reason": "본문을 읽을 수 없는 특수 페이지 혹은 예외 상황입니다.",
                "summary": [],
                "nagging": None,
            }), 200

        # 정제된 텍스트로 LangChain 분석 호출
        analysis_result = evaluate_with_langchain(final_text, goal)

        if not analysis_result:
            return jsonify({"score": 10, "reason": "AI 분석 실패 (서버 에러)", "summary": [], "nagging": None}), 500

        result_dict = analysis_result.model_dump()
        
        # 💾 2번 캐시에는 오직 '순수 분석 결과(점수, 이유)'만 저장 (nagging 문장은 빼고 저장해야 함!)
        evaluation_cache.set(cache_key, result_dict)

    # 🔵 [3번 캐시 작동 구간] 캐시 적중 여부와 상관없이 잔소리 생성기는 무조건 실행!
    # 그래야 history_store를 타고 매번 신선하고 새로운 잔소리 문장이 창조됨
    nagging_result = None
    if result_dict["score"] < BLOCK_THRESHOLD:
        intensity = max(1, min(5, 5 - result_dict["score"]))
        print(f"🗯️ [3번 히스토리 필터 가동] score={result_dict['score']} -> 중복 회피 잔소리 생성")
        
        nagging_result = generate_nagging(
            goal=goal,
            page_title=title or url,
            persona_input=persona,
            intensity=intensity,
            reason=result_dict["reason"],
        )
    else:
        print(f"✅ [통과] score={result_dict['score']} -> 잔소리 없음")

    # 매번 신선하게 조립된 잔소리 묶음을 결합해서 최종 리턴
    result_dict["nagging"] = nagging_result
    return jsonify(result_dict), 200


if __name__ == "__main__":
    app.run(port=5001, debug=True)