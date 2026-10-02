import { Link } from 'react-router-dom';
import { viewPathFor } from '../../lib/markets';
import { isSelfPricedHolding } from '../../lib/constants';

/**
 * A holding's name, linked to its detail page — a company, a fund, a coin, physical gold's
 * price. A self-priced holding (an FD, a flat) has no market, so its name stays plain text.
 */
export default function HoldingLink({ h, children }) {
  const to = viewPathFor({ ...h, isManual: isSelfPricedHolding(h) });
  return to ? <Link to={to} className="stock-link" style={{ color: 'inherit' }}>{children}</Link> : children;
}
