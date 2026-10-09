import { sitePath } from '../utils/paths';

// Default lifecycle: no skipWaiting, claim, controllerchange reload, or data writes.
export async function registerPwaWorker(): Promise<void> {
  if (!window.isSecureContext || !('serviceWorker' in navigator)) return;
  try {
    await navigator.serviceWorker.register(sitePath('sw.js'), {
      scope: sitePath(''),
      updateViaCache: 'none',
    });
  } catch {
    // Registration/update failure must leave the regular online site usable.
  }
}
