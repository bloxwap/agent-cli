import type { ReactNode } from 'react';
import { CopyButton } from './copy-button';

const SOURCE = `agent-cli schema order
agent-cli init --network testnet
# Complete external wallet approvals.
# Fund using a supported test route and show the QR.
agent-cli status --network testnet
# Wait for deposits to settle.
agent-cli run --network testnet --detach
agent-cli events --follow --since 0`;

// Highlight this fixed shell example with the same code roles as the other docs sites.
const TOKEN = /(#[^\n]*)|(--[a-z][\w-]*)|(\bagent-cli\b)|(\b(?:schema|order|init|status|run|events)\b)|(\btestnet\b|\b\d+\b)|([\s\S])/g;

function highlight(code: string): ReactNode[] {
  const output: ReactNode[] = [];
  let plain = '';

  const flush = () => {
    if (plain) output.push(plain);
    plain = '';
  };

  for (const [, comment, flag, executable, command, value, other] of code.matchAll(TOKEN)) {
    const text = comment ?? flag ?? executable ?? command ?? value ?? other;
    const className = comment ? 'syntax-muted'
      : flag ? 'syntax-type'
      : command ? 'syntax-keyword'
      : executable || value ? 'syntax-string'
      : null;

    if (className) {
      flush();
      output.push(<span className={className} key={output.length}>{text}</span>);
    } else {
      plain += text;
    }
  }

  flush();
  return output;
}

export function HeroCode() {
  return (
    <figure className="code-window" aria-label="Agent CLI onboarding workflow">
      <figcaption className="code-toolbar">
        <span className="window-dots" aria-hidden="true"><i /><i /><i /></span>
        <span className="code-caption">init → fund → status → run</span>
        <span className="code-actions">
          <span className="code-language">Shell</span>
          <CopyButton text={`${SOURCE}\n`} label="Copy workflow commands" />
        </span>
      </figcaption>
      <pre tabIndex={0} aria-label="Shell commands"><code>{highlight(SOURCE)}</code></pre>
    </figure>
  );
}
