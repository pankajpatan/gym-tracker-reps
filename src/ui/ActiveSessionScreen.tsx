/**
 * The active session screen (UI.md §3) — the product.
 *
 * Structure follows the spec exactly: sticky header with duration/volume/sets
 * and Finish, a scrolling list of exercise cards, and the input dock pinned
 * above the bottom edge. Nothing may cover the dock, and nothing modal may
 * appear while a session is active (UI.md §0).
 */

import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { QueryableDatabase } from '../db/queries';
import type { DockState } from '../domain/dock';
import type { MuscleSlug } from '../domain/muscles';
import { dockSeed, formatDuration } from '../domain/session';
import { restFor } from '../domain/timer';
import { formatWeight, fromKg, toKg } from '../domain/units';
import { useUnit } from './UnitContext';
import { ExerciseCard } from './ExerciseCard';
import { ExerciseDetail } from './ExerciseDetail';
import { ExercisePicker } from './ExercisePicker';
import { InputDock } from './InputDock';
import { PlateCalculator } from './PlateCalculator';
import { RestTimerBar } from './RestTimerBar';
import {
  dark, light, RADIUS, RADIUS_PILL, space, tabular, TAP_TARGET, type as T, type Theme,
} from './theme';
import type { ActiveSessionApi } from './useActiveSession';
import type { RestTimerApi } from './useRestTimer';

interface Props {
  readonly session: ActiveSessionApi;
  readonly db: QueryableDatabase | null;
  readonly rest?: RestTimerApi;
  /** The lifter's default rest, from Settings. Null means no timer. */
  readonly restSeconds?: number | null;
  /** Back to home without ending the session — the workout keeps running. */
  readonly onLeave?: () => void;
}

interface Focus {
  readonly exercise: number;
  readonly row: number;
}

