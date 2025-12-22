
/**
 * Calculates the Root Mean Square (RMS) of the audio signal to determine volume.
 */
export const calculateRMS = (buffer: Float32Array): number => {
  let sum = 0;
  for (let i = 0; i < buffer.length; i++) {
    sum += buffer[i] * buffer[i];
  }
  return Math.sqrt(sum / buffer.length);
};

/**
 * Converts RMS amplitude to Decibels (dB).
 * Standardized so that 0dB is max volume (clipping), returning negative values usually.
 * We normalize it roughly for display purposes.
 */
export const amplitudeToDecibels = (rms: number): number => {
  if (rms <= 0) return -100;
  // 20 * log10(rms). Typically values are -60dB (quiet) to 0dB (loud).
  const db = 20 * Math.log10(rms);
  return Math.max(-100, db); 
};

/**
 * Autocorrelation algorithm to detect pitch (Fundamental Frequency - F0).
 * Optimized for human vocal range.
 */
export const autoCorrelate = (buffer: Float32Array, sampleRate: number): number => {
  const SIZE = buffer.length;
  const MAX_SAMPLES = Math.floor(SIZE / 2);
  let bestOffset = -1;
  let bestCorrelation = 0;
  let rms = 0;
  let foundGoodCorrelation = false;
  const correlations = new Float32Array(MAX_SAMPLES);

  for (let i = 0; i < SIZE; i++) {
    const val = buffer[i];
    rms += val * val;
  }
  rms = Math.sqrt(rms / SIZE);

  if (rms < 0.01) return -1;

  let lastCorrelation = 1;

  for (let offset = 0; offset < MAX_SAMPLES; offset++) {
    let correlation = 0;

    for (let i = 0; i < MAX_SAMPLES; i++) {
      correlation += Math.abs((buffer[i]) - (buffer[i + offset]));
    }
    
    correlation = 1 - (correlation / MAX_SAMPLES);
    correlations[offset] = correlation;

    if ((correlation > 0.9) && (correlation > lastCorrelation)) {
      foundGoodCorrelation = true;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    } else if (foundGoodCorrelation) {
      const shift = (correlations[bestOffset + 1] - correlations[bestOffset - 1]) / (2 * (2 * correlations[bestOffset] - correlations[bestOffset + 1] - correlations[bestOffset - 1]));
      return sampleRate / (bestOffset + shift);
    }
    lastCorrelation = correlation;
  }

  if (bestCorrelation > 0.01) {
      return sampleRate / bestOffset;
  }
  
  return -1;
};

/**
 * Generates an RGB string based on intensity (0-255).
 * Uses a Cold-to-Warm (Blue -> Cyan -> Green -> Yellow -> Red) colormap.
 */
export const getColorForIntensity = (value: number): string => {
    if (value < 2) return `rgba(0,0,0,0)`; // Quase silêncio é transparente
  
    let r = 0, g = 0, b = 0;
  
    // Escala térmica simplificada (0-255)
    if (value < 64) {
        // De Azul Escuro (0,0,100) para Azul Claro (0,150,255) - FRIO
        const ratio = value / 64;
        r = 0;
        g = 150 * ratio;
        b = 100 + (155 * ratio);
    } else if (value < 128) {
        // De Azul Claro (0,150,255) para Verde/Ciano (0,255,200)
        const ratio = (value - 64) / 64;
        r = 0;
        g = 150 + (105 * ratio);
        b = 255 - (55 * ratio);
    } else if (value < 192) {
        // De Verde (0,255,0) para Amarelo (255,255,0) - TRANSIÇÃO
        const ratio = (value - 128) / 64;
        r = 255 * ratio;
        g = 255;
        b = 0;
    } else {
        // De Amarelo (255,255,0) para Vermelho (255,0,0) - QUENTE
        const ratio = (value - 192) / 63;
        r = 255;
        g = 255 - (255 * ratio);
        b = 0;
    }
  
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  };
