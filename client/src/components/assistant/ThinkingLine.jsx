import { useEffect, useState } from 'react';
import { Bloom } from '../ui/Spinner';

const WORDS = [
  'Compounding', 'Reconciling', 'Tallying', 'Marking to market', 'Rebalancing', 'Accruing',
  'Appraising', 'Assaying', 'Auditing the ledger', 'Weighing', 'Counting the lakhs', 'Balancing the books',
  'Tracing the cashflow', 'Reading the tape', 'Netting', 'Annualising', 'Diversifying thoughts',
  'Totting up', 'Settling', 'Cross-checking', 'Minting', 'Hedging', 'Vesting', 'Clearing',
  'Pruning the garden', 'Watering the roots', 'Harvesting', 'Sowing',
];

const pick = (not) => {
  let w;
  do w = WORDS[Math.floor(Math.random() * WORDS.length)]; while (w === not);
  return w;
};

/** The assistant's "working on it" line: the bloom, a rotating word and the time taken so far. */
export default function ThinkingLine() {
  const [word, setWord] = useState(() => pick());
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);

  useEffect(() => {
    const words = setInterval(() => setWord(w => pick(w)), 2600);
    const clock = setInterval(() => setNow(Date.now()), 1000);
    return () => { clearInterval(words); clearInterval(clock); };
  }, []);

  const secs = Math.floor((now - start) / 1000);
  return (
    <div className="chat-thinking" role="status" aria-label="Thinking">
      <Bloom size={0.55} />
      <span key={word} className="chat-thinking-word">{word}…</span>
      {secs >= 3 && <span className="chat-thinking-time figure">{secs}s</span>}
    </div>
  );
}
