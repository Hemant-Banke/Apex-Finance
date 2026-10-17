import { useEffect, useState } from 'react';
import { accountsAPI, dashboardAPI } from '../lib/api';
import SectionHeader from '../components/ui/SectionHeader';
import Spinner from '../components/ui/Spinner';
import GoalsView from '../components/goals/GoalsView';
import { useToast } from '../context/ToastContext';

/** Goals (`/goals`): what the money is for, planned together against what you hold and what you save. */
export default function Goals() {
  const toast = useToast();
  const [data, setData] = useState(null);

  useEffect(() => {
    Promise.all([
      dashboardAPI.getSpendingProfile(12).then(r => r.data).catch(() => null),
      accountsAPI.getAll().then(r => r.data).catch(() => []),
      dashboardAPI.getPortfolio().then(r => r.data).catch(() => null),
    ]).then(([spending, accounts, portfolio]) => {
      if (!spending) toast.error('Failed to load your spending');
      setData({ spending, accounts, portfolio });
    });
  }, [toast]);

  return (
    <div className="animate-in" style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
      <SectionHeader title="What the money is for"
        sub="Every goal planned together — what each can take from what you hold, what to invest each month, and where" />
      {!data ? <Spinner /> : <GoalsView {...data} />}
    </div>
  );
}
