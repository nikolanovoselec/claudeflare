import { Component } from 'solid-js';
import {
  mdiShieldLockOutline,
  mdiCloudOutline,
  mdiLightningBolt,
} from '@mdi/js';
import Icon from '../Icon';
import { setupStore } from '../../stores/setup';

const WelcomeStep: Component = () => {
  return (
    <div class="welcome-step">
      <h2 class="welcome-title">Welcome to Claudeflare</h2>
      <p class="welcome-description">
        Let's set up your personal Claude Code environment. This wizard will
        configure everything you need in just a few minutes.
      </p>

      <div class="welcome-features">
        <div class="welcome-feature">
          <div class="welcome-feature-icon">
            <Icon path={mdiShieldLockOutline} size={24} />
          </div>
          <div class="welcome-feature-text">
            <strong>Secure & Private</strong>
            <span>Your data stays in your Cloudflare account</span>
          </div>
        </div>
        <div class="welcome-feature">
          <div class="welcome-feature-icon">
            <Icon path={mdiCloudOutline} size={24} />
          </div>
          <div class="welcome-feature-text">
            <strong>Cloud-Native</strong>
            <span>Runs on Cloudflare Containers with R2 storage</span>
          </div>
        </div>
        <div class="welcome-feature">
          <div class="welcome-feature-icon">
            <Icon path={mdiLightningBolt} size={24} />
          </div>
          <div class="welcome-feature-text">
            <strong>Persistent Sessions</strong>
            <span>Your workspace syncs automatically to R2</span>
          </div>
        </div>
      </div>

      <div class="welcome-steps-preview">
        <h3>Setup Overview</h3>
        <ol>
          <li>
            <strong>Create API Token</strong> – One token with 4 permissions
          </li>
          <li>
            <strong>Optional: Custom Domain</strong> – Add Cloudflare Access protection
          </li>
          <li>
            <strong>Auto-Configure</strong> – We set up R2, secrets, and Access
          </li>
        </ol>
      </div>

      <button class="welcome-button" onClick={() => setupStore.nextStep()}>
        Get Started →
      </button>

      <style>{`
        .welcome-step {
          display: flex;
          flex-direction: column;
          gap: 24px;
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

        .welcome-features {
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px;
          background: var(--color-bg-tertiary);
          border-radius: 12px;
        }

        .welcome-feature {
          display: flex;
          align-items: center;
          gap: 12px;
        }

        .welcome-feature-icon {
          width: 40px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-accent);
        }

        .welcome-feature-text {
          display: flex;
          flex-direction: column;
          gap: 2px;
        }

        .welcome-feature-text strong {
          color: var(--color-text-primary);
          font-size: 14px;
        }

        .welcome-feature-text span {
          color: var(--color-text-secondary);
          font-size: 13px;
        }

        .welcome-steps-preview {
          padding: 16px;
          background: var(--color-bg-primary);
          border: 1px solid var(--color-border);
          border-radius: 12px;
        }

        .welcome-steps-preview h3 {
          margin: 0 0 12px 0;
          font-size: 14px;
          font-weight: 600;
          color: var(--color-text-secondary);
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }

        .welcome-steps-preview ol {
          margin: 0;
          padding-left: 20px;
          display: flex;
          flex-direction: column;
          gap: 8px;
        }

        .welcome-steps-preview li {
          color: var(--color-text-secondary);
          font-size: 14px;
        }

        .welcome-steps-preview li strong {
          color: var(--color-text-primary);
        }

        .welcome-button {
          padding: 16px 32px;
          font-size: 16px;
          font-weight: 600;
          color: white;
          background: var(--color-accent);
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s ease;
          align-self: center;
        }

        .welcome-button:hover {
          background: var(--color-accent-hover);
          transform: translateY(-1px);
        }
      `}</style>
    </div>
  );
};

export default WelcomeStep;
