export type Severity = "error" | "warning";

export interface StoryDiagnostic {
  line: number;
  start: number;
  end: number;
  message: string;
  severity: Severity;
}

export interface HeaderField {
  key: string;
  value: string;
  line: number;
}

export interface StoryDay {
  startLine: number;
  endLine: number;
  separatorLine: number;
  day: number | string | null;
  title: string | null;
  scene: string | null;
  mood: string | null;
  fields: HeaderField[];
  entryCount: number;
}

export interface StoryParseResult {
  days: StoryDay[];
  diagnostics: StoryDiagnostic[];
}

export const KNOWN_KEYS: string[] = ["day", "title", "scene", "mood"];

const DAY_SEPARATOR = /^===\s*$/;
const HEADER_END = /^---\s*$/;

function newDay(startLine: number): StoryDay {
  return {
    startLine,
    endLine: startLine,
    separatorLine: -1,
    day: null,
    title: null,
    scene: null,
    mood: null,
    fields: [],
    entryCount: 0
  };
}

function span(line: string): [number, number] {
  const start = line.length - line.trimStart().length;
  const end = line.trimEnd().length;
  return [start, end];
}

export function parseStory(text: string): StoryParseResult {
  const lines = text.split(/\r?\n/);
  const days: StoryDay[] = [];
  const diagnostics: StoryDiagnostic[] = [];

  let current = newDay(0);
  let seenKeys = new Set<string>();
  let inHeader = true;
  let hasContent = false;
  let firstContentLine = -1;

  const report = (
    line: number,
    start: number,
    end: number,
    message: string,
    severity: Severity
  ): void => {
    diagnostics.push({ line, start, end, message, severity });
  };

  const finishDay = (endLine: number): void => {
    current.endLine = endLine;
    if (hasContent === false) {
      return;
    }
    const firstLength = lines[firstContentLine].length;
    if (inHeader) {
      report(
        firstContentLine,
        0,
        firstLength,
        "No '---' line found, so every line in this day is read as a header.",
        "warning"
      );
    }
    if (current.day === null) {
      report(firstContentLine, 0, firstLength, "This day has no 'day' field.", "warning");
    }
    days.push(current);
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (DAY_SEPARATOR.test(line)) {
      finishDay(i - 1);
      current = newDay(i + 1);
      seenKeys = new Set<string>();
      inHeader = true;
      hasContent = false;
      firstContentLine = -1;
      continue;
    }

    const trimmed = line.trim();
    if (trimmed.length === 0 || trimmed.startsWith("#")) {
      continue;
    }

    if (hasContent === false) {
      hasContent = true;
      firstContentLine = i;
    }

    const range = span(line);
    const start = range[0];
    const end = range[1];

    if (inHeader && HEADER_END.test(trimmed)) {
      inHeader = false;
      current.separatorLine = i;
      continue;
    }

    const colon = line.indexOf(":");

    if (inHeader) {
      if (colon === -1) {
        report(i, start, end, "Invalid header syntax: missing colon.", "error");
        continue;
      }
      const rawKey = line.slice(0, colon);
      const key = rawKey.trim().toLowerCase();
      const value = line.slice(colon + 1).trim();
      const keyEnd = rawKey.trimEnd().length;

      if (key.length === 0) {
        report(i, start, colon + 1, "Header key is empty.", "warning");
        continue;
      }
      if (seenKeys.has(key)) {
        report(i, start, keyEnd, "Duplicate header key '" + key + "'.", "warning");
      }
      seenKeys.add(key);
      if (value.length === 0) {
        report(i, start, end, "Header key '" + key + "' has no value.", "warning");
      }

      current.fields.push({ key, value, line: i });

      if (key === "day") {
        const parsed = parseInt(value, 10);
        if (Number.isNaN(parsed)) {
          current.day = value;
          if (value.length > 0) {
            report(i, start, end, "The 'day' field should be a number.", "warning");
          }
        } else {
          current.day = parsed;
        }
      } else if (key === "title") {
        current.title = value;
      } else if (key === "scene") {
        current.scene = value;
      } else if (key === "mood") {
        current.mood = value;
      }
      continue;
    }

    if (trimmed.startsWith("*")) {
      current.entryCount++;
      continue;
    }

    if (colon === -1) {
      report(i, start, end, "Invalid dialogue syntax: missing speaker colon.", "error");
      current.entryCount++;
      continue;
    }

    const speaker = line.slice(0, colon).trim();
    const dialogue = line.slice(colon + 1).trim();
    if (speaker.length === 0) {
      report(i, start, colon + 1, "Missing speaker name before the colon.", "error");
    } else if (dialogue.length === 0) {
      report(i, start, end, "Dialogue line has no text.", "warning");
    }
    current.entryCount++;
  }

  finishDay(lines.length - 1);
  return { days, diagnostics };
}
