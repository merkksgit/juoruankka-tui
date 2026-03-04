// Raw terminal helpers — direct ANSI escape sequences for flicker-free rendering

const ESC = "\x1b[";

export const term = {
  // Screen buffer
  enterAltScreen: () => process.stdout.write("\x1b[?1049h"),
  leaveAltScreen: () => process.stdout.write("\x1b[?1049l"),

  // Cursor
  hideCursor: () => process.stdout.write(`${ESC}?25l`),
  showCursor: () => process.stdout.write(`${ESC}?25h`),
  moveTo: (row, col) => process.stdout.write(`${ESC}${row + 1};${col + 1}H`),

  // Clearing
  clearScreen: () => process.stdout.write(`${ESC}2J`),
  clearLine: () => process.stdout.write(`${ESC}2K`),

  // Colors
  yellow: (text) => `\x1b[33m${text}\x1b[0m`,
  cyan: (text) => `\x1b[36m${text}\x1b[0m`,
  blue: (text) => `\x1b[34m${text}\x1b[0m`,
  orange: (text) => `\x1b[38;5;208m${text}\x1b[0m`,
  gray: (text) => `\x1b[37m${text}\x1b[0m`,
  dim: (text) => `\x1b[90m${text}\x1b[0m`,
  dimWhite: (text) => `\x1b[2;37m${text}\x1b[0m`,
  white: (text) => `\x1b[37m${text}\x1b[0m`,
  bold: (text) => `\x1b[1m${text}\x1b[0m`,
  boldYellow: (text) => `\x1b[1;33m${text}\x1b[0m`,

  // Terminal size
  get rows() { return process.stdout.rows || 24; },
  get cols() { return process.stdout.columns || 80; },

  // Write at position (clears line first to avoid artifacts)
  writeAt: (row, col, text) => {
    process.stdout.write(`${ESC}${row + 1};${col + 1}H${ESC}2K${text}`);
  },

  // Write full line at row
  writeLine: (row, text) => {
    process.stdout.write(`${ESC}${row + 1};1H${ESC}2K${text}`);
  },
};
