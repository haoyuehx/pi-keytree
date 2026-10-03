import type { Theme } from "@earendil-works/pi-coding-agent";
import { isKeyRelease, matchesKey, truncateToWidth, visibleWidth, type KeyId, type TUI } from "@earendil-works/pi-tui";

export type PanelSettings = {
  activation: KeyId;
  timeout: number;
  position: "right";
  width: number | "auto";
  showIcons: boolean;
  showUnavailable: boolean;
};
export type Availability = { reason?: string; note?: string };
type Node<T> = { label: string; icon?: string; children?: Record<string, T> };

/** One component per activation. Navigation changes only its stack and scroll offset. */
export class WhichKeyPanel<T extends Node<T>> {
  private stack: { menu: Record<string, T>; label: string; offset: number }[];
  private timer: ReturnType<typeof setTimeout> | undefined;
  private disposed = false;
  private hint = "";
  private readonly icons: boolean;

  constructor(
    private tui: TUI,
    private theme: Theme,
    private settings: PanelSettings,
    menu: Record<string, T>,
    private availability: (entry: T) => Availability,
    private done: (entry?: T) => void,
    private onDispose: () => void,
    fontConfirmed: boolean,
  ) {
    this.stack = [{ menu, label: "Pi Keytree", offset: 0 }];
    const glyphs: string[] = [];
    const walk = (items: Record<string, T>) => Object.values(items).forEach(e => {
      if (e.icon) glyphs.push(e.icon);
      if (e.children) walk(e.children);
    });
    walk(menu);
    this.icons = settings.showIcons && fontConfirmed && glyphs.every(g => {
      const w = visibleWidth(g);
      return w >= 1 && w <= 2 && !/[\x00-\x1f\x7f-\x9f]/.test(g);
    });
    this.arm();
  }

  private get current() { return this.stack[this.stack.length - 1]; }
  private get title() { return this.stack.map(s => s.label).join(" > "); }
  private entries() {
    return Object.entries(this.current.menu).map(([key, entry]) => ({ key, entry, state: this.availability(entry) }))
      .filter(row => this.settings.showUnavailable || !row.state.reason);
  }
  private get pageSize() { return Math.max(1, this.tui.terminal.rows - 7); }

