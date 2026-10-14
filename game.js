// 起動したNode.jsサーバーに接続する
const socket = io("https://reversipuyoserver.onrender.com/");

"use strict";

// ==========================================================
// 設定 (スマホ移植を想定した縦長レイアウト)
// ==========================================================
const COLS = 6;
const ROWS = 12;
const CELL = 48;

const BOARD_MARGIN_X = 16;
const TOP_MARGIN = 12;
const TITLE_HEIGHT = 40;
const TITLE_GAP = 8;
const SIDE_PANEL_WIDTH = 100;
const SIDE_PANEL_GAP = 12;
const BOTTOM_MARGIN = 16;

const BOARD_W = COLS * CELL;
const BOARD_H = ROWS * CELL;

const TITLE_Y = TOP_MARGIN;
const BOARD_Y = TITLE_Y + TITLE_HEIGHT + TITLE_GAP;
const BOARD_X = BOARD_MARGIN_X + SIDE_PANEL_WIDTH + SIDE_PANEL_GAP;

const SCREEN_W = BOARD_W + SIDE_PANEL_WIDTH * 2 + SIDE_PANEL_GAP * 2 + BOARD_MARGIN_X * 2;
const SCREEN_H = BOARD_Y + BOARD_H + BOTTOM_MARGIN;

const FALL_INTERVAL = 500;
const FAST_FALL_INTERVAL = 40;
const LOCK_DELAY = 150;

const MOVE_INITIAL_DELAY = 200;
const MOVE_REPEAT_INTERVAL = 60;

const DETACHED_FALL_SPEED_MULTIPLIER = 15;
const CLEAR_DISPLAY_DELAY = 300;
const FLIP_DISPLAY_DELAY = 180;

const REVERSI_PUYO_CHANCE = 0.15;

const COLORS = [
  [255, 80, 80],    // 赤
  [80, 200, 80],    // 緑
  [80, 140, 255],   // 青
  [255, 220, 60],   // 黄
  [200, 100, 255],  // 紫
];

const OJAMA = -1;                 // おじゃまぷよを表す印(色は0以上のインデックス)
const OJAMA_SCORE_INTERVAL = 1000;
const BATTLE_OJAMA_POINT_INTERVAL = 30;

const GRID_COLOR = "rgba(120,140,220,0.12)";
const TEXT_COLOR = "#fff";

// フォント
const FONT_DISPLAY = '"Orbitron","Arial Black","Impact",sans-serif';
const FONT_UI = '"Hiragino Sans","Noto Sans JP","Yu Gothic","Meiryo",sans-serif';
const HISCORE_KEY = "reversiPuyoHiScore";
const PLAYER_NAME_KEY = "reversiPuyoPlayerName";
const PLAYER_NAME_MAX_LENGTH = 7;

// 回転オフセット: 0=下, 1=右, 2=上, 3=左 (dx, dy)
const ROTATIONS = { 0: [0, 1], 1: [1, 0], 2: [0, -1], 3: [-1, 0] };

function computeChildPos(x, y, rot) {
  const [dx, dy] = ROTATIONS[rot];
  return [x + dx, y + dy];
}

const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;
const rgba = (c, a) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
const shade = (c, f) => c.map((v) => Math.max(0, Math.min(255, Math.round(v * f))));
const lift = (c, n) => c.map((v) => Math.min(255, v + n));
const key = (x, y) => `${x},${y}`;
const parseKey = (k) => k.split(",").map(Number);

function chainColor(n) {
  const list = [[255, 214, 79], [255, 152, 0], [255, 82, 82], [224, 64, 251]];
  return list[Math.max(0, Math.min(3, n - 2))];
}

// ==========================================================
// ぷよペア(操作中の2個組)
// ==========================================================
class PuyoPair {
  constructor(color1, rev1, color2, rev2) {
    this.x = Math.floor(COLS / 2) - 1;
    this.y = 0;
    this.rot = 0;
    this.color1 = color1;
    this.color2 = color2;
    this.rev1 = rev1;
    this.rev2 = rev2;
  }
  cells() {
    const [cx, cy] = computeChildPos(this.x, this.y, this.rot);
    return [
      { x: this.x, y: this.y, color: this.color1, isReversi: this.rev1 },
      { x: cx, y: cy, color: this.color2, isReversi: this.rev2 },
    ];
  }
}

// ==========================================================
// メインゲームクラス
// ==========================================================
class PuyoGame {
  constructor(ctx) {
    this.ctx = ctx;
    this.keys = { a: false, d: false, s: false };

    // 演出用
    this.time = 0;
    this.particles = [];
    this.popups = [];
    this.shakeTime = 0;
    this.shakeMag = 0;
    this.hiScore = this.loadHiScore();
    this.playerName = this.loadPlayerName();
    this.stars = Array.from({ length: 70 }, () => ({
      x: Math.random() * SCREEN_W,
      y: Math.random() * SCREEN_H,
      s: Math.random() < 0.2 ? 2 : 1,
      v: 0.004 + Math.random() * 0.012,
      p: Math.random() * Math.PI * 2,
    }));
    this.bgGrad = ctx.createLinearGradient(0, 0, 0, SCREEN_H);
    this.bgGrad.addColorStop(0, "rgb(10,10,32)");
    this.bgGrad.addColorStop(1, "rgb(34,14,54)");
    this.vignette = ctx.createRadialGradient(
      SCREEN_W / 2, SCREEN_H / 2, SCREEN_H * 0.3,
      SCREEN_W / 2, SCREEN_H / 2, SCREEN_H * 0.75
    );
    this.vignette.addColorStop(0, "rgba(0,0,0,0)");
    this.vignette.addColorStop(1, "rgba(0,0,0,0.45)");

    this.pointer = { x: -1, y: -1 };   // ボタンのホバー表示用

    this.state = "TITLE";
    this.isSinglePlayer = false;
    this.isBattle = false;
    this.battleRandomState = 0;
    this.reset();
    this.state = "TITLE";
  }

  loadHiScore() {
    try { return parseInt(localStorage.getItem(HISCORE_KEY) || "0", 10) || 0; }
    catch (e) { return 0; }
  }
  saveHiScore() {
    try { localStorage.setItem(HISCORE_KEY, String(this.hiScore)); } catch (e) { /* 無視 */ }
  }
  loadPlayerName() {
    try { return this.limitPlayerName(localStorage.getItem(PLAYER_NAME_KEY) || ""); }
    catch (e) { return ""; }
  }
  limitPlayerName(name) {
    return Array.from(name.trim()).slice(0, PLAYER_NAME_MAX_LENGTH).join("");
  }
  savePlayerName() {
    this.playerName = this.limitPlayerName(this.playerName);
    try { localStorage.setItem(PLAYER_NAME_KEY, this.playerName); } catch (e) { /* 無視 */ }
  }

  reset() {
    this.board = Array.from({ length: ROWS }, () => Array(COLS).fill(null));
    this.reversi = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    this.score = 0;
    this.displayScore = 0;
    this.maxChain = 0;
    this.newRecord = false;
    this.gameOver = false;
    this.nextOjamaScore = OJAMA_SCORE_INTERVAL;
    this.pendingBattleOjama = 0;
    this.battleOjamaColumnCursor = 0;

    this.particles = [];
    this.popups = [];
    this.shakeTime = 0;

    this.nextPair = this.randomPair();
    this.nextNextPair = this.randomPair();

    this.current = null;
    this.fallTimer = 0;
    this.lockTimer = 0;
    this.isGrounded = false;

    this.state = "PLAYING";
    this.chainCount = 0;

    this.fallingPuyos = [];
    this.afterFallingAction = null;

    this.matchedCells = new Set();
    this.flashTimer = 0;

    this.pendingNewReversiCells = new Set();
    this.reversiCheckPending = false;

    this.flippingCells = new Map(); // "x,y" -> 新しい色
    this.flipTimer = 0;

    this.moveDir = 0;
    this.moveTimer = 0;
    this.moveDasDone = false;

    this.spawnPair();
  }

  // ------------------------------------------------------
  randomPuyo() {
    const random = this.isBattle ? () => this.nextBattleRandom() : Math.random;
    const color = Math.floor(random() * COLORS.length);
    const isReversi = random() < REVERSI_PUYO_CHANCE;
    return [color, isReversi];
  }
  randomPair() {
    return [this.randomPuyo(), this.randomPuyo()];
  }
  nextBattleRandom() {
    let state = this.battleRandomState >>> 0;
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    this.battleRandomState = state >>> 0;
    return this.battleRandomState / 0x100000000;
  }
  getBattleSnapshot() {
    return {
      board: this.board,
      reversi: this.reversi,
      current: this.current
        ? this.current.cells().map(({ x, y, color, isReversi }) => ({ x, y, color, isReversi }))
        : [],
      fallingPuyos: this.fallingPuyos.map(({ x, y, color, isReversi }) => ({
        x, y, color, isReversi
      })),
      nextPair: this.nextPair,
      nextNextPair: this.nextNextPair
    };
  }

  spawnPair() {
    const [[c1, r1], [c2, r2]] = this.nextPair;
    this.current = new PuyoPair(c1, r1, c2, r2);
    this.nextPair = this.nextNextPair;
    this.nextNextPair = this.randomPair();
    this.isGrounded = false;
    this.lockTimer = 0;

    if (!this.isValidPosition(this.current.x, this.current.y, this.current.rot)) {
      this.state = "GAMEOVER";
      this.gameOver = true;
      this.onGameOver();
    }
  }

  onGameOver() {
    this.updateHiScore();
    Sound.play("gameover", this.newRecord);
    if (this.isBattle) reportBattleLoss();
  }

  updateHiScore() {
    if (this.score <= this.hiScore) return;
    this.hiScore = this.score;
    this.newRecord = true;
    this.saveHiScore();
  }

  // ------------------------------------------------------
  isValidPosition(x, y, rot) {
    const [cx, cy] = computeChildPos(x, y, rot);
    for (const [px, py] of [[x, y], [cx, cy]]) {
      if (px < 0 || px >= COLS || py >= ROWS) return false;
      if (py >= 0 && this.board[py][px] !== null) return false;
    }
    return true;
  }

  tryMove(dx, dy) {
    if (!this.current) return false;
    const nx = this.current.x + dx;
    const ny = this.current.y + dy;
    if (this.isValidPosition(nx, ny, this.current.rot)) {
      this.current.x = nx;
      this.current.y = ny;
      return true;
    }
    return false;
  }

