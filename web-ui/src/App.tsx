import { Component, onMount, onCleanup, createSignal, Show, type JSX } from 'solid-js';
import { Router, Route, Navigate, useNavigate } from '@solidjs/router';
import Layout from './components/Layout';
import SetupWizard from './components/setup/SetupWizard';
import { getUser, getSetupStatus } from './api/client';
import { sessionStore } from './stores/session';
import { terminalStore } from './stores/terminal';
import './styles/app.css';

// Check setup status from API
async function checkSetupStatus(): Promise<boolean> {
  try {
    const status = await getSetupStatus();
    return status.configured;
  } catch (err) {
    console.error('Failed to check setup status:', err);
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
    } catch (err) {
      console.warn('Failed to get user info:', err);
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
  );
};

export default App;
