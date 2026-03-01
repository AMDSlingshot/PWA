/**
 * useCamera — Silent continuous video recording (no shutter, no preview freeze)
 *
 * Previous approach used takePictureAsync which on Android:
 *   1. Freezes the camera preview during capture
 *   2. Plays OS-level shutter sound (can't be suppressed)
 *   3. Blocks the JS thread during base64 encoding
 *
 * New approach: recordAsync() runs silently in native, zero UI impact.
 * Video segments are saved to disk and the file URI is sent to the backend.
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Camera } from "expo-camera";
import * as FileSystem from "expo-file-system";

const VIDEO_SEGMENT_SECONDS = 10; // Record in 10-second silent segments

export function useCamera({ onFrame, enabled = false }) {
  const [hasPermission, setHasPermission] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const cameraRef = useRef(null);
  const isRecordingVideo = useRef(false);
  const shouldContinue = useRef(false);

  useEffect(() => {
    async function requestPermission() {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === "granted");
    }
    requestPermission();
  }, []);

  useEffect(() => {
    if (enabled && isReady && hasPermission) startRecordingLoop();
    else stopRecordingLoop();
    return () => stopRecordingLoop();
  }, [enabled, isReady, hasPermission]);

  async function startRecordingLoop() {
    if (shouldContinue.current) return;
    shouldContinue.current = true;
    recordSegment();
  }

  async function recordSegment() {
    if (
      !shouldContinue.current ||
      !cameraRef.current ||
      isRecordingVideo.current
    )
      return;
    isRecordingVideo.current = true;

    try {
      const video = await cameraRef.current.recordAsync({
        maxDuration: VIDEO_SEGMENT_SECONDS,
        quality: "480p",
        mute: true, // No audio in video — we already capture audio separately
      });

      if (video?.uri && shouldContinue.current && onFrameRef.current) {
        // Read a small portion as data URI for WS, or just send the file path
        try {
          const info = await FileSystem.getInfoAsync(video.uri);
          onFrameRef.current({
            type: "VIDEO_SEGMENT",
            timestamp: Date.now(),
            uri: video.uri,
            fileSize: info.size || 0,
            durationMs: VIDEO_SEGMENT_SECONDS * 1000,
          });
        } catch (e) {
          // Send just the URI if we can't get file info
          onFrameRef.current({
            type: "VIDEO_SEGMENT",
            timestamp: Date.now(),
            uri: video.uri,
            durationMs: VIDEO_SEGMENT_SECONDS * 1000,
          });
        }
      }
    } catch (e) {
      // recordAsync can fail if camera is closed mid-record — that's fine
    }

    isRecordingVideo.current = false;

    // Loop: start next segment if still active
    if (shouldContinue.current) {
      // Small delay to let the camera settle between segments
      setTimeout(() => recordSegment(), 200);
    }
  }

  function stopRecordingLoop() {
    shouldContinue.current = false;
    if (isRecordingVideo.current && cameraRef.current) {
      try {
        cameraRef.current.stopRecording();
      } catch (e) {}
    }
    isRecordingVideo.current = false;
  }

  const handleCameraReady = useCallback(() => setIsReady(true), []);

  return {
    hasPermission,
    isReady,
    cameraRef,
    handleCameraReady,
    isActive: enabled && isReady && hasPermission,
  };
}
