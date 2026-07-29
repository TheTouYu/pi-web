export const PI_VERSION = "0.82.1";
export const PI_WEB_VERSION = "0.8.2";
export const COMPANION_VERSION = "1.0.0";
export const HUB_PROTOCOL_VERSION = 1;

export const LIVE_LIMITS = Object.freeze({
  maxFrameBytes: 16 * 1024 * 1024,
  maxBrowserQueueBytes: 4 * 1024 * 1024,
  reconnectMaxMs: 30_000,
  disconnectReservationMs: 2 * 60_000,
  interruptedOverlayMs: 10 * 60_000,
  controlReconnectGraceMs: 30_000,
  controlIdleExpiryMs: 15 * 60_000,
  loginAbsoluteExpiryMs: 7 * 24 * 60 * 60_000,
  commandDedupeEntries: 256,
  commandDedupeMs: 15 * 60_000,
  invalidationCoalesceMs: 50,
  maxImages: 10,
  maxImageBytes: 10 * 1024 * 1024,
});

export const LIVE_CAPABILITIES = [
  "prompt", "steer", "follow_up", "abort", "abort_and_send", "set_model",
  "set_thinking_level", "get_tools", "set_tools", "get_commands", "get_state",
  "set_session_name", "compact",
] as const;

export type LiveCapability = typeof LIVE_CAPABILITIES[number];
