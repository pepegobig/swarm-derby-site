// Swarm Derby bash counter: every bash (tap) toward 1,000,000, shown on the game's jumbotron.
//   GET  /total   -> { total, goal }
//   GET  /status  -> { total, goal, agentSwings, nextSwing, checkedAt }
//   POST /bash    { n } adds one swing's bashes (1..60), at most one report per visitor every 1.5 s and 3,000 bashes
//                 per visitor per hour. A visitor is one IPv4 address or one IPv6 /64, and the limits are stored, so a
//                 restart does not reset them. Practice swings count too; the counter is for fun and cannot move any funds.
// Agents hit without bashing, so a cron adds one bash per Agents-league swing on SwarmDerby v2. It reads the contract's
// nextSwingId and swings(id) at the latest block: free RPCs refuse log queries more than about 10,000 blocks back.
import { DurableObject } from "cloudflare:workers";

const GOAL = 1_000_000;
const MAX_PER_SWING = 60; // a 2.4 s bash window at about 25 taps a second
const MIN_GAP_MS = 1500;
const MAX_PER_HOUR = 3000;
const HOUR_MS = 3_600_000;
const ORIGINS = ["https://swarm-derby.sites.imd.fun", "https://swarm-derby.site.identitymd.eth.limo"];
const DERBY = "0x53d9aa0b925c5148bcc5f98f394872687f4c831c"; // SwarmDerby v2 on Robinhood Chain
const NEXT_SWING_ID = "0x3346caae"; // nextSwingId()
const SWINGS = "0x7903bd36"; // swings(uint256): player, league, ...
const AGENTS_LEAGUE = 1;
const RPCS = [
  "https://rpc.mainnet.chain.robinhood.com",
  "https://robinhood-rpc.publicnode.com",
  "https://robinhood.drpc.org",
  "https://4663.rpc.thirdweb.com",
];
const MAX_READS = 8; // swings read per cron run; with RPC fallbacks this stays under the free plan's 50 subrequests

export class BashCounter extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS kv (k TEXT PRIMARY KEY, v INTEGER NOT NULL)");
    this.sql.exec(
      "CREATE TABLE IF NOT EXISTS visitors (id TEXT PRIMARY KEY, since INTEGER NOT NULL, count INTEGER NOT NULL, last INTEGER NOT NULL)",
    );
  }
  read(k) {
    const rows = this.sql.exec("SELECT v FROM kv WHERE k = ?", k).toArray();
    return rows.length ? rows[0].v : 0;
  }
  has(k) {
    return this.sql.exec("SELECT 1 FROM kv WHERE k = ?", k).toArray().length > 0;
  }
  write(k, v) {
    this.sql.exec("INSERT INTO kv (k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v = excluded.v", k, v);
  }
  getStatus() {
    return {
      total: this.read("total"),
      goal: GOAL,
      agentSwings: this.read("agentSwings"),
      nextSwing: this.has("nextSwing") ? this.read("nextSwing") : null,
      checkedAt: this.read("checkedAt"),
    };
  }
  addBashes(visitor, n) {
    const now = Date.now();
    const rows = this.sql.exec("SELECT since, count, last FROM visitors WHERE id = ?", visitor).toArray();
    let v = rows.length ? rows[0] : null;
    if (!v || now - v.since > HOUR_MS) v = { since: now, count: 0, last: 0 };
    if (now - v.last < MIN_GAP_MS || v.count + n > MAX_PER_HOUR) return { ok: false, total: this.read("total") };
    this.sql.exec(
      "INSERT INTO visitors (id, since, count, last) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET since = excluded.since, count = excluded.count, last = excluded.last",
      visitor, v.since, v.count + n, now,
    );
    const total = this.read("total") + n;
    this.write("total", total);
    return { ok: true, total };
  }
  addAgentSwings(n, nextSwing) {
    if (n > 0) {
      this.write("total", this.read("total") + n);
      this.write("agentSwings", this.read("agentSwings") + n);
    }
    this.write("nextSwing", nextSwing);
    this.write("checkedAt", Date.now());
    this.sql.exec("DELETE FROM kv WHERE k = 'lastBlock'"); // left by the log-based version
    return this.getStatus();
  }
  pruneVisitors() {
    this.sql.exec("DELETE FROM visitors WHERE last < ?", Date.now() - HOUR_MS); // their hour is over, so they start fresh anyway
  }
}

// One visitor = one IPv4 address, or one IPv6 /64: a single connection can hold billions of IPv6 addresses.
function visitorKey(ip) {
  if (!ip.includes(":")) return ip;
  const parts = ip.split(":");
  if (parts[parts.length - 1].includes(".")) return parts[parts.length - 1]; // IPv4-mapped, ::ffff:1.2.3.4
  const [head, tail] = ip.split("::");
  const h = head ? head.split(":") : [];
  const t = tail ? tail.split(":") : [];
  const full = tail === undefined ? h : [...h, ...Array(8 - h.length - t.length).fill("0"), ...t];
  return full.slice(0, 4).map((x) => parseInt(x || "0", 16).toString(16)).join(":") + "::/64";
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

const call = (data) => rpc("eth_call", [{ to: DERBY, data }, "latest"]);

async function countAgentSwings(env) {
  const stub = counter(env);
  const nextHex = await call(NEXT_SWING_ID);
  const next = nextHex ? parseInt(nextHex, 16) : NaN;
  if (!Number.isSafeInteger(next)) return;
  const { nextSwing } = await stub.getStatus();
  if (nextSwing === null) return void (await stub.addAgentSwings(0, next)); // first run: count from now on
  let id = nextSwing, added = 0;
  for (; id < next && id < nextSwing + MAX_READS; id++) {
    const swing = await call(SWINGS + id.toString(16).padStart(64, "0"));
    if (!swing || swing.length < 130) break; // read it again on the next run
    if (parseInt(swing.slice(66, 130), 16) === AGENTS_LEAGUE) added++; // word 1 is the league
  }
  await stub.addAgentSwings(added, id);
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
      const visitor = visitorKey(request.headers.get("CF-Connecting-IP") || "unknown");
      const r = await counter(env).addBashes(visitor, n);
      return respond({ total: r.total }, origin, r.ok ? 200 : 429);
    }
    return respond({ error: "not_found" }, origin, 404);
  },
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([countAgentSwings(env), counter(env).pruneVisitors()]));
  },
};
