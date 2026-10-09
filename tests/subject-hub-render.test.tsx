import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readExamCatalog } from '../scripts/catalog';
import { CatalogPage } from '../src/app/CatalogPage';
import { App } from '../src/app/App';
import { subjectGroupDefinition } from '../src/engine/subject-groups';
import { AttemptRepository, storageKey } from '../src/engine/persistence';
import { createAttempt, transition } from '../src/engine/exam-state';
import { CatalogPreferencesRepository } from '../src/engine/catalog-preferences';
const { catalog, exams } = await readExamCatalog();
const subjectCount = new Set(catalog.exams.map((exam) => subjectGroupDefinition(exam.subject).id))
  .size;
const questionCount = catalog.exams.reduce((sum, exam) => sum + exam.questionCount, 0);
const farmaco = exams.find((exam) => exam.id === 'farmaco-p2-2025')!;
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

it('Home renderiza todas as matérias, contagens e links reais, sem ExamCards', () => {
  const { container } = render(<CatalogPage catalog={catalog} />);
  expect(screen.getAllByRole('article')).toHaveLength(subjectCount);
  expect(container.querySelectorAll('.exam-card')).toHaveLength(0);
  expect(screen.queryByRole('searchbox')).not.toBeInTheDocument();
  expect(
    screen.getByText(
      `${subjectCount} matérias · ${catalog.exams.length} simulados · ${questionCount} questões`,
    ),
  ).toBeInTheDocument();
  const card = screen.getByRole('article', { name: 'Farmacologia' });
  expect(within(card).getByText('5 simulados · 148 questões')).toBeInTheDocument();
  expect(within(card).getByRole('link', { name: 'Farmacologia Abrir matéria →' })).toHaveAttribute(
    'href',
    '/CHATGPT/?area=farmacologia',
  );
  expect(card.querySelector('.subject-monogram')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.queryByRole('heading', { name: 'Farmacologia Básica' })).not.toBeInTheDocument();
  for (const alias of [
    'Propedêutica/Clínica Médica',
    'Microbiologia/Virologia',
    'Patologia/Imunologia',
  ])
    expect(screen.queryByRole('article', { name: alias })).not.toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  expect(screen.getByRole('link', { name: 'Ver todos os simulados' })).toHaveAttribute(
    'href',
    '/CHATGPT/?view=all',
  );
});

it('App coloca um único convite entre cabeçalho e matérias somente após dispensar SetupPrompt', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(catalog))));
  window.history.replaceState({}, '', '/CHATGPT/');
  const { container } = render(<App />);
  await screen.findByRole('heading', { name: 'Suas matérias' });
  expect(container.querySelector('.setup-prompt')).toBeInTheDocument();
  expect(container.querySelector('.pwa-install')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Agora não' }));
  expect(container.querySelector('.setup-prompt')).toBeNull();
  expect(container.querySelectorAll('.pwa-install')).toHaveLength(1);
  const header = container.querySelector('.catalog-heading')!;
  const prompt = container.querySelector('.pwa-install')!;
  expect(header.nextElementSibling).toBe(prompt);
  expect(prompt.nextElementSibling).toBe(
    container.querySelector('section[aria-labelledby="subjects-title"]'),
  );
});

