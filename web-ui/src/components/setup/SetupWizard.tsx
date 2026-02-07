import { Component, Switch, Match, createSignal, onMount, Show } from 'solid-js';
import { setupStore } from '../../stores/setup';
import { getSetupStatus, getUser } from '../../api/client';
import WelcomeStep from './WelcomeStep';
import ConfigureStep from './ConfigureStep';
import ProgressStep from './ProgressStep';

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

      <style>{`
        .setup-wizard {
          min-height: 100vh;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 24px;
          background: var(--color-bg-primary);
        }

        .setup-container {
          width: 100%;
          max-width: 600px;
          background: var(--color-bg-secondary);
          border-radius: 16px;
          border: 1px solid var(--color-border);
          overflow: hidden;
        }

        .setup-header {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
          padding: 32px;
          background: linear-gradient(
            135deg,
            rgba(124, 58, 237, 0.1) 0%,
            rgba(124, 58, 237, 0.05) 100%
          );
          border-bottom: 1px solid var(--color-border);
        }

        .setup-logo {
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .setup-title {
          margin: 0;
          font-size: 24px;
          font-weight: 600;
          color: var(--color-text-primary);
        }

        /* Override progress bar border-radius for wizard */
        .setup-progress {
          border-radius: 0;
        }

        .setup-content {
          padding: 32px;
        }

        .denied-message {
          margin: 0 0 24px;
          font-size: 16px;
          color: var(--color-text-secondary);
          text-align: center;
        }

        .denied-button {
          display: block;
          width: 100%;
          padding: 14px 24px;
          font-size: 14px;
          font-weight: 500;
          color: white;
          background: var(--color-accent);
          border: none;
          border-radius: 8px;
          cursor: pointer;
          transition: background 0.2s ease;
        }

        .denied-button:hover {
          background: var(--color-accent-hover);
        }
      `}</style>
    </div>
  );
};

export default SetupWizard;
