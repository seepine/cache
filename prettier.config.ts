import type { Config } from 'prettier'

export default {
  // 在语句末尾打印分号
  semi: false,
  // 使用单引号而不是双引号
  singleQuote: true,
  // HTML 标签中的空格敏感度
  htmlWhitespaceSensitivity: 'ignore',

  /** =====prettier默认值===== */

  // 指定打印机将包裹的行长度
  printWidth: 80,
  // 用制表符而不是空格缩进线条
  useTabs: false,
  // 指定每个缩进级别的空格数
  tabWidth: 2,
  // 箭头函数参数只有一个时是否添加括号
  arrowParens: 'always',
  // 是否在对象字面量中打印空格
  bracketSpacing: true,
  // 尽可能打印尾随逗号
  trailingComma: 'all',
  // 每个属性是否独占一行
  singleAttributePerLine: false,
  // 方括号是否与最后一个元素在同一行
  bracketSameLine: false,
  // 在 JSX 中使用单引号而不是双引号
  jsxSingleQuote: false,
  // 是否在 Markdown 中换行
  proseWrap: 'preserve',
  // 换行符使用 LF 而不是 CRLF
  endOfLine: 'lf',
} satisfies Config
