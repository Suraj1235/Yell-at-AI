# Subtext Vocal Context

Use this skill when a user message contains a `<vocal-context schema="vocalcontext/v1">` block.

Treat the block as local evidence about delivery, not as a diagnosis. Use `assistant_guidance` as the response policy when present, use emphasis to identify words the user likely stressed, and use flags as confidence-graded evidence. If a flag is low-confidence or ambiguous, hedge your interpretation and ask a clarifying question only when it materially affects the coding task.

Flag handling:

- `yelling`: de-escalate, acknowledge urgency, and avoid matching intensity.
- `confusion`: slow down, clarify assumptions, and offer a concrete next step.
- `emphasis`: preserve the stressed constraint or object in your plan.
- `hesitation` / `uncertainty`: verify ambiguous choices before large changes.
- `urgency`: prioritize the shortest safe path and state tradeoffs plainly.

Never tell the user what emotion they are feeling. Prefer language like "you emphasized `whole`" or "the delivery suggests urgency" over "you are angry" or "you are anxious."
