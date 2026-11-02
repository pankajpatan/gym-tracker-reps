/**
 * Plate and warm-up calculators (F-8, UI.md §3).
 *
 * Opened from the dock with the weight already in it, because the moment this
 * is wanted is standing at the bar with the number on screen — not in a
 * settings menu.
 */

import { useState, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { DEFAULT_PLATES, describeSide, loadBar, warmupSets } from '../domain/plates';
import { useUnit } from './UnitContext';
import { RADIUS, space, TAP_TARGET, tabular, type Theme } from './theme';

interface Props {
  readonly weight: number | null;
  readonly theme: Theme;
  readonly onClose: () => void;
}

export function PlateCalculator({ weight, theme, onClose }: Props): ReactElement {
  const unit = useUnit();
  const set = DEFAULT_PLATES[unit];
  const [target, setTarget] = useState<number>(weight && weight > 0 ? weight : set.bar);

  const loading = loadBar(target, set);
  const warmups = warmupSets(target, set);

  const step = (delta: number): void => setTarget((current) => Math.max(0, current + delta));

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={styles.top}>
        <Text style={[styles.title, { color: theme.text }]}>Plates</Text>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.done}>
          <Text style={{ color: theme.accent, fontSize: 17, fontWeight: '700' }}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <View style={styles.targetRow}>
          <Pressable accessibilityLabel="less weight" onPress={() => step(-2.5)} style={[styles.stepper, { borderColor: theme.border }]}>
            <Text style={{ color: theme.text, fontSize: 22 }}>−</Text>
          </Pressable>
          <View style={styles.targetValue}>
            <Text style={[styles.target, tabular, { color: theme.text }]}>{target}</Text>
            <Text style={[styles.unit, { color: theme.textMuted }]}>{unit}</Text>
          </View>
          <Pressable accessibilityLabel="more weight" onPress={() => step(2.5)} style={[styles.stepper, { borderColor: theme.border }]}>
            <Text style={{ color: theme.text, fontSize: 22 }}>+</Text>
          </Pressable>
        </View>

        <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <Text style={[styles.label, { color: theme.textMuted }]}>EACH SIDE</Text>
          <Text style={[styles.perSide, tabular, { color: theme.text }]}>
            {describeSide(loading.perSide)}
          </Text>

          <View style={styles.plateRow}>
            {loading.perSide.map((plate, index) => (
              <View
                key={index}
                accessibilityLabel={`${plate} ${unit} plate`}
                style={[
                  styles.plate,
                  {
                    backgroundColor: theme.accent,
                    height: 28 + (plate / (set.plates[0] ?? plate)) * 44,
                  },
                ]}
              >
                <Text style={styles.plateLabel}>{plate}</Text>
              </View>
            ))}
            {loading.perSide.length === 0 && (
              <Text style={{ color: theme.textMuted, fontSize: 15 }}>Just the bar</Text>
            )}
          </View>

          <Text style={[styles.sub, { color: theme.textMuted }]}>
            {set.bar} {unit} bar · total {loading.achieved} {unit}
          </Text>

          {loading.shortBy !== 0 && (
            <Text style={[styles.warn, { color: theme.danger }]}>
              {loading.shortBy > 0
                ? `${loading.shortBy} ${unit} short — the plates cannot make ${target} exactly.`
                : `${target} ${unit} is below the bar.`}
            </Text>
          )}
        </View>

        <Text style={[styles.label, { color: theme.textMuted, marginTop: space(3) }]}>WARM-UP</Text>
        {warmups.length === 0 ? (
          <Text style={[styles.sub, { color: theme.textMuted }]}>
            Nothing to work up to at this weight.
          </Text>
        ) : (
          warmups.map((warmup, index) => (
            <View key={index} style={[styles.warmRow, { borderBottomColor: theme.border }]}>
              <Text style={[styles.warmWeight, tabular, { color: theme.text }]}>
                {warmup.weight} {unit}
              </Text>
              <Text style={[styles.warmReps, tabular, { color: theme.textMuted }]}>
                × {warmup.reps}
              </Text>
              <Text style={[styles.warmPlates, { color: theme.textMuted }]} numberOfLines={1}>
                {describeSide(warmup.loading.perSide)}
              </Text>
            </View>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space(4), paddingVertical: space(3) },
  title: { fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  done: { minHeight: TAP_TARGET, justifyContent: 'center', paddingHorizontal: space(2) },
  body: { padding: space(4), gap: space(2) },
  targetRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space(4) },
  stepper: { width: TAP_TARGET, height: TAP_TARGET, borderRadius: RADIUS, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  targetValue: { flexDirection: 'row', alignItems: 'baseline', gap: space(1) },
  target: { fontSize: 40, fontWeight: '700', letterSpacing: -1 },
  unit: { fontSize: 15 },
  card: { borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth, padding: space(3), gap: space(2) },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  perSide: { fontSize: 17, fontWeight: '600' },
  plateRow: { flexDirection: 'row', alignItems: 'center', gap: space(1), minHeight: 72 },
  plate: { width: 26, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  plateLabel: { color: '#FFFFFF', fontSize: 10, fontWeight: '700' },
  sub: { fontSize: 13 },
  warn: { fontSize: 13, fontWeight: '600' },
  warmRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(2), borderBottomWidth: StyleSheet.hairlineWidth },
  warmWeight: { fontSize: 17, fontWeight: '700', width: 88, letterSpacing: -0.3 },
  warmReps: { fontSize: 15, width: 40 },
  warmPlates: { fontSize: 13, flex: 1 },
});
