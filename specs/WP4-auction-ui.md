# WP4: Auction UI

**Goal:** players see the open auction, bid with their answers, get refunds, see who
designed today, and pay out the bonus. Repo: `swarm-derby-site`. Depends on WP1 and a
deployed WP3. Money: yes (the player's own wallet).

## Files

`dev/game.html` (edit), `index.html` (rebuild).

## Config

Add `auction: ''` to each network in `DERBY_CONFIG`, with the same local-devnet-only URL
override as the other addresses. Empty → none of this UI appears (R7).

## 1. Entry points

- Header button `AUCTION` left of `PRACTICE`, in the slam colour (fuchsia); shows `AUCTION · <lead> IMD` when there's a bid.
- On phones narrower than 380 px, a leaderboard footer link `Design tomorrow` instead.

## 2. Drawer (works without a wallet)

Reads `openDay()`, `auction(day)`, `minNextBid(day)`; refreshes every 15 s while open.

| Section | Content |
|---|---|
| Heading | `DESIGN <date of the theme day>` and a countdown to `end` |
| Leader | **amount and `shortAddr(leader)` only.** Never the leader's answers (R4) |
| What you win | "The swarm builds your batter and stadium for that day. Your whole bid is that day's bonus prize for the arcade top 3." (if `buildFee > 0`, say how much goes to the build) |
| Form | questions below, amount prefilled with `minNextBid`, `BID` |
| Footer | "Outbid bids are refunded automatically." `CLAIM REFUND` only when `refunds(you) > 0` |

### Questions

| Label | Control | Field |
|---|---|---|
| Your batter's creature | `SPIN` button: a random pick from the page's `creatureList` (real animals, living and extinct, 24 characters at most). Spin as often as you like | `creature`, and `title` (the day takes the creature's name) |
| Batter's vibe | Hype, Chill, Grumpy, Chaotic | `vibe` |
| Stadium | Moon, Beach, Cyber city, Volcano, Underwater, Desert | `stadium` |
| Weather (looks only) | Clear, Windy, Rain, Snow, Fog, Meteor shower | `weather` |
| Your X (Twitter) link | required: an `x.com` or `twitter.com` profile link or `@handle` (handle: 1–15 of A–Z a–z 0–9 _), placeholder "https://x.com/yourname"; the page shows the handle it read | `shoutout`, always sent as `https://x.com/<handle>` (29 characters at most) |

`BID` stays disabled until a creature is spun and the X link is valid. Under the creature:
"Spin as often as you like. The swarm draws an original batter of that kind, and the day
takes its name. Answers are reviewed before the day is built; a rejected design is
refunded."

### Flow

Connect if needed → approve exactly `amount` → `bid(day, amount, answers)` from the **main
wallet** (never the quick-swing key) → banner `YOU'RE LEADING`. Decode errors into plain
text alongside the existing `ERROR_TEXT`.

## 3. Today's credit and bonus

From the **published theme pack** (screened content), not the chain: if today's pack has a
`winner`, show under the leaderboard header
`TODAY: <title> · designed by <shoutout or shortAddr(winner)> · bonus <bonus> IMD`, with
`bonus` read from `auction(today)`. Show the bonus next to the arcade pot and include it in
the top-3 payout estimates.

## 4. Paying the bonus

Next to the existing `settleNextDay` button: for each recent day with
`auction(day).settled && !paid && !vetoed && bonus > 0` and `derby.dayClosed(0, day)`, offer
`PAY BONUS · EARN <0.5%> IMD` → `staticCall` then `payBonus(day)`. For each recent day whose
auction has ended with a leader but is not settled, offer `SETTLE` → `staticCall` then
`settle(day)`.

## Rules

Bid text never renders from the chain; pack text uses `textContent`; the drawer doesn't
capture the Space key; practice is unchanged.

## Done when (local devnet, like `e2e/`)

1. [ ] With no wallet, the drawer shows the open auction, lead amount, leader address and
       countdown, and **no** answer text.
2. [ ] A valid bid lands and the drawer shows the new leader.
3. [ ] A second wallet outbids; the first is refunded.
4. [ ] Invalid inputs are blocked in the browser; a forced invalid call shows the decoded
       contract error.
5. [ ] After `settle` and a published pack for that day, the credit and bonus appear.
6. [ ] After the day closes, a stranger's page offers and executes `PAY BONUS`; winners and
       tip are paid.
7. [ ] A pack shoutout of `<img src=x onerror=alert(1)>` (mocked past the validator)
       renders as plain text.
8. [ ] With `auction` unset, the page is identical to before.
