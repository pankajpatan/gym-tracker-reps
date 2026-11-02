/**
 * App settings, backed by the `setting` table.
 *
 * Only what is needed to display and load weight for now; the rest of UI.md §7
 * arrives with step 9. Values are read once on open and written through, so a
 * change is durable immediately rather than at some later flush.
 */

import { useCallback, useEffect, useState } from 'react';
import { getSetting, setSetting, type QueryableDatabase } from '../db/queries';
import { DEFAULT_PLATES } from '../domain/plates';
import { DEFAULT_REST_S } from '../domain/timer';
import type { Unit } from '../domain/units';

export type Appearance = 'system' | 'light' | 'dark';

export interface Settings {
  readonly unit: Unit;
  readonly barWeight: number;
  readonly restSeconds: number;
  readonly restAutoStart: boolean;
  readonly restSound: boolean;
  readonly appearance: Appearance;
}

export interface SettingsApi extends Settings {
  readonly loaded: boolean;
  setUnit(unit: Unit): Promise<void>;
  setBarWeight(weight: number): Promise<void>;
  setRestSeconds(seconds: number): Promise<void>;
  setRestAutoStart(on: boolean): Promise<void>;
  setRestSound(on: boolean): Promise<void>;
  setAppearance(appearance: Appearance): Promise<void>;
}

export function useSettings(db: QueryableDatabase | null): SettingsApi {
  const [unit, setUnitState] = useState<Unit>('kg');
  const [barWeight, setBarState] = useState<number>(DEFAULT_PLATES.kg.bar);
  const [restSeconds, setRestState] = useState<number>(DEFAULT_REST_S);
  const [restAutoStart, setAutoStartState] = useState(true);
  const [restSound, setSoundState] = useState(true);
  const [appearance, setAppearanceState] = useState<Appearance>('system');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (!db) return;
    void (async () => {
      const storedUnit = await getSetting(db, 'unit');
      const nextUnit: Unit = storedUnit === 'lb' ? 'lb' : 'kg';
      const storedBar = await getSetting(db, 'bar_weight');
      const storedRest = await getSetting(db, 'rest_seconds');
      const storedAuto = await getSetting(db, 'rest_auto_start');
      const storedSound = await getSetting(db, 'rest_sound');
      const storedAppearance = await getSetting(db, 'appearance');

      setUnitState(nextUnit);
      setBarState(storedBar === null ? DEFAULT_PLATES[nextUnit].bar : Number(storedBar));
      setRestState(storedRest === null ? DEFAULT_REST_S : Number(storedRest));
      // Absent means on: a rest timer that has to be switched on is a rest
      // timer nobody uses.
      setAutoStartState(storedAuto !== '0');
      setSoundState(storedSound !== '0');
      setAppearanceState(
        storedAppearance === 'light' || storedAppearance === 'dark' ? storedAppearance : 'system',
      );
      setLoaded(true);
    })();
  }, [db]);

  /**
   * Switching unit moves the default bar with it unless the lifter has set one.
   * A 20kg bar does not become a 20lb bar; it becomes the 45lb bar that is
   * standing in the same rack.
   */
  const setUnit = useCallback(async (next: Unit): Promise<void> => {
    setUnitState(next);
    if (!db) return;
    await setSetting(db, 'unit', next);
    const explicit = await getSetting(db, 'bar_weight_explicit');
    if (explicit !== '1') {
      setBarState(DEFAULT_PLATES[next].bar);
      await setSetting(db, 'bar_weight', String(DEFAULT_PLATES[next].bar));
    }
  }, [db]);

  const setBarWeight = useCallback(async (weight: number): Promise<void> => {
    setBarState(weight);
    if (!db) return;
    await setSetting(db, 'bar_weight', String(weight));
    await setSetting(db, 'bar_weight_explicit', '1');
  }, [db]);

  const setRestSeconds = useCallback(async (seconds: number): Promise<void> => {
    const safe = Math.max(0, Math.round(seconds));
    setRestState(safe);
    if (db) await setSetting(db, 'rest_seconds', String(safe));
  }, [db]);

  const setRestAutoStart = useCallback(async (on: boolean): Promise<void> => {
    setAutoStartState(on);
    if (db) await setSetting(db, 'rest_auto_start', on ? '1' : '0');
  }, [db]);

  const setRestSound = useCallback(async (on: boolean): Promise<void> => {
    setSoundState(on);
    if (db) await setSetting(db, 'rest_sound', on ? '1' : '0');
  }, [db]);

  const setAppearance = useCallback(async (next: Appearance): Promise<void> => {
    setAppearanceState(next);
    if (db) await setSetting(db, 'appearance', next);
  }, [db]);

  return {
    unit, barWeight, restSeconds, restAutoStart, restSound, appearance, loaded,
    setUnit, setBarWeight, setRestSeconds, setRestAutoStart, setRestSound, setAppearance,
  };
}
