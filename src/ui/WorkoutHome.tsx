/**
 * Workout home (UI.md §2) — the screen the app opens on.
 *
 * Three states, and the spec is strict about the third: when a session is in
 * progress the whole screen becomes a resume card, because **there must never
 * be two entry points to one session**. Starting a second workout while one is
 * running is how a lifter loses a set.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  createRoutine, deleteRoutine, listRoutines, recentSessions, routineExercises,
  routineLastTrained, type QueryableDatabase, type RoutineRow, type SessionSummary,
} from '../db/queries';
import { healthNotice } from '../domain/health';
import { formatDuration } from '../domain/session';
import { formatWeight } from '../domain/units';
import { useUnit } from './UnitContext';
import { SessionDetail } from './SessionDetail';
import { RoutineEditor } from './RoutineEditor';
import { RADIUS, RADIUS_PILL, RADIUS_SM, space, TAP_TARGET, tabular, type as T, type Theme } from './theme';
import type { ActiveSessionApi } from './useActiveSession';
import type { HealthApi } from './useHealth';

interface Props {
  readonly db: QueryableDatabase | null;
  readonly session: ActiveSessionApi;
  readonly theme: Theme;
  readonly health: HealthApi;
  readonly onOpenSession: () => void;
}

interface RoutineCard extends RoutineRow {
  readonly exercises: number;
  readonly lastTrained: number | null;
}

/** "Last: 4 days ago" — vague on purpose; nobody needs the hour. */
function ResumeStat({ value, label, theme }: { value: string; label: string; theme: Theme }): ReactElement {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.resumeValue, tabular, { color: theme.text }]}>{value}</Text>
      <Text style={[T.label, { color: theme.textFaint }]}>{label}</Text>
    </View>
  );
}

function agoLabel(epochSeconds: number | null, now: number): string {
  if (epochSeconds === null) return 'Not trained yet';
  const days = Math.floor((now - epochSeconds) / 86_400);
  if (days <= 0) return 'Last: today';
  if (days === 1) return 'Last: yesterday';
  return `Last: ${days} days ago`;
}

/**
 * "Empty" only means something next to a routine. With no routines saved there
 * is nothing to be empty of, so the first-launch label is just "Start workout".
 * Once routines exist the word does real work and matches what switchers know —
 * Strong and Hevy both label this button "Start Empty Workout".
 */
/**
 * Apple Health, named where a lifter lands after tapping Finish (guideline
 * 2.5.1). What it says is decided in domain/health.ts.
 */
