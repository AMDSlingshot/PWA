/**
 * RecordingScreen — Main recording interface
 */

import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  memo,
} from "react";
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  Dimensions,
  ScrollView,
  Alert,
} from "react-native";
import { CameraView } from "expo-camera";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import { useNavigation, useRoute } from "@react-navigation/native";

import { useIMU } from "../hooks/useIMU";
import { useGPS } from "../hooks/useGPS";
import { useCamera } from "../hooks/useCamera";
import { useAudio } from "../hooks/useAudio";

import SensorStatusBar from "../components/SensorStatusBar";
import AccelWaveform from "../components/AccelWaveform";
import IRIGauge from "../components/IRIGauge";
import SegmentHistory from "../components/SegmentHistory";

import wsClient from "../services/WebSocketClient";
import {
  saveSegment,
  createSession,
  finalizeSession,
} from "../services/OfflineBuffer";
import {
  pushSample,
  computeRollingIRI,
  resetIRIEstimator,
} from "../utils/iriEstimate";
import { COLORS, SPACING, RADIUS } from "../utils/theme";

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const SESSION_ID_PREFIX = "pulse_";

// ─── Memoized camera component — never re-renders during display ticks ───────
const StableCamera = React.memo(({ cameraRef, onCameraReady }) => (
  <CameraView
    ref={cameraRef}
    style={{ flex: 1 }}
    facing="back"
    onCameraReady={onCameraReady}
  />
));

// ─── Merge all display values into one state object → one render per tick ────
const INITIAL_DISPLAY = {
  accelZ: 0,
  currentIRI: null,
  isSpeedValid: false,
  speedKmh: 0,
  distanceM: 0,
  gpsCoords: null,
  audioRMS: 0,
  currentSegmentDistance: 0,
  elapsedSeconds: 0,
  wsStatus: "off",
};

