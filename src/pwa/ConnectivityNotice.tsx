import { useEffect, useState } from 'react';

export const offlineMessage =
  'Sem conexão com a internet. Os simulados do MedSim ainda não estão disponíveis offline. Verifique sua conexão para continuar.';
export function ConnectivityNotice() {
  const [offline, setOffline] = useState(() => navigator.onLine === false);
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return offline ? (
    <p role="status" className="notice">
      {offlineMessage}
    </p>
  ) : null;
}
