# Configuration reference

Start with `config.example.json`. Copy it to `config.json` for local development, or `<Pi agent directory>/pi-keytree/config.json` for a persistent user configuration. The latter takes precedence over the local file. `PI_KEYTREE_CONFIG` overrides both; relative paths resolve from the launch directory. No project-local config is automatically executed or loaded by Pi Keytree.

## UI

| Field | Default | Meaning |
| --- | --- | --- |
| enabled | true | Register the extension UI and shortcut |
| activation | ctrl+space | A modified key; must contain Ctrl, Alt, or Super |
| timeout | 0 | Nonnegative integer milliseconds; 0 allocates no timeout timer |
| position | right | Only right is supported in 0.1.0 |
| width | auto | Content-aware size, or target width in columns (12–240) |
| showIcons | true | Use icons only when font support is confirmed conservatively |
| showUnavailable | true | Dim unavailable actions; false hides them |

Actual width is capped at 60 columns and 35% of a normal terminal. Below 60 columns it may use up to 55%, retaining margins. Height follows item count; excess items scroll. On extremely small terminals only the title is rendered, but navigation/close keys still work.

Positive timeouts restart on input, scrolling, and navigation. Key-release events do not reset timers. Closing, disposing, or reloading clears timers and status. Legacy `leaderKey` / `timeoutMs` fields remain accepted; new names take precedence.

## Menu nodes

`menu` maps single lowercase letters or digits to entries. Each level accepts 1–36 items and nesting is limited to five levels. A group has `label`, optional `icon`, and `children`. A leaf has `label`, optional `icon`, and an `action`.

```json
{
  "g": {
    "label": "Git",
    "icon": "",
    "children": {
      "d": {
        "label": "Diff",
        "action": "command",
        "command": "/diff",
        "git": true,
        "idle": true
      }
    }
  }
}
```

Optional leaf guards: `idle: true` disables while work/messages are queued; `git: true` requires a working tree; `requires: "command-name"` requires a registered extension command.

| Action | Additional fields | Behavior |
| --- | --- | --- |
| command | command | Dispatch only a registered extension command |
| prefill | command | Prepare text in an empty editor; never replace a draft |
| branchDiff | git: true, idle: true recommended | Detect or ask for a Git base, then dispatch /diff |
| preset | preset | Select the named entry in top-level presets |
| presetPicker | idle: true recommended | Spark picker or available local presets |
| projectConfig | — | Read-only viewer of existing .pi/settings.json, keybindings.json, spark.json in cwd/repository root |
| agentsFile | — | Read the nearest AGENTS.md without crossing the repository boundary |

Built-in UI commands must use `prefill`. Multi-line/control-character command strings are rejected. This is trusted configuration: a registered plugin command can have side effects. Do not copy arbitrary mappings from untrusted sources.

## Presets

The shipped presets deliberately omit model/provider defaults:

```json
{
  "presets": {
    "fast": { "sparkNames": ["fast", "Fast"] }
  }
}
```

Pi Keytree reads preset names from user and cwd Spark configuration, following Spark's precedence. A matching name dispatches `/preset <name>`; Spark owns its model/thinking values. If a name is configured but its command is unavailable, the action is disabled rather than silently applying another preset.

You can explicitly configure a fallback:

```json
{
  "sparkNames": ["fast"],
  "provider": "your-provider-id",
  "model": "your-model-id",
  "thinking": "low"
}
```

`provider`, `model`, and `thinking` must be provided together. Valid thinking levels are off, minimal, low, medium, high, xhigh, max. Replace the illustrative IDs with models available to your Pi installation. The runtime checks registration and authentication before switching; Pi may clamp thinking to model capabilities. It changes the current session, not saved defaults.

No matching Spark name and no fallback means unavailable. Malformed Spark JSON is reported rather than silently overridden. `/reload` after changes to keep Spark's own config cache consistent.

## Fonts and background

The renderer uses Pi's foreground theme roles only. It does not set a fixed RGB or indexed background. Pi's overlay compositor resets style before each overlay segment, so text and padding use the terminal default background. This does not make underlying conversation characters visible through the panel.

There is no universal font-capability API. Auto detection accepts a clear Nerd Font declaration in a local Kitty configuration only when it can verify the Kitty process has no custom configuration/font override. Unknown platforms, SSH, inaccessible process metadata, and ambiguous includes fall back to text. It reads configuration but never changes it.

- `PI_KEYTREE_NERD_FONT=1`: explicitly confirm Nerd Font support.
- `PI_KEYTREE_NERD_FONT=0`: force text fallback.
- `showIcons: false`: always hide icons, regardless of environment.

Every configured icon must have a measured width of one or two columns and contain no control characters, or icons are disabled for that panel. This is not a guarantee that the terminal will render a particular glyph correctly.

## Read-only viewer

Files are capped at 256 KiB, control characters are removed, and long lines are clipped. Scroll with arrows, j/k, PageUp/PageDown, Home/End. Close with Esc, q, or Ctrl+C. Viewing never changes editor text or sends file contents to a model. Treat configuration views and screenshots as potentially sensitive.
