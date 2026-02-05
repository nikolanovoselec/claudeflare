import { Component, Show, createSignal, For } from 'solid-js';
import {
  mdiEarth,
  mdiAlertOutline,
  mdiInformationOutline,
} from '@mdi/js';
import Icon from '../Icon';
import { setupStore } from '../../stores/setup';

const DomainStep: Component = () => {
  const [newEmail, setNewEmail] = createSignal('');

  const handleAddEmail = () => {
    const email = newEmail().trim();
    if (email && email.includes('@')) {
      setupStore.addEmail(email);
      setNewEmail('');
    }
  };

  const handleContinue = () => {
    if (setupStore.useCustomDomain && !setupStore.customDomain) {
      return;
    }
    setupStore.nextStep();
  };

  return (
    <div class="domain-step">
      <h2 class="domain-title">
        <Icon path={mdiEarth} size={24} class="title-icon" />
        Custom Domain (Optional)
      </h2>

      <div class="workers-url-preview">
        <span class="url-label">Your instance will be available at:</span>
        <code class="url-value">{window.location.origin}</code>
      </div>

      <div class="domain-warning">
        <span class="warning-icon">
          <Icon path={mdiAlertOutline} size={18} />
        </span>
        <span>
          workers.dev URLs cannot be protected with Cloudflare Access.
          Add a custom domain to enable authentication.
        </span>
      </div>

      <div class="domain-options">
        <label class="domain-option">
          <input
            type="radio"
            name="domainChoice"
            checked={!setupStore.useCustomDomain}
            onChange={() => setupStore.setUseCustomDomain(false)}
          />
          <div class="domain-option-content">
            <strong>Use workers.dev only (no authentication)</strong>
            <span>Quick setup, but anyone with the URL can access</span>
          </div>
        </label>

        <label class="domain-option">
          <input
            type="radio"
            name="domainChoice"
            checked={setupStore.useCustomDomain}
            onChange={() => setupStore.setUseCustomDomain(true)}
          />
          <div class="domain-option-content">
            <strong>Add custom domain (recommended for production)</strong>
            <span>Enables Cloudflare Access authentication</span>
          </div>
        </label>
      </div>

      <Show when={setupStore.useCustomDomain}>
        <div class="custom-domain-section">
          <div class="input-group">
            <label class="input-label">Custom domain:</label>
            <input
              type="text"
              class="input-field"
              placeholder="claude.example.com"
              value={setupStore.customDomain}
              onInput={(e) => setupStore.setCustomDomain(e.currentTarget.value)}
            />
            <span class="input-hint">
              <Icon path={mdiInformationOutline} size={14} class="hint-icon" />
              Domain must be in your Cloudflare account
            </span>
          </div>

          <div class="access-policy-section">
            <label class="input-label">Who can access?</label>
            <div class="access-options">
              <label class="access-option">
                <input
                  type="radio"
                  name="accessPolicy"
                  checked={setupStore.accessPolicy.type === 'email'}
                  onChange={() => setupStore.setAccessPolicy({ type: 'email' })}
                />
                <span>Specific email addresses</span>
              </label>

              <label class="access-option">
                <input
                  type="radio"
                  name="accessPolicy"
                  checked={setupStore.accessPolicy.type === 'domain'}
                  onChange={() => setupStore.setAccessPolicy({ type: 'domain' })}
                />
                <span>Anyone with email domain</span>
              </label>

              <label class="access-option">
                <input
                  type="radio"
                  name="accessPolicy"
                  checked={setupStore.accessPolicy.type === 'everyone'}
                  onChange={() => setupStore.setAccessPolicy({ type: 'everyone' })}
                />
                <span>Anyone (one-time PIN via email)</span>
              </label>
            </div>

            <Show when={setupStore.accessPolicy.type === 'email'}>
              <div class="email-list-section">
                <div class="email-input-row">
                  <input
                    type="email"
                    class="input-field"
                    placeholder="user@example.com"
                    value={newEmail()}
                    onInput={(e) => setNewEmail(e.currentTarget.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddEmail()}
                  />
                  <button class="add-email-btn" onClick={handleAddEmail}>
                    Add
                  </button>
                </div>
                <div class="email-list">
                  <For each={setupStore.accessPolicy.emails}>
                    {(email, index) => (
                      <div class="email-tag">
                        <span>{email}</span>
                        <button
                          class="email-remove"
                          onClick={() => setupStore.removeEmail(index())}
                        >
                          ×
                        </button>
                      </div>
                    )}
                  </For>
                </div>
              </div>
            </Show>

            <Show when={setupStore.accessPolicy.type === 'domain'}>
              <div class="input-group">
                <input
                  type="text"
                  class="input-field"
                  placeholder="example.com"
                  value={setupStore.accessPolicy.domain}
                  onInput={(e) =>
                    setupStore.setAccessPolicy({ domain: e.currentTarget.value })
                  }
                />
                <span class="input-hint">
                  Anyone with an @{setupStore.accessPolicy.domain || 'example.com'} email can access
                </span>
              </div>
            </Show>
          </div>
        </div>
      </Show>

      <div class="domain-actions">
        <button class="domain-button secondary" onClick={() => setupStore.prevStep()}>
          ← Back
        </button>
        <button
          class="domain-button primary"
          onClick={handleContinue}
          disabled={setupStore.useCustomDomain && !setupStore.customDomain}
        >
          Continue →
        </button>
      </div>

      <style>{`
        .domain-step {
          display: flex;
          flex-direction: column;
          gap: 20px;
        }

        .domain-title {
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

        .workers-url-preview {
          display: flex;
          flex-direction: column;
          gap: 8px;
          padding: 16px;
          background: var(--color-bg-tertiary);
          border-radius: 8px;
          text-align: center;
        }

        .url-label {
          font-size: 13px;
          color: var(--color-text-secondary);
        }

        .url-value {
          font-size: 14px;
          color: var(--color-accent);
          background: var(--color-bg-primary);
          padding: 8px 12px;
          border-radius: 6px;
        }

        .domain-warning {
          display: flex;
          align-items: flex-start;
          gap: 8px;
          padding: 12px;
          background: rgba(239, 68, 68, 0.1);
          border: 1px solid rgba(239, 68, 68, 0.2);
          border-radius: 8px;
          font-size: 13px;
          color: var(--color-text-secondary);
        }

        .warning-icon {
          display: flex;
          align-items: center;
          color: var(--color-warning, #f59e0b);
        }

        .domain-options {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .domain-option {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          padding: 16px;
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .domain-option:hover {
          border-color: var(--color-accent);
        }

        .domain-option input[type="radio"] {
          margin-top: 4px;
          accent-color: var(--color-accent);
        }

        .domain-option-content {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .domain-option-content strong {
          color: var(--color-text-primary);
          font-size: 14px;
        }

        .domain-option-content span {
          color: var(--color-text-secondary);
          font-size: 13px;
        }

        .custom-domain-section {
          display: flex;
          flex-direction: column;
          gap: 16px;
          padding: 16px;
          background: var(--color-bg-primary);
          border: 1px solid var(--color-border);
          border-radius: 8px;
        }

        .input-group {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .input-label {
          font-size: 14px;
          font-weight: 500;
          color: var(--color-text-primary);
        }

        .input-field {
          padding: 12px 16px;
          font-size: 14px;
          background: var(--color-bg-secondary);
          border: 1px solid var(--color-border);
          border-radius: 8px;
          color: var(--color-text-primary);
          outline: none;
        }

        .input-field:focus {
          border-color: var(--color-accent);
        }

        .input-field::placeholder {
          color: var(--color-text-tertiary);
        }

        .input-hint {
          font-size: 12px;
          color: var(--color-text-secondary);
          display: flex;
          align-items: center;
          gap: 4px;
        }

        .hint-icon {
          flex-shrink: 0;
          color: var(--color-text-tertiary);
        }

        .access-policy-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .access-options {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .access-option {
          display: flex;
          align-items: center;
          gap: 8px;
          padding: 12px;
          background: var(--color-bg-secondary);
          border-radius: 6px;
          cursor: pointer;
          font-size: 14px;
          color: var(--color-text-primary);
        }

        .access-option input[type="radio"] {
          accent-color: var(--color-accent);
        }

        .email-list-section {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .email-input-row {
          display: flex;
          gap: 8px;
        }

        .email-input-row .input-field {
          flex: 1;
        }

        .add-email-btn {
          padding: 0 16px;
          background: var(--color-accent);
          color: white;
          border-radius: 8px;
          font-size: 14px;
          cursor: pointer;
        }

        .add-email-btn:hover {
          background: var(--color-accent-hover);
        }

        .email-list {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .email-tag {
          display: flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: var(--color-bg-tertiary);
          border-radius: 20px;
          font-size: 13px;
          color: var(--color-text-primary);
        }

        .email-remove {
          width: 18px;
          height: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-bg-primary);
          border-radius: 50%;
          font-size: 14px;
          color: var(--color-text-secondary);
          cursor: pointer;
        }

        .email-remove:hover {
          background: var(--color-error);
          color: white;
        }

        .domain-actions {
          display: flex;
          justify-content: space-between;
          gap: 12px;
        }

        .domain-button {
          flex: 1;
          padding: 14px 24px;
          font-size: 14px;
          font-weight: 500;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .domain-button.primary {
          background: var(--color-accent);
          color: white;
        }

        .domain-button.primary:hover:not(:disabled) {
          background: var(--color-accent-hover);
        }

        .domain-button.primary:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        .domain-button.secondary {
          background: var(--color-bg-tertiary);
          color: var(--color-text-primary);
          border: 1px solid var(--color-border);
        }

        .domain-button.secondary:hover {
          background: var(--color-bg-primary);
        }
      `}</style>
    </div>
  );
};

export default DomainStep;
