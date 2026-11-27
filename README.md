# Poker Bench

Run a five-seat poker game with models of your choice. Watch the table, read the chat, and replay each decision.

## Start the app

Install Node.js 22.9 or later. The app has no package dependencies.

```sh
git clone https://github.com/Sahaj0312/poker-bench.git
cd poker-bench
npm start
```

Open [the local table](http://localhost:4395). The first screen shows a recorded demo. You can use the demo without an API key. The [hosted viewer](https://river-room-ai-poker.grainymeter8.chatgpt.site) also runs demos and opens replay files.

The app opens in dark mode. Use the theme button in the top bar to switch between light and dark.

## Play a seat

1. Select **New session**.
2. Set **Your role** to **Play a seat**. Enter your name and select the seat to replace.
3. Choose **Demo players** for practice or **Live models** for your local provider lineup. Only the four model opponents need connections.
4. Start the session. On your turn, choose a legal move. Use **Table chat** to send a message at any time during live play. Every seat can read the shared conversation. Each chat-capable model decides independently whether to start a conversation, reply to anyone, or stay quiet, even after folding. A mention is public. Messages, betting actions, board cards, and hand results wake the seats. Independent background checks also run about every 35–60 seconds during play. Each check uses a separate provider call with the same seat perspective as a bet. Each seat waits at least 12 seconds between chat checks. The dealer continues betting while they run. Duplicate deals reset the chat visible to models on each rotation.

Human games use continuous stacks. Each seat gets 30 seconds per move and an automatic 90-second reserve for the session. Duplicate rotations reset the reserve. When time expires, the dealer checks if possible. Otherwise, it folds. The public hand history and fairness log identify the timeout. Model opponents see the same move times and chat as the human player.

When betting closes with the contenders all-in or already matched against an all-in player, their cards turn face up for the remaining board. At showdown, the table shows the hands and payouts before the next deal. Select **View result** below the table to review any completed hand. At a contested showdown each pot winner shows both cards. Other hands auto-muck unless already face up. A player can select the left, right, or both cards to show at hand end with a betting action. The last selection applies if the player stays in the hand. An uncontested winner can show voluntarily. Other local browser profiles receive only public cards. The full replay becomes available when the session ends. During a human session the local log contains public events. The dealer releases full cards and decision reports when the session completes or its owner selects **End session**. An unexpected dealer exit retains only public history for that human session. The host controls the dealer process. Use the same browser profile to return to a local seat after a refresh.

Select **Sit out next hand** to finish your hand and skip new deals. Select **Return on big blind** to rejoin when the big blind reaches your seat. The dealer skips a missed small blind and advances the big blind to the next eligible seat. After 30 seconds without a seat heartbeat, the dealer marks the seat disconnected at its next five-second check. An open hand keeps its normal clock. **Leave table** vacates the seat, checks or folds the current hand, and lets the other players finish. **End session** stops the whole table.

Hosted practice runs in a browser worker. Keep the tab open until the game ends. The browser saves the finished replay in **Sessions**.

## Connect your models

1. Open **Model lineup** in the local app.
2. Open a seat. Give it a unique name.
3. Select a provider. Check the endpoint.
4. Enter your API key if the provider requires one.
5. Select **List models** to load model IDs from the provider. You can also enter an ID directly.
6. Repeat these steps for the other seats. Select **Save lineup**.
7. Select **New session**. Set **Players** to **Live models**.
8. Select the game format, hand count, starting stack, and small blind. Select **Start session**.

You can test five different models or put the same model in several seats. Give each seat a different name. The dealer fixes the lineup when the session starts. Each replay contains the seat names, model IDs, and provider endpoints.

| Provider | Connection |
| --- | --- |
| OpenAI, Google Gemini, OpenRouter | Select the provider preset. Use a model that accepts chat completions. |
| Anthropic | Use the Messages API. |
| TypeSafe Jev | Use the System One decision API. Jev can read chat and select a move. It plays silently. |
| Local model server | Use a chat completions endpoint on localhost. An API key is optional. |
| Custom endpoint | Enter the full inference URL. Select the matching protocol. |
| ChatGPT subscription | Install the Codex CLI. Run `codex login` and select ChatGPT. Enter a model ID available to your account. |

Codex is optional. Any seat can use it. Each Codex turn starts in a new temporary directory with tool restrictions. Provider model lists depend on the account and endpoint. If a provider does not expose a list, enter its model ID.

### Supply keys through the environment

Copy `.env.example` to `.env`. Set the fields for each seat. The original slot names, such as `RIVER_ASTRA_`, identify configuration entries. The `NAME` field sets the name shown at the table.

A saved lineup takes priority over environment settings. The server can use an environment key when the saved protocol and endpoint match the environment configuration. An endpoint change requires a key for the new destination.

The server listens on loopback. Keys entered in the app are stored as plain text in `data/players.json` with owner-only file permissions. Git ignores `.env` and `data/`. Replay exports omit keys. Model calls use your own provider accounts.

## Compare results

| Format | Rules | Result |
| --- | --- | --- |
| Continuous stacks | Chips and public history carry into the next hand. The dealer button moves. | Final chip balance |
| Duplicate deals | Each five-hand block uses one deck and button. Every model plays each position once. Stacks and history reset before each rotation. | Cumulative net chips |

Use complete five-hand blocks for a duplicate-deal comparison. Use several independent blocks before drawing conclusions about skill. A single session describes one outcome.

The dealer controls the shuffle, legal actions, and payouts. It publishes a SHA-256 seed commitment before the first decision. It reveals the seed when the session ends. Each seat sees its own cards, public events, and previous move times. Research spectators can see all cards in a model-only game. A human game withholds private information throughout play, including after the human leaves.

When a lineup includes TypeSafe, every seat receives the same legal raise totals. The dealer offers the minimum raise, half-pot, pot, double-pot, and all-in when legal. It calculates pot fractions after the call and removes duplicate amounts. Other lineups can use any legal whole-chip raise. The fairness log identifies the rule used in each session.

Each live turn uses the base clock and the remaining reserve. Recorded response time includes provider and network latency. The clock excludes failed attempts and pauses for a retry. Demo response times come from a seeded simulation.

### Table rules

The default table uses play chips, fixed blinds, no rake, and one runout. To collect rake, set a whole percentage and a chip cap in **New session**. The dealer takes whole chips after the flop, applies one cap across the contested pots, and returns uncalled bets in full. The house rules permit talk about the current hand, including a claim about hole cards. GGPoker restricts that speech and uses different time-bank and cash-game rules. [GGPoker security policy](https://ggpoker.com/network/security-ecology-policy/) · [GGPoker house rules](https://legal.ggpoker.com/house-rules/)

## Inspect a decision

Open **Hand replay → Decision records**. Select a player and a hand. Open a betting request or chat check to inspect the seat input, public messages, instructions, returned choice, and dealer timestamps. **View table at this request** moves the replay to the input event. Each new model recording keeps an input fingerprint. The viewer recomputes it from the recorded event prefix, chat prefix, clock, and private note. This preserves the input even if more messages arrived while the model was responding.

Text-capable models can include a short decision basis and a private plan. The next betting or chat request for that seat receives its most recent betting plan. Duplicate rotations clear this memory. These are model-authored explanations. Private inference steps are unavailable. A recorded message establishes that the dealer supplied it. A model can report using it. Establishing its effect on a bet requires a controlled comparison. Producing the report can itself change response time or play.

A choice-only provider supplies a move. Practice policies supply scripted choices. Older sessions contain only the evidence their dealer recorded. The viewer displays an absent explanation explicitly.

## Replay a session

Use the timeline to select an event. Use the hand menu to jump to a deal. Select **Table pace** to reproduce recorded decision times.

- **Actions** shows bets, timing, showdown cards, and payouts.
- **Fairness log** checks the seed and rebuilds the game from recorded moves. New recordings also check a SHA-256 digest over the chat, inputs, reports, and event stream. A stopped recording can check this digest. The digest is stored with the file and carries no independent signature.
- **Export replay** saves a JSON file with cards, chat, and available decision records.
- **Sessions** opens a stored session or imports a replay, including older River Room recordings.

Live logs stay in `data/<session-id>.jsonl`. The browser stores demos and imported recordings in IndexedDB. Closing the browser leaves the local dealer running. If a provider returns a configuration or protocol error, the dealer pauses before it changes the game state. Fix the connection and retry the turn, or end the session. A server restart preserves a partial replay. Model-only tables journal pending and returned requests as play proceeds.

## Run the checks

```sh
npm test
```

The tests cover hand ranking, side pots, chip conservation, timing, private information, duplicate deals, provider requests, custom lineups, and replay verification. Provider integration tests use local fixtures.

## Write a change

Start each commit subject with a verb. Describe one change. Use short sentences in instructions. Use the same term for the same part of the system. Keep the exact names of provider fields, commands, and poker rules.

## Provider references

[Codex authentication](https://developers.openai.com/codex/auth/) · [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create) · [Gemini chat completions](https://ai.google.dev/gemini-api/docs/openai) · [TypeSafe System One](https://docs.typesafe.ai/api/system-one)
