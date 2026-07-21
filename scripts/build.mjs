#!/usr/bin/env node
// esbuild 打包配置（esbuild CLI 无配置文件，用 JS API 传 options）。类型检查由 tsc 负责。
import * as esbuild from 'esbuild';

/** @type {import('esbuild').BuildOptions} */
const options = {
  entryPoints: ['src/main.ts'],
  bundle: true,
  // IIFE + main.ts 里的 globalThis 赋值 = 脚本全局，无需 CJS，minBobVersion 保持 1.6.0
  format: 'iife',
  target: 'es2019', // 兼容旧版 Bob 的 JavaScriptCore
  outfile: 'dist/main.js',
  logLevel: 'info',
};

if (process.argv.includes('--watch')) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log('esbuild 正在监听 src/ 变更…');
} else {
  await esbuild.build(options);
}
