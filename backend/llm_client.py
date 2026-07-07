"""
실제 LLM API(Claude/OpenAI)를 호출하고, JSON 응답을 안전하게 파싱하는 래퍼.
provider 전환만으로 백엔드를 바꿀 수 있도록 인터페이스를 통일한다.

API 키가 아직 없다면 config.LLM_PROVIDER=mock 으로 두고 개발을 진행할 수 있다.
이 경우 실제 LLM을 호출하지 않고 personas.py의 few_shot 예시를 살짝 변형해서
그럴듯한 응답을 흉내낸다. 캐싱/반복방지/API 스키마/익스텐션 연동을 미리 다
테스트해볼 수 있고, 나중에 키가 생기면 .env의 LLM_PROVIDER만 바꾸면 된다.
"""
import json
import random
import re

import config
from personas import PERSONAS, resolve_persona


def _strip_code_fence(text: str) -> str:
    """LLM이 ```json ... ``` 형태로 감싸서 응답하는 경우 대비."""
    text = text.strip()
    text = re.sub(r"^```json\s*|^```\s*|```$", "", text, flags=re.MULTILINE).strip()
    return text


def _call_anthropic(prompt: str) -> str:
    from anthropic import Anthropic

    client = Anthropic(api_key=config.ANTHROPIC_API_KEY)
    response = client.messages.create(
        model=config.ANTHROPIC_MODEL,
        max_tokens=config.NAGGING_MAX_TOKENS,
        temperature=config.NAGGING_TEMPERATURE,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.content[0].text


def _call_openai(prompt: str) -> str:
    from openai import OpenAI

    client = OpenAI(api_key=config.OPENAI_API_KEY)
    response = client.chat.completions.create(
        model=config.OPENAI_MODEL,
        max_tokens=config.NAGGING_MAX_TOKENS,
        temperature=config.NAGGING_TEMPERATURE,
        messages=[{"role": "user", "content": prompt}],
    )
    return response.choices[0].message.content


def _call_mock(persona_input: str) -> str:
    """
    API 키 없이 개발할 때 쓰는 가짜 응답기.
    - 프리셋이면 few_shot 예시를 그대로 재활용
    - 자유 입력이면 GENERIC_FEW_SHOT 예시에 persona_input을 끼워 넣어 흉내
    실제 LLM 호출 없이 JSON 문자열 형태로 반환한다 (실제 응답 포맷을 그대로 흉내냄).
    """
    persona = resolve_persona(persona_input)
    example = random.choice(persona["few_shot"])
    tone_tags = ["stern", "worried", "sassy", "firm", "playful"]

    if persona_input in PERSONAS:
        # 프리셋인 경우 그대로 사용
        text = example["nagging"]
    else:
        # 자유 입력인 경우, 어떤 페르소나 설명이 들어갔는지 눈으로 확인할 수 있게 표시
        text = f"[{persona_input}] {example['nagging']}"

    fake_response = {"text": text, "tone_tag": random.choice(tone_tags)}
    return json.dumps(fake_response, ensure_ascii=False)


def call_llm_for_nagging(prompt: str, persona_input: str = "교관") -> dict:
    """
    Returns:
        {"text": str, "tone_tag": str} 형태. 파싱 실패 시 raise ValueError
        (호출부인 nagging_service.py에서 폴백 처리)

    Args:
        persona_input: mock 모드에서만 사용 (프리셋 키 또는 자유 입력 텍스트)
    """
    if config.LLM_PROVIDER == "mock":
        raw = _call_mock(persona_input)
    elif config.LLM_PROVIDER == "anthropic":
        raw = _call_anthropic(prompt)
    elif config.LLM_PROVIDER == "openai":
        raw = _call_openai(prompt)
    else:
        raise ValueError(f"알 수 없는 LLM_PROVIDER: {config.LLM_PROVIDER}")

    cleaned = _strip_code_fence(raw)
    parsed = json.loads(cleaned)  # 실패하면 json.JSONDecodeError -> 호출부에서 catch

    if "text" not in parsed:
        raise ValueError("LLM 응답에 'text' 필드가 없습니다.")

    return {
        "text": parsed["text"],
        "tone_tag": parsed.get("tone_tag", "neutral"),
    }
