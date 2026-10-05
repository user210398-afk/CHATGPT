import { storageFixtureJson } from './legacy-fixtures';
import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CatalogPage } from '../src/app/CatalogPage';
import { AttemptRepository, storageKey } from '../src/engine/persistence';
import { catalogPreferencesKey } from '../src/engine/catalog-preferences';
import { createAttempt, transition } from '../src/engine/exam-state';
import { catalogExam, completedAttempt, testCatalog } from './catalog-fixtures';
import { poc } from './fixtures';
afterEach(() => vi.restoreAllMocks());
it('renderiza todas as provas, status textual e CTA inicial', () => {
  render(<CatalogPage catalog={testCatalog} />);
  expect(screen.getAllByRole('article')).toHaveLength(3);
  expect(screen.getAllByText('Não iniciada')).toHaveLength(3);
  expect(screen.getAllByRole('link', { name: /Abrir prova/ })).toHaveLength(3);
  expect(screen.getByText('3 provas disponíveis')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Limpar filtros' })).not.toBeInTheDocument();
});
it('tentativa aberta mostra progresso acessível e CTA Continuar', () => {
  new AttemptRepository(() => localStorage).save(
    poc,
    {
      ...createAttempt(poc),
      answers: { [poc.questions[0]!.id]: 'option-1', [poc.questions[1]!.id]: 'option-2' },
    },
    [],
  );
  render(<CatalogPage catalog={testCatalog} />);
  expect(within(screen.getAllByRole('article')[0]!).getByText('Em andamento')).toBeInTheDocument();
  expect(screen.getByText('Respondidas 2 de 30')).toBeInTheDocument();
  expect(screen.getByRole('progressbar')).toHaveAccessibleName('Respondidas 2 de 30 7%');
  expect(screen.getByRole('progressbar')).toHaveAttribute('value', '2');
  expect(screen.getByRole('link', { name: /Continuar/ })).toHaveAttribute(
    'href',
    `/CHATGPT/?exam=${poc.id}`,
  );
});
it('conclusão mostra resultado, singular e CTA Ver prova', () => {
  new AttemptRepository(() => localStorage).save(poc, completedAttempt(), []);
  render(<CatalogPage catalog={testCatalog} />);
  expect(screen.getByText('Concluída')).toBeInTheDocument();
  expect(screen.getByText('Último resultado: 5%')).toBeInTheDocument();
  expect(screen.getByText('1 tentativa concluída')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Ver prova/ })).toBeInTheDocument();
});
it('dissertativa concluída mostra sem nota automática sem inferir percentual', () => {
  const essay = {
    ...poc,
    id: 'card-essay',
    questions: poc.questions.filter((q) => q.type === 'essay'),
  };
  const current = transition(essay, createAttempt(essay, '2026-10-03T10:00:00.000Z'), {
    type: 'finish',
    now: '2026-10-03T11:00:00.000Z',
  });
  new AttemptRepository(() => localStorage).save(essay, current, []);
  render(<CatalogPage catalog={testCatalog} />);
  expect(screen.getByText('Concluída · sem nota automática')).toBeInTheDocument();
  expect(screen.queryByText(/Último resultado/)).not.toBeInTheDocument();
});
it('favorito muda aria-pressed imediatamente, persiste e não abre a prova', async () => {
  render(<CatalogPage catalog={testCatalog} />);
  const user = userEvent.setup();
  const button = screen.getByRole('button', {
    name: `Adicionar ${catalogExam.title} aos favoritos`,
  });
  expect(button).toHaveAttribute('aria-pressed', 'false');
  await user.click(button);
  expect(button).toHaveAttribute('aria-pressed', 'true');
  expect(button).toHaveAccessibleName(`Remover ${catalogExam.title} dos favoritos`);
  expect(JSON.parse(localStorage.getItem(catalogPreferencesKey)!).favorites).toEqual([poc.id]);
  await user.click(button);
  expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getAllByRole('article')).toHaveLength(3);
});
it('filtros combinados, contador X de Y, empty state e limpar restauram todos os controles', async () => {
  render(<CatalogPage catalog={testCatalog} />);
  const user = userEvent.setup();
  await user.selectOptions(screen.getByLabelText('Disciplina'), 'Farmacologia');
  await user.selectOptions(screen.getByLabelText('Tipo'), 'objective-only');
  await user.selectOptions(screen.getByLabelText('Ano'), '2025');
  await user.selectOptions(screen.getByLabelText('Ordenação'), 'lowest');
  expect(screen.getAllByRole('article')).toHaveLength(1);
  expect(screen.getByText('1 de 3 provas')).toBeInTheDocument();
  await user.selectOptions(screen.getByLabelText('Status'), 'completed');
  await user.selectOptions(screen.getByLabelText('Favoritos'), 'favorites');
  await user.type(screen.getByRole('searchbox'), 'zzz');
  expect(screen.getByRole('status')).toHaveTextContent('Nenhuma prova encontrada');
  expect(screen.getByText('0 de 3 provas')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
  expect(screen.getAllByRole('article')).toHaveLength(3);
  expect(screen.getByRole('searchbox')).toHaveValue('');
  for (const label of ['Disciplina', 'Ano', 'Status', 'Favoritos', 'Tipo'])
    expect(screen.getByLabelText(label)).toHaveValue('all');
  expect(screen.getByLabelText('Ordenação')).toHaveValue('default');
});
it('filtro favoritos reage à remoção sem recarregar a página', async () => {
  render(<CatalogPage catalog={testCatalog} />);
  const user = userEvent.setup();
  await user.click(
    screen.getByRole('button', { name: `Adicionar ${catalogExam.title} aos favoritos` }),
  );
  await user.selectOptions(screen.getByLabelText('Favoritos'), 'favorites');
  expect(screen.getAllByRole('article')).toHaveLength(1);
  await user.click(
    screen.getByRole('button', { name: `Remover ${catalogExam.title} dos favoritos` }),
  );
  expect(screen.queryAllByRole('article')).toHaveLength(0);
});
it('falha de escrita preserva aria-pressed e mostra aviso honesto', async () => {
  render(<CatalogPage catalog={testCatalog} />);
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('quota');
  });
  const button = screen.getByRole('button', {
    name: `Adicionar ${catalogExam.title} aos favoritos`,
  });
  await userEvent.setup().click(button);
  expect(button).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('status')).toHaveTextContent('O favorito não foi alterado');
  expect(screen.getAllByRole('article')).toHaveLength(3);
});
it('storage bloqueado permite catálogo, links, busca e filtros independentes', async () => {
  vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new DOMException('blocked', 'SecurityError');
  });
  render(<CatalogPage catalog={testCatalog} />);
  expect(screen.getAllByRole('article')).toHaveLength(3);
  expect(screen.getAllByRole('link', { name: /Abrir prova/ })).toHaveLength(3);
  await userEvent.setup().selectOptions(screen.getByLabelText('Tipo'), 'essay-only');
  expect(screen.getAllByRole('article')).toHaveLength(1);
  fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'zoologia' } });
  expect(screen.getAllByRole('article')).toHaveLength(1);
});
it('corrupção não sobrescreve os registros ao montar ou favoritar', async () => {
  localStorage.setItem(catalogPreferencesKey, '{bad');
  localStorage.setItem(storageKey(catalogExam), '{bad-current');
  render(<CatalogPage catalog={testCatalog} />);
  await userEvent
    .setup()
    .click(screen.getByRole('button', { name: `Adicionar ${catalogExam.title} aos favoritos` }));
  expect(localStorage.getItem(catalogPreferencesKey)).toBe('{bad');
  expect(localStorage.getItem(storageKey(catalogExam))).toBe('{bad-current');
});
it('pageshow atualiza progresso ao restaurar catálogo do cache de navegação', () => {
  render(<CatalogPage catalog={testCatalog} />);
  localStorage.setItem(
    storageKey(catalogExam),
    storageFixtureJson({ storageVersion: 2, current: completedAttempt() }),
  );
  fireEvent(window, new Event('pageshow'));
  expect(within(screen.getAllByRole('article')[0]!).getByText('Concluída')).toBeInTheDocument();
});
