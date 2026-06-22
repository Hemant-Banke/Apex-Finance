import { useState } from 'react';
import Modal from '../ui/Modal';
import StatementUpload from './StatementUpload';
import TransactionReview from './TransactionReview';

export default function ImportModal({ open, onClose, accounts, onSuccess }) {
  const [step, setStep]         = useState('upload');   // 'upload' | 'review'
  const [parsed, setParsed]     = useState(null);
  const [accountId, setAccountId] = useState('');

  function handleClose() {
    setStep('upload');
    setParsed(null);
    onClose();
  }

  function handleParsed(data) {
    setAccountId(data.accountId);
    setParsed(data);
    setStep('review');
  }

  function handleDone() {
    handleClose();
    onSuccess?.();
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={step === 'upload' ? 'Import statement' : 'Review transactions'}
      maxWidth={step === 'review' ? 860 : 480}
    >
      {step === 'upload' && (
        <StatementUpload
          accounts={accounts}
          onParsed={handleParsed}
        />
      )}
      {step === 'review' && parsed && (
        <TransactionReview
          data={parsed}
          accounts={accounts}
          accountId={accountId}
          onBack={() => setStep('upload')}
          onDone={handleDone}
        />
      )}
    </Modal>
  );
}
