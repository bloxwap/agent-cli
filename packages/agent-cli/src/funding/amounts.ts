import { AgentCliError } from '../errors/index.js';
function checkDecimals(decimals: number) {
  if (!Number.isInteger(decimals) || decimals < 0 || decimals > 30)
    throw new RangeError('Invalid decimals');
}
export function parseUsdc(value: string, decimals: number): bigint {
  checkDecimals(decimals);
  if (!/^-?\d+(\.\d+)?$/.test(value))
    throw new AgentCliError(
      'INVALID_SIZE',
      'Expected nonnegative decimal string',
    );
  const negative = value.startsWith('-');
  const [whole, fraction = ''] = (negative ? value.slice(1) : value).split('.');
  if (fraction.length > decimals)
    throw new AgentCliError('INVALID_SIZE', 'Too many decimal places');
  return (
    (negative ? -1n : 1n) *
    (BigInt(whole) * 10n ** BigInt(decimals) +
      BigInt(fraction.padEnd(decimals, '0') || '0'))
  );
}
export function formatUsdc(value: bigint, decimals: number): string {
  checkDecimals(decimals);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const scale = 10n ** BigInt(decimals);
  const fraction = (absolute % scale)
    .toString()
    .padStart(decimals, '0')
    .replace(/0+$/, '');
  return `${negative ? '-' : ''}${absolute / scale}${fraction ? '.' + fraction : ''}`;
}
export const toHyperCore = (evm: bigint) => evm * 100n;
export function fromHyperCore(core: bigint) {
  if (core % 100n !== 0n)
    throw new AgentCliError(
      'INVALID_SIZE',
      'Conversion would lose HyperCore precision',
    );
  return core / 100n;
}

// Expand finite JS numbers without scientific notation before exact parsing.
export function decimalNumber(value: number): string {
  if (!Number.isFinite(value))
    throw new AgentCliError('CONFIG_INVALID', 'Expected finite decimal');
  const text = String(value);
  if (!/[eE]/.test(text)) return text;
  const [coefficient, exponent] = text.toLowerCase().split('e');
  const negative = coefficient.startsWith('-');
  const [whole, fraction = ''] = coefficient.replace('-', '').split('.');
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  return (
    (negative ? '-' : '') +
    (point <= 0
      ? '0.' + '0'.repeat(-point) + digits
      : point >= digits.length
        ? digits + '0'.repeat(point - digits.length)
        : digits.slice(0, point) + '.' + digits.slice(point))
  );
}
