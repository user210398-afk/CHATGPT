import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyInitialPreferences } from '../engine/ui-preferences';
import '../styles/tokens.css';
import '../styles/global.css';
import '../styles/components.css';
applyInitialPreferences();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
