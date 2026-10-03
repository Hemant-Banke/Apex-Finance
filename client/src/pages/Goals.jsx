import { useEffect, useState } from 'react';
import { dashboardAPI } from '../lib/api';
import SectionHeader from '../components/ui/SectionHeader';
import Spinner from '../components/ui/Spinner';
import GoalsView from '../components/goals/GoalsView';
import { useToast } from '../context/ToastContext';

/** Goals (`/goals`): what the money is for. Surplus is the same income-less-spending the Freedom Plan uses. */
export default function Goals() {
  const toast = useToast();
  const [surplus, setSurplus] = useState(null);

  useEffect(() => {
    dashboardAPI.getSpendingProfile(12)
      .then(r => setSurplus(Math.max(0, (r.data.income || 0) - (r.data.expense || 0))))
      .catch(e => { setSurplus(0); toast.error(e.response?.data?.message || 'Failed to load your spending'); });
  }, [toast]);

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionHeader eyebrow="Goals" title="What the money is for"
        sub="Each goal priced, dated, funded and given a mix — and the odds it gets there" />
      {surplus == null ? <Spinner /> : <GoalsView surplus={surplus} />}
    </div>
  );
}
