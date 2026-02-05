import { Component, For, Show, createMemo, createSignal, createEffect, onCleanup } from 'solid-js';
import {
  mdiCheck,
  mdiLoading,
  mdiCircleOutline,
  mdiOpenInNew,
  mdiAlertCircle,
  mdiRocketLaunchOutline,
  mdiCloudSyncOutline,
  mdiCheckCircle,
  mdiPackageVariant,
  mdiHarddisk,
  mdiShieldCheckOutline,
} from '@mdi/js';
import Icon from './Icon';
import type { InitProgress, InitStage, InitProgressDetail } from '../types';
import '../styles/init-progress.css';

interface InitProgressProps {
  sessionName: string;
  sessionId?: string;
  progress: InitProgress | null;
  onOpen?: () => void;
}

// Define the 6 initialization stages with their labels
const stages: { key: InitStage; label: string }[] = [
  { key: 'creating', label: 'Creating session' },
  { key: 'starting', label: 'Starting container' },
  { key: 'syncing', label: 'Syncing workspace' },
  { key: 'mounting', label: 'Preparing terminal' },
  { key: 'verifying', label: 'Verifying workspace' },
  { key: 'ready', label: 'Ready' },
];

const stageOrder: Record<InitStage, number> = {
  stopped: -1,
  creating: 0,
  starting: 1,
  syncing: 2,
  mounting: 3,
  verifying: 4,
  ready: 5,
  error: -2,
};

// Stage-to-icon mapping for hero icon
const stageIcons: Record<string, string> = {
  creating: mdiPackageVariant,
  starting: mdiRocketLaunchOutline,
  syncing: mdiCloudSyncOutline,
  mounting: mdiHarddisk,
  verifying: mdiShieldCheckOutline,
  ready: mdiCheckCircle,
  error: mdiAlertCircle,
};

// Stage-to-icon mapping for step icons
const stepIcons: Record<string, string> = {
  creating: mdiPackageVariant,
  starting: mdiRocketLaunchOutline,
  syncing: mdiCloudSyncOutline,
  mounting: mdiHarddisk,
  verifying: mdiShieldCheckOutline,
  ready: mdiCheckCircle,
};

