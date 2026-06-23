const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sources = [
  'apps-script/ReceiptSemiAutoAppend.gs',
  'apps-script/ReceiptMailDraftsDynamic.gs'
];
const output = path.join(root, 'apps-script/ReceiptUnifiedFlow.gs');

const header = `/**
 * ReceiptUnifiedFlow.gs
 *
 * Generated from ReceiptSemiAutoAppend.gs and ReceiptMailDraftsDynamic.gs.
 * Run tools/build-receipt-unified.js after changing either source file.
 */

`;

const content = sources
  .map(file => fs.readFileSync(path.join(root, file), 'utf8').trim())
  .join('\n\n');

fs.writeFileSync(output, header + content + '\n', 'utf8');
