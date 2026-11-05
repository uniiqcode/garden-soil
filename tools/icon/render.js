const {chromium}=require('playwright');const fs=require('fs');
(async()=>{const b=await chromium.launch();
// build.py が作った SVG から PNG を書き出す
const jobs=[['icon.svg',512,'out/icon-512.png'],['icon.svg',192,'out/icon-192.png'],['icon.svg',180,'out/apple-touch-icon.png'],
['favicon.svg',16,'out/fav-16.png'],['favicon.svg',32,'out/fav-32.png'],['favicon.svg',48,'out/fav-48.png']];
for(const [f,s,o] of jobs){const p=await b.newPage({viewport:{width:s,height:s},deviceScaleFactor:1});
await p.setContent(`<style>html,body{margin:0;background:transparent}img{display:block;width:${s}px;height:${s}px}</style><img src="data:image/svg+xml;base64,${fs.readFileSync(f).toString('base64')}">`);
await p.waitForTimeout(100);await p.screenshot({path:o,omitBackground:true});await p.close();}
await b.close()})();
