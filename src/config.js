import { readFileSync, writeFileSync, existsSync, mkdirSync, chmodSync } from "fs";
import { join } from "path";
import { homedir } from "os";

const CONFIG_DIR = join(homedir(), ".config", "juoruankka-tui");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const DEFAULT_SERVER = "https://juoruankka.com";

function ensureConfigDir() {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadConfig() {
  if (!existsSync(CONFIG_PATH)) {
    return { server: DEFAULT_SERVER };
  }

  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const config = JSON.parse(raw);
    config.server = (config.server || DEFAULT_SERVER).replace(/\/+$/, "");
    return config;
  } catch {
    return { server: DEFAULT_SERVER };
  }
}

export function loadCachedToken() {
  if (!existsSync(CONFIG_PATH)) return null;
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const data = JSON.parse(raw);
    return data.token || null;
  } catch {
    return null;
  }
}

export function saveCachedToken(token) {
  ensureConfigDir();
  let config = {};
  if (existsSync(CONFIG_PATH)) {
    try {
      config = JSON.parse(readFileSync(CONFIG_PATH, "utf-8"));
    } catch {}
  }
  config.server = config.server || DEFAULT_SERVER;
  config.token = token;
  delete config.password;
  delete config.email;
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf-8");
  chmodSync(CONFIG_PATH, 0o600);
}

export { CONFIG_PATH, CONFIG_DIR, DEFAULT_SERVER };
