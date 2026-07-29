#!/usr/bin/env node
"use strict";

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getUnsupportedNodeVersionMessage, isNodeVersionSupported } = require("./node-version");

if (!isNodeVersionSupported(process.versions.node)) {
  console.error(getUnsupportedNodeVersionMessage(process.versions.node));
  process.exit(1);
}

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { spawn } = require("child_process");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const fs = require("fs");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { parseLaunchOptions } = require("./pi-web-options");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const integration = require("./integration-manager");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const { startHub } = require("./live/hub-manager");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const auth = require("./auth-manager");

const pkgDir = path.join(__dirname, "..");
const nextDir = path.join(pkgDir, ".next");

// Resolve next's CLI entry directly to avoid relying on .bin symlinks (which
// may not exist when installed via npx).
let nextBin;
try {
  nextBin = require.resolve("next/dist/bin/next", { paths: [pkgDir] });
} catch {
  // Fallback: locate next package root and derive the bin path manually.
  try {
    const nextPkg = require.resolve("next/package.json", { paths: [pkgDir] });
    nextBin = path.join(path.dirname(nextPkg), "dist", "bin", "next");
  } catch {
    nextBin = path.join(pkgDir, "node_modules", "next", "dist", "bin", "next");
  }
}

async function handleIntegrationCommand(args) {
  const action = args[1] || "status";
  const yes = args.includes("--yes");
  if (action === "status") {
    console.log(JSON.stringify(integration.status(pkgDir), null, 2));
    return;
  }
  if (action === "uninstall") {
    console.log(JSON.stringify(integration.uninstall(pkgDir), null, 2));
    console.log("Restart any running Pi processes to unload the Companion Extension.");
    return;
  }
  if (action !== "install" && action !== "repair") throw new Error(`Unknown integration command: ${action}`);
  if (!yes && (!process.stdin.isTTY || !process.stdout.isTTY)) {
    throw new Error("Non-interactive installation requires: pi-web integration install --yes");
  }
  if (!yes && !await integration.confirmInstall(pkgDir)) {
    console.log("Installation declined. Pi Web remains fully usable without Live Integration.");
    return;
  }
  console.log(JSON.stringify(integration.install(pkgDir), null, 2));
  console.log("Companion installed. Restart already-running Pi processes to load it.");
}

async function main() {
if (process.argv[2] === "auth") {
  if (process.argv[3] !== "set-password") throw new Error("Usage: pi-web auth set-password");
  await auth.promptAndSave();
  console.log("Administrator password updated. All previous login sessions are invalid.");
  return;
}
if (process.argv[2] === "integration") {
  await handleIntegrationCommand(process.argv.slice(2));
  return;
}

const { port, hostname, openBrowser } = parseLaunchOptions();
const loopbackHostnames = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

if (!fs.existsSync(nextDir)) {
  console.error("Build artifacts not found. Please report this issue.");
  process.exit(1);
}

if (!loopbackHostnames.has(hostname)) {
  if (!fs.existsSync(auth.target()) && !process.env.PI_WEB_PASSWORD) {
    if (!process.stdin.isTTY || !process.stdout.isTTY) {
      throw new Error("Refusing non-loopback startup without an administrator password. Set PI_WEB_PASSWORD or run: pi-web auth set-password");
    }
    console.log(`Non-loopback Pi Web requires authentication (${hostname}).`);
    await auth.promptAndSave();
  }
  process.env.PI_WEB_AUTH_ENABLED = "1";
} else if (fs.existsSync(auth.target()) || process.env.PI_WEB_PASSWORD) {
  process.env.PI_WEB_AUTH_ENABLED = "1";
}

const currentIntegration = integration.status(pkgDir);
if (!currentIntegration.installed && process.stdin.isTTY && process.stdout.isTTY) {
  if (await integration.confirmInstall(pkgDir)) {
    integration.install(pkgDir);
    console.log("Companion installed. Restart already-running Pi processes to load it.");
  } else {
    console.log("Installation declined. Pi Web will start without terminal Live Integration.");
  }
}

let hub = null;
let hubRestarts = 0;
async function launchHub() {
  try {
    const result = await startHub(pkgDir);
    hub = result.child;
    if (hub) hub.once("exit", () => {
      hub = null;
      if (hubRestarts++ < 3) setTimeout(() => void launchHub(), 500 * 2 ** hubRestarts).unref();
      else console.warn("Live Hub stopped after repeated failures; history browsing remains available.");
    });
  } catch (error) {
    console.warn(`Live Integration unavailable: ${error.message}`);
  }
}
await launchHub();

const nextArgs = ["start", "-p", port];
nextArgs.push("-H", hostname);

// Always run next's JS entry with node directly — avoids .bin symlink issues
// and path-with-spaces problems on Windows when shell: true is used.
const child = spawn(process.execPath, [nextBin, ...nextArgs], {
  cwd: pkgDir,
  stdio: ["inherit", "pipe", "inherit"],
  env: { ...process.env, PI_WEB_HOSTNAME: hostname },
});

let browserOpened = false;
const url = `http://${hostname}:${port}`;

child.stdout.on("data", (chunk) => {
  const text = chunk.toString();
  process.stdout.write(text);
  if (openBrowser && !browserOpened && text.includes("Ready")) {
    browserOpened = true;
    const isWindows = process.platform === "win32";
    const isMac = process.platform === "darwin";
    const openCmd = isWindows ? "start" : isMac ? "open" : "xdg-open";
    const opener = spawn(openCmd, [url], {
      shell: isWindows,
      stdio: "ignore",
      detached: true,
    });

    opener.on("error", (error) => {
      console.warn(`Could not open browser automatically: ${error.message}`);
    });

    opener.unref();
  }
});

child.on("exit", (code) => {
  if (hub) hub.kill("SIGTERM");
  process.exit(code ?? 0);
});
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
