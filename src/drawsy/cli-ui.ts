import type { LocalEngineStatus } from "./engine-status.js";

type CompanionState = "running" | "starting" | "stopped" | "other";

type Dashboard = {
  version: string;
  companion: CompanionState;
  companionVersion?: string;
  autostart?: boolean;
  engines: LocalEngineStatus[];
  includeLinks?: boolean;
  hint?: string;
};

const colors = {
  violet: "38;2;101;84;217",
  coral: "38;2;255;125;136",
  blue: "38;2;88;162;232",
  orange: "38;2;245;119;45",
  green: "38;2;55;153;80",
  muted: "38;2;137;143;156",
  amber: "38;2;210;153;34",
};

const canColor = () => Boolean(
  process.stdout.isTTY && !("NO_COLOR" in process.env) && process.env.TERM !== "dumb",
);

const paint = (text: string, color: string, bold = false) =>
  canColor() ? `\u001b[${bold ? "1;" : ""}${color}m${text}\u001b[0m` : text;

const delay = (milliseconds: number) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function wordmark(): string {
  return [
    paint("D", colors.violet, true),
    paint("r", colors.violet, true),
    paint("a", colors.coral, true),
    paint("w", colors.orange, true),
    paint("s", colors.green, true),
    paint("y", colors.blue, true),
  ].join("");
}

async function printHeader(animate: boolean): Promise<void> {
  const letters = ["D", "r", "a", "w", "s", "y"];
  const letterColors = [colors.violet, colors.violet, colors.coral, colors.orange, colors.green, colors.blue];
  const animated = animate && process.stdout.isTTY && !process.env.CI && process.env.TERM !== "dumb";

  if (animated) {
    let visible = "";
    for (let index = 0; index < letters.length; index++) {
      visible += paint(letters[index]!, letterColors[index]!, true);
      process.stdout.write(`\r  ${visible} Companion`);
      await delay(38);
    }
    process.stdout.write("\n");
    return;
  }

  console.log(`\n  ${wordmark()} Companion`);
}

type Indicator = { stop: (message: string) => void };

/** Animate one drawn stroke across the line only in an interactive terminal. */
export function startDrawsyIndicator(label: string): Indicator {
  if (!process.stdout.isTTY || process.env.CI || process.env.TERM === "dumb") {
    return { stop: () => undefined };
  }

  const width = 9;
  let position = 0;
  let direction = 1;
  const render = () => {
    const stroke = `${"-".repeat(position)}${paint("/", colors.violet)}${"-".repeat(width - position - 1)}`;
    process.stdout.write(`\r\u001b[2K  ${stroke}  ${label}`);
    position += direction;
    if (position === width - 1 || position === 0) direction *= -1;
  };

  render();
  const timer = setInterval(render, 75);
  timer.unref();

  return {
    stop(message: string) {
      clearInterval(timer);
      process.stdout.write(`\r\u001b[2K  ${paint("OK", colors.green, true)}  ${message}\n`);
    },
  };
}

export async function printDashboard(state: Dashboard, animate = false): Promise<void> {
  await printHeader(animate);
  console.log(`  ${paint("Local bridge", colors.muted)}  ${paint(`v${state.version}`, colors.muted)}`);
  console.log("");

  const companionLabel: Record<CompanionState, [string, string]> = {
    running: ["Running", colors.green],
    starting: ["Starting", colors.amber],
    stopped: ["Not running", colors.muted],
    other: ["Another Companion is running", colors.amber],
  };
  const [companionText, companionColor] = companionLabel[state.companion];
  const companionVersion = state.companionVersion ? ` · v${state.companionVersion}` : "";
  console.log(`  ${"Companion".padEnd(12)} ${paint(`${companionText}${companionVersion}`, companionColor)}`);

  for (const engine of state.engines) {
    let label: string;
    let color: string;
    if (!engine.installed) {
      label = "Not found";
      color = colors.muted;
    } else if (engine.id === "opencode" && process.platform === "win32") {
      label = "Installed · unavailable on Windows";
      color = colors.amber;
    } else {
      label = `Available${engine.version ? ` · v${engine.version}` : ""}`;
      color = colors.green;
    }
    console.log(`  ${engine.name.padEnd(12)} ${paint(label, color)}`);
  }

  if (state.autostart !== undefined) {
    console.log(`  ${"At sign-in".padEnd(12)} ${paint(state.autostart ? "Enabled" : "Off", state.autostart ? colors.green : colors.muted)}`);
  }

  if (state.includeLinks) {
    console.log("");
    console.log(`  Open Drawsy  ${paint("https://drawsyai.com", colors.blue)}`);
    console.log(`  Plans        ${paint("https://app.drawsyai.com/pricing", colors.muted)}`);
  }

  if (state.hint) {
    console.log("");
    console.log(`  ${paint(state.hint, colors.muted)}`);
  }

  console.log("");
}

export async function printHelp(version: string): Promise<void> {
  await printHeader(false);
  console.log(`  ${paint(`v${version}`, colors.muted)} · local canvas bridge`);
  console.log("");
  console.log("  no command          Show status and links");
  console.log("  setup              Start now and at sign-in");
  console.log("  start              Start for this login session");
  console.log("  serve              Run in this terminal");
  console.log("  status | stop | logs");
  console.log("  autostart enable | disable");
  console.log("");
  console.log("  Update: npm install --global --ignore-scripts @drawsy/companion@latest");
  console.log("");
}
