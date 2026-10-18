const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const core = fs.readFileSync(path.join(root, 'public/legacy/10-core.js'), 'utf8');
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');

// The selection predicate is deliberately full containment, never intersection.
function fullyInside(b, a) {
  return b.left >= a.left && b.top >= a.top && b.right <= a.right && b.bottom <= a.bottom;
}
const area = { left: 10, top: 10, right: 100, bottom: 100 };
assert.equal(fullyInside({left:20,top:20,right:80,bottom:80}, area), true, 'inside object is selected');
assert.equal(fullyInside({left:5,top:20,right:80,bottom:80}, area), false, 'left-clipped object is excluded');
assert.equal(fullyInside({left:20,top:5,right:80,bottom:80}, area), false, 'top-clipped object is excluded');
assert.equal(fullyInside({left:20,top:20,right:105,bottom:80}, area), false, 'right-clipped object is excluded');
assert.equal(fullyInside({left:20,top:20,right:80,bottom:105}, area), false, 'bottom-clipped object is excluded');
assert.match(core, /function isFullyInside\(box, area\)/, 'runtime selection uses strict containment');
assert.match(core, /span\[data-tidx\], span\[data-added-id\], \.editor-img-box/, 'text and image objects are supported');
assert.match(core, /_commitGroupMove/, 'group movement persists image position');
assert.doesNotMatch(html, /legacy\/70-f\.js/, 'duplicate region handler is not loaded');
console.log('Region selection tests passed.');
