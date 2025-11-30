import { STOPWORDS_PT_BR, STOPWORDS_EN_US, NORMATIVE_PROFILES } from '../constants';
import { Keypoint, KeypointResult, NormativeProfile, SessionResult, TestInstance } from '../types';

// Helper: Tokenize and clean text
const tokenize = (text: string, language: string): string[] => {
  const normalized = text
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "") // Remove accents
    .replace(/[^\w\s]/g, ""); // Remove punctuation

  const tokens = normalized.split(/\s+/).filter(t => t.length > 0);
  
  const stopwords = language === 'en-US' ? STOPWORDS_EN_US : STOPWORDS_PT_BR;
  
  // Filter stopwords and very short words (keep only significant lexical tokens)
  return tokens.filter(t => !stopwords.has(t) && t.length > 2);
};

// Helper: Calculate overlap
const calculateMatch = (recallTokens: string[], keypointTokens: string[]): { hit: boolean; matches: string[] } => {
  const matches = keypointTokens.filter(kt => recallTokens.includes(kt));
  const uniqueMatches = Array.from(new Set(matches)); // Count unique token matches
  
  // Rule: Hit if >= 30% coverage of keypoint tokens OR >= 2 distinct strong tokens found
  const coverageRatio = matches.length / keypointTokens.length;
  const hit = coverageRatio >= 0.35 || uniqueMatches.length >= 2;

  return { hit, matches: uniqueMatches };
};

export const scoreSession = (
  test: TestInstance,
  recallText: string,
  actualReadTimeSec: number,
  previousSession?: SessionResult
): SessionResult => {
  const recallTokens = tokenize(recallText, test.language);
  
  // 1. Score Keypoints
  const keypointResults: KeypointResult[] = test.keypoints.map(kp => {
    // Ensure keypoint is tokenized if not already (though we store it tokenized in setup, doing it here ensures consistency)
    const kpTokens = tokenize(kp.text, test.language); 
    const { hit, matches } = calculateMatch(recallTokens, kpTokens);
    
    return {
      keypoint_id: kp.id,
      text: kp.text,
      hit,
      matched_tokens: matches
    };
  });

  const hitCount = keypointResults.filter(k => k.hit).length;
  const coveragePct = (hitCount / test.keypoints.length) * 100;

  // 2. Normative Comparison
  const profile = NORMATIVE_PROFILES.find(p => p.id === test.normative_profile_id);
  
  let zCoverage = 0;
  let rciCoverage = undefined;
  let qualitativeLabel = "Dados normativos indisponíveis";
  let zWpm = undefined;

  // Calculate effective WPM
  // Avoid division by zero
  const safeTime = actualReadTimeSec < 5 ? 5 : actualReadTimeSec; 
  // Word count estimate (standard: space delimited)
  const passageWordCount = test.passage.trim().split(/\s+/).length;
  const wpmEffective = Math.round((passageWordCount / safeTime) * 60);

  if (profile) {
    // Z-Score Coverage
    // Z = (Score - Mean) / SD
    zCoverage = (coveragePct - profile.mean_coverage) / profile.sd_coverage;
    
    // Z-Score Speed
    zWpm = (wpmEffective - profile.mean_wpm) / profile.sd_wpm;

    // Qualitative Label based on Z-Score
    if (zCoverage >= -1.0) qualitativeLabel = "Dentro da faixa esperada";
    else if (zCoverage >= -2.0) qualitativeLabel = "Levemente reduzido";
    else qualitativeLabel = "Abaixo do esperado";

    // RCI Calculation (if previous session exists)
    // Sdiff = SD * sqrt(2 * (1 - rxx))
    // RCI = (X2 - X1) / Sdiff
    if (previousSession) {
      const sDiff = profile.sd_coverage * Math.sqrt(2 * (1 - profile.reliability_coverage));
      const diff = coveragePct - previousSession.coverage_pct;
      rciCoverage = diff / sDiff;
    }
  }

  return {
    session_id: crypto.randomUUID(),
    test_id: test.id,
    normative_profile_id: test.normative_profile_id,
    recall_text: recallText,
    coverage_pct: coveragePct,
    z_coverage: Number(zCoverage.toFixed(2)),
    wpm_effective: wpmEffective,
    z_wpm: zWpm ? Number(zWpm.toFixed(2)) : undefined,
    rci_coverage: rciCoverage ? Number(rciCoverage.toFixed(2)) : undefined,
    created_at: new Date().toISOString(),
    keypoint_results: keypointResults,
    qualitative_label: qualitativeLabel
  };
};

// Helper for UI to format tokens for display (for dev/audit mostly)
export const getKeypointTokens = (text: string, lang: string) => tokenize(text, lang);