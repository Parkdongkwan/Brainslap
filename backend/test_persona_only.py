"""
app.py(판정 로직)를 켜지 않고, 페르소나 잔소리 생성 부분만 단독으로 테스트하는 스크립트.
OpenAI 키가 없어도 .env에 LLM_PROVIDER=mock 이면 바로 동작한다.

실행:
    python test_persona_only.py
"""
from nagging_service import generate_nagging

TEST_CASES = [
    {"goal": "백준 미로 탐색 파이썬으로 풀기", "title": "아이브 직캠 4K", "reason": "학습 목표와 무관한 콘텐츠"},
    {"goal": "토익 900 달성", "title": "요즘 유행하는 릴스 모음", "reason": "영어 학습과 무관한 SNS 콘텐츠"},
]

PERSONAS_TO_TEST = ["교관", "엄마", "사극_왕장군", "능글맞은 선배처럼 말해줘"]

for persona in PERSONAS_TO_TEST:
    print(f"\n===== 페르소나: {persona} =====")
    for case in TEST_CASES:
        result = generate_nagging(
            goal=case["goal"],
            page_title=case["title"],
            persona_input=persona,
            intensity=4,
            reason=case["reason"],
        )
        print(f"[{result['source']}] {result['text']}  (tone={result['tone_tag']})")
