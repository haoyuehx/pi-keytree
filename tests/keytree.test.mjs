import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { mkdtemp, readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const project = dirname(dirname(fileURLToPath(import.meta.url)));
const hostRequire = createRequire(process.env.PI_KEYTREE_TEST_HOST
  ? join(resolve(process.env.PI_KEYTREE_TEST_HOST), 'package.json') : import.meta.url);
const temporary = await mkdtemp(join(tmpdir(), 'pi-keytree-test-'));
process.env.PI_CODING_AGENT_DIR = join(temporary, 'agent');
delete process.env.PI_KEYTREE_CONFIG;
process.env.PI_KEYTREE_NERD_FONT = '0';
await mkdir(process.env.PI_CODING_AGENT_DIR, { recursive: true });
// Pi is ESM-only; resolve its public import entry, not the CJS require condition.
const sdkPath = process.env.PI_KEYTREE_TEST_HOST
  ? resolve(process.env.PI_KEYTREE_TEST_HOST, JSON.parse(await readFile(join(process.env.PI_KEYTREE_TEST_HOST, 'package.json'), 'utf8')).exports['.'].import)
  : fileURLToPath(import.meta.resolve('@earendil-works/pi-coding-agent'));
const tuiPath = hostRequire.resolve('@earendil-works/pi-tui');
const { createJiti } = await import(pathToFileURL(hostRequire.resolve('jiti')));
const jiti = createJiti(import.meta.url, { alias: {
  '@earendil-works/pi-coding-agent': sdkPath, '@earendil-works/pi-tui': tuiPath,
} });
const sdk = await import(pathToFileURL(sdkPath));
const { matchesKey, visibleWidth } = await import(pathToFileURL(tuiPath));
const { validateConfig, loadConfig } = await jiti.import(join(project, 'index.ts'));
const { WhichKeyPanel } = await jiti.import(join(project, 'panel.ts'));
const example = JSON.parse(await readFile(join(project, 'config.example.json'), 'utf8'));
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const theme = { fg: (_role, text) => text, bg: () => { throw new Error('Panel must not paint a background'); } };

async function harness() {
  const loader = new sdk.DefaultResourceLoader({
    cwd: temporary, agentDir: process.env.PI_CODING_AGENT_DIR,
    settingsManager: sdk.SettingsManager.inMemory(),
    noExtensions: true, noSkills: true, noPromptTemplates: true, noThemes: true, noContextFiles: true,
    additionalExtensionPaths: [project],
  });
  await loader.reload();
  const loaded = loader.getExtensions();
  assert.deepEqual(loaded.errors, []);
  assert.equal(loaded.extensions.length, 1, 'manifest exposes only index.ts');
  const extension = loaded.extensions[0];
  const state = { component: undefined, draft: '', messages: [], commands: [], status: undefined, instances: 0 };
  loaded.runtime.getCommands = () => state.commands.map(name => ({ name, source: 'extension' }));
  loaded.runtime.sendUserMessage = (text, options) => state.messages.push({ text, options });
  const ctx = {
    mode: 'tui', hasUI: true, cwd: temporary, isIdle: () => true, hasPendingMessages: () => false,
    modelRegistry: { find: () => undefined, getAvailable: () => [] },
    ui: {
      getEditorText: () => state.draft, setEditorText: text => { state.draft = text; },
      notify() {}, setStatus: (_key, text) => { state.status = text; },
      custom: factory => new Promise(resolve => {
        state.instances++;
        state.component = factory({ terminal: { rows: 24, columns: 100 }, requestRender() {} }, theme, {}, result => {
          state.component.dispose(); state.component = undefined; resolve(result);
        });
      }),
    },
  };
  const open = async () => {
    const pending = extension.shortcuts.get('ctrl+space').handler(ctx);
    for (let i = 0; !state.component && i < 50; i++) await wait(10);
    assert(state.component);
    await wait(60); // allow local context inspection to finish
    return { pending };
  };
  const close = async () => {
    for (const fn of [...(extension.handlers.get('session_shutdown') ?? [])]) await fn({ type: 'session_shutdown', reason: 'reload' }, ctx);
  };
  return { state, ctx, extension, open, close };
}

test('Pi Keytree release checks', async t => {
  try {
    await t.test('safe defaults and configuration precedence', async () => {
      assert.equal(validateConfig(example).timeout, 0);
      assert.equal(loadConfig().activation, 'ctrl+space');
      assert(!Object.values(example.presets).some(p => p.model || p.provider));
      assert.throws(() => validateConfig({ ...example, activation: 'space' }));
      assert.throws(() => validateConfig({ ...example, timeout: -1 }));
      const config = join(temporary, 'explicit.json');
      await writeFile(config, JSON.stringify({ ...example, timeout: 5000 }));
      process.env.PI_KEYTREE_CONFIG = config;
      assert.equal(loadConfig().timeout, 5000);
      process.env.PI_KEYTREE_CONFIG = join(temporary, 'missing.json');
      assert.throws(() => loadConfig());
      delete process.env.PI_KEYTREE_CONFIG;
    });
    await t.test('manifest loads independently; missing plugins and presets are unavailable', async () => {
      const h = await harness();
      assert(h.extension.commands.has('keytree'));
      const { pending } = await h.open();
      h.state.component.handleInput('a');
      assert(h.state.component.render(60).join('\n').includes('unavailable'));
      h.state.component.handleInput('s');
      assert.equal(h.state.draft, ''); assert.equal(h.state.messages.length, 0);
      assert(h.state.component);
      h.state.component.handleInput('\x7f'); h.state.component.handleInput('m');
      assert(h.state.component.render(60).join('\n').includes('unavailable'));
      h.state.component.handleInput('\x1b'); await pending;
      await h.close();
    });
    await t.test('hierarchy, no timeout, toggle, draft preservation and session cleanup', async () => {
      const h = await harness(); h.state.draft = 'hello world ';
      const { pending } = await h.open();
      await wait(1700); assert(h.state.component);
      h.state.component.handleInput('s');
      assert(h.state.component.render(60)[0].includes('Pi Keytree > Session'));
      h.state.component.handleInput('n'); assert.equal(h.state.draft, 'hello world ');
      h.state.component.handleInput('\x7f'); assert(!h.state.component.render(60)[0].includes(' > '));
      h.state.component.handleInput('g'); h.state.component.handleInput('\x1b[D');
      assert.equal(h.state.instances, 1);
      h.state.component.handleInput('\0'); await pending;
      assert.equal(h.state.component, undefined); assert.equal(h.state.status, undefined);
      const next = await h.open(); await h.close(); await next.pending;
      assert.equal(h.state.component, undefined); assert.equal(h.state.status, undefined);
      assert.equal(h.extension.handlers.get('session_shutdown')?.length ?? 0, 0);
      assert.equal(h.extension.handlers.get('session_start')?.length ?? 0, 0);
    });
    await t.test('builtins only prefill; extension commands require registration', async () => {
      const h = await harness();
      let run = await h.open(); h.state.component.handleInput('s'); h.state.component.handleInput('i'); await run.pending;
      assert.equal(h.state.draft, '/session'); assert.equal(h.state.messages.length, 0);
      h.state.draft = ''; h.state.commands.push('quotas');
      run = await h.open(); h.state.component.handleInput('q'); h.state.component.handleInput('q'); await run.pending;
      assert.deepEqual(h.state.messages, [{ text: '/quotas', options: { expandPromptTemplates: true } }]);
      await h.close();
    });
    await t.test('key encoding, finite inactivity timeout, layout bounds and scrolling', async () => {
      assert(matchesKey('\0', 'ctrl+space')); assert(matchesKey('\x1b[32;5u', 'ctrl+space'));
      assert(!matchesKey(' ', 'ctrl+space'));
      const terminal = { rows: 12, columns: 80 };
      const tui = { terminal, requestRender() {} };
      const menu = Object.fromEntries('abcdefghijklmnopqrstuvwxyz0123456789'.split('').map(key => [key, { label: `Action ${key}` }]));
      let closed = 0, disposed = 0;
      const panel = new WhichKeyPanel(tui, theme, { ...example, timeout: 200 }, menu, () => ({}), () => closed++, () => disposed++, false);
      await wait(120); panel.handleInput('\x1b[B'); await wait(120); assert.equal(closed, 0);
      await wait(120); assert.equal(closed, 1); assert.equal(disposed, 1); panel.dispose(); assert.equal(disposed, 1);
      const ui = new WhichKeyPanel(tui, theme, example, menu, () => ({}), () => {}, () => {}, false);
      for (const columns of [1,12,40,80,160]) for (const rows of [1,6,7,12,40]) {
        terminal.columns = columns; terminal.rows = rows;
        const width = ui.preferredWidth(), lines = ui.render(width);
        assert(lines.length <= ui.overlayOptions().maxHeight);
        assert(lines.every(line => visibleWidth(line) <= width));
      }
      terminal.rows = 12; terminal.columns = 80; ui.handleInput('\x1b[F');
      assert(ui.render(ui.preferredWidth()).join('\n').includes('32–36/36'));
      ui.dispose();
    });
  } finally {
    delete process.env.PI_KEYTREE_CONFIG;
    await rm(temporary, { recursive: true, force: true });
  }
});