export default function RecordingScreen() {
  const navigation = useNavigation();
  const route = useRoute();
  const { sessionName, serverHost, segmentLengthM } = route.params;

  const [isRecording, setIsRecording] = useState(false);
  const [display, setDisplay] = useState(INITIAL_DISPLAY);
  const [completedSegments, setCompletedSegments] = useState([]);
  const [queueSize, setQueueSize] = useState(0);

  // ─── All raw/live values in refs — zero re-renders ─────────────────────────
  const refs = useRef({
    isRecording: false,
    isStopping: false,
    sessionId: null,
    sessionStartTime: null,
    accelZ: 0,
    audioRMS: 0,
    speedKmh: 0,
    distanceM: 0,
    isSpeedValid: false,
    gpsCoords: null,
    segmentDist: 0,
    currentIRI: null,
    completedSegments: [],
    segmentStartDist: 0,
    segmentIndex: 0,
    wsStatus: "off",
    elapsedSeconds: 0,
  }).current;

  const elapsedTimer = useRef(null);
  const displayTimer = useRef(null);
  const iriTimer = useRef(null);
  const segIndexRef = useRef(0); // needed for render

  // ─── Single display update tick — ONE setState = ONE render ────────────────
  const startDisplayTimer = useCallback(() => {
    if (displayTimer.current) return;
    displayTimer.current = setInterval(() => {
      setDisplay({
        accelZ: refs.accelZ,
        currentIRI: refs.currentIRI,
        isSpeedValid: refs.isSpeedValid,
        speedKmh: refs.speedKmh,
        distanceM: refs.distanceM,
        gpsCoords: refs.gpsCoords,
        audioRMS: refs.audioRMS,
        currentSegmentDistance: refs.segmentDist,
        elapsedSeconds: refs.elapsedSeconds,
        wsStatus: refs.wsStatus,
      });
    }, 250); // ~4fps — smooth enough, far fewer re-renders than 150ms (was ~7fps)
  }, []);

  const stopDisplayTimer = useCallback(() => {
    if (displayTimer.current) {
      clearInterval(displayTimer.current);
      displayTimer.current = null;
    }
  }, []);

  // ─── Sensor Hooks ──────────────────────────────────────────────────────────
  const imu = useIMU({
    enabled: isRecording,
    onSample: useCallback((packet) => {
      if (!refs.isRecording) return;
      refs.accelZ = packet.az - 9.81;
      pushSample(packet.az, refs.speedKmh);
      wsClient.send(packet);
    }, []),
  });

  const gps = useGPS({
    enabled: isRecording,
    onSample: useCallback(
      (packet) => {
        if (!refs.isRecording) return;
        refs.speedKmh = packet.speed_kmh;
        refs.isSpeedValid = packet.speed_kmh >= 20;
        refs.distanceM = packet.distance_m;
        refs.gpsCoords = { lat: packet.lat, lng: packet.lng };
        refs.segmentDist = packet.distance_m - refs.segmentStartDist;
        if (refs.segmentDist >= segmentLengthM) {
          refs.segmentStartDist = packet.distance_m;
        }
        wsClient.send(packet);
      },
      [segmentLengthM],
    ),
  });

  const camera = useCamera({
    enabled: isRecording,
    onFrame: useCallback((packet) => {
      if (!refs.isRecording) return;
      // Video segments are file URIs — send metadata only (backend can fetch/skip video)
      wsClient.send({
        type: "VIDEO_SEGMENT",
        timestamp: packet.timestamp,
        uri: packet.uri,
        fileSize: packet.fileSize || 0,
        durationMs: packet.durationMs,
      });
    }, []),
  });

  const audio = useAudio({
    enabled: isRecording,
    onSample: useCallback((packet) => {
      if (!refs.isRecording) return;
      refs.audioRMS = packet.rms;
      wsClient.send(packet);
    }, []),
  });

  // ─── WebSocket callbacks ───────────────────────────────────────────────────
  useEffect(() => {
    wsClient.onConnected = () => {
      refs.wsStatus = "connected";
    };
    wsClient.onDisconnected = () => {
      refs.wsStatus = "disconnected";
    };
    wsClient.onSegmentComplete = handleSegmentComplete;
    wsClient.onQueueDrain = () => setQueueSize(0);
    return () => {
      wsClient.onConnected = null;
      wsClient.onDisconnected = null;
      wsClient.onSegmentComplete = null;
      wsClient.onQueueDrain = null;
    };
  }, []);

  useEffect(() => {
    const t = setInterval(() => {
      const size = wsClient.getStatus().queueSize;
      // Only trigger re-render if queueSize actually changed
      setQueueSize((prev) => (prev === size ? prev : size));
    }, 2000);
    return () => clearInterval(t);
  }, []);

  // ─── Segment Complete ──────────────────────────────────────────────────────
  async function handleSegmentComplete(segment) {
    const seg = { ...segment, segment_index: refs.segmentIndex };
    refs.segmentIndex++;
    segIndexRef.current = refs.segmentIndex;
    refs.completedSegments = [...refs.completedSegments, seg];
    setCompletedSegments([...refs.completedSegments]);
    if (refs.sessionId) {
      await saveSegment(refs.sessionId, seg.segment_index, seg);
    }
  }

  // ─── Start ─────────────────────────────────────────────────────────────────
  async function startRecording() {
    if (refs.isRecording) return;

    // Flip state immediately so stop button shows
    refs.isRecording = true;
    refs.isStopping = false;
    setIsRecording(true);

    const newSessionId = SESSION_ID_PREFIX + Date.now();
    refs.sessionId = newSessionId;
    refs.accelZ = 0;
    refs.audioRMS = 0;
    refs.speedKmh = 0;
    refs.distanceM = 0;
    refs.isSpeedValid = false;
    refs.gpsCoords = null;
    refs.segmentDist = 0;
    refs.currentIRI = null;
    refs.completedSegments = [];
    refs.segmentStartDist = 0;
    refs.segmentIndex = 0;
    refs.elapsedSeconds = 0;
    refs.wsStatus = "connecting";
    segIndexRef.current = 0;

    setCompletedSegments([]);
    setDisplay({ ...INITIAL_DISPLAY, wsStatus: "connecting" });

    gps.resetDistance();
    resetIRIEstimator();

    await createSession({ id: newSessionId, name: sessionName, serverHost });

    wsClient.connect(serverHost, newSessionId);
    await activateKeepAwakeAsync();

    refs.sessionStartTime = Date.now();

    // Elapsed time — just update the ref, display timer handles the render
    elapsedTimer.current = setInterval(() => {
      refs.elapsedSeconds = Math.floor(
        (Date.now() - refs.sessionStartTime) / 1000,
      );
    }, 1000);

    // IRI computation
    iriTimer.current = setInterval(() => {
      refs.currentIRI = computeRollingIRI();
    }, 500);

    // Start the single display update loop
    startDisplayTimer();
  }

  // ─── Stop ──────────────────────────────────────────────────────────────────
  function stopRecording() {
    Alert.alert("Stop Recording", "End this session and save all data?", [
      { text: "Cancel", style: "cancel" },
      { text: "Stop & Save", style: "destructive", onPress: confirmStop },
    ]);
  }

  async function confirmStop() {
    if (refs.isStopping) return;
    refs.isStopping = true;
    refs.isRecording = false;

    setIsRecording(false);
    stopDisplayTimer();

    clearInterval(elapsedTimer.current);
    elapsedTimer.current = null;
    clearInterval(iriTimer.current);
    iriTimer.current = null;

    wsClient.disconnect();
    refs.wsStatus = "off";
    deactivateKeepAwake();

    try {
      if (refs.sessionId) {
        const segs = refs.completedSegments;
        const avgIRI =
          segs.length > 0
            ? segs.reduce((s, seg) => s + (seg.iri_value || 0), 0) / segs.length
            : null;
        await finalizeSession(refs.sessionId, {
          distanceM: refs.distanceM,
          segmentCount: segs.length,
          avgIRI,
        });
      }
    } catch (e) {
      console.error("[Stop] finalizeSession failed:", e);
    }

    navigation.replace("History");
  }

  // ─── Derived display values (memoized to prevent child re-renders) ─────────
  const sensorStatuses = useMemo(
    () => ({
      imu: imu.isActive ? "active" : isRecording ? "error" : "off",
      gps: gps.isActive
        ? display.isSpeedValid
          ? "active"
          : "degraded"
        : isRecording
          ? "error"
          : "off",
      camera: camera.isActive ? "active" : isRecording ? "degraded" : "off",
      audio: audio.isActive ? "active" : isRecording ? "degraded" : "off",
      ws:
        display.wsStatus === "connected"
          ? "active"
          : display.wsStatus === "connecting"
            ? "degraded"
            : display.wsStatus === "disconnected"
              ? "error"
              : "off",
    }),
    [
      imu.isActive,
      gps.isActive,
      camera.isActive,
      audio.isActive,
      display.isSpeedValid,
      display.wsStatus,
      isRecording,
    ],
  );

  function formatElapsed(secs) {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0)
      return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }

  function formatDistance(meters) {
    if (meters >= 1000) return `${(meters / 1000).toFixed(2)} km`;
    return `${Math.round(meters)} m`;
  }

  const wsStatus = display.wsStatus;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg0} />

      {/* Header */}
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.sessionName} numberOfLines={1}>
            {sessionName}
          </Text>
          <Text style={styles.sessionMeta}>
            {isRecording ? formatElapsed(display.elapsedSeconds) : "READY"} ·{" "}
            {formatDistance(display.distanceM)} · SEG {segIndexRef.current}
          </Text>
        </View>
        <View
          style={[
            styles.wsBadge,
            wsStatus === "connected" && styles.wsBadgeConnected,
            wsStatus === "connecting" && styles.wsBadgeConnecting,
            wsStatus === "disconnected" && styles.wsBadgeDisconnected,
          ]}
        >
          <Text
            style={[
              styles.wsBadgeText,
              wsStatus === "connected" && { color: COLORS.green },
              wsStatus === "connecting" && { color: COLORS.amber },
              wsStatus === "disconnected" && { color: COLORS.red },
            ]}
          >
            {wsStatus === "connected"
              ? "● LIVE"
              : wsStatus === "connecting"
                ? "◌ LINKING"
                : wsStatus === "disconnected"
                  ? "○ OFFLINE"
                  : "○ IDLE"}
          </Text>
          {queueSize > 0 && <Text style={styles.queueBadge}>{queueSize}Q</Text>}
        </View>
      </View>

      {/* Sensor Bar */}
      <View style={styles.sensorBar}>
        <SensorStatusBar
          statuses={sensorStatuses}
          sampleRate={imu.sampleRate}
        />
      </View>

      {/* Scrollable content */}
      <ScrollView
        style={styles.scrollArea}
        contentContainerStyle={styles.scrollContent}
      >
        {/* Camera — StableCamera is memoized, overlays re-render independently */}
        <View style={styles.cameraContainer}>
          {camera.hasPermission ? (
            <StableCamera
              cameraRef={camera.cameraRef}
              onCameraReady={camera.handleCameraReady}
            />
          ) : (
            <View style={styles.cameraPlaceholder}>
              <Text style={styles.cameraPlaceholderText}>
                CAM PERMISSION REQUIRED
              </Text>
            </View>
          )}
          {isRecording && !display.isSpeedValid && (
            <View style={styles.speedWarning}>
              <Text style={styles.speedWarningText}>
                ⚠ SPEED &lt; 20 km/h — IRI INVALID
              </Text>
            </View>
          )}
          {display.gpsCoords && (
            <View style={styles.gpsOverlay}>
              <Text style={styles.gpsText}>
                {display.gpsCoords.lat.toFixed(5)},{" "}
                {display.gpsCoords.lng.toFixed(5)}
              </Text>
            </View>
          )}
        </View>

        {/* Data Panels */}
        <View style={styles.dataPanels}>
          <View style={styles.iriPanel}>
            <IRIGauge
              iri={display.currentIRI}
              isValid={display.isSpeedValid || !isRecording}
            />
            <Text style={styles.iriNote}>LIVE ESTIMATE</Text>
          </View>
          <View style={styles.rightPanel}>
            <View style={styles.speedPanel}>
              <Text
                style={[
                  styles.speedValue,
                  { color: display.isSpeedValid ? COLORS.green : COLORS.amber },
                ]}
              >
                {display.speedKmh.toFixed(0)}
              </Text>
              <Text style={styles.speedUnit}>km/h</Text>
            </View>
            <View style={styles.waveformPanel}>
              <Text style={styles.waveformLabel}>ACCEL Z m/s²</Text>
              <AccelWaveform value={display.accelZ} />
            </View>
            <View style={styles.audioPanel}>
              <Text style={styles.audioLabel}>MIC RMS</Text>
              <View style={styles.audioBar}>
                <View
                  style={[
                    styles.audioFill,
                    {
                      width: `${Math.min(100, display.audioRMS * 500)}%`,
                      backgroundColor:
                        display.audioRMS > 0.1 ? COLORS.amber : COLORS.amberDim,
                    },
                  ]}
                />
              </View>
            </View>
          </View>
        </View>

        {/* Segment Progress */}
        {isRecording && (
          <View style={styles.segmentProgress}>
            <View style={styles.segmentProgressTrack}>
              <View
                style={[
                  styles.segmentProgressFill,
                  {
                    width: `${Math.min(100, (display.currentSegmentDistance / segmentLengthM) * 100)}%`,
                  },
                ]}
              />
            </View>
            <Text style={styles.segmentProgressText}>
              {Math.round(display.currentSegmentDistance)}m / {segmentLengthM}m
              SEGMENT {segIndexRef.current + 1}
            </Text>
          </View>
        )}

        {/* Segment History */}
        <View style={styles.historyContainer}>
          <Text style={styles.historyLabel}>COMPLETED SEGMENTS</Text>
          <SegmentHistory segments={completedSegments} />
        </View>
      </ScrollView>

      {/* Button — pinned at bottom */}
      <View style={styles.buttonArea}>
        {!isRecording ? (
          <TouchableOpacity
            style={styles.recordBtn}
            onPress={startRecording}
            activeOpacity={0.8}
          >
            <View style={styles.recordBtnInner}>
              <View style={styles.recordDot} />
            </View>
            <Text style={styles.recordBtnLabel}>START RECORDING</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity
            style={styles.stopBtn}
            onPress={stopRecording}
            activeOpacity={0.8}
          >
            <View style={styles.stopBtnInner}>
              <View style={styles.stopSquare} />
            </View>
            <Text style={styles.stopBtnLabel}>STOP SESSION</Text>
          </TouchableOpacity>
        )}
      </View>
    </SafeAreaView>
  );
}

