#!/usr/bin/env node
// Swarm Derby reference agent: plays the AGENT league non-stop until its budget runs out.
//
//   npm i ethers@6
//   RPC_URL=https://rpc.mainnet.chain.robinhood.com \
//   PRIVATE_KEY=0x...            \  # the agent's own wallet: IMD for turns, a little ETH for gas
//   DERBY=0x...                  \  # SwarmDerby address
//   MAX_IMD=5                    \  # hard budget: total IMD this run may spend on turns
//   QUALITY=100                  \  # 1-100; 100 is a perfect swing (see agent.md)
//   node agent-bot.mjs
//
// Optional: PACKS_PER_BUY (default 2), MAX_SWINGS (default unlimited), VELO (default 100),
// MAX_GWEI (default 1: the highest gas price the agent signs), CHAIN_ID (default 4663) and
// IMD (default: IMD on Robinhood Chain). The agent signs only for CHAIN_ID, so a wrong or
// hostile RPC cannot move it to another chain.

import { ethers } from 'ethers';

const env = (k, d) => (process.env[k] ?? d);
const RPC_URL = env('RPC_URL', 'https://rpc.mainnet.chain.robinhood.com');
const PRIVATE_KEY = env('PRIVATE_KEY', '').trim();
const DERBY = env('DERBY');
const MAX_IMD = ethers.parseEther(env('MAX_IMD', '5'));
const QUALITY = Number(env('QUALITY', '100'));
const VELO = Number(env('VELO', '100'));
const PACKS_PER_BUY = BigInt(env('PACKS_PER_BUY', '2'));
const MAX_SWINGS = Number(env('MAX_SWINGS', 'Infinity'));
const MAX_FEE = ethers.parseUnits(env('MAX_GWEI', '1'), 'gwei');
const CHAIN_ID = Number(env('CHAIN_ID', '4663'));
const IMD = env('IMD', '0x5F7Bb59365ce557C26dbcAa4EE9d39A4b95B7127');
const AGENT = 1;

if (!PRIVATE_KEY || !DERBY) {
  console.error('Set PRIVATE_KEY and DERBY (and usually MAX_IMD). See agent.md.');
  process.exit(1);
}
if (!(QUALITY >= 1 && QUALITY <= 100) || !(VELO >= 0 && VELO <= 100)) {
  console.error('QUALITY must be 1-100 and VELO 0-100.');
  process.exit(1);
}

const ABI = [
  'function imd() view returns (address)',
  'function packPrice() view returns (uint256)',
  'function turns(uint8 league, address player) view returns (uint256)',
  'function buyPacks(uint8 league, uint256 packs)',
  'function swing(uint8 league, uint8 quality, uint8 velo, bytes32 commit) returns (uint256)',
  'function finalize(uint256 swingId, bytes32 salt) returns (uint8, uint16)',
  'function expire(uint256 swingId)',
  'function swings(uint256) view returns (address player, uint8 league, uint8 quality, uint8 velo, uint8 status, uint64 committedAt, bytes32 commit, uint32 day, bytes32 drawHash)',
  'function currentDay() view returns (uint256)',
  'function dayScore(uint8 league, uint256 day, address player) view returns (uint256)',
  'event SwingCommitted(uint256 indexed swingId, address indexed player, uint8 league, uint8 quality, uint8 velo, uint64 committedAt)',
  'event SwingResolved(uint256 indexed swingId, address indexed player, uint8 tier, uint16 feet)'
];
const ERC20 = [
  'function balanceOf(address) view returns (uint256)',
  'function allowance(address, address) view returns (uint256)',
  'function approve(address, uint256) returns (bool)'
];
const TIERS = ['WHIFF', 'FOUL', 'POP', 'HOMER', 'BOMB', 'SLAM'];

