/**
 * The display unit, as context rather than a prop.
 *
 * It was a prop, defaulting to `'kg'`, and that default silently won twice:
 * first in History and Home, which hardcoded 'kg' outright, and then in every
 * screen reached *through* them — SessionDetail was rendered without the prop,
 * fell back to kilograms, and handed that fallback down to ExerciseDetail. A
 * lifter set pounds in Settings and half the app ignored it.
 *
 * A default that is also a valid value cannot fail loudly. Context removes the
 * threading, so a screen cannot be rendered without one.
 */

import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { Unit } from '../domain/units';

const UnitContext = createContext<Unit>('kg');

export function UnitProvider({ unit, children }: { unit: Unit; children: ReactNode }): ReactElement {
  return <UnitContext.Provider value={unit}>{children}</UnitContext.Provider>;
}

export function useUnit(): Unit {
  return useContext(UnitContext);
}
