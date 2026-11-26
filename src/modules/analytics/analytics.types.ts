export interface AnalyticsFilter {
  from: string;
  to: string;
  sectorId?: number;
  sectorIds?: number[];
  shiftRangeId?: number;
}

interface ScoreBucket {
  score: number;
  responses: number;
}

interface Satisfaction {
  responses: number;
  mean: number | null;
  distribution: (ScoreBucket & { percentage: number })[];
}

export interface GlobalQuestionMetric extends Satisfaction {
  questionId: number;
  questionVersionId: number;
  isNps: boolean;
  text: string;
  publishedSectorIds: number[];
  sectors: (Satisfaction & { sectorId: number })[];
}

export interface SectorHeatmapMetric {
  sectorId: number; satisfactionMean: number | null; npsMean: number | null;
  positivePercentage: number | null; completionRate: number | null;
  responses: number; npsResponses: number; started: number; completed: number;
}
export interface QuestionDistributionMetric {
  questionId: number; questionVersionId: number; text: string; position: number;
  mean: number | null; responses: number; skipped: number;
  distribution: { score: number; responses: number }[];
}
export interface CriticalQuestionMetric {
  sectorId: number; questionId: number; questionVersionId: number;
  text: string; mean: number; responses: number;
}

export interface Dashboard {
  sessions: {
    started: number;
    complete: number;
    incomplete: number;
    closedIncomplete: number;
    inProgress: number;
    endedOrExpired: number;
    unknownDeadline: number;
    completionRate: number | null;
    nonCompletionRate: number | null;
  };
  nps: { responses: number; detractors: number; passives: number; promoters: number; value: number | null };
  shifts: { id: number; name: string; sector_id: number; completed: number; percentage: number | null }[];
  unclassifiedCompleted: number;
  questions: { question_id: number; question_version_id: number; is_nps: boolean; responses: number; skipped: number; mean: number | null }[];
  distribution: (ScoreBucket & { is_nps: boolean })[];
  daily: { day: string; started: number; complete: number }[];
  dailyAnswers: { day: string; mean: number | null; nps_responses: number; nps: number | null }[];
  sectors: { sector_id: number; started: number; complete: number }[];
  ombudsman: { sector_id: number; ticket_type: string; status: string; tickets: number }[];
  responseRate: null;
  teamAttributionAvailable: false;
  timeZone: string;
  privacyNotice: string;
}
