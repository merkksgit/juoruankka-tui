// Auth/feed-list calls are cheap and should fail fast. Article fetches can be
// slow on a cold cache: the backend fetches each missing feed live with a 25s
// per-feed timeout, batched. A refresh clears the whole cache, so every feed is
// cold — give it the most headroom.
const TIMEOUT = 15000;
const ARTICLES_TIMEOUT = 30000;
const REFRESH_TIMEOUT = 45000;

export class TokenExpiredError extends Error {
  constructor() {
    super("Istunto vanhentunut");
    this.name = "TokenExpiredError";
  }
}

function timeoutSignal(ms = TIMEOUT) {
  return AbortSignal.timeout(ms);
}

function wrapFetchError(err) {
  if (err.name === "TimeoutError" || err.name === "AbortError") {
    throw new Error("Yhteys aikakatkaistiin");
  }
  throw err;
}

export async function verifyToken(server, token) {
  let res;
  try {
    res = await fetch(`${server}/api/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: timeoutSignal(),
    });
  } catch (err) {
    wrapFetchError(err);
  }

  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== "ok") return null;

  return { token, user: data.user };
}

export async function login(server, email, password) {
  let res;
  try {
    res = await fetch(`${server}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
      signal: timeoutSignal(),
    });
  } catch (err) {
    wrapFetchError(err);
  }

  const data = await res.json();
  if (data.status !== "ok") {
    throw new Error(data.message || "Login failed");
  }

  return { token: data.token, user: data.user };
}

export async function fetchFeeds(server, token) {
  let res;
  try {
    res = await fetch(`${server}/api/feeds/sync`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: timeoutSignal(),
    });
  } catch (err) {
    wrapFetchError(err);
  }

  if (res.status === 401) throw new TokenExpiredError();

  const data = await res.json();
  if (data.status !== "ok") {
    throw new Error(data.message || "Failed to fetch feeds");
  }

  return data.feeds;
}

export async function fetchArticles(server, feeds) {
  let res;
  try {
    res = await fetch(`${server}/api/articles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feeds }),
      signal: timeoutSignal(ARTICLES_TIMEOUT),
    });
  } catch (err) {
    wrapFetchError(err);
  }

  if (res.status === 401) throw new TokenExpiredError();

  const data = await res.json();
  if (data.status !== "ok") {
    throw new Error(data.message || "Failed to fetch articles");
  }

  return data.articles;
}

export async function fetchSaved(server, token) {
  let res;
  try {
    res = await fetch(`${server}/api/saved`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: timeoutSignal(),
    });
  } catch (err) {
    wrapFetchError(err);
  }

  if (res.status === 401) throw new TokenExpiredError();

  const data = await res.json();
  if (data.status !== "ok") {
    throw new Error(data.message || "Failed to fetch saved articles");
  }

  return data.articles;
}

export async function fetchLikes(server, token) {
  let res;
  try {
    res = await fetch(`${server}/api/likes`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: timeoutSignal(),
    });
  } catch (err) {
    wrapFetchError(err);
  }

  if (res.status === 401) throw new TokenExpiredError();

  const data = await res.json();
  if (data.status !== "ok") {
    throw new Error(data.message || "Failed to fetch liked articles");
  }

  return data.articles;
}

export async function refreshArticles(server, feeds) {
  let res;
  try {
    res = await fetch(`${server}/api/articles/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feeds }),
      signal: timeoutSignal(REFRESH_TIMEOUT),
    });
  } catch (err) {
    wrapFetchError(err);
  }

  if (res.status === 401) throw new TokenExpiredError();

  const data = await res.json();
  if (data.status !== "ok") {
    throw new Error(data.message || "Failed to refresh articles");
  }

  return data.articles;
}
