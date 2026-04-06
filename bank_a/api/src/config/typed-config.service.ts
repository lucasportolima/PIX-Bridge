import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EnvConfig } from './env.config';

/**
 * Thin wrapper around ConfigService that enforces strict typing.
 * Eliminates `any` casts when reading environment variables throughout the app.
 */
@Injectable()
export class TypedConfigService {
  constructor(private readonly config: ConfigService<EnvConfig, true>) {}

  get<K extends keyof EnvConfig>(key: K): EnvConfig[K] {
    return this.config.get(key, { infer: true });
  }
}
