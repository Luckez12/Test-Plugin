# Auto Build Patch

Adds `.github/workflows/build.yml`.

Auto runs on pushes to:
- `src/**`
- `manifest.json`
- `build.js`
- `package.json`
- `package-lock.json`

It installs dependencies, builds all providers, validates the manifest, and commits generated `providers/` files.
