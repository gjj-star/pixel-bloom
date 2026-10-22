const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

class MockElement {
  constructor() {
    this.children = [];
    this.dataset = {};
    this.classList = { toggle() {}, add() {} };
    this.style = { setProperty() {} };
    this.listeners = {};
    this.textContent = '';
    this.value = '4';
  }

  addEventListener(type, callback) { this.listeners[type] = callback; }
  setAttribute(name, value) { this[name] = value; }
  append(child) { this.children.push(child); }
  querySelectorAll(selector) {
    if (selector === '[data-type]') return this.children.filter((child) => child.dataset.type !== undefined);
    return [];
  }
  setPointerCapture() {}
  getBoundingClientRect() { return { left: 0, top: 0, width: 360, height: 220 }; }
}

const elements = new Map([
  ['#palette', new MockElement()],
  ['#brush', new MockElement()],
  ['#speed', new MockElement()],
  ['#spray', new MockElement()],
  ['#undo', new MockElement()],
  ['#pause', new MockElement()],
  ['#clear', new MockElement()],
  ['#reset', new MockElement()],
  ['#save', new MockElement()],
  ['#load', new MockElement()],
  ['#stats', new MockElement()],
  ['#selected-label', new MockElement()],
  ['#message', new MockElement()],
]);

let drawCalls = 0;
const canvas = new MockElement();
canvas.width = 360;
canvas.height = 220;
canvas.getContext = () => ({
  createImageData: (width, height) => ({ data: new Uint8ClampedArray(width * height * 4) }),
  putImageData: () => { drawCalls++; },
});
elements.set('#world', canvas);

const effectsCanvas = new MockElement();
effectsCanvas.width = 720;
effectsCanvas.height = 440;
effectsCanvas.getContext = () => ({
  clearRect() {},
  save() {},
  restore() {},
  beginPath() {},
  arc() {},
  fill() {},
});
elements.set('#effects', effectsCanvas);

const document = {
  querySelector: (selector) => elements.get(selector),
  createElement: () => new MockElement(),
  addEventListener() {},
};

const savedValues = new Map();
const localStorage = {
  setItem: (key, value) => savedValues.set(key, value),
  getItem: (key) => savedValues.get(key) ?? null,
};

const appPath = path.join(__dirname, '..', 'app.js');
const adapterPath = path.join(__dirname, '..', 'aicraft-pixel-engine-adapter.js');
const source = `${fs.readFileSync(adapterPath, 'utf8')}\n${fs.readFileSync(appPath, 'utf8')}\n` +
  'globalThis.__test = { update, render, resetWorld, updatePowderOrLiquid, updatePlant, updateSeed, updateFire, updateFlower, updateSteam, updateSalt, updateAcid, updateElectricity, setCell, indexOf, pushUndoSnapshot, undo, saveWorld, loadWorld, cells, energy, plantAge, plantLean, moved, MATERIALS, FIRE, WOOD, WATER, STONE, PLANT, FLOWER, SEED, STEAM, METAL, SALT, ACID, ELECTRICITY, EMPTY, SAND };';
const context = { document, localStorage, requestAnimationFrame() {}, console, Math, Uint8Array, Uint16Array, Uint32Array, Uint8ClampedArray };

vm.createContext(context);
vm.runInContext(source, context, { filename: appPath });

