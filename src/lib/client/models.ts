/**
 * Models the user can pick between in the chat composer.
 * Keep the list short — Sonnet for everyday work, Opus for hard problems.
 */
export type ModelId = "claude-sonnet-4-6" | "claude-opus-4-8";

export type ModelOption = {
  id: ModelId;
  label: string;
  shortLabel: string;
  description: string;
};

export const MODELS: ModelOption[] = [
  {
    id: "claude-sonnet-4-6",
    label: "Claude Sonnet 4.6",
    shortLabel: "Sonnet",
    description: "빠르고 똑똑한 기본 모델. 대부분의 코딩 작업에 충분합니다.",
  },
  {
    id: "claude-opus-4-8",
    label: "Claude Opus 4.8",
    shortLabel: "Opus",
    description: "가장 강력한 추론. 복잡한 설계·디버깅에 권장 (속도는 느림).",
  },
];

export const DEFAULT_MODEL: ModelId = "claude-sonnet-4-6";

export function isModelId(v: unknown): v is ModelId {
  return MODELS.some((m) => m.id === v);
}

/**
 * 추론 깊이 — 학생에게는 3단계만 노출하고, 모델별 Anthropic effort 레벨로
 * 변환해 보낸다. balanced(=high)는 API 기본값과 같아 기존 동작과 동일하다.
 */
export type EffortId = "fast" | "balanced" | "deep";

/** Anthropic API 의 effort 레벨 (Agent SDK Options.effort 와 동일). */
export type ApiEffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export type EffortOption = {
  id: EffortId;
  label: string;
  description: string;
};

export const EFFORTS: EffortOption[] = [
  {
    id: "fast",
    label: "빠르게",
    description: "간단한 질문·수정에. 응답이 가장 빨라요.",
  },
  {
    id: "balanced",
    label: "보통",
    description: "대부분의 작업에 알맞은 균형 (기본값).",
  },
  {
    id: "deep",
    label: "깊게",
    description: "어려운 문제·설계·디버깅에. 느리지만 꼼꼼해요.",
  },
];

export const DEFAULT_EFFORT: EffortId = "balanced";

export function isEffortId(v: unknown): v is EffortId {
  return EFFORTS.some((e) => e.id === v);
}

// "깊게"는 모델별 최적 레벨이 다르다: xhigh 는 Opus 4.7+ 전용(코딩 권장,
// Claude Code 기본값)이고 Sonnet 에선 high 로 조용히 다운그레이드되므로,
// Sonnet 은 실질 최고 단계인 max 를 쓴다.
const DEEP_LEVEL_BY_MODEL: Record<ModelId, ApiEffortLevel> = {
  "claude-sonnet-4-6": "max",
  "claude-opus-4-8": "xhigh",
};

/** UI 3단계 → 해당 모델의 Anthropic effort 레벨. */
export function effortForModel(
  effort: EffortId,
  model: ModelId,
): ApiEffortLevel {
  if (effort === "fast") return "low";
  if (effort === "deep") return DEEP_LEVEL_BY_MODEL[model];
  return "high";
}
