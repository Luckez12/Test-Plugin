# Auto Build Patch

Adds `.github/workflows/build.yml`.

Auto runs on pushes to:
- `src/**`
- `manifest.json`
- `build.js`
- `package.json`
- `package-lock.json`

It installs dependencies, builds all providers, validates the manifest, and commits generated `providers/` files.


## KissKH v1.0.10
- Added a hard exact-title/alias gate before year/type scoring can validate a KissKH detail.
- Capped fuzzy title similarity for ranking only; it can no longer become a valid match through year/type points.
- Added explicit `REJECT ... reason=title-mismatch` logs.
- Added regression coverage for TMDB 236235: `The Gentlemen` must reject `The Princess (2024)` and must not request a video key/source.
- Aligned `providers/kisskh.js`, `src/kisskh/index.js`, `manifest.json`, and `scripts/register-kisskh.js` to v1.0.10.
- Fixed `scripts/register-kisskh.js` for the current object-based manifest format and bumped repository manifest to v1.7.12 so clients can refresh KissKH v1.0.10 metadata.
