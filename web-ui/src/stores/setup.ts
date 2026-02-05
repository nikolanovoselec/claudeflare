import { createStore, produce } from 'solid-js/store';

export interface SetupState {
  step: number;
  token: string;
  tokenValid: boolean;
  tokenError: string | null;
  tokenVerifying: boolean;
  accountInfo: { id: string; name: string } | null;
  // Custom domain (optional)
  useCustomDomain: boolean;
  customDomain: string;
  customDomainError: string | null;
  // Access policy (only if custom domain)
  accessPolicy: {
    type: 'email' | 'domain' | 'everyone';
    emails: string[];
    domain: string;
  };
  // Configuration progress
  configuring: boolean;
  configureSteps: Array<{ step: string; status: string; error?: string }>;
  configureError: string | null;
  setupComplete: boolean;
  // Result URLs
  workersDevUrl: string | null;
  customDomainUrl: string | null;
  adminSecret: string | null;
  accountId: string | null;
}

const [state, setState] = createStore<SetupState>({
  step: 1,
  token: '',
  tokenValid: false,
  tokenError: null,
  tokenVerifying: false,
  accountInfo: null,
  useCustomDomain: false,
  customDomain: '',
  customDomainError: null,
  accessPolicy: {
    type: 'email',
    emails: [],
    domain: '',
  },
  configuring: false,
  configureSteps: [],
  configureError: null,
  setupComplete: false,
  workersDevUrl: null,
  customDomainUrl: null,
  adminSecret: null,
  accountId: null,
});

function setToken(token: string): void {
  setState({ token, tokenValid: false, tokenError: null });
}

async function verifyToken(): Promise<boolean> {
  setState({ tokenVerifying: true, tokenError: null });

  try {
    const res = await fetch('/api/setup/verify-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: state.token }),
    });
    const data = await res.json();

    if (data.valid) {
      setState({ tokenValid: true, accountInfo: data.account, tokenError: null });
      return true;
    } else {
      setState({ tokenValid: false, tokenError: data.error || 'Invalid token' });
      return false;
    }
  } catch {
    setState({ tokenValid: false, tokenError: 'Verification failed' });
    return false;
  } finally {
    setState({ tokenVerifying: false });
  }
}

function setAccessPolicy(policy: Partial<SetupState['accessPolicy']>): void {
  setState('accessPolicy', (prev) => ({ ...prev, ...policy }));
}

function addEmail(email: string): void {
  if (email && !state.accessPolicy.emails.includes(email)) {
    setState(
      produce((s) => {
        s.accessPolicy.emails.push(email);
      })
    );
  }
}

function removeEmail(index: number): void {
  setState(
    produce((s) => {
      s.accessPolicy.emails.splice(index, 1);
    })
  );
}

function setUseCustomDomain(use: boolean): void {
  setState({ useCustomDomain: use, customDomainError: null });
}

function setCustomDomain(domain: string): void {
  setState({ customDomain: domain, customDomainError: null });
}

function nextStep(): void {
  setState('step', state.step + 1);
}

function prevStep(): void {
  setState('step', Math.max(1, state.step - 1));
}

function goToStep(step: number): void {
  setState('step', step);
}

async function configure(): Promise<boolean> {
  setState({ configuring: true, configureSteps: [], configureError: null });

  try {
    const res = await fetch('/api/setup/configure', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        token: state.token,
        customDomain: state.useCustomDomain ? state.customDomain : undefined,
        accessPolicy: state.useCustomDomain ? state.accessPolicy : undefined,
      }),
    });
    const data = await res.json();

    setState({ configureSteps: data.steps || [] });

    if (data.success) {
      setState({
        setupComplete: true,
        workersDevUrl: data.workersDevUrl || null,
        customDomainUrl: data.customDomainUrl || null,
        adminSecret: data.adminSecret || null,
        accountId: data.accountId || null,
      });
      return true;
    } else {
      setState({ configureError: data.error || 'Configuration failed' });
      return false;
    }
  } catch {
    setState({ configureError: 'Configuration request failed' });
    return false;
  } finally {
    setState({ configuring: false });
  }
}

function reset(): void {
  setState({
    step: 1,
    token: '',
    tokenValid: false,
    tokenError: null,
    tokenVerifying: false,
    accountInfo: null,
    useCustomDomain: false,
    customDomain: '',
    customDomainError: null,
    accessPolicy: {
      type: 'email',
      emails: [],
      domain: '',
    },
    configuring: false,
    configureSteps: [],
    configureError: null,
    setupComplete: false,
    workersDevUrl: null,
    customDomainUrl: null,
    adminSecret: null,
    accountId: null,
  });
}

export const setupStore = {
  // State (readonly via getters)
  get step() {
    return state.step;
  },
  get token() {
    return state.token;
  },
  get tokenValid() {
    return state.tokenValid;
  },
  get tokenError() {
    return state.tokenError;
  },
  get tokenVerifying() {
    return state.tokenVerifying;
  },
  get accountInfo() {
    return state.accountInfo;
  },
  get useCustomDomain() {
    return state.useCustomDomain;
  },
  get customDomain() {
    return state.customDomain;
  },
  get customDomainError() {
    return state.customDomainError;
  },
  get accessPolicy() {
    return state.accessPolicy;
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
  get workersDevUrl() {
    return state.workersDevUrl;
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
  setToken,
  verifyToken,
  setAccessPolicy,
  addEmail,
  removeEmail,
  setUseCustomDomain,
  setCustomDomain,
  nextStep,
  prevStep,
  goToStep,
  configure,
  reset,
};
