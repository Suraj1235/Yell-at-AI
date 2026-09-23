# Wild YouTube Speech Baseline

```sh
npm run wild:youtube
```

Runs entirely from `eval/wild/cache/` once the clips are downloaded; ffmpeg and
yt-dlp are only needed to fetch a missing clip.

Important: this is a natural-speech assistant-handoff benchmark, not an emotion classifier.

## Scoring change: contract-only criteria

Pass criteria now use only what the contract tells the assistant:
`affect.emotional_coloring`, `flags` and `assistant_guidance.priority`.
Previously `delivery_clear` and `aroused` were computed by the harness from raw
prosody categories and `question_text` was read straight off the transcript, so
a clip could pass while the contract steered the assistant somewhere else (the
two NASA clips passed as "clear" while the contract told the assistant to
resolve a text/tone mismatch). The 13/14 recorded at 8a11df6 was on those old
criteria.

## Before: engine at 8a11df6, contract-only criteria

Result: 11/14 (0.786).

| Result | Case | Genre | Coloring | Priority | Flags |
| --- | --- | --- | --- | --- | --- |
| PASS | mit_ocw_audience_question | classroom audience question | neutral | normal | none |
| PASS | mit_ocw_professor_answer | classroom professor answer | emphatic | preserve_emphasis | emphasis |
| PASS | mit_ocw_debrief_discussion | classroom discussion | hesitant | careful | hesitation |
| MISS | nasa_artemis_quarantine_qa | remote public Q&A | mixed | resolve_mismatch | lexical_prosodic_mismatch |
| MISS | nasa_artemis_news_conference | press conference answer | mixed | resolve_mismatch | emphasis, lexical_prosodic_mismatch |
| PASS | white_house_press_briefing | press briefing | emphatic | preserve_emphasis | emphasis |
| PASS | arvada_city_council_meeting | public meeting room audio | emphatic | preserve_emphasis | emphasis |
| PASS | usgs_pubtalk_lecture | public science lecture | neutral | normal | none |
| PASS | pycon_warnings_talk | conference technical talk | emphatic | preserve_emphasis | emphasis |
| PASS | fosdem_deepspeech_talk | conference technical talk | emphatic | preserve_emphasis | emphasis |
| PASS | gitbutler_fosdem_git_talk | conference technical talk | emphatic | preserve_emphasis | emphasis |
| MISS | stanford_cs224n_lecture | university lecture | uncertain | clarify | uncertainty, emphasis |
| PASS | ted_public_speaking_talk | stage public-speaking talk | neutral | normal | none |
| PASS | google_io_developer_keynote | developer keynote | emphatic | preserve_emphasis | emphasis |

## After: gain-invariant uncalibrated read, contract-only criteria

Result: 11/14 (0.786), the same three misses as before the engine change.

| Result | Case | Genre | Coloring | Priority | Flags |
| --- | --- | --- | --- | --- | --- |
| PASS | mit_ocw_audience_question | classroom audience question | neutral | normal | none |
| PASS | mit_ocw_professor_answer | classroom professor answer | emphatic | preserve_emphasis | emphasis |
| PASS | mit_ocw_debrief_discussion | classroom discussion | hesitant | careful | hesitation |
| MISS | nasa_artemis_quarantine_qa | remote public Q&A | mixed | resolve_mismatch | emphasis, lexical_prosodic_mismatch |
| MISS | nasa_artemis_news_conference | press conference answer | mixed | resolve_mismatch | emphasis, lexical_prosodic_mismatch |
| PASS | white_house_press_briefing | press briefing | emphatic | preserve_emphasis | emphasis |
| PASS | arvada_city_council_meeting | public meeting room audio | emphatic | preserve_emphasis | emphasis |
| PASS | usgs_pubtalk_lecture | public science lecture | emphatic | preserve_emphasis | emphasis |
| PASS | pycon_warnings_talk | conference technical talk | emphatic | preserve_emphasis | emphasis |
| PASS | fosdem_deepspeech_talk | conference technical talk | emphatic | preserve_emphasis | emphasis |
| PASS | gitbutler_fosdem_git_talk | conference technical talk | emphatic | preserve_emphasis | emphasis |
| MISS | stanford_cs224n_lecture | university lecture | uncertain | clarify | uncertainty, emphasis |
| PASS | ted_public_speaking_talk | stage public-speaking talk | neutral | normal | none |
| PASS | google_io_developer_keynote | developer keynote | emphatic | preserve_emphasis | emphasis |

- No calm clip gained a yelling, urgency or tension flag. This set is what the
  uncalibrated vocal-effort cut (-6 dB alpha ratio) was checked against: at
  -9 dB three of these clips would be flagged, at -12 dB six.
- USGS and the NASA Q&A gained an emphasis flag (harmless: preserve stressed
  words).
- The two NASA misses are the lexical "softening language with elevated
  delivery" rule (a softener word plus a fast rate), and the Stanford miss is
  rising terminal pitch plus an uncertainty-context word. Both are text-side rules this change
  did not touch.
- The MIT debrief keeps its hesitation read. The new relative speech gate
  keeps its pauses visible (noise sits about 21 dB under the speech there).

## Fixes Driven By Raw Data

- Caption slicing now keys caches by segment time and avoids pulling neighboring speaker text into the transcript.
- YouTube VTT parsing now prefers plain caption lines over word-timing internals, reducing duplicated transcripts.
- Wh-words are no longer treated as confusion markers by themselves.
- `kind` is no longer a softener token.
- `just` is context-aware, so phrases like "just as much" are not treated as hedging.
- Rising terminal pitch in long natural speech no longer creates uncertainty unless the utterance has stronger uncertainty context.
- The wild evaluator treats loud-but-unflagged speech as clear delivery, since room/mic gain alone is not yelling.

## Sources

- MIT OpenCourseWare: `https://www.youtube.com/watch?v=ZLbt_1bI_NA`, `https://www.youtube.com/watch?v=5ZhLLCQWjWQ`
- NASA: `https://www.youtube.com/watch?v=Ii_tmJff7LQ`, `https://www.youtube.com/watch?v=_43Ei9eQVww`
- The White House: `https://www.youtube.com/watch?v=4sEVgwy5eDk`
- City of Arvada: `https://www.youtube.com/watch?v=qokvHZultWg`
- USGS Presentations: `https://www.youtube.com/watch?v=Y0T3qnbXJNQ`
- PyCon US: `https://www.youtube.com/watch?v=X0AjcpicNOM`
- FOSDEM: `https://www.youtube.com/watch?v=KHjfonUAIPI`
- GitButler: `https://www.youtube.com/watch?v=aolI_Rz0ZqY`
