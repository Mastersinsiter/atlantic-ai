const { createCanvas, registerFont } = require('canvas');
registerFont('fonts/BebasNeue-Regular.ttf', { family: 'BebasNeue' });
const ctx = createCanvas(100, 100).getContext('2d');
ctx.font = '34px "BebasNeue"';
const w1 = ctx.measureText('WWWmmm').width;
ctx.font = '34px "DOES_NOT_EXIST"';
const w2 = ctx.measureText('WWWmmm').width;
console.log(w1, w2);
