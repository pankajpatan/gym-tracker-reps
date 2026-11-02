/**
 * The input dock (UI.md §3.2) — it replaces the system keyboard entirely.
 *
 * Rebuilt 15 Sep after seeing it on a phone. Three things were wrong, all of
 * them structural rather than cosmetic:
 *
 * 1. An empty field showed `–` beside its unit, which read as a second minus
 *    button sitting inside the box. An empty value now shows nothing at all and
 *    the unit label lives above the field, where a label belongs.
 * 2. Values (1, 2.5, 5…) and actions (BW, 123, Plates) were the same kind of
 *    chip in one wrapping list, so the row looked like seven equal choices and
 *    reflowed into three ragged lines. Values scroll on one line; actions are a
 *    separate, quieter row.
 * 3. Nothing established which field the chips were feeding except a thin
 *    outline. The focused field now carries the accent as a filled label and a
 *    two-pixel ring.
 */

import { useState, type ReactElement } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { applyChip, focusField, step, type DockField, type DockState } from '../domain/dock';
import { formatWeight, weightChips } from '../domain/units';
import { useUnit } from './UnitContext';
import { RADIUS, RADIUS_PILL, RADIUS_SM, space, TAP_TARGET, tabular, type Theme, type as T } from './theme';

interface Props {
  readonly state: DockState;
  readonly theme: Theme;
  readonly onChange: (next: DockState) => void;
  readonly onLog: () => void;
  readonly onOpenPlates?: () => void;
}

