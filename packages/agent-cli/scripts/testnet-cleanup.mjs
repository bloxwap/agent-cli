// Run-owned public approvals are recorded before signing so interrupted init or
// rotation can clean both agents without relying on the currently active config.
export async function cleanupTestnetAccount({
  info,
  cancel,
  revoke,
  masterAddress,
  agents,
}) {
  const result = { status: 'failed' };
  let failed = false;
  const query = (type) => info(type, { user: masterAddress });
  try {
    const orders = await query('frontendOpenOrders');
    if (!Array.isArray(orders)) throw new Error();
    for (const order of orders) {
      try {
        await cancel(order);
      } catch {
        failed = true;
      }
    }
  } catch {
    failed = true;
  }
  try {
    const approved = await query('extraAgents');
    if (!Array.isArray(approved)) throw new Error();
    for (const agent of approved) {
      const owned = agents.find(
        (candidate) =>
          candidate.address.toLowerCase() ===
            String(agent.address).toLowerCase() &&
          candidate.name === agent.name,
      );
      if (!owned) {
        failed = true;
        continue;
      }
      try {
        await revoke(owned);
      } catch {
        failed = true;
      }
    }
  } catch {
    failed = true;
  }
  // Independently inspect every boundary even if one request or cleanup failed.
  for (const [type, field] of [
    ['frontendOpenOrders', 'orders'],
    ['extraAgents', 'agents'],
    ['clearinghouseState', 'positions'],
  ]) {
    try {
      const state = await query(type);
      const values = field === 'positions' ? state.assetPositions : state;
      if (!Array.isArray(values)) throw new Error();
      result[field] =
        field === 'positions'
          ? values.filter(({ position }) => {
              const size = position?.szi;
              if (typeof size !== 'string' || !/^-?\d+(\.\d+)?$/.test(size))
                throw new Error();
              return !/^-?0+(\.0+)?$/.test(size);
            }).length
          : values.length;
      if (result[field] !== 0) failed = true;
    } catch {
      failed = true;
    }
  }
  if (!failed) result.status = 'verified';
  return result;
}
