/**
 * Motion primitives (UI.md §0).
 *
 * The brief is deliberately narrow: "Set completion: row fills green over
 * 120ms, no bounce. No custom transitions anywhere — this app is used mid-set."
 * Motion here is feedback, not decoration. A lifter waiting on an animation
 * between sets is a lifter who stops logging.
 *
 * Everything is driven by `Animated` from React Native — no native dependency,
 * so none of this costs a rebuild.
 */

import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing } from 'react-native';

/** UI.md §10: Reduce Motion removes the green fill animation. */
export function useReduceMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    let live = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((value) => {
      if (live) setReduced(value);
    });
    const subscription = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduced);
    return () => { live = false; subscription.remove(); };
  }, []);

  return reduced;
}

export const DURATION = { fill: 120, enter: 180, exit: 140 } as const;

/**
 * A 0→1 value that follows a boolean.
 *
 * Returns `Animated.Value` rather than a number so interpolation happens on the
 * animation thread where it can; with Reduce Motion on it jumps instead of
 * easing, which is the accessible behaviour rather than a slower one.
 */
export function useToggleValue(on: boolean, duration = DURATION.fill): Animated.Value {
  const reduced = useReduceMotion();
  const value = useRef(new Animated.Value(on ? 1 : 0)).current;

  useEffect(() => {
    if (reduced) {
      value.setValue(on ? 1 : 0);
      return;
    }
    Animated.timing(value, {
      toValue: on ? 1 : 0,
      duration,
      // Linear-out, no overshoot: UI.md says no bounce, and a spring on a set
      // row reads as celebration when the lifter wants acknowledgement.
      easing: Easing.out(Easing.quad),
      useNativeDriver: false, // colour interpolation is not native-driver safe
    }).start();
  }, [on, reduced, duration, value]);

  return value;
}

/** A one-shot entrance: fade with a small rise, or nothing under Reduce Motion. */
export function useEnter(duration = DURATION.enter): Animated.Value {
  const reduced = useReduceMotion();
  const value = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduced) {
      value.setValue(1);
      return;
    }
    Animated.timing(value, {
      toValue: 1,
      duration,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [reduced, duration, value]);

  return value;
}
