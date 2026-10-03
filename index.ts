import { readFileSync, existsSync } from "node:fs";
import { open, readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";
import { WhichKeyPanel, type PanelSettings } from "./panel.ts";
import { getAgentDir, type ExtensionAPI, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { getKeybindings, matchesKey, isKeyRelease, truncateToWidth, type KeyId } from "@earendil-works/pi-tui";

// No editor replacement, global input listener, private API, or synthetic keystrokes.
type Action = "command" | "prefill" | "branchDiff" | "preset" | "presetPicker" | "projectConfig" | "agentsFile";
type Entry = { label: string; icon?: string; children?: Menu; action?: Action; command?: string; requires?: string; preset?: string; git?: boolean; idle?: boolean };
type Menu = Record<string, Entry>;
type Preset = { sparkNames: string[]; provider?: string; model?: string; thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max" };
type Config = PanelSettings & { enabled: boolean; presets: Record<string, Preset>; menu: Menu };
type Status = { reason?: string; note?: string };
type Snapshot = { loading: boolean; gitRoot?: string; configs: string[]; agents?: string; spark: Record<string, unknown>; sparkError?: string; quotaDisabled: Set<string> };
const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url));
const STATUS_KEY = "pi-keytree";

// Config is user data, never written into the installed package automatically.
export function loadConfig(): Config {
  const explicit = process.env.PI_KEYTREE_CONFIG;
  const paths = explicit ? [resolve(explicit)] : [
    join(getAgentDir(), "pi-keytree", "config.json"),
    join(PACKAGE_DIR, "config.json"),
    join(PACKAGE_DIR, "config.example.json"),
  ];
  for (const path of paths) {
    try { return validateConfig(JSON.parse(readFileSync(path, "utf8"))); }
    catch (error: any) {
      if (!explicit && error.code === "ENOENT") continue;
      throw new Error(`Pi Keytree configuration: ${path}: ${error.message}`);
    }
  }
  throw new Error("Pi Keytree: no configuration or bundled example found");
}
const BUILTINS = new Set(["new", "resume", "tree", "session", "model", "reload", "settings", "quit", "exit", "fork", "login", "logout", "compact", "export", "hotkeys", "scoped-models"]);
const nameOf = (text: string) => text.trim().split(/\s+/)[0].replace(/^\//, "");
const clean = (text: string) => text.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, "");

export function validateConfig(value: unknown): Config {
  const raw = value as Config & { leaderKey?: KeyId; timeoutMs?: number };
  if (!raw || typeof raw !== "object") throw new Error("Invalid configuration");
  // Legacy names remain readable; new names take precedence. No migration writes.
  const c = { ...raw, activation: raw.activation ?? raw.leaderKey ?? "ctrl+space",
    timeout: raw.timeout ?? raw.timeoutMs ?? 0, position: raw.position ?? "right",
    width: raw.width ?? "auto", showIcons: raw.showIcons ?? true,
    showUnavailable: raw.showUnavailable ?? true } as Config;
  if (typeof c.enabled !== "boolean" || typeof c.activation !== "string" ||
      !/^(?:(?:ctrl|alt|shift|super)\+)+(?:[a-z0-9]|space|f(?:[1-9]|1[0-2]))$/.test(c.activation) ||
      !/(?:ctrl|alt|super)\+/.test(c.activation)) throw new Error("activation must be a modified key, e.g. ctrl+space (plain Space is forbidden)");
  if (!Number.isSafeInteger(c.timeout) || c.timeout < 0 || c.timeout > 2147483647) throw new Error("timeout must be 0..2147483647 milliseconds; 0 disables timeout");
  if (c.position !== "right") throw new Error("Only position: right is currently supported");
  if (c.width !== "auto" && (!Number.isInteger(c.width) || c.width < 12 || c.width > 240)) throw new Error("width must be auto or 12..240 columns");
  if (typeof c.showIcons !== "boolean" || typeof c.showUnavailable !== "boolean") throw new Error("showIcons/showUnavailable must be boolean");
  if (!c.presets || typeof c.presets !== "object" || Array.isArray(c.presets)) throw new Error("presets must be an object");
  for (const p of Object.values(c.presets)) {
    if (!p || !Array.isArray(p.sparkNames) || !p.sparkNames.every(n => typeof n === "string" && /^[\w-]+$/.test(n)) ||
        ((p.provider !== undefined || p.model !== undefined || p.thinking !== undefined) &&
          (typeof p.provider !== "string" || !p.provider.trim() || typeof p.model !== "string" || !p.model.trim() ||
           !["off", "minimal", "low", "medium", "high", "xhigh", "max"].includes(p.thinking!)))) throw new Error("Invalid preset: specify sparkNames, and optionally provider/model/thinking together");
  }
  function walk(menu: Menu, depth = 0) {
    if (!menu || typeof menu !== "object" || Array.isArray(menu) || depth > 4 || !Object.keys(menu).length || Object.keys(menu).length > 36) throw new Error("Menu must have 1..36 entries per level, maximum depth 5");
    for (const [key, e] of Object.entries(menu)) {
      if (!/^[a-z0-9]$/.test(key) || !e || typeof e.label !== "string" || /[\x00-\x1f\x7f-\x9f]/.test(e.label) || (e.icon !== undefined && typeof e.icon !== "string")) throw new Error("Menu keys must be single lowercase letters/digits with labels");
      if (e.children) { if (e.action) throw new Error("Group cannot also be an action"); walk(e.children, depth + 1); continue; }
      if (!["command", "prefill", "branchDiff", "preset", "presetPicker", "projectConfig", "agentsFile"].includes(e.action!)) throw new Error(`Invalid action: ${e.action}`);
      if (["command", "prefill"].includes(e.action!) && (typeof e.command !== "string" || !/^\/[\w:-]+(?: [^\r\n\x00-\x1f]*)?$/.test(e.command))) throw new Error("Invalid slash command");
      if (e.action === "command" && BUILTINS.has(nameOf(e.command!))) throw new Error("Built-in commands must use prefill, never command");
      if (e.action === "preset" && !Object.hasOwn(c.presets, e.preset!)) throw new Error(`Unknown preset: ${e.preset}`);
    }
  }
  walk(c.menu);
  return c;
}

export default function piKeytree(pi: ExtensionAPI) {
  const config = loadConfig();
  if (!config.enabled) return;
  let active: { cancel: () => void; ctx: ExtensionContext } | undefined;
  let epoch = 0;
  const sessionUnsubscribers: (() => void)[] = [];
  const hasCommand = (name: string) => pi.getCommands().some(c => c.name === name && c.source === "extension");
  const notify = (ctx: ExtensionContext, text: string) => ctx.ui.notify(`Pi Keytree: ${text}`, "info");
  const fresh = (token: number) => token === epoch;
  function cleanup() {
    epoch++;
    active?.cancel();
    active?.ctx.ui.setStatus(STATUS_KEY, undefined);
    active = undefined;
    actionController?.abort();
    closeViewer?.();
  }
  // All session/UI resources are disposed on reload, session replacement and shutdown.
  sessionUnsubscribers.push(pi.on("session_shutdown", cleanup));
  sessionUnsubscribers.push(pi.on("session_start", cleanup));

  async function git(ctx: ExtensionContext, args: string[]) {
    return pi.exec("git", args, { cwd: ctx.cwd, timeout: 2500 });
  }
  async function json(path: string): Promise<any> {
    try { return JSON.parse(await readFile(path, "utf8")); }
    catch (e: any) { if (e.code === "ENOENT") return undefined; throw new Error(`Cannot read ${path}: ${e.message}`); }
  }
  async function inspect(ctx: ExtensionContext): Promise<Snapshot> {
    const s: Snapshot = { loading: false, configs: [], spark: {}, quotaDisabled: new Set() };
    try { const r = await git(ctx, ["rev-parse", "--show-toplevel"]); if (r.code === 0) s.gitRoot = r.stdout.trim(); } catch { /* Git not installed / not a repository. */ }
    const roots = [...new Set([ctx.cwd, s.gitRoot].filter(Boolean) as string[])];
    s.configs = roots.flatMap(root => ["settings.json", "keybindings.json", "spark.json"].map(f => join(root, ".pi", f))).filter(existsSync);
    // Prefer the nearest AGENTS.md; do not cross the repository boundary.
    for (let dir = resolve(ctx.cwd); ; dir = dirname(dir)) {
      const path = join(dir, "AGENTS.md");
      if (existsSync(path)) { s.agents = path; break; }
      if (dir === s.gitRoot || dirname(dir) === dir) break;
    }
    try {
      const global = await json(join(getAgentDir(), "spark.json"));
      // Match Spark's own global/project lookup; reading JSON does not execute it.
      const project = await json(join(ctx.cwd, ".pi", "spark.json"));
      const gp = global?.presets, pp = project?.presets;
      // Only preset names are needed. Spark remains the authority for their values.
      if (pp === false || (pp === undefined && gp === false)) s.spark = {};
      else s.spark = { ...(gp && typeof gp === "object" ? gp : {}), ...(pp && typeof pp === "object" ? pp : {}) };
    } catch (e: any) { s.sparkError = e.message; }
    try {
      const q = await json(join(getAgentDir(), "extensions", "quotas.json"));
      if (q?.quotasCommand === false) s.quotaDisabled.add("quotas");
      if (q?.providerCommands === false) s.quotaDisabled.add("codex:quotas");
    } catch { /* Command registration is still authoritative. */ }
    return s;
  }
  function sparkName(id: string, s: Snapshot) {
    return config.presets[id]?.sparkNames.find(name => Object.hasOwn(s.spark, name));
  }
  function status(e: Entry, ctx: ExtensionContext, s: Snapshot): Status {
    if (e.children) {
      const states = Object.values(e.children).map(child => status(child, ctx, s));
      if (states.length && states.every(child => child.reason)) {
        const reasons = new Set(states.map(child => child.reason));
        return { reason: reasons.size === 1 ? states[0].reason : "all actions unavailable (open for details)" };
      }
      return {};
    }
    if (ctx.mode !== "tui") return { reason: "TUI only" };
    if (e.idle && (!ctx.isIdle() || ctx.hasPendingMessages())) return { reason: "agent busy / queued messages" };
    if (e.action === "prefill" && ctx.ui.getEditorText() !== "") return { reason: "draft present (preserved)" };
    const command = e.requires ?? (e.action === "command" ? nameOf(e.command!) : e.action === "branchDiff" ? "diff" : undefined);
    if (command && !hasCommand(command)) return { reason: `unavailable: /${command} not registered` };
    if (command && s.quotaDisabled.has(command)) return { reason: "disabled in quotas configuration" };
    if (e.git) {
      if (s.loading) return { reason: "checking Git..." };
      if (!s.gitRoot) return { reason: "not a Git working tree" };
    }
    if (["projectConfig", "agentsFile", "preset", "presetPicker"].includes(e.action!)) {
      if (s.loading) return { reason: "checking context..." };
      if (e.action === "projectConfig" && !s.configs.length) return { reason: "no project .pi configuration files" };
      if (e.action === "agentsFile" && !s.agents) return { reason: "AGENTS.md not found" };
      if (e.action === "presetPicker") {
        if (s.sparkError) return { reason: "invalid spark.json (not falling back)" };
        if (Object.keys(s.spark).length && !hasCommand("preset")) return { reason: "Spark presets configured but /preset unavailable" };
        if (!Object.keys(s.spark).length && !Object.values(config.presets).some(p => p.provider && p.model)) return { reason: "no presets configured (Spark or local)" };
        return { note: Object.keys(s.spark).length ? "Spark picker" : "local fallback picker" };
      }
      if (e.action === "preset") {
        if (s.sparkError) return { reason: "invalid spark.json (not falling back)" };
        const name = sparkName(e.preset!, s);
        if (name) return hasCommand("preset") ? { note: `Spark: ${name}` } : { reason: "Spark preset configured but /preset unavailable" };
        const p = config.presets[e.preset!];
        if (!p.provider || !p.model) return { reason: "preset not configured (Spark or local)" };
        if (!ctx.modelRegistry.find(p.provider, p.model)) return { reason: "fallback model not in registry" };
        if (!ctx.modelRegistry.getAvailable().some(m => m.provider === p.provider && m.id === p.model)) return { reason: "fallback model has no authentication" };
        return { note: `local: ${p.model} / ${p.thinking}` };
      }
    }
    return e.action === "prefill" ? { note: "fill editor; Enter to confirm" } : {};
  }
  function dispatch(text: string, ctx: ExtensionContext) {
    const name = nameOf(text);
    // Never send built-in UI commands or an unregistered command to the model.
    if (BUILTINS.has(name) || !hasCommand(name)) throw new Error(`Not a registered extension command: /${name}`);
    pi.sendUserMessage(text, { expandPromptTemplates: true });
  }
  async function applyPreset(id: string, ctx: ExtensionContext, s: Snapshot, token: number) {
    const e: Entry = { label: id, action: "preset", preset: id, idle: true };
    const state = status(e, ctx, s);
    if (state.reason) throw new Error(state.reason);
    const name = sparkName(id, s);
    if (name) { dispatch(`/preset ${name}`, ctx); return; }
    const p = config.presets[id];
    const model = ctx.modelRegistry.find(p.provider!, p.model!)!;
    if (!await pi.setModel(model)) throw new Error(`No authentication for ${p.provider}/${p.model}`);
    if (!fresh(token)) return;
    pi.setThinkingLevel(p.thinking!);
    notify(ctx, `${id}: ${p.model} / ${pi.getThinkingLevel()}`);
  }
  async function chooseBranch(ctx: ExtensionContext, token: number): Promise<string | undefined> {
    const r = await git(ctx, ["for-each-ref", "--format=%(refname) %(symref)", "refs/remotes", "refs/heads"]);
    if (r.code !== 0) throw new Error("Cannot enumerate Git refs");
    const rows = r.stdout.trim().split("\n").filter(Boolean).map(line => line.trim().split(/\s+/));
    const refs = new Set(rows.map(([ref]) => ref));
    // Multiple distinct remote HEADs are ambiguous: ask rather than preferring origin silently.
    const remoteHeads = [...new Set(rows.filter(([ref, target]) => /^refs\/remotes\/.+\/HEAD$/.test(ref) && target && refs.has(target)).map(([, target]) => target))];
    let candidates = remoteHeads;
    if (!candidates.length) {
      for (const branch of ["main", "master"]) {
        const local = `refs/heads/${branch}`;
        if (refs.has(local)) { candidates = [local]; break; }
        const remotes = [...refs].filter(ref => ref.startsWith("refs/remotes/") && ref.endsWith(`/${branch}`) && !rows.find(row => row[0] === ref)?.[1]);
        if (remotes.length) { candidates = remotes; break; }
      }
    }
    if (!fresh(token)) return;
    if (candidates.length === 1) return candidates[0];
    if (!candidates.length) candidates = rows.filter(([, target]) => !target).map(([ref]) => ref);
    if (!candidates.length) throw new Error("No branch refs available (unborn repository?)");
    return ctx.ui.select("Choose Git diff base (no unambiguous default)", candidates, { signal: actionController?.signal });
  }
  let actionController: AbortController | undefined;
  let closeViewer: (() => void) | undefined;
  sessionUnsubscribers.push(pi.on("session_shutdown", () => {
    actionController?.abort(); closeViewer?.();
    // These lifecycle registrations belong to the old runtime; remove them on disposal.
    for (const unsubscribe of sessionUnsubscribers.splice(0)) unsubscribe();
  }));

  async function viewFile(path: string, ctx: ExtensionContext, token: number) {
    const file = await open(path, "r");
    let text: string;
    try {
      if (!(await file.stat()).isFile()) throw new Error("Not a regular file");
      const buffer = Buffer.alloc(256 * 1024 + 1);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      text = clean(buffer.subarray(0, Math.min(bytesRead, 256 * 1024)).toString("utf8")).replace(/\t/g, "    ");
      if (bytesRead > 256 * 1024) text += "\n[truncated at 256 KiB]";
    } finally { await file.close(); }
    if (!fresh(token)) return;
    await ctx.ui.custom<void>((tui, theme, _kb, done) => {
      let offset = 0, height = 15, disposed = false;
      const lines = text.split("\n");
      const finish = () => { if (!disposed) { disposed = true; closeViewer = undefined; done(); } };
      closeViewer = finish;
      return {
        render(width: number) {
          height = Math.max(1, Math.min(24, tui.terminal.rows - 6));
          return [theme.fg("accent", truncateToWidth(`READ ONLY · ${path}`, width)),
            ...lines.slice(offset, offset + height).map(line => truncateToWidth(line, width)),
            theme.fg("muted", truncateToWidth(`${offset + 1}/${lines.length} · ↑↓/jk PgUp/PgDn · Esc/q close`, width))];
        },
        invalidate() {},
        handleInput(data: string) {
          if (isKeyRelease(data)) return;
          if (matchesKey(data, "escape") || matchesKey(data, "q") || matchesKey(data, "ctrl+c")) { finish(); return; }
          if (matchesKey(data, "down") || matchesKey(data, "j")) offset++;
          if (matchesKey(data, "up") || matchesKey(data, "k")) offset--;
          if (matchesKey(data, "pageDown")) offset += height;
          if (matchesKey(data, "pageUp")) offset -= height;
          if (matchesKey(data, "home")) offset = 0;
          if (matchesKey(data, "end")) offset = lines.length - height;
          offset = Math.max(0, Math.min(offset, Math.max(0, lines.length - height)));
          tui.requestRender();
        },
        dispose() { disposed = true; closeViewer = undefined; },
      };
    }, { overlay: true, overlayOptions: { anchor: "center", width: "90%", maxHeight: "90%" } });
  }
  async function execute(e: Entry, ctx: ExtensionContext, s: Snapshot, token: number) {
    if (!fresh(token)) return;
    const unavailable = status(e, ctx, s).reason;
    if (unavailable) { notify(ctx, unavailable); return; }
    switch (e.action) {
      case "prefill": ctx.ui.setEditorText(e.command!); notify(ctx, "Command prepared; press Enter when ready"); break;
      case "command": dispatch(e.command!, ctx); break;
      case "branchDiff": {
        const ref = await chooseBranch(ctx, token);
        if (!ref || !fresh(token)) return;
        const verified = await git(ctx, ["rev-parse", "--verify", `${ref}^{commit}`]);
        const hash = verified.stdout.trim();
        if (verified.code !== 0 || !/^[0-9a-f]{40,64}$/.test(hash)) throw new Error("Selected branch is not a valid commit");
        if (fresh(token)) { notify(ctx, `Base: ${ref}`); dispatch(`/diff ${hash}...HEAD`, ctx); }
        break;
      }
      case "preset": await applyPreset(e.preset!, ctx, s, token); break;
      case "presetPicker": {
        if (s.sparkError) throw new Error(s.sparkError);
        if (Object.keys(s.spark).length) { dispatch("/preset", ctx); break; }
        const ids = Object.keys(config.presets).filter(id => !status({ label: id, action: "preset", preset: id, idle: true }, ctx, s).reason);
        if (!ids.length) throw new Error("No available local presets; configure a model and authentication first");
        const id = await ctx.ui.select("Local fallback presets", ids, { signal: actionController?.signal });
        if (id && fresh(token)) await applyPreset(id, ctx, s, token);
        break;
      }
      case "projectConfig": {
        const path = s.configs.length === 1 ? s.configs[0] : await ctx.ui.select("Project configuration (read only)", s.configs, { signal: actionController?.signal });
        if (path && fresh(token)) await viewFile(path, ctx, token);
        break;
      }
      case "agentsFile": await viewFile(s.agents!, ctx, token); break;
    }
  }
  async function nerdFontConfirmed(): Promise<boolean> {
    if (!config.showIcons) return false;
    if (process.env.PI_KEYTREE_NERD_FONT === "1") return true;
    if (process.env.PI_KEYTREE_NERD_FONT === "0" || process.env.SSH_CONNECTION || !process.env.KITTY_PID) return false;
    try {
      // No terminal protocol exposes actual glyph support. Conservatively use local
      // Kitty's declared font only when no command-line config override is present.
      const argv = (await readFile(`/proc/${process.env.KITTY_PID}/cmdline`, "utf8")).split("\0");
      if (argv.some(arg => arg === "--config" || arg === "-c" || arg.startsWith("--config=") || /font_family/.test(arg))) return false;
      const path = join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "kitty", "kitty.conf");
      const text = await readFile(path, "utf8");
      // Includes could override the font; only accept a final explicit Nerd Font declaration.
      const relevant = text.split(/\r?\n/).filter(line => /^\s*(?:font_family|include|globinclude|envinclude|geninclude)\s/.test(line));
      return /^\s*font_family\s+.*Nerd\s*Font/i.test(relevant.at(-1) ?? "");
    } catch { return false; }
  }
  let opening = false;
  async function show(ctx: ExtensionContext) {
    if (active) { active.cancel(); return; }
    if (ctx.mode !== "tui" || opening) return;
    opening = true;
    const token = epoch;
    let s: Snapshot = { loading: true, configs: [], spark: {}, quotaDisabled: new Set() };
    let requestRender: (() => void) | undefined;
    // Context checks never block the keyboard/menu; stale responses are ignored.
    const inspected = inspect(ctx).then(value => { s = value; if (fresh(token)) requestRender?.(); }).catch((error: any) => {
      s.loading = false;
      s.sparkError = "Context inspection failed";
      if (fresh(token)) { notify(ctx, clean(error.message ?? String(error))); requestRender?.(); }
    });
    const fontConfirmed = await nerdFontConfirmed();
    if (!fresh(token)) { opening = false; return; }
    try {
      let panel: WhichKeyPanel<Entry> | undefined;
      const selected = await ctx.ui.custom<Entry | undefined>((tui, theme, _kb, done) => {
        panel = new WhichKeyPanel(tui, theme, config, config.menu, e => status(e, ctx, s), done, () => {
          ctx.ui.setStatus(STATUS_KEY, undefined);
          requestRender = undefined;
        }, fontConfirmed);
        requestRender = () => tui.requestRender();
        active = { cancel: () => panel?.close(), ctx };
        ctx.ui.setStatus(STATUS_KEY, `${config.activation} · Pi Keytree`);
        return panel;
      }, { overlay: true, overlayOptions: () => panel?.overlayOptions() ?? { anchor: "right-center", width: 32 } });
      active = undefined;
      if (selected && fresh(token)) {
        await inspected;
        actionController = new AbortController();
        await execute(selected, ctx, s, token);
      }
    } catch (e: any) { if (fresh(token)) ctx.ui.notify(`Pi Keytree: ${clean(e.message ?? String(e))}`, "warning"); }
    finally { opening = false; actionController = undefined; }
  }

  // Public shortcut registration is scoped to the main editor, not unrelated dialogs.
  // Conservatively refuse collisions visible through the public keybindings manager.
  const normalize = (key: string) => key.split("+").sort().join("+");
  const conflicts = Object.entries(getKeybindings().getResolvedBindings()).filter(([, keys]) =>
    (Array.isArray(keys) ? keys : [keys]).some(k => k && normalize(k) === normalize(config.activation)));
  if (!conflicts.length) pi.registerShortcut(config.activation, { description: "Pi Keytree command menu", handler: show });
  else pi.on("session_start", (_event, ctx) => notify(ctx, `${config.activation} conflicts with ${conflicts.map(([id]) => id).join(", ")}; use /keytree`));
  pi.registerCommand("keytree", {
    description: "Open Pi Keytree; /keytree off closes active UI",
    handler: async (args, ctx) => {
      if (args.trim() === "off") { cleanup(); actionController?.abort(); closeViewer?.(); return; }
      await show(ctx);
    },
  });
}
