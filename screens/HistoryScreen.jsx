/**
 * HistoryScreen — Past sessions list with stats and upload option
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  View, Text, FlatList, TouchableOpacity, StyleSheet,
  SafeAreaView, StatusBar, Alert, ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { useFocusEffect, useNavigation } from '@react-navigation/native';
import { getSessions, deleteSession, getSessionStats, exportSessionJSON } from '../services/OfflineBuffer';
import { COLORS, SPACING, RADIUS, getIRIColor, getIRILabel } from '../utils/theme';


export default function HistoryScreen() {
  const navigation = useNavigation();
  const [sessions, setSessions] = useState([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [sessionStats, setSessionStats] = useState({});

  // FIX: load on mount AND on focus to handle navigation.replace()
  useEffect(() => {
    loadSessions();
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadSessions();
    }, [])
  );

  async function loadSessions(isRefresh = false) {
    if (isRefresh) setIsRefreshing(true);
    else setIsLoading(true);

    try {
      const data = await getSessions();
      setSessions(data);

      // Load stats for each session
      const stats = {};
      for (const session of data) {
        try {
          stats[session.id] = await getSessionStats(session.id);
        } catch (e) {
          // no stats yet
        }
      }
      setSessionStats(stats);
    } catch (e) {
      console.error('Failed to load sessions:', e);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }

  async function handleDelete(session) {
    Alert.alert(
      'Delete Session',
      `Delete "${session.name}"? This cannot be undone.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteSession(session.id);
            loadSessions();
          },
        },
      ]
    );
  }
async function handleExport(session) {
  try {
    const json = await exportSessionJSON(session.id);
    Alert.alert('Export', JSON.stringify(JSON.parse(json), null, 2).slice(0, 500) + '\n\n[Copy from console]');
    console.log('PULSE EXPORT:', json);
  } catch (e) {
    Alert.alert('Export Failed', e.message);
  }
}

  function formatDate(timestamp) {
    const d = new Date(timestamp);
    return d.toLocaleDateString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    });
  }

  function formatDistance(m) {
    if (!m) return '—';
    if (m >= 1000) return `${(m / 1000).toFixed(2)} km`;
    return `${Math.round(m)} m`;
  }

  function formatDuration(startedAt, endedAt) {
    if (!endedAt) return 'in progress';
    const secs = Math.floor((endedAt - startedAt) / 1000);
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}m ${s}s`;
  }

  function renderSession({ item: session }) {
    const stats = sessionStats[session.id];
    const avgIRI = session.avg_iri;
    const iriColor = getIRIColor(avgIRI);
    const iriLabel = getIRILabel(avgIRI);
    const isRecording = session.status === 'recording';

    return (
      <View style={[styles.sessionCard, isRecording && styles.sessionCardRecording]}>

        {/* Header row */}
        <View style={styles.cardHeader}>
          <View style={styles.cardHeaderLeft}>
            <Text style={styles.sessionName} numberOfLines={1}>{session.name}</Text>
            <Text style={styles.sessionDate}>{formatDate(session.started_at)}</Text>
          </View>
          {isRecording && (
            <View style={styles.recordingBadge}>
              <Text style={styles.recordingBadgeText}>● REC</Text>
            </View>
          )}
          {!isRecording && avgIRI != null && (
            <View style={[styles.iriChip, { borderColor: iriColor + '60', backgroundColor: iriColor + '15' }]}>
              <Text style={[styles.iriChipValue, { color: iriColor }]}>
                {avgIRI.toFixed(1)}
              </Text>
              <Text style={[styles.iriChipLabel, { color: iriColor + 'CC' }]}>{iriLabel}</Text>
            </View>
          )}
        </View>

        {/* Stats row */}
        <View style={styles.statsRow}>
          <StatChip label="DISTANCE" value={formatDistance(session.distance_m)} />
          <StatChip label="SEGMENTS" value={session.segment_count || '0'} />
          <StatChip label="DURATION" value={formatDuration(session.started_at, session.ended_at)} />
          {stats && stats.segment_count > 0 && (
            <StatChip label="MAX IRI" value={stats.max_iri != null ? stats.max_iri.toFixed(1) : '—'} />
          )}
        </View>

        {/* Condition breakdown */}
        {stats && stats.segment_count > 0 && (
          <View style={styles.conditionBar}>
            {[
              { key: 'good_count', color: COLORS.iriGood, label: 'G' },
              { key: 'fair_count', color: COLORS.iriFair, label: 'F' },
              { key: 'poor_count', color: COLORS.iriPoor, label: 'P' },
              { key: 'very_poor_count', color: COLORS.iriVeryPoor, label: 'VP' },
            ].map(({ key, color, label }) => {
              const count = stats[key] || 0;
              const pct = (count / stats.segment_count) * 100;
              if (pct === 0) return null;
              return (
                <View
                  key={key}
                  style={[styles.conditionSegment, { flex: pct, backgroundColor: color }]}
                />
              );
            })}
          </View>
        )}

        {/* Actions */}
        <View style={styles.cardActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => handleExport(session)}
          >
            <Text style={styles.actionBtnText}>↑ EXPORT</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnDanger]}
            onPress={() => handleDelete(session)}
          >
            <Text style={[styles.actionBtnText, { color: COLORS.red }]}>✕ DELETE</Text>
          </TouchableOpacity>
        </View>

      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor={COLORS.bg0} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backBtn}>
          <Text style={styles.backBtnText}>← BACK</Text>
        </TouchableOpacity>
        <Text style={styles.title}>SESSION HISTORY</Text>
        <View style={{ width: 60 }} />
      </View>

      {isLoading ? (
        <View style={styles.centered}>
          <ActivityIndicator color={COLORS.green} />
          <Text style={styles.loadingText}>Loading sessions...</Text>
        </View>
      ) : sessions.length === 0 ? (
        <View style={styles.centered}>
          <Text style={styles.emptyIcon}>◎</Text>
          <Text style={styles.emptyTitle}>No Sessions Yet</Text>
          <Text style={styles.emptySubtitle}>Start a recording to collect road data</Text>
        </View>
      ) : (
        <FlatList
          data={sessions}
          renderItem={renderSession}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={isRefreshing}
              onRefresh={() => loadSessions(true)}
              tintColor={COLORS.green}
            />
          }
        />
      )}
    </SafeAreaView>
  );
}

