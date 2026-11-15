'use strict';

// AUCTION MASTERS multiplayer lobby + authoritative auction server.
// Requires Node.js 20+ and the `ws` package. Run: npm install && npm start
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const WebSocket = require('ws');

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const SAVE_FILE = path.join(ROOT, 'profiles.json');
const MAX_SEATS = 8;
const AUCTION_SECONDS = 26;
const INTERMISSION_MS = 4500;
const rooms = new Map();
const sockets = new Map();
const profiles = new Map();
let nextRoomNo = 1;

const BOT_TEMPLATES = [
  { name: 'ミスター・フォックス', icon: '🦊', style: '慎重派', aggression: .34 },
  { name: 'リリー', icon: '👩🏻‍🦰', style: '堅実派', aggression: .48 },
  { name: 'ブラックウッド', icon: '🧔🏻', style: '目利き', aggression: .57 },
  { name: 'カイ', icon: '🧑🏻‍💼', style: '積極派', aggression: .72 },
  { name: 'ミナ', icon: '👩🏻', style: '直感派', aggression: .62 },
  { name: 'ドクターK', icon: '👨🏻‍🔬', style: '研究家', aggression: .43 },
  { name: 'ルーク', icon: '🧑🏽', style: '勝負師', aggression: .82 }
];
const RARITIES = [
  { key:'N', name:'ノーマル', weight:2600, min:7000, max:30000, unlock:1 },
  { key:'C', name:'コモン', weight:1800, min:18000, max:70000, unlock:1 },
  { key:'UC', name:'アンコモン', weight:1250, min:50000, max:160000, unlock:1 },
  { key:'R', name:'レア', weight:850, min:100000, max:480000, unlock:1 },
  { key:'HR', name:'ハイレア', weight:560, min:300000, max:1200000, unlock:7 },
  { key:'RR', name:'ダブルレア', weight:360, min:800000, max:3000000, unlock:13 },
  { key:'RRR', name:'トリプルレア', weight:230, min:2000000, max:8000000, unlock:19 },
  { key:'SR', name:'スーパーレア', weight:150, min:5000000, max:20000000, unlock:25 },
  { key:'Epic', name:'エピック', weight:100, min:15000000, max:60000000, unlock:31 },
  { key:'UR', name:'ウルトラレア', weight:66, min:40000000, max:150000000, unlock:37 },
  { key:'Legendary', name:'レジェンダリー', weight:43, min:100000000, max:500000000, unlock:43 },
  { key:'UL', name:'アルティメットレア', weight:28, min:300000000, max:1200000000, unlock:49 },
  { key:'Mythic', name:'ミシック', weight:18, min:800000000, max:3000000000, unlock:55 },
  { key:'SEC', name:'シークレットレア', weight:12, min:2000000000, max:8000000000, unlock:61 },
  { key:'GDR', name:'ゴッドレア', weight:8, min:5000000000, max:25000000000, unlock:67 },
  { key:'EX', name:'エクストラ', weight:5, min:12000000000, max:50000000000, unlock:73 },
  { key:'SP', name:'スペシャル', weight:3, min:30000000000, max:100000000000, unlock:79 }
];
const OBJECTS = [
  ['懐中時計','⌚'],['陶磁器の花瓶','🏺'],['王冠','👑'],['古代硬貨','🪙'],['油彩画','🖼️'],['宝石箱','💎'],['彫刻','🗿'],['天体望遠鏡','🔭'],['航海用コンパス','🧭'],['万年筆','🖋️'],['古文書','📜'],['楽器','🎻'],['短剣','🗡️'],['化石標本','🦴'],['腕時計','⌚'],['銀食器','🍴'],['香水瓶','🧴'],['ガラス細工','🔮'],['勲章','🎖️'],['古い地図','🗺️'],['写真機','📷'],['置時計','🕰️'],['指輪','💍'],['仮面','🎭'],['ティーセット','🫖'],['タイプライター','⌨️'],['切手帳','📮'],['蓄音機','📻'],['チェスセット','♟️'],['ランプ','🪔']
];
const MATERIALS = ['純銀','純金','白金','青銅','翡翠','琥珀','黒曜石','水晶','ダイヤモンド','サファイア','ルビー','瑠璃','象牙細工','七宝','大理石','希少木材','磁器','古鉄'];
const ERAS = ['古代王朝','失われた帝国','中世王国','大航海時代','産業革命期','19世紀','20世紀初頭','戦前時代','旧王室','伝説の工房','未知の文明','幻の博覧会'];
const ORIGINS = ['北方の王都','東方の港町','南方の交易都市','西方の山岳国','砂漠の遺跡','海底神殿','王立美術館旧蔵','名門コレクター旧蔵','発掘調査隊発見','無名の工房'];
const MOTIFS = ['星辰','双頭の鷲','月桂樹','青い鳥','太陽紋','竜の紋章','波模様','王家の紋章'];
const CONDITIONS = ['極美品','美品','良品','経年変化あり','修復跡あり','希少な初期型'];