  /** Public overlay width is columns; auto is content-aware and normally 25–35%. */
  preferredWidth(): number {
    const columns = Math.max(1, this.tui.terminal.columns);
    const cap = Math.max(1, Math.min(60, columns - 2, Math.floor(columns * (columns < 60 ? 0.55 : 0.35))));
    if (this.settings.width !== "auto") return Math.max(1, Math.min(cap, this.settings.width));
    const content = Math.max(visibleWidth(this.title) + 6, ...this.entries().map(({ entry }) =>
      visibleWidth(entry.label) + (this.icons ? 12 : 8)));
    return Math.max(1, Math.min(cap, Math.max(Math.floor(columns * 0.25), content)));
  }
  overlayOptions() {
    return { anchor: "right-center" as const, width: this.preferredWidth(),
      maxHeight: Math.max(1, this.tui.terminal.rows - 2), margin: 1 };
  }
  private arm() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    // 0 means no timer at all (not a zero-delay timer).
    if (this.settings.timeout > 0) this.timer = setTimeout(() => this.close(), this.settings.timeout);
  }
  close(entry?: T) {
    if (this.disposed) return;
    this.dispose();
    this.done(entry);
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    this.onDispose();
  }
  invalidate() {}

  render(width: number): string[] {
    if (width < 4 || this.tui.terminal.rows < 7) {
      return [truncateToWidth(this.theme.fg("accent", this.title), Math.max(0, width))];
    }
    const theme = this.theme;
    const inner = width - 2;
    const framed = (text: string) => {
      const clipped = truncateToWidth(text, inner);
      return theme.fg("borderAccent", "│") + clipped + " ".repeat(Math.max(0, inner - visibleWidth(clipped))) + theme.fg("borderAccent", "│");
    };
    const title = truncateToWidth(`─ ${this.title} `, inner);
    const lines = [theme.fg("borderAccent", `╭${title}${"─".repeat(Math.max(0, inner - visibleWidth(title)))}╮`)];
    const entries = this.entries();
    this.current.offset = Math.max(0, Math.min(this.current.offset, Math.max(0, entries.length - this.pageSize)));
    for (const { key, entry, state } of entries.slice(this.current.offset, this.current.offset + this.pageSize)) {
      const keyText = theme.fg(state.reason ? "dim" : "accent", key);
      const icon = this.icons && entry.icon ? `${entry.icon}${" ".repeat(Math.max(0, 2 - visibleWidth(entry.icon)))} ` : this.icons ? "   " : "";
      const suffix = state.reason ? " [unavailable]" : entry.children ? " ›" : "";
      // Reserve space for the unavailable marker before trimming the description.
      const available = Math.max(0, inner - 5 - visibleWidth(icon) - visibleWidth(suffix));
      const label = truncateToWidth(entry.label, available);
      const body = theme.fg(state.reason ? "dim" : "text", `${icon}${label}${suffix}`);
      lines.push(framed(` ${keyText}  ${body}`));
    }
    if (!entries.length) lines.push(framed(theme.fg("dim", " No available actions")));
    const scrolling = entries.length > this.pageSize;
    const status = this.hint || (scrolling ? `${this.current.offset + 1}–${Math.min(entries.length, this.current.offset + this.pageSize)}/${entries.length} · ↑↓ scroll` : "");
    if (status) lines.push(framed(theme.fg("muted", ` ${status}`)));
    const help = this.stack.length === 1 ? `Esc close  ${this.settings.activation} close${scrolling ? "  ↑↓ scroll" : ""}` : "Esc close  ← back  ↑↓ scroll";
    lines.push(framed(theme.fg("muted", ` ${help}`)));
    lines.push(theme.fg("borderAccent", `╰${"─".repeat(inner)}╯`));
    // Foreground-only rendering: Pi's overlay compositor resets SGR before each
    // segment, so text AND padding use the terminal default background. Do not
    // wrap these lines in theme.bg(): an RGB fill defeats Kitty's transparency.
    // This preserves terminal transparency, not the conversation cells beneath.
    return lines.map(line => truncateToWidth(line, width));
  }

  handleInput(data: string) {
    if (this.disposed || isKeyRelease(data)) return;
    if (matchesKey(data, "escape") || matchesKey(data, this.settings.activation)) { this.close(); return; }
    this.arm(); // Positive timeout measures inactivity, including scroll/back/invalid keys.
    this.hint = "";
    if (matchesKey(data, "backspace") || matchesKey(data, "left")) {
      if (this.stack.length > 1) this.stack.pop();
    } else if (["up", "down", "pageUp", "pageDown", "home", "end"].some(k => matchesKey(data, k as KeyId))) {
      const count = this.entries().length;
      if (matchesKey(data, "up")) this.current.offset--;
      if (matchesKey(data, "down")) this.current.offset++;
      if (matchesKey(data, "pageUp")) this.current.offset -= this.pageSize;
      if (matchesKey(data, "pageDown")) this.current.offset += this.pageSize;
      if (matchesKey(data, "home")) this.current.offset = 0;
      if (matchesKey(data, "end")) this.current.offset = count;
      this.current.offset = Math.max(0, Math.min(this.current.offset, Math.max(0, count - this.pageSize)));
    } else {
      const row = this.entries().find(({ key }) => matchesKey(data, key as KeyId));
      if (!row) this.hint = "Unknown key · Esc close";
      else if (row.entry.children) this.stack.push({ menu: row.entry.children, label: row.entry.label, offset: 0 });
      else if (row.state.reason) this.hint = row.state.reason; // Do not close on a disabled action.
      else { this.close(row.entry); return; }
    }
    this.tui.requestRender();
  }
}