const InitProgressComponent: Component<InitProgressProps> = (props) => {
  // Track elapsed times for each stage
  const [stageTimes, setStageTimes] = createSignal<Record<string, { start: number; elapsed: number }>>({});
  const [currentTime, setCurrentTime] = createSignal(Date.now());

  // Track total startup time
  const [startTime] = createSignal(Date.now());
  const [totalTime, setTotalTime] = createSignal<number | null>(null);

  // Update current time every 100ms for live elapsed display
  let timerInterval: number | undefined;
  createEffect(() => {
    if (!props.progress || props.progress.stage === 'ready' || props.progress.stage === 'error') {
      if (timerInterval) {
        clearInterval(timerInterval);
        timerInterval = undefined;
      }
      // Calculate total time when ready
      if (props.progress?.stage === 'ready' && totalTime() === null) {
        setTotalTime((Date.now() - startTime()) / 1000);
      }
      return;
    }
    if (!timerInterval) {
      timerInterval = window.setInterval(() => {
        setCurrentTime(Date.now());
      }, 100);
    }
  });

  onCleanup(() => {
    if (timerInterval) {
      clearInterval(timerInterval);
    }
  });

  // Track stage transitions for elapsed time calculation
  createEffect(() => {
    const currentStage = props.progress?.stage;
    if (!currentStage || currentStage === 'stopped') return;

    setStageTimes(prev => {
      const now = Date.now();
      const updated = { ...prev };

      // If this stage hasn't started yet, record its start time
      if (!updated[currentStage]) {
        updated[currentStage] = { start: now, elapsed: 0 };
      }

      // Mark all previous stages as completed with their elapsed times
      stages.forEach(stage => {
        if (stageOrder[stage.key] < stageOrder[currentStage] && updated[stage.key]) {
          // If not yet finalized, calculate final elapsed time
          if (updated[stage.key].elapsed === 0) {
            const nextStageStart = updated[currentStage]?.start || now;
            updated[stage.key] = {
              ...updated[stage.key],
              elapsed: (nextStageStart - updated[stage.key].start) / 1000
            };
          }
        }
      });

      return updated;
    });
  });

  const currentStageIndex = () => {
    if (!props.progress) return -1;
    return stageOrder[props.progress.stage] ?? -1;
  };

  const getStageStatus = (stageKey: InitStage): 'completed' | 'active' | 'pending' | 'error' => {
    if (!props.progress) return 'pending';
    if (props.progress.stage === 'error') return 'error';

    const idx = currentStageIndex();
    const stageIdx = stageOrder[stageKey];

    if (idx > stageIdx) return 'completed';
    if (idx === stageIdx) return 'active';
    return 'pending';
  };

  // Get elapsed time for a stage
  const getElapsedTime = (stageKey: InitStage): string => {
    // Don't show time for ready stage - it's instantaneous
    if (stageKey === 'ready') return '';

    const times = stageTimes();
    const stageTime = times[stageKey];
    if (!stageTime) return '';

    const status = getStageStatus(stageKey);
    if (status === 'completed' && stageTime.elapsed > 0) {
      return `${stageTime.elapsed.toFixed(1)}s`;
    }
    if (status === 'active') {
      const elapsed = (currentTime() - stageTime.start) / 1000;
      return `${elapsed.toFixed(1)}s`;
    }
    return '';
  };

  // Get details for the current stage, enriched with session info
  const stageDetails = () => {
    const baseDetails = props.progress?.details || [];
    const enrichedDetails = [...baseDetails];

    // Add session ID if available
    if (props.sessionId) {
      enrichedDetails.unshift({
        key: 'Session ID',
        value: props.sessionId.slice(0, 8) + '...',
      });
    }

    // Add started at time
    enrichedDetails.unshift({
      key: 'Started at',
      value: new Date(startTime()).toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }),
    });

    return enrichedDetails;
  };

  // Format total time for display
  const formatTotalTime = () => {
    const time = totalTime();
    if (time === null) return null;
    return time.toFixed(1);
  };

  const isComplete = () => props.progress?.stage === 'ready';
  const isError = () => props.progress?.stage === 'error';
  const progressPercent = () => props.progress?.progress ?? 0;
  const statusMessage = () => props.progress?.message ?? 'Initializing...';

  // Hero icon based on current stage
  const heroIcon = () => {
    const stage = props.progress?.stage;
    if (!stage || stage === 'stopped') return mdiLoading;
    return stageIcons[stage] || mdiLoading;
  };

  // Hero icon animation class
  const heroIconClass = () => {
    if (isComplete()) return 'init-progress-hero-icon animate-bounce animate-scaleIn';
    if (isError()) return 'init-progress-hero-icon';
    return 'init-progress-hero-icon animate-float';
  };

  // Modal class for error shake
  const modalClass = () => {
    if (isError()) return 'init-progress animate-shake';
    return 'init-progress';
  };

  // Progress bar color changes to green when complete, red on error
  const progressBarClass = createMemo(() => {
    if (isError()) return 'init-progress-bar-fill init-progress-bar-fill--error';
    if (isComplete()) return 'init-progress-bar-fill init-progress-bar-fill--complete';
    return 'init-progress-bar-fill';
  });

  return (
    <div class={modalClass()} data-testid="init-progress">
      {/* Hero Icon */}
      <div class="init-progress-hero">
        <div class={heroIconClass()} data-testid="init-progress-hero-icon">
          <Icon
            path={heroIcon()}
            size={48}
            class={isComplete() ? '' : isError() ? '' : 'animate-pulse'}
          />
        </div>
      </div>

      <div class="init-progress-header">
        <h2>Starting "{props.sessionName}"</h2>
        <p class="init-progress-subtitle">{statusMessage()}</p>
      </div>

      <div
        class={`init-progress-bar ${isComplete() ? 'init-progress-bar--complete' : ''} ${isError() ? 'init-progress-bar--error' : ''}`}
        data-testid="init-progress-bar"
      >
        <div
          class={progressBarClass()}
          style={{ width: `${progressPercent()}%` }}
          data-testid="init-progress-bar-fill"
        />
        <span class="init-progress-bar-text">
          {progressPercent()}%
        </span>
      </div>

      <ul class="init-progress-stages">
        <For each={stages}>
          {(stage, index) => {
            const status = () => getStageStatus(stage.key);
            const elapsedTime = () => getElapsedTime(stage.key);
            return (
              <li
                class={`init-progress-stage init-progress-stage--${status()}`}
                data-stage={stage.key}
                data-testid={`init-progress-step-${index()}`}
              >
                <div class="init-progress-stage-row">
                  <span class="init-progress-stage-icon">
                    <Show when={status() === 'completed'}>
                      <Icon path={mdiCheck} size={18} />
                    </Show>
                    <Show when={status() === 'active' && stage.key !== 'ready'}>
                      <Icon path={stepIcons[stage.key] || mdiLoading} size={18} class="animate-spin" />
                    </Show>
                    <Show when={status() === 'active' && stage.key === 'ready'}>
                      <Icon path={mdiCheck} size={18} />
                    </Show>
                    <Show when={status() === 'pending'}>
                      <Icon path={mdiCircleOutline} size={18} />
                    </Show>
                    <Show when={status() === 'error'}>
                      <Icon path={mdiAlertCircle} size={18} />
                    </Show>
                  </span>
                  <span class="init-progress-stage-label">{stage.label}</span>
                  <span
                    class="init-progress-stage-time"
                    data-testid={`init-progress-step-${index()}-time`}
                  >
                    {elapsedTime() || (status() === 'active' ? '...' : '')}
                  </span>
                </div>
              </li>
            );
          }}
        </For>
      </ul>

      {/* Details section - always visible */}
      <Show when={true}>
        <div class="init-progress-details-section">
          <div class="init-progress-details-title">Details</div>
          <div class="init-progress-details-grid">
            <For each={stageDetails()}>
              {(detail) => (
                <div class="init-progress-detail">
                  <span class="init-progress-detail-key">{detail.key}</span>
                  <span class={`init-progress-detail-value ${detail.status ? `init-progress-detail-value--${detail.status}` : ''}`}>
                    <Show when={detail.status}>
                      <span class={`init-progress-status-dot init-progress-status-dot--${detail.status}`} />
                    </Show>
                    {detail.value}
                  </span>
                </div>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* Open button and total time - shown when complete */}
      <Show when={isComplete()}>
        <div class="init-progress-actions">
          <button class="init-progress-open-btn" onClick={props.onOpen}>
            <Icon path={mdiOpenInNew} size={18} />
            <span>Open</span>
          </button>
          <Show when={formatTotalTime()}>
            <div class="init-progress-total-time">
              Started in {formatTotalTime()}s
            </div>
          </Show>
        </div>
      </Show>

      {/* Error state */}
      <Show when={isError()}>
        <div class="init-progress-error-msg">
          {props.progress?.message || 'An error occurred during startup'}
        </div>
      </Show>
    </div>
  );
};

export default InitProgressComponent;
