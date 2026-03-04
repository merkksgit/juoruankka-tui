const TIMEOUT = 15000;

export class TokenExpiredError extends Error {
  constructor() {
    super("Istunto vanhentunut");
    this.name = "TokenExpiredError";
  }
}

function timeoutSignal() {
  return AbortSignal.timeout(TIMEOUT);
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
      signal: timeoutSignal(),
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

export async function refreshArticles(server, feeds) {
  let res;
  try {
    res = await fetch(`${server}/api/articles/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ feeds }),
      signal: timeoutSignal(),
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
