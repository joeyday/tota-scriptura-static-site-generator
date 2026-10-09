import { spawn } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import { createWatcher } from "./watch.js";

// ─── Restarting serve when tsgen's own code changes ───
// Node loads each module once per process, so a rebuild can't pick up an edit to
// lib/ or build.js: the server has to start over. `tsgen serve` therefore runs as two
// processes. This one only watches tsgen's code and keeps the real server (the same
// command, marked TSGEN_SUPERVISED) running, starting it over when the code changes.
// The server's own watcher still handles the vault and the template. Pages open in a
// browser notice the restart and reload (see the boot id in serve.js). Only `serve`
// comes here; a build never loads this file.

const TSGEN_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const QUIET_MS = 1000;

// Never returns: exits when the server stops for good.
export function supervise() {
  let child = null;
  let restarting = false;
  let stopping = false;
  let ran = false; // has the server started before? A first run that fails is just a failure

  function start() {
    child = spawn(process.execPath, [process.argv[1], ...process.argv.slice(2)], {
      stdio: "inherit",
      env: { ...process.env, TSGEN_SUPERVISED: "1" },
    });
    child.on("exit", (code, signal) => {
      child = null;
      if (stopping) process.exit(0);
      if (restarting) {
        restarting = false;
        ran = true;
        start();
      } else if (!ran) {
        process.exit(code ?? 1);
      } else {
        console.error(
          `tsgen exited${signal ? ` (${signal})` : ` with code ${code}`}. Waiting for a change to its code to start it again.`,
        );
      }
    });
  }

  function restart(files) {
    const shown = files.slice(0, 5).join(", ");
    console.log(
      `Changed: ${shown}${files.length > 5 ? ` and ${files.length - 5} more` : ""} (tsgen's own code). Restarting.`,
    );
    if (child) {
      restarting = true;
      child.kill("SIGTERM");
    } else {
      ran = true;
      start();
    }
  }

  // The generator's code: everything in lib/, plus build.js and serve.js at the top.
  const watcher = createWatcher({ onChange: restart, quietMs: QUIET_MS });
  watcher.watch(path.join(TSGEN_DIR, "lib"), (rel) => /\.(m?js|json)$/.test(rel));
  watcher.watch(TSGEN_DIR, (rel) => rel === "build.js" || rel === "serve.js", { recursive: false });

  // Ctrl-C reaches the server too; either way, stop it and leave.
  const stop = () => {
    stopping = true;
    watcher.stop();
    if (child) child.kill("SIGTERM");
    else process.exit(0);
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);

  start();
}
