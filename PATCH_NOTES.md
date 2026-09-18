# MovieBox v1.1.5

- Keeps MovieBox host list intact.
- Marks 407/timeout/network-failed hosts unhealthy only for the current runtime session.
- Prioritizes the last successful API host for later search/resource calls.
- Resets host-health state naturally when the provider runtime restarts.
- Preserves v1.1.4 quality rules: known <720p rejected; Auto/Unknown accepted.
