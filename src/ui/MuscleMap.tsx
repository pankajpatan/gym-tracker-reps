/**
 * Muscle maps (CONTENT-LIBRARY.md option F).
 *
 * The art is one silhouette per side with the worked muscles lit. It is
 * **accurate by construction**: the highlight is driven by the dataset's own
 * muscle fields, so unlike a generated movement drawing it cannot show a wrong
 * bar path or a backwards grip. That is the whole reason this shape was chosen.
 *
 * Two sizes, one asset: the detail view draws the whole body, the row chip
 * crops to the muscle's own bounding box so at 30px it reads as "chest" rather
 * than "somewhere on the torso".
 */

import type { ReactElement } from 'react';
import Svg, { Path } from 'react-native-svg';
import bodyPaths from '../../assets/body-paths.json';
import muscleCrops from '../../assets/muscle-crops.json';
import { MUSCLE_LABEL, MUSCLE_SIDE, type MuscleSlug } from '../domain/muscles';
import type { Theme } from './theme';

type Side = 'front' | 'back';

const BODY = bodyPaths as Record<Side, { muscles: Record<string, string[]>; outline: string[] }>;
const CROPS = muscleCrops as Record<string, number[]>;

/** The artwork's own coordinate space; the back body sits to the right of the front. */
const FULL_VIEWBOX: Record<Side, string> = {
  front: '0 0 724 1448',
  back: '724 0 724 1448',
};

interface BodyProps {
  readonly side: Side;
  readonly primary: readonly MuscleSlug[];
  readonly secondary: readonly MuscleSlug[];
  readonly size: number;
  readonly theme: Theme;
  readonly viewBox?: string;
  readonly label?: string;
}

/**
 * `secondary` is drawn at 30% of the accent rather than a second hue — one
 * accent is a rule (UI.md §0), and a two-colour body would read as two
 * different kinds of thing rather than as more and less.
 */
function Body({ side, primary, secondary, size, theme, viewBox, label }: BodyProps): ReactElement {
  const lit = new Set(primary);
  const tinted = new Set(secondary.filter((slug) => !lit.has(slug)));
  const muscles = BODY[side].muscles;

  return (
    <Svg
      width={size}
      height={size}
      viewBox={viewBox ?? FULL_VIEWBOX[side]}
      accessible
      accessibilityLabel={label ?? `${side} view`}
    >
      {BODY[side].outline.map((d, index) => (
        <Path key={`o${index}`} d={d} fill={theme.surface2} stroke={theme.border} strokeWidth={1} />
      ))}
      {Object.entries(muscles).flatMap(([slug, paths]) => {
        const fill = lit.has(slug as MuscleSlug)
          ? theme.accent
          : tinted.has(slug as MuscleSlug)
            ? `${theme.accent}4D` // 30%
            : null;
        if (!fill) return [];
        return paths.map((d, index) => <Path key={`${slug}${index}`} d={d} fill={fill} />);
      })}
    </Svg>
  );
}

interface MapProps {
  readonly primary: readonly MuscleSlug[];
  readonly secondary?: readonly MuscleSlug[];
  readonly size?: number;
  readonly theme: Theme;
}

/** Front and back side by side — exercise detail (96px) and finish summary (92px). */
export function MuscleMap({ primary, secondary = [], size = 96, theme }: MapProps): ReactElement {
  const named = primary.map((slug) => MUSCLE_LABEL[slug]).join(', ');
  return (
    <Svg width={size * 2} height={size} viewBox="0 0 1448 1448" accessible accessibilityLabel={`Muscles worked: ${named || 'none'}`}>
      <Body side="front" primary={primary} secondary={secondary} size={size} theme={theme} />
      <Body side="back" primary={primary} secondary={secondary} size={size} theme={theme} />
    </Svg>
  );
}

interface ChipProps {
  readonly muscle: MuscleSlug | null;
  readonly size?: number;
  readonly theme: Theme;
}

/**
 * The 30px row chip. Cropped, not scaled — scaling the whole body makes the lit
 * region four pixels tall, which is the failure CONTENT-LIBRARY.md calls out.
 *
 * Acceptance: cover the text in the picker and the muscle is still identifiable
 * from the chip alone.
 */
export function MuscleChip({ muscle, size = 30, theme }: ChipProps): ReactElement | null {
  if (!muscle) return null;
  const side = MUSCLE_SIDE[muscle];
  const crop = CROPS[`${side}:${muscle}`];
  if (!crop) return null;

  return (
    <Body
      side={side}
      primary={[muscle]}
      secondary={[]}
      size={size}
      theme={theme}
      viewBox={crop.join(' ')}
      label={MUSCLE_LABEL[muscle]}
    />
  );
}
