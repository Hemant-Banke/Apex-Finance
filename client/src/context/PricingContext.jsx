import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { isLive, setLive as persist, subscribePriced, getLastPriced } from '../lib/pricing';

const Ctx = createContext({ live: false, setLive: () => {}, priced: null });

/** The live-prices switch, shared app-wide. Pages remount when it flips, so every figure refetches. */
export function PricingProvider({ children }) {
  const [live, setState] = useState(isLive);
  // `{ date, at }` of the latest priced response — what the figures on screen are really as of.
  const [priced, setPriced] = useState(getLastPriced);
  useEffect(() => subscribePriced(setPriced), []);
  const setLive = useCallback((on) => { persist(on); setState(!!on); }, []);
  return <Ctx.Provider value={{ live, setLive, priced }}>{children}</Ctx.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export const usePricing = () => useContext(Ctx);