it.each([
  ['farmacologia', 'Farmacologia', 5, 148],
  ['propedeutica', 'Propedêutica', 2, 40],
])('%s mostra somente seus simulados e breadcrumb', (area, title, count, questions) => {
  render(<CatalogPage catalog={catalog} area={String(area)} />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(String(title));
  expect(screen.getAllByRole('article')).toHaveLength(Number(count));
  expect(screen.getByText(`${count} simulados · ${questions} questões`)).toBeInTheDocument();
  expect(screen.queryByLabelText('Disciplina')).not.toBeInTheDocument();
  const breadcrumb = screen.getByRole('navigation', { name: 'Breadcrumb' });
  expect(within(breadcrumb).getByRole('link', { name: 'Matérias' })).toHaveAttribute(
    'href',
    '/CHATGPT/',
  );
  expect(within(breadcrumb).getByText(String(title))).toHaveAttribute('aria-current', 'page');
});

it('Todos os simulados mostra um ExamCard por prova e preserva todos os filtros', () => {
  render(<CatalogPage catalog={catalog} mode="all" />);
  expect(screen.getAllByRole('article')).toHaveLength(catalog.exams.length);
  expect(
    screen.getByText(`${catalog.exams.length} simulados · ${questionCount} questões`),
  ).toBeInTheDocument();
  for (const label of ['Disciplina', 'Ano', 'Status', 'Favoritos', 'Tipo', 'Ordenação'])
    expect(screen.getByLabelText(label)).toBeInTheDocument();
});

it('filtros de matéria combinam busca, ano, status, tipo, favorito e ordenação', async () => {
  const repository = new AttemptRepository(() => localStorage);
  repository.save(
    farmaco,
    transition(farmaco, createAttempt(farmaco, '2026-10-03T10:00:00.000Z'), {
      type: 'finish',
      now: '2026-10-03T11:00:00.000Z',
    }),
    [],
    repository.read(farmaco).persistence,
  );
  new CatalogPreferencesRepository(() => localStorage).setFavorite(farmaco.id, true);
  const coincident = {
    ...catalog,
    exams: catalog.exams.map((exam) => ({ ...exam, tags: [...exam.tags, 'audit-coincident-tag'] })),
  };
  render(<CatalogPage catalog={coincident} area="farmacologia" />);
  const user = userEvent.setup();
  await user.type(screen.getByRole('searchbox'), 'audit-coincident-tag');
  expect(screen.getAllByRole('article')).toHaveLength(5);
  for (const article of screen.getAllByRole('article'))
    expect(within(article).getByRole('link')).toHaveAttribute(
      'href',
      expect.stringContaining('farmac'),
    );
  await user.clear(screen.getByRole('searchbox'));
  await user.type(screen.getByRole('searchbox'), 'farmacologia');
  await user.selectOptions(screen.getByLabelText('Ano'), '2025');
  await user.selectOptions(screen.getByLabelText('Status'), 'completed');
  await user.selectOptions(screen.getByLabelText('Tipo'), 'objective-only');
  await user.selectOptions(screen.getByLabelText('Favoritos'), 'favorites');
  await user.selectOptions(screen.getByLabelText('Ordenação'), 'year');
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByText('1 de 5 provas')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: `Remover ${farmaco.title} dos favoritos` }));
  expect(screen.queryAllByRole('article')).toHaveLength(0);
  expect(screen.getByRole('status')).toHaveTextContent('Nenhuma prova encontrada');
  await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
  expect(screen.getAllByRole('article')).toHaveLength(5);
});

it('favoritos existentes refletem ao abrir e alteração persiste imediatamente', async () => {
  const preferences = new CatalogPreferencesRepository(() => localStorage);
  const unrelated = catalog.exams.find((exam) => exam.subject === 'Fisiologia')!;
  preferences.setFavorite(farmaco.id, true);
  preferences.setFavorite(unrelated.id, true);
  const view = render(<CatalogPage catalog={catalog} area="farmacologia" />);
  const button = screen.getByRole('button', { name: `Remover ${farmaco.title} dos favoritos` });
  expect(button).toHaveAttribute('aria-pressed', 'true');
  await userEvent.setup().click(button);
  expect(button).toHaveAttribute('aria-pressed', 'false');
  view.unmount();
  const all = render(<CatalogPage catalog={catalog} mode="all" />);
  expect(
    screen.getByRole('button', { name: `Adicionar ${farmaco.title} aos favoritos` }),
  ).toHaveAttribute('aria-pressed', 'false');
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: `Adicionar ${farmaco.title} aos favoritos` }));
  expect(
    screen.getByRole('button', { name: `Remover ${unrelated.title} dos favoritos` }),
  ).toHaveAttribute('aria-pressed', 'true');
  all.unmount();
  render(<CatalogPage catalog={catalog} area="farmacologia" />);
  expect(
    screen.getByRole('button', { name: `Remover ${farmaco.title} dos favoritos` }),
  ).toHaveAttribute('aria-pressed', 'true');
});

it('progresso de current e conclusão agrega no Hub e preserva ExamCard', () => {
  const other = exams.find((exam) => exam.id === 'farmaco-p2-2024')!;
  const studyCurrent = exams.find((exam) => exam.id === 'farmaco-p2-2023')!;
  const studyComplete = exams.find((exam) => exam.id === 'farmacologia-parassimpatoliticos')!;
  const repository = new AttemptRepository(() => localStorage);
  repository.save(
    farmaco,
    { ...createAttempt(farmaco), answers: { [farmaco.questions[0]!.id]: 'option-1' } },
    [],
    repository.read(farmaco).persistence,
  );
  repository.save(
    studyCurrent,
    createAttempt(studyCurrent, '2026-10-03T10:00:00.000Z', 'study-current', 'study'),
    [],
    repository.read(studyCurrent).persistence,
  );
  repository.save(
    studyComplete,
    transition(
      studyComplete,
      createAttempt(studyComplete, '2026-10-03T10:00:00.000Z', 'study-complete', 'study'),
      {
        type: 'finish',
        now: '2026-10-03T11:00:00.000Z',
      },
    ),
    [],
    repository.read(studyComplete).persistence,
  );
  repository.save(
    other,
    transition(other, createAttempt(other, '2026-10-03T10:00:00.000Z'), {
      type: 'finish',
      now: '2026-10-03T11:00:00.000Z',
    }),
    [],
    repository.read(other).persistence,
  );
  const view = render(<CatalogPage catalog={catalog} />);
  expect(
    within(screen.getByRole('article', { name: 'Farmacologia' })).getByText(
      '2 concluídos · 2 em andamento · 1 não iniciado',
    ),
  ).toBeInTheDocument();
  view.unmount();
  render(<CatalogPage catalog={catalog} area="farmacologia" />);
  expect(screen.getAllByRole('link', { name: /Continuar/ })).toHaveLength(2);
  expect(
    within(screen.getByRole('article', { name: farmaco.title })).getByRole('link', {
      name: 'Continuar',
    }),
  ).toHaveAttribute('href', `/CHATGPT/?exam=${farmaco.id}`);
  expect(screen.getByText('Respondidas 1 de 42')).toBeInTheDocument();
  expect(screen.getAllByText('Último resultado: 0%')).toHaveLength(2);
  expect(screen.getAllByText('1 tentativa concluída')).toHaveLength(2);
});

