/**
 * Routine editor (UI.md §5.1).
 *
 * The rule that governs this screen: **no cap on routines, and no upsell
 * anywhere on it.** Nothing here counts, gates or advertises.
 *
 * Reordering is up/down buttons rather than drag handles — a deliberate v1
 * deviation from UI.md, because drag-and-drop needs a gesture library and this
 * is not the interaction the app is judged on. The stored shape is identical,
 * so swapping in drag later touches only this file.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  addExerciseToRoutine, removeRoutineExercise, renameRoutine, reorderRoutineExercises,
  routineExercises, updateRoutineExercise,
  type QueryableDatabase, type RoutineExerciseRow,
} from '../db/queries';
import type { MuscleSlug } from '../domain/muscles';
import { ExercisePicker } from './ExercisePicker';
import { MuscleChip } from './MuscleMap';
import { RADIUS, space, TAP_TARGET, tabular, type Theme } from './theme';

interface Props {
  readonly db: QueryableDatabase;
  readonly routineId: number;
  readonly initialName: string;
  readonly theme: Theme;
  readonly onClose: () => void;
}

export function RoutineEditor({ db, routineId, initialName, theme, onClose }: Props): ReactElement {
  const [name, setName] = useState(initialName);
  const [rows, setRows] = useState<RoutineExerciseRow[]>([]);
  const [picking, setPicking] = useState(false);

  const reload = useCallback(async () => {
    setRows(await routineExercises(db, routineId));
  }, [db, routineId]);

  useEffect(() => { void reload(); }, [reload]);

  const move = async (index: number, delta: number): Promise<void> => {
    const next = [...rows];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    const [moved] = next.splice(index, 1);
    if (moved) next.splice(target, 0, moved);
    setRows(next);
    await reorderRoutineExercises(db, routineId, next.map((r) => r.id));
  };

  /**
   * Supersetting pairs a row with the one above it: they share a group number,
   * and the left rail in the session screen reads them as A1/A2. Tapping again
   * breaks the pair.
   */
  const toggleSuperset = async (index: number): Promise<void> => {
    const current = rows[index];
    const above = rows[index - 1];
    if (!current || !above) return;

    if (current.superset_group !== null && current.superset_group === above.superset_group) {
      await updateRoutineExercise(db, current.id, { supersetGroup: null });
    } else {
      const group = above.superset_group ?? current.id;
      await updateRoutineExercise(db, above.id, { supersetGroup: group });
      await updateRoutineExercise(db, current.id, { supersetGroup: group });
    }
    await reload();
  };

  const setTargetSets = async (row: RoutineExerciseRow, delta: number): Promise<void> => {
    const next = Math.max(1, (row.target_sets ?? 3) + delta);
    await updateRoutineExercise(db, row.id, { targetSets: next });
    await reload();
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={styles.top}>
        <TextInput
          value={name}
          onChangeText={setName}
          onEndEditing={() => void renameRoutine(db, routineId, name.trim() || 'Routine')}
          placeholder="Routine name"
          placeholderTextColor={theme.textMuted}
          accessibilityLabel="routine name"
          style={[styles.nameInput, { color: theme.text, borderColor: theme.border, backgroundColor: theme.surface }]}
        />
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.done}>
          <Text style={{ color: theme.accent, fontSize: 17, fontWeight: '700' }}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {rows.map((row, index) => {
          const above = rows[index - 1];
          const paired = row.superset_group !== null && row.superset_group === above?.superset_group;
          return (
            <View
              key={row.id}
              style={[
                styles.row,
                { backgroundColor: theme.surface, borderColor: theme.border },
                paired && { borderLeftWidth: 3, borderLeftColor: theme.accent },
              ]}
            >
              <MuscleChip muscle={(row.muscle as MuscleSlug | null) ?? null} theme={theme} />
              <View style={styles.rowText}>
                <Text style={[styles.name, { color: theme.text }]}>{row.name}</Text>
                <View style={styles.setsControl}>
                  <Pressable accessibilityLabel="fewer sets" onPress={() => void setTargetSets(row, -1)} style={styles.tiny}>
                    <Text style={{ color: theme.accent, fontSize: 18 }}>−</Text>
                  </Pressable>
                  <Text style={[styles.sets, tabular, { color: theme.textMuted }]}>
                    {row.target_sets ?? 3} sets
                  </Text>
                  <Pressable accessibilityLabel="more sets" onPress={() => void setTargetSets(row, 1)} style={styles.tiny}>
                    <Text style={{ color: theme.accent, fontSize: 18 }}>+</Text>
                  </Pressable>
                </View>
              </View>

              <Pressable accessibilityLabel="move up" onPress={() => void move(index, -1)} style={styles.tiny}>
                <Text style={{ color: theme.textMuted, fontSize: 16 }}>↑</Text>
              </Pressable>
              <Pressable accessibilityLabel="move down" onPress={() => void move(index, 1)} style={styles.tiny}>
                <Text style={{ color: theme.textMuted, fontSize: 16 }}>↓</Text>
              </Pressable>
              {index > 0 && (
                <Pressable
                  accessibilityLabel={paired ? 'break superset' : 'superset with the exercise above'}
                  onPress={() => void toggleSuperset(index)}
                  style={styles.tiny}
                >
                  <Text style={{ color: paired ? theme.accent : theme.textMuted, fontSize: 15, fontWeight: '700' }}>⇄</Text>
                </Pressable>
              )}
              <Pressable
                accessibilityLabel={`remove ${row.name}`}
                onPress={async () => { await removeRoutineExercise(db, row.id); await reload(); }}
                style={styles.tiny}
              >
                <Text style={{ color: theme.danger, fontSize: 18 }}>×</Text>
              </Pressable>
            </View>
          );
        })}

        <Pressable accessibilityRole="button" onPress={() => setPicking(true)} style={styles.add}>
          <Text style={{ color: theme.accent, fontSize: 17, fontWeight: '600' }}>+ Add exercise</Text>
        </Pressable>

        {rows.length === 0 && (
          <Text style={[styles.empty, { color: theme.textMuted }]}>
            Add the exercises you do in this session, in order.
          </Text>
        )}
      </ScrollView>

      <Modal visible={picking} animationType="slide" presentationStyle="pageSheet">
        <ExercisePicker
          db={db}
          theme={theme}
          onClose={() => setPicking(false)}
          onPick={async (exercise) => {
            setPicking(false);
            await addExerciseToRoutine(db, routineId, exercise.id, { targetSets: 3 });
            await reload();
          }}
        />
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, paddingTop: space(4) },
  top: { flexDirection: 'row', alignItems: 'center', gap: space(2), paddingHorizontal: space(4), paddingBottom: space(3) },
  nameInput: { flex: 1, height: 44, borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth, paddingHorizontal: space(3), fontSize: 20, fontWeight: '700' },
  done: { minHeight: TAP_TARGET, justifyContent: 'center', paddingHorizontal: space(2) },
  list: { padding: space(4), gap: space(2) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(2), padding: space(2), borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth },
  rowText: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600' },
  setsControl: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  sets: { fontSize: 13 },
  tiny: { minWidth: 32, minHeight: TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  add: { minHeight: TAP_TARGET, alignItems: 'center', justifyContent: 'center', marginTop: space(2) },
  empty: { fontSize: 15, textAlign: 'center', paddingVertical: space(6) },
});
