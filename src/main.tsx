import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Provider } from 'react-redux';
import { App } from './App';
import { AuthGate } from './auth/AuthGate';
import { entities } from './registry';
import { createAppStore } from './store/store';
import './styles.css';

const store = createAppStore(
  Object.fromEntries(entities.map(entity => [entity.id, entity.adapter]))
);
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Provider store={store}>
      <AuthGate>
        <App />
      </AuthGate>
    </Provider>
  </StrictMode>
);
