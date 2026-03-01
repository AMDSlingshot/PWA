/**
 * SensorStatusBar — 5-channel sensor status indicators
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { COLORS } from "../utils/theme"; // FIX: removed unused FONTS import

const SENSORS = [
  { key: "imu", label: "IMU", sublabel: "200Hz" },
  { key: "gps", label: "GPS", sublabel: "L1" },
  { key: "camera", label: "CAM", sublabel: "2fps" },
  { key: "audio", label: "MIC", sublabel: "RMS" },
  { key: "ws", label: "LINK", sublabel: "WS" },
];

export default React.memo(function SensorStatusBar({
  statuses = {},
  sampleRate = 0,
}) {
  return (
    <View style={styles.container}>
      {SENSORS.map((sensor) => {
        const status = statuses[sensor.key] || "off";
        const color = getStatusColor(status);

        return (
          <View key={sensor.key} style={styles.sensor}>
            <View style={[styles.dot, { backgroundColor: color }]}>
              {status === "active" && (
                <View style={[styles.pulse, { borderColor: color }]} />
              )}
            </View>
            <Text style={[styles.label, { color }]}>{sensor.label}</Text>
            <Text style={styles.sublabel}>
              {sensor.key === "imu" && status === "active"
                ? `${sampleRate}Hz`
                : sensor.sublabel}
            </Text>
          </View>
        );
      })}
    </View>
  );
});

function getStatusColor(status) {
  switch (status) {
    case "active":
      return COLORS.green;
    case "degraded":
      return COLORS.amber;
    case "error":
      return COLORS.red;
    default:
      return COLORS.textMuted;
  }
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: 4,
  },
  sensor: {
    alignItems: "center",
    gap: 3,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    position: "relative",
  },
  pulse: {
    position: "absolute",
    top: -4,
    left: -4,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 1,
    opacity: 0.3,
  },
  label: {
    fontSize: 9,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  sublabel: {
    fontSize: 8,
    color: COLORS.textMuted,
    letterSpacing: 0.3,
  },
});
