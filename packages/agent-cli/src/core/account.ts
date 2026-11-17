import { parseUsdc, formatUsdc } from '../funding/amounts.js';
// Remove marked PnL so a price move cannot masquerade as receipt of a deposit.
export function collateralBalance(state: {
  marginSummary: { accountValue: string };
  assetPositions?: { position: { unrealizedPnl: string } }[];
}) {
  const equity = parseUsdc(state.marginSummary.accountValue, 18);
  const pnl = (state.assetPositions ?? []).reduce(
    (sum, { position }) => sum + parseUsdc(position.unrealizedPnl, 18),
    0n,
  );
  return formatUsdc(equity - pnl, 18);
}
