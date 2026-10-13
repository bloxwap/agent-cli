import {expect,test} from 'vitest';
import {accountBalance,positions,expiryStatus,type AccountState} from '../src/commands/read.js';
import {migrate} from '../src/core/config.js';
export const accountFixture:AccountState={marginSummary:{accountValue:'100.12345678',totalMarginUsed:'4',totalNtlPos:'20'},withdrawable:'96',assetPositions:[{position:{coin:'BTC',szi:'0.001',entryPx:'20000',unrealizedPnl:'1',liquidationPx:'10000',leverage:{type:'cross',value:5}}}]};
test('read fixtures retain numeric strings and exact balances',()=>{expect(accountBalance(accountFixture).accountValueUnits).toBe('10012345678');expect(positions(accountFixture)[0]).toMatchObject({size:'0.001',leverage:'5',entryPrice:'20000'});expect(expiryStatus(migrate({agentExpiry:86400000}),0).warnings).toHaveLength(3);});
