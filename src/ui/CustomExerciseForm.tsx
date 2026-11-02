/**
 * Creating a custom exercise (UI.md §5.2, F-9).
 *
 * Equipment is asked for because it is load-bearing, not for completeness: it
 * decides whether an empty weight is a bodyweight set or a mistake
 * (FEATURES.md). A custom exercise with no equipment is treated as
 * weight-optional, which is the safe default but leaves the lifter unprotected
 * on a barbell movement — so the field is offered with a sensible preset
 * rather than left blank.
 *
 * Muscle is asked for because it drives the row chip. Neither is mandatory;
 * a nameless flow that blocks on metadata is worse than a slightly emptier row.
 */

import { useState, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { createCustomExercise, type QueryableDatabase, type LibraryRow } from '../db/queries';
import { MUSCLE_LABEL, type MuscleSlug } from '../domain/muscles';
import { RADIUS, space, TAP_TARGET, type Theme } from './theme';

/** The values the seeded library uses, so custom rows behave identically. */
const EQUIPMENT = [
  'barbell', 'dumbbell', 'machine', 'cable', 'kettlebells',
  'body only', 'bands', 'other',
] as const;

const MUSCLES = Object.keys(MUSCLE_LABEL) as MuscleSlug[];

interface Props {
  readonly db: QueryableDatabase;
  readonly initialName?: string;
  readonly theme: Theme;
  readonly onCreated: (exercise: LibraryRow) => void;
  readonly onCancel: () => void;
}

export function CustomExerciseForm({
  db, initialName = '', theme, onCreated, onCancel,
}: Props): ReactElement {
  const [name, setName] = useState(initialName);
  const [muscle, setMuscle] = useState<MuscleSlug | null>(null);
  const [equipment, setEquipment] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async (): Promise<void> => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    try {
      const id = await createCustomExercise(db, { name: trimmed, muscle, equipment });
      onCreated({ id, name: trimmed, muscle, equipment, is_custom: 1, art_ref: null });
    } catch {
      // Almost always a duplicate name: the unique index on name_norm.
      setSaving(false);
    }
  };

  const chip = (
    label: string,
    selected: boolean,
    onPress: () => void,
  ): ReactElement => (
    <Pressable
      key={label}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      onPress={onPress}
      style={[
        styles.chip,
        {
          backgroundColor: selected ? theme.accent : theme.surface,
          borderColor: selected ? theme.accent : theme.border,
        },
      ]}
    >
      <Text style={{ color: selected ? '#FFFFFF' : theme.text, fontSize: 14 }}>{label}</Text>
    </Pressable>
  );

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={styles.top}>
        <Pressable accessibilityRole="button" onPress={onCancel} style={styles.action}>
          <Text style={{ color: theme.textMuted, fontSize: 17 }}>Cancel</Text>
        </Pressable>
        <Text style={[styles.title, { color: theme.text }]}>New exercise</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityState={{ disabled: !name.trim() }}
          onPress={() => void save()}
          style={styles.action}
        >
          <Text style={{ color: name.trim() ? theme.accent : theme.textMuted, fontSize: 17, fontWeight: '700' }}>
            Save
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="always">
        <TextInput
          autoFocus
          value={name}
          onChangeText={setName}
          placeholder="Exercise name"
          placeholderTextColor={theme.textMuted}
          accessibilityLabel="exercise name"
          style={[styles.input, { backgroundColor: theme.surface, borderColor: theme.border, color: theme.text }]}
        />

        <Text style={[styles.label, { color: theme.textMuted }]}>EQUIPMENT</Text>
        <Text style={[styles.help, { color: theme.textMuted }]}>
          Decides whether a set with no weight is bodyweight or a missed entry.
        </Text>
        <View style={styles.chips}>
          {EQUIPMENT.map((item) => chip(item, equipment === item, () =>
            setEquipment(equipment === item ? null : item)))}
        </View>

        <Text style={[styles.label, { color: theme.textMuted }]}>MUSCLE</Text>
        <View style={styles.chips}>
          {MUSCLES.map((slug) => chip(MUSCLE_LABEL[slug], muscle === slug, () =>
            setMuscle(muscle === slug ? null : slug)))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space(3), paddingVertical: space(3) },
  title: { fontSize: 17, fontWeight: '700' },
  action: { minHeight: TAP_TARGET, justifyContent: 'center', paddingHorizontal: space(2) },
  body: { padding: space(4), gap: space(2) },
  input: { minHeight: TAP_TARGET + space(1), borderRadius: RADIUS, borderWidth: 1, paddingHorizontal: space(3), fontSize: 17 },
  label: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginTop: space(3) },
  help: { fontSize: 12, marginBottom: space(1) },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space(2) },
  chip: { minHeight: 36, paddingHorizontal: space(3), borderRadius: RADIUS, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
});
