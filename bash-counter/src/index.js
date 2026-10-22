// Swarm Derby bash counter: every bash (tap) toward 1,000,000, shown on the game's jumbotron.
//   GET  /total   -> { total, goal }
//   GET  /status  -> { total, goal, agentSwings, lastBlock }
//   POST /bash    { n } adds one swing's bashes (1..60), at most one report per visitor every 1.5 s and 3,000 bashes
//                 per visitor per hour. Practice swings count too; the counter is for fun and cannot move any funds.
// Agents hit without bashing, so a cron adds one bash per Agents-league swing committed on SwarmDerby v2.
import { DurableObject } from "cloudflare:workers";

const GOAL = 1_000_000;
const MAX_PER_SWING = 60; // a 2.4 s bash window at about 25 taps a second
const MIN_GAP_MS = 1500;
const MAX_PER_HOUR = 3000;
const ORIGINS = ["https://swarm-derby.sites.imd.fun", "https://swarm-derby.site.identitymd.eth.limo"];
const DERBY = "0x53d9aa0b925c5148bcc5f98f394872687f4c831c"; // SwarmDerby v2 on Robinhood Chain
const SWING_COMMITTED = "0xa91490f69f4d4b738be71fd6a1a4ab25b25b3a396f809bb9597096cc76442df0";
const AGENTS_LEAGUE = 1;
const RPCS = [
  "https://rpc.mainnet.chain.robinhood.com",
  "https://robinhood-rpc.publicnode.com",
  "https://robinhood.drpc.org",
  "https://4663.rpc.thirdweb.com",
];
const LOG_STEP = 10_000; // blocks per eth_getLogs call
const MAX_STEPS = 20; // per cron run, well under the subrequest limit

export class BashCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
    this.visitors = new Map(); // in memory only; it resets when the object restarts, which is fine for a rate limit
  }
  read(k) {
    const rows = this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray();
    return rows.length ? rows[0].v : 0;
  }
  write(k, v) {
    this.sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
  }
  getStatus() {
    return { total: this.read("total"), goal: GOAL, agentSwings: this.read("agentSwings"), lastBlock: this.read("lastBlock") };
  }
  addBashes(visitor, n) {
    const now = Date.now();
    let v = this.visitors.get(visitor);
    if (!v || now - v.since > 3_600_000) v = { since: now, count: 0, last: 0 };
    if (now - v.last < MIN_GAP_MS || v.count + n > MAX_PER_HOUR) return { ok: false, total: this.read("total") };
    v.last = now;
    v.count += n;
    if (this.visitors.size > 50_000) this.visitors.clear();
    this.visitors.set(visitor, v);
    const total = this.read("total") + n;
    this.write("total", total);
    return { ok: true, total };
  }
  addAgentSwings(n, lastBlock) {
    if (n > 0) {
      this.write("total", this.read("total") + n);
      this.write("agentSwings", this.read("agentSwings") + n);
    }
    this.write("lastBlock", lastBlock);
    return this.getStatus();
  }
}

const counter = (env) => env.COUNTER.get(env.COUNTER.idFromName("global"));

function respond(body, origin, status = 200, cache = "no-store") {
  return new Response(status === 204 ? null : JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": cache,
      "Access-Control-Allow-Origin": ORIGINS.includes(origin) ? origin : ORIGINS[0],
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Max-Age": "86400",
      Vary: "Origin",
    },
  });
}

async function rpc(method, params) {
  for (const url of RPCS) {
    try {
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      });
      if (!r.ok) continue;
      const j = await r.json();
      if (j && j.result !== undefined && !j.error) return j.result;
    } catch {}
  }
  return null;
}

async function countAgentSwings(env) {
  const stub = counter(env);
  const headHex = await rpc("eth_blockNumber", []);
  if (!headHex) return;
  const head = parseInt(headHex, 16);
  const { lastBlock } = await stub.getStatus();
  if (!lastBlock) return void (await stub.addAgentSwings(0, head)); // first run: count from now on
  let from = lastBlock + 1, added = 0, done = lastBlock;
  for (let i = 0; i < MAX_STEPS && from <= head; i++) {
    const to = Math.min(head, from + LOG_STEP - 1);
    const logs = await rpc("eth_getLogs", [
      { address: DERBY, topics: [SWING_COMMITTED], fromBlock: "0x" + from.toString(16), toBlock: "0x" + to.toString(16) },
    ]);
    if (logs === null) break;
    for (const l of logs) if (parseInt(l.data.slice(2, 66), 16) === AGENTS_LEAGUE) added++;
    done = to;
    from = to + 1;
  }
  if (done > lastBlock) await stub.addAgentSwings(added, done);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const origin = request.headers.get("Origin") || "";
    if (request.method === "OPTIONS") return respond(null, origin, 204);
    if (request.method === "GET" && url.pathname === "/total") {
      const { total, goal } = await counter(env).getStatus();
      return respond({ total, goal }, origin, 200, "public, max-age=3");
    }
    if (request.method === "GET" && url.pathname === "/status") return respond(await counter(env).getStatus(), origin);
    if (request.method === "POST" && url.pathname === "/bash") {
      let n;
      try {
        n = (await request.json()).n;
      } catch {
        return respond({ error: "bad_json" }, origin, 400);
      }
      if (!Number.isInteger(n) || n < 1 || n > MAX_PER_SWING) return respond({ error: "bad_n" }, origin, 400);
      const visitor = request.headers.get("CF-Connecting-IP") || "unknown";
      const r = await counter(env).addBashes(visitor, n);
      return respond({ total: r.total }, origin, r.ok ? 200 : 429);
    }
    return respond({ error: "not_found" }, origin, 404);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(countAgentSwings(env));
  },
};
