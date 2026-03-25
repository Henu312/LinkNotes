import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/app.css';

window.addEventListener('error', (event) => {
  if (event.message === 'ResizeObserver loop completed with undelivered notifications.') {
    event.preventDefault();
  }
});

const container = document.getElementById('root');

if (!container) {
  throw new Error('找不到根节点');
}

createRoot(container).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
