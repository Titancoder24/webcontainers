/**
 * Shell tokenizer - converts input strings into a stream of tokens
 * for the shell parser. Handles quoting, escaping, and operator recognition.
 */

export enum TokenType {
  WORD = 'WORD',
  PIPE = 'PIPE',
  AND = 'AND',
  OR = 'OR',
  SEMICOLON = 'SEMICOLON',
  REDIRECT_OUT = 'REDIRECT_OUT',
  REDIRECT_APPEND = 'REDIRECT_APPEND',
  REDIRECT_IN = 'REDIRECT_IN',
  BACKGROUND = 'BACKGROUND',
  LPAREN = 'LPAREN',
  RPAREN = 'RPAREN',
  NEWLINE = 'NEWLINE',
  EOF = 'EOF',
}

export interface Token {
  type: TokenType;
  value: string;
  /** Character offset in the original input where this token starts. */
  position: number;
}

/**
 * Tokenize a shell input string into an array of {@link Token}s.
 *
 * Supported constructs:
 * - Double-quoted strings: `"hello world"` – preserves content, allows `\` escapes
 * - Single-quoted strings: `'hello world'` – literal, no escaping
 * - Backslash escaping outside quotes
 * - Operators: `|`, `&&`, `||`, `;`, `>`, `>>`, `<`, `&`, `(`, `)`, newline
 * - Unquoted word splitting on whitespace
 */
export function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let pos = 0;
  const len = input.length;

  while (pos < len) {
    // Skip spaces and tabs (not newlines – those are tokens)
    if (input[pos] === ' ' || input[pos] === '\t') {
      pos++;
      continue;
    }

    // Comments – skip to end of line
    if (input[pos] === '#') {
      while (pos < len && input[pos] !== '\n') {
        pos++;
      }
      continue;
    }

    // Newline
    if (input[pos] === '\n') {
      tokens.push({ type: TokenType.NEWLINE, value: '\n', position: pos });
      pos++;
      continue;
    }

    // Two-character operators
    if (pos + 1 < len) {
      const two = input[pos] + input[pos + 1];
      if (two === '&&') {
        tokens.push({ type: TokenType.AND, value: '&&', position: pos });
        pos += 2;
        continue;
      }
      if (two === '||') {
        tokens.push({ type: TokenType.OR, value: '||', position: pos });
        pos += 2;
        continue;
      }
      if (two === '>>') {
        tokens.push({ type: TokenType.REDIRECT_APPEND, value: '>>', position: pos });
        pos += 2;
        continue;
      }
    }

    // Single-character operators
    if (input[pos] === '|') {
      tokens.push({ type: TokenType.PIPE, value: '|', position: pos });
      pos++;
      continue;
    }
    if (input[pos] === ';') {
      tokens.push({ type: TokenType.SEMICOLON, value: ';', position: pos });
      pos++;
      continue;
    }
    if (input[pos] === '>') {
      tokens.push({ type: TokenType.REDIRECT_OUT, value: '>', position: pos });
      pos++;
      continue;
    }
    if (input[pos] === '<') {
      tokens.push({ type: TokenType.REDIRECT_IN, value: '<', position: pos });
      pos++;
      continue;
    }
    if (input[pos] === '&') {
      tokens.push({ type: TokenType.BACKGROUND, value: '&', position: pos });
      pos++;
      continue;
    }
    if (input[pos] === '(') {
      tokens.push({ type: TokenType.LPAREN, value: '(', position: pos });
      pos++;
      continue;
    }
    if (input[pos] === ')') {
      tokens.push({ type: TokenType.RPAREN, value: ')', position: pos });
      pos++;
      continue;
    }

    // Word (may contain quoted segments, escape sequences, etc.)
    const wordStart = pos;
    let word = '';

    while (pos < len) {
      const ch = input[pos];

      // Unquoted whitespace / operator characters end the word
      if (ch === ' ' || ch === '\t' || ch === '\n') break;
      if (ch === '|' || ch === ';' || ch === '(' || ch === ')' || ch === '<' || ch === '#') break;
      if (ch === '>' && word.length > 0) break; // allow "2>" later
      if (ch === '>') break;
      if (ch === '&') {
        // '&' by itself or '&&' ends the word
        break;
      }

      // Backslash escape (outside quotes)
      if (ch === '\\') {
        pos++;
        if (pos < len) {
          if (input[pos] === '\n') {
            // Line continuation – skip both characters
            pos++;
            continue;
          }
          word += input[pos];
          pos++;
        }
        continue;
      }

      // Double-quoted string
      if (ch === '"') {
        pos++; // skip opening quote
        while (pos < len && input[pos] !== '"') {
          if (input[pos] === '\\') {
            pos++;
            if (pos < len) {
              const esc = input[pos];
              // In double quotes, only these characters are special after backslash
              if (esc === '"' || esc === '\\' || esc === '$' || esc === '`' || esc === '\n') {
                if (esc === '\n') {
                  // Line continuation inside double quotes
                  pos++;
                  continue;
                }
                word += esc;
              } else {
                // Backslash is literal when not before a special char
                word += '\\' + esc;
              }
              pos++;
            }
          } else {
            word += input[pos];
            pos++;
          }
        }
        if (pos < len) pos++; // skip closing quote
        continue;
      }

      // Single-quoted string
      if (ch === "'") {
        pos++; // skip opening quote
        while (pos < len && input[pos] !== "'") {
          word += input[pos];
          pos++;
        }
        if (pos < len) pos++; // skip closing quote
        continue;
      }

      // Regular character
      word += ch;
      pos++;
    }

    if (word.length > 0 || pos > wordStart) {
      tokens.push({ type: TokenType.WORD, value: word, position: wordStart });
    }
  }

  tokens.push({ type: TokenType.EOF, value: '', position: pos });
  return tokens;
}
