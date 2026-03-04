# CLAUDE.md — Juoruankka TUI

## Project Overview

Terminal UI client for the Juoruankka RSS news aggregator. Connects to the Juoruankka API to browse articles by topic with vim-style navigation.

## Architecture

- **Pure Node.js** — no frameworks, no build step, no transpilation
- **Raw ANSI terminal control** — alternate screen buffer, direct cursor positioning, differential rendering for zero flicker
- **Single dependency** — `open` (for launching URLs in browser)
- **ES modules** throughout

## Project Structure

```
cli/
├── index.js          # Entry point, config loading
├── package.json
├── src/
│   ├── App.js        # Main app logic, screens, input handling, rendering
│   ├── api.js        # API client (login, fetchFeeds, fetchArticles)
│   ├── config.js     # Config file reader (~/.juoruankka.json)
│   └── term.js       # ANSI escape sequence helpers
```

## Key Design Decisions

### Rendering
- Uses alternate screen buffer (`\x1b[?1049h`) for clean enter/exit
- Differential row updates: only redraws changed rows on navigation
- Full row-by-row rewrite (without clearScreen) on scroll offset changes
- `clearScreen` only used on full screen transitions (topic list <-> article list)

### Navigation
- Vim keybindings: `j`/`k` navigate, `g`/`G` top/bottom, `Enter`/`l` select, `q`/`h` back
- Arrow keys also supported
- `Ctrl+C` always exits

### Colors
- Yellow/bold yellow: headers, selected items
- Blue: feed source names
- Cyan: timestamps, loading messages
- Orange (256-color 208): navigation hints
- White: article titles (unselected)
- Dim (dark gray): separators

## Config File

Located at `~/.config/juoruankka-tui/config.json`:
```json
{
  "server": "https://juoruankka.com",
  "token": "jwt-token-cached-after-login"
}
```

Created automatically on first launch. Credentials are prompted interactively on first launch and when the token expires. Password is never stored on disk — only the JWT token is cached. The config file is set to `chmod 600` after writing.

## API Endpoints Used

- `POST /api/auth/login` — authenticate (only on first launch / token expiry)
- `GET /api/auth/me` — validate cached token
- `GET /api/feeds/sync` — fetch user's RSS feeds (requires JWT)
- `POST /api/articles` — fetch articles for given feeds

## Running

```bash
npm install
npm start
```

## Development Notes

- Node.js 18+ required (uses native `fetch`)
- No build step — edit and run directly
- Terminal must support ANSI escape sequences and 256-color
- Articles are deduplicated by `id` to prevent duplicates across topics
- Splash screen shows for minimum 1.5s on startup

## Git Conventions

- Do not include the `Co-Authored-By` line in commit messages
