# BrainSlap 통합 v1.2 — 개입 파트 × 페르소나 파트 × 판정 파트

> 담당: 사용자 행동 제어 및 개입 메커니즘
> 이번 변경: 페르소나 파트의 실제 잔소리 파이프라인(/analyze·/nagging) 위에
> 개입 10종 전체를 배선. INTEGRATION_SNIPPETS.md의 "아직 연결 안 한 부분" 해소.

## 파일 변경 요약

| 파일 | 상태 | 내용 |
|---|---|---|
| `content/interventions.js` | **수정 (내 파트)** | 페르소나 한글 키 5종+자유입력 대응, 백엔드 잔소리(ctx.nag)를 메인 대사로 사용, 읽씹 시 강도+1 재생성 요청 |
| `background.js` | **수정** | 페르소나 파트의 흐름(제목/persona/intensity 전송, 캐시 적중 시 /nagging 재생성) 100% 유지. `triggerOverlay` → `dispatchIntervention`(개입 추첨) 교체 + 세션·보상·NAG 프록시 추가(★ 구간) |
| `popup.html` / `popup.js` | **수정** | 페르소나 파트 UI(목표·페르소나 6칩·강도 슬라이더·토글) 원형 유지 + 방해요소 풀·집중 세션·포인트 표시 병합. persistSettings 패턴 유지 |
| `manifest.json` | **수정** | `content_scripts`(정적 등록) + `alarms` 권한 |
| `app.py` + 파이썬 모듈 전부 | **무수정** | 페르소나 파트 소유 — 그대로 사용 |
| `content.js` / `content.css` | **미사용 처리** | DM 단일 모듈 이식판 — interventions.js의 DM 모듈(알림→채팅→읽씹 점령 3단)이 대체. 파일은 참고용으로 보존, background가 더 이상 주입하지 않음 |

## 잔소리 파이프라인 연결 방식 (페르소나 파트 확인 요청)

- `/analyze` 응답의 `nagging.text` → `BRAINSLAP_BLOCK` 페이로드의 `nag` 필드로 전달
- 개입 UI에서의 사용처: 도망 버튼 카드의 메인 문구 / DM 첫 말풍선·알림 미리보기 / 알림 폭탄 최후통첩
- **읽씹 에스컬레이션**: DM을 읽씹하면 content가 `BRAINSLAP_REQUEST_NAG`(intensityBoost:1) →
  background가 `/nagging` 재호출 → **히스토리 저장소 덕분에 매번 새로운, 더 센 잔소리**가 옴.
  페르소나 파트가 만든 반복 방지 구조를 개입 강도 에스컬레이션에 그대로 활용한 것.
- 자유 입력 페르소나: 백엔드 잔소리는 그대로 반영되고, 로컬 전용 대사(도주 멘트 등)는 중립 GENERIC 템플릿 사용
- `tone_tag`는 페이로드에 전달만 해둠 — 추후 이모지/애니메이션 매칭에 사용 가능

## 메시지 프로토콜 v1.2

| 방향 | type | 비고 |
|---|---|---|
| BG → CS | `BRAINSLAP_BLOCK` | +`nag`, `toneTag`, `intensity`, `title` 필드 추가 |
| BG → CS | `BRAINSLAP_SESSION_RESULT` | perfect / baseReward / jackpot |
| CS → BG | `BRAINSLAP_REQUEST_NAG` | 🆕 잔소리 재생성 프록시 (읽씹 페널티 강도+1) |
| CS → BG | `CLOSE_TAB` / `BRAINSLAP_CLOSE_TAB` | 둘 다 처리 (페르소나 파트 프로토콜 호환) |
| CS → BG | `BRAINSLAP_EVENT` | 개입 행동 로그 — 통계 파트 연동 대기 |

## 테스트 순서

1. `.env`에 `LLM_PROVIDER=openai` (키 없으면 `mock` 으로도 전체 흐름 테스트 가능 — 페르소나 파트가 만들어둔 기능)
2. `python app.py` → 확장 새로고침(`chrome://extensions`)
3. popup: 목표 입력 → 페르소나/강도 선택 → 방해 요소 체크 → 감시 시작
4. 목표와 무관한 페이지 5초 체류 → 추첨된 개입 + **실제 LLM 잔소리** 확인
5. DM 개입에서 알림 16초 방치 → 화면 점령 + 강도+1 새 잔소리 확인
6. 같은 페이지 재방문(캐시 적중) → 판정 재사용 + 잔소리만 새 문장인지 확인

## 남은 TODO (팀 회의 안건)

- [ ] streak(연속 출석) 갱신 로직 — 보상 파트와 스키마 협의
- [ ] `BRAINSLAP_EVENT` 서버 적재 → 개입 효과 통계
- [ ] 잭팟 추첨 서버 사이드 이전 (포인트 어뷰징 방지)
- [ ] 판정 점수 구간별 개입 강도 매핑 (예: 3~4점 소프트 / 0~2점 하드) — INTEGRATION_SNIPPETS 3번 제안 반영
- [ ] 협상 휴식 타이머의 페이지 이동 생존 (background alarm 이전)
