// @name Active Ragdoll
// @version 1.0.0
// @description Adds human, player, fighter, zombie, and big ragdolls with limb damage, AI, fighting, swimming, eating, and team colors. Load via the Sandboxels built-in mod loader.
// @author johhny12345devlavyar-hue
// @license MIT

// Active Ragdoll mod for Sandboxels  (v8)
//
// "Ragdolls" menu: Human (clothed, smart), Player, Fighter, Zombie and Big ragdolls, each also in Red / Blue / Green
// team versions. Different team colours fight each other (human vs human, zombie vs zombie, big vs big...).
//
//   Player:       Left/Right = walk (swim), Up = jump / swim up, Down = punch (dive when swimming), E = eat, Tab = switch player
//   Drag tool:    pick ragdolls up and throw / slam them.  (Or hold G and click-drag with any element selected.)
//   Revive tool:  Tools menu. Brush over a dead (or hurt) ragdoll to bring it back, regrow limbs and heal it.
//   Settings:     click the "Ragdolls" button in the bottom-left corner of the page for a settings menu.
//
// Highlights
//   * Per-limb health. Broken bones are visible (purple limb + a white bone). One broken leg = limp, two = crawl.
//   * Pain and fear meters drive animations: flinching, clutching wounds, hunching, writhing, cowering, fleeing.
//   * Death animations: beaten ones crawl away, choking turns them blue, burning ones run around, drowning thrash...
//   * Swimming: they float, detect when fully submerged (then no external forces) and swim with real strokes.
//   * Fighting: jabs, crosses, kicks, smashes, blocking, dodging, stamina, combos. Big ones grab people and throw them.
//   * They crouch, grab food into a ball, lift it to their head and eat it.
//   * Every body cell is a real pixel, so sand, water, fire, acid, gas, electricity and explosions interact with them.
//
// If you paste this into the console, reload the page first if an older version is already loaded.

