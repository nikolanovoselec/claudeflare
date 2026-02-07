import { Component, onMount, onCleanup, createSignal, Show, type JSX } from 'solid-js';
import { Router, Route, Navigate, useNavigate } from '@solidjs/router';
import Layout from './components/Layout';
import SetupWizard from './components/setup/SetupWizard';
import { getUser } from './api/client';
import { sessionStore } from './stores/session';
import { terminalStore } from './stores/terminal';

// Check setup status from API
async function checkSetupStatus(): Promise<boolean> {
  try {
    const res = await fetch('/api/setup/status');
    const data = await res.json();
    return data.configured === true;
  } catch (e) {
    console.error('Failed to check setup status:', e);
    // If status check fails, assume setup is needed
    return false;
  }
}

// Main app content after setup check
const AppContent: Component = () => {
  const [userName, setUserName] = createSignal<string | undefined>();
  const [userRole, setUserRole] = createSignal<'admin' | 'user' | undefined>();
  const [loading, setLoading] = createSignal(true);
  const [authError, setAuthError] = createSignal<string | null>(null);

  onMount(async () => {
    try {
      const user = await getUser();
      setUserName(user.email);
      setUserRole(user.role);
    } catch (e) {
      console.warn('Failed to get user info:', e);
      if (import.meta.env.DEV) {
        setUserName('dev@localhost');
        setUserRole('admin');
      } else {
        setAuthError('Authentication required. Please refresh the page.');
      }
    } finally {
      setLoading(false);
    }
  });

  onCleanup(() => {
    sessionStore.stopAllMetricsPolling();
    terminalStore.disposeAll();
  });

  return (
    <Show
      when={!loading()}
      fallback={
        <div class="app-loading">
          <div class="app-loading-spinner" />
          <span>Loading...</span>
        </div>
      }
    >
      <Show
        when={!authError()}
        fallback={
          <div class="app-auth-error">
            <h1>Authentication Error</h1>
            <p>{authError()}</p>
            <button onClick={() => window.location.reload()}>Retry</button>
          </div>
        }
      >
        <Layout userName={userName()} userRole={userRole()} />
      </Show>
    </Show>
  );
};

// Router wrapper that checks setup status
const SetupGuard: Component<{ children: JSX.Element }> = (props) => {
  const [setupRequired, setSetupRequired] = createSignal<boolean | null>(null);
  const navigate = useNavigate();

  onMount(async () => {
    const configured = await checkSetupStatus();
    setSetupRequired(!configured);

    // If setup is required and we're not on /setup, navigate there
    if (!configured && window.location.pathname !== '/setup') {
      navigate('/setup', { replace: true });
    }
  });

  return (
    <Show
      when={setupRequired() !== null}
      fallback={
        <div class="app-loading">
          <div class="app-loading-spinner" />
          <span>Checking setup status...</span>
        </div>
      }
    >
      <Show when={!setupRequired()} fallback={<Navigate href="/setup" />}>
        {props.children}
      </Show>
    </Show>
  );
};

const App: Component = () => {
  return (
    <>
      <Router>
        <Route path="/setup" component={SetupWizard} />
        <Route
          path="/*"
          component={() => (
            <SetupGuard>
              <AppContent />
            </SetupGuard>
          )}
        />
      </Router>

      <style>{`
        .app-loading {
          height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          color: var(--color-text-secondary);
          background: var(--color-bg-primary);
        }

        .app-loading-spinner {
          width: 32px;
          height: 32px;
          border: 3px solid var(--color-border);
          border-top-color: var(--color-accent);
          border-radius: 50%;
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          to {
            transform: rotate(360deg);
          }
        }

        .app-auth-error {
          height: 100vh;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          padding: 32px;
          text-align: center;
          background: var(--color-bg-primary);
        }

        .app-auth-error h1 {
          margin: 0;
          font-size: 24px;
          color: var(--color-error);
        }

        .app-auth-error p {
          margin: 0;
          color: var(--color-text-secondary);
        }

        .app-auth-error button {
          padding: 12px 24px;
          font-size: 14px;
          font-weight: 500;
          color: var(--color-bg-primary);
          background: var(--color-accent);
          border-radius: 6px;
          transition: background var(--transition-fast);
          cursor: pointer;
        }

        .app-auth-error button:hover {
          background: var(--color-accent-hover);
        }
      `}</style>
    </>
  );
};

export default App;
