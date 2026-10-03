# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-10-03

### Added

- Initial public release.
- Hierarchical leader-key command menu with configurable categories and actions.
- Ctrl+Space activation; `/keytree` as an alternative entry point.
- Right-side, which-key inspired panel that updates the same overlay for submenus.
- Nested Agent / Session / Git / Model / Quota / Project / MCP menus.
- Plugin availability detection with dimmed or hidden unavailable actions.
- Configurable timeout (`0` disables automatic closing) and configurable width.
- Optional Nerd Font icons with conservative detection and plain-text fallback.
- Draft-preserving behavior: existing editor input is never overwritten.
- Safe fallback for unavailable commands; built-in UI commands are inserted into the editor instead of being executed directly.
- Read-only project configuration and `AGENTS.md` viewer.
- Git base-branch detection (remote HEAD, then main, then master) with explicit selection when ambiguous.
- Terminal-default background rendering that preserves terminal transparency.

### Known limitations

- Pi does not currently expose a universal public `executeCommand` API for all built-in UI commands.
- Some built-in commands are inserted into the editor and require Enter confirmation.
- Ctrl+Space behavior can depend on terminal input encoding and may be intercepted by an input method or desktop shortcut.
- Overlay transparency depends on terminal and Pi TUI behavior; the panel is not an alpha blend of the text beneath it.
- Font detection is configuration-based and cannot guarantee glyph coverage.
- Availability checks are snapshots and do not prove network or plugin health.
- Host shortcut conflict checks do not enumerate every other extension's shortcuts.

[0.1.0]: https://github.com/haoyuehx/pi-keytree/releases/tag/v0.1.0
