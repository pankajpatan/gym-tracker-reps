/**
 * App entry. Opens the database, then renders the active session screen.
 *
 * Step 2 wires one screen end to end; the tab bar (UI.md §1) arrives with
 * History, Exercises and Settings. The clock ticks here rather than inside the
 * screen so the header's duration updates without the screen owning a timer.
 */

import { useEffect, useRef, useState, type ReactElement } from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { Pressable, StyleSheet, Text, useColorScheme, View } from 'react-native';
import { openDatabase } from './src/db';
import type { QueryableDatabase } from './src/db/queries';
import { nowSeconds } from './src/db/queries';
import { ActiveSessionScreen } from './src/ui/ActiveSessionScreen';
import { HistoryScreen } from './src/ui/HistoryScreen';
import { SettingsScreen } from './src/ui/SettingsScreen';
import { WorkoutHome } from './src/ui/WorkoutHome';
import { dark, light, space, TAP_TARGET } from './src/ui/theme';
import { UnitProvider } from './src/ui/UnitContext';
import { useActiveSession } from './src/ui/useActiveSession';
import { useRestTimer } from './src/ui/useRestTimer';
import { useHealth } from './src/ui/useHealth';
import { useRating } from './src/ui/useRating';
import { useSettings } from './src/ui/useSettings';

export default function App(): ReactElement {
  const [db, setDb] = useState<QueryableDatabase | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [now, setNow] = useState(nowSeconds());

  useEffect(() => {
    openDatabase().then(setDb).catch((error: unknown) => {
      setFailure(error instanceof Error ? error.message : String(error));
    });
  }, []);

  useEffect(() => {
    const tick = setInterval(() => setNow(nowSeconds()), 1000);
    return () => clearInterval(tick);
  }, []);

  const session = useActiveSession(db, now);
  const settings = useSettings(db);
  const rest = useRestTimer(db, now, { sound: settings.restSound });
  const health = useHealth(db);
  const rating = useRating(db);

  /**
   * A finished workout goes to Apple Health **once**.
   *
   * The ref is the guard that matters: an effect that writes and then causes a
   * re-render will run again, and this one wrote to a health record every time.
   * Keying on the session's own timestamps means a given workout can be written
   * exactly once per launch no matter how often the effect fires.
   *
   * A failure is still ignored here — the session is in SQLite, which is the
   * record that matters, and Settings shows the reason.
   */
  const writtenToHealth = useRef<string | null>(null);
  useEffect(() => {
    const finished = session.lastFinished;
    if (!finished) return;
    const key = `${finished.startedAt}-${finished.endedAt}`;
    if (writtenToHealth.current === key) return;
    writtenToHealth.current = key;
    /**
     * And the one moment a rating is worth asking for: a session saved, ideally
     * one that set a record. The rules live in domain/rating.ts; this only
     * supplies the context. Guarded by the same ref, so it is asked once.
     *
     * Waits for this session's Health write: `health.lastError` here would be
     * the previous render's value, from before the write finished.
     */
    void (async () => {
      const outcome = await health.saveWorkout(finished);
      await rating.considerAsking({
        hadPersonalRecord: finished.hadPersonalRecord,
        recentFailure: outcome === 'failed',
      });
    })();
  }, [session.lastFinished, health, rating]);
  /**
   * Appearance follows the system unless the lifter has chosen otherwise
   * (UI.md §7). Dark is the product, but a gym at 6am and a living room at 9pm
   * are different rooms and the choice belongs to whoever is holding the phone.
   */
  const scheme = useColorScheme();
  const resolved = settings.appearance === 'system'
    ? (scheme === 'light' ? 'light' : 'dark')
    : settings.appearance;
  const theme = resolved === 'light' ? light : dark;

  /**
   * Two of the four tabs UI.md §1 specifies. Exercises and Settings arrive with
   * their own steps; a tab bar with placeholder destinations would be worse
   * than one that grows.
   *
   * The logging screen is deliberately outside the tab bar — it is a mode, not
   * a destination, and nothing may sit over the input dock (UI.md §0).
   */
  const [tab, setTab] = useState<'workout' | 'history' | 'settings'>('workout');
  const [viewing, setViewing] = useState<'home' | 'session'>('home');

  // Finishing or discarding a session drops back to home on its own.
  useEffect(() => {
    if (session.sessionId === null) setViewing('home');
  }, [session.sessionId]);

  if (failure) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 }}>
        <Text>The workout database could not be opened.</Text>
        <Text>{failure}</Text>
      </View>
    );
  }

  return (
    <SafeAreaProvider>
      <UnitProvider unit={settings.unit}>
      <StatusBar style={resolved === 'light' ? 'dark' : 'light'} />
      {viewing === 'session' && session.sessionId !== null ? (
        <ActiveSessionScreen
          session={session}
          db={db}
          rest={rest}
          restSeconds={settings.restAutoStart ? settings.restSeconds : 0}
          onLeave={() => setViewing('home')}
        />
      ) : (
        <View style={{ flex: 1, backgroundColor: theme.bg }}>
          {tab === 'workout' && (
            <WorkoutHome
              db={db}
              session={session}
              theme={theme}
              health={health}
              onOpenSession={() => setViewing('session')}
            />
          )}
          {tab === 'history' && <HistoryScreen db={db} theme={theme} />}
          {tab === 'settings' && (
            <SettingsScreen
              settings={settings}
              theme={theme}
              db={db}
              health={health}
              onDataChanged={() => setTab('history')}
            />
          )}

          <View style={[styles.tabBar, { backgroundColor: theme.surface, borderTopColor: theme.border }]}>
            {(['workout', 'history', 'settings'] as const).map((name) => (
              <Pressable
                key={name}
                accessibilityRole="button"
                accessibilityState={{ selected: tab === name }}
                onPress={() => setTab(name)}
                style={styles.tabItem}
              >
                <View style={[
                  styles.tabPill,
                  tab === name && { backgroundColor: theme.accentSoft },
                ]}>
                  <Text style={{
                    color: tab === name ? theme.accent : theme.textMuted,
                    fontSize: 13,
                    fontWeight: tab === name ? '700' : '500',
                  }}>
                    {name === 'workout' ? 'Workout' : name === 'history' ? 'History' : 'Settings'}
                  </Text>
                </View>
              </Pressable>
            ))}
          </View>
        </View>
      )}
      </UnitProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    paddingBottom: space(5),
    paddingTop: space(1),
  },
  tabItem: { flex: 1, minHeight: TAP_TARGET, alignItems: 'center', justifyContent: 'center' },
  tabPill: { paddingHorizontal: space(4), paddingVertical: space(2), borderRadius: 999 },
});
