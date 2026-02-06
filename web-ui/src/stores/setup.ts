import { createStore, produce } from 'solid-js/store';

const TOTAL_STEPS = 3;

export interface SetupState {
  step: number;
  // Token detection (auto-detected from env)
  tokenDetected: boolean;
  tokenDetecting: boolean;
  tokenDetectError: string | null;
  accountInfo: { id: string; name: string } | null;
  // Custom domain (optional)
  customDomain: string;
  customDomainError: string | null;
  // Allowed users and origins
  allowedUsers: string[];
  allowedOrigins: string[];
  // Configuration progress
  configuring: boolean;
  configureSteps: Array<{ step: string; status: string; error?: string }>;
  configureError: string | null;
  setupComplete: boolean;
  // Result URLs
  customDomainUrl: string | null;
  adminSecret: string | null;
  accountId: string | null;
}

const initialState: SetupState = {
  step: 1,
  tokenDetected: false,
  tokenDetecting: false,
  tokenDetectError: null,
  accountInfo: null,
  customDomain: '',
  customDomainError: null,
  allowedUsers: [],
  allowedOrigins: [],
  configuring: false,
  configureSteps: [],
  configureError: null,
  setupComplete: false,
  customDomainUrl: null,
  adminSecret: null,
  accountId: null,
};

const [state, setState] = createStore<SetupState>({ ...initialState });

async function detectToken(): Promise<void> {
  setState('tokenDetecting', true);
  setState('tokenDetectError', null);
  try {
    const res = await fetch('/api/setup/detect-token');
    const data = await res.json();
    if (data.detected && data.valid) {
      setState('tokenDetected', true);
      setState('accountInfo', data.account);
    } else {
      setState('tokenDetectError', data.error || 'Token not detected');
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Failed to detect token';
    setState('tokenDetectError', msg);
  } finally {
    setState('tokenDetecting', false);
  }
}

function addAllowedUser(email: string): void {
  if (email && !state.allowedUsers.includes(email)) {
    setState(
      produce((s) => {
        s.allowedUsers.push(email);
      })
    );
  }
}

function removeAllowedUser(email: string): void {
  setState(
    produce((s) => {
      const index = s.allowedUsers.indexOf(email);
      if (index !== -1) {
        s.allowedUsers.splice(index, 1);
      }
    })
  );
}

function setAllowedOrigins(origins: string[]): void {
  setState('allowedOrigins', origins);
}

function setCustomDomain(domain: string): void {
  setState({ customDomain: domain, customDomainError: null });
}

function nextStep(): void {
  if (state.step < TOTAL_STEPS) {
    setState('step', state.step + 1);
  }
}

function prevStep(): void {
  setState('step', Math.max(1, state.step - 1));
}

function goToStep(step: number): void {
  setState('step', Math.max(1, Math.min(TOTAL_STEPS, step)));
}

async function configure(): Promise<boolean> {
  setState({ configuring: true, configureSteps: [], configureError: null });

  try {
    const body: Record<string, unknown> = {
      customDomain: state.customDomain,
      allowedUsers: state.allowedUsers,
    };
    if (state.allowedOrigins.length > 0) {
      body.allowedOrigins = state.allowedOrigins;
    }

    const res = await fetch('/api/setup/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();

    setState({ configureSteps: data.steps || [] });

    if (data.success) {
      setState({
        setupComplete: true,
        customDomainUrl: data.customDomainUrl || null,
        adminSecret: data.adminSecret || null,
        accountId: data.accountId || null,
      });
      return true;
    } else {
      setState({ configureError: data.error || 'Configuration failed' });
      return false;
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Configuration request failed';
    setState({ configureError: msg });
    return false;
  } finally {
    setState({ configuring: false });
  }
}

function reset(): void {
  setState({ ...initialState, allowedUsers: [], allowedOrigins: [], configureSteps: [] });
}

export const setupStore = {
  // State (readonly via getters)
  get step() {
    return state.step;
  },
  get tokenDetected() {
    return state.tokenDetected;
  },
  get tokenDetecting() {
    return state.tokenDetecting;
  },
  get tokenDetectError() {
    return state.tokenDetectError;
  },
  get accountInfo() {
    return state.accountInfo;
  },
  get customDomain() {
    return state.customDomain;
  },
  get customDomainError() {
    return state.customDomainError;
  },
  get allowedUsers() {
    return state.allowedUsers;
  },
  get allowedOrigins() {
    return state.allowedOrigins;
  },
  get configuring() {
    return state.configuring;
  },
  get configureSteps() {
    return state.configureSteps;
  },
  get configureError() {
    return state.configureError;
  },
  get setupComplete() {
    return state.setupComplete;
  },
  get customDomainUrl() {
    return state.customDomainUrl;
  },
  get adminSecret() {
    return state.adminSecret;
  },
  get accountId() {
    return state.accountId;
  },

  // Actions
  detectToken,
  addAllowedUser,
  removeAllowedUser,
  setAllowedOrigins,
  setCustomDomain,
  nextStep,
  prevStep,
  goToStep,
  configure,
  reset,
};
