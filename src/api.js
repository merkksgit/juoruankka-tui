export async function verifyToken(server, token) {
  const res = await fetch(`${server}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) return null;
  const data = await res.json();
  if (data.status !== "ok") return null;

  return { token, user: data.user };
}

export async function login(server, email, password) {
  const res = await fetch(`${server}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });

  const data = await res.json();
  if (data.status !== "ok") {
    throw new Error(data.message || "Login failed");
  }

  return { token: data.token, user: data.user };
}

export async function fetchFeeds(server, token) {
  const res = await fetch(`${server}/api/feeds/sync`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  const data = await res.json();
  if (data.status !== "ok") {
    throw new Error(data.message || "Failed to fetch feeds");
  }

  return data.feeds;
}

export async function fetchArticles(server, feeds) {
  const res = await fetch(`${server}/api/articles`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ feeds }),
  });

  const data = await res.json();
  if (data.status !== "ok") {
    throw new Error(data.message || "Failed to fetch articles");
  }

  return data.articles;
}
