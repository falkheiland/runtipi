import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { envMapToString, envStringToMap, settingsSchema } from '@runtipi/shared';
import { pathExists } from '@runtipi/shared/node';
import { logger } from '@/utils/logger/logger';

type EnvKeys =
  | 'APPS_REPO_ID'
  | 'APPS_REPO_URL'
  | 'TZ'
  | 'INTERNAL_IP'
  | 'DNS_IP'
  | 'ARCHITECTURE'
  | 'TIPI_VERSION'
  | 'JWT_SECRET'
  | 'ROOT_FOLDER_HOST'
  | 'NGINX_PORT'
  | 'NGINX_PORT_SSL'
  | 'DOMAIN'
  | 'STORAGE_PATH'
  | 'POSTGRES_PORT'
  | 'POSTGRES_HOST'
  | 'POSTGRES_DBNAME'
  | 'POSTGRES_PASSWORD'
  | 'POSTGRES_USERNAME'
  | 'REDIS_HOST'
  | 'REDIS_PASSWORD'
  | 'LOCAL_DOMAIN'
  | 'DEMO_MODE'
  | 'GUEST_DASHBOARD'
  | 'TIPI_GID'
  | 'TIPI_UID'
  // eslint-disable-next-line @typescript-eslint/ban-types
  | (string & {});

/**
 * Reads and returns the generated seed
 */
const getSeed = async () => {
  const rootFolder = process.cwd();

  const seedFilePath = path.join(rootFolder, 'state', 'seed');

  if (!(await pathExists(seedFilePath))) {
    throw new Error('Seed file not found');
  }

  const seed = await fs.promises.readFile(seedFilePath, 'utf-8');

  return seed;
};

/**
 * Derives a new entropy value from the provided entropy and the seed
 * @param {string} entropy - The entropy value to derive from
 */
const deriveEntropy = async (entropy: string) => {
  const seed = await getSeed();
  const hmac = crypto.createHmac('sha256', seed);
  hmac.update(entropy);

  return hmac.digest('hex');
};

/**
 * Generates a random seed if it does not exist yet
 */
const generateSeed = async (rootFolder: string) => {
  if (!(await pathExists(path.join(rootFolder, 'state', 'seed')))) {
    const randomBytes = crypto.randomBytes(32);
    const seed = randomBytes.toString('hex');

    await fs.promises.writeFile(path.join(rootFolder, 'state', 'seed'), seed);
  }
};

/**
 * Will return the first internal IP address of the current system
 */
const getInternalIp = () => {
  const interfaces = os.networkInterfaces();

  for (let i = 0; i < Object.keys(interfaces).length; i += 1) {
    const devName = Object.keys(interfaces)[i];
    const iface = interfaces[devName || ''];

    const length = iface?.length || 0;
    for (let j = 0; j < length; j += 1) {
      const alias = iface?.[j];

      if (alias && alias.family === 'IPv4' && alias.address !== '127.0.0.1' && !alias.internal) return alias.address;
    }
  }

  return '0.0.0.0';
};

/**
 * Returns the architecture of the current system
 */
const getArchitecture = () => {
  const arch = os.arch();

  if (arch === 'arm64') return 'arm64';
  if (arch === 'x64') return 'amd64';

  throw new Error(`Unsupported architecture: ${arch}`);
};

/**
 * Generates a valid .env file from the settings.json file
 */
export const generateSystemEnvFile = async (params: { customEnvFile?: string }) => {
  const rootFolder = process.cwd();
  await fs.promises.mkdir(path.join(rootFolder, 'state'), { recursive: true });
  const settingsFilePath = path.join(rootFolder, 'state', 'settings.json');
  const envFilePath = path.join(rootFolder, '.env');

  if (!(await pathExists(envFilePath))) {
    await fs.promises.writeFile(envFilePath, '');
  }

  const envFile = await fs.promises.readFile(envFilePath, 'utf-8');
  const envMap: Map<EnvKeys, string> = envStringToMap(envFile);

  if (!(await pathExists(settingsFilePath))) {
    await fs.promises.writeFile(settingsFilePath, JSON.stringify({}));
  }

  const settingsFile = await fs.promises.readFile(settingsFilePath, 'utf-8');

  const settings = settingsSchema.safeParse(JSON.parse(settingsFile));

  if (!settings.success) {
    throw new Error(`Invalid settings.json file: ${settings.error.message}`);
  }

  await generateSeed(rootFolder);

  const { data } = settings;

  const postgresPassword = envMap.get('POSTGRES_PASSWORD') || (await deriveEntropy('postgres_password'));
  const redisPassword = envMap.get('REDIS_PASSWORD') || (await deriveEntropy('redis_password'));

  const version = await fs.promises.readFile(path.join(rootFolder, 'VERSION'), 'utf-8');

  const newEnvMap = new Map<EnvKeys, string>();

  newEnvMap.set('INTERNAL_IP', data.listenIp || getInternalIp());
  newEnvMap.set('ARCHITECTURE', getArchitecture());
  newEnvMap.set('TIPI_VERSION', version);
  newEnvMap.set('ROOT_FOLDER_HOST', rootFolder);
  newEnvMap.set('NGINX_PORT', String(data.port || 80));
  newEnvMap.set('NGINX_PORT_SSL', String(data.sslPort || 443));
  newEnvMap.set('STORAGE_PATH', data.storagePath || rootFolder);
  newEnvMap.set('POSTGRES_PASSWORD', postgresPassword);
  newEnvMap.set('POSTGRES_PORT', String(data.postgresPort || 5432));
  newEnvMap.set('REDIS_HOST', 'tipi-redis');
  newEnvMap.set('REDIS_PASSWORD', redisPassword);
  newEnvMap.set('NODE_ENV', 'production');
  newEnvMap.set('DOMAIN', data.domain || 'example.com');
  newEnvMap.set('LOCAL_DOMAIN', data.localDomain || 'tipi.lan');

  const { customEnvFile } = params;

  // Override env variables with custom env file if provided
  if (customEnvFile) {
    const customEnvFilePath = path.join(path.isAbsolute(customEnvFile) ? '' : rootFolder, customEnvFile);

    if (await pathExists(customEnvFilePath)) {
      const customEnvFileContent = await fs.promises.readFile(customEnvFilePath, 'utf-8');
      const customEnvMap = envStringToMap(customEnvFileContent);
      customEnvMap.forEach((value, key) => {
        newEnvMap.set(key, value);
      });
    }
  }

  await fs.promises.writeFile(envFilePath, envMapToString(newEnvMap));

  return newEnvMap;
};

/**
 * Copies the system files from the assets folder to the current working directory
 */
export const copySystemFiles = async () => {
  if (process.env.NODE_ENV === 'development') {
    logger.info('Skipping copying of system files in development mode');
    return;
  }
  // Remove old unused files
  const assetsFolder = path.join('/snapshot', 'runtipi', 'packages', 'cli', 'assets');

  // Copy docker-compose.yml file
  logger.info('Copying file docker-compose.yml');
  await fs.promises.copyFile(path.join(assetsFolder, 'docker-compose.yml'), path.join(process.cwd(), 'docker-compose.yml'));

  // Copy VERSION file
  logger.info('Copying file VERSION');
  await fs.promises.copyFile(path.join(assetsFolder, 'VERSION'), path.join(process.cwd(), 'VERSION'));
};
