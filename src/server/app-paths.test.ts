import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveDatabasePath } from './app-paths';

describe('resolveDatabasePath', () => {
  it('isolates development data from production data on macOS', () => {
    expect(
      resolveDatabasePath({
        platform: 'darwin',
        homeDirectory: '/Users/ada',
        environment: 'development',
      }),
    ).toBe(
      '/Users/ada/Library/Application Support/Mermaid Workbench/mermaid-workbench-development.sqlite3',
    );

    expect(
      resolveDatabasePath({
        platform: 'darwin',
        homeDirectory: '/Users/ada',
        environment: 'production',
      }),
    ).toBe(
      '/Users/ada/Library/Application Support/Mermaid Workbench/mermaid-workbench.sqlite3',
    );
  });

  it.each([
    [
      'win32',
      'C:\\Users\\Ada',
      { APPDATA: 'C:\\Users\\Ada\\AppData\\Roaming' },
      'C:\\Users\\Ada\\AppData\\Roaming\\Mermaid Workbench\\mermaid-workbench-development.sqlite3',
    ],
    [
      'linux',
      '/home/ada',
      { XDG_DATA_HOME: '/var/ada-data' },
      '/var/ada-data/Mermaid Workbench/mermaid-workbench-development.sqlite3',
    ],
  ] as const)(
    'uses conventional %s application-data storage',
    (platform, homeDirectory, environmentVariables, expected) => {
      expect(
        resolveDatabasePath({
          platform,
          homeDirectory,
          environment: 'development',
          environmentVariables,
          pathApi: platform === 'win32' ? path.win32 : path.posix,
        }),
      ).toBe(expected);
    },
  );

  it('uses an explicit data directory without exposing it to clients', () => {
    expect(
      resolveDatabasePath({
        platform: 'darwin',
        homeDirectory: '/Users/ada',
        environment: 'development',
        dataDirectoryOverride: '/tmp/workbench-test',
      }),
    ).toBe('/tmp/workbench-test/mermaid-workbench-development.sqlite3');
  });
});
