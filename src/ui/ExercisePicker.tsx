/**
 * The exercise picker (UI.md §5.2) — search-first, opened as a sheet.
 *
 * Custom exercises render identically to seeded ones.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { MuscleSlug } from '../domain/muscles';
import { searchExercises, type LibraryRow, type QueryableDatabase } from '../db/queries';
import { CustomExerciseForm } from './CustomExerciseForm';
import { MuscleChip } from './MuscleMap';
import { RADIUS, RADIUS_SM, space, TAP_TARGET, type as T, type Theme } from './theme';

interface Props {
  readonly db: QueryableDatabase;
  readonly theme: Theme;
  readonly onPick: (exercise: LibraryRow) => void;
  readonly onClose: () => void;
}

export function ExercisePicker({ db, theme, onPick, onClose }: Props): ReactElement {
  const [query, setQuery] = useState('');
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    let live = true;
    void searchExercises(db, query, 80).then((results) => { if (live) setRows(results); });
    return () => { live = false; };
  }, [db, query]);


  return (
    <SafeAreaView style={[styles.sheet, { backgroundColor: theme.bg }]}>
      <Text style={[styles.screenTitle, { color: theme.text }]}>Exercises</Text>

      <View style={styles.top}>
        <TextInput
          autoFocus
          value={query}
          onChangeText={setQuery}
          placeholder="Search exercises"
          placeholderTextColor={theme.textMuted}
          style={[styles.search, { backgroundColor: theme.surface2, color: theme.text }]}
          accessibilityLabel="search exercises"
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="create a custom exercise"
          onPress={() => setCreating(true)}
          style={styles.cancel}
        >
          <Text style={{ color: theme.accent, fontSize: 26 }}>+</Text>
        </Pressable>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.cancel}>
          <Text style={{ color: theme.accent, fontSize: 17 }}>Done</Text>
        </Pressable>
      </View>

      <ScrollView keyboardShouldPersistTaps="always">
        {rows.map((row) => (
          <Pressable
            key={row.id}
            accessibilityRole="button"
            accessibilityLabel={`${row.name}${row.muscle ? `, ${row.muscle}` : ''}`}
            onPress={() => onPick(row)}
            style={({ pressed }) => [
              styles.row,
              { borderBottomColor: theme.border, backgroundColor: pressed ? theme.surface2 : 'transparent' },
            ]}
          >
            <MuscleChip muscle={(row.muscle as MuscleSlug | null) ?? null} theme={theme} />
            <View style={styles.rowText}>
              <Text style={[styles.name, { color: theme.text }]}>{row.name}</Text>
              <Text style={[styles.meta, { color: theme.textFaint }]}>
                {[row.muscle, row.equipment].filter(Boolean).join(' · ') || 'Custom'}
              </Text>
            </View>
          </Pressable>
        ))}

        {rows.length === 0 && query.trim().length > 0 && (
          <Pressable accessibilityRole="button" onPress={() => setCreating(true)} style={styles.create}>
            <Text style={{ color: theme.accent, fontSize: 17, fontWeight: '600' }}>
              Create “{query.trim()}”
            </Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal visible={creating} animationType="slide" presentationStyle="pageSheet">
        <CustomExerciseForm
          db={db}
          initialName={query.trim()}
          theme={theme}
          onCancel={() => setCreating(false)}
          onCreated={(exercise) => { setCreating(false); onPick(exercise); }}
        />
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  sheet: { flex: 1, paddingTop: space(2) },
  screenTitle: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, paddingHorizontal: space(4), paddingBottom: space(2) },
  top: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(4), paddingBottom: space(3) },
  search: { flex: 1, height: 42, borderRadius: RADIUS_SM, paddingHorizontal: space(3), fontSize: 16 },
  cancel: { minHeight: TAP_TARGET, justifyContent: 'center', paddingHorizontal: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: TAP_TARGET + space(2), paddingHorizontal: space(4), borderBottomWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1 },
  name: { fontSize: 16, fontWeight: '500' },
  meta: { fontSize: 12, marginTop: 1 },
  create: { minHeight: TAP_TARGET + space(2), alignItems: 'center', justifyContent: 'center' },
});