  tryRotate(direction) {
    if (!this.current) return;
    const newRot = (this.current.rot + direction + 4) % 4;
    if (this.isValidPosition(this.current.x, this.current.y, newRot)) {
      this.current.rot = newRot;
      Sound.play("rotate");
      return;
    }
    // 壁蹴り(簡易)
    for (const kick of [-1, 1, -2, 2]) {
      if (this.isValidPosition(this.current.x + kick, this.current.y, newRot)) {
        this.current.x += kick;
        this.current.rot = newRot;
        Sound.play("rotate");
        return;
      }
    }
  }

  // ------------------------------------------------------
  lockCurrent() {
    Sound.play("lock");
    const newReversiCells = new Set();
    for (const { x, y, color, isReversi } of this.current.cells()) {
      if (y >= 0 && y < ROWS && x >= 0 && x < COLS) {
        this.board[y][x] = color;
        this.reversi[y][x] = isReversi;
        if (isReversi) newReversiCells.add(key(x, y));
      }
    }
    this.current = null;
    this.chainCount = 0;

    // 今回新たに置いたリバーシぷよだけをリバーシ判定の対象にする
    this.pendingNewReversiCells = newReversiCells;
    this.reversiCheckPending = true;

    this.startGravityAnimation("CLEAR_CHECK");
  }

  // ------------------------------------------------------
  computeGravityMoves() {
    const moves = [];
    for (let x = 0; x < COLS; x++) {
      if (this.isBattle) {
        this.computeSegmentMoves(x, 0, ROWS - 1, moves);
        continue;
      }
      let segBottom = ROWS - 1;
      for (let y = ROWS - 1; y >= 0; y--) {
        if (this.board[y][x] === OJAMA) {
          this.computeSegmentMoves(x, y + 1, segBottom, moves);
          segBottom = y - 1;
        }
      }
      this.computeSegmentMoves(x, 0, segBottom, moves);
    }
    return moves;
  }

  computeSegmentMoves(x, top, bottom, moves) {
    if (top > bottom) return;
    const entries = [];
    for (let y = top; y <= bottom; y++) {
      if (this.board[y][x] !== null) {
        entries.push({ y, color: this.board[y][x], isReversi: this.reversi[y][x] });
      }
    }
    const count = entries.length;
    const startY = bottom - count + 1;
    entries.forEach((e, i) => {
      const newY = startY + i;
      if (e.y !== newY) {
        moves.push({ x, from: e.y, to: newY, color: e.color, isReversi: e.isReversi });
      }
    });
  }

  startGravityAnimation(nextAction) {
    const moves = this.computeGravityMoves();
    this.afterFallingAction = nextAction;

    // 今回着地したリバーシぷよが落下で移動する場合は追跡位置も更新する
    if (this.reversiCheckPending && this.pendingNewReversiCells.size > 0) {
      const shifted = new Set();
      const movedFrom = new Set();
      for (const m of moves) {
        const k = key(m.x, m.from);
        if (this.pendingNewReversiCells.has(k)) {
          movedFrom.add(k);
          shifted.add(key(m.x, m.to));
        }
      }
      if (shifted.size > 0) {
        for (const k of movedFrom) this.pendingNewReversiCells.delete(k);
        for (const k of shifted) this.pendingNewReversiCells.add(k);
      }
    }

    if (moves.length === 0) {
      this.finishFalling();
      return;
    }

    const interval = FALL_INTERVAL / DETACHED_FALL_SPEED_MULTIPLIER;
    this.fallingPuyos = [];
    for (const m of moves) {
      this.board[m.from][m.x] = null;
      this.reversi[m.from][m.x] = false;
      // timerをinterval分進めた状態で開始 → 次のupdateで即座に1マス落ちる
      this.fallingPuyos.push({
        x: m.x, y: m.from, toY: m.to, color: m.color,
        isReversi: m.isReversi, timer: interval,
      });
    }
    this.state = "FALLING";
  }

  updateFalling(dt) {
    const interval = FALL_INTERVAL / DETACHED_FALL_SPEED_MULTIPLIER;
    const still = [];
    for (const p of this.fallingPuyos) {
      p.timer += dt;
      while (p.timer >= interval && p.y < p.toY) {
        p.timer -= interval;
        p.y += 1;
      }
      if (p.y >= p.toY) {
        this.board[p.toY][p.x] = p.color;
        this.reversi[p.toY][p.x] = p.isReversi;
      } else {
        still.push(p);
      }
    }
    this.fallingPuyos = still;
    if (this.fallingPuyos.length === 0) this.finishFalling();
  }

  finishFalling() {
    if (this.afterFallingAction === "CLEAR_CHECK") {
      if (this.reversiCheckPending) {
        const flipMap = this.computeReversiFlips(this.pendingNewReversiCells);
        this.reversiCheckPending = false;
        this.pendingNewReversiCells = new Set();
        if (flipMap.size > 0) {
          this.flippingCells = flipMap;
          this.flipTimer = 0;
          this.state = "REVERSI_FLIP";
          return;
        }
      }
      this.checkForMatches();
    } else if (this.afterFallingAction === "FLIP_CHECK") {
      this.checkForMatches(false);
    } else if (this.afterFallingAction === "SPAWN_PAIR") {
      if (this.isBattle && this.pendingBattleOjama > 0) {
        this.startBattleOjamaDrop();
        return;
      }
      this.state = "PLAYING";
      this.spawnPair();
    } else {
      this.state = "PLAYING";
    }
  }