export function ActiveSessionScreen({
  session, db, rest, restSeconds, onLeave,
}: Props): ReactElement {
  const unit = useUnit();
  const scheme = useColorScheme();
  const theme: Theme = scheme === 'light' ? light : dark;

  const [focus, setFocus] = useState<Focus>({ exercise: 0, row: 0 });
  const [picking, setPicking] = useState(false);
  const [hint, setHint] = useState<string | null>(null);
  const [detailFor, setDetailFor] = useState<number | null>(null);
  const [plates, setPlates] = useState(false);
  const [dock, setDock] = useState<DockState>({ weight: null, reps: null, focus: 'weight' });

  /**
   * The dock shows the focused row's values, then the set just logged on this
   * exercise, then the PREVIOUS column — so a lifter doing 3x60kg taps Log set
   * three times without re-entering anything.
   */
  const currentExercise = session.exercises[focus.exercise];
  const focusedRow = currentExercise?.rows[focus.row];
  const lastLogged = [...(currentExercise?.rows ?? [])]
    .filter((row) => row.done && row.index < focus.row)
    .at(-1) ?? null;

  /**
   * The dock holds DISPLAY units; everything stored is kg (SPEC.md). The
   * conversion happens here on the way in and in `handleLog` on the way out,
   * and nowhere else — a dock seeded straight from `weight_kg` would show 60
   * to a lifter working in pounds and then store 60kg when they logged it.
   */
  useEffect(() => {
    if (!focusedRow) return;
    const seed = dockSeed(focusedRow, lastLogged);
    setDock((current) => ({
      weight: seed.weight === null ? null : Math.round(fromKg(seed.weight, unit) * 100) / 100,
      reps: seed.reps,
      focus: current.focus,
    }));
  }, [focusedRow, lastLogged, unit]);

  const header = useMemo(() => ({
    duration: formatDuration(session.totals.durationS),
    volume: `${formatWeight(session.totals.volumeKg, unit)} ${unit}`,
    sets: String(session.totals.sets),
  }), [session.totals, unit]);

  /**
   * Takes the row to log explicitly rather than reading `focus`.
   *
   * Tapping a row's ○ sets focus *and* logs, and `setFocus` does not apply
   * synchronously — reading `focus` here would log whichever row was focused
   * before the tap. The coordinates come from the caller.
   */
  const handleLog = async (exerciseIndex: number, rowIndex: number): Promise<void> => {
    const row = session.exercises[exerciseIndex]?.rows[rowIndex];
    const values: DockState = exerciseIndex === focus.exercise && rowIndex === focus.row
      ? dock
      : { weight: row?.weightKg ?? null, reps: row?.reps ?? null, focus: dock.focus };

    // Back to kg at the edge, so nothing downstream has to know about units.
    const inKg: DockState = {
      ...values,
      weight: values.weight === null ? null : toKg(values.weight, unit),
    };
    const outcome = await session.logRow(exerciseIndex, rowIndex, inKg);

    /**
     * Nothing was written — the row has no reps and nothing to copy from.
     * Say so and put the cursor where the fix is, rather than absorbing the tap
     * in silence. A button that looks like it worked and did not is worse than
     * a button that refuses out loud.
     */
    if (!outcome.logged) {
      if (outcome.reason === 'needs-reps') {
        setFocus({ exercise: exerciseIndex, row: rowIndex });
        setDock((current) => ({ ...current, focus: 'reps' }));
        setHint('Enter reps to log this set');
      } else if (outcome.reason === 'needs-weight') {
        setFocus({ exercise: exerciseIndex, row: rowIndex });
        setDock((current) => ({ ...current, focus: 'weight' }));
        setHint('Enter a weight, or tap BW for bodyweight');
      }
      return;
    }
    setHint(null);

    /**
     * Rest starts on the logged set, not on the tap — if nothing was written
     * there is nothing to rest from, which is why this sits after the guard
     * above. Warm-ups start one too: the lifter is still waiting.
     */
    if (rest) {
      const seconds = restFor(null, restSeconds);
      const exercise = session.exercises[exerciseIndex];
      if (seconds !== null && exercise) {
        void rest.start(seconds, exercise.name, rowIndex);
      }
    }

    if (outcome.next !== null) {
      setFocus({ exercise: exerciseIndex, row: outcome.next });
      return;
    }
    // Exercise finished: advance to the next card that still has work.
    const following = session.exercises.findIndex(
      (ex, i) => i > exerciseIndex && ex.rows.some((r) => !r.done),
    );
    if (following !== -1) setFocus({ exercise: following, row: 0 });
  };

  if (session.sessionId === null) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
        <View style={styles.empty}>
          <Text style={[styles.emptyTitle, { color: theme.text }]}>No workout in progress</Text>
          <Pressable
            accessibilityRole="button"
            onPress={() => void session.start()}
            style={[styles.primary, { backgroundColor: theme.accent }]}
          >
            <Text style={styles.primaryLabel}>Start empty workout</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={[styles.header, { backgroundColor: theme.surface, borderBottomColor: theme.border }]}>
        {onLeave && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="back to home"
            onPress={onLeave}
            style={[styles.iconButton, { backgroundColor: theme.surface2 }]}
          >
            <Text style={{ color: theme.text, fontSize: 20, fontWeight: '600', marginTop: -2 }}>‹</Text>
          </Pressable>
        )}

        <View style={styles.stats}>
          <Stat label="TIME" value={header.duration} theme={theme} />
          <Stat label="VOLUME" value={header.volume} theme={theme} />
          <Stat label="SETS" value={header.sets} theme={theme} />
        </View>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={session.totals.sets === 0 ? 'discard empty workout' : 'finish workout'}
          onPress={async () => {
            /**
             * Ending the workout ends the rest with it.
             *
             * The timer outlived its session: log a set, tap Finish, and the
             * scheduled alert still fired a minute later for a workout that was
             * already over — along with a Live Activity counting down on the
             * Lock Screen for nothing.
             */
            await rest?.skip();
            await session.finish();
          }}
          style={[
            styles.finish,
            session.totals.sets === 0
              ? { backgroundColor: 'transparent', borderColor: theme.border, borderWidth: StyleSheet.hairlineWidth }
              : { backgroundColor: theme.accent },
          ]}
        >
          <Text
            style={[
              T.small,
              {
                fontWeight: '700',
                color: session.totals.sets === 0 ? theme.textMuted : theme.accentText,
              },
            ]}
          >
            {session.totals.sets === 0 ? 'Discard' : 'Finish'}
          </Text>
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={styles.list}
        keyboardShouldPersistTaps="always"
        showsVerticalScrollIndicator={false}
      >
        {session.exercises.length === 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="add your first exercise"
            onPress={() => setPicking(true)}
            style={[styles.emptyCard, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <View style={[styles.emptyBadge, { backgroundColor: theme.accentSoft }]}>
              <Text style={{ color: theme.accent, fontSize: 26, fontWeight: '700', marginTop: -2 }}>+</Text>
            </View>
            <Text style={[T.heading, { color: theme.text }]}>Add your first exercise</Text>
            <Text style={[T.small, { color: theme.textMuted, textAlign: 'center' }]}>
              Search 657 exercises, or create your own.
            </Text>
          </Pressable>
        ) : (
          session.exercises.map((exercise, index) => (
            <ExerciseCard
              key={`${exercise.exerciseId}-${index}`}
              name={exercise.name}
              muscle={exercise.muscle}
              rows={exercise.rows}
              activeRow={focus.exercise === index ? focus.row : null}
              theme={theme}
              onFocusRow={(row) => setFocus({ exercise: index, row })}
              onToggleRow={(row) => void handleLog(index, row)}
              onAddSet={() => session.addSet(index)}
              onOpenDetail={() => setDetailFor(exercise.exerciseId)}
            />
          ))
        )}

        {session.exercises.length > 0 && (
          <Pressable
            accessibilityRole="button"
            onPress={() => setPicking(true)}
            style={[styles.addExercise, { borderColor: theme.borderStrong }]}
          >
            <Text style={[T.heading, { color: theme.accent }]}>+  Add exercise</Text>
          </Pressable>
        )}
      </ScrollView>

      <Modal visible={detailFor !== null} animationType="slide" presentationStyle="pageSheet">
        {db && detailFor !== null && (
          <ExerciseDetail
            db={db}
            exerciseId={detailFor}
            theme={theme}
            onClose={() => setDetailFor(null)}
          />
        )}
      </Modal>

      <Modal visible={picking} animationType="slide" presentationStyle="pageSheet">
        {db && (
          <ExercisePicker
            db={db}
            theme={theme}
            onClose={() => setPicking(false)}
            onPick={(row) => {
              setPicking(false);
              void session.addExercise(
                row.id, row.name, (row.muscle as MuscleSlug | null) ?? null, row.equipment,
              );
            }}
          />
        )}
      </Modal>

      {hint && (
        <Text style={[styles.hint, { color: theme.danger, backgroundColor: theme.surface }]}>
          {hint}
        </Text>
      )}

      {rest && (
        <RestTimerBar
          timer={rest.timer}
          secondsLeft={rest.secondsLeft}
          theme={theme}
          onAdjust={(delta) => void rest.add(delta)}
          onSkip={() => void rest.skip()}
        />
      )}

      <InputDock
        state={dock}
        theme={theme}
        onChange={(next) => { setHint(null); setDock(next); }}
        onLog={() => void handleLog(focus.exercise, focus.row)}
        onOpenPlates={() => setPlates(true)}
      />

      <Modal visible={plates} animationType="slide" presentationStyle="pageSheet">
        <PlateCalculator
          weight={dock.weight}
          theme={theme}
          onClose={() => setPlates(false)}
        />
      </Modal>
    </SafeAreaView>
  );
}

