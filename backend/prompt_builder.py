"""
페르소나 + 목표 + 페이지 정보 + 판정 사유를 조합해서
LLM에 보낼 최종 프롬프트 문자열을 만든다.
"""
from personas import resolve_persona


def _format_few_shot(few_shot: list[dict]) -> str:
    lines = []
    for ex in few_shot:
        lines.append(
            f"- 목표: \"{ex['goal']}\" / 딴짓: \"{ex['distraction']}\" "
            f"→ 잔소리: \"{ex['nagging']}\""
        )
    return "\n".join(lines)


def build_nagging_prompt(
    goal: str,
    page_title: str,
    persona_input: str,
    intensity: int = 3,
    reason: str = "",
    recent_naggings: list[str] | None = None,
) -> str:
    """
    Args:
        goal: 사용자가 설정한 오늘의 목표
        page_title: 현재 차단 대상 페이지의 제목 (유튜브 영상 제목 등)
        persona_input: 프리셋 키("교관") 또는 사용자가 직접 쓴 자유 텍스트
                       (예: "능글맞은 선배처럼 말해줘")
        intensity: 말투 강도 1~5
        reason: 판정 엔진이 이 페이지를 차단으로 판단한 사유 (judge 파이프라인에서 전달받음)
        recent_naggings: 직전에 이미 사용된 잔소리 목록 (반복 방지용)

    Returns:
        LLM에 그대로 넘길 프롬프트 문자열
    """
    persona = resolve_persona(persona_input)
    few_shot_text = _format_few_shot(persona["few_shot"])
    forbidden_text = ", ".join(persona["forbidden"])

    avoid_repeat_block = ""
    if recent_naggings:
        joined = "\n".join(f"- {t}" for t in recent_naggings)
        avoid_repeat_block = (
            f"\n아래 표현들은 이미 사용했으니 절대 반복하지 말고 다른 표현으로 생성하세요:\n{joined}\n"
        )

    prompt = f"""당신은 '{persona['display_name']}' 페르소나로 사용자에게 잔소리하는 AI입니다.

[말투 규칙]
{persona['tone_instruction']}
말투 강도: {intensity}/5 (숫자가 클수록 더 세고 직설적으로)

[절대 사용 금지]
{forbidden_text}

[페르소나 예시]
{few_shot_text}
{avoid_repeat_block}
[현재 상황]
사용자 목표: "{goal}"
지금 보고 있는 페이지: "{page_title}"
차단 사유: "{reason}"

위 상황에 맞는 잔소리를 1~2문장, {intensity}/5 강도로 생성하세요.
반드시 아래 JSON 형식으로만 응답하고, 다른 설명이나 코드블록 표시는 절대 포함하지 마세요:
{{"text": "생성한 잔소리", "tone_tag": "짧은 감정 태그(예: stern, worried, sassy 등 영문 한 단어)"}}
"""
    return prompt
