/**
 * Shell parser - converts a token stream into an AST.
 *
 * Grammar (loosely):
 *   list       → sequence (NEWLINE | EOF)
 *   sequence   → pipeline ((AND | OR | SEMICOLON) pipeline)*
 *   pipeline   → command (PIPE command)*
 *   command    → WORD+ [redirects] | LPAREN list RPAREN [redirects]
 *   redirect   → (REDIRECT_OUT | REDIRECT_APPEND | REDIRECT_IN) WORD
 *
 * A trailing `&` converts the preceding pipeline to a Background node.
 */

import { type Token, TokenType } from './tokenizer.js';

// ── AST Node Types ──────────────────────────────────────────────────────────

export interface Redirect {
  /** The redirection operator used. */
  op: '>' | '>>' | '<';
  /** Target file path. */
  file: string;
  /** File descriptor being redirected (default: 1 for > / >>, 0 for <). */
  fd: number;
}

export interface CommandNode {
  type: 'command';
  cmd: string;
  args: string[];
  redirects: Redirect[];
}

export interface PipelineNode {
  type: 'pipeline';
  commands: ASTNode[];
}

export interface SequenceNode {
  type: 'sequence';
  left: ASTNode;
  right: ASTNode;
  operator: '&&' | '||' | ';';
}

export interface BackgroundNode {
  type: 'background';
  command: ASTNode;
}

export interface SubshellNode {
  type: 'subshell';
  body: ASTNode;
  redirects: Redirect[];
}

export type ASTNode =
  | CommandNode
  | PipelineNode
  | SequenceNode
  | BackgroundNode
  | SubshellNode;

// ── Parser ──────────────────────────────────────────────────────────────────

export class ParseError extends Error {
  constructor(
    message: string,
    public position: number,
  ) {
    super(message);
    this.name = 'ParseError';
  }
}

export class Parser {
  private tokens: Token[];
  private pos: number;

