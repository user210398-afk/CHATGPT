import { useEffect, useState } from 'react';
import { offlineMessage } from '../pwa/ConnectivityNotice';
export function useResource<T>(loader: (signal: AbortSignal) => Promise<T>) {
  const [state, setState] = useState<{ data?: T; error?: string }>({});
  useEffect(() => {
    const controller = new AbortController();
    setState({});
    loader(controller.signal)
      .then((data) => {
        if (!controller.signal.aborted) setState({ data });
      })
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            error:
              error instanceof TypeError
                ? `${offlineMessage} A requisição não foi concluída; uma indicação de conexão do navegador não garante acesso ao servidor.`
                : error instanceof Error
                  ? error.message
                  : 'Falha ao carregar os dados.',
          });
      });
    return () => controller.abort();
  }, [loader]);
  return state;
}
