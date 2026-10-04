import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyInitialTheme } from './theme';
import '../styles/tokens.css';
import '../styles/global.css';
import '../styles/components.css';
applyInitialTheme();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
