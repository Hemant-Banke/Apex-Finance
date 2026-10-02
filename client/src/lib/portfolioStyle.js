// Growth-asset share → style. Bands follow the usual equity-allocation profiles.
export const STYLES = [
  { max: 20,  label: 'Capital preservation', short: 'Preserve' },
  { max: 40,  label: 'Conservative',         short: 'Conservative' },
  { max: 65,  label: 'Balanced',             short: 'Balanced' },
  { max: 85,  label: 'Growth',               short: 'Growth' },
  { max: 101, label: 'Aggressive',           short: 'Aggressive' },
];

/** The style verdict for a profile: growth-asset share (equity + crypto) and its band. */
export function portfolioStyle(profile, cash = 0) {
  if (!profile?.total) return null;
  const total = profile.total + Math.max(0, cash);
  const growth = (((profile.classes?.equity || 0) + (profile.classes?.crypto || 0)) / total) * 100;
  return { growth, ...STYLES.find(s => growth < s.max) };
}