function HealthCard({ health, session, hasFinishedWorkout, theme }: {
  health: HealthApi; session: ActiveSessionApi; hasFinishedWorkout: boolean; theme: Theme;
}): ReactElement | null {
  const notice = healthNotice({
    available: health.available,
    enabled: health.enabled,
    offerDismissed: health.offerDismissed,
    hasFinishedWorkout,
    lastFinishedEndedAt: session.lastFinished?.endedAt ?? null,
    lastSavedEndedAt: health.lastSavedEndedAt,
    lastError: health.lastError,
  });
  if (notice.kind === 'none') return null;

  if (notice.kind === 'offer') {
    return (
      <View style={[styles.healthCard, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.healthHead}>
          <Text style={[styles.healthTitle, { color: theme.text }]}>Save workouts to Apple Health</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="not now"
            onPress={() => void health.dismissOffer()}
            style={styles.tiny}
          >
            <Text style={{ color: theme.textFaint, fontSize: 17 }}>×</Text>
          </Pressable>
        </View>
        <Text style={[T.small, { color: theme.textMuted }]}>
          Each finished workout is written to the Health app as strength
          training. Nothing is read from Apple Health.
        </Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="turn on Apple Health"
          onPress={async () => {
            if (!(await health.enable())) return;
            // The workout that prompted this was finished while Health was
            // off, so it was not written. Write it now, once.
            const finished = session.lastFinished;
            if (finished && health.lastSavedEndedAt !== finished.endedAt) {
              await health.saveWorkout(finished);
            }
          }}
          style={[styles.healthButton, { backgroundColor: theme.accentSoft }]}
        >
          <Text style={{ color: theme.accent, fontSize: 15, fontWeight: '700' }}>Turn on</Text>
        </Pressable>
      </View>
    );
  }

  const line = notice.kind === 'saved'
    ? '✓ Workout saved to Apple Health'
    : notice.kind === 'failed'
      ? `Not saved to Apple Health: ${notice.reason}`
      : 'Finished workouts are saved to Apple Health';
  const color = notice.kind === 'saved'
    ? theme.success
    : notice.kind === 'failed' ? theme.danger : theme.textMuted;
  return (
    <View
      accessibilityRole="text"
      style={[styles.healthLine, { backgroundColor: notice.kind === 'saved' ? theme.successSoft : theme.surface }]}
    >
      <Text style={{ color, fontSize: 14, fontWeight: '600' }}>{line}</Text>
    </View>
  );
}

export function WorkoutHome({ db, session, theme, health, onOpenSession }: Props): ReactElement {
  const unit = useUnit();
  const [cards, setCards] = useState<RoutineCard[]>([]);
  const [editing, setEditing] = useState<{ id: number; name: string } | null>(null);
  const [recent, setRecent] = useState<SessionSummary[]>([]);
  const [viewingSession, setViewingSession] = useState<{ id: number; title: string } | null>(null);

  const reload = useCallback(async () => {
    if (!db) return;
    const routines = await listRoutines(db);
    const now = Math.floor(Date.now() / 1000);
    const built: RoutineCard[] = [];
    for (const routine of routines) {
      built.push({
        ...routine,
        exercises: (await routineExercises(db, routine.id)).length,
        lastTrained: await routineLastTrained(db, routine.id),
      });
    }
    setCards(built);
    setRecent(await recentSessions(db, 5));
    void now;
  }, [db]);

  // Reloads when a workout finishes too — `session.sessionId` going null is the
  // signal that a session just ended and Recent has something new in it.
  useEffect(() => { void reload(); }, [reload, editing, session.sessionId]);

  const now = Math.floor(Date.now() / 1000);

  // A session is running: the resume card replaces everything else.
  if (session.sessionId !== null) {
    return (
      <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
        <View style={styles.list}>
          <Text style={[styles.screenTitle, { color: theme.text }]}>Workout</Text>

          <View style={[styles.resume, { backgroundColor: theme.surface, borderColor: theme.accent }]}>
            <View style={styles.liveRow}>
              <View style={[styles.liveDot, { backgroundColor: theme.accent }]} />
              <Text style={[T.label, { color: theme.accent }]}>IN PROGRESS</Text>
            </View>

            <View style={styles.resumeStats}>
              <ResumeStat value={formatDuration(session.totals.durationS)} label="TIME" theme={theme} />
              <ResumeStat value={String(session.totals.sets)} label="SETS" theme={theme} />
              <ResumeStat value={String(session.exercises.length)} label="EXERCISES" theme={theme} />
            </View>

            <Pressable
              accessibilityRole="button"
              onPress={onOpenSession}
              style={[styles.primary, { backgroundColor: theme.accent }]}
            >
              <Text style={styles.primaryLabel}>Resume workout</Text>
            </Pressable>
          </View>
        </View>
      </SafeAreaView>
    );
  }


  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={styles.list}>
        <Text style={[styles.screenTitle, { color: theme.text }]}>Workout</Text>

        <Pressable
          accessibilityRole="button"
          onPress={async () => { await session.start(); onOpenSession(); }}
          style={[styles.primary, { backgroundColor: theme.accent }]}
        >
          <Text style={styles.primaryLabel}>
            {cards.length === 0 ? 'Start workout' : 'Start empty workout'}
          </Text>
        </Pressable>

        <HealthCard
          health={health}
          session={session}
          hasFinishedWorkout={recent.length > 0}
          theme={theme}
        />

        <View style={styles.sectionHead}>
          <Text style={[styles.section, { color: theme.textMuted }]}>ROUTINES</Text>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="new routine"
            onPress={async () => {
              if (!db) return;
              const id = await createRoutine(db, 'New routine');
              setEditing({ id, name: 'New routine' });
            }}
            style={styles.tiny}
          >
            <Text style={{ color: theme.accent, fontSize: 22 }}>+</Text>
          </Pressable>
        </View>

        {cards.length === 0 && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="create your first routine"
            onPress={async () => {
              if (!db) return;
              const id = await createRoutine(db, 'New routine');
              setEditing({ id, name: 'New routine' });
            }}
            style={[styles.emptyCard, { borderColor: theme.border }]}
          >
            <Text style={[T.heading, { color: theme.text }]}>Build a routine</Text>
            <Text style={[T.small, { color: theme.textMuted, textAlign: 'center' }]}>
              Save the exercises you do together, and it is waiting for you next time.
            </Text>
          </Pressable>
        )}

        {cards.map((card) => (
          <View key={card.id} style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`start ${card.name}`}
              onPress={async () => { await session.startFromRoutine(card.id, card.name); onOpenSession(); }}
              style={styles.cardMain}
            >
              <View style={[styles.countBlock, { backgroundColor: theme.surface2 }]}>
                <Text style={[styles.countValue, tabular, { color: theme.text }]}>{card.exercises}</Text>
                <Text style={[styles.countLabel, { color: theme.textFaint }]}>EX</Text>
              </View>
              <View style={styles.cardText}>
                <Text style={[styles.cardName, { color: theme.text }]} numberOfLines={1}>{card.name}</Text>
                <Text style={[styles.cardMeta, { color: theme.textMuted }]}>
                  {agoLabel(card.lastTrained, now)}
                </Text>
              </View>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`edit ${card.name}`}
              onPress={() => setEditing({ id: card.id, name: card.name })}
              style={[styles.iconButton, { backgroundColor: theme.surface2 }]}
            >
              <Text style={{ color: theme.textMuted, fontSize: 15 }}>✎</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`delete ${card.name}`}
              onPress={async () => { if (db) { await deleteRoutine(db, card.id); await reload(); } }}
              style={[styles.iconButton, { backgroundColor: theme.surface2 }]}
            >
              <Text style={{ color: theme.danger, fontSize: 17 }}>×</Text>
            </Pressable>
          </View>
        ))}
        <Text style={[styles.section, { color: theme.textMuted, marginTop: space(4) }]}>RECENT</Text>

        {recent.length === 0 && (
          <Text style={[styles.empty, { color: theme.textFaint }]}>
            Finished workouts show up here.
          </Text>
        )}

        {recent.map((item) => {
          const when = new Date(item.started_at * 1000);
          const title = item.name ?? when.toLocaleDateString();
          return (
            <Pressable
              key={item.id}
              accessibilityRole="button"
              accessibilityLabel={`${title}, ${item.sets} sets`}
              onPress={() => setViewingSession({ id: item.id, title })}
              style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <View style={styles.cardMain}>
                <View style={[styles.countBlock, { backgroundColor: theme.surface2 }]}>
                  <Text style={[styles.countValue, tabular, { color: theme.text }]}>{item.sets}</Text>
                  <Text style={[styles.countLabel, { color: theme.textFaint }]}>SETS</Text>
                </View>
                <View style={styles.cardText}>
                  <Text style={[styles.cardName, { color: theme.text }]} numberOfLines={1}>{title}</Text>
                  <Text style={[styles.cardMeta, tabular, { color: theme.textMuted }]}>
                    {when.toLocaleDateString()} · {formatDuration((item.ended_at ?? item.started_at) - item.started_at)}
                    {' · '}{formatWeight(item.volume_kg, unit)} {unit}
                  </Text>
                </View>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <Modal visible={viewingSession !== null} animationType="slide" presentationStyle="pageSheet">
        {db && viewingSession && (
          <SessionDetail
            db={db}
            sessionId={viewingSession.id}
            title={viewingSession.title}
            theme={theme}
            onClose={() => setViewingSession(null)}
          />
        )}
      </Modal>

      <Modal visible={editing !== null} animationType="slide" presentationStyle="pageSheet">
        {db && editing && (
          <RoutineEditor
            db={db}
            routineId={editing.id}
            initialName={editing.name}
            theme={theme}
            onClose={() => setEditing(null)}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  list: { padding: space(4), gap: space(3) },
  primary: { height: 56, borderRadius: RADIUS, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', letterSpacing: 0.2 },
  sectionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: space(2) },
  section: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  screenTitle: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, marginBottom: space(1) },
  card: { flexDirection: 'row', alignItems: 'center', gap: space(2), padding: space(2), borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth },
  cardMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: space(3), paddingVertical: space(1) },
  cardText: { flex: 1 },
  countBlock: { width: 48, height: 48, borderRadius: RADIUS_SM, alignItems: 'center', justifyContent: 'center' },
  countValue: { fontSize: 20, fontWeight: '700', letterSpacing: -0.5 },
  countLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  iconButton: { width: 34, height: 34, borderRadius: RADIUS_PILL, alignItems: 'center', justifyContent: 'center' },
  emptyCard: { alignItems: 'center', gap: space(2), paddingVertical: space(6), paddingHorizontal: space(5), borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth, borderStyle: 'dashed' },
  cardName: { fontSize: 17, fontWeight: '600', letterSpacing: -0.2 },
  cardMeta: { fontSize: 13, marginTop: 2 },
  tiny: { minWidth: 40, minHeight: TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  liveRow: { flexDirection: 'row', alignItems: 'center', gap: space(2) },
  liveDot: { width: 8, height: 8, borderRadius: 4 },
  resumeStats: { flexDirection: 'row' },
  resumeValue: { fontSize: 26, fontWeight: '700', letterSpacing: -0.6 },
  empty: { fontSize: 15, textAlign: 'center', paddingVertical: space(4) },
  healthCard: { padding: space(3), borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth, gap: space(2) },
  healthHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  healthTitle: { fontSize: 17, fontWeight: '600', flex: 1 },
  healthButton: { alignSelf: 'flex-start', paddingHorizontal: space(4), minHeight: 40, borderRadius: RADIUS_PILL, justifyContent: 'center' },
  healthLine: { paddingHorizontal: space(3), paddingVertical: space(2), borderRadius: RADIUS_SM },
  resume: { padding: space(4), borderRadius: RADIUS, borderWidth: 1.5, gap: space(4) },
});
