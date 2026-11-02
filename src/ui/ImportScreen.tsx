/**
 * Import (UI.md §8, IMPORT.md) — the wedge.
 *
 * Four states: pick → preview → resolve → done. The preview exists because
 * **nothing is written until the lifter agrees**: they are handing over years
 * of training and deserve to see what will happen to it before it happens.
 *
 * Unlimited, always. Hevy allows one import ever and drops routines; both of
 * those are the reason someone switches, so neither limit appears here.
 */

import { useState, type ReactElement } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { planImport, undoImport, writeImport, type ImportPlan, type ImportResult } from '../db/import';
import type { QueryableDatabase } from '../db/queries';
import { parseImport } from '../domain/import/detect';
import { inferRoutines } from '../domain/import/routines';
import type { ImportSource } from '../domain/import/types';
import { cryptoModule, documentPicker, fileSystem } from './nativeOptional';
import { RADIUS, RADIUS_PILL, RADIUS_SM, space, TAP_TARGET, tabular, type as T, type Theme } from './theme';

type Stage = 'pick' | 'working' | 'preview' | 'done' | 'error';

const SOURCE_LABEL: Record<ImportSource, string> = {
  strong: 'Strong', hevy: 'Hevy', alpha: 'Alpha Progression', unknown: 'Unknown app',
};

interface Props {
  readonly db: QueryableDatabase | null;
  readonly theme: Theme;
  readonly onClose: () => void;
  readonly onImported: () => void;
}