  // ------------------------------------------------------
  computeReversiFlips(newAnchorCells) {
    const flipMap = new Map();

    // 横方向(各行)
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (this.board[y][x] !== null && this.reversi[y][x]) {
          const color = this.board[y][x];
          let x2 = x + 1;
          while (x2 < COLS && this.board[y][x2] !== null) {
            if (this.board[y][x2] === OJAMA && !this.isBattle) break;
            if (this.board[y][x2] !== OJAMA &&
                this.reversi[y][x2] && this.board[y][x2] === color) {
              if (newAnchorCells.has(key(x, y)) || newAnchorCells.has(key(x2, y))) {
                for (let xi = x + 1; xi < x2; xi++) {
                  flipMap.set(key(xi, y), this.board[y][xi] === OJAMA ? OJAMA : color);
                }
              }
              break;
            }
            x2++;
          }
        }
      }
    }

    // 縦方向(各列)
    for (let x = 0; x < COLS; x++) {
      for (let y = 0; y < ROWS; y++) {
        if (this.board[y][x] !== null && this.reversi[y][x]) {
          const color = this.board[y][x];
          let y2 = y + 1;
          while (y2 < ROWS && this.board[y2][x] !== null) {
            if (this.board[y2][x] === OJAMA && !this.isBattle) break;
            if (this.board[y2][x] !== OJAMA &&
                this.reversi[y2][x] && this.board[y2][x] === color) {
              if (newAnchorCells.has(key(x, y)) || newAnchorCells.has(key(x, y2))) {
                for (let yi = y + 1; yi < y2; yi++) {
                  flipMap.set(key(x, yi), this.board[yi][x] === OJAMA ? OJAMA : color);
                }
              }
              break;
            }
            y2++;
          }
        }
      }
    }
    return flipMap;
  }

  finalizeReversiFlip() {
    Sound.play("flip");
    if (this.isBattle) this.chainCount = this.flippingCells.size;
    for (const [k, color] of this.flippingCells) {
      const [fx, fy] = parseKey(k);
      if (color === OJAMA) {
        this.board[fy][fx] = null;
        this.spawnBurst(BOARD_X + fx * CELL + CELL / 2, BOARD_Y + fy * CELL + CELL / 2,
          [190, 200, 220], 8, 160);
      } else {
        this.board[fy][fx] = color;
        this.spawnBurst(BOARD_X + fx * CELL + CELL / 2, BOARD_Y + fy * CELL + CELL / 2,
          COLORS[color], 6, 140);
      }
      this.reversi[fy][fx] = false;
    }
    this.flippingCells = new Map();
    if (this.isBattle) this.startGravityAnimation("FLIP_CHECK");
    else this.checkForMatches();
  }

  // ------------------------------------------------------
  findConnectedGroups() {
    const visited = Array.from({ length: ROWS }, () => Array(COLS).fill(false));
    const groups = [];
    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        if (this.board[y][x] === null || this.board[y][x] === OJAMA || visited[y][x]) continue;
        const color = this.board[y][x];
        const stack = [[x, y]];
        const group = [];
        visited[y][x] = true;
        while (stack.length) {
          const [cx, cy] = stack.pop();
          group.push([cx, cy]);
          for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
            const nx = cx + dx, ny = cy + dy;
            if (nx >= 0 && nx < COLS && ny >= 0 && ny < ROWS && !visited[ny][nx]) {
              if (this.board[ny][nx] === color) {
                visited[ny][nx] = true;
                stack.push([nx, ny]);
              }
            }
          }
        }
        if (group.length >= 4) groups.push(group);
      }
    }
    return groups;
  }

  checkForMatches(countAsChain = true) {
    const groups = this.findConnectedGroups();
    if (groups.length > 0) {
      if (countAsChain) this.chainCount += 1;
      this.maxChain = Math.max(this.maxChain, this.chainCount);
      Sound.play("clear", this.chainCount);
      this.matchedCells = new Set();
      for (const g of groups) for (const [x, y] of g) this.matchedCells.add(key(x, y));
      this.flashTimer = 0;
      this.state = "CLEARING";
    } else {
      if (this.isBattle && this.pendingBattleOjama > 0) {
        this.startBattleOjamaDrop();
        return;
      }
      this.state = "PLAYING";
      this.spawnPair();
    }
  }

  finalizeClear() {
    const cleared = this.matchedCells.size;
    let sx = 0, sy = 0;
    for (const k of this.matchedCells) {
      const [x, y] = parseKey(k);
      const c = this.board[y][x];
      if (c !== null && c !== OJAMA) {
        this.spawnBurst(BOARD_X + x * CELL + CELL / 2, BOARD_Y + y * CELL + CELL / 2,
          COLORS[c], 10, 200);
      }
      sx += x;
      sy += y;
      this.board[y][x] = null;
      this.reversi[y][x] = false;
    }
    const chainBonus = Math.max(1, this.chainCount);
    const sizeBonus = Math.min(2.0, 1.0 + Math.max(0, cleared - 4) * 0.1);
    const gained = Math.floor(cleared * 10 * chainBonus * sizeBonus);
    this.score += gained;
    this.updateHiScore();
    this.maybeSendBattleOjama(cleared, sizeBonus);

    // スコア・連鎖の表示演出
    const px = BOARD_X + (sx / cleared) * CELL + CELL / 2;
    const py = BOARD_Y + (sy / cleared) * CELL + CELL / 2;
    this.addPopup(`+${gained}`, px, py, 20, "#ffffff", "#ffe08a", 900);
    if (this.chainCount >= 2) {
      const col = chainColor(this.chainCount);
      this.addPopup(`${this.chainCount} CHAIN!`, BOARD_X + BOARD_W / 2, BOARD_Y + BOARD_H * 0.3,
        Math.min(36, 26 + this.chainCount * 2), rgb(lift(col, 60)), rgb(col), 1100);
      this.shakeTime = 350;
      this.shakeMag = Math.min(10, 2 + this.chainCount * 1.5);
    }

    this.matchedCells = new Set();
    this.maybeSpawnOjama();
    this.startGravityAnimation("CLEAR_CHECK");
  }

  // ------------------------------------------------------
  maybeSpawnOjama() {
    if (this.isBattle) return;
    while (this.score >= this.nextOjamaScore) {
      this.spawnOjamaPuyo();
      this.nextOjamaScore += OJAMA_SCORE_INTERVAL;
    }
  }

  maybeSendBattleOjama(cleared, sizeBonus) {
    if (!this.isBattle || !activeRoomCode || battleResult) return;
    const flipCount = this.chainCount;
    const reversiBonus = flipCount <= 1 ? 0 : 1.1 + flipCount / 20;
    const attackPoints = Math.floor(
      cleared * 10 * reversiBonus * sizeBonus
    );
    const count = Math.floor(attackPoints / BATTLE_OJAMA_POINT_INTERVAL);
    if (count <= 0) return;
    socket.emit("battleOjama", { roomCode: activeRoomCode, count });
  }

  syncBattleOjama(count) {
    if (!this.isBattle || !Number.isSafeInteger(count) || count < 0) return;
    this.pendingBattleOjama = count;
  }

  startBattleOjamaDrop() {
    this.state = "WAITING_OJAMA";
    socket.timeout(5000).emit("battleOjamaLanded", { roomCode: activeRoomCode },
      (error, response) => {
        if (!this.isBattle || this.state !== "WAITING_OJAMA") return;
        if (error || !response?.success ||
            !Number.isSafeInteger(response.count) || response.count < 0) {
          this.state = "PLAYING";
          openRoomMessage("おじゃまぷよを処理できません",
            response?.error || "サーバーとの通信に失敗しました。");
          this.spawnPair();
          return;
        }
        this.pendingBattleOjama = 0;
        if (response.count === 0) {
          this.state = "PLAYING";
          this.spawnPair();
          return;
        }
        this.dropBattleOjama(response.count);
      });
  }

  dropBattleOjama(count) {
    const plannedByColumn = Array.from({ length: COLS }, () => []);
    for (let i = 0; i < count; i++) {
      const x = (this.battleOjamaColumnCursor + i) % COLS;
      plannedByColumn[x].push(i);
    }

    const drops = [];
    for (let x = 0; x < COLS; x++) {
      const planned = plannedByColumn[x];
      if (planned.length === 0) continue;
      let targetY = 0;
      while (targetY < ROWS && this.board[targetY][x] === null) targetY++;
      targetY--;
      if (targetY - planned.length + 1 < 0) {
        this.pendingBattleOjama = 0;
        this.state = "GAMEOVER";
        this.gameOver = true;
        this.onGameOver();
        return;
      }
      planned.forEach((_, index) => {
        drops.push({
          x,
          y: -1 - index,
          toY: targetY - index,
          color: OJAMA,
          isReversi: false,
          timer: 0,
        });
      });
    }

    this.pendingBattleOjama = 0;
    this.battleOjamaColumnCursor = (this.battleOjamaColumnCursor + drops.length) % COLS;
    this.fallingPuyos = drops;
    this.afterFallingAction = "SPAWN_PAIR";
    this.state = "FALLING";
    Sound.play("ojama");
  }

  spawnOjamaPuyo() {
    const bottomStart = ROWS - 6;
    const candidates = [];
    for (let y = bottomStart; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if (this.board[y][x] === null) candidates.push([x, y]);
    if (candidates.length === 0) return;
    const [x, y] = candidates[Math.floor(Math.random() * candidates.length)];
    this.board[y][x] = OJAMA;
    this.reversi[y][x] = false;
    Sound.play("ojama");
  }

  // ------------------------------------------------------
  // 演出(パーティクル・ポップアップ)
  spawnBurst(cx, cy, color, n = 10, speed = 180) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = speed * (0.4 + Math.random() * 0.8);
      const life = 450 + Math.random() * 350;
      this.particles.push({
        x: cx, y: cy,
        vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 60,
        life, max: life,
        size: 2 + Math.random() * 3,
        color: lift(color, 40),
      });
    }
    if (this.particles.length > 500) this.particles.splice(0, this.particles.length - 500);
  }

  addPopup(text, x, y, size, c1, c2, life) {
    this.popups.push({ text, x, y, size, c1, c2, life, max: life });
  }

  updateFx(dt) {
    this.time += dt;

    if (this.displayScore !== this.score) {
      this.displayScore += (this.score - this.displayScore) * Math.min(1, dt / 150);
      if (Math.abs(this.score - this.displayScore) < 1) this.displayScore = this.score;
    }

    const g = 900 * dt / 1000;
    for (const p of this.particles) {
      p.life -= dt;
      p.vy += g;
      p.x += p.vx * dt / 1000;
      p.y += p.vy * dt / 1000;
    }
    this.particles = this.particles.filter((p) => p.life > 0);

    for (const p of this.popups) p.life -= dt;
    this.popups = this.popups.filter((p) => p.life > 0);

    if (this.shakeTime > 0) this.shakeTime = Math.max(0, this.shakeTime - dt);
  }

  // ------------------------------------------------------
  update(dt) {
    if (this.state === "PAUSED") return;
    this.updateFx(dt);

    if (this.state === "TITLE" || this.state === "ROOM" || this.state === "GAMEOVER") return;
    if (this.state === "WAITING_OJAMA") return;

    if (this.state === "FALLING") { this.updateFalling(dt); return; }

    if (this.state === "REVERSI_FLIP") {
      this.flipTimer += dt;
      if (this.flipTimer > FLIP_DISPLAY_DELAY) {
        this.flipTimer = 0;
        this.finalizeReversiFlip();
      }
      return;
    }

    if (this.state === "CLEARING") {
      this.flashTimer += dt;
      if (this.flashTimer > CLEAR_DISPLAY_DELAY) {
        this.flashTimer = 0;
        this.finalizeClear();
      }
      return;
    }

    if (!this.current) return;

    const interval = this.keys.s ? FAST_FALL_INTERVAL : FALL_INTERVAL;

    // 左右キーの長押しリピート処理
    const left = this.keys.a, right = this.keys.d;
    const direction = left && !right ? -1 : right && !left ? 1 : 0;

    if (direction !== 0) {
      if (direction !== this.moveDir) {
        // 押し始めはhandleKeydownで既に1回動いている
        this.moveDir = direction;
        this.moveTimer = 0;
        this.moveDasDone = false;
      } else {
        this.moveTimer += dt;
        const threshold = this.moveDasDone ? MOVE_REPEAT_INTERVAL : MOVE_INITIAL_DELAY;
        if (this.moveTimer >= threshold) {
          this.moveTimer = 0;
          this.moveDasDone = true;
          if (this.tryMove(direction, 0)) Sound.play("move");
        }
      }
    } else {
      this.moveDir = 0;
      this.moveTimer = 0;
      this.moveDasDone = false;
    }

    this.fallTimer += dt;
    if (this.fallTimer >= interval) {
      this.fallTimer = 0;
      this.isGrounded = !this.tryMove(0, 1);
    }

    if (this.isGrounded) {
      this.lockTimer += dt;
      if (this.lockTimer >= LOCK_DELAY) this.lockCurrent();
    } else {
      this.lockTimer = 0;
    }
  }

  // ------------------------------------------------------
  handleKeydown(k) {
    if (this.state !== "PLAYING" || !this.current) return;
    if (k === "a") { if (this.tryMove(-1, 0)) Sound.play("move"); }
    else if (k === "d") { if (this.tryMove(1, 0)) Sound.play("move"); }
    else if (k === "space") this.tryRotate(1);
  }

  // ======================================================
  // 描画
  // ======================================================
  blendWhite(color, f) {
    return color.map((c) => Math.floor(c + (255 - c) * f));
  }
  circle(cx, cy, r, fill) {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = fill;
    ctx.fill();
  }

  pathRoundRect(x, y, w, h, r) {
    const c = this.ctx;
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  text(str, x, y, font, color, align = "left", baseline = "top") {
    const ctx = this.ctx;
    ctx.font = font;
    ctx.fillStyle = color;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(str, x, y);
  }

  // 幅に収まるようにフォントを縮めて中央表示
  textFit(str, x, y, maxW, startPx, weight, color) {
    const ctx = this.ctx;
    let px = startPx;
    for (; px > 8; px--) {
      ctx.font = `${weight} ${px}px ${FONT_DISPLAY}`;
      if (ctx.measureText(str).width <= maxW) break;
    }
    this.text(str, x, y, `${weight} ${px}px ${FONT_DISPLAY}`, color, "center", "middle");
  }

  // グラデ+縁取り+発光の派手な文字(中央揃え)
  fancyText(str, x, y, size, c1, c2) {
    const ctx = this.ctx;
    ctx.save();
    ctx.font = `900 ${size}px ${FONT_DISPLAY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    const g = ctx.createLinearGradient(0, y - size / 2, 0, y + size / 2);
    g.addColorStop(0, c1);
    g.addColorStop(1, c2);
    ctx.shadowColor = c2;
    ctx.shadowBlur = size * 0.4;
    ctx.lineWidth = Math.max(3, size * 0.12);
    ctx.strokeStyle = "rgba(20,10,40,0.9)";
    ctx.strokeText(str, x, y);
    ctx.fillStyle = g;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  // ぷよ(光沢のある球)
  drawDisc(cx, cy, radius, color, isReversi = false, scale = 1, alpha = 1) {
    const ctx = this.ctx;
    const r = radius * scale;
    ctx.save();
    ctx.globalAlpha = alpha;

    // 影
    this.circle(cx, cy + r * 0.14, r, "rgba(0,0,0,0.35)");

    // 本体(放射状グラデーション)
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, rgb(lift(color, 90)));
    g.addColorStop(0.5, rgb(color));
    g.addColorStop(1, rgb(shade(color, 0.5)));
    this.circle(cx, cy, r, g);

    // 輪郭
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = rgb(shade(color, 0.35));
    ctx.beginPath();
    ctx.arc(cx, cy, r - 0.75, 0, Math.PI * 2);
    ctx.stroke();

    // 反射光
    ctx.fillStyle = "rgba(255,255,255,0.6)";
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.3, cy - r * 0.42, r * 0.36, r * 0.2, -0.5, 0, Math.PI * 2);
    ctx.fill();

    // リバーシぷよ: 白いリング + 中心点
    if (isReversi) {
      const ringR = r * 0.5;
      const w = Math.max(2.5, r * 0.16);
      ctx.lineWidth = w + 2;
      ctx.strokeStyle = "rgba(0,0,0,0.35)";
      ctx.beginPath();
      ctx.arc(cx, cy + r * 0.02, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.lineWidth = w;
      ctx.strokeStyle = "#fff";
      ctx.beginPath();
      ctx.arc(cx, cy, ringR, 0, Math.PI * 2);
      ctx.stroke();
      this.circle(cx, cy, Math.max(1.5, r * 0.14), "#fff");
    }
    ctx.restore();
  }

  drawCell(x, y, color, isReversi = false, scale = 1, alpha = 1) {
    // y は小数(落下アニメ)でもOK
    const cx = BOARD_X + x * CELL + CELL / 2;
    const cy = BOARD_Y + y * CELL + CELL / 2;
    this.drawDisc(cx, cy, CELL / 2 - 2, color, isReversi, scale, alpha);
  }

  drawFlippingCell(x, y, fromColor, toColor, fromIsReversi, progress) {
    const ctx = this.ctx;
    const cx = BOARD_X + x * CELL + CELL / 2;
    const cy = BOARD_Y + y * CELL + CELL / 2;
    const flipScale = Math.max(0.08, Math.abs(Math.cos(progress * Math.PI)));
    const color = progress < 0.5 ? fromColor : toColor;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(flipScale, 1);
    if (color === OJAMA) {
      ctx.translate(-cx, -cy);
      this.drawOjama(x, y);
    } else {
      this.drawDisc(0, 0, CELL / 2 - 2, COLORS[color],
        progress < 0.5 && fromIsReversi);
    }
    ctx.restore();
  }

  // おじゃまぷよ: 金属っぽい灰色の球 + ×
  drawOjama(x, y) {
    const ctx = this.ctx;
    const cx = BOARD_X + x * CELL + CELL / 2;
    const cy = BOARD_Y + y * CELL + CELL / 2;
    const r = CELL / 2 - 2;

    this.circle(cx, cy + r * 0.14, r, "rgba(0,0,0,0.4)");
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.35, r * 0.1, cx, cy, r);
    g.addColorStop(0, "rgb(165,165,178)");
    g.addColorStop(0.5, "rgb(88,88,100)");
    g.addColorStop(1, "rgb(34,34,42)");
    this.circle(cx, cy, r, g);

    const mark = r * 0.5;
    ctx.lineCap = "round";
    ctx.lineWidth = Math.max(3, r * 0.24);
    ctx.strokeStyle = "rgb(22,22,28)";
    ctx.beginPath();
    ctx.moveTo(cx - mark, cy - mark); ctx.lineTo(cx + mark, cy + mark);
    ctx.moveTo(cx - mark, cy + mark); ctx.lineTo(cx + mark, cy - mark);
    ctx.stroke();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.moveTo(cx - mark - 1, cy - mark - 1); ctx.lineTo(cx + mark - 1, cy + mark - 1);
    ctx.moveTo(cx - mark - 1, cy + mark - 1); ctx.lineTo(cx + mark - 1, cy - mark - 1);
    ctx.stroke();
    ctx.lineCap = "butt";

    ctx.fillStyle = "rgba(255,255,255,0.35)";
    ctx.beginPath();
    ctx.ellipse(cx - r * 0.3, cy - r * 0.42, r * 0.34, r * 0.18, -0.5, 0, Math.PI * 2);
    ctx.fill();
  }

  // 着地位置の予測表示
  drawGhost() {
    if (this.state !== "PLAYING" || !this.current) return;
    const ctx = this.ctx;
    const cur = this.current;
    let gy = cur.y;
    while (this.isValidPosition(cur.x, gy + 1, cur.rot)) gy++;
    if (gy === cur.y) return;

    const [cx, cy] = computeChildPos(cur.x, gy, cur.rot);
    const cells = [[cur.x, gy, cur.color1], [cx, cy, cur.color2]];
    for (const [x, y, color] of cells) {
      if (y < 0) continue;
      const px = BOARD_X + x * CELL + CELL / 2;
      const py = BOARD_Y + y * CELL + CELL / 2;
      ctx.save();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = rgba(COLORS[color], 0.15);
      ctx.strokeStyle = rgb(COLORS[color]);
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(px, py, CELL / 2 - 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
  }

  drawBackground() {
    const ctx = this.ctx;
    ctx.fillStyle = this.bgGrad;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    for (const s of this.stars) {
      const y = (s.y + this.time * s.v) % SCREEN_H;
      const a = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(this.time / 600 + s.p));
      ctx.fillStyle = `rgba(180,200,255,${a})`;
      ctx.fillRect(s.x, y, s.s, s.s);
    }
    ctx.fillStyle = this.vignette;
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
  }

  drawBoard() {
    const ctx = this.ctx;

    // 盤面の背景
    const bg = ctx.createLinearGradient(0, BOARD_Y, 0, BOARD_Y + BOARD_H);
    bg.addColorStop(0, "rgb(10,12,26)");
    bg.addColorStop(1, "rgb(22,18,46)");
    ctx.fillStyle = bg;
    ctx.fillRect(BOARD_X, BOARD_Y, BOARD_W, BOARD_H);

    // 市松模様
    ctx.fillStyle = "rgba(255,255,255,0.03)";
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++)
        if ((x + y) % 2 === 0) ctx.fillRect(BOARD_X + x * CELL, BOARD_Y + y * CELL, CELL, CELL);

    // 危険ゾーン(上3段にぷよがあると赤く点滅)
    let danger = false;
    for (let y = 0; y < 3; y++)
      for (let x = 0; x < COLS; x++)
        if (this.board[y][x] !== null) danger = true;
    if (danger) {
      ctx.fillStyle = `rgba(255,40,60,${0.07 + 0.06 * Math.sin(this.time / 140)})`;
      ctx.fillRect(BOARD_X, BOARD_Y, BOARD_W, CELL * 3);
    }

    // グリッド線
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x <= COLS; x++) {
      const px = BOARD_X + x * CELL + 0.5;
      ctx.moveTo(px, BOARD_Y); ctx.lineTo(px, BOARD_Y + BOARD_H);
    }
    for (let y = 0; y <= ROWS; y++) {
      const py = BOARD_Y + y * CELL + 0.5;
      ctx.moveTo(BOARD_X, py); ctx.lineTo(BOARD_X + BOARD_W, py);
    }
    ctx.stroke();

    // 着地予測
    this.drawGhost();

    // 固定済みぷよ
    let flashFactor = 0, clearScale = 1;
    if (this.state === "CLEARING" && this.matchedCells.size > 0) {
      const t = Math.min(1, this.flashTimer / CLEAR_DISPLAY_DELAY);
      flashFactor = t * 0.75;
      clearScale = 1 + 0.15 * t;
    }
    const flipProgress = this.state === "REVERSI_FLIP"
      ? Math.min(1, this.flipTimer / FLIP_DISPLAY_DELAY)
      : 0;

    for (let y = 0; y < ROWS; y++) {
      for (let x = 0; x < COLS; x++) {
        const c = this.board[y][x];
        if (c === OJAMA) {
          const flipToColor = this.flippingCells.get(key(x, y));
          if (flipToColor !== undefined) {
            this.drawFlippingCell(x, y, c, flipToColor, false, flipProgress);
          }
          else this.drawOjama(x, y);
        } else if (c !== null) {
          let color = COLORS[c];
          let scale = 1;
          const k = key(x, y);
          if (this.matchedCells.has(k)) {
            color = this.blendWhite(color, flashFactor);
            scale = clearScale;
          } else if (this.flippingCells.has(k)) {
            this.drawFlippingCell(x, y, c, this.flippingCells.get(k),
              this.reversi[y][x], flipProgress);
            continue;
          }
          this.drawCell(x, y, color, this.reversi[y][x], scale);
        }
      }
    }

    // ちぎれて落下中のぷよ
    for (const p of this.fallingPuyos) {
      if (p.color === OJAMA) this.drawOjama(p.x, p.y);
      else this.drawCell(p.x, p.y, COLORS[p.color], p.isReversi);
    }

    // 操作中のぷよ
    if (this.current) {
      for (const { x, y, color, isReversi } of this.current.cells()) {
        if (y >= 0) this.drawCell(x, y, COLORS[color], isReversi);
      }
    }

    // ネオンの枠
    ctx.save();
    ctx.shadowColor = "rgba(90,170,255,0.9)";
    ctx.shadowBlur = 16;
    ctx.strokeStyle = "rgb(120,180,255)";
    ctx.lineWidth = 3;
    ctx.strokeRect(BOARD_X - 1.5, BOARD_Y - 1.5, BOARD_W + 3, BOARD_H + 3);
    ctx.restore();
    ctx.strokeStyle = "rgba(255,255,255,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(BOARD_X + 0.5, BOARD_Y + 0.5, BOARD_W - 1, BOARD_H - 1);
  }

  drawBattleBoard(rect) {
    const scale = Math.min(rect.w / BOARD_W, rect.h / BOARD_H);
    this.ctx.save();
    this.ctx.translate(rect.x, rect.y);
    this.ctx.scale(scale, scale);
    this.ctx.translate(-BOARD_X, -BOARD_Y);
    this.drawBoard();
    this.ctx.restore();
  }

  drawOpponentBoard(rect, snapshot) {
    const scale = Math.min(rect.w / BOARD_W, rect.h / BOARD_H);
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(rect.x, rect.y);
    ctx.scale(scale, scale);
    ctx.translate(-BOARD_X, -BOARD_Y);

    const x = BOARD_X, y = BOARD_Y;
    const bg = ctx.createLinearGradient(0, y, 0, y + BOARD_H);
    bg.addColorStop(0, "rgb(10,12,26)");
    bg.addColorStop(1, "rgb(22,18,46)");
    ctx.fillStyle = bg;
    ctx.fillRect(x, y, BOARD_W, BOARD_H);
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let col = 0; col <= COLS; col++) {
      const px = x + col * CELL + 0.5;
      ctx.moveTo(px, y);
      ctx.lineTo(px, y + BOARD_H);
    }
    for (let row = 0; row <= ROWS; row++) {
      const py = y + row * CELL + 0.5;
      ctx.moveTo(x, py);
      ctx.lineTo(x + BOARD_W, py);
    }
    ctx.stroke();
    ctx.strokeStyle = "rgba(120,180,255,0.55)";
    ctx.lineWidth = 3;
    ctx.strokeRect(x - 1.5, y - 1.5, BOARD_W + 3, BOARD_H + 3);

    if (snapshot) {
      for (let row = 0; row < ROWS; row++) {
        for (let col = 0; col < COLS; col++) {
          const color = snapshot.board[row][col];
          if (color === OJAMA) this.drawOjama(col, row);
          else if (color !== null) {
            this.drawCell(col, row, COLORS[color], snapshot.reversi[row][col]);
          }
        }
      }
      for (const puyo of snapshot.fallingPuyos) {
        if (puyo.color === OJAMA) this.drawOjama(puyo.x, puyo.y);
        else this.drawCell(puyo.x, puyo.y, COLORS[puyo.color], puyo.isReversi);
      }
      for (const puyo of snapshot.current) {
        if (puyo.y >= 0) this.drawCell(puyo.x, puyo.y, COLORS[puyo.color], puyo.isReversi);
      }
    }
    ctx.restore();
  }

  drawNextPreview(x, y, width, pair = this.nextPair, nextPair = this.nextNextPair) {
    const scale = width / SIDE_PANEL_WIDTH;
    const nextX = BOARD_X + BOARD_W + SIDE_PANEL_GAP;
    const nextY = BOARD_Y;
    const ctx = this.ctx;
    ctx.save();
    ctx.translate(x - nextX * scale, y - nextY * scale);
    ctx.scale(scale, scale);
    this.drawNextPanel(pair, nextPair);
    ctx.restore();
  }

  drawBattleNextPreview(x, y, pair, nextPair, scale = 1) {
    const ctx = this.ctx;
    const width = 152, height = 104;
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(scale, scale);
    const centerX = width / 2;
    this.pathRoundRect(0, 0, width, height, 9);
    ctx.fillStyle = "rgba(12,15,34,0.94)";
    ctx.fill();
    ctx.strokeStyle = "rgba(140,170,255,0.55)";
    ctx.lineWidth = 1;
    ctx.stroke();
    if (pair) {
      const [[color1, reversi1], [color2, reversi2]] = pair;
      const nextX = 40;
      this.text("NEXT", nextX, 16, `700 9px ${FONT_DISPLAY}`,
        "rgb(190,205,245)", "center", "middle");
      this.drawDisc(nextX, 48, 13, COLORS[color1], reversi1);
      this.drawDisc(nextX, 76, 13, COLORS[color2], reversi2);
    }

    if (nextPair) {
      const [[color1, reversi1], [color2, reversi2]] = nextPair;
      const nextNextX = 112;
      this.text("NEXT 2", nextNextX, 16, `700 9px ${FONT_DISPLAY}`,
        "rgb(150,165,205)", "center", "middle");
      this.drawDisc(nextNextX, 48, 10, COLORS[color1], reversi1, 1, 0.85);
      this.drawDisc(nextNextX, 76, 10, COLORS[color2], reversi2, 1, 0.85);
    }

    ctx.strokeStyle = "rgba(140,170,255,0.3)";
    ctx.beginPath();
    ctx.moveTo(76, 30);
    ctx.lineTo(76, height - 12);
    ctx.stroke();
    ctx.restore();
  }

  drawBattleOjamaWarning(rect) {
    const count = this.pendingBattleOjama;
    if (!count || !this.isBattle ||
        (this.state !== "PLAYING" && this.state !== "WAITING_OJAMA")) return;

    const color = count <= 3 ? "#ffffff"
      : count <= 6 ? "#ffe34d"
        : count <= 9 ? "#ff941f"
          : "#ff334b";
    const alpha = Math.sin(this.time / 85) > 0 ? 1 : 0.2;
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `900 34px ${FONT_DISPLAY}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 5;
    ctx.strokeStyle = "rgba(15,18,40,0.9)";
    ctx.shadowColor = color;
    ctx.shadowBlur = 16;
    ctx.strokeText("!", rect.x + rect.w / 2, rect.y + 21);
    ctx.fillStyle = color;
    ctx.fillText("!", rect.x + rect.w / 2, rect.y + 21);
    ctx.restore();
  }

  drawBattleScreen() {
    const localPlayer = roomPlayers.find((player) => player.socketId === socket.id);
    const opponent = roomPlayers.find((player) => player.socketId !== socket.id);
    const layout = {
      local: { x: 3, y: 154, w: 234, h: 468 },
      opponent: { x: 321, y: 154, w: 218, h: 436 },
      localNext: { x: 44, y: 40, scale: 1 },
      opponentNext: { x: 358, y: 40, scale: 0.94 },
      localName: { x: 120, y: 22 },
      opponentName: { x: 430, y: 22 },
    };

    this.text(localPlayer?.name || this.playerName, layout.localName.x, layout.localName.y,
      `700 14px ${FONT_UI}`, "rgb(255,230,120)", "center", "middle");
    this.text(opponent?.name || "対戦相手", layout.opponentName.x, layout.opponentName.y,
      `700 14px ${FONT_UI}`, "rgb(200,210,235)", "center", "middle");

    this.drawBattleBoard(layout.local);
    this.drawBattleOjamaWarning(layout.local);
    const opponentState = opponentBattleState?.socketId === opponent?.socketId
      ? opponentBattleState.state
      : null;
    this.drawOpponentBoard(layout.opponent, opponentState);
    this.drawBattleNextPreview(layout.localNext.x, layout.localNext.y,
      this.nextPair, this.nextNextPair, layout.localNext.scale);
    this.drawBattleNextPreview(layout.opponentNext.x, layout.opponentNext.y,
      opponentState?.nextPair || null, opponentState?.nextNextPair || null,
      layout.opponentNext.scale);
  }

  drawBattleResult() {
    const result = battleResult;
    const didWin = result?.winnerId === socket.id;
    const message = didWin ? "YOU WIN!" : "YOU LOSE";
    const ctx = this.ctx;
    const panel = { x: 92, y: 224, w: SCREEN_W - 184, h: 204 };

    ctx.fillStyle = "rgba(5,5,18,0.78)";
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);
    this.pathRoundRect(panel.x, panel.y, panel.w, panel.h, 18);
    ctx.fillStyle = "rgba(20,22,48,0.98)";
    ctx.fill();
    ctx.strokeStyle = didWin ? "rgba(255,220,125,0.95)" : "rgba(255,110,125,0.95)";
    ctx.lineWidth = 2;
    ctx.stroke();

    this.fancyText(message, SCREEN_W / 2, panel.y + 62, 32,
      didWin ? "#fff2a8" : "#ffb3b3", didWin ? "#ffb02e" : "#ff3b4e");
    this.drawButton(this.battleResultLayout().returnToRoom, "部屋に戻る");
  }

  battleResultLayout() {
    const width = 220, height = 48;
    return {
      returnToRoom: {
        x: (SCREEN_W - width) / 2,
        y: SCREEN_H / 2 + 44,
        w: width,
        h: height
      }
    };
  }

  drawPanel(x, y, w, h, title) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, y, 0, y + h);
    g.addColorStop(0, "rgba(48,54,96,0.95)");
    g.addColorStop(1, "rgba(22,24,50,0.95)");
    this.pathRoundRect(x, y, w, h, 10);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.shadowColor = "rgba(100,140,255,0.5)";
    ctx.shadowBlur = 8;
    ctx.strokeStyle = "rgba(120,150,255,0.7)";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    if (title) {
      this.text(title, x + w / 2, y + 14, `700 11px ${FONT_DISPLAY}`, "rgb(140,170,255)", "center", "middle");
    }
  }

  drawHeader() {
    const ctx = this.ctx;
    ctx.save();
    ctx.shadowColor = "rgba(255,170,40,0.9)";
    ctx.shadowBlur = 14;
    const g = ctx.createLinearGradient(0, TITLE_Y, 0, TITLE_Y + TITLE_HEIGHT);
    g.addColorStop(0, "#fff2a8");
    g.addColorStop(1, "#ffb02e");
    this.text("REVERSI PUYO", SCREEN_W / 2, TITLE_Y + TITLE_HEIGHT / 2,
      `900 26px ${FONT_DISPLAY}`, g, "center", "middle");
    ctx.restore();
    if (this.isSinglePlayer && (this.state === "PLAYING" || this.state === "PAUSED")) {
      this.drawMenuButton(this.pauseMenuLayout().toggle);
    }
  }

  drawMenuButton(rect) {
    this.drawButton(rect, "");
    const ctx = this.ctx;
    const centerX = rect.x + rect.w / 2;
    const centerY = rect.y + rect.h / 2;
    ctx.save();
    ctx.strokeStyle = "#ffffff";
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    for (const offset of [-9, 0, 9]) {
      ctx.beginPath();
      ctx.moveTo(centerX - 13, centerY + offset);
      ctx.lineTo(centerX + 13, centerY + offset);
      ctx.stroke();
    }
    ctx.restore();
  }

  drawHud() {
    const ctx = this.ctx;
    const boxW = SIDE_PANEL_WIDTH;

    // ---- 左: SCORE / HI-SCORE / MAX CHAIN ----
    const lx = BOARD_X - SIDE_PANEL_GAP - boxW;
    this.drawPanel(lx, BOARD_Y, boxW, 96, "SCORE");
    this.textFit(String(Math.round(this.displayScore)), lx + boxW / 2, BOARD_Y + 58,
      boxW - 16, 22, 900, "rgb(255,230,120)");

    this.drawPanel(lx, BOARD_Y + 108, boxW, 70, "HI-SCORE");
    this.textFit(String(Math.max(this.hiScore, this.score)), lx + boxW / 2, BOARD_Y + 108 + 44,
      boxW - 16, 16, 900, "rgb(255,255,255)");

    this.drawPanel(lx, BOARD_Y + 190, boxW, 70, "MAX CHAIN");
    const mcCol = this.maxChain >= 2 ? rgb(chainColor(this.maxChain)) : "rgb(255,255,255)";
    this.textFit(String(this.maxChain), lx + boxW / 2, BOARD_Y + 190 + 44, boxW - 16, 24, 900, mcCol);

    this.drawNextPanel(this.nextPair);
    const nx = BOARD_X + BOARD_W + SIDE_PANEL_GAP;
    const cx = nx + boxW / 2;
    const ry = BOARD_Y + 184;
    this.drawPanel(nx, ry, boxW, 84, "RULE");
    const f = `11px ${FONT_UI}`;
    this.text("同色の◎で挟むと", cx, ry + 44, f, "rgb(200,210,235)", "center", "middle");
    this.text("間のぷよが反転!", cx, ry + 64, f, "rgb(200,210,235)", "center", "middle");
  }

  drawNextPanel(pair, nextPair = this.nextNextPair) {
    const ctx = this.ctx;
    const boxW = SIDE_PANEL_WIDTH;
    const nx = BOARD_X + BOARD_W + SIDE_PANEL_GAP;
    this.drawPanel(nx, BOARD_Y, boxW, 172, "NEXT");
    const cx = nx + boxW / 2;

    if (pair) {
      const [[c1, r1], [c2, r2]] = pair;
      this.drawDisc(cx, BOARD_Y + 50, 12, COLORS[c1], r1);
      this.drawDisc(cx, BOARD_Y + 76, 12, COLORS[c2], r2);
    } else {
      this.text("?", cx, BOARD_Y + 68, `700 24px ${FONT_UI}`,
        "rgb(155,160,185)", "center", "middle");
    }

    ctx.strokeStyle = "rgba(140,170,255,0.25)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(nx + 14, BOARD_Y + 98);
    ctx.lineTo(nx + boxW - 14, BOARD_Y + 98);
    ctx.stroke();

    if (nextPair) {
      const [[c3, r3], [c4, r4]] = nextPair;
      this.drawDisc(cx, BOARD_Y + 122, 9, COLORS[c3], r3, 1, 0.75);
      this.drawDisc(cx, BOARD_Y + 142, 9, COLORS[c4], r4, 1, 0.75);
    }
  }

  drawFx() {
    const ctx = this.ctx;

    // パーティクル(加算合成で光らせる)
    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (const p of this.particles) {
      const a = Math.max(0, p.life / p.max);
      ctx.fillStyle = rgba(p.color, a);
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.5 + 0.5 * a), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // ポップアップ文字
    for (const p of this.popups) {
      const t = 1 - p.life / p.max;
      const ratio = p.life / p.max;
      const alpha = ratio < 0.3 ? ratio / 0.3 : 1;
      const scale = 1 + 0.4 * Math.max(0, 1 - t * 5);
      ctx.save();
      ctx.translate(p.x, p.y - 30 * t);
      ctx.scale(scale, scale);
      ctx.globalAlpha = alpha;
      this.fancyText(p.text, 0, 0, p.size, p.c1, p.c2);
      ctx.restore();
    }
  }

  drawTitleArtwork(titleY, puyoY) {
    const cx = SCREEN_W / 2;

    this.fancyText("REVERSI", cx, titleY, 60, "#fff7c2", "#ffb300");
    this.fancyText("PUYO", cx, titleY + 72, 92, "#c8f1ff", "#2d8cff");

    const n = COLORS.length, gap = 64;
    const x0 = cx - ((n - 1) * gap) / 2;
    for (let i = 0; i < n; i++) {
      const y = puyoY + Math.sin(this.time / 320 + i * 0.9) * 10;
      this.drawDisc(x0 + i * gap, y, 27, COLORS[i], i === 2);
    }
  }

  drawTitleScreen() {
    const cx = SCREEN_W / 2;

    const nameButton = this.playerNameLayout();
    const nameLabel = this.playerName
      ? `プレイヤー名：${this.playerName}`
      : "プレイヤー名を入力してください";
    const nameHover = this.hit(nameButton, this.pointer.x, this.pointer.y);
    this.pathRoundRect(nameButton.x, nameButton.y, nameButton.w, nameButton.h, 10);
    this.ctx.fillStyle = nameHover ? "rgba(75,90,155,0.95)" : "rgba(38,44,82,0.9)";
    this.ctx.fill();
    this.ctx.strokeStyle = nameHover ? "rgba(175,195,255,0.95)" : "rgba(120,150,255,0.65)";
    this.ctx.lineWidth = 1.5;
    this.ctx.stroke();
    this.text(nameLabel, nameButton.x + 12, nameButton.y + nameButton.h / 2,
      `700 16px ${FONT_UI}`, "#ffffff", "left", "middle");

    this.drawTitleArtwork(SCREEN_H * 0.26, SCREEN_H * 0.50);

    this.text(`HI-SCORE  ${this.hiScore}`, cx, SCREEN_H * 0.59,
      `700 19px ${FONT_DISPLAY}`, "rgb(255,230,120)", "center", "middle");

    this.drawButton(this.titleLayout().play, "プレイ");
    this.drawButton(this.titleLayout().createRoom, "部屋を作成");
    this.drawButton(this.titleLayout().joinRoom, "部屋に入る");

    if (activeRoomCode) {
      this.text(`ルームコード：${activeRoomCode}`, cx, SCREEN_H * 0.83,
        `700 17px ${FONT_UI}`, "rgb(255,230,120)", "center", "middle");
    }

    this.text("A / D：移動　　S：高速落下　　SPACE：回転", cx, SCREEN_H * 0.88,
      `15px ${FONT_UI}`, "rgb(170,185,220)", "center", "middle");
    this.text("◎は同じ色で挟むとその間の色を反転させる", cx, SCREEN_H * 0.93,
      `15px ${FONT_UI}`, "rgb(170,185,220)", "center", "middle");
  }

  drawRoomScreen() {
    const cx = SCREEN_W / 2;
    this.drawTitleArtwork(SCREEN_H * 0.17, SCREEN_H * 0.43);

    this.text(`ルームコード：${activeRoomCode}`, cx, SCREEN_H * 0.50,
      `700 16px ${FONT_UI}`, "rgb(255,230,120)", "center", "middle");

    const players = roomPlayers.slice(0, 2);
    for (let i = 0; i < 2; i++) {
      const player = players[i];
      const y = SCREEN_H * 0.55 + i * 68;
      const card = { x: 72, y, w: SCREEN_W - 144, h: 58 };

      this.pathRoundRect(card.x, card.y, card.w, card.h, 12);
      this.ctx.fillStyle = player ? "rgba(38,44,82,0.94)" : "rgba(24,28,54,0.8)";
      this.ctx.fill();
      this.ctx.strokeStyle = player ? "rgba(143,164,255,0.9)" : "rgba(120,140,190,0.45)";
      this.ctx.lineWidth = 1.5;
      this.ctx.stroke();

      this.text(i === 0 ? "ホスト" : "プレイヤー", card.x + 16, card.y + 19,
        `700 12px ${FONT_UI}`, i === 0 ? "rgb(255,220,125)" : "rgb(170,185,220)", "left", "middle");
      this.text(player ? player.name : "参加を待っています…", card.x + 16, card.y + 41,
        `700 15px ${FONT_UI}`, player ? "#ffffff" : "rgb(155,160,185)", "left", "middle");
    }

    const isHost = players.some((player) => player.socketId === socket.id && player.isHost);
    if (isHost) {
      this.drawButton(this.roomLayout().start, "対戦開始",
        players.length < 2 || activeBattleStarted);
    } else {
      const waitingMessage = activeBattleStarted
        ? "相手が部屋に戻るのを待っています"
        : "ホストが対戦を開始するのを待っています";
      this.text(waitingMessage, cx, SCREEN_H * 0.80,
        `13px ${FONT_UI}`, "rgb(170,185,220)", "center", "middle");
    }
    this.drawButton(this.roomLayout().leave, "タイトルに戻る");
  }

  roomLayout() {
    const width = 220, height = 42;
    return {
      start: { x: (SCREEN_W - width) / 2, y: SCREEN_H * 0.80 - height / 2, w: width, h: height },
      leave: { x: (SCREEN_W - width) / 2, y: SCREEN_H * 0.92 - height / 2, w: width, h: height },
    };
  }

  titleLayout() {
    const bw = 280, bh = 60;
    const roomButtonW = 136, roomButtonH = 50, roomGap = 12;
    const rowWidth = roomButtonW * 2 + roomGap;
    const rowX = (SCREEN_W - rowWidth) / 2;
    return {
      play: { x: (SCREEN_W - bw) / 2, y: SCREEN_H * 0.68 - bh / 2, w: bw, h: bh },
      createRoom: { x: rowX, y: SCREEN_H * 0.68 + bh / 2 + 10, w: roomButtonW, h: roomButtonH },
      joinRoom: { x: rowX + roomButtonW + roomGap, y: SCREEN_H * 0.68 + bh / 2 + 10, w: roomButtonW, h: roomButtonH },
    };
  }

  playerNameLayout() {
    const label = this.playerName
      ? `プレイヤー名：${this.playerName}`
      : "プレイヤー名を入力してください";
    this.ctx.font = `700 16px ${FONT_UI}`;
    const labelWidth = this.ctx.measureText(label).width;
    return { x: 14, y: 12, w: Math.ceil(labelWidth) + 28, h: 44 };
  }

  // ゲームオーバー画面のレイアウト(描画とクリック判定で共用)
  gameoverLayout() {
    const boxW = 390, boxH = 450;
    const boxX = (SCREEN_W - boxW) / 2, boxY = (SCREEN_H - boxH) / 2;
    const bw = 290, bh = 54, bx = (SCREEN_W - bw) / 2;
    return {
      box: { x: boxX, y: boxY, w: boxW, h: boxH },
      retry: { x: bx, y: boxY + 310, w: bw, h: bh },
      title: { x: bx, y: boxY + 380, w: bw, h: bh },
    };
  }

  hit(r, x, y) {
    return x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  }

  // ボタン(リトライ/タイトルに戻る 共通の見た目)
  drawButton(r, label, disabled = false) {
    const ctx = this.ctx;
    const hover = !disabled && this.hit(r, this.pointer.x, this.pointer.y);
    const g = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    g.addColorStop(0, disabled ? "#343750" : "#4a5190");
    g.addColorStop(1, disabled ? "#242638" : "#2a2e5e");
    this.pathRoundRect(r.x, r.y, r.w, r.h, 12);
    ctx.fillStyle = g;
    ctx.fill();
    if (hover) {
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.fill();
    }
    ctx.save();
    ctx.shadowColor = "rgba(120,150,255,0.7)";
    ctx.shadowBlur = hover ? 16 : 8;
    ctx.strokeStyle = disabled ? "#5e627a" : "#8fa4ff";
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
    this.text(label, r.x + r.w / 2, r.y + r.h / 2 + 1, `700 19px ${FONT_UI}`,
      disabled ? "rgb(145,150,170)" : "#ffffff", "center", "middle");
  }

  drawGameover() {
    const ctx = this.ctx;
    const cx = SCREEN_W / 2;
    const L = this.gameoverLayout();
    const { x: boxX, y: boxY, w: boxW, h: boxH } = L.box;

    ctx.fillStyle = "rgba(5,5,15,0.7)";
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

    const g = ctx.createLinearGradient(0, boxY, 0, boxY + boxH);
    g.addColorStop(0, "rgba(54,30,60,0.97)");
    g.addColorStop(1, "rgba(20,14,38,0.97)");
    this.pathRoundRect(boxX, boxY, boxW, boxH, 18);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.shadowColor = "rgba(255,60,80,0.8)";
    ctx.shadowBlur = 18;
    ctx.strokeStyle = "rgb(255,90,110)";
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    this.fancyText("GAME OVER", cx, boxY + 64, 44, "#ffb3b3", "#ff3b4e");

    this.text("SCORE", cx, boxY + 136, `700 17px ${FONT_DISPLAY}`, "rgb(140,170,255)", "center", "middle");
    this.textFit(String(this.score), cx, boxY + 180, boxW - 60, 46, 900, "rgb(255,230,120)");

    if (this.newRecord) {
      ctx.save();
      ctx.globalAlpha = 0.6 + 0.4 * Math.sin(this.time / 160);
      this.text("NEW RECORD!", cx, boxY + 244, `900 26px ${FONT_DISPLAY}`, "#ffd54f", "center", "middle");
      ctx.restore();
    } else {
      this.text(`BEST  ${this.hiScore}`, cx, boxY + 244, `700 19px ${FONT_DISPLAY}`, "rgb(220,225,255)", "center", "middle");
    }

    this.text(`MAX CHAIN  ${this.maxChain}`, cx, boxY + 286, `700 17px ${FONT_DISPLAY}`, "rgb(220,225,255)", "center", "middle");

    this.drawButton(L.retry, "リトライ");
    this.drawButton(L.title, "タイトルに戻る");
  }

  drawPauseMenu() {
    const ctx = this.ctx;
    const layout = this.pauseMenuLayout();

    ctx.fillStyle = "rgba(5,5,18,0.72)";
    ctx.fillRect(0, 0, SCREEN_W, SCREEN_H);

    const panel = layout.panel;
    this.pathRoundRect(panel.x, panel.y, panel.w, panel.h, 18);
    ctx.fillStyle = "rgba(20,22,48,0.97)";
    ctx.fill();
    ctx.strokeStyle = "rgba(143,164,255,0.9)";
    ctx.lineWidth = 2;
    ctx.stroke();

    this.fancyText("PAUSE", SCREEN_W / 2, panel.y + 56, 36, "#fff2a8", "#ffb02e");
    this.drawButton(layout.continue, "つづける");
    this.drawButton(layout.restart, "最初からやり直す");
    this.drawButton(layout.title, "タイトルに戻る");
  }

  pauseMenuLayout() {
    const buttonWidth = 290, buttonHeight = 56, gap = 16;
    const buttonX = (SCREEN_W - buttonWidth) / 2;
    const buttonY = SCREEN_H / 2 - 46;
    const panelWidth = 360, panelHeight = 380;
    return {
      toggle: { x: SCREEN_W - 60, y: TITLE_Y + 2, w: 48, h: 42 },
      panel: {
        x: (SCREEN_W - panelWidth) / 2,
        y: (SCREEN_H - panelHeight) / 2,
        w: panelWidth,
        h: panelHeight,
      },
      continue: { x: buttonX, y: buttonY, w: buttonWidth, h: buttonHeight },
      restart: { x: buttonX, y: buttonY + buttonHeight + gap, w: buttonWidth, h: buttonHeight },
      title: { x: buttonX, y: buttonY + (buttonHeight + gap) * 2, w: buttonWidth, h: buttonHeight },
    };
  }

  draw() {
    const ctx = this.ctx;
    this.drawBackground();

    if (this.state === "TITLE") {
      this.drawTitleScreen();
    } else if (this.state === "ROOM") {
      this.drawRoomScreen();
    } else if (this.isBattle) {
      this.drawBattleScreen();
      if (this.state === "GAMEOVER") this.drawBattleResult();
    } else {
      ctx.save();
      if (this.shakeTime > 0) {
        const m = this.shakeMag * (this.shakeTime / 350);
        ctx.translate((Math.random() * 2 - 1) * m, (Math.random() * 2 - 1) * m);
      }
      this.drawHeader();
      this.drawBoard();
      this.drawHud();
      this.drawFx();
      ctx.restore();
      if (this.state === "PAUSED") this.drawPauseMenu();
      else if (this.state === "GAMEOVER") this.drawGameover();
    }

    if (!this.isBattle && this.state !== "ROOM") {
      ctx.strokeStyle = "rgba(120,140,255,0.35)";
      ctx.lineWidth = 2;
      const leftX = BOARD_X - SIDE_PANEL_GAP - SIDE_PANEL_WIDTH - SIDE_PANEL_GAP / 2;
      const rightX = BOARD_X + BOARD_W + SIDE_PANEL_GAP + SIDE_PANEL_WIDTH + SIDE_PANEL_GAP / 2;
      ctx.beginPath();
      ctx.moveTo(leftX, 0); ctx.lineTo(leftX, SCREEN_H);
      ctx.moveTo(rightX, 0); ctx.lineTo(rightX, SCREEN_H);
      ctx.stroke();
    }
  }

  // ------------------------------------------------------
  restart() {
    this.reset();
    this.state = "PLAYING";
    Sound.play("start");
  }

  // タイトルへ戻る(ハイスコアは保持)
  toTitle() {
    this.reset();
    this.isSinglePlayer = false;
    this.state = "TITLE";
  }

  // タイトル画面でプレイボタン/スペース → ゲーム開始
  confirm() {
    if (this.state !== "TITLE") return;
    if (!this.playerName) {
      openPlayerNameDialog();
      return;
    }
    this.isSinglePlayer = true;
    this.state = "PLAYING";
    Sound.play("start");
  }

  // 画面のタップ/クリック処理(座標は論理座標)
  handlePointer(lx, ly) {
    if (this.state === "TITLE") {
      if (this.hit(this.playerNameLayout(), lx, ly)) {
        openPlayerNameDialog();
      } else {
        const layout = this.titleLayout();
        if (this.hit(layout.play, lx, ly)) this.confirm();
        else if (this.hit(layout.createRoom, lx, ly)) createOnlineRoom();
        else if (this.hit(layout.joinRoom, lx, ly)) openJoinRoomDialog();
      }
    } else if (this.state === "ROOM") {
      const layout = this.roomLayout();
      const isHost = roomPlayers.some((player) => player.socketId === socket.id && player.isHost);
      if (isHost && roomPlayers.length >= 2 && !activeBattleStarted
        && this.hit(layout.start, lx, ly)) {
        requestStartBattle();
      } else if (this.hit(layout.leave, lx, ly)) {
        requestLeaveRoom();
      }
    } else if (this.isBattle && this.state === "GAMEOVER") {
      if (this.hit(this.battleResultLayout().returnToRoom, lx, ly)) returnToOnlineRoom();
    } else if (this.state === "PAUSED") {
      const layout = this.pauseMenuLayout();
      if (this.hit(layout.continue, lx, ly)) this.state = "PLAYING";
      else if (this.hit(layout.restart, lx, ly)) this.restart();
      else if (this.hit(layout.title, lx, ly)) this.toTitle();
    } else if (this.state === "PLAYING" && this.isSinglePlayer) {
      if (this.hit(this.pauseMenuLayout().toggle, lx, ly)) this.state = "PAUSED";
    } else if (this.state === "GAMEOVER") {
      const L = this.gameoverLayout();
      if (this.hit(L.retry, lx, ly)) this.restart();
      else if (this.hit(L.title, lx, ly)) this.toTitle();
    }
  }

  pressKey(k) {
    if (k === "a" || k === "d" || k === "s") this.keys[k] = true;
    if (this.state === "TITLE") {
      if (k === "space") this.confirm();
    } else if (this.state === "ROOM") {
      if (k === "escape") requestLeaveRoom();
    } else if (this.state === "PAUSED") {
      if (k === "escape") this.state = "PLAYING";
    } else if (this.state === "GAMEOVER") {
      if (k === "r") this.restart();
      else if (k === "t") this.toTitle();
    } else {
      if (k === "escape" && this.isSinglePlayer && this.state === "PLAYING") {
        this.state = "PAUSED";
        return;
      }
      this.handleKeydown(k);
    }
  }

  releaseKey(k) {
    if (k === "a" || k === "d" || k === "s") this.keys[k] = false;
  }
}

