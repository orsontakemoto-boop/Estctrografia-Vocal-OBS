
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
  const SCROLL_SPEED = 2; // 2x a velocidade original (2px por frame)

  // Smoothing Refs (Buffers para média de 0.5s)
  const dbHistoryRef = useRef<number[]>([]);
  const hzHistoryRef = useRef<number[]>([]);
  const frameCountRef = useRef<number>(0);
  const HISTORY_SIZE = 30; // ~0.5 segundos a 60fps

  // State for UI Overlay
  const [db, setDb] = useState<number>(-100);
  const [hz, setHz] = useState<number>(0);
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
    if (!canvasRef.current || !analyserRef.current) return;

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
    if (frameCountRef.current % 5 === 0) {
        const avgDb = dbHistoryRef.current.reduce((a, b) => a + b, 0) / dbHistoryRef.current.length;
        setDb(avgDb);

        const validPitches = hzHistoryRef.current.filter(p => p > 0);
        if (validPitches.length > HISTORY_SIZE / 2) {
            const avgHz = validPitches.reduce((a, b) => a + b, 0) / validPitches.length;
            setHz(avgHz);
        } else {
            setHz(0);
        }
    }

    // --- 2. Draw Spectrogram ---

    const width = canvas.width;
    const height = canvas.height;
    
    // Shift canvas to the left by SCROLL_SPEED
    ctx.drawImage(canvas, SCROLL_SPEED, 0, width - SCROLL_SPEED, height, 0, 0, width - SCROLL_SPEED, height);

    // Clear the rightmost strip
    ctx.clearRect(width - SCROLL_SPEED, 0, SCROLL_SPEED, height);

    // Use about 40% of the frequency bins (human voice focus)
    const relevantBinCount = Math.floor(bufferLength * 0.4); 
    
    for (let i = 0; i < relevantBinCount; i++) {
      const value = dataArray[i];
      const y = height - 1 - Math.floor((i / relevantBinCount) * height);
      const barHeight = Math.ceil(height / relevantBinCount) || 1;

      if (value > 0) {
        ctx.fillStyle = getColorForIntensity(value);
        // Draw rectangle with SCROLL_SPEED width
        ctx.fillRect(width - SCROLL_SPEED, y, SCROLL_SPEED, barHeight);
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

  const displayDb = Math.max(-100, Math.round(db));
  const displayHz = hz > 0 ? Math.round(hz) : "--";
  const noteName = hz > 0 ? getNoteFromFreq(hz) : "";

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

      <canvas ref={canvasRef} className="w-full h-full block" />

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
              Frequência
            </span>
            <div className="px-4 py-2 rounded-lg font-mono font-bold text-5xl border-l-8 border-white text-white min-w-[240px] text-right bg-black/50 backdrop-blur-md shadow-lg">
              {displayHz} <span className="text-2xl text-white/70">Hz</span>
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
