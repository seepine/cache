# AGENTS.md

## 项目概述

`@seepine/cache` 是一个轻量级 TypeScript 缓存库，发布到 npm。支持：

- 纯内存缓存（基于 LRU Cache）
- 通过 Adapter 接入外部缓存（如 Redis）
- 内存 + 外部多级缓存
- 分布式锁（无 Adapter 时自动退化为进程内锁）

## 目录结构

```
src/
  index.ts              # 主入口，Cache 类实现
  types.ts              # 类型定义（CacheAdapter 抽象类、配置类型、TtlValue 等）
  utils.ts              # 工具函数（sleep、genRandomInteger、parseTtlSecond）
  index.test.ts         # Cache 类单元测试
  index.adapter.test.ts # Adapter 模式集成测试
  utils.test.ts         # 工具函数单元测试
  adapt/
    bun.ts              # Bun Redis 适配器（BunRedisAdapter）
    bun.test.ts         # Bun 适配器测试（需 Bun 运行时，vitest 默认排除）
```

## 技术栈

- **语言**：TypeScript（strict 模式）
- **运行时**：Node.js >= 18，部分适配器依赖 Bun
- **构建**：tsdown（输出 ESM + CJS）
- **测试**：vitest（globals 模式，覆盖率用 v8）
- **格式化**：prettier（无分号、单引号）
- **版本发布**：commit-and-tag-version

## 常用命令

> 使用npm，而不是pnpm、yarn

| 命令                 | 说明                             |
| -------------------- | -------------------------------- |
| `npm run build`      | 构建产物到 dist/                 |
| `npm run tsc`        | TypeScript 类型检查（不输出）    |
| `npm run test`       | 运行所有测试（排除 bun.test.ts） |
| `npm run test:watch` | 测试监听模式                     |
| `npm run coverage`   | 运行测试并生成覆盖率报告         |
| `npm run format`     | 用 prettier 格式化 src/          |

## 编码规范

- **无分号**，使用**单引号**，缩进 **2 空格**
- 箭头函数参数始终加括号 `(x) => ...`
- 使用 `type` 关键字导入类型：`import type { ... } from '...'`
- 注释和文档使用**中文**
- 函数、类方法使用 JSDoc 风格注释
- 异步操作统一使用 `async/await`
- 导出使用 `export class` / `export function` / `export type`，入口文件通过 `export * from './types'` 重导出

## 架构要点

### Cache 类（src/index.ts）

- 构造时根据是否传入 `adapter` 决定运行模式：纯内存 or 外部缓存
- 键格式：`{namespace}:cache:{key}`（缓存）、`{namespace}:lock:{key}`（锁）
- `getOrSet` 内部使用 `lock` 防止缓存击穿
- 分布式锁实现：setnx + 看门狗自动续约 + 超时控制

### CacheAdapter 抽象类（src/types.ts）

- 自定义 Adapter 需继承 `CacheAdapter` 并实现所有抽象方法：`set`、`setnx`、`get`、`del`、`expire`、`clear`、`close`
- 值的序列化/反序列化由 Adapter 自行处理（BunRedisAdapter 使用 `JSON.stringify` / `JSON.parse`）

### TTL 格式

- 数字：秒数
- 字符串：`{number}{unit}`，支持 `y`(年)、`d`(天)、`h`(时)、`m`(分)、`s`(秒)

## 测试说明

- `src/adapt/bun.test.ts` 需要 Bun 运行时和 Redis 服务，vitest 配置中已排除
- 覆盖率同样排除 `src/adapt/bun.ts`
- 测试用例编写参考已有文件，尽量通俗简单，不要过度封装

## 新增 Adapter 指南

1. 在 `src/adapt/` 下创建新文件（如 `ioredis.ts`）
2. 实现 `CacheAdapter` 抽象类的所有方法
3. 在 `tsdown.config.ts` 的 `entry` 中添加入口
4. 编写对应测试文件

## 注意

每次新增或修改代码，应按照以下步骤进行：

- 使用 `.agents/skills/code-simplifier/SKILL.md` 这个 code-simplifier skill 对代码进行简化。
- 使用 `npm run tsc` 对代码进行类型检查，确保符合项目的类型规范。
- 使用 `npm run format` 对代码进行格式化，确保符合项目的代码规范。
- 使用 `npm run test` 对代码进行测试，确保通过测试用例。
