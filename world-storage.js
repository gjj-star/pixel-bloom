// 多作品使用 IndexedDB，避免多份网格迅速耗尽 localStorage 的容量。
(() => {
  const library = document.querySelector('#world-library');
  const list = document.querySelector('#world-list');
  const status = document.querySelector('#library-status');
  const autoStatus = document.querySelector('#autosave-status');
  const resumeActions = document.querySelector('#resume-actions');
  const nameInput = document.querySelector('#world-name');
  const fileInput = document.querySelector('#world-file');
  const AUTO = '__autosave__';
  let dbPromise, available = true, awaitingResume = true, busy = false;
  let resumeRecord = null, wasRunning = false, initialized = false;

  function database() {
    if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open('sandspiel-world-library', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('worlds', { keyPath: 'id' });
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('存档数据库被其他标签页占用'));
    });
    return dbPromise;
  }

  async function storage(mode, operation) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const transaction = db.transaction('worlds', mode);
      const request = operation(transaction.objectStore('worlds'));
      transaction.oncomplete = () => resolve(request.result);
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('存档写入中断'));
    });
  }

  function fail(error) {
    console.error('World storage:', error);
    status.textContent = '操作失败：文件可能不兼容，或浏览器存储不可用／空间不足。已有存档不会被主动删除，可导出当前世界备份。';
    showMessage(status.textContent);
  }

  // 导入文件视为不可信数据：先完整检查，再接触当前世界。
  function validate(payload) {
    const assert = (condition) => { if (!condition) throw new Error('无效或不兼容的世界文件'); };
    assert(payload?.version === 1 && payload.width === WIDTH && payload.height === HEIGHT);
    // 旧存档的 gameMode、gardenTasks、gardenJournal 字段忽略，统一读取为自由沙盒。
    assert(payload.scenePreset === undefined || Object.hasOwn(SCENE_PRESETS, payload.scenePreset));
    assert(Number.isSafeInteger(payload.tick) && payload.tick >= 0);
    if (payload.animals !== undefined) {
      const state = payload.animals;
      assert(state && Array.isArray(state.chicks) && state.chicks.length <= 10 &&
        Number.isSafeInteger(state.fruitSpent) && state.fruitSpent >= 0 &&
        Number.isSafeInteger(state.nextId) && state.nextId > 0);
      const ids = new Set();
      for (const chick of state.chicks) {
        assert(chick && Object.values(chick).every((value) => typeof value === 'number' && Number.isFinite(value)) &&
          Number.isSafeInteger(chick.id) && chick.id > 0 && chick.id < state.nextId && !ids.has(chick.id) &&
          chick.x >= 4 && chick.x <= WIDTH - 5 && chick.y >= 9 && chick.y < HEIGHT &&
          chick.vy >= 0 && chick.vy <= 1 && [-1, 1].includes(chick.direction) &&
          chick.fullness >= 0 && chick.fullness <= 100 && Number.isSafeInteger(chick.age) && chick.age >= 0 &&
          Number.isInteger(chick.eating) && chick.eating >= 0 && chick.eating <= 90 &&
          Number.isSafeInteger(chick.meals) && chick.meals >= 0);
        assert(chick.state === undefined || Number.isInteger(chick.state) && chick.state >= 0 && chick.state <= 5);
        assert(chick.stateTicks === undefined || Number.isInteger(chick.stateTicks) && chick.stateTicks >= 0 && chick.stateTicks <= 300);
        assert(chick.moving === undefined || [0, 1].includes(chick.moving));
        assert(chick.growth === undefined || chick.growth >= 0 && chick.growth <= 1);
        assert(chick.growthTicks === undefined || chick.growthTicks >= 0 && chick.growthTicks <= 7200);
        assert(chick.coat === undefined || Number.isInteger(chick.coat) && chick.coat >= 0 && chick.coat <= 2);
        assert(chick.eggProgress === undefined || Number.isInteger(chick.eggProgress) && chick.eggProgress >= 0 && chick.eggProgress <= 1200);
        ids.add(chick.id);
      }
      if (state.eggs !== undefined) {
        assert(Array.isArray(state.eggs) && state.eggs.length <= 8);
        assert(state.collectedEggs === undefined || Number.isSafeInteger(state.collectedEggs) && state.collectedEggs >= 0);
        assert(state.nextEggId === undefined || Number.isSafeInteger(state.nextEggId) && state.nextEggId > 0);
        const counts = new Map();
        const eggIds = new Set();
        for (const egg of state.eggs) {
          assert(egg && Number.isInteger(egg.x) && egg.x >= 2 && egg.x <= WIDTH - 3 &&
            Number.isInteger(egg.y) && egg.y >= 4 && egg.y < HEIGHT && ids.has(egg.parentId));
          assert(egg.hatchProgress === undefined || Number.isInteger(egg.hatchProgress) && egg.hatchProgress >= 0 && egg.hatchProgress <= 2400);
          assert(egg.id === undefined || Number.isSafeInteger(egg.id) && egg.id > 0 && !eggIds.has(egg.id) &&
            Number.isSafeInteger(state.nextEggId) && egg.id < state.nextEggId);
          if (egg.id !== undefined) eggIds.add(egg.id);
          counts.set(egg.parentId, (counts.get(egg.parentId) || 0) + 1);
          assert(counts.get(egg.parentId) <= 2);
        }
      }
    }
    const limits = { cells: [0, MATERIALS.length - 1], energy: [0, 65535], plantAge: [0, 65535],
      plantLean: [-128, 127], plantBranchBudget: [0, 255], plantBranchId: [0, 4294967294] };
    for (const [key, [min, max]] of Object.entries(limits)) {
      const array = payload[key];
      if (array === undefined && ['plantBranchBudget', 'plantBranchId'].includes(key)) continue;
      assert(Array.isArray(array) && array.length === cells.length &&
        array.every((value) => Number.isInteger(value) && value >= min && value <= max));
    }
    let nodes = 0;
    function safe(value, depth = 0) {
      assert(++nodes < 3000000 && depth < 16);
      if (typeof value === 'number') { assert(Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER); return; }
      if (value === null || ['string', 'boolean'].includes(typeof value)) return;
      assert(typeof value === 'object');
      for (const [key, child] of Object.entries(value)) {
        assert(!['__proto__', 'prototype', 'constructor'].includes(key));
        safe(child, depth + 1);
      }
    }
    safe(payload);
    const pairs = (key) => {
      const entries = payload[key] || [];
      assert(Array.isArray(entries) && entries.length <= cells.length);
      const ids = new Set();
      for (const entry of entries) {
        assert(Array.isArray(entry) && entry.length === 2 && Number.isInteger(entry[0]) && entry[0] > 0 && !ids.has(entry[0]));
        ids.add(entry[0]);
      }
      return entries;
    };
    for (const [, family] of pairs('plantFamilies')) {
      assert(family && typeof family === 'object' && !Array.isArray(family));
      assert(Number.isInteger(family.rootX) && family.rootX >= 0 && family.rootX < WIDTH &&
        Number.isInteger(family.rootY) && family.rootY >= 0 && family.rootY < HEIGHT);
      assert(!family.species || ['flower', 'tree', 'giant', 'mushroom', 'cactus'].includes(family.species));
      for (const key of ['branchTips', 'branchBlooms', 'branchTargets', 'branchSpreads', 'treeDepths', 'treeCanopies']) {
        const map = family[key] || {};
        assert(typeof map === 'object' && !Array.isArray(map));
        for (const [id, value] of Object.entries(map)) {
          assert(/^\d+$/.test(id) && Number.isFinite(value));
          if (key === 'branchTips') assert(Number.isInteger(value) && value >= 0 && value < cells.length);
        }
      }
      for (const key of ['treeLayers', 'cactusArms']) assert(!family[key] || Array.isArray(family[key]));
      for (const key of ['treeBranches', 'treeFruitStates', 'cactusBranches', 'treeDetours']) {
        assert(!family[key] || typeof family[key] === 'object' && !Array.isArray(family[key]));
      }
      for (const path of Object.values(family.treeDetours || {})) {
        assert(Array.isArray(path) && path.every((point) => Array.isArray(point) && point.length === 2 &&
          Number.isInteger(point[0]) && Number.isInteger(point[1]) && inBounds(...point)));
      }
    }
    for (const key of ['branchFamilies', 'branchBloomOffsets']) {
      for (const [, value] of pairs(key)) assert(Number.isFinite(value));
    }
    assert(!payload.floweredBranches || Array.isArray(payload.floweredBranches) &&
      payload.floweredBranches.every((id) => Number.isInteger(id) && id > 0));
    for (const key of ['nextBranchId', 'nextPlantFamilyId']) {
      assert(payload[key] === undefined || Number.isInteger(payload[key]) && payload[key] > 0 && payload[key] <= 4294967294);
    }
    assert(payload.fruitTimingVersion === undefined || [1, 2].includes(payload.fruitTimingVersion));
    for (const [, family] of payload.plantFamilies || []) {
      for (const [key, value] of Object.entries(family)) {
        if (['species', 'treeKind'].includes(key)) { assert(typeof value === 'string'); continue; }
        if (value === null || typeof value !== 'object') { assert(typeof value === 'number' || typeof value === 'boolean'); continue; }
        if (['treeLayers', 'cactusArms'].includes(key)) {
          assert(value.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) &&
            Object.values(entry).every((item) => typeof item === 'number' || typeof item === 'boolean')));
        }
        if (['treeBranches', 'treeFruitStates', 'cactusBranches'].includes(key)) {
          assert(Object.values(value).every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) &&
            Object.values(entry).every((item) => typeof item === 'number')));
        }
      }
    }
    return payload;
  }

  function thumbnail() {
    render();
    const preview = document.createElement('canvas');
    preview.width = 180; preview.height = 110;
    const context = preview.getContext('2d');
    context.drawImage(canvas, 0, 0, 180, 110);
    context.drawImage(effectsCanvas, 0, 0, 180, 110);
    return preview.toDataURL('image/png');
  }

  function record(id, name) {
    return { id, name: name.trim().slice(0, 40) || '未命名世界', savedAt: Date.now(),
      thumbnail: thumbnail(), payload: createWorldPayload() };
  }

  async function autosave() {
    if (!initialized || !available || awaitingResume || busy || library.open || paintDown) return;
    busy = true;
    try {
      const saved = record(AUTO, '上次世界（自动保存）');
      await storage('readwrite', (store) => store.put(saved));
      resumeRecord = saved;
      autoStatus.textContent = `已自动保存 · ${new Date(saved.savedAt).toLocaleTimeString()}`;
    } catch (error) {
      autoStatus.textContent = '自动保存失败，请导出世界备份；旧存档未主动删除。';
      console.error(error);
    } finally { busy = false; }
  }

  function download(payload, name) {
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = `${(name || '我的世界').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')}.json`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function loadRecord(saved) {
    try {
      const payload = validate(saved.payload);
      if (!confirm(`读取“${saved.name}”并替换当前画布？当前画布可按 Z 撤销恢复。`)) return;
      stopPainting();
      const previous = createSnapshot();
      try { restoreSnapshot(payload); }
      catch (error) {
        restoreSnapshot(previous);
        throw error;
      }
      undoStack.push(previous);
      if (undoStack.length > MAX_UNDO_STEPS) undoStack.shift();
      undoButton.disabled = false;
      awaitingResume = false;
      resumeActions.hidden = true;
      nameInput.value = saved.id === AUTO ? '' : saved.name;
      if (library.open) library.close();
      autoStatus.textContent = '世界已读取，下次自动保存将在 20 秒内完成';
      showMessage(`已读取：${saved.name}`);
    } catch (error) { fail(error); }
  }

  async function renderLibrary() {
    list.replaceChildren();
    let all = [];
    try { all = await storage('readonly', (store) => store.getAll()); }
    catch { status.textContent = '作品库暂不可用，可尝试读取旧版存档，或使用导入／导出文件备份。'; }
    // 旧单槽存档只读展示，不迁移删除，也不占用新作品的名称。
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      if (raw) all.push({ id: '__legacy__', name: '旧版单槽存档', payload: JSON.parse(raw) });
    } catch { status.textContent = '旧版存档无法读取；新作品库仍可使用。'; }
    all.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
    if (!all.length) { list.textContent = '还没有作品。输入名称，保存你的第一个世界吧。'; return; }
    for (const saved of all) {
      const card = document.createElement('article'); card.className = 'world-card';
      if (saved.thumbnail?.startsWith('data:image/png;base64,')) {
        const image = document.createElement('img'); image.src = saved.thumbnail; image.alt = `${saved.name}的预览`; card.append(image);
      }
      const title = document.createElement('h3'); title.textContent = saved.name;
      const time = document.createElement('p'); time.textContent = saved.savedAt ? new Date(saved.savedAt).toLocaleString() : '保留原始存档';
      const details = document.createElement('p');
      details.textContent = `自由沙盒 · ${SCENE_PRESETS[saved.payload.scenePreset]?.name || '材料实验室'}`;
      const actions = document.createElement('div'); actions.className = 'library-actions';
      const button = (label, handler) => {
        const element = document.createElement('button'); element.type = 'button'; element.textContent = label;
        element.addEventListener('click', () => operate(handler)); actions.append(element);
      };
      button('读取', () => loadRecord(saved));
      button('导出', () => download(saved.payload, saved.name));
      if (saved.id !== AUTO && saved.id !== '__legacy__') {
        button('覆盖为当前世界', async () => {
          if (!confirm(`覆盖“${saved.name}”？原版本将被替换，建议先导出备份。`)) return;
          await storage('readwrite', (store) => store.put(record(saved.id, saved.name)));
          status.textContent = '作品已覆盖保存'; await renderLibrary();
        });
        button('改名', async () => {
          const name = prompt('新的作品名称（最多 40 字）', saved.name);
          if (!name?.trim()) return;
          await storage('readwrite', (store) => store.put({ ...saved, name: name.trim().slice(0, 40) }));
          await renderLibrary();
        });
        button('删除', async () => {
          if (!confirm(`永久删除“${saved.name}”？此操作不可撤销，请先导出需要的备份。`)) return;
          await storage('readwrite', (store) => store.delete(saved.id));
          status.textContent = '已删除该本地作品；已导出的备份文件不受影响。'; await renderLibrary();
        });
      }
      card.append(title, time, details, actions); list.append(card);
    }
  }

  async function operate(handler) {
    if (busy) return;
    busy = true;
    library.setAttribute('aria-busy', 'true');
    try { await handler(); } catch (error) { fail(error); }
    finally { busy = false; library.removeAttribute('aria-busy'); }
  }

  function open() {
    if (library.open) return;
    stopPainting(); wasRunning = running; running = false;
    library.showModal();
    status.textContent = available ? '' : '浏览器存储不可用，仍可导出当前世界或导入文件。';
    operate(renderLibrary);
  }
  globalThis.worldStorage = { open };
  library.addEventListener('close', () => { running = wasRunning; pauseButton.textContent = running ? '⏸ 暂停' : '▶ 继续'; });
  document.querySelector('#library-close').addEventListener('click', () => { if (!busy) library.close(); });
  library.addEventListener('cancel', (event) => { if (busy) event.preventDefault(); });
  document.querySelector('#library-save').addEventListener('click', () => operate(async () => {
    const saved = record(globalThis.crypto?.randomUUID?.() || `world-${Date.now()}-${Math.random()}`, nameInput.value);
    await storage('readwrite', (store) => store.put(saved));
    status.textContent = `已保存：${saved.name}`; await renderLibrary();
  }));
  document.querySelector('#library-export').addEventListener('click', () => operate(() => download(createWorldPayload(), nameInput.value)));
  document.querySelector('#library-import').addEventListener('click', () => { if (!busy) fileInput.click(); });
  fileInput.addEventListener('change', () => operate(async () => {
    const file = fileInput.files[0]; fileInput.value = '';
    if (!file) return;
    if (file.size > 20 * 1024 * 1024) throw new Error('文件超过 20 MB');
    const payload = validate(JSON.parse(await file.text()));
    await loadRecord({ id: '__import__', name: file.name.replace(/\.json$/i, ''), payload });
  }));
  document.querySelector('#resume-world').addEventListener('click', () => operate(async () => {
    if (resumeRecord) await loadRecord(resumeRecord);
  }));
  document.querySelector('#fresh-world').addEventListener('click', () => {
    if (busy || !confirm('使用当前世界开始？下一次自动保存将替换上次自动存档，命名作品不受影响。')) return;
    awaitingResume = false; resumeActions.hidden = true; autosave();
  });

  async function initialize() {
    try {
      resumeRecord = await storage('readonly', (store) => store.get(AUTO));
      awaitingResume = Boolean(resumeRecord);
      resumeActions.hidden = !resumeRecord;
      autoStatus.textContent = resumeRecord ? '发现上次世界：请选择继续或从当前世界开始；选择前不会覆盖自动存档。'
        : '自动保存已开启，每 20 秒保存一次；建议定期导出备份';
    } catch (error) {
      available = false; awaitingResume = false;
      autoStatus.textContent = '浏览器存储不可用，请使用导出文件备份世界'; console.error(error);
    }
    initialized = true;
  }
  initialize();
  setInterval(autosave, 20000);
  document.addEventListener('visibilitychange', () => { if (document.hidden) autosave(); });
})();
