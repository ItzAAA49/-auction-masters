AUCTION MASTERS 1.2 - オンラインアカウント版
================================================

今回の更新内容
--------------
- プレイ開始前にアカウント登録またはログインが必要です。
- ユーザー名とパスワードでログインします。パスワードはサーバー側で
  scrypt を使ってハッシュ化し、平文では保存しません。
- 所持金、レベル、所持品、コレクション、鑑定士、落札履歴を
  PostgreSQL に保存します。
- 所持金ランキングは登録済みアカウント全員を掲載します。
  所持金が0円でもランキングから除外されません。
- ランキングからプレイヤーを選ぶと、プロフィール、コレクション、
  落札履歴、売却済みかどうかを確認できます。
- 所持品の鑑定・売却・保管・取り出しはサーバー側で検証して保存します。
- Bot入り会場はオンラインマッチングを利用します。空席はBotで埋まり、
  人間のプレイヤーが入るとBotの席が減ります。

重要：データベースの設定が必要です
----------------------------------
アカウント機能は PostgreSQL を必要とします。DATABASE_URL が未設定の場合、
サーバーは起動しますが、登録・ログイン・ランキングAPIは利用できません。
Render のサービスと接続する PostgreSQL データベースを用意し、
Web Service の環境変数 DATABASE_URL に接続URLを設定してください。

Render での設定手順
--------------------
1. Render Dashboard を開き、New → PostgreSQL からデータベースを作成します。
2. データベースの Connect 画面から Internal Database URL をコピーします。
   Web Service とデータベースが同じ Render アカウント・リージョンにある場合は
   Internal URL を使ってください。
3. Render Dashboard で AUCTION MASTERS の Web Service を開きます。
4. 左側の Environment → Add Environment Variable を選びます。
5. Key に DATABASE_URL、Value にコピーした接続URLを入力して保存・デプロイします。
6. 公開URLの末尾に /health を付けて開き、JSON の database が true であることを確認します。
7. ゲームを開き、最初にアカウントを作成します。友達にも同じURLを共有してください。

render.yaml には DATABASE_URL の未設定環境変数を定義しています。
Blueprint 作成・同期後も、実際の接続URLを Environment に設定する必要があります。
接続URLやパスワードなどの秘密情報を GitHub に書き込まないでください。

データ保存について
------------------
アカウント情報は PostgreSQL に保存されるため、Render Web Service の
一時ファイルシステムには依存しません。

Render Free PostgreSQL は試用向けです。Free データベースは作成から30日で
期限切れとなり、バックアップもありません。期限後の猶予期間内に有料プランへ
アップグレードしないとデータが削除されます。長期運用では、期限のない
永続的な PostgreSQL プランを使い、バックアップも用意してください。

オンライン対戦
--------------
- 自動マッチング：レベル10区分ごとにルームを分けます。
- 最大8席：人間プレイヤー数に応じてBotが空席を埋めます。
- フレンドルーム：招待コードで同じルームに参加できます。
- 所持金・レベル・商品・履歴はサーバーが管理します。

ローカル起動
------------
Node.js 20 以上が必要です。

  npm install
  DATABASE_URL="postgresql://..." npm start

Chrome で http://localhost:8080 を開きます。
ローカル環境でも PostgreSQL の接続先が必要です。

ヘルスチェック
--------------
公開URLに /health を付けて開きます。

  https://あなたのサービス.onrender.com/health

database:true なら PostgreSQL 接続済みです。
database:false なら DATABASE_URL またはデータベース接続設定を確認してください。

主なファイル
------------
- auction_masters.html : アカウント画面、メニュー、競売会場、所持品、ランキング
- server.js            : 認証、データ保存、ランキング、マッチング、入札サーバー
- package.json         : Node.js依存関係
- render.yaml          : Render Web Service と環境変数の設定

参考ドキュメント
----------------
Render Postgres の作成・接続：
https://render.com/docs/postgresql-creating-connecting

Render 環境変数：
https://render.com/docs/configure-environment-variables

Render Free プランの制限：
https://render.com/docs/free
