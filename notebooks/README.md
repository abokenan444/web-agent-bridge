# WAB LoRA Fine-Tune Notebook

[`wab_lora_finetune_colab.ipynb`](wab_lora_finetune_colab.ipynb) — fine-tunes a small open model (default: **Qwen2.5-3B-Instruct**) on the 1500-record WAB agent dataset using **QLoRA via Unsloth**, on a free **Colab T4** GPU.

## Open in Colab

[![Open In Colab](https://colab.research.google.com/assets/colab-badge.svg)](https://colab.research.google.com/github/abokenan444/web-agent-bridge/blob/master/notebooks/wab_lora_finetune_colab.ipynb)

## What it teaches the model

The dataset (`datasets/wab-agent-v1.jsonl`) balances two patterns:

1. **Happy path** — agent receives a user request, calls `wab_live` against the WAB API, gets a green verify-live response, completes the action, returns the receipt id.
2. **Revoked refusal** — agent recognises a revoked / suspended domain in the `wab_live` response and refuses to transact, surfacing the `reason_code` and `appeal_deadline`.

After 2 epochs (~30 min on T4) the model reliably:

- Calls `wab_live` **before** any side-effecting action.
- Refuses on `revoked === "yes"` without retrying with different parameters.
- Quotes the revocation reason and appeal deadline in its refusal.

## Outputs

The notebook produces a LoRA adapter (~100 MB) you can:

- Load with `peft` on top of the base Qwen2.5-3B-Instruct model
- Optionally merge to a full 16-bit model (~6 GB)
- Optionally export to GGUF Q4\_K\_M (~2 GB) for `llama.cpp` / Ollama / LM Studio
- Optionally push to Hugging Face Hub

## License

The notebook + dataset are part of `web-agent-bridge` and ship under the project's MIT licence. The base model (`Qwen2.5-3B-Instruct`) is Apache-2.0.
