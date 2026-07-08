import { useEffect, useState } from 'react';
import { subscribeLoading } from '../../lib/api';

/**
 * A thin, premium indeterminate progress bar pinned to the top of the viewport.
 * Driven by the global in-flight API request count — so any fetch or mutation
 * (adding a transaction, importing, rebuilding, refetching a page) surfaces a
 * subtle sweep of accent light without blanking the page.
 */
export default function TopProgressBar() {
  const [active, setActive] = useState(false);

  useEffect(() => subscribeLoading(count => setActive(count > 0)), []);

  return (
    <div className={`top-progress${active ? ' active' : ''}`} aria-hidden="true">
      <div className="top-progress-bar" />
    </div>
  );
}
