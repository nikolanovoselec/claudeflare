import { Component, Show, createSignal } from 'solid-js';
import {
  mdiKeyOutline,
  mdiShieldLockOutline,
  mdiClipboardTextOutline,
  mdiCheck,
} from '@mdi/js';
import Icon from '../Icon';
import { setupStore } from '../../stores/setup';

const TokenStep: Component = () => {
  const [showDetails, setShowDetails] = createSignal(false);

  const handleVerify = async () => {
    const valid = await setupStore.verifyToken();
    if (valid) {
      setupStore.nextStep();
    }
  };

  const permissions = [
    {
      scope: 'Account',
      permission: 'Workers Scripts',
      level: 'Edit',
      why: 'Store R2 credentials and admin secret securely',
      usedFor: 'Setting worker environment secrets via API',
    },
    {
      scope: 'Account',
      permission: 'Workers R2 Storage',
      level: 'Edit',
      why: 'Each user gets their own storage bucket for data isolation',
      usedFor: 'Creating per-user R2 buckets on first login',
    },
    {
      scope: 'Account',
      permission: 'Workers KV Storage',
      level: 'Edit',
      why: 'Store setup state and configuration data',
      usedFor: 'KV namespace binding required by wrangler deploy',
    },
    {
      scope: 'Account',
      permission: 'Containers',
      level: 'Edit',
      why: 'Run persistent terminal sessions in containers',
      usedFor: 'Uploading container image via GitHub Actions deploy',
    },
  ];

  const optionalPermissions = [
    {
      scope: 'Account',
      permission: 'Access: Apps and Policies',
      level: 'Edit',
      why: 'Protect your instance with Cloudflare Access authentication',
      usedFor: 'Creating Access app for custom domain',
    },
    {
      scope: 'Zone',
      permission: 'Zone',
      level: 'Read',
      why: 'Look up the DNS zone for your custom domain',
      usedFor: 'Resolving zone ID from domain name via Cloudflare API',
    },
    {
      scope: 'Zone',
      permission: 'DNS',
      level: 'Edit',
      why: 'Create a DNS record pointing to the worker',
      usedFor: 'Creating CNAME record for custom domain to workers.dev',
    },
    {
      scope: 'Zone',
      permission: 'Workers Routes',
      level: 'Edit',
      why: 'Route traffic from your custom domain to the worker',
      usedFor: 'Creating a worker route for the custom domain pattern',
    },
  ];

  return (
    <div class="token-step">
      <h2 class="token-title">
        <Icon path={mdiKeyOutline} size={24} class="title-icon" />
        Create API Token
      </h2>

      <p class="token-description">
        Create a Cloudflare API token with the permissions below. The token is stored
        securely as a worker secret and only used for initial setup.
      </p>

      <div class="permissions-section">
        <div class="permissions-header">
          <span>Required Permissions</span>
          <button
            class="permissions-toggle"
            onClick={() => setShowDetails(!showDetails())}
          >
            {showDetails() ? 'Hide details ▲' : 'Show what each does ▼'}
          </button>
        </div>

        <div class="permissions-list">
          {permissions.map((p) => (
            <div class="permission-item" classList={{ expanded: showDetails() }}>
              <div class="permission-main">
                <span class="permission-scope">{p.scope}</span>
                <span class="permission-arrow">→</span>
                <span class="permission-name">{p.permission}</span>
                <span class="permission-arrow">→</span>
                <span class="permission-level">{p.level}</span>
              </div>
              <Show when={showDetails()}>
                <div class="permission-details">
                  <div class="permission-detail">
                    <strong>WHY:</strong> {p.why}
                  </div>
                  <div class="permission-detail">
                    <strong>USED FOR:</strong> {p.usedFor}
                  </div>
                </div>
              </Show>
            </div>
          ))}
        </div>
      </div>

      <div class="optional-permissions-section">
        <div class="optional-permissions-header">
          <span>For custom domain setup, also add:</span>
        </div>
        <div class="permissions-list">
          {optionalPermissions.map((p) => (
            <div class="permission-item" classList={{ expanded: showDetails() }}>
              <div class="permission-main">
                <span class="permission-scope">{p.scope}</span>
                <span class="permission-arrow">→</span>
                <span class="permission-name">{p.permission}</span>
                <span class="permission-arrow">→</span>
                <span class="permission-level">{p.level}</span>
              </div>
              <Show when={showDetails()}>
                <div class="permission-details">
                  <div class="permission-detail">
                    <strong>WHY:</strong> {p.why}
                  </div>
                  <div class="permission-detail">
                    <strong>USED FOR:</strong> {p.usedFor}
                  </div>
                </div>
              </Show>
            </div>
          ))}
        </div>
      </div>

      <div class="security-note">
        <span class="security-icon">
          <Icon path={mdiShieldLockOutline} size={18} />
        </span>
        <span>
          This token is stored as an encrypted worker secret and is only used for
          the operations described above.
        </span>
      </div>

      <a
        href="https://dash.cloudflare.com/profile/api-tokens"
        target="_blank"
        rel="noopener noreferrer"
        class="token-link"
      >
        <Icon path={mdiClipboardTextOutline} size={16} class="link-icon" />
        Open Cloudflare Token Creator
      </a>

      <div class="token-input-section">
        <label class="token-label">Paste your token:</label>
        <input
          type="password"
          class="token-input"
          placeholder="Enter your Cloudflare API token"
          value={setupStore.token}
          onInput={(e) => setupStore.setToken(e.currentTarget.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleVerify()}
        />
        <Show when={setupStore.tokenError}>
          <div class="token-error">{setupStore.tokenError}</div>
        </Show>
        <Show when={setupStore.tokenValid && setupStore.accountInfo}>
          <div class="token-success">
            <Icon path={mdiCheck} size={16} class="success-icon" />
            Token verified for account: {setupStore.accountInfo?.name}
          </div>
        </Show>
      </div>

      <div class="token-actions">
        <button class="token-button secondary" onClick={() => setupStore.prevStep()}>
          ← Back
        </button>
        <button
          class="token-button primary"
          onClick={handleVerify}
          disabled={!setupStore.token || setupStore.tokenVerifying}
        >
          {setupStore.tokenVerifying ? 'Verifying...' : 'Verify Token →'}
        </button>
      </div>

      <style>{`
        .token-step {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .token-title {
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
          color: var(--color-accent);
        }

        .token-description {
          margin: 0;
          font-size: 14px;
          color: var(--color-text-secondary);
          text-align: center;
          line-height: 1.6;
        }

        .permissions-section {
          background: var(--color-bg-tertiary);
          border-radius: 12px;
          overflow: hidden;
        }

        .permissions-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: var(--color-bg-primary);
          border-bottom: 1px solid var(--color-border);
          font-size: 14px;
          font-weight: 500;
          color: var(--color-text-primary);
        }

        .permissions-toggle {
          font-size: 12px;
          color: var(--color-accent);
          background: none;
          border: none;
          cursor: pointer;
          padding: 4px 8px;
        }

        .permissions-toggle:hover {
          text-decoration: underline;
        }

        .permissions-list {
          display: flex;
          flex-direction: column;
        }

        .permission-item {
          padding: 12px 16px;
          border-bottom: 1px solid var(--color-border);
        }

        .permission-item:last-child {
          border-bottom: none;
        }

        .permission-main {
          display: flex;
          align-items: center;
          gap: 8px;
          flex-wrap: wrap;
          font-size: 13px;
        }

        .permission-scope {
          color: var(--color-text-secondary);
        }

        .permission-arrow {
          color: var(--color-text-tertiary);
        }

        .permission-name {
          color: var(--color-text-primary);
          font-weight: 500;
        }

        .permission-level {
          color: var(--color-accent);
          font-weight: 500;
        }

        .permission-details {
          margin-top: 12px;
          padding: 12px;
          background: var(--color-bg-primary);
          border-radius: 8px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .permission-detail {
          font-size: 12px;
          color: var(--color-text-secondary);
          line-height: 1.4;
        }

        .permission-detail strong {
          color: var(--color-text-primary);
        }

        .permission-detail.optional {
          color: var(--color-warning);
          font-style: italic;
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .info-icon {
          flex-shrink: 0;
        }

        .optional-permissions-section {
          background: var(--color-bg-tertiary);
          border-radius: 12px;
          overflow: hidden;
          border: 1px dashed var(--color-border);
        }

        .optional-permissions-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          padding: 12px 16px;
          background: var(--color-bg-primary);
          border-bottom: 1px solid var(--color-border);
          font-size: 13px;
          font-weight: 500;
          color: var(--color-text-secondary);
          font-style: italic;
        }

        .security-note {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 12px;
          background: rgba(124, 58, 237, 0.1);
          border-radius: 8px;
          font-size: 13px;
          color: var(--color-text-secondary);
        }

        .security-icon {
          display: flex;
          align-items: center;
          color: var(--color-accent);
        }

        .token-link {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          padding: 12px 16px;
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          color: var(--color-accent);
          text-decoration: none;
          font-size: 14px;
          transition: all 0.2s ease;
        }

        .link-icon {
          flex-shrink: 0;
        }

        .token-link:hover {
          background: var(--color-bg-primary);
          border-color: var(--color-accent);
        }

        .token-input-section {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .token-label {
          font-size: 14px;
          font-weight: 500;
          color: var(--color-text-primary);
        }

        .token-input {
          padding: 12px 16px;
          font-size: 14px;
          background: var(--color-bg-primary);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          color: var(--color-text-primary);
          outline: none;
        }

        .token-input:focus {
          border-color: var(--color-accent);
        }

        .token-input::placeholder {
          color: var(--color-text-tertiary);
        }

        .token-error {
          font-size: 13px;
          color: var(--color-error);
        }

        .token-success {
          font-size: 13px;
          color: var(--color-success);
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .success-icon {
          flex-shrink: 0;
        }

        .token-actions {
          display: flex;
          justify-content: space-between;
          gap: 12px;
        }

        .token-button {
          flex: 1;
          padding: 14px 24px;
          font-size: 14px;
          font-weight: 500;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .token-button.primary {
          background: var(--color-accent);
          color: white;
        }

        .token-button.primary:hover:not(:disabled) {
          background: var(--color-accent-hover);
        }

        .token-button.primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .token-button.secondary {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          border: 1px solid var(--color-border);
        }

        .token-button.secondary:hover {
          background: var(--color-bg-primary);
        }
      `}</style>
    </div>
  );
};

export default TokenStep;