it('pageshow atualiza resumo do Hub restaurado do bfcache', () => {
  render(<CatalogPage catalog={catalog} />);
  const repository = new AttemptRepository(() => localStorage);
  repository.save(farmaco, createAttempt(farmaco), [], repository.read(farmaco).persistence);
  fireEvent(window, new Event('pageshow'));
  expect(screen.getByText('0 concluídos · 1 em andamento · 4 não iniciados')).toBeInTheDocument();
});

it.each(['missing', '', 'Farmacologia'])(
  'rota inválida %s mostra erro explícito e retorno',
  (area) => {
    const before = JSON.stringify(Object.entries(localStorage));
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const removes = vi.spyOn(Storage.prototype, 'removeItem');
    render(<CatalogPage catalog={catalog} area={area} />);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Matéria não encontrada.');
    expect(screen.getByRole('link', { name: 'Voltar para Matérias' })).toHaveAttribute(
      'href',
      '/CHATGPT/',
    );
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    expect(JSON.stringify(Object.entries(localStorage))).toBe(before);
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
  },
);

it('matéria futura aparece no Hub e sua página preserva o nome original', () => {
  const future = { ...catalog.exams[0]!, id: 'future-neuro', subject: 'Neurocirurgia / Pediatria' };
  const extended = { ...catalog, exams: [...catalog.exams, future] };
  const view = render(<CatalogPage catalog={extended} />);
  expect(screen.getByRole('article', { name: future.subject })).toBeInTheDocument();
  view.unmount();
  render(<CatalogPage catalog={extended} area={subjectGroupDefinition(future.subject).id} />);
  expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(future.subject);
  expect(screen.getAllByRole('article')).toHaveLength(1);
});

it('catálogo vazio possui estados previsíveis no Hub e em Todos', () => {
  const empty = { ...catalog, exams: [] };
  const view = render(<CatalogPage catalog={empty} />);
  expect(screen.getByRole('status')).toHaveTextContent('Nenhuma matéria disponível.');
  view.unmount();
  render(<CatalogPage catalog={empty} mode="all" />);
  expect(screen.getByRole('status')).toHaveTextContent('Nenhuma prova encontrada.');
});

it.each(['', '?area=farmacologia', '?view=all'])(
  'App navega %s sem setItem/removeItem/clear nem Exam completo',
  async (search) => {
    localStorage.setItem(storageKey(farmaco), '{corrupt-current');
    const writes = vi.spyOn(Storage.prototype, 'setItem');
    const removes = vi.spyOn(Storage.prototype, 'removeItem');
    const clears = vi.spyOn(Storage.prototype, 'clear');
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(JSON.stringify(catalog)));
    vi.stubGlobal('fetch', fetcher);
    window.history.replaceState({}, '', `/CHATGPT/${search}`);
    render(<App />);
    await screen.findByRole('heading', {
      name:
        search === ''
          ? 'Suas matérias'
          : search.includes('area')
            ? 'Farmacologia'
            : 'Todos os simulados',
    });
    fireEvent(window, new Event('pageshow'));
    expect(writes).not.toHaveBeenCalled();
    expect(removes).not.toHaveBeenCalled();
    expect(clears).not.toHaveBeenCalled();
    expect(localStorage.getItem(storageKey(farmaco))).toBe('{corrupt-current');
    expect(fetcher.mock.calls.every(([url]) => url === '/CHATGPT/generated/exam-index.json')).toBe(
      true,
    );
    expect(screen.getByRole('link', { name: 'Matérias', current: 'page' })).toBeInTheDocument();
  },
);
