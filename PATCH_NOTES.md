# KissKH provider patch

1. Extract this ZIP into the root of `Test-Plugin`.
2. Run: `node scripts/register-kisskh.js`
3. Optional rebuild: `npm run build -- kisskh`
4. Validate: `npm run validate`
5. Test example: `npm run test:provider -- kisskh 94997 tv 1 1`

Notes:
- Uses TMDB metadata to match KissKH titles.
- Tries multiple KissKH domains.
- Uses the Cloudstream Google kkey flow with enc-dec fallback.
- Returns direct HLS/MP4 only.
- Includes English, Malay and Indonesian subtitles when available.
