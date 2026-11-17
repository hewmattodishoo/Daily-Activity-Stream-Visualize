# Agent instructions — DAS demo kit

This repo builds prospect-specific demos of Dynamic Yield **Daily Activity Stream (DAS)** reporting.

When the user asks to create, adapt or update a DAS demo for a prospect, follow the skill in
`.github/skills/das-demo/SKILL.md` (read it fully, plus its `references/`).

Quick facts:
- Prospect content lives only in `prospects/<slug>/` (`prospect.json`, `requirements.json`, `TALK_TRACK.md`, optional `feed.csv`).
- Build: `python3 build.py prospects/<slug>` (requires Python 3.10+, `pandas`, `pyarrow`). Validate only: `--check`.
- Output: `prospects/<slug>/dist/index.html` — generated, never edit by hand.
- `engine/` is shared by all prospects; change it only to add/fix a capability, then rebuild `prospects/_template` and `prospects/vidaxl`.
- All data is synthetic. Never present it as real prospect performance.
