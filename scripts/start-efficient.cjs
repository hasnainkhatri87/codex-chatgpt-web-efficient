const { spawnSync } = require("node:child_process");
const path = require("node:path");

// User-requested launch preset, scoped to this child process. No global settings
// are changed. Keep the low profile's idle cleanup while explicitly allowing five tabs.
function efficientEnvironment(env = process.env) {
  return {
    ...env,
    CODEX_CHATGPT_WEB_RESOURCE_PROFILE: "low",
    CODEX_CHATGPT_WEB_MAX_TABS: "5",
  };
}

function launchEfficient({ env = process.env, spawn = spawnSync } = {}) {
  const executable = process.versions.bun ? process.execPath : "bun";
  const result = spawn(executable, ["run", "app"], {
    cwd: path.resolve(__dirname, ".."),
    env: efficientEnvironment(env),
    stdio: "inherit",
    shell: false,
  });
  if (result.error) throw result.error;
  return result.status ?? 1;
}

module.exports = { efficientEnvironment, launchEfficient };
if (require.main === module) {
  try { process.exitCode = launchEfficient(); }
  catch (error) {
    console.error(`Efficient launcher failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
