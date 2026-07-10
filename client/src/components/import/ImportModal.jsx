import { useState } from 'react';
import Modal from '../ui/Modal';
import StatementUpload from './StatementUpload';
import TransactionReview from './TransactionReview';

export default function ImportModal({ open, onClose, accounts, defaultAccountId, onSuccess }) {
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
      eyebrow="Import"
      title={step === 'upload' ? 'Import a statement' : 'Review & confirm'}
      subtitle={step === 'upload'
        ? 'Upload a bank, UPI, or broker statement to extract transactions.'
        : 'Adjust anything, then import the selected rows.'}
      align="top"
      maxWidth={step === 'review' ? 880 : 500}
    >
      {step === 'upload' && (
        <StatementUpload
          accounts={accounts}
          defaultAccountId={defaultAccountId}
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
