/**
 * A small line chart, drawn with react-native-svg (UI.md §4).
 *
 * No charting library: the geometry is twenty lines in `domain/progress.ts` and
 * already tested, and every library in this space is a native dependency that
 * would cost a rebuild and a maintenance risk for one screen.
 */

import { useState, type ReactElement } from 'react';
import { StyleSheet, Text, View, type LayoutChangeEvent } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { bounds, plot, type Point } from '../domain/progress';
import { space, tabular, type Theme } from './theme';

interface Props {
  readonly points: readonly Point[];
  readonly theme: Theme;
  readonly height?: number;
  readonly suffix?: string;
  /**
   * The unsmoothed sessions, drawn faint behind the trend. Keeping them visible
   * is the point: a smoothed line alone would quietly replace what happened
   * with what we calculated.
   */
  readonly raw?: readonly Point[];
}

export function Chart({ points, theme, height = 140, suffix = '', raw }: Props): ReactElement {
  if (points.length === 0) {
    return (
      <View style={[styles.empty, { height }]}>
        <Text style={{ color: theme.textMuted, fontSize: 13 }}>
          Not enough history to chart yet.
        </Text>
      </View>
    );
  }

  /**
   * The chart is drawn at the container's real width, measured on layout.
   *
   * A fixed viewBox with width="100%" does NOT stretch: preserveAspectRatio
   * defaults to "meet", so a 300-unit chart renders at 1:1, centres itself, and
   * everything past the container edge is clipped — the most recent sessions,
   * which are the ones being looked for. Measuring avoids that without
   * distorting the stroke, which preserveAspectRatio="none" would.
   */
  const [width, setWidth] = useState(300);
  const onLayout = (event: LayoutChangeEvent): void => {
    const measured = Math.round(event.nativeEvent.layout.width);
    if (measured > 0 && measured !== width) setWidth(measured);
  };

  const showRaw = raw !== undefined && raw.length === points.length && raw.length > 0;

  // Both lines share one scale, or the trend would float against its own data.
  const scaleOver = showRaw ? [...points, ...raw] : points;
  const { min, max } = bounds(scaleOver);
  const inner = height - 16;
  const span = (max - min) || 1;
  const project = (list: readonly Point[]): string => list
    .map((point, index) => {
      const x = list.length === 1 ? width / 2 : (index / (list.length - 1)) * width;
      const y = inner - ((point.value - min) / span) * inner + 8;
      return `${x},${y}`;
    })
    .join(' ');

  const mapped = plot(points, width, inner);
  const line = project(points);

  /**
   * The axis reads top-to-bottom on the left, where an axis belongs.
   *
   * The first version put max at the top-left and min at the top-RIGHT on one
   * line, which read as two unrelated numbers — the first question asked about
   * this screen was "what do 1301 and 117 represent?".
   */
  return (
    <View style={styles.chartRow}>
      <View style={[styles.axis, { height }]}>
        <Text style={[styles.axisLabel, tabular, { color: theme.textFaint }]}>
          {Math.round(max).toLocaleString()}{suffix}
        </Text>
        <Text style={[styles.axisLabel, tabular, { color: theme.textFaint }]}>
          {Math.round(min).toLocaleString()}{suffix}
        </Text>
      </View>
      <View style={styles.plot} onLayout={onLayout}>
        <Svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} accessibilityLabel="progress chart">
          {showRaw && (
            <Polyline
              points={project(raw)}
              fill="none"
              stroke={theme.textFaint}
              strokeWidth={1}
              strokeOpacity={0.5}
            />
          )}
          <Polyline
            points={line}
            fill="none"
            stroke={theme.accent}
            strokeWidth={2.5}
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {!showRaw && mapped.map((p, i) => (
            <Circle key={i} cx={p.x} cy={p.y + 8} r={3} fill={theme.accent} />
          ))}
        </Svg>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: { alignItems: 'center', justifyContent: 'center' },
  chartRow: { flexDirection: 'row', alignItems: 'stretch', gap: space(2) },
  axis: { justifyContent: 'space-between', paddingVertical: space(2), minWidth: 40 },
  axisLabel: { fontSize: 11, textAlign: 'right' },
  plot: { flex: 1 },
});
