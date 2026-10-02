import { Link } from 'react-router-dom';
import { Briefcase, Pencil } from 'lucide-react';
import { formatCurrency, compactIfLarge, formatSigned } from '../../lib/utils';
import { accountTypeLabel } from '../../lib/constants';
import { TYPE_ICON, ACCOUNT_TYPE_STYLE } from '../../lib/accountPickerOptions';
import Sparkline from '../ui/Sparkline';

/**
 * One account as a card you would want in your wallet: a deep metallic face in its type's
 * colour, a chip, the balance, and the type set like a card network along the foot.
 * The sheen and the brushed texture live in index.css (`.account-card`).
 */
export default function AccountCard({ acc, share, shareLabel = 'of assets', onEdit }) {
  const Icon = TYPE_ICON[acc.type] || Briefcase;
  const tone = (ACCOUNT_TYPE_STYLE[acc.type] || ACCOUNT_TYPE_STYLE.other).tone;

  const cash   = acc.cashBalance  ?? 0;
  const assets = acc.assetBalance ?? 0;
  const split  = !acc.isDebt && assets > 0;

  const spark = acc.spark || [];
  const moved = spark.length > 1 ? spark[spark.length - 1] - spark[0] : null;

  return (
    <Link to={`/accounts/${acc._id}`} className="account-card group" style={{ '--tone': tone }}>
      <Icon className="account-card-mark" size={132} strokeWidth={1} aria-hidden />

      <div className="flex items-start justify-between" style={{ gap: 10, position: 'relative' }}>
        <span className="flex items-center" style={{ gap: 12, minWidth: 0 }}>
          <span className="account-card-chip"><Icon size={15} strokeWidth={1.9} /></span>
          <span style={{ minWidth: 0 }}>
            <span className="truncate" style={{ display: 'block', fontSize: '0.92rem', fontWeight: 500, color: 'var(--color-text-primary)', letterSpacing: '-0.005em' }}>{acc.name}</span>
            {acc.description && (
              <span className="truncate" style={{ display: 'block', fontSize: '0.7rem', color: 'var(--color-text-muted)', marginTop: 2 }}>{acc.description}</span>
            )}
          </span>
        </span>
        <button onClick={(e) => onEdit(acc, e)} title={`Edit ${acc.name}`} aria-label={`Edit ${acc.name}`}
          className="opacity-0 group-hover:!opacity-100 transition-opacity"
          style={{ color: 'var(--color-text-secondary)', background: 'none', border: 'none', cursor: 'pointer', display: 'flex', padding: 4 }}>
          <Pencil size={13} />
        </button>
      </div>

      <div style={{ marginTop: 'auto', position: 'relative' }}>
        <p className="figure account-card-balance" style={{ color: acc.balance < 0 ? 'var(--color-danger)' : undefined }}>
          {formatCurrency(acc.balance)}
        </p>
        <p className="text-xs" style={{ color: 'var(--color-text-muted)', marginTop: 6 }}>
          {split ? (
            <>
              {Math.round(cash) !== 0 && <><span className="figure">{compactIfLarge(Math.round(cash))}</span> cash · </>}
              <span className="figure">{compactIfLarge(Math.round(assets))}</span> invested
            </>
          ) : acc.isDebt ? 'Outstanding' : 'Cash'}
          {moved != null && Math.round(moved) !== 0 && (
            <> · <span className="figure">{formatSigned(Math.round(moved), compactIfLarge)}</span> in 90d</>
          )}
        </p>
      </div>

      <div className="flex items-center justify-between" style={{ marginTop: 16, position: 'relative' }}>
        <span className="account-card-network">{accountTypeLabel(acc.type)}</span>
        {share != null && (
          <span className="figure" title={`${Math.abs(share).toFixed(1)}% ${shareLabel}`}
            style={{ fontSize: '0.7rem', color: 'var(--color-text-secondary)' }}>
            {Math.abs(share).toFixed(0)}%
          </span>
        )}
      </div>

      {spark.length > 1 && (
        <div className="account-card-spark" aria-hidden>
          <Sparkline values={spark} tone={tone} height={58} width={240} fluid />
        </div>
      )}
    </Link>
  );
}
