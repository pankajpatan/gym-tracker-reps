/**
 * Settings (UI.md §7) — the units section, brought forward from step 9.
 *
 * It arrives early because without it there is no way to choose pounds, and an
 * app that silently assumes kilograms is unusable for most of its market. The
 * remaining sections (timer, appearance, Health, data, about) land with
 * their own steps rather than as empty rows here.
 */

import type { ReactElement } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import type { QueryableDatabase } from '../db/queries';
import { undoImport, undoableImport, type ImportBatchSummary } from '../db/import';
import { allSetsForExport } from '../db/queries';
import { exportFilename, toCsv } from '../domain/export';
import { DEFAULT_PLATES } from '../domain/plates';
import { formatRemaining } from '../domain/timer';
import { fileWriter, sharing } from './nativeOptional';
import { ImportScreen } from './ImportScreen';
import type { Unit } from '../domain/units';
import { RADIUS, RADIUS_SM, space, TAP_TARGET, tabular, type Theme } from './theme';
import type { HealthApi } from './useHealth';
import type { Appearance, SettingsApi } from './useSettings';

interface Props {
  readonly settings: SettingsApi;
  readonly theme: Theme;
  readonly db: QueryableDatabase | null;
  readonly health: HealthApi;
  readonly onDataChanged?: () => void;
}

