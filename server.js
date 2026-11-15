'use strict';

// AUCTION MASTERS multiplayer lobby + authoritative auction server.
// Requires Node.js 20+ and the `ws` package. Run: npm install && npm start
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const WebSocket = require('ws');
const { Pool } = require('pg');
const { promisify } = require('node:util');
const scryptAsync = promisify(crypto.scrypt);

const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const ROOT = __dirname;
const SESSION_DAYS = 30;
const pool = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.PGSSLMODE === 'disable' ? false : { rejectUnauthorized: false }, max: 5 }) : null;
let databaseReady = false;
const MAX_SEATS = 8;
const AUCTION_SECONDS = 26;
const INTERMISSION_MS = 4500;
const rooms = new Map();
const sockets = new Map();
const profiles = new Map();
let nextRoomNo = 1;
const APPRAISERS = [
 {level:1,cost:200000,accuracy:55.0,title:'見習い鑑定士'}, {level:2,cost:500000,accuracy:62.0,title:'初級鑑定士'},
 {level:3,cost:1200000,accuracy:68.0,title:'中級鑑定士'}, {level:4,cost:3000000,accuracy:74.0,title:'上級鑑定士'},
 {level:5,cost:7500000,accuracy:80.0,title:'一流鑑定士'}, {level:6,cost:20000000,accuracy:85.0,title:'熟練鑑定士'},
 {level:7,cost:50000000,accuracy:89.0,title:'名門鑑定士'}, {level:8,cost:120000000,accuracy:93.0,title:'伝説級鑑定士'},
 {level:9,cost:300000000,accuracy:97.0,title:'世界的鑑定士'}, {level:10,cost:1000000000,accuracy:99.5,title:'至高の鑑定士'}
];

