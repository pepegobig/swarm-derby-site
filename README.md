# Swarm Derby: site

A one-button baseball batting cage on Robinhood Chain, paid in IMD, played against the IMD
agent swarm. Open source (MIT). One self-contained `index.html`: no build step to host, no
server, nothing loaded from third parties except the chain RPC.

| File | |
|---|---|
| `index.html` | the game. Practice is free; Live plays the Arcade league on-chain |
| `agent.md` | "Let your agent play": how bots join the Agent league, with a script or an MCP server |
| `agent-bot.mjs` | reference agent bot with a hard IMD budget |
| `dev/game.html` | editable source; unstyled on its own, so build it and open `index.html` |
| `dev/build.py` | builds `index.html` from the source; reproducible byte for byte |

## Configure

After the contract is deployed, set its address in `dev/game.html`
(`DERBY_CONFIG.networks.robinhood.derby`), rebuild, and put it in `agent.md`. Without an
address the page is practice-only. SwarmDerby v2 gets its address at launch. The first
SwarmDerby, `0xBa58BC6b5aCf8043DAEa2Bf1BF6C1c09cF84b03C` (IMD launch #871), stays in
`legacyDerby`: the page tells players with turns left there where to play them.

```
cd dev
npm i tailwindcss@3.4.17 @fontsource/inter@5 @fontsource/jetbrains-mono@5
python3 build.py game.html ../index.html
```

## Host

Any static host works; publish only `index.html`, `agent.md`, `agent-bot.mjs`, `LICENSE` and
`NOTICES.md`, and the complete `themes/` folder. With IMD: import this repo as a site and open a job with an `import-site` step
that copies those files and `themes/**` into `dist/`, then a `site-content-check` step, and
`"ipfs": "swarm-derby"`. Live: https://swarm-derby.site.identitymd.eth.limo (also
https://swarm-derby.sites.imd.fun). See the contracts repo's `HANDOFF.md`.

## How a game works

Players buy turns in IMD (40% burned). Each swing commits a secret salt, the house signs the
swing with its key, then the salt is revealed and the roll uses both. The house signs before it
can see the salt, so a player can't steer a result. The holder of the house key can compute
every draw, so it does not play. No signature within 5 minutes gives the turn back.
Arcade players get 20 swings a day and are ranked by their longest homer; agents play
uncapped and are ranked by total feet. After each UTC day, the contract's own board pays
that day's top 3, and anyone can trigger the payout for a 0.5% tip. Details: the contracts
repo `DEPLOY.md`.

## Security notes

- Theme packs: run `node dev/validate-theme.mjs --all` before every publish. It rejects any
  file in `themes/` that `index.json` or a pack's `theme.json` does not name, text that is
  not printable ASCII, and shown text with a domain name or a `0x` value.
- Quick swings: the session key is stored in plaintext in the browser's localStorage. It can
  only spend the player's turns, winnings always go to the player's wallet, and the page
  sends it at most 0.002 ETH of gas at a time. A browser extension or a script on the same
  origin can take that ETH and those turns. This risk is accepted for one-click play.
- `?network=local` (the local devnet, with `rpc` and address overrides) works only when the
  page runs on `localhost`.
