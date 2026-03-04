import { term } from "./term.js";
import { login, verifyToken, fetchFeeds, fetchArticles } from "./api.js";
import { loadCachedToken, saveCachedToken } from "./config.js";
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

export async function startApp(config) {
  // Setup terminal
  term.enterAltScreen();
  term.hideCursor();
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding("utf8");

  const cleanup = () => {
    term.showCursor();
    term.leaveAltScreen();
    process.stdin.setRawMode(false);
    process.exit(0);
  };

  process.on("SIGINT", cleanup);
  process.on("SIGTERM", cleanup);

  // State
  let screen = "loading";
  let token = null;
  let user = null;
  let feeds = [];
  let topics = [];
  let articles = [];
  let selectedIndex = 0;
  let scrollOffset = 0;
  let selectedTopic = null;

  // Render functions
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
    term.clearScreen();
    const startRow = Math.max(0, Math.floor((term.rows - LOGO.length) / 2) - 2);

    for (let i = 0; i < LOGO.length; i++) {
      const pad = Math.max(0, Math.floor((term.cols - 85) / 2));
      term.writeLine(startRow + i, " ".repeat(pad) + term.yellow(LOGO[i]));
    }

    const version = "v0.1.0";
    term.writeLine(
      startRow + LOGO.length + 1,
      " ".repeat(Math.max(0, Math.floor((term.cols - version.length) / 2))) +
        term.gray(version),
    );
    term.writeLine(
      startRow + LOGO.length + 3,
      " ".repeat(Math.max(0, Math.floor((term.cols - message.length) / 2))) +
        term.cyan(message),
    );
  }

  function drawLoading(message) {
    term.clearScreen();
    drawHeader();
    term.writeLine(2, ` ${term.cyan(message)}`);
  }

  // --- Topic screen ---

  function drawTopicRow(i) {
    const name = TOPIC_NAMES[topics[i]] || topics[i];
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

    drawStatusBar("j/k: navigate  Enter/l: select  q: quit");
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
    const rawTitle = article.title || "Untitled";
    const title =
      rawTitle.length > maxTitle
        ? rawTitle.slice(0, maxTitle - 1) + "…"
        : rawTitle;

    const source = article.source || "";
    const date = article.date || "";

    if (isSelected) {
      term.writeLine(
        row,
        ` ${term.boldYellow("▸")} ${term.boldYellow(title)} ${term.dim("│")} ${term.blue(source)} ${term.dim("│")} ${term.cyan(date)}`,
      );
    } else {
      term.writeLine(
        row,
        `   ${term.white(title)} ${term.dim("│")} ${term.blue(source)} ${term.dim("│")} ${term.cyan(date)}`,
      );
    }
  }

  function drawArticleHeader() {
    const viewportHeight = term.rows - 5;
    const topicName = TOPIC_NAMES[selectedTopic] || selectedTopic;
    const countInfo =
      articles.length > viewportHeight
        ? ` ${term.gray(`(${articles.length}) [${scrollOffset + 1}-${Math.min(scrollOffset + viewportHeight, articles.length)}/${articles.length}]`)}`
        : ` ${term.gray(`(${articles.length})`)}`;
    term.writeLine(2, ` ${term.boldYellow(topicName)}${countInfo}`);
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

    drawStatusBar("j/k: navigate  Enter/l: open  g/G: top/bottom  q/h: back");
  }

  // Input handler
  process.stdin.on("data", async (key) => {
    if (key === "\x03") {
      cleanup();
      return;
    }

    if (screen === "topics") {
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
        selectedIndex = 0;
        scrollOffset = 0;
        screen = "loading";
        drawLoading("Haetaan artikkeleita...");

        try {
          const topicFeeds =
            topic === "all"
              ? feeds.filter((f) => f.enabled !== false)
              : feeds.filter(
                  (f) => f.category === topic && f.enabled !== false,
                );

          const feedPayload = topicFeeds.map((f) => ({
            url: f.url,
            name: f.name,
          }));
          const arts = await fetchArticles(config.server, feedPayload);
          // Deduplicate by article id
          const seen = new Set();
          const unique = arts.filter((a) => {
            if (seen.has(a.id)) return false;
            seen.add(a.id);
            return true;
          });
          unique.sort((a, b) => b.timestamp - a.timestamp);
          articles = unique;
          screen = "articles";
          drawArticlesFull();
        } catch (err) {
          drawLoading(`Virhe: ${err.message}`);
        }
        return;
      } else if (key === "q") {
        cleanup();
        return;
      }

      if (prevIndex !== selectedIndex) {
        // Only redraw the two changed rows
        drawTopicRow(prevIndex);
        drawTopicRow(selectedIndex);
      }
    } else if (screen === "articles") {
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
          try {
            await open(articles[selectedIndex].url);
          } catch {}
        }
        return;
      } else if (key === "q" || key === "h") {
        screen = "topics";
        selectedIndex = topics.indexOf(selectedTopic);
        if (selectedIndex < 0) selectedIndex = 0;
        drawTopicsFull();
        return;
      }

      if (prevIndex !== selectedIndex) {
        // Recalculate scroll offset
        const viewportHeight = term.rows - 5;
        const half = Math.floor(viewportHeight / 2);
        if (articles.length > viewportHeight) {
          scrollOffset = Math.max(
            0,
            Math.min(selectedIndex - half, articles.length - viewportHeight),
          );
        }

        if (scrollOffset !== prevOffset) {
          // Redraw all visible rows in-place (no clearScreen)
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
  });

  // Redraw on terminal resize
  process.stdout.on("resize", () => {
    if (screen === "topics") drawTopicsFull();
    else if (screen === "articles") drawArticlesFull();
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

    const categories = new Set(
      userFeeds.map((f) => f.category).filter(Boolean),
    );
    topics = [
      "all",
      ...TOPIC_ORDER.filter((t) => t !== "all" && categories.has(t)),
    ];

    // Keep splash visible for at least 1.5s
    const elapsed = Date.now() - splashStart;
    if (elapsed < 1500) {
      await new Promise((r) => setTimeout(r, 1500 - elapsed));
    }

    screen = "topics";
    selectedIndex = 0;
    drawTopicsFull();
  } catch (err) {
    drawLoading(`Virhe: ${err.message}`);
    drawStatusBar("q: quit");
    process.stdin.on("data", (key) => {
      if (key === "q" || key === "\x03") cleanup();
    });
  }
}
