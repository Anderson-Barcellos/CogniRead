export type Complexity = 'neutral' | 'dense';
export type Language = 'pt-BR' | 'en-US' | 'es-ES';

export interface NormativeProfile {
  id: string;
  label: string;
  language: Language;
  mean_wpm: number;
  sd_wpm: number;
  mean_coverage: number; // Percentage 0-100
  sd_coverage: number;
  reliability_coverage: number; // Cronbach's alpha or similar (rxx)
}

export interface TestConfig {
  language: Language;
  topic: string;
  complexity: Complexity;
  target_read_time_sec: number;
  use_calibrated_wpm: boolean;
  user_calibrated_wpm?: number;
  normative_profile_id: string;
}

export interface Keypoint {
  id: number;
  text: string;
  tokens: string[]; // Core tokens for matching
}

export interface TestInstance {
  id: string;
  language: Language;
  topic: string;
  complexity: Complexity;
  passage: string;
  keypoints: Keypoint[];
  target_words: number;
  allowed_time_sec: number;
  normative_profile_id: string;
  created_at: string;
}

export interface KeypointResult {
  keypoint_id: number;
  text: string;
  hit: boolean;
  matched_tokens: string[];
}

export interface SessionResult {
  session_id: string;
  test_id: string;
  normative_profile_id: string;
  recall_text: string;
  coverage_pct: number;
  z_coverage: number;
  wpm_effective: number;
  z_wpm?: number;
  rci_coverage?: number; // Reliable Change Index compared to previous session
  created_at: string;
  keypoint_results: KeypointResult[];
  qualitative_label: string;
}

export enum AppState {
  SETUP,
  GENERATING,
  READING,
  RECALL,
  SCORING,
  RESULTS,
  HISTORY
}