export function SettingsScreen({ settings, theme, db, health, onDataChanged }: Props): ReactElement {
  const { unit, barWeight } = settings;
  const [importing, setImporting] = useState(false);
  const [lastImport, setLastImport] = useState<ImportBatchSummary | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [exporting, setExporting] = useState<string | null>(null);
  const [healthCleared, setHealthCleared] = useState<string | null>(null);
  const healthOn = health.enabled;

  const refreshUndo = useCallback(async () => {
    if (!db) return;
    setLastImport(await undoableImport(db));
  }, [db]);

  useEffect(() => { void refreshUndo(); }, [refreshUndo, importing]);
  const barStep = unit === 'kg' ? 2.5 : 5;

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <ScrollView contentContainerStyle={styles.body}>
        <Text style={[styles.title, { color: theme.text }]}>Settings</Text>

        <Text style={[styles.section, { color: theme.textMuted }]}>UNITS</Text>
        <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.row}>
          {(['kg', 'lb'] as Unit[]).map((option) => (
            <Pressable
              key={option}
              accessibilityRole="button"
              accessibilityState={{ selected: unit === option }}
              onPress={() => void settings.setUnit(option)}
              style={[
                styles.option,
                {
                  backgroundColor: unit === option ? theme.accent : theme.surface,
                  borderColor: unit === option ? theme.accent : theme.border,
                },
              ]}
            >
              <Text style={{ color: unit === option ? '#FFFFFF' : theme.text, fontSize: 17, fontWeight: '600' }}>
                {option}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={[styles.help, { color: theme.textFaint }]}>
          Every workout is stored in kilograms and converted for display, so
          switching never changes what you have already lifted.
        </Text>
        </View>

        {/*
          * Second, not near the bottom. App Review rejected 1.0 under 2.5.1
          * because HealthKit use was not identified where a reviewer looks;
          * it is named here and on Home after a workout (domain/health.ts).
          */}
        {health.available && (
          <>
            <Text style={[styles.section, { color: theme.textMuted }]}>APPLE HEALTH</Text>
            <Pressable
              accessibilityRole="switch"
              accessibilityState={{ checked: healthOn }}
              onPress={async () => {
                if (healthOn) { await health.disable(); return; }
                await health.enable();
              }}
              style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}
            >
              <View style={styles.switchRow}>
                <Text style={[styles.rowTitle, { color: theme.text }]}>Save workouts to Apple Health</Text>
                <View style={[
                  styles.switch,
                  { backgroundColor: healthOn ? theme.accent : theme.surface3 },
                ]}>
                  <View style={[styles.knob, { alignSelf: healthOn ? 'flex-end' : 'flex-start' }]} />
                </View>
              </View>
              <Text style={[styles.help, { color: theme.textFaint }]}>
                Gym Tracker works with Apple Health. Finished workouts are
                written to the Health app as strength training, with their
                duration, volume and set count. Nothing is ever read: this app
                does not look at your health data.
              </Text>
              <Text style={[styles.help, { color: theme.textFaint }]}>
                Apple Health shows a dash where calories would be, and that is
                deliberate. Estimating energy burned from lifting needs your
                bodyweight and a formula that is a guess either way, and we are
                not asking to read your health data to produce a number we
                would be making up. Your sets, weights and volume are here.
              </Text>
              {healthOn && (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="remove workouts this app wrote from Health"
                  onPress={async () => {
                    const removed = await health.removeOurWorkouts();
                    setHealthCleared(`Removed ${removed} workout${removed === 1 ? '' : 's'} from Apple Health.`);
                  }}
                >
                  <Text style={[styles.help, { color: theme.accent, fontWeight: '600' }]}>
                    Remove the workouts this app wrote from Apple Health
                  </Text>
                </Pressable>
              )}
              {healthCleared && (
                <Text style={[styles.help, { color: theme.textMuted }]}>{healthCleared}</Text>
              )}
              {health.lastError && (
                <Text style={[styles.help, { color: theme.danger }]}>
                  Last write failed: {health.lastError}
                </Text>
              )}
            </Pressable>
          </>
        )}

        <Text style={[styles.section, { color: theme.textMuted }]}>BAR WEIGHT</Text>
        <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>
        <View style={styles.row}>
          <Pressable
            accessibilityLabel="lighter bar"
            onPress={() => void settings.setBarWeight(Math.max(0, barWeight - barStep))}
            style={[styles.stepper, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.text, fontSize: 22 }}>−</Text>
          </Pressable>
          <Text style={[styles.barValue, tabular, { color: theme.text }]}>
            {barWeight} {unit}
          </Text>
          <Pressable
            accessibilityLabel="heavier bar"
            onPress={() => void settings.setBarWeight(barWeight + barStep)}
            style={[styles.stepper, { borderColor: theme.border }]}
          >
            <Text style={{ color: theme.text, fontSize: 22 }}>+</Text>
          </Pressable>
        </View>
        <Text style={[styles.help, { color: theme.textFaint }]}>
          Used by the plate calculator. Standard is {DEFAULT_PLATES[unit].bar} {unit}.
        </Text>
        </View>

        <Text style={[styles.section, { color: theme.textMuted }]}>REST TIMER</Text>
        <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.row}>
            <Pressable
              accessibilityLabel="shorter rest"
              onPress={() => void settings.setRestSeconds(settings.restSeconds - 15)}
              style={[styles.stepper, { borderColor: theme.border }]}
            >
              <Text style={{ color: theme.text, fontSize: 22 }}>−</Text>
            </Pressable>
            <Text style={[styles.barValue, tabular, { color: theme.text }]}>
              {settings.restSeconds === 0 ? 'Off' : formatRemaining(settings.restSeconds)}
            </Text>
            <Pressable
              accessibilityLabel="longer rest"
              onPress={() => void settings.setRestSeconds(settings.restSeconds + 15)}
              style={[styles.stepper, { borderColor: theme.border }]}
            >
              <Text style={{ color: theme.text, fontSize: 22 }}>+</Text>
            </Pressable>
          </View>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: settings.restAutoStart }}
            onPress={() => void settings.setRestAutoStart(!settings.restAutoStart)}
            style={styles.switchRow}
          >
            <Text style={[styles.rowTitle, { color: theme.text }]}>Start after every set</Text>
            <View style={[
              styles.switch,
              { backgroundColor: settings.restAutoStart ? theme.accent : theme.surface3 },
            ]}>
              <View style={[
                styles.knob,
                { alignSelf: settings.restAutoStart ? 'flex-end' : 'flex-start' },
              ]} />
            </View>
          </Pressable>
          <Pressable
            accessibilityRole="switch"
            accessibilityState={{ checked: settings.restSound }}
            onPress={() => void settings.setRestSound(!settings.restSound)}
            style={styles.switchRow}
          >
            <Text style={[styles.rowTitle, { color: theme.text }]}>Sound when rest ends</Text>
            <View style={[
              styles.switch,
              { backgroundColor: settings.restSound ? theme.accent : theme.surface3 },
            ]}>
              <View style={[
                styles.knob,
                { alignSelf: settings.restSound ? 'flex-end' : 'flex-start' },
              ]} />
            </View>
          </Pressable>
          <Text style={[styles.help, { color: theme.textFaint }]}>
            {settings.restSeconds === 0
              ? 'No timer will start. Set a length above to turn it back on.'
              : 'Counts down on the Lock Screen and in the Dynamic Island. '
                + 'The sound plays whether the app is open or in your pocket, '
                + 'and follows your ring switch.'}
          </Text>
        </View>

        <Text style={[styles.section, { color: theme.textMuted }]}>APPEARANCE</Text>
        <View style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}>
          <View style={styles.row}>
            {(['system', 'light', 'dark'] as Appearance[]).map((option) => (
              <Pressable
                key={option}
                accessibilityRole="button"
                accessibilityState={{ selected: settings.appearance === option }}
                onPress={() => void settings.setAppearance(option)}
                style={[
                  styles.option,
                  {
                    backgroundColor: settings.appearance === option ? theme.accent : theme.surface2,
                    borderColor: settings.appearance === option ? theme.accent : theme.border,
                  },
                ]}
              >
                <Text style={{
                  color: settings.appearance === option ? '#FFFFFF' : theme.text,
                  fontSize: 15,
                  fontWeight: '600',
                }}>
                  {option[0]?.toUpperCase()}{option.slice(1)}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>

        <Text style={[styles.section, { color: theme.textMuted }]}>DATA</Text>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="import from another app"
          onPress={() => setImporting(true)}
          style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Text style={[styles.rowTitle, { color: theme.text }]}>Import from another app</Text>
          <Text style={[styles.help, { color: theme.textFaint }]}>
            Bring your history and routines across from Strong, Hevy or Alpha
            Progression. As many times as you like.
          </Text>
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="export your workouts as a CSV file"
          disabled={exporting !== null}
          onPress={async () => {
            if (!db) return;
            const writer = fileWriter();
            const share = sharing();
            if (!writer || !share) { setExporting('Export needs the latest version.'); return; }
            setExporting('Preparing…');
            try {
              const rows = await allSetsForExport(db);
              const directory = writer.cacheDirectory();
              if (directory === null) { setExporting('No place to write the file.'); return; }
              const uri = `${directory.replace(/\/$/, '')}/${exportFilename()}`;
              await writer.writeText(uri, toCsv(rows));
              if (await share.isAvailableAsync()) {
                await share.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: 'Export workouts' });
              }
              setExporting(null);
            } catch (caught) {
              setExporting(caught instanceof Error ? caught.message : 'Export failed.');
            }
          }}
          style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}
        >
          <Text style={[styles.rowTitle, { color: theme.text }]}>
            {exporting ?? 'Export your workouts'}
          </Text>
          <Text style={[styles.help, { color: theme.textFaint }]}>
            A CSV other apps can read — the same format Strong exports, so Hevy
            and this app both accept it. Your data is yours to take.
          </Text>
        </Pressable>

        {lastImport && (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="undo the last import"
            disabled={undoing}
            onPress={async () => {
              if (!db) return;
              setUndoing(true);
              await undoImport(db, lastImport.id);
              await refreshUndo();
              setUndoing(false);
              onDataChanged?.();
            }}
            style={[styles.group, { backgroundColor: theme.surface, borderColor: theme.border }]}
          >
            <Text style={[styles.rowTitle, { color: theme.danger }]}>
              {undoing ? 'Undoing…' : 'Undo last import'}
            </Text>
            <Text style={[styles.help, { color: theme.textFaint }]}>
              {lastImport.sessions} workouts and {lastImport.sets.toLocaleString()} sets
              imported from {lastImport.source} on{' '}
              {new Date(lastImport.imported_at * 1000).toLocaleDateString()}.
              Removing them leaves everything you logged yourself untouched.
            </Text>
          </Pressable>
        )}

        <Modal visible={importing} animationType="slide" presentationStyle="pageSheet">
          <ImportScreen
            db={db}
            theme={theme}
            onClose={() => setImporting(false)}
            onImported={() => onDataChanged?.()}
          />
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  body: { padding: space(4), gap: space(2) },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5, marginBottom: space(2) },
  section: { fontSize: 11, fontWeight: '700', letterSpacing: 0.8, marginTop: space(4) },
  row: { flexDirection: 'row', alignItems: 'center', gap: space(3) },
  group: { borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth, padding: space(3), gap: space(3) },
  option: { flex: 1, height: 42, borderRadius: RADIUS_SM, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  stepper: { width: TAP_TARGET, height: TAP_TARGET, borderRadius: RADIUS, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  barValue: { fontSize: 22, fontWeight: '700', minWidth: 96, textAlign: 'center' },
  help: { fontSize: 12, lineHeight: 17 },
  rowTitle: { fontSize: 17, fontWeight: '600' },
  switchRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  switch: { width: 48, height: 30, borderRadius: 999, padding: 3, justifyContent: 'center' },
  knob: { width: 24, height: 24, borderRadius: 999, backgroundColor: '#FFFFFF' },
});
