/**
 * useCamera — Rear camera frame capture at 2fps
 */
import { useState, useEffect, useRef, useCallback } from 'react';
import { Camera } from 'expo-camera';

const FRAME_INTERVAL_MS = 500;
const FRAME_QUALITY = 0.7;

export function useCamera({ onFrame, enabled = false }) {
  const [hasPermission, setHasPermission] = useState(false);
  const [isReady, setIsReady] = useState(false);
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;

  const cameraRef = useRef(null);
  const frameTimer = useRef(null);
  const isCaptureActive = useRef(false);

  useEffect(() => {
    async function requestPermission() {
      const { status } = await Camera.requestCameraPermissionsAsync();
      setHasPermission(status === 'granted');
    }
    requestPermission();
  }, []);

  useEffect(() => {
    if (enabled && isReady && hasPermission) startCapture();
    else stopCapture();
    return () => stopCapture();
  }, [enabled, isReady, hasPermission]);

  function startCapture() {
    if (frameTimer.current) return;
    isCaptureActive.current = true;

    frameTimer.current = setInterval(async () => {
      if (!isCaptureActive.current || !cameraRef.current) return;
      try {
        const photo = await cameraRef.current.takePictureAsync({
          quality: FRAME_QUALITY,
          base64: true,
          skipProcessing: true,
          exif: false,
          width: 640,
        });
        if (photo?.base64 && onFrameRef.current) {
          onFrameRef.current({ type: 'FRAME', timestamp: Date.now(), data: photo.base64, width: photo.width, height: photo.height });
        }
      } catch (e) {}
    }, FRAME_INTERVAL_MS);
  }

  function stopCapture() {
    isCaptureActive.current = false;
    if (frameTimer.current) { clearInterval(frameTimer.current); frameTimer.current = null; }
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