// No read cache: on ~100ms blocks ethers' default 250ms cache can return a stale nonce
// right after a confirmed transaction.
const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, {
  staticNetwork: ethers.Network.from(CHAIN_ID), cacheTimeout: -1
});
provider.pollingInterval = 200;
let wallet;
try {
  wallet = new ethers.Wallet(PRIVATE_KEY, provider);
} catch (e) {
  // ethers puts the bad value in its error; never print the key.
  console.error('PRIVATE_KEY is not a valid private key (0x and 64 hex characters).');
  process.exit(1);
}
const derby = new ethers.Contract(DERBY, ABI, wallet);
// Every transaction pays at most MAX_GWEI per gas, whatever fee the RPC suggests.
const fee = { maxFeePerGas: MAX_FEE, maxPriorityFeePerGas: 0n };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const COMMITTED = 1n, DRAWN = 2n; // Status: None, Committed, Drawn, Final, Refunded
const DRAW_WAIT_MS = 5 * 60_000 + 15_000; // DRAW_WINDOW and a margin for the chain clock

async function send(txPromise) {
  const tx = await txPromise;
  const rc = await tx.wait();
  if (rc.status !== 1) throw new Error(`reverted: ${tx.hash}`);
  return rc;
}

function event(rc, name) {
  for (const log of rc.logs) {
    try {
      const ev = derby.interface.parseLog(log);
      if (ev && ev.name === name) return ev;
    } catch (e) {}
  }
  throw new Error(`no ${name} in ${rc.hash}`);
}

async function main() {
  const me = wallet.address;
  if (Number(await provider.send('eth_chainId', [])) !== CHAIN_ID) throw new Error(`the RPC is not chain ${CHAIN_ID}`);
  if ((await derby.imd()).toLowerCase() !== IMD.toLowerCase()) throw new Error('DERBY does not take the IMD token; check the address');
  const imd = new ethers.Contract(IMD, ERC20, wallet);
  let spent = 0n;
  let swings = 0;
  let totalFeet = 0;
  let undrawn = 0;
  console.log(`agent ${me} · quality ${QUALITY} · budget ${ethers.formatEther(MAX_IMD)} IMD`);

  while (swings < MAX_SWINGS) {
    // 1. Turns: buy more only while the budget allows
    if ((await derby.turns(AGENT, me)) === 0n) {
      const cost = (await derby.packPrice()) * PACKS_PER_BUY;
      if (spent + cost > MAX_IMD) { console.log('budget reached, stopping'); break; }
      if ((await imd.balanceOf(me)) < cost) { console.log('out of IMD, stopping'); break; }
      if ((await imd.allowance(me, DERBY)) < cost) await send(imd.approve(DERBY, cost, fee));
      await send(derby.buyPacks(AGENT, PACKS_PER_BUY, fee));
      spent += cost;
      console.log(`bought ${PACKS_PER_BUY * 5n} turns · spent ${ethers.formatEther(spent)} IMD`);
    }

    // 2. Commit: a fresh secret salt per swing; only its hash goes on-chain
    const salt = ethers.hexlify(ethers.randomBytes(32));
    const commit = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(['bytes32', 'address'], [salt, me]));
    const committed = event(await send(derby.swing(AGENT, QUALITY, VELO, commit, fee)), 'SwingCommitted');
    const swingId = committed.args.swingId;

    // 3. Wait for the house draw (normally a few seconds), then reveal. With no draw in
    //    5 minutes, expire gives the turn back.
    const deadline = Date.now() + DRAW_WAIT_MS;
    let status;
    while ((status = (await derby.swings(swingId)).status) === COMMITTED && Date.now() < deadline) await sleep(250);
    if (status === COMMITTED) {
      await send(derby.expire(swingId, fee));
      console.log(`#${swingId} no draw in 5 minutes: turn given back`);
      if (++undrawn >= 3) { console.log('the house is not drawing, stopping'); break; }
      continue;
    }
    if (status !== DRAWN) continue;
    undrawn = 0;
    const resolved = event(await send(derby.finalize(swingId, salt, fee)), 'SwingResolved');
    const tier = Number(resolved.args.tier);
    const feet = Number(resolved.args.feet);
    swings += 1;
    if (tier >= 3) totalFeet += feet;
    console.log(`#${swingId} ${TIERS[tier]}${feet ? ' ' + feet + ' ft' : ''} · run total ${totalFeet} ft`);
  }

  const day = await derby.currentDay();
  console.log(`done: ${swings} swings, ${totalFeet} ft this run, ${await derby.dayScore(AGENT, day, me)} ft on today's agent board`);
}

main().catch((e) => { console.error(e.shortMessage || e.message); process.exit(1); });
