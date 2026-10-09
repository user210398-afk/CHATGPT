import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { applyInitialPreferences } from '../engine/ui-preferences';
import { registerPwaWorker } from '../pwa/register';
import '../styles/tokens.css';
import '../styles/global.css';
import '../styles/components.css';
applyInitialPreferences();
if (import.meta.env.PROD) void registerPwaWorker();
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
