# Wild YouTube Speech Baseline

Generated locally on 2026-06-27 with:

```sh
npm run wild:youtube
```

Result: 11/11 clips matched expected assistant-handoff behavior. Pass rate: 1.0.

Important: this is a natural-speech assistant-handoff benchmark, not an emotion classifier.

Note: the manifest has since been expanded to 14 candidate clips across 11 source channels. This file remains the latest checked-in fully verified baseline until the expanded set can be rerun in an environment where YouTube allows segment and caption downloads.

| Result | Case | Source | Genre | Segment | Energy | Rate | Pitch Range | Pause Density | Flags | Matched Evidence |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| PASS | mit_ocw_audience_question | MIT OpenCourseWare | classroom audience question | 00:00:20.600-00:00:28.800 | medium | fast | wide | low | none | question_text |
| PASS | mit_ocw_professor_answer | MIT OpenCourseWare | classroom professor answer | 00:00:28.800-00:00:55.000 | high | normal | medium | low | none | delivery_clear |
| PASS | mit_ocw_debrief_discussion | MIT OpenCourseWare | classroom discussion | 00:01:15.000-00:01:45.000 | low | slow | medium | high | hesitation, emphasis | flag_hesitation, pause_high |
| PASS | nasa_artemis_quarantine_qa | NASA | remote public Q&A | 00:02:53.000-00:03:23.000 | low | normal | wide | low | lexical_prosodic_mismatch | delivery_clear |
| PASS | nasa_artemis_news_conference | NASA | press conference answer | 00:07:00.000-00:07:30.000 | low | normal | medium | low | none | delivery_clear |
| PASS | white_house_press_briefing | The White House | press briefing | 00:05:00.000-00:05:30.000 | low | normal | medium | low | emphasis | delivery_clear |
| PASS | arvada_city_council_meeting | City of Arvada | public meeting room audio | 00:30:00.000-00:30:30.000 | low | normal | medium | moderate | emphasis | delivery_clear |
| PASS | usgs_pubtalk_lecture | USGS Presentations | public science lecture | 00:05:00.000-00:05:30.000 | medium | normal | wide | moderate | emphasis | delivery_clear |
| PASS | pycon_warnings_talk | PyCon US | conference technical talk | 00:02:00.000-00:02:30.000 | medium | normal | wide | moderate | emphasis | delivery_clear |
| PASS | fosdem_deepspeech_talk | FOSDEM | conference technical talk | 00:02:00.000-00:02:30.000 | low | normal | wide | moderate | emphasis | delivery_clear |
| PASS | gitbutler_fosdem_git_talk | GitButler | conference technical talk | 00:02:00.000-00:02:30.000 | medium | normal | wide | low | emphasis | delivery_clear, flag_emphasis |

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
