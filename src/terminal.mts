import {
  Pseudoterminal,
  EventEmitter,
  Event,
  TerminalDimensions,
} from "vscode";
import History from "./models/history.mjs";

const PROMPT = ">>> ";
const DEL = (count: number) => `\x1b[${count}D\x1b[1P`;
// Ctrl+D; Ctrl+E
const IGNORED_CHARS = ["\x04", "\x05"];

export class Terminal implements Pseudoterminal {
  private openingMessageCallback: () => Promise<string>;

  private writeEmitter = new EventEmitter<string>();
  private closeEmitter = new EventEmitter<void | number>();
  private submitEmitter = new EventEmitter<string>();
  private isOpen = false;
  private buffer = "";
  private multilineMode = false;
  private indentation = 0;
  private waitingForPrompt = false;
  private history: History = new History();
  private controlSequence: boolean = false;
  private xCursor: number = 0;
  private isForzen: boolean = false;

  onDidWrite: Event<string> = this.writeEmitter.event;
  onDidClose: Event<void | number> = this.closeEmitter.event;
  onDidSubmit: Event<string> = this.submitEmitter.event;

  constructor(openingMessageCallback: () => Promise<string>) {
    this.openingMessageCallback = openingMessageCallback;
  }

  public open(initialDimensions: TerminalDimensions | undefined): void {
    if (this.isOpen && initialDimensions !== undefined) return;

    this.isOpen = true;
    this.isForzen = false;

    //this.writeEmitter.fire("\x1b[1;32mWelcome to the Virtual REPL!\x1b[0m\r\n");
    //this.writeEmitter.fire("Enter a message and it will be echoed back:\r\n");
    this.openingMessageCallback().then((message: string) => {
      this.writeEmitter.fire(message);
      this.writeEmitter.fire(PROMPT);
    });
  }

  public close(): void {
    this.isOpen = false;
    // clear history
    this.history.clear();
  }

  public freeze(): void {
    this.isForzen = true;

    this.clean(false);
  }

  public clean(waitingForPrompt?: boolean): void {
    this.waitingForPrompt! != waitingForPrompt;

    // TODO: maybe restore current state
    this.buffer = "";
    this.multilineMode = false;
    this.indentation = 0;
    this.xCursor = 0;
  }

  public melt(): void {
    this.isForzen = false;
  }

  private getRelativeCursor(): number {
    let relativeCursor = this.xCursor;
    if (this.multilineMode) {
      const currentLineLength = this.buffer.split("\n").pop()?.length;
      if (currentLineLength === undefined) return -1;
      relativeCursor = this.xCursor + (this.buffer.length - currentLineLength);
    }
    return relativeCursor;
  }

  public handleInput(data: string): void {
    if (!this.isOpen || this.isForzen) return;

    for (const char of data) {
      if (this.controlSequence) {
        this.controlSequence = false;

        if (data === "\x1b[A") {
          // arrow up
          const historyItem = this.history.arrowUp();
          // delete until last save positon
          this.writeEmitter.fire("\x1b[u\x1b[0J");
          this.buffer = historyItem;
          this.xCursor = this.buffer.length;
          this.writeEmitter.fire(this.buffer);
        } else if (data === "\x1b[B") {
          // arrow down
          const historyItem = this.history.arrowDown();
          // delete until last save positon
          this.writeEmitter.fire("\x1b[u\x1b[0J");
          this.buffer = historyItem;
          this.xCursor = this.buffer.length;
          this.writeEmitter.fire(this.buffer);
        } else if (data === "\x1b[C") {
          // arrow right
          if (this.xCursor < this.buffer.length) {
            this.xCursor++;
            this.writeEmitter.fire("\x1b[1C");
          }
        } else if (data === "\x1b[D") {
          // arrow left
          if (
            this.xCursor > 0 &&
            (!this.multilineMode || this.indentation < this.xCursor)
          ) {
            this.xCursor--;
            this.writeEmitter.fire("\x1b[1D");
          }
        } else if (
          data === "\x1b[3~" &&
          this.xCursor < this.buffer.split("\n")[-1].length
        ) {
          // delete
          this.writeEmitter.fire("\x1b[0K");
          // delete the character (if any) right of the cursor, index of which will be xCursor
          this.buffer =
            this.buffer.slice(0, this.xCursor) +
            this.buffer.slice(this.xCursor + 1);
        }

        break;
      }

      if (char === "\r") {
        if (
          this.multilineMode &&
          this.buffer.split("\n").pop()?.trim() === ""
        ) {
          this.multilineMode = false;
          this.processMultilineInput();
          this.buffer = "";
          this.xCursor = 0;
        } else {
          if (!this.multilineMode) {
            if (this.buffer === "") {
              this.writeEmitter.fire("\r\n");
              this.prompt();
            } else {
              this.processInput(this.buffer);
            }
            this.buffer = "";
            this.xCursor = 0;
          } else {
            this.buffer += "\n";
            this.writeEmitter.fire("\r\n");
            this.handleIndentation();
          }
        }
      } else if (char === "\x7f") {
        // Backspace
        this.handleBackspace();
      } else if (char === "\x1b") {
        // Escape
        this.controlSequence = true;
      } else if (char === "\x03") {
        // Ctrl+C
        if (!this.waitingForPrompt) return;

        this.submitEmitter.fire(char);
      } else {
        if (IGNORED_CHARS.includes(char)) return;

        const relativeCursor = this.getRelativeCursor();
        if (relativeCursor === -1) return;
        // this.buffer += char; for xCursor
        this.buffer =
          this.buffer.slice(0, relativeCursor) +
          char +
          this.buffer.slice(relativeCursor);
        // if xCursor is not at the end of the row
        if (relativeCursor < this.buffer.length) {
          // shift the rest of the row to the right, to don't overwrite it
          this.writeEmitter.fire("\x1b[1@");
        }
        this.writeEmitter.fire(char);
        this.xCursor++;

        // don't allow multiline imput while we're waiting for a prompt
        if (!this.waitingForPrompt) {
          this.checkMultilineMode();
        }
      }
    }
  }

