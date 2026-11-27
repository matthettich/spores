// desktop/path-allow.js: only song files the person picked are allowed (run: cd desktop && npm test)
'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('fs'), os = require('os'), path = require('path');
const { createAllowList, isSongFile } = require('../desktop/path-allow');

test('only .spores / .json count as song files', () => {
  assert.ok(isSongFile('/a/b.spores') && isSongFile('/a/b.JSON'));
  assert.ok(!isSongFile('/a/b.txt') && !isSongFile('/a/b.spores.exe') && !isSongFile(null));
});
test('a path is refused until it was picked, relative and NUL paths never allowed', () => {
  const a = createAllowList({ win32: false });
  assert.match(a.check('/home/x/s.spores'), /own dialogs/);
  a.allow('/home/x/s.spores');
  assert.equal(a.check('/home/x/s.spores'), null);
  assert.equal(a.check('/home/x/../x/s.spores'), null);       // normalised
  assert.match(a.check('/home/x/other.spores'), /own dialogs/);
  assert.match(a.check('/home/x/s.txt'), /not a Spores song/);
  assert.equal(a.allow('rel/s.spores'), '');
  assert.equal(a.allow('/x\0/s.spores'), '');
  assert.match(a.check('rel/s.spores'), /own dialogs/);
});
test('Windows paths compare case-insensitively', () => {
  const a = createAllowList({ win32: true });
  a.allow('C:\\Songs\\A.spores');
  assert.equal(a.check('c:\\songs\\a.SPORES'), null);
});
test('the list is kept across runs (newest last), capped', () => {
  const f = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'sp-')), 'allowed.txt');
  const a = createAllowList({ file: f, win32: false, max: 3 });
  for (const n of ['1', '2', '3', '4']) a.allow(`/s/${n}.spores`);
  const b = createAllowList({ file: f, win32: false, max: 3 });
  assert.deepEqual(b.list(), ['/s/2.spores', '/s/3.spores', '/s/4.spores']);
  assert.equal(b.check('/s/4.spores'), null);
  assert.match(b.check('/s/1.spores'), /own dialogs/);
});
