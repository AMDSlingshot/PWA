/**
 * useIMU — Accelerometer + Gyroscope at 200Hz
 */
import { useState, useEffect, useRef } from 'react';
import { Accelerometer, Gyroscope } from 'expo-sensors';

const TARGET_INTERVAL_MS = 5;

export function useIMU({ onSample, enabled = false }) {
  const [isAvailable, setIsAvailable] = useState(false);
  const [hasPermission, setHasPermission] = useState(false);
  const sampleRateRef = useRef(0); // FIX: ref not state — no re-render every second

  const onSampleRef = useRef(onSample);
  onSampleRef.current = onSample;

  const accelSub = useRef(null);
  const gyroSub = useRef(null);
  const latestGyro = useRef({ rx: 0, ry: 0, rz: 0 });
  const sampleCount = useRef(0);
  const rateTimer = useRef(null);

  useEffect(() => {
    async function checkSensors() {
      const accelAvail = await Accelerometer.isAvailableAsync();
      setIsAvailable(accelAvail);
      setHasPermission(true);
    }
    checkSensors();
  }, []);

  useEffect(() => {
    if (!isAvailable || !hasPermission) return;
    if (enabled) startSensors();
    else stopSensors();
    return () => stopSensors();
  }, [enabled, isAvailable, hasPermission]);

  function startSensors() {
    if (accelSub.current) return;
    Accelerometer.setUpdateInterval(TARGET_INTERVAL_MS);
    Gyroscope.setUpdateInterval(TARGET_INTERVAL_MS);

    gyroSub.current = Gyroscope.addListener((data) => {
      latestGyro.current = { rx: data.x, ry: data.y, rz: data.z };
    });

    accelSub.current = Accelerometer.addListener((data) => {
      sampleCount.current++;
      if (onSampleRef.current) {
        onSampleRef.current({
          type: 'IMU',
          timestamp: Date.now(),
          ax: data.x * 9.81,
          ay: data.y * 9.81,
          az: data.z * 9.81,
          ...latestGyro.current,
        });
      }
    });

    rateTimer.current = setInterval(() => {
      sampleRateRef.current = sampleCount.current; // FIX: ref only, no setState
      sampleCount.current = 0;
    }, 1000);
  }

  function stopSensors() {
    if (accelSub.current) { accelSub.current.remove(); accelSub.current = null; }
    if (gyroSub.current)  { gyroSub.current.remove();  gyroSub.current = null; }
    if (rateTimer.current) { clearInterval(rateTimer.current); rateTimer.current = null; }
    sampleRateRef.current = 0;
  }

  return {
    isAvailable,
    hasPermission,
    sampleRate: sampleRateRef.current,
    isActive: enabled && isAvailable && hasPermission,
  };
}