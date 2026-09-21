# Root-cause extraction

This module implements Issue #9 as a deterministic, fail-closed extraction stage over accepted `CASE_FEED_V1` remarks.

It derives:
- `rootCauseText`
- `rootCauseState = CONFIRMED | PROVISIONAL | ABSENT | CONFLICT`
- `rootCauseEvidenceSummary`
- `rootCauseSource = remarks`

The original `remarks` value is copied unchanged into each output record and remains authoritative.

Classification deliberately prefers explicit evidence:
- explicit root-cause labels;
- otherwise explicit generic cause labels;
- otherwise bounded final-causal wording;
- uncertainty cues force PROVISIONAL;
- no explicit causal conclusion -> ABSENT;
- multiple distinct selected causal claims -> CONFLICT.

The extractor does not call a network service or language model and does not write to ONES.

Example:

```bash
python root-cause/extract.py --input case-feed.json --output root-cause-report.json
```
