# mecab-spawn
``mecab-spawn`` は形態素解析器 ``MeCab`` とのプロセス間通信を簡易化するパッケージです。

## インストール
```sh
npm install mecab-spawn
```

## 使い方
``` javascript
// MeCab プロセスのスポーン
const mecabSpawn = require('mecab-spawn')
const mecab = mecabSpawn.spawn()

// 文字列を分析し結果をコンソールに出力する
mecab.analyze('メカブ\nスポーン')
  .then(result => {
    console.log(result)
  }).catch(err => {
    console.error(err)
  })

// MeCab の終了
mecab.kill()
  .then(message => {
    console.log(message)
  }).catch(err => {
    console.error(err)
  })

// => [ [ 'メカブ', '名詞', '固有名詞', '組織', '*', '*', '*', '*' ],
//      'EOS',
//      [ 'スポーン', '名詞', '固有名詞', '組織', '*', '*', '*', '*' ] ]
//   MeCab process is killed.
```

``analyze()`` は非同期で実行されますが、``mecab-spawn`` は内部的にタスクのキューを持つため ``kill()`` は分析結果を出力した後に実行されます。

``spawn()`` は引数がない場合、パスの通った ``mecab`` コマンドを実行しようとします。引数を指定した場合は ``child_process.spawn()`` にそのまま渡されます。

``` javascript
// UniDic 辞書を使用して実行
const mecab = mecabSpawn.spawn('mecab', ['-d', '/usr/local/lib/mecab/dic/unidic-mecab'])
```

## 行パース関数
解析結果のうち ``eos`` のみ ``mecab.getEOSObject()`` の値がそのまま使われ、残りは全て行パース関数が処理します。

``MeCab`` の解析結果に対して、初期状態では慣例的に ``\t`` と ``,`` で行を分割した文字列の配列を返します。具体的には ``line.split(/[\t,]/)`` を実行するだけです。

これを手早く変更するには以下のように ``createLineParser()`` でパース関数を作成し設定します。
```
// カンマのみで行を分割する
mecab.lineParser = mecab.createLineParser(',')
```

行パース関数には自分で作成した関数を設定できます。
以下はUniDicの初期書式の行をオブジェクトとして返す行パース関数の設定例です。

``` javascript
// Make UniDic default morpheme an Object.
//   node-format-unidic: %m\t%f[9]\t%f[6]\t%f[7]\t%F-[0,1,2,3]\t%f[4]\t%f[5]\t%f[23]\n
//   unk-format-unidic:  %m\t%m\t%m\t%m\t%F-[0,1,2,3]\t%f[4]\t%f[5]\t0\n
mecab.lineParser = line => {
  if (line === 'BOS') {
    return 'BOS'
  }
  const tokens = line.split('\t')
  if (tokens.length !== 8) {
    return { whatIsThis: line }
  }
  const m = { surface: tokens[0] }
  if (tokens[1]) m.pron = tokens[1]
  if (tokens[2]) m.lForm = tokens[2]
  if (tokens[3]) m.lemma = tokens[3]
  const posArray = tokens[4].split('-')
  m.pos1 = posArray[0]
  if (posArray[1]) m.pos2 = posArray[1]
  if (posArray[2]) m.pos3 = posArray[2]
  if (posArray[3]) m.pos4 = posArray[3]
  if (tokens[5]) m.cType = tokens[5]
  if (tokens[6]) m.cForm = tokens[6]
  if (tokens[7]) m.aType = Number(tokens[7])
  return m
}
```

## 辞書のコーディングシステム
初期状態では ``UTF-8`` 辞書にのみ対応していますが、辞書に対応したエンコード/デコード関数を設定することで ``UTF-8`` 以外にも対応することができます。

``` sh
npm install iconv-lite
```

``` javascript
// iconv-lite で EUC-JP 辞書に対応する
const iconv = require('iconv-lite')
// UTF-8 => EUC-JP
// EUC-JP のファイルを直接読ませる場合は不要
mecab.setDefaultEncoder(data => iconv.encode(data, 'eucjp'))
// EUC-JP => UTF-8
mecab.setDefaultDecoder(data => iconv.decode(data, 'eucjp'))
```

あるいは ``analyze()`` にエンコード/デコード関数を指定することで優先的に分析元データに合わせて変更できます。
``` javascript
const eucjpDecoder = data => iconv.decode(data, 'eucjp')
mecab.analyze(data, null, eucjpDecoder)
```

## EOS オブジェクト
初期状態の解析結果では ``eos`` は ``"EOS"`` 文字列オブジェクトですが、その後の処理の為に必要であれば変更可能です。
``` javascript
// 配列に入った eos を設定する。
mecab.setEOSObject(['EOS'])
mecab.analyze('メカブ\nスポーン\nスポーン').then(console.log)
// => [ [ 'メカブ', '名詞', '固有名詞', '組織', '*', '*', '*', '*' ],
        [ 'EOS' ],
        [ 'スポーン', '名詞', '固有名詞', '組織', '*', '*', '*', '*' ],
        [ 'EOS' ],
        [ 'スポーン', '名詞', '固有名詞', '組織', '*', '*', '*', '*' ] ]
```

## EOS フォーマット
``mecab-spawn`` は ``MeCab`` の解析出力完了時を調べるためにバイト列中の ``eos`` 出現回数を数えることで判断します。もし解析結果と``eos-format``の区別がつかない場合は解析結果の読み取りに失敗します。

EOS フォーマットを設定する際に Windows や Mac で ``\r``を設定する必要はありません。MeCab は ``\n`` を自動的に OS に合わせた改行文字で出力するからです。

``` javascript
// eos を変更する
mecabIPC.spawn('mecab', ['--eos-format=End\\sof\\sSentence\\n'])
mecab.setEOSSample('End of Sentence\\n')
```

