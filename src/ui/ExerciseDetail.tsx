/**
 * Exercise detail (UI.md §4): History · Charts · Records · About.
 *
 * The comparison strip at the top is Setgraph's pattern and the spec notes
 * nobody else in the SERP shows it — this session against the one before it,
 * which is the question a lifter actually asks ("did I beat last time"), not a
 * rolling average, which answers a different one.
 */

import { useEffect, useState, type ReactElement } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  exerciseHistory, exerciseInfo, personalRecordsFor,
  type ExerciseSessionRow, type ExerciseInfo, type PrRecord, type QueryableDatabase,
} from '../db/queries';
import { parseArt } from '../db/seed';
import type { MuscleSlug } from '../domain/muscles';
import {
  compareToRecent, convertDelta, formatDelta, rollingAverage, series, smoothingWindow,
  type Metric,
} from '../domain/progress';
import { formatWeight, fromKg } from '../domain/units';
import { useUnit } from './UnitContext';
import { Chart } from './Chart';
import { MuscleMap } from './MuscleMap';
import { RADIUS, RADIUS_PILL, RADIUS_SM, space, TAP_TARGET, tabular, type as T, type Theme } from './theme';

type Tab = 'history' | 'charts' | 'records' | 'about';

const PR_LABEL: Record<string, string> = {
  weight: 'Best weight',
  reps: 'Most reps',
  volume: 'Best set volume',
  e1rm: 'Estimated 1RM',
};

interface Props {
  readonly db: QueryableDatabase;
  readonly exerciseId: number;
  readonly theme: Theme;
  readonly onClose: () => void;
}

