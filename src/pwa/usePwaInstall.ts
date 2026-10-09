import { useEffect, useRef, useState } from 'react';
import { dismissInstall, installDismissKey, isStandalone, readInstallDismissed } from './install';

type InstallEvent = Event & {
  prompt: () => Promise<unknown>;
  userChoice: Promise<{ outcome: string }>;
};
function isInstallEvent(event: Event): event is InstallEvent {
  try {
    const candidate = event as Partial<InstallEvent>;
    return (
      typeof candidate.prompt === 'function' && typeof candidate.userChoice?.then === 'function'
    );
  } catch {
    return false;
  }
}
export function usePwaInstall() {
  const deferred = useRef<InstallEvent | null>(null);
  const busy = useRef(false);
  const installedConfirmed = useRef(false);
  const mounted = useRef(true);
  const [standalone, setStandalone] = useState(isStandalone);
  const [dismissed, setDismissed] = useState(readInstallDismissed);
  const [available, setAvailable] = useState(false);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [dismissWarning, setDismissWarning] = useState<string | null>(null);
  useEffect(() => {
    mounted.current = true;
    const media = window.matchMedia?.('(display-mode: standalone)');
    const update = () => setStandalone(isStandalone());
    const capture = (event: Event) => {
      if (isStandalone() || !isInstallEvent(event)) return;
      event.preventDefault();
      deferred.current = event;
      setAvailable(true);
    };
    const installed = () => {
      installedConfirmed.current = true;
      deferred.current = null;
      setAvailable(false);
      setDismissed(true);
      setMessage('Instalação confirmada pelo navegador. Abra o MedSim pelo ícone na tela inicial.');
    };
    const storage = (event: StorageEvent) => {
      // Re-read rather than trusting event.newValue.
      if (event.key === installDismissKey) setDismissed(readInstallDismissed());
    };
    media?.addEventListener('change', update);
    window.addEventListener('pageshow', update);
    window.addEventListener('beforeinstallprompt', capture);
    window.addEventListener('appinstalled', installed);
    window.addEventListener('storage', storage);
    return () => {
      mounted.current = false;
      deferred.current = null;
      media?.removeEventListener('change', update);
      window.removeEventListener('pageshow', update);
      window.removeEventListener('beforeinstallprompt', capture);
      window.removeEventListener('appinstalled', installed);
      window.removeEventListener('storage', storage);
    };
  }, []);
  async function install() {
    const event = deferred.current;
    if (!event || busy.current || isStandalone()) return;
    busy.current = true;
    deferred.current = null; // A prompt can only be consumed once.
    setAvailable(false);
    setPending(true);
    try {
      await event.prompt(); // Exclusively called by an explicit user action.
      const choice: unknown = await event.userChoice;
      if (mounted.current && !installedConfirmed.current)
        setMessage(
          choice &&
            typeof choice === 'object' &&
            'outcome' in choice &&
            choice.outcome === 'accepted'
            ? 'Solicitação aceita. Aguarde a confirmação de instalação do navegador.'
            : 'Instalação não confirmada. Você pode continuar pelo site e consultar as instruções.',
        );
    } catch {
      if (mounted.current && !installedConfirmed.current)
        setMessage('A instalação não está disponível agora. Consulte as instruções do navegador.');
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }
  return {
    standalone,
    dismissed,
    available,
    pending,
    message,
    dismissWarning,
    install,
    dismiss: () => {
      setDismissWarning(dismissInstall());
      setDismissed(true);
    },
  };
}
export type PwaInstallState = ReturnType<typeof usePwaInstall>;
