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
const INTERMISSION_MS = 1500;
const rooms = new Map();
const sockets = new Map();
let nextSocketSequence = 0;
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
function roomMatchBand(room) {
  const band = Number(room?.matchBand ?? room?.levelBand);
  return Number.isInteger(band) ? Math.max(0, Math.min(9, band)) : 0;
}
function bandLabel(band) { const start = band * 10 + 1; return `Lv.${start}–${Math.min(100, start + 9)}`; }
function minIncrement(value) {
  if (value < 100000) return 1000;
  if (value < 1000000) return 5000;
  if (value < 10000000) return 25000;
  return Math.max(100000, Math.round(value * .01 / 1000) * 1000);
}
function minimumBid(auction) { return Math.max(auction.item.startBid, auction.currentBid + minIncrement(auction.currentBid)); }
function marketTrendFor(material){const weekIndex=Math.floor(Date.parse(currentEventWeekKey()+'T00:00:00Z')/604800000),hash=[...String(material||'')].reduce((sum,c)=>sum+c.charCodeAt(0),0);return MARKET_TRENDS[(weekIndex+hash)%MARKET_TRENDS.length]}
const APPRAISER_FAKE_DETECTION=[35,42,50,58,65,73,80,87,93,97];
function publicItemRecord(item){if(!item||typeof item!=='object')return item;const copy={...item};delete copy.authenticityCode;delete copy.fakeValueFactor;delete copy.referenceMarketValue;if(copy.appraisal&&typeof copy.appraisal==='object'){copy.appraisal={...copy.appraisal};delete copy.appraisal.exact}return copy}
function currentEventWeekKey(){const d=new Date();d.setUTCHours(0,0,0,0);d.setUTCDate(d.getUTCDate()-((d.getUTCDay()+6)%7));return d.toISOString().slice(0,10)}
const MARKET_TRENDS=[
 {factor:1.30,label:'急騰'},{factor:1.18,label:'人気上昇'},{factor:1.08,label:'やや上昇'},
 {factor:.92,label:'やや下落'},{factor:.82,label:'人気低下'},{factor:.70,label:'暴落'}
];
const CONDITION_MARKET_FACTORS=Object.freeze({'極美品':1.15,'美品':1.08,'良品':1,'経年変化あり':.90,'修復跡あり':.78,'希少な初期型':1.12});
const WEEKLY_MARKET_EVENTS=[
 {id:'ancient-relics',title:'古代文明の秘宝展',description:'古代王朝や失われた帝国にまつわる品への注目が高まっています。',targetLabel:'古代文明・遺跡の品',bonusPercent:16,eras:['古代王朝','失われた帝国','未知の文明'],objects:['古代硬貨','古文書','化石標本','古い地図']},
 {id:'royal-collection',title:'王室コレクション週間',description:'王冠や勲章、王室ゆかりの装飾品に特別な需要が集まっています。',targetLabel:'王室・装飾品',bonusPercent:15,eras:['旧王室'],objects:['王冠','勲章','指輪','宝石箱','銀食器']},
 {id:'fine-art',title:'美術工芸品フェア',description:'絵画や陶磁器、伝統工芸品の評価が上がっています。',targetLabel:'美術品・工芸品',bonusPercent:15,objects:['油彩画','陶磁器の花瓶','彫刻','ガラス細工','ティーセット'],materials:['翡翠','琥珀','水晶','瑠璃','七宝']},
 {id:'mechanical-heritage',title:'機械遺産・時計特集',description:'精密な時計や歴史的な機械製品がコレクターの注目を集めています。',targetLabel:'時計・機械遺産',bonusPercent:14,objects:['懐中時計','腕時計','置時計','タイプライター','蓄音機','写真機','天体望遠鏡']}
];
function getWeeklyMarketEvent(){
 const weekKey=currentEventWeekKey(),weekIndex=Math.floor(Date.parse(weekKey+'T00:00:00Z')/604800000);
 const event=WEEKLY_MARKET_EVENTS[weekIndex%WEEKLY_MARKET_EVENTS.length];
 return {...event,weekKey,endsAt:Date.parse(weekKey+'T00:00:00Z')+604800000};
}
function marketEventMatchesItem(event,item){
 return !!event&&!!item&&((event.objects||[]).includes(item.object)||(event.materials||[]).includes(item.material)||(event.eras||[]).includes(item.era));
}
function weeklyMarketEventPayload(){
 const event=getWeeklyMarketEvent();
 return {id:event.id,title:event.title,description:event.description,targetLabel:event.targetLabel,bonusPercent:event.bonusPercent,weekKey:event.weekKey,endsAt:event.endsAt};
}
function authenticityProfileFor(rarityKey){
 const index=RARITIES.findIndex(r=>r.key===rarityKey);
 if(index>=13)return {genuine:72,highFake:19,lowFake:9};
 if(index>=8)return {genuine:75,highFake:17,lowFake:8};
 return {genuine:78,highFake:15,lowFake:7};
}
function rollAuthenticity(rarityKey){
 const profile=authenticityProfileFor(rarityKey),roll=Math.random()*100;
 if(roll<profile.genuine)return 'genuine';
 if(roll<profile.genuine+profile.highFake)return 'high_fake';
 return 'low_fake';
}
const WEEKLY_EVENT_CHALLENGES=[{id:'auctions-10',title:'競売に10回参加',description:'競売を10回最後まで見届ける',field:'auctions',target:10,xp:250,cash:5000},{id:'wins-3',title:'3回落札する',description:'競売で商品を3点落札する',field:'wins',target:3,xp:450,cash:10000},{id:'appraisals-3',title:'鑑定を3回行う',description:'鑑定士に商品を3点鑑定してもらう',field:'appraisals',target:3,xp:250,cash:5000},{id:'sales-3',title:'商品を3点売却する',description:'所持品から商品を3点売却する',field:'sales',target:3,xp:250,cash:5000}];
function weeklyEventProgress(account){const stats={...defaultStats(),...(account.stats||{})},weekKey=currentEventWeekKey();let weekly=stats.weeklyEvent||{};if(weekly.weekKey!==weekKey)weekly={weekKey,auctions:0,wins:0,appraisals:0,sales:0};stats.weeklyEvent=weekly;account.stats=stats;return weekly}
function recordWeeklyEvent(account,field){const weekly=weeklyEventProgress(account);if(['auctions','wins','appraisals','sales'].includes(field))weekly[field]=Math.max(0,Number(weekly[field])||0)+1}
function weeklyEventPayload(account){const weekly=weeklyEventProgress(account),weekKey=weekly.weekKey;return {weekKey,endsAt:Date.parse(weekKey+'T00:00:00Z')+604800000,featuredMarketEvent:weeklyMarketEventPayload(),challenges:WEEKLY_EVENT_CHALLENGES.map(ch=>({...ch,progress:Math.min(ch.target,Number(weekly[ch.field])||0),claimed:account.seen.includes('event:weekly:'+weekKey+':'+ch.id)}))}}
const GUILD_ACHIEVEMENTS=[
 {id:'guild-auctions-100',title:'百戦錬磨',description:'メンバー全員で競売参加100回',field:'auctions',target:100},
 {id:'guild-wins-25',title:'落札の名門',description:'メンバー全員で落札25回',field:'wins',target:25},
 {id:'guild-sales-50',title:'商才集団',description:'メンバー全員で売却50回',field:'sales',target:50},
 {id:'guild-members-10',title:'仲間が集う場所',description:'ギルドメンバー10人に到達',field:'members',target:10}
];
function guildAchievementPayload(memberRows){
 const totals={members:memberRows.length,auctions:0,wins:0,sales:0};
 for(const row of memberRows){
  let stats=row.stats||{};if(typeof stats==='string'){try{stats=JSON.parse(stats)}catch{stats={}}}
  for(const field of ['auctions','wins','sales'])totals[field]+=Math.max(0,Number(stats[field])||0);
 }
 return {totals,achievements:GUILD_ACHIEVEMENTS.map(item=>({id:item.id,title:item.title,description:item.description,progress:Math.min(item.target,totals[item.field]),target:item.target,completed:totals[item.field]>=item.target}))};
}
function publicAccountState(account){const state=accountState(account);state.inventory=state.inventory.map(publicItemRecord);state.collection=state.collection.map(publicItemRecord);state.museum=state.museum.map(publicItemRecord);state.auctionHistory=state.auctionHistory.map(publicItemRecord);return state}
function safeSend(ws, data) {
  if (!ws || ws.readyState !== WebSocket.OPEN) return false;
  try { ws.send(JSON.stringify(data)); return true; } catch { return false; }
}
function defaultStats(){return {wins:0,auctions:0,sales:0,profit:0,appraisals:0,loansBorrowed:0,loanTotalBorrowed:0,loansRepaid:0,debtFreeCount:0,loanBalance:0,loanPrincipal:0,weeklyEvent:{weekKey:'',auctions:0,wins:0,appraisals:0,sales:0}}}
const MUSEUM_MAX_EXHIBITS=12;
const MUSEUM_MAX_OFFLINE_MINUTES=24*60;
const MUSEUM_RARITY_MULTIPLIER={N:1,C:1.3,UC:1.8,R:2.5,HR:4,RR:7,RRR:12,SR:20,Epic:35,UR:60,Legendary:100,UL:160,Mythic:250,SEC:380,GDR:550,EX:750,SP:1000};
const MUSEUM_CONDITION_MULTIPLIER={'極美品':1.15,'美品':1.08,'良品':1,'経年変化あり':0.9,'修復跡あり':0.8,'希少な初期型':1.12};
function museumItemIncomePerMinute(item,playerLevel=1){
 const appraisal=item?.appraisal&&typeof item.appraisal==='object'?item.appraisal:null;
 const assessedValue=Number(appraisal?.estimate);
 const value=Math.max(1000,Math.min(10000000000000,assessedValue>0?assessedValue:Number(item?.marketValue)||0));
 const valueScore=Math.max(0,Math.log10(value)-3);
 const rarity=MUSEUM_RARITY_MULTIPLIER[String(item?.rarity||'N')]||1;
 const condition=MUSEUM_CONDITION_MULTIPLIER[String(item?.condition||'良品')]||1;
 const level=Math.max(1,Math.min(100,Number(playerLevel)||1));
 const levelProgress=(level-1)/99;
 const levelMultiplier=1+Math.pow(levelProgress,1.1)*1.4;
 const appraisalMultiplier=appraisal?1.35:1;
 return Math.max(1,Math.min(1000000,Math.floor(Math.pow(valueScore,1.7)*1.4*rarity*condition*levelMultiplier*appraisalMultiplier)));
}
function museumIncomePerMinute(account){
 const level=Math.max(1,Math.min(100,Number(account?.level)||1));
 return Math.min(10000000,(Array.isArray(account?.museum)?account.museum:[]).reduce((sum,item)=>sum+museumItemIncomePerMinute(item,level),0));
}
function museumSummaryForAccount(account){
 const exhibits=Array.isArray(account?.museum)?account.museum:[];
 const level=Math.max(1,Math.min(100,Number(account?.level)||1));
 const incomePerMinute=museumIncomePerMinute(account);
 return {
  capacity:MUSEUM_MAX_EXHIBITS,count:exhibits.length,incomePerMinute,
  estimatedPerHour:incomePerMinute*60,estimatedPerDay:incomePerMinute*1440,
  offlineCapHours:24,
  exhibits:exhibits.map(item=>({id:String(item.id||''),incomePerMinute:museumItemIncomePerMinute(item,level)})),
  availableItems:[...(Array.isArray(account?.inventory)?account.inventory:[]).map(item=>({id:String(item.id||''),place:'inventory',incomePerMinute:museumItemIncomePerMinute(item,level)})),
   ...(Array.isArray(account?.collection)?account.collection:[]).map(item=>({id:String(item.id||''),place:'collection',incomePerMinute:museumItemIncomePerMinute(item,level)}))]
 };
}
function settleMuseumIncome(account,now=Date.now()){
 const incomePerMinute=museumIncomePerMinute(account);
 if(incomePerMinute<=0)return {minutes:0,earned:0,incomePerMinute:0};
 const rawLast=account.museumUpdatedAt?new Date(account.museumUpdatedAt).getTime():now;
 const last=Number.isFinite(rawLast)?rawLast:now;
 const elapsedMinutes=Math.floor(Math.max(0,now-last)/60000);
 if(elapsedMinutes<=0)return {minutes:0,earned:0,incomePerMinute};
 const minutes=Math.min(MUSEUM_MAX_OFFLINE_MINUTES,elapsedMinutes);
 const earned=minutes*incomePerMinute;
 account.cash=(Number(account.cash)||0)+earned;
 account.museumUpdatedAt=new Date(elapsedMinutes>MUSEUM_MAX_OFFLINE_MINUTES?now:last+minutes*60000).toISOString();
 return {minutes,earned,incomePerMinute};
}
async function settleMuseumAccount(accountId,knownAccount=null){
 if(knownAccount){
  const knownRate=museumIncomePerMinute(knownAccount),rawLast=knownAccount.museumUpdatedAt?new Date(knownAccount.museumUpdatedAt).getTime():Date.now();
  if(knownRate<=0||!Number.isFinite(rawLast)||Date.now()-rawLast<60000)return knownAccount;
 }
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const q=await client.query('SELECT * FROM am_accounts WHERE id=$1 FOR UPDATE',[accountId]);
  const account=accountFromRow(q.rows[0]);
  if(!account){await client.query('COMMIT');return null}
  const settled=settleMuseumIncome(account);
  if(settled.minutes>0)await persistAccount(account,client);
  await client.query('COMMIT');
  if(settled.minutes>0)syncOnlineAccount(account);
  return account;
 }catch(error){
  try{await client.query('ROLLBACK')}catch{}
  throw error;
 }finally{client.release()}
}
function accountState(a){
 const updatedAt=a.museumUpdatedAt?new Date(a.museumUpdatedAt):new Date();
 return {cash:Number(a.cash)||0,level:Number(a.level)||1,xp:Number(a.xp)||0,
 inventory:Array.isArray(a.inventory)?a.inventory:[],collection:Array.isArray(a.collection)?a.collection:[],
 museum:Array.isArray(a.museum)?a.museum:[],museumUpdatedAt:Number.isFinite(updatedAt.getTime())?updatedAt.toISOString():new Date().toISOString(),
 auctionHistory:Array.isArray(a.auctionHistory)?a.auctionHistory:[],appraiserLevel:Number(a.appraiserLevel)||0,
 stats:{...defaultStats(),...(a.stats||{})},seen:Array.isArray(a.seen)?a.seen:[]};
}
function accountFromRow(r){
 if(!r)return null;
 return {id:r.id,username:r.username,usernameKey:r.username_key,displayName:r.display_name||r.username,
 passwordSalt:r.password_salt,passwordHash:r.password_hash,isBanned:!!r.is_banned,banReason:r.ban_reason||'',bannedUntil:r.banned_until||null,...accountState({cash:r.cash,level:r.level,xp:r.xp,
 inventory:r.inventory,collection:r.collection,museum:r.museum,museumUpdatedAt:r.museum_updated_at,auctionHistory:r.auction_history,appraiserLevel:r.appraiser_level,
 stats:r.stats,seen:r.seen}),createdAt:r.created_at};
}
function isAccountCurrentlyBanned(account,now=Date.now()){
 if(!account?.isBanned)return false;
 if(!account.bannedUntil)return true;
 const until=new Date(account.bannedUntil).getTime();return !Number.isFinite(until)||until>now;
}
const adminLoginAttempts=new Map();
async function hasAdminSession(req,accountId){
 const token=parseCookies(req.headers.cookie).am_admin_session;
 if(!token)return false;
 const q=await pool.query("SELECT 1 FROM am_admin_sessions WHERE token_hash=$1 AND account_id=$2 AND expires_at>NOW()",[tokenHash(token),accountId]);
 return !!q.rowCount;
}
function publicAccount(a){return {id:a.id,username:a.username,displayName:a.displayName||a.username,
 cash:Number(a.cash)||0,level:Number(a.level)||1,createdAt:a.createdAt||null,
 stats:{...defaultStats(),...(a.stats||{})}}}
