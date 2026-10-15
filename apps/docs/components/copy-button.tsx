'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { IconButton } from '@bloxwap/hig-react/button';

/** A compact HIG icon button that copies `text`, with a check mark and a screen-reader status on success. */
export function CopyButton({ text, label }: { text: string; label: string }) {
  const pending = useRef(false);
  const [result, setResult] = useState<'copied' | 'failed' | null>(null);

  useEffect(() => {
    if (result === null) return;
    const timer = window.setTimeout(() => setResult(null), result === 'copied' ? 2000 : 5000);
    return () => window.clearTimeout(timer);
  }, [result]);

  async function copy() {
    if (pending.current) return;
    pending.current = true;
    try {
      await navigator.clipboard.writeText(text);
      setResult('copied');
    } catch {
      setResult('failed');
    } finally {
      pending.current = false;
    }
  }

  return <>
    <IconButton intent="ghost" label={label} data-shape="icon" data-hig-density="compact" title={result === 'copied' ? 'Copied!' : label} onClick={copy}>
      {result === 'copied' ? <Check /> : <Copy />}
    </IconButton>
    <span role="status" className={result === 'failed' ? 'copy-feedback' : 'hig-sr-only'}>
      {result === 'copied' ? 'Code copied to clipboard.' : result === 'failed' ? 'Could not copy. Select the code to copy it manually.' : ''}
    </span>
  </>;
}
