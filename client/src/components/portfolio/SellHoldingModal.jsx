import Modal from '../ui/Modal';
import AssetIcon from '../market/AssetIcon';
import AssetTransactionForm from '../market/AssetTransactionForm';
import { assetTypeLabel } from '../../lib/constants';

/**
 * Sell a position you already own.
 *
 * The one dialog behind every "Sell" affordance — the account's Breakdown list and the
 * portfolio's holdings table — so the two cannot drift into being subtly different
 * flows. Everything it needs comes off the holding itself; there is no market search,
 * because the instrument is already known.
 *
 * `holding` doubles as the open flag (null = closed), which keeps the caller to one
 * piece of state rather than a boolean and a payload that can disagree.
 *
 * `positions` is the per-account split. The account list and the merged portfolio
 * disagree about what "qty" means — one account's holding vs. every account's — so the
 * shape is normalised here and the form always reads the per-account figure.
 */
export default function SellHoldingModal({ holding, accounts = [], defaultAccountId, onClose, onSuccess }) {
  if (!holding) return null;

  const positions = holding.positions?.length
    ? holding.positions
    : [{
        account:        defaultAccountId ?? null,
        qty:            holding.qty ?? 0,
        avgCostPerUnit: holding.avgCostPerUnit ?? 0,
      }];

  // Largest position first — the account most likely being sold from.
  const ordered = [...positions].sort((a, b) => Math.abs(b.qty) - Math.abs(a.qty));

  return (
    <Modal
      open
      onClose={onClose}
      align="top"
      wide
      eyebrow="Sell holding"
      title={holding.name || holding.symbol}
      subtitle={holding.symbol && !holding.name?.startsWith(holding.symbol) ? (
        <span className="figure" style={{ color: 'var(--color-text-secondary)', fontWeight: 600 }}>
          {holding.symbol}
        </span>
      ) : undefined}
      tag={holding.type ? assetTypeLabel(holding.type) : undefined}
      titlePrefix={
        <AssetIcon symbol={holding.symbol} name={holding.name} type={holding.type} size={40} />
      }
    >
      <AssetTransactionForm
        holding={{ ...holding, positions: ordered }}
        accounts={accounts}
        defaultAccountId={defaultAccountId ?? ordered[0]?.account ?? undefined}
        onSuccess={onSuccess}
      />
    </Modal>
  );
}
