/* ============================
   PIXEL MINER — Core Script
   ============================ */

(() => {
  const mineEl = document.getElementById('mine');
  const depthEl = document.getElementById('depth');
  const moneyEl = document.getElementById('money');
  const shopBtn = document.getElementById('shopBtn');
  const pediaBtn = document.getElementById('pediaBtn');
  const surfaceBtn = document.getElementById('surfaceBtn');
  const shopModal = document.getElementById('shopModal');
  const pediaModal = document.getElementById('pediaModal');
  const closeButtons = document.querySelectorAll('.close');
  const tabs = document.querySelectorAll('.tab');
  const tabPanels = {
    upgrades: document.getElementById('tab-upgrades'),
    boosts: document.getElementById('tab-boosts'),
    skins: document.getElementById('tab-skins'),
  };
  const upgradeList = document.getElementById('upgradeList');
  const boostList = document.getElementById('boostList');
  const skinList = document.getElementById('skinList');
  const upgradeProgress = document.getElementById('upgradeProgress');
  const advancedWrap = document.getElementById('advancedUpgrades');
  const buyAdvancedBtn = document.getElementById('buyAdvanced');

  const cursorGif = document.getElementById('cursorGif');
  const mineSound = document.getElementById('mineSound');

  // CONFIG
  const BLOCK = { size: parseInt(getComputedStyle(document.documentElement).getPropertyValue('--block-size')) || 56, cols: 12 };
  const VIEW_MARGIN_ROWS = 8; // generate a little beyond the viewport
  const BARRIER_EVERY = 20;   // rows (approx) between barriers at first, scales with depth

  // ECON & MATERIALS
  const materials = [
    { id:'stone',   name:'Stone',    color:'#808b96', base:1,   rarity:0.60, depthBias:0 },
    { id:'coal',    name:'Coal',     color:'#3a3a3a', base:3,   rarity:0.18, depthBias:4 },
    { id:'iron',    name:'Iron',     color:'#b3b3b3', base:6,   rarity:0.12, depthBias:12 },
    { id:'gold',    name:'Gold',     color:'#f5c542', base:12,  rarity:0.06, depthBias:25 },
    { id:'emerald', name:'Emerald',  color:'#2ecc71', base:24,  rarity:0.025, depthBias:40 },
    { id:'diamond', name:'Diamond',  color:'#74e4ff', base:40,  rarity:0.010, depthBias:65 },
    { id:'ruby',    name:'Ruby',     color:'#ff4d6d', base:55,  rarity:0.006, depthBias:85 },
  ];

  // Game state
  const state = {
    money: 0,
    depth: 0, // meters roughly equals rows mined/scroll position
    blocks: new Map(), // key "r:c" -> block data
    mined: 0,

    // Tools & Combat
    pickaxeLevel: 1,
    pickaxeDamage: 5,
    pickaxeSpeed: 1.0, // swing frequency multiplier; higher = faster
    critChance: 0.05,
    critMult: 2.0,

    // Custom upgrades
    rareChanceBonus: 0, // increases chance to roll rare ores
    skin: 'default',

    // Upgrades purchased (per category per level)
    upgradeCounts: {
      damage: 0,
      speed: 0,
      radar: 0, // custom upgrade
    },
    // For the 15-segment progress unlock
    totalUpgradePurchases: 0,
    advancedUnlocked: false,
  };

  /* ============================
     UTIL
  ============================ */

  const clamp = (n,min,max)=>Math.max(min,Math.min(max,n));
  const fmt = n => '£' + Math.floor(n).toLocaleString();
  const keyRC = (r,c)=>`${r}:${c}`;

  function rngSeeded(r, c) {
    // Basic deterministic RNG per cell (no libs)
    let x = (r * 73856093) ^ (c * 19349663) ^ 0x9e3779b9;
    x = (x ^ (x >>> 16)) * 0x45d9f3b;
    x = (x ^ (x >>> 16)) * 0x45d9f3b;
    x = (x ^ (x >>> 16));
    // 0..1
    return (x >>> 0) / 4294967295;
  }

  function chooseMaterial(row) {
    // Increase rarity of deeper ores with depthBias
    const depth = row;
    const weights = materials.map(m => {
      const bias = clamp((depth - m.depthBias) / 100, 0, 1);
      return m.rarity * (1 + bias) * (1 + state.rareChanceBonus);
    });
    const total = weights.reduce((a,b)=>a+b,0);
    let roll = Math.random() * total;
    for (let i=0;i<materials.length;i++){
      if ((roll -= weights[i]) <= 0) return materials[i];
    }
    return materials[0];
  }

  function generateHP(mat, row){
    // HP scales with depth; barriers have special handling elsewhere
    const base = 8 + row * 0.8;
    const matFactor = Math.max(1, materials.findIndex(m => m.id===mat.id)+1);
    return Math.floor(base * (0.6 + matFactor*0.2));
  }

  function isBarrierRow(row){
    // Barriers get rarer but tougher
    if (row < 15) return false;
    const every = Math.max( BARRIER_EVERY, Math.floor(row/4) );
    return row % every === 0;
  }

  function barrierRequirement(row){
    // Required damage and level scale with depth
    const reqDamage = 20 + Math.floor(row * 1.5);
    const reqLevel = 1 + Math.floor(row / 60);
    return { reqDamage, reqLevel };
  }

  /* ============================
     WORLD GENERATION (LAZY)
  ============================ */

  const renderedRows = new Set();

  function ensureRowsInView(){
    const top = window.scrollY;
    const h = window.innerHeight;
    const rowTop = Math.floor(top / BLOCK.size) - VIEW_MARGIN_ROWS;
    const rowBot = Math.floor((top + h) / BLOCK.size) + VIEW_MARGIN_ROWS;

    for (let r = Math.max(0,rowTop); r <= rowBot; r++){
      if (renderedRows.has(r)) continue;
      renderRow(r);
      renderedRows.add(r);
    }
  }

  function renderRow(r){
    // place BLOCK.cols blocks across, spaced by size
    for (let c=0; c<BLOCK.cols; c++){
      const x = 12 + c * (BLOCK.size + 6);
      const y = r * BLOCK.size + 140; // + header
      const el = document.createElement('div');
      el.className = 'block';
      el.style.left = `${x}px`;
      el.style.top = `${y}px`;

      // Barrier row?
      if (isBarrierRow(r)){
        const { reqDamage, reqLevel } = barrierRequirement(r);
        el.classList.add('barrier');
        el.style.background = 'linear-gradient(135deg, #394055, #151827)';
        el.dataset.type = 'barrier';
        el.dataset.row = r;
        el.dataset.reqDamage = reqDamage;
        el.dataset.reqLevel = reqLevel;
        el.innerHTML = `<div class="hp">Barrier • Dmg≥${reqDamage} • Lvl≥${reqLevel}</div>`;
        attachBlockHandlers(el);
        mineEl.appendChild(el);
        state.blocks.set(keyRC(r,c), {type:'barrier', row:r, col:c, hp: reqDamage * 3});
        continue;
      }

      // Material selection (deterministic-ish but with spice)
      const rnd = rngSeeded(r,c);
      const oldRandom = Math.random;
      Math.random = () => rnd; // bias chooseMaterial deterministically per cell
      const mat = chooseMaterial(r);
      Math.random = oldRandom;

      const hp = generateHP(mat, r);
      el.style.background = mat.color;
      el.dataset.type = mat.id;
      el.dataset.row = r;
      el.dataset.hp = hp;
      el.innerHTML = `<div class="hp">${hp}</div>`;
      attachBlockHandlers(el);
      mineEl.appendChild(el);
      state.blocks.set(keyRC(r,c), {type:mat.id, row:r, col:c, hp, mat});
    }
  }

  /* ============================
     INTERACTION
  ============================ */

  // Cursor GIF handling
  let holdInterval = null;
  let soundInterval = null;
  function showCursorGif(e){
    cursorGif.style.left = e.clientX + 'px';
    cursorGif.style.top = e.clientY + 'px';
    cursorGif.classList.add('show');
  }
  function hideCursorGif(){
    cursorGif.classList.remove('show');
  }

  function playMineSoundLoop(){
    clearInterval(soundInterval);
    try { mineSound.currentTime = 0; mineSound.play(); } catch(e){}
    soundInterval = setInterval(() => {
      try { mineSound.currentTime = 0; mineSound.play(); } catch(e){}
    }, Math.max(60, 140 / state.pickaxeSpeed)); // faster with speed
  }
  function stopMineSoundLoop(){
    clearInterval(soundInterval);
  }

  function tapFrameTick(){
    // Restart GIF to simulate "advance a frame"
    const base = "https://media3.giphy.com/media/v1.Y2lkPTZjMDliOTUyd3djZGx5azNwMnFvNzBhazR4dzdyYTdjbG93YW1tenJrbnBsNGx4bSZlcD12MV9zdGlja2Vyc19zZWFyY2gmY3Q9cw/A7VmRVZ1g5qxEthBX3/source.gif";
    cursorGif.src = base + "?t=" + Date.now();
  }

  document.addEventListener('mousedown', (e)=>{
    showCursorGif(e);
    tapFrameTick();
    playMineSoundLoop();
    // swing loop while holding (for continuous mining if you hold on a block)
    clearInterval(holdInterval);
    holdInterval = setInterval(()=>{ /* loop exists to sync feel with sound */ }, Math.max(50, 140 / state.pickaxeSpeed));
  });
  document.addEventListener('mousemove', (e)=>{
    if (cursorGif.classList.contains('show')) showCursorGif(e);
  });
  document.addEventListener('mouseup', ()=>{
    hideCursorGif();
    clearInterval(holdInterval);
    stopMineSoundLoop();
  });
  document.addEventListener('click', (e)=>{
    // each click "advances" the gif
    tapFrameTick();
    try { mineSound.currentTime = 0; mineSound.play(); } catch(_){}
  }, true);

  function attachBlockHandlers(el){
    el.addEventListener('mousedown', ()=> el.classList.add('hit'));
    el.addEventListener('mouseup', ()=> el.classList.remove('hit'));
    el.addEventListener('mouseleave', ()=> el.classList.remove('hit'));
    el.addEventListener('click', (e)=> tryMineBlock(e.currentTarget));
  }

  function tryMineBlock(el){
    const type = el.dataset.type;
    const row = parseInt(el.dataset.row,10);
    const key = keyRC(row, Math.round((parseInt(el.style.left)-12)/(BLOCK.size+6)));
    const data = state.blocks.get(key);
    if (!data) return;

    // Barriers gate by damage & level
    if (type === 'barrier'){
      const reqD = parseInt(el.dataset.reqDamage,10);
      const reqL = parseInt(el.dataset.reqLevel,10);
      if (state.pickaxeDamage < reqD || state.pickaxeLevel < reqL){
        // thunk but no break
        shake(el);
        return;
      }
      // barriers have big HP: use pickaxe damage
      const dealt = computeDamage();
      data.hp -= dealt;
      el.querySelector('.hp').textContent = `Barrier • ${Math.max(0, data.hp)} HP`;
      if (data.hp <= 0){
        rewardBarrier(row);
        removeBlock(el, key);
      }
      return;
    }

    // Normal block
    const dealt = computeDamage();
    data.hp -= dealt;
    el.dataset.hp = data.hp;
    el.querySelector('.hp').textContent = Math.max(0, data.hp);

    if (data.hp <= 0){
      const mat = data.mat || materials.find(m=>m.id===type);
      const value = mat.base * (1 + row/120); // deeper = more value
      state.money += value;
      moneyEl.textContent = fmt(state.money);
      removeBlock(el, key);
    }
  }

  function removeBlock(el, key){
    state.blocks.delete(key);
    el.remove();
  }

  function rewardBarrier(row){
    const bonus = 200 + row * 8;
    state.money += bonus;
    moneyEl.textContent = fmt(state.money);
    // also give a small crit buff to feel good
    state.critChance = Math.min(0.5, state.critChance + 0.005);
    floatText(`+${fmt(bonus)} • +0.5% Crit`, 1800);
  }

  function computeDamage(){
    const base = state.pickaxeDamage;
    const crit = Math.random() < state.critChance;
    return Math.floor(base * (crit ? state.critMult : 1));
  }

  function shake(el){
    el.style.transition = 'transform .06s';
    el.style.transform = 'translateX(3px)';
    setTimeout(()=>{ el.style.transform = 'translateX(-3px)'; }, 60);
    setTimeout(()=>{ el.style.transform = ''; el.style.transition = 'transform .05s'; }, 120);
  }

  function floatText(text, ms=1400){
    const n = document.createElement('div');
    n.textContent = text;
    n.style.position = 'fixed';
    n.style.right = '16px';
    n.style.bottom = '16px';
    n.style.background = '#111425';
    n.style.border = '1px solid #2b2f4a';
    n.style.padding = '8px 10px';
    n.style.borderRadius = '10px';
    n.style.color = '#cfe5ff';
    n.style.zIndex = '60';
    document.body.appendChild(n);
    setTimeout(()=>{ n.remove(); }, ms);
  }

  /* ============================
     DEPTH / SCROLL
  ============================ */
  function updateDepth(){
    const d = Math.max(0, Math.floor((window.scrollY) / BLOCK.size));
    state.depth = d;
    depthEl.textContent = `Depth: ${d}m`;
  }

  window.addEventListener('scroll', ()=>{
    updateDepth();
    ensureRowsInView();
  });

  surfaceBtn.addEventListener('click', ()=>{
    window.scrollTo({top:0, behavior:'smooth'});
  });

  /* ============================
     SHOP
  ============================ */
  function openModal(el){ el.setAttribute('aria-hidden','false'); }
  function closeModal(el){ el.setAttribute('aria-hidden','true'); }

  shopBtn.addEventListener('click', ()=> openModal(shopModal));
  pediaBtn.addEventListener('click', ()=> openModal(pediaModal));
  closeButtons.forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const which = btn.dataset.close;
      if (which==='shop') closeModal(shopModal);
      if (which==='pedia') closeModal(pediaModal);
    });
  });

  tabs.forEach(t=>{
    t.addEventListener('click', ()=>{
      tabs.forEach(x=>x.classList.remove('active'));
      t.classList.add('active');
      const name = t.dataset.tab;
      Object.keys(tabPanels).forEach(k=>{
        tabPanels[k].classList.toggle('hidden', k!==name);
      });
    });
  });

  // Build Upgrade Progress (15 segments)
  function renderUpgradeSegments(){
    upgradeProgress.innerHTML = '';
    const filled = clamp(state.totalUpgradePurchases, 0, 15);
    for (let i=0;i<15;i++){
      const s = document.createElement('div');
      s.className = 'seg' + (i<filled ? ' filled' : '');
      upgradeProgress.appendChild(s);
    }
    // Unlock advanced card at 15
    if (filled >= 15 && !state.advancedUnlocked){
      advancedWrap.classList.remove('hidden');
    }
  }

  // Base upgrades (5 per type per pickaxe level)
  function upgradeCapPerType(){
    return 5 * state.pickaxeLevel;
  }

  function renderUpgrades(){
    upgradeList.innerHTML = '';
    const cap = upgradeCapPerType();

    const items = [
      {
        id:'damage',
        title:'Pickaxe Damage',
        desc:'Increase base damage per swing.',
        get price(){ return 50 * Math.pow(1.65, state.upgradeCounts.damage); },
        buy(){
          if (!spend(this.price)) return;
          state.upgradeCounts.damage++;
          state.pickaxeDamage = Math.floor(5 + state.upgradeCounts.damage * 2 + (state.pickaxeLevel-1)*5);
          incProgress();
          renderAllShop();
        }
      },
      {
        id:'speed',
        title:'Pickaxe Speed',
        desc:'Swing faster (lower delay).',
        get price(){ return 60 * Math.pow(1.7, state.upgradeCounts.speed); },
        buy(){
          if (!spend(this.price)) return;
          state.upgradeCounts.speed++;
          state.pickaxeSpeed = 1.0 + state.upgradeCounts.speed * 0.08 + (state.pickaxeLevel-1)*0.1;
          incProgress();
          renderAllShop();
        }
      },
      {
        id:'radar',
        title:'Ore Radar',
        desc:'Slightly increases rare ore chance.',
        get price(){ return 120 * Math.pow(1.6, state.upgradeCounts.radar); },
        buy(){
          if (!spend(this.price)) return;
          state.upgradeCounts.radar++;
          state.rareChanceBonus = state.upgradeCounts.radar * 0.03;
          incProgress();
          renderAllShop();
        }
      }
    ];

    items.forEach(it=>{
      const count = state.upgradeCounts[it.id];
      const card = document.createElement('div');
      card.className = 'card';
      const maxed = count >= cap;
      card.innerHTML = `
        <h3>${it.title}</h3>
        <p>${it.desc}</p>
        <p>Level: ${count}/${cap}</p>
        <p class="price">${maxed ? 'MAX' : fmt(it.price)}</p>
        <button class="btn" ${maxed?'disabled':''}>${maxed?'Maxed':'Buy'}</button>
      `;
      card.querySelector('button').addEventListener('click', ()=>it.buy());
      upgradeList.appendChild(card);
    });

    // Level up pickaxe (appears once you max all 3 categories at current cap)
    const allMaxed = Object.values(state.upgradeCounts).every(v=>v>=cap);
    const levelUpPrice = 2000 * Math.pow(2.25, state.pickaxeLevel-1);
    const lvlCard = document.createElement('div');
    lvlCard.className = 'card';
    lvlCard.innerHTML = `
      <h3>Pickaxe Level ${state.pickaxeLevel}</h3>
      <p>Unlock higher upgrade caps and break deeper barriers.</p>
      <p class="price">${allMaxed?fmt(levelUpPrice):'Max all categories to level up'}</p>
      <button class="btn" ${allMaxed?'':'disabled'}>${allMaxed?'Level Up':'Locked'}</button>
    `;
    lvlCard.querySelector('button').addEventListener('click', ()=>{
      if (!allMaxed) return;
      if (!spend(levelUpPrice)) return;
      state.pickaxeLevel++;
      // small base bumps
      state.pickaxeDamage += 3;
      state.pickaxeSpeed += 0.05;
      floatText(`Pickaxe Level ${state.pickaxeLevel}!`);
      renderAllShop();
    });
    upgradeList.appendChild(lvlCard);
  }

  function incProgress(){
    state.totalUpgradePurchases = clamp(state.totalUpgradePurchases+1, 0, 15);
    renderUpgradeSegments();
  }

  // Advanced purchase
  buyAdvancedBtn.addEventListener('click', ()=>{
    const price = 15000;
    if (!spend(price)) return;
    state.advancedUnlocked = true;
    state.critChance = Math.min(0.8, state.critChance + 0.02);
    state.critMult += 0.25;
    state.pickaxeDamage = Math.floor(state.pickaxeDamage * 1.05);
    state.pickaxeSpeed += 0.05;
    buyAdvancedBtn.disabled = true;
    floatText('Advanced Upgrade Purchased!');
  });

  // Boosts (temporary)
  function renderBoosts(){
    boostList.innerHTML = '';
    const boosts = [
      {
        id:'doubledrops',
        title:'Double Sell (3 min)',
        desc:'Temporarily doubles ore sell value.',
        price: 2500,
        use(){
          if (!spend(this.price)) return;
          const original = computeSell;
          computeSell = (base,row)=> original(base,row) * 2;
          floatText('Double Sell ACTIVE (3 min)');
          setTimeout(()=>{ computeSell = original; floatText('Double Sell ended'); }, 180000);
          renderAllShop();
        }
      },
      {
        id:'adren',
        title:'Adrenaline (2 min)',
        desc:'+50% swing speed temporarily.',
        price: 1800,
        use(){
          if (!spend(this.price)) return;
          state.pickaxeSpeed += 0.5;
          floatText('Adrenaline ACTIVE (2 min)');
          setTimeout(()=>{ state.pickaxeSpeed -= 0.5; floatText('Adrenaline ended'); }, 120000);
          renderAllShop();
        }
      },
      {
        id:'scanner',
        title:'Deep Scanner (5 min)',
        desc:'+6% rare ore chance temporarily.',
        price: 2200,
        use(){
          if (!spend(this.price)) return;
          state.rareChanceBonus += 0.06;
          floatText('Deep Scanner ACTIVE (5 min)');
          setTimeout(()=>{ state.rareChanceBonus -= 0.06; floatText('Deep Scanner ended'); }, 300000);
          renderAllShop();
        }
      }
    ];

    boosts.forEach(b=>{
      const card = document.createElement('div');
      card.className = 'card';
      card.innerHTML = `
        <h3>${b.title}</h3>
        <p>${b.desc}</p>
        <p class="price">${fmt(b.price)}</p>
        <button class="btn">Buy & Activate</button>
      `;
      card.querySelector('button').addEventListener('click', ()=>b.use());
      boostList.appendChild(card);
    });
  }

  // Skins (cosmetic)
  function renderSkins(){
    skinList.innerHTML = '';
    const skins = [
      { id:'default', title:'Default', price:0, preview:'linear-gradient(135deg,#6e7b8a,#3a4152)' },
      { id:'ember',   title:'Ember',   price:500, preview:'linear-gradient(135deg,#ff9248,#992a14)' },
      { id:'glacier', title:'Glacier', price:500, preview:'linear-gradient(135deg,#9be1ff,#3468a5)' },
      { id:'toxic',   title:'Toxic',   price:750, preview:'linear-gradient(135deg,#b2ff59,#1f7a33)' },
    ];
    skins.forEach(s=>{
      const owned = localStorage.getItem('skinOwned-'+s.id)
