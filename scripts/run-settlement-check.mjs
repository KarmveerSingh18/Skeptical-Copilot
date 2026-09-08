process.loadEnvFile('.env');
import { getExchange } from '../src/sdk/client.js';
import { pollSettledTrades, computeCalibrationSummary } from '../src/calibration/calibrationService.js';
import { readTradeLog } from '../src/calibration/tradeLog.js';

async function main() {
  console.log('--- Initial State ---');
  const initialTrades = readTradeLog();
  console.log('Total trades in log:', initialTrades.length);
  for (const t of initialTrades) {
    console.log(`Trade #${t.tradeNumber}: ${t.symbol} | side: ${t.proposedSide} | conf: ${t.statedConfidence} | outcome: ${t.outcome}`);
  }

  console.log('\n--- Running pollSettledTrades() ---');
  const ex = await getExchange();
  const pollResult = await pollSettledTrades(ex);
  console.log('Poll Results:');
  console.log(JSON.stringify(pollResult, null, 2));

  console.log('\n--- Calibration Summary ---');
  const updatedTrades = readTradeLog();
  const summary = computeCalibrationSummary(updatedTrades);
  console.log(JSON.stringify(summary, null, 2));
}

main().catch(console.error);
