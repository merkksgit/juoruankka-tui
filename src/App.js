import { term } from "./term.js";
import { login, verifyToken, fetchFeeds, fetchArticles, refreshArticles, fetchSaved, fetchLikes, checkLatestVersion, TokenExpiredError } from "./api.js";
import { loadCachedToken, saveCachedToken, clearCachedToken, loadReadHistory, saveReadArticle } from "./config.js";
import { promptCredentials } from "./prompt.js";
import open from "open";
import { spawn } from "child_process";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

// Single source of truth for our version — read from package.json so it only
// needs bumping in one place.
const VERSION = (() => {
  try {
    const pkgPath = join(dirname(fileURLToPath(import.meta.url)), "..", "package.json");
    return JSON.parse(readFileSync(pkgPath, "utf8")).version || "0.0.0";
  } catch {
    return "0.0.0";
  }
})();

// Compare dotted numeric versions; true if `remote` is strictly newer than `local`.
function isNewerVersion(remote, local) {
  if (!remote || !local) return false;
  const a = remote.split(".").map((n) => parseInt(n, 10) || 0);
  const b = local.split(".").map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] || 0, y = b[i] || 0;
    if (x > y) return true;
    if (x < y) return false;
  }
  return false;
}

function openUrl(url) {
  open(url.trim()).catch(() => {});
}

// Candidate VLC commands, tried in order. Windows paths come first because the
// common setup here is WSL launching the Windows build; falls back to a Linux/mac
// `vlc`/`cvlc` on PATH. Override with a "player" string in config.json.
const VLC_CANDIDATES = [
  "/mnt/c/Program Files/VideoLAN/VLC/vlc.exe",
  "/mnt/c/Program Files (x86)/VideoLAN/VLC/vlc.exe",
  "vlc",
  "cvlc",
];

function launchPlayer(cmd, url) {
  return new Promise((resolve, reject) => {
    let settled = false;
    // `--` stops option parsing so a feed-supplied URL can't smuggle player flags.
    const child = spawn(cmd, ["--", url], { detached: true, stdio: "ignore" });
    child.once("error", (err) => {
      if (!settled) { settled = true; reject(err); }
    });
    // ENOENT fires asynchronously; if no error after a short grace period the
    // process started, so detach and let it run independently of the TUI.
    setTimeout(() => {
      if (!settled) { settled = true; child.unref(); resolve(); }
    }, 200);
  });
}

