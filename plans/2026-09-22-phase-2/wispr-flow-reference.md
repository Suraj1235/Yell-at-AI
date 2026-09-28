# Wispr Flow — UX reference for the shell polish pass

Compiled 2026-09-22 from Wispr Flow's help center, product page, changelog and hands-on
reviews. This is the bar to clear. Sources at the bottom.

## Their interaction model (verified)

| Element | Wispr Flow behaviour |
| --- | --- |
| Trigger | Hold-to-talk: `Fn` (Mac), `Ctrl+Win` (Windows). Release → processing → text lands in the active field. |
| Hands-free | `Fn+Space` / `Ctrl+Win+Space`, **or click the Flow Bar**, **or double-tap the PTT key within 0.5s**. Exit: press shortcut again or click ■ on the bar. |
| Cancel | `X` or `Esc` → offers **"Undo"** and **"Open History"**. |
| Audio cue | A "ping" when recording starts. |
| Flow Bar | Persistent by default (Settings › System › Flow Bar visibility). Stop ■ / cancel X shown **only in hands-free**. Processing shows staged labels ("Message…", "Cleaning up…"). Onboarding mic test shows **bars rising**. |
| Auto-stop | Hard cap 20 min (warning at 19). Stops on no audio, or on mic failure. **"Audio is transcribed, not discarded"** on auto-stop. |
| Hub (main window) | Sidebar: **Home** = history grouped by date, **search**, hover → copy / flag, retry failed, **arrow-key navigation**, word count + statistics. **Settings** = General (shortcuts, mic, languages), System (launch at login, Flow Bar visibility, notifications), Account/Billing. |
| Onboarding | Sign-in → permissions (mic; Accessibility on Mac; overlay+accessibility on Android) with a "enable in System Settings if you dismissed it" recovery path → hotkey with platform defaults → **guided practice: press, speak, release as instructed; each demo skippable** → data preferences → Hub opens. Reviewers: "polished compared to indie competitors", "under 3 minutes". |
| Command Mode (paid) | Hold `Ctrl+Win+Alt` / `Fn+Ctrl`, speak an instruction, release → edits selected/surrounding text. |
| Style | "Flow edits as you speak": filler removal, punctuation, per-app tone (Very Casual → Formal), dictionary, snippets, 100+ languages. |
| Mobile | iPhone: custom keyboard via globe key. Android: Flow Bubble overlay — tap = hands-free, long-press = PTT. |
| Privacy | Cloud processing only. SOC 2 / HIPAA / ISO. "Data never sold." No local mode. Free tier 2,000 words/week. |

## Their known UX complaints (from reviews)

- Over-edits: "rewrites what you said instead of transcribing it accurately."
- Windows app freezes target apps (VS Code, Notepad++) during dictation.
- ~800 MB idle RAM on Windows.
- iPhone keyboard requires app-switching per session.
- Voice formatting commands ("new paragraph") take practice.

## Where we are behind — MATCH these (table stakes)

1. **Double-tap PTT → hands-free** within 0.5s. Verify; implement if missing.
2. **Click/tap the pill** to start and to stop hands-free. Verify; implement if missing.
3. **Cancel affordance**: Esc/X → a brief toast with **Undo** (restore the cancelled take to the transcript field) and **Open History**.
4. **Recording-start cue**: a short, quiet ping. Off when `prefers-reduced-motion` or a setting says so.
5. **Auto-stop safety**: silence timeout, max-duration cap with a warning before it, and on every auto-stop the audio is still analysed and the words still land in history/clipboard — never discarded. This is also our spec gate 1.
6. **History**: grouped by date, searchable, hover → copy, arrow-key navigation, and "retry" for turns that failed post-capture.
7. **Stats**: words dictated, turns, emphasis caught — small, in the history header.
8. **Onboarding**: permission step shows **live level bars** so the user sees the mic works; guided press-speak-release with the exact hotkey shown; **every step skippable**; a recovery path if permission was dismissed.
9. **Pill visibility setting**: "only while active" vs "always show a resting mark".
10. **Processing-stage labels** in OUR vocabulary: `Listening…` → `Reading delivery…` → `Inserted` / `Copied`. We never say "cleaning up" — we don't rewrite words.

## Where we are better — make these LOUD

1. **Live prosody while speaking.** Waveform tints with detected emphasis; chips appear mid-utterance. They structurally cannot do this (cloud, post-hoc). This is the demo. It must look inevitable, not bolted on.
2. **Inspectable result.** The released block carries z-scores and evidence strings. Render it as an **evidence card**: the transcript with the emphasised word highlighted inline, chips with confidence, one-line guidance — not a `<pre>` dump. Keep the raw block one click away.
3. **Honesty badge.** They send everything to the cloud silently. Our badge names the engine and who receives audio, on first paint. Design it as a first-class, elegant element — a quiet statement of fact, not a warning banner.
4. **Offline, no account, no cap.** Where they ask you to sign in, we say: no account, no word limit, nothing leaves your machine on the default engine. Put that sentence in onboarding.
5. **Your words, verbatim.** Their #1 complaint is over-editing. We add evidence beside your words and never rewrite them. Say it once, plainly, in onboarding and in the settings copy.
6. **Calibration.** A personal baseline makes the reads about *you*. They have nothing for delivery.
7. **Lightweight.** A webview and a Node sidecar. Measure idle memory of the shell tab and state it honestly if it is small.

## Non-negotiables carried over

- Prosody analysis is local on every engine. Copy claims "never leaves" only for `egress: "none"`. Badge text must be literally true in every state, including typed fallback. `test/privacy-claims.test.js` guards this — never weaken it.
- Zero runtime dependencies, no framework, no bundler, no CDN, no remote fonts, strict CSP.
- Phone-width works: 16px gutters, no horizontal scroll, safe-area insets.
- Accessible: keyboard-operable, visible focus, `prefers-reduced-motion`, ARIA live regions.

## Sources

- https://wisprflow.ai/
- https://docs.wisprflow.ai/articles/5096240724-navigating-the-wispr-flow-app-desktop-ios-and-android
- https://docs.wisprflow.ai/articles/3152211871-setup-guide
- https://docs.wisprflow.ai/articles/6391241694-use-flow-hands-free
- https://docs.wisprflow.ai/articles/4816967992-how-to-use-command-mode
- https://docs.wisprflow.ai/articles/2612050838-supported-unsupported-keyboard-hotkey-shortcuts
- https://spokenly.app/blog/wispr-flow-review
- https://zackproser.com/blog/wisprflow-review
- https://tldv.io/blog/wisprflow/
- https://roadmap.wisprflow.ai/changelog
