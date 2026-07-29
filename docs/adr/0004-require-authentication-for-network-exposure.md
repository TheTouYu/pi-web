# Require authentication for network exposure

Loopback-only Pi Web remains usable without login, while any non-loopback bind requires a configured single-administrator password and refuses startup without one. When authentication is enabled, a central default-deny boundary protects pages, APIs, files, configuration, SSE, live output, and control, leaving only login, minimal health, and required static resources public. Passwords are stored as slow hashes and bounded signed login sessions are separate from short-lived per-instance control capabilities.