assert.equal(elements.get('#palette').children.length, 11, '应显示 11 个可选工具，草和花由种子内部生成');
assert.match(elements.get('#stats').textContent, /水：\d+ · 种子：\d+ · 草：\d+ · 花：\d+ · 火：\d+ · 酸：\d+ · 盐：\d+ · 电：\d+/);
assert.ok(context.__test.cells.some((kind) => kind === context.__test.WOOD), '初始场景应包含木屋');
assert.ok(context.__test.cells.some((kind) => kind === context.__test.SEED), '初始场景应包含种子');
assert.ok(context.__test.cells.some((kind) => kind === context.__test.METAL), '初始场景应包含金属导线');
for (let y = 218; y < 220; y++) {
  for (let x = 0; x < 360; x++) {
    assert.equal(context.__test.cells[context.__test.indexOf(x, y)], context.__test.STONE, '高分辨率场景底部应保持连续石头地面');
  }
}
for (let frame = 0; frame < 240; frame++) context.__test.update();
context.__test.render();
const electricityCount = context.__test.cells.filter((cell) => cell === context.__test.ELECTRICITY).length;
assert.ok(electricityCount < 500, `电流不应在 240 帧后漫溢整个画布，当前为 ${electricityCount} 格`);
assert.ok(drawCalls >= 2, 'Canvas 应至少完成初始化和测试后的两次绘制');
const drawCallsAfterDirtyRender = drawCalls;
context.__test.render();
assert.equal(drawCalls, drawCallsAfterDirtyRender, '没有脏区时不应重复提交 Canvas 像素');
assert.equal(context.__test.cells.length, 360 * 220, '加密后的网格尺寸应保持正确');

// 确定性验证：水火接触生成蒸汽，蒸汽寿命结束后冷凝成水。
context.__test.cells.fill(context.__test.EMPTY);
context.__test.energy.fill(0);
context.__test.moved.fill(0);
const fireCell = context.__test.indexOf(10, 10);
const waterCell = context.__test.indexOf(11, 10);
context.__test.setCell(fireCell, context.__test.FIRE, 10);
context.__test.setCell(waterCell, context.__test.WATER);
context.__test.updateFire(10, 10, fireCell);
assert.equal(context.__test.cells[fireCell], context.__test.STEAM, '火所在位置应转化为蒸汽');
assert.equal(context.__test.cells[waterCell], context.__test.STEAM, '水所在位置应转化为蒸汽');
context.__test.energy[fireCell] = 1;
context.__test.moved.fill(0);
context.__test.updateSteam(10, 10, fireCell);
assert.equal(context.__test.cells[fireCell], context.__test.WATER, '蒸汽能量耗尽后应冷凝成水');

// 撤销和浏览器本地存档应恢复 cells 与 energy 的完整状态。
const stateCell = context.__test.indexOf(20, 20);
context.__test.setCell(stateCell, context.__test.EMPTY);
context.__test.pushUndoSnapshot();
context.__test.setCell(stateCell, context.__test.SAND);
context.__test.undo();
assert.equal(context.__test.cells[stateCell], context.__test.EMPTY, '撤销应恢复操作前的材料');
context.__test.setCell(stateCell, context.__test.SAND);
assert.equal(context.__test.saveWorld(), true, '世界应能写入本地存档');
context.__test.setCell(stateCell, context.__test.EMPTY);
assert.equal(context.__test.loadWorld(), true, '世界应能从本地存档读取');
assert.equal(context.__test.cells[stateCell], context.__test.SAND, '读档应恢复已保存的材料');

// 确定性验证：酸腐蚀木头，盐溶于水，电流激活相邻金属。
context.Math.random = () => 0;
context.__test.cells.fill(context.__test.EMPTY);
context.__test.energy.fill(0);
context.__test.plantAge.fill(0);
context.__test.plantLean.fill(0);
context.__test.moved.fill(0);

const fastSand = context.__test.indexOf(20, 10);
context.__test.setCell(fastSand, context.__test.SAND);
context.__test.updatePowderOrLiquid(20, 10, context.__test.SAND);
assert.equal(context.__test.cells[context.__test.indexOf(20, 12)], context.__test.SAND, '加密网格后沙子单帧仍应保持原有下落距离');
context.__test.cells.fill(context.__test.EMPTY);
context.__test.energy.fill(0);
context.__test.moved.fill(0);

const densitySand = context.__test.indexOf(30, 10);
const densityWater = context.__test.indexOf(30, 11);
context.__test.setCell(densitySand, context.__test.SAND);
context.__test.setCell(densityWater, context.__test.WATER);
for (const x of [29, 30, 31]) context.__test.setCell(context.__test.indexOf(x, 12), context.__test.STONE);
context.__test.updatePowderOrLiquid(30, 10, context.__test.SAND);
assert.equal(context.__test.cells[context.__test.indexOf(30, 11)], context.__test.SAND, '高密度沙子应能置换下方低密度水');
assert.equal(context.__test.cells[context.__test.indexOf(30, 10)], context.__test.WATER, '被置换的水应留在沙子原位置');

