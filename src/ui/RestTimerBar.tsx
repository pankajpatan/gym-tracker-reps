/**
 * The rest bar (UI.md §5.3): exercise name, countdown, −15 / +15 / Skip.
 *
 * It sits directly above the input dock and never covers it — nothing may block
 * logging (UI.md §0), and the most common thing a lifter does during rest is
 * fix the set they just entered.
 */

import type { ReactElement } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import { formatRemaining, type RestTimer } from '../domain/timer';
import { useEnter } from './motion';
import { RADIUS, space, TAP_TARGET, tabular, type Theme } from './theme';

interface Props {
  readonly timer: RestTimer | null;
  readonly secondsLeft: number;
  readonly theme: Theme;
  readonly onAdjust: (deltaS: number) => void;
  readonly onSkip: () => void;
}

export function RestTimerBar({ timer, secondsLeft, theme, onAdjust, onSkip }: Props): ReactElement | null {
  // Hooks run unconditionally; the early return happens after.
  const enter = useEnter();
  if (!timer) return null;
  const done = secondsLeft === 0;

  /**
   * The bar appears between a set and the next one, so it rises rather than
   * pops — a control that materialises under the thumb mid-reach is how a
   * wrong button gets pressed.
   */
  const style = {
    opacity: enter,
    transform: [{ translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
  };

  return (
    <Animated.View
      accessibilityLiveRegion="polite"
      accessibilityLabel={
        done ? 'Rest over' : `Resting, ${formatRemaining(secondsLeft)} left, ${timer.exerciseName}`
      }
      style={[
        styles.bar,
        style,
        { backgroundColor: done ? theme.successSoft : theme.surface2, borderColor: done ? theme.success : theme.border },
      ]}
    >
      <View style={styles.left}>
        <Text style={[styles.count, tabular, { color: done ? theme.success : theme.text }]}>
          {done ? 'Rest over' : formatRemaining(secondsLeft)}
        </Text>
        <Text style={[styles.name, { color: theme.textMuted }]} numberOfLines={1}>
          {timer.exerciseName} · set {timer.setNumber + 1}
        </Text>
      </View>

      <Pressable accessibilityLabel="fifteen seconds less" onPress={() => onAdjust(-15)} style={styles.action}>
        <Text style={[styles.actionLabel, { color: theme.text }]}>−15</Text>
      </Pressable>
      <Pressable accessibilityLabel="fifteen seconds more" onPress={() => onAdjust(15)} style={styles.action}>
        <Text style={[styles.actionLabel, { color: theme.text }]}>+15</Text>
      </Pressable>
      <Pressable accessibilityLabel="skip rest" onPress={onSkip} style={styles.action}>
        <Text style={[styles.actionLabel, { color: theme.accent }]}>Skip</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row', alignItems: 'center', gap: space(1),
    paddingHorizontal: space(3), paddingVertical: space(2),
    borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth,
  },
  left: { flex: 1 },
  count: { fontSize: 22, fontWeight: '700' },
  name: { fontSize: 12 },
  action: { minWidth: 48, minHeight: TAP_TARGET, borderRadius: RADIUS, alignItems: 'center', justifyContent: 'center' },
  actionLabel: { fontSize: 15, fontWeight: '600' },
});
