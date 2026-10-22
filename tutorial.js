// 轻量引导只观察真实操作，不创建演示植物、不自动改动世界或存档。
(() => {
  const KEY = 'sandspiel-tutorial-seen-v1';
  const panel = document.querySelector('#tutorial-panel');
  const title = document.querySelector('#tutorial-title');
  const label = document.querySelector('#tutorial-step-label');
  const description = document.querySelector('#tutorial-description');
  const feedback = document.querySelector('#tutorial-feedback');
  const back = document.querySelector('#tutorial-back');
  const next = document.querySelector('#tutorial-next');
  const tool = document.querySelector('#tutorial-tool');
  const openButton = document.querySelector('#tutorial-open');
  const steps = [
    { title: '铺一片沙地', target: '[data-type="1"]', material: SAND, action: '选择沙子',
      text: '选择沙子，在画布底部空白位置按住拖动，铺一小片承托面。沙子会自然下落堆积；画错可按 Z 撤销。画不进去时，换一块空白位置。' },
    { title: '播下种子', target: '[data-type="14"]', material: SEED, action: '选择普通种子',
      text: '在沙地上方少量播撒普通种子，让它落到沙地或平台上。普通种子长花草；小树种子才会长成果树，两者不是同一种植物。' },
    { title: '少量浇水', target: '[data-type="2"]', material: WATER, action: '选择水',
      text: '在刚才的种子旁少量画水，让水与种子接触。种子先吸水、落地，再发芽。不要一直灌水：长期深水会使多数植物枯萎。' },
    { title: '观察自然生长', target: '#world',
      text: '观察新芽逐节长高、花苞慢慢展开。模拟暂停时不会生长，可点击“继续”；速度可调高。种子必须接触水并找到承托面；此步可直接略过，不必一直等待。' },
    { title: '认识采果', target: '#world', action: '准备直接采摘', harvest: true,
      text: '普通花不会结果。小树长出树冠后才有青果。果子变红成熟后，在普通绘制模式把鼠标靠近它，出现抓手时点击即可采摘，不用切换采果工具；橡皮擦和小鸡工具除外。果子数量显示在画布上方，可以用“喂果”喂给小鸡。没有熟果时可先略过。' },
    { title: '保存你的作品', target: '#save', action: '打开存档管理', save: true,
      text: '点击“保存作品”，输入名称并另存。自动保存只滚动保留上次世界，命名作品互相独立；重要作品还应导出 JSON 文件备份。引导结束后仍可从顶部重新打开。' },
  ];
  let index = -1, highlighted = null, observed = new Set(), baselineFamilies = new Set();
  let initialHarvest = 0, saveOpened = false;

  function remember() {
    try { localStorage.setItem(KEY, '1'); } catch { /* 隐私模式下不阻碍引导。 */ }
  }
  function resetObservation() {
    observed.clear(); baselineFamilies = new Set(plantFamilies.keys());
    initialHarvest = harvestTotals.picked + harvestTotals.fallen;
    saveOpened = false;
  }
  function clearHighlight() {
    highlighted?.classList.remove('tutorial-highlight'); highlighted = null;
  }
  function success() {
    if (index <= 2) return observed.has(steps[index]?.material);
    if (index === 3) {
      for (const [id, family] of plantFamilies) {
        if (baselineFamilies.has(id)) continue;
        for (const [branchId, tip] of Object.entries(family.branchTips || {})) {
          if (cells[tip] === PLANT && plantBranchId[tip] === Number(branchId) && family.rootY - Math.floor(tip / WIDTH) >= 6) return true;
        }
      }
      return false;
    }
    if (index === 4) return harvestTotals.picked + harvestTotals.fallen > initialHarvest;
    return saveOpened;
  }
  function updateFeedback() {
    if (panel.hidden || index < 0) return;
    if (index === 5 && document.querySelector('#world-library').open) saveOpened = true;
    const done = success();
    const messages = [
      '已绘制沙子，可以继续播种。', '已播下种子，接下来给它少量水。', '已绘制水，请观察水是否接触种子；这不代表已发芽。',
      '已观察到本次练习的新植物逐节长高。', '已成功收集熟果，可用来喂小鸡。', '已打开存档管理；是否保存成功请看管理窗口提示。',
    ];
    const text = done ? `✓ ${messages[index]}` : index === 3 && !running
      ? '当前模拟已暂停，继续模拟后才会生长；也可直接阅读下一步。'
      : index === 5 ? '请打开存档管理了解保存方式，或直接完成引导。' : '可以在当前画布操作，也可以先阅读下一步。';
    if (feedback.textContent !== text) feedback.textContent = text;
    next.textContent = index === steps.length - 1 ? '完成引导' : done ? '下一步' : '暂不操作，下一步';
  }
  function renderStep() {
    clearHighlight();
    back.hidden = index < 0;
    back.disabled = index === 0;
    tool.hidden = true;
    if (index < 0) {
      title.textContent = '第一次来？用几步认识沙盒';
      label.textContent = '铺沙 → 播种 → 浇水 → 生长 → 采果 → 保存';
      description.textContent = '这里没有关卡限制。可以按引导体验，也可以跳过，直接自由创作。已有作品和上次世界不会被引导清空。';
      feedback.textContent = '';
      next.textContent = '开始引导';
      return;
    }
    const step = steps[index];
    title.textContent = step.title;
    label.textContent = `${index + 1} / ${steps.length}`;
    description.textContent = step.text;
    if (step.action) { tool.hidden = false; tool.textContent = step.action; }
    highlighted = document.querySelector(step.target);
    highlighted?.classList.add('tutorial-highlight');
    updateFeedback();
  }
  function close() {
    panel.hidden = true; clearHighlight(); remember();
    openButton.focus({ preventScroll: true });
  }
  function open() {
    index = -1; resetObservation(); panel.hidden = false; renderStep();
    panel.scrollIntoView({ block: 'nearest', behavior: 'auto' });
    next.focus({ preventScroll: true });
  }
  openButton.addEventListener('click', open);
  document.querySelector('#tutorial-skip').addEventListener('click', close);
  next.addEventListener('click', () => {
    if (index >= steps.length - 1) { close(); showMessage('引导结束，开始自由创作吧；顶部可随时重新打开'); return; }
    index++; renderStep();
  });
  back.addEventListener('click', () => { if (index > 0) { index--; renderStep(); } });
  tool.addEventListener('click', () => {
    const step = steps[index];
    if (!step) return;
    if (step.material !== undefined) selectMaterial(step.material);
    else if (step.harvest) { selectMaterial(SAND); showMessage('靠近成熟果实时鼠标会变抓手，点击即可采摘'); }
    else if (step.save) { saveWorld(); saveOpened = document.querySelector('#world-library').open; }
    updateFeedback();
  });
  globalThis.sandboxTutorial = {
    painted(kind, count) {
      if (!panel.hidden && index >= 0 && count > 0) { observed.add(kind); updateFeedback(); }
    },
    worldChanged() {
      if (!panel.hidden) {
        resetObservation();
        // 清空／读档后不沿用此前世界的操作判定；待本次同步操作完成再取新基线。
        queueMicrotask(() => { resetObservation(); updateFeedback(); });
      }
    },
  };
  setInterval(() => { if (!panel.hidden) updateFeedback(); }, 600);
  let seen = false;
  try { seen = localStorage.getItem(KEY) === '1'; } catch { /* 本页仍可正常跳过。 */ }
  if (!seen) { panel.hidden = false; resetObservation(); renderStep(); }
})();