context.__test.cells.fill(context.__test.EMPTY);
context.__test.energy.fill(0);
context.__test.moved.fill(0);
const levelingWater = context.__test.indexOf(50, 10);
context.__test.setCell(levelingWater, context.__test.WATER);
for (const x of [48, 49, 50, 51]) context.__test.setCell(context.__test.indexOf(x, 11), context.__test.STONE);
context.__test.updatePowderOrLiquid(50, 10, context.__test.WATER);
assert.ok(
  context.__test.cells[context.__test.indexOf(48, 10)] === context.__test.WATER ||
  context.__test.cells[context.__test.indexOf(49, 10)] === context.__test.WATER,
  '液体下方受阻时应按 dispersion 横向找平',
);

context.__test.cells.fill(context.__test.EMPTY);
context.__test.energy.fill(0);
context.__test.moved.fill(0);

const curvedStem = context.__test.indexOf(60, 70);
context.__test.setCell(curvedStem, context.__test.PLANT, 120, 0, 1);
context.__test.updatePlant(60, 70, curvedStem);
const curvedTargets = [context.__test.indexOf(59, 69), context.__test.indexOf(61, 69)];
assert.ok(curvedTargets.some((target) => context.__test.cells[target] === context.__test.PLANT), '草应优先向斜上方弯曲生长');
assert.ok(context.__test.plantAge[curvedStem] > 0, '草应记录生长年龄');

context.__test.cells.fill(context.__test.EMPTY);
context.__test.energy.fill(0);
context.__test.plantAge.fill(0);
context.__test.plantLean.fill(0);
context.__test.moved.fill(0);
const seedCell = context.__test.indexOf(70, 70);
const seedWaterCell = context.__test.indexOf(71, 70);
const seedClusterCell = context.__test.indexOf(70, 71);
context.__test.setCell(seedCell, context.__test.SEED);
context.__test.setCell(seedClusterCell, context.__test.SEED);
context.__test.setCell(seedWaterCell, context.__test.WATER);
// 水中的种子先吸水几帧，再完成播种；这段延迟用于验证种子土不会瞬间消失。
for (let frame = 0; frame < 9; frame++) context.__test.updateSeed(70, 70, seedCell);
assert.equal(context.__test.cells[seedCell], context.__test.PLANT, '种子接触水后应发芽为草');
assert.equal(context.__test.cells[seedWaterCell], context.__test.EMPTY, '种子发芽应消耗相邻水格');
assert.equal(context.__test.cells[seedClusterCell], context.__test.EMPTY, '相连的种子团应在播种后消失');
assert.ok(!context.__test.cells.some((kind) => kind === context.__test.FLOWER), '播种完成后应先长根茎，不应立即生成花');
assert.equal(context.__test.cells.filter((kind) => kind === context.__test.PLANT).length, 1, '播种完成时应先只留下一个发芽点');

context.__test.cells.fill(context.__test.EMPTY);
context.__test.energy.fill(0);
context.__test.plantAge.fill(0);
context.__test.plantLean.fill(0);
context.__test.moved.fill(0);
const growingPlant = context.__test.indexOf(100, 100);
context.__test.setCell(growingPlant, context.__test.PLANT, 180, 0, 1);
for (let frame = 0; frame < 16; frame++) context.__test.updatePlant(100, 100, growingPlant);
assert.ok(context.__test.cells.filter((kind) => kind === context.__test.PLANT).length > 1, '草茎应能在播种后继续分枝生长');

context.__test.cells.fill(context.__test.EMPTY);
context.__test.energy.fill(0);
context.__test.plantAge.fill(0);
context.__test.plantLean.fill(0);
const youngStem = context.__test.indexOf(80, 70);
context.__test.setCell(youngStem, context.__test.PLANT, 100, 10, -1);
context.__test.updatePlant(80, 70, youngStem);
assert.ok(!context.__test.cells.some((kind) => kind === context.__test.FLOWER), '年轻根茎应先长高，不能过早开花');