// ==========================================================
// 起動・入力・描画ループ
// ==========================================================
const canvas = document.getElementById("c");
const ctx = canvas.getContext("2d");
const RES = 2; // 内部解像度の倍率(くっきり表示用)
canvas.width = SCREEN_W * RES;
canvas.height = SCREEN_H * RES;
ctx.scale(RES, RES);

// Webフォントを先読み(読み込み前はフォールバック表示)
try {
  if (document.fonts && document.fonts.load) {
    document.fonts.load('900 20px "Orbitron"');
    document.fonts.load('700 20px "Orbitron"');
  }
} catch (e) { /* 無視 */ }

const game = new PuyoGame(ctx);
const playerNameDialog = document.getElementById("player-name-dialog");
const playerNameForm = document.getElementById("player-name-form");
const playerNameInput = document.getElementById("player-name-input");
const roomDialog = document.getElementById("room-dialog");
const roomForm = document.getElementById("room-form");
const roomDialogTitle = document.getElementById("room-dialog-title");
const roomDialogMessage = document.getElementById("room-dialog-message");
const roomCodeLabel = document.getElementById("room-code-label");
const roomCodeInput = document.getElementById("room-code-input");
const roomDialogError = document.getElementById("room-dialog-error");
const roomJoinSubmit = document.getElementById("room-join-submit");
const roomDialogActions = roomDialog.querySelector(".dialog-actions");
const roomConfirmActions = document.getElementById("room-confirm-actions");
let activeRoomCode = "";
let roomPlayers = [];
let battlePairSeed = 0;
let opponentBattleState = null;
let battleResult = null;
let activeBattleStarted = false;

