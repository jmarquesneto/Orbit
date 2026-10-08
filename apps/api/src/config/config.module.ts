import { Global, Module } from '@nestjs/common';
import { Env, parseEnv } from './env.schema.js';

export const ENV = Symbol('ENV');

@Global()
@Module({
  providers: [{ provide: ENV, useFactory: (): Env => Object.freeze(parseEnv(process.env)) }],
  exports: [ENV],
})
export class ConfigModule {}