function StatChip({ label, value }) {
  return (
    <View style={statChipStyles.container}>
      <Text style={statChipStyles.label}>{label}</Text>
      <Text style={statChipStyles.value}>{value}</Text>
    </View>
  );
}

const statChipStyles = StyleSheet.create({
  container: {
    alignItems: 'center',
    gap: 2,
  },
  label: {
    fontSize: 8,
    color: COLORS.textMuted,
    letterSpacing: 1.5,
    fontWeight: '600',
  },
  value: {
    fontSize: 13,
    color: COLORS.textPrimary,
    fontWeight: '500',
    letterSpacing: 0.2,
    fontVariant: ['tabular-nums'],
  },
});

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg0,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  backBtn: {
    width: 60,
  },
  backBtnText: {
    fontSize: 10,
    color: COLORS.textMuted,
    fontWeight: '700',
    letterSpacing: 1,
  },
  title: {
    fontSize: 11,
    color: COLORS.textSecondary,
    fontWeight: '800',
    letterSpacing: 3,
  },
  list: {
    padding: SPACING.md,
    gap: SPACING.md,
    paddingBottom: SPACING.xxl,
  },
  sessionCard: {
    backgroundColor: COLORS.bg2,
    borderRadius: RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  sessionCardRecording: {
    borderColor: COLORS.red + '60',
    backgroundColor: COLORS.redFaint,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
  },
  cardHeaderLeft: {
    flex: 1,
    gap: 2,
  },
  sessionName: {
    fontSize: 14,
    color: COLORS.textPrimary,
    fontWeight: '600',
    letterSpacing: 0.2,
  },
  sessionDate: {
    fontSize: 10,
    color: COLORS.textMuted,
    letterSpacing: 0.3,
  },
  recordingBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    backgroundColor: COLORS.redFaint,
    borderWidth: 1,
    borderColor: COLORS.red + '60',
  },
  recordingBadgeText: {
    fontSize: 9,
    color: COLORS.red,
    fontWeight: '800',
    letterSpacing: 1,
  },
  iriChip: {
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    borderWidth: 1,
    gap: 1,
  },
  iriChipValue: {
    fontSize: 18,
    fontWeight: '200',
    letterSpacing: -0.5,
    fontVariant: ['tabular-nums'],
  },
  iriChipLabel: {
    fontSize: 8,
    fontWeight: '700',
    letterSpacing: 1.5,
  },
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    paddingVertical: SPACING.sm,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  conditionBar: {
    flexDirection: 'row',
    height: 4,
    borderRadius: 2,
    overflow: 'hidden',
    gap: 1,
  },
  conditionSegment: {
    height: '100%',
    borderRadius: 1,
  },
  cardActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  actionBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    alignItems: 'center',
  },
  actionBtnDanger: {
    borderColor: COLORS.red + '40',
  },
  actionBtnText: {
    fontSize: 10,
    color: COLORS.textSecondary,
    fontWeight: '700',
    letterSpacing: 1.5,
  },

  // Loading / Empty
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    gap: SPACING.md,
  },
  loadingText: {
    fontSize: 12,
    color: COLORS.textMuted,
    marginTop: SPACING.sm,
  },
  emptyIcon: {
    fontSize: 48,
    color: COLORS.textMuted,
  },
  emptyTitle: {
    fontSize: 16,
    color: COLORS.textSecondary,
    fontWeight: '600',
  },
  emptySubtitle: {
    fontSize: 12,
    color: COLORS.textMuted,
    letterSpacing: 0.5,
  },
});
