const fs=require('fs'),z=require('zlib'),cp=require('child_process');
const names=fs.readdirSync(__dirname).filter(n=>/^patch\.part\.\d{2}$/.test(n)).sort();
if(names.length!==6)throw new Error('patch fragments missing: '+names.length);
const payload=names.map(n=>fs.readFileSync(__dirname+'/'+n,'utf8')).join('');
const patch=z.brotliDecompressSync(Buffer.from(payload,'base64'));
cp.execFileSync('patch',['-p1','-d','app'],{input:patch,stdio:['pipe','inherit','inherit']});
console.log('Okugasegi UI/gameplay patch applied');
