import { NormativeProfile } from './types';

// Portuguese stopwords for scoring logic
export const STOPWORDS_PT_BR = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas', 'por', 'pelo', 'pela', 'pelos', 'pelas',
  'para', 'com', 'sem', 'sob', 'sobre', 'ante', 'até',
  'e', 'ou', 'mas', 'nem', 'que', 'se', 'como',
  'eu', 'tu', 'ele', 'ela', 'nós', 'vós', 'eles', 'elas',
  'me', 'te', 'se', 'nos', 'vos', 'lhe', 'lhes',
  'meu', 'teu', 'seu', 'nosso', 'vosso',
  'ser', 'estar', 'ter', 'haver', 'fazer', 'ir',
  'foi', 'era', 'é', 'são', 'está', 'estão',
  'isso', 'aquilo', 'isto', 'esse', 'essa', 'este', 'esta',
  'muito', 'pouco', 'mais', 'menos', 'tão'
]);

// English stopwords (basic set)
export const STOPWORDS_EN_US = new Set([
  'a', 'an', 'the', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by',
  'and', 'or', 'but', 'is', 'are', 'was', 'were', 'be', 'been',
  'i', 'you', 'he', 'she', 'it', 'we', 'they',
  'this', 'that', 'these', 'those'
]);

// Normative Profiles
export const NORMATIVE_PROFILES: NormativeProfile[] = [
  {
    id: 'adult_high_performance',
    label: 'Adulto (Alto Desempenho) - 39 anos / QI ~132',
    language: 'pt-BR',
    mean_wpm: 250, // Leitura rápida e eficiente
    sd_wpm: 40,
    mean_coverage: 80.0, // Alta retenção esperada
    sd_coverage: 10.0,
    reliability_coverage: 0.85
  },
  {
    id: 'adult_pt_br_general',
    label: 'Adulto Geral (pt-BR) - Piloto',
    language: 'pt-BR',
    mean_wpm: 180,
    sd_wpm: 30,
    mean_coverage: 65.0, 
    sd_coverage: 15.0,
    reliability_coverage: 0.80
  },
  {
    id: 'elderly_pt_br_general',
    label: 'Idoso >65 anos (pt-BR) - Piloto',
    language: 'pt-BR',
    mean_wpm: 140,
    sd_wpm: 25,
    mean_coverage: 50.0,
    sd_coverage: 12.0,
    reliability_coverage: 0.75
  },
  {
    id: 'adult_en_us_general',
    label: 'General Adult (en-US) - Pilot',
    language: 'en-US',
    mean_wpm: 230,
    sd_wpm: 40,
    mean_coverage: 65.0,
    sd_coverage: 15.0,
    reliability_coverage: 0.80
  }
];

export const DEFAULT_TOPICS = [
  "Neuroplasticidade e aprendizado motor",
  "O impacto do microbioma intestinal na saúde mental",
  "Entropia e a segunda lei da termodinâmica",
  "Mecanismos de edição genética CRISPR-Cas9",
  "Matéria escura e a expansão do universo",
  "Epigenética e herança transgeracional",
  "Computação quântica e criptografia",
  "A hipótese de Gaia e regulação planetária",
  "Fusão nuclear como fonte de energia limpa",
  "O papel dos telômeros no envelhecimento celular"
];