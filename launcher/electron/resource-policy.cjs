// Resource controls never raise the upstream five-tab account-safety ceiling.
function readResourcePolicy(env = process.env) {
  const profile = env.CODEX_CHATGPT_WEB_RESOURCE_PROFILE || "balanced";
  if (!["balanced", "low"].includes(profile)) throw new Error("Resource profile must be balanced or low");
  const integer = (name, fallback, min, max) => {
    const raw = env[name];
    if (raw === undefined || raw === "") return fallback;
    if (!/^\d+$/.test(raw)) throw new Error(`${name} must be an integer between ${min} and ${max}`);
    const value = Number(raw);
    if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`${name} must be between ${min} and ${max}`);
    return value;
  };
  return Object.freeze({
    profile,
    maxTabs: integer("CODEX_CHATGPT_WEB_MAX_TABS", profile === "low" ? 2 : 5, 1, 5),
    retainedTabTtlMs: integer("CODEX_CHATGPT_WEB_IDLE_TAB_SECONDS", profile === "low" ? 300 : 1800, 30, 1800) * 1000,
  });
}
module.exports = { readResourcePolicy };