const CAMERA_HEIGHT = 160;

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: COLORS.bg0 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    paddingHorizontal: SPACING.md,
    paddingTop: SPACING.sm,
    paddingBottom: 6,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  sessionName: {
    fontSize: 13,
    color: COLORS.textPrimary,
    fontWeight: "600",
    letterSpacing: 0.3,
    maxWidth: SCREEN_WIDTH * 0.55,
  },
  sessionMeta: {
    fontSize: 10,
    color: COLORS.textMuted,
    letterSpacing: 0.5,
    marginTop: 2,
  },
  wsBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.bg2,
  },
  wsBadgeConnected: {
    borderColor: COLORS.green + "60",
    backgroundColor: COLORS.greenFaint,
  },
  wsBadgeConnecting: {
    borderColor: COLORS.amber + "60",
    backgroundColor: COLORS.amberFaint,
  },
  wsBadgeDisconnected: {
    borderColor: COLORS.red + "40",
    backgroundColor: COLORS.redFaint,
  },
  wsBadgeText: {
    fontSize: 9,
    fontWeight: "800",
    letterSpacing: 1,
    color: COLORS.textMuted,
  },
  queueBadge: { fontSize: 8, color: COLORS.amber, fontWeight: "700" },
  sensorBar: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  scrollArea: { flex: 1 },
  scrollContent: { flexGrow: 1 },
  cameraContainer: {
    height: CAMERA_HEIGHT,
    backgroundColor: COLORS.bg2,
    position: "relative",
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  camera: { flex: 1 },
  cameraPlaceholder: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
  },
  cameraPlaceholderText: {
    fontSize: 11,
    color: COLORS.textMuted,
    letterSpacing: 2,
  },
  speedWarning: {
    position: "absolute",
    bottom: 8,
    left: 0,
    right: 0,
    alignItems: "center",
  },
  speedWarningText: {
    fontSize: 10,
    color: COLORS.amber,
    backgroundColor: COLORS.bg0 + "CC",
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
    fontWeight: "700",
    letterSpacing: 1,
  },
  gpsOverlay: {
    position: "absolute",
    top: 8,
    right: 8,
    backgroundColor: COLORS.bg0 + "BB",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  gpsText: { fontSize: 9, color: COLORS.green, letterSpacing: 0.5 },
  dataPanels: {
    flexDirection: "row",
    padding: SPACING.md,
    gap: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  iriPanel: { flex: 1, alignItems: "center", gap: 4 },
  iriNote: { fontSize: 8, color: COLORS.textMuted, letterSpacing: 2 },
  rightPanel: { flex: 1.2, gap: SPACING.sm },
  speedPanel: { flexDirection: "row", alignItems: "flex-end", gap: 4 },
  speedValue: {
    fontSize: 36,
    fontWeight: "200",
    letterSpacing: -1,
    lineHeight: 38,
    fontVariant: ["tabular-nums"],
  },
  speedUnit: {
    fontSize: 11,
    color: COLORS.textMuted,
    marginBottom: 4,
    letterSpacing: 1,
  },
  waveformPanel: { gap: 4 },
  waveformLabel: { fontSize: 8, color: COLORS.textMuted, letterSpacing: 2 },
  audioPanel: { flexDirection: "row", alignItems: "center", gap: SPACING.sm },
  audioLabel: {
    fontSize: 8,
    color: COLORS.textMuted,
    letterSpacing: 1.5,
    width: 40,
  },
  audioBar: {
    flex: 1,
    height: 4,
    backgroundColor: COLORS.bg3,
    borderRadius: 2,
    overflow: "hidden",
  },
  audioFill: { height: "100%", borderRadius: 2 },
  segmentProgress: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    gap: 4,
  },
  segmentProgressTrack: {
    height: 3,
    backgroundColor: COLORS.bg3,
    borderRadius: 2,
    overflow: "hidden",
  },
  segmentProgressFill: {
    height: "100%",
    backgroundColor: COLORS.amber,
    borderRadius: 2,
  },
  segmentProgressText: {
    fontSize: 9,
    color: COLORS.textMuted,
    letterSpacing: 1.5,
  },
  historyContainer: {
    paddingHorizontal: SPACING.md,
    paddingVertical: 8,
    gap: 6,
  },
  historyLabel: {
    fontSize: 8,
    color: COLORS.textMuted,
    letterSpacing: 2,
    fontWeight: "600",
  },
  buttonArea: {
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.lg,
    paddingTop: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  recordBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.md,
    backgroundColor: COLORS.redFaint,
    borderWidth: 1,
    borderColor: COLORS.red + "80",
    borderRadius: RADIUS.md,
    paddingVertical: 16,
  },
  recordBtnInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.red,
    justifyContent: "center",
    alignItems: "center",
  },
  recordDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.red,
  },
  recordBtnLabel: {
    fontSize: 14,
    color: COLORS.red,
    fontWeight: "800",
    letterSpacing: 3,
  },
  stopBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: SPACING.md,
    backgroundColor: COLORS.bg3,
    borderWidth: 1,
    borderColor: COLORS.borderBright,
    borderRadius: RADIUS.md,
    paddingVertical: 16,
  },
  stopBtnInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: COLORS.textSecondary,
    justifyContent: "center",
    alignItems: "center",
  },
  stopSquare: {
    width: 12,
    height: 12,
    backgroundColor: COLORS.textSecondary,
    borderRadius: 2,
  },
  stopBtnLabel: {
    fontSize: 14,
    color: COLORS.textSecondary,
    fontWeight: "800",
    letterSpacing: 3,
  },
});
