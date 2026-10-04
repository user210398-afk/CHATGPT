import { afterEach, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExamPage } from '../src/components/exam/ExamPage';
import { RichContent } from '../src/components/common/RichContent';
import { App } from '../src/app/App';
import { poc } from './fixtures';

afterEach(() => {
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});
it('renderiza e conclui a POC real, restaura dissertativa e exibe modelos somente na revisão', async () => {
  const user = userEvent.setup();
  const first = render(<ExamPage exam={poc} />);
  expect(screen.getByRole('heading', { name: 'Questão 1 de 30' })).toBeInTheDocument();
  const answerB = screen.getByRole('radio', { name: /b\) Substância química/ });
  await user.click(answerB);
  expect(answerB).toBeChecked();
  await user.click(screen.getByRole('radio', { name: /a\) Molécula/ }));
  expect(answerB).not.toBeChecked();
  await user.click(screen.getByRole('button', { name: '⚑ Marcar para revisão' }));
  await user.click(screen.getByRole('button', { name: 'Próxima →' }));
  await user.click(screen.getByRole('button', { name: '← Anterior' }));
  expect(screen.getByRole('radio', { name: /a\) Molécula/ })).toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Ir para questão 21' }));
  await user.type(screen.getByRole('textbox', { name: 'Sua resposta' }), 'Resposta para revisar.');
  expect(screen.queryByText('Resposta-modelo')).not.toBeInTheDocument();
  first.unmount();
  render(<ExamPage exam={poc} />);
  expect(screen.getByRole('heading', { name: 'Questão 21 de 30' })).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveValue('Resposta para revisar.');
  expect(screen.getByText(/Tentativa restaurada/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Finalizar tentativa' }));
  expect(screen.getByText(/28 questão\(ões\) sem resposta/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Confirmar finalização' }));
  expect(screen.getByRole('heading', { name: 'Seu resultado' })).toBeInTheDocument();
  expect(screen.getByText(/1 de 10 dissertativas respondidas/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Revisar respostas' }));
  expect(screen.getByRole('heading', { name: 'Resposta-modelo' })).toBeInTheDocument();
  expect(screen.getByRole('textbox')).toHaveAttribute('readonly');
  await user.click(
    screen.getByRole('button', { name: 'Ir para questão 1, respondida, marcada para revisão' }),
  );
  expect(screen.getByText('Resposta correta')).toBeInTheDocument();
  expect(screen.getAllByRole('radio')[0]).toBeDisabled();
});
it('carrega o catálogo, filtra por texto sem acentos e salva tema', async () => {
  const user = userEvent.setup();
  const catalog = {
    schemaVersion: 1,
    exams: [
      {
        id: poc.id,
        revision: 1,
        title: poc.title,
        subject: poc.subject,
        year: poc.year,
        division: poc.division,
        description: '',
        tags: poc.tags,
        questionCount: 30,
        objectiveCount: 20,
        essayCount: 10,
      },
    ],
  };
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(catalog)));
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  const link = await screen.findByRole('link', { name: /Abrir prova/ });
  expect(link).toHaveAttribute('href', `/CHATGPT/?exam=${poc.id}`);
  await user.type(screen.getByRole('searchbox'), 'hipofise');
  expect(link).toBeInTheDocument();
  await user.clear(screen.getByRole('searchbox'));
  await user.type(screen.getByRole('searchbox'), 'inexistente');
  expect(screen.getByRole('status')).toHaveTextContent('Nenhuma prova encontrada');
  await user.click(screen.getByRole('button', { name: /Tema escuro/ }));
  expect(document.documentElement.dataset.theme).toBe('dark');
  expect(localStorage.getItem('chatgpt-exams:preferences:v1')).toContain('dark');
});
it('realiza loader → estado → renderer sem HTML legado pela URL da aplicação', async () => {
  window.history.replaceState({}, '', `/CHATGPT/?exam=${poc.id}`);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify(poc)));
  vi.stubGlobal('fetch', fetcher);
  render(<App />);
  expect(await screen.findByRole('heading', { name: 'Questão 1 de 30' })).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]![0]).toBe(`/CHATGPT/generated/exams/${poc.id}.json`);
  expect(document.querySelector('iframe')).toBeNull();
});
it('renderiza texto com sintaxe HTML como texto, não como código', () => {
  render(<RichContent content={[{ type: 'text', text: '<img src=x onerror=alert(1)>' }]} />);
  expect(screen.getByText('<img src=x onerror=alert(1)>')).toBeInTheDocument();
  expect(document.querySelector('img')).toBeNull();
});
