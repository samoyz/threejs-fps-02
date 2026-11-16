// The DOM HUD: crosshair, hit marker, health, ammo, money, timer, score, kill feed,
// bomb status, buy menu, minimap and the overlay panels. It never touches the
// simulation; main.js pushes numbers in and reads the button callbacks out.
import { WEAPONS, GRENADES, ARMOR_PRICE } from './weapons.js';

const COPY = {
  start: {
    title: 'Emberline',
    copy: 'A tactical round-based shooter in Foundry Yard. Plant the charge at Site A or B — or stop the other team from doing it. Click to play.',
    action: 'Click to play',
  },
  paused: {
    title: 'Emberline',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
  roundEnd: { title: '', copy: '', action: 'Next round' },
  matchEnd: { title: '', copy: '', action: 'Play again' },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthValue = $('health-value');
  const healthFill = $('health-fill');
  const armorValue = $('armor-value');
  const moneyValue = $('money-value');
  const timerValue = $('timer-value');
  const scoreEmber = $('score-ember');
  const scoreSlate = $('score-slate');
  const aliveEmber = $('alive-ember');
  const aliveSlate = $('alive-slate');
  const hitmarker = $('hitmarker');
  const crosshair = $('crosshair');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const bombStatus = $('bomb-status');
  const bombText = $('bomb-text');
  const bombFill = $('bomb-fill');
  const buyMenu = $('buy-menu');
  const buyList = $('buy-list');
  const buyMoney = $('buy-money');
  const buyClose = $('buy-close');
  const hint = $('hint');
  const vignette = $('damage-vignette');
  const minimap = $('minimap');

  let hitTimer = 0;
  let bannerTimer = 0;
  let lastAmmo = '';
  let lastHealth = '';
  let lastTimer = '';
  let lastScore = '';
  let lastMoney = -1;
  let lastBomb = '';

  function setAmmo(mag, reserve, name) {
    const key = `${mag}/${reserve}/${name}`;
    if (key === lastAmmo) return;
    lastAmmo = key;
    ammoMag.textContent = String(mag);
    ammoReserve.textContent = `/ ${reserve}`;
    weaponName.textContent = name;
    $('ammo').classList.toggle('empty', mag === 0);
  }

  function setHealth(hp, armor) {
    const key = `${hp}|${armor}`;
    if (key === lastHealth) return;
    lastHealth = key;
    healthValue.textContent = String(Math.max(0, Math.ceil(hp)));
    healthFill.style.width = `${Math.max(0, Math.min(100, hp))}%`;
    armorValue.textContent = armor > 0 ? `+${Math.ceil(armor)}` : '';
  }

  function setMoney(value) {
    if (value === lastMoney) return;
    lastMoney = value;
    moneyValue.textContent = `$${value}`;
    buyMoney.textContent = `$${value}`;
  }

  function setTimer(seconds, phase) {
    const total = Math.max(0, Math.ceil(seconds));
    const key = `${total}|${phase}`;
    if (key === lastTimer) return;
    lastTimer = key;
    const m = Math.floor(total / 60);
    const s = total % 60;
    timerValue.textContent = `${m}:${String(s).padStart(2, '0')}`;
    timerValue.classList.toggle('urgent', total <= 10 && phase === 'live');
    $('phase-label').textContent = phase === 'freeze' ? 'BUY' : phase === 'live' ? 'ROUND' : '';
  }

  function setScore(ember, slate) {
    const key = `${ember}-${slate}`;
    if (key === lastScore) return;
    lastScore = key;
    scoreEmber.textContent = String(ember);
    scoreSlate.textContent = String(slate);
  }

  function setAlive(ember, slate) {
    aliveEmber.textContent = String(ember);
    aliveSlate.textContent = String(slate);
  }

  function setBomb(state, fuse, plantProgress, defuseProgress) {
    const key = `${state}|${Math.ceil(fuse)}|${Math.round(plantProgress * 20)}|${Math.round(defuseProgress * 20)}`;
    if (key === lastBomb) return;
    lastBomb = key;
    if (state === 'planted') {
      bombStatus.hidden = false;
      bombText.textContent = `CHARGE LIVE — ${Math.ceil(fuse)}s`;
      bombFill.style.width = `${Math.max(0, (fuse / 35) * 100)}%`;
      bombFill.style.background = 'var(--danger)';
    } else if (plantProgress > 0) {
      bombStatus.hidden = false;
      bombText.textContent = `PLANTING — ${Math.round(plantProgress * 100)}%`;
      bombFill.style.width = `${plantProgress * 100}%`;
      bombFill.style.background = 'var(--accent)';
    } else if (defuseProgress > 0) {
      bombStatus.hidden = false;
      bombText.textContent = `DEFUSING — ${Math.round(defuseProgress * 100)}%`;
      bombFill.style.width = `${defuseProgress * 100}%`;
      bombFill.style.background = 'var(--slate)';
    } else {
      bombStatus.hidden = true;
    }
  }

  function setCrosshairGap(px) {
    crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
  }

  function setScoped(scoped) {
    document.body.classList.toggle('scoped', scoped);
  }

  function hitMarker(killed, holdMs = 90) {
    hitmarker.classList.add('on');
    hitmarker.classList.toggle('kill', killed);
    clearTimeout(hitTimer);
    hitTimer = setTimeout(() => hitmarker.classList.remove('on', 'kill'), holdMs);
  }

  function damageFlash() {
    vignette.classList.add('on');
    setTimeout(() => vignette.classList.remove('on'), 180);
  }

  function feed(text, kind = '') {
    const line = document.createElement('div');
    line.className = `feed-line ${kind}`;
    line.textContent = text;
    killfeed.prepend(line);
    while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
    setTimeout(() => line.remove(), 6000);
  }

  function showBanner(titleText, subText, ms = 2600) {
    bannerTitle.textContent = titleText;
    bannerSub.textContent = subText;
    banner.hidden = false;
    clearTimeout(bannerTimer);
    bannerTimer = setTimeout(() => { banner.hidden = true; }, ms);
  }

  function setHint(text) {
    if (hint.textContent !== text) hint.textContent = text;
  }

  function buildBuyMenu(onBuy) {
    buyList.innerHTML = '';
    const items = [
      ...Object.values(WEAPONS).map((w) => ({ id: w.id, name: w.name, detail: `${w.damage} dmg · ${w.mag} rounds`, price: w.price, key: String(w.slot) })),
      { id: 'frag', name: GRENADES.frag.name, detail: 'Blast · 6.5 m radius', price: GRENADES.frag.price, key: 'G' },
      { id: 'smoke', name: GRENADES.smoke.name, detail: 'Blocks sight · 18 s', price: GRENADES.smoke.price, key: 'G' },
      { id: 'armor', name: 'Kevlar Vest', detail: 'Halves damage · 50 armour', price: ARMOR_PRICE, key: '' },
    ];
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'buy-item';
      button.dataset.id = item.id;
      button.innerHTML = `<span class="buy-key">${item.key}</span><span class="buy-name">${item.name}</span><span class="buy-detail">${item.detail}</span><span class="buy-price">$${item.price}</span>`;
      button.addEventListener('click', () => onBuy(item.id));
      buyList.appendChild(button);
    }
  }

  function showBuyMenu() {
    buyMenu.hidden = false;
  }

  function hideBuyMenu() {
    buyMenu.hidden = true;
  }

  function markBought(id, owned) {
    const button = buyList.querySelector(`[data-id="${id}"]`);
    if (button) button.classList.toggle('owned', owned);
  }

  function drawMinimap(entities, bomb, player) {
    const ctx = minimap.getContext('2d');
    if (!ctx) return;
    const W = minimap.width;
    const H = minimap.height;
    const px = (x) => ((x + 20) / 40) * W;
    const pz = (z) => ((z + 16) / 32) * H;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = 'rgba(16,20,26,0.85)';
    ctx.fillRect(0, 0, W, H);
    ctx.strokeStyle = 'rgba(139,152,165,0.5)';
    ctx.strokeRect(1, 1, W - 2, H - 2);
    // Sites.
    for (const [key, site] of Object.entries({ A: { x: -15.5, z: -9.5 }, B: { x: 15.5, z: -9.5 } })) {
      ctx.beginPath();
      ctx.arc(px(site.x), pz(site.z), 7, 0, Math.PI * 2);
      ctx.strokeStyle = '#f0a830';
      ctx.stroke();
      ctx.fillStyle = '#f0a830';
      ctx.font = 'bold 9px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(key, px(site.x), pz(site.z) + 3);
    }
    // Bomb.
    if (bomb.state === 'planted') {
      ctx.beginPath();
      ctx.arc(px(bomb.x), pz(bomb.z), 4, 0, Math.PI * 2);
      ctx.fillStyle = '#e0533d';
      ctx.fill();
    }
    // Teammates and the player.
    for (const entity of entities) {
      if (!entity.alive) continue;
      const x = px(entity.mover.state.position.x);
      const y = pz(entity.mover.state.position.z);
      if (entity.isPlayer) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(-entity.mover.state.yaw);
        ctx.fillStyle = '#f0a830';
        ctx.beginPath();
        ctx.moveTo(0, -6);
        ctx.lineTo(4, 5);
        ctx.lineTo(-4, 5);
        ctx.closePath();
        ctx.fill();
        ctx.restore();
      } else if (entity.team === player.team) {
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#f0a830';
        ctx.fill();
      }
    }
  }

  return {
    setAmmo,
    setHealth,
    setMoney,
    setTimer,
    setScore,
    setAlive,
    setBomb,
    setCrosshairGap,
    setScoped,
    hitMarker,
    damageFlash,
    feed,
    showBanner,
    setHint,
    buildBuyMenu,
    showBuyMenu,
    hideBuyMenu,
    markBought,
    drawMinimap,
    showOverlay(mode, data = {}) {
      const text = COPY[mode] ?? COPY.start;
      if (mode === 'roundEnd') {
        title.textContent = data.winner === 'ember' ? 'Ember takes the round' : 'Slate takes the round';
        copy.textContent = `${data.reason}. Ember ${data.score.ember} — ${data.score.slate} Slate.`;
        play.textContent = 'Next round';
      } else if (mode === 'matchEnd') {
        title.textContent = data.winner === 'ember' ? 'Ember wins the match' : 'Slate wins the match';
        copy.textContent = `Final score Ember ${data.score.ember} — ${data.score.slate} Slate.`;
        play.textContent = 'Play again';
      } else {
        title.textContent = text.title;
        copy.textContent = text.copy;
        play.textContent = text.action;
      }
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
    onBuyClose(handler) {
      buyClose.addEventListener('click', handler);
    },
  };
}
