/**
 * History (UI.md §6): a month calendar with a dot on every trained day, above
 * the sessions for the selected day — or the whole month when none is selected.
 *
 * The dot is the point of this screen. A lifter opens it to see whether the
 * month looks full, and only then to read one workout, so consistency is what
 * the layout leads with.
 */

import { useCallback, useEffect, useState, type ReactElement } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { recentSessions, trainedDays, type QueryableDatabase, type SessionSummary } from '../db/queries';
import {
  groupByDay, keyForEpoch, monthGrid, monthLabel, monthRange, shiftMonth, WEEKDAYS,
} from '../domain/calendar';
import { formatDuration } from '../domain/session';
import { formatWeight } from '../domain/units';
import { useUnit } from './UnitContext';
import { SessionDetail } from './SessionDetail';
import { RADIUS, RADIUS_PILL, RADIUS_SM, space, TAP_TARGET, tabular, type as T, type Theme } from './theme';

interface Props {
  readonly db: QueryableDatabase | null;
  readonly theme: Theme;
}

export function HistoryScreen({ db, theme }: Props): ReactElement {
  const unit = useUnit();
  const today = new Date();
  const [{ year, month }, setMonth] = useState({ year: today.getFullYear(), month: today.getMonth() });
  const [selected, setSelected] = useState<string | null>(null);
  const [days, setDays] = useState<{ id: number; started_at: number; name: string | null }[]>([]);
  const [summaries, setSummaries] = useState<SessionSummary[]>([]);
  const [viewing, setViewing] = useState<{ id: number; title: string } | null>(null);

  const reload = useCallback(async () => {
    if (!db) return;
    const { from, to } = monthRange(year, month);
    setDays(await trainedDays(db, from, to));
    // Counts and volume come from the same summary query the home screen uses,
    // so a workout cannot read differently in two places.
    setSummaries(await recentSessions(db, 200));
  }, [db, year, month]);

  useEffect(() => { void reload(); }, [reload]);

  const byDay = groupByDay(days);
  const grid = monthGrid(year, month, today);
  const summaryFor = (id: number): SessionSummary | undefined => summaries.find((s) => s.id === id);

  const listed = selected
    ? (byDay.get(selected) ?? [])
    : days;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <Text style={[styles.screenTitle, { color: theme.text }]}>History</Text>

      <View style={[styles.calendar, { backgroundColor: theme.surface, borderColor: theme.border }]}>
      <View style={styles.header}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="previous month"
          onPress={() => { setSelected(null); setMonth(shiftMonth(year, month, -1)); }}
          style={styles.arrow}
        >
          <Text style={{ color: theme.accent, fontSize: 22 }}>‹</Text>
        </Pressable>
        <Text style={[styles.month, { color: theme.text }]}>{monthLabel(year, month)}</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="next month"
          onPress={() => { setSelected(null); setMonth(shiftMonth(year, month, 1)); }}
          style={styles.arrow}
        >
          <Text style={{ color: theme.accent, fontSize: 22 }}>›</Text>
        </Pressable>
      </View>

      <View style={styles.weekdays}>
        {WEEKDAYS.map((day, index) => (
          <Text key={index} style={[styles.weekday, { color: theme.textMuted }]}>{day}</Text>
        ))}
      </View>

      <View style={styles.grid}>
        {grid.map((square) => {
          const trained = byDay.has(square.key);
          const isSelected = selected === square.key;
          return (
            <Pressable
              key={square.key}
              accessibilityRole="button"
              accessibilityState={{ selected: isSelected }}
              accessibilityLabel={`${square.key}${trained ? ', trained' : ''}`}
              onPress={() => setSelected(isSelected ? null : square.key)}
              style={styles.square}
            >
              <View
                style={[
                  styles.squareInner,
                  trained && { backgroundColor: theme.accentSoft },
                  isSelected && { backgroundColor: theme.accent },
                  square.isToday && !isSelected && { borderColor: theme.accent, borderWidth: 1.5 },
                ]}
              >
                <Text
                  style={[
                    styles.dayNumber,
                    tabular,
                    {
                      color: isSelected
                        ? theme.accentText
                        : trained ? theme.accent : theme.text,
                      opacity: square.inMonth ? 1 : 0.25,
                      fontWeight: trained || isSelected ? '700' : '500',
                    },
                  ]}
                >
                  {square.day}
                </Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      </View>

      <ScrollView contentContainerStyle={styles.list}>
        <Text style={[styles.listHead, { color: theme.textFaint }]}>
          {selected ? `${listed.length} on this day` : `${days.length} this month`}
        </Text>

        {listed.length === 0 && (
          <Text style={[styles.empty, { color: theme.textMuted }]}>
            {selected ? 'Nothing logged on this day.' : 'No workouts this month yet.'}
          </Text>
        )}

        {listed.map((row) => {
          const summary = summaryFor(row.id);
          const when = new Date(row.started_at * 1000);
          const title = row.name ?? when.toLocaleDateString();
          return (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              onPress={() => setViewing({ id: row.id, title })}
              style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <View style={[styles.countBlock, { backgroundColor: theme.surface2 }]}>
                <Text style={[styles.countValue, tabular, { color: theme.text }]}>
                  {summary?.sets ?? 0}
                </Text>
                <Text style={[styles.countLabel, { color: theme.textFaint }]}>SETS</Text>
              </View>
              <View style={{ flex: 1 }}>
              <Text style={[styles.cardName, { color: theme.text }]} numberOfLines={1}>{title}</Text>
              <Text style={[styles.cardMeta, tabular, { color: theme.textMuted }]}>
                {when.toLocaleDateString()} {when.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                {summary ? ` · ${formatDuration((summary.ended_at ?? summary.started_at) - summary.started_at)}` : ''}
                {summary ? ` · ${formatWeight(summary.volume_kg, unit)} ${unit}` : ''}
              </Text>
              </View>
            </Pressable>
          );
        })}
      </ScrollView>

      <Modal visible={viewing !== null} animationType="slide" presentationStyle="pageSheet">
        {db && viewing && (
          <SessionDetail
            db={db}
            sessionId={viewing.id}
            title={viewing.title}
            theme={theme}
            onClose={() => setViewing(null)}
          />
        )}
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  screenTitle: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, paddingHorizontal: space(4), paddingTop: space(2), paddingBottom: space(3) },
  calendar: { marginHorizontal: space(4), borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth, paddingBottom: space(2) },
  squareInner: { width: 38, height: 38, borderRadius: RADIUS_SM, alignItems: 'center', justifyContent: 'center', borderColor: 'transparent', borderWidth: 1.5 },
  countBlock: { width: 46, height: 46, borderRadius: RADIUS_SM, alignItems: 'center', justifyContent: 'center' },
  countValue: { fontSize: 19, fontWeight: '700', letterSpacing: -0.5 },
  countLabel: { fontSize: 9, fontWeight: '700', letterSpacing: 0.6 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space(3), paddingVertical: space(2) },
  arrow: { minWidth: TAP_TARGET, minHeight: TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  month: { fontSize: 15, fontWeight: '700' },
  weekdays: { flexDirection: 'row', paddingHorizontal: space(2) },
  weekday: { flex: 1, textAlign: 'center', fontSize: 11, fontWeight: '600' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: space(2), paddingBottom: space(2) },
  square: { width: `${100 / 7}%`, height: 44, alignItems: 'center', justifyContent: 'center' },
  dayNumber: { fontSize: 14 },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
  list: { padding: space(4), gap: space(2) },
  listHead: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
  card: { flexDirection: 'row', alignItems: 'center', gap: space(3), padding: space(2), borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth },
  cardName: { fontSize: 17, fontWeight: '600' },
  cardMeta: { fontSize: 13, marginTop: 2 },
  empty: { fontSize: 15, textAlign: 'center', paddingVertical: space(6) },
});
