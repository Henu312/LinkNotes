const fs = require('node:fs');
const path = require('node:path');

if (process.platform !== 'win32') {
  process.exit(0);
}

const root = path.resolve(__dirname, '..');
const targets = [
  path.join(root, 'node_modules', 'node-pty', 'binding.gyp'),
  path.join(root, 'node_modules', 'node-pty', 'deps', 'winpty', 'src', 'winpty.gyp')
];

const spectrePattern = /[ \t]*'SpectreMitigation': 'Spectre'\s*,?\r?\n/g;

let touched = 0;

for (const targetPath of targets) {
  if (!fs.existsSync(targetPath)) {
    continue;
  }

  const original = fs.readFileSync(targetPath, 'utf8');
  const patched = original.replace(spectrePattern, '');

  if (patched !== original) {
    fs.writeFileSync(targetPath, patched, 'utf8');
    touched += 1;
  }
}

if (touched > 0) {
  process.stdout.write(`patched node-pty spectre config in ${touched} file(s)\n`);
}
