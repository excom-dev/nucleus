import { QuarkParseError } from "./error";
import type { Token, TokenizeResult } from "./types";

// Character codes used by the scanner.
const TAB = 9;
const LF = 10;
const FF = 12;
const CR = 13;
const SPACE = 32;
const BANG = 33; // !
const DQUOTE = 34; // "
const HASH = 35; // #
const DOLLAR = 36; // $
const PERCENT = 37; // %
const SQUOTE = 39; // '
const LPAREN = 40; // (
const RPAREN = 41; // )
const STAR = 42; // *
const PLUS = 43; // +
const MINUS = 45; // -
const DOT = 46; // .
const SLASH = 47; // /
const COLON = 58; // :
const LT = 60; // <
const EQ = 61; // =
const GT = 62; // >
const AT = 64; // @
const BACKSLASH = 92; // \
const CARET = 94; // ^
const UNDERSCORE = 95; // _
const LBRACE = 123; // {
const PIPE = 124; // |
const RBRACE = 125; // }
const TILDE = 126; // ~

const isWs = (c: number): boolean =>
  c === SPACE || c === TAB || c === LF || c === CR || c === FF;
const isDigit = (c: number): boolean => c >= 48 && c <= 57;
const isIdentStart = (c: number): boolean =>
  (c >= 97 && c <= 122) ||
  (c >= 65 && c <= 90) ||
  c === UNDERSCORE ||
  c === BACKSLASH ||
  c >= 0x80;
const isIdentChar = (c: number): boolean =>
  isIdentStart(c) || isDigit(c) || c === MINUS;

/**
 * Single-pass tokenizer. Whitespace is not tokenized; each token carries a
 * `ws` flag indicating whether whitespace/comments preceded it. Comments are
 * returned separately so expression parsing never has to skip them.
 */
