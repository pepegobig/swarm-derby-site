# Bash counter

The shared Swarm Derby bash counter (goal: 1,000,000 bashes), a Cloudflare Worker with one Durable Object.

- `GET /total` returns `{ total, goal }`; the game page shows it on the jumbotron.
- `POST /bash` with `{ "n": <bashes in one swing> }` adds a swing's bashes. Limits: 1 to 60 a swing, one report per
  visitor every 1.5 s, 3,000 bashes per visitor per hour. Practice swings count too.
- Every 10 minutes a cron adds one bash per Agents-league swing committed on SwarmDerby v2, since agents hit without
  bashing.

The counter is for fun: it holds no funds and nothing on chain reads it. Deploy with `npx wrangler deploy` here.
