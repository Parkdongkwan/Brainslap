"""
같은 (goal, page) 조합에 대해 최근 생성된 잔소리를 기억해두는 인메모리 저장소.
목적: 재방문 시 매번 똑같은 잔소리가 나와서 질리는 것을 방지.

해커톤 규모에서는 dict + 프로세스 메모리로 충분하다.
서버가 여러 대로 스케일 아웃되는 상황이 아니라면 Redis까지는 불필요.
"""
import hashlib
from collections import defaultdict, deque

import config


class HistoryStore:
    def __init__(self, maxlen: int = config.RECENT_HISTORY_SIZE):
        self._store: dict[str, deque] = defaultdict(lambda: deque(maxlen=maxlen))

    def get_recent(self, cache_key: str) -> list[str]:
        return list(self._store[cache_key])

    def add(self, cache_key: str, nagging_text: str) -> None:
        self._store[cache_key].append(nagging_text)


# 앱 전역에서 공유하는 싱글턴 인스턴스
history_store = HistoryStore()


def make_cache_key(goal: str, page_title: str, persona_input: str) -> str:
    """
    judge 파이프라인의 캐시 키 설계와 동일한 원칙(goal+page 조합)을 따른다.
    persona_input이 이제 자유 텍스트일 수 있으므로(길이/특수문자 제각각)
    해시로 정규화해서 키 길이를 일정하게 유지한다.
    """
    raw = f"{persona_input}:{goal}:{page_title}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()
