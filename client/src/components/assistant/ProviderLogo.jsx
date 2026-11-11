import { useState } from 'react';
import { Plug, Sparkles } from 'lucide-react';

const LOGODEV_TOKEN = import.meta.env.VITE_LOGODEV_TOKEN;

// Each AI provider's logo on logo.dev, by domain. Checked by eye: Gemini has no mark of its own there, so it shows Google's.
const DOMAINS = {
  anthropic: 'anthropic.com',
  openai: 'openai.com',
  gemini: 'gemini.google.com',
  openrouter: 'openrouter.ai',
  groq: 'groq.com',
  together: 'together.ai',
  deepseek: 'deepseek.com',
  mistral: 'mistral.ai',
  xai: 'x.ai',
};

/** An AI provider's logo on a light tile (some marks are black and would vanish on the dark UI). */
export default function ProviderLogo({ provider, size = 20 }) {
  const [failed, setFailed] = useState(false);
  const domain = DOMAINS[provider];
  const radius = Math.round(size * 0.26);

  if (!domain || !LOGODEV_TOKEN || failed) {
    const Icon = provider === 'custom' ? Plug : Sparkles;
    return (
      <span style={{ width: size, height: size, borderRadius: radius, flexShrink: 0, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--color-bg-elevated)' }}>
        <Icon size={Math.round(size * 0.55)} style={{ color: 'var(--color-text-secondary)' }} strokeWidth={1.6} />
      </span>
    );
  }
  const px = Math.max(64, size * 3);
  return (
    <span style={{ width: size, height: size, borderRadius: radius, flexShrink: 0, overflow: 'hidden', display: 'inline-flex', background: '#F4F2EE' }}>
      <img src={`https://img.logo.dev/${domain}?token=${LOGODEV_TOKEN}&size=${px}&format=png&fallback=404`}
        alt="" width={size} height={size} loading="lazy" onError={() => setFailed(true)}
        style={{ width: '100%', height: '100%', objectFit: 'contain' }} />
    </span>
  );
}
