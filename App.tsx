import React, { useState, useEffect, useRef } from 'react';
import { 
  AppState, 
  TestInstance, 
  SessionResult,
  Complexity,
} from './types';
import { NORMATIVE_PROFILES, DEFAULT_TOPICS } from './constants';
import { generateTestContent, refineTranscription, generateClinicalAnalysis } from './services/geminiService';
import { scoreSession, getKeypointTokens } from './services/scoringService';
import { saveSession, getSessions, getLatestSession } from './services/storageService';
import { Button } from './components/Button';
import { HistoryChart } from './components/HistoryChart';

// Ambient declaration for Web Speech API
declare global {
  interface Window {
    webkitSpeechRecognition: any;
    SpeechRecognition: any;
  }
}

const App: React.FC = () => {
  // Global State
  const [appState, setAppState] = useState<AppState>(AppState.SETUP);
  const [error, setError] = useState<string | null>(null);

  // Theme State
  const [isDarkMode, setIsDarkMode] = useState(() => {
    if (typeof window !== 'undefined') {
        const stored = localStorage.getItem('theme');
        if (stored) return stored === 'dark';
        return window.matchMedia('(prefers-color-scheme: dark)').matches;
    }
    return false;
  });

  // Setup State
  const [profileId, setProfileId] = useState('adult_high_performance');
  const [duration, setDuration] = useState(90); // seconds
  const [useCalibrated, setUseCalibrated] = useState(false);
  const [userWpm, setUserWpm] = useState(250);

  // Internal generation state
  const [generatedConfig, setGeneratedConfig] = useState<{topic: string, complexity: Complexity} | null>(null);

  // Test State
  const [testData, setTestData] = useState<TestInstance | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);

  // Recall State
  const [recallText, setRecallText] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [isProcessingAudio, setIsProcessingAudio] = useState(false);
  const [liveTranscript, setLiveTranscript] = useState(''); // Text shown during recording overlay
  const recognitionRef = useRef<any>(null);
  const accumulatedTranscriptRef = useRef<string>(''); // Raw buffer to avoid React state closure issues

  // Result State
  const [result, setResult] = useState<SessionResult | null>(null);
  const [history, setHistory] = useState<SessionResult[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  // Refs for timer
  const startTimeRef = useRef<number>(0);

  // Load History on Mount
  useEffect(() => {
    setHistory(getSessions());
  }, [appState]);

  // Theme Effect
  useEffect(() => {
    if (isDarkMode) {
      document.documentElement.classList.add('dark');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark');
      localStorage.setItem('theme', 'light');
    }
  }, [isDarkMode]);

  const toggleTheme = () => setIsDarkMode(!isDarkMode);

  // --- Logic Handlers ---

  const handleStartGeneration = async () => {
    setAppState(AppState.GENERATING);
    setError(null);
    
    try {
      const selectedProfile = NORMATIVE_PROFILES.find(p => p.id === profileId)!;
      
      const randomTopic = DEFAULT_TOPICS[Math.floor(Math.random() * DEFAULT_TOPICS.length)];
      const randomComplexity: Complexity = Math.random() > 0.5 ? 'neutral' : 'dense';
      
      setGeneratedConfig({ topic: randomTopic, complexity: randomComplexity });

      const baseWpm = useCalibrated ? userWpm : selectedProfile.mean_wpm;
      
      const adjustedWpm = randomComplexity === 'dense' ? Math.round(baseWpm * 0.85) : baseWpm;

      const targetWords = Math.round((duration / 60) * adjustedWpm);
      
      const { passage, keypoints } = await generateTestContent(
        randomTopic,
        selectedProfile.language,
        randomComplexity,
        targetWords
      );

      const newTest: TestInstance = {
        id: crypto.randomUUID(),
        language: selectedProfile.language,
        topic: randomTopic,
        complexity: randomComplexity,
        passage,
        keypoints: keypoints.map((k, i) => ({ 
            id: i, 
            text: k, 
            tokens: getKeypointTokens(k, selectedProfile.language) 
        })),
        target_words: targetWords,
        allowed_time_sec: duration,
        normative_profile_id: profileId,
        created_at: new Date().toISOString()
      };

      setTestData(newTest);
      setTimeLeft(duration);
      setAppState(AppState.READING);
      
    } catch (err: any) {
      console.error(err);
      setError("Erro ao gerar conteúdo. Verifique sua conexão ou tente novamente.");
      setAppState(AppState.SETUP);
    }
  };

  const handleFinishReading = (timeExpired: boolean) => {
    const finalElapsed = timeExpired 
      ? duration 
      : Math.floor((Date.now() - startTimeRef.current) / 1000);
      
    setElapsedTime(finalElapsed);
    setAppState(AppState.RECALL);
  };

  // Robust Timer Effect using Date.now() to prevent drift and ensure auto-advance
  useEffect(() => {
    let intervalId: number;

    if (appState === AppState.READING) {
      startTimeRef.current = Date.now();
      setTimeLeft(duration);
      setElapsedTime(0);

      intervalId = window.setInterval(() => {
        const now = Date.now();
        const passed = Math.floor((now - startTimeRef.current) / 1000);
        const remaining = Math.max(0, duration - passed);

        setElapsedTime(passed);
        setTimeLeft(remaining);

        if (remaining === 0) {
          window.clearInterval(intervalId);
          handleFinishReading(true);
        }
      }, 200); // Check more frequently for UI smoothness and quick transition
    }

    return () => {
      if (intervalId) window.clearInterval(intervalId);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState, duration]); 


  // Speech Recognition Logic
  const startRecording = () => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SpeechRecognition) {
      alert("Seu navegador não suporta reconhecimento de fala.");
      return;
    }

    const recognition = new SpeechRecognition();
    recognition.lang = testData?.language || 'pt-BR';
    recognition.continuous = true;
    recognition.interimResults = true;

    accumulatedTranscriptRef.current = '';
    setLiveTranscript('');
    setIsRecording(true);

    recognition.onresult = (event: any) => {
      let interim = '';
      let newFinal = '';

      for (let i = event.resultIndex; i < event.results.length; ++i) {
        if (event.results[i].isFinal) {
          newFinal += event.results[i][0].transcript;
        } else {
          interim += event.results[i][0].transcript;
        }
      }
      
      if (newFinal) {
        accumulatedTranscriptRef.current += ' ' + newFinal;
      }

      setLiveTranscript(accumulatedTranscriptRef.current + ' ' + interim);
    };

    recognition.onerror = (event: any) => {
      console.error("Speech error", event.error);
      stopRecording();
    };
    
    // Prevent auto-stop on silence in some browsers if we want continuous
    // But for this UX, if it stops, we just process.
    recognition.onend = () => {
       if (isRecording) {
         // If it stopped but we didn't explicitly trigger stopRecording (e.g. silence),
         // we treat it as finishing the session.
         stopRecording();
       }
    };

    recognitionRef.current = recognition;
    recognition.start();
  };

  const stopRecording = async () => {
    if (recognitionRef.current) {
      // Prevent onend from triggering another stop
      const rec = recognitionRef.current;
      recognitionRef.current = null; // Detach ref immediately
      rec.stop();
    }

    setIsRecording(false);
    
    const rawText = accumulatedTranscriptRef.current.trim();
    if (rawText.length > 2) {
      setIsProcessingAudio(true);
      try {
        const refined = await refineTranscription(rawText);
        setRecallText(prev => (prev + ' ' + refined).trim());
      } catch (e) {
        console.error("Refinement failed", e);
        setRecallText(prev => (prev + ' ' + rawText).trim());
      } finally {
        setIsProcessingAudio(false);
        setLiveTranscript('');
        accumulatedTranscriptRef.current = '';
      }
    }
  };


  const handleSubmitRecall = async () => {
    if (!testData) return;
    setAppState(AppState.SCORING);
    setIsAnalyzing(true);
    
    try {
      const previous = getLatestSession();

      // 1. Calculate numerical scores (Client-side)
      const baseResult = scoreSession(
        testData,
        recallText,
        elapsedTime,
        previous
      );

      // 2. Get Clinical Analysis from Gemini 3 Pro (Server-side/API)
      const aiFeedback = await generateClinicalAnalysis(
        testData.passage,
        recallText,
        testData.keypoints.map(k => k.text)
      );

      const finalResult: SessionResult = {
        ...baseResult,
        ai_feedback: aiFeedback
      };

      setResult(finalResult);
      saveSession(finalResult);
      setAppState(AppState.RESULTS);
    } catch (e) {
      console.error("Analysis failed", e);
      // Fallback if AI fails
      setAppState(AppState.RESULTS); 
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleReset = () => {
    setRecallText('');
    setTestData(null);
    setResult(null);
    setGeneratedConfig(null);
    setAppState(AppState.SETUP);
  };

  // --- Render Helpers ---

  const renderSetup = () => (
    <div className="max-w-2xl mx-auto bg-white dark:bg-slate-900 p-6 md:p-8 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 transition-colors duration-200">
      <div className="mb-8">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">Configuração do Teste</h2>
        <p className="text-slate-500 dark:text-slate-400">
          O sistema selecionará automaticamente um tema científico e ajustará a complexidade.
        </p>
      </div>

      <div className="space-y-6">
        {/* Profile Selector */}
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Perfil de Comparação</label>
          <select 
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-slate-100"
          >
            {NORMATIVE_PROFILES.map(p => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
        </div>

        {/* Auto Selection Info Badges */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
           <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700 flex items-center gap-3">
             <div className="bg-slate-200 dark:bg-slate-700 p-2 rounded-full">
               <svg className="w-5 h-5 text-slate-600 dark:text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19.428 15.428a2 2 0 00-1.022-.547l-2.384-.477a6 6 0 00-3.86.517l-.318.158a6 6 0 01-3.86.517L6.05 15.21a2 2 0 00-1.806.547M8 4h8l-1 1v5.172a2 2 0 00.586 1.414l5 5c1.26 1.26.367 3.414-1.415 3.414H4.828c-1.782 0-2.674-2.154-1.414-3.414l5-5A2 2 0 009 10.172V5L8 4z" />
               </svg>
             </div>
             <div>
               <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Tema Científico</div>
               <div className="text-xs text-slate-500 dark:text-slate-400">Aleatório</div>
             </div>
           </div>

           <div className="p-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700 flex items-center gap-3">
             <div className="bg-slate-200 dark:bg-slate-700 p-2 rounded-full">
               <svg className="w-5 h-5 text-slate-600 dark:text-slate-300" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
               </svg>
             </div>
             <div>
               <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">Complexidade</div>
               <div className="text-xs text-slate-500 dark:text-slate-400">Auto-ajustável</div>
             </div>
           </div>
        </div>
          
        <div>
          <label className="block text-sm font-medium text-slate-700 dark:text-slate-300 mb-2">Duração da Leitura</label>
          <select 
            value={duration}
            onChange={(e) => setDuration(Number(e.target.value))}
            className="w-full p-3 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none text-slate-900 dark:text-slate-100"
          >
            <option value={60}>60 segundos (Curto)</option>
            <option value={90}>90 segundos (Médio)</option>
            <option value={120}>120 segundos (Longo)</option>
          </select>
        </div>

        {/* Calibration Toggle */}
        <div className="flex items-start gap-3 p-4 bg-slate-50 dark:bg-slate-800 rounded-lg border border-slate-100 dark:border-slate-700">
          <input 
            type="checkbox" 
            id="useCalibration"
            checked={useCalibrated}
            onChange={(e) => setUseCalibrated(e.target.checked)}
            className="mt-1 h-4 w-4 text-brand-600 focus:ring-brand-500 border-slate-300 dark:border-slate-600 rounded bg-white dark:bg-slate-700"
          />
          <div className="flex-1">
            <label htmlFor="useCalibration" className="block text-sm font-medium text-slate-900 dark:text-slate-100">
              Usar WPM Personalizado
            </label>
            <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
              Sobrescreve a velocidade média do perfil selecionado.
            </p>
            {useCalibrated && (
              <div className="mt-3 flex items-center gap-2">
                <span className="text-sm text-slate-600 dark:text-slate-300">Velocidade (WPM):</span>
                <input 
                  type="number" 
                  value={userWpm}
                  onChange={(e) => setUserWpm(Number(e.target.value))}
                  className="w-24 p-2 border border-slate-300 dark:border-slate-600 rounded text-sm bg-white dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                  min="50"
                  max="600"
                />
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 text-red-700 dark:text-red-300 text-sm rounded-lg border border-red-100 dark:border-red-800">
            {error}
          </div>
        )}

        <div className="pt-4">
          <Button onClick={handleStartGeneration} className="w-full shadow-brand-500/25">
            Gerar e Iniciar
          </Button>
        </div>

        {/* Mini History */}
        {history.length > 0 && (
           <div className="mt-8 pt-8 border-t border-slate-100 dark:border-slate-800">
             <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-4">Seu Histórico Recente</h3>
             <HistoryChart sessions={history} isDark={isDarkMode} />
           </div>
        )}
      </div>
    </div>
  );

  const renderGenerating = () => (
    <div className="flex flex-col items-center justify-center min-h-[50vh]">
      <div className="relative w-20 h-20">
        <div className="absolute top-0 left-0 w-full h-full border-4 border-slate-200 dark:border-slate-700 rounded-full"></div>
        <div className="absolute top-0 left-0 w-full h-full border-4 border-brand-500 rounded-full border-t-transparent animate-spin"></div>
      </div>
      <h3 className="mt-8 text-xl font-medium text-slate-800 dark:text-slate-100">
        {isAnalyzing ? "Gemini 3 Pro Analisando..." : "Sintetizando Conhecimento..."}
      </h3>
      <p className="text-slate-500 dark:text-slate-400 mt-2">
        {isAnalyzing ? "Avaliando nuances clínicas e estruturais do seu relato." : "Selecionando tema científico e estruturando texto."}
      </p>
    </div>
  );

  const renderReading = () => {
    if (!testData) return null;
    
    // Progress calculation
    const progress = ((testData.allowed_time_sec - timeLeft) / testData.allowed_time_sec) * 100;

    return (
      <div className="max-w-3xl mx-auto animate-fade-in relative">
        {/* Progress Bar (Sticky Top) */}
        <div className="sticky top-4 z-10 mb-8 bg-white/90 dark:bg-slate-900/90 backdrop-blur-sm rounded-full shadow-sm border border-slate-200 dark:border-slate-700 p-1 flex items-center justify-between px-4 h-14 transition-colors duration-200">
          <div className="flex flex-col">
             <span className="text-xs font-bold text-slate-400 uppercase">Tempo Restante</span>
             <span className={`font-mono text-xl font-bold ${timeLeft < 10 ? 'text-red-500' : 'text-slate-700 dark:text-slate-200'}`}>
                {Math.floor(timeLeft / 60)}:{String(timeLeft % 60).padStart(2, '0')}
             </span>
          </div>
          <div className="flex-1 mx-6 h-2 bg-slate-100 dark:bg-slate-700 rounded-full overflow-hidden">
             <div 
                className="h-full bg-brand-500 transition-all duration-1000 ease-linear"
                style={{ width: `${100 - progress}%` }} // Shows remaining
             />
          </div>
          <Button onClick={() => handleFinishReading(false)} variant="secondary" className="py-1 px-3 text-sm h-9">
            Concluir Leitura
          </Button>
        </div>
        
        {/* Info Header */}
        <div className="mb-4 flex gap-3 text-sm text-slate-500 dark:text-slate-400 justify-center">
            <span className="bg-slate-100 dark:bg-slate-800 px-2 py-1 rounded transition-colors duration-200">{testData.topic}</span>
            <span className={`px-2 py-1 rounded transition-colors duration-200 ${testData.complexity === 'dense' ? 'bg-amber-100 dark:bg-amber-900/50 text-amber-800 dark:text-amber-100' : 'bg-slate-100 dark:bg-slate-800'}`}>
                {testData.complexity === 'dense' ? 'Texto Denso' : 'Texto Neutro'}
            </span>
        </div>

        {/* Text Passage */}
        <div className="bg-white dark:bg-slate-900 p-8 md:p-12 rounded-lg shadow-sm leading-relaxed text-lg md:text-xl text-slate-800 dark:text-slate-200 font-serif border border-slate-100 dark:border-slate-800 transition-colors duration-200">
           {testData.passage.split('\n').map((para, idx) => (
             <p key={idx} className="mb-6 last:mb-0 text-justify">
               {para}
             </p>
           ))}
        </div>
      </div>
    );
  };

  const renderRecall = () => (
    <div className="max-w-3xl mx-auto animate-fade-in relative z-0">
      <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 text-center mb-6 transition-colors duration-200">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">Hora de Relembrar</h2>
        <p className="text-slate-600 dark:text-slate-300">
          Escreva ou <strong>dite</strong> tudo o que você lembra do texto lido sobre <strong>{testData?.topic}</strong>.
        </p>
      </div>

      <div className="relative">
        <textarea
          value={recallText}
          onChange={(e) => setRecallText(e.target.value)}
          placeholder="Comece a digitar aqui ou use o microfone..."
          className="w-full h-80 p-6 rounded-xl border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-lg resize-none shadow-inner bg-white dark:bg-slate-900 text-slate-900 dark:text-white transition-colors duration-200 pb-16"
          disabled={isRecording} 
        />
        
        {/* Full Screen Recording Overlay */}
        {(isRecording || isProcessingAudio) && (
           <div className="absolute inset-0 bg-slate-900/95 backdrop-blur-md flex flex-col items-center justify-center rounded-xl z-20 animate-fade-in p-8 text-center">
              
              {isProcessingAudio ? (
                // Processing State
                <>
                  <div className="relative w-24 h-24 mb-6">
                    <div className="absolute inset-0 border-4 border-slate-700 rounded-full"></div>
                    <div className="absolute inset-0 border-4 border-brand-500 rounded-full border-t-transparent animate-spin"></div>
                  </div>
                  <h3 className="text-xl font-bold text-white mb-2">Organizando suas ideias...</h3>
                  <p className="text-slate-400 max-w-sm">O Gemini está removendo hesitações e formatando o texto para máxima clareza.</p>
                </>
              ) : (
                // Active Recording State
                <>
                  <div className="flex items-center gap-1.5 h-16 mb-8">
                     {/* Visual Equalizer Simulation */}
                     {[...Array(5)].map((_, i) => (
                       <div key={i} className="w-3 bg-brand-500 rounded-full animate-pulse" 
                            style={{ 
                              height: '100%', 
                              animationDuration: `${0.6 + i * 0.1}s`,
                              opacity: 0.8
                            }}>
                       </div>
                     ))}
                  </div>

                  <div className="w-full max-w-lg mb-8 min-h-[80px] text-lg text-slate-300 font-medium leading-relaxed">
                    "{liveTranscript || "Fale agora, estou ouvindo..."}"
                  </div>

                  <button
                    onClick={stopRecording}
                    className="group relative flex items-center justify-center w-20 h-20 bg-red-500 rounded-full shadow-xl shadow-red-500/30 hover:bg-red-600 transition-all hover:scale-105"
                  >
                     <div className="w-8 h-8 bg-white rounded-md"></div>
                     {/* Pulse Ring */}
                     <span className="absolute -inset-4 rounded-full border-2 border-red-500/50 animate-ping opacity-75"></span>
                  </button>
                  <p className="mt-4 text-sm text-slate-400 uppercase tracking-widest font-semibold">Toque para Finalizar</p>
                </>
              )}
           </div>
        )}

        {/* Regular Start Button (Visible when NOT recording) */}
        {!isRecording && !isProcessingAudio && (
          <div className="absolute bottom-4 left-4 flex gap-2 items-center">
             <button
               onClick={startRecording}
               className="flex items-center gap-2 px-5 py-2.5 rounded-full font-medium transition-all bg-brand-50 dark:bg-slate-800 text-brand-700 dark:text-brand-300 hover:bg-brand-100 dark:hover:bg-slate-700 border border-brand-200 dark:border-slate-700 shadow-sm"
             >
               <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                 <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
               </svg>
               Ditar Resposta
             </button>
          </div>
        )}

        <div className="absolute bottom-4 right-4 text-slate-400 text-sm">
           {recallText.length} caracteres
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={handleSubmitRecall} disabled={recallText.length < 10 || isProcessingAudio || isRecording}>
          Enviar Resposta
        </Button>
      </div>
    </div>
  );

  const renderResults = () => {
    if (!result) return null;

    return (
      <div className="max-w-4xl mx-auto animate-fade-in">
        <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-lg overflow-hidden border border-slate-100 dark:border-slate-800 transition-colors duration-200">
          {/* Header */}
          <div className="bg-slate-800 dark:bg-slate-950 text-white p-8 text-center transition-colors duration-200">
            <h2 className="text-3xl font-bold mb-1">{result.coverage_pct.toFixed(0)}% de Cobertura</h2>
            <p className="text-brand-100 text-lg opacity-90">{result.qualitative_label}</p>
          </div>

          {/* Metrics Grid */}
          <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-slate-100 dark:divide-slate-800 border-b border-slate-100 dark:border-slate-800">
             <div className="p-6 text-center">
               <div className="text-sm text-slate-500 dark:text-slate-400 uppercase tracking-wide font-semibold mb-1">Z-Score</div>
               <div className={`text-2xl font-bold ${result.z_coverage < -1.5 ? 'text-red-500' : 'text-slate-800 dark:text-slate-100'}`}>
                 {result.z_coverage > 0 ? '+' : ''}{result.z_coverage}
               </div>
             </div>
             <div className="p-6 text-center">
               <div className="text-sm text-slate-500 dark:text-slate-400 uppercase tracking-wide font-semibold mb-1">Velocidade</div>
               <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                 {result.wpm_effective} <span className="text-sm font-normal text-slate-400">WPM</span>
               </div>
             </div>
             <div className="p-6 text-center bg-slate-50 dark:bg-slate-800/50">
               <div className="text-sm text-slate-500 dark:text-slate-400 uppercase tracking-wide font-semibold mb-1">Tempo</div>
               <div className="text-2xl font-bold text-slate-800 dark:text-slate-100">
                 {elapsedTime}s
               </div>
             </div>
             <div className="p-6 text-center bg-slate-50 dark:bg-slate-800/50">
               <div className="text-sm text-slate-500 dark:text-slate-400 uppercase tracking-wide font-semibold mb-1">Mudança (RCI)</div>
               <div className={`text-2xl font-bold ${result.rci_coverage && Math.abs(result.rci_coverage) > 1.96 ? 'text-brand-600' : 'text-slate-400 dark:text-slate-500'}`}>
                 {result.rci_coverage !== undefined ? result.rci_coverage : '--'}
               </div>
             </div>
          </div>

          {/* Gemini 3 Pro Feedback Section */}
          {result.ai_feedback && (
             <div className="p-8 bg-brand-50 dark:bg-brand-900/10 border-b border-brand-100 dark:border-brand-900/30">
               <div className="flex items-center gap-2 mb-3">
                 <svg className="w-5 h-5 text-brand-600 dark:text-brand-400" fill="currentColor" viewBox="0 0 20 20">
                   <path d="M10 2a6 6 0 00-6 6v3.586l-.707.707A1 1 0 004 14h12a1 1 0 00.707-1.707L16 11.586V8a6 6 0 00-6-6zM10 18a3 3 0 01-3-3h6a3 3 0 01-3 3z" />
                 </svg>
                 <h3 className="text-lg font-bold text-brand-900 dark:text-brand-100">Análise Clínica (Gemini 3 Pro)</h3>
               </div>
               <p className="text-brand-800 dark:text-brand-200 leading-relaxed italic">
                 "{result.ai_feedback}"
               </p>
             </div>
          )}

          <div className="p-8">
            <div className="mb-6 flex items-center justify-between">
                <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Detalhamento dos Pontos-Chave</h3>
                <span className="text-xs font-medium px-2 py-1 bg-slate-100 dark:bg-slate-800 rounded text-slate-600 dark:text-slate-300">
                    {testData?.complexity === 'dense' ? 'Complexidade Alta' : 'Complexidade Padrão'}
                </span>
            </div>
            <div className="space-y-4">
              {result.keypoint_results.map((kp) => (
                <div key={kp.keypoint_id} className={`flex items-start gap-4 p-4 rounded-lg border transition-colors duration-200 ${kp.hit ? 'bg-green-50 dark:bg-green-900/20 border-green-100 dark:border-green-800' : 'bg-red-50 dark:bg-red-900/20 border-red-100 dark:border-red-800'}`}>
                  <div className={`mt-1 flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center ${kp.hit ? 'bg-green-500' : 'bg-red-400'}`}>
                    {kp.hit ? (
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    ) : (
                      <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    )}
                  </div>
                  <div>
                    <p className={`font-medium ${kp.hit ? 'text-green-900 dark:text-green-100' : 'text-red-900 dark:text-red-100'}`}>{kp.text}</p>
                    {kp.hit && (
                       <p className="text-xs text-green-700 dark:text-green-300 mt-1">
                         Tokens detectados: {kp.matched_tokens.join(', ')}
                       </p>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="p-8 bg-slate-50 dark:bg-slate-800/50 border-t border-slate-100 dark:border-slate-800 flex justify-between items-center transition-colors duration-200">
             <Button variant="outline" onClick={() => {
                const csvContent = "data:text/csv;charset=utf-8," 
                  + "Data,Coverage,Z-Score,WPM,Topic\n"
                  + history.map(h => {
                      return `${h.created_at},${h.coverage_pct},${h.z_coverage},${h.wpm_effective},${h.test_id}`
                  }).join("\n");
                const encodedUri = encodeURI(csvContent);
                window.open(encodedUri);
             }}>
               Exportar CSV
             </Button>
             <Button onClick={handleReset}>Novo Teste</Button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen flex flex-col font-sans bg-gray-50 dark:bg-slate-850 transition-colors duration-200">
      <header className="bg-white dark:bg-slate-900 border-b border-slate-200 dark:border-slate-800 transition-colors duration-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
             <div className="w-8 h-8 bg-brand-600 rounded-lg flex items-center justify-center text-white font-bold">C</div>
             <span className="text-xl font-bold text-slate-800 dark:text-white tracking-tight">CogniRead</span>
          </div>
          <div className="flex items-center gap-4">
             <div className="text-sm text-slate-500 dark:text-slate-400 hidden md:block">
               {appState === AppState.SETUP ? 'Configuração' : 'Avaliação em andamento'}
             </div>
             <button 
                onClick={toggleTheme} 
                className="p-2 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-500 dark:text-slate-400 transition-colors"
                title={isDarkMode ? "Mudar para modo claro" : "Mudar para modo escuro"}
             >
                {isDarkMode ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                    </svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 24.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                    </svg>
                )}
             </button>
          </div>
        </div>
      </header>

      <main className="flex-1 max-w-6xl mx-auto w-full px-4 py-8 md:py-12">
        {appState === AppState.SETUP && renderSetup()}
        {appState === AppState.GENERATING && renderGenerating()}
        {appState === AppState.READING && renderReading()}
        {appState === AppState.RECALL && renderRecall()}
        {appState === AppState.SCORING && renderGenerating()} {/* Reuse spinner */}
        {appState === AppState.RESULTS && renderResults()}
      </main>

      <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 py-6 mt-auto transition-colors duration-200">
        <div className="max-w-6xl mx-auto px-4 text-center text-slate-400 dark:text-slate-500 text-sm">
          <p>© 2024 CogniRead. Uso clínico experimental.</p>
          <p className="mt-1">Os dados são processados localmente ou via API anônima.</p>
        </div>
      </footer>
    </div>
  );
};

export default App;