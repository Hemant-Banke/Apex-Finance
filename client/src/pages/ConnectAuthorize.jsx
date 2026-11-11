import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ShieldCheck, Eye, Ban } from 'lucide-react';
import ApexLogo from '../components/ui/ApexLogo';
import Button from '../components/ui/Button';
import Card from '../components/ui/Card';
import Spinner from '../components/ui/Spinner';
import { mcpAPI } from '../lib/api';
import { useAuth } from '../context/AuthContext';

/** Where Claude or ChatGPT send the user to approve the Apex connector. */
export default function ConnectAuthorize() {
  const [params] = useSearchParams();
  const requestId = params.get('request');
  const { user } = useAuth();
  const [req, setReq] = useState(null);
  const [loadError, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!requestId) return;
    mcpAPI.request(requestId).then(r => setReq(r.data))
      .catch(e => setError(e.response?.data?.message || 'This request could not be loaded.'));
  }, [requestId]);

  const error = requestId ? loadError : 'This link is incomplete. Start the connection again from the app.';

  const answer = async (approve) => {
    setBusy(true);
    try {
      const { data } = await mcpAPI.decide(requestId, approve);
      window.location.assign(data.redirect);
    } catch (e) {
      setError(e.response?.data?.message || 'Something went wrong.');
      setBusy(false);
    }
  };

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--color-bg-primary)' }}>
      <div style={{ width: '100%', maxWidth: 440 }}>
        <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 24 }}><ApexLogo /></div>
        <Card gilt>
          {error ? (
            <p className="text-sm" style={{ color: 'var(--color-text-secondary)', textAlign: 'center' }}>{error}</p>
          ) : !req ? <Spinner height={160} /> : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
              <div>
                <p className="eyebrow" style={{ marginBottom: 10 }}>Connect</p>
                <h1 className="heading-lg">{req.clientName} wants to read your Apex data</h1>
                <p className="text-sm" style={{ color: 'var(--color-text-muted)', marginTop: 8 }}>
                  Signed in as {user?.email || user?.name}. Approving sends you back to <span className="figure">{req.redirectHost}</span>.
                </p>
              </div>
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 10, listStyle: 'none', padding: 0, margin: 0 }}>
                {[
                  [Eye, 'See your net worth, accounts, holdings, transactions, cashflow, goals and spending habits.'],
                  [Ban, 'Read only. It cannot add, change or delete anything.'],
                  [ShieldCheck, 'Revoke access at any time in Settings › AI.'],
                ].map(([Icon, text]) => (
                  <li key={text} className="text-sm" style={{ display: 'flex', gap: 10, color: 'var(--color-text-secondary)' }}>
                    <Icon size={15} style={{ flexShrink: 0, marginTop: 2, color: 'var(--color-text-muted)' }} />{text}
                  </li>
                ))}
              </ul>
              <p className="text-xs" style={{ color: 'var(--color-text-muted)' }}>
                What you ask there is answered by that app's AI under its own terms, using the data it reads from Apex.
              </p>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
                <Button variant="secondary" onClick={() => answer(false)} disabled={busy}>Deny</Button>
                <Button variant="gold" onClick={() => answer(true)} disabled={busy}>{busy ? 'Connecting…' : 'Allow access'}</Button>
              </div>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
