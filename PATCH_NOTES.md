# MovieBox v1.1.7

- Removes the dedicated 2160p resource probe from the normal discovery path.
- Requests 1080p first and falls back to 720p only when needed.
- Still accepts an actual 2160p/4K resource if it is returned inside the 1080p resource response.
- Preserves the v1.1.4 minimum-quality rule: known qualities below 720p are rejected; Auto/Unknown is allowed.
- Preserves v1.1.5 session host-health routing and v1.1.6 timing diagnostics.