export function ImportScreen({ db, theme, onClose, onImported }: Props): ReactElement {
  const [stage, setStage] = useState<Stage>('pick');
  const [plan, setPlan] = useState<ImportPlan | null>(null);
  const [fileHash, setFileHash] = useState<string>('');
  const [fileName, setFileName] = useState<string>('');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string>('');
  const [skipRoutines, setSkipRoutines] = useState(false);

  const pick = async (): Promise<void> => {
    const picker = documentPicker();
    const fs = fileSystem();
    const crypto = cryptoModule();
    if (!db || !picker || !fs || !crypto) {
      setError('Import needs the latest version of the app.');
      setStage('error');
      return;
    }

    try {
      const picked = await picker.getDocumentAsync({
        // Exports arrive as .csv, .tsv or plain text depending on the app and
        // the share route, and iOS types them inconsistently — so the filter is
        // wide and the *content* decides what this is.
        type: ['text/csv', 'text/comma-separated-values', 'text/tab-separated-values', 'text/plain', 'public.comma-separated-values-text', '*/*'],
        copyToCacheDirectory: true,
      });
      if (picked.canceled || !picked.assets?.[0]) return;

      setStage('working');
      const asset = picked.assets[0];
      setFileName(asset.name);

      const text = await fs.readText(asset.uri);
      const parsed = parseImport(text);

      if (parsed.source === 'unknown') {
        setError('That file is not a Strong, Hevy or Alpha Progression export. Nothing was changed.');
        setStage('error');
        return;
      }

      const routines = parsed.routines.length > 0
        ? parsed.routines
        : inferRoutines(parsed.sessions);

      setFileHash(await crypto.digestStringAsync(crypto.CryptoDigestAlgorithm.SHA256, text));
      setPlan(await planImport(db, parsed, routines));
      setStage('preview');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'That file could not be read.');
      setStage('error');
    }
  };

  const confirm = async (): Promise<void> => {
    if (!db || !plan) return;
    setStage('working');
    try {
      // `undefined` means "all of them"; an empty array means "none", so the
      // option is passed only when the lifter opted out.
      const written = await writeImport(db, plan, fileHash, skipRoutines ? { selectedRoutines: [] } : {});
      setResult(written);
      setStage('done');
      onImported();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The import could not be written.');
      setStage('error');
    }
  };

  const undo = async (): Promise<void> => {
    if (!db || !result) return;
    await undoImport(db, result.batchId);
    onImported();
    onClose();
  };

  return (
    <SafeAreaView style={[styles.screen, { backgroundColor: theme.bg }]}>
      <View style={styles.top}>
        <Text style={[styles.title, { color: theme.text }]}>Import</Text>
        <Pressable accessibilityRole="button" onPress={onClose} style={styles.done}>
          <Text style={{ color: theme.accent, fontSize: 17, fontWeight: '700' }}>
            {stage === 'done' ? 'Done' : 'Cancel'}
          </Text>
        </Pressable>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        {stage === 'pick' && (
          <>
            <Text style={[T.body, { color: theme.textMuted, lineHeight: 21 }]}>
              Bring your history over from Strong, Hevy or Alpha Progression.
              Export a CSV from that app, then pick it here.
            </Text>
            <Text style={[T.small, { color: theme.textFaint, lineHeight: 19 }]}>
              Your routines come across too, which those apps do not do. You can
              import as many times as you like, and undo afterwards.
            </Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => void pick()}
              style={[styles.primary, { backgroundColor: theme.accent }]}
            >
              <Text style={styles.primaryLabel}>Choose a file</Text>
            </Pressable>
          </>
        )}

        {stage === 'working' && (
          <View style={styles.centre}>
            <ActivityIndicator color={theme.accent} />
            <Text style={[T.small, { color: theme.textMuted }]}>Reading {fileName || 'the file'}…</Text>
          </View>
        )}

        {stage === 'preview' && plan && (
          <>
            <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
              <Text style={[T.label, { color: theme.textFaint }]}>FOUND IN {fileName.toUpperCase()}</Text>
              <Text style={[styles.sourceName, { color: theme.text }]}>
                {SOURCE_LABEL[plan.file.source]} export
              </Text>
              <View style={styles.counts}>
                <Count value={plan.sessionCount} label="WORKOUTS" theme={theme} />
                <Count value={plan.setCount} label="SETS" theme={theme} />
                <Count value={plan.routines.length} label="ROUTINES" theme={theme} />
              </View>
            </View>

            {plan.routines.length > 0 && (
              <Pressable
                accessibilityRole="checkbox"
                accessibilityState={{ checked: !skipRoutines }}
                onPress={() => setSkipRoutines((value) => !value)}
                style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}
              >
                <Text style={[T.heading, { color: theme.text }]}>
                  {skipRoutines ? 'Skip routines' : `Bring ${plan.routines.length} routines across`}
                </Text>
                <Text style={[T.small, { color: theme.textFaint }]}>
                  {plan.file.routines.length > 0
                    ? 'Taken straight from the export.'
                    : 'Worked out from workouts you repeated. Tap to change.'}
                </Text>
                <Text style={[T.small, { color: theme.textMuted }]} numberOfLines={2}>
                  {plan.routines.map((r) => r.name).join(' · ')}
                </Text>
              </Pressable>
            )}

            {plan.unmatched.length > 0 && (
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[T.heading, { color: theme.text }]}>
                  {plan.unmatched.length} exercises we do not know
                </Text>
                <Text style={[T.small, { color: theme.textFaint }]}>
                  They will be added as your own exercises, so nothing is lost.
                </Text>
                <Text style={[T.small, { color: theme.textMuted }]} numberOfLines={3}>
                  {plan.unmatched.slice(0, 8).join(' · ')}
                  {plan.unmatched.length > 8 ? ` · +${plan.unmatched.length - 8} more` : ''}
                </Text>
              </View>
            )}

            {plan.file.skipped.length > 0 && (
              <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.border }]}>
                <Text style={[T.heading, { color: theme.danger }]}>
                  {plan.file.skipped.length} rows could not be read
                </Text>
                <Text style={[T.small, { color: theme.textFaint }]}>
                  {plan.file.skipped.slice(0, 3).map((s) => `Line ${s.line}: ${s.reason}`).join('\n')}
                </Text>
              </View>
            )}

            <Pressable
              accessibilityRole="button"
              onPress={() => void confirm()}
              style={[styles.primary, { backgroundColor: theme.accent }]}
            >
              <Text style={styles.primaryLabel}>
                Import {plan.sessionCount} workouts
              </Text>
            </Pressable>
            <Text style={[T.small, { color: theme.textFaint, textAlign: 'center' }]}>
              Nothing has been changed yet.
            </Text>
          </>
        )}

        {stage === 'done' && result && (
          <>
            <View style={[styles.card, { backgroundColor: theme.successSoft, borderColor: theme.success }]}>
              <Text style={[styles.sourceName, { color: theme.text }]}>
                {result.duplicate ? 'Already imported' : 'History imported'}
              </Text>
              {result.duplicate ? (
                <Text style={[T.small, { color: theme.textMuted }]}>
                  This exact file was imported before, so nothing changed.
                </Text>
              ) : (
                <View style={styles.counts}>
                  <Count value={result.sessions} label="WORKOUTS" theme={theme} />
                  <Count value={result.sets} label="SETS" theme={theme} />
                  <Count value={result.routines} label="ROUTINES" theme={theme} />
                </View>
              )}
              {result.overlapping > 0 && (
                <Text style={[T.small, { color: theme.textMuted }]}>
                  {result.overlapping} workouts were already here and were left alone.
                </Text>
              )}
            </View>

            {!result.duplicate && (
              <Pressable
                accessibilityRole="button"
                onPress={() => void undo()}
                style={[styles.secondary, { borderColor: theme.borderStrong }]}
              >
                <Text style={[T.heading, { color: theme.danger }]}>Undo this import</Text>
              </Pressable>
            )}
          </>
        )}

        {stage === 'error' && (
          <View style={[styles.card, { backgroundColor: theme.surface, borderColor: theme.danger }]}>
            <Text style={[T.heading, { color: theme.danger }]}>Could not import</Text>
            <Text style={[T.small, { color: theme.textMuted }]}>{error}</Text>
            <Pressable
              accessibilityRole="button"
              onPress={() => { setStage('pick'); setError(''); }}
              style={[styles.secondary, { borderColor: theme.borderStrong }]}
            >
              <Text style={[T.heading, { color: theme.accent }]}>Try another file</Text>
            </Pressable>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

function Count({ value, label, theme }: { value: number; label: string; theme: Theme }): ReactElement {
  return (
    <View style={{ flex: 1 }}>
      <Text style={[styles.countValue, tabular, { color: theme.text }]}>{value.toLocaleString()}</Text>
      <Text style={[T.label, { color: theme.textFaint }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: space(4), paddingTop: space(2) },
  title: { fontSize: 28, fontWeight: '700', letterSpacing: -0.5 },
  done: { minHeight: TAP_TARGET, justifyContent: 'center' },
  body: { padding: space(4), gap: space(3) },
  centre: { alignItems: 'center', gap: space(3), paddingVertical: space(10) },
  card: { borderRadius: RADIUS, borderWidth: StyleSheet.hairlineWidth, padding: space(4), gap: space(2) },
  sourceName: { fontSize: 20, fontWeight: '700', letterSpacing: -0.3 },
  counts: { flexDirection: 'row', marginTop: space(1) },
  countValue: { fontSize: 24, fontWeight: '700', letterSpacing: -0.5 },
  primary: { height: 54, borderRadius: RADIUS, alignItems: 'center', justifyContent: 'center' },
  primaryLabel: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
  secondary: { height: 48, borderRadius: RADIUS_PILL, borderWidth: StyleSheet.hairlineWidth, alignItems: 'center', justifyContent: 'center', marginTop: space(2) },
});
