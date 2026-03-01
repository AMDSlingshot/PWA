/**
 * SetupScreen — Configure server, session name, camera height
 */

import React, { useState, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  ScrollView, Alert, ActivityIndicator, Platform,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage'; // FIX: was missing
import { COLORS, SPACING, RADIUS } from '../utils/theme';

const STORAGE_KEYS = {
  SERVER_HOST: 'pulse_server_host',
  CAMERA_HEIGHT: 'pulse_camera_height',
  SEGMENT_LENGTH: 'pulse_segment_length',
};

export default function SetupScreen({ navigation }) {
  const [serverHost, setServerHost] = useState('192.168.1.100:8000');
  const [sessionName, setSessionName] = useState('');
  const [cameraHeightM, setCameraHeightM] = useState('1.20');
  const [segmentLengthM, setSegmentLengthM] = useState('100');
  const [isTestingConnection, setIsTestingConnection] = useState(false);
  const [connectionStatus, setConnectionStatus] = useState(null);

  useEffect(() => {
    loadSavedSettings();
    generateSessionName();
  }, []);

  async function loadSavedSettings() {
    try {
      const [host, height, segLen] = await Promise.all([
        AsyncStorage.getItem(STORAGE_KEYS.SERVER_HOST),
        AsyncStorage.getItem(STORAGE_KEYS.CAMERA_HEIGHT),
        AsyncStorage.getItem(STORAGE_KEYS.SEGMENT_LENGTH),
      ]);
      if (host) setServerHost(host);
      if (height) setCameraHeightM(height);
      if (segLen) setSegmentLengthM(segLen);
    } catch (e) {
      // Use defaults
    }
  }

  function generateSessionName() {
    const now = new Date();
    const date = now.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
    const time = now.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false });
    setSessionName(`Session ${date} ${time}`);
  }

  async function saveSettings() {
    try {
      await Promise.all([
        AsyncStorage.setItem(STORAGE_KEYS.SERVER_HOST, serverHost),
        AsyncStorage.setItem(STORAGE_KEYS.CAMERA_HEIGHT, cameraHeightM),
        AsyncStorage.setItem(STORAGE_KEYS.SEGMENT_LENGTH, segmentLengthM),
      ]);
    } catch (e) {
      // Non-critical
    }
  }

  async function testConnection() {
    setIsTestingConnection(true);
    setConnectionStatus(null);

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const response = await fetch(`http://${serverHost}/health`, { signal: controller.signal });
      clearTimeout(timeout);
      setConnectionStatus(response.ok ? 'ok' : 'fail');
    } catch (e) {
      setConnectionStatus('fail');
    } finally {
      setIsTestingConnection(false);
    }
  }

  async function startSession() {
    if (!sessionName.trim()) {
      Alert.alert('Session Name Required', 'Please enter a name for this session.');
      return;
    }

    const cameraHeight = parseFloat(cameraHeightM);
    if (isNaN(cameraHeight) || cameraHeight < 0.5 || cameraHeight > 3.0) {
      Alert.alert('Invalid Camera Height', 'Camera height must be between 0.5m and 3.0m.');
      return;
    }

    await saveSettings();

    navigation.navigate('Recording', {
      sessionName: sessionName.trim(),
      serverHost: serverHost.trim(),
      cameraHeightM: cameraHeight,
      segmentLengthM: parseInt(segmentLengthM, 10) || 100,
    });
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.logo}>PULSE</Text>
        <Text style={styles.logoSub}>COLLECTOR</Text>
        <Text style={styles.tagline}>Physical Understanding of Living Street Economics</Text>
      </View>

      <View style={styles.divider} />

      {/* Server Config */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>BACKEND SERVER</Text>
        <View style={styles.inputRow}>
          <TextInput
            style={styles.input}
            value={serverHost}
            onChangeText={setServerHost}
            placeholder="192.168.x.x:8000"
            placeholderTextColor={COLORS.textMuted}
            autoCapitalize="none"
            keyboardType="url"
          />
          <TouchableOpacity
            style={[styles.testBtn,
            connectionStatus === 'ok' && styles.testBtnOk,
            connectionStatus === 'fail' && styles.testBtnFail,
            ]}
            onPress={testConnection}
            disabled={isTestingConnection}
          >
            {isTestingConnection ? (
              <ActivityIndicator size="small" color={COLORS.green} />
            ) : (
              <Text style={[styles.testBtnText,
              connectionStatus === 'ok' && { color: COLORS.green },
              connectionStatus === 'fail' && { color: COLORS.red },
              ]}>
                {connectionStatus === 'ok' ? '✓ OK' : connectionStatus === 'fail' ? '✗ FAIL' : 'TEST'}
              </Text>
            )}
          </TouchableOpacity>
        </View>
        <Text style={styles.hint}>
          Start backend: <Text style={styles.code}>uvicorn main:app --host 0.0.0.0 --port 8000</Text>
        </Text>
      </View>

      {/* Session Config */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>SESSION</Text>
        <View style={styles.fieldGroup}>
          <Text style={styles.fieldLabel}>NAME</Text>
          <TextInput
            style={styles.input}
            value={sessionName}
            onChangeText={setSessionName}
            placeholder="Session name..."
            placeholderTextColor={COLORS.textMuted}
          />
        </View>
      </View>

      {/* Sensor Config */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>SENSOR PARAMETERS</Text>
        <View style={styles.paramRow}>
          <View style={styles.paramField}>
            <Text style={styles.fieldLabel}>CAMERA HEIGHT (m)</Text>
            <TextInput
              style={styles.inputSmall}
              value={cameraHeightM}
              onChangeText={setCameraHeightM}
              keyboardType="decimal-pad"
              placeholder="1.20"
              placeholderTextColor={COLORS.textMuted}
            />
            <Text style={styles.hint}>Measure from phone lens to road surface</Text>
          </View>
          <View style={styles.paramField}>
            <Text style={styles.fieldLabel}>SEGMENT LENGTH (m)</Text>
            <TextInput
              style={styles.inputSmall}
              value={segmentLengthM}
              onChangeText={setSegmentLengthM}
              keyboardType="number-pad"
              placeholder="100"
              placeholderTextColor={COLORS.textMuted}
            />
            <Text style={styles.hint}>IRI computed per segment</Text>
          </View>
        </View>
      </View>

      {/* Pre-flight */}
      <View style={styles.section}>
        <Text style={styles.sectionLabel}>PRE-FLIGHT CHECKLIST</Text>
        {[
          'Phone mounted rigidly (windshield/dashboard holder)',
          'Rear camera facing road ahead',
          'Backend server running and reachable',
          'Camera height measured and entered above',
          'Minimum drive speed: 20 km/h for valid IRI',
        ].map((item, i) => (
          <View key={i} style={styles.checkItem}>
            <Text style={styles.checkDot}>◇</Text>
            <Text style={styles.checkText}>{item}</Text>
          </View>
        ))}
      </View>

      {/* Start */}
      <TouchableOpacity style={styles.startBtn} onPress={startSession} activeOpacity={0.8}>
        <Text style={styles.startBtnText}>INITIALIZE SESSION</Text>
        <Text style={styles.startBtnSub}>5 sensor channels · WebSocket stream</Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.historyLink} onPress={() => navigation.navigate('History')}>
        <Text style={styles.historyLinkText}>VIEW SESSION HISTORY  →</Text>
      </TouchableOpacity>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.bg1 },
  content: { padding: SPACING.lg, paddingTop: SPACING.xl + 20, paddingBottom: SPACING.xxl, gap: SPACING.lg },
  header: { alignItems: 'center', gap: 4 },
  logo: { fontSize: 42, fontWeight: '100', color: COLORS.green, letterSpacing: 12 },
  logoSub: { fontSize: 10, color: COLORS.textMuted, letterSpacing: 4, fontWeight: '600' },
  tagline: { fontSize: 9, color: COLORS.textMuted, letterSpacing: 1, marginTop: 4, textAlign: 'center', opacity: 0.6 },
  divider: { height: 1, backgroundColor: COLORS.border },
  section: { gap: SPACING.sm },
  sectionLabel: { fontSize: 9, color: COLORS.textMuted, letterSpacing: 3, fontWeight: '700', marginBottom: 2 },
  inputRow: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'center' },
  input: {
    flex: 1, backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.sm, color: COLORS.textPrimary, paddingHorizontal: SPACING.md,
    paddingVertical: 12, fontSize: 14, letterSpacing: 0.3,
  },
  inputSmall: {
    backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.sm, color: COLORS.textPrimary, paddingHorizontal: SPACING.md,
    paddingVertical: 10, fontSize: 16, letterSpacing: 0.3, textAlign: 'center',
  },
  testBtn: {
    backgroundColor: COLORS.bg2, borderWidth: 1, borderColor: COLORS.border,
    borderRadius: RADIUS.sm, paddingHorizontal: 16, paddingVertical: 12, minWidth: 70, alignItems: 'center',
  },
  testBtnOk: { borderColor: COLORS.green + '80', backgroundColor: COLORS.greenFaint },
  testBtnFail: { borderColor: COLORS.red + '80', backgroundColor: COLORS.redFaint },
  testBtnText: { fontSize: 11, color: COLORS.textSecondary, fontWeight: '700', letterSpacing: 1 },
  hint: { fontSize: 10, color: COLORS.textMuted, lineHeight: 14 },
  code: { color: COLORS.amber, fontFamily: Platform.OS === 'ios' ? 'Courier New' : 'monospace', fontSize: 9 },
  fieldGroup: { gap: 6 },
  fieldLabel: { fontSize: 9, color: COLORS.textMuted, letterSpacing: 2, fontWeight: '600' },
  paramRow: { flexDirection: 'row', gap: SPACING.md },
  paramField: { flex: 1, gap: 6 },
  checkItem: { flexDirection: 'row', gap: SPACING.sm, alignItems: 'flex-start', paddingVertical: 3 },
  checkDot: { fontSize: 10, color: COLORS.textMuted, marginTop: 1 },
  checkText: { flex: 1, fontSize: 12, color: COLORS.textSecondary, lineHeight: 18 },
  startBtn: {
    backgroundColor: COLORS.greenFaint, borderWidth: 1, borderColor: COLORS.green + '60',
    borderRadius: RADIUS.md, paddingVertical: SPACING.lg, alignItems: 'center', gap: 4, marginTop: SPACING.sm,
  },
  startBtnText: { fontSize: 15, color: COLORS.green, fontWeight: '800', letterSpacing: 3 },
  startBtnSub: { fontSize: 10, color: COLORS.greenMid, letterSpacing: 1 },
  historyLink: { alignItems: 'center', paddingVertical: SPACING.md },
  historyLinkText: { fontSize: 10, color: COLORS.textMuted, letterSpacing: 2, fontWeight: '600' },
});
