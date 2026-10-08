import * as vscode from "vscode";
import { parseStory, StoryDiagnostic } from "./parser";

const LANGUAGE_ID = "story";
const DEBOUNCE_MS = 250;

const HOVER_DOCS: Record<string, string> = {
  day: "**day**\n\nThe day number. Parsed as an integer when possible.",
  title: "**title**\n\nThe title of this day.",
  scene: "**scene**\n\nWhere this day takes place.",
  mood: "**mood**\n\nThe overall mood of this day."
};

const SEPARATOR_DOC =
  "**===**\n\nStarts a new day. Must be alone on its line with no leading spaces.";
const HEADER_END_DOC =
  "**---**\n\nEnds the header. Everything after it is body: `* narration` and `speaker: text`.";

function toDiagnostic(d: StoryDiagnostic): vscode.Diagnostic {
  const range = new vscode.Range(d.line, d.start, d.line, Math.max(d.end, d.start + 1));
  let severity = vscode.DiagnosticSeverity.Warning;
  if (d.severity === "error") {
    severity = vscode.DiagnosticSeverity.Error;
  }
  const diagnostic = new vscode.Diagnostic(range, d.message, severity);
  diagnostic.source = "story";
  return diagnostic;
}

export function activate(context: vscode.ExtensionContext): void {
  const collection = vscode.languages.createDiagnosticCollection("story");
  const timers = new Map<string, ReturnType<typeof setTimeout>>();

  const refresh = (doc: vscode.TextDocument): void => {
    if (doc.languageId !== LANGUAGE_ID) {
      return;
    }
    const result = parseStory(doc.getText());
    collection.set(doc.uri, result.diagnostics.map(toDiagnostic));
  };

  const schedule = (doc: vscode.TextDocument): void => {
    if (doc.languageId !== LANGUAGE_ID) {
      return;
    }
    const key = doc.uri.toString();
    const existing = timers.get(key);
    if (existing !== undefined) {
      clearTimeout(existing);
    }
    timers.set(
      key,
      setTimeout(() => {
        timers.delete(key);
        refresh(doc);
      }, DEBOUNCE_MS)
    );
  };

  context.subscriptions.push(
    collection,
    {
      dispose: () => {
        timers.forEach((timer) => clearTimeout(timer));
        timers.clear();
      }
    },
    vscode.workspace.onDidOpenTextDocument(refresh),
    vscode.workspace.onDidChangeTextDocument((e) => schedule(e.document)),
    vscode.workspace.onDidCloseTextDocument((doc) => {
      const key = doc.uri.toString();
      const existing = timers.get(key);
      if (existing !== undefined) {
        clearTimeout(existing);
        timers.delete(key);
      }
      collection.delete(doc.uri);
    })
  );

  vscode.workspace.textDocuments.forEach(refresh);

  const selector: vscode.DocumentSelector = { language: LANGUAGE_ID };

  context.subscriptions.push(
    vscode.languages.registerDocumentSymbolProvider(selector, {
      provideDocumentSymbols(doc: vscode.TextDocument): vscode.DocumentSymbol[] {
        const result = parseStory(doc.getText());
        const lastLine = doc.lineCount - 1;
        return result.days.map((day) => {
          const startLine = Math.min(day.startLine, lastLine);
          const endLine = Math.min(day.endLine, lastLine);
          let name = "Untitled day";
          if (day.day !== null) {
            name = "Day " + day.day;
          }
          if (day.title !== null && day.title.length > 0) {
            name = name + " - " + day.title;
          }
          const detailParts: string[] = [];
          if (day.scene !== null && day.scene.length > 0) {
            detailParts.push(day.scene);
          }
          if (day.mood !== null && day.mood.length > 0) {
            detailParts.push(day.mood);
          }
          const range = new vscode.Range(
            startLine,
            0,
            endLine,
            doc.lineAt(endLine).text.length
          );
          return new vscode.DocumentSymbol(
            name,
            detailParts.join(" | "),
            vscode.SymbolKind.Namespace,
            range,
            doc.lineAt(startLine).range
          );
        });
      }
    }),

    vscode.languages.registerFoldingRangeProvider(selector, {
      provideFoldingRanges(doc: vscode.TextDocument): vscode.FoldingRange[] {
        const result = parseStory(doc.getText());
        const ranges: vscode.FoldingRange[] = [];
        const lastLine = doc.lineCount - 1;
        result.days.forEach((day) => {
          const endLine = Math.min(day.endLine, lastLine);
          if (endLine > day.startLine) {
            ranges.push(new vscode.FoldingRange(day.startLine, endLine));
          }
          if (day.separatorLine > day.startLine && endLine > day.separatorLine) {
            ranges.push(new vscode.FoldingRange(day.separatorLine, endLine));
          }
        });
        return ranges;
      }
    }),

    vscode.languages.registerHoverProvider(selector, {
      provideHover(
        doc: vscode.TextDocument,
        position: vscode.Position
      ): vscode.Hover | undefined {
        const line = doc.lineAt(position.line).text;

        if (/^===\s*$/.test(line)) {
          return new vscode.Hover(new vscode.MarkdownString(SEPARATOR_DOC));
        }
        if (/^\s*---\s*$/.test(line)) {
          return new vscode.Hover(new vscode.MarkdownString(HEADER_END_DOC));
        }

        const result = parseStory(doc.getText());
        const day = result.days.find(
          (d) => position.line >= d.startLine && position.line <= d.endLine
        );
        if (day === undefined) {
          return undefined;
        }
        const inHeader = day.separatorLine === -1 || position.line < day.separatorLine;
        if (inHeader === false) {
          return undefined;
        }

        const colon = line.indexOf(":");
        if (colon === -1 || position.character > colon) {
          return undefined;
        }
        const key = line.slice(0, colon).trim().toLowerCase();
        const docText = HOVER_DOCS[key];
        if (docText === undefined) {
          return undefined;
        }
        return new vscode.Hover(new vscode.MarkdownString(docText));
      }
    })
  );
}

export function deactivate(): void {
  return;
                                                    }