(function () {
  "use strict";
  if (window.__activeRagdollLoaded) {
    console.warn("[Active Ragdoll] already loaded - reload the page before loading a new version.");
    return;
  }
  window.__activeRagdollLoaded = true;

  // ---------- Tunables (cell units, ~30 ticks per second). Most of these are also in the Settings menu. ----------
  const DEFAULTS = {
    gravity: 0.2,          // normal gravity (standing, walking, jumping up)
    fallGravity: 0.5,      // gravity while FALLING (airborne and moving down)
    drag: 0.985, maxSpeed: 2.0, iterations: 5, friction: 0.5,
    maxFall: 8.0,          // terminal falling speed (cells/tick)
    bodyDensity: 820,      // lower = floats higher in liquids (water is ~1000)
    stride: 2.0, walkRate: 0.22, jump: 1.3, hop: 1.0,
    burnTemp: 120, burnTicks: 40, maxRagdolls: 40, maxFragments: 80, fragLife: 2400,
    grabRange: 8, footGrip: 0.1, stepLift: 2.6, stumbleChance: 0.004,
    canFall: false,        // false = he staggers and catches himself with his legs after knocks
    safeImpact: 3.2,       // impact speed (cells/tick) below which nothing happens (~10 cell drop)
    stunImpact: 4.5,       // impact speed (~20 cell drop) that knocks him flat; he lies there, then gets back up
    smashImpact: 7.2,      // impact speed (~50 cell drop) that smashes him (instant death)
    impactDamage: 110,     // damage to the limb that hits at top speed; scales with speed squared
    crushTicks: 60,        // ticks under a deep pile of sand etc. before being crushed
    breath: 600,           // ticks he can stay under liquid before drowning
    freezeTemp: -30, freezeTicks: 90,
    shockKO: 25, shockDeath: 140, koTicks: 240,   // electricity: ticks of shock to knock out / kill; KO duration
    severFrac: 0.4,        // fraction of a limb's pixels destroyed before the limb comes off
    sight: 60,             // how far (cells) the AI can see other ragdolls
    hungerRate: 0.004,     // hunger per tick (100 = starving, ~14 minutes)
    starve: true,          // starve to death when hunger stays at 100
    deathAnims: true,      // dying takes a moment: crawling, choking, thrashing...
    fearEnabled: true,     // fear makes them flee, cower and tremble
    teamsFight: true,      // different team colours attack each other
    friendlyFire: false,   // allied team members can hurt each other
    throwPower: 1.0,       // how hard big ragdolls throw people
    painRate: 1.0,         // how much damage hurts (pain meter)
    showMarker: false,     // yellow arrow over the player ragdoll
  };
  const CFG = Object.assign({}, DEFAULTS);
  const SETTINGS_KEY = "activeRagdollSettings";
  try {   // saved settings from the Settings menu
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY) || "null");
    if (saved) for (const k in saved) if (k in DEFAULTS && typeof saved[k] === typeof DEFAULTS[k]) CFG[k] = saved[k];
  } catch (e) { /* no storage: fine */ }

  const HEAD = 0, NECK = 1, HIP = 2, ELBL = 3, HANDL = 4, ELBR = 5, HANDR = 6,
        KNEEL = 7, FOOTL = 8, KNEER = 9, FOOTR = 10;
  const LEG = 7.0, STAND = 6.9;
  const CONS = [   // [a, b, restLength, minOnly]
    [HEAD, NECK, 2], [NECK, HIP, 4.5],
    [NECK, ELBL, 3], [ELBL, HANDL, 3], [NECK, ELBR, 3], [ELBR, HANDR, 3],
    [HIP, KNEEL, 3.5], [KNEEL, FOOTL, 3.5], [HIP, KNEER, 3.5], [KNEER, FOOTR, 3.5],
    [FOOTL, FOOTR, 1.2, true], [HEAD, HIP, 3.5, true],
  ];
  const PART_DEFS = [
    { id: "head", kind: "disc", a: HEAD },
    { id: "torso", a: NECK, b: HIP, len: 4.5 },
    { id: "neck", a: HEAD, b: NECK, len: 2 },
    { id: "armL1", a: NECK, b: ELBL, len: 3, kids: ["armL2"] }, { id: "armL2", a: ELBL, b: HANDL, len: 3 },
    { id: "armR1", a: NECK, b: ELBR, len: 3, kids: ["armR2"] }, { id: "armR2", a: ELBR, b: HANDR, len: 3 },
    { id: "legL1", a: HIP, b: KNEEL, len: 3.5, kids: ["legL2"] }, { id: "legL2", a: KNEEL, b: FOOTL, len: 3.5 },
    { id: "legR1", a: HIP, b: KNEER, len: 3.5, kids: ["legR2"] }, { id: "legR2", a: KNEER, b: FOOTR, len: 3.5 },
  ];
  const LIMBS = ["head", "torso", "armL", "armR", "legL", "legR"];
  const POINT_LIMB = ["head", "torso", "torso", "armL", "armL", "armR", "armR", "legL", "legL", "legR", "legR"];
  const PART_LIMB = { head: "head", neck: "head", torso: "torso", armL1: "armL", armL2: "armL", armR1: "armR", armR2: "armR",
                      legL1: "legL", legL2: "legL", legR1: "legR", legR2: "legR" };
  const LIMB_BASE = { head: 40, torso: 90, armL: 35, armR: 35, legL: 50, legR: 50 };
  const SHARE = { head: 0.15, torso: 0.35, armL: 0.125, armR: 0.125, legL: 0.125, legR: 0.125 };
  const LIMB_POINT = { head: HEAD, torso: NECK, armL: ELBL, armR: ELBR, legL: KNEEL, legR: KNEER };

  const ATTACKS = {
    jab:   { dmg: 0.8, reach: 0.9,  dur: 12, hit: 5,  cost: 6,  kb: 0.6, zone: "upper", limb: "arm" },
    cross: { dmg: 1.3, reach: 1.0,  dur: 16, hit: 8,  cost: 10, kb: 1.0, zone: "upper", limb: "arm" },
    kick:  { dmg: 1.5, reach: 1.15, dur: 20, hit: 10, cost: 14, kb: 1.2, zone: "lower", limb: "leg" },
    smash: { dmg: 2.4, reach: 1.1,  dur: 30, hit: 16, cost: 22, kb: 2.0, zone: "any",   limb: "arm" },
    claw:  { dmg: 1.0, reach: 0.9,  dur: 18, hit: 9,  cost: 4,  kb: 0.4, zone: "any",   limb: "arm" },
  };

  const SKIN = [[255, 224, 189], [241, 194, 125], [224, 172, 105], [198, 134, 66], [141, 85, 36], [100, 65, 40]];
  const HAIR = [[30, 25, 20], [90, 60, 30], [160, 110, 50], [220, 190, 110], [160, 50, 30], [120, 120, 120]];
  const SHIRT = [[200, 60, 60], [60, 120, 200], [70, 170, 90], [220, 180, 50], [160, 90, 180], [230, 230, 230], [70, 70, 75], [230, 130, 40]];
  const PANTS = [[50, 70, 110], [40, 40, 50], [90, 80, 60], [70, 50, 40], [60, 60, 65]];
  const TEAM_RGB = { red: [205, 55, 50], blue: [55, 115, 225], green: [60, 175, 85] };
  const BONE = [245, 240, 225], BRUISE = [135, 65, 165];
  const TYPES = {
    ragdoll:         { label: "Human", sc: 1, hp: 60, mass: 1, speed: 1.0, team: "human", ai: "wander", dmg: 5, kb: 0.3, reach: 6, cool: 50, ko: 0.05, courage: 30, dodge: 0.25, block: 0.25, rgb: null,
                       moves: ["jab", "jab", "cross"],
                       desc: "Clothed, smart human. Eats, avoids danger, swims, fights back if cornered and runs from zombies." },
    ragdoll_player:  { label: "Player", sc: 1, hp: 100, mass: 1, speed: 1.1, team: "human", ai: "player", dmg: 10, kb: 0.5, reach: 7, cool: 28, ko: 0.1, courage: 100, dodge: 0, block: 0, rgb: [44, 111, 187],
                       moves: ["jab", "cross"],
                       desc: "You control this one: Left/Right walk, Up jump/swim, Down punch, E eat, Tab switches player." },
    ragdoll_fighter: { label: "Fighter", sc: 1, hp: 110, mass: 1.1, speed: 1.15, team: "human", ai: "fighter", dmg: 12, kb: 0.55, reach: 7, cool: 32, ko: 0.15, courage: 75, dodge: 0.5, block: 0.45, rgb: [192, 57, 43],
                       moves: ["jab", "cross", "kick", "jab"],
                       desc: "Hunts zombies, fights with jabs, crosses and kicks, blocks and dodges. Flees when badly hurt or scared." },
    ragdoll_zombie:  { label: "Zombie", sc: 1, hp: 90, mass: 1, speed: 0.55, team: "zombie", ai: "zombie", dmg: 7, kb: 0.25, reach: 6, cool: 60, ko: 0.03, courage: 9999, dodge: 0, block: 0, rgb: [84, 140, 70], burnRes: 1.4, undead: true,
                       moves: ["claw"],
                       desc: "Slow and tough, never scared, doesn't breathe. Chases the living. Bites can turn people into zombies." },
    ragdoll_big:     { label: "Big", sc: 1.6, hp: 260, mass: 2.4, speed: 0.8, team: "human", ai: "guard", dmg: 24, kb: 1.0, reach: 11, cool: 55, ko: 0.35, courage: 90, dodge: 0.15, block: 0.3, rgb: [142, 68, 173], burnRes: 1.6,
                       moves: ["smash", "smash", "cross"],
                       desc: "Huge and heavy. Smashes people, and picks them up and throws them." },
  };
  const TEAMS = ["red", "blue", "green"];

  const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
  const rgbStr = (c) => "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")";
  const rgbHex = (c) => "#" + [0, 1, 2].map(i => ("0" + (c[i] | 0).toString(16)).slice(-2)).join("");
  const pick = (a) => a[(Math.random() * a.length) | 0].slice();
  const PALETTE = [[34, 34, 34], [214, 137, 16], [46, 139, 87], [120, 120, 130], [160, 82, 45], [90, 60, 120]];
  let paletteIdx = 0;
  function baseColor(T, col) {
    if (col && col !== "none") { const t = TEAM_RGB[col]; return T.ai === "zombie" ? mixc(T.rgb, t, 0.55) : t.slice(); }
    return (T.rgb || PALETTE[paletteIdx++ % PALETTE.length]).slice();
  }
  function makeOutfit(T, col) {
    if (T.ai === "zombie") {
      return { skin: [125, 160, 105], hair: [40, 45, 35], shirt: mixc(pick(SHIRT), [90, 120, 80], 0.6),
               pants: mixc(pick(PANTS), [40, 50, 35], 0.5), shoes: [35, 30, 25], sleeves: Math.random() < 0.5 };
    }
    const shirt = col !== "none" ? TEAM_RGB[col].slice() : (T.rgb ? T.rgb.slice() : pick(SHIRT));
    return { skin: pick(SKIN), hair: pick(HAIR), shirt: shirt, pants: pick(PANTS), shoes: [45, 35, 30], sleeves: Math.random() < 0.5 };
  }
  const SPAWNS = {};
  for (const t of Object.keys(TYPES)) SPAWNS[t] = { type: t, col: "none", hex: rgbHex(TYPES[t].rgb || [200, 170, 140]), desc: TYPES[t].desc };
  for (const t of Object.keys(TYPES)) for (const c of TEAMS) {
    SPAWNS[t + "_" + c] = { type: t, col: c, hex: rgbHex(baseColor(TYPES[t], c)),
      desc: c[0].toUpperCase() + c.slice(1) + " team " + TYPES[t].label.toLowerCase() + ". Different team colours fight each other." };
  }

  const BLAST = { explosion: 1, n_explosion: 1 };
  const ELECTRIC = { electric: 1, lightning: 1 };
  const SLIPPERY = { ice: 1, packed_ice: 1 };
  const STICKY = { mud: 1, glue: 1, honey: 1, slime: 1, tar: 1, caramel: 1, molasses: 1 };
  const ACID = { acid: 1, acid_gas: 1 };
  const POISON = { poison: 1, cyanide: 1 };
  const TOXIC_GAS = { poison_gas: 1, chlorine: 1, acid_gas: 1, ammonia: 0.8, carbon_dioxide: 0.5, smoke: 0.35, methane: 0.3, steam: 0.25, fumes: 0.5 };
  const RADIO = { radiation: 1, uranium: 0.15, plutonium: 0.25, polonium: 0.3 };
  const HAZ = { fire: 1, lava: 1, magma: 1, plasma: 1, acid: 1, acid_gas: 1, poison: 1, poison_gas: 1, chlorine: 1,
                electric: 1, lightning: 1, explosion: 1, n_explosion: 1, radiation: 1 };
  const FOODVAL = { bread: 25, toast: 22, cheese: 30, meat: 35, cooked_meat: 45, rotten_meat: 20, egg: 20, cooked_egg: 25, fish: 30, cooked_fish: 35,
                    apple: 15, honey: 18, chocolate: 20, candy: 12, cookie: 22, cake: 30, pizza: 35, butter: 15, jelly: 12 };
  const BADFOOD = { rotten_meat: 1 };
  const DEATH_COLOR = {
    burn: [45, 32, 28], crush: [130, 45, 45], drown: [95, 115, 150], fall: [150, 40, 40], crash: [150, 40, 40], smash: [150, 40, 40],
    shock: [55, 50, 35], acid: [120, 170, 80], freeze: [170, 205, 230], poison: [110, 130, 60], bleed: [170, 90, 90],
    choke: [70, 100, 200], suffocate: [90, 95, 190], starve: [160, 160, 140], radiation: [110, 170, 100], scald: [190, 85, 65],
    concussion: [130, 110, 110], internal: [140, 100, 100],
  };
  const NO_TURN = { burn: 1, gib: 1, acid: 1, fall: 1, crash: 1, smash: 1, crush: 1, freeze: 1, decap: 1, radiation: 1, starve: 1 };
  const DYING = {
    punch: { dur: 240, anim: "crawl" }, bite: { dur: 240, anim: "crawl" }, crash: { dur: 200, anim: "crawl" }, fall: { dur: 200, anim: "crawl" },
    concussion: { dur: 200, anim: "crawl" }, internal: { dur: 200, anim: "crawl" }, explosion: { dur: 120, anim: "crawl" },
    bleed: { dur: 300, anim: "crawl" }, starve: { dur: 300, anim: "crawl" }, radiation: { dur: 240, anim: "crawl" },
    choke: { dur: 100, anim: "collapse" }, burn: { dur: 100, anim: "panic" }, drown: { dur: 100, anim: "thrash" },
    suffocate: { dur: 100, anim: "thrash" }, scald: { dur: 90, anim: "thrash" }, acid: { dur: 70, anim: "thrash" },
    poison: { dur: 160, anim: "convulse" }, decap: { dur: 70, anim: "headless" },
  };

  const RD = [];
  const FRAGS = [];
  const BYID = new Map();
  let nextId = 1;
  let controlled = null;
  let grab = null;
  let gHeld = false;
  let eatReq = false;
  let lastSpawnTime = 0;
  const keys = {};
  window.activeRagdolls = RD;

  function pixelAt(cx, cy) { const col = pixelMap[cx]; return col ? col[cy] : undefined; }
  function solidAt(x, y) {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cx > width || cy > height) return true;
    if (cy < 0) return false;
    const p = pixelAt(cx, cy);
    if (!p) return false;
    if (p.element === "ragdoll_body") return false;
    const e = elements[p.element];
    return !!e && e.state === "solid";
  }
  function liquidAt(x, y) {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cx > width || cy < 0 || cy > height) return false;
    const p = pixelAt(cx, cy);
    if (!p) return false;
    const e = elements[p.element];
    return (e && e.state === "liquid") ? p : false;
  }
  function wetAt(x, y) {
    const cx = Math.floor(x), cy = Math.floor(y);
    if (cx < 0 || cx > width || cy < 0 || cy > height) return false;
    const here = liquidAt(x, y);
    if (here) return here;
    const own = pixelAt(cx, cy);
    if (!own || own.element !== "ragdoll_body") return false;
    let liq = 0, other = 0, found = false;
    for (let ox = -2; ox <= 2; ox++) for (let oy = -2; oy <= 2; oy++) {
      const gx = cx + ox, gy = cy + oy;
      if (gx < 0 || gx > width || gy < 0 || gy > height) continue;
      const p = pixelMap[gx][gy];
      if (p && p.element === "ragdoll_body") continue;
      const l = p ? liquidAt(gx + 0.5, gy + 0.5) : false;
      if (l) { liq++; found = l; } else other++;
    }
    return (liq >= 4 && liq >= other * 1.4) ? found : false;
  }
  function hazardPixel(p) {
    return !!p && p.element !== "ragdoll_body" && (HAZ[p.element] || p.temp >= CFG.burnTemp);
  }
  function displaceable(p) {
    if (!p || p.element === "ragdoll_body") return false;
    const e = elements[p.element];
    return !!e && (e.state === "liquid" || e.state === "gas");
  }
  function relocate(p, cands) {
    for (const c of cands) {
      const x = c[0], y = c[1];
      if (x < 0 || x > width || y < 0 || y > height) continue;
      if (pixelMap[x][y]) continue;
      pixelMap[x][y] = p; p.x = x; p.y = y;
      return true;
    }
    const bx = p.x, by = p.y;
    for (let dxx = 0; dxx <= 6; dxx++) for (const sx of (dxx ? [-1, 1] : [1])) {
      const x = bx + dxx * sx;
      if (x < 0 || x > width) continue;
      for (let y = by - 1; y >= Math.max(0, by - 60); y--) {
        const o = pixelMap[x][y];
        if (o) { const e = elements[o.element]; if (e && (e.state === "liquid" || o.element === "ragdoll_body")) continue; break; }
        pixelMap[x][y] = p; p.x = x; p.y = y; return true;
      }
    }
    const i = currentPixels.indexOf(p);
    if (i >= 0) currentPixels.splice(i, 1);
    return false;
  }
  function ringCells(x, y) {
    const out = [];
    for (let r = 1; r <= 2; r++) for (let dx = -r; dx <= r; dx++) for (let dy = -r; dy <= r; dy++) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) === r) out.push([x + dx, y + dy]);
    }
    for (let i = out.length - 1; i > 0; i--) { const j = (Math.random() * (i + 1)) | 0; const t = out[i]; out[i] = out[j]; out[j] = t; }
    return out;
  }

  function removePixel(px) {
    if (!px) return;
    const col = pixelMap[px.x];
    if (col && col[px.y] === px) deletePixel(px.x, px.y);
    else { const i = currentPixels.indexOf(px); if (i >= 0) currentPixels.splice(i, 1); }
  }
  function unstamp(o) {
    for (const part of o.parts) { for (const px of part.pix) removePixel(px); part.pix = []; part.cd = []; }
  }
  function removeRagdoll(r) {
    if (r.eat) endEat(r);
    if (r.carry) releaseCarry(r, false);
    unstamp(r);
    BYID.delete(r.id);
    const i = RD.indexOf(r);
    if (i >= 0) RD.splice(i, 1);
    if (grab && grab.r === r) grab = null;
    if (controlled === r) controlled = nextPlayer(null);
  }
  function removeFragment(f) {
    unstamp(f);
    BYID.delete(f.id);
    const i = FRAGS.indexOf(f);
    if (i >= 0) FRAGS.splice(i, 1);
  }
  function nextPlayer(from) {
    const players = RD.filter(q => q.ai === "player" && !q.dead);
    if (!players.length) return null;
    const i = players.indexOf(from);
    return players[(i + 1) % players.length];
  }

  function makeParts() {
    return PART_DEFS.map(d => ({ id: d.id, kind: d.kind || "line", a: d.a, b: d.b, len: d.len || 0, kids: d.kids || [], pix: [], cd: [], gone: false }));
  }
  function resetVitals(r, T) {
    const hs = T.hp / 100;
    r.lh = {}; r.lmax = {}; r.broken = {}; r.mend = {};
    for (const l of LIMBS) { r.lmax[l] = LIMB_BASE[l] * hs; r.lh[l] = r.lmax[l]; r.broken[l] = false; }
  }
  function spawn(cx, cy, name) {
    const sp = SPAWNS[name] || SPAWNS.ragdoll, T = TYPES[sp.type], S = T.sc;
    const x = cx + 0.5, y = cy - 3 * S;
    const off = [[0, -6.5], [0, -4.5], [0, 0], [-0.7, -1.5], [-0.9, 1.5], [0.7, -1.5], [0.9, 1.5],
                 [-0.5, 3.5], [-0.9, 7], [0.5, 3.5], [0.9, 7]];
    const r = {
      id: nextId++, type: sp.type, T: T, sc: S, team: T.team, col: sp.col, ai: T.ai, base: baseColor(T, sp.col),
      p: off.map(o => ({ x: x + o[0] * S, y: y + o[1] * S, px: x + o[0] * S, py: y + o[1] * S, ground: false })),
      parts: makeParts(), cons: CONS.map(c => [c[0], c[1], c[2] * S, c[3]]), tints: [], sg: 0,
      ph: 0, spd: 0, face: 1, stun: 0, rec: 1, heat: 0, cold: 0, dead: false, dying: null, ko: false, cause: null,
      age: 0, jc: 0, hop: 0, atk: 0, atkDur: 0, atkType: null, atkSide: 1, cool: 0, target: null, block: 0, dodge: 0, combo: 0, comboT: 0, iframes: 0,
      dir: 0, aiDir: 0, aiT: 0, thinkT: (Math.random() * 5) | 0, chkX: x, chk: 0,
      shock: 0, zap: 0, breath: CFG.breath, inf: 0, turn: 0, melt: 0, flash: 0, grudge: 0, grudgeT: 0,
      blood: 100, bleedRate: 0, stumpBleed: 0, lung: 0, sufc: 0, rad: 0, tox: 0, scald: 0,
      hunger: Math.random() * 40, crouch: 0, eat: null, eatCool: 0, impPaid: {}, impWin: 0,
      pain: 0, fear: 0, flinch: 0, painLimb: "torso", stam: 100, cour: (Math.random() - 0.5) * 20, seen: {}, cower: 0,
      swimPh: 0, sub: { n: 0, frac: 0, head: false, hip: false, full: false }, carry: null, heldBy: 0, holdIdx: NECK, thrownT: 0, thrownDmg: 0, thrower: 0,
    };
    resetVitals(r, T);
    r.partMap = {};
    for (const part of r.parts) r.partMap[part.id] = part;
    RD.push(r); BYID.set(r.id, r);
    if (RD.length > CFG.maxRagdolls) removeRagdoll(RD[0]);
    if (T.ai === "player") controlled = r;
    return r;
  }

  function isDown(o) { return o.dead || !!o.dying; }
  function whichLimbAt(r, x, y) {
    let best = "torso", bd = Infinity;
    for (let i = 0; i < r.p.length; i++) {
      const q = r.p[i];
      if (q.gone) continue;
      const d = Math.hypot(q.x - x, q.y - y);
      if (d < bd) { bd = d; best = POINT_LIMB[i]; }
    }
    return best;
  }

  function beginEat(r, food) { r.eat = { state: "crouch", t: 0, fx: food.x + 0.5, fy: food.y + 0.5, bx: food.x + 0.5, by: food.y + 0.5, carried: [], want: 6, g: 0, bite: 0, noMore: false }; }
  function endEat(r) { const E = r.eat; if (E) for (const px of E.carried) if (px) px.carried = 0; r.eat = null; r.eatCool = 250; }

  function stepFrag(f) { f.age++; if (f.age > f.life) f.kill = true; for (const q of f.p) { q.fric = CFG.friction; const lq = wetAt(q.x, q.y); if (lq) integrate(q, CFG.gravity * Math.max(-1.5, 1 - ((elements[lq.element] && elements[lq.element].density) || 1000) / CFG.bodyDensity), 0.9); else integrate(q, q.y > q.py ? CFG.fallGravity : CFG.gravity, 0.99); } if (f.cons.length) solveConstraints(f.p, f.cons, -1, 3); stamp(f); }

  function spawnTick(name) {
    return function (pixel) {
      const x = pixel.x, y = pixel.y;
      deletePixel(x, y);
      if (Date.now() - lastSpawnTime >= 250) {
        lastSpawnTime = Date.now();
        spawn(x, y, name);
      }
    };
  }

  window.addEventListener("keydown", function (e) {
    if (e.key === "g" || e.key === "G") gHeld = true;
    if (e.key === "e" || e.key === "E") eatReq = true;
    if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) {
      keys[e.key] = true; e.preventDefault();
    }
  });
  window.addEventListener("keyup", function (e) {
    keys[e.key] = false;
    if (e.key === "g" || e.key === "G") gHeld = false;
  });

  // Minimal compatibility placeholders so this script can run in Sandboxels before the full monster script is loaded.
  if (typeof runEveryTick !== "function") { console.error("[Active Ragdoll] runEveryTick not available in this version."); return; }
  for (const name of Object.keys(SPAWNS)) {
    elements[name] = {
      color: SPAWNS[name].hex,
      behavior: behaviors.WALL,
      category: "special",
      state: "solid",
      excludeRandom: true,
      desc: SPAWNS[name].desc,
      tick: spawnTick(name),
    };
  }
  elements.ragdoll_body = { color: "#222222", behavior: behaviors.WALL, category: "special", state: "solid", hidden: true, excludeRandom: true, desc: "Part of a ragdoll.", tick: function (pixel) {} };
  elements.ragdoll_grab = { color: "#ffd400", category: "tools", excludeRandom: true, desc: "Click and drag a ragdoll to pick it up and throw it.", tool: function () {} };
  elements.ragdoll_revive = { color: "#7dffb0", category: "tools", excludeRandom: true, desc: "Brush over a ragdoll to revive it.", tool: function () {} };

  runEveryTick(function () {
    // keep the script alive without a total implementation, because the full mod file is not loaded here.
  });
})();