const BOT_TEMPLATES = [
 {name:'ミスター・フォックス',icon:'🦊',style:'慎重派',strategy:'cautious',aggression:.30,patience:.82,riskTolerance:.35,appraisalSkill:.82,budgetRatio:.58},
 {name:'リリー',icon:'👩🏻‍🦰',style:'収集家',strategy:'collector',aggression:.56,patience:.58,riskTolerance:.72,appraisalSkill:.52,budgetRatio:.82},
 {name:'ブラックウッド',icon:'🧔🏻',style:'投資家',strategy:'investor',aggression:.48,patience:.72,riskTolerance:.55,appraisalSkill:.92,budgetRatio:.76},
 {name:'カイ',icon:'🧑🏻‍💼',style:'威圧派',strategy:'intimidator',aggression:.82,patience:.35,riskTolerance:.88,appraisalSkill:.38,budgetRatio:.94},
 {name:'ミナ',icon:'👩🏻',style:'収集家',strategy:'collector',aggression:.66,patience:.48,riskTolerance:.78,appraisalSkill:.42,budgetRatio:.88},
 {name:'ドクターK',icon:'👨🏻‍🔬',style:'研究家',strategy:'investor',aggression:.42,patience:.88,riskTolerance:.48,appraisalSkill:.98,budgetRatio:.68},
 {name:'ルーク',icon:'🧑🏽',style:'終盤勝負',strategy:'sniper',aggression:.90,patience:.96,riskTolerance:.92,appraisalSkill:.35,budgetRatio:.98}
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
function marketTrendFor(material){const trends=[{factor:1.14,label:'人気上昇'},{factor:1.07,label:'やや上昇'},{factor:.94,label:'やや下落'},{factor:.86,label:'人気低下'}],week=Math.floor(Date.now()/604800000),hash=[...String(material||'')].reduce((s,c)=>s+c.charCodeAt(0),0);return trends[(week+hash)%trends.length]}
const APPRAISER_FAKE_DETECTION=[35,42,50,58,65,73,80,87,93,97];
function publicItemRecord(item){if(!item||typeof item!=='object')return item;const copy={...item};delete copy.authenticityCode;delete copy.fakeValueFactor;delete copy.referenceMarketValue;return copy}
function publicAccountState(account){const state=accountState(account);state.inventory=state.inventory.map(publicItemRecord);state.collection=state.collection.map(publicItemRecord);state.auctionHistory=state.auctionHistory.map(publicItemRecord);return state}
function safeSend(ws, data) {
  if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}
function defaultStats(){return {wins:0,auctions:0,sales:0,profit:0,appraisals:0,loansBorrowed:0,loanTotalBorrowed:0,loansRepaid:0,debtFreeCount:0,loanBalance:0,loanPrincipal:0}}
function accountState(a){
 return {cash:Number(a.cash)||0,level:Number(a.level)||1,xp:Number(a.xp)||0,
 inventory:Array.isArray(a.inventory)?a.inventory:[],collection:Array.isArray(a.collection)?a.collection:[],
 auctionHistory:Array.isArray(a.auctionHistory)?a.auctionHistory:[],appraiserLevel:Number(a.appraiserLevel)||0,
 stats:{...defaultStats(),...(a.stats||{})},seen:Array.isArray(a.seen)?a.seen:[]};
}
function accountFromRow(r){
 if(!r)return null;
 return {id:r.id,username:r.username,usernameKey:r.username_key,displayName:r.display_name||r.username,
 passwordSalt:r.password_salt,passwordHash:r.password_hash,...accountState({cash:r.cash,level:r.level,xp:r.xp,
 inventory:r.inventory,collection:r.collection,auctionHistory:r.auction_history,appraiserLevel:r.appraiser_level,
 stats:r.stats,seen:r.seen}),createdAt:r.created_at};
}
function publicAccount(a){return {id:a.id,username:a.username,displayName:a.displayName||a.username,
 cash:Number(a.cash)||0,level:Number(a.level)||1,createdAt:a.createdAt||null,
 stats:{...defaultStats(),...(a.stats||{})}}}
async function initializeDatabase(){
 if(!pool)return;
 await pool.query("CREATE TABLE IF NOT EXISTS am_accounts(id TEXT PRIMARY KEY,username TEXT NOT NULL,username_key TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,cash BIGINT NOT NULL DEFAULT 100000,level INTEGER NOT NULL DEFAULT 1,xp INTEGER NOT NULL DEFAULT 0,inventory JSONB NOT NULL DEFAULT '[]'::jsonb,collection JSONB NOT NULL DEFAULT '[]'::jsonb,auction_history JSONB NOT NULL DEFAULT '[]'::jsonb,stats JSONB NOT NULL DEFAULT '{\"wins\":0,\"auctions\":0,\"sales\":0,\"profit\":0}'::jsonb,appraiser_level INTEGER NOT NULL DEFAULT 0,seen JSONB NOT NULL DEFAULT '[]'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await pool.query("CREATE TABLE IF NOT EXISTS am_sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES am_accounts(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await pool.query("CREATE INDEX IF NOT EXISTS am_sessions_account_idx ON am_sessions(account_id)");
 await pool.query("CREATE INDEX IF NOT EXISTS am_accounts_cash_rank_idx ON am_accounts(cash DESC,created_at ASC)");
 await pool.query("CREATE TABLE IF NOT EXISTS am_trade_offers(id TEXT PRIMARY KEY,seller_id TEXT NOT NULL REFERENCES am_accounts(id) ON DELETE CASCADE,buyer_id TEXT NOT NULL REFERENCES am_accounts(id) ON DELETE CASCADE,item_id TEXT NOT NULL,item_json JSONB NOT NULL,offer_amount BIGINT NOT NULL CHECK(offer_amount>0),status TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),responded_at TIMESTAMPTZ)");
 await pool.query("CREATE INDEX IF NOT EXISTS am_trade_seller_status_idx ON am_trade_offers(seller_id,status,created_at DESC)");
 await pool.query("CREATE INDEX IF NOT EXISTS am_trade_buyer_idx ON am_trade_offers(buyer_id,created_at DESC)");
 databaseReady=true;console.log("AUCTION MASTERS PostgreSQL database ready");
}
async function getAccountById(id){
 if(!databaseReady)return null;
 const q=await pool.query("SELECT * FROM am_accounts WHERE id=$1",[id]);const a=accountFromRow(q.rows[0]);if(a)profiles.set(a.id,a);return a;
}
async function persistAccount(a){
 if(!databaseReady||!a)return;
 const s=accountState(a);
 await pool.query("UPDATE am_accounts SET display_name=$2,cash=$3::bigint,level=$4,xp=$5,inventory=$6::jsonb,collection=$7::jsonb,auction_history=$8::jsonb,stats=$9::jsonb,appraiser_level=$10,seen=$11::jsonb,updated_at=NOW() WHERE id=$1",
 [a.id,a.displayName||a.username,String(Math.max(0,Math.floor(s.cash))),Math.max(1,Math.min(100,Math.floor(s.level))),Math.max(0,Math.floor(s.xp)),
 JSON.stringify(s.inventory),JSON.stringify(s.collection),JSON.stringify(s.auctionHistory),JSON.stringify(s.stats),Math.max(0,Math.min(10,Math.floor(s.appraiserLevel))),JSON.stringify(s.seen)]);
 profiles.set(a.id,a);
}
async function loadProfiles(){
 if(!databaseReady)return;const q=await pool.query("SELECT * FROM am_accounts");
 for(const r of q.rows){const a=accountFromRow(r);profiles.set(a.id,a)}
}
function syncOnlineAccount(account){
 profiles.set(account.id,account);
 for(const room of rooms.values()){
  const player=room.players.get(account.id);
  if(player){player.account=account;player.cash=Number(account.cash)||0;player.level=Number(account.level)||1;player.name=account.displayName||account.username;broadcastRoom(room)}
 }
}
function xpNeeded(level){
 const n=Math.max(0,Math.min(99,Number(level||1)-1));
 return Math.floor(100+35*n+12*Math.pow(n,1.6));
}
function addAccountXp(a,amount){
 const s=accountState(a),gained=Math.max(0,Math.floor(Number(amount)||0));
 if(s.level>=100){s.level=100;s.xp+=gained;Object.assign(a,s);return gained}
 s.xp+=gained;
 while(s.level<100&&s.xp>=xpNeeded(s.level)){s.xp-=xpNeeded(s.level);s.level++}
 
 Object.assign(a,s);return gained;
}
function achievementProgressForAccount(a){
 const seen=Array.isArray(a.seen)?a.seen:[];
 const catalogKeys=new Set();
 seen.forEach(value=>{const marker=String(value||'');if(marker.startsWith('catalog:'))catalogKeys.add(marker.slice(8))});
 [...(a.auctionHistory||[]),...(a.inventory||[]),...(a.collection||[])].forEach(item=>{
  if(item?.object&&RARITIES.some(r=>r.key===item.rarity))catalogKeys.add(encodeURIComponent(String(item.object))+'|'+String(item.rarity));
 });
 const objects=new Set(),rarityIndices=[];
 catalogKeys.forEach(key=>{
  const parts=String(key).split('|'),rarity=parts.pop(),index=RARITIES.findIndex(r=>r.key===rarity);
  if(index>=0)rarityIndices.push(index);
  try{objects.add(decodeURIComponent(parts.join('|')))}catch{}
 });
 const hasRarityAtLeast=key=>{const required=RARITIES.findIndex(r=>r.key===key);return rarityIndices.some(i=>i>=required)};
 const stats={...defaultStats(),...(a.stats||{})},wins=Number(stats.wins)||0,sales=Number(stats.sales)||0;
 const profit=Math.max(0,Number(stats.profit)||0),appraisals=Number(stats.appraisals)||0,level=Number(a.level)||1;
 return [
  {id:'first-win',value:wins,target:1,xp:60},{id:'wins-10',value:wins,target:10,xp:120},
  {id:'wins-50',value:wins,target:50,xp:300},{id:'wins-100',value:wins,target:100,xp:650},
  {id:'first-sale',value:sales,target:1,xp:50},{id:'sales-10',value:sales,target:10,xp:150},
  {id:'profit-million',value:profit,target:1000000,xp:300},
  {id:'first-appraisal',value:appraisals,target:1,xp:50},{id:'appraisal-10',value:appraisals,target:10,xp:150},
  {id:'level-10',value:level,target:10,xp:200},{id:'level-25',value:level,target:25,xp:500},
  {id:'level-50',value:level,target:50,xp:1200},{id:'level-100',value:level,target:100,xp:4000},
  {id:'epic-hunter',value:hasRarityAtLeast('Epic')?1:0,target:1,xp:120},
  {id:'mythic-hunter',value:hasRarityAtLeast('Mythic')?1:0,target:1,xp:350},
  {id:'all-objects',value:objects.size,target:OBJECTS.length,xp:250},
  {id:'index-50',value:catalogKeys.size,target:50,xp:150},{id:'index-100',value:catalogKeys.size,target:100,xp:300},
  {id:'index-250',value:catalogKeys.size,target:250,xp:800},
  {id:'complete-index',value:catalogKeys.size,target:OBJECTS.length*RARITIES.length,xp:5000},
  {id:'wins-250',value:wins,target:250,xp:1500},{id:'wins-500',value:wins,target:500,xp:3500},
  {id:'sales-50',value:sales,target:50,xp:500},{id:'sales-100',value:sales,target:100,xp:1200},
  {id:'appraisal-50',value:appraisals,target:50,xp:500},{id:'appraisal-100',value:appraisals,target:100,xp:1200},
  {id:'wealth-1m',value:Number(a.cash)||0,target:1000000,xp:250},{id:'wealth-10m',value:Number(a.cash)||0,target:10000000,xp:1000},
  {id:'wealth-100m',value:Number(a.cash)||0,target:100000000,xp:3000},
  {id:'borrow-first',value:Number(stats.loansBorrowed)||0,target:1,xp:80},
  {id:'borrow-million',value:Number(stats.loanTotalBorrowed)||0,target:1000000,xp:300},
  {id:'repay-first',value:Number(stats.loansRepaid)||0,target:1,xp:100},
  {id:'repay-5',value:Number(stats.loansRepaid)||0,target:5,xp:350},
  {id:'debt-free',value:Number(stats.debtFreeCount)||0,target:1,xp:500},
  {id:'debt-free-3',value:Number(stats.debtFreeCount)||0,target:3,xp:1500}
 ];
}
function unlockAccountAchievements(a){
 if(!Array.isArray(a.seen))a.seen=[];
 const unlocked=[];
 for(let pass=0;pass<25;pass++){
  const available=achievementProgressForAccount(a).filter(entry=>entry.value>=entry.target&&!a.seen.includes('achievement:'+entry.id));
  if(!available.length)break;
  for(const entry of available){a.seen.push('achievement:'+entry.id);addAccountXp(a,entry.xp);unlocked.push({...entry})}
 }
 return unlocked;
}
function parseCookies(header){const out={};for(const p of String(header||"").split(";")){const i=p.indexOf("=");if(i<0)continue;const k=p.slice(0,i).trim(),v=p.slice(i+1).trim();try{out[k]=decodeURIComponent(v)}catch{out[k]=v}}return out}
function tokenHash(token){return crypto.createHash("sha256").update(token).digest("hex")}
async function accountForCookie(header){
 if(!databaseReady)return null;const token=parseCookies(header).am_session;if(!token)return null;
 const q=await pool.query("SELECT a.* FROM am_sessions s JOIN am_accounts a ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>NOW()",[tokenHash(token)]);
 const a=accountFromRow(q.rows[0]);if(a)profiles.set(a.id,a);return a;
}
function setSessionCookie(req,res,token){
 const secure=req.headers["x-forwarded-proto"]==="https"||process.env.NODE_ENV==="production";
 res.setHeader("Set-Cookie","am_session="+encodeURIComponent(token)+"; Path=/; HttpOnly; SameSite=Lax; Max-Age="+(SESSION_DAYS*86400)+(secure?"; Secure":""));
}
function clearSessionCookie(req,res){
 const secure=req.headers["x-forwarded-proto"]==="https"||process.env.NODE_ENV==="production";
 res.setHeader("Set-Cookie","am_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0"+(secure?"; Secure":""));
}
function sendJson(res,status,data){const body=JSON.stringify(data);res.writeHead(status,{"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","Content-Length":Buffer.byteLength(body)});res.end(body)}
async function readJson(req,maxBytes=32768){let raw="";for await(const chunk of req){raw+=chunk;if(Buffer.byteLength(raw)>maxBytes)throw Object.assign(new Error("送信データが大きすぎます。"),{status:413})}if(!raw)return {};try{return JSON.parse(raw)}catch{throw Object.assign(new Error("JSON形式が正しくありません。"),{status:400})}}
function cleanText(v,max=18){return String(v??"").trim().replace(/[<>]/g,"").slice(0,max)}
function rowToAccountState(a){return {account:publicAccount(a),state:publicAccountState(a)}}
function findItem(a,id,place){const key=place==="collection"?"collection":"inventory",arr=a[key],index=arr.findIndex(x=>String(x.id)===id);return {key,arr,index,item:index>=0?arr[index]:null}}
async function apiHandler(req,res,url){
 const path=url.pathname;if(!path.startsWith("/api/"))return false;
 if(!databaseReady){sendJson(res,503,{error:"アカウント用データベースが未接続です。管理者がRenderのDATABASE_URLを設定してください。"});return true}
 try{
  if(req.method==="POST"&&path==="/api/auth/register"){
   const b=await readJson(req),username=cleanText(b.username,18),key=username.normalize("NFKC").toLocaleLowerCase("ja-JP"),password=String(b.password||"");
   if(!/^[\p{L}\p{N}_-]{3,18}$/u.test(username)){sendJson(res,400,{error:"ユーザー名は3〜18文字の日本語・英数字・_・-で入力してください。"});return true}
   if(password.length<8||Buffer.byteLength(password)>128){sendJson(res,400,{error:"パスワードは8文字以上、128バイト以内にしてください。"});return true}
   const salt=crypto.randomBytes(16).toString("hex"),hash=(await scryptAsync(password,salt,64)).toString("hex"),id=crypto.randomUUID(),stats=defaultStats();
   try{await pool.query("INSERT INTO am_accounts(id,username,username_key,display_name,password_salt,password_hash,cash,level,xp,inventory,collection,auction_history,stats,appraiser_level,seen) VALUES($1,$2,$3,$4,$5,$6,100000,1,0,'[]'::jsonb,'[]'::jsonb,'[]'::jsonb,$7::jsonb,0,'[]'::jsonb)",[id,username,key,username,salt,hash,JSON.stringify(stats)])}
   catch(err){if(err.code==="23505"){sendJson(res,409,{error:"このユーザー名はすでに使われています。"});return true}throw err}
   const a={id,username,usernameKey:key,displayName:username,passwordSalt:salt,passwordHash:hash,cash:100000,level:1,xp:0,inventory:[],collection:[],auctionHistory:[],stats,appraiserLevel:0,seen:[],createdAt:new Date()};
   profiles.set(id,a);const token=crypto.randomBytes(32).toString("base64url");
   await pool.query("INSERT INTO am_sessions(token_hash,account_id,expires_at) VALUES($1,$2,$3)",[tokenHash(token),id,new Date(Date.now()+SESSION_DAYS*86400000)]);
   setSessionCookie(req,res,token);sendJson(res,201,rowToAccountState(a));return true;
  }
  if(req.method==="POST"&&path==="/api/auth/login"){
   const b=await readJson(req),key=cleanText(b.username,18).normalize("NFKC").toLocaleLowerCase("ja-JP"),password=String(b.password||"");
   const q=await pool.query("SELECT * FROM am_accounts WHERE username_key=$1",[key]),a=accountFromRow(q.rows[0]);
   if(!a||!password){sendJson(res,401,{error:"ユーザー名またはパスワードが違います。"});return true}
   const derived=await scryptAsync(password,a.passwordSalt,64),stored=Buffer.from(a.passwordHash,"hex");
   if(derived.length!==stored.length||!crypto.timingSafeEqual(derived,stored)){sendJson(res,401,{error:"ユーザー名またはパスワードが違います。"});return true}
   unlockAccountAchievements(a);await persistAccount(a);
   profiles.set(a.id,a);const token=crypto.randomBytes(32).toString("base64url");
   await pool.query("INSERT INTO am_sessions(token_hash,account_id,expires_at) VALUES($1,$2,$3)",[tokenHash(token),a.id,new Date(Date.now()+SESSION_DAYS*86400000)]);
   setSessionCookie(req,res,token);sendJson(res,200,rowToAccountState(a));return true;
  }
  if(req.method==="POST"&&path==="/api/auth/logout"){
   const token=parseCookies(req.headers.cookie).am_session;if(token)await pool.query("DELETE FROM am_sessions WHERE token_hash=$1",[tokenHash(token)]);
   clearSessionCookie(req,res);sendJson(res,200,{ok:true});return true;
  }
  if(req.method==="GET"&&path==="/api/auth/me"){
   const a=await accountForCookie(req.headers.cookie);if(!a){sendJson(res,401,{error:"ログインしていません。"});return true}
   unlockAccountAchievements(a);await persistAccount(a);
    sendJson(res,200,rowToAccountState(a));return true;
  }
  if(req.method==="GET"&&path==="/api/leaderboard"){
   const q=await pool.query("SELECT id,username,display_name,cash,level,created_at FROM am_accounts ORDER BY cash DESC,created_at ASC,username_key ASC");
   const entries=q.rows.map((r,i)=>({rank:i+1,id:r.id,username:r.username,displayName:r.display_name||r.username,cash:Number(r.cash)||0,level:Number(r.level)||1,createdAt:r.created_at}));
   sendJson(res,200,{total:entries.length,entries});return true;
  }
  const publicPlayer=path.match(/^\/api\/players\/([a-f0-9-]{20,50})$/i);
  if(req.method==="GET"&&publicPlayer){
   const q=await pool.query("SELECT * FROM am_accounts WHERE id=$1",[publicPlayer[1]]),a=accountFromRow(q.rows[0]);
   if(!a){sendJson(res,404,{error:"プレイヤーが見つかりません。"});return true}
   sendJson(res,200,{profile:publicAccount(a),collection:[...a.inventory,...a.collection].map(publicItemRecord),auctionHistory:a.auctionHistory.map(publicItemRecord),stats:a.stats});return true;
  }
  const account=await accountForCookie(req.headers.cookie);if(!account){sendJson(res,401,{error:"ログインが必要です。"});return true}

  if(req.method==="GET"&&path==="/api/trades"){
   const q=await pool.query("SELECT t.*,s.username AS seller_username,s.display_name AS seller_display_name,b.username AS buyer_username,b.display_name AS buyer_display_name FROM am_trade_offers t JOIN am_accounts s ON s.id=t.seller_id JOIN am_accounts b ON b.id=t.buyer_id WHERE t.seller_id=$1 OR t.buyer_id=$1 ORDER BY t.created_at DESC LIMIT 100",[account.id]);
   sendJson(res,200,{offers:q.rows.map(r=>({id:r.id,sellerId:r.seller_id,buyerId:r.buyer_id,itemId:r.item_id,item:r.item_json,offerAmount:Number(r.offer_amount)||0,status:r.status,createdAt:r.created_at,respondedAt:r.responded_at,sellerName:r.seller_display_name||r.seller_username,buyerName:r.buyer_display_name||r.buyer_username,incoming:r.seller_id===account.id}))});return true;
  }
  if(req.method==="POST"&&path==="/api/trades"){
   const b=await readJson(req),sellerId=String(b.sellerId||""),itemId=String(b.itemId||""),offerAmount=Math.floor(Number(b.offerAmount));
   if(!sellerId||sellerId===account.id){sendJson(res,400,{error:"自分の商品には買取交渉を送れません。"});return true}
   if(!itemId||!Number.isSafeInteger(offerAmount)||offerAmount<=0){sendJson(res,400,{error:"商品または買取希望額が正しくありません。"});return true}
   if(Number(account.cash)<offerAmount){sendJson(res,400,{error:"提示額に対して所持金が足りません。"});return true}
   const sellerQ=await pool.query("SELECT id,inventory,collection FROM am_accounts WHERE id=$1",[sellerId]),seller=sellerQ.rows[0];
   if(!seller){sendJson(res,404,{error:"相手プレイヤーが見つかりません。"});return true}
   const owned=[...(Array.isArray(seller.inventory)?seller.inventory:[]),...(Array.isArray(seller.collection)?seller.collection:[])].find(x=>String(x.id)===itemId);
   if(!owned){sendJson(res,404,{error:"相手はその商品を現在保有していません。"});return true}
   const pending=await pool.query("SELECT id FROM am_trade_offers WHERE seller_id=$1 AND buyer_id=$2 AND item_id=$3 AND status='pending' LIMIT 1",[sellerId,account.id,itemId]);
   if(pending.rowCount){sendJson(res,409,{error:"この商品にはすでに交渉を送っています。"});return true}
   const id=crypto.randomUUID();
   await pool.query("INSERT INTO am_trade_offers(id,seller_id,buyer_id,item_id,item_json,offer_amount) VALUES($1,$2,$3,$4,$5::jsonb,$6)",[id,sellerId,account.id,itemId,JSON.stringify(owned),String(offerAmount)]);
   sendJson(res,201,{ok:true,id,message:"買取交渉を送信しました。"});return true;
  }
  const tradeRespond=path.match(/^\/api\/trades\/([a-f0-9-]{20,50})\/respond$/i);
  if(req.method==="POST"&&tradeRespond){
   const b=await readJson(req),decision=String(b.decision||"");
   if(!["accept","reject"].includes(decision)){sendJson(res,400,{error:"承諾または拒否を選択してください。"});return true}
   const client=await pool.connect();
   try{
    await client.query("BEGIN");
    const offerQ=await client.query("SELECT * FROM am_trade_offers WHERE id=$1 FOR UPDATE",[tradeRespond[1]]),offer=offerQ.rows[0];
    if(!offer){await client.query("ROLLBACK");sendJson(res,404,{error:"交渉が見つかりません。"});return true}
    if(offer.seller_id!==account.id){await client.query("ROLLBACK");sendJson(res,403,{error:"この交渉に回答する権限がありません。"});return true}
    if(offer.status!=="pending"){await client.query("ROLLBACK");sendJson(res,409,{error:"この交渉にはすでに回答済みです。"});return true}
    if(decision==="reject"){
     await client.query("UPDATE am_trade_offers SET status='rejected',responded_at=NOW() WHERE id=$1",[offer.id]);
     await client.query("COMMIT");sendJson(res,200,{ok:true,message:"買取交渉を断りました。"});return true;
    }
    const accountsQ=await client.query("SELECT * FROM am_accounts WHERE id=ANY($1::text[]) ORDER BY id FOR UPDATE",[[offer.seller_id,offer.buyer_id]]);
    const sellerRow=accountsQ.rows.find(r=>r.id===offer.seller_id),buyerRow=accountsQ.rows.find(r=>r.id===offer.buyer_id);
    if(!sellerRow||!buyerRow){await client.query("ROLLBACK");sendJson(res,404,{error:"取引相手のアカウントが見つかりません。"});return true}
    const amount=Number(offer.offer_amount),buyerCash=Number(buyerRow.cash)||0;
    if(buyerCash<amount){await client.query("ROLLBACK");sendJson(res,400,{error:"購入希望者の所持金が不足しています。交渉は保留のままです。"});return true}
    const sellerInventory=Array.isArray(sellerRow.inventory)?sellerRow.inventory:[],sellerCollection=Array.isArray(sellerRow.collection)?sellerRow.collection:[];
    let itemIndex=sellerInventory.findIndex(x=>String(x.id)===offer.item_id),item=null;
    if(itemIndex>=0)item=sellerInventory.splice(itemIndex,1)[0];
    else{itemIndex=sellerCollection.findIndex(x=>String(x.id)===offer.item_id);if(itemIndex>=0)item=sellerCollection.splice(itemIndex,1)[0]}
    if(!item){await client.query("ROLLBACK");sendJson(res,409,{error:"商品はすでに売却・移動されているため、取引できません。"});return true}
    const buyerInventory=Array.isArray(buyerRow.inventory)?buyerRow.inventory:[],buyerCollection=Array.isArray(buyerRow.collection)?buyerRow.collection:[];
     const buyerSeen=Array.isArray(buyerRow.seen)?buyerRow.seen:[];
     const catalogMark=item.object&&item.rarity?'catalog:'+encodeURIComponent(String(item.object))+'|'+String(item.rarity):null;
     if(catalogMark&&!buyerSeen.includes(catalogMark))buyerSeen.push(catalogMark);
    buyerInventory.unshift({...item,tradeBoughtAt:Date.now(),tradePaid:amount});
    const sellerStats={...defaultStats(),...(sellerRow.stats||{})},profit=amount-(Number(item.auctionPaid)||0);
    sellerStats.sales=(Number(sellerStats.sales)||0)+1;sellerStats.profit=(Number(sellerStats.profit)||0)+profit;
    const history=Array.isArray(sellerRow.auction_history)?sellerRow.auction_history:[];
    const historyItem=history.find(x=>String(x.id)===offer.item_id);if(historyItem){historyItem.saleAmount=amount;historyItem.soldAt=Date.now()}
    await client.query("UPDATE am_accounts SET cash=$2::bigint,inventory=$3::jsonb,collection=$4::jsonb,stats=$5::jsonb,auction_history=$6::jsonb,updated_at=NOW() WHERE id=$1",[sellerRow.id,String((Number(sellerRow.cash)||0)+amount),JSON.stringify(sellerInventory),JSON.stringify(sellerCollection),JSON.stringify(sellerStats),JSON.stringify(history)]);
    await client.query("UPDATE am_accounts SET cash=$2::bigint,inventory=$3::jsonb,collection=$4::jsonb,seen=$5::jsonb,updated_at=NOW() WHERE id=$1",[buyerRow.id,String(buyerCash-amount),JSON.stringify(buyerInventory),JSON.stringify(buyerCollection),JSON.stringify(buyerSeen)]);
    await client.query("UPDATE am_trade_offers SET status='accepted',responded_at=NOW() WHERE id=$1",[offer.id]);
    await client.query("COMMIT");
    const sellerAccount=await getAccountById(sellerRow.id),buyerAccount=await getAccountById(buyerRow.id);
    if(sellerAccount){unlockAccountAchievements(sellerAccount);await persistAccount(sellerAccount);syncOnlineAccount(sellerAccount)}
     if(buyerAccount){unlockAccountAchievements(buyerAccount);await persistAccount(buyerAccount);syncOnlineAccount(buyerAccount)}
    sendJson(res,200,{ok:true,message:"取引が成立しました。商品と代金を移動しました。"});return true;
   }catch(err){try{await client.query("ROLLBACK")}catch{}throw err}
   finally{client.release()}
  }
  if(req.method==="POST"&&path==="/api/profile/name"){
   const b=await readJson(req),name=cleanText(b.displayName,18);if(name.length<2){sendJson(res,400,{error:"表示名は2文字以上で入力してください。"});return true}
   account.displayName=name;await persistAccount(account);syncOnlineAccount(account);
   sendJson(res,200,rowToAccountState(account));return true;
  }

  if(req.method==="POST"&&path==="/api/loan/borrow"){
   const b=await readJson(req),amount=Math.floor(Number(b.amount)||0),level=Math.max(1,Math.min(100,Number(account.level)||1));
   const cap=Math.min(2500000,100000+(level-1)*25000),stats={...defaultStats(),...(account.stats||{})};
   if(Number(stats.loanBalance)>0){sendJson(res,409,{error:"現在の借金を完済してから、次の融資を申し込んでください。"});return true}
   if(!Number.isSafeInteger(amount)||amount<10000||amount>cap){sendJson(res,400,{error:"借入額は10,000円以上、上限"+cap.toLocaleString("ja-JP")+"円以下で指定してください。"});return true}
   const totalDue=Math.ceil(amount*1.15);
   account.cash=(Number(account.cash)||0)+amount;
   stats.loansBorrowed=(Number(stats.loansBorrowed)||0)+1;stats.loanTotalBorrowed=(Number(stats.loanTotalBorrowed)||0)+amount;
   stats.loanBalance=totalDue;stats.loanPrincipal=amount;account.stats=stats;
   unlockAccountAchievements(account);await persistAccount(account);syncOnlineAccount(account);
   sendJson(res,200,{...rowToAccountState(account),message:"融資 "+amount.toLocaleString("ja-JP")+"円を受け取りました。返済総額は"+totalDue.toLocaleString("ja-JP")+"円です。"});return true;
  }
  if(req.method==="POST"&&path==="/api/loan/repay"){
   const b=await readJson(req),amount=Math.floor(Number(b.amount)||0),stats={...defaultStats(),...(account.stats||{})};
   const balance=Math.max(0,Number(stats.loanBalance)||0);
   if(balance<=0){sendJson(res,409,{error:"返済する借金はありません。"});return true}
   if(!Number.isSafeInteger(amount)||amount<=0){sendJson(res,400,{error:"返済額を正しく入力してください。"});return true}
   if(amount>Number(account.cash)){sendJson(res,400,{error:"所持金が足りません。"});return true}
   if(amount>balance){sendJson(res,400,{error:"返済額が借金残高を超えています。"});return true}
   account.cash-=amount;stats.loanBalance=balance-amount;stats.loansRepaid=(Number(stats.loansRepaid)||0)+1;
   if(stats.loanBalance===0){stats.loanPrincipal=0;stats.debtFreeCount=(Number(stats.debtFreeCount)||0)+1}
   account.stats=stats;unlockAccountAchievements(account);await persistAccount(account);syncOnlineAccount(account);
   sendJson(res,200,{...rowToAccountState(account),message:stats.loanBalance===0?"借金を完済しました！":"返済しました。残り "+stats.loanBalance.toLocaleString("ja-JP")+"円です。"});return true;
  }

  if(req.method==="POST"&&path==="/api/appraiser/upgrade"){
   const current=Math.max(0,Math.min(10,Number(account.appraiserLevel)||0)),next=APPRAISERS[current];
   if(!next){sendJson(res,409,{error:"鑑定士はすでに最高レベルです。"});return true}
   if(account.cash<next.cost){sendJson(res,400,{error:"鑑定士の雇用・昇格には¥"+next.cost.toLocaleString("ja-JP")+"が必要です。"});return true}
   account.cash-=next.cost;account.appraiserLevel=next.level;await persistAccount(account);syncOnlineAccount(account);
   sendJson(res,200,{...rowToAccountState(account),message:next.title+"を雇用・昇格しました。"});return true;
  }
  const itemMatch=path.match(/^\/api\/items\/([^/]+)\/(appraise|sell|store|retrieve)$/);
  if(req.method==="POST"&&itemMatch){
   const id=decodeURIComponent(itemMatch[1]),action=itemMatch[2],b=await readJson(req),place=b.place==="collection"?"collection":"inventory",f=findItem(account,id,place);
   if(!f.item){sendJson(res,404,{error:"対象の商品が見つかりません。"});return true}
   const item=f.item;
   if(action==="appraise"){
    if(item.appraisal){sendJson(res,409,{error:"この商品はすでに鑑定済みです。"});return true}
    const level=Math.max(0,Math.min(10,Number(account.appraiserLevel)||0));if(!level){sendJson(res,400,{error:"先に鑑定士を雇用してください。"});return true}
    const app=APPRAISERS[level-1],fee=Math.max(500,Math.round((Number(item.marketValue)||0)*(.014-(level-1)*.0011)));
    if(account.cash<fee){sendJson(res,400,{error:"鑑定料 "+fee.toLocaleString("ja-JP")+"円が必要です。"});return true}
    account.cash-=fee;const exact=Math.random()*100<app.accuracy,trueIndex=RARITIES.findIndex(r=>r.key===item.rarity);
    let ri=trueIndex<0?0:trueIndex;if(!exact)ri=clamp(ri+(Math.random()<.5?-1:1),0,RARITIES.length-1);
    const error=(100-app.accuracy)/100,estimate=(Number(item.marketValue)||0)*rand(1-error,1+error);
    const detectionRate=APPRAISER_FAKE_DETECTION[level-1]||0,authenticityWarning=item.authenticityCode!=='genuine'&&Math.random()*100<detectionRate;
    item.appraised=true;item.appraisal={rank:RARITIES[ri].key,rankName:RARITIES[ri].name,estimate:Math.round(estimate),accuracy:app.accuracy,exact,fee,authenticityWarning,authenticityMessage:authenticityWarning?'偽物の疑いを検出しました':'偽物の兆候は確認されませんでした（完全な保証ではありません）',fakeDetectionRate:detectionRate};
    account.stats.appraisals=(Number(account.stats.appraisals)||0)+1;unlockAccountAchievements(account);
   }else if(action==="sell"){
    if(place!=="inventory"){sendJson(res,400,{error:"コレクションから直接売却することはできません。"});return true}
    const sale=Math.round((Number(item.marketValue)||0)*(item.appraisal?rand(.78,.94):rand(.43,.62))),profit=sale-(Number(item.auctionPaid)||0);
    account.cash+=sale;account.stats.sales=(Number(account.stats.sales)||0)+1;account.stats.profit=(Number(account.stats.profit)||0)+profit;f.arr.splice(f.index,1);
    const history=account.auctionHistory.find(h=>h.id===item.id);if(history){history.saleAmount=sale;history.soldAt=Date.now()}
    addAccountXp(account,12+Math.max(0,Math.min(30,Math.floor(profit/10000))));unlockAccountAchievements(account);await persistAccount(account);syncOnlineAccount(account);
    sendJson(res,200,{...rowToAccountState(account),message:"商品を売却しました。",sale,profit});return true;
   }else if(action==="store"){
    if(place!=="inventory"){sendJson(res,400,{error:"この商品はすでにコレクションにあります。"});return true}
    account.inventory.splice(f.index,1);account.collection.unshift(item);
   }else if(action==="retrieve"){
    if(place!=="collection"){sendJson(res,400,{error:"この商品はコレクションにありません。"});return true}
    account.collection.splice(f.index,1);account.inventory.unshift(item);
   }
   await persistAccount(account);syncOnlineAccount(account);sendJson(res,200,{...rowToAccountState(account),message:action==="appraise"?"鑑定しました。":action==="store"?"コレクションに保管しました。":"所持品に戻しました。"});return true;
  }
  sendJson(res,404,{error:"API endpoint not found"});return true;
 }catch(err){console.error("API error:",err);if(!res.headersSent)sendJson(res,Number(err.status)||500,{error:Number(err.status)?err.message:"サーバー処理中にエラーが発生しました。"});return true}
}
function makeItem(level,roomBand=levelBand(level)){
 const available=RARITIES.filter(r=>r.unlock<=level),total=available.reduce((s,r)=>s+r.weight,0);let n=Math.random()*total,rarity=available[0];
 for(const r of available){n-=r.weight;if(n<=0){rarity=r;break}}
 const obj=pick(OBJECTS),material=pick(MATERIALS),era=pick(ERAS),origin=pick(ORIGINS),motif=pick(MOTIFS),condition=pick(CONDITIONS);
 const roomPriceFactor=Math.pow(1.28,Math.max(0,Math.min(9,Number(roomBand)||0))),referenceMarketValue=Math.round(randInt(rarity.min,rarity.max)*roomPriceFactor);
 const roll=Math.random(),authenticityCode=roll<.90?'genuine':roll<.97?'high_fake':'low_fake',fakeValueFactor=authenticityCode==='high_fake'?rand(.15,.30):authenticityCode==='low_fake'?rand(.01,.05):1;
 const trend=marketTrendFor(material),marketValue=Math.max(100,Math.round(referenceMarketValue*fakeValueFactor*trend.factor)),startBid=Math.max(500,Math.round(marketValue*rand(.12,.22)/100)*100);
 return {id:'AM-'+crypto.randomBytes(5).toString('hex').toUpperCase(),name:`${era}の${material}${obj[0]}「${motif}」`,emoji:obj[1],object:obj[0],material,era,origin,motif,condition,rarity:rarity.key,rarityName:rarity.name,marketValue,referenceMarketValue,authenticityCode,fakeValueFactor,marketTrendLabel:trend.label,marketTrendPercent:Math.round((trend.factor-1)*100),startBid,createdAt:Date.now()};
}
function createAuction(room) {
  const activeLevels = [...room.players.values()].map(p => p.level);
  const effectiveLevel = activeLevels.length ? Math.max(...activeLevels) : room.levelBand * 10 + 1;
  const item = makeItem(effectiveLevel, room.levelBand);
  room.auction = {
    item, currentBid: item.startBid, highestBidderId: null, highestBidderName: null,
    highestBidderIsBot: false, status: 'live', endsAt: Date.now() + AUCTION_SECONDS * 1000,
    round: (room.round || 0) + 1, log: [], appraiserPreviews: {}, botAssessments:{}, extensionMs:0
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
function getPlayerAuctionAppraisal(auction, player) {
  const level = Math.max(0, Math.min(10, Number(player?.account?.appraiserLevel) || 0));
  if (!level || !auction) return null;
  if (!auction.appraiserPreviews) auction.appraiserPreviews = {};
  const cached = auction.appraiserPreviews[player.id];
  if (cached && cached.level === level) return cached.preview;
  const app = APPRAISERS[level - 1];
  const trueIndex = RARITIES.findIndex(r => r.key === auction.item.rarity);
  let rankIndex = trueIndex < 0 ? 0 : trueIndex;
  const exact = Math.random() * 100 < app.accuracy;
  if (!exact) rankIndex = clamp(rankIndex + (Math.random() < .5 ? -1 : 1), 0, RARITIES.length - 1);
  const error = (100 - app.accuracy) / 100;
  const estimate = Math.round((Number(auction.item.marketValue) || 0) * rand(1 - error, 1 + error));
  const estimateLow = Math.max(0, Math.floor(estimate / (1 + error) / 100) * 100);
  const estimateHigh = Math.ceil(estimate / (1 - error) / 100) * 100;
  const detectionRate=APPRAISER_FAKE_DETECTION[level-1]||0;
  const fakeDetected=auction.item.authenticityCode!=='genuine'&&Math.random()*100<detectionRate;
  const preview={rank:RARITIES[rankIndex].key,rankName:RARITIES[rankIndex].name,estimate,accuracy:app.accuracy,exact,estimateLow,estimateHigh,
   resaleLow:Math.round(estimateLow*.78),resaleHigh:Math.round(estimateHigh*.94),recommendedMaxBid:Math.floor(estimateLow*.70/100)*100,
   authenticityWarning:fakeDetected,authenticityMessage:fakeDetected?'偽物の疑いを検出しました':'偽物の兆候は確認されませんでした（完全な保証ではありません）',fakeDetectionRate:detectionRate};
  auction.appraiserPreviews[player.id] = { level, preview };
  return preview;
}
function snapshot(room, forPlayerId) {
  const auction = room.auction;
  const currentPlayer = room.players.get(forPlayerId);
  const appraiserPreview = auction && currentPlayer ? getPlayerAuctionAppraisal(auction, currentPlayer) : null;
  const publicItem = auction ? {
    id: auction.item.id, name: auction.item.name, emoji: auction.item.emoji,
    object: auction.item.object, material: auction.item.material, era: auction.item.era,
    origin: auction.item.origin, motif: auction.item.motif, condition: auction.item.condition,
    rarity: auction.item.rarity, rarityName: auction.item.rarityName, startBid: auction.item.startBid,
    marketTrendLabel:auction.item.marketTrendLabel||'相場安定',marketTrendPercent:Number(auction.item.marketTrendPercent)||0
  } : null;
  return {
    roomId: room.id, levelBand: room.levelBand, bandText: bandLabel(room.levelBand),
    players: allSeats(room).map(p => ({ ...p, isYou: p.id === forPlayerId,
      isLeading: auction?.highestBidderId === p.id })),
    auction: auction ? {
      item: publicItem, currentBid: auction.currentBid,
      highestBidderId: auction.highestBidderId, highestBidderName: auction.highestBidderName,
      highestBidderIsBot: auction.highestBidderIsBot, status: auction.status,
      endsAt: auction.endsAt, round: auction.round, appraiserPreview
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
  const bots = BOT_TEMPLATES.map((b, i) => ({ ...b, id: `bot-${id}-${i}`, level: band * 10 + 1, isBot: true, isYou: false, cash: Math.round(rand(65000, 190000) * factor) }));
  const room = { id, levelBand: band, isPrivate, inviteCode, players: new Map(), bots, round: 0, auction: null, timer: null, botNextAt: 0, nextAuctionAt: null, log: [] };
  rooms.set(id, room);
  room.timer = setInterval(() => tickRoom(room), 250);
  return room;
}
function detachIdentity(id,ws){
 const old=sockets.get(id);if(old&&old!==ws){try{safeSend(old,{type:'replaced'});old.playerId=null;old.roomId=null;old.close()}catch{}}
 for(const room of [...rooms.values()])if(room.players.has(id)){room.players.delete(id);if(!closeRoomIfEmpty(room))broadcastRoom(room)}
}
function sendJoined(player,room){
 player.roomId=room.id;
 safeSend(player.ws,{type:'joined',you:{cash:player.cash,level:player.level,state:publicAccountState(player.account)},snapshot:snapshot(room,player.id)});
 broadcastRoom(room);
}
async function authenticatedPlayer(ws){
 if(!databaseReady||!ws.accountId)return null;
 return await getAccountById(ws.accountId);
}
async function joinQuick(ws){
 const account=await authenticatedPlayer(ws);if(!account)return safeSend(ws,{type:'error',message:'先にアカウントへログインしてください。'});
 const id=account.id,level=Math.max(1,Math.min(100,Number(account.level)||1)),band=levelBand(level);detachIdentity(id,ws);
 const player={id,name:account.displayName||account.username,level,cash:Number(account.cash)||0,ws,roomId:null,account};
 profiles.set(id,account);
 let room=[...rooms.values()].find(r=>!r.isPrivate&&r.levelBand===band&&r.players.size<MAX_SEATS);if(!room)room=createRoom(band);
 room.players.set(id,player);if(!room.auction)createAuction(room);sockets.set(id,ws);ws.playerId=id;ws.roomId=room.id;sendJoined(player,room);
}
async function createPrivate(ws){
 const account=await authenticatedPlayer(ws);if(!account)return safeSend(ws,{type:'error',message:'先にアカウントへログインしてください。'});
 const id=account.id;detachIdentity(id,ws);
 const player={id,name:account.displayName||account.username,level:Math.max(1,Math.min(100,Number(account.level)||1)),cash:Number(account.cash)||0,ws,roomId:null,account};
 const room=createRoom(levelBand(player.level),true);room.players.set(id,player);if(!room.auction)createAuction(room);
 sockets.set(id,ws);ws.playerId=id;ws.roomId=room.id;safeSend(ws,{type:'friend_room_created',code:room.inviteCode});sendJoined(player,room);
}
async function joinPrivate(ws,msg){
 const account=await authenticatedPlayer(ws);if(!account)return safeSend(ws,{type:'error',message:'先にアカウントへログインしてください。'});
 const code=String(msg.code||'').trim().toUpperCase().slice(0,12);
 if(!code)return safeSend(ws,{type:'error',message:'招待コードを入力してください。'});
 const room=[...rooms.values()].find(r=>r.isPrivate&&r.inviteCode===code);
 if(!room)return safeSend(ws,{type:'error',message:'招待コードが見つかりません。'});
 if(room.players.size>=MAX_SEATS)return safeSend(ws,{type:'error',message:'このルームは満員です。'});
 const id=account.id;detachIdentity(id,ws);
 const player={id,name:account.displayName||account.username,level:Math.max(1,Math.min(100,Number(account.level)||1)),cash:Number(account.cash)||0,ws,roomId:null,account};
 room.players.set(id,player);sockets.set(id,ws);ws.playerId=id;ws.roomId=room.id;sendJoined(player,room);
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
  const remaining=auction.endsAt-Date.now();
  if(remaining>0&&remaining<=5000&&auction.extensionMs<20000){const add=Math.min(5000,20000-auction.extensionMs);auction.endsAt+=add;auction.extensionMs+=add}
  auction.highestBidderId = player.id;
  auction.highestBidderName = player.name;
  auction.highestBidderIsBot = false;
  roomLog(room, `${player.name} が ¥${amount.toLocaleString('ja-JP')} で入札`);
  room.botNextAt = Date.now() + randInt(2400, 4200);
  broadcastRoom(room);
}
function botTurn(room){
 const auction=room.auction;if(!auction||auction.status!=='live')return;
 const bots=botSeats(room).filter(b=>b.cash>=minimumBid(auction)&&b.id!==auction.highestBidderId);if(!bots.length)return;
 const remaining=auction.endsAt-Date.now(),eligible=bots.filter(b=>b.strategy!=='sniper'||remaining<=7000);if(!eligible.length)return;
 const bot=pick(eligible),item=auction.item;if(!auction.botAssessments)auction.botAssessments={};
 if(auction.botAssessments[bot.id]===undefined){const seesFake=item.authenticityCode!=='genuine'&&Math.random()*100<Number(bot.appraisalSkill||0)*100;auction.botAssessments[bot.id]=seesFake?'fake':'unknown'}
 const knowsFake=auction.botAssessments[bot.id]==='fake',mult={cautious:.82,collector:1.34,investor:1.08,intimidator:1.42,sniper:1.22};
 const risk=.82+Math.max(0,Math.min(1,Number(bot.riskTolerance)||0))*.34,valueCeiling=item.marketValue*(mult[bot.strategy]||1)*risk*(knowsFake?.30:1);
 const ceiling=Math.min(valueCeiling,bot.cash*Math.max(.35,Math.min(1,Number(bot.budgetRatio)||.7)));if(auction.currentBid>=ceiling)return;
 const chanceBase={cautious:.30,collector:.62,investor:.48,intimidator:.78,sniper:.88};let chance=(chanceBase[bot.strategy]||.5)+Number(bot.aggression||0)*.12;
 if(auction.highestBidderId&&!auction.highestBidderIsBot)chance+=.12;if(bot.strategy==='investor'&&Number(item.marketTrendPercent)>5)chance+=.12;if(bot.strategy==='cautious'&&knowsFake)chance*=.12;
 if(Math.random()>Math.max(.08,Math.min(.92,chance)))return;
 const ranges={cautious:[.025,.055],collector:[.05,.12],investor:[.04,.085],intimidator:[.14,.24],sniper:[.09,.18]},range=ranges[bot.strategy]||[.045,.10];
 const offered=Math.min(auction.currentBid+Math.max(minIncrement(auction.currentBid),Math.round(auction.currentBid*rand(range[0],range[1])/100)*100),Math.floor(Math.min(ceiling,bot.cash)/100)*100);
 if(offered<minimumBid(auction))return;auction.currentBid=offered;auction.highestBidderId=bot.id;auction.highestBidderName=bot.name;auction.highestBidderIsBot=true;
 roomLog(room,`${bot.name}（${bot.style}）が ¥${offered.toLocaleString('ja-JP')} で入札`);room.botNextAt=Date.now()+randInt(2400,5100);broadcastRoom(room);
}
async function settleAuction(room){
 const auction=room.auction;if(!auction||auction.status!=='live')return;
 auction.status='finished';
 const settledItem={...auction.item},auctionId=settledItem.id;
 const winnerId=auction.highestBidderId,amount=winnerId?auction.currentBid:0,winner=winnerId?room.players.get(winnerId):null,winnerName=auction.highestBidderName||'入札なし';
 let wonItem=null;
 if(winner){
  wonItem={...settledItem,auctionPaid:amount,wonAt:Date.now()};
  winner.account.cash=Math.max(0,Number(winner.account.cash)-amount);
  winner.account.inventory.unshift(wonItem);
  winner.account.auctionHistory.unshift({...wonItem});
  const catalogMark='catalog:'+encodeURIComponent(String(wonItem.object||''))+'|'+String(wonItem.rarity||'');
  if(wonItem.object&&wonItem.rarity&&!winner.account.seen.includes(catalogMark))winner.account.seen.push(catalogMark);
  winner.account.stats.wins=(Number(winner.account.stats.wins)||0)+1;
  const rarityIndex=RARITIES.findIndex(r=>r.key===wonItem.rarity);
  addAccountXp(winner.account,40+Math.min(45,Math.max(0,rarityIndex)*3));
   unlockAccountAchievements(winner.account);
  winner.cash=winner.account.cash;winner.level=winner.account.level;profiles.set(winner.id,winner.account);
 }
 for(const player of room.players.values()){
  player.account.stats.auctions=(Number(player.account.stats.auctions)||0)+1;
  await persistAccount(player.account);
 }
 roomLog(room,winnerId?winnerName+' が落札':'入札なし・流札');
 for(const player of room.players.values()){
  safeSend(player.ws,{type:'auction_result',auctionId,itemId:auctionId,winnerId,winnerName,amount,item:publicItemRecord(wonItem?{...wonItem}:{...settledItem,auctionPaid:amount}),you:{cash:player.cash,level:player.level,state:publicAccountState(player.account)}});
 }
 broadcastRoom(room);room.nextAuctionAt=Date.now()+INTERMISSION_MS;
}
function tickRoom(room) {
  if (!rooms.has(room.id)) return;
  if (room.players.size === 0) { closeRoomIfEmpty(room); return; }
  const now = Date.now();
  if (room.auction?.status === 'live') {
    if (now >= room.botNextAt) { botTurn(room); room.botNextAt = now + randInt(2600, 4400); }
    if (now >= room.auction.endsAt) settleAuction(room).catch(err => { console.error('Auction settlement failed:', err); room.nextAuctionAt = Date.now() + INTERMISSION_MS; });
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

const server = http.createServer(async (req,res)=>{
 const url=new URL(req.url,'http://'+(req.headers.host||'localhost')),pathname=url.pathname;
 if(pathname.startsWith('/api/')){await apiHandler(req,res,url);return}
 if(pathname==='/'||pathname==='/auction_masters.html'){
  fs.readFile(path.join(ROOT,'auction_masters.html'),(err,data)=>{
   if(err){res.writeHead(500,{'Content-Type':'text/plain; charset=utf-8'});res.end('Game file is missing.');return}
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'});res.end(data);
  });return;
 }
 if(pathname==='/favicon.svg'){
  fs.readFile(path.join(ROOT,'favicon.svg'),(err,data)=>{
   if(err){res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8','Cache-Control':'no-store'});res.end('Favicon not found.');return}
   res.writeHead(200,{'Content-Type':'image/svg+xml; charset=utf-8','Cache-Control':'no-store'});res.end(data);
  });return;
 }
 if(pathname==='/health'){sendJson(res,200,{ok:true,database:databaseReady,rooms:rooms.size,players:sockets.size});return}
 res.writeHead(404,{'Content-Type':'text/plain; charset=utf-8'});res.end('Not found');
});
const wss=new WebSocket.Server({server,maxPayload:16*1024});
wss.on('connection',(ws,req)=>{
 ws.isAlive=true;
 ws.authPromise=accountForCookie(req.headers.cookie||'').then(a=>{ws.accountId=a?.id||null;return a}).catch(err=>{console.warn('WebSocket auth failed:',err.message);ws.accountId=null;return null});
 ws.on('pong',()=>{ws.isAlive=true});
 ws.on('message',async raw=>{
  let msg;try{msg=JSON.parse(raw.toString())}catch{safeSend(ws,{type:'error',message:'不正なデータです。'});return}
  if(!msg||typeof msg.type!=='string')return;
  try{
   await ws.authPromise;
   if(msg.type==='join_quick'){await joinQuick(ws);return}
   if(msg.type==='create_private'){await createPrivate(ws);return}
   if(msg.type==='join_private'){await joinPrivate(ws,msg);return}
   if(msg.type==='bid'){const player=ws.playerId?rooms.get(ws.roomId)?.players.get(ws.playerId):null;if(player)handleBid(player,msg.amount);return}
   if(msg.type==='leave'){leaveRoom(ws);safeSend(ws,{type:'room_closed'});return}
   if(msg.type==='profile_update'){safeSend(ws,{type:'error',message:'所持金・レベルはサーバー側で管理されています。'});return}
  }catch(err){console.error('WebSocket message failed:',err);safeSend(ws,{type:'error',message:'サーバー処理中にエラーが発生しました。'})}
 });
 ws.on('close',()=>leaveRoom(ws));ws.on('error',()=>leaveRoom(ws));
});
const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) { ws.terminate(); continue; }
    ws.isAlive = false;
    ws.ping();
  }
}, 30000);
async function start(){
 try{await initializeDatabase();await loadProfiles()}
 catch(err){databaseReady=false;console.error('PostgreSQL initialization failed:',err.message)}
 server.listen(PORT,HOST,()=>console.log('AUCTION MASTERS server listening on http://'+HOST+':'+PORT+(databaseReady?' (database connected)':' (DATABASE_URL missing/unavailable)')));
}
start();
server.on('close',()=>{clearInterval(heartbeat);for(const room of rooms.values())clearInterval(room.timer);if(pool)pool.end().catch(()=>{})});
