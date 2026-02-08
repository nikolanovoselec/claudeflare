import { Component, Switch, Match, createSignal, onMount, Show } from 'solid-js';
import { setupStore } from '../../stores/setup';
import { getSetupStatus, getUser } from '../../api/client';
import WelcomeStep from './WelcomeStep';
import ConfigureStep from './ConfigureStep';
import ProgressStep from './ProgressStep';
import '../../styles/setup-wizard.css';

type AuthState = 'loading' | 'authorized' | 'denied';

const SetupWizard: Component = () => {
  const [authState, setAuthState] = createSignal<AuthState>('loading');

  onMount(async () => {
    try {
      const status = await getSetupStatus();
      if (!status.configured) {
        // First-time setup: allow public access
        setAuthState('authorized');
        return;
      }
      // Already configured: check if current user is admin
      const user = await getUser();
      if (user.role === 'admin') {
        setAuthState('authorized');
      } else {
        setAuthState('denied');
      }
    } catch {
      // If we can't determine status, deny access (safe default)
      setAuthState('denied');
    }
  });

  const handleReturn = () => {
    window.location.href = '/';
  };

  return (
    <div class="setup-wizard">
      <Show when={authState() === 'loading'}>
        <div class="setup-container">
          <div class="setup-header">
            <div class="setup-logo">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <rect width="48" height="48" rx="12" fill="var(--color-accent)" />
                <path
                  d="M24 12L32 18V30L24 36L16 30V18L24 12Z"
                  stroke="white"
                  stroke-width="2"
                  fill="none"
                />
                <circle cx="24" cy="24" r="4" fill="white" />
              </svg>
            </div>
            <h1 class="setup-title">Loading...</h1>
          </div>
        </div>
      </Show>

      <Show when={authState() === 'denied'}>
        <div class="setup-container">
          <div class="setup-header">
            <div class="setup-logo">
              <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
                <rect width="48" height="48" rx="12" fill="var(--color-error, #ef4444)" />
                <path
                  d="M24 14L24 28"
                  stroke="white"
                  stroke-width="3"
                  stroke-linecap="round"
                />
                <circle cx="24" cy="34" r="2" fill="white" />
              </svg>
            </div>
            <h1 class="setup-title">Access Denied</h1>
          </div>
          <div class="setup-content">
            <p class="denied-message">
              Only administrators can access the setup wizard.
            </p>
            <button class="denied-button" onClick={handleReturn}>
              Return to Dashboard
            </button>
          </div>
        </div>
      </Show>

      <Show when={authState() === 'authorized'}>
      <div class="setup-container">
        <div class="setup-header">
          <div class="setup-logo">
            <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
              <rect width="48" height="48" rx="12" fill="var(--color-accent)" />
              <path
                d="M24 12L32 18V30L24 36L16 30V18L24 12Z"
                stroke="white"
                stroke-width="2"
                fill="none"
              />
              <circle cx="24" cy="24" r="4" fill="white" />
            </svg>
          </div>
          <h1 class="setup-title">Claudeflare Setup</h1>
        </div>

        <div class="progress-bar setup-progress">
          <div
            class="progress-bar-fill"
            style={{ width: `${(setupStore.step / 3) * 100}%` }}
          />
        </div>

        <div class="setup-content">
          <Switch>
            <Match when={setupStore.step === 1}>
              <WelcomeStep />
            </Match>
            <Match when={setupStore.step === 2}>
              <ConfigureStep />
            </Match>
            <Match when={setupStore.step === 3}>
              <ProgressStep />
            </Match>
          </Switch>
        </div>
      </div>
      </Show>

    </div>
  );
};

export default SetupWizard;
