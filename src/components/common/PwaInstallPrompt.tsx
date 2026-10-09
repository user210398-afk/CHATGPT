import { useId } from 'react';
import { installationGuide } from '../../pwa/install';
import type { PwaInstallState } from '../../pwa/usePwaInstall';

export function PwaInstallPrompt({
  pwa,
  settings = false,
}: {
  pwa: PwaInstallState;
  settings?: boolean;
}) {
  const titleId = useId();
  if (!settings && (pwa.standalone || pwa.dismissed))
    return pwa.dismissWarning ? (
      <p role="status" className="notice">
        {pwa.dismissWarning}
      </p>
    ) : null;
  const guide = installationGuide(navigator.userAgent, navigator.maxTouchPoints);
  return (
    <section className="card pwa-install" aria-labelledby={titleId}>
      <h2 id={titleId}>{settings ? 'MedSim no celular' : 'Leve o MedSim para sua tela inicial'}</h2>
      <p>
        {settings
          ? 'Você pode adicionar o MedSim à tela inicial e utilizá-lo como aplicativo.'
          : 'Acesse seus simulados com a praticidade de um aplicativo, direto do celular. Sem precisar baixar pela loja de aplicativos.'}
      </p>
      <p className="notice">
        É necessária conexão com a internet para utilizar os simulados. O funcionamento offline
        ainda não está disponível e está previsto para futuras atualizações.
      </p>
      {pwa.standalone ? (
        <p role="status">O MedSim já está aberto em modo aplicativo.</p>
      ) : (
        <>
          {pwa.available && (
            <button className="primary" onClick={() => void pwa.install()} disabled={pwa.pending}>
              Instalar MedSim
            </button>
          )}
          {pwa.pending && <p role="status">Aguardando o navegador…</p>}
          <details className="pwa-guide" open={settings || undefined}>
            <summary>Como instalar</summary>
            <p>
              <strong>{guide.browser}</strong>
            </p>
            <ol>
              {guide.steps.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <p className="small">
              A instalação e a abertura como aplicativo dependem do navegador e da versão do
              sistema. Um atalho pode continuar abrindo no navegador.
            </p>
          </details>
        </>
      )}
      <p className="small muted">
        Seu progresso fica armazenado localmente no dispositivo. Não há sincronização automática
        entre dispositivos. A instalação não cria uma conta nem envia automaticamente seu histórico
        a um servidor.
      </p>
      <p className="small muted">
        Antes de mudar do navegador para o aplicativo, exporte um backup em Configurações → Dados.
        Especialmente no iOS, os ambientes podem ter armazenamentos separados. Guarde o backup e
        importe-o no novo ambiente; anotações e eliminações temporárias não fazem parte do backup
        atual.
      </p>
      {pwa.message && <p role="status">{pwa.message}</p>}
      {settings && pwa.dismissWarning && <p role="status">{pwa.dismissWarning}</p>}
      {!settings && <button onClick={pwa.dismiss}>Agora não</button>}
    </section>
  );
}
