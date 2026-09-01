import { describe, it, expect } from 'vitest';
import {
    parseFrontmatter,
    splitFrontmatter,
    stripFrontmatter,
    hasFrontmatter,
    stringifyFrontmatter,
} from '../utils/frontmatter.js';

const BOM = '﻿';

describe('parseFrontmatter', () => {
    const variants = [
        { label: 'LF',       content: '---\nname: foo\ndescription: bar\n---\nbody' },
        { label: 'CRLF',     content: '---\r\nname: foo\r\ndescription: bar\r\n---\r\nbody' },
        { label: 'BOM+LF',   content: BOM + '---\nname: foo\ndescription: bar\n---\nbody' },
        { label: 'BOM+CRLF', content: BOM + '---\r\nname: foo\r\ndescription: bar\r\n---\r\nbody' },
    ];

    for (const { label, content } of variants) {
        it(`parses data and body correctly (${label})`, () => {
            const { data, body } = parseFrontmatter(content);
            expect(data.name).toBe('foo');
            expect(data.description).toBe('bar');
            expect(body).toBe('body');
        });
    }

    it('returns empty data and original body when no frontmatter', () => {
        const { data, body } = parseFrontmatter('# just body');
        expect(data).toEqual({});
        expect(body).toBe('# just body');
    });

    it('strips BOM from plain body when no frontmatter', () => {
        const { data, body } = parseFrontmatter(BOM + '# just body');
        expect(data).toEqual({});
        expect(body).toBe('# just body');
    });
});

describe('parseFrontmatter – malformed YAML', () => {
    it('does not throw and returns empty data', () => {
        expect(() => parseFrontmatter('---\n: : :\n---\nx')).not.toThrow();
        const { data } = parseFrontmatter('---\n: : :\n---\nx');
        expect(data).toEqual({});
    });
});

describe('splitFrontmatter – round-trip', () => {
    it('raw + body equals BOM-stripped input for LF', () => {
        const input = '---\nname: foo\n---\nbody';
        const { raw, body } = splitFrontmatter(input);
        expect(raw + body).toBe(input);
    });

    it('raw + body equals BOM-stripped input for CRLF', () => {
        const input = '---\r\nname: foo\r\n---\r\nbody';
        const { raw, body } = splitFrontmatter(input);
        expect(raw + body).toBe(input);
    });

    it('raw + body equals BOM-stripped input when BOM+LF', () => {
        const input = BOM + '---\nname: foo\n---\nbody';
        const { raw, body } = splitFrontmatter(input);
        expect(raw + body).toBe(input.slice(1)); // BOM stripped
    });

    it('raw is empty string when no frontmatter', () => {
        const { raw } = splitFrontmatter('# plain body');
        expect(raw).toBe('');
    });
});

describe('parseFrontmatter – no trailing newline after closing delimiter', () => {
    it('parses frontmatter at end of string with no trailing newline', () => {
        const { data, body } = parseFrontmatter('---\nname: x\n---');
        expect(data.name).toBe('x');
        expect(body).toBe('');
    });
});

describe('stripFrontmatter', () => {
    it('returns body only for LF input', () => {
        expect(stripFrontmatter('---\nname: foo\n---\nbody')).toBe('body');
    });

    it('returns body only for CRLF input', () => {
        expect(stripFrontmatter('---\r\nname: foo\r\n---\r\nbody')).toBe('body');
    });

    it('returns original string when no frontmatter', () => {
        expect(stripFrontmatter('# plain')).toBe('# plain');
    });
});

describe('hasFrontmatter', () => {
    it('returns true for LF frontmatter', () => {
        expect(hasFrontmatter('---\nname: foo\n---\nbody')).toBe(true);
    });

    it('returns true for CRLF frontmatter', () => {
        expect(hasFrontmatter('---\r\nname: foo\r\n---\r\nbody')).toBe(true);
    });

    it('returns true for BOM-prefixed frontmatter', () => {
        expect(hasFrontmatter(BOM + '---\nname: foo\n---\nbody')).toBe(true);
    });

    it('returns false for plain body', () => {
        expect(hasFrontmatter('# just body')).toBe(false);
    });
});

describe('stringifyFrontmatter', () => {
    it('round-trips data through parseFrontmatter', () => {
        const out = stringifyFrontmatter({ name: 'a', description: 'b' }, 'body');
        const { data, body } = parseFrontmatter(out);
        expect(data.name).toBe('a');
        expect(data.description).toBe('b');
        expect(body.trim()).toBe('body');
    });

    it('produces LF-only output (no CR)', () => {
        const out = stringifyFrontmatter({ name: 'a', description: 'b' }, 'body');
        expect(out.includes('\r')).toBe(false);
    });
});
