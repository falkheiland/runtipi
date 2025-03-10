// const spy = vi.spyOn(dockerHelpers, 'compose').mockImplementation(() => Promise.resolve({ stdout: '', stderr: randomError }));

import { vi, it, describe, beforeEach, expect } from 'vitest';
import { faker } from '@faker-js/faker';
import fs from 'fs';
import { compose } from './docker-helpers';

const execAsync = vi.fn().mockImplementation(() => Promise.resolve({ stdout: '', stderr: '' }));

vi.mock('@runtipi/shared/node', async (importOriginal) => {
  const mod = (await importOriginal()) as object;

  return {
    ...mod,
    FileLogger: vi.fn().mockImplementation(() => ({
      flush: vi.fn(),
      error: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      debug: vi.fn(),
    })),
    execAsync: (cmd: string) => execAsync(cmd),
  };
});

beforeEach(async () => {
  vi.resetModules();
});

describe('docker helpers', async () => {
  it('should call execAsync with correct args', async () => {
    // arrange
    const appId = faker.word.noun().toLowerCase();
    const command = faker.word.noun().toLowerCase();

    // act
    await compose(appId, command);

    // assert
    const expected = [
      'docker-compose',
      `--env-file /storage/app-data/${appId}/app.env`,
      `--project-name ${appId}`,
      `-f /app/apps/${appId}/docker-compose.yml`,
      '-f /app/repos/repo-id/apps/docker-compose.common.yml',
      command,
    ].join(' ');

    expect(execAsync).toHaveBeenCalledWith(expected);
  });

  it('should add user env file if exists', async () => {
    // arrange
    const appId = faker.word.noun().toLowerCase();
    const command = faker.word.noun().toLowerCase();
    await fs.promises.mkdir(`/app/user-config/${appId}`, { recursive: true });
    const userEnvFile = `/app/user-config/${appId}/app.env`;
    await fs.promises.writeFile(userEnvFile, 'test');

    // act
    await compose(appId, command);

    // assert
    const expected = [
      'docker-compose',
      `--env-file /storage/app-data/${appId}/app.env`,
      `--env-file ${userEnvFile}`,
      `--project-name ${appId}`,
      `-f /app/apps/${appId}/docker-compose.yml`,
      '-f /app/repos/repo-id/apps/docker-compose.common.yml',
      command,
    ].join(' ');

    expect(execAsync).toHaveBeenCalledWith(expected);
  });

  it('should add user compose file if exists', async () => {
    // arrange
    const appId = faker.word.noun().toLowerCase();
    const command = faker.word.noun().toLowerCase();
    await fs.promises.mkdir(`/app/user-config/${appId}`, { recursive: true });
    const userComposeFile = `/app/user-config/${appId}/docker-compose.yml`;
    await fs.promises.writeFile(userComposeFile, 'test');

    // act
    await compose(appId, command);

    // assert
    const expected = [
      'docker-compose',
      `--env-file /storage/app-data/${appId}/app.env`,
      `--project-name ${appId}`,
      `-f /app/apps/${appId}/docker-compose.yml`,
      '-f /app/repos/repo-id/apps/docker-compose.common.yml',
      `--file ${userComposeFile}`,
      command,
    ].join(' ');

    expect(execAsync).toHaveBeenCalledWith(expected);
  });

  it('should add arm64 compose file if exists and arch is arm64', async () => {
    // arrange
    vi.mock('@/lib/environment', async (importOriginal) => {
      const mod = (await importOriginal()) as object;
      return { ...mod, getEnv: () => ({ arch: 'arm64', appsRepoId: 'repo-id' }) };
    });
    const appId = faker.word.noun().toLowerCase();
    const command = faker.word.noun().toLowerCase();
    await fs.promises.mkdir(`/app/apps/${appId}`, { recursive: true });
    const arm64ComposeFile = `/app/apps/${appId}/docker-compose.arm64.yml`;
    await fs.promises.writeFile(arm64ComposeFile, 'test');

    // act
    await compose(appId, command);

    // assert
    const expected = [
      'docker-compose',
      `--env-file /storage/app-data/${appId}/app.env`,
      `--project-name ${appId}`,
      `-f ${arm64ComposeFile}`,
      `-f /app/repos/repo-id/apps/docker-compose.common.yml`,
      command,
    ].join(' ');

    expect(execAsync).toHaveBeenCalledWith(expected);
  });
});
