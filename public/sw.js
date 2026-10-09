/* MedSim PWA-1: network only, zero Cache Storage. Default conservative lifecycle.
 * No skipWaiting/claim/reload/messages, remote imports or academic interception.
 * Change this file to release a worker update; it waits for controlled tabs to close.
 */
const entry = new URL('./', self.location.href);
const offlinePage = `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>MedSim — conexão necessária</title></head>
<body><main><h1>MedSim precisa de internet</h1><p>O MedSim precisa de conexão com a internet para utilizar os simulados. O funcionamento offline ainda não está disponível. Conecte-se à internet e tente novamente.</p><p>Seus registros locais não foram apagados. Não há sincronização automática entre dispositivos.</p><p><a href="./">Tentar novamente com conexão</a></p></main></body></html>`;

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (
    request.method !== 'GET' || request.mode !== 'navigate' ||
    url.origin !== entry.origin ||
    (url.pathname !== entry.pathname && url.pathname !== `${entry.pathname}index.html`)
  ) return;
  event.respondWith(
    fetch(request, { cache: 'no-store' }).catch(() => new Response(offlinePage, {
      status: 503,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store',
        'Content-Security-Policy': "default-src 'none'; base-uri 'none'; form-action 'none'; object-src 'none'",
      },
    })),
  );
});
