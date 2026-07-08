"""
같은 (goal, url) 조합에 대한 평가 결과(judge)를 기억해두는 인메모리 캐시.
목적: 재방문 시 매번 LLM을 새로 호출하지 않고 캐시된 판정(score/reason/summary)을 재사용.

TTL(초)이 지나면 캐시가 자동으로 무효화된다.
같은 URL이라도 시간이 지나면 페이지 내용(뉴스, 피드 등)이 바뀔 수 있기 때문에
history_store처럼 무기한 보관하지 않고 만료 시간을 둔다.

해커톤 규모에서는 dict + 프로세스 메모리로 충분하다.
서버가 여러 대로 스케일 아웃되는 상황이 아니라면 Redis까지는 불필요.
"""
import hashlib
import time

# config.py에 EVALUATION_CACHE_TTL 값이 없다면 아래 기본값(초)을 사용
try:
    import config
    DEFAULT_TTL = getattr(config, "EVALUATION_CACHE_TTL", 1800)
except ImportError:
    DEFAULT_TTL = 300


class EvaluationCache:
    def __init__(self, ttl_seconds: int = DEFAULT_TTL):
        self._store: dict[str, tuple[float, dict]] = {}
        self._ttl = ttl_seconds

    def get(self, cache_key: str) -> dict | None:
        entry = self._store.get(cache_key)
        if not entry:
            return None

        timestamp, result = entry
        if time.time() - timestamp > self._ttl:
            # 만료된 캐시는 제거하고 미스 처리
            del self._store[cache_key]
            return None

        return result

    def set(self, cache_key: str, result: dict) -> None:
        self._store[cache_key] = (time.time(), result)


# 앱 전역에서 공유하는 싱글턴 인스턴스
evaluation_cache = EvaluationCache()


def make_cache_key(goal: str, url: str) -> str:
    """
    (goal, url) 조합으로 캐시 키를 만든다.
    persona_input은 판정(score/reason/summary) 자체와는 무관하므로 키에 포함하지 않는다.
    (persona별 잔소리 캐싱은 history_store의 make_cache_key가 별도로 담당)
    """
    raw = f"{goal}:{url}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()