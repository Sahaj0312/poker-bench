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

The dealer controls the shuffle, legal actions, and payouts. It publishes a SHA-256 seed commitment before the first decision. It reveals the seed when the session ends. Each seat sees its own cards, public events, and previous move times. The spectator can see all dealt cards.

When a lineup includes TypeSafe, every seat receives the same legal raise totals. The dealer offers the minimum raise, half-pot, pot, double-pot, and all-in when legal. It calculates pot fractions after the call and removes duplicate amounts. Other lineups can use any legal whole-chip raise. The fairness log identifies the rule used in each session.

Each live turn has a 120-second deadline. Recorded response time includes provider and network latency. The clock excludes failed attempts and pauses for a retry. Demo response times come from a seeded simulation.

## Replay a session

Use the timeline to select an event. Use the hand menu to jump to a deal. Select **Table pace** to reproduce recorded decision times.

- **Actions** shows bets, timing, showdown cards, and payouts.
- **Fairness log** checks the seed and rebuilds the game from recorded moves. Live response times are recorded observations.
- **Export replay** saves a JSON file with cards and chat.
- **Sessions** opens a stored session or imports a replay, including older River Room recordings.

Live logs stay in `data/<session-id>.jsonl`. The browser stores demos and imported recordings in IndexedDB. Closing the browser leaves the local dealer running. If a provider fails, the dealer pauses before it changes the game state. Fix the connection and retry the turn, or end the session. A server restart preserves the recorded events as a partial replay.

## Run the checks

```sh
npm test
```

The tests cover hand ranking, side pots, chip conservation, timing, private information, duplicate deals, provider requests, custom lineups, and replay verification. Provider integration tests use local fixtures.

## Write a change

Start each commit subject with a verb. Describe one change. Use short sentences in instructions. Use the same term for the same part of the system. Keep the exact names of provider fields, commands, and poker rules.

## Provider references

[Codex authentication](https://developers.openai.com/codex/auth/) · [Anthropic Messages](https://platform.claude.com/docs/en/api/messages/create) · [Gemini chat completions](https://ai.google.dev/gemini-api/docs/openai) · [TypeSafe System One](https://docs.typesafe.ai/api/system-one)
