// 小鸡使用独立实体层，不占用材料格，也不会自动吃掉玩家的树果。
(() => {
  const placeButton = document.querySelector('#place-chick');
  const feedButton = document.querySelector('#feed-chick');
  const status = document.querySelector('#animal-status');
  const LIMIT = 10;
  // 0 走动，1 啄地，2 理毛，3 休息，4 被摸摸，5 吃完后的满足。
  const WALK = 0, PECK = 1, PREEN = 2, REST = 3, PET = 4, HAPPY = 5;
  const ADULT_GROWTH_TICKS = 7200;
  const ADULT_COATS = [
    { body: [237, 231, 208], head: [255, 246, 222], wing: [199, 190, 163], tail: '#8d8c78' },
    { body: [182, 115, 63], head: [223, 168, 96], wing: [137, 84, 49], tail: '#685644' },
    { body: [113, 130, 135], head: [193, 203, 197], wing: [77, 94, 103], tail: '#495963' },
  ];
  let chicks = [], eggs = [], fruitSpent = 0, nextId = 1, mode = '', acted = false, hinted = false;
  const EGG_INTERVAL = 1200, EGG_LIMIT = 8, EGGS_PER_CHICK = 2;
  const HATCH_TICKS = 2400;
  let nextEggId = 1, collectedEggs = 0;
  const broodEgg = (chick) => chicks.length < LIMIT && eggs.find((egg) => egg.parentId === chick.id);
  let cursor = null;
  const stock = () => Math.max(0, harvestTotals.picked + harvestTotals.fallen - fruitSpent);
  const at = (x, y) => inBounds(Math.floor(x), Math.floor(y)) ? cells[indexOf(Math.floor(x), Math.floor(y))] : STONE;
  const solid = (kind) => ![EMPTY, WATER, FIRE, SMOKE, STEAM, ELECTRICITY].includes(kind);
  const sizeFor = (growth = 0) => 1 + growth * 0.7;
  const stageFor = (chick) => chick.growth >= 0.95 ? '成鸡' : chick.growth >= 0.35 ? '少年鸡' : '幼雏';
  function fits(x, y, growth = 0) {
    const half = Math.ceil(2 * sizeFor(growth)), height = Math.ceil(7 * sizeFor(growth));
    if (x < Math.max(4, half + 1) || x > WIDTH - Math.max(5, half + 2) || y < Math.max(9, height + 1) || y >= HEIGHT) return false;
    for (let dy = -height; dy < 0; dy++) {
      for (let dx = -half; dx <= half; dx++) if (solid(at(x + dx, y + dy))) return false;
    }
    return true;
  }
  function supported(x, y) { return [-2, 0, 2].some((dx) => solid(at(x + dx, y))); }
  function wet(x, y) { return [-2, 0, 2].some((dx) => at(x + dx, y - 1) === WATER); }
  function cancelTool() {
    const previous = mode;
    mode = '';
    cursor = null;
    for (const button of [placeButton, feedButton]) {
      button.classList.remove('active'); button.setAttribute('aria-pressed', 'false');
    }
    if (previous) {
      selectedLabel.textContent = harvestMode ? '当前：🧺 采果' : `当前：${MATERIALS[selected].name}`;
      palette.querySelectorAll('[data-type]').forEach((button) => {
        const active = !harvestMode && Number(button.dataset.type) === selected;
        button.classList.toggle('active', active); button.setAttribute('aria-pressed', String(active));
      });
    }
  }
  function choose(next) {
    if (mode === next) { cancelTool(); selectMaterial(selected); return; }
    setHarvestMode(false);
    mode = next;
    placeButton.classList.toggle('active', next === 'place');
    feedButton.classList.toggle('active', next === 'feed');
    placeButton.setAttribute('aria-pressed', String(next === 'place'));
    feedButton.setAttribute('aria-pressed', String(next === 'feed'));
    palette.querySelectorAll('[data-type]').forEach((button) => { button.classList.remove('active'); button.setAttribute('aria-pressed', 'false'); });
    selectedLabel.textContent = next === 'place' ? '当前：🐤 放小鸡' : '当前：🍎 喂果';
    showMessage(next === 'place' ? '点空地放小鸡，点已有小鸡可摸摸它；最多 10 只' : '收集熟果后点击小鸡喂食；喂过的小鸡会在附近跟随持果的光标');
  }
  function hint(text) { if (!hinted) { showMessage(text); hinted = true; } }
  function pet(chick) {
    if (broodEgg(chick)) { hint('它正在照顾鸡蛋，孵出来后再摸摸吧'); return; }
    if (chick.eating > 0 || chick.state === PET) { hint('它正忙着吃东西或享受摸摸，稍等一下吧'); return; }
    pushUndoSnapshot();
    chick.state = PET; chick.stateTicks = 90; chick.moving = 0;
    acted = true;
    showMessage(`摸摸这只${stageFor(chick)}，它开心地扑了扑翅膀 ♥`);
  }
  function feed(chick) {
    if (stock() < 1) { hint('还没有可喂的果子，可以先直接采摘熟果'); return; }
    if (chick.eating > 0 || chick.fullness >= 80) { hint(running ? '这只小鸡还在吃或已经吃饱了，稍后再喂吧' : '小鸡还在进食或已经吃饱；继续模拟后才会消化'); return; }
    pushUndoSnapshot();
    fruitSpent++; chick.meals++; chick.fullness = Math.min(100, chick.fullness + 35); chick.eating = 90;
    chick.state = PECK; chick.stateTicks = 90; chick.moving = 0;
    acted = true;
    showMessage(`${stageFor(chick)}吃到果子啦！${chick.growth < 0.95 ? '吃饱后会长得更快。' : ''}剩余 ${stock()} 颗`);
    renderStatus();
  }
  function interactionNear(x, y) {
    const egg = eggs.slice().sort((a, b) => Math.hypot(a.x - x, a.y - 2 - y) - Math.hypot(b.x - x, b.y - 2 - y))
      .find((item) => Math.hypot(item.x - x, item.y - 2 - y) <= 4);
    if (egg) return { id: `egg:${egg.id}`, action: 'collect', label: `点击收集鸡蛋 · 孵化 ${Math.floor(egg.hatchProgress / HATCH_TICKS * 100)}%${chicks.length >= LIMIT ? '（小鸡已满，等待空位）' : ''}` };
    const distance = (chick) => Math.hypot(chick.x - x, chick.y - 4 * sizeFor(chick.growth) - y);
    const chick = chicks.slice().sort((a, b) => distance(a) - distance(b))
      .find((item) => distance(item) <= Math.max(9, 7 * sizeFor(item.growth)));
    if (!chick) return null;
    const action = chick.eating > 0 || chick.state === PET ? 'busy' : stock() > 0 && chick.fullness < 80 ? 'feed' : broodEgg(chick) ? 'brood' : 'pet';
    const label = action === 'feed' ? `点击喂这只${stageFor(chick)} · 消耗 1 颗果子` : action === 'pet'
      ? `点击摸摸这只${stageFor(chick)} · 不消耗果子${chick.fullness >= 80 ? '（它吃饱了）' : ''}`
      : action === 'brood' ? '正在孵蛋 · 有果子时可以喂食，不打断孵蛋' : '小鸡正在进食或享受摸摸，请稍等 · 点击不会扣果子';
    return { id: chick.id, action, label };
  }
  function interact(id) {
    if (acted) return;
    if (typeof id === 'string' && id.startsWith('egg:')) {
      const index = eggs.findIndex((egg) => `egg:${egg.id}` === id);
      if (index >= 0) {
        pushUndoSnapshot(); eggs.splice(index, 1); collectedEggs++;
        showMessage(`收集到一枚鸡蛋！已收集 ${collectedEggs} 枚`); renderStatus();
      }
      acted = true; return;
    }
    const chick = chicks.find((item) => item.id === id);
    if (!chick) { acted = true; return; }
    if (chick.eating > 0 || chick.state === PET) hint('它正忙着吃东西或享受摸摸，稍等一下吧');
    else if (stock() > 0 && chick.fullness < 80) feed(chick);
    else pet(chick);
    acted = true; // 同一次按下／拖动最多互动一次，不会拖到别处开始绘制。
  }
  function handle(x, y) {
    if (!mode) return false;
    if (acted) return true;
    if (mode === 'place') {
      const nearby = chicks.find((chick) => Math.hypot(chick.x - x, chick.y - 4 * sizeFor(chick.growth) - y) <= Math.max(9, 7 * sizeFor(chick.growth)));
      if (nearby) {
        pet(nearby);
        return true;
      }
      if (chicks.length >= LIMIT) { hint('鸡群已达 10 只，停止繁衍和继续放置'); return true; }
      let ground = null;
      for (let py = Math.max(9, Math.floor(y)); py < HEIGHT - 1; py++) {
        if (fits(x, py) && supported(x, py) && !wet(x, py)) { ground = py; break; }
        if (solid(at(x, py))) break; // 不穿过平台寻找它下面的地面。
      }
      if (ground === null || chicks.some((chick) => Math.abs(chick.x - x) < 9 && Math.abs(chick.y - ground) < 9)) {
        hint('这里没有足够的干燥落脚空间，换一块空地试试'); return true;
      }
      pushUndoSnapshot();
      chicks.push({ id: nextId++, x, y: ground, vy: 0, direction: Math.random() < 0.5 ? -1 : 1,
        fullness: 0, age: 0, eating: 0, meals: 0, state: WALK, stateTicks: randomBetween(90, 180), moving: 0,
        growth: 0, growthTicks: 0, eggProgress: 0, coat: randomBetween(0, ADULT_COATS.length - 1) });
      acted = true;
      showMessage('小鸡落地啦！切回材料后靠近它，点击即可喂果或摸摸');
    } else {
      const radius = Math.max(10, Number(brushInput.value) * WORLD_SCALE);
      const distance = (item) => Math.hypot(item.x - x, item.y - 4 * sizeFor(item.growth) - y);
      const chick = chicks.slice().sort((a, b) => distance(a) - distance(b))
        .find((item) => distance(item) <= Math.max(radius, 7 * sizeFor(item.growth)));
      if (!chick) { hint('请点击小鸡附近，不会在空白处消耗果子'); return true; }
      feed(chick);
    }
    renderStatus();
    return true;
  }
  function eggFits(x, y) {
    if (x < 2 || x > WIDTH - 3 || y < 4 || y >= HEIGHT) return false;
    for (let dy = -4; dy < 0; dy++) {
      for (let dx = -1; dx <= 1; dx++) if (solid(at(x + dx, y + dy))) return false;
    }
    return true;
  }
  function updateEggs(chick) {
    // 成鸡在干燥、有承托且营养充足时积累，不以库存直接换蛋。
    if (chicks.length >= LIMIT || broodEgg(chick) || chick.growth < 0.95 || chick.fullness < 20 || wet(chick.x, chick.y) ||
        !supported(chick.x, chick.y) || chick.eating > 0 || chick.state === PET ||
        eggs.length >= EGG_LIMIT || eggs.filter((egg) => egg.parentId === chick.id).length >= EGGS_PER_CHICK) return;
    chick.eggProgress = Math.min(EGG_INTERVAL, (chick.eggProgress || 0) + 1);
    if (chick.eggProgress < EGG_INTERVAL) return;
    for (const offset of [0]) {
      const x = Math.round(chick.x + offset), y = Math.floor(chick.y);
      if (!eggFits(x, y) || !solid(at(x, y)) ||
          eggs.some((egg) => Math.abs(egg.x - x) < 5 && Math.abs(egg.y - y) < 5)) continue;
      eggs.push({ id: nextEggId++, x, y, parentId: chick.id, hatchProgress: 0 });
      chick.eggProgress = 0; chick.fullness = Math.max(0, chick.fullness - 20);
      chick.state = HAPPY; chick.stateTicks = 100;
      showMessage('成鸡下蛋啦！它会留在这里孵蛋，直到小鸡出生');
      break; // 空间不足时等待，不把蛋生成进墙里。
    }
  }
  function update() {
    for (const egg of [...eggs]) {
      if (!solid(at(egg.x, egg.y)) && eggFits(egg.x, egg.y + 1)) egg.y++;
      if (!eggFits(egg.x, egg.y) || !solid(at(egg.x, egg.y)) || wet(egg.x, egg.y)) continue;
      const parent = chicks.find((chick) => chick.id === egg.parentId);
      if (chicks.length >= LIMIT || !parent || Math.abs(parent.x - egg.x) > 2 || Math.abs(parent.y - egg.y) > 2) continue;
      egg.hatchProgress = Math.min(HATCH_TICKS, egg.hatchProgress + 1);
      if (egg.hatchProgress < HATCH_TICKS || chicks.length >= LIMIT) continue;
      const birthX = [-10, 10, -14, 14].map((offset) => egg.x + offset).find((x) =>
        fits(x, egg.y) && supported(x, egg.y) && !wet(x, egg.y) &&
        !chicks.some((chick) => Math.abs(chick.x - x) < 9 && Math.abs(chick.y - egg.y) < 9));
      if (birthX === undefined) continue;
      chicks.push({ id: nextId++, x: birthX, y: egg.y, vy: 0, direction: Math.random() < 0.5 ? -1 : 1,
        fullness: 0, age: 0, eating: 0, meals: 0, state: HAPPY, stateTicks: 100, moving: 0,
        growth: 0, growthTicks: 0, eggProgress: 0, coat: randomBetween(0, ADULT_COATS.length - 1) });
      eggs.splice(eggs.indexOf(egg), 1);
      showMessage('鸡蛋孵化啦！一只小鸡探出了脑袋 ♥');
    }
    const follower = mode === 'feed' && cursor && stock() > 0 ? chicks.filter((chick) =>
      chick.meals > 0 && chick.fullness < 80 && chick.eating === 0 && chick.state !== PET &&
      Math.abs(chick.y - 4 * sizeFor(chick.growth) - cursor.y) <= 12 && Math.abs(chick.x - cursor.x) <= 48)
      .sort((a, b) => Math.abs(a.x - cursor.x) - Math.abs(b.x - cursor.x))[0] : null;
    for (const chick of chicks) {
      chick.moving = 0;
      chick.age++;
      chick.growthTicks = Math.min(ADULT_GROWTH_TICKS, chick.growthTicks + (chick.fullness > 0 ? 1.6 : 1));
      // 不喂食最多保持幼雏；一颗果子可进入少年期，三颗才可完全长成。
      const targetGrowth = Math.min(chick.growthTicks / ADULT_GROWTH_TICKS, (chick.meals + 1) / 4, 1);
      const nextGrowth = Math.min(targetGrowth, chick.growth + 1 / 1800);
      if (nextGrowth > chick.growth && fits(chick.x, chick.y, nextGrowth) &&
          !chicks.some((other) => other !== chick && Math.abs(other.x - chick.x) < 4 * sizeFor(nextGrowth) && Math.abs(other.y - chick.y) < 10)) {
        chick.growth = nextGrowth; // 周围没空间时等待，避免体型变大后穿墙。
      }
      chick.fullness = Math.max(0, chick.fullness - 0.012);
      updateEggs(chick);
      if (chick.eating > 0) {
        chick.eating--;
        if (chick.eating === 0) { chick.state = HAPPY; chick.stateTicks = 100; }
      } else {
        chick.stateTicks = Math.max(0, chick.stateTicks - 1);
        if (chick.stateTicks === 0) {
          const choice = Math.random();
          chick.state = choice < 0.45 ? WALK : choice < 0.72 ? PECK : choice < 0.87 ? PREEN : REST;
          if (chick.fullness >= 80 && choice > 0.5) chick.state = REST;
          chick.stateTicks = randomBetween(90, chick.state === REST ? 300 : 210);
          if (chick.state === WALK && Math.random() < 0.35) chick.direction *= -1;
        }
      }
      if (!supported(chick.x, chick.y)) {
        chick.vy = Math.min(1, chick.vy + 0.12);
        const nextY = Math.min(HEIGHT - 2, chick.y + chick.vy);
        if (fits(chick.x, nextY, chick.growth)) chick.y = nextY;
        else chick.vy = 0;
      } else {
        chick.y = Math.floor(chick.y); chick.vy = 0;
        const egg = broodEgg(chick);
        const following = Boolean(egg) || chick === follower;
        const targetX = egg ? egg.x : cursor?.x;
        if (chick.eating > 0 || chick.state === PET) continue;
        if (following) {
          if (Math.abs(targetX - chick.x) < (egg ? 1 : 5)) continue;
          chick.direction = Math.sign(targetX - chick.x);
        } else if (chick.state !== WALK) continue;
        const nx = chick.x + chick.direction * (following ? 0.12 : 0.075);
        let nextY = chick.y;
        if (!fits(nx, nextY, chick.growth) && fits(nx, nextY - 1, chick.growth) && supported(nx, nextY - 1)) nextY--;
        if (!fits(nx, nextY, chick.growth) || wet(nx, nextY) || !supported(nx, nextY + 1) ||
            chicks.some((other) => other !== chick && Math.abs(other.x - nx) < 3.5 * (sizeFor(chick.growth) + sizeFor(other.growth)) && Math.abs(other.y - nextY) < 10)) {
          chick.direction *= -1;
        } else { chick.x = nx; chick.y = nextY; chick.moving = 1; }
      }
    }
  }
  function draw(context, sx, sy) {
    context.save(); context.globalCompositeOperation = 'source-over'; context.shadowBlur = 0;
    for (const egg of eggs) {
      context.save(); context.translate(egg.x * sx, egg.y * sy); context.scale(sx, sy);
      context.fillStyle = '#c7b994'; context.fillRect(-1, -3, 3, 3);
      context.fillStyle = '#fff0cc'; context.fillRect(0, -4, 1, 1); context.fillRect(-1, -3, 2, 2);
      context.fillStyle = '#fff9e6'; context.fillRect(0, -3, 1, 1);
      if (egg.hatchProgress >= HATCH_TICKS * 0.75) {
        context.fillStyle = '#a39578'; context.fillRect(0, -3, 1, 1); context.fillRect(-1, -2, 1, 1);
      }
      context.restore();
    }
    for (const chick of chicks) {
      const size = sizeFor(chick.growth);
      context.save(); context.translate(chick.x * sx, chick.y * sy); context.scale(sx * chick.direction * size, sy * size);
      const coat = ADULT_COATS[chick.coat];
      const feathering = Math.max(0, Math.min(1, (chick.growth - 0.12) / 0.83));
      const blend = (young, adult) => `rgb(${young.map((channel, i) => Math.round(channel + (adult[i] - channel) * feathering)).join(',')})`;
      const walking = chick.moving === 1;
      const pecking = chick.eating > 0 || chick.state === PECK && !walking;
      const egg = broodEgg(chick);
      const brooding = egg && Math.abs(chick.x - egg.x) <= 2 && Math.abs(chick.y - egg.y) <= 2;
      const resting = (brooding || chick.state === REST) && !chick.eating && !walking;
      const petting = chick.state === PET;
      const happy = chick.state === HAPPY;
      const preening = chick.state === PREEN && !chick.eating && !walking;
      const phase = chick.age * (chick.eating ? 0.38 : 0.22);
      const bob = pecking ? 1 + (1 + Math.sin(phase)) * 1.3 : preening ? 0.4 : 0;
      if (petting || happy) context.translate(0, -Math.max(0, Math.sin(chick.age * 0.18)) * 0.7);
      if (resting) context.translate(0, 1);
      context.fillStyle = '#de943e';
      const stride = walking ? Math.sin(chick.age * 0.18) * 0.5 : 0;
      if (!resting) { context.fillRect(-2, -1, 1, 1 + stride); context.fillRect(1, -1, 1, 1 - stride); }
      context.fillStyle = blend([237, 201, 93], coat.body); context.fillRect(-3, -6, 6, 5); context.fillRect(-4, -4, 1, 2);
      if (chick.coat === 2 && feathering > 0) {
        context.save(); context.globalAlpha = feathering;
        context.fillStyle = '#d8ddd2';
        context.fillRect(-2, -5, 1, 1); context.fillRect(0, -3, 1, 1); context.fillRect(2, -4, 1, 1);
        context.restore();
      }
      if (chick.growth > 0.35) {
        context.save(); context.globalAlpha = Math.min(1, (chick.growth - 0.35) * 2);
        context.fillStyle = coat.tail; context.fillRect(-5, -5, 2, 2); context.fillRect(-6, -6, 1, 2);
        context.restore();
      }
      const headX = preening ? -2 : 0;
      context.fillStyle = blend([255, 228, 136], coat.head); context.fillRect(headX, -8 + bob, 4, 4); context.fillRect(-2, -6, 3, 3);
      context.fillStyle = blend([220, 169, 71], coat.wing);
      context.fillRect(-2, petting || happy ? -5 - Math.sin(chick.age * 0.6) : -4, 2, 2);
      context.fillStyle = '#e28e39'; context.fillRect(preening ? -3 : 4, -5 + bob, 2, 1);
      context.fillStyle = '#303a32'; context.fillRect(headX + 2, -7 + bob, resting || petting ? 2 : 1, resting || petting ? 0.5 : 1);
      if (chick.growth > 0.55) {
        context.save(); context.globalAlpha = Math.min(1, (chick.growth - 0.55) / 0.4);
        context.fillStyle = '#c96b61';
        context.fillRect(headX + 1, -9 + bob, 2, 1); context.fillRect(headX + 2, -10 + bob, 1, 1);
        context.fillRect(headX + 3, -4 + bob, 1, 1);
        context.restore();
      }
      if (chick.eating > 0 && chick.eating > 20) {
        context.fillStyle = '#d76e59'; context.fillRect(4, -1, 2, 1);
        context.fillStyle = '#f3cb7c'; context.fillRect(6, -1 - Math.abs(Math.sin(phase)), 0.6, 0.6);
      }
      if (chick.eating > 0 || petting || happy) {
        context.save(); context.translate(0, -(1 - ((chick.age % 40) / 40)) * 1.5);
        context.fillStyle = '#d46e69';
        context.fillRect(-1, -12, 1, 1); context.fillRect(1, -12, 1, 1); context.fillRect(-1, -11, 3, 1); context.fillRect(0, -10, 1, 1);
        context.restore();
      } else if (resting) {
        context.fillStyle = '#a3c4b2'; context.font = '3px monospace'; context.fillText('z', 2, -11 - Math.sin(chick.age * 0.03) * 0.4);
      }
      context.restore();
    }
    context.restore();
  }
  function renderStatus() {
    const text = `🍎 可喂果子 ${stock()} · 🐤 小鸡 ${chicks.length}/${LIMIT} · 🥚 地上 ${eggs.length}/${EGG_LIMIT} · 已收蛋 ${collectedEggs} · 已喂 ${fruitSpent} 颗`;
    if (status.textContent !== text) status.textContent = text;
  }
  function snapshot() { return { chicks: chicks.map((chick) => ({ ...chick })), eggs: eggs.map((egg) => ({ ...egg })), fruitSpent, nextId, nextEggId, collectedEggs }; }
  function restore(saved) {
    cancelTool();
    chicks = (saved?.chicks || []).slice(0, LIMIT).map((chick) =>
      ({ state: WALK, stateTicks: 120, moving: 0, growth: 0, growthTicks: 0, eggProgress: 0,
        coat: (chick.id - 1) % ADULT_COATS.length, ...chick }));
    eggs = (saved?.eggs || []).slice(0, EGG_LIMIT).map((egg, i) => ({ hatchProgress: 0, ...egg, id: egg.id ?? i + 1 }));
    nextEggId = Math.max(saved?.nextEggId || 1, ...eggs.map((egg) => egg.id + 1));
    collectedEggs = saved?.collectedEggs || 0;
    fruitSpent = Math.max(0, Math.min(saved?.fruitSpent || 0, harvestTotals.picked + harvestTotals.fallen));
    nextId = saved?.nextId || Math.max(0, ...chicks.map((chick) => chick.id)) + 1;
    acted = false; renderStatus();
  }
  globalThis.sandboxAnimals = {
    snapshot, restore, update, draw, handle, renderStatus, cancelTool, interactionNear, interact,
    get toolActive() { return Boolean(mode); },
    beginGesture() { acted = false; hinted = false; },
    clear() { chicks = []; eggs = []; cancelTool(); renderStatus(); },
    reset() { chicks = []; eggs = []; fruitSpent = 0; nextId = 1; nextEggId = 1; collectedEggs = 0; cancelTool(); },
  };
  placeButton.addEventListener('click', () => choose('place'));
  feedButton.addEventListener('click', () => choose('feed'));
  canvas.addEventListener('pointermove', (event) => {
    cursor = mode === 'feed' && event.pointerType !== 'touch' ? pointerPosition(event) : null;
  });
  canvas.addEventListener('pointerleave', () => { cursor = null; });
  renderStatus();
})();