  constructor(tokens: Token[]) {
    this.tokens = tokens;
    this.pos = 0;
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private peek(): Token {
    return this.tokens[this.pos];
  }

  private advance(): Token {
    const tok = this.tokens[this.pos];
    this.pos++;
    return tok;
  }

  private expect(type: TokenType): Token {
    const tok = this.peek();
    if (tok.type !== type) {
      throw new ParseError(
        `Expected ${type} but got ${tok.type} ("${tok.value}")`,
        tok.position,
      );
    }
    return this.advance();
  }

  private match(...types: TokenType[]): boolean {
    return types.includes(this.peek().type);
  }

  private skipNewlines(): void {
    while (this.peek().type === TokenType.NEWLINE) {
      this.advance();
    }
  }

  // ── Public entry point ─────────────────────────────────────────────────

  /**
   * Parse the full token stream and return a single AST node
   * (or `null` if the input is empty).
   */
  parse(): ASTNode | null {
    this.skipNewlines();
    if (this.peek().type === TokenType.EOF) return null;

    const node = this.parseList();
    this.skipNewlines();

    if (this.peek().type !== TokenType.EOF) {
      const tok = this.peek();
      throw new ParseError(
        `Unexpected token ${tok.type} ("${tok.value}")`,
        tok.position,
      );
    }
    return node;
  }

  // ── Grammar rules ──────────────────────────────────────────────────────

  /**
   * list → sequence ((NEWLINE | SEMICOLON) sequence)*
   */
  private parseList(): ASTNode {
    let node = this.parseSequence();

    while (
      this.peek().type === TokenType.NEWLINE ||
      this.peek().type === TokenType.SEMICOLON
    ) {
      const opToken = this.advance();
      this.skipNewlines();
      if (
        this.peek().type === TokenType.EOF ||
        this.peek().type === TokenType.RPAREN
      ) {
        break; // trailing newline / semicolon
      }
      const right = this.parseSequence();
      node = {
        type: 'sequence',
        left: node,
        right,
        operator: ';',
      } satisfies SequenceNode;
    }

    return node;
  }

  /**
   * sequence → pipeline_or_bg ((AND | OR) pipeline_or_bg)*
   */
  private parseSequence(): ASTNode {
    let node = this.parsePipelineOrBackground();

    while (
      this.peek().type === TokenType.AND ||
      this.peek().type === TokenType.OR
    ) {
      const opToken = this.advance();
      const operator = opToken.value as '&&' | '||';
      this.skipNewlines();
      const right = this.parsePipelineOrBackground();
      node = {
        type: 'sequence',
        left: node,
        right,
        operator,
      } satisfies SequenceNode;
    }

    return node;
  }

  /**
   * pipeline_or_bg → pipeline (BACKGROUND)?
   */
  private parsePipelineOrBackground(): ASTNode {
    const node = this.parsePipeline();

    if (this.peek().type === TokenType.BACKGROUND) {
      this.advance();
      return { type: 'background', command: node } satisfies BackgroundNode;
    }

    return node;
  }

  /**
   * pipeline → command (PIPE command)*
   */
  private parsePipeline(): ASTNode {
    const first = this.parseCommand();
    const commands: ASTNode[] = [first];

    while (this.peek().type === TokenType.PIPE) {
      this.advance();
      this.skipNewlines();
      commands.push(this.parseCommand());
    }

    if (commands.length === 1) return commands[0];
    return { type: 'pipeline', commands } satisfies PipelineNode;
  }

  /**
   * command → simple_command | subshell
   * simple_command → WORD+ [redirects]
   * subshell → LPAREN list RPAREN [redirects]
   */
  private parseCommand(): ASTNode {
    // Subshell
    if (this.peek().type === TokenType.LPAREN) {
      this.advance();
      this.skipNewlines();
      const body = this.parseList();
      this.expect(TokenType.RPAREN);
      const redirects = this.parseRedirects();
      return { type: 'subshell', body, redirects } satisfies SubshellNode;
    }

    const words: string[] = [];
    const redirects: Redirect[] = [];
    const startPos = this.peek().position;

    while (true) {
      const tok = this.peek();

      // Redirect operators can appear anywhere among the words
      if (
        tok.type === TokenType.REDIRECT_OUT ||
        tok.type === TokenType.REDIRECT_APPEND ||
        tok.type === TokenType.REDIRECT_IN
      ) {
        redirects.push(this.parseSingleRedirect());
        continue;
      }

      if (tok.type === TokenType.WORD) {
        // Check for fd-prefixed redirects like "2>" "2>>" "1<"
        const fdRedirect = this.tryFdRedirect();
        if (fdRedirect) {
          redirects.push(fdRedirect);
          continue;
        }
        words.push(this.advance().value);
        continue;
      }

      break;
    }

    if (words.length === 0) {
      const tok = this.peek();
      throw new ParseError(
        `Expected command but got ${tok.type} ("${tok.value}")`,
        tok.position,
      );
    }

    const [cmd, ...args] = words;
    return { type: 'command', cmd, args, redirects } satisfies CommandNode;
  }

  // ── Redirect parsing ──────────────────────────────────────────────────

  private parseRedirects(): Redirect[] {
    const redirects: Redirect[] = [];
    while (true) {
      const tok = this.peek();
      if (
        tok.type === TokenType.REDIRECT_OUT ||
        tok.type === TokenType.REDIRECT_APPEND ||
        tok.type === TokenType.REDIRECT_IN
      ) {
        redirects.push(this.parseSingleRedirect());
      } else {
        break;
      }
    }
    return redirects;
  }

  private parseSingleRedirect(): Redirect {
    const opToken = this.advance();
    const file = this.expect(TokenType.WORD).value;

    let op: '>' | '>>' | '<';
    let fd: number;

    switch (opToken.type) {
      case TokenType.REDIRECT_OUT:
        op = '>';
        fd = 1;
        break;
      case TokenType.REDIRECT_APPEND:
        op = '>>';
        fd = 1;
        break;
      case TokenType.REDIRECT_IN:
        op = '<';
        fd = 0;
        break;
      default:
        throw new ParseError(`Unexpected redirect token ${opToken.type}`, opToken.position);
    }

    return { op, file, fd };
  }

  /**
   * Try to match a WORD token that is purely a digit followed by a redirect
   * operator (e.g. `2>`, `1>>`, `0<`). Returns a Redirect or null.
   */
  private tryFdRedirect(): Redirect | null {
    const tok = this.peek();
    if (tok.type !== TokenType.WORD) return null;
    if (!/^\d+$/.test(tok.value)) return null;

    const nextPos = this.pos + 1;
    if (nextPos >= this.tokens.length) return null;
    const nextTok = this.tokens[nextPos];

    if (
      nextTok.type !== TokenType.REDIRECT_OUT &&
      nextTok.type !== TokenType.REDIRECT_APPEND &&
      nextTok.type !== TokenType.REDIRECT_IN
    ) {
      return null;
    }

    const fd = parseInt(tok.value, 10);
    this.advance(); // consume the fd number

    const opToken = this.advance(); // consume the redirect operator
    const file = this.expect(TokenType.WORD).value;

    let op: '>' | '>>' | '<';
    switch (opToken.type) {
      case TokenType.REDIRECT_OUT:
        op = '>';
        break;
      case TokenType.REDIRECT_APPEND:
        op = '>>';
        break;
      case TokenType.REDIRECT_IN:
        op = '<';
        break;
      default:
        op = '>';
    }

    return { op, file, fd };
  }
}

/**
 * Convenience function: parse a token array into an AST.
 */
export function parse(tokens: Token[]): ASTNode | null {
  return new Parser(tokens).parse();
}