function Stat({ label, value, theme }: { label: string; value: string; theme: Theme }): ReactElement {
  return (
    <View style={styles.stat}>
      <Text style={[T.label, { color: theme.textFaint }]}>{label}</Text>
      <Text style={[styles.statValue, tabular, { color: theme.text }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  header: {
    flexDirection: 'row', alignItems: 'center', gap: space(2),
    paddingHorizontal: space(3), paddingVertical: space(2),
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  iconButton: { width: 36, height: 36, borderRadius: RADIUS_PILL, alignItems: 'center', justifyContent: 'center' },
  stats: { flexDirection: 'row', flex: 1, gap: space(5), paddingLeft: space(1) },
  stat: { gap: 1 },
  statValue: { fontSize: 19, fontWeight: '700', letterSpacing: -0.3 },
  finish: { height: 34, paddingHorizontal: space(4), borderRadius: RADIUS_PILL, alignItems: 'center', justifyContent: 'center' },
  list: { padding: space(4), gap: space(3) },
  hint: { fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: space(2) },
  empty: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: space(4), padding: space(4) },
  emptyTitle: { fontSize: 22, fontWeight: '700' },
  emptyCard: {
    alignItems: 'center', gap: space(2), paddingVertical: space(8), paddingHorizontal: space(5),
    borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed', marginTop: space(6),
  },
  emptyBadge: { width: 52, height: 52, borderRadius: RADIUS_PILL, alignItems: 'center', justifyContent: 'center', marginBottom: space(1) },
  addExercise: {
    height: 48, alignItems: 'center', justifyContent: 'center',
    borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed',
  },
  primary: {
    minHeight: TAP_TARGET + space(1), borderRadius: 14, paddingHorizontal: space(6),
    alignItems: 'center', justifyContent: 'center',
  },
  primaryLabel: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
});
