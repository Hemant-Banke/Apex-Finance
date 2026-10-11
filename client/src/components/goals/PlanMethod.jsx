import katex from 'katex';
import 'katex/dist/katex.min.css';
import Modal from '../ui/Modal';
import { compactIfLarge } from '../../lib/utils';
import { ASSETS, ASSET_KEYS, PAYOUT_MIX, PRIORITIES, PRIORITY_ORDER, mixReturn } from '../../lib/goals';
import { PLAN_METHOD } from '../../lib/goalPlan';

const money = (v) => compactIfLarge(Math.round(v || 0));
const pct = (v, d = 1) => `${+Number(v).toFixed(d)}%`;

function Part({ n, title, children }) {
  return (
    <section className="method-part">
      <p className="method-head"><span className="figure">{String(n).padStart(2, '0')}</span>{title}</p>
      {children}
    </section>
  );
}
const P = ({ children }) => <p className="method-text">{children}</p>;
const tex = (src) => ({ __html: katex.renderToString(src, { displayMode: true, throwOnError: false }) });

/** Formula block: one row per [TeX, note?], the notes in a column of their own. */
const F = ({ rows }) => (
  <div className="method-formula">
    {rows.map(([src, note], i) => (
      <div key={i} className="method-row">
        <div className="method-math" dangerouslySetInnerHTML={tex(src)} />
        {note && <span className="method-note">{note}</span>}
      </div>
    ))}
  </div>
);

