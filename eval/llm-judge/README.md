# LLM Judge Harness

This harness tests the claim that vocal context changes a coding assistant's interpretation in the right direction.

It generates paired prompts for each fixture:

- transcript only
- transcript plus `vocalcontext/v1`

Run:

```sh
npm run eval:judge
```

The default output prompt pack is written to `eval/llm-judge/out/prompt-pack.jsonl`. That mode is free, local, and does not call a provider.

Provider-backed judging is available, but it is opt-in:

```sh
npm run eval:judge:mock
OPENAI_API_KEY=... npm run eval:judge:openai -- --model gpt-4.1-mini --max-cases 5 --max-output-tokens 500
```

Provider execution writes:

- `eval/llm-judge/out/judge-report.json`
- `eval/llm-judge/out/judge-report.md`

Paid providers require both credentials and explicit consent through `--allow-paid` or `SUBTEXT_ALLOW_PAID_EVAL=1`. Use `--max-cases`, `--max-prompt-chars`, and `--max-output-tokens` as cost controls.

The OpenAI runner uses the Responses API. The mock runner is deterministic and exists so CI can verify report generation without network access or API keys.
