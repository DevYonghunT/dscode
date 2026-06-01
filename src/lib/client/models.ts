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