context.__test.cells.fill(context.__test.EMPTY);
context.__test.energy.fill(0);
context.__test.plantAge.fill(0);
context.__test.plantLean.fill(0);
const matureStem = context.__test.indexOf(80, 70);
context.__test.setCell(matureStem, context.__test.PLANT, 100, 80, -1);
context.__test.updatePlant(80, 70, matureStem);
const flowerTargets = [
  context.__test.indexOf(79, 69),
  context.__test.indexOf(81, 69),
  context.__test.indexOf(78, 68),
  context.__test.indexOf(80, 68),
];
assert.ok(flowerTargets.some((target) => context.__test.cells[target] === context.__test.FLOWER), '根茎达到高度后应在枝端开花');
assert.ok(context.__test.cells[matureStem] === context.__test.PLANT, '开花后根茎仍应继续作为伴生支撑');
const buddingFlower = flowerTargets.find((target) => context.__test.cells[target] === context.__test.FLOWER);
const buddingEnergy = context.__test.energy[buddingFlower];
context.__test.updateFlower(buddingFlower % 360, Math.floor(buddingFlower / 360), buddingFlower);
assert.ok(context.__test.energy[buddingFlower] > buddingEnergy, '花朵应从小花苞逐帧展开');
for (let frame = 0; frame < 30; frame++) {
  context.__test.updateFlower(buddingFlower % 360, Math.floor(buddingFlower / 360), buddingFlower);
}
assert.ok(context.__test.energy[buddingFlower] >= 24, '花朵经过展开阶段后应达到完整状态');
const flowerCountAfterFirstBloom = context.__test.cells.filter((kind) => kind === context.__test.FLOWER).length;
context.__test.updatePlant(80, 70, matureStem);
assert.equal(
  context.__test.cells.filter((kind) => kind === context.__test.FLOWER).length,
  flowerCountAfterFirstBloom,
  '同一花端附近应保持留白，不能连续叠加花朵',
);

context.__test.cells.fill(context.__test.EMPTY);
context.__test.energy.fill(0);
context.__test.plantAge.fill(0);
context.__test.plantLean.fill(0);
const dryMatureStem = context.__test.indexOf(120, 70);
context.__test.setCell(dryMatureStem, context.__test.PLANT, 0, 80, 1);
context.__test.updatePlant(120, 70, dryMatureStem);
assert.ok(context.__test.cells.some((kind) => kind === context.__test.FLOWER), '成熟根茎没有持续浇水也应能开花');

context.__test.cells.fill(context.__test.EMPTY);
context.__test.energy.fill(0);
context.__test.plantAge.fill(0);
context.__test.plantLean.fill(0);
context.__test.moved.fill(0);
const acidCell = context.__test.indexOf(30, 30);
const woodCell = context.__test.indexOf(31, 30);
context.__test.setCell(acidCell, context.__test.ACID);
context.__test.setCell(woodCell, context.__test.WOOD);
context.__test.updateAcid(30, 30, acidCell);
assert.equal(context.__test.cells[woodCell], context.__test.EMPTY, '酸应腐蚀相邻木头');

const saltCell = context.__test.indexOf(40, 40);
const saltWaterCell = context.__test.indexOf(41, 40);
context.__test.setCell(saltCell, context.__test.SALT);
context.__test.setCell(saltWaterCell, context.__test.WATER);
context.__test.updateSalt(40, 40, saltCell);
assert.equal(context.__test.cells[saltCell], context.__test.EMPTY, '盐接触水后应溶解');

const sparkCell = context.__test.indexOf(50, 50);
const conductorCell = context.__test.indexOf(51, 50);
context.__test.setCell(sparkCell, context.__test.ELECTRICITY, 12);
context.__test.setCell(conductorCell, context.__test.METAL);
context.__test.updateElectricity(50, 50, sparkCell);
assert.ok(context.__test.energy[conductorCell] > 0, '电流应激活相邻金属');

console.log('Smoke test passed: initialization, palette, 240 updates, and rendering are valid.');
