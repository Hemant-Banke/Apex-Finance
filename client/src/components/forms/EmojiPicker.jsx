import { useState, useRef, useMemo } from 'react';
import Popover from '../ui/Popover';
import { Search } from 'lucide-react';

/**
 * EmojiPicker — a button showing the current emoji; clicking opens a searchable grid.
 *
 * Replaces the free-text inputs we had, which happily accepted "asdf" as an emoji.
 * The value can now only ever be one of these, so a category's icon is always an icon.
 *
 * Grouped and keyworded for money-shaped things, since that is what these label.
 */

const GROUPS = [
  {
    name: 'Money',
    items: [
      ['💰', 'money cash salary income'], ['💵', 'cash note dollar'], ['🪙', 'coin change'],
      ['💳', 'card credit debit'], ['🏦', 'bank'], ['📈', 'invest growth stocks up'],
      ['📉', 'loss down'], ['📊', 'chart portfolio'], ['💹', 'market forex'],
      ['🧾', 'bill receipt tax invoice'], ['💸', 'spend expense outflow'], ['🏧', 'atm withdraw'],
      ['💼', 'business work job'], ['🤝', 'deal partner'], ['🧧', 'gift money bonus'],
      ['🎯', 'goal target savings'], ['🐷', 'piggy savings'], ['🔒', 'locked deposit fd'],
    ],
  },
  {
    name: 'Home & bills',
    items: [
      ['🏠', 'home house rent'], ['🏡', 'house property'], ['🏢', 'office building'],
      ['💡', 'electricity power light bill'], ['🔥', 'gas heating'], ['💧', 'water bill'],
      ['📶', 'internet wifi broadband'], ['📱', 'phone mobile recharge'], ['🛜', 'wifi'],
      ['🧹', 'cleaning maid help'], ['🔧', 'repair maintenance fix'], ['🛋️', 'furniture'],
      ['🪑', 'furniture chair'], ['🧺', 'laundry'], ['🗑️', 'waste'],
    ],
  },
  {
    name: 'Food',
    items: [
      ['🍜', 'food noodles meal'], ['🍔', 'burger fastfood'], ['🍕', 'pizza'],
      ['🍽️', 'dining restaurant eat'], ['☕', 'coffee cafe tea'], ['🍺', 'beer alcohol drinks'],
      ['🍷', 'wine'], ['🛒', 'grocery groceries supermarket'], ['🥦', 'vegetables grocery'],
      ['🍎', 'fruit'], ['🥐', 'bakery bread'], ['🍰', 'dessert cake'],
      ['🥡', 'takeaway delivery'], ['🧋', 'boba drinks'],
    ],
  },
  {
    name: 'Transport',
    items: [
      ['🚗', 'car drive'], ['⛽', 'fuel petrol diesel gas'], ['🚕', 'taxi cab uber ola'],
      ['🚌', 'bus'], ['🚇', 'metro subway train'], ['🚆', 'train rail'],
      ['✈️', 'flight travel airline'], ['🛵', 'scooter bike delivery'], ['🚲', 'cycle bike'],
      ['🅿️', 'parking'], ['🛣️', 'toll highway'], ['🚢', 'ship cruise'],
    ],
  },
  {
    name: 'Life',
    items: [
      ['🏥', 'hospital medical health'], ['💊', 'medicine pharmacy'], ['🩺', 'doctor checkup'],
      ['🦷', 'dentist'], ['🎓', 'education school college tuition'], ['📚', 'books study'],
      ['👶', 'baby child kids'], ['🐾', 'pet dog cat vet'], ['💇', 'salon haircut grooming'],
      ['🧴', 'personal care toiletries'], ['👕', 'clothes apparel shopping'], ['👟', 'shoes'],
      ['🛍️', 'shopping retail'], ['🎁', 'gift present'], ['❤️', 'charity donation love'],
      ['🛡️', 'insurance protection'], ['⚖️', 'legal lawyer'],
    ],
  },
  {
    name: 'Leisure',
    items: [
      ['🎬', 'movies cinema entertainment'], ['🎧', 'music spotify audio'], ['📺', 'tv streaming netflix'],
      ['🎮', 'games gaming'], ['🏋️', 'gym fitness workout'], ['🧘', 'yoga wellness'],
      ['⚽', 'sports football'], ['🏏', 'cricket sports'], ['🎨', 'art hobby'],
      ['🎪', 'events fun'], ['🏨', 'hotel stay travel'], ['🏖️', 'holiday vacation beach'],
      ['📷', 'photography'], ['🎸', 'music instrument'], ['✂️', 'hobby craft'],
    ],
  },
  {
    name: 'Other',
    items: [
      ['📋', 'other misc general'], ['📦', 'package delivery'], ['🔔', 'subscription reminder'],
      ['🔁', 'recurring repeat'], ['🏛️', 'government tax'], ['🧮', 'accounting fees'],
      ['💻', 'software tech laptop'], ['🖥️', 'computer'], ['🛠️', 'tools'],
      ['🌱', 'growth misc'], ['⭐', 'favourite starred'], ['❓', 'unknown misc'],
    ],
  },
];

