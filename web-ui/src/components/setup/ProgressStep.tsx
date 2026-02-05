import { Component, Show, For, onMount, createSignal } from 'solid-js';
import {
  mdiCog,
  mdiAlertCircle,
  mdiCheckCircle,
  mdiCheckCircleOutline,
  mdiCircleOutline,
  mdiLoading,
  mdiRocketLaunchOutline,
  mdiMapMarkerOutline,
  mdiShieldLockOutline,
  mdiKeyOutline,
  mdiInformationOutline,
} from '@mdi/js';
import Icon from '../Icon';
import { setupStore } from '../../stores/setup';

const ProgressStep: Component = () => {
  const [configStarted, setConfigStarted] = createSignal(false);

  onMount(async () => {
    if (!configStarted()) {
      setConfigStarted(true);
      await setupStore.configure();
    }
  });

  const stepLabels: Record<string, string> = {
    get_account: 'Verifying account',
    create_r2_token: 'Deriving R2 credentials',
    set_secrets: 'Setting worker secrets',
    configure_custom_domain: 'Configuring custom domain',
    create_access_app: 'Creating Access application',
    finalize: 'Finalizing setup',
  };

  const getStepLabel = (step: string) => stepLabels[step] || step;

  const getStepIcon = (status: string) => {
    switch (status) {
      case 'success':
        return mdiCheckCircle;
      case 'error':
        return mdiAlertCircle;
      case 'pending':
        return mdiCircleOutline;
      default:
        return mdiLoading;
    }
  };

  const handleLaunch = () => {
    // If custom domain, redirect there (will trigger CF Access login)
    if (setupStore.customDomainUrl) {
      window.location.href = setupStore.customDomainUrl;
    } else {
      // Otherwise just reload (setup is complete, will show main app)
      window.location.reload();
    }
  };

  const handleRetry = () => {
    setupStore.configure();
  };

  return (
    <div class="progress-step">
      <Show
        when={setupStore.setupComplete}
        fallback={
          <>
            <h2 class="progress-title">
              {setupStore.configureError ? (
                <>
                  <Icon path={mdiAlertCircle} size={24} class="title-icon title-icon--error" />
                  Setup Failed
                </>
              ) : (
                <>
                  <Icon path={mdiCog} size={24} class="title-icon title-icon--spin" />
                  Configuring Claudeflare
                </>
              )}
            </h2>

            <div class="progress-steps">
              <For each={setupStore.configureSteps}>
                {(step) => (
                  <div class={`progress-step-item ${step.status}`}>
                    <span class={`step-icon ${step.status === 'running' ? 'step-icon--spin' : ''}`}>
                      <Icon path={getStepIcon(step.status)} size={18} />
                    </span>
                    <span class="step-label">{getStepLabel(step.step)}</span>
                    <Show when={step.error}>
                      <span class="step-error">{step.error}</span>
                    </Show>
                  </div>
                )}
              </For>
            </div>

            <Show when={setupStore.configuring}>
              <div class="progress-bar-container">
                <div
                  class="progress-bar"
                  style={{
                    width: `${
                      (setupStore.configureSteps.filter((s) => s.status === 'success')
                        .length /
                        Math.max(setupStore.configureSteps.length, 4)) *
                      100
                    }%`,
                  }}
                />
              </div>
            </Show>

            <Show when={setupStore.configureError}>
              <div class="error-message">
                <strong>Error:</strong> {setupStore.configureError}
              </div>
              <div class="progress-actions">
                <button
                  class="progress-button secondary"
                  onClick={() => setupStore.prevStep()}
                >
                  ← Back
                </button>
                <button class="progress-button primary" onClick={handleRetry}>
                  Retry
                </button>
              </div>
            </Show>
          </>
        }
      >
        <h2 class="progress-title">
          <Icon path={mdiCheckCircleOutline} size={24} class="title-icon title-icon--success" />
          Setup Complete!
        </h2>

        <div class="success-section">
          <p class="success-message">Your Claudeflare instance is ready:</p>

          <div class="url-list">
            <div class="url-item">
              <span class="url-icon">
                <Icon path={mdiMapMarkerOutline} size={20} />
              </span>
              <div class="url-content">
                <span class="url-label">workers.dev (unprotected):</span>
                <a href={setupStore.workersDevUrl || ''} class="url-value">
                  {setupStore.workersDevUrl}
                </a>
              </div>
            </div>

            <Show when={setupStore.customDomainUrl}>
              <div class="url-item">
                <span class="url-icon">
                  <Icon path={mdiShieldLockOutline} size={20} />
                </span>
                <div class="url-content">
                  <span class="url-label">Custom domain (with Access):</span>
                  <a href={setupStore.customDomainUrl || ''} class="url-value">
                    {setupStore.customDomainUrl}
                  </a>
                  <span class="url-note">Protected by Cloudflare Access</span>
                </div>
              </div>
            </Show>
          </div>

          <Show when={setupStore.adminSecret}>
            <div class="admin-secret-section">
              <span class="secret-label">
                <Icon path={mdiKeyOutline} size={16} class="secret-icon" />
                Admin Secret (save this!):
              </span>
              <code class="secret-value">{setupStore.adminSecret}</code>
              <span class="secret-note">
                Used for admin endpoints. Store securely.
              </span>
            </div>
          </Show>

          <div class="cicd-section">
            <h3 class="cicd-title">
              <Icon path={mdiCog} size={18} class="cicd-icon" />
              Enable Continuous Deployment
            </h3>
            <p class="cicd-description">
              To enable automatic deploys with container support, add these
              GitHub Actions secrets to your forked repository:
            </p>
            <div class="cicd-steps">
              <div class="cicd-step">
                <span class="cicd-step-number">1</span>
                <div class="cicd-step-content">
                  <span class="cicd-step-label">Go to your repo Settings → Secrets and variables → Actions</span>
                </div>
              </div>
              <div class="cicd-step">
                <span class="cicd-step-number">2</span>
                <div class="cicd-step-content">
                  <span class="cicd-step-label">Add repository secrets:</span>
                  <div class="cicd-secrets">
                    <div class="cicd-secret">
                      <code class="cicd-secret-name">CLOUDFLARE_API_TOKEN</code>
                      <span class="cicd-secret-hint">Use the same token you entered in step 2</span>
                    </div>
                    <Show when={setupStore.accountId}>
                      <div class="cicd-secret">
                        <code class="cicd-secret-name">CLOUDFLARE_ACCOUNT_ID</code>
                        <code class="cicd-secret-value">{setupStore.accountId}</code>
                      </div>
                    </Show>
                  </div>
                </div>
              </div>
              <div class="cicd-step">
                <span class="cicd-step-number">3</span>
                <div class="cicd-step-content">
                  <span class="cicd-step-label">Add a repository variable (Settings → Secrets and variables → Actions → Variables tab):</span>
                  <div class="cicd-secrets">
                    <div class="cicd-secret">
                      <code class="cicd-secret-name">CLOUDFLARE_WORKER_NAME</code>
                      <span class="cicd-secret-hint">The worker name you chose during deployment (e.g., claudeflare)</span>
                    </div>
                  </div>
                </div>
              </div>
              <div class="cicd-step">
                <span class="cicd-step-number">4</span>
                <div class="cicd-step-content">
                  <span class="cicd-step-label">Push a change or go to Actions → Deploy → Run workflow</span>
                </div>
              </div>
            </div>
            <p class="cicd-note">
              <Icon path={mdiInformationOutline} size={14} class="note-icon" />
              GitHub Actions builds the container image (requires Docker, which Workers Builds doesn't provide).
            </p>
          </div>

          <button class="launch-button" onClick={handleLaunch}>
            <Icon path={mdiRocketLaunchOutline} size={20} />
            Launch Claudeflare
          </button>

          <Show when={setupStore.customDomainUrl}>
            <p class="launch-note">
              <Icon path={mdiInformationOutline} size={14} class="note-icon" />
              You'll be redirected to Cloudflare Access login
            </p>
          </Show>
        </div>
      </Show>

      <style>{`
        .progress-step {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .progress-title {
          margin: 0;
          font-size: 24px;
          font-weight: 600;
          color: var(--color-text-primary);
          text-align: center;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
        }

        .title-icon {
          flex-shrink: 0;
        }

        .title-icon--spin {
          animation: spin 2s linear infinite;
          color: var(--color-accent);
        }

        .title-icon--error {
          color: var(--color-error);
        }

        .title-icon--success {
          color: var(--color-success);
        }

        @keyframes spin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }

        .progress-steps {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .progress-step-item {
          display: flex;
          align-items: center;
          gap: 12px;
          padding: 12px 16px;
          background: var(--color-bg-tertiary);
          border-radius: 8px;
          transition: all 0.3s ease;
        }

        .progress-step-item.success {
          background: rgba(34, 197, 94, 0.1);
        }

        .progress-step-item.error {
          background: rgba(239, 68, 68, 0.1);
        }

        .step-icon {
          width: 24px;
          height: 24px;
          display: flex;
          align-items: center;
          justify-content: center;
        }

        .step-icon--spin {
          animation: spin 1s linear infinite;
        }

        .progress-step-item.success .step-icon {
          color: var(--color-success);
        }

        .progress-step-item.error .step-icon {
          color: var(--color-error);
        }

        .progress-step-item.pending .step-icon {
          color: var(--color-text-tertiary);
        }

        .step-label {
          flex: 1;
          font-size: 14px;
          color: var(--color-text-primary);
        }

        .step-error {
          font-size: 12px;
          color: var(--color-error);
        }

        .progress-bar-container {
          height: 8px;
          background: var(--color-bg-tertiary);
          border-radius: 4px;
          overflow: hidden;
        }

        .progress-bar {
          height: 100%;
          background: var(--color-accent);
          transition: width 0.5s ease;
        }

        .error-message {
          padding: 12px 16px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 8px;
          font-size: 14px;
          color: var(--color-error);
        }

        .progress-actions {
          display: flex;
          justify-content: space-between;
          gap: 12px;
        }

        .progress-button {
          flex: 1;
          padding: 14px 24px;
          font-size: 14px;
          font-weight: 500;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .progress-button.primary {
          background: var(--color-accent);
          color: white;
        }

        .progress-button.primary:hover {
          background: var(--color-accent-hover);
        }

        .progress-button.secondary {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          border: 1px solid var(--color-border);
        }

        .progress-button.secondary:hover {
          background: var(--color-bg-primary);
        }

        .success-section {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .success-message {
          margin: 0;
          font-size: 16px;
          color: var(--color-text-secondary);
          text-align: center;
        }

        .url-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .url-item {
          display: flex;
          gap: 12px;
          padding: 16px;
          background: var(--color-bg-tertiary);
          border-radius: 8px;
        }

        .url-icon {
          display: flex;
          align-items: center;
          color: var(--color-text-secondary);
        }

        .url-content {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .url-label {
          font-size: 13px;
          color: var(--color-text-secondary);
        }

        .url-value {
          font-size: 14px;
          color: var(--color-accent);
          text-decoration: none;
          word-break: break-all;
        }

        .url-value:hover {
          text-decoration: underline;
        }

        .url-note {
          font-size: 12px;
          color: var(--color-success);
        }

        .admin-secret-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 16px;
          background: rgba(124, 58, 237, 0.1);
          border: 1px solid rgba(124, 58, 237, 0.2);
          border-radius: 8px;
        }

        .secret-label {
          font-size: 14px;
          font-weight: 500;
          color: var(--color-text-primary);
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .secret-icon {
          color: var(--color-accent);
        }

        .secret-value {
          padding: 8px 12px;
          background: var(--color-bg-primary);
          border-radius: 6px;
          font-size: 12px;
          color: var(--color-accent);
          word-break: break-all;
        }

        .secret-note {
          font-size: 12px;
          color: var(--color-text-secondary);
        }

        .launch-button {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 16px 32px;
          font-size: 16px;
          font-weight: 600;
          color: white;
          background: var(--color-accent);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .launch-button:hover {
          background: var(--color-accent-hover);
          transform: translateY(-1px);
        }

        .launch-note {
          margin: 0;
          font-size: 13px;
          color: var(--color-text-secondary);
          text-align: center;
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 4px;
        }

        .note-icon {
          flex-shrink: 0;
        }

        .cicd-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px;
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-border);
          border-radius: 8px;
        }

        .cicd-title {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
          color: var(--color-text-primary);
          display: flex;
          align-items: center;
          gap: 8px;
        }

        .cicd-icon {
          color: var(--color-text-secondary);
        }

        .cicd-description {
          margin: 0;
          font-size: 14px;
          color: var(--color-text-secondary);
        }

        .cicd-steps {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .cicd-step {
          display: flex;
          gap: 12px;
          align-items: flex-start;
        }

        .cicd-step-number {
          display: flex;
          align-items: center;
          justify-content: center;
          width: 24px;
          height: 24px;
          background: var(--color-accent);
          color: white;
          border-radius: 50%;
          font-size: 12px;
          font-weight: 600;
          flex-shrink: 0;
        }

        .cicd-step-content {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .cicd-step-label {
          font-size: 14px;
          color: var(--color-text-primary);
        }

        .cicd-secrets {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .cicd-secret {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
        }

        .cicd-secret-name {
          padding: 2px 8px;
          background: var(--color-bg-primary);
          border-radius: 4px;
          font-size: 13px;
          color: var(--color-accent);
        }

        .cicd-secret-value {
          padding: 2px 8px;
          background: var(--color-bg-primary);
          border-radius: 4px;
          font-size: 12px;
          color: var(--color-text-secondary);
          word-break: break-all;
        }

        .cicd-secret-hint {
          font-size: 12px;
          color: var(--color-text-tertiary);
        }

        .cicd-note {
          margin: 0;
          font-size: 13px;
          color: var(--color-text-secondary);
          display: flex;
          align-items: center;
          gap: 4px;
        }
      `}</style>
    </div>
  );
};

export default ProgressStep;
