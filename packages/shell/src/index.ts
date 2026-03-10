/**
 * @aspect/shell – A bash-like shell interpreter for WebContainers.
 *
 * @packageDocumentation
 */

// Shell class – main entry point
export { Shell, type ShellOptions, type ShellWritable, type ShellReadable } from './shell.js';

// Tokenizer
export { tokenize, TokenType, type Token } from './tokenizer.js';

// Parser & AST
export {
  parse,
  Parser,
  ParseError,
  type ASTNode,
  type CommandNode,
  type PipelineNode,
  type SequenceNode,
  type BackgroundNode,
  type SubshellNode,
  type Redirect,
} from './parser.js';

// Built-in commands
export { builtins, type BuiltinFn, type ShellContext } from './builtins.js';

// Glob expansion
export { expandGlob, hasGlobChars, type ReaddirFn, type ReaddirEntry } from './glob.js';

// Executor
export {
  Executor,
  type ExecutorOptions,
  type SpawnFunction,
  type SpawnResult,
} from './executor.js';
