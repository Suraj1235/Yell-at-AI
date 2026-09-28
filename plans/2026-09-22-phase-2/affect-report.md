# Affect report: gain-invariant uncalibrated read

Branch `fix/gain-invariant-affect` (worktree `D:\Yell-at-AI\.worktrees\affect`), 5 commits on top of 8a11df6:

| SHA | Commit |
| --- | --- |
| 7b27875 | fix(eval): score acted and wild clips on what the assistant receives |
| f169e39 | fix(engine): read uncalibrated energy from vocal effort, not mic level |
| fe98e8b | test(eval): held-out-by-corpus refit and the new acted/wild baselines |
| 401270b | docs: replace the retired 21/25 with contract-scored, per-label numbers |
| fbe3231 | perf(whisper): pass a thread count instead of whisper.cpp's fixed 4 |

## 1. Eval now measures what the AI receives

`scripts/run-external-emotion-eval.mjs` scores each clip only on `affect.emotional_coloring` and `flags`. Composite readings (`reads_aroused`, `reads_subdued`, `reads_uncertain`, `reads_neutral`, `steering_flag`) are defined from those two fields alone. The script refuses a manifest that names any other signal, or that gives two clips with the same label different rules. It prints a per-label confusion table of what the coloring told the assistant.

Label rules:
- angry: must read aroused (tense/urgent/high_intensity coloring, or a tension/urgency/yelling flag). Must not read subdued.
- fearful: must read aroused or uncertain. Must not read subdued.
- happy: must read aroused or neutral. Must not read subdued or uncertain. The contract has no word for positive arousal.
- sad: must read subdued or hesitant. Must not read aroused.
- neutral: must read neutral or emphatic. No steering flag.

Wild eval: `delivery_clear`, `aroused` and `question_text` are gone. Criteria now use only coloring, flags and `assistant_guidance.priority`. `delivery_clear` means no steering flag and a priority of `normal` or `preserve_emphasis`. Three manifest entries changed, each noted in the diff: the audience question no longer passes on transcript text, the debrief uses `coloring_hesitant` instead of `pause_high`, and the keynote's `aroused` became `reads_aroused`. The script also runs from the cache without ffmpeg or yt-dlp. Previously it required both even when every clip was cached, and a missing yt-dlp crashed the toolchain lookup.

## 2. Per-label confusion (acted, 25 clips, contract-scored)

Columns show the coloring bucket the assistant was told.

Before (8a11df6, absolute-RMS energy): **8/25**

| Label | aroused | subdued | uncertain | neutral | Pass |
| --- | --- | --- | --- | --- | --- |
| angry | 1 | 2 | 0 | 3 | 1/6 |
| fearful | 0 | 2 | 1 | 0 | 1/3 |
| happy | 0 | 4 | 0 | 1 | 1/5 |
| neutral | 1 | 3 | 0 | 1 | 1/5 |
| sad | 0 | 4 | 0 | 2 | 4/6 |

15 of the 25 clips read "subdued", across every label. Sad's 4/6 is not skill.

After, in-sample: **19/25**

| Label | aroused | subdued | uncertain | neutral | Pass |
| --- | --- | --- | --- | --- | --- |
| angry | 5 | 0 | 0 | 1 | 5/6 |
| fearful | 1 | 0 | 1 | 1 | 2/3 |
| happy | 0 | 1 | 0 | 4 | 4/5 |
| neutral | 1 | 0 | 0 | 4 | 4/5 |
| sad | 0 | 3 | 1 | 2 | 4/6 |

After, held out by corpus: **20/25**. For each fold, the grid refits the effort-high, effort-low and narrow-pitch cuts on two corpora, takes the centre of the tied-best plateau, and scores the third corpus.

| Held out | Train | Refit (hi dB / lo dB / narrow st) | Tied-best range | Held-out (refit) | Held-out (shipped) |
| --- | --- | --- | --- | --- | --- |
| CREMA-D | 15/16 | -10 / -17 / 6 | -12..-8 / -22..-13 / 3..7 | 6/9 | 5/9 |
| RAVDESS | 13/16 | -11 / -18 / 4 | -12..-9 / -22..-15 / 3..5 | 8/9 | 8/9 |
| EmoDB | 16/18 | -11 / -19 / 5 | -12..-9 / -22..-15 / 5 | 6/7 | 6/7 |

Held-out confusion: angry 6/6, fearful 3/3, happy 5/5 (3 of them read "aroused"), neutral 3/5, sad 3/6.

The held-out score is not lower than in-sample because the shipped effort-high cut (-6 dB) is deliberately above the acted optimum. Every fold picks -9 to -12 dB. At -9 dB, three calm wild clips (NASA Q&A, White House briefing, USGS lecture) get tension or urgency flags. At -12 dB, six do. At -7 dB and above, none do. The shipped cut costs one CREMA-D anger take and one RAVDESS fear take. The low-effort and narrow-pitch cuts are stable across folds, but their plateaus are wide, so the data barely constrains them. The narrow cut is marginal: a happy take at 4.86 st reads subdued, and a neutral take sits at 5.05 st.

