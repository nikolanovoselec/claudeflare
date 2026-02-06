import { Component, Show, onMount } from 'solid-js';
import {
  mdiCheckCircleOutline,
  mdiAlertCircleOutline,
  mdiLoading,
} from '@mdi/js';
import Icon from '../Icon';
import { setupStore } from '../../stores/setup';
import Button from '../ui/Button';

const WelcomeStep: Component = () => {
  onMount(() => {
    setupStore.detectToken();
  });

  return (
    <div class="welcome-step">
      <h2 class="welcome-title">Welcome to Claudeflare</h2>
      <p class="welcome-description">
        Let's configure your personal Claude Code environment.
      </p>

      <div class="token-detect-section">
        {/* Detecting state */}
        <Show when={setupStore.tokenDetecting}>
          <div class="token-status token-status--detecting">
            <span class="token-status-icon token-status-icon--spin">
              <Icon path={mdiLoading} size={24} />
            </span>
            <div class="token-status-text">
              <strong>Detecting API token...</strong>
              <span>Checking for a pre-configured Cloudflare API token</span>
            </div>
          </div>
        </Show>

        {/* Detected + valid */}
        <Show when={!setupStore.tokenDetecting && setupStore.tokenDetected && setupStore.accountInfo}>
          <div class="token-status token-status--success">
            <span class="token-status-icon">
              <Icon path={mdiCheckCircleOutline} size={24} />
            </span>
            <div class="token-status-text">
              <strong>API Token Detected</strong>
              <span>
                Account: {setupStore.accountInfo!.name} ({setupStore.accountInfo!.id})
              </span>
            </div>
          </div>

          <Button onClick={() => setupStore.nextStep()}>
            Get Started
          </Button>
        </Show>

        {/* Detected but invalid / error */}
        <Show when={!setupStore.tokenDetecting && setupStore.tokenDetectError}>
          <div class="token-status token-status--error">
            <span class="token-status-icon">
              <Icon path={mdiAlertCircleOutline} size={24} />
            </span>
            <div class="token-status-text">
              <strong>Token Error</strong>
              <span>{setupStore.tokenDetectError}</span>
            </div>
          </div>

          <div class="token-error-help">
            <p>
              The API token could not be verified. This usually means you need to
              re-deploy with a valid <code>CLOUDFLARE_API_TOKEN</code> secret set
              via GitHub Actions.
            </p>
          </div>
        </Show>

        {/* Not detected at all */}
        <Show when={!setupStore.tokenDetecting && !setupStore.tokenDetected && !setupStore.tokenDetectError}>
          <div class="token-status token-status--error">
            <span class="token-status-icon">
              <Icon path={mdiAlertCircleOutline} size={24} />
            </span>
            <div class="token-status-text">
              <strong>No Token Found</strong>
              <span>
                Deploy via GitHub Actions first with a <code>CLOUDFLARE_API_TOKEN</code> secret
                to set up the API token automatically.
              </span>
            </div>
          </div>
        </Show>
      </div>

      <style>{`
        .welcome-step {
          display: flex;
          flex-direction: column;
          gap: 24px;
          align-items: center;
        }

        .welcome-title {
          margin: 0;
          font-size: 28px;
          font-weight: 600;
          color: var(--color-text-primary);
          text-align: center;
        }

        .welcome-description {
          margin: 0;
          font-size: 16px;
          color: var(--color-text-secondary);
          text-align: center;
          line-height: 1.6;
        }

        .token-detect-section {
          width: 100%;
          display: flex;
          flex-direction: column;
          gap: 16px;
          align-items: center;
        }

        .token-status {
          width: 100%;
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 16px;
          border-radius: 12px;
        }

        .token-status--detecting {
          background: var(--color-bg-tertiary);
          color: var(--color-text-secondary);
        }

        .token-status--success {
          background: rgba(34, 197, 94, 0.1);
          border: 1px solid rgba(34, 197, 94, 0.2);
        }

        .token-status--error {
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
        }

        .token-status-icon {
          display: flex;
          align-items: center;
          flex-shrink: 0;
        }

        .token-status--detecting .token-status-icon {
          color: var(--color-accent);
        }

        .token-status--success .token-status-icon {
          color: var(--color-success);
        }

        .token-status--error .token-status-icon {
          color: var(--color-error);
        }

        .token-status-icon--spin {
          animation: spin 1s linear infinite;
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .token-status-text {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .token-status-text strong {
          font-size: 15px;
          color: var(--color-text-primary);
        }

        .token-status-text span {
          font-size: 13px;
          color: var(--color-text-secondary);
        }

        .token-status-text code {
          padding: 2px 6px;
          background: var(--color-bg-primary);
          border-radius: 4px;
          font-size: 12px;
          color: var(--color-accent);
        }

        .token-error-help {
          width: 100%;
          padding: 12px 16px;
          background: var(--color-bg-tertiary);
          border-radius: 8px;
        }

        .token-error-help p {
          margin: 0;
          font-size: 13px;
          color: var(--color-text-secondary);
          line-height: 1.6;
        }

        .token-error-help code {
          padding: 2px 6px;
          background: var(--color-bg-primary);
          border-radius: 4px;
          font-size: 12px;
          color: var(--color-accent);
        }
      `}</style>
    </div>
  );
};

export default WelcomeStep;
