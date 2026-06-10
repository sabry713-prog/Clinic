export interface AnswerSourceDto {
  readonly fact_segment: string;
  readonly type: string;
  readonly id: string;
  readonly code: string;
  readonly source_system: string;
  readonly field: string;
}

export interface QAResponseDto {
  readonly interaction_id: string;
  readonly patient_id: string;
  readonly conversation_id: string;
  readonly question: string;
  readonly classification: "ALLOWED" | "REFUSED";
  readonly classifier_confidence: number;
  readonly refusal_category: string | null;
  readonly rule_matches: readonly string[];
  readonly language: string;
  readonly answer_text: string;
  readonly sources: readonly AnswerSourceDto[];
  readonly model_version: string;
  readonly prompt_template_version: string;
  readonly latency_ms: number;
  readonly disclaimer: string;
  readonly blocklist_triggered: boolean;
}

export interface QAInteractionListDto {
  readonly data: readonly QAInteractionSummaryDto[];
  readonly next_cursor: string | null;
  readonly total: number | null;
}

export interface QAInteractionSummaryDto {
  readonly id: string;
  readonly conversation_id: string | null;
  readonly patient_id: string;
  readonly classification: string;
  readonly refusal_category: string | null;
  readonly language: string;
  readonly created_at: string;
  // Note: question_text is intentionally omitted from list view to reduce PHI exposure
}
