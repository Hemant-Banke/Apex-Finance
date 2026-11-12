import { useState } from 'react';
import GEO from '../../lib/worldMap.json';
import SectionHeader from '../ui/SectionHeader';

// A country's flag from its ISO3 code; images, not emoji, because Windows draws emoji flags as two letters.
export default function Flag({ iso, height = 14, style }) {
  const [failed, setFailed] = useState(false);
  const a2 = GEO.a2[iso];
  const width = Math.round(height * 4 / 3);
  if (!a2 || failed) return <span style={{ display: 'inline-block', width, height, flexShrink: 0, ...style }} />;
  return (
    <img src={`https://flagcdn.com/w80/${a2}.png`} alt="" width={width} height={height} loading="lazy" onError={() => setFailed(true)}
      style={{ width, height, objectFit: 'cover', borderRadius: 2, flexShrink: 0, boxShadow: '0 0 0 1px rgba(255,255,255,0.08)', verticalAlign: 'middle', ...style }} />
  );
}

/** The heading that names the economy the page below the map is about. */
export function CountryHeading({ iso, name, sub, action }) {
  return (
    <SectionHeader style={{ marginTop: 8 }} sub={sub} action={action}
      title={<span className="flex items-center" style={{ gap: 14 }}><Flag iso={iso} height={24} />{name}</span>} />
  );
}
