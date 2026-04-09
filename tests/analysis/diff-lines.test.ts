import { describe, expect, it } from 'bun:test';
import { overlapsWithDiff, parseDiffHunks } from '../../src/analysis/diff-lines';

describe('parseDiffHunks', () => {
    it('parses standard git diff output', () => {
        const diff = `diff --git a/src/auth.ts b/src/auth.ts
index abc1234..def5678 100644
--- a/src/auth.ts
+++ b/src/auth.ts
@@ -10,6 +10,8 @@ import { User } from './models';
 export function login(user: string, pass: string) {
+    validate(user);
+    validate(pass);
     const token = createToken(user, pass);
     return token;
 }
@@ -50,3 +52,7 @@ export function logout() {
     clearSession();
+    audit('logout');
+    cleanup();
+    notify();
+    return true;
 }`;

        const hunks = parseDiffHunks(diff);

        expect(hunks.size).toBe(1);
        expect(hunks.has('src/auth.ts')).toBe(true);

        const fileHunks = hunks.get('src/auth.ts')!;
        expect(fileHunks).toHaveLength(2);

        expect(fileHunks[0]).toEqual({ newStart: 10, newCount: 8 });
        expect(fileHunks[1]).toEqual({ newStart: 52, newCount: 7 });
    });

    it('parses multi-file diff', () => {
        const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,3 +1,4 @@
 line1
+added
 line2
 line3
diff --git a/src/b.ts b/src/b.ts
--- a/src/b.ts
+++ b/src/b.ts
@@ -20,5 +20,6 @@ function foo() {
     bar();
+    baz();
     return;
 }`;

        const hunks = parseDiffHunks(diff);

        expect(hunks.size).toBe(2);
        expect(hunks.get('src/a.ts')).toHaveLength(1);
        expect(hunks.get('src/b.ts')).toHaveLength(1);

        expect(hunks.get('src/a.ts')![0]).toEqual({ newStart: 1, newCount: 4 });
        expect(hunks.get('src/b.ts')![0]).toEqual({ newStart: 20, newCount: 6 });
    });

    it('handles hunk with single line (no count)', () => {
        const diff = `--- a/file.ts
+++ b/file.ts
@@ -5,0 +6 @@
+newLine`;

        const hunks = parseDiffHunks(diff);
        expect(hunks.get('file.ts')![0]).toEqual({ newStart: 6, newCount: 1 });
    });

    it('handles pure deletion hunk (newCount=0)', () => {
        const diff = `--- a/file.ts
+++ b/file.ts
@@ -5,3 +5,0 @@
-removed1
-removed2
-removed3`;

        const hunks = parseDiffHunks(diff);
        expect(hunks.get('file.ts')![0]).toEqual({ newStart: 5, newCount: 0 });
    });

    it('returns empty map for empty input', () => {
        expect(parseDiffHunks('').size).toBe(0);
    });
});

describe('overlapsWithDiff', () => {
    const hunks = new Map([
        [
            'src/service.ts',
            [
                { newStart: 10, newCount: 5 }, // lines 10-14
                { newStart: 50, newCount: 3 }, // lines 50-52
            ],
        ],
    ]);

    it('returns true when function fully contains a hunk', () => {
        // Function lines 5-20 contain hunk 10-14
        expect(overlapsWithDiff('src/service.ts', 5, 20, hunks)).toBe(true);
    });

    it('returns true when function partially overlaps hunk start', () => {
        // Function lines 8-12 overlap with hunk 10-14
        expect(overlapsWithDiff('src/service.ts', 8, 12, hunks)).toBe(true);
    });

    it('returns true when function partially overlaps hunk end', () => {
        // Function lines 13-18 overlap with hunk 10-14
        expect(overlapsWithDiff('src/service.ts', 13, 18, hunks)).toBe(true);
    });

    it('returns true when hunk fully contains function', () => {
        // Function lines 11-13 inside hunk 10-14
        expect(overlapsWithDiff('src/service.ts', 11, 13, hunks)).toBe(true);
    });

    it('returns false when function is before all hunks', () => {
        // Function lines 1-5, first hunk at 10
        expect(overlapsWithDiff('src/service.ts', 1, 5, hunks)).toBe(false);
    });

    it('returns false when function is between hunks', () => {
        // Function lines 20-40, hunks at 10-14 and 50-52
        expect(overlapsWithDiff('src/service.ts', 20, 40, hunks)).toBe(false);
    });

    it('returns false when function is after all hunks', () => {
        expect(overlapsWithDiff('src/service.ts', 60, 80, hunks)).toBe(false);
    });

    it('returns false for file not in diff', () => {
        expect(overlapsWithDiff('src/other.ts', 10, 20, hunks)).toBe(false);
    });

    it('skips pure deletion hunks (newCount=0)', () => {
        const withDeletion = new Map([['file.ts', [{ newStart: 10, newCount: 0 }]]]);
        expect(overlapsWithDiff('file.ts', 10, 15, withDeletion)).toBe(false);
    });

    it('handles exact boundary overlap', () => {
        // Function ends exactly where hunk starts
        expect(overlapsWithDiff('src/service.ts', 5, 10, hunks)).toBe(true);
        // Function starts exactly where hunk ends
        expect(overlapsWithDiff('src/service.ts', 14, 20, hunks)).toBe(true);
    });

    it('handles single-line function on changed line', () => {
        expect(overlapsWithDiff('src/service.ts', 12, 12, hunks)).toBe(true);
    });

    it('handles single-line function on unchanged line', () => {
        expect(overlapsWithDiff('src/service.ts', 30, 30, hunks)).toBe(false);
    });
});