/** The plan's method in full, as a modal, with this plan's own numbers filled in. */
export default function PlanMethod({ plan, open, onClose }) {
  const s = plan.settings, M = PLAN_METHOD;
  const rets = Object.fromEntries(ASSET_KEYS.map(k => [k, s.returns[k] / 100]));
  const payoutRet = mixReturn(PAYOUT_MIX, rets) * 100;
  const src = plan.sources;
  const used = src.accounts.filter(a => a.included && a.available > 1).length;
  const phases = plan.phases.length;

  return (
    <Modal open={open} onClose={onClose} eyebrow="Goals" title="How the plan is worked out" maxWidth={1040} align="top"
      subtitle="What goes in, what is maximised, how it is solved, and what it leaves out">
        <div className="method-grid">
          <Part n={1} title="The question">
            <P>
              Given what you already hold and what you can save each month, how should every rupee be split across your goals —
              and which account should each rupee sit in — so that the goals that matter most are the likeliest to happen?
              All goals are solved together, because they compete for the same money.
            </P>
          </Part>

          <Part n={2} title="What goes in">
            <P>
              Each goal: its cost in today’s rupees <i>A</i>, its date (<i>T</i> months away), its inflation <i>i</i>
              {s.inflationShift ? ` (plus ${s.inflationShift > 0 ? '+' : ''}${s.inflationShift} points for every goal)` : ''}, whether it is paid at once or over <i>n</i> years,
              its priority, its asset strategy, and whether it may use money already held.
            </P>
            <P>
              Money already held: cash and liquid investments in {used} account{used === 1 ? '' : 's'}, <span className="figure">{money(src.available)}</span> in all,
              after keeping back a reserve of {s.reserveMonths} months’ spending (<span className="figure">{money(src.reserve)}</span>) from cash.
              FDs, EPF/NPS, bonds and self-valued assets never count — they cannot be moved at will. Each holding is split into equity, debt
              and gold by its own make-up (a hybrid fund is part of each); crypto counts as equity, metals as gold.
            </P>
            <P>
              Money each month: a cap of <span className="figure">{money(plan.cap0)}</span>
              {s.cap == null ? ', your average income less spending over the last 12 months' : ', set by you'}, rising {pct(s.capGrowth)} a year.
            </P>
          </Part>

          <Part n={3} title="What each goal needs">
            <P>Each payout is inflated to its own year, and the corpus needed on the date is the payouts discounted at the payout mix’s return
              ({pct(payoutRet)}: {ASSET_KEYS.map(k => `${Math.round(PAYOUT_MIX[k] * 100)}% ${ASSETS[k].label.toLowerCase()}`).join(', ')}) — what is not yet drawn keeps earning.</P>
            <F rows={[
              [String.raw`w_k = \frac{A}{n}\,(1+i)^{T/12 + k}`, 'payout in year k = 0 … n−1'],
              [String.raw`R = \sum_{k=0}^{n-1} \frac{w_k}{(1+r_{\text{payout}})^{k}}`, 'corpus needed on the date'],
            ]} />
          </Part>

          <Part n={4} title="Markets">
            <P>
              {M.sims} simulated markets, month by month, one return per class per month. Each is lognormal, set so its expected
              growth matches the class’s return; classes move independently. The random numbers are seeded ({M.seed}), so the same
              inputs always give the same plan.
            </P>
            <F rows={[[String.raw`1 + r = \exp\!\left(\tfrac{\ln(1+\mu)}{12} - \tfrac{\sigma^2}{2} + \sigma z\right),\quad z \sim \mathcal{N}(0,1)`]]} />
            <table className="method-table">
              <thead><tr><th>Class</th><th>Return μ</th><th>Volatility σ</th></tr></thead>
              <tbody>{ASSET_KEYS.map(k => (
                <tr key={k}><td>{ASSETS[k].label}</td><td className="figure">{pct(s.returns[k])}</td><td className="figure">{pct(ASSETS[k].vol * 100, 0)}</td></tr>
              ))}</tbody>
            </table>
          </Part>

          <Part n={5} title="A goal’s pot">
            <P>
              Each goal has its own pot, rebalanced every month to its mix — the glide path, or your fixed strategy until the last three
              years. Because the mix is fixed in advance, the pot on its date is a straight sum of what goes in, each rupee multiplied by
              how much that scenario grows it. That linearity is what makes the problem fast to solve.
            </P>
            <F rows={[
              [String.raw`g(t) = 1 + \textstyle\sum_c m_c(t)\, r_c(t)`, 'a month’s growth'],
              [String.raw`G(t) = \textstyle\prod_{u=t}^{T-1} g(u)`, 'growth to the date'],
              [String.raw`V = W_0\, G(0) + \textstyle\sum_p x_p F_p`, 'value on the date'],
              [String.raw`F_p = \textstyle\sum_{t \in p} \gamma(t)\, G(t)`, 'phase p’s growth factor'],
              [String.raw`\gamma(t) = (1 + \text{growth})^{\lfloor t/12 \rfloor}`, 'the cap’s yearly rise'],
            ]} />
            <P><i>W₀</i> is what the goal is given today, <i>x_p</i> its monthly amount in phase <i>p</i> (in today’s rupees, rising with the cap).
              Phases run between goal dates — {phases} in this plan — because a monthly amount should only change when a goal falls due.</P>
          </Part>

          <Part n={6} title="What is maximised">
            <P>For every goal in every scenario, a blend of making it and how close it came — so a goal that misses by a little scores far
              better than one that misses by a lot. Its odds are the share of scenarios where it makes it.</P>
            <F rows={[
              [String.raw`u = \lambda\, \sigma\!\left(\frac{V - R}{\kappa R}\right) + (1-\lambda)\min\!\left(1, \frac{V}{R}\right)`],
              [String.raw`\lambda = ${M.lambda}`, 'weight on making it'],
              [String.raw`\kappa = ${M.kappa}`, 'how sharp “made it” is'],
              [String.raw`\text{odds} = \Pr_s\,[\,V_s \ge R\,]`, `share of ${M.sims} scenarios`],
            ]} />
            <P>σ is the logistic curve — a smooth step at the corpus, so the optimiser can see which way “made it” lies.</P>
          </Part>

          <Part n={7} title="The rules">
            <F rows={[
              [String.raw`\textstyle\sum_{\text{goals}} W_0 \le \text{money already held}`],
              [String.raw`\textstyle\sum_{\text{goals}} x_p \le \text{monthly cap}`, 'in every phase p'],
              [String.raw`W_0,\ x_p \ge 0`],
              [String.raw`W_0 = 0`, 'for a goal started from scratch'],
              [String.raw`x_p = 0`, 'once a goal’s date has passed'],
            ]} />
            <P>Priorities are strict. A tier is funded until each of its goals reaches the tier’s target odds
              ({PRIORITY_ORDER.map(p => `${PRIORITIES[p].label} ${s.confidence[p]}%`).join(', ')}) — or the money runs out — before the next tier gets a rupee.</P>
          </Part>

          <Part n={8} title="How it is solved">
            <P>
              Greedy allocation on the simulated markets. Each pool — money held, and each phase’s monthly cap — is handed out in
              steps of 1/{M.steps} of itself. At every step, every goal in the current tier still below its target is scored on every
              pool it can use, and the step goes to the best score: the extra utility it buys per rupee of present value (monthly money
              is discounted at the debt return, so early and late money compare fairly). A step that would carry a goal past its target is
              cut back, by bisection, to land on it.
            </P>
            <F rows={[
              [String.raw`\text{score} = \frac{\mathbb{E}_s\!\left[\,u'(V_s)\,\phi_s\,\right]}{\text{PV}(\text{pool})}`],
              [String.raw`\phi = G(0) \ \text{or}\ F_p`, 'money held, or phase p'],
            ]} />
            <P>
              Inside a tier this shares a shortfall between equal goals. Across tiers it can be wasteful — a higher tier may spend early
              money a lower tier had no substitute for. So if a lower tier falls short, the pools that ran out are priced up by how much the
              lower tiers lean on them, and the smallest price (searched between 0 and {M.maxPrice} in {M.search} bisection rounds) that still
              serves every tier as well is kept. Between equally good plans, the one leaving the most money unused wins.
            </P>
            <F rows={[
              [String.raw`\text{price} = 1 + \alpha \textstyle\sum_j \frac{1}{n_j}`],
              ['j', 'lower-tier goals that can use the pool'],
              ['n_j', 'how many pools goal j can use'],
            ]} />
          </Part>

          <Part n={9} title="From classes to accounts">
            <P>
              Each class is invested in the included account that already holds most of it; failing that, your largest brokerage;
              failing that, a new account the plan recommends opening (shown dashed).
            </P>
            <P>
              Money set aside today is taken first from holdings already in the class the goal wants, then from cash, and only then
              from other holdings — so the fewest accounts are touched and only real mismatches become moves. Each month’s amount is
              split by the goal’s mix at the start of the phase. Payouts come from where the money then sits: the final year’s mix,
              then the payout mix for later years of a spread goal. Payouts and the “middle outcome” are the median scenario.
            </P>
          </Part>

          <Part n={10} title="Levers">
            <P>
              Each lever re-solves the whole plan with one assumption moved, on {M.leverSims} scenarios (and its own baseline on the
              same {M.leverSims}, so the comparison is fair). A goal already at its target is held there, so a lever’s effect shows
              elsewhere: goals crossing their target, the odds of goals below it, and the money left spare — the present value of every
              unused rupee. Changes under 1% of that are the size of one step, not a finding, and are not shown.
            </P>
          </Part>

          <Part n={11} title="What it leaves out">
            <P>
              Returns are assumptions, not forecasts; classes are treated as uncorrelated (generous when equity and gold fall together).
              No taxes, fund costs or exit loads. Rebalancing is free and monthly. The greedy solution is near-optimal for this kind of
              problem but not proven optimal. The cap comes from a 12-month average and assumes it holds. Nothing here moves money —
              it is a plan, and the accounts it names are where it would put each rupee.
            </P>
          </Part>
        </div>
    </Modal>
  );
}
