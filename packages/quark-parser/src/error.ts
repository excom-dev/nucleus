export class QuarkParseError extends SyntaxError {
  position: number;
  line: number;
  column: number;

  constructor(message: string, source: string, position: number) {
    let line = 1;
    let column = 1;
    const max = Math.min(position, source.length);
    for (let i = 0; i < max; i++) {
      if (source.charCodeAt(i) === 10) {
        line++;
        column = 1;
      } else {
        column++;
      }
    }
    super(`${message} (${line}:${column})`);
    this.name = "QuarkParseError";
    this.position = position;
    this.line = line;
    this.column = column;
  }
}
