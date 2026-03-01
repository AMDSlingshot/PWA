/**
 * SegmentHistory — Horizontal row of completed segment chips
 */

import React from "react";
import { View, Text, ScrollView, StyleSheet } from "react-native";
import { COLORS, getIRIColor, getIRILabel } from "../utils/theme";

export default React.memo(function SegmentHistory({ segments = [] }) {
  if (segments.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>
          Driving 100m segments will appear here
        </Text>
      </View>
    );
  }

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.scroll}
      nestedScrollEnabled={true} // FIX: required for Android when inside a vertical ScrollView
    >
      {segments.slice(-20).map((seg, i) => {
        const color = getIRIColor(seg.iri_value);
        const label = getIRILabel(seg.iri_value);
        return (
          <View
            key={i}
            style={[
              styles.chip,
              { borderColor: color + "60", backgroundColor: color + "10" },
            ]}
          >
            <Text style={[styles.segNum, { color: COLORS.textMuted }]}>
              #{seg.segment_index + 1}
            </Text>
            <Text style={[styles.iriVal, { color }]}>
              {seg.iri_value != null ? seg.iri_value.toFixed(1) : "—"}
            </Text>
            <Text style={[styles.cond, { color: color + "CC" }]}>{label}</Text>
          </View>
        );
      })}
    </ScrollView>
  );
});

const styles = StyleSheet.create({
  scroll: {
    paddingHorizontal: 4,
    gap: 6,
    alignItems: "center",
  },
  empty: {
    height: 54,
    justifyContent: "center",
    alignItems: "center",
  },
  emptyText: {
    fontSize: 10,
    color: COLORS.textMuted,
    letterSpacing: 0.5,
  },
  chip: {
    alignItems: "center",
    paddingHorizontal: 8,
    paddingVertical: 6,
    borderRadius: 6,
    borderWidth: 1,
    minWidth: 52,
    gap: 1,
  },
  segNum: {
    fontSize: 8,
    letterSpacing: 0.5,
  },
  iriVal: {
    fontSize: 16,
    fontWeight: "300",
    letterSpacing: -0.5,
    fontVariant: ["tabular-nums"],
  },
  cond: {
    fontSize: 7,
    fontWeight: "700",
    letterSpacing: 1,
  },
});