function openPlayerNameDialog() {
  playerNameInput.value = game.playerName;
  playerNameDialog.showModal();
  playerNameInput.focus();
}

function openJoinRoomDialog() {
  roomDialogTitle.textContent = "ルームに参加";
  roomDialogMessage.textContent = "4桁のルームコードを入力してください。";
  roomDialogActions.hidden = false;
  roomConfirmActions.hidden = true;
  roomCodeLabel.hidden = false;
  roomCodeInput.hidden = false;
  roomJoinSubmit.hidden = false;
  roomDialogError.textContent = "";
  roomCodeInput.value = "";
  roomDialog.showModal();
  roomCodeInput.focus();
}

function createOnlineRoom() {
  if (!socket.connected) {
    openRoomMessage("接続できません", "サーバーに接続できません。時間をおいて再度お試しください。");
    return;
  }

  socket.timeout(5000).emit("createRoom", { playerName: game.playerName }, (error, response) => {
    if (error || !response || !response.success) {
      openRoomMessage("ルームを作成できません", "サーバーとの通信に失敗しました。もう一度お試しください。");
      return;
    }
    enterOnlineRoom(response);
  });
}

function enterOnlineRoom(response, fallbackRoomCode = "") {
  activeRoomCode = response.roomCode || fallbackRoomCode;
  roomPlayers = response.players || [];
  if (roomDialog.open) roomDialog.close();
  updateOnlineRoomView();
}

