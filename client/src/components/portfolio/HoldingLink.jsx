import { Link, useLocation } from 'react-router-dom';
import { viewPathFor } from '../../lib/markets';
import { isSelfPricedHolding } from '../../lib/constants';

/**
 * A holding's name, linked to its detail page — a company, a fund, a coin, physical gold's
 * price. A self-priced holding (an FD, a flat) has no market, so its name stays plain text.
 */
export default function HoldingLink({ h, children }) {
  const { pathname, search } = useLocation();
  const to = viewPathFor({ ...h, isManual: isSelfPricedHolding(h) });
  // Carry the origin so the instrument page's back link returns here, not to Markets.
  return to ? <Link to={to} state={{ from: pathname + search }} className="stock-link" style={{ color: 'inherit' }}>{children}</Link> : children;
}
