import type { Context } from '@deepseek-ai/cordis';

export declare const name = 'big-plan';
export declare const inject: readonly ['tools', 'subagents', 'jobs'];

export interface Config {
  readonly provider?: string;
}

export declare function apply(ctx: Context, config?: Config): void;