What model-free DSP separates:
- **Arousal separates.** Anger reads aroused (5/6), and neutral stays neutral (4/5).
- **Happy does not separate from neutral.** 4 of 5 happy clips read neutral and none read aroused. Valence is not conveyed.
- Fear is inconsistent. Sad is half right (3 subdued, 1 hesitant). Two quiet CREMA-D sad takes sit near their room noise and cannot be measured.
- The neutral miss is in personal-baseline mode: voice-quality tension against a 3-clip baseline. That behaviour predates this change.

## 3. Engine change

- **Speech gate (`src/dsp/features.js`).** The gate is now relative to the clip: the noise estimate plus 6 dB, clamped to between 15 and 30 dB under the loud frames. It replaces the absolute 0.004-0.025 RMS window. Only digital silence (1e-7) is gated absolutely.
- **Vocal effort (`src/dsp/mel.js`).** The per-frame FFT now also yields the alpha ratio: 1-5 kHz energy over 50 Hz-1 kHz energy, in dB, taken as the median over voiced frames. This is the eGeMAPS measure of vocal effort.
- **Analyzer.** In uncalibrated mode, energy now means vocal effort: high at -6 dB or above, low at -18 dB or below. The other cuts:
  - Yelling needs -3 dB or above plus elevated delivery.
  - The jitter symptom is gated by raised effort, not RMS. The old 0.12-jitter term only fired above an absolute RMS level, which had hidden CREMA-D's 0.19-0.49 pitch-tracking jitter because those files are quiet.
  - Raised effort alone counts as tension.
  - Narrow pitch is 5 st or less (was 3.2).
  - "Flat" delivery is not called when the other dimension contradicts it.
  - Uncalibrated evidence text quotes only level-independent numbers.
  - Every cut is in `THRESHOLDS` with the data behind it.
- **Personal baseline.** The baseline now optionally stores the alpha ratio. Old baselines stay valid. Baseline mode still wins when present: loudness against your own history, plus effort when the baseline has it.
- **Fixtures (disclosed).** The yelling and urgency fixtures said "loud" only through larger sample values, and had no harmonics above 1 kHz. In other words they encoded the absolute-level bug. `scripts/generate-fixtures.mjs` now gives every fixture a harmonic tail whose tilt carries effort (modal, raised, shouted, soft), normalised so peak amplitude still means what it meant. **No test expectation changed.**
- Re-vendored `apps/web/vendor` with `node apps/web/build.mjs`.

## 4. Gain-invariance test

`test/gain-invariance.test.js` analyses every golden fixture, and every cached acted clip, at 0.25x, 1x and 4x amplitude. It requires identical affect, flags, prosody categories, guidance and emphasis words at all three levels. It also checks that yelling survives a 0.25x mic and a neutral clip stays unflagged at 4x.
- New engine: **0 of 35 clips** (25 acted + 10 fixtures) change coloring or flags across the three gains.
- Old engine: **27 of 35** change.
- The test fails on the old engine and passes on the new one.

## 5. Wild YouTube (contract-only criteria)

Before and after are both **11/14**, with the same three misses:
- Two NASA clips miss on the "softening language with elevated delivery" rule, which fires on a softener word plus a fast rate.
- Stanford misses on rising terminal pitch plus an uncertainty-context word.

These are text-side rules the engine change did not touch. No calm clip gained a yelling, urgency or tension flag. USGS and the NASA Q&A gained a harmless emphasis flag. The MIT debrief keeps its hesitation read.

On the old, harness-derived criteria the recorded score was 13/14. Rescoring the same old engine on the honest criteria gives 11/14.

## 6. Tests

- `npm test`: **162 pass**, 0 fail, 0 skipped. The baseline was 157. The additions are 3 gain-invariance tests, 1 baseline alpha-ratio test and 1 whisper threads test.
- The emphasis (`whole`), yelling, urgency, hesitation, confusion, mismatch and personal-baseline golden tests all pass unchanged.
- `npm run external:emotion` enforces 0.7 or better and passes at 0.76.
- build, smoke and harness:conformance pass.
- Bench p95 is 87.9 ms, against 88.4 ms for the old engine on the same box, so there is no latency change.

## 7. Whisper threads

`transcribeWithWhisper` now passes `-t min(os.availableParallelism(), 8)`. `SUBTEXT_WHISPER_THREADS` overrides it, and the adapter never duplicates a `-t` the caller already passed.

On this i7-10510U (4 cores / 8 threads) with base.en, the median of 8 interleaved runs:

| Clip | 4 threads | 8 threads |
| --- | --- | --- |
| 3.2 s | 3.48 s | 3.34 s |
| 8.2 s | 4.55 s | 4.33 s |

That is a 4-6% gain, inside the roughly 1 s spread between runs. I could not reproduce the 5.0 s to 3.8 s improvement the controller measured. The extra threads here are hyperthreads.

## Caveats

- There are 25 acted clips from 3 corpora. These are directional results, not a classifier.
- Uncalibrated effort reads depend on the microphone's frequency response, even though they no longer depend on its gain. A laptop mic with weak bass could push calm speech toward "high". The -6 dB cut has a 1.4 dB margin over the brightest calm wild clip. Calibration still helps.
- The contract vocabulary cannot express positive arousal, so a raised happy voice can only ever reach the assistant as "tense".
- I copied the eval caches from `D:\Yell-at-AI\eval\{external,wild}\cache` into the worktree. They are gitignored. The main repo was not modified.
