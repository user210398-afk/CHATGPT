import { act, render, renderHook, screen, fireEvent, waitFor } from '@testing-library/react';
import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';
import { promisify } from 'node:util';
import { execFile } from 'node:child_process';
import { validatePwa } from '../scripts/validate-pwa';
import { PwaInstallPrompt } from '../src/components/common/PwaInstallPrompt';
import { ConnectivityNotice, offlineMessage } from '../src/pwa/ConnectivityNotice';
import { useResource } from '../src/app/useResource';

beforeEach(() => {
  vi.resetModules();
  vi.stubGlobal(
    'matchMedia',
    vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })),
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

async function installHook() {
  const { usePwaInstall } = await import('../src/pwa/usePwaInstall');
  return renderHook(usePwaInstall);
}
function installEvent(outcome: string, rejects = false) {
  const event = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
    prompt: rejects
      ? vi.fn().mockRejectedValue(new Error('unavailable'))
      : vi.fn().mockResolvedValue(undefined),
    userChoice: Promise.resolve({ outcome }),
  });
  act(() => window.dispatchEvent(event));
  return event;
}

it('manifest e PNGs locais reais, dimensões, dados comprimidos e worker sem cache', async () => {
  await validatePwa('public');
});
it.each(['accepted', 'dismissed', '<script>alert(1)</script>'])(
  'instala somente sob ação explícita, consome evento e trata %s',
  async (outcome) => {
    const hook = await installHook();
    const event = installEvent(outcome);
    expect(event.defaultPrevented).toBe(true);
    expect(hook.result.current.available).toBe(true);
    expect(event.prompt).not.toHaveBeenCalled();
    await act(() => hook.result.current.install());
    expect(event.prompt).toHaveBeenCalledTimes(1);
    expect(hook.result.current.available).toBe(false);
    expect(hook.result.current.dismissed).toBe(false);
    expect(hook.result.current.message).not.toContain('<script>');
    expect(hook.result.current.message).toMatch(
      outcome === 'accepted' ? /Solicitação aceita/ : /não confirmada/,
    );
    await act(() => hook.result.current.install());
    expect(event.prompt).toHaveBeenCalledTimes(1);
    act(() => window.dispatchEvent(new Event('appinstalled')));
    expect(hook.result.current.message).toMatch(/Instalação confirmada/);
    expect(hook.result.current.dismissed).toBe(true);
  },
);
it('trata falha de prompt e evento sem capacidade real', async () => {
  const hook = await installHook();
  const hostile = Object.assign(new Event('beforeinstallprompt'), { prompt: vi.fn() });
  Object.defineProperty(hostile, 'userChoice', {
    get() {
      throw new Error('untrusted getter');
    },
  });
  act(() => window.dispatchEvent(hostile));
  expect(hook.result.current.available).toBe(false);
  act(() =>
    window.dispatchEvent(
      Object.assign(new Event('beforeinstallprompt'), { prompt: 'javascript:alert(1)' }),
    ),
  );
  expect(hook.result.current.available).toBe(false);
  installEvent('accepted', true);
  await act(() => hook.result.current.install());
  expect(hook.result.current.message).toMatch(/não está disponível/);
  expect(hook.result.current.pending).toBe(false);
});
it('impede prompt concorrente e preserva confirmação que chega antes de userChoice', async () => {
  const hook = await installHook();
  let finish!: (value: { outcome: string }) => void;
  const event = Object.assign(new Event('beforeinstallprompt'), {
    prompt: vi.fn().mockResolvedValue(undefined),
    userChoice: new Promise<{ outcome: string }>((resolve) => {
      finish = resolve;
    }),
  });
  act(() => window.dispatchEvent(event));
  let installation!: Promise<void>;
  act(() => {
    installation = hook.result.current.install();
  });
  await act(() => hook.result.current.install());
  act(() => window.dispatchEvent(new Event('appinstalled')));
  await act(async () => {
    finish({ outcome: 'accepted' });
    await installation;
  });
  expect(event.prompt).toHaveBeenCalledTimes(1);
  expect(hook.result.current.message).toMatch(/Instalação confirmada/);
});
it.each(['media', 'ios'])('standalone %s oculta convite e mantém Configurações', async (mode) => {
  if (mode === 'media')
    vi.stubGlobal('matchMedia', () => ({
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
  else Object.defineProperty(navigator, 'standalone', { configurable: true, value: true });
  const hook = await installHook();
  const view = render(<PwaInstallPrompt pwa={hook.result.current} />);
  expect(screen.queryByText('Leve o MedSim para sua tela inicial')).toBeNull();
  view.rerender(<PwaInstallPrompt pwa={hook.result.current} settings />);
  expect(screen.getByText(/já está aberto em modo aplicativo/)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Instalar MedSim' })).toBeNull();
  Reflect.deleteProperty(navigator, 'standalone');
});
it.each([
  ['iPhone', 0, 'iPhone e iPad', 'Compartilhar'],
  ['Macintosh', 5, 'iPhone e iPad', 'Compartilhar'],
  ['Android SamsungBrowser/27 Chrome/130', 0, 'Samsung Internet', 'Adicionar página'],
  ['Android Chrome/130', 0, 'Chrome no Android', '⋮'],
  ['Firefox', 0, 'Seu navegador', 'Se a opção'],
])('guia progressivo %s sem prometer instalação automática', async (ua, touches, browser, step) => {
  const { installationGuide } = await import('../src/pwa/install');
  const guide = installationGuide(String(ua), Number(touches));
  expect(guide.browser).toBe(browser);
  expect(guide.steps.join(' ')).toContain(step);
  const hook = await installHook();
  render(<PwaInstallPrompt pwa={hook.result.current} settings />);
  expect(screen.queryByRole('button', { name: 'Instalar MedSim' })).toBeNull();
  expect(screen.getByText(/Não há sincronização automática/)).toBeInTheDocument();
});
it.each(['blocked', 'invalid', 'normal'])(
  'dispensa segura com storage %s preserva demais chaves e persiste em memória',
  async (kind) => {
    const { installDismissKey } = await import('../src/pwa/install');
    localStorage.setItem('academic', 'raw-original');
    sessionStorage.setItem('scratch', 'session-original');
    if (kind === 'invalid') localStorage.setItem(installDismissKey, 'invalid-original');
    const hook = await installHook();
    if (kind === 'blocked')
      vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
        throw new Error('blocked');
      });
    act(() => hook.result.current.dismiss());
    expect(hook.result.current.dismissed).toBe(true);
    if (kind !== 'normal') expect(hook.result.current.dismissWarning).toBeTruthy();
    vi.restoreAllMocks();
    expect(localStorage.getItem('academic')).toBe('raw-original');
    expect(sessionStorage.getItem('scratch')).toBe('session-original');
    if (kind === 'invalid')
      expect(localStorage.getItem(installDismissKey)).toBe('invalid-original');
    if (kind === 'normal') expect(localStorage.getItem(installDismissKey)).toBe('dismissed');
    hook.unmount();
    const again = await installHook();
    expect(again.result.current.dismissed).toBe(true);
  },
);
it('registro seguro usa base e escopo; falha deixa site utilizável', async () => {
  const { registerPwaWorker } = await import('../src/pwa/register');
  const register = vi.fn().mockRejectedValue(new Error('blocked'));
  vi.stubGlobal('isSecureContext', false);
  Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { register } });
  await registerPwaWorker();
  expect(register).not.toHaveBeenCalled();
  vi.stubGlobal('isSecureContext', true);
  await expect(registerPwaWorker()).resolves.toBeUndefined();
  expect(register).toHaveBeenCalledWith('/CHATGPT/sw.js', {
    scope: '/CHATGPT/',
    updateViaCache: 'none',
  });
  Reflect.deleteProperty(navigator, 'serviceWorker');
});
it('worker ignora acadêmicos, JSONs, backups, externo e legado; HTTP não vira offline', async () => {
  const callbacks: Record<
    string,
    (event: { request: unknown; respondWith: (response: unknown) => void }) => void
  > = {};
  const network = vi.fn().mockResolvedValue(new Response('server-error', { status: 500 }));
  runInNewContext(await readFile('public/sw.js', 'utf8'), {
    URL,
    Response,
    fetch: network,
    self: {
      location: { href: 'https://medsim.invalid/CHATGPT/sw.js' },
      addEventListener: (name: string, cb: (typeof callbacks)[string]) => {
        callbacks[name] = cb;
      },
    },
    get caches() {
      throw new Error('Cache Storage forbidden');
    },
  });
  expect(Object.keys(callbacks)).toEqual(['fetch']);
  for (const [path, mode, method] of [
    ['/CHATGPT/generated/exam-index.json', 'cors', 'GET'],
    ['/CHATGPT/generated/exams/test.json', 'navigate', 'GET'],
    ['/CHATGPT/backup.json', 'cors', 'GET'],
    ['/CHATGPT/legacy/index.html', 'navigate', 'GET'],
    ['/CHATGPT/icons/medsim-192.png', 'no-cors', 'GET'],
    ['/CHATGPT/', 'navigate', 'POST'],
    ['https://external.invalid/CHATGPT/', 'navigate', 'GET'],
    ['/else/', 'navigate', 'GET'],
  ]) {
    const respondWith = vi.fn();
    callbacks.fetch!({
      request: { url: new URL(path!, 'https://medsim.invalid').href, mode, method },
      respondWith,
    });
    expect(respondWith).not.toHaveBeenCalled();
  }
  expect(network).not.toHaveBeenCalled();
  const request = {
    url: 'https://medsim.invalid/CHATGPT/?exam=test',
    mode: 'navigate',
    method: 'GET',
  };
  let response!: Promise<Response>;
  callbacks.fetch!({
    request,
    respondWith: (value) => {
      response = value as Promise<Response>;
    },
  });
  expect(network).toHaveBeenCalledWith(request, { cache: 'no-store' });
  expect((await response).status).toBe(500);
  network.mockRejectedValueOnce(new TypeError('offline'));
  callbacks.fetch!({
    request,
    respondWith: (value) => {
      response = value as Promise<Response>;
    },
  });
  const fallback = await response;
  expect(fallback.status).toBe(503);
  expect(fallback.headers.get('Cache-Control')).toBe('no-store');
  expect(await fallback.text()).toContain('O funcionamento offline ainda não está disponível');
});
it('conectividade avisa sem mutação, e falha de rede com onLine=true não é sucesso', async () => {
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  localStorage.setItem('academic', 'original');
  render(<ConnectivityNotice />);
  expect(screen.getByRole('status')).toHaveTextContent(offlineMessage);
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  fireEvent(window, new Event('online'));
  expect(screen.queryByRole('status')).toBeNull();
  const loader = vi.fn().mockRejectedValue(new TypeError('network failure'));
  const hook = renderHook(() => useResource(loader));
  await waitFor(() => expect(hook.result.current.error).toContain(offlineMessage));
  expect(hook.result.current.data).toBeUndefined();
  expect(localStorage.getItem('academic')).toBe('original');
});
it.each([true, false])(
  'HTTP conserva diagnóstico com onLine=%s, sem fallback de dados antigos',
  async (online) => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(online);
    const loader = vi.fn().mockRejectedValue(new Error('HTTP 404'));
    const hook = renderHook(() => useResource(loader));
    await waitFor(() => expect(hook.result.current.error).toBe('HTTP 404'));
    expect(hook.result.current.data).toBeUndefined();
  },
);
it('PWA preserva academicamente fonte, schemas, engine, legado e lockfile da main', async () => {
  const run = promisify(execFile);
  const { stdout } = await run('git', [
    'diff',
    '5a15d4028dfecce458f8f701f0150642de0fb187',
    '--',
    'data',
    'authoring',
    'schema',
    'src/engine',
    'simulados',
    'index.html',
    'simulados.json',
    '*.js',
    'package-lock.json',
    ':(exclude)public/sw.js',
  ]);
  expect(stdout).toBe('');
  const { stdout: untracked } = await run('git', [
    'ls-files',
    '--others',
    '--exclude-standard',
    '--',
    'data',
    'authoring',
    'schema',
    'src/engine',
    'simulados',
  ]);
  expect(untracked).toBe('');
});
it('infraestrutura permite somente script de audit, etapa read-only de CI e plugin CSP de desenvolvimento', async () => {
  const run = promisify(execFile);
  const base = '5a15d4028dfecce458f8f701f0150642de0fb187';
  const original = async (path: string) => (await run('git', ['show', `${base}:${path}`])).stdout;
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  expect(pkg.scripts['audit:security']).toBe('node scripts/audit-security.mjs');
  delete pkg.scripts['audit:security'];
  expect(pkg).toEqual(JSON.parse(await original('package.json')));
  const ci = await readFile('.github/workflows/ci.yml', 'utf8');
  expect(ci.replace('      - run: npm run audit:security\n', '')).toBe(
    await original('.github/workflows/ci.yml'),
  );
  const config = (await import('../vite.config')).default;
  expect(config.root).toBe('app');
  expect(config.base).toBe('/CHATGPT/');
  expect(config.publicDir).toBe('../public');
  expect(config.build).toEqual({ outDir: '../dist', emptyOutDir: true });
  expect(config.plugins).toHaveLength(1);
  expect(Object.keys(config).sort()).toEqual(['base', 'build', 'plugins', 'publicDir', 'root']);
  expect(config.plugins![0]).toMatchObject({ name: 'development-csp', apply: 'serve' });
  const plugin = config.plugins![0] as unknown as { transformIndexHtml: (html: string) => string };
  const html = await readFile('app/index.html', 'utf8');
  expect(html).toContain('Content-Security-Policy');
  const developmentHtml = plugin.transformIndexHtml(html);
  expect(developmentHtml).not.toContain('Content-Security-Policy');
  expect(developmentHtml).toContain('rel="manifest"');
  expect(developmentHtml).toContain('src="/main.ts"');
  const { stdout } = await run('git', [
    'diff',
    base,
    '--',
    '.github/workflows',
    ':(exclude).github/workflows/ci.yml',
  ]);
  expect(stdout).toBe(''); // Pages/manual publication and Content Gate remain byte-identical.
});