function rand(min, max) { return Math.random() * (max - min) + min; }
function randInt(min, max) { return Math.floor(rand(min, max + 1)); }
function pick(a) { return a[Math.floor(Math.random() * a.length)]; }
function levelBand(level) { return Math.floor((Math.max(1, Math.min(100, level)) - 1) / 10); }
function bandLabel(band) { const start = band * 10 + 1; return `Lv.${start}–${Math.min(100, start + 9)}`; }
function minIncrement(value) {
  if (value < 100000) return 1000;
  if (value < 1000000) return 5000;
  if (value < 10000000) return 25000;
  return Math.max(100000, Math.round(value * .01 / 1000) * 1000);
}
function minimumBid(auction) { return Math.max(auction.item.startBid, auction.currentBid + minIncrement(auction.currentBid)); }
function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function loadProfiles() {
  try {
    if (!fs.existsSync(SAVE_FILE)) return;
    const raw = JSON.parse(fs.readFileSync(SAVE_FILE, 'utf8'));
    for (const [id, p] of Object.entries(raw)) profiles.set(id, p);
  } catch (err) { console.warn('Profile data could not be loaded:', err.message); }
}
let saveTimer = null;
function saveProfiles() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const data = Object.fromEntries(profiles.entries());
    const tmp = SAVE_FILE + '.tmp';
    try { fs.writeFileSync(tmp, JSON.stringify(data, null, 2)); fs.renameSync(tmp, SAVE_FILE); }
    catch (err) { console.warn('Profile data could not be saved:', err.message); }
  }, 250);
}
function makeItem(level) {
  const available = RARITIES.filter(r => r.unlock <= level);
  const total = available.reduce((s, r) => s + r.weight, 0);
  let n = Math.random() * total;
  let rarity = available[0];
  for (const r of available) { n -= r.weight; if (n <= 0) { rarity = r; break; } }
  const obj = pick(OBJECTS), material = pick(MATERIALS), era = pick(ERAS), origin = pick(ORIGINS), motif = pick(MOTIFS), condition = pick(CONDITIONS);
  const marketValue = randInt(rarity.min, rarity.max);
  const startBid = Math.max(500, Math.round(marketValue * rand(.12, .22) / 100) * 100);
  return {
    id: 'AM-' + crypto.randomBytes(5).toString('hex').toUpperCase(),
    name: `${era}の${material}${obj[0]}「${motif}」`, emoji: obj[1], object: obj[0], material,
    era, origin, motif, condition, rarity: rarity.key, rarityName: rarity.name,
    marketValue, startBid, createdAt: Date.now()
  };
}
function createAuction(room) {
  const activeLevels = [...room.players.values()].map(p => p.level);
  const effectiveLevel = activeLevels.length ? Math.max(...activeLevels) : room.levelBand * 10 + 1;
  const item = makeItem(effectiveLevel);
  room.auction = {
    item, currentBid: item.startBid, highestBidderId: null, highestBidderName: null,
    highestBidderIsBot: false, status: 'live', endsAt: Date.now() + AUCTION_SECONDS * 1000,
    round: (room.round || 0) + 1, log: []
  };
  room.round = room.auction.round;
  room.botNextAt = Date.now() + randInt(2800, 4300);
  room.nextAuctionAt = null;
}
function botSeats(room) {
  const count = Math.max(0, MAX_SEATS - room.players.size);
  return room.bots.slice(0, count);
}
function allSeats(room) {
  const humans = [...room.players.values()].map(p => ({
    id: p.id, name: p.name, icon: '👤', level: p.level, isBot: false, cash: p.cash
  }));
  return [...humans, ...botSeats(room)].slice(0, MAX_SEATS);
}
function snapshot(room, forPlayerId) {
  const auction = room.auction;
  const publicItem = auction ? {
    id: auction.item.id, name: auction.item.name, emoji: auction.item.emoji,
    object: auction.item.object, material: auction.item.material, era: auction.item.era,
    origin: auction.item.origin, motif: auction.item.motif, condition: auction.item.condition,
    rarity: auction.item.rarity, rarityName: auction.item.rarityName, startBid: auction.item.startBid
  } : null;
  return {
    roomId: room.id, levelBand: room.levelBand, bandText: bandLabel(room.levelBand),
    players: allSeats(room).map(p => ({ ...p, isYou: p.id === forPlayerId,
      isLeading: auction?.highestBidderId === p.id })),
    auction: auction ? {
      item: publicItem, currentBid: auction.currentBid,
      highestBidderId: auction.highestBidderId, highestBidderName: auction.highestBidderName,
      highestBidderIsBot: auction.highestBidderIsBot, status: auction.status,
      endsAt: auction.endsAt, round: auction.round
    } : null
  };
}
function broadcastRoom(room) {
  for (const player of room.players.values()) {
    if (player.ws?.readyState === WebSocket.OPEN) {
      safeSend(player.ws, { type: 'room_state', snapshot: snapshot(room, player.id), you: { cash: player.cash, level: player.level } });
    }
  }
}
function roomLog(room, line) {
  room.log.unshift({ at: Date.now(), text: line });
  room.log = room.log.slice(0, 10);
}
function closeRoomIfEmpty(room) {
  if (room.players.size !== 0) return false;
  clearInterval(room.timer);
  rooms.delete(room.id);
  return true;
}
function createRoom(band, isPrivate = false) {
  const id = `AM-${String(nextRoomNo++).padStart(4, '0')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  let inviteCode = null;
  if (isPrivate) { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; inviteCode = Array.from({length:6}, () => chars[randInt(0, chars.length - 1)]).join(''); while ([...rooms.values()].some(r => r.inviteCode === inviteCode)) inviteCode = Array.from({length:6}, () => chars[randInt(0, chars.length - 1)]).join(''); }
  const factor = Math.pow(1.043, band * 10);
  const bots = BOT_TEMPLATES.map((b, i) => ({ id: `bot-${id}-${i}`, name: b.name, icon: b.icon, level: band * 10 + 1, isBot: true, isYou: false, cash: Math.round(rand(65000, 190000) * factor), aggression: b.aggression }));
  const room = { id, levelBand: band, isPrivate, inviteCode, players: new Map(), bots, round: 0, auction: null, timer: null, botNextAt: 0, nextAuctionAt: null, log: [] };
  rooms.set(id, room);
  room.timer = setInterval(() => tickRoom(room), 250);
  return room;
}
function sendJoined(player, room) {
  player.roomId = room.id;
  safeSend(player.ws, { type: 'joined', you: { cash: player.cash, level: player.level }, snapshot: snapshot(room, player.id) });
  broadcastRoom(room);
}
function joinQuick(ws, msg) {
  const id = String(msg.playerId || '').slice(0, 80);
  if (!id) return safeSend(ws, { type: 'error', message: 'プレイヤーIDがありません。' });
  const level = Math.max(1, Math.min(100, Math.floor(Number(msg.level) || 1)));
  const band = levelBand(level);
  // Remove an old socket for this identity, so one identity occupies one seat.
  const old = sockets.get(id);
  if (old && old !== ws) { try { safeSend(old, { type: 'replaced' }); old.playerId = null; old.roomId = null; old.close(); } catch {} }
  for (const room of [...rooms.values()]) {
    if (room.players.has(id)) { room.players.delete(id); if (!closeRoomIfEmpty(room)) broadcastRoom(room); }
  }
  const stored = profiles.get(id);
  const player = {
    id, name: String(msg.name || 'オークショニア').slice(0, 18), level,
    cash: stored ? Math.max(0, Math.floor(stored.cash)) : Math.max(0, Math.floor(Number(msg.cash) || 100000)),
    ws, roomId: null
  };
  profiles.set(id, { cash: player.cash, level: player.level, name: player.name });
  let room = [...rooms.values()].find(r => !r.isPrivate && r.levelBand === band && r.players.size < MAX_SEATS);
  if (!room) room = createRoom(band);
  room.players.set(id, player);
  if (!room.auction) createAuction(room);
  sockets.set(id, ws);
  ws.playerId = id;
  ws.roomId = room.id;
  sendJoined(player, room);
  saveProfiles();
}
function detachIdentity(id, ws) {
  const old = sockets.get(id);
  if (old && old !== ws) { try { safeSend(old, { type: 'replaced' }); old.playerId = null; old.roomId = null; old.close(); } catch {} }
  for (const room of [...rooms.values()]) {
    if (room.players.has(id)) { room.players.delete(id); if (!closeRoomIfEmpty(room)) broadcastRoom(room); }
  }
}
function createPrivate(ws, msg) {
  const id = String(msg.playerId || '').slice(0, 80);
  if (!id) return safeSend(ws, { type: 'error', message: 'プレイヤーIDがありません。' });
  detachIdentity(id, ws);
  const level = Math.max(1, Math.min(100, Math.floor(Number(msg.level) || 1)));
  const stored = profiles.get(id);
  const player = { id, name: String(msg.name || 'オークショニア').slice(0, 18), level,
    cash: stored ? Math.max(0, Math.floor(stored.cash)) : Math.max(0, Math.floor(Number(msg.cash) || 100000)), ws, roomId: null };
  const room = createRoom(levelBand(level), true);
  room.players.set(id, player); if (!room.auction) createAuction(room); sockets.set(id, ws); ws.playerId = id; ws.roomId = room.id;
  profiles.set(id, { cash: player.cash, level: player.level, name: player.name });
  safeSend(ws, { type: 'friend_room_created', code: room.inviteCode });
  sendJoined(player, room); saveProfiles();
}
function joinPrivate(ws, msg) {
  const id = String(msg.playerId || '').slice(0, 80);
  const code = String(msg.code || '').trim().toUpperCase().slice(0, 12);
  if (!id || !code) return safeSend(ws, { type: 'error', message: 'プレイヤーIDまたは招待コードがありません。' });
  const room = [...rooms.values()].find(r => r.isPrivate && r.inviteCode === code);
  if (!room) return safeSend(ws, { type: 'error', message: '招待コードが見つかりません。' });
  if (room.players.size >= MAX_SEATS) return safeSend(ws, { type: 'error', message: 'このルームは満員です。' });
  detachIdentity(id, ws);
  const level = Math.max(1, Math.min(100, Math.floor(Number(msg.level) || 1)));
  const stored = profiles.get(id);
  const player = { id, name: String(msg.name || 'オークショニア').slice(0, 18), level,
    cash: stored ? Math.max(0, Math.floor(stored.cash)) : Math.max(0, Math.floor(Number(msg.cash) || 100000)), ws, roomId: null };
  room.players.set(id, player); sockets.set(id, ws); ws.playerId = id; ws.roomId = room.id;
  profiles.set(id, { cash: player.cash, level: player.level, name: player.name });
  sendJoined(player, room); saveProfiles();
}

function rejectBid(player, reason) { safeSend(player.ws, { type: 'bid_rejected', reason }); }
function handleBid(player, amountRaw) {
  const room = rooms.get(player.roomId);
  if (!room || !room.auction || room.auction.status !== 'live') return rejectBid(player, '現在は入札できません。');
  const amount = Math.floor(Number(amountRaw));
  const min = minimumBid(room.auction);
  if (!Number.isSafeInteger(amount) || amount < min) return rejectBid(player, `最低入札額は ¥${min.toLocaleString('ja-JP')} です。`);
  if (amount > player.cash) return rejectBid(player, '所持金が足りません。');
  const auction = room.auction;
  auction.currentBid = amount;
  auction.highestBidderId = player.id;
  auction.highestBidderName = player.name;
  auction.highestBidderIsBot = false;
  roomLog(room, `${player.name} が ¥${amount.toLocaleString('ja-JP')} で入札`);
  room.botNextAt = Date.now() + randInt(2400, 4200);
  broadcastRoom(room);
}
function botTurn(room) {
  const auction = room.auction;
  if (!auction || auction.status !== 'live') return;
  const bots = botSeats(room);
  const candidates = bots.filter(b => b.cash >= minimumBid(auction) && b.id !== auction.highestBidderId);
  if (!candidates.length) return;
  const bot = pick(candidates);
  const ceiling = auction.item.marketValue * (1 + bot.aggression * .48);
  const interested = auction.currentBid < ceiling && Math.random() < (auction.highestBidderId && !auction.highestBidderIsBot ? .68 : .52);
  if (!interested) return;
  let offered = auction.currentBid + Math.max(minIncrement(auction.currentBid), Math.round(auction.currentBid * rand(.045, .12) / 100) * 100);
  offered = Math.min(offered, Math.floor(Math.min(ceiling, bot.cash) / 100) * 100);
  if (offered < minimumBid(auction)) return;
  auction.currentBid = offered;
  auction.highestBidderId = bot.id;
  auction.highestBidderName = bot.name;
  auction.highestBidderIsBot = true;
  roomLog(room, `${bot.name} が ¥${offered.toLocaleString('ja-JP')} で入札`);
  room.botNextAt = Date.now() + randInt(2600, 5100);
  broadcastRoom(room);
}
function settleAuction(room) {
  const auction = room.auction;
  if (!auction || auction.status !== 'live') return;
  auction.status = 'finished';
  const winnerId = auction.highestBidderId;
  const amount = winnerId ? auction.currentBid : 0;
  const winner = winnerId ? room.players.get(winnerId) : null;
  const winnerName = auction.highestBidderName || '入札なし';
  if (winner) {
    winner.cash = Math.max(0, winner.cash - amount);
    profiles.set(winner.id, { cash: winner.cash, level: winner.level, name: winner.name });
  } else if (auction.highestBidderIsBot && winnerId) {
    const winningBot = room.bots.find(b => b.id === winnerId);
    if (winningBot) winningBot.cash = Math.max(0, winningBot.cash - amount);
  }
  roomLog(room, winnerId ? `${winnerName} が落札` : '入札なし・流札');
  const item = winner ? { ...auction.item, marketValue: auction.item.marketValue, auctionPaid: amount } : null;
  for (const p of room.players.values()) {
    safeSend(p.ws, { type: 'auction_result', winnerId, winnerName, amount, item: winnerId ? { ...auction.item, auctionPaid: amount } : null,
      you: { cash: p.cash, level: p.level } });
  }
  if (winner) saveProfiles();
  broadcastRoom(room);
  room.nextAuctionAt = Date.now() + INTERMISSION_MS;
}
function tickRoom(room) {
  if (!rooms.has(room.id)) return;
  if (room.players.size === 0) { closeRoomIfEmpty(room); return; }
  const now = Date.now();
  if (room.auction?.status === 'live') {
    if (now >= room.botNextAt) { botTurn(room); room.botNextAt = now + randInt(2600, 4400); }
    if (now >= room.auction.endsAt) settleAuction(room);
  } else if (room.nextAuctionAt && now >= room.nextAuctionAt) {
    createAuction(room);
    broadcastRoom(room);
  }
}
function leaveRoom(ws) {
  const id = ws.playerId;
  if (!id) return;
  const room = rooms.get(ws.roomId);
  if (room) {
    room.players.delete(id);
    if (!closeRoomIfEmpty(room)) broadcastRoom(room);
  }
  if (sockets.get(id) === ws) sockets.delete(id);
  ws.playerId = null;
  ws.roomId = null;
}

loadProfiles();
const server = http.createServer((req, res) => {
  const pathname = new URL(req.url, `http://${req.headers.host || 'localhost'}`).pathname;
  if (pathname === '/' || pathname === '/auction_masters.html') {
    const file = path.join(ROOT, 'auction_masters.html');
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Game file is missing.'); return; }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(data);
    });
    return;
  }
  if (pathname === '/health') { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ ok: true, rooms: rooms.size, players: sockets.size })); return; }
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('Not found');
});
const wss = new WebSocket.Server({ server, maxPayload: 16 * 1024 });
wss.on('connection', ws => {
  ws.isAlive = true;
  ws.on('pong', () => { ws.isAlive = true; });
  ws.on('message', raw => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { safeSend(ws, { type: 'error', message: '不正なデータです。' }); return; }
    if (!msg || typeof msg.type !== 'string') return;
    if (msg.type === 'join_quick') { joinQuick(ws, msg); return; }
    if (msg.type === 'create_private') { createPrivate(ws, msg); return; }
    if (msg.type === 'join_private') { joinPrivate(ws, msg); return; }
    if (msg.type === 'bid') {
      const player = ws.playerId ? rooms.get(ws.roomId)?.players.get(ws.playerId) : null;
      if (player) handleBid(player, msg.amount);
      return;
    }
    if (msg.type === 'leave') { leaveRoom(ws); safeSend(ws, { type: 'room_closed' }); return; }
    if (msg.type === 'profile_update' && ws.playerId) {
      const p = rooms.get(ws.roomId)?.players.get(ws.playerId);
      if (p) { p.level = Math.max(1, Math.min(100, Math.floor(Number(msg.level) || p.level))); const suppliedCash = Number(msg.cash); if (Number.isFinite(suppliedCash) && suppliedCash >= 0) p.cash = Math.floor(suppliedCash); profiles.set(p.id, { cash: p.cash, level: p.level, name: p.name }); saveProfiles(); broadcastRoom(rooms.get(ws.roomId)); }
    }
  });
  ws.on('close', () => leaveRoom(ws));
  ws.on('error', () => leaveRoom(ws));
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
server.listen(PORT, HOST, () => console.log(`AUCTION MASTERS server listening on http://${HOST}:${PORT}`));
server.on('close', () => { clearInterval(heartbeat); for (const room of rooms.values()) clearInterval(room.timer); });
