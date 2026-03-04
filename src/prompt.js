import { createInterface } from "readline";

function prompt(question) {
  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer);
    });
  });
}

function promptHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding("utf8");

    let input = "";

    const onData = (key) => {
      if (key === "\r" || key === "\n") {
        // Enter — submit
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.stdin.removeListener("data", onData);
        process.stdout.write("\n");
        resolve(input);
      } else if (key === "\x03") {
        // Ctrl+C — exit
        process.stdout.write("\n");
        process.exit(0);
      } else if (key === "\x15") {
        // Ctrl+U — clear line
        input = "";
      } else if (key === "\x17") {
        // Ctrl+W — delete last word
        input = input.replace(/\S*\s*$/, "");
      } else if (key === "\x7f" || key === "\b") {
        // Backspace
        input = input.slice(0, -1);
      } else if (key.charCodeAt(0) >= 32) {
        // Printable character
        input += key;
      }
    };

    process.stdin.on("data", onData);
  });
}

export async function promptCredentials() {
  console.log("");
  const email = await prompt("  Email: ");
  const password = await promptHidden("  Password: ");
  return { email, password };
}
