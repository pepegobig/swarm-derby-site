# Bash counter

The shared Swarm Derby bash counter (goal: 1,000,000 bashes), a Cloudflare Worker with one Durable Object.

- `GET /total` returns `{ total, goal }`; the game page shows it on the jumbotron.
- `POST /bash` with `{ "n": <bashes in one swing> }` adds a swing's bashes. Limits: 1 to 60 a swing, one report per
  visitor every 1.5 s, 3,000 bashes per visitor per hour. A visitor is one IPv4 address or one IPv6 /64 (one
  connection can hold billions of IPv6 addresses), and the limits are stored in the Durable Object, so a restart does
  not reset them. Practice swings count too.
- Every 10 minutes a cron adds one bash per Agents-league swing on SwarmDerby v2, since agents hit without bashing.
  It reads `nextSwingId()` and `swings(id)` at the latest block (at most 8 swings a run), because free RPCs refuse log
  queries more than about 10,000 blocks back. `GET /status` shows the next swing id to read and the last check time.
  The same cron deletes stored visitor limits whose hour is over.

The counter is for fun: it holds no funds and nothing on chain reads it. Deploy with `npx wrangler deploy` here.
