import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import '@xyflow/react/dist/style.css';
import './styles.css';

const root = document.getElementById('root');
if (!root) {
  throw new Error('Mermaid Workbench could not find its application root.');
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
