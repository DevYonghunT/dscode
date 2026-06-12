# 추론 깊이(Reasoning Effort) 선택 기능 설계

날짜: 2026-06-10 · 승인: 사용자 확인 완료

## 목표

채팅 컴포저의 모델 선택(Sonnet/Opus)에 더해, 학생이 추론 깊이를 3단계로
선택할 수 있게 한다. 맥/윈도우 데스크톱 앱 공통(같은 Next.js 코드베이스).

## 단계 정의

| UI 라벨 | id | Sonnet 4.6 | Opus 4.8 | 용도 |
|---|---|---|---|---|
| 빠르게 | `fast` | `low` | `low` | 간단한 질문·수정, 최단 응답 |
| 보통 (기본) | `balanced` | `high` | `high` | 대부분의 작업 |
| 깊게 | `deep` | `max` | `xhigh` | 어려운 문제·설계·디버깅 |

- "깊게" 모델별 매핑 이유: `xhigh`는 Opus 4.7+ 전용(코딩 권장, Claude Code
  기본값)이고 Sonnet에선 `high`로 조용히 다운그레이드되므로, Sonnet은 실질
  최고 단계인 `max`를 쓴다.
- 기본값 `balanced`(=`high`)는 Anthropic API 기본값과 동일 → 기존 동작 불변.

## 데이터 흐름 (모델 선택과 동일 경로)

1. `src/lib/client/models.ts` — `EffortId` 타입, `EFFORTS` 목록(라벨/설명),
   `DEFAULT_EFFORT`, `isEffortId()`, `effortForModel(effort, model)` 매핑.
2. `src/app/page.tsx` — `effort` 상태 + `dscode_effort` localStorage 저장/복원.
3. `src/components/Chat.tsx` — `effort`/`onChangeEffort` props 전달.
4. `src/components/ModelPicker.tsx` — 팝오버 하단에 "추론 깊이" 섹션(3옵션).
   알약 버튼은 기본값이 아닐 때만 `Sonnet · 깊게` 형태로 표기.
5. `src/hooks/useChat.ts` — `effort`를 POST /api/chat body에 포함.
6. `src/app/api/chat/route.ts` — `isEffortId` 검증 후 `effortForModel`로
   API 레벨 변환, `runAgent`에 전달. 잘못된 값·미지원 모델은 무시(기본 high).
7. `src/lib/agent.ts` — `RunAgentOptions.effort` 추가, `options.effort`로
   Agent SDK에 전달 (SDK 0.3.159 `Options.effort` 네이티브 지원 확인됨).

## 안전장치

- 서버는 알 수 없는 effort/model 값이면 effort를 보내지 않음(API 기본 high).
- SDK 자체도 모델 미지원 레벨을 자동 다운그레이드(이중 안전).

## 검증

- `pnpm lint` + `pnpm build`(타입 체크) 통과.
- code-reviewer 에이전트 리뷰.
- 데스크톱 반영은 `pnpm dist:mac` / `dist:win` 재빌드.
