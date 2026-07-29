import { mkdirSync } from 'node:fs';
import os from 'node:os';
import path, { type PlatformPath } from 'node:path';
import {
  APP_NAME,
  DEV_DATABASE_NAME,
  PROD_DATABASE_NAME,
} from '@shared/constants';

export interface DatabasePathOptions {
  platform?: NodeJS.Platform;
  homeDirectory?: string;
  environment?: 'development' | 'production';
  environmentVariables?: Record<string, string | undefined>;
  dataDirectoryOverride?: string;
  pathApi?: PlatformPath;
}

export function resolveDatabasePath(
  options: DatabasePathOptions = {},
): string {
  const platform = options.platform ?? process.platform;
  const homeDirectory = options.homeDirectory ?? os.homedir();
  const environment =
    options.environment ??
    (process.env.NODE_ENV === 'production' ? 'production' : 'development');
  const environmentVariables =
    options.environmentVariables ?? process.env;
  const pathApi =
    options.pathApi ?? (platform === 'win32' ? path.win32 : path.posix);
  const databaseName =
    environment === 'production'
      ? PROD_DATABASE_NAME
      : DEV_DATABASE_NAME;

  let dataDirectory = options.dataDirectoryOverride;
  if (!dataDirectory) {
    if (platform === 'darwin') {
      dataDirectory = pathApi.join(
        homeDirectory,
        'Library',
        'Application Support',
        APP_NAME,
      );
    } else if (platform === 'win32') {
      dataDirectory = pathApi.join(
        environmentVariables.APPDATA ??
          pathApi.join(homeDirectory, 'AppData', 'Roaming'),
        APP_NAME,
      );
    } else {
      dataDirectory = pathApi.join(
        environmentVariables.XDG_DATA_HOME ??
          pathApi.join(homeDirectory, '.local', 'share'),
        APP_NAME,
      );
    }
  }

  return pathApi.join(dataDirectory, databaseName);
}

export function ensureDatabaseDirectory(databasePath: string): void {
  mkdirSync(path.dirname(databasePath), { recursive: true });
}