async function openInVlc(audioUrl, config) {
  // audioUrl comes from untrusted RSS feeds — only allow real http(s) URLs so a
  // feed can't point the player at a local file or inject an argv flag.
  const url = (audioUrl || "").trim();
  if (!/^https?:\/\//i.test(url)) return false;

  const candidates = config.player ? [config.player] : VLC_CANDIDATES;
  for (const cmd of candidates) {
    try {
      await launchPlayer(cmd, url);
      return true;
    } catch {}
  }
  return false;
}

const TOPIC_NAMES = {
  all: "Kaikki",
  paauutiset: "Pääuutiset",
  tuoreimmat: "Tuoreimmat",
  luetuimmat: "Luetuimmat",
  kotimaa: "Kotimaa",
  politiikka: "Politiikka",
  ulkomaat: "Ulkomaat",
  talous: "Talous",
  teknologia: "Teknologia",
  urheilu: "Urheilu",
  viihde: "Viihde",
  tiede: "Tiede",
  paakirjoitukset: "Pääkirjoitukset",
  kolumnit: "Kolumnit",
  youtube: "YouTube",
  podcasts: "Podcastit",
  blogs: "Blogit",
  github: "GitHub",
  saved: "Tallennetut",
  liked: "Yhteisön tykätyt",
};

// Virtual topics that load from per-user / community endpoints instead of feeds
const VIRTUAL_TOPICS = ["saved", "liked"];

const TOPIC_ORDER = [
  "all",
  "paauutiset",
  "tuoreimmat",
  "luetuimmat",
  "kotimaa",
  "politiikka",
  "ulkomaat",
  "talous",
  "teknologia",
  "urheilu",
  "viihde",
  "tiede",
  "paakirjoitukset",
  "kolumnit",
  "youtube",
  "podcasts",
  "blogs",
  "github",
];

function relativeTime(timestamp) {
  if (!timestamp) return "";
  const now = Date.now();
  const diff = now - timestamp;
  if (diff < 0) return "nyt";

  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "nyt";
  if (minutes < 60) return `${minutes}m`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;

  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;

  const weeks = Math.floor(days / 7);
  if (weeks < 5) return `${weeks}vk`;

  const months = Math.floor(days / 30);
  return `${months}kk`;
}

export async function startApp(config) {
  // Setup terminal
  term.enterAltScreen();
  term.hideCursor();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  const cleanup = () => {
    if (spinnerTimer) clearInterval(spinnerTimer);
    term.showCursor();
    term.leaveAltScreen();
    process.stdin.setRawMode(false);
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // State
  let screen = "loading";
  let previousScreen = null;
  let errorMessage = null;
  let token = null;
  let user = null;
  let feeds = [];
  let topics = [];
  let allArticles = [];
  let articles = [];
  let selectedIndex = 0;
  let scrollOffset = 0;
  let selectedTopic = null;
  let searchQuery = "";
  let readHistory = loadReadHistory();
  const articleCache = new Map();
  const CACHE_TTL = 10 * 60 * 1000;

  // Newer version available on GitHub, or null. Filled in the background so the
  // check never delays startup; the splash and topics screen show it once known.
  let updateVersion = null;
  const updateCheck = checkLatestVersion()
    .then((latest) => {
      if (isNewerVersion(latest, VERSION)) updateVersion = latest;
    })
    .catch(() => {});

  // --- Render functions ---

  function drawHeader() {
    const header = user
      ? `${term.boldYellow("Juoruankka")} ${term.dim("—")} ${term.gray(user.displayName)}`
      : term.boldYellow("Juoruankka");
    term.writeLine(0, ` ${header}`);
  }

  function drawStatusBar(hints) {
    const row = term.rows - 1;
    term.writeLine(row, ` ${term.orange(hints)}`);
  }

  const LOGO = [
    "     ██╗██╗   ██╗ ██████╗ ██████╗ ██╗   ██╗ █████╗ ███╗   ██╗██╗  ██╗██╗  ██╗ █████╗ ",
    "     ██║██║   ██║██╔═══██╗██╔══██╗██║   ██║██╔══██╗████╗  ██║██║ ██╔╝██║ ██╔╝██╔══██╗",
    "     ██║██║   ██║██║   ██║██████╔╝██║   ██║███████║██╔██╗ ██║█████╔╝ █████╔╝ ███████║",
    "██   ██║██║   ██║██║   ██║██╔══██╗██║   ██║██╔══██║██║╚██╗██║██╔═██╗ ██╔═██╗ ██╔══██║",
    "╚█████╔╝╚██████╔╝╚██████╔╝██║  ██║╚██████╔╝██║  ██║██║ ╚████║██║  ██╗██║  ██╗██║  ██║",
    " ╚════╝  ╚═════╝  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝",
  ];

  function drawSplash(message) {
    stopSpinner();
    term.clearScreen();
    const startRow = Math.max(0, Math.floor((term.rows - LOGO.length) / 2) - 2);

    for (let i = 0; i < LOGO.length; i++) {
      const pad = Math.max(0, Math.floor((term.cols - 85) / 2));
      term.writeLine(startRow + i, " ".repeat(pad) + term.yellow(LOGO[i]));
    }

    const version = `v${VERSION}`;
    const versionLine = updateVersion ? `${version}  ·  päivitys saatavilla: v${updateVersion}` : version;
    const versionText = updateVersion
      ? term.gray(version) + term.dim("  ·  ") + term.orange(`päivitys saatavilla: v${updateVersion}`)
      : term.gray(version);
    term.writeLine(startRow + LOGO.length + 1, " ".repeat(Math.max(0, Math.floor((term.cols - versionLine.length) / 2))) + versionText);

    const msgRow = startRow + LOGO.length + 3;
    let frame = 0;
    const render = () => {
      const ch = spinnerFrames[frame % spinnerFrames.length];
      const text = message + " " + ch;
      term.writeLine(msgRow, " ".repeat(Math.max(0, Math.floor((term.cols - text.length) / 2))) + term.cyan(text));
      frame++;
    };
    render();
    spinnerTimer = setInterval(render, 100);
  }

  const spinnerFrames = ["/", "-", "\\", "|"];
  let spinnerTimer = null;

  function startSpinner(message) {
    stopSpinner();
    let frame = 0;
    const render = () => {
      const ch = spinnerFrames[frame % spinnerFrames.length];
      term.writeLine(2, ` ${term.cyan(message + " " + ch)}`);
      frame++;
    };
    term.clearScreen();
    drawHeader();
    render();
    spinnerTimer = setInterval(render, 100);
  }

  function stopSpinner() {
    if (spinnerTimer) {
      clearInterval(spinnerTimer);
      spinnerTimer = null;
    }
  }

  function drawLoading(message) {
    startSpinner(message);
  }

  function drawError() {
    stopSpinner();
    term.clearScreen();
    drawHeader();
    term.writeLine(2, ` ${term.cyan(`Virhe: ${errorMessage}`)}`);
    drawStatusBar("q/h: back");
  }

  // --- Topic screen ---

  function drawTopicRow(i) {
    const topicKey = topics[i];
    const name = TOPIC_NAMES[topicKey] || topicKey;
    const isSelected = i === selectedIndex;
    const line = isSelected
      ? ` ${term.boldYellow(`▸ ${name}`)}`
      : `   ${term.white(name)}`;
    term.writeLine(3 + i, line);
  }

  function drawTopicsFull() {
    term.clearScreen();
    drawHeader();
    term.writeLine(1, updateVersion
      ? ` ${term.orange(`↑ Päivitys saatavilla: v${updateVersion} (nyt v${VERSION}) — git pull`)}`
      : "");
    term.writeLine(2, ` ${term.boldYellow("Aiheet")}`);

    for (let i = 0; i < topics.length; i++) {
      drawTopicRow(i);
    }

    drawStatusBar("j/k: navigate  Enter/l: select  ?: help  L: logout  q: quit");
  }

  // --- Article screen ---

  function drawArticleRow(ai) {
    const viewportHeight = term.rows - 5;
    const maxTitle = term.cols - 35;
    const vi = ai - scrollOffset;
    if (vi < 0 || vi >= viewportHeight) return;
    const row = 3 + vi;

    if (ai >= articles.length) {
      term.writeLine(row, "");
      return;
    }

    const article = articles[ai];
    const isSelected = ai === selectedIndex;
    const isRead = readHistory.has(article.id);
    const rawTitle = article.title || "Untitled";
    const title =
      rawTitle.length > maxTitle
        ? rawTitle.slice(0, maxTitle - 1) + "…"
        : rawTitle;

    const source = article.source || "";
    const time = relativeTime(article.timestamp);

    if (isSelected) {
      term.writeLine(row,
        ` ${term.boldYellow("▸")} ${term.boldYellow(title)} ${term.dim("│")} ${term.blue(source)} ${term.dim("│")} ${term.cyan(time)}`
      );
    } else if (isRead) {
      term.writeLine(row,
        `   ${term.dimWhite(title)} ${term.dim("│")} ${term.dimWhite(source)} ${term.dim("│")} ${term.dimWhite(time)}`
      );
    } else {
      term.writeLine(row,
        `   ${term.white(title)} ${term.dim("│")} ${term.blue(source)} ${term.dim("│")} ${term.cyan(time)}`
      );
    }
  }

  function drawArticleHeader() {
    const viewportHeight = term.rows - 5;
    const topicName = TOPIC_NAMES[selectedTopic] || selectedTopic;
    const filterInfo = searchQuery ? ` ${term.cyan(`"${searchQuery}"`)}` : "";
    const countInfo = articles.length > viewportHeight
      ? ` ${term.gray(`(${articles.length}) [${scrollOffset + 1}-${Math.min(scrollOffset + viewportHeight, articles.length)}/${articles.length}]`)}`
      : ` ${term.gray(`(${articles.length})`)}`;
    term.writeLine(2, ` ${term.boldYellow(topicName)}${countInfo}${filterInfo}`);
  }

  function drawArticlesFull() {
    const viewportHeight = term.rows - 5;

    // Calculate scroll
    const half = Math.floor(viewportHeight / 2);
    if (articles.length > viewportHeight) {
      scrollOffset = Math.max(
        0,
        Math.min(selectedIndex - half, articles.length - viewportHeight),
      );
    } else {
      scrollOffset = 0;
    }

    term.clearScreen();
    drawHeader();
    term.writeLine(1, "");
    drawArticleHeader();

    if (articles.length === 0) {
      term.writeLine(3, ` ${term.gray("Ei artikkeleita.")}`);
    } else {
      for (let vi = 0; vi < viewportHeight; vi++) {
        const ai = vi + scrollOffset;
        drawArticleRow(ai);
      }
    }

    drawArticlesStatusBar();
  }

  function drawArticlesStatusBar() {
    const vlc = selectedTopic === "podcasts" ? "v: vlc  " : "";
    drawStatusBar(`j/k: navigate  Enter/l: open  ${vlc}p: preview  /: search  r: refresh  ?: help  q/h: back`);
  }

  // --- Help screen ---

  function drawHelp() {
    term.clearScreen();
    drawHeader();
    term.writeLine(2, ` ${term.boldYellow("Pikanäppäimet")}`);

    const bindings = [
      ["j / ↓", "Seuraava"],
      ["k / ↑", "Edellinen"],
      ["d", "10 riviä alas"],
      ["u", "10 riviä ylös"],
      ["g", "Ensimmäinen"],
      ["G", "Viimeinen"],
      ["Enter / l", "Valitse / Avaa"],
      ["v", "Toista podcast VLC:ssä"],
      ["p", "Esikatselu"],
      ["q / h", "Takaisin"],
      ["r", "Päivitä artikkelit"],
      ["/", "Hae artikkeleita"],
      ["Esc", "Tyhjennä haku"],
      ["L", "Kirjaudu ulos"],
      ["?", "Näytä ohje"],
      ["Ctrl+C", "Poistu"],
    ];

    for (let i = 0; i < bindings.length; i++) {
      const [key, desc] = bindings[i];
      term.writeLine(4 + i, `   ${term.cyan(key.padEnd(14))} ${term.white(desc)}`);
    }

    drawStatusBar("q/?/Esc: back");
  }

  // --- Preview screen ---

  let previewArticle = null;
  let previewScrollOffset = 0;
  let previewLines = [];

  function wrapText(text, maxWidth) {
    const lines = [];
    for (const paragraph of text.split("\n")) {
      if (paragraph.trim() === "") { lines.push(""); continue; }
      const words = paragraph.split(/\s+/);
      let line = "";
      for (const word of words) {
        if (line.length + word.length + 1 > maxWidth) {
          lines.push(line);
          line = word;
        } else {
          line = line ? line + " " + word : word;
        }
      }
      if (line) lines.push(line);
    }
    return lines;
  }

  function buildPreviewLines(article) {
    const maxWidth = Math.min(term.cols - 6, 80);
    const lines = [];

    lines.push(term.boldYellow(article.title || "Untitled"));
    lines.push("");

    const meta = [];
    if (article.source) meta.push(term.blue(article.source));
    if (article.timestamp) meta.push(term.cyan(relativeTime(article.timestamp)));
    if (meta.length) lines.push(meta.join(` ${term.dim("│")} `));

    if (article.tags && article.tags.length) {
      lines.push(term.gray(article.tags.join(", ")));
    }

    lines.push("");
    lines.push(term.gray("─".repeat(maxWidth)));
    lines.push("");

    if (article.description) {
      const wrapped = wrapText(article.description, maxWidth);
      for (const line of wrapped) {
        lines.push(term.white(line));
      }
    } else {
      lines.push(term.gray("Ei kuvausta saatavilla."));
    }

    lines.push("");
    lines.push(term.gray("─".repeat(maxWidth)));
    lines.push("");
    lines.push(term.cyan(article.url || ""));

    return lines;
  }

  function drawPreview() {
    term.clearScreen();
    drawHeader();
    term.writeLine(1, "");

    const viewportHeight = term.rows - 4;
    const visible = previewLines.slice(previewScrollOffset, previewScrollOffset + viewportHeight);

    for (let i = 0; i < viewportHeight; i++) {
      term.writeLine(2 + i, i < visible.length ? `   ${visible[i]}` : "");
    }

    drawPreviewStatusBar();
  }

  function drawPreviewStatusBar() {
    const vlc = selectedTopic === "podcasts" ? "v: vlc  " : "";
    drawStatusBar(`Enter/l: open in browser  ${vlc}j/k: scroll  q/h: back`);
  }

  // --- Search bar ---

  function drawSearchBar() {
    const row = term.rows - 1;
    term.writeLine(row, ` ${term.orange("/")}${term.white(searchQuery)}${term.white("█")}`);
  }

  function applySearchFilter() {
    if (!searchQuery) {
      articles = allArticles;
    } else {
      const q = searchQuery.toLowerCase();
      articles = allArticles.filter((a) =>
        (a.title || "").toLowerCase().includes(q) ||
        (a.source || "").toLowerCase().includes(q)
      );
    }
    selectedIndex = 0;
    scrollOffset = 0;
  }

  // --- Article loading ---

  async function loadArticles(topic, forceRefresh = false) {
    const cached = articleCache.get(topic);
    if (!forceRefresh && cached && Date.now() - cached.timestamp < CACHE_TTL) {
      allArticles = cached.articles;
      searchQuery = "";
      articles = cached.articles;
      selectedIndex = 0;
      scrollOffset = 0;
      screen = "articles";
      drawArticlesFull();
      return;
    }

    if (forceRefresh) articleCache.clear();

    screen = "loading";

    let arts;
    if (topic === "saved") {
      drawLoading("Haetaan tallennettuja...");
      arts = await fetchSaved(config.server, token);
    } else if (topic === "liked") {
      drawLoading("Haetaan suosituimpia...");
      arts = await fetchLikes(config.server, token);
    } else {
      drawLoading(forceRefresh ? "Päivitetään syötteitä..." : "Haetaan artikkeleita...");

      const topicFeeds = topic === "all"
        ? feeds.filter((f) => f.enabled !== false)
        : feeds.filter((f) => f.category === topic && f.enabled !== false);

      const feedPayload = topicFeeds.map((f) => ({ url: f.url, name: f.name }));
      const fetch = forceRefresh ? refreshArticles : fetchArticles;
      arts = await fetch(config.server, feedPayload);
    }

    const seen = new Set();
    const unique = arts.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
    // Virtual topics arrive pre-ordered by the server (saved: newest saved first,
    // liked: most popular first), so only re-sort feed topics by publish time.
    if (!VIRTUAL_TOPICS.includes(topic)) {
      unique.sort((a, b) => b.timestamp - a.timestamp);
    }

    articleCache.set(topic, { articles: unique, timestamp: Date.now() });

    allArticles = unique;
    searchQuery = "";
    articles = unique;
    selectedIndex = 0;
    scrollOffset = 0;
    screen = "articles";
    stopSpinner();
    drawArticlesFull();
  }

  // --- Re-authentication ---

  async function reauthenticate(message = "Istunto vanhentunut — kirjaudu uudelleen") {
    stopSpinner();
    term.clearScreen();
    term.showCursor();
    term.leaveAltScreen();
    process.stdin.setRawMode(false);
    process.stdin.pause();
    console.log(term.boldYellow(`\n  ${message}\n`));
    const { email, password } = await promptCredentials();

    term.enterAltScreen();
    term.hideCursor();
    process.stdin.setRawMode(true);
    process.stdin.resume();
    drawLoading("Kirjaudutaan sisään...");

    const auth = await login(config.server, email, password);
    saveCachedToken(auth.token);
    token = auth.token;
    user = auth.user;

    // Re-fetch feeds with new token
    const userFeeds = await fetchFeeds(config.server, auth.token);
    feeds = userFeeds;
  }

  // --- Input handlers ---

  function handleTopicInput(key) {
    const prevIndex = selectedIndex;

    if (key === "j" || key === "\x1b[B") {
      selectedIndex = Math.min(selectedIndex + 1, topics.length - 1);
    } else if (key === "k" || key === "\x1b[A") {
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (key === "d") {
      selectedIndex = Math.min(selectedIndex + 10, topics.length - 1);
    } else if (key === "u") {
      selectedIndex = Math.max(selectedIndex - 10, 0);
    } else if (key === "g") {
      selectedIndex = 0;
    } else if (key === "G") {
      selectedIndex = topics.length - 1;
    } else if (key === "\r" || key === "l") {
      const topic = topics[selectedIndex];
      selectedTopic = topic;
      loadArticles(topic).catch((err) => {
        if (err instanceof TokenExpiredError) {
          reauthenticate()
            .then(() => loadArticles(topic))
            .catch((e) => { errorMessage = e.message; screen = "error"; drawError(); });
        } else {
          errorMessage = err.message;
          screen = "error";
          drawError();
        }
      });
      return;
    } else if (key === "?") {
      previousScreen = "topics";
      screen = "help";
      drawHelp();
      return;
    } else if (key === "L") {
      clearCachedToken();
      if (spinnerTimer) clearInterval(spinnerTimer);
      term.showCursor();
      term.leaveAltScreen();
      process.stdin.setRawMode(false);
      console.log("Logged out successfully.");
      process.exit(0);
      return;
    } else if (key === "q") {
      cleanup();
      return;
    }

    if (prevIndex !== selectedIndex) {
      drawTopicRow(prevIndex);
      drawTopicRow(selectedIndex);
    }
  }

  function handleArticleInput(key) {
    const prevIndex = selectedIndex;
    const prevOffset = scrollOffset;

    if (key === "j" || key === "\x1b[B") {
      selectedIndex = Math.min(selectedIndex + 1, articles.length - 1);
    } else if (key === "k" || key === "\x1b[A") {
      selectedIndex = Math.max(selectedIndex - 1, 0);
    } else if (key === "d") {
      selectedIndex = Math.min(selectedIndex + 10, articles.length - 1);
    } else if (key === "u") {
      selectedIndex = Math.max(selectedIndex - 10, 0);
    } else if (key === "g") {
      selectedIndex = 0;
    } else if (key === "G") {
      selectedIndex = articles.length - 1;
    } else if (key === "\r" || key === "l") {
      if (articles[selectedIndex]) {
        const article = articles[selectedIndex];
        readHistory.add(article.id);
        saveReadArticle(article.id);
        drawArticleRow(selectedIndex);
        openUrl(article.url);
      }
      return;
    } else if (key === "p") {
      if (articles[selectedIndex]) {
        previewArticle = articles[selectedIndex];
        previewLines = buildPreviewLines(previewArticle);
        previewScrollOffset = 0;
        previousScreen = "articles";
        screen = "preview";
        drawPreview();
      }
      return;
    } else if (key === "v") {
      const article = articles[selectedIndex];
      if (!article) return;
      if (!article.audioUrl) {
        drawStatusBar("Tämä ei ole podcast-jakso");
        return;
      }
      drawStatusBar("Avataan VLC:ssä...");
      openInVlc(article.audioUrl, config).then((ok) => {
        if (screen !== "articles") return;
        if (ok) drawArticlesStatusBar();
        else drawStatusBar('VLC:n avaaminen epäonnistui — aseta "player" config.json:iin');
      });
      return;
    } else if (key === "r") {
      loadArticles(selectedTopic, true).catch((err) => {
        if (err instanceof TokenExpiredError) {
          reauthenticate()
            .then(() => loadArticles(selectedTopic, true))
            .catch((e) => { errorMessage = e.message; screen = "error"; drawError(); });
        } else {
          errorMessage = err.message;
          screen = "error";
          drawError();
        }
      });
      return;
    } else if (key === "\x1b") {
      // Escape — clear search filter if active
      if (searchQuery) {
        searchQuery = "";
        applySearchFilter();
        drawArticlesFull();
      }
      return;
    } else if (key === "/") {
      searchQuery = "";
      screen = "search";
      drawSearchBar();
      return;
    } else if (key === "?") {
      previousScreen = "articles";
      screen = "help";
      drawHelp();
      return;
    } else if (key === "q" || key === "h") {
      screen = "topics";
      allArticles = [];
      articles = [];
      searchQuery = "";
      selectedIndex = topics.indexOf(selectedTopic);
      if (selectedIndex < 0) selectedIndex = 0;
      drawTopicsFull();
      return;
    }

    if (prevIndex !== selectedIndex) {
      const viewportHeight = term.rows - 5;
      const half = Math.floor(viewportHeight / 2);
      if (articles.length > viewportHeight) {
        scrollOffset = Math.max(0, Math.min(selectedIndex - half, articles.length - viewportHeight));
      }

      if (scrollOffset !== prevOffset) {
        for (let vi = 0; vi < viewportHeight; vi++) {
          drawArticleRow(vi + scrollOffset);
        }
      } else {
        drawArticleRow(prevIndex);
        drawArticleRow(selectedIndex);
      }

      if (articles.length > viewportHeight) {
        drawArticleHeader();
      }
    }
  }

  function handleSearchInput(key) {
    if (key === "\x1b" || key === "\x1b[A" || key === "\x1b[B") {
      // Escape or arrow keys — exit search, clear filter
      searchQuery = "";
      applySearchFilter();
      screen = "articles";
      drawArticlesFull();
    } else if (key === "\r") {
      // Enter — confirm search, stay in articles with filter applied
      screen = "articles";
      drawArticlesFull();
    } else if (key === "\x7f" || key === "\b") {
      // Backspace
      searchQuery = searchQuery.slice(0, -1);
      applySearchFilter();
      drawArticlesFull();
      drawSearchBar();
    } else if (key.charCodeAt(0) >= 32 && key.length === 1) {
      // Printable character
      searchQuery += key;
      applySearchFilter();
      drawArticlesFull();
      drawSearchBar();
    }
  }

  function handleHelpInput(key) {
    if (key === "q" || key === "?" || key === "\x1b") {
      screen = previousScreen;
      if (screen === "topics") drawTopicsFull();
      else if (screen === "articles") drawArticlesFull();
    }
  }

  function handlePreviewInput(key) {
    if (key === "\r" || key === "l") {
      if (previewArticle) {
        readHistory.add(previewArticle.id);
        saveReadArticle(previewArticle.id);
        openUrl(previewArticle.url);
      }
      return;
    } else if (key === "v") {
      if (!previewArticle) return;
      if (!previewArticle.audioUrl) {
        drawStatusBar("Tämä ei ole podcast-jakso");
        return;
      }
      drawStatusBar("Avataan VLC:ssä...");
      openInVlc(previewArticle.audioUrl, config).then((ok) => {
        if (screen !== "preview") return;
        if (ok) drawPreviewStatusBar();
        else drawStatusBar('VLC:n avaaminen epäonnistui — aseta "player" config.json:iin');
      });
      return;
    } else if (key === "j" || key === "\x1b[B") {
      const viewportHeight = term.rows - 4;
      if (previewScrollOffset < previewLines.length - viewportHeight) {
        previewScrollOffset++;
        drawPreview();
      }
    } else if (key === "k" || key === "\x1b[A") {
      if (previewScrollOffset > 0) {
        previewScrollOffset--;
        drawPreview();
      }
    } else if (key === "q" || key === "h" || key === "\x1b") {
      screen = "articles";
      drawArticlesFull();
    }
  }

  function handleErrorInput(key) {
    if (key === "q" || key === "h" || key === "\x1b") {
      screen = "topics";
      selectedIndex = topics.indexOf(selectedTopic);
      if (selectedIndex < 0) selectedIndex = 0;
      drawTopicsFull();
    }
  }

  // Main input dispatcher
  process.stdin.on("data", async (key) => {
    if (key === "\x03") {
      cleanup();
      return;
    }

    if (screen === "topics") handleTopicInput(key);
    else if (screen === "articles") handleArticleInput(key);
    else if (screen === "search") handleSearchInput(key);
    else if (screen === "preview") handlePreviewInput(key);
    else if (screen === "help") handleHelpInput(key);
    else if (screen === "error") handleErrorInput(key);
  });

  // Redraw on terminal resize
  process.stdout.on("resize", () => {
    if (screen === "topics") drawTopicsFull();
    else if (screen === "articles") drawArticlesFull();
    else if (screen === "preview") drawPreview();
    else if (screen === "help") drawHelp();
    else if (screen === "error") drawError();
  });

  // Startup — try cached token, prompt for credentials if needed
  let splashStart = Date.now();

  try {
    const cachedToken = loadCachedToken();
    let auth = null;

    if (cachedToken) {
      auth = await verifyToken(config.server, cachedToken);
    }

    if (!auth) {
      // Need fresh login — exit alt screen to show prompt
      term.showCursor();
      term.leaveAltScreen();
      process.stdin.setRawMode(false);
      process.stdin.pause();
      console.log(term.boldYellow("\n  Juoruankka — Kirjaudu sisään\n"));
      const { email, password } = await promptCredentials();

      // Re-enter alt screen and restore raw mode
      term.enterAltScreen();
      term.hideCursor();
      process.stdin.setRawMode(true);
      process.stdin.resume();
      drawSplash("Kirjaudutaan sisään...");

      auth = await login(config.server, email, password);
      saveCachedToken(auth.token);
      splashStart = Date.now();
    }

    token = auth.token;
    user = auth.user;

    drawSplash("Haetaan syötteitä...");
    const userFeeds = await fetchFeeds(config.server, auth.token);
    feeds = userFeeds;

    const enabledFeeds = userFeeds.filter((f) => f.enabled !== false);
    const categories = new Set(enabledFeeds.map((f) => f.category).filter(Boolean));
    topics = ["all", ...TOPIC_ORDER.filter((t) => t !== "all" && categories.has(t)), ...VIRTUAL_TOPICS];

    // Keep splash visible for at least 1.5s
    const elapsed = Date.now() - splashStart;
    if (elapsed < 1500) {
      await new Promise((r) => setTimeout(r, 1500 - elapsed));
    }

    // Give the background version check a brief moment to land so the topics
    // screen can show the notice immediately; never block longer than 2s.
    await Promise.race([updateCheck, new Promise((r) => setTimeout(r, 2000))]);

    stopSpinner();
    screen = "topics";
    selectedIndex = 0;
    drawTopicsFull();
  } catch (err) {
    stopSpinner();
    term.clearScreen();
    drawHeader();
    term.writeLine(2, ` ${term.cyan(`Virhe: ${err.message}`)}`);
    drawStatusBar("q: quit");
    process.stdin.on("data", (key) => {
      if (key === "q" || key === "\x03") cleanup();
    });
  }
}
