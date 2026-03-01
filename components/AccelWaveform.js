/**
 * AccelWaveform — Live accelerometer Z-axis sparkline
 * Uses setNativeProps to avoid React re-renders on every update
 */

import React, { useEffect, useRef } from 'react';
import { View, StyleSheet } from 'react-native';
import Svg, { Polyline, Line, Text as SvgText } from 'react-native-svg';
import { COLORS } from '../utils/theme';

const HISTORY_LENGTH = 80;
const SVG_HEIGHT = 60;
const SVG_WIDTH = 300;
const Y_RANGE = 5;

export default function AccelWaveform({ value = 0, color = COLORS.green }) {
  const historyRef = useRef(new Array(HISTORY_LENGTH).fill(0));
  const polylineRef = useRef(null);
  const labelRef = useRef(null);

  useEffect(() => {
    historyRef.current.shift();
    historyRef.current.push(value);

    const pts = historyRef.current
      .map((v, i) => {
        const x = (i / (HISTORY_LENGTH - 1)) * SVG_WIDTH;
        const normalized = Math.max(-Y_RANGE, Math.min(Y_RANGE, v));
        const y = SVG_HEIGHT - ((normalized + Y_RANGE) / (2 * Y_RANGE)) * SVG_HEIGHT;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    // FIX: bypass React re-render entirely
    if (polylineRef.current) {
      polylineRef.current.setNativeProps({ points: pts });
    }
    if (labelRef.current) {
      labelRef.current.setNativeProps({
        text: `${value >= 0 ? '+' : ''}${value.toFixed(2)}`,
      });
    }
  }, [value]);

  const midY = SVG_HEIGHT / 2;

  return (
    <View style={styles.container}>
      <Svg width={SVG_WIDTH} height={SVG_HEIGHT}>
        <Line x1={0} y1={midY} x2={SVG_WIDTH} y2={midY}
          stroke={COLORS.border} strokeWidth={0.5} strokeDasharray="4,4" />
        {[2, -2].map((val) => {
          const y = SVG_HEIGHT - ((val + Y_RANGE) / (2 * Y_RANGE)) * SVG_HEIGHT;
          return (
            <Line key={val} x1={0} y1={y} x2={SVG_WIDTH} y2={y}
              stroke={COLORS.border} strokeWidth={0.3} strokeDasharray="2,6" />
          );
        })}
        <Polyline
          ref={polylineRef}
          points=""
          fill="none"
          stroke={color}
          strokeWidth={1.5}
          strokeLinejoin="round"
        />
        <SvgText
          ref={labelRef}
          x={SVG_WIDTH - 2}
          y={14}
          fill={color}
          fontSize={10}
          textAnchor="end"
          fontWeight="bold"
        >
          {`+0.00`}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: COLORS.bg2,
    borderRadius: 4,
    overflow: 'hidden',
  },
});
