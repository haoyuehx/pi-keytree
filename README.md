# Pi Keytree

**Hierarchical leader-key command menu for Pi.**

Discover commands through a small, keyboard-driven tree instead of memorizing every slash command. Inspired by Neovim/LazyVim/which-key style command discovery. This is an independent project, not an official Neovim, LazyVim, or which-key integration.

## Features

- Leader-key style command discovery with configurable categories and actions.
- Right-side bordered overlay; submenus update the same panel.
- Hierarchical navigation, scrolling, and responsive sizing.
- Plugin-aware availability and context checks before execution.
- Configurable timeout; **0 means no automatic timeout**.
- Optional Nerd Font icons with plain-text fallback.
- Terminal-default background and Pi theme foreground colors.
- No replacement of the Pi editor; current drafts are preserved.
- Read-only project file viewer and safe Git base-branch selection.
- No additional runtime dependencies: Pi supplies the host libraries.

## Screenshot

<!-- Add screenshot here -->

## Installation

Requires Pi **1.0.0**. Later releases are not yet verified. Pi itself supplies `@earendil-works/pi-coding-agent` and `@earendil-works/pi-tui`.

### npm (recommended)

```bash
pi install npm:pi-keytree
```

The package is published on npm as [`pi-keytree`](https://www.npmjs.com/package/pi-keytree) and is registered as a Pi package through its manifest. Pinning a version is optional, for example `pi install npm:pi-keytree@0.1.0`. Development and test scripts never publish to npm.

### Local development / source checkout

Use this only when working on the source; it is not the recommended way to install for normal use.

```bash
# Try only this extension for one invocation, without changing Pi settings.
pi --no-extensions -e ./index.ts

# Alternatively, install the local package persistently.
pi install .
```

The temporary command disables other extensions in that invocation; their menu actions will be unavailable. It does not disable or modify them in your saved configuration. Avoid loading another leader-menu extension on Ctrl+Space at the same time. Use `/keytree` if the activation shortcut conflicts.

## Usage

Press **Ctrl+Space**, or run `/keytree`, then press a category key and an action key.

| Key | Behavior |
| --- | --- |
| Esc | Close the entire menu |
| Ctrl+Space again | Toggle the menu closed |
| Backspace / Left Arrow | Return to the parent menu |
| Up / Down | Scroll a long menu |
| PageUp / PageDown / Home / End | Scroll by page or jump |
| Category key | Enter its submenu |
| Action key | Close the menu, then execute an available action |

The path appears in the title, for example `Pi Keytree > Git`. Unknown keys and unavailable actions keep the panel open and show a short hint. `/keytree off` closes UI owned by this extension; it is not a persistent disable switch.

Ordinary Space is never an activation key. While the menu is open, it temporarily owns keyboard focus; unknown input is not forwarded into your draft. Closing restores Pi's previous focus.

## Default key tree

`L` below means Ctrl+Space. Keys are pressed sequentially.

| Category | Keys | Action |
| --- | --- | --- |
| Agent | `L a s/w/r/o` | Prepare `/run scout/worker/reviewer/oracle `; add a task and press Enter |
| Agent | `L a f` | Open `/subagents-fleet` |
| Session | `L s n/r/t/i` | Prepare `/new`, `/resume`, `/tree`, `/session` |
| Git | `L g d/c` | `/diff` or `/diff --cached` |
| Git | `L g b` | Diff against an automatically detected or explicitly selected base |
| Model | `L m m` | Prepare `/model` |
| Model | `L m p` | Spark preset picker, or configured local fallback presets |
| Model | `L m f/r/a` | Fast / review / main preset, **only when configured** |
| Quota | `L q q/c` | `/quotas` or `/codex:quotas` |
| Project | `L p r` | Prepare `/reload` |
| Project | `L p c/a` | Read-only project configuration / AGENTS.md viewer |
| MCP | `L x m/s` | `/mcp-adapter status` or `/mcp-adapter setup` |

Built-in UI commands marked **prepare** are inserted into an empty editor and require Enter. A nonempty draft, including whitespace, is never overwritten. Agent shortcuts do not start work without a user-supplied task.

Git base selection uses a valid remote HEAD first, then main, then master. Multiple candidates or no recognized default cause a selection prompt, not a guess. The selected ref is resolved to a commit before passing it to `/diff`. Three-dot comparison covers committed branch changes, not unstaged edits. No fetch or repository mutation is performed.

## Configuration

No configuration file is required: `config.example.json` is the safe built-in default. It contains no provider-specific model defaults, credentials, or personal paths.

For local development, copy the example:

```bash
cp config.example.json config.json
```

`config.json` is ignored by Git and excluded from the npm package. For an installed npm package, keep configuration outside its install directory so updates do not overwrite it:

```bash
mkdir -p ~/.pi/agent/pi-keytree
cp config.example.json ~/.pi/agent/pi-keytree/config.json
```

Run that copy command from a checkout or the installed package directory. When using a custom Pi agent directory, use its `pi-keytree/config.json` instead.

Lookup order (the first existing file wins; files are **not merged**):

1. `PI_KEYTREE_CONFIG`, if set (a missing explicit file is an error).
2. `<Pi agent directory>/pi-keytree/config.json`.
3. `config.json` beside `index.ts` (local development).
4. Bundled `config.example.json`.

A malformed chosen file is reported rather than silently ignored. Run `/reload` after edits. No config is automatically written or copied.

```json
{
  "enabled": true,
  "activation": "ctrl+space",
  "timeout": 0,
  "position": "right",
  "width": "auto",
  "showIcons": true,
  "showUnavailable": true
}
```

This excerpt shows UI options only; retain `presets` and `menu` from the full example. Numeric width means terminal columns, not percent. `timeout: 5000` closes after five seconds of inactivity. See [Configuration reference](docs/configuration.md) for actions, presets, icons, and bounds.

## Integrations

All integrations are **optional**, detected by registered extension commands, not imported as dependencies.

| Package | Integration |
| --- | --- |
| pi-spark | Uses configured `/preset` names first; leaves its editor and shortcuts intact |
| pi-subagents | `/run` templates and `/subagents-fleet`; agent existence is validated by that plugin |
| pi-diff-review | `/diff`, staged diff, and selected-base diff |
| @latentminds/pi-quotas | `/quotas` and `/codex:quotas`; respects known quota command switches |
| pi-mcp-adapter | Explicit `/mcp-adapter status/setup`, avoiding ambiguity with Pi's built-in MCP command |

Missing commands are dimmed and marked unavailable, or hidden with `showUnavailable: false`. They are never submitted as ordinary model prompts. Not being in a Git repository also disables Git actions. An unavailable integration does not prevent using Session or other independent categories.

The example's fast/review/main presets contain **names only**. If a matching Spark preset is absent, that shortcut remains unavailable until you configure a local fallback. Matching Spark presets always win; Pi Keytree does not maintain a second competing set of model defaults.

Opening MCP setup is deliberate user interaction: saving inside that plugin may change its configuration. Pi Keytree itself does not write those files.

## Philosophy

This is command discovery, not a Vim mode. It does not take over ordinary Space, introduce modal text editing, create a CustomEditor, or replace Pi's editor, header, or footer. It uses public extension and TUI APIs without patching Pi core.

## Known limitations

- Pi 1.0.0 has no uniform public `executeCommand()` for built-in UI commands. Those actions prepare text for explicit confirmation instead of using synthetic input or private methods.
- Ctrl+Space depends on terminal keyboard encoding and may be intercepted by an input method or desktop shortcut. `/keytree` is a fallback. Kitty's legacy NUL and CSI-u encodings are supported through Pi's key parser.
- The panel is visually nonintrusive but temporarily captures focus. A passive overlay would allow menu letters to leak into the editor. Model/tool activity can continue behind it.
- Terminal-default background can preserve terminal transparency, but this is **not alpha blending** of conversation text beneath the panel. Padding replaces those cells.
- Font detection is conservative and configuration-based, not a guarantee of glyph coverage. Unknown environments use text-only rows.
- Extremely small terminals show a compact title. Longer descriptions can be truncated; unavailable actions show their reason when pressed.
- Availability checks do not prove network connectivity or plugin health. Authentication expiry and plugin errors remain the plugin's responsibility.
- Some context checks are snapshots taken when opening the menu. Reopen after changing files or configuration; reload after changing extension settings.
- Host shortcut conflict checks do not enumerate every other extension's shortcut. Check `/hotkeys` and startup warnings when changing activation.

## Development

Source is loaded directly by Pi; no build step or generated JavaScript is required.

```bash
npm install
npm test
pi --no-extensions -e ./index.ts
# Inside Pi, after edits:
# /reload
npm pack --dry-run
```

`npm install` is for development/testing (Jiti and host peer packages); it is not required for Pi-managed installation. To test against an existing Pi installation without installing dependencies, set `PI_KEYTREE_TEST_HOST` to the directory containing that installation's package.json. The test runner resolves host libraries and Jiti from there. See [Development and release checklist](docs/development.md).

## Uninstall

To disable without removing files, set `enabled: false` in your chosen config and run `/reload`. To remove a package installation:

```bash
pi remove npm:pi-keytree
# For a local installation, pass the same local package path instead.
```

Temporary `-e` usage ends when that Pi process exits. Deleting a checkout does not remove a persistent package declaration; remove it through Pi first. User configuration at `<agent directory>/pi-keytree/` may be retained or deleted separately. No background services are installed.

## License

[MIT](LICENSE) — Copyright (c) 2026 Pi Keytree contributors.