function updateOnlineRoomView() {
  if (game.isBattle) {
    game.reset();
    game.isBattle = false;
  }
  game.state = "ROOM";
}

function startOnlineBattle(pairSeed) {
  if (game.isBattle || roomPlayers.length < 2 || !pairSeed) return;
  battlePairSeed = pairSeed;
  opponentBattleState = null;
  battleResult = null;
  activeBattleStarted = true;
  game.battleRandomState = pairSeed;
  game.isBattle = true;
  game.reset();
  game.isSinglePlayer = false;
  game.state = "PLAYING";
}

function requestStartBattle() {
  if (!socket.connected || roomPlayers.length < 2) return;

  socket.timeout(5000).emit("startBattle", (error, response) => {
    if (error || !response || !response.success) {
      openRoomMessage("対戦を開始できません", response?.error || "サーバーとの通信に失敗しました。");
    }
  });
}

function reportBattleLoss() {
  if (!activeRoomCode || battleResult) return;
  socket.emit("battleLost", { roomCode: activeRoomCode });
}

function returnToOnlineRoom() {
  if (!socket.connected) {
    openRoomMessage("接続が切れました", "サーバーに接続できないため、部屋に戻れません。");
    return;
  }

  socket.timeout(5000).emit("battleReturnToRoom", (error, response) => {
    if (error || !response?.success) {
      openRoomMessage("部屋に戻れません", response?.error || "サーバーとの通信に失敗しました。");
      return;
    }

    game.reset();
    game.isBattle = false;
    game.isSinglePlayer = false;
    game.state = "ROOM";
    battleResult = null;
    opponentBattleState = null;
  });
}

