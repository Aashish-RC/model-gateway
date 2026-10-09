import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { z } from 'zod';

export const KeyConfigSchema = z.object({
  id: z.string(),
  key: z.string(),
  weight: z.number().default(1),
  isHealthy: z.boolean().default(true),
});

export const ProviderConfigSchema = z.object({
  baseUrl: z.string().url(),
  keys: z.array(KeyConfigSchema).default([]),
});

export const ServerConfigSchema = z.object({
  host: z.string().default('0.0.0.0'),
  port: z.number().int().positive().default(8080),
  logLevel: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

export const GatewayConfigSchema = z.object({
  timeoutMs: z.number().int().positive().default(60000),
  retryAttempts: z.number().int().nonnegative().default(3),
  rateLimit: z.object({
    maxRequestsPerMinute: z.number().int().positive().default(600),
  }).default({ maxRequestsPerMinute: 600 }),
});

export const RoutingConfigSchema = z.object({
  defaultProvider: z.string().default('openai'),
  fallbackProviders: z.array(z.string()).default(['anthropic', 'gemini']),
});

export const AppConfigSchema = z.object({
  server: ServerConfigSchema.default({
    host: '0.0.0.0',
    port: 8080,
    logLevel: 'info',
  }),
  gateway: GatewayConfigSchema.default({
    timeoutMs: 60000,
    retryAttempts: 3,
    rateLimit: { maxRequestsPerMinute: 600 },
  }),
  providers: z.record(z.string(), ProviderConfigSchema).default({}),
  routing: RoutingConfigSchema.default({
    defaultProvider: 'openai',
    fallbackProviders: ['anthropic', 'gemini'],
  }),
});

export type AppConfig = z.infer<typeof AppConfigSchema>;
export type KeyConfig = z.infer<typeof KeyConfigSchema>;
export type ProviderConfig = z.infer<typeof ProviderConfigSchema>;

export function loadConfig(configPath?: string): AppConfig {
  const resolvedPath = configPath ?? process.env.GATEWAY_CONFIG_PATH ?? path.resolve(process.cwd(), 'config/config.yaml');
  
  if (fs.existsSync(resolvedPath)) {
    const rawYaml = fs.readFileSync(resolvedPath, 'utf8');
    const parsed = YAML.parse(rawYaml) ?? {};
    return AppConfigSchema.parse(parsed);
  }

  // Fallback to example or defaults if config file does not exist
  const examplePath = path.resolve(process.cwd(), 'config/config.example.yaml');
  if (fs.existsSync(examplePath)) {
    const rawYaml = fs.readFileSync(examplePath, 'utf8');
    const parsed = YAML.parse(rawYaml) ?? {};
    return AppConfigSchema.parse(parsed);
  }

  return AppConfigSchema.parse({});
}
