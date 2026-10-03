# Development and release checklist

Pi Keytree loads TypeScript through Pi's extension loader. `index.ts` contains configuration/integrations and `panel.ts` contains the UI. Keep public API boundaries and avoid replacing the editor.

## Tests

```bash
npm install
npm test
pi --no-extensions -e ./index.ts
```

Tests use Node's built-in test runner, Jiti, and Pi's public package/resource APIs. They create isolated temporary directories, mock interactive UI, and never submit model prompts. `PI_KEYTREE_TEST_HOST` can select an existing installation root containing Pi's package.json instead of installing development dependencies.

Manual terminal checks:

1. Ctrl+Space opens a single right-hand panel; wait more than five seconds with timeout=0.
2. Enter a category, then return with Backspace and Left; Esc and Ctrl+Space close.
3. Enter a draft containing spaces, open a prefill action, and verify it is disabled and the draft survives.
4. With no integrations loaded, commands show unavailable instead of throwing.
5. With integrations loaded and a temporary Git repository, g d opens /diff.
6. Shrink and expand the terminal, scroll long menus, and check theme foregrounds/default background.
7. /reload, then reopen; verify no duplicate panels, stale timer, or input handler remains.

Do not load two extensions bound to Ctrl+Space in the same test session. Temporary `--no-extensions -e` testing does not change saved packages/settings.

## Publication boundary

The package manifest declares only `./index.ts` as an extension. `panel.ts` is an imported helper, not a second entry point. Host libraries are peerDependencies with `*` ranges as recommended by Pi 1.0.0; there are no additional runtime dependencies. Jiti is a development dependency only.

The npm `files` allowlist contains source, the public configuration example, README, license, and the configuration reference. Tests, personal config, screenshots, logs, dependency directories, and other development artifacts are not shipped. There are no install/publish lifecycle scripts.

Before releasing:

- Check compatibility against the intended Pi version.
- Run npm test and npm pack --dry-run; inspect every packed path.
- Scan tracked files and the tarball for personal paths, credentials, and identifying screenshots.
- Review Git author metadata separately from source files.
- Add repository/homepage/bugs metadata only after the repository URL is known.
- Confirm the npm package name is available and the publisher has permission.
- Add a sanitized screenshot only if desired; no screenshot is required to publish.
- Set an appropriate version and record release notes.

Repository creation, pushing, and npm publication are separate deliberate operations; none is automated here.