  private handleIndentation(): void {
    const lastLine = this.buffer.split("\n").slice(-2)[0];
    if (lastLine.trim().endsWith(":")) {
      this.indentation += 4;
      this.xCursor = this.indentation;
    }
    const indentStr = " ".repeat(this.indentation);
    this.writeEmitter.fire(indentStr);
    this.buffer += indentStr;
  }

  private handleBackspace(): void {
    const currentLine = this.buffer.split("\n").pop();

    if (currentLine === undefined) return;

    if (
      this.multilineMode &&
      this.indentation > 0 &&
      currentLine?.length === this.indentation &&
      currentLine.trim() === ""
    ) {
      this.indentation -= 4;
      this.xCursor -= 4;

      // Remove the last 4 characters from the buffer
      this.buffer = this.buffer.slice(0, -4);
      this.writeEmitter.fire(DEL(4));
    } else if (currentLine.length > 0) {
      const relativeCursor = this.getRelativeCursor();
      if (relativeCursor === -1) return;

      // Remove the last character from the buffer at relativeCursor-1
      this.buffer =
        this.buffer.slice(0, relativeCursor - 1) +
        this.buffer.slice(relativeCursor);
      this.xCursor--;
      this.writeEmitter.fire(DEL(1));
    }
  }

  private checkMultilineMode(): void {
    const multilineKeywords = [
      "def",
      "while",
      "for",
      "if",
      "elif",
      "else",
      "with",
      "class",
      "try",
      "except",
      "finally",
    ];
    const lastLine = this.buffer.split("\n").pop() || "";
    if (!this.multilineMode) {
      this.multilineMode = multilineKeywords.some(keyword =>
        lastLine.trim().startsWith(keyword)
      );
    }
  }

  private processInput(input: string): void {
    /*if (input === "exit") {
      this.writeEmitter.fire("\r\nExiting...\r\n");
      this.closeEmitter.fire(0);
    }*/
    //this.writeEmitter.fire(`\r\nYou entered: \x1b[1;33m${input}\x1b[0m\r\n`);
    if (input === ".cls" || input === ".clear") {
      this.writeEmitter.fire("\x1b[2J\x1b[0f");
      this.open(undefined);

      return;
    } else if (input === ".empty") {
      this.writeEmitter.fire("\x1b[2J\x1b[0f");
      this.prompt();

      return;
    }

    this.writeEmitter.fire("\r\n");
    this.waitingForPrompt = true;
    this.history.add(input);
    this.submitEmitter.fire(input + "\n");
  }

  private processMultilineInput(): void {
    //this.writeEmitter.fire("\nMultiline input submitted\r\n");
    this.indentation = 0;
    this.writeEmitter.fire("\r\n");
    this.waitingForPrompt = true;
    this.history.add(this.buffer);
    this.submitEmitter.fire(this.buffer);
  }

  public write(data: string): void {
    this.writeEmitter.fire(data);
  }

  public prompt(): void {
    this.waitingForPrompt = false;
    this.writeEmitter.fire(PROMPT);
    // save cursor positon
    this.writeEmitter.fire("\x1b7");
  }

  public getIsOpen(): boolean {
    return this.isOpen;
  }
}
