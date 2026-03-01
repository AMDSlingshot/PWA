/**
 * useCamera — Silent continuous video recording with HTTP upload
 *
 * Records short video segments using recordAsync() (silent, no preview freeze)
 * and uploads each clip via HTTP POST to the backend, which extracts frames
 * for depth estimation, visual assessment, and SLAM.
 *
 * Why this approach?
 *   - recordAsync() is native silent recording — no shutter, no preview freeze
 *   - No JS-thread base64 encoding overhead
 *   - Backend extracts frames from video using OpenCV (much more efficient)
 *   - HTTP multipart upload works reliably for binary data (vs large WS payloads)
 */
import { useState, useEffect, useRef, useCallback } from "react";
import { Camera } from "expo-camera";

const VIDEO_SEGMENT_SECONDS = 5; // Short clips for frequent processing

export function useCamera({ onFrame, enabled = false, serverHost = null, sessionId = null }) {
  const [hasPermission, setHasPermission] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const cameraRef = useRef(null);
  const isRecordingVideo = useRef(false);
  const shouldContinue = useRef(false);
  const serverHostRef = useRef(serverHost);
  const sessionIdRef = useRef(sessionId);

  // Keep refs in sync with latest prop values
  serverHostRef.current = serverHost;
  sessionIdRef.current = sessionId;

  // ── Permissions ──────────────────────────────────────────────────────────
  useEffect(() => {
    async function requestPermission() {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === "granted");
    }
    requestPermission();
  }, []);

  // ── Start / Stop recording loop ─────────────────────────────────────────
  useEffect(() => {
    if (enabled && isReady && hasPermission) {
      startRecordingLoop();
    } else {
      stopRecordingLoop();
    }
    return () => stopRecordingLoop();
  }, [enabled, isReady, hasPermission]);

  function startRecordingLoop() {
    if (shouldContinue.current) return;
    shouldContinue.current = true;
    recordSegment();
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

  async function recordSegment() {
    if (!shouldContinue.current || !cameraRef.current || isRecordingVideo.current) return;
    isRecordingVideo.current = true;

    try {
      const video = await cameraRef.current.recordAsync({
        maxDuration: VIDEO_SEGMENT_SECONDS,
        quality: "480p",
        mute: true,
      });

      if (video?.uri && shouldContinue.current) {
        // Upload the video file to the backend via HTTP
        uploadVideoSegment(video.uri);

        // Notify parent (for status tracking / WS metadata)
        if (onFrameRef.current) {
          onFrameRef.current({
            type: "VIDEO_SEGMENT",
            timestamp: Date.now(),
            uri: video.uri,
            durationMs: VIDEO_SEGMENT_SECONDS * 1000,
            uploaded: true,
          });
        }
      }
    } catch (e) {
      // When the user stops the session, stopRecording() interrupts the
      // in-progress recordAsync() before it finishes — this is expected.
      if (shouldContinue.current) {
        console.warn("[Camera] recordAsync error:", e.message);
      }
    }

    isRecordingVideo.current = false;

    // Loop: start next segment if still active
    if (shouldContinue.current) {
      setTimeout(() => recordSegment(), 200);
    }
  }

  async function uploadVideoSegment(uri) {
    const host = serverHostRef.current;
    const sid = sessionIdRef.current;
    if (!host || !sid) return;

    try {
      // Build the HTTP URL — match protocol to host
      const protocol = host.startsWith("https") ? "https" : "http";
      const cleanHost = host.replace(/^https?:\/\//, "");
      const url = `${protocol}://${cleanHost}/upload/video/${sid}`;

      const formData = new FormData();
      formData.append("video", {
        uri: uri,
        type: "video/mp4",
        name: `segment_${Date.now()}.mp4`,
      });

      const resp = await fetch(url, {
        method: "POST",
        body: formData,
        headers: { "Content-Type": "multipart/form-data" },
      });

      if (!resp.ok) {
        console.warn(`[Camera] Upload failed: ${resp.status}`);
      }
    } catch (e) {
      console.warn("[Camera] Upload error:", e.message);
      // Non-fatal — IMU/GPS/Audio still flow over WebSocket
    }
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
