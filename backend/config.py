"""
환경 변수 및 전역 설정.
.env 파일에 API 키를 넣어두고 여기서 불러온다.
"""
import os
from dotenv import load_dotenv

load_dotenv()

# 어떤 LLM을 쓸지: "anthropic" 또는 "openai"
LLM_PROVIDER = os.getenv("LLM_PROVIDER", "anthropic")

ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
OPENAI_API_KEY = os.getenv("OPENAI_API_KEY", "")

# 모델명 (필요시 팀 상황에 맞게 교체)
ANTHROPIC_MODEL = os.getenv("ANTHROPIC_MODEL", "claude-sonnet-4-6")
OPENAI_MODEL = os.getenv("OPENAI_MODEL", "gpt-4o-mini")

# 잔소리는 판정(score)과 달리 매번 다르게 나와야 하므로 temperature를 높게 설정
NAGGING_TEMPERATURE = float(os.getenv("NAGGING_TEMPERATURE", "0.9"))
NAGGING_MAX_TOKENS = int(os.getenv("NAGGING_MAX_TOKENS", "300"))

# 같은 (goal, page) 조합에 대해 최근 몇 개의 잔소리를 "반복 금지 목록"으로 기억할지
RECENT_HISTORY_SIZE = int(os.getenv("RECENT_HISTORY_SIZE", "3"))

# 잔소리 텍스트 최대 길이 (UI 말풍선 깨짐 방지용 하드 컷)
MAX_NAGGING_LENGTH = int(os.getenv("MAX_NAGGING_LENGTH", "120"))
