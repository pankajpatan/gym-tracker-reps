import type { ReactElement } from 'react';
/**
 * One exercise inside an active session (UI.md §3).
 *
 * The set row is the two-tap path: tap ○ and the row logs whatever is shown,
 * falling back to the PREVIOUS column when the fields are empty. Nothing here
 * decides *what* gets logged — `resolveLogValues` does — so the rule stays
 * testable without a device.
 */

import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { MuscleSlug } from '../domain/muscles';
import { formatWeight, type Unit } from '../domain/units';
import { useUnit } from './UnitContext';
import { MuscleChip } from './MuscleMap';
import { useToggleValue } from './motion';
import { RADIUS, RADIUS_SM, space, TAP_TARGET, tabular, type as T, type Theme } from './theme';

export type RowType = 'normal' | 'warmup' | 'drop' | 'failure';

export interface SetRowModel {
  readonly index: number;
  readonly done: boolean;
  readonly type: RowType;
  readonly weightKg: number | null;
  readonly reps: number | null;
  readonly previous: { weightKg: number | null; reps: number | null } | null;
}

interface Props {
  readonly name: string;
  readonly muscle?: MuscleSlug | null;
  readonly rows: readonly SetRowModel[];
  readonly activeRow: number | null;
  readonly theme: Theme;
  readonly onFocusRow: (index: number) => void;
  readonly onToggleRow: (index: number) => void;
  readonly onAddSet: () => void;
  readonly onOpenDetail?: () => void;
}

/** `W` / `D` / `F` replace the set number for a non-working set (UI.md §3). */
function rowBadge(row: SetRowModel): string {
  switch (row.type) {
    case 'warmup': return 'W';
    case 'drop': return 'D';
    case 'failure': return 'F';
    default: return String(row.index + 1);
  }
}

function previousLabel(row: SetRowModel, unit: Unit): string {
  if (!row.previous || row.previous.reps === null) return '—';
  const { weightKg, reps } = row.previous;
  return weightKg === null ? `${reps} reps` : `${formatWeight(weightKg, unit)} × ${reps}`;
}

