import type { Detector } from "./types";

/**
 * Voice Isolation & Acoustic Telemetry Detector
 *
 * Implements a real-time Web Audio API signal processing pipeline:
 * 1. Hardware Noise Suppression & Echo Cancellation constraints on input stream.
 * 2. 2nd-order Biquad Band-Pass Filter isolating the fundamental human vocal formant spectrum (300 Hz – 3400 Hz).
 * 3. Fast Fourier Transform (FFT) spectral energy analysis + Root-Mean-Square (RMS) power calculation.
 * 4. Adaptive environmental noise floor calibration to reject ambient steady-state noise (fans, air conditioning).
 * 5. Temporal integration to prevent transient clicks (key strokes, desk bumps) from triggering false positives,
 *    flagging sustained human vocalization / speech communication.
 */
export const voiceIsolationDetector: Detector = (emit) => {
  // If window or Web Audio API is unavailable (e.g. headless SSR / test environment), exit cleanly
  if (typeof window === "undefined" || !navigator?.mediaDevices?.getUserMedia) {
    return () => {};
  }

  let isDestroyed = false;
  let audioCtx: AudioContext | null = null;
  let mediaStream: MediaStream | null = null;
  let analyser: AnalyserNode | null = null;
  let monitorInterval: any = null;

  // Vocal activity state tracking
  let continuousSpeechMs = 0;
  let noiseFloorRms = 0.02; // Dynamic baseline noise floor
  let lastEmissionTime = 0;

  const initAudio = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1
        }
      });

      if (isDestroyed) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }

      mediaStream = stream;
      const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
      if (!AudioContextClass) return;

      audioCtx = new AudioContextClass();
      if (audioCtx.state === "suspended") {
        void audioCtx.resume();
      }

      const source = audioCtx.createMediaStreamSource(stream);

      // Voice Formant Band-pass Filter (300 Hz - 3400 Hz)
      const bandpass = audioCtx.createBiquadFilter();
      bandpass.type = "bandpass";
      bandpass.frequency.value = 1850; // Center frequency of speech band
      bandpass.Q.value = 1.0; // Standard bandwidth covering ~300Hz - 3400Hz

      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.smoothingTimeConstant = 0.8;

      source.connect(bandpass);
      bandpass.connect(analyser);

      const bufferLength = analyser.frequencyBinCount;
      const dataArray = new Float32Array(bufferLength);
      const timeDomainData = new Float32Array(bufferLength);

      const sampleRate = audioCtx.sampleRate;
      const binWidth = (sampleRate / 2) / bufferLength;

      // Monitor interval (every 200ms)
      monitorInterval = setInterval(() => {
        if (!analyser || isDestroyed) return;

        analyser.getFloatTimeDomainData(timeDomainData);
        analyser.getFloatFrequencyData(dataArray);

        // 1. Calculate RMS energy
        let sumSquares = 0;
        for (let i = 0; i < timeDomainData.length; i++) {
          sumSquares += timeDomainData[i] * timeDomainData[i];
        }
        const rms = Math.sqrt(sumSquares / timeDomainData.length);

        // 2. Adaptive noise floor tracking (slowly adapts when signal is quiet)
        if (rms < noiseFloorRms * 1.5) {
          noiseFloorRms = noiseFloorRms * 0.95 + rms * 0.05;
        }

        // 3. Spectral Energy in Human Vocal Band (300Hz - 3000Hz)
        let speechBandEnergy = 0;
        let totalEnergy = 0;

        for (let i = 0; i < bufferLength; i++) {
          const freq = i * binWidth;
          const power = Math.pow(10, dataArray[i] / 10); // dB to linear power
          totalEnergy += power;
          if (freq >= 300 && freq <= 3200) {
            speechBandEnergy += power;
          }
        }

        const speechConcentration = totalEnergy > 0 ? speechBandEnergy / totalEnergy : 0;
        const speechThreshold = Math.max(0.04, noiseFloorRms * 2.5);

        // Human speech typically features concentrated harmonic energy between 300Hz and 3kHz
        const isVoiceActive = rms > speechThreshold && speechConcentration > 0.55;

        if (isVoiceActive) {
          continuousSpeechMs += 200;
        } else {
          continuousSpeechMs = Math.max(0, continuousSpeechMs - 150);
        }

        const now = Date.now();
        // Flag when sustained speech occurs for > 1200ms and throttle emissions to once per 8 seconds
        if (continuousSpeechMs >= 1200 && now - lastEmissionTime > 8000) {
          lastEmissionTime = now;
          const estimatedDb = Math.round(20 * Math.log10(Math.max(rms, 0.0001)) + 100);

          emit({
            event_type: "VOICE_DETECTED",
            event_category: "AUDIO",
            severity: "MEDIUM",
            detection_source: "voice_isolation_engine",
            confidence: "CONFIRMED",
            event_description: `Acoustic voice activity detected via bandpass-isolated formant analysis (~${estimatedDb} dB SPL).`,
            warning: "Speech or vocal sounds detected. Examination environment must remain quiet and free of spoken assistance.",
            metadata: {
              rms: parseFloat(rms.toFixed(4)),
              db_level: estimatedDb,
              vocal_concentration: parseFloat(speechConcentration.toFixed(2)),
              duration_ms: continuousSpeechMs
            }
          });
        }
      }, 200);
    } catch {
      // Microphone access declined or not supported: gracefully continue without blocking
    }
  };

  void initAudio();

  return () => {
    isDestroyed = true;
    if (monitorInterval) clearInterval(monitorInterval);
    if (mediaStream) {
      mediaStream.getTracks().forEach((t) => t.stop());
    }
    if (audioCtx && audioCtx.state !== "closed") {
      void audioCtx.close();
    }
  };
};
