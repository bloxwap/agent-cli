export function commandEnvelopeError(name, envelope) {
  const code =
    envelope && typeof envelope.code === 'string' ? envelope.code : 'UNKNOWN';
  const message =
    envelope && typeof envelope.message === 'string'
      ? envelope.message
      : 'Unknown error';
  return new Error(`Command ${name} failed: [${code}] ${message}`);
}

export function safeTestnetError(error, secrets = []) {
  let message = 'Unknown error';
  if (error instanceof Error || typeof error === 'string') {
    message = error instanceof Error ? error.message : error;
  } else if (error !== undefined && error !== null) {
    try {
      message = JSON.stringify(error) ?? String(error);
    } catch {
      message = String(error);
    }
  }
  for (const secret of secrets)
    if (typeof secret === 'string' && secret.length >= 4)
      message = message.split(secret).join('[REDACTED]');
  return message
    .replace(
      /-----BEGIN [^-]+PRIVATE KEY-----[\s\S]*?-----END [^-]+PRIVATE KEY-----/g,
      '[REDACTED]',
    )
    .replace(/[A-Za-z0-9+/]{80,}={0,2}/g, '[REDACTED]')
    .replace(/(?:0x)?[a-fA-F0-9]{64,}/g, '[REDACTED]')
    .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]');
}
