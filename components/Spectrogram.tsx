
import React, { useEffect, useRef, useState } from 'react';
import { amplitudeToDecibels, autoCorrelate, calculateRMS, getColorForIntensity } from '../utils/audioHelpers';

export const Spectrogram: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Audio Refs
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const sourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const animationIdRef = useRef<number | null>(null);

  // Speed Config
  const SCROLL_SPEED = 4; // Aumentado para 4px por frame (mais rápido)
  
  // Frequency Range Config
  const MIN_FREQ = 0;
  const MAX_FREQ = 5000;
  
  // Marcadores do Eixo Y (Frequências para exibir)
  const FREQUENCY_MARKERS = [0, 500, 1000, 2000, 3000, 4000, 5000];

  // Smoothing Refs (Buffers para média)
  const dbHistoryRef = useRef<number[]>([]);
  const hzHistoryRef = useRef<number[]>([]);
  const frameCountRef = useRef<number>(0);
  const HISTORY_SIZE = 30; // ~0.5 segundos a 60fps

  // State for UI Overlay
  const [db, setDb] = useState<number>(-100);
  const [hz, setHz] = useState<number>(0); // Frequência em tempo real (para o marcador)
  const [persistedHz, setPersistedHz] = useState<number>(0); // Média de 0.5s (para a caixa de texto)
  
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsInteraction, setNeedsInteraction] = useState(false);

  const startAudio = async () => {
    // Se já existe e está suspenso, tenta retomar
    if (audioContextRef.current) {
      if (audioContextRef.current.state === 'suspended') {
        try {
          await audioContextRef.current.resume();
          if (audioContextRef.current.state === 'running') {
            setNeedsInteraction(false);
          }
        } catch (e) {
          console.warn("Autoplay bloqueado pelo navegador, aguardando interação.");
          setNeedsInteraction(true);
        }
      }
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      const AudioCtxClass = (window.AudioContext || (window as any).webkitAudioContext);
      const ctx = new AudioCtxClass();
      audioContextRef.current = ctx;
      
      analyserRef.current = ctx.createAnalyser();
      analyserRef.current.fftSize = 2048; 
      analyserRef.current.smoothingTimeConstant = 0.0; 

      sourceRef.current = ctx.createMediaStreamSource(stream);
      sourceRef.current.connect(analyserRef.current);

      if (ctx.state === 'suspended') {
        try {
          await ctx.resume();
        } catch(e) {}
      }

      if (ctx.state === 'suspended') {
        setNeedsInteraction(true);
      }

      setIsReady(true);
      draw();
    } catch (err: any) {
      console.error("Error accessing microphone:", err);
      setError("Permissão de microfone negada ou indisponível.");
    }
  };

  const draw = () => {
    if (!canvasRef.current || !analyserRef.current || !audioContextRef.current) return;

    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const timeDomainArray = new Float32Array(analyser.fftSize);

    // Get Data
    analyser.getByteFrequencyData(dataArray);
    analyser.getFloatTimeDomainData(timeDomainArray);

    // --- 1. Calculations & Smoothing ---
    const rms = calculateRMS(timeDomainArray);
    const currentDb = amplitudeToDecibels(rms);
    const currentHz = autoCorrelate(timeDomainArray, audioContextRef.current?.sampleRate || 44100);

    dbHistoryRef.current.push(currentDb);
    if (dbHistoryRef.current.length > HISTORY_SIZE) dbHistoryRef.current.shift();

    hzHistoryRef.current.push(currentHz > 0 ? currentHz : 0);
    if (hzHistoryRef.current.length > HISTORY_SIZE) hzHistoryRef.current.shift();

    frameCountRef.current++;

    // A cada 5 frames: Atualiza dB e Marcador Visual (tempo real/rápido)
    if (frameCountRef.current % 5 === 0) {
        const avgDb = dbHistoryRef.current.reduce((a, b) => a + b, 0) / dbHistoryRef.current.length;
        setDb(avgDb);

        // Lógica para o marcador visual (zera no silêncio)
        const validPitches = hzHistoryRef.current.filter(p => p > 0);
        // Usa uma janela menor para o marcador visual ser responsivo
        const recentPitches = validPitches.slice(-10); 
        if (recentPitches.length > 3) {
            const avgHz = recentPitches.reduce((a, b) => a + b, 0) / recentPitches.length;
            setHz(avgHz);
        } else {
            setHz(0);
        }
    }

    // A cada 30 frames (~0.5 segundos): Atualiza a CAIXA DE TEXTO
    if (frameCountRef.current % 30 === 0) {
        const validPitches = hzHistoryRef.current.filter(p => p > 0);
        
        // Se houver dados suficientes no buffer de 0.5s (mais de 1/3 preenchido com som)
        if (validPitches.length > HISTORY_SIZE / 3) {
            const avgHz = validPitches.reduce((a, b) => a + b, 0) / validPitches.length;
            setPersistedHz(avgHz);
        }
        // Se não houver dados suficientes (silêncio), NÃO ATUALIZA setPersistedHz
        // mantendo assim o último valor registrado na tela.
    }

    // --- 2. Draw Spectrogram ---

    const width = canvas.width;
    const height = canvas.height;
    
    // Check if canvas has valid dimensions before drawing to avoid errors
    if (width > 0 && height > 0) {
      // Shift canvas to the left by SCROLL_SPEED
      ctx.drawImage(canvas, SCROLL_SPEED, 0, width - SCROLL_SPEED, height, 0, 0, width - SCROLL_SPEED, height);

      // Clear the rightmost strip
      ctx.clearRect(width - SCROLL_SPEED, 0, SCROLL_SPEED, height);

      // Calculate Frequency mapping
      const sampleRate = audioContextRef.current.sampleRate;
      const nyquist = sampleRate / 2;
      // Calculate which bin index corresponds to our min/max frequencies
      const startBin = Math.floor((MIN_FREQ / nyquist) * bufferLength);
      const endBin = Math.floor((MAX_FREQ / nyquist) * bufferLength);
      // Ensure we don't go out of bounds
      const safeEndBin = Math.min(bufferLength, endBin);
      const rangeBins = safeEndBin - startBin;

      // Draw only the requested frequency range stretched to full height
      for (let i = 0; i < rangeBins; i++) {
        const dataIndex = startBin + i;
        const value = dataArray[dataIndex];
        
        // Map 'i' (relative to our range) to the full canvas height
        // i=0 (0Hz) -> Bottom (y=height)
        // i=rangeBins (5000Hz) -> Top (y=0)
        const y = height - 1 - Math.floor((i / rangeBins) * height);
        
        // Calculate bar height to cover gaps caused by stretching small ranges
        const barHeight = Math.ceil(height / rangeBins) || 1;

        if (value > 0) {
          ctx.fillStyle = getColorForIntensity(value);
          ctx.fillRect(width - SCROLL_SPEED, y, SCROLL_SPEED, barHeight);
        }
      }
    }

    animationIdRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();
    
    startAudio();

    const unlockAudio = () => {
        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume().then(() => {
                setNeedsInteraction(false);
            });
        }
    };
    window.addEventListener('click', unlockAudio);
    window.addEventListener('keydown', unlockAudio);

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('click', unlockAudio);
      window.removeEventListener('keydown', unlockAudio);
      if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  // Helper para posicionar as etiquetas de frequência (linear)
  const getFrequencyPosition = (freq: number) => {
    const percentage = ((freq - MIN_FREQ) / (MAX_FREQ - MIN_FREQ)) * 100;
    return Math.max(0, Math.min(100, percentage));
  };

  const displayDb = Math.max(-100, Math.round(db));
  
  // Display Hz agora usa persistedHz (a média de 0.5s que não apaga)
  const displayHzValue = persistedHz > 0 ? Math.round(persistedHz) : "--";
  const noteName = persistedHz > 0 ? getNoteFromFreq(persistedHz) : "";

  return (
    <div ref={containerRef} className="relative w-full h-[300px] bg-transparent overflow-hidden group">
      {(!isReady || needsInteraction) && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50">
          <button 
            onClick={startAudio}
            className="px-6 py-3 bg-yellow-400 hover:bg-yellow-500 text-black font-bold rounded shadow-lg transition animate-pulse"
          >
            {needsInteraction ? "Clique para Ativar Áudio" : "Iniciar Espectrografia"}
          </button>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900/80 text-white p-4 text-center">
          {error}
        </div>
      )}

      {/* Camada do Canvas */}
      <canvas ref={canvasRef} className="w-full h-full block" />

      {/* Camada de Eixo Y (Frequências e Marcadores) */}
      {isReady && (
        <div className="absolute left-0 top-0 bottom-0 w-full pointer-events-none z-10">
          
          {/* Rótulo da Unidade (Hz) acima do eixo */}
          <div className="absolute left-1 top-2 bg-black/60 px-1.5 py-0.5 rounded text-white/90 text-[11px] font-mono font-bold border border-white/20 z-20">
            Hz
          </div>

          {/* Marcadores Estáticos do Eixo */}
          {FREQUENCY_MARKERS.map((freq) => (
            <div 
              key={freq} 
              className="absolute w-16 flex items-center justify-start group-hover:opacity-100 transition-opacity"
              style={{ bottom: `${getFrequencyPosition(freq)}%`, transform: 'translateY(50%)' }}
            >
              <div className="bg-black/60 text-white/80 text-[10px] font-mono px-1 rounded shadow-sm">
                {freq >= 1000 ? `${freq / 1000}k` : freq}
              </div>
              <div className="h-px bg-white/30 flex-grow ml-1"></div>
            </div>
          ))}

          {/* Marcador Dinâmico de F0 (Usa hz em tempo real para sumir no silêncio) */}
          {hz > MIN_FREQ && hz < MAX_FREQ && (
             <div 
               className="absolute left-0 w-full flex items-center transition-[bottom] duration-100 ease-linear z-20"
               style={{ bottom: `${getFrequencyPosition(hz)}%`, transform: 'translateY(50%)' }}
             >
                {/* Etiqueta F0 no eixo */}
                <div className="bg-red-600 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-r shadow-md border-l-2 border-white/80 flex items-center">
                   <span className="mr-1">F0</span>
                   <span className="opacity-90">{Math.round(hz)}</span>
                </div>
                
                {/* Linha guia através da tela */}
                <div className="flex-grow h-px bg-red-500/50 border-t border-red-400/60 border-dashed mx-1"></div>
             </div>
          )}
        </div>
      )}

      {/* Camada de Informações (Canto Superior Direito) */}
      {isReady && (
        <div className="absolute top-2 right-2 flex flex-col items-end space-y-4 pointer-events-none">
          <div className="flex flex-col items-end">
            <span className="text-yellow-400 font-mono text-sm font-bold uppercase tracking-wider text-shadow-black mb-1">
              Intensidade
            </span>
            <div className={`
              px-4 py-2 rounded-lg font-mono font-bold text-5xl border-l-8 min-w-[240px] text-right bg-black/50 backdrop-blur-md shadow-lg
              ${displayDb > -10 ? 'text-red-500 border-red-500' : 
                displayDb > -20 ? 'text-orange-400 border-orange-400' : 
                'text-white border-yellow-400'}
            `}>
              {displayDb} <span className="text-2xl text-white/70">dB</span>
            </div>
          </div>

          <div className="flex flex-col items-end">
            <span className="text-yellow-400 font-mono text-sm font-bold uppercase tracking-wider text-shadow-black mb-1">
              Frequência (0.5s Média)
            </span>
            {/* Usa displayHzValue (persistedHz) para a caixa, mantendo o valor */}
            <div className="px-4 py-2 rounded-lg font-mono font-bold text-5xl border-l-8 border-white text-white min-w-[240px] text-right bg-black/50 backdrop-blur-md shadow-lg">
              {displayHzValue} <span className="text-2xl text-white/70">Hz</span>
            </div>
          </div>
          
          {noteName && (
             <div className="text-4xl font-black text-white/50 font-mono pr-2">
                {noteName}
             </div>
          )}
        </div>
      )}
    </div>
  );
};

const getNoteFromFreq = (freq: number) => {
  const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const a4 = 440;
  const n = Math.round(12 * (Math.log2(freq / a4))) + 69;
  const octave = Math.floor(n / 12) - 1;
  const noteIndex = n % 12;
  return `${noteStrings[noteIndex]}${octave}`;
};
