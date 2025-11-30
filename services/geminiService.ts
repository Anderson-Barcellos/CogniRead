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
  // Updated to the more capable model as requested
  const modelName = 'gemini-3-pro-preview';

  // 1. Generate Keypoints first
  const keypointsPrompt = `
    Gere exatamente 6 pontos-chave concisos sobre o tema científico: "${topic}".
    Idioma: ${language}.
    Cada ponto deve ser uma frase completa, curta e representar uma ideia distinta e factualmente correta.
    Retorne apenas a lista de frases.
  `;

  const keypointSchema: Schema = {
    type: Type.OBJECT,
    properties: {
      points: {
        type: Type.ARRAY,
        items: { type: Type.STRING },
        description: "Lista de 6 pontos-chave distintos sobre o tema."
      }
    },
    required: ["points"]
  };

  try {
    const kpResponse = await ai.models.generateContent({
      model: modelName,
      contents: keypointsPrompt,
      config: {
        responseMimeType: "application/json",
        responseSchema: keypointSchema,
        temperature: 0.7
      }
    });

    const kpJson = JSON.parse(kpResponse.text || "{}");
    const rawKeypoints: string[] = kpJson.points || [];

    if (rawKeypoints.length === 0) throw new Error("Falha ao gerar pontos-chave");

    // 2. Generate Passage based on Keypoints
    const passagePrompt = `
      Escreva um texto contínuo e coeso em ${language} sobre "${topic}".
      
      Requisitos obrigatórios:
      1. O texto deve cobrir EXPLICITAMENTE todos os seguintes pontos-chave:
      ${rawKeypoints.map((p, i) => `- ${p}`).join('\n')}
      
      2. Complexidade: ${complexity === 'dense' ? 'DENSA (vocabulário acadêmico rico, conectores lógicos complexos, maior abstração)' : 'NEUTRA (informativo, claro, jornalístico)'}.
      3. Tamanho alvo: Aproxime-se de ${targetWords} palavras. (Margem de erro 20%).
      4. Estilo: Científico/Acadêmico.
      5. Formato: Parágrafos fluídos. NÃO faça uma lista de tópicos. NÃO use negrito.
    `;

    const passageResponse = await ai.models.generateContent({
      model: modelName,
      contents: passagePrompt,
      config: {
        temperature: 0.7 
      }
    });

    const passage = passageResponse.text?.trim() || "";
    
    return {
      passage,
      keypoints: rawKeypoints
    };

  } catch (error) {
    console.error("Gemini API Error:", error);
    throw error;
  }
};