async function initializeDatabase(){
 if(!pool)return;
 await pool.query("CREATE TABLE IF NOT EXISTS am_accounts(id TEXT PRIMARY KEY,username TEXT NOT NULL,username_key TEXT NOT NULL UNIQUE,display_name TEXT NOT NULL,password_salt TEXT NOT NULL,password_hash TEXT NOT NULL,cash BIGINT NOT NULL DEFAULT 100000,level INTEGER NOT NULL DEFAULT 1,xp INTEGER NOT NULL DEFAULT 0,inventory JSONB NOT NULL DEFAULT '[]'::jsonb,collection JSONB NOT NULL DEFAULT '[]'::jsonb,museum JSONB NOT NULL DEFAULT '[]'::jsonb,museum_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),is_banned BOOLEAN NOT NULL DEFAULT FALSE,ban_reason TEXT,banned_until TIMESTAMPTZ,auction_history JSONB NOT NULL DEFAULT '[]'::jsonb,stats JSONB NOT NULL DEFAULT '{\"wins\":0,\"auctions\":0,\"sales\":0,\"profit\":0}'::jsonb,appraiser_level INTEGER NOT NULL DEFAULT 0,seen JSONB NOT NULL DEFAULT '[]'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await pool.query("ALTER TABLE am_accounts ADD COLUMN IF NOT EXISTS museum JSONB NOT NULL DEFAULT '[]'::jsonb");
 await pool.query("ALTER TABLE am_accounts ADD COLUMN IF NOT EXISTS museum_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()");
 await pool.query("ALTER TABLE am_accounts ADD COLUMN IF NOT EXISTS is_banned BOOLEAN NOT NULL DEFAULT FALSE");
 await pool.query("ALTER TABLE am_accounts ADD COLUMN IF NOT EXISTS ban_reason TEXT");
 await pool.query("ALTER TABLE am_accounts ADD COLUMN IF NOT EXISTS banned_until TIMESTAMPTZ");
 await pool.query("CREATE TABLE IF NOT EXISTS am_admin_sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES am_accounts(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await pool.query("CREATE INDEX IF NOT EXISTS am_admin_sessions_account_idx ON am_admin_sessions(account_id)");
 await pool.query("CREATE TABLE IF NOT EXISTS am_admin_audit(id BIGSERIAL PRIMARY KEY,actor_account_id TEXT NOT NULL REFERENCES am_accounts(id) ON DELETE CASCADE,target_account_id TEXT REFERENCES am_accounts(id) ON DELETE SET NULL,action TEXT NOT NULL,details JSONB NOT NULL DEFAULT '{}'::jsonb,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await pool.query("CREATE INDEX IF NOT EXISTS am_admin_audit_created_idx ON am_admin_audit(created_at DESC)");
 await pool.query("CREATE TABLE IF NOT EXISTS am_sessions(token_hash TEXT PRIMARY KEY,account_id TEXT NOT NULL REFERENCES am_accounts(id) ON DELETE CASCADE,expires_at TIMESTAMPTZ NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await pool.query("CREATE INDEX IF NOT EXISTS am_sessions_account_idx ON am_sessions(account_id)");
 await pool.query("CREATE INDEX IF NOT EXISTS am_accounts_cash_rank_idx ON am_accounts(cash DESC,created_at ASC)");
 await pool.query("CREATE TABLE IF NOT EXISTS am_trade_offers(id TEXT PRIMARY KEY,seller_id TEXT NOT NULL REFERENCES am_accounts(id) ON DELETE CASCADE,buyer_id TEXT NOT NULL REFERENCES am_accounts(id) ON DELETE CASCADE,item_id TEXT NOT NULL,item_json JSONB NOT NULL,offer_amount BIGINT NOT NULL CHECK(offer_amount>0),status TEXT NOT NULL DEFAULT 'pending',created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),responded_at TIMESTAMPTZ)");
 await pool.query("CREATE INDEX IF NOT EXISTS am_trade_seller_status_idx ON am_trade_offers(seller_id,status,created_at DESC)");
 await pool.query("CREATE INDEX IF NOT EXISTS am_trade_buyer_idx ON am_trade_offers(buyer_id,created_at DESC)");
 await pool.query("CREATE TABLE IF NOT EXISTS am_guilds(id TEXT PRIMARY KEY,name TEXT NOT NULL,name_key TEXT NOT NULL UNIQUE,owner_id TEXT NOT NULL REFERENCES am_accounts(id) ON DELETE CASCADE,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await pool.query("CREATE TABLE IF NOT EXISTS am_guild_members(guild_id TEXT NOT NULL REFERENCES am_guilds(id) ON DELETE CASCADE,account_id TEXT NOT NULL UNIQUE REFERENCES am_accounts(id) ON DELETE CASCADE,role TEXT NOT NULL DEFAULT 'member' CHECK(role IN ('owner','member')),joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),PRIMARY KEY(guild_id,account_id))");
 await pool.query("CREATE INDEX IF NOT EXISTS am_guild_members_guild_idx ON am_guild_members(guild_id,joined_at ASC)");
 await pool.query("CREATE TABLE IF NOT EXISTS am_guild_messages(id TEXT PRIMARY KEY,guild_id TEXT NOT NULL REFERENCES am_guilds(id) ON DELETE CASCADE,account_id TEXT NOT NULL REFERENCES am_accounts(id) ON DELETE CASCADE,body TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())");
 await pool.query("CREATE INDEX IF NOT EXISTS am_guild_messages_guild_idx ON am_guild_messages(guild_id,created_at DESC)");
 databaseReady=true;console.log("AUCTION MASTERS PostgreSQL database ready");
}
function japanDateKey(date=new Date()){
 const parts=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Tokyo',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(date);
 const part=type=>parts.find(value=>value.type===type)?.value||'00';
 return part('year')+'-'+part('month')+'-'+part('day');
}
async function grantLoginBonus(accountId){
 const client=await pool.connect();
 try{
  await client.query('BEGIN');
  const q=await client.query('SELECT * FROM am_accounts WHERE id=$1 FOR UPDATE',[accountId]);
  const account=accountFromRow(q.rows[0]);
  if(!account){await client.query('ROLLBACK');return {account:null,reward:null}}
  const today=japanDateKey(),markers=Array.isArray(account.seen)?account.seen:[];
  const previous=markers.find(value=>String(value).startsWith('login-bonus-state:'));
  const match=previous&&String(previous).match(/^login-bonus-state:(\d{4}-\d{2}-\d{2}):(\d{1,3})$/);
  if(match&&match[1]===today){
   await client.query('COMMIT');
   profiles.set(account.id,account);
   return {account,reward:null};
  }
  const previousDay=match?Number(match[2]):0;
  const day=previousDay>=100?1:previousDay+1;
  const cash=day*10000,xp=day*100;
  account.cash=Math.max(0,Number(account.cash)||0)+cash;
  addAccountXp(account,xp);
  const items=[];
  if(day===100){
   for(let i=0;i<2;i++){
    const item=makeItem(100,9,'SP');
    account.inventory.unshift(item);
    const catalogMark='catalog:'+encodeURIComponent(String(item.object||''))+'|SP';
    if(item.object&&!account.seen.includes(catalogMark))account.seen.push(catalogMark);
    items.push(publicItemRecord(item));
   }
  }
  account.seen=account.seen.filter(value=>!String(value).startsWith('login-bonus-state:'));
  account.seen.push('login-bonus-state:'+today+':'+day);
  await persistAccount(account,client);
  await client.query('COMMIT');
  syncOnlineAccount(account);
  return {account,reward:{day,cash,xp,items}};
 }catch(error){
  try{await client.query('ROLLBACK')}catch{}
  throw error;
 }finally{client.release()}
}
async function getAccountById(id){
 if(!databaseReady)return null;
 const q=await pool.query("SELECT * FROM am_accounts WHERE id=$1",[id]);const a=accountFromRow(q.rows[0]);if(a)profiles.set(a.id,a);return a;
}
async function persistAccount(a,db=pool){
 if(!databaseReady||!a)return;
 const s=accountState(a);
 await db.query("UPDATE am_accounts SET display_name=$2,cash=$3::bigint,level=$4,xp=$5,inventory=$6::jsonb,collection=$7::jsonb,museum=$8::jsonb,museum_updated_at=$9::timestamptz,auction_history=$10::jsonb,stats=$11::jsonb,appraiser_level=$12,seen=$13::jsonb,updated_at=NOW() WHERE id=$1",
 [a.id,a.displayName||a.username,String(Math.max(0,Math.floor(s.cash))),Math.max(1,Math.min(100,Math.floor(s.level))),Math.max(0,Math.floor(s.xp)),
 JSON.stringify(s.inventory),JSON.stringify(s.collection),JSON.stringify(s.museum),s.museumUpdatedAt,JSON.stringify(s.auctionHistory),JSON.stringify(s.stats),Math.max(0,Math.min(10,Math.floor(s.appraiserLevel))),JSON.stringify(s.seen)]);
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

const COLLECTION_RARITY_POINTS=[4,6,9,13,18,24,31,40,50,62,76,92,110,130,152,176,202];
const COLLECTION_RANKS=[
 {level:0,minPoints:0,name:'新米コレクター',appraisalDiscount:0},
 {level:1,minPoints:50,name:'骨董品愛好家',appraisalDiscount:1},
 {level:2,minPoints:150,name:'本格コレクター',appraisalDiscount:2},
 {level:3,minPoints:350,name:'熟練収集家',appraisalDiscount:4},
 {level:4,minPoints:700,name:'名品蒐集家',appraisalDiscount:6},
 {level:5,minPoints:1300,name:'大蒐集家',appraisalDiscount:8},
 {level:6,minPoints:2400,name:'伝説の収集家',appraisalDiscount:10}
];
const COLLECTION_SETS=[
 {id:'materials',title:'素材見本帳',description:'異なる素材を3種類集める',field:'materials',target:3,bonusPoints:15},
 {id:'eras',title:'時代の軌跡',description:'異なる時代の品を3種類集める',field:'eras',target:3,bonusPoints:15},
 {id:'origins',title:'世界の産地',description:'異なる産地の品を3種類集める',field:'origins',target:3,bonusPoints:15},
 {id:'objects',title:'多彩な蒐集家',description:'異なる商品ジャンルを5種類集める',field:'objects',target:5,bonusPoints:15}
];
const COLLECTION_MILESTONES=[
 {id:'pieces-5',target:5,title:'収集の第一歩',description:'ユニークな収集品を5種類集める',xp:100,cash:2000},
 {id:'pieces-15',target:15,title:'確かな目利き',description:'ユニークな収集品を15種類集める',xp:300,cash:7500},
 {id:'pieces-30',target:30,title:'本格的な蒐集家',description:'ユニークな収集品を30種類集める',xp:700,cash:18000},
 {id:'pieces-60',target:60,title:'名品コレクター',description:'ユニークな収集品を60種類集める',xp:1500,cash:45000},
 {id:'pieces-100',target:100,title:'伝説のコレクション',description:'ユニークな収集品を100種類集める',xp:3000,cash:100000}
];
function collectionSummaryForAccount(account){
 const items=Array.isArray(account?.collection)?account.collection:[];
 const unique=new Map();
 for(const item of items){
  if(!item||!item.object)continue;
  const rarityIndex=RARITIES.findIndex(r=>r.key===item.rarity);
  if(rarityIndex<0)continue;
  const key=encodeURIComponent(String(item.object))+'|'+String(item.rarity);
  if(!unique.has(key))unique.set(key,item);
 }
 const pieces=[...unique.values()];
 const distinct={
  // Set progress rewards real variety across the stored specimens, even when two specimens share a catalog slot.
  materials:new Set(items.map(x=>String(x?.material||'').trim()).filter(Boolean)),
  eras:new Set(items.map(x=>String(x?.era||'').trim()).filter(Boolean)),
  origins:new Set(items.map(x=>String(x?.origin||'').trim()).filter(Boolean)),
  objects:new Set(items.map(x=>String(x?.object||'').trim()).filter(Boolean))
 };
 const basePoints=pieces.reduce((sum,item)=>{
  const index=RARITIES.findIndex(r=>r.key===item.rarity);
  return sum+(COLLECTION_RARITY_POINTS[index]||0);
 },0);
 const diversityPoints=distinct.objects.size*4+distinct.materials.size*2+distinct.eras.size*2+distinct.origins.size*2;
 const sets=COLLECTION_SETS.map(set=>{
  const count=distinct[set.field].size;
  return {...set,progress:Math.min(set.target,count),completed:count>=set.target};
 });
 const setPoints=sets.filter(x=>x.completed).reduce((sum,x)=>sum+x.bonusPoints,0);
 const points=basePoints+diversityPoints+setPoints;
 let rank=COLLECTION_RANKS[0],nextRank=null;
 for(let i=0;i<COLLECTION_RANKS.length;i++){
  if(points>=COLLECTION_RANKS[i].minPoints)rank=COLLECTION_RANKS[i];
  else{nextRank=COLLECTION_RANKS[i];break}
 }
 const seen=Array.isArray(account?.seen)?account.seen:[];
 const milestones=COLLECTION_MILESTONES.map(item=>{
  const marker='collection:milestone:'+item.id;
  return {...item,progress:Math.min(item.target,pieces.length),claimed:seen.includes(marker),ready:pieces.length>=item.target};
 });
 return {
  itemCount:items.length,uniquePieces:pieces.length,points,rank:rank.level,rankName:rank.name,
  appraisalDiscount:rank.appraisalDiscount,nextRank:nextRank?{level:nextRank.level,name:nextRank.name,minPoints:nextRank.minPoints}:null,
  pointsToNextRank:nextRank?Math.max(0,nextRank.minPoints-points):0,
  diversity:{materials:distinct.materials.size,eras:distinct.eras.size,origins:distinct.origins.size,objects:distinct.objects.size},
  basePoints,diversityPoints,setPoints,sets,milestones
 };
}

function achievementProgressForAccount(a){
 if(!Array.isArray(a.seen))a.seen=[];
 const seen=a.seen;
 const catalogKeys=new Set();
 const ownedCatalogItems=[...(a.auctionHistory||[]),...(a.inventory||[]),...(a.collection||[]),...(a.museum||[])];
 ownedCatalogItems.forEach(item=>{
  if(!item?.object||!RARITIES.some(r=>r.key===item.rarity))return;
  const key=encodeURIComponent(String(item.object))+'|'+String(item.rarity);
  const marker='catalog:'+key;
  if(!seen.includes(marker))seen.push(marker);
  catalogKeys.add(key);
 });
 seen.forEach(value=>{const marker=String(value||'');if(marker.startsWith('catalog:'))catalogKeys.add(marker.slice(8))});
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
async function readJson(req,maxBytes=32768){
 const chunks=[];let totalBytes=0;
 for await(const chunk of req){
  const buffer=Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk);
  totalBytes+=buffer.length;
  if(totalBytes>maxBytes)throw Object.assign(new Error("送信データが大きすぎます。"),{status:413});
  chunks.push(buffer);
 }
 if(totalBytes===0)return {};
 try{return JSON.parse(Buffer.concat(chunks,totalBytes).toString("utf8"))}
 catch{throw Object.assign(new Error("JSON形式が正しくありません。"),{status:400})}
}
function cleanText(v,max=18){return String(v??"").trim().replace(/[<>]/g,"").slice(0,max)}
function rowToAccountState(a,loginBonus=null){return {account:publicAccount(a),state:publicAccountState(a),...(loginBonus?{loginBonus}: {})}}
function findItem(a,id,place){const key=place==="museum"?"museum":place==="collection"?"collection":"inventory",arr=a[key],index=arr.findIndex(x=>String(x.id)===id);return {key,arr,index,item:index>=0?arr[index]:null}}
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
   const bonusResult=await grantLoginBonus(id),a=bonusResult.account;
   profiles.set(id,a);const token=crypto.randomBytes(32).toString("base64url");
   await pool.query("INSERT INTO am_sessions(token_hash,account_id,expires_at) VALUES($1,$2,$3)",[tokenHash(token),id,new Date(Date.now()+SESSION_DAYS*86400000)]);
   setSessionCookie(req,res,token);sendJson(res,201,rowToAccountState(a,bonusResult.reward));return true;
  }
  if(req.method==="POST"&&path==="/api/auth/login"){
   const b=await readJson(req),key=cleanText(b.username,18).normalize("NFKC").toLocaleLowerCase("ja-JP"),password=String(b.password||"");
   const q=await pool.query("SELECT * FROM am_accounts WHERE username_key=$1",[key]),a=accountFromRow(q.rows[0]);
   if(!a||!password){sendJson(res,401,{error:"ユーザー名またはパスワードが違います。"});return true}
   const derived=await scryptAsync(password,a.passwordSalt,64),stored=Buffer.from(a.passwordHash,"hex");
   if(derived.length!==stored.length||!crypto.timingSafeEqual(derived,stored)){sendJson(res,401,{error:"ユーザー名またはパスワードが違います。"});return true}
   if(isAccountCurrentlyBanned(a)){sendJson(res,403,{error:"このアカウントは利用停止中です。管理者にお問い合わせください。",banReason:a.banReason||''});return true}
   const settledAccount=await settleMuseumAccount(a.id,a);if(settledAccount)Object.assign(a,settledAccount);
   const bonusResult=await grantLoginBonus(a.id);Object.assign(a,bonusResult.account);
   unlockAccountAchievements(a);await persistAccount(a);
   profiles.set(a.id,a);const token=crypto.randomBytes(32).toString("base64url");
   await pool.query("INSERT INTO am_sessions(token_hash,account_id,expires_at) VALUES($1,$2,$3)",[tokenHash(token),a.id,new Date(Date.now()+SESSION_DAYS*86400000)]);
   setSessionCookie(req,res,token);sendJson(res,200,rowToAccountState(a,bonusResult.reward));return true;
  }
  if(req.method==="POST"&&path==="/api/auth/logout"){
   const token=parseCookies(req.headers.cookie).am_session;
   if(token){
    await pool.query("DELETE FROM am_admin_sessions WHERE account_id=(SELECT account_id FROM am_sessions WHERE token_hash=$1)",[tokenHash(token)]);
    await pool.query("DELETE FROM am_sessions WHERE token_hash=$1",[tokenHash(token)]);
   }
   clearSessionCookie(req,res);
   const secure=req.headers["x-forwarded-proto"]==="https"||process.env.NODE_ENV==="production";
   res.setHeader("Set-Cookie","am_admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"+(secure?"; Secure":""));
   sendJson(res,200,{ok:true});return true;
  }
  if(req.method==="GET"&&path==="/api/auth/me"){
   const a=await accountForCookie(req.headers.cookie);if(!a){sendJson(res,401,{error:"ログインしていません。"});return true}
   if(isAccountCurrentlyBanned(a)){sendJson(res,403,{error:"このアカウントは利用停止中です。管理者にお問い合わせください。",banReason:a.banReason||''});return true}
   const settledAccount=await settleMuseumAccount(a.id,a);if(settledAccount)Object.assign(a,settledAccount);
   unlockAccountAchievements(a);await persistAccount(a);
    sendJson(res,200,rowToAccountState(a));return true;
  }
  if(req.method==="GET"&&path==="/api/leaderboard"){
   const q=await pool.query("SELECT id,username,display_name,cash,level,created_at FROM am_accounts WHERE NOT (is_banned AND (banned_until IS NULL OR banned_until>NOW())) ORDER BY cash DESC,created_at ASC,username_key ASC");
   const entries=q.rows.map((r,i)=>({rank:i+1,id:r.id,username:r.username,displayName:r.display_name||r.username,cash:Number(r.cash)||0,level:Number(r.level)||1,createdAt:r.created_at}));
   sendJson(res,200,{total:entries.length,entries});return true;
  }
  const publicPlayer=path.match(/^\/api\/players\/([a-f0-9-]{20,50})$/i);
  if(req.method==="GET"&&publicPlayer){
   const q=await pool.query("SELECT * FROM am_accounts WHERE id=$1",[publicPlayer[1]]),a=accountFromRow(q.rows[0]);
   if(!a){sendJson(res,404,{error:"プレイヤーが見つかりません。"});return true}
   sendJson(res,200,{profile:publicAccount(a),collection:[...a.inventory,...a.collection].map(publicItemRecord),auctionHistory:a.auctionHistory.map(publicItemRecord),stats:a.stats});return true;
  }
  const sessionAccount=await accountForCookie(req.headers.cookie);if(!sessionAccount){sendJson(res,401,{error:"ログインが必要です。"});return true}
  if(isAccountCurrentlyBanned(sessionAccount)){sendJson(res,403,{error:"このアカウントは利用停止中です。管理者にお問い合わせください。",banReason:sessionAccount.banReason||''});return true}
  const account=await settleMuseumAccount(sessionAccount.id,sessionAccount)||sessionAccount;

  if(req.method==="POST"&&path==="/api/admin/login"){
   const body=await readJson(req),code=String(body.code||""),expected=String(process.env.ADMIN_ACCESS_CODE||"");
   if(!expected){sendJson(res,503,{error:"管理者コードがサーバーに設定されていません。Renderの ADMIN_ACCESS_CODE を設定してください。"});return true}
   const ip=String(req.headers["x-forwarded-for"]||req.socket.remoteAddress||"unknown").split(",")[0].trim();
   let attempt=adminLoginAttempts.get(ip)||{count:0,resetAt:0};
   if(attempt.resetAt>Date.now()&&attempt.count>=5){sendJson(res,429,{error:"コード入力の試行回数が上限に達しました。15分後に再試行してください。"});return true}
   const expectedHash=crypto.createHash("sha256").update(expected).digest();
   const providedHash=crypto.createHash("sha256").update(code).digest();
   if(!code||!crypto.timingSafeEqual(expectedHash,providedHash)){
    if(attempt.resetAt<=Date.now())attempt={count:0,resetAt:Date.now()+15*60*1000};
    attempt.count++;adminLoginAttempts.set(ip,attempt);
    sendJson(res,401,{error:"管理者コードが違います。"});return true;
   }
   adminLoginAttempts.delete(ip);
   const token=crypto.randomBytes(32).toString("base64url"),expires=new Date(Date.now()+8*60*60*1000);
   await pool.query("INSERT INTO am_admin_sessions(token_hash,account_id,expires_at) VALUES($1,$2,$3)",[tokenHash(token),account.id,expires]);
   const secure=req.headers["x-forwarded-proto"]==="https"||process.env.NODE_ENV==="production";
   res.setHeader("Set-Cookie","am_admin_session="+encodeURIComponent(token)+"; Path=/; HttpOnly; SameSite=Strict; Max-Age=28800"+(secure?"; Secure":""));
   sendJson(res,200,{ok:true,expiresAt:expires});return true;
  }
  if(req.method==="POST"&&path==="/api/admin/logout"){
   const token=parseCookies(req.headers.cookie).am_admin_session;
   if(token)await pool.query("DELETE FROM am_admin_sessions WHERE token_hash=$1 AND account_id=$2",[tokenHash(token),account.id]);
   const secure=req.headers["x-forwarded-proto"]==="https"||process.env.NODE_ENV==="production";
   res.setHeader("Set-Cookie","am_admin_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0"+(secure?"; Secure":""));
   sendJson(res,200,{ok:true});return true;
  }
  if(req.method==="GET"&&path==="/api/admin/me"){
   if(!await hasAdminSession(req,account.id)){sendJson(res,403,{error:"管理者認証が必要です。"});return true}
   const counts=await pool.query("SELECT COUNT(*)::int AS total,COUNT(*) FILTER(WHERE is_banned AND (banned_until IS NULL OR banned_until>NOW()))::int AS banned FROM am_accounts");
   sendJson(res,200,{admin:{id:account.id,username:account.username,displayName:account.displayName},totalAccounts:counts.rows[0]?.total||0,bannedAccounts:counts.rows[0]?.banned||0,onlinePlayers:sockets.size});return true;
  }
  if(req.method==="GET"&&path==="/api/admin/accounts"){
   if(!await hasAdminSession(req,account.id)){sendJson(res,403,{error:"管理者認証が必要です。"});return true}
   const query=String(url.searchParams.get("q")||"").trim().slice(0,80),pattern="%"+query+"%";
   const filter="($1='' OR username ILIKE $2 OR display_name ILIKE $2 OR id=$3)";
   const rows=await pool.query("SELECT id,username,display_name,cash,level,xp,is_banned,ban_reason,banned_until,created_at,jsonb_array_length(inventory) AS inventory_count,jsonb_array_length(collection) AS collection_count,jsonb_array_length(museum) AS museum_count FROM am_accounts WHERE "+filter+" ORDER BY created_at DESC LIMIT 100",[query,pattern,query]);
   const total=await pool.query("SELECT COUNT(*)::int AS count FROM am_accounts WHERE "+filter,[query,pattern,query]);
   sendJson(res,200,{total:total.rows[0]?.count||0,accounts:rows.rows.map(r=>({id:r.id,username:r.username,displayName:r.display_name||r.username,cash:Number(r.cash)||0,level:Number(r.level)||1,xp:Number(r.xp)||0,isBanned:!!r.is_banned&&(!r.banned_until||new Date(r.banned_until).getTime()>Date.now()),banReason:r.ban_reason||"",bannedUntil:r.banned_until,createdAt:r.created_at,inventoryCount:Number(r.inventory_count)||0,collectionCount:Number(r.collection_count)||0,museumCount:Number(r.museum_count)||0,isOnline:sockets.has(r.id)}))});return true;
  }
  if(req.method==="GET"&&path==="/api/admin/audit"){
   if(!await hasAdminSession(req,account.id)){sendJson(res,403,{error:"管理者認証が必要です。"});return true}
   const q=await pool.query("SELECT l.id,l.action,l.details,l.created_at,actor.username AS actor_username,target.username AS target_username FROM am_admin_audit l JOIN am_accounts actor ON actor.id=l.actor_account_id LEFT JOIN am_accounts target ON target.id=l.target_account_id ORDER BY l.created_at DESC LIMIT 100");
   sendJson(res,200,{entries:q.rows});return true;
  }
  const adminAccountAction=path.match(/^\/api\/admin\/accounts\/([a-f0-9-]{20,50})\/(ban|unban|cash|progress)$/i);
  if(req.method==="POST"&&adminAccountAction){
   if(!await hasAdminSession(req,account.id)){sendJson(res,403,{error:"管理者認証が必要です。"});return true}
   const targetId=adminAccountAction[1],action=adminAccountAction[2],body=await readJson(req);
   if(targetId===account.id&&action!=="cash"&&action!=="progress"){sendJson(res,400,{error:"自分自身へのBAN・解除操作はできません。"});return true}
   if(action==="ban"){
    const reason=String(body.reason||"管理者による利用停止").trim().slice(0,200);
    const durationHours=Math.max(0,Math.min(8760,Math.floor(Number(body.durationHours)||0)));
    const bannedUntil=durationHours>0?new Date(Date.now()+durationHours*3600000):null;
    const updated=await pool.query("UPDATE am_accounts SET is_banned=TRUE,ban_reason=$2,banned_until=$3,updated_at=NOW() WHERE id=$1 RETURNING id",[targetId,reason,bannedUntil]);
    if(!updated.rowCount){sendJson(res,404,{error:"対象アカウントが見つかりません。"});return true}
    await pool.query("DELETE FROM am_sessions WHERE account_id=$1",[targetId]);
    await pool.query("DELETE FROM am_admin_sessions WHERE account_id=$1",[targetId]);
    const cached=profiles.get(targetId);if(cached){cached.isBanned=true;cached.banReason=reason;cached.bannedUntil=bannedUntil}
    const targetSocket=sockets.get(targetId);
    if(targetSocket){safeSend(targetSocket,{type:"error",message:"このアカウントは管理者により利用停止されました。"});leaveRoom(targetSocket);targetSocket.close(4003,"Account banned")}
    await pool.query("INSERT INTO am_admin_audit(actor_account_id,target_account_id,action,details) VALUES($1,$2,'ban',$3::jsonb)",[account.id,targetId,JSON.stringify({reason,durationHours,bannedUntil})]);
    sendJson(res,200,{ok:true,message:durationHours?durationHours+"時間のBANを適用しました。":"永久BANを適用しました。"});return true;
   }
   if(action==="unban"){
    const updated=await pool.query("UPDATE am_accounts SET is_banned=FALSE,ban_reason=NULL,banned_until=NULL,updated_at=NOW() WHERE id=$1 RETURNING id",[targetId]);
    if(!updated.rowCount){sendJson(res,404,{error:"対象アカウントが見つかりません。"});return true}
    const cached=profiles.get(targetId);if(cached){cached.isBanned=false;cached.banReason="";cached.bannedUntil=null}
    await pool.query("INSERT INTO am_admin_audit(actor_account_id,target_account_id,action,details) VALUES($1,$2,'unban','{}'::jsonb)",[account.id,targetId]);
    sendJson(res,200,{ok:true,message:"BANを解除しました。"});return true;
   }
   if(action==="cash"){
    const delta=Number(body.delta);
    if(!Number.isSafeInteger(delta)||delta===0||Math.abs(delta)>1000000000){sendJson(res,400,{error:"増減額は1〜1,000,000,000円の整数で入力してください。"});return true}
    const updated=await pool.query("UPDATE am_accounts SET cash=GREATEST(0,cash+$2::bigint),updated_at=NOW() WHERE id=$1 RETURNING cash",[targetId,String(delta)]);
    if(!updated.rowCount){sendJson(res,404,{error:"対象アカウントが見つかりません。"});return true}
    const cash=Number(updated.rows[0].cash)||0,cached=profiles.get(targetId);
    if(cached){cached.cash=cash;syncOnlineAccount(cached)}
    if(targetId===account.id){account.cash=cash;syncOnlineAccount(account)}
    await pool.query("INSERT INTO am_admin_audit(actor_account_id,target_account_id,action,details) VALUES($1,$2,'cash',$3::jsonb)",[account.id,targetId,JSON.stringify({delta,cash})]);
    const payload={ok:true,message:"所持金を更新しました。",cash};if(targetId===account.id)Object.assign(payload,rowToAccountState(account));sendJson(res,200,payload);return true;
   }
   if(action==="progress"){
    const levelDelta=Number(body.levelDelta||0),xpDelta=Number(body.xpDelta||0);
    if(!Number.isSafeInteger(levelDelta)||Math.abs(levelDelta)>99||!Number.isSafeInteger(xpDelta)||Math.abs(xpDelta)>1000000000||(!levelDelta&&!xpDelta)){sendJson(res,400,{error:"レベルは±99、XPは±1,000,000,000以内の整数で指定してください。"});return true}
    const client=await pool.connect();let level=1,xp=0;
    try{
     await client.query("BEGIN");
     const locked=await client.query("SELECT level,xp FROM am_accounts WHERE id=$1 FOR UPDATE",[targetId]);
     if(!locked.rowCount){await client.query("ROLLBACK");sendJson(res,404,{error:"対象アカウントが見つかりません。"});return true}
     const progress={level:Math.max(1,Math.min(100,Number(locked.rows[0].level)||1)),xp:Math.max(0,Number(locked.rows[0].xp)||0)};
     progress.level=Math.max(1,Math.min(100,progress.level+levelDelta));
     if(xpDelta>0)addAccountXp(progress,xpDelta);
     else if(xpDelta<0)progress.xp=Math.max(0,progress.xp+xpDelta);
     const saved=await client.query("UPDATE am_accounts SET level=$2,xp=$3,updated_at=NOW() WHERE id=$1 RETURNING level,xp",[targetId,progress.level,String(progress.xp)]);
     await client.query("COMMIT");level=Number(saved.rows[0].level)||1;xp=Number(saved.rows[0].xp)||0;
    }catch(error){try{await client.query("ROLLBACK")}catch{}throw error}finally{client.release()}
    if(targetId===account.id){account.level=level;account.xp=xp}
    const liveAccount=targetId===account.id?account:profiles.get(targetId);
    if(liveAccount){liveAccount.level=level;liveAccount.xp=xp;syncOnlineAccount(liveAccount)}
    await pool.query("INSERT INTO am_admin_audit(actor_account_id,target_account_id,action,details) VALUES($1,$2,'progress',$3::jsonb)",[account.id,targetId,JSON.stringify({levelDelta,xpDelta,level,xp})]);
    const payload={ok:true,level,xp,message:"レベル・XPを変更しました。Lv."+level+" / "+xp.toLocaleString("ja-JP")+" XP"};
    if(targetId===account.id)Object.assign(payload,rowToAccountState(account));
    sendJson(res,200,payload);return true;
   }
  }
  if(req.method==="GET"&&path==="/api/museum"){
   sendJson(res,200,{...rowToAccountState(account),museumSummary:museumSummaryForAccount(account)});return true;
  }
  if(req.method==="GET"&&path==="/api/events"){sendJson(res,200,weeklyEventPayload(account));return true}
  if(req.method==="POST"&&path==="/api/events/claim"){
   const b=await readJson(req),challenge=WEEKLY_EVENT_CHALLENGES.find(x=>x.id===String(b.id||''));
   if(!challenge){sendJson(res,400,{error:"イベント報酬が見つかりません。"});return true}
   const weekly=weeklyEventProgress(account),marker='event:weekly:'+weekly.weekKey+':'+challenge.id;
   if(account.seen.includes(marker)){sendJson(res,409,{error:"このイベント報酬は受け取り済みです。"});return true}
   if((Number(weekly[challenge.field])||0)<challenge.target){sendJson(res,409,{error:"イベントの達成条件を満たしていません。"});return true}
   const reserved=await pool.query("UPDATE am_accounts SET seen=seen || jsonb_build_array($2::text) WHERE id=$1 AND NOT (seen ? $2)",[account.id,marker]);
   if(!reserved.rowCount){sendJson(res,409,{error:"このイベント報酬は受け取り済みです。"});return true}
   account.seen.push(marker);account.cash=(Number(account.cash)||0)+challenge.cash;addAccountXp(account,challenge.xp);
   unlockAccountAchievements(account);await persistAccount(account);syncOnlineAccount(account);
   sendJson(res,200,{...rowToAccountState(account),message:'イベント報酬を受け取りました。 +'+challenge.xp+' XP / '+challenge.cash.toLocaleString('ja-JP')+'円'});return true;
  }
if(req.method==="POST"&&path==="/api/tutorial/complete"){
   const marker="tutorial:beginner-v1";
   if(!Array.isArray(account.seen))account.seen=[];
   let awarded=false;
   if(!account.seen.includes(marker)){
    const reserved=await pool.query("UPDATE am_accounts SET seen=seen || jsonb_build_array($2::text) WHERE id=$1 AND NOT (seen ? $2)",[account.id,marker]);
    if(reserved.rowCount){account.seen.push(marker);addAccountXp(account,1100);unlockAccountAchievements(account);await persistAccount(account);syncOnlineAccount(account);awarded=true}
   }
   sendJson(res,200,{...rowToAccountState(account),message:awarded?"チュートリアル完了！ 1,100 XPを獲得しました。":"このチュートリアル報酬は受け取り済みです。"});return true;
  }
  if(req.method==="GET"&&path==="/api/guilds"){
 const q=await pool.query("SELECT g.id,g.name,g.owner_id,COALESCE(o.display_name,o.username) AS owner_name,COUNT(m.account_id)::int AS member_count,COALESCE(SUM(a.cash),0)::numeric AS total_wealth FROM am_guilds g JOIN am_accounts o ON o.id=g.owner_id LEFT JOIN am_guild_members m ON m.guild_id=g.id LEFT JOIN am_accounts a ON a.id=m.account_id GROUP BY g.id,o.display_name,o.username ORDER BY total_wealth DESC,member_count DESC,g.created_at ASC LIMIT 50");
 sendJson(res,200,{guilds:q.rows.map(r=>({id:r.id,name:r.name,ownerName:r.owner_name,memberCount:Number(r.member_count)||0,totalWealth:Number(r.total_wealth)||0,createdAt:r.created_at}))});return true;
}
if(req.method==="GET"&&path==="/api/guilds/me"){
 const q=await pool.query("SELECT g.id,g.name,g.owner_id,m.role,m.joined_at FROM am_guild_members m JOIN am_guilds g ON g.id=m.guild_id WHERE m.account_id=$1",[account.id]);
 if(!q.rowCount){sendJson(res,200,{guild:null,members:[],exhibits:[],achievements:[],totals:{members:0,auctions:0,wins:0,sales:0}});return true}
 const g=q.rows[0],members=await pool.query("SELECT a.id,a.display_name,a.username,a.level,a.cash,a.stats,m.role,m.joined_at FROM am_guild_members m JOIN am_accounts a ON a.id=m.account_id WHERE m.guild_id=$1 ORDER BY CASE WHEN m.role='owner' THEN 0 ELSE 1 END,m.joined_at ASC",[g.id]);
 const inventoryRows=await pool.query("SELECT COALESCE(a.display_name,a.username) AS member_name,a.inventory FROM am_guild_members m JOIN am_accounts a ON a.id=m.account_id WHERE m.guild_id=$1",[g.id]);
 const guildExhibits=[];
 for(const member of inventoryRows.rows){
  let inventory=member.inventory;
  if(typeof inventory==="string"){try{inventory=JSON.parse(inventory)}catch{inventory=[]}}
  if(!Array.isArray(inventory))continue;
  for(const item of inventory){
   if(!item||typeof item!=="object")continue;
   const estimate=Number(item.appraisal?.estimate)||0,marketValue=Number(item.marketValue)||0;
   const value=estimate>0?estimate:marketValue;
   if(!Number.isFinite(value)||value<=0)continue;
   guildExhibits.push({id:String(item.id||""),name:String(item.name||item.object||"展示品"),emoji:String(item.emoji||"💎"),rarity:String(item.rarity||"N"),condition:String(item.condition||""),memberName:String(member.member_name||"メンバー"),value,appraised:estimate>0});
  }
 }
 guildExhibits.sort((a,b)=>b.value-a.value);
 const exhibits=guildExhibits.slice(0,3);
 const guildMilestones=guildAchievementPayload(members.rows);
 sendJson(res,200,{guild:{id:g.id,name:g.name,ownerId:g.owner_id,role:g.role,joinedAt:g.joined_at},members:members.rows.map(m=>({id:m.id,name:m.display_name||m.username,level:Number(m.level)||1,cash:Number(m.cash)||0,role:m.role,joinedAt:m.joined_at})),exhibits,achievements:guildMilestones.achievements,totals:guildMilestones.totals});return true;
}
if(req.method==="GET"&&path==="/api/guilds/messages"){
 const member=await pool.query("SELECT guild_id FROM am_guild_members WHERE account_id=$1",[account.id]);
 if(!member.rowCount){sendJson(res,403,{error:"ギルドに加入していません。"});return true}
 const q=await pool.query("SELECT m.id,m.body,m.created_at,a.display_name,a.username FROM am_guild_messages m JOIN am_accounts a ON a.id=m.account_id WHERE m.guild_id=$1 ORDER BY m.created_at DESC LIMIT 50",[member.rows[0].guild_id]);
 sendJson(res,200,{messages:q.rows.reverse().map(m=>({id:m.id,body:m.body,name:m.display_name||m.username,createdAt:m.created_at}))});return true;
}
if(req.method==="POST"&&path==="/api/guilds/messages"){
 const b=await readJson(req),body=cleanText(b.body,200);
 if(!body){sendJson(res,400,{error:"投稿内容を入力してください。"});return true}
 const member=await pool.query("SELECT guild_id FROM am_guild_members WHERE account_id=$1",[account.id]);
 if(!member.rowCount){sendJson(res,403,{error:"ギルドに加入していません。"});return true}
 const recent=await pool.query("SELECT id FROM am_guild_messages WHERE account_id=$1 AND created_at>NOW()-INTERVAL '3 seconds' LIMIT 1",[account.id]);
 if(recent.rowCount){sendJson(res,429,{error:"投稿は3秒に1回までです。"});return true}
 const id=crypto.randomUUID();
 await pool.query("INSERT INTO am_guild_messages(id,guild_id,account_id,body) VALUES($1,$2,$3,$4)",[id,member.rows[0].guild_id,account.id,body]);
 sendJson(res,201,{ok:true,message:"ギルド掲示板に投稿しました。"});return true;
}
if(req.method==="POST"&&path==="/api/guilds/create"){
 const b=await readJson(req),name=cleanText(b.name,16),nameKey=name.normalize("NFKC").toLocaleLowerCase("ja-JP");
 if(name.length<3){sendJson(res,400,{error:"ギルド名は3〜16文字で入力してください。"});return true}
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const locked=await client.query("SELECT cash FROM am_accounts WHERE id=$1 FOR UPDATE",[account.id]);
  if(!locked.rowCount){await client.query("ROLLBACK");sendJson(res,404,{error:"アカウントが見つかりません。"});return true}
  if(Number(locked.rows[0].cash)<100000){await client.query("ROLLBACK");sendJson(res,400,{error:"ギルド設立には¥100,000が必要です。"});return true}
  const member=await client.query("SELECT guild_id FROM am_guild_members WHERE account_id=$1",[account.id]);
  if(member.rowCount){await client.query("ROLLBACK");sendJson(res,409,{error:"すでにギルドへ加入しています。"});return true}
  const id=crypto.randomUUID();
  await client.query("INSERT INTO am_guilds(id,name,name_key,owner_id) VALUES($1,$2,$3,$4)",[id,name,nameKey,account.id]);
  await client.query("INSERT INTO am_guild_members(guild_id,account_id,role) VALUES($1,$2,'owner')",[id,account.id]);
  await client.query("UPDATE am_accounts SET cash=cash-100000,updated_at=NOW() WHERE id=$1",[account.id]);
  await client.query("COMMIT");
  const updated=await getAccountById(account.id);if(updated){await persistAccount(updated);syncOnlineAccount(updated)}
  sendJson(res,201,{...rowToAccountState(updated||account),message:"ギルドを設立しました。設立費用として¥100,000を支払いました。"});return true;
 }catch(err){try{await client.query("ROLLBACK")}catch{}if(err.code==="23505"){sendJson(res,409,{error:"同じ名前のギルドがあるか、すでに加入しています。"});return true}throw err}
 finally{client.release()}
}
if(req.method==="POST"&&path==="/api/guilds/join"){
 const b=await readJson(req),guildId=String(b.guildId||"").slice(0,80),client=await pool.connect();
 try{
  await client.query("BEGIN");
  const g=await client.query("SELECT id FROM am_guilds WHERE id=$1 FOR UPDATE",[guildId]);
  if(!g.rowCount){await client.query("ROLLBACK");sendJson(res,404,{error:"ギルドが見つかりません。"});return true}
  const existing=await client.query("SELECT guild_id FROM am_guild_members WHERE account_id=$1",[account.id]);
  if(existing.rowCount){await client.query("ROLLBACK");sendJson(res,409,{error:"すでにギルドへ加入しています。"});return true}
  const count=await client.query("SELECT COUNT(*)::int AS n FROM am_guild_members WHERE guild_id=$1",[guildId]);
  if(Number(count.rows[0].n)>=30){await client.query("ROLLBACK");sendJson(res,409,{error:"このギルドは30人の定員に達しています。"});return true}
  await client.query("INSERT INTO am_guild_members(guild_id,account_id,role) VALUES($1,$2,'member')",[guildId,account.id]);
  await client.query("COMMIT");sendJson(res,200,{ok:true,message:"ギルドに加入しました。"});return true;
 }catch(err){try{await client.query("ROLLBACK")}catch{}if(err.code==="23505"){sendJson(res,409,{error:"すでに別のギルドへ加入しています。"});return true}throw err}finally{client.release()}
}
if(req.method==="POST"&&path==="/api/guilds/leave"){
 const client=await pool.connect();
 try{
  await client.query("BEGIN");
  const membership=await client.query("SELECT guild_id,role FROM am_guild_members WHERE account_id=$1 FOR UPDATE",[account.id]);
  if(!membership.rowCount){await client.query("ROLLBACK");sendJson(res,404,{error:"加入中のギルドがありません。"});return true}
  const m=membership.rows[0];
  if(m.role==='owner'){
   const count=await client.query("SELECT COUNT(*)::int AS n FROM am_guild_members WHERE guild_id=$1",[m.guild_id]);
   if(Number(count.rows[0].n)>1){await client.query("ROLLBACK");sendJson(res,409,{error:"ギルドマスターは、メンバーがいる間は脱退できません。先にギルドを解散してください。"});return true}
   await client.query("DELETE FROM am_guilds WHERE id=$1",[m.guild_id]);
  }else await client.query("DELETE FROM am_guild_members WHERE guild_id=$1 AND account_id=$2",[m.guild_id,account.id]);
  await client.query("COMMIT");sendJson(res,200,{ok:true,message:"ギルドを脱退しました。"});return true;
 }catch(err){try{await client.query("ROLLBACK")}catch{}throw err}finally{client.release()}
}
if(req.method==="POST"&&path==="/api/guilds/disband"){
 const b=await readJson(req),guildId=String(b.guildId||"").slice(0,80);
 const deleted=await pool.query("DELETE FROM am_guilds WHERE id=$1 AND owner_id=$2",[guildId,account.id]);
 if(!deleted.rowCount){sendJson(res,403,{error:"ギルドマスターのみ解散できます。"});return true}
 sendJson(res,200,{ok:true,message:"ギルドを解散しました。"});return true;
}
if(req.method==="GET"&&path==="/api/trades"){
   const q=await pool.query("SELECT t.*,s.username AS seller_username,s.display_name AS seller_display_name,b.username AS buyer_username,b.display_name AS buyer_display_name FROM am_trade_offers t JOIN am_accounts s ON s.id=t.seller_id JOIN am_accounts b ON b.id=t.buyer_id WHERE t.seller_id=$1 OR t.buyer_id=$1 ORDER BY t.created_at DESC LIMIT 100",[account.id]);
   sendJson(res,200,{offers:q.rows.map(r=>({id:r.id,sellerId:r.seller_id,buyerId:r.buyer_id,itemId:r.item_id,item:publicItemRecord(r.item_json),offerAmount:Number(r.offer_amount)||0,status:r.status,createdAt:r.created_at,respondedAt:r.responded_at,sellerName:r.seller_display_name||r.seller_username,buyerName:r.buyer_display_name||r.buyer_username,incoming:r.seller_id===account.id}))});return true;
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

  if(req.method==="POST"&&path==="/api/appraiser/secret-reward"){
   const secretBody=await readJson(req);
   if(String(secretBody.code||"").trim().toUpperCase()!=="AAA"){sendJson(res,400,{error:"記録コードが一致しません。"});return true}
   const client=await pool.connect();
   let rewardItem=null,lockedAccount=null;
   const marker="secret:appraiser:aaa-sp";
   try{
    await client.query("BEGIN");
    const lockedResult=await client.query("SELECT * FROM am_accounts WHERE id=$1 FOR UPDATE",[account.id]);
    lockedAccount=accountFromRow(lockedResult.rows[0]);
    if(!lockedAccount){await client.query("ROLLBACK");sendJson(res,404,{error:"アカウントが見つかりません。"});return true}
    if(lockedAccount.seen.includes(marker)){
     await client.query("ROLLBACK");sendJson(res,409,{error:"この隠し報酬はすでに受け取り済みです。"});return true;
    }
    rewardItem=makeItem(100);
    const special=RARITIES.find(r=>r.key==="SP");
    rewardItem.rarity="SP";
    rewardItem.rarityName=special?.name||"スペシャル";
    rewardItem.referenceMarketValue=randInt(30000000000,100000000000);
    rewardItem.marketValue=rewardItem.referenceMarketValue;
    rewardItem.authenticityCode="genuine";
    rewardItem.fakeValueFactor=1;
    rewardItem.startBid=Math.max(500,Math.round(rewardItem.marketValue*rand(.12,.22)/100)*100);
    lockedAccount.inventory.push(rewardItem);
    lockedAccount.seen.push(marker);
    const catalogMarker='catalog:'+encodeURIComponent(String(rewardItem.object||''))+'|SP';
    if(rewardItem.object&&!lockedAccount.seen.includes(catalogMarker))lockedAccount.seen.push(catalogMarker);
    await persistAccount(lockedAccount,client);
    await client.query("COMMIT");
   }catch(error){
    try{await client.query("ROLLBACK")}catch{}
    throw error;
   }finally{client.release()}
   syncOnlineAccount(lockedAccount);
   sendJson(res,200,{...rowToAccountState(lockedAccount),rewardItem,message:"隠し報酬を獲得しました！ SPの品を所持品に追加しました。"});
   return true;
  }

  if(req.method==="POST"&&path==="/api/appraiser/upgrade"){
   const current=Math.max(0,Math.min(10,Number(account.appraiserLevel)||0)),next=APPRAISERS[current];
   if(!next){sendJson(res,409,{error:"鑑定士はすでに最高レベルです。"});return true}
   if(account.cash<next.cost){sendJson(res,400,{error:"鑑定士の雇用・昇格には¥"+next.cost.toLocaleString("ja-JP")+"が必要です。"});return true}
   account.cash-=next.cost;account.appraiserLevel=next.level;await persistAccount(account);syncOnlineAccount(account);
   sendJson(res,200,{...rowToAccountState(account),message:next.title+"を雇用・昇格しました。"});return true;
  }

  if(req.method==="GET"&&path==="/api/collection"){
   sendJson(res,200,{summary:collectionSummaryForAccount(account)});return true;
  }
  if(req.method==="POST"&&path==="/api/collection/claim"){
   const b=await readJson(req),milestone=COLLECTION_MILESTONES.find(x=>x.id===String(b.id||''));
   if(!milestone){sendJson(res,400,{error:"コレクション報酬が見つかりません。"});return true}
   const summary=collectionSummaryForAccount(account);
   if(summary.uniquePieces<milestone.target){sendJson(res,409,{error:"収集品の種類がまだ足りません。"});return true}
   const marker='collection:milestone:'+milestone.id;
   if(account.seen.includes(marker)){sendJson(res,409,{error:"この収集報酬は受け取り済みです。"});return true}
   const reserved=await pool.query("UPDATE am_accounts SET seen=seen || jsonb_build_array($2::text) WHERE id=$1 AND NOT (seen ? $2)",[account.id,marker]);
   if(!reserved.rowCount){sendJson(res,409,{error:"この収集報酬は受け取り済みです。"});return true}
   account.seen.push(marker);account.cash=(Number(account.cash)||0)+milestone.cash;
   addAccountXp(account,milestone.xp);unlockAccountAchievements(account);
   await persistAccount(account);syncOnlineAccount(account);
   sendJson(res,200,{...rowToAccountState(account),summary:collectionSummaryForAccount(account),message:'コレクション報酬を獲得！ +'+milestone.xp.toLocaleString('ja-JP')+' XP / '+milestone.cash.toLocaleString('ja-JP')+'円'});
   return true;
  }
  const itemMatch=path.match(/^\/api\/items\/([^/]+)\/(appraise|sell|store|retrieve|exhibit|unexhibit)$/);
  if(req.method==="POST"&&itemMatch){
   const id=decodeURIComponent(itemMatch[1]),action=itemMatch[2],b=await readJson(req),requestedPlace=b.place,place=action==="unexhibit"?"museum":action==="appraise"&&requestedPlace==="museum"?"museum":requestedPlace==="collection"?"collection":"inventory",f=findItem(account,id,place);
   if(!f.item){sendJson(res,404,{error:"対象の商品が見つかりません。"});return true}
   const item=f.item;
   if(action==="appraise"){
    if(item.appraisal){sendJson(res,409,{error:"この商品はすでに鑑定済みです。"});return true}
    const level=Math.max(0,Math.min(10,Number(account.appraiserLevel)||0));if(!level){sendJson(res,400,{error:"先に鑑定士を雇用してください。"});return true}
    const app=APPRAISERS[level-1],baseFee=Math.max(500,Math.round((Number(item.marketValue)||0)*(.014-(level-1)*.0011))),collectionDiscount=collectionSummaryForAccount(account).appraisalDiscount,fee=Math.max(500,Math.round(baseFee*(1-collectionDiscount/100)));
    if(account.cash<fee){sendJson(res,400,{error:"鑑定料 "+fee.toLocaleString("ja-JP")+"円が必要です。"});return true}
    account.cash-=fee;const exact=Math.random()*100<app.accuracy,trueIndex=RARITIES.findIndex(r=>r.key===item.rarity);
    let ri=trueIndex<0?0:trueIndex;if(!exact)ri=clamp(ri+(Math.random()<.5?-1:1),0,RARITIES.length-1);
    const error=(100-app.accuracy)/100,estimate=(Number(item.marketValue)||0)*rand(1-error,1+error),estimateLow=Math.max(0,Math.floor(estimate/(1+error)/100)*100),estimateHigh=Math.ceil(estimate/(1-error)/100)*100,resaleLow=Math.round(estimateLow*.78),resaleHigh=Math.round(estimateHigh*.94);
    const detectionRate=APPRAISER_FAKE_DETECTION[level-1]||0,authenticityWarning=item.authenticityCode!=='genuine'&&Math.random()*100<detectionRate;
    item.appraised=true;item.appraisal={reportId:'AMR-'+Date.now()+'-'+crypto.randomBytes(3).toString('hex').toUpperCase(),appraiserTitle:app.title,appraisedAt:new Date().toISOString(),rank:RARITIES[ri].key,rankName:RARITIES[ri].name,estimate:Math.round(estimate),estimateLow,estimateHigh,resaleLow,resaleHigh,accuracy:app.accuracy,fee,collectionDiscount,authenticityWarning,authenticityMessage:authenticityWarning?'偽物の疑いを検出しました':'偽物の兆候は確認されませんでした（完全な保証ではありません）',fakeDetectionRate:detectionRate};
    const historyItem=account.auctionHistory.find(entry=>String(entry.id)===String(item.id));
    if(historyItem){historyItem.appraised=true;historyItem.appraisal={...item.appraisal}}
    account.stats.appraisals=(Number(account.stats.appraisals)||0)+1;recordWeeklyEvent(account,'appraisals');unlockAccountAchievements(account);
   }else if(action==="sell"){
    if(place!=="inventory"){sendJson(res,400,{error:"コレクションから直接売却することはできません。"});return true}
    const sale=Math.round((Number(item.marketValue)||0)*(item.appraisal?rand(.78,.94):rand(.43,.62))),profit=sale-(Number(item.auctionPaid)||0);
    account.cash+=sale;account.stats.sales=(Number(account.stats.sales)||0)+1;recordWeeklyEvent(account,'sales');account.stats.profit=(Number(account.stats.profit)||0)+profit;f.arr.splice(f.index,1);
    const history=account.auctionHistory.find(h=>h.id===item.id);if(history){history.saleAmount=sale;history.soldAt=Date.now()}
    addAccountXp(account,12+Math.max(0,Math.min(30,Math.floor(profit/10000))));unlockAccountAchievements(account);await persistAccount(account);syncOnlineAccount(account);
    sendJson(res,200,{...rowToAccountState(account),message:"商品を売却しました。",sale,profit});return true;
   }else if(action==="store"){
    if(place!=="inventory"){sendJson(res,400,{error:"この商品はすでにコレクションにあります。"});return true}
    account.inventory.splice(f.index,1);account.collection.unshift(item);
   }else if(action==="retrieve"){
    if(place!=="collection"){sendJson(res,400,{error:"この商品はコレクションにありません。"});return true}
    account.collection.splice(f.index,1);account.inventory.unshift(item);
   }else if(action==="exhibit"){
    if(place==="museum"){sendJson(res,409,{error:"この商品はすでに博物館に展示されています。"});return true}
    if(account.museum.length>=MUSEUM_MAX_EXHIBITS){sendJson(res,409,{error:"博物館の展示枠がいっぱいです。展示を終了してから追加してください。"});return true}
    f.arr.splice(f.index,1);account.museum.unshift(item);account.museumUpdatedAt=new Date().toISOString();
   }else if(action==="unexhibit"){
    if(place!=="museum"){sendJson(res,400,{error:"博物館に展示されていません。"});return true}
    account.museum.splice(f.index,1);account.inventory.unshift(item);account.museumUpdatedAt=new Date().toISOString();
   }
   await persistAccount(account);syncOnlineAccount(account);
   const message=action==="appraise"?"鑑定しました。":action==="store"?"コレクションに保管しました。":action==="retrieve"?"所持品に戻しました。":action==="exhibit"?"博物館に展示しました。":action==="unexhibit"?"展示を終了し、所持品に戻しました。":"更新しました。";
   sendJson(res,200,{...rowToAccountState(account),message,museumSummary:museumSummaryForAccount(account)});return true;
  }
  sendJson(res,404,{error:"API endpoint not found"});return true;
 }catch(err){console.error("API error:",err);if(!res.headersSent)sendJson(res,Number(err.status)||500,{error:Number(err.status)?err.message:"サーバー処理中にエラーが発生しました。"});return true}
}
function makeItem(level,roomBand=levelBand(level),forcedRarityKey=null){
 const currentLevel=Math.max(1,Math.min(100,Math.floor(Number(level)||1)));
 const currentBand=Math.max(0,Math.min(9,Math.floor(Number(roomBand)||0)));
 const available=RARITIES.filter(r=>r.unlock<=currentLevel).map(r=>({
  rarity:r,
  weight:r.weight*Math.pow(.06,Math.max(0,currentBand-levelBand(r.unlock)))*Math.pow(1.05,currentBand*levelBand(r.unlock))
 }));
 const total=available.reduce((sum,entry)=>sum+entry.weight,0);
 const forcedRarity=forcedRarityKey?RARITIES.find(r=>r.key===forcedRarityKey):null;
 let n=Math.random()*total,rarity=forcedRarity||available[0]?.rarity||RARITIES[0];
 if(!forcedRarity)for(const entry of available){n-=entry.weight;if(n<=0){rarity=entry.rarity;break}}
 const obj=pick(OBJECTS),material=pick(MATERIALS),era=pick(ERAS),origin=pick(ORIGINS),motif=pick(MOTIFS),condition=pick(CONDITIONS);
 const withinBandProgress=Math.max(0,Math.min(9,currentLevel-(currentBand*10+1)));
 const roomPriceFactor=Math.pow(1.28,currentBand)*Math.pow(1.025,withinBandProgress),referenceMarketValue=Math.round(randInt(rarity.min,rarity.max)*roomPriceFactor);
 const authenticityCode=rollAuthenticity(rarity.key),fakeValueFactor=authenticityCode==='high_fake'?rand(.15,.30):authenticityCode==='low_fake'?rand(.01,.05):1;
 const trend=marketTrendFor(material),conditionFactor=CONDITION_MARKET_FACTORS[condition]||1;
 const marketEvent=getWeeklyMarketEvent(),eventMatch=marketEventMatchesItem(marketEvent,{object:obj[0],material,era}),eventFactor=eventMatch?1+marketEvent.bonusPercent/100:1;
 const marketValue=Math.max(100,Math.round(referenceMarketValue*fakeValueFactor*trend.factor*conditionFactor*eventFactor));
 const auctioneerValue=authenticityCode==='genuine'
  ? marketValue
  : Math.max(100,Math.round(referenceMarketValue*trend.factor*conditionFactor*eventFactor));
 const startBid=Math.max(500,Math.round(auctioneerValue*rand(.12,.22)/100)*100);
 return {id:'AM-'+crypto.randomBytes(5).toString('hex').toUpperCase(),name:`${era}の${material}${obj[0]}「${motif}」`,emoji:obj[1],object:obj[0],material,era,origin,motif,condition,rarity:rarity.key,rarityName:rarity.name,marketValue,referenceMarketValue,authenticityCode,fakeValueFactor,marketTrendLabel:trend.label,marketTrendPercent:Math.round((trend.factor-1)*100),marketConditionPercent:Math.round((conditionFactor-1)*100),marketEventLabel:eventMatch?marketEvent.title:null,marketEventPercent:eventMatch?marketEvent.bonusPercent:0,startBid,createdAt:Date.now()};
}
function createAuction(room) {
  const activeLevels = [...room.players.values()].map(p => p.level);
  const effectiveLevel = activeLevels.length ? Math.max(...activeLevels) : room.levelBand * 10 + 1;
  const effectiveBand = levelBand(effectiveLevel);
  // Matchmaking band is fixed when the room is created; only auction difficulty follows player progression.
  room.bots.forEach((bot,index)=>{
    bot.level=effectiveLevel;
    bot.cash=Math.max(Number(bot.cash)||0,botCapitalForLevel(effectiveLevel,index));
  });
  const item = makeItem(effectiveLevel, effectiveBand, room.isPrivate ? pick(RARITIES).key : null);
  room.auction = {
    item, currentBid: item.startBid, highestBidderId: null, highestBidderName: null,
    highestBidderIsBot: false, status: 'live', endsAt: Date.now() + AUCTION_SECONDS * 1000,
    round: (room.round || 0) + 1, log: [], appraiserPreviews: {}, botAssessments:{}, passedPlayers:new Set(), extensionMs:0
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
  const preview={rank:RARITIES[rankIndex].key,rankName:RARITIES[rankIndex].name,estimate,accuracy:app.accuracy,estimateLow,estimateHigh,
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
    marketTrendLabel:auction.item.marketTrendLabel||'相場安定',marketTrendPercent:Number(auction.item.marketTrendPercent)||0,marketConditionPercent:Number(auction.item.marketConditionPercent)||0,marketEventLabel:auction.item.marketEventLabel||null,marketEventPercent:Number(auction.item.marketEventPercent)||0
  } : null;
  return {
    roomId: room.id, levelBand: roomMatchBand(room), bandText: bandLabel(roomMatchBand(room)),
    players: allSeats(room).map(p => ({
      id:p.id,name:p.name,icon:p.icon,level:p.level,isBot:!!p.isBot,cash:Number(p.cash)||0,
      style:p.isBot?p.style:undefined,isYou:p.id===forPlayerId,
      isLeading:auction?.highestBidderId===p.id,passed:!!auction?.passedPlayers?.has(p.id)
    })),
    auction: auction ? {
      item: publicItem, currentBid: auction.currentBid,
      highestBidderId: auction.highestBidderId, highestBidderName: auction.highestBidderName,
      highestBidderIsBot: auction.highestBidderIsBot, status: auction.status,
      endsAt: auction.endsAt, round: auction.round, appraiserPreview,
      passed: !!currentPlayer && !!auction.passedPlayers?.has(forPlayerId)
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
function pruneDisconnectedRoomPlayers(room) {
  for (const [id, player] of room.players) {
    if (player.ws?.readyState === WebSocket.OPEN) continue;
    room.players.delete(id);
    if (sockets.get(id) === player.ws) sockets.delete(id);
    if (player.ws?.playerId === id) { player.ws.playerId = null; player.ws.roomId = null; }
  }
  return !closeRoomIfEmpty(room);
}
function socketCanJoinAccount(account, ws) {
  if (!account || ws.readyState !== WebSocket.OPEN) return false;
  const active = sockets.get(account.id);
  if (active && active !== ws && Number(active.connectionSequence || 0) > Number(ws.connectionSequence || 0)) {
    safeSend(ws, { type: 'error', message: 'この接続は古くなっています。ページを再読み込みして、もう一度接続してください。' });
    return false;
  }
  return true;
}
function sendExistingRoomIfJoined(account, ws) {
  const room = ws.roomId ? rooms.get(ws.roomId) : null;
  const player = room?.players.get(account.id);
  if (!player || player.ws !== ws) return false;
  sendJoined(player, room);
  return true;
}
function botCapitalForLevel(level,index=0){
 const safeLevel=Math.max(1,Math.min(100,Math.floor(Number(level)||1)));
 const base=180000+Math.max(0,Number(index)||0)*22500;
 return Math.round(base*Math.pow(1.23,safeLevel-1));
}
function createRoom(band, isPrivate = false) {
  const id = `AM-${String(nextRoomNo++).padStart(4, '0')}-${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  let inviteCode = null;
  if (isPrivate) { const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; inviteCode = Array.from({length:6}, () => chars[randInt(0, chars.length - 1)]).join(''); while ([...rooms.values()].some(r => r.inviteCode === inviteCode)) inviteCode = Array.from({length:6}, () => chars[randInt(0, chars.length - 1)]).join(''); }
  const botLevel=band*10+1;
  const bots = BOT_TEMPLATES.map((b, i) => ({ ...b, id: `bot-${id}-${i}`, level: botLevel, isBot: true, isYou: false, cash: botCapitalForLevel(botLevel,i) }));
  const fixedBand = Math.max(0, Math.min(9, Math.floor(Number(band) || 0)));
  const room = { id, levelBand: fixedBand, matchBand: fixedBand, isPrivate, inviteCode, players: new Map(), bots, round: 0, auction: null, timer: null, botNextAt: 0, nextAuctionAt: null, log: [] };
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
 const account=await getAccountById(ws.accountId);
 return isAccountCurrentlyBanned(account)?null:account;
}
async function joinQuick(ws){
 const account=await authenticatedPlayer(ws);
 if(!account)return safeSend(ws,{type:'error',message:'先にアカウントへログインしてください。'});
 if(!socketCanJoinAccount(account,ws))return;
 if(sendExistingRoomIfJoined(account,ws))return;
 const id=account.id,level=Math.max(1,Math.min(100,Number(account.level)||1)),band=levelBand(level);
 detachIdentity(id,ws);
 const player={id,name:account.displayName||account.username,level,cash:Number(account.cash)||0,ws,roomId:null,account};
 profiles.set(id,account);
 let room=null;
 for(const candidate of [...rooms.values()]){
  if(candidate.isPrivate||roomMatchBand(candidate)!==band)continue;
  if(!pruneDisconnectedRoomPlayers(candidate))continue;
  if(candidate.players.size<MAX_SEATS){room=candidate;break;}
 }
 if(!room)room=createRoom(band);
 room.players.set(id,player);
 if(!room.auction)createAuction(room);
 sockets.set(id,ws);ws.playerId=id;ws.roomId=room.id;sendJoined(player,room);
}
async function createPrivate(ws){
 const account=await authenticatedPlayer(ws);
 if(!account)return safeSend(ws,{type:'error',message:'先にアカウントへログインしてください。'});
 if(!socketCanJoinAccount(account,ws))return;
 if(sendExistingRoomIfJoined(account,ws))return;
 const id=account.id;
 detachIdentity(id,ws);
 const level=Math.max(1,Math.min(100,Number(account.level)||1));
 const player={id,name:account.displayName||account.username,level,cash:Number(account.cash)||0,ws,roomId:null,account};
 const room=createRoom(levelBand(level),true);
 room.players.set(id,player);if(!room.auction)createAuction(room);
 sockets.set(id,ws);ws.playerId=id;ws.roomId=room.id;
 safeSend(ws,{type:'friend_room_created',code:room.inviteCode});sendJoined(player,room);
}
async function joinPrivate(ws,msg){
 const account=await authenticatedPlayer(ws);
 if(!account)return safeSend(ws,{type:'error',message:'先にアカウントへログインしてください。'});
 if(!socketCanJoinAccount(account,ws))return;
 if(sendExistingRoomIfJoined(account,ws))return;
 const code=String(msg.code||'').trim().toUpperCase().slice(0,12);
 if(!/^[A-HJ-NP-Z2-9]{6}$/.test(code))return safeSend(ws,{type:'error',message:'招待コードは6文字で入力してください。'});
 const room=[...rooms.values()].find(r=>r.isPrivate&&r.inviteCode===code);
 if(!room||!pruneDisconnectedRoomPlayers(room))return safeSend(ws,{type:'error',message:'招待コードが見つからないか、ルームが終了しています。'});
 if(room.players.size>=MAX_SEATS)return safeSend(ws,{type:'error',message:'このルームは満員です。'});
 const id=account.id;
 detachIdentity(id,ws);
 const level=Math.max(1,Math.min(100,Number(account.level)||1));
 const player={id,name:account.displayName||account.username,level,cash:Number(account.cash)||0,ws,roomId:null,account};
 room.players.set(id,player);sockets.set(id,ws);ws.playerId=id;ws.roomId=room.id;sendJoined(player,room);
}
function rejectBid(player, reason) { safeSend(player.ws, { type: 'bid_rejected', reason }); }
function handleBid(player, amountRaw) {
  const room = rooms.get(player.roomId);
  if (!room || !room.auction || room.auction.status !== 'live') return rejectBid(player, '現在は入札できません。');
  if(room.auction.passedPlayers?.has(player.id))return rejectBid(player,'この品は見送り済みです。次の品をお待ちください。');
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
function handlePassItem(player){
 const room=rooms.get(player.roomId),auction=room?.auction;
 if(!room||!auction||auction.status!=='live')return rejectBid(player,'現在はこの品を見送れません。');
 if(auction.highestBidderId===player.id)return rejectBid(player,'現在あなたが最高入札者のため、この品は見送れません。');
 if(!auction.passedPlayers)auction.passedPlayers=new Set();
 if(auction.passedPlayers.has(player.id))return;
 auction.passedPlayers.add(player.id);
 roomLog(room,player.name+' はこの品を見送りました');
 safeSend(player.ws,{type:'item_passed',itemId:auction.item.id});
 broadcastRoom(room);
}
function botTurn(room){
 const auction=room.auction;if(!auction||auction.status!=='live')return;
 if(!auction.passedPlayers)auction.passedPlayers=new Set();
 if(!auction.botAssessments)auction.botAssessments={};
 const item=auction.item,remaining=auction.endsAt-Date.now();
 const candidates=[];let passedAny=false;
 const multipliers={cautious:1.65,collector:3.50,investor:2.80,intimidator:4.20,sniper:4.60};
 const conditionFactor={'修復跡あり':.68,'経年変化あり':.86,'良品':1,'美品':1.05,'極美品':1.10,'希少な初期型':1.12};
 for(const bot of botSeats(room)){
  if(bot.id===auction.highestBidderId||auction.passedPlayers.has(bot.id))continue;
  if(auction.botAssessments[bot.id]===undefined){
   const seesFake=item.authenticityCode!=='genuine'&&Math.random()*100<Number(bot.appraisalSkill||0)*100;
   auction.botAssessments[bot.id]=seesFake?'fake':'unknown';
  }
  const knowsFake=auction.botAssessments[bot.id]==='fake';
  const risk=.88+Math.max(0,Math.min(1,Number(bot.riskTolerance)||0))*.42;
  const quality=conditionFactor[item.condition]||1;
  const fakeFactor=knowsFake?(bot.strategy==='cautious'?.25:.55):1;
  const trendFactor=(Number(item.marketTrendPercent)||0)<-10?.90:1;
  const valueCeiling=item.marketValue*(multipliers[bot.strategy]||2.5)*risk*quality*fakeFactor*trendFactor;
  const budgetRatio=Math.max(.55,Math.min(1,Number(bot.budgetRatio)||.75));
  const ceiling=Math.min(valueCeiling,(Number(bot.cash)||0)*budgetRatio);
  const badFake=knowsFake&&(bot.strategy==='cautious'||Math.random()<.30);
  const badCondition=item.condition==='修復跡あり'&&Math.random()<.28;
  if(badFake||badCondition||auction.currentBid>=ceiling){
   auction.passedPlayers.add(bot.id);
   roomLog(room,bot.name+'（'+bot.style+'）はこの品を見送りました');
   passedAny=true;
   continue;
  }
  if(bot.strategy==='sniper'&&remaining>7000)continue;
  candidates.push({bot,ceiling,knowsFake});
 }
 if(passedAny)broadcastRoom(room);
 if(!candidates.length)return;
 const weights=candidates.map(({bot})=>{
  const aggression=Math.max(0,Math.min(1,Number(bot.aggression)||0));
  const patience=Math.max(0,Math.min(1,Number(bot.patience)||0));
  const latePressure=1-Math.max(0,Math.min(1,remaining/AUCTION_SECONDS/1000));
  let weight=.55+aggression*.85;
  if(bot.strategy==='sniper')weight*=2.2;
  if(bot.strategy==='cautious')weight*=.72;
  if(patience>.7)weight*=.82+latePressure*.65;
  return Math.max(.1,weight);
 });
 let roll=Math.random()*weights.reduce((a,b)=>a+b,0),chosen=candidates[candidates.length-1];
 for(let i=0;i<candidates.length;i++){roll-=weights[i];if(roll<=0){chosen=candidates[i];break}}
 const {bot,ceiling,knowsFake}=chosen;
 const chanceBase={cautious:.42,collector:.78,investor:.68,intimidator:.90,sniper:.92};
 let chance=(chanceBase[bot.strategy]||.62)+Number(bot.aggression||0)*.12;
 const trend=Number(item.marketTrendPercent)||0,rarityIndex=RARITIES.findIndex(r=>r.key===item.rarity);
 const patience=Math.max(0,Math.min(1,Number(bot.patience)||0)),latePressure=1-Math.max(0,Math.min(1,remaining/AUCTION_SECONDS/1000));
 chance*=1-patience*.24+patience*latePressure*.52;
 if(auction.highestBidderId&&!auction.highestBidderIsBot&&bot.strategy==='intimidator')chance+=.20;
 else if(auction.highestBidderId&&!auction.highestBidderIsBot)chance+=.12;
 if(bot.strategy==='investor')chance+=trend>5?.16:trend<0?-.10:0;
 if(bot.strategy==='collector')chance+=Math.max(0,rarityIndex-5)*.012;
 if(bot.strategy==='cautious'&&knowsFake)chance*=.08;
 if(item.condition==='極美品'&&bot.strategy==='collector')chance+=.08;
 if(Math.random()>Math.max(.08,Math.min(.98,chance)))return;
 const ranges={cautious:[.035,.075],collector:[.07,.15],investor:[.06,.12],intimidator:[.14,.26],sniper:[.12,.22]},range=ranges[bot.strategy]||[.05,.11];
 const increment=Math.max(minIncrement(auction.currentBid),Math.round(auction.currentBid*rand(range[0],range[1])/100)*100);
 const offered=Math.min(auction.currentBid+increment,Math.floor(Math.min(ceiling,bot.cash)/100)*100);
 if(offered<minimumBid(auction)){
  auction.passedPlayers.add(bot.id);
  roomLog(room,bot.name+'（'+bot.style+'）は入札上限に達したため見送りました');
  broadcastRoom(room);return;
 }
 const timeLeft=auction.endsAt-Date.now();
 if(timeLeft>0&&timeLeft<=5000&&auction.extensionMs<20000){const extra=Math.min(5000,20000-auction.extensionMs);auction.endsAt+=extra;auction.extensionMs+=extra}
 auction.currentBid=offered;auction.highestBidderId=bot.id;auction.highestBidderName=bot.name;auction.highestBidderIsBot=true;
 roomLog(room,bot.name+'（'+bot.style+'）が ¥'+offered.toLocaleString('ja-JP')+' で入札');
 room.botNextAt=Date.now()+randInt(1800,3600);broadcastRoom(room);
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
  winner.account.stats.wins=(Number(winner.account.stats.wins)||0)+1;recordWeeklyEvent(winner.account,'wins');
  const rarityIndex=RARITIES.findIndex(r=>r.key===wonItem.rarity);
  addAccountXp(winner.account,40+Math.min(45,Math.max(0,rarityIndex)*3));
   unlockAccountAchievements(winner.account);
  winner.cash=winner.account.cash;winner.level=winner.account.level;profiles.set(winner.id,winner.account);
 }
 for(const player of room.players.values()){
  player.account.stats.auctions=(Number(player.account.stats.auctions)||0)+1;recordWeeklyEvent(player.account,'auctions');
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
  if (!id) { ws.roomId = null; return; }
  const room = rooms.get(ws.roomId);
  const seatedPlayer = room?.players.get(id);
  if (seatedPlayer?.ws === ws) {
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
 ws.connectionSequence=++nextSocketSequence;
 ws.isAlive=true;
 ws.authPromise=accountForCookie(req.headers.cookie||'').then(a=>{ws.accountId=a?.id||null;return a}).catch(err=>{console.warn('WebSocket auth failed:',err.message);ws.accountId=null;return null});
 ws.on('pong',()=>{ws.isAlive=true});
 let messageQueue=Promise.resolve();
 ws.on('message',raw=>{
  messageQueue=messageQueue.then(async()=>{
   if(ws.readyState!==WebSocket.OPEN)return;
   let msg;try{msg=JSON.parse(raw.toString())}catch{safeSend(ws,{type:'error',message:'通信データを読み取れませんでした。'});return}
   if(!msg||typeof msg.type!=='string')return;
   try{
    await ws.authPromise;
    if(ws.readyState!==WebSocket.OPEN)return;
    if(msg.type==='join_quick'){await joinQuick(ws);return}
    if(msg.type==='create_private'){await createPrivate(ws);return}
    if(msg.type==='join_private'){await joinPrivate(ws,msg);return}
    if(msg.type==='bid'){const player=ws.playerId?rooms.get(ws.roomId)?.players.get(ws.playerId):null;if(player?.ws===ws)handleBid(player,msg.amount);return}
    if(msg.type==='pass_item'){const player=ws.playerId?rooms.get(ws.roomId)?.players.get(ws.playerId):null;if(player?.ws===ws)handlePassItem(player);return}
    if(msg.type==='leave'){leaveRoom(ws);safeSend(ws,{type:'room_closed'});return}
    if(msg.type==='profile_update'){safeSend(ws,{type:'error',message:'所持金・レベルはサーバー側で管理されています。'});return}
   }catch(err){console.error('WebSocket message failed:',err);safeSend(ws,{type:'error',message:'サーバー処理中にエラーが発生しました。'})}
  }).catch(err=>{console.error('WebSocket queue failed:',err);safeSend(ws,{type:'error',message:'通信処理中にエラーが発生しました。'})});
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
let museumSettlementBusy=false;
const museumSettlementTimer=setInterval(async()=>{
 if(!databaseReady||museumSettlementBusy)return;
 museumSettlementBusy=true;
 try{
  for(const account of [...profiles.values()]){
   if(!Array.isArray(account.museum)||account.museum.length===0)continue;
   try{await settleMuseumAccount(account.id,account)}
   catch(error){console.warn('Museum income settlement failed:',error.message)}
  }
 }finally{museumSettlementBusy=false}
},30000);
async function start(){
 try{await initializeDatabase();await loadProfiles()}
 catch(err){databaseReady=false;console.error('PostgreSQL initialization failed:',err.message)}
 server.listen(PORT,HOST,()=>console.log('AUCTION MASTERS server listening on http://'+HOST+':'+PORT+(databaseReady?' (database connected)':' (DATABASE_URL missing/unavailable)')));
}
start();
server.on('close',()=>{clearInterval(heartbeat);clearInterval(museumSettlementTimer);for(const room of rooms.values())clearInterval(room.timer);if(pool)pool.end().catch(()=>{})});
