import { Component, Show } from 'solid-js';
import Icon from '../Icon';

export interface InputProps {
  type?: 'text' | 'password' | 'search';
  value?: string;
  onInput?: (value: string) => void;
  icon?: string;
  placeholder?: string;
  error?: string;
  hint?: string;
  disabled?: boolean;
}

const Input: Component<InputProps> = (props) => {
  const type = () => props.type || 'text';
  const hasIcon = () => !!props.icon;
  const hasError = () => !!props.error;

  const handleInput = (e: InputEvent) => {
    const target = e.target as HTMLInputElement;
    props.onInput?.(target.value);
  };

  return (
    <div class="input-container">
      <div
        data-testid="input-wrapper"
        data-has-icon={hasIcon().toString()}
        data-error={hasError().toString()}
        class="input-wrapper"
      >
        <Show when={props.icon}>
          <span class="input-icon">
            <Icon path={props.icon!} size={18} />
          </span>
        </Show>
        <input
          data-testid="input"
          type={type()}
          value={props.value || ''}
          placeholder={props.placeholder}
          disabled={props.disabled}
          onInput={handleInput}
          class="input"
        />
      </div>

      <Show when={props.error}>
        <span data-testid="input-error" class="input-error">
          {props.error}
        </span>
      </Show>

      <Show when={props.hint && !props.error}>
        <span data-testid="input-hint" class="input-hint">
          {props.hint}
        </span>
      </Show>

      <style>{`
        .input-container {
          display: flex;
          flex-direction: column;
          gap: 4px;
          width: 100%;
        }

        .input-wrapper {
          position: relative;
          display: flex;
          align-items: center;
          width: 100%;
        }

        .input {
          width: 100%;
          padding: 10px 12px;
          font-family: var(--font-sans);
          font-size: 14px;
          color: var(--color-text-primary);
          background: var(--color-bg-tertiary);
          border: 1px solid var(--color-border);
          border-radius: 6px;
          outline: none;
          transition: all var(--transition-fast);
        }

        .input-wrapper[data-has-icon="true"] .input {
          padding-left: 40px;
        }

        .input::placeholder {
          color: var(--color-text-muted);
        }

        .input:focus {
          border-color: var(--color-accent);
          box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.1);
        }

        .input:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }

        /* Error state */
        .input-wrapper[data-error="true"] .input {
          border-color: var(--color-error);
        }

        .input-wrapper[data-error="true"] .input:focus {
          border-color: var(--color-error);
          box-shadow: 0 0 0 3px rgba(239, 68, 68, 0.1);
        }

        /* Icon */
        .input-icon {
          position: absolute;
          left: 12px;
          display: flex;
          align-items: center;
          justify-content: center;
          color: var(--color-text-muted);
          pointer-events: none;
        }

        .input:focus ~ .input-icon,
        .input-wrapper:has(.input:focus) .input-icon {
          color: var(--color-accent);
        }

        /* Error message */
        .input-error {
          font-size: 12px;
          color: var(--color-error);
        }

        /* Hint message */
        .input-hint {
          font-size: 12px;
          color: var(--color-text-muted);
        }
      `}</style>
    </div>
  );
};

export default Input;
