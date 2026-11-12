import { ROUNDS_PER_RUN, STRIKES_PER_ROUND } from "./config";

/**
 * Player-facing copy that quotes the run structure. Everything derives from
 * config, so changing ROUNDS_PER_RUN or STRIKES_PER_ROUND updates every screen.
 */

const WORDS = [
  "zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine",
  "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty",
] as const;

export const numberWord = (n: number): string => WORDS[n] ?? String(n);
export const capitalize = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

const rounds = () => plural(ROUNDS_PER_RUN, "round", "rounds");
const strikes = () => plural(STRIKES_PER_ROUND, "strike", "strikes");

/** Title screen tagline. */
export const tagline = (): string =>
  `A daily parry. ${capitalize(numberWord(ROUNDS_PER_RUN))} ${rounds()}. One tap per strike.`;

/** How-to line 3. */
export const howToStrikes = (): string =>
  `${capitalize(numberWord(ROUNDS_PER_RUN))} ${rounds()} of ${numberWord(STRIKES_PER_ROUND)} ${strikes()}. ` +
  `One chance each. Beware false starts, and the blade that hangs.`;

/** Metadata and Open Graph description. */
export const pitch = (): string =>
  `One foe. ${capitalize(numberWord(ROUNDS_PER_RUN))} ${rounds()}. Tap at the instant of impact. ` +
  `A daily parry-timing duel scored to the millisecond.`;

/** Open Graph banner line. */
export const bannerLine = (): string =>
  `ONE FOE · ${numberWord(ROUNDS_PER_RUN).toUpperCase()} ${rounds().toUpperCase()} · ONE TAP PER STRIKE`;

/** Open Graph alt text. */
export const ogAlt = (): string =>
  `Deflect: the daily parry. One foe, ${numberWord(ROUNDS_PER_RUN)} ${rounds()}, one tap per strike.`;
