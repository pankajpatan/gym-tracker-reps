/**
 * A finished workout, read-only (UI.md §6).
 *
 * The minimum that makes training visible: what you did, in the order you did
 * it. Editing a past session, the calendar and the charts are later steps — but
 * a log you cannot read back is not a log, so this much ships now.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { sessionDetail, type QueryableDatabase, type SessionDetailRow } from '../db/queries';
import { ExerciseDetail } from './ExerciseDetail';
import type { MuscleSlug } from '../domain/muscles';
import { formatWeight } from '../domain/units';
import { useUnit } from './UnitContext';
import { MuscleChip } from './MuscleMap';
import { space, TAP_TARGET, tabular, type Theme } from './theme';

interface Props {
  readonly db: QueryableDatabase;
  readonly sessionId: number;
  readonly title: string;
  readonly theme: Theme;
  readonly onClose: () => void;
}

export function SessionDetail({ db, sessionId, title, theme, onClose }: Props): ReactElement {
  const unit = useUnit();
  const [rows, setRows] = useState<SessionDetailRow[]>([]);
  const [detailFor, setDetailFor] = useState<number | null>(null);

  useEffect(() => {
    let live = true;
    void sessionDetail(db, sessionId).then((result) => { if (live) setRows(result); });
    return () => { live = false; };
  }, [db, sessionId]);

  // Group consecutive sets of the same exercise, the way they were performed.
  const groups: { exerciseId: number; name: string; muscle: string | null; sets: SessionDetailRow[] }[] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last && last.exerciseId === row.exercise_id) last.sets.push(row);
    else groups.push({ exerciseId: row.exercise_id, name: row.name, muscle: row.muscle, sets: [row] });
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={styles.top}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={1}>{title}</Text>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.done}>
          <Text style={{ color: theme.accent, fontSize: 17, fontWeight: '700' }}>Done</Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.list}>
        {groups.map((group, index) => (
          <View key={`${group.exerciseId}-${index}`} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${group.name}, open history and records`}
              onPress={() => setDetailFor(group.exerciseId)}
              style={styles.cardHead}
            >
              <MuscleChip muscle={(group.muscle as MuscleSlug | null) ?? null} theme={theme} />
              <Text style={[styles.name, { color: theme.text }]}>{group.name}</Text>
              <Text style={{ color: theme.textMuted, fontSize: 15 }}>›</Text>
            </Pressable>
            {group.sets.map((set, i) => (
              <View key={i} style={styles.setRow}>
                <Text style={[styles.setIndex, tabular, { color: theme.textMuted }]}>
                  {set.type === 'warmup' ? 'W' : i + 1}
                </Text>
                <Text style={[styles.setValue, tabular, { color: theme.text }]}>
                  {set.weight_kg === null ? 'Bodyweight' : `${formatWeight(set.weight_kg, unit)} ${unit}`}
                  {set.reps === null ? '' : ` × ${set.reps}`}
                </Text>
              </View>
            ))}
          </View>
        ))}

        {rows.length === 0 && (
          <Text style={[styles.empty, { color: theme.textMuted }]}>No sets were logged in this workout.</Text>
        )}
      </ScrollView>

      <Modal visible={detailFor !== null} animationType="slide" presentationStyle="pageSheet">
        {detailFor !== null && (
          <ExerciseDetail
            db={db}
            exerciseId={detailFor}
            theme={theme}
            onClose={() => setDetailFor(null)}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: space(4), paddingVertical: space(3) },
  title: { flex: 1, fontSize: 26, fontWeight: '700', letterSpacing: -0.5 },
  done: { minHeight: TAP_TARGET, justifyContent: 'center', paddingHorizontal: space(2) },
  list: { padding: space(4), gap: space(3) },
  card: { borderRadius: 14, borderWidth: StyleSheet.hairlineWidth, padding: space(3), gap: space(1) },
  cardHead: { flexDirection: 'row', alignItems: 'center', gap: space(2), marginBottom: space(1) },
  name: { fontSize: 17, fontWeight: '700', flexShrink: 1 },
  setRow: { flexDirection: 'row', alignItems: 'center', gap: space(3), minHeight: 28 },
  setIndex: { width: 24, fontSize: 12, fontWeight: '700' },
  setValue: { fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  empty: { fontSize: 15, textAlign: 'center', paddingVertical: space(8) },
});
