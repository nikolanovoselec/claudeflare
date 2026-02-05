import { Component, Show, Switch, Match } from 'solid-js';
import { setupStore } from '../../stores/setup';
import WelcomeStep from './WelcomeStep';
import TokenStep from './TokenStep';
import DomainStep from './DomainStep';
import ProgressStep from './ProgressStep';

const SetupWizard: Component = () => {
  return (
    <div class="setup-wizard">
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
            style={{ width: `${(setupStore.step / 4) * 100}%` }}
          />
        </div>

        <div class="setup-content">
          <Switch>
            <Match when={setupStore.step === 1}>
              <WelcomeStep />
            </Match>
            <Match when={setupStore.step === 2}>
              <TokenStep />
            </Match>
            <Match when={setupStore.step === 3}>
              <DomainStep />
            </Match>
            <Match when={setupStore.step === 4}>
              <ProgressStep />
            </Match>
          </Switch>
        </div>
      </div>

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
      `}</style>
    </div>
  );
};

export default SetupWizard;
