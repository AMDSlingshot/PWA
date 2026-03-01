/**
 * useAudio — Microphone RMS every 100ms
 */
import { useState, useEffect, useRef } from 'react';
import { Audio } from 'expo-av';

const METERING_INTERVAL_MS = 100;

export function useAudio({ onSample, enabled = false }) {
  const [hasPermission, setHasPermission] = useState(false);
  const onSampleRef = useRef(onSample);
  onSampleRef.current = onSample;

  const recordingRef = useRef(null);
  const meteringTimer = useRef(null);

  useEffect(() => {
    async function requestPermission() {
      const { status } = await Audio.requestPermissionsAsync();
      setHasPermission(status === 'granted');
    }
    requestPermission();
    return () => cleanup();
  }, []);

  useEffect(() => {
    if (enabled && hasPermission) startRecording();
    else stopRecording();
    return () => stopRecording();
  }, [enabled, hasPermission]);

  async function startRecording() {
    if (recordingRef.current) return;
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: true,
        playsInSilentModeIOS: true,
        staysActiveInBackground: true,
      });

      const recording = new Audio.Recording();
      await recording.prepareToRecordAsync({
        android: {
          extension: '.m4a',
          outputFormat: Audio.AndroidOutputFormat.MPEG_4,
          audioEncoder: Audio.AndroidAudioEncoder.AAC,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 64000,
        },
        ios: {
          extension: '.m4a',
          outputFormat: Audio.IOSOutputFormat.MPEG4AAC,
          audioQuality: Audio.IOSAudioQuality.MEDIUM,
          sampleRate: 44100,
          numberOfChannels: 1,
          bitRate: 64000,
          linearPCMBitDepth: 16,
          linearPCMIsBigEndian: false,
          linearPCMIsFloat: false,
        },
        web: {},
        isMeteringEnabled: true,
      });

      await recording.startAsync();
      recordingRef.current = recording;

      meteringTimer.current = setInterval(async () => {
        if (!recordingRef.current) return;
        try {
          const status = await recordingRef.current.getStatusAsync();
          if (!status.isRecording) return;
          const dbfs = status.metering || -160;
          const rms = Math.pow(10, dbfs / 20);
          if (onSampleRef.current) {
            onSampleRef.current({ type: 'AUDIO', timestamp: Date.now(), rms, dbfs, sample_rate: 44100 });
          }
        } catch (e) {}
      }, METERING_INTERVAL_MS);
    } catch (e) {
      console.error('[Audio] Failed to start:', e);
    }
  }

  async function stopRecording() {
    if (meteringTimer.current) { clearInterval(meteringTimer.current); meteringTimer.current = null; }
    if (recordingRef.current) {
      try { await recordingRef.current.stopAndUnloadAsync(); } catch (e) {}
      recordingRef.current = null;
    }
  }

  async function cleanup() {
    await stopRecording();
    try { await Audio.setAudioModeAsync({ allowsRecordingIOS: false }); } catch (e) {}
  }

  return {
    hasPermission,
    isActive: enabled && hasPermission && !!recordingRef.current,
  };
}