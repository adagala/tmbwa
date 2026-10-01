import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

root.render(<div className="min-h-screen bg-gray-50 dark:bg-gray-950" />);

void import('./Application').then(({ default: Application }) => {
  root.render(
    <React.StrictMode>
      <Application />
    </React.StrictMode>,
  );
});
