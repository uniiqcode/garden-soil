# 土日和(garden-soil)で作業するときの決まり

- niisan とのやり取りは日本語で行う。
- 公開アプリ(GitHub Pages)。アフィリエイトのリンクは入れない。
- 仕様は `docs/spec.md`。判定ルールを変えたら同じ変更で spec とテスト(`tests/logic.test.mjs`)も直す。
- 画面のファイル(HTML/CSS/JS/JSON)を変えたら `sw.js` の `CACHE_NAME` を上げ、変えたファイルの `?v=N` もそろえて上げる(`index.html`・`js/app.js`・`sw.js` の SHELL)。
- ノウハウはリンク先に任せる。`data/tasks.json` の `summary` は2〜3文の要点だけ。リンクは実在を確かめたものだけを入れ、`checked` に日付を書く。
- 変更後は `npm test` と、`python3 -m http.server 8080` を起動して `node tests/ui.mjs` を通す。
- `main` に直接 push しない。作業ブランチから PR にする。
