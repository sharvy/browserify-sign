// much of this based on https://github.com/indutny/self-signed/blob/gh-pages/lib/rsa.js
var parseKeys = require('parse-asn1');
var bn = require('bn.js');
var elliptic = require('elliptic');
var crt = require("browserify-rsa");
module.exports = sign;
function sign(hash, key, crypto) {
  var priv = parseKeys(key, crypto);
  if (priv.curve) {
    return ecSign(hash, priv, crypto);
  } else if (priv.type === 'dsa') {
    return dsaSign(hash, priv, crypto);
  }
  var len = priv.modulus.byteLength();
  var pad = [ 0, 1 ];
  while (hash.length + pad.length + 1 < len) {
    pad.push(0xff);
  }
  pad.push(0x00);
  var i = -1;
  while (++i < hash.length) {
    pad.push(hash[i]);
  }
  
  var out = crt(pad, priv, crypto);
  return out;
}
function ecSign(hash, priv, crypto) {
  elliptic.rand = crypto.randomBytes;
  var curve;
  if (priv.curve.join('.')  === '1.3.132.0.10') {
    curve = new elliptic.ec('secp256k1');
  }
  var key = curve.genKeyPair();
  key._importPrivate(priv.privateKey);
  var out = key.sign(hash);
  return new Buffer(out.toDER());
}
function dsaSign(hash, priv, crypto) {
  var x = priv.params.priv_key;
  var p = priv.params.p;
  var q = priv.params.q;
  var montq = bn.mont(q);
  var g = priv.params.g;
  var r = new bn(0);
  var k;
  var H = new bn(hash);
  var s = false;
  var kv = getKay(x, hash, crypto);
  while (s === false) {
    while (!r.cmpn(0)) {
      k = makeKey(q, kv, crypto);
      r = makeR(g, k, p, q);
    }
    s = k.invm(q).imul(H.add(x.imul(r).mod(q)).mod(q)).mod(q);
    if (!s.cmpn(0)) {
      s = false;
      r = new bn(0);
    }
  }
  return toDER(r,s);
}
function toDER(r, s) {
  r = r.toArray();
  s = s.toArray();

  // Pad values
  if (r[0] & 0x80)
    r = [ 0 ].concat(r);
  // Pad values
  if (s[0] & 0x80)
    s = [ 0 ].concat(s);

  var total = r.length + s.length + 4;
  var res = [ 0x30, total, 0x02, r.length ];
  res = res.concat(r, [ 0x02, s.length ], s);
  return new Buffer(res);
}
function getKay(x, hash, crypto) {
  x = new Buffer(x.toArray());
  var algo = 'sha1';//I know!
  var hlen = hash.length;
  var v = new Buffer(hlen);
  v.fill(1);
  var k = new Buffer(hlen);
  k.fill(0);
  k = crypto.createHmac('sha1', k)
    .update(v)
    .update(new Buffer([0]))
    .update(x)
    .update(hash)
    .digest();
  v = crypto.createHmac(algo, k)
    .update(v)
    .digest();
  k = crypto.createHmac(algo, k)
    .update(v)
    .update(new Buffer([1]))
    .update(x)
    .update(hash)
    .digest();
  return {
    k:k,
    v:v
  };
}
function bits2int(bits, q) {
  bits = new bn(bits);
  var shift = bits.bitLength() - q.bitLength();
  if (shift > 0) {
    bits.ishrn(shift);
  }
  return bits;
}
function makeKey(q, kv, crypto) {
  var t;
  var k;
  while (true) {
    t = new Buffer('');
    while (t.length * 8 < q.bitLength()) {
      kv.v = crypto.createHmac('sha1', kv.k)
        .update(kv.v)
        .digest();
      t = Buffer.concat([t, kv.v]);
    }
    k = bits2int(t, q);
    kv.k =  crypto.createHmac('sha1', kv.k)
        .update(kv.v)
        .update(new Buffer([0]))
        .digest();
    kv.v = crypto.createHmac('sha1', kv.k)
        .update(kv.v)
        .digest();
    if (k.cmp(q) === -1) {
      return k;
    }
  }
}
function makeR(g, k, p, q) {
  return g.toRed(bn.mont(p)).redPow(k).fromRed().mod(q);
}