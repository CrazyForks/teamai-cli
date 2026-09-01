import matter from 'gray-matter';

/** Result of splitting a document into its YAML frontmatter and body. */
export interface FrontmatterSplit {
  /** Parsed frontmatter fields. Empty object when absent or unparseable. */
  data: Record<string, unknown>;
  /** Whether the frontmatter parsed to a mapping/object. */
  valid: boolean;
  /** Document body after the frontmatter block (any leading BOM removed). */
  body: string;
  /** Verbatim leading frontmatter block including delimiters and trailing newline; '' when absent. */
  raw: string;
}

/**
 * Matches a leading YAML frontmatter block, tolerant of an optional UTF-8 BOM,
 * LF or CRLF line endings, and trailing horizontal whitespace on delimiter lines.
 */
const FRONTMATTER_BLOCK = /^﻿?---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

/** Strip a single leading UTF-8 BOM if present. */
function stripBom(text: string): string {
    return text.charCodeAt(0) === 0xFEFF ? text.slice(1) : text;
}

/**
 * Split a document into frontmatter data, its verbatim raw block, and the body.
 *
 * Handles LF/CRLF line endings and a leading UTF-8 BOM. Never throws: malformed
 * YAML yields an empty `data` object. `raw + body` always reconstructs the input
 * with any leading BOM removed.
 */
export function splitFrontmatter(content: string): FrontmatterSplit {
    const match = content.match(FRONTMATTER_BLOCK);
    if (!match) {
        return { data: {}, valid: false, body: stripBom(content), raw: '' };
    }
    const rawFull = match[0];
    const body = content.slice(rawFull.length);
    const raw = stripBom(rawFull);
    let data: Record<string, unknown> = {};
    let valid = false;
    try {
        const parsed = matter(raw);
        if (parsed.data === null || typeof parsed.data !== 'object' || Array.isArray(parsed.data)) {
            return { data: {}, valid: false, body, raw };
        }
        data = parsed.data as Record<string, unknown>;
        valid = true;
    } catch {
        data = {};
    }
    return { data, valid, body, raw };
}

/** Parse frontmatter fields and body from a document. */
export function parseFrontmatter(content: string): { data: Record<string, unknown>; body: string } {
    const { data, body } = splitFrontmatter(content);
    return { data, body };
}

/** Return the document body with any leading frontmatter block removed. */
export function stripFrontmatter(content: string): string {
    return splitFrontmatter(content).body;
}

/** Report whether a document begins with a YAML frontmatter block. */
export function hasFrontmatter(content: string): boolean {
    return FRONTMATTER_BLOCK.test(content);
}

/**
 * Serialize frontmatter data and a body into a document string.
 *
 * Produces LF-delimited output in the form `---\n<yaml>---\n<body>`.
 */
export function stringifyFrontmatter(data: Record<string, unknown>, body: string): string {
    return matter.stringify(body, data);
}
