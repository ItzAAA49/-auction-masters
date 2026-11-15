AUCTION MASTERS 1.1 - オンライン公開用パッケージ
================================================

まず大事なこと
--------------
HTMLファイルをダウンロードして直接開くだけでは、オンライン対戦はできません。
オンライン対戦には、このパッケージに入っている server.js をインターネット上で
動かす場所（サーバー）が必要です。

このパッケージには Render 用の render.yaml を追加しました。
GitHub にファイルをアップロードし、Render で Blueprint として公開すると、
友達と同じURLを開いてオンライン対戦できる構成です。

必要なファイル
--------------
- auction_masters.html : メニュー・2.5D競売会場・入札画面など
- server.js            : マッチング・Bot補充・オンライン入札同期サーバー
- package.json         : Node.js依存関係と起動コマンド
- render.yaml          : Render にサーバーを作成させる設定
- start_server.sh      : Linux / Chromebook Linux 向け起動スクリプト

オンライン公開手順（ブラウザ中心）
----------------------------------
A. GitHub にゲームファイルを置く

1. https://github.com/new を開き、GitHub アカウントでログインします。
2. Repository name に auction-masters-game と入力します。
3. Public または Private を選び、Create repository を押します。
4. 作成したリポジトリで Add file → Upload files を選びます。
5. このZIPを解凍し、中にあるファイルをすべてアップロードします。
   ※ ZIPファイルそのものではなく、auction_masters.html、server.js、
      package.json、render.yaml などの中身をアップロードします。
6. 下の Commit changes を押します。

B. Render でオンラインサーバーを起動する

1. https://dashboard.render.com/ を開き、アカウントを作成／ログインします。
2. New → Blueprint を選びます。
3. GitHub の接続を求められたら許可します。
4. auction-masters-game リポジトリの Connect を押します。
5. Blueprint name と branch を確認します。
6. 作成内容に auction-masters-game の Web Service が表示されたら、
   Deploy Blueprint を押します。
7. デプロイが終わるまで待ちます。成功すると https://xxxx.onrender.com の
   ようなURLが表示されます。
8. そのURLをChromeで開きます。ここから「スタート」を押せばオンライン接続します。
9. 友達にもまったく同じURLを送ってください。各自のブラウザから参加できます。

C. ちゃんと動くか確認する

公開URLの末尾に /health を付けて開きます。
例：https://xxxx.onrender.com/health
{"ok":true,...} のようなJSONが表示されれば、サーバーは起動しています。
その後、通常の公開URLに戻ってゲームを開いてください。

ローカルで試す場合（Linux環境がある場合）
----------------------------------------
Node.js 20 以上が必要です。
このフォルダで以下を実行します。

  npm install
  npm start

Chrome で http://localhost:8080 を開きます。

注意点
------
- Render の Free Web Service は15分間アクセスがないと休止し、次のアクセスで
  起動し直します。復帰に約1分かかる場合があります。
- Free Web Service のファイルシステムは一時的です。休止・再起動・再デプロイ時に
  profiles.json が消える可能性があるため、現段階では所持金などのオンライン進行を
  長期間保存する用途には向きません。
- まずは友達とオンライン対戦を試すための構成です。本格公開前にはアカウント認証、
  DB保存、入札や所持金の不正対策、レート制限などを追加する必要があります。
- オンライン対戦は公開URLから開いた場合に動きます。ダウンロードしたHTMLを
  file:// で直接開いた場合はBot練習だけ利用できます。

公式説明
--------
Render の Blueprint 手順：
https://render.com/docs/infrastructure-as-code
Render WebSocket 対応：
https://render.com/docs/web-services
Render 無料プランの制限：
https://render.com/docs/free