export function InputDock({ state, theme, onChange, onLog, onOpenPlates }: Props): ReactElement {
  const unit = useUnit();
  const chips = weightChips(unit);
  const [typing, setTyping] = useState<DockField | null>(null);
  const [draft, setDraft] = useState('');

  /**
   * The keypad is the escape hatch for an exact value — 7.5, 62.5, 102.5 —
   * which chips reach only by repeated tapping. A decimal comma is accepted as
   * well as a point: a localised number pad offers whichever the region uses.
   */
  const commitTyped = (): void => {
    if (!typing) return;
    const parsed = Number(draft.replace(',', '.'));
    if (Number.isFinite(parsed) && parsed >= 0) {
      onChange(
        typing === 'weight'
          ? { ...state, weight: parsed, bodyweight: false }
          : { ...state, reps: Math.round(parsed) },
      );
    }
    setTyping(null);
    setDraft('');
  };

  const field = (which: DockField, value: string, label: string): ReactElement => {
    const focused = state.focus === which;
    return (
      <View style={styles.fieldGroup}>
        <Text style={[T.label, { color: focused ? theme.accent : theme.textFaint }]}>
          {label}
        </Text>
        <View style={styles.fieldRow}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`decrease ${which}`}
            onPress={() => onChange(step(state, which, -1, unit))}
            style={[styles.stepper, { backgroundColor: theme.surface3 }]}
          >
            <Text style={[styles.stepperLabel, { color: theme.text }]}>−</Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`${label}, ${value || 'empty'}`}
            onPress={() => onChange(focusField(state, which))}
            onLongPress={() => {
              const current = which === 'weight' ? state.weight : state.reps;
              setDraft(current === null ? '' : String(current));
              setTyping(which);
            }}
            style={[
              styles.field,
              {
                backgroundColor: theme.surface,
                borderColor: focused ? theme.accent : 'transparent',
              },
            ]}
          >
            <Text
              numberOfLines={1}
              style={[styles.fieldValue, tabular, { color: value ? theme.text : theme.textFaint }]}
            >
              {value || '—'}
            </Text>
          </Pressable>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`increase ${which}`}
            onPress={() => onChange(step(state, which, 1, unit))}
            style={[styles.stepper, { backgroundColor: theme.surface3 }]}
          >
            <Text style={[styles.stepperLabel, { color: theme.text }]}>+</Text>
          </Pressable>
        </View>
      </View>
    );
  };

  const action = (label: string, onPress: () => void, selected = false): ReactElement => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.action,
        {
          backgroundColor: selected ? theme.accentSoft : 'transparent',
          borderColor: selected ? theme.accent : theme.border,
        },
      ]}
    >
      <Text style={[T.small, { color: selected ? theme.accent : theme.textMuted, fontWeight: '600' }]}>
        {label}
      </Text>
    </Pressable>
  );

  return (
    <View style={[styles.dock, { backgroundColor: theme.surface2, borderTopColor: theme.border }]}>
      <View style={styles.fields}>
        {field(
          'weight',
          state.bodyweight && state.weight === null
            ? 'BW'
            : state.weight === null ? '' : formatWeight(state.weight, unit),
          unit.toUpperCase(),
        )}
        {field('reps', state.reps === null ? '' : String(state.reps), 'REPS')}
      </View>

      {/* Values: one line, scrolling. They are all the same kind of thing. */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.chips}
        keyboardShouldPersistTaps="always"
      >
        {chips.map((amount) => (
          <Pressable
            key={amount}
            accessibilityRole="button"
            accessibilityLabel={`add ${amount}`}
            accessibilityHint="long press to subtract"
            onPress={() => onChange(applyChip(state, amount, 'add'))}
            onLongPress={() => onChange(applyChip(state, amount, 'subtract'))}
            style={[styles.chip, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Text style={[styles.chipLabel, tabular, { color: theme.text }]}>
              {state.focus === 'weight' ? `+${amount}` : `+${Math.round(amount)}`}
            </Text>
          </Pressable>
        ))}
      </ScrollView>

      {/* Actions: quieter, and clearly not quantities. */}
      <View style={styles.actions}>
        {action('Bodyweight', () =>
          onChange({
            ...state,
            bodyweight: !state.bodyweight,
            weight: state.bodyweight ? state.weight : null,
          }), state.bodyweight === true)}
        {action('Type value', () => {
          const current = state.focus === 'weight' ? state.weight : state.reps;
          setDraft(current === null ? '' : String(current));
          setTyping(state.focus);
        })}
        {onOpenPlates && action('Plates', onOpenPlates)}
      </View>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel="log set"
        onPress={onLog}
        style={({ pressed }) => [
          styles.log,
          { backgroundColor: theme.accent, opacity: pressed ? 0.85 : 1 },
        ]}
      >
        <Text style={[styles.logLabel, { color: theme.accentText }]}>Log set</Text>
      </Pressable>

      <Modal visible={typing !== null} transparent animationType="fade">
        <Pressable style={styles.backdrop} onPress={commitTyped}>
          <View style={[styles.keypad, { backgroundColor: theme.surface, borderColor: theme.borderStrong }]}>
            <Text style={[T.label, { color: theme.textMuted }]}>
              {typing === 'weight' ? unit.toUpperCase() : 'REPS'}
            </Text>
            <TextInput
              autoFocus
              value={draft}
              onChangeText={setDraft}
              onSubmitEditing={commitTyped}
              keyboardType={typing === 'weight' ? 'decimal-pad' : 'number-pad'}
              returnKeyType="done"
              selectTextOnFocus
              accessibilityLabel={`type ${typing ?? ''}`}
              style={[styles.keypadInput, tabular, { color: theme.text, borderBottomColor: theme.accent }]}
            />
            <Pressable
              accessibilityRole="button"
              onPress={commitTyped}
              style={[styles.keypadDone, { backgroundColor: theme.accent }]}
            >
              <Text style={[styles.logLabel, { color: theme.accentText }]}>Done</Text>
            </Pressable>
          </View>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  dock: { paddingHorizontal: space(3), paddingTop: space(3), paddingBottom: space(2), gap: space(3), borderTopWidth: StyleSheet.hairlineWidth },
  fields: { flexDirection: 'row', gap: space(3) },
  fieldGroup: { flex: 1, gap: space(1) },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  stepper: { width: 40, height: 40, borderRadius: RADIUS_SM, alignItems: 'center', justifyContent: 'center' },
  stepperLabel: { fontSize: 20, fontWeight: '600' },
  field: { flex: 1, height: 48, borderRadius: RADIUS_SM, borderWidth: 2, alignItems: 'center', justifyContent: 'center' },
  fieldValue: { fontSize: 24, fontWeight: '700' },
  chips: { gap: space(2), paddingRight: space(2) },
  chip: { minWidth: 56, height: 38, paddingHorizontal: space(3), borderRadius: RADIUS_PILL, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  chipLabel: { fontSize: 15, fontWeight: '600' },
  actions: { flexDirection: 'row', gap: space(2) },
  action: { flex: 1, height: 34, borderRadius: RADIUS_PILL, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center' },
  log: { height: 52, borderRadius: RADIUS, alignItems: 'center', justifyContent: 'center' },
  logLabel: { fontSize: 17, fontWeight: '700', letterSpacing: 0.2 },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: space(6) },
  keypad: { borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth, padding: space(4), gap: space(3) },
  keypadInput: { fontSize: 34, fontWeight: '700', borderBottomWidth: 2, paddingVertical: space(2), textAlign: 'center' },
  keypadDone: { height: TAP_TARGET, borderRadius: RADIUS_SM, alignItems: 'center', justifyContent: 'center' },
});
