import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Search } from 'lucide-react';
import Modal from '../ui/Modal';
import BackLink from '../ui/BackLink';
import MarketSearch from '../market/MarketSearch';
import { viewPathFor } from '../../lib/markets';

/**
 * The bar across the top of every page — fixed in place like the sidebar.
 *
 * It holds what used to be placed page by page: the way back, where you are, the page's
 * key actions, and search. A page fills it by rendering `<PageBar>`: its `back` and
 * `title` are plain data the bar lays out itself; its `actions` are PORTALLED into the
 * bar, so buttons keep their own live state ("Refreshing…") without lifting it into the
 * shell. Everything a page put there leaves with the page.
 */
const Bar = createContext(null);

/** Anything with a market to show; a self-priced asset (an FD, a flat) has none. */
const isViewable = (s) => viewPathFor(s) != null;

export function TopBarProvider({ children }) {
  const [page, setPage] = useState({ back: null, title: null });
  const [actionsEl, setActionsEl] = useState(null);
  return <Bar.Provider value={{ page, setPage, actionsEl, setActionsEl }}>{children}</Bar.Provider>;
}

export default function TopBar({ section }) {
  const { page, setActionsEl } = useContext(Bar);
  const navigate = useNavigate();
  const [searchOpen, setSearchOpen] = useState(false);
  // A stable callback: a fresh ref function each render would detach and re-attach, setting state in a loop.
  const actionsSlot = useCallback((el) => setActionsEl(el), [setActionsEl]);

  // ⌘K / Ctrl+K from anywhere opens search.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); setSearchOpen(true); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const Icon = section?.icon;

  return (
    <header className="topbar">
      <div className="topbar-inner">
        {/* Navigation, not a headline: the page's own header below is that. One line —
            the section (a link back to its front page) and, on a detail page, its name. */}
        <div className="topbar-lead">
          {page.back && <BackLink to={page.back.to} compact>{page.back.label}</BackLink>}
          <nav aria-label="Breadcrumb" className="topbar-crumbs">
            {section && (page.title
              ? <Link to={section.to} className="topbar-crumb">{Icon && <Icon size={15} strokeWidth={1.7} />}{section.label}</Link>
              : <span className="topbar-crumb is-current">{Icon && <Icon size={15} strokeWidth={1.7} />}{section.label}</span>)}
            {page.title && (
              <>
                <ChevronRight size={14} className="topbar-sep" aria-hidden />
                <span className="topbar-page" title={page.title}>{page.title}</span>
              </>
            )}
          </nav>
        </div>

        <div className="flex items-center" style={{ gap: 10, flexShrink: 0 }}>
          <div ref={actionsSlot} className="flex items-center" style={{ gap: 8 }} />
          <button type="button" className="topbar-search" onClick={() => setSearchOpen(true)}
            title="Find a company, index, metal, coin or fund">
            <Search size={14} strokeWidth={2} />
            <span>Search markets</span>
            <kbd>⌘K</kbd>
          </button>
        </div>
      </div>

      <Modal open={searchOpen} onClose={() => setSearchOpen(false)}
        align="top" wide className="modal-fade-down"
        eyebrow="Markets" title="Find an asset"
        subtitle="Companies, indices, gold and silver, crypto, ETFs and mutual funds.">
        <MarketSearch browse filter={isViewable}
          placeholder="Search a company, index, metal, coin or fund…"
          onSelect={sec => { setSearchOpen(false); navigate(viewPathFor(sec)); }} />
      </Modal>
    </header>
  );
}

/**
 * A page's part of the top bar: `back` ({ to, label }), a `title` (the page's own name,
 * after the section in the breadcrumb), and `actions` on the right.
 */
export function PageBar({ back, title, actions }) {
  const { setPage, actionsEl } = useContext(Bar);
  const backTo = back?.to, backLabel = back?.label;

  useEffect(() => {
    setPage({ back: backTo ? { to: backTo, label: backLabel } : null, title: title || null });
    return () => setPage({ back: null, title: null });
  }, [setPage, backTo, backLabel, title]);

  return actions && actionsEl ? createPortal(actions, actionsEl) : null;
}
