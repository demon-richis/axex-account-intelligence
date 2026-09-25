const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { buildBlocklistInsert } = require('../src/analyzers/blocklistManager');

const files = [
  'src/routes/analyze.js',
  'src/routes/flag.js',
  'src/analyzers/networkAnalyzer.js',
  'src/analyzers/altDetector.js',
  'src/analyzers/blocklistManager.js'
];

function balanced(text, start) {
  let depth = 0;
  let quote = null;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
      continue;
    }
    if (character === '\\') { index += 1; continue; }
    if (character === "'" || character === '"' || character === '`') { quote = character; continue; }
    if (character === '(') depth += 1;
    if (character === ')' && --depth === 0) return text.slice(start + 1, index);
  }
  throw new Error('Unbalanced SQL parentheses');
}

function splitList(text) {
  const parts = [];
  let start = 0;
  let depth = 0;
  let quote = null;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (character === '\\') index += 1;
      else if (character === quote) quote = null;
    } else if (character === '\\') index += 1;
    else if (character === "'" || character === '"') quote = character;
    else if (character === '(') depth += 1;
    else if (character === ')') depth -= 1;
    else if (character === ',' && depth === 0) { parts.push(text.slice(start, index).trim()); start = index + 1; }
  }
  if (text.slice(start).trim()) parts.push(text.slice(start).trim());
  return parts;
}

function insertContracts(source) {
  const statements = [];
  const insert = /INSERT\s+INTO\s+[a-z_]+\s*\(/gi;
  for (const match of source.matchAll(insert)) {
    const openColumns = match.index + match[0].lastIndexOf('(');
    const columnsEnd = openColumns + balanced(source, openColumns).length + 2;
    const valuesIndex = source.indexOf('VALUES', columnsEnd);
    if (valuesIndex < 0) continue;
    const between = source.slice(valuesIndex + 6, valuesIndex + 30);
    if (between.includes('${')) continue;
    const openValues = source.indexOf('(', valuesIndex);
    if (openValues < 0) continue;
    statements.push({ columns: splitList(balanced(source, openColumns)), values: splitList(balanced(source, openValues)) });
  }
  return statements;
}

function assertInsertContract(text) {
  const statement = insertContracts(text)[0];
  assert.ok(statement, 'INSERT statement was not found');
  assert.equal(statement.columns.length, statement.values.length, `columns=${statement.columns.length}, values=${statement.values.length}`);
  const placeholders = [...text.matchAll(/\$(\d+)/g)].map(match => Number(match[1]));
  assert.ok(!placeholders.length || Math.max(...placeholders) <= statement.values.length, 'placeholder exceeds INSERT values');
}

test('repository INSERT contracts have matching columns and values', () => {
  for (const file of files) {
    const source = fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
    for (const statement of insertContracts(source)) {
      assert.equal(statement.columns.length, statement.values.length, `${file}: columns=${statement.columns.length}, values=${statement.values.length}`);
    }
  }
  const generated = buildBlocklistInsert([{ cidr: '203.0.113.0/24', source: 'test', kind: 'tor' }]);
  assertInsertContract(generated.text);
  assert.equal(generated.params.length, 3);
});
