import { term } from "./term.js";
import { login, verifyToken, fetchFeeds, fetchArticles, refreshArticles, TokenExpiredError } from "./api.js";
import { loadCachedToken, saveCachedToken, loadReadHistory, saveReadArticle } from "./config.js";
import { promptCredentials } from "./prompt.js";
import open from "open";

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
};

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

    const version = "v0.2.1";
    term.writeLine(startRow + LOGO.length + 1, " ".repeat(Math.max(0, Math.floor((term.cols - version.length) / 2))) + term.gray(version));

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
    term.writeLine(1, "");
    term.writeLine(2, ` ${term.boldYellow("Aiheet")}`);

    for (let i = 0; i < topics.length; i++) {
      drawTopicRow(i);
    }

    drawStatusBar("j/k: navigate  Enter/l: select  ?: help  q: quit");
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

    drawStatusBar("j/k: navigate  Enter/l: open  /: search  r: refresh  ?: help  q/h: back");
  }

  // --- Help screen ---

  function drawHelp() {
    term.clearScreen();
    drawHeader();
    term.writeLine(2, ` ${term.boldYellow("Pikanäppäimet")}`);

    const bindings = [
      ["j / ↓", "Seuraava"],
      ["k / ↑", "Edellinen"],
      ["g", "Ensimmäinen"],
      ["G", "Viimeinen"],
      ["Enter / l", "Valitse / Avaa"],
      ["q / h", "Takaisin"],
      ["r", "Päivitä artikkelit"],
      ["/", "Hae artikkeleita"],
      ["Esc", "Tyhjennä haku"],
      ["?", "Näytä ohje"],
      ["Ctrl+C", "Poistu"],
    ];

    for (let i = 0; i < bindings.length; i++) {
      const [key, desc] = bindings[i];
      term.writeLine(4 + i, `   ${term.cyan(key.padEnd(14))} ${term.white(desc)}`);
    }

    drawStatusBar("q/?/Esc: back");
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
    screen = "loading";
    drawLoading(forceRefresh ? "Päivitetään syötteitä..." : "Haetaan artikkeleita...");

    const topicFeeds = topic === "all"
      ? feeds.filter((f) => f.enabled !== false)
      : feeds.filter((f) => f.category === topic && f.enabled !== false);

    const feedPayload = topicFeeds.map((f) => ({ url: f.url, name: f.name }));
    const fetch = forceRefresh ? refreshArticles : fetchArticles;
    const arts = await fetch(config.server, feedPayload);

    const seen = new Set();
    const unique = arts.filter((a) => {
      if (seen.has(a.id)) return false;
      seen.add(a.id);
      return true;
    });
    unique.sort((a, b) => b.timestamp - a.timestamp);

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

  async function reauthenticate() {
    term.showCursor();
    term.leaveAltScreen();
    console.log(term.boldYellow("\n  Istunto vanhentunut — kirjaudu uudelleen\n"));
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
        open(article.url).catch(() => {});
      }
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
    else if (screen === "help") handleHelpInput(key);
    else if (screen === "error") handleErrorInput(key);
  });

  // Redraw on terminal resize
  process.stdout.on("resize", () => {
    if (screen === "topics") drawTopicsFull();
    else if (screen === "articles") drawArticlesFull();
    else if (screen === "help") drawHelp();
    else if (screen === "error") drawError();
  });

  // Startup — try cached token, prompt for credentials if needed
  const splashStart = Date.now();

  try {
    const cachedToken = loadCachedToken();
    let auth = null;

    if (cachedToken) {
      drawSplash("Kirjaudutaan sisään...");
      auth = await verifyToken(config.server, cachedToken);
    }

    if (!auth) {
      // Need fresh login — exit alt screen to show prompt
      term.showCursor();
      term.leaveAltScreen();
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
    }

    token = auth.token;
    user = auth.user;

    drawSplash("Haetaan syötteitä...");
    const userFeeds = await fetchFeeds(config.server, auth.token);
    feeds = userFeeds;

    const enabledFeeds = userFeeds.filter((f) => f.enabled !== false);
    const categories = new Set(enabledFeeds.map((f) => f.category).filter(Boolean));
    topics = ["all", ...TOPIC_ORDER.filter((t) => t !== "all" && categories.has(t))];

    // Keep splash visible for at least 1.5s
    const elapsed = Date.now() - splashStart;
    if (elapsed < 1500) {
      await new Promise((r) => setTimeout(r, 1500 - elapsed));
    }

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
