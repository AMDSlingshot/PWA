/**
 * IRIGauge — Large IRI display with condition label and color
 */

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import {
  COLORS,
  getIRIColor,
  getIRILabel,
  getIRIAction,
  formatIRI,
} from "../utils/theme";

export default React.memo(function IRIGauge({ iri, isValid = true, style }) {
  const color = getIRIColor(iri);
  const label = getIRILabel(iri);
  const action = getIRIAction(iri);

  return (
    <View style={[styles.container, style]}>
      <Text style={styles.unit}>IRI m/km</Text>
      <View style={[styles.valueContainer, { borderColor: color + "40" }]}>
        <Text style={[styles.value, { color }]}>
          {isValid ? formatIRI(iri) : "—"}
        </Text>
      </View>
      <View
        style={[
          styles.badge,
          { backgroundColor: color + "20", borderColor: color + "60" },
        ]}
      >
        <Text style={[styles.badgeText, { color }]}>{label}</Text>
      </View>
      <Text style={styles.action}>{isValid ? action : "SPEED < 20 km/h"}</Text>
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    alignItems: "center",
    gap: 6,
  },
  unit: {
    fontSize: 10,
    color: COLORS.textMuted,
    letterSpacing: 2,
    fontWeight: "600",
  },
  valueContainer: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 20,
    paddingVertical: 8,
    minWidth: 120,
    alignItems: "center",
  },
  value: {
    fontSize: 52,
    fontWeight: "200",
    letterSpacing: -2,
    fontVariant: ["tabular-nums"],
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: "800",
    letterSpacing: 2,
  },
  action: {
    fontSize: 9,
    color: COLORS.textMuted,
    letterSpacing: 1.5,
    fontWeight: "500",
  },
});