const ALL = GROUPS.flatMap(g => g.items.map(([e, kw]) => ({ emoji: e, kw, group: g.name })));

export default function EmojiPicker({ value, onChange, size = 38 }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const triggerRef = useRef(null);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    return ALL.filter(x => x.kw.includes(q));
  }, [query]);

  const pick = (e) => { onChange(e); setOpen(false); setQuery(''); };

  const Cell = ({ emoji }) => (
    <button type="button" onClick={() => pick(emoji)} title={emoji}
      style={{
        width: 30, height: 30, flexShrink: 0, fontSize: '1.05rem',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        borderRadius: 7, cursor: 'pointer', fontFamily: 'inherit',
        border: `1px solid ${value === emoji ? 'var(--color-accent)' : 'transparent'}`,
        background: value === emoji ? 'var(--color-accent-dim)' : 'transparent',
        transition: 'background 0.12s',
      }}
      onMouseEnter={ev => { if (value !== emoji) ev.currentTarget.style.background = 'var(--color-bg-elevated)'; }}
      onMouseLeave={ev => { if (value !== emoji) ev.currentTarget.style.background = 'transparent'; }}
    >
      {emoji}
    </button>
  );

  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setOpen(o => !o)}
        title="Choose an emoji" aria-label="Choose an emoji"
        style={{
          width: size, height: size, flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: '1.2rem', cursor: 'pointer', fontFamily: 'inherit',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--color-bg-input)',
          border: `1px solid ${open ? 'var(--color-accent)' : 'var(--color-border)'}`,
          boxShadow: 'inset 0 1px 2px rgba(0,0,0,0.28)',
        }}>
        {value || '📋'}
      </button>

      <Popover open={open} anchorRef={triggerRef} onClose={() => { setOpen(false); setQuery(''); }} width={286}>
        <div style={{ display: 'flex', flexDirection: 'column', maxHeight: 300 }}>
          {/* Search */}
          <div style={{ padding: 8, borderBottom: '1px solid var(--color-border)', flexShrink: 0 }}>
            <div style={{ position: 'relative' }}>
              <Search size={13} style={{ position: 'absolute', left: 9, top: '50%', transform: 'translateY(-50%)', color: 'var(--color-text-muted)' }} />
              <input
                autoFocus
                type="text" value={query} onChange={e => setQuery(e.target.value)}
                placeholder="Search — rent, coffee, salary…"
                className="input-field"
                style={{ paddingLeft: 28, height: 32, fontSize: '0.8125rem' }}
              />
            </div>
          </div>

          {/* Grid */}
          <div style={{ overflowY: 'auto', padding: 8 }}>
            {results ? (
              results.length ? (
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                  {results.map(r => <Cell key={r.emoji} emoji={r.emoji} />)}
                </div>
              ) : (
                <p className="text-xs" style={{ color: 'var(--color-text-muted)', padding: '10px 4px' }}>
                  Nothing matches “{query}”.
                </p>
              )
            ) : (
              GROUPS.map(g => (
                <div key={g.name} style={{ marginBottom: 8 }}>
                  <p className="eyebrow" style={{ margin: '2px 0 5px 3px' }}>{g.name}</p>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2 }}>
                    {g.items.map(([e]) => <Cell key={e} emoji={e} />)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </Popover>
    </>
  );
}
