import { GoogleGenAI, Type, Schema } from "@google/genai";
import { Keypoint, Complexity, Language } from '../types';

// Initialize the API client
const getClient = () => {
  const apiKey = process.env.API_KEY; 
  if (!apiKey) {
     throw new Error("API Key not found in environment variables");
  }
  return new GoogleGenAI({ apiKey });
};

export const generateTestContent = async (
  topic: string,
  language: Language,
  complexity: Complexity,
  targetWords: number
): Promise<{ passage: string; keypoints: string[] }> => {
  const ai = getClient();
  
  // Using 'gemini-2.5-flash' for optimal speed in generation and extraction.
  const modelName = 'gemini-2.5-flash';

  const prompt = `
    Atue como um redator acadêmico especializado e psicometrista.
    
    Tarefa Principal:
    1. Escreva um texto científico contínuo e coeso sobre o tema: "${topic}".
       - Idioma: ${language}.
       - Complexidade: ${complexity === 'dense' ? 'DENSA (vocabulário acadêmico rico, conectores lógicos complexos, maior abstração)' : 'NEUTRA (informativo, claro, jornalístico)'}.
       - Tamanho alvo: Aproximadamente ${targetWords} palavras.
       - Formato: Parágrafos fluídos. NÃO faça lista de tópicos no texto principal.
    
    Tarefa Secundária:
    2. Extraia exatamente 6 pontos-chave (frases curtas e factuais) que estejam EXPLICITAMENTE presentes no texto que você acabou de escrever.
       - Estes pontos servirão como gabarito para teste de memória.
  `;

  const responseSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      passage: {
        type: Type.STRING,
        description: "O texto científico completo gerado."
      },
      keypoints: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Lista de exatos 6 pontos-chave encontrados no texto gerado."
      }
    },
    required: ["passage", "keypoints"]
  };

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: responseSchema,
        temperature: 0.7
      }
    });

    const jsonResult = JSON.parse(response.text || "{}");
    
    const passage = jsonResult.passage?.trim() || "";
    const keypoints = jsonResult.keypoints || [];

    if (!passage || keypoints.length === 0) {
      throw new Error("Falha ao gerar conteúdo estruturado corretamente.");
    }
    
    return {
      passage,
      keypoints
    };

  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};

/**
 * Uses Gemini Flash to clean up spoken text (STT post-processing).
 * Removes stutters, repetitions, and filler words without changing the meaning.
 */
export const refineTranscription = async (rawText: string): Promise<string> => {
  const ai = getClient();
  const modelName = 'gemini-2.5-flash';

  const prompt = `
    Você é um editor de texto especializado em transcrições de fala para texto.
    
    Tarefa: Reescreva o texto abaixo, que foi ditado por um usuário tentando lembrar de um texto lido.
    Objetivo: Remover hesitações (é, hum, tipo), repetições involuntárias e erros gramaticais leves de concordância causados pela fala.
    Regra Crítica: NÃO adicione informações, NÃO invente fatos e NÃO resuma. Mantenha exatamente as ideias que o usuário expressou, apenas tornando o texto fluido e escrito corretamente.
    
    Texto Original: "${rawText}"
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: { temperature: 0.3 }
    });
    return response.text?.trim() || rawText;
  } catch (e) {
    console.error("Transcription refinement failed", e);
    return rawText; // Fallback to raw text
  }
};

/**
 * Uses Gemini 3 Pro for deep clinical analysis of the recall.
 */
export const generateClinicalAnalysis = async (
  originalPassage: string,
  userRecall: string,
  keypoints: string[]
): Promise<string> => {
  const ai = getClient();
  // Using the smarter model for qualitative analysis
  const modelName = 'gemini-3-pro-preview';

  const prompt = `
    Atue como um neuropsicólogo sênior avaliando um teste de memória de prosa (similar ao Rivermead ou Logical Memory).

    Texto Original Lido pelo Paciente:
    "${originalPassage}"

    Pontos-Chave Esperados:
    ${JSON.stringify(keypoints)}

    Relato do Paciente (Evocação):
    "${userRecall}"

    Tarefa: Forneça um feedback clínico curto (máximo 3 frases) e direto sobre a qualidade da evocação.
    Analise:
    1. Acurácia factual (o paciente inventou informações/confabulações?).
    2. Sequenciamento lógico (as ideias estão na ordem correta?).
    3. Detalhes vs. Generalização (ele lembrou de detalhes específicos ou apenas o tema geral?).
    
    Responda em tom profissional e acolhedor, dirigindo-se ao avaliador.
  `;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: prompt,
      config: { temperature: 0.5 }
    });
    return response.text?.trim() || "Análise indisponível no momento.";
  } catch (e) {
    console.error("Clinical analysis failed", e);
    return "Não foi possível gerar a análise qualitativa.";
  }
};