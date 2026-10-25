import assert from 'node:assert/strict';
import bundle from '../../prototype/node_modules/playwright-core/lib/utilsBundle.js';
// Blurred GPU surfaces can differ by one 8-bit unit after a compositor repaint.
// Decode pixels rather than comparing PNG encodings or accepting visible bleed.
export function assertPixelDifferenceAtMost(before,after,tolerance=1){
 const a=bundle.PNG.sync.read(before),b=bundle.PNG.sync.read(after);
 assert.equal(a.width,b.width);assert.equal(a.height,b.height);
 let maximum=0;for(let i=0;i<a.data.length;i++)maximum=Math.max(maximum,Math.abs(a.data[i]-b.data[i]));
 assert.ok(maximum<=tolerance,`Pixel difference ${maximum} exceeds ${tolerance}`);
}
