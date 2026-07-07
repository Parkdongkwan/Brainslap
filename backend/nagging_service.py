"""
페르소나 잔소리 생성의 메인 진입점.

judge 파이프라인 담당 팀원은 이 파일의 generate_nagging() 함수 하나만 import해서
자기 /judge 엔드포인트 안에서 호출하면 된다.

    from nagging_service import generate_nagging
    result = generate_nagging(goal, page_title, persona_input, intensity, reason)
    # result = {"text": "...", "tone_tag": "...", "persona": "...", "source": "llm" | "fallback"}

persona_input에는 프리셋 키("교관")를 넘길 수도 있고,
사용자가 직접 입력한 자유 텍스트("능글맞은 선배처럼 말해줘")를 그대로 넘길 수도 있다.
"""
import json
import logging
import random

import config
from history_store import history_store, make_cache_key
from llm_client import call_llm_for_nagging
from personas import resolve_persona
from prompt_builder import build_nagging_prompt

logger = logging.getLogger(__name__)


def _apply_length_cap(text: str) -> str:
    if len(text) <= config.MAX_NAGGING_LENGTH:
        return text
    return text[: config.MAX_NAGGING_LENGTH - 1].rstrip() + "…"


def generate_nagging(
    goal: str,
    page_title: str,
    persona_input: str,
    intensity: int = 3,
    reason: str = "",
) -> dict:
    """
    Returns:
        {
            "text": str,          # 실제로 화면에 띄울 잔소리
            "tone_tag": str,      # UI에서 이모지/애니메이션 매칭용 태그
            "persona": str,       # 사용자가 넘긴 persona_input 그대로 (프리셋 키 또는 자유 텍스트)
            "source": "llm" | "fallback"  # LLM 생성 성공 여부 (모니터링/디버깅용)
        }
    """
    persona = resolve_persona(persona_input)
    cache_key = make_cache_key(goal, page_title, persona_input)
    recent = history_store.get_recent(cache_key)

    prompt = build_nagging_prompt(
        goal=goal,
        page_title=page_title,
        persona_input=persona_input,
        intensity=intensity,
        reason=reason,
        recent_naggings=recent,
    )

    try:
        result = call_llm_for_nagging(prompt, persona_input=persona_input)
        text = _apply_length_cap(result["text"])
        tone_tag = result["tone_tag"]
        source = "llm"
    except (json.JSONDecodeError, ValueError, Exception) as e:
        # 데모 중 파싱 실패로 화면이 깨지는 것을 막기 위한 안전장치.
        # 실제 원인은 로그로만 남기고 사용자에게는 폴백 문구를 보여준다.
        logger.warning("잔소리 생성 실패, 폴백 문구 사용: %s", e)
        text = random.choice(persona["fallback_pool"])
        tone_tag = "fallback"
        source = "fallback"

    history_store.add(cache_key, text)

    return {
        "text": text,
        "tone_tag": tone_tag,
        "persona": persona_input,
        "source": source,
    }
