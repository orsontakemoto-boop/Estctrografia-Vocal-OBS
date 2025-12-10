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

  const startAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      
      audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
      const ctx = audioContextRef.current;
      
      analyserRef.current = ctx.createAnalyser();
      analyserRef.current.fftSize = 2048; // Resolution of frequency
      analyserRef.current.smoothingTimeConstant = 0.0; // No smoothing for rapid changes

      sourceRef.current = ctx.createMediaStreamSource(stream);
      sourceRef.current.connect(analyserRef.current);

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
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const analyser = analyserRef.current;
    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    const timeDomainArray = new Float32Array(analyser.fftSize);

    // Get Data
    analyser.getByteFrequencyData(dataArray); // 0-255 for Spectrogram
    analyser.getFloatTimeDomainData(timeDomainArray); // -1.0 to 1.0 for Pitch/dB

    // --- 1. Calculations & Smoothing ---
    
    // Instantaneous values
    const rms = calculateRMS(timeDomainArray);
    const currentDb = amplitudeToDecibels(rms);
    const currentHz = autoCorrelate(timeDomainArray, audioContextRef.current?.sampleRate || 44100);

    // Update History Buffers for smoothing (0.5s window)
    dbHistoryRef.current.push(currentDb);
    if (dbHistoryRef.current.length > HISTORY_SIZE) dbHistoryRef.current.shift();

    // For Hz, maintain buffer but treat silence as 0
    hzHistoryRef.current.push(currentHz > 0 ? currentHz : 0);
    if (hzHistoryRef.current.length > HISTORY_SIZE) hzHistoryRef.current.shift();

    // Update UI State every 5 frames (~12fps) to keep numbers readable but responsive
    frameCountRef.current++;
    if (frameCountRef.current % 5 === 0) {
        // Average dB
        const avgDb = dbHistoryRef.current.reduce((a, b) => a + b, 0) / dbHistoryRef.current.length;
        setDb(avgDb);

        // Average Hz
        // We filter for valid pitches to calculate the average frequency of the voice, ignoring momentary silence in the buffer
        const validPitches = hzHistoryRef.current.filter(p => p > 0);
        if (validPitches.length > HISTORY_SIZE / 2) {
            // Require at least 50% of the window to have sound to show a frequency
            const avgHz = validPitches.reduce((a, b) => a + b, 0) / validPitches.length;
            setHz(avgHz);
        } else {
            setHz(0);
        }
    }

    // --- 2. Draw Spectrogram ---

    // Shift existing canvas content to the left by 1 pixel
    const width = canvas.width;
    const height = canvas.height;
    
    const imageData = ctx.getImageData(1, 0, width - 1, height);
    ctx.putImageData(imageData, 0, 0);

    // Clear the rightmost strip
    ctx.clearRect(width - 1, 0, 1, height);

    const relevantBinCount = Math.floor(bufferLength * 0.4); 
    
    for (let i = 0; i < relevantBinCount; i++) {
      const value = dataArray[i];
      
      const y = height - 1 - Math.floor((i / relevantBinCount) * height);
      const barHeight = Math.ceil(height / relevantBinCount) || 1;

      if (value > 0) {
        ctx.fillStyle = getColorForIntensity(value);
        ctx.fillRect(width - 1, y, 1, barHeight);
      }
    }

    animationIdRef.current = requestAnimationFrame(draw);
  };

  useEffect(() => {
    // Handle resize
    const handleResize = () => {
      if (containerRef.current && canvasRef.current) {
        canvasRef.current.width = containerRef.current.clientWidth;
        canvasRef.current.height = containerRef.current.clientHeight;
      }
    };

    window.addEventListener('resize', handleResize);
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      if (animationIdRef.current) cancelAnimationFrame(animationIdRef.current);
      if (audioContextRef.current) audioContextRef.current.close();
    };
  }, []);

  // Format dB for display
  const displayDb = Math.max(-100, Math.round(db));
  
  // Format Hz
  const displayHz = hz > 0 ? Math.round(hz) : "--";
  const noteName = hz > 0 ? getNoteFromFreq(hz) : "";

  return (
    <div ref={containerRef} className="relative w-full h-[300px] bg-transparent overflow-hidden group">
      {/* Start Button Overlay (Only visible if not started) */}
      {!isReady && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50">
          <button 
            onClick={startAudio}
            className="px-6 py-3 bg-yellow-400 hover:bg-yellow-500 text-black font-bold rounded shadow-lg transition"
          >
            Iniciar Espectrografia
          </button>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex items-center justify-center bg-red-900/80 text-white p-4 text-center">
          {error}
        </div>
      )}

      {/* The Spectrogram Canvas */}
      <canvas ref={canvasRef} className="w-full h-full block" />

      {/* Metrics Overlay - OBS Style */}
      {isReady && (
        <div className="absolute top-2 right-2 flex flex-col items-end space-y-4 pointer-events-none">
          {/* Decibel Meter */}
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

          {/* Frequency Meter */}
          <div className="flex flex-col items-end">
            <span className="text-yellow-400 font-mono text-sm font-bold uppercase tracking-wider text-shadow-black mb-1">
              Frequência
            </span>
            <div className="px-4 py-2 rounded-lg font-mono font-bold text-5xl border-l-8 border-white text-white min-w-[240px] text-right bg-black/50 backdrop-blur-md shadow-lg">
              {displayHz} <span className="text-2xl text-white/70">Hz</span>
            </div>
          </div>
          
          {/* Musical Note (Bonus) */}
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

// Simple helper for note name
const getNoteFromFreq = (freq: number) => {
  const noteStrings = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const a4 = 440;
  const n = Math.round(12 * (Math.log2(freq / a4))) + 69;
  const octave = Math.floor(n / 12) - 1;
  const noteIndex = n % 12;
  return `${noteStrings[noteIndex]}${octave}`;
};