function leaveOnlineRoom() {
  socket.emit("leaveRoom");
  activeRoomCode = "";
  roomPlayers = [];
  battlePairSeed = 0;
  opponentBattleState = null;
  battleResult = null;
  activeBattleStarted = false;
  game.isBattle = false;
  game.state = "TITLE";
}

function requestLeaveRoom() {
  const isHost = roomPlayers.some((player) => player.socketId === socket.id && player.isHost);
  if (!isHost) {
    leaveOnlineRoom();
    return;
  }

  roomDialogTitle.textContent = "タイトルに戻りますか？";
  roomDialogMessage.textContent = "本当に戻っていいですか？ルームは終了します。";
  roomDialogActions.hidden = true;
  roomConfirmActions.hidden = false;
  roomCodeLabel.hidden = true;
  roomCodeInput.hidden = true;
  roomDialogError.textContent = "";
  roomDialog.showModal();
}

function openRoomMessage(title, message) {
  roomDialogTitle.textContent = title;
  roomDialogMessage.textContent = message;
  roomDialogActions.hidden = false;
  roomConfirmActions.hidden = true;
  roomCodeLabel.hidden = true;
  roomCodeInput.hidden = true;
  roomJoinSubmit.hidden = true;
  roomDialogError.textContent = "";
  roomDialog.showModal();
}

