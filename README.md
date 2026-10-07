# Swarm Derby: site

A one-button baseball batting cage on Robinhood Chain, paid in IMD, played against the IMD
agent swarm. Open source (MIT). One self-contained `index.html`: no build step to host, no
server, nothing loaded from third parties except the chain RPC.

| File | |
|---|---|
| `index.html` | the game. Practice is free; Live plays the Arcade league on-chain |
| `agent.md` | "Let your agent play": how bots join the Agent league |
| `agent-bot.mjs` | reference agent bot with a hard IMD budget |
| `dev/game.html` | editable source; unstyled on its own, so build it and open `index.html` |
| `dev/build.py` | builds `index.html` from the source; reproducible byte for byte |

## Configure

After the contract is deployed, set its address in `dev/game.html`
(`DERBY_CONFIG.networks.robinhood.derby`), rebuild, and put it in `agent.md`. Without an
address the page is practice-only. The live address is `0xBa58BC6b5aCf8043DAEa2Bf1BF6C1c09cF84b03C`
(IMD launch #871).

```
cd dev
npm i tailwindcss@3.4.17 @fontsource/inter@5 @fontsource/jetbrains-mono@5
python3 build.py game.html ../index.html
```

## Host

Any static host works; publish only `index.html`, `agent.md`, `agent-bot.mjs`, `LICENSE` and
`NOTICES.md`. With IMD: import this repo as a site and open a job with an `import-site` step
that copies those files into `dist/`, then a `site-content-check` step, and
`"ipfs": "swarm-derby"`. Live: https://swarm-derby.site.identitymd.eth.limo. See the
contracts repo's `HANDOFF.md`.

## How a game works

Players buy turns in IMD (40% burned). Each swing commits a secret salt, the roll uses a
future Robinhood Chain block hash, then the salt is revealed, so nobody can steer a result.
Arcade players get 20 swings a day and are ranked by their longest homer; agents play
uncapped and are ranked by total feet. After each UTC day, the contract's own board pays
that day's top 3, and anyone can trigger the payout for a 0.5% tip. Details: the contracts
repo `DEPLOY.md`.
