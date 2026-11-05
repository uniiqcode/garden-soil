# アイコンの作り直し方

アイコン(`icons/`)とファビコン(`favicon.*`・`apple-touch-icon.png`)は、Zen Maru Gothic(Bold)の文字を図形にして作っています。
見る人の端末のフォントに左右されません。

1. 必要な文字だけのフォントを Google Fonts から取る(SIL Open Font License)
   ```bash
   T=$(python3 -c "import urllib.parse;print(urllib.parse.quote('土日和つちびより'))")
   url=$(curl -sS "https://fonts.googleapis.com/css2?family=Zen+Maru+Gothic:wght@700&text=$T" -A "Mozilla/5.0" | grep -o 'https://fonts.gstatic.com[^)]*')
   curl -sSL -o maru.ttf "$url"
   ```
2. SVG を作る(2つ目の数字は4文字のかたまりの大きさ。360 で Android のセーフゾーン=中心から直径80%の円 に収まる)
   ```bash
   pip install fonttools pillow
   python3 build.py maru.ttf 360   # icon.svg / icon-rounded.svg / favicon.svg ができる
   ```
3. PNG と ICO を書き出す(Playwright が必要)
   ```bash
   mkdir -p out && node render.js
   python3 -c "from PIL import Image; im=[Image.open(f'out/fav-{s}.png') for s in (16,32,48)]; im[2].save('out/favicon.ico',sizes=[(16,16),(32,32),(48,48)],append_images=im[:2])"
   cp out/icon-512.png out/icon-maskable-512.png
   ```
4. できたものをリポジトリの決まった場所へコピーし、`sw.js` の `CACHE_NAME` を上げる。

配色: 空 `#8CCBF0`→`#BFE0F2`、土 `#8A6440`→`#5A3D26`、「土」`#6B4A2F`、「つちびより」白、「日」「和」`#FBF6EA`。ファビコンは空色 `#86C5EA` の地に「土」。