export function ExerciseCard({
  name, muscle = null, rows, activeRow, theme,
  onFocusRow, onToggleRow, onAddSet, onOpenDetail,
}: Props): ReactElement {
  const unit = useUnit();
  return (
    <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${name}, open history and records`}
        accessibilityHint="shows history, charts and records"
        onPress={onOpenDetail}
        style={styles.title}
      >
        <MuscleChip muscle={muscle} theme={theme} />
        <Text style={[styles.name, { color: theme.text }]}>{name}</Text>
        {onOpenDetail && <Text style={{ color: theme.textMuted, fontSize: 15 }}>›</Text>}
      </Pressable>

      <View style={[styles.headerRow, { borderBottomColor: theme.border }]}>
        <Text style={[styles.colSet, styles.heading, { color: theme.textMuted }]}>SET</Text>
        <Text style={[styles.colPrev, styles.heading, { color: theme.textMuted }]}>PREVIOUS</Text>
        <Text style={[styles.colValue, styles.heading, { color: theme.textMuted }]}>
          {unit.toUpperCase()}
        </Text>
        <Text style={[styles.colValue, styles.heading, { color: theme.textMuted }]}>REPS</Text>
        <View style={styles.colCheck} />
      </View>

      {rows.map((row) => (
        <SetRow
          key={row.index}
          row={row}
          focused={activeRow === row.index}
          unit={unit}
          theme={theme}
          onFocus={() => onFocusRow(row.index)}
          onToggle={() => onToggleRow(row.index)}
        />
      ))}

      <Pressable accessibilityRole="button" onPress={onAddSet} style={styles.addSet}>
        <Text style={[styles.addSetLabel, { color: theme.accent }]}>+ Add set</Text>
      </Pressable>
    </View>
  );
}

/**
 * One set row, with the completion fill UI.md §0 asks for: the row fills green
 * over 120ms, no bounce. The tick scales from 0.8 to 1 in the same window so
 * the acknowledgement lands in one gesture rather than two.
 */
function SetRow({ row, focused, unit, theme, onFocus, onToggle }: {
  row: SetRowModel;
  focused: boolean;
  unit: Unit;
  theme: Theme;
  onFocus: () => void;
  onToggle: () => void;
}): ReactElement {
  const done = useToggleValue(row.done);

  const background = done.interpolate({
    inputRange: [0, 1],
    outputRange: [focused ? theme.accentSoft : theme.bg, theme.successSoft],
  });

  return (
    <Animated.View style={[
      styles.row,
      { backgroundColor: background, borderColor: focused && !row.done ? theme.accent : 'transparent' },
    ]}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={
          `Set ${row.index + 1}, ` +
          `${row.weightKg === null ? 'bodyweight' : `${formatWeight(row.weightKg, unit)} ${unit}`}, ` +
          `${row.reps ?? 0} reps, ${row.done ? 'completed' : 'not completed'}`
        }
        onPress={onFocus}
        style={styles.rowPress}
      >
        <Text style={[styles.colSet, tabular, { color: theme.textMuted }]}>{rowBadge(row)}</Text>
        <Text style={[styles.colPrev, tabular, { color: theme.textFaint }]}>
          {previousLabel(row, unit)}
        </Text>
        <Text style={[styles.colValue, tabular, { color: theme.text }]}>
          {row.weightKg === null ? '' : formatWeight(row.weightKg, unit)}
        </Text>
        <Text style={[styles.colValue, tabular, { color: theme.text }]}>
          {row.reps ?? ''}
        </Text>
      </Pressable>

      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: row.done }}
        accessibilityLabel={row.done ? `undo set ${row.index + 1}` : `log set ${row.index + 1}`}
        onPress={onToggle}
        style={styles.colCheck}
      >
        <Animated.View
          style={[
            styles.tick,
            {
              transform: [{ scale: done.interpolate({ inputRange: [0, 1], outputRange: [0.85, 1] }) }],
              backgroundColor: row.done ? theme.success : 'transparent',
              borderColor: row.done ? theme.success : theme.borderStrong,
            },
          ]}
        >
          {row.done && <Text style={styles.tickMark}>✓</Text>}
        </Animated.View>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth, padding: space(3), gap: space(1) },
  tick: { width: 26, height: 26, borderRadius: RADIUS_SM, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  tickMark: { color: '#FFFFFF', fontSize: 15, fontWeight: '800' },
  title: { flexDirection: 'row', alignItems: 'center', gap: space(2), marginBottom: space(1) },
  name: { fontSize: 17, fontWeight: '700', flexShrink: 1 },
  headerRow: { flexDirection: 'row', alignItems: 'center', paddingBottom: space(1), borderBottomWidth: StyleSheet.hairlineWidth },
  heading: { fontSize: 10, fontWeight: '700', letterSpacing: 0.8 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 46, marginTop: space(1), paddingHorizontal: space(1), borderRadius: RADIUS_SM, borderWidth: 1.5, borderColor: 'transparent' },
  rowPress: { flex: 1, flexDirection: 'row', alignItems: 'center', minHeight: 46 },
  // Hevy and Setgraph both let the numerals carry the row and mute everything
  // around them. The previous column is reference, not content.
  colSet: { width: 30, textAlign: 'center', fontSize: 13, fontWeight: '700' },
  colPrev: { flex: 1.3, fontSize: 12 },
  colValue: { flex: 1, textAlign: 'center', fontSize: 21, fontWeight: '700', letterSpacing: -0.4 },
  colCheck: { width: TAP_TARGET, height: TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  addSet: { minHeight: TAP_TARGET, justifyContent: 'center' },
  addSetLabel: { fontSize: 14, fontWeight: '600' },
});