export function tokenize(source: string): TokenizeResult {
  const tokens: Token[] = [];
  const comments: Token[] = [];
  const len = source.length;
  let i = 0;
  let ws = false;

  const err = (message: string, at: number): never => {
    throw new QuarkParseError(message, source, at);
  };

  const push = (
    type: Token["type"],
    value: string,
    start: number,
    end: number,
    unit?: string,
    quote?: '"' | "'"
  ): void => {
    const token: Token = { type, value, start, end, ws };
    if (unit !== undefined) token.unit = unit;
    if (quote !== undefined) token.quote = quote;
    tokens.push(token);
    ws = false;
  };

  /** True when the previous token can end a value (for `-`/`+` handling). */
  const prevValueLike = (): boolean => {
    const t = tokens[tokens.length - 1];
    if (!t) return false;
    if (t.type === "punct") return t.value === ")" || t.value === "]";
    return t.type !== "at";
  };

  /** Skips a balanced `#{...}`; `idx` points just after the `#{`. */
  const skipInterpolation = (idx: number): number => {
    let depth = 1;
    while (idx < len && depth > 0) {
      const c = source.charCodeAt(idx);
      if (c === LBRACE) depth++;
      else if (c === RBRACE) depth--;
      else if (c === DQUOTE || c === SQUOTE) {
        idx++;
        while (idx < len && source.charCodeAt(idx) !== c) {
          if (source.charCodeAt(idx) === BACKSLASH) idx++;
          idx++;
        }
      }
      idx++;
    }
    return idx;
  };

  const scanIdent = (start: number): string => {
    let j = start;
    while (j < len) {
      const c = source.charCodeAt(j);
      if (c === BACKSLASH) {
        j += 2;
        continue;
      }
      if (!isIdentChar(c)) break;
      j++;
    }
    i = j;
    return source.slice(start, j);
  };

  const scanString = (quote: number): void => {
    const start = i;
    i++;
    while (i < len) {
      const c = source.charCodeAt(i);
      if (c === quote) break;
      if (c === BACKSLASH) {
        i += 2;
        continue;
      }
      if (c === HASH && source.charCodeAt(i + 1) === LBRACE) {
        i = skipInterpolation(i + 2);
        continue;
      }
      i++;
    }
    if (i >= len) err("Unterminated string", start);
    push(
      "string",
      source.slice(start + 1, i),
      start,
      i + 1,
      undefined,
      quote === DQUOTE ? '"' : "'"
    );
    i++;
  };

  /** `start` may point at a sign, a leading dot, or a digit. */
  const scanNumber = (start: number): void => {
    let j = start;
    const first = source.charCodeAt(j);
    if (first === MINUS || first === PLUS) j++;
    while (isDigit(source.charCodeAt(j))) j++;
    if (source.charCodeAt(j) === DOT && isDigit(source.charCodeAt(j + 1))) {
      j++;
      while (isDigit(source.charCodeAt(j))) j++;
    }
    // Exponent (`2e3`, `2e-3`), but not units that start with `e` (`2em`).
    const e = source.charCodeAt(j);
    if (e === 101 || e === 69) {
      let k = j + 1;
      const s = source.charCodeAt(k);
      if (s === MINUS || s === PLUS) k++;
      if (isDigit(source.charCodeAt(k))) {
        k++;
        while (isDigit(source.charCodeAt(k))) k++;
        j = k;
      }
    }
    const numEnd = j;
    let unit: string | undefined;
    if (source.charCodeAt(j) === PERCENT) {
      unit = "%";
      j++;
    } else if (isIdentStart(source.charCodeAt(j))) {
      const u = j;
      while (j < len && isIdentChar(source.charCodeAt(j))) j++;
      unit = source.slice(u, j);
    }
    push("number", source.slice(start, numEnd), start, j, unit);
    i = j;
  };

  /**
   * Attempts to scan the contents of an unquoted `url(...)`. Returns `null`
   * (without emitting) when the contents look like a normal expression
   * (quoted string, variable, ...), in which case regular tokenization
   * continues from the `(`.
   */
  const tryScanRawUrl = (): {
    rawStart: number;
    rawEnd: number;
    endAfterParen: number;
  } | null => {
    let j = i + 1; // after "("
    while (j < len && isWs(source.charCodeAt(j))) j++;
    const q = source.charCodeAt(j);
    if (q === DQUOTE || q === SQUOTE || q === DOLLAR || q === RPAREN) {
      return null;
    }
    const rawStart = j;
    let lastNonWs = j - 1;
    let sawWs = false;
    while (j < len) {
      const c = source.charCodeAt(j);
      if (c === RPAREN) break;
      if (c === BACKSLASH) {
        j += 2;
        lastNonWs = j - 1;
        continue;
      }
      if (c === HASH && source.charCodeAt(j + 1) === LBRACE) {
        j = skipInterpolation(j + 2);
        lastNonWs = j - 1;
        continue;
      }
      if (c === DQUOTE || c === SQUOTE || c === LPAREN || c === DOLLAR) {
        return null;
      }
      if (isWs(c)) {
        sawWs = true;
      } else {
        if (sawWs) return null; // internal whitespace: not a raw url
        lastNonWs = j;
      }
      j++;
    }
    if (j >= len || lastNonWs < rawStart) return null;
    return { rawStart, rawEnd: lastNonWs + 1, endAfterParen: j + 1 };
  };

  while (i < len) {
    const c = source.charCodeAt(i);

    if (isWs(c)) {
      i++;
      ws = true;
      continue;
    }

    // `/* */` comments and the `/` operator.
    if (c === SLASH) {
      const n = source.charCodeAt(i + 1);
      if (n === SLASH) err("Line comments are not supported, use /* */", i);
      if (n === STAR) {
        const start = i;
        i += 2;
        while (
          i < len &&
          !(source.charCodeAt(i) === STAR && source.charCodeAt(i + 1) === SLASH)
        ) {
          i++;
        }
        if (i >= len) err("Unterminated comment", start);
        comments.push({
          type: "comment",
          value: source.slice(start + 2, i),
          start,
          end: i + 2,
          ws,
        });
        i += 2;
        ws = true;
        continue;
      }
      push("punct", "/", i, i + 1);
      i++;
      continue;
    }

    if (c === DQUOTE || c === SQUOTE) {
      scanString(c);
      continue;
    }

    if (isDigit(c)) {
      scanNumber(i);
      continue;
    }

    if (c === DOT) {
      if (isDigit(source.charCodeAt(i + 1))) {
        scanNumber(i);
        continue;
      }
      if (
        source.charCodeAt(i + 1) === DOT &&
        source.charCodeAt(i + 2) === DOT
      ) {
        push("punct", "...", i, i + 3);
        i += 3;
        continue;
      }
      push("punct", ".", i, i + 1);
      i++;
      continue;
    }

    if (c === MINUS || c === PLUS) {
      const n = source.charCodeAt(i + 1);
      const startsNumber =
        isDigit(n) || (n === DOT && isDigit(source.charCodeAt(i + 2)));
      /*
       * A sign when at an expression start, or when in the `10px -5px`
       * shape (whitespace before, none after). `10-5` and `10 - 5` stay
       * subtraction.
       */
      const isSign = !prevValueLike() || (ws && !isWs(n));
      if (startsNumber && isSign) {
        scanNumber(i);
        continue;
      }
      if (c === MINUS && (isIdentStart(n) || n === MINUS) && isSign) {
        const start = i;
        i++; // include the '-' via slice below
        scanIdent(i);
        push("ident", source.slice(start, i), start, i);
        continue;
      }
      push("punct", c === MINUS ? "-" : "+", i, i + 1);
      i++;
      continue;
    }

    if (c === DOLLAR) {
      const n = source.charCodeAt(i + 1);
      if (isIdentStart(n) || isDigit(n)) {
        const start = i;
        const value = scanIdent(i + 1);
        push("variable", value, start, i);
        continue;
      }
      if (n === EQ) {
        push("punct", "$=", i, i + 2);
        i += 2;
        continue;
      }
      push("punct", "$", i, i + 1);
      i++;
      continue;
    }

    if (c === AT) {
      const n = source.charCodeAt(i + 1);
      if (isIdentStart(n) || n === MINUS) {
        const start = i;
        const value = scanIdent(i + 1);
        push("at", value, start, i);
        continue;
      }
      push("punct", "@", i, i + 1);
      i++;
      continue;
    }

    if (c === HASH) {
      const n = source.charCodeAt(i + 1);
      if (n === LBRACE) {
        push("punct", "#{", i, i + 2);
        i += 2;
        continue;
      }
      if (isIdentChar(n)) {
        const start = i;
        let j = i + 1;
        while (j < len && isIdentChar(source.charCodeAt(j))) j++;
        push("hash", source.slice(start + 1, j), start, j);
        i = j;
        continue;
      }
      push("punct", "#", i, i + 1);
      i++;
      continue;
    }

    if (isIdentStart(c)) {
      const start = i;
      const value = scanIdent(start);
      if (
        source.charCodeAt(i) === LPAREN &&
        (value === "url" || value === "URL" || value === "Url")
      ) {
        const parenAt = i;
        const url = tryScanRawUrl();
        if (url) {
          push("ident", value, start, parenAt);
          push("punct", "(", parenAt, parenAt + 1);
          push(
            "url",
            source.slice(url.rawStart, url.rawEnd),
            url.rawStart,
            url.rawEnd
          );
          push("punct", ")", url.endAfterParen - 1, url.endAfterParen);
          i = url.endAfterParen;
          continue;
        }
      }
      push("ident", value, start, i);
      continue;
    }

    // Multi-character and single-character punctuation.
    const n = source.charCodeAt(i + 1);
    let punct: string | null = null;
    switch (c) {
      case EQ:
        punct = n === EQ ? "==" : "=";
        break;
      case BANG:
        punct = n === EQ ? "!=" : "!";
        break;
      case LT:
        punct = n === EQ ? "<=" : "<";
        break;
      case GT:
        punct = n === EQ ? ">=" : ">";
        break;
      case COLON:
        punct = n === COLON ? "::" : ":";
        break;
      case STAR:
        punct = n === EQ ? "*=" : "*";
        break;
      case TILDE:
        punct = n === EQ ? "~=" : "~";
        break;
      case CARET:
        punct = n === EQ ? "^=" : "^";
        break;
      case PIPE:
        punct = n === EQ ? "|=" : "|";
        break;
      default:
        punct = source[i];
    }
    push("punct", punct, i, i + punct.length);
    i += punct.length;
  }

  return { tokens, comments };
}
