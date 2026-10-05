import { useEffect, useRef } from 'react';
import type { AttemptMode } from '../../engine/exam-state';
export function ModeChooser({ onStart }: { onStart: (mode: AttemptMode) => void }) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className="card" aria-labelledby="mode-title">
      <h2 id="mode-title" ref={heading} tabIndex={-1}>
        Como deseja fazer esta tentativa?
      </h2>
      <div className="settings-grid">
        <div>
          <h3>Modo Prova</h3>
          <p>Veja gabarito e explicações somente após finalizar.</p>
          <button className="primary" onClick={() => onStart('exam')}>
            Iniciar em Modo Prova
          </button>
        </div>
        <div>
          <h3>Modo Estudo</h3>
          <p>Confirme cada resposta e receba feedback imediatamente.</p>
          <button className="primary" onClick={() => onStart('study')}>
            Iniciar em Modo Estudo
          </button>
        </div>
      </div>
    </section>
  );
}
