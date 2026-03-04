# Juoruankka TUI

A terminal UI client for [Juoruankka](https://juoruankka.com), a self-hosted RSS news aggregator. Browse your feeds, navigate by topic, and open articles in your browser -- all from the terminal.

```
     ██╗██╗   ██╗ ██████╗ ██████╗ ██╗   ██╗ █████╗ ███╗   ██╗██╗  ██╗██╗  ██╗ █████╗
     ██║██║   ██║██╔═══██╗██╔══██╗██║   ██║██╔══██╗████╗  ██║██║ ██╔╝██║ ██╔╝██╔══██╗
     ██║██║   ██║██║   ██║██████╔╝██║   ██║███████║██╔██╗ ██║█████╔╝ █████╔╝ ███████║
██   ██║██║   ██║██║   ██║██╔══██╗██║   ██║██╔══██║██║╚██╗██║██╔═██╗ ██╔═██╗ ██╔══██║
╚█████╔╝╚██████╔╝╚██████╔╝██║  ██║╚██████╔╝██║  ██║██║ ╚████║██║  ██╗██║  ██╗██║  ██║
 ╚════╝  ╚═════╝  ╚═════╝ ╚═╝  ╚═╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═══╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝  ╚═╝
```

## Requirements

- Node.js 18+
- A Juoruankka account

## Installation

### Option 1: Install globally from source

```bash
git clone https://github.com/yourusername/juoruankka-tui.git
cd juoruankka-tui
npm install
npm link
```

This makes the `juoruankka` command available globally. To uninstall: `npm unlink -g juoruankka-tui`

### Option 2: Run without installing globally

```bash
git clone https://github.com/yourusername/juoruankka-tui.git
cd juoruankka-tui
npm install
npm start
```

## Configuration

On first launch, the TUI will guide you through setup:

1. Prompts for the server URL (defaults to `https://juoruankka.com`)
2. Creates a config file at `~/.config/juoruankka-tui/config.json`
3. Prompts for your email and password to log in

Credentials are never stored on disk -- only the authentication token (JWT) is cached in the config file for subsequent launches. When the token expires, you'll be prompted to log in again.

## Usage

```bash
# If installed globally
juoruankka

# If running from the project directory
npm start
```

## Keybindings

| Key           | Action                  |
|---------------|-------------------------|
| `j` / Down    | Move down               |
| `k` / Up      | Move up                 |
| `g`           | Jump to top             |
| `G`           | Jump to bottom          |
| `Enter` / `l` | Select topic / Open URL |
| `q` / `h`     | Go back / Quit          |
| `Ctrl+C`      | Force quit              |

## How It Works

The TUI connects to the Juoruankka API using credentials from the config file. On startup it:

1. Authenticates and fetches your synced RSS feeds
2. Extracts available topics from your feed categories
3. Presents a navigable topic list
4. When a topic is selected, fetches and displays articles in a compact list
5. Pressing Enter on an article opens it in your default browser

## Technical Details

- Pure Node.js with no frameworks -- uses raw ANSI escape sequences for rendering
- Alternate screen buffer for clean terminal state on exit
- Differential rendering (only changed rows are redrawn) for flicker-free navigation
- Single runtime dependency: `open` (for launching URLs in browser)
- Articles are deduplicated across feeds to prevent repeated entries

## Project Structure

```
cli/
├── index.js          # Entry point, config loading
├── package.json
├── src/
│   ├── App.js        # Main app logic, screens, input handling
│   ├── api.js        # API client (login, feeds, articles)
│   ├── config.js     # Config file management (~/.config/juoruankka-tui/)
│   ├── prompt.js     # Interactive credential prompts
│   └── term.js       # ANSI terminal helpers
```

## License

Part of the Juoruankka project.
