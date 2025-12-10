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
  // Vocal range typically 85Hz to 1100Hz (Soprano High C is ~1046Hz)
  // We trim the search area to avoid false positives at very low/high frequencies
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

  // If signal is too quiet, return -1
  if (rms < 0.01) return -1;

  let lastCorrelation = 1;

  for (let offset = 0; offset < MAX_SAMPLES; offset++) {
    let correlation = 0;

    for (let i = 0; i < MAX_SAMPLES; i++) {
      correlation += Math.abs((buffer[i]) - (buffer[i + offset]));
    }
    
    // We want the difference to be close to 0 (similarity)
    // Inverting it to find "peak" similarity
    correlation = 1 - (correlation / MAX_SAMPLES);
    correlations[offset] = correlation; // Store for analysis if needed

    if ((correlation > 0.9) && (correlation > lastCorrelation)) {
      foundGoodCorrelation = true;
      if (correlation > bestCorrelation) {
        bestCorrelation = correlation;
        bestOffset = offset;
      }
    } else if (foundGoodCorrelation) {
      // Gaussian interpolation for better precision
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
 * Low: White -> Yellow
 * High: Orange -> Red
 */
export const getColorForIntensity = (value: number): string => {
    // Thresholds
    const lowEnd = 0;
    const midPoint = 150; // Transition from Yellow to Orange
    const highEnd = 255;
  
    if (value < 5) return `rgba(0,0,0,0)`; // Transparent for silence
  
    let r, g, b;
  
    if (value <= midPoint) {
      // Interpolate White (255, 255, 255) to Yellow (250, 204, 21)
      const ratio = value / midPoint;
      r = 255 - (5 * ratio); // 255 -> 250
      g = 255 - (51 * ratio); // 255 -> 204
      b = 255 - (234 * ratio); // 255 -> 21
    } else {
      // Interpolate Orange (249, 115, 22) to Red (239, 68, 68)
      // Actually let's blend from Yellow end to Red
      const ratio = (value - midPoint) / (highEnd - midPoint);
      
      // Start: Yellow (250, 204, 21)
      // End: Red (239, 68, 68)
      r = 250 - (11 * ratio);
      g = 204 - (136 * ratio);
      b = 21 + (47 * ratio);
    }
  
    return `rgb(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)})`;
  };