import ApexLogo from './ApexLogo';
import CubeGrid, { GRID_PERIOD } from './CubeGrid';

/**
 * Branded full-screen boot loader — the first thing users see while the session
 * is being restored. Reuses the landing aesthetic: animated CubeGrid, floating
 * accent orbs, and the pulsing Apex mark inside a spinning ring.
 */
export default function AppLoader({ label = 'Preparing your portfolio' }) {
  return (
    <div className="app-loader">
      <CubeGrid period={GRID_PERIOD} style={{ opacity: 0.5 }} />
      <div className="landing-orb" style={{ width: 540, height: 540, background: 'radial-gradient(circle, rgba(201,169,106,0.12), transparent 65%)', top: '-14%', left: '-8%', animation: 'orbFloat1 26s ease-in-out infinite' }} />
      <div className="landing-orb" style={{ width: 440, height: 440, background: 'radial-gradient(circle, rgba(91,110,142,0.10), transparent 65%)', bottom: '-14%', right: '-6%', animation: 'orbFloat3 22s ease-in-out infinite' }} />

      <div className="app-loader-inner">
        <div className="app-loader-mark">
          <span className="app-loader-ring" />
          <ApexLogo size={50} className="logo-pulse" style={{ color: 'var(--color-accent)', position: 'relative', zIndex: 1 }} />
        </div>
        <span className="app-loader-word">Apex</span>
        <span className="app-loader-label">{label}</span>
      </div>
    </div>
  );
}
