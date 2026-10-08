import {
  allExamsUrl,
  dashboardUrl,
  errorNotebookUrl,
  reviewUrl,
  settingsUrl,
  sitePath,
} from '../utils/paths';

// Presentation only. These destinations never select an exam, attempt or review session.
export const guidedTourSteps = [
  {
    title: 'Boas-vindas ao MedSim',
    description:
      'Organize sua prática médica, acompanhe seu aprendizado e retome os assuntos que precisam de atenção. Esta apresentação é opcional: você pode sair e recomeçar quando quiser.',
    href: () => sitePath(''),
    target: '.app-header .brand',
  },
  {
    title: 'Catálogo de matérias',
    description:
      'As matérias organizam os simulados por área. Escolha um assunto para explorar as provas e o progresso disponível. Você também pode consultar todos os simulados juntos.',
    href: () => sitePath(''),
    target: '#tour-content [aria-labelledby="subjects-title"] .catalog-toolbar',
  },
  {
    title: 'Busca e filtros de simulados',
    description:
      'Encontre um simulado pelo nome e combine filtros de disciplina, ano, tipo, status e favoritos. Abrir ou iniciar uma prova depende da sua escolha, depois da apresentação.',
    href: allExamsUrl,
    target: '#tour-content .catalog-filters',
  },
  {
    title: 'Dashboard e desempenho',
    description:
      'O dashboard reúne seu progresso local e a evolução dos resultados. Com tentativas concluídas, você poderá acompanhar tendências por matéria. Sem resultados, a página indica o que ainda está disponível.',
    href: dashboardUrl,
    target: '#tour-content [aria-labelledby="overview-title"]',
  },
  {
    title: 'Revisão de tentativas',
    description:
      'Aqui você encontra tentativas concluídas disponíveis para revisar respostas e explicações. Se ainda não houver histórico, volte após concluir um simulado. Esta apresentação não abre tentativas nem inicia sessões de revisão.',
    href: () => reviewUrl(),
    target: '#tour-content .page-heading',
  },
  {
    title: 'Caderno de Erros',
    description:
      'Consulte as questões que merecem atenção e acompanhe erros recorrentes e dificuldades superadas. O caderno usa resultados disponíveis neste navegador; sem tentativas, ele apresenta um estado vazio.',
    href: errorNotebookUrl,
    target: '#tour-content .notebook-page .page-heading',
  },
  {
    title: 'Configurações e personalização',
    description:
      'Escolha tema, tamanho do texto e densidade. As opções de acessibilidade incluem alto contraste, foco reforçado e redução de movimentos. Ao sair, você volta à página onde iniciou; use “Conhecer o MedSim” para recomeçar.',
    href: settingsUrl,
    target: '#tour-content [aria-labelledby="appearance-title"]',
  },
] as const;
