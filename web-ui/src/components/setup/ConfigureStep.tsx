import { Component, For, createSignal } from 'solid-js';
import { setupStore } from '../../stores/setup';
import Button from '../ui/Button';
import Input from '../ui/Input';

const ConfigureStep: Component = () => {
  const [emailInput, setEmailInput] = createSignal('');

  const handleAddEmail = () => {
    const email = emailInput().trim().toLowerCase();
    if (email && email.includes('@') && !setupStore.allowedUsers.includes(email)) {
      setupStore.addAllowedUser(email);
      setEmailInput('');
    }
  };

  return (
    <div class="configure-step">
      <h2 class="configure-title">Configure Your Instance</h2>

      {/* Custom Domain (Required) */}
      <div class="setup-field">
        <label class="setup-field-label">Custom Domain</label>
        <p class="setup-field-description">
          Your Cloudflare Access-protected domain (e.g., claude.example.com)
        </p>
        <Input
          value={setupStore.customDomain}
          onInput={(value) => setupStore.setCustomDomain(value)}
          placeholder="claude.example.com"
        />
      </div>

      {/* Allowed Users (Required) */}
      <div class="setup-field">
        <label class="setup-field-label">Allowed Users</label>
        <p class="setup-field-description">
          Email addresses that can access this instance
        </p>
        <div class="email-input-row">
          <Input
            value={emailInput()}
            onInput={(value) => setEmailInput(value)}
            placeholder="user@example.com"
          />
          <Button onClick={handleAddEmail} variant="secondary" size="sm">
            Add
          </Button>
        </div>
        <div class="email-tags">
          <For each={setupStore.allowedUsers}>
            {(email) => (
              <span class="email-tag">
                {email}
                <button
                  class="email-tag-remove"
                  onClick={() => setupStore.removeAllowedUser(email)}
                >
                  x
                </button>
              </span>
            )}
          </For>
        </div>
      </div>

      {/* Allowed Origins (Optional) */}
      <div class="setup-field">
        <label class="setup-field-label">Allowed Origins (Optional)</label>
        <p class="setup-field-description">
          CORS origins, comma-separated. Defaults to your custom domain.
        </p>
        <Input
          value={setupStore.allowedOrigins.join(', ')}
          onInput={(value) =>
            setupStore.setAllowedOrigins(
              value
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean)
            )
          }
          placeholder=".example.com, .workers.dev"
        />
      </div>

      {/* Navigation */}
      <div class="setup-actions">
        <Button onClick={() => setupStore.prevStep()} variant="ghost">
          Back
        </Button>
        <Button
          onClick={() => setupStore.nextStep()}
          disabled={!setupStore.customDomain || setupStore.allowedUsers.length === 0}
        >
          Continue
        </Button>
      </div>

      <style>{`
        .configure-step {
          display: flex;
          flex-direction: column;
          gap: 24px;
        }

        .configure-title {
          margin: 0;
          font-size: 24px;
          font-weight: 600;
          color: var(--color-text-primary);
          text-align: center;
        }

        .setup-field {
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .setup-field-label {
          font-size: 14px;
          font-weight: 500;
          color: var(--color-text-primary);
        }

        .setup-field-description {
          margin: 0;
          font-size: 13px;
          color: var(--color-text-secondary);
          line-height: 1.4;
        }

        .email-input-row {
          display: flex;
          gap: 8px;
          align-items: flex-start;
        }

        .email-input-row .input-container {
          flex: 1;
        }

        .email-tags {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
        }

        .email-tag {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          padding: 6px 10px;
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-border);
          border-radius: 20px;
          font-size: 13px;
          color: var(--color-text-primary);
        }

        .email-tag-remove {
          width: 18px;
          height: 18px;
          display: flex;
          align-items: center;
          justify-content: center;
          background: var(--color-bg-primary);
          border: none;
          border-radius: 50%;
          font-size: 14px;
          color: var(--color-text-secondary);
          cursor: pointer;
          transition: all 0.2s ease;
        }

        .email-tag-remove:hover {
          background: var(--color-error);
          color: white;
        }

        .setup-actions {
          display: flex;
          justify-content: space-between;
          gap: 12px;
        }
      `}</style>
    </div>
  );
};

export default ConfigureStep;
