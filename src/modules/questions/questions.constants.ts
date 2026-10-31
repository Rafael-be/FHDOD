export const QUESTION_POLICY = {
  sector: { scaleMin: 1, scaleMax: 5, lowScoreThreshold: 2 },
  nps: { scaleMin: 0, scaleMax: 10, lowScoreThreshold: 5 },
} as const;

export type QuestionRole = "superuser" | "sector_manager";
