# Connect terminal Pi through a companion extension and Live Hub

Ordinary interactive Pi TUI processes will publish their existing agent events through an explicitly installed global Companion Extension to a single per-OS-user Live Hub child process owned by the Pi Web launcher. Linux and macOS use a private Unix socket; Pi Web keeps its existing SSE-down/HTTP-up browser interface. The child-process boundary preserves terminal connections across Next.js reloads, while the extension remains best-effort and never makes Pi depend on Pi Web.

The integration requires an exact Pi CLI/SDK version match and an exact Companion/Hub protocol match. The self-contained Companion artifact is installed atomically only after terminal authorization; unsupported platforms, declined installation, non-interactive startup, or integration failure leave all pre-existing Pi Web behavior available.
