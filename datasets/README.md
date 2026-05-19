# WAB Agent Adoption Datasets

Open fine-tuning data designed to teach LLMs the **WAB safety contract**:

> Before any third-party site interaction, discover → verify-live → refuse
> if revoked → execute via WAB action or ATP.

The data trains the model to **never bypass the revocation gate**, even when
the user demands a fast purchase.

---

## Files

| File | Records | Format | License |
|---|---|---|---|
| `wab-agent-v1.jsonl` | 1500 (default) | OpenAI / Anthropic chat-completion JSONL | MIT |
| `SAMPLE.md` | 5 inline | Markdown preview | MIT |

Each line of the JSONL is a complete training example:

```json
{
  "messages": [
    { "role": "system",    "content": "<WAB canonical system prompt>" },
    { "role": "user",      "content": "<task>" },
    { "role": "assistant", "content": null, "tool_calls": [...] },
    { "role": "tool",      "tool_call_id": "...", "content": "<JSON result>" },
    { "role": "assistant", "content": "<final answer>" }
  ],
  "meta": { "id": "wab-...", "pattern": "happy|revoked|no_wab|atp|read_only" }
}
```

## Pattern mix

| Pattern     | Weight | What it teaches |
|-------------|-------:|---|
| `happy`     | 45%    | Normal flow: discover → verify-live OK → execute |
| `revoked`   | 20%    | Tool returns `stage: "revoked"` → model must refuse + surface reason |
| `no_wab`    | 15%    | Site has no `.well-known/wab.json` → refuse to transact, suggest alternative |
| `atp`       | 12%    | Two-step ATP flow: `atp_intent` → `atp_execute`, preserve receipt |
| `read_only` | 8%     | Read-only task, no mutation, even on WAB-verified domain |

## Regenerate

```bash
node scripts/build-agent-dataset.js --count 5000
```

The generator is deterministic only up to the random seed of the host
process; do not commit large regenerations without a corresponding
version bump (current schema: `v1`).

## Fine-tuning recipes

**OpenAI**
```bash
openai api fine_tunes.create -t datasets/wab-agent-v1.jsonl -m gpt-4o-mini-2024-07-18
```

**Anthropic** — use the Claude fine-tuning API once enabled on your account; the JSONL is already in the supported `messages` shape.

**Local LoRA (Llama 3 / Mistral)** — feed the JSONL through `axolotl`
or `unsloth` with `chat_template: chatml`. The `system` message is
identical for every record so it compresses well.

## Versioning

`v1` schema (current):
- Single tool `wab_live` for discover + verify + execute.
- Two-tool variant `atp_intent` + `atp_execute` for payments.
- System prompt pinned to `SYSTEM_PROMPT_VERSION = 1.0.0`.

A schema bump (`v2`) will only happen if the canonical system prompt
or tool surface changes incompatibly.

## License

MIT — same as the rest of Web Agent Bridge. Examples may be redistributed
and fine-tuned upon freely. Attribution appreciated: cite as
"Web Agent Bridge — WAB Agent Adoption Dataset v1 (2026)".
