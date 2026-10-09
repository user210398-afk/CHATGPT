export const installDismissKey = 'medsim:pwa:v1:install-dismissed';
const dismissedValue = 'dismissed';
let dismissedInDocument = false;

export function readInstallDismissed(): boolean {
  if (dismissedInDocument) return true;
  try {
    return localStorage.getItem(installDismissKey) === dismissedValue;
  } catch {
    return false;
  }
}
export function dismissInstall(): string | null {
  dismissedInDocument = true;
  try {
    const previous = localStorage.getItem(installDismissKey);
    if (previous !== null && previous !== dismissedValue)
      return 'Convite fechado nesta página. A preferência de instalação existente foi preservada.';
    localStorage.setItem(installDismissKey, dismissedValue);
    return null;
  } catch {
    return 'Convite fechado nesta página. Não foi possível salvar essa preferência no navegador.';
  }
}
export function isStandalone(): boolean {
  return (
    (window.matchMedia?.('(display-mode: standalone)').matches ?? false) ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}
// UA selects copy only. Installation capability always comes from browser events.
export function installationGuide(userAgent: string, touchPoints: number) {
  if (/iPhone|iPad|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && touchPoints > 1))
    return {
      browser: 'iPhone e iPad',
      steps: [
        'Abra o MedSim no Safari. Se estiver em outro navegador, copie o endereço e abra-o no Safari.',
        'Acesse o menu Compartilhar (a posição pode variar conforme a versão do iOS).',
        'Selecione Adicionar à Tela de Início; procure nas ações do menu se necessário.',
        'Ative a abertura como aplicativo da web quando essa opção aparecer.',
        'Confirme a adição e abra o MedSim pelo novo ícone.',
      ],
    };
  if (/SamsungBrowser/i.test(userAgent))
    return {
      browser: 'Samsung Internet',
      steps: [
        'Abra o menu do Samsung Internet.',
        'Procure Adicionar página a → Tela inicial ou Instalar aplicativo. O nome e a posição variam conforme a versão.',
        'Confirme a instalação ou adição e abra o MedSim pelo novo ícone.',
      ],
    };
  if (/Android/i.test(userAgent) && /Chrome/i.test(userAgent))
    return {
      browser: 'Chrome no Android',
      steps: [
        'Abra o menu ⋮ do Chrome.',
        'Procure Instalar aplicativo ou Adicionar à tela inicial. A opção depende da versão e da disponibilidade no navegador.',
        'Confirme a adição e abra o MedSim pelo novo ícone.',
      ],
    };
  return {
    browser: 'Seu navegador',
    steps: [
      'Abra o menu do navegador e procure Instalar aplicativo ou Adicionar à tela inicial.',
      'Se a opção estiver disponível, confirme e abra o MedSim pelo novo ícone.',
      'Se ela não aparecer, continue usando o site. No iPhone, abra no Safari e use Compartilhar → Adicionar à Tela de Início; no Android, tente Chrome ou Samsung Internet.',
    ],
  };
}
