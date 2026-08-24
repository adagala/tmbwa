import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';
import MaintenancePage from './sections/MaintenancePage';

const root = ReactDOM.createRoot(document.getElementById('root')!);

if (import.meta.env.VITE_MAINTENANCE === 'true') {
  root.render(
    <React.StrictMode>
      <MaintenancePage />
    </React.StrictMode>,
  );
} else {
  root.render(<div className="min-h-screen bg-gray-50 dark:bg-gray-950" />);

  void import('./Application').then(({ default: Application }) => {
    root.render(
      <React.StrictMode>
        <Application />
      </React.StrictMode>,
    );
  });
}
