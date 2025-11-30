import React, { useState, useEffect, useRef } from 'react';
import { 
  AppState, 
  TestConfig, 
  TestInstance, 
  SessionResult,
  Complexity,
  KeypointResult
} from './types';
import { NORMATIVE_PROFILES, DEFAULT_TOPICS } from './constants';
import { generateTestContent } from './services/geminiService';
import { scoreSession, getKeypointTokens } from './services/scoringService';
import { saveSession, getSessions, getLatestSession } from './services/storageService';
import { Button } from './components/Button';
import { HistoryChart } from './components/HistoryChart';

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
  // Default to High Performance profile
  const [profileId, setProfileId] = useState('adult_high_performance');
  const [duration, setDuration] = useState(90); // seconds
  const [useCalibrated, setUseCalibrated] = useState(false);
  const [userWpm, setUserWpm] = useState(250);

  // Internal generation state (not exposed to user setup)
  const [generatedConfig, setGeneratedConfig] = useState<{topic: string, complexity: Complexity} | null>(null);

  // Test State
  const [testData, setTestData] = useState<TestInstance | null>(null);
  const [timeLeft, setTimeLeft] = useState(0);
  const [elapsedTime, setElapsedTime] = useState(0);
  const [isFinishedEarly, setIsFinishedEarly] = useState(false);

  // Recall State
  const [recallText, setRecallText] = useState('');

  // Result State
  const [result, setResult] = useState<SessionResult | null>(null);
  const [history, setHistory] = useState<SessionResult[]>([]);

  // Refs for timer
  const timerRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  // Load History on Mount
  useEffect(() => {
    setHistory(getSessions());
  }, [appState]); // Reload when state changes (e.g. back to home)

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

  // --- Handlers ---

  const handleStartGeneration = async () => {
    setAppState(AppState.GENERATING);
    setError(null);
    
    try {
      const selectedProfile = NORMATIVE_PROFILES.find(p => p.id === profileId)!;
      
      // Randomize Topic and Complexity
      const randomTopic = DEFAULT_TOPICS[Math.floor(Math.random() * DEFAULT_TOPICS.length)];
      const randomComplexity: Complexity = Math.random() > 0.5 ? 'neutral' : 'dense';
      
      setGeneratedConfig({ topic: randomTopic, complexity: randomComplexity });

      const baseWpm = useCalibrated ? userWpm : selectedProfile.mean_wpm;
      
      // ADJUSTMENT: If text is dense, we reduce the effective WPM used for target word calculation.
      // Dense texts take longer to process cognitively. 
      // Reducing target WPM by 15% ensures the generated text is slightly shorter, 
      // making the fixed time limit fair for the increased difficulty.
      const adjustedWpm = randomComplexity === 'dense' ? Math.round(baseWpm * 0.85) : baseWpm;

      // Calculate target words: (Time / 60) * Adjusted WPM
      const targetWords = Math.round((duration / 60) * adjustedWpm);
      
      const { passage, keypoints } = await generateTestContent(
        randomTopic,
        selectedProfile.language,
        randomComplexity,
        targetWords
      );

      // Create Test Instance
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

  const handleStartReading = () => {
    startTimeRef.current = Date.now();
    setElapsedTime(0);
    setIsFinishedEarly(false);
    
    timerRef.current = window.setInterval(() => {
      const now = Date.now();
      const passed = Math.floor((now - startTimeRef.current) / 1000);
      setElapsedTime(passed);
      
      setTimeLeft((prev) => {
        if (prev <= 1) {
          handleFinishReading(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    if (appState === AppState.READING) {
      handleStartReading();
    }
    return () => {
      if (timerRef.current) {
        window.clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appState]);

  const handleFinishReading = (timeExpired: boolean) => {
    if (timerRef.current) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    
    const finalElapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    setElapsedTime(timeExpired ? duration : finalElapsed);
    setIsFinishedEarly(!timeExpired);
    
    setAppState(AppState.RECALL);
  };

  const handleSubmitRecall = () => {
    if (!testData) return;
    setAppState(AppState.SCORING);
    
    const previous = getLatestSession();

    const sessionResult = scoreSession(
      testData,
      recallText,
      elapsedTime,
      previous
    );

    setResult(sessionResult);
    saveSession(sessionResult);
    setAppState(AppState.RESULTS);
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
      <h3 className="mt-8 text-xl font-medium text-slate-800 dark:text-slate-100">Sintetizando Conhecimento...</h3>
      <p className="text-slate-500 dark:text-slate-400 mt-2">Selecionando tema científico e estruturando texto.</p>
      {generatedConfig && (
        <p className="text-brand-600 dark:text-brand-400 mt-4 font-medium animate-fade-in text-sm bg-brand-50 dark:bg-brand-900/30 px-3 py-1 rounded-full">
           Tema selecionado: {generatedConfig.topic}
        </p>
      )}
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
    <div className="max-w-3xl mx-auto animate-fade-in">
      <div className="bg-white dark:bg-slate-900 p-8 rounded-2xl shadow-sm border border-slate-100 dark:border-slate-800 text-center mb-6 transition-colors duration-200">
        <h2 className="text-2xl font-bold text-slate-800 dark:text-slate-100 mb-2">Hora de Relembrar</h2>
        <p className="text-slate-600 dark:text-slate-300">
          Escreva tudo o que você lembra do texto lido sobre <strong>{testData?.topic}</strong>. 
        </p>
      </div>

      <div className="relative">
        <textarea
          value={recallText}
          onChange={(e) => setRecallText(e.target.value)}
          placeholder="Comece a digitar aqui..."
          className="w-full h-80 p-6 rounded-xl border border-slate-300 dark:border-slate-600 focus:ring-2 focus:ring-brand-500 focus:border-brand-500 outline-none text-lg resize-none shadow-inner bg-white dark:bg-slate-900 text-slate-900 dark:text-white transition-colors duration-200"
          autoFocus
        />
        <div className="absolute bottom-4 right-4 text-slate-400 text-sm">
           {recallText.length} caracteres
        </div>
      </div>

      <div className="mt-6 flex justify-end">
        <Button onClick={handleSubmitRecall} disabled={recallText.length < 10}>
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
                      // Find topic for history if possible, otherwise generic
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