/**
 * Theme tokens.
 *
 * **Dark is the product; light is the courtesy.** UI.md specifies dark first
 * and SHOTS.md calls for dark screenshots, and the lane agrees — Strong, Hevy
 * and Setgraph all present dark. A gym is dim, the phone is at arm's length,
 * and a white screen at 6am is hostile.
 *
 * The palette is built in layers rather than as flat colours: `bg` is the room,
 * `surface` is a card in it, `surface2` is a control on that card. Each step is
 * a real luminance step, so depth comes from the structure instead of from
 * borders drawn around everything.
 */

export interface Theme {
  readonly bg: string;
  readonly surface: string;
  readonly surface2: string;
  readonly surface3: string;
  readonly text: string;
  readonly textMuted: string;
  readonly textFaint: string;
  readonly accent: string;
  readonly accentSoft: string;
  readonly accentText: string;
  readonly success: string;
  readonly successSoft: string;
  readonly danger: string;
  readonly border: string;
  readonly borderStrong: string;
  readonly isDark: boolean;
}

export const dark: Theme = {
  bg: '#0A0B0D',
  surface: '#141619',
  surface2: '#1C1F24',
  surface3: '#262A31',
  text: '#F4F6F8',
  textMuted: '#9BA3AE',
  textFaint: '#5C646F',
  accent: '#2F6BFF',
  accentSoft: 'rgba(47,107,255,0.16)',
  accentText: '#FFFFFF',
  success: '#22C55E',
  successSoft: 'rgba(34,197,94,0.14)',
  danger: '#F05252',
  border: 'rgba(255,255,255,0.07)',
  borderStrong: 'rgba(255,255,255,0.14)',
  isDark: true,
};

export const light: Theme = {
  bg: '#FAFBFC',
  surface: '#FFFFFF',
  surface2: '#F1F3F6',
  surface3: '#E5E9EF',
  text: '#0C0E12',
  textMuted: '#646C78',
  textFaint: '#99A1AD',
  accent: '#1F5AF0',
  accentSoft: 'rgba(31,90,240,0.10)',
  accentText: '#FFFFFF',
  success: '#12A150',
  successSoft: 'rgba(18,161,80,0.12)',
  danger: '#D93A3A',
  border: 'rgba(12,14,18,0.08)',
  borderStrong: 'rgba(12,14,18,0.16)',
  isDark: false,
};

/** 4pt grid, and the 44pt minimum tap target (UI.md §0). */
export const space = (units: number): number => units * 4;
export const TAP_TARGET = 44;

/** One radius scale, so nothing is rounded by accident. */
export const RADIUS = 14;
export const RADIUS_SM = 10;
export const RADIUS_PILL = 999;

/**
 * Type scale. Sizes from UI.md §0, with weights fixed per role so a heading is
 * never a body line that happens to be bold.
 */
export const type = {
  display: { fontSize: 34, fontWeight: '700' as const, letterSpacing: -0.5 },
  title: { fontSize: 22, fontWeight: '700' as const, letterSpacing: -0.3 },
  heading: { fontSize: 17, fontWeight: '600' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  small: { fontSize: 13, fontWeight: '400' as const },
  label: { fontSize: 11, fontWeight: '700' as const, letterSpacing: 0.8 },
};

/**
 * Every numeral in the app is tabular. A column of weights that shifts by a
 * pixel per digit is the single most obvious way a logging screen looks broken.
 */
export const tabular = { fontVariant: ['tabular-nums' as const] };

/** A card lift that reads on both themes: shadow on light, border on dark. */
export function elevated(theme: Theme): object {
  return theme.isDark
    ? { borderWidth: StyleSheet_hairline, borderColor: theme.border }
    : {
      shadowColor: '#0C0E12',
      shadowOpacity: 0.06,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 2 },
    };
}

const StyleSheet_hairline = 0.5;
