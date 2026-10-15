'use client';

import { Tabs } from '@bloxwap/hig-react/navigation';
import { InstallCommand as HIGInstallCommand } from '@bloxwap/hig-react/recipes/install-command';

const managers = [
  { name: 'npm', command: 'npm install -g @bloxwap/agent-cli' },
  { name: 'bun', command: 'bunx @bloxwap/agent-cli --help' },
];

/** HIG Tabs pick the package manager (roving focus, arrow/Home/End keys); each panel is the HIG install recipe with its own copy status. */
export function InstallCommand() {
  return <div className="package-install" data-hig-density="compact">
    <Tabs
      label="Package manager"
      defaultValue="npm"
      items={managers.map(({ name, command }) => ({
        value: name,
        label: name,
        content: <HIGInstallCommand command={command} onCopy={() => navigator.clipboard.writeText(command)} />,
      }))}
    />
    <p className="install-platforms">Node.js 22.12+ · Bun</p>
  </div>;
}
