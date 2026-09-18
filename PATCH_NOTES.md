# MovieBox v1.1.6 timing diagnostics

No stream-selection behavior was changed from v1.1.5.

Added elapsed timing logs for:
- TMDB metadata
- auth bootstrap / token cache hit
- mobile search
- each MovieBox resource request (2160/1080/720 path)
- CDN byte-range probe
- overall search stage
- overall stream stage

Existing behavior retained:
- temporary session host-health routing
- known quality below 720p rejected
- Auto/Unknown accepted
- 1080 -> 720 fallback