export function ExerciseDetail({ db, exerciseId, theme, onClose }: Props): ReactElement {
  const unit = useUnit();
  const [tab, setTab] = useState<Tab>('history');
  const [info, setInfo] = useState<ExerciseInfo | null>(null);
  const [history, setHistory] = useState<ExerciseSessionRow[]>([]);
  const [records, setRecords] = useState<PrRecord[]>([]);
  const [metric, setMetric] = useState<Metric>('volume');

  useEffect(() => {
    let live = true;
    void (async () => {
      const [i, h, r] = await Promise.all([
        exerciseInfo(db, exerciseId),
        exerciseHistory(db, exerciseId),
        personalRecordsFor(db, exerciseId),
      ]);
      if (!live) return;
      setInfo(i); setHistory(h); setRecords(r);
    })();
    return () => { live = false; };
  }, [db, exerciseId]);

  const comparison = compareToRecent(history);
  const art = parseArt(info?.art_ref ?? null);

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={styles.top}>
        <Text style={[styles.title, { color: theme.text }]} numberOfLines={2}>
          {info?.name ?? 'Exercise'}
        </Text>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.done}>
          <Text style={{ color: theme.accent, fontSize: 17, fontWeight: '700' }}>Done</Text>
        </Pressable>
      </View>

      <Text style={[styles.meta, { color: theme.textMuted }]}>
        {[info?.muscle, info?.equipment].filter(Boolean).join(' · ') || 'Custom exercise'}
      </Text>

      {comparison && (
        <View style={[styles.strip, { borderColor: theme.border, backgroundColor: theme.surface }]}>
          <StripItem label="sets" value={String(comparison.sets.value)} delta={formatDelta(comparison.sets)} theme={theme} />
          <StripItem label="reps" value={String(comparison.reps.value)} delta={formatDelta(comparison.reps)} theme={theme} />
          {(() => {
            // Volume is stored in kg; both the figure and its change belong in
            // the lifter's unit, and at this magnitude a decimal is noise.
            const volume = convertDelta(comparison.volume, (value) => fromKg(value, unit));
            return (
              <StripItem
                label={`${unit} volume`}
                value={Math.round(volume.value).toLocaleString()}
                delta={formatDelta(volume)}
                theme={theme}
              />
            );
          })()}
        </View>
      )}

      {comparison && comparison.against > 0 && (
        <Text style={[styles.against, { color: theme.textFaint }]}>
          Last session vs your previous {comparison.against}
        </Text>
      )}

      <View style={[styles.tabs, { backgroundColor: theme.surface2 }]}>
        {(['history', 'charts', 'records', 'about'] as Tab[]).map((name) => (
          <Pressable
            key={name}
            accessibilityRole="button"
            accessibilityState={{ selected: tab === name }}
            onPress={() => setTab(name)}
            style={[styles.tab, tab === name && { backgroundColor: theme.surface }]}
          >
            <Text style={{
              color: tab === name ? theme.text : theme.textMuted,
              fontSize: 13,
              fontWeight: tab === name ? '700' : '500',
            }}>
              {name[0]?.toUpperCase()}{name.slice(1)}
            </Text>
          </Pressable>
        ))}
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {tab === 'history' && (
          history.length === 0
            ? <Empty theme={theme} text="You have not logged this exercise yet." />
            : history.map((row) => (
              <View key={row.session_id} style={[styles.row, { borderBottomColor: theme.border }]}>
                <Text style={[styles.rowDate, { color: theme.text }]}>
                  {new Date(row.started_at * 1000).toLocaleDateString()}
                </Text>
                <Text style={[styles.rowMeta, tabular, { color: theme.textMuted }]}>
                  {row.sets} sets · {row.reps} reps · {formatWeight(row.volume_kg, unit)} {unit}
                  {row.top_weight_kg === null ? '' : ` · top ${formatWeight(row.top_weight_kg, unit)}`}
                </Text>
              </View>
            ))
        )}

        {tab === 'charts' && (
          <View style={styles.gap}>
            <View style={styles.metrics}>
              {(['volume', 'weight', 'e1rm'] as Metric[]).map((name) => (
                <Pressable
                  key={name}
                  accessibilityRole="button"
                  accessibilityState={{ selected: metric === name }}
                  onPress={() => setMetric(name)}
                  style={[
                    styles.metricChip,
                    {
                      backgroundColor: metric === name ? theme.accent : theme.surface,
                      borderColor: metric === name ? theme.accent : theme.border,
                    },
                  ]}
                >
                  <Text style={{ color: metric === name ? '#FFFFFF' : theme.text, fontSize: 13 }}>
                    {name === 'e1rm' ? 'Est. 1RM' : name === 'weight' ? 'Top weight' : 'Volume'}
                  </Text>
                </Pressable>
              ))}
            </View>
            {(() => {
              /**
               * Everything is stored in kg and the chart is labelled with the
               * lifter's unit, so the VALUES have to be converted too. Labelling
               * kilograms as pounds was wrong by a factor of 2.2.
               */
              const raw = series(history, metric)
                .map((point) => ({ at: point.at, value: fromKg(point.value, unit) }));
              const window = smoothingWindow(raw.length);
              const smoothed = rollingAverage(raw, window);
              return (
                <>
                  {window > 1 ? (
                    <Chart points={smoothed} raw={raw} theme={theme} suffix={` ${unit}`} />
                  ) : (
                    <Chart points={raw} theme={theme} suffix={` ${unit}`} />
                  )}
                  <Text style={[styles.note, { color: theme.textFaint }]}>
                    {metric === 'volume'
                      ? `Total ${unit} moved per session — sets × reps × weight.`
                      : metric === 'weight'
                        ? 'Heaviest set of each session.'
                        : 'Best estimated one-rep max of each session.'}
                  </Text>
                  <Text style={[styles.note, { color: theme.textFaint }]}>
                    {window > 1
                      ? `Trend over ${window} sessions, with each session behind it.`
                      : 'Every session, unsmoothed.'}
                    {' '}Warm-up sets are excluded.
                  </Text>
                </>
              );
            })()}
          </View>
        )}

        {tab === 'records' && (
          records.length === 0
            ? <Empty theme={theme} text="Records appear once you finish a workout with this exercise." />
            : records.map((record) => (
              <View key={record.kind} style={[styles.row, { borderBottomColor: theme.border }]}>
                <Text style={[styles.rowDate, { color: theme.text }]}>
                  {PR_LABEL[record.kind] ?? record.kind}
                </Text>
                <Text style={[styles.rowMeta, tabular, { color: theme.textMuted }]}>
                  {record.kind === 'reps'
                    ? `${Math.round(record.value)} reps`
                    : `${formatWeight(record.value, unit)} ${unit}`}
                  {' · '}{new Date(record.achieved_at * 1000).toLocaleDateString()}
                </Text>
              </View>
            ))
        )}

        {tab === 'about' && (
          <View style={styles.gap}>
            <View style={styles.maps}>
              <MuscleMap
                primary={art.primary as MuscleSlug[]}
                secondary={art.secondary as MuscleSlug[]}
                size={96}
                theme={theme}
              />
            </View>
            <View style={styles.legend}>
              <Legend colour={theme.accent} label="Primary" theme={theme} />
              <Legend colour={`${theme.accent}4D`} label="Secondary" theme={theme} />
            </View>
            <Text style={[styles.instructions, { color: theme.text }]}>
              {info?.instructions ?? 'No instructions for this exercise yet.'}
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function StripItem({ label, value, delta, theme }: {
  label: string; value: string; delta: string; theme: Theme;
}): ReactElement {
  const up = delta.startsWith('▲');
  const down = delta.startsWith('▼');
  const colour = up ? theme.success : down ? theme.danger : theme.textFaint;
  return (
    <View style={styles.stripItem}>
      <View style={styles.stripTop}>
        <View style={[styles.dot, { backgroundColor: colour }]} />
        <Text style={[T.label, { color: theme.textFaint }]}>{label.toUpperCase()}</Text>
      </View>
      <Text style={[styles.stripValue, tabular, { color: theme.text }]}>{value}</Text>
      <Text style={[styles.stripDelta, tabular, { color: colour }]}>{delta}</Text>
    </View>
  );
}

function Legend({ colour, label, theme }: { colour: string; label: string; theme: Theme }): ReactElement {
  return (
    <View style={styles.legendItem}>
      <View style={[styles.swatch, { backgroundColor: colour }]} />
      <Text style={{ color: theme.textMuted, fontSize: 12 }}>{label}</Text>
    </View>
  );
}

function Empty({ theme, text }: { theme: Theme; text: string }): ReactElement {
  return <Text style={[styles.note, { color: theme.textMuted, paddingVertical: space(8) }]}>{text}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'flex-start', paddingHorizontal: space(4), paddingTop: space(3) },
  title: { flex: 1, fontSize: 22, fontWeight: '700' },
  done: { minHeight: TAP_TARGET, justifyContent: 'center', paddingLeft: space(2) },
  meta: { fontSize: 13, paddingHorizontal: space(4), paddingBottom: space(3) },
  strip: { flexDirection: 'row', marginHorizontal: space(4), padding: space(3), borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth },
  stripItem: { flex: 1, alignItems: 'flex-start', gap: 1 },
  stripTop: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  stripValue: { fontSize: 20, fontWeight: '700', letterSpacing: -0.4 },
  stripDelta: { fontSize: 12, fontWeight: '700' },
  against: { fontSize: 11, textAlign: 'center', marginTop: space(1) },
  tabs: { flexDirection: 'row', marginHorizontal: space(4), marginTop: space(3), padding: 3, borderRadius: RADIUS_SM, gap: 2 },
  tab: { flex: 1, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: RADIUS_SM - 3 },
  body: { padding: space(4), gap: space(1) },
  gap: { gap: space(3) },
  row: { paddingVertical: space(2), borderBottomWidth: StyleSheet.hairlineWidth },
  rowDate: { fontSize: 15, fontWeight: '600' },
  rowMeta: { fontSize: 13, marginTop: 2 },
  metrics: { flexDirection: 'row', gap: space(2) },
  metricChip: { minHeight: 36, paddingHorizontal: space(3), borderRadius: RADIUS, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  note: { fontSize: 12, textAlign: 'center' },
  maps: { alignItems: 'center' },
  legend: { flexDirection: 'row', justifyContent: 'center', gap: space(4) },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: space(1) },
  swatch: { width: 12, height: 12, borderRadius: 3 },
  instructions: { fontSize: 15, lineHeight: 22 },
});