roomCodeInput.addEventListener("input", () => {
  roomCodeInput.value = roomCodeInput.value.replace(/\D/g, "").slice(0, 4);
});

roomForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const roomCode = roomCodeInput.value;
  if (!/^\d{4}$/.test(roomCode)) {
    roomDialogError.textContent = "4桁の数字を入力してください。";
    return;
  }
  if (!socket.connected) {
    roomDialogError.textContent = "サーバーに接続できません。";
    return;
  }

  roomJoinSubmit.disabled = true;
  socket.timeout(5000).emit("joinRoom", { roomCode, playerName: game.playerName }, (error, response) => {
    roomJoinSubmit.disabled = false;
    if (error || !response) {
      roomDialogError.textContent = "サーバーとの通信に失敗しました。もう一度お試しください。";
      return;
    }
    if (!response.success) {
      roomDialogError.textContent = response.error || "ルームに参加できませんでした。";
      return;
    }
    enterOnlineRoom(response, roomCode);
  });
});

document.getElementById("room-dialog-close").addEventListener("click", () => roomDialog.close());
document.getElementById("room-confirm-cancel").addEventListener("click", () => roomDialog.close());
document.getElementById("room-confirm-leave").addEventListener("click", () => {
  roomDialog.close();
  leaveOnlineRoom();
});

socket.on("roomState", (room) => {
  if (room.roomCode === activeRoomCode) {
    roomPlayers = room.players;
    activeBattleStarted = room.started;
    if (!room.started) {
      battlePairSeed = 0;
      battleResult = null;
    }
    updateOnlineRoomView();
  }
});

socket.on("battleStarted", (room) => {
  if (room.roomCode === activeRoomCode) startOnlineBattle(room.pairSeed);
});

socket.on("opponentState", (update) => {
  if (update.roomCode === activeRoomCode && game.isBattle) {
    opponentBattleState = update;
  }
});

socket.on("battleOjamaPending", (request) => {
  if (request.roomCode === activeRoomCode && game.isBattle) {
    game.syncBattleOjama(request.count);
  }
});

socket.on("battleResult", (result) => {
  if (result.roomCode !== activeRoomCode || !game.isBattle || battleResult) return;
  battleResult = result;
  game.gameOver = true;
  game.state = "GAMEOVER";
});

socket.on("roomClosed", () => {
  if (game.state !== "ROOM" && !game.isBattle) return;
  activeRoomCode = "";
  roomPlayers = [];
  battlePairSeed = 0;
  opponentBattleState = null;
  battleResult = null;
  activeBattleStarted = false;
  game.isBattle = false;
  game.state = "TITLE";
  openRoomMessage("ルームが終了しました", "ホストが退出したため、ルームを終了しました。");
});

socket.on("disconnect", () => {
  if (game.state !== "ROOM" && !game.isBattle) return;
  activeRoomCode = "";
  roomPlayers = [];
  battlePairSeed = 0;
  opponentBattleState = null;
  battleResult = null;
  activeBattleStarted = false;
  game.isBattle = false;
  game.state = "TITLE";
  openRoomMessage("接続が切れました", "サーバーとの接続が切れたため、タイトルに戻りました。");
});

playerNameInput.addEventListener("input", () => {
  playerNameInput.value = game.limitPlayerName(playerNameInput.value);
});

playerNameForm.addEventListener("submit", (e) => {
  if (e.submitter.value !== "save") {
    if (!game.playerName) e.preventDefault();
    return;
  }
  const enteredName = game.limitPlayerName(playerNameInput.value);
  if (!enteredName) {
    if (!game.playerName) e.preventDefault();
    return;
  }
  game.playerName = enteredName;
  game.savePlayerName();
});

playerNameDialog.addEventListener("cancel", (e) => {
  if (!game.playerName) e.preventDefault();
});

if (!game.playerName) openPlayerNameDialog();

// 画面にフィットさせる
function fit() {
  const wrap = document.getElementById("wrap");
  const aw = wrap.clientWidth, ah = wrap.clientHeight;
  const scale = Math.min(aw / SCREEN_W, ah / SCREEN_H);
  canvas.style.width = Math.floor(SCREEN_W * scale) + "px";
  canvas.style.height = Math.floor(SCREEN_H * scale) + "px";
}
window.addEventListener("resize", fit);
fit();
new ResizeObserver(fit).observe(document.getElementById("wrap"));

// キーボード
const KEYMAP = { KeyA: "a", KeyD: "d", KeyS: "s", Space: "space", KeyR: "r", KeyT: "t", Escape: "escape" };
window.addEventListener("keydown", (e) => {
  const k = KEYMAP[e.code];
  if (!k) return;
  e.preventDefault();
  if (e.repeat) return;
  Sound.resume();
  game.pressKey(k);
});
window.addEventListener("keyup", (e) => {
  const k = KEYMAP[e.code];
  if (k) game.releaseKey(k);
});
window.addEventListener("blur", () => { game.keys.a = game.keys.d = game.keys.s = false; });

// スマホ(iOS)でも音が出るよう、タッチを離したときにも音声を有効化する
window.addEventListener("pointerup", () => Sound.resume());

// キャンバスのタップ/クリック(タイトル:開始 / ゲームオーバー:ボタン操作)
function toLogical(e) {
  const rect = canvas.getBoundingClientRect();
  return [
    ((e.clientX - rect.left) / rect.width) * SCREEN_W,
    ((e.clientY - rect.top) / rect.height) * SCREEN_H,
  ];
}
canvas.addEventListener("pointerdown", (e) => {
  Sound.resume();
  const [lx, ly] = toLogical(e);
  game.pointer = { x: lx, y: ly };
  game.handlePointer(lx, ly);
  if (e.pointerType !== "mouse") game.pointer = { x: -1, y: -1 };  // タッチ後にホバー表示が残らないように
});
canvas.addEventListener("pointermove", (e) => {
  const [lx, ly] = toLogical(e);
  game.pointer = { x: lx, y: ly };
});
canvas.addEventListener("pointerleave", () => {
  game.pointer = { x: -1, y: -1 };
});

// タッチ操作ボタン
document.querySelectorAll("#controls button").forEach((btn) => {
  const k = btn.dataset.key;
  const down = (e) => {
    Sound.resume();
    e.preventDefault();
    btn.classList.add("active");
    game.pressKey(k);
  };
  const up = (e) => {
    e.preventDefault();
    btn.classList.remove("active");
    game.releaseKey(k);
  };
  btn.addEventListener("pointerdown", down);
  btn.addEventListener("pointerup", up);
  btn.addEventListener("pointercancel", up);
  btn.addEventListener("pointerleave", up);
});

let last = performance.now();
let lastBattleSnapshot = 0;
function loop(now) {
  const dt = Math.min(now - last, 50); // タブ復帰時などの巨大dtを抑える
  last = now;
  game.update(dt);
  if (game.isBattle && game.state === "PLAYING" && now - lastBattleSnapshot >= 80) {
    lastBattleSnapshot = now;
    socket.emit("battleState", {
      roomCode: activeRoomCode,
      state: game.getBattleSnapshot()
    });
  }
  game.draw();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);