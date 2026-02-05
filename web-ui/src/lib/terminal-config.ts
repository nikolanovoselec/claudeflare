import {
  mdiRobotOutline,
  mdiChartLine,
  mdiFolderOutline,
  mdiConsole,
} from '@mdi/js';

// Tab configuration: what runs on each terminal tab
export const TERMINAL_TAB_CONFIG: Record<string, { name: string; icon: string }> = {
  '1': { name: 'claude', icon: mdiRobotOutline },
  '2': { name: 'htop', icon: mdiChartLine },
  '3': { name: 'yazi', icon: mdiFolderOutline },
  '4': { name: 'terminal', icon: mdiConsole },
  '5': { name: 'terminal', icon: mdiConsole },
  '6': { name: 'terminal', icon: mdiConsole },
};
