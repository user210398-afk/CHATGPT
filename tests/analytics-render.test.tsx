import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DashboardPage } from '../src/app/DashboardPage';
import { PerformanceTrendChart } from '../src/components/dashboard/PerformanceTrendChart';
import { SubjectPerformanceChart } from '../src/components/dashboard/SubjectPerformanceChart';
import { StudyRhythmChart } from '../src/components/dashboard/StudyRhythmChart';
import { PerformanceInsights } from '../src/components/dashboard/PerformanceInsights';
import { BackupControls } from '../src/components/settings/BackupControls';
import { HistoryResetControls } from '../src/components/dashboard/HistoryResetControls';
import {
  analyzePerformance,
  defaultAnalyticsFilters,
  performanceSeries,
} from '../src/engine/analytics';
import type { AnalyticsAttempt } from '../src/engine/analytics-reader';
import { storageKey, historyStorageKey, summary } from '../src/engine/persistence';
import { catalogExam, completedAttempt, testCatalog } from './catalog-fixtures';
import { poc } from './fixtures';
const now = Date.parse('2026-10-07T12:00:00.000Z');
function point(
  id: string,
  score: number | null = 80,
  mode: 'exam' | 'study' = 'exam',
): AnalyticsAttempt {
  return {
    attemptId: id,
    examId: 'exam',
    examRevision: 1,
    examTitle: `Prova ${id}`,
    subject: 'Fisiologia',
    mode,
    completedAt: new Date(now - Number(id || 0) * 1000).toISOString(),
    percentage: score,
    correct: score ?? 0,
    incorrect: score === null ? 0 : 100 - score,
    unanswered: 0,
    objectiveTotal: score === null ? 0 : 100,
  };
}
function seed(count = 6) {
  const history = Array.from({ length: count }, (_, i) => ({
    ...summary(
      completedAttempt(
        `result-${i}`,
        i + 1,
        `2026-10-0${3 + Math.floor(i / 3)}T1${i % 3}:00:00.000Z`,
      ),
    ),
    mode: i % 2 ? 'study' : 'exam',
  }));
  localStorage.setItem(historyStorageKey(poc), JSON.stringify({ storageVersion: 3, history }));
}
afterEach(() => {
  vi.restoreAllMocks();
  document.documentElement.removeAttribute('data-text-size');
});
describe('Dashboard Analytics', () => {
  it('hierarquia, Panorama global, estado vazio e honestidade sem 0% inventado', () => {
    render(<DashboardPage catalog={testCatalog} />);
    for (const name of [
      'Meu desempenho',
      'Panorama geral',
      'Evolução',
      'Evolução do desempenho',
      'Médias por disciplina',
      'Ritmo de estudo',
      'Leituras do seu desempenho',
      'Atividade recente',
      'Backup do progresso',
      'Dados e histórico',
    ])
      expect(screen.getByRole('heading', { name })).toBeInTheDocument();
    expect(document.querySelectorAll('.metric')).toHaveLength(8);
    expect(screen.getByText('Todo o progresso local · sem filtros')).toBeInTheDocument();
    expect(
      screen.getByText('Nenhum resultado com nota automática neste recorte.'),
    ).toBeInTheDocument();
    expect(document.querySelector('.analytics-summary div:last-child dd')).toHaveTextContent('—');
    expect(document.querySelectorAll('.performance-point')).toHaveLength(0);
    expect(screen.getByText(/somente da revisão atualmente publicada/)).toBeInTheDocument();
    expect(screen.getByText('Dados insuficientes para avaliar tendência')).toBeInTheDocument();
  });
  it('armazenamento indisponível usa —, sem gráficos ou insights de zeros', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('blocked');
    });
    render(<DashboardPage catalog={testCatalog} />);
    expect(screen.getByText(/Analytics indisponível/)).toHaveTextContent('Resultados: —');
    expect(
      screen.queryByRole('heading', { name: 'Evolução do desempenho' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'Leituras do seu desempenho' }),
    ).not.toBeInTheDocument();
    expect(document.querySelector('.metric-featured dd')).toHaveTextContent('—');
  });
  it('warning partial preserva fontes independentes válidas', () => {
    seed(1);
    localStorage.setItem(storageKey(poc), '{bad');
    render(<DashboardPage catalog={testCatalog} />);
    expect(screen.getByText('Cobertura parcial')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: /Gráfico de evolução/ })).toBeInTheDocument();
    expect(localStorage.getItem(storageKey(poc))).toBe('{bad');
  });
  it('filtros combináveis, aria-pressed, disciplina, recorte vazio e limpar preservam Panorama', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    seed();
    const user = userEvent.setup();
    render(<DashboardPage catalog={testCatalog} />);
    const overview = screen.getByRole('region', { name: 'Panorama geral' }).textContent;
    const url = window.location.href;
    await user.click(screen.getByRole('button', { name: 'Últimos 7 dias' }));
    expect(screen.getByRole('button', { name: 'Últimos 7 dias' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Estudo' }));
    expect(screen.getByRole('button', { name: 'Estudo' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByLabelText('Resultado selecionado')).toHaveTextContent('Modo Estudo');
    await user.selectOptions(screen.getByLabelText('Disciplina'), 'Farmacologia');
    expect(
      screen.getByText('Nenhum resultado com nota automática neste recorte.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Panorama geral' }).textContent).toBe(overview);
    expect(window.location.href).toBe(url);
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(screen.queryByRole('button', { name: 'Limpar filtros' })).not.toBeInTheDocument();
    expect(screen.getByLabelText('Disciplina')).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Todos' })).toHaveAttribute('aria-pressed', 'true');
  });
  it('abrir, filtrar, selecionar, focar e abrir dados são zero-write em ambos os storages e sem fetch', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(now);
    seed();
    const before = { local: { ...localStorage }, session: { ...sessionStorage } };
    const set = vi.spyOn(Storage.prototype, 'setItem'),
      remove = vi.spyOn(Storage.prototype, 'removeItem');
    const fetch = vi.fn();
    vi.stubGlobal('fetch', fetch);
    const user = userEvent.setup();
    render(<DashboardPage catalog={testCatalog} />);
    await user.click(screen.getByRole('button', { name: 'Últimos 30 dias' }));
    await user.click(screen.getByRole('button', { name: 'Estudo' }));
    await user.selectOptions(screen.getByLabelText('Disciplina'), poc.subject);
    const control = document.querySelector<HTMLButtonElement>('.performance-point[tabindex="0"]')!;
    act(() => control.focus());
    await user.keyboard('{ArrowLeft}');
    await user.click(control);
    await user.click(screen.getByText('Ver dados do gráfico'));
    await user.click(screen.getByRole('button', { name: /^Filtrar Fisiologia/ }));
    await user.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect({ local: { ...localStorage }, session: { ...sessionStorage } }).toEqual(before);
    vi.unstubAllGlobals();
  });
  it('pageshow e storage oficiais atualizam; domínios pessoais não geram refresh', () => {
    render(<DashboardPage catalog={testCatalog} />);
    seed(1);
    fireEvent(window, new Event('pageshow'));
    expect(screen.getByLabelText('Resultado selecionado').querySelectorAll('option')).toHaveLength(
      1,
    );
    seed(2);
    fireEvent(
      window,
      new StorageEvent('storage', { key: historyStorageKey(poc), storageArea: sessionStorage }),
    );
    expect(screen.getByLabelText('Resultado selecionado').querySelectorAll('option')).toHaveLength(
      1,
    );
    fireEvent(window, new StorageEvent('storage', { key: `${storageKey(poc)}:annotations` }));
    expect(screen.getByLabelText('Resultado selecionado').querySelectorAll('option')).toHaveLength(
      1,
    );
    fireEvent(window, new StorageEvent('storage', { key: historyStorageKey(poc) }));
    expect(screen.getByLabelText('Resultado selecionado').querySelectorAll('option')).toHaveLength(
      2,
    );
  });
  it('bar de disciplina aplica filtro em memória via teclado', async () => {
    seed(1);
    const user = userEvent.setup();
    render(<DashboardPage catalog={testCatalog} />);
    const bar = screen.getByRole('button', { name: /^Filtrar Fisiologia/ });
    act(() => bar.focus());
    await user.keyboard('{Enter}');
    expect(screen.getByLabelText('Disciplina')).toHaveValue(poc.subject);
  });
});
describe('representações acessíveis dos gráficos', () => {
  it('um ponto e pontos empatados renderizam sem divisão por zero; tooltip equivalente a focus/hover', async () => {
    const series = performanceSeries([point('0')]);
    render(<PerformanceTrendChart series={series} />);
    const control = screen.getByRole('button', { name: /Prova 0 · Fisiologia/ });
    expect(control.style.left).toBe('50%');
    expect(control.style.top).toBe('20%');
    fireEvent.mouseEnter(control);
    act(() => control.focus());
    expect(screen.getByRole('status')).toHaveTextContent('Prova 0');
    expect(screen.getByRole('status')).toHaveTextContent('80% · Modo Prova');
    expect(screen.getByRole('status').querySelector('time')).toHaveAttribute(
      'dateTime',
      series[0]!.attempt.completedAt,
    );
    await userEvent.setup().click(screen.getByText('Ver dados do gráfico'));
    expect(screen.getByRole('table')).toHaveTextContent('Prova 0');
  });
  it('centenas de pontos: todos os resultados na tabela e seleção nativa; setas com foco', async () => {
    const input = Array.from({ length: 380 }, (_, i) =>
      point(String(i), i % 101, i % 2 ? 'study' : 'exam'),
    );
    render(<PerformanceTrendChart series={performanceSeries(input)} />);
    expect(document.querySelectorAll('.performance-point')).toHaveLength(380);
    expect(document.querySelectorAll('.performance-point[tabindex="0"]')).toHaveLength(1);
    expect(screen.getByLabelText('Resultado selecionado').querySelectorAll('option')).toHaveLength(
      380,
    );
    const user = userEvent.setup();
    act(() =>
      document.querySelector<HTMLButtonElement>('.performance-point[tabindex="0"]')!.focus(),
    );
    await user.keyboard('{Home}');
    expect(document.querySelectorAll('.performance-point')[0]).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(document.querySelectorAll('.performance-point')[1]).toHaveFocus();
    await user.keyboard('{End}');
    expect(document.querySelectorAll('.performance-point')[379]).toHaveFocus();
    await user.click(screen.getByText('Ver dados do gráfico'));
    expect(screen.getAllByRole('row')).toHaveLength(381);
    expect(document.querySelector('.moving-average')).toBeInTheDocument();
  });
  it('vazio, null e pouca amostra não inventam nota ou tendência', () => {
    const analysis = analyzePerformance([point('0', null, 'study')], defaultAnalyticsFilters, now);
    render(
      <>
        <PerformanceTrendChart series={analysis.series} />
        <SubjectPerformanceChart subjects={analysis.subjects} onSelect={vi.fn()} />
        <StudyRhythmChart buckets={analysis.buckets} period="all" />
        <PerformanceInsights insights={analysis.insights} />
      </>,
    );
    expect(screen.getByRole('button', { name: /sem nota automática/ })).toHaveTextContent('—');
    expect(screen.getByText(/amostra pequena/)).toBeInTheDocument();
    expect(screen.getByText('0 Prova · 1 Estudo')).toBeInTheDocument();
    expect(screen.getByText('Dados insuficientes para avaliar tendência')).toBeInTheDocument();
    expect(document.querySelector('.subject-bar-label strong:last-child')).toHaveTextContent('—');
    expect(document.querySelectorAll('.performance-point')).toHaveLength(0);
  });
  it('texto grande mantém controles nativos e tabela textual completa', () => {
    document.documentElement.dataset.textSize = 'large';
    render(
      <PerformanceTrendChart series={performanceSeries([point('1'), point('2', 90, 'study')])} />,
    );
    expect(screen.getByLabelText('Resultado selecionado')).toBeInTheDocument();
    expect(screen.getByText('Ver dados do gráfico')).toBeInTheDocument();
  });
});
describe('Backup e Dados/histórico: refinamento visual com ações preservadas', () => {
  it('duas áreas de backup mantêm download e file input/limite/zero upload', () => {
    render(<BackupControls catalog={testCatalog} />);
    expect(screen.getByRole('heading', { name: 'Guardar uma cópia' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Restaurar uma cópia' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar progresso' })).toBeEnabled();
    expect(screen.getByLabelText('Importar progresso')).toHaveAttribute('type', 'file');
    expect(screen.getByText(/JSON local · até 10 MiB/)).toHaveTextContent('zero upload');
  });
  it('indicadores e zona de cuidado; confirmação e cancelamento não escrevem e exigem ZERAR exato', async () => {
    seed(1);
    const onReset = vi.fn();
    const user = userEvent.setup();
    const set = vi.spyOn(Storage.prototype, 'setItem'),
      remove = vi.spyOn(Storage.prototype, 'removeItem');
    render(
      <HistoryResetControls
        catalog={{ schemaVersion: 1, exams: [catalogExam] }}
        onReset={onReset}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Zona de cuidado' })).toBeInTheDocument();
    expect(screen.getByText('Conclusões registradas')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Zerar histórico e estatísticas' }));
    const region = screen.getByRole('region', { name: 'Confirmar remoção do histórico' });
    expect(within(region).getByRole('heading')).toHaveFocus();
    const confirm = within(region).getByRole('button', { name: 'Confirmar reset do histórico' });
    expect(confirm).toBeDisabled();
    await user.type(screen.getByLabelText('Digite ZERAR para confirmar'), 'zerar');
    expect(confirm).toBeDisabled();
    await user.clear(screen.getByLabelText('Digite ZERAR para confirmar'));
    await user.type(screen.getByLabelText('Digite ZERAR para confirmar'), 'ZERAR');
    expect(confirm).toBeEnabled();
    await user.click(screen.getByRole('button', { name: 'Cancelar reset' }));
    expect(screen.getByRole('button', { name: 'Zerar histórico e estatísticas' })).toHaveFocus();
    expect(onReset).not.toHaveBeenCalled();
    expect(set).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();
  });
});
