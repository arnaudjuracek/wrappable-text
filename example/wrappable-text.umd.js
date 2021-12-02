(function (factory) {
  typeof define === 'function' && define.amd ? define(factory) :
  factory();
}((function () {
  function _defineProperties(target, props) {
    for (var i = 0; i < props.length; i++) {
      var descriptor = props[i];
      descriptor.enumerable = descriptor.enumerable || false;
      descriptor.configurable = true;
      if ("value" in descriptor) descriptor.writable = true;
      Object.defineProperty(target, descriptor.key, descriptor);
    }
  }

  function _createClass(Constructor, protoProps, staticProps) {
    if (protoProps) _defineProperties(Constructor.prototype, protoProps);
    if (staticProps) _defineProperties(Constructor, staticProps);
    return Constructor;
  }

  function createCommonjsModule(fn, basedir, module) {
  	return module = {
  	  path: basedir,
  	  exports: {},
  	  require: function (path, base) {
        return commonjsRequire();
      }
  	}, fn(module, module.exports), module.exports;
  }

  function commonjsRequire () {
  	throw new Error('Dynamic requires are not currently supported by @rollup/plugin-commonjs');
  }

  var TINF_OK = 0;
  var TINF_DATA_ERROR = -3;

  function Tree() {
    this.table = new Uint16Array(16);   /* table of code length counts */
    this.trans = new Uint16Array(288);  /* code -> symbol translation table */
  }

  function Data(source, dest) {
    this.source = source;
    this.sourceIndex = 0;
    this.tag = 0;
    this.bitcount = 0;
    
    this.dest = dest;
    this.destLen = 0;
    
    this.ltree = new Tree();  /* dynamic length/symbol tree */
    this.dtree = new Tree();  /* dynamic distance tree */
  }

  /* --------------------------------------------------- *
   * -- uninitialized global data (static structures) -- *
   * --------------------------------------------------- */

  var sltree = new Tree();
  var sdtree = new Tree();

  /* extra bits and base tables for length codes */
  var length_bits = new Uint8Array(30);
  var length_base = new Uint16Array(30);

  /* extra bits and base tables for distance codes */
  var dist_bits = new Uint8Array(30);
  var dist_base = new Uint16Array(30);

  /* special ordering of code length codes */
  var clcidx = new Uint8Array([
    16, 17, 18, 0, 8, 7, 9, 6,
    10, 5, 11, 4, 12, 3, 13, 2,
    14, 1, 15
  ]);

  /* used by tinf_decode_trees, avoids allocations every call */
  var code_tree = new Tree();
  var lengths = new Uint8Array(288 + 32);

  /* ----------------------- *
   * -- utility functions -- *
   * ----------------------- */

  /* build extra bits and base tables */
  function tinf_build_bits_base(bits, base, delta, first) {
    var i, sum;

    /* build bits table */
    for (i = 0; i < delta; ++i) bits[i] = 0;
    for (i = 0; i < 30 - delta; ++i) bits[i + delta] = i / delta | 0;

    /* build base table */
    for (sum = first, i = 0; i < 30; ++i) {
      base[i] = sum;
      sum += 1 << bits[i];
    }
  }

  /* build the fixed huffman trees */
  function tinf_build_fixed_trees(lt, dt) {
    var i;

    /* build fixed length tree */
    for (i = 0; i < 7; ++i) lt.table[i] = 0;

    lt.table[7] = 24;
    lt.table[8] = 152;
    lt.table[9] = 112;

    for (i = 0; i < 24; ++i) lt.trans[i] = 256 + i;
    for (i = 0; i < 144; ++i) lt.trans[24 + i] = i;
    for (i = 0; i < 8; ++i) lt.trans[24 + 144 + i] = 280 + i;
    for (i = 0; i < 112; ++i) lt.trans[24 + 144 + 8 + i] = 144 + i;

    /* build fixed distance tree */
    for (i = 0; i < 5; ++i) dt.table[i] = 0;

    dt.table[5] = 32;

    for (i = 0; i < 32; ++i) dt.trans[i] = i;
  }

  /* given an array of code lengths, build a tree */
  var offs = new Uint16Array(16);

  function tinf_build_tree(t, lengths, off, num) {
    var i, sum;

    /* clear code length count table */
    for (i = 0; i < 16; ++i) t.table[i] = 0;

    /* scan symbol lengths, and sum code length counts */
    for (i = 0; i < num; ++i) t.table[lengths[off + i]]++;

    t.table[0] = 0;

    /* compute offset table for distribution sort */
    for (sum = 0, i = 0; i < 16; ++i) {
      offs[i] = sum;
      sum += t.table[i];
    }

    /* create code->symbol translation table (symbols sorted by code) */
    for (i = 0; i < num; ++i) {
      if (lengths[off + i]) t.trans[offs[lengths[off + i]]++] = i;
    }
  }

  /* ---------------------- *
   * -- decode functions -- *
   * ---------------------- */

  /* get one bit from source stream */
  function tinf_getbit(d) {
    /* check if tag is empty */
    if (!d.bitcount--) {
      /* load next tag */
      d.tag = d.source[d.sourceIndex++];
      d.bitcount = 7;
    }

    /* shift bit out of tag */
    var bit = d.tag & 1;
    d.tag >>>= 1;

    return bit;
  }

  /* read a num bit value from a stream and add base */
  function tinf_read_bits(d, num, base) {
    if (!num)
      return base;

    while (d.bitcount < 24) {
      d.tag |= d.source[d.sourceIndex++] << d.bitcount;
      d.bitcount += 8;
    }

    var val = d.tag & (0xffff >>> (16 - num));
    d.tag >>>= num;
    d.bitcount -= num;
    return val + base;
  }

  /* given a data stream and a tree, decode a symbol */
  function tinf_decode_symbol(d, t) {
    while (d.bitcount < 24) {
      d.tag |= d.source[d.sourceIndex++] << d.bitcount;
      d.bitcount += 8;
    }
    
    var sum = 0, cur = 0, len = 0;
    var tag = d.tag;

    /* get more bits while code value is above sum */
    do {
      cur = 2 * cur + (tag & 1);
      tag >>>= 1;
      ++len;

      sum += t.table[len];
      cur -= t.table[len];
    } while (cur >= 0);
    
    d.tag = tag;
    d.bitcount -= len;

    return t.trans[sum + cur];
  }

  /* given a data stream, decode dynamic trees from it */
  function tinf_decode_trees(d, lt, dt) {
    var hlit, hdist, hclen;
    var i, num, length;

    /* get 5 bits HLIT (257-286) */
    hlit = tinf_read_bits(d, 5, 257);

    /* get 5 bits HDIST (1-32) */
    hdist = tinf_read_bits(d, 5, 1);

    /* get 4 bits HCLEN (4-19) */
    hclen = tinf_read_bits(d, 4, 4);

    for (i = 0; i < 19; ++i) lengths[i] = 0;

    /* read code lengths for code length alphabet */
    for (i = 0; i < hclen; ++i) {
      /* get 3 bits code length (0-7) */
      var clen = tinf_read_bits(d, 3, 0);
      lengths[clcidx[i]] = clen;
    }

    /* build code length tree */
    tinf_build_tree(code_tree, lengths, 0, 19);

    /* decode code lengths for the dynamic trees */
    for (num = 0; num < hlit + hdist;) {
      var sym = tinf_decode_symbol(d, code_tree);

      switch (sym) {
        case 16:
          /* copy previous code length 3-6 times (read 2 bits) */
          var prev = lengths[num - 1];
          for (length = tinf_read_bits(d, 2, 3); length; --length) {
            lengths[num++] = prev;
          }
          break;
        case 17:
          /* repeat code length 0 for 3-10 times (read 3 bits) */
          for (length = tinf_read_bits(d, 3, 3); length; --length) {
            lengths[num++] = 0;
          }
          break;
        case 18:
          /* repeat code length 0 for 11-138 times (read 7 bits) */
          for (length = tinf_read_bits(d, 7, 11); length; --length) {
            lengths[num++] = 0;
          }
          break;
        default:
          /* values 0-15 represent the actual code lengths */
          lengths[num++] = sym;
          break;
      }
    }

    /* build dynamic trees */
    tinf_build_tree(lt, lengths, 0, hlit);
    tinf_build_tree(dt, lengths, hlit, hdist);
  }

  /* ----------------------------- *
   * -- block inflate functions -- *
   * ----------------------------- */

  /* given a stream and two trees, inflate a block of data */
  function tinf_inflate_block_data(d, lt, dt) {
    while (1) {
      var sym = tinf_decode_symbol(d, lt);

      /* check for end of block */
      if (sym === 256) {
        return TINF_OK;
      }

      if (sym < 256) {
        d.dest[d.destLen++] = sym;
      } else {
        var length, dist, offs;
        var i;

        sym -= 257;

        /* possibly get more bits from length code */
        length = tinf_read_bits(d, length_bits[sym], length_base[sym]);

        dist = tinf_decode_symbol(d, dt);

        /* possibly get more bits from distance code */
        offs = d.destLen - tinf_read_bits(d, dist_bits[dist], dist_base[dist]);

        /* copy match */
        for (i = offs; i < offs + length; ++i) {
          d.dest[d.destLen++] = d.dest[i];
        }
      }
    }
  }

  /* inflate an uncompressed block of data */
  function tinf_inflate_uncompressed_block(d) {
    var length, invlength;
    var i;
    
    /* unread from bitbuffer */
    while (d.bitcount > 8) {
      d.sourceIndex--;
      d.bitcount -= 8;
    }

    /* get length */
    length = d.source[d.sourceIndex + 1];
    length = 256 * length + d.source[d.sourceIndex];

    /* get one's complement of length */
    invlength = d.source[d.sourceIndex + 3];
    invlength = 256 * invlength + d.source[d.sourceIndex + 2];

    /* check length */
    if (length !== (~invlength & 0x0000ffff))
      return TINF_DATA_ERROR;

    d.sourceIndex += 4;

    /* copy block */
    for (i = length; i; --i)
      d.dest[d.destLen++] = d.source[d.sourceIndex++];

    /* make sure we start next block on a byte boundary */
    d.bitcount = 0;

    return TINF_OK;
  }

  /* inflate stream from source to dest */
  function tinf_uncompress(source, dest) {
    var d = new Data(source, dest);
    var bfinal, btype, res;

    do {
      /* read final block flag */
      bfinal = tinf_getbit(d);

      /* read block type (2 bits) */
      btype = tinf_read_bits(d, 2, 0);

      /* decompress block */
      switch (btype) {
        case 0:
          /* decompress uncompressed block */
          res = tinf_inflate_uncompressed_block(d);
          break;
        case 1:
          /* decompress block with fixed huffman trees */
          res = tinf_inflate_block_data(d, sltree, sdtree);
          break;
        case 2:
          /* decompress block with dynamic huffman trees */
          tinf_decode_trees(d, d.ltree, d.dtree);
          res = tinf_inflate_block_data(d, d.ltree, d.dtree);
          break;
        default:
          res = TINF_DATA_ERROR;
      }

      if (res !== TINF_OK)
        throw new Error('Data error');

    } while (!bfinal);

    if (d.destLen < d.dest.length) {
      if (typeof d.dest.slice === 'function')
        return d.dest.slice(0, d.destLen);
      else
        return d.dest.subarray(0, d.destLen);
    }
    
    return d.dest;
  }

  /* -------------------- *
   * -- initialization -- *
   * -------------------- */

  /* build fixed huffman trees */
  tinf_build_fixed_trees(sltree, sdtree);

  /* build extra bits and base tables */
  tinf_build_bits_base(length_bits, length_base, 4, 3);
  tinf_build_bits_base(dist_bits, dist_base, 2, 1);

  /* fix a special case */
  length_bits[28] = 0;
  length_base[28] = 258;

  var tinyInflate = tinf_uncompress;

  // Generated by CoffeeScript 1.7.1
  var UnicodeTrie, inflate;

  inflate = tinyInflate;

  UnicodeTrie = (function() {
    var DATA_BLOCK_LENGTH, DATA_GRANULARITY, DATA_MASK, INDEX_1_OFFSET, INDEX_2_BLOCK_LENGTH, INDEX_2_BMP_LENGTH, INDEX_2_MASK, INDEX_SHIFT, LSCP_INDEX_2_LENGTH, LSCP_INDEX_2_OFFSET, OMITTED_BMP_INDEX_1_LENGTH, SHIFT_1, SHIFT_1_2, SHIFT_2, UTF8_2B_INDEX_2_LENGTH, UTF8_2B_INDEX_2_OFFSET;

    SHIFT_1 = 6 + 5;

    SHIFT_2 = 5;

    SHIFT_1_2 = SHIFT_1 - SHIFT_2;

    OMITTED_BMP_INDEX_1_LENGTH = 0x10000 >> SHIFT_1;

    INDEX_2_BLOCK_LENGTH = 1 << SHIFT_1_2;

    INDEX_2_MASK = INDEX_2_BLOCK_LENGTH - 1;

    INDEX_SHIFT = 2;

    DATA_BLOCK_LENGTH = 1 << SHIFT_2;

    DATA_MASK = DATA_BLOCK_LENGTH - 1;

    LSCP_INDEX_2_OFFSET = 0x10000 >> SHIFT_2;

    LSCP_INDEX_2_LENGTH = 0x400 >> SHIFT_2;

    INDEX_2_BMP_LENGTH = LSCP_INDEX_2_OFFSET + LSCP_INDEX_2_LENGTH;

    UTF8_2B_INDEX_2_OFFSET = INDEX_2_BMP_LENGTH;

    UTF8_2B_INDEX_2_LENGTH = 0x800 >> 6;

    INDEX_1_OFFSET = UTF8_2B_INDEX_2_OFFSET + UTF8_2B_INDEX_2_LENGTH;

    DATA_GRANULARITY = 1 << INDEX_SHIFT;

    function UnicodeTrie(data) {
      var isBuffer, uncompressedLength, view;
      isBuffer = typeof data.readUInt32BE === 'function' && typeof data.slice === 'function';
      if (isBuffer || data instanceof Uint8Array) {
        if (isBuffer) {
          this.highStart = data.readUInt32BE(0);
          this.errorValue = data.readUInt32BE(4);
          uncompressedLength = data.readUInt32BE(8);
          data = data.slice(12);
        } else {
          view = new DataView(data.buffer);
          this.highStart = view.getUint32(0);
          this.errorValue = view.getUint32(4);
          uncompressedLength = view.getUint32(8);
          data = data.subarray(12);
        }
        data = inflate(data, new Uint8Array(uncompressedLength));
        data = inflate(data, new Uint8Array(uncompressedLength));
        this.data = new Uint32Array(data.buffer);
      } else {
        this.data = data.data, this.highStart = data.highStart, this.errorValue = data.errorValue;
      }
    }

    UnicodeTrie.prototype.get = function(codePoint) {
      var index;
      if (codePoint < 0 || codePoint > 0x10ffff) {
        return this.errorValue;
      }
      if (codePoint < 0xd800 || (codePoint > 0xdbff && codePoint <= 0xffff)) {
        index = (this.data[codePoint >> SHIFT_2] << INDEX_SHIFT) + (codePoint & DATA_MASK);
        return this.data[index];
      }
      if (codePoint <= 0xffff) {
        index = (this.data[LSCP_INDEX_2_OFFSET + ((codePoint - 0xd800) >> SHIFT_2)] << INDEX_SHIFT) + (codePoint & DATA_MASK);
        return this.data[index];
      }
      if (codePoint < this.highStart) {
        index = this.data[(INDEX_1_OFFSET - OMITTED_BMP_INDEX_1_LENGTH) + (codePoint >> SHIFT_1)];
        index = this.data[index + ((codePoint >> SHIFT_2) & INDEX_2_MASK)];
        index = (index << INDEX_SHIFT) + (codePoint & DATA_MASK);
        return this.data[index];
      }
      return this.data[this.data.length - DATA_GRANULARITY];
    };

    return UnicodeTrie;

  })();

  var unicodeTrie = UnicodeTrie;

  var b64 = createCommonjsModule(function (module, exports) {
  var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  (function (exports) {

    var Arr = (typeof Uint8Array !== 'undefined')
      ? Uint8Array
      : Array;

  	var PLUS   = '+'.charCodeAt(0);
  	var SLASH  = '/'.charCodeAt(0);
  	var NUMBER = '0'.charCodeAt(0);
  	var LOWER  = 'a'.charCodeAt(0);
  	var UPPER  = 'A'.charCodeAt(0);
  	var PLUS_URL_SAFE = '-'.charCodeAt(0);
  	var SLASH_URL_SAFE = '_'.charCodeAt(0);

  	function decode (elt) {
  		var code = elt.charCodeAt(0);
  		if (code === PLUS ||
  		    code === PLUS_URL_SAFE)
  			return 62 // '+'
  		if (code === SLASH ||
  		    code === SLASH_URL_SAFE)
  			return 63 // '/'
  		if (code < NUMBER)
  			return -1 //no match
  		if (code < NUMBER + 10)
  			return code - NUMBER + 26 + 26
  		if (code < UPPER + 26)
  			return code - UPPER
  		if (code < LOWER + 26)
  			return code - LOWER + 26
  	}

  	function b64ToByteArray (b64) {
  		var i, j, l, tmp, placeHolders, arr;

  		if (b64.length % 4 > 0) {
  			throw new Error('Invalid string. Length must be a multiple of 4')
  		}

  		// the number of equal signs (place holders)
  		// if there are two placeholders, than the two characters before it
  		// represent one byte
  		// if there is only one, then the three characters before it represent 2 bytes
  		// this is just a cheap hack to not do indexOf twice
  		var len = b64.length;
  		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0;

  		// base64 is 4/3 + up to two characters of the original data
  		arr = new Arr(b64.length * 3 / 4 - placeHolders);

  		// if there are placeholders, only get up to the last complete 4 chars
  		l = placeHolders > 0 ? b64.length - 4 : b64.length;

  		var L = 0;

  		function push (v) {
  			arr[L++] = v;
  		}

  		for (i = 0, j = 0; i < l; i += 4, j += 3) {
  			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3));
  			push((tmp & 0xFF0000) >> 16);
  			push((tmp & 0xFF00) >> 8);
  			push(tmp & 0xFF);
  		}

  		if (placeHolders === 2) {
  			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4);
  			push(tmp & 0xFF);
  		} else if (placeHolders === 1) {
  			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2);
  			push((tmp >> 8) & 0xFF);
  			push(tmp & 0xFF);
  		}

  		return arr
  	}

  	function uint8ToBase64 (uint8) {
  		var i,
  			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
  			output = "",
  			temp, length;

  		function encode (num) {
  			return lookup.charAt(num)
  		}

  		function tripletToBase64 (num) {
  			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
  		}

  		// go through the array every three bytes, we'll deal with trailing stuff later
  		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
  			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2]);
  			output += tripletToBase64(temp);
  		}

  		// pad the end with zeros, but make sure to not forget the extra bytes
  		switch (extraBytes) {
  			case 1:
  				temp = uint8[uint8.length - 1];
  				output += encode(temp >> 2);
  				output += encode((temp << 4) & 0x3F);
  				output += '==';
  				break
  			case 2:
  				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1]);
  				output += encode(temp >> 10);
  				output += encode((temp >> 4) & 0x3F);
  				output += encode((temp << 2) & 0x3F);
  				output += '=';
  				break
  		}

  		return output
  	}

  	exports.toByteArray = b64ToByteArray;
  	exports.fromByteArray = uint8ToBase64;
  }( exports));
  });

  var linebreak_es_min = createCommonjsModule(function (module) {
  var AI,AL,BA,BK,CB,CJ,CR,LF,NL,NS,SA,SG,SP,WJ,XX,CI_BRK,CP_BRK,DI_BRK,IN_BRK,PR_BRK,LineBreaker,UnicodeTrie,base64,classTrie,data,NS_1=NS=5,AL_1=AL=12,BA_1=BA=17,WJ_1=WJ=22,AI_1=AI=29,BK_1=BK=30,CB_1=CB=31,CJ_1=CJ=32,CR_1=CR=33,LF_1=LF=34,NL_1=NL=35,SA_1=SA=36,SG_1=SG=37,SP_1=SP=38,XX_1=XX=39,DI_BRK_1=DI_BRK=0,IN_BRK_1=IN_BRK=1,CI_BRK_1=CI_BRK=2,CP_BRK_1=CP_BRK=3,PR_BRK_1=PR_BRK=4,pairTable=[[PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,CP_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[PR_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,CI_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK],[IN_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,CI_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,DI_BRK,IN_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[IN_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK],[IN_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[IN_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[IN_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[IN_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,IN_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,DI_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,DI_BRK,IN_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,DI_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[IN_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,CI_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,DI_BRK,PR_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[IN_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK],[IN_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,CI_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,IN_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,DI_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,IN_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,DI_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,IN_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,IN_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,DI_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,IN_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,DI_BRK],[DI_BRK,PR_BRK,PR_BRK,IN_BRK,IN_BRK,IN_BRK,PR_BRK,PR_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK,IN_BRK,DI_BRK,DI_BRK,PR_BRK,CI_BRK,PR_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,DI_BRK,IN_BRK]];UnicodeTrie=unicodeTrie,base64=b64,data=base64.toByteArray("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"),classTrie=new UnicodeTrie(data),LineBreaker=function(){var Break,mapClass,mapFirst;return mapClass=function(c){return c===AI_1?AL_1:c===SA_1||c===SG_1||c===XX_1?AL_1:c===CJ_1?NS_1:c},mapFirst=function(c){return c===LF_1||c===NL_1?BK_1:c===CB_1?BA_1:c===SP_1?WJ_1:c},Break=class{constructor(position,required=!1){this.position=position,this.required=required;}},class{constructor(string){this.string=string,this.pos=0,this.lastPos=0,this.curClass=null,this.nextClass=null;}nextCodePoint(){var code,next;return code=this.string.charCodeAt(this.pos++),next=this.string.charCodeAt(this.pos),55296<=code&&56319>=code&&56320<=next&&57343>=next?(this.pos++,1024*(code-55296)+(next-56320)+65536):code}nextCharClass(first=!1){return mapClass(classTrie.get(this.nextCodePoint()))}nextBreak(){var cur,lastClass,shouldBreak;for(null==this.curClass&&(this.curClass=mapFirst(this.nextCharClass()));this.pos<this.string.length;){if(this.lastPos=this.pos,lastClass=this.nextClass,this.nextClass=this.nextCharClass(),this.curClass===BK_1||this.curClass===CR_1&&this.nextClass!==LF_1)return this.curClass=mapFirst(mapClass(this.nextClass)),new Break(this.lastPos,!0);if(cur=function(){switch(this.nextClass){case SP_1:return this.curClass;case BK_1:case LF_1:case NL_1:return BK_1;case CR_1:return CR_1;case CB_1:return BA_1;}}.call(this),null!=cur){if(this.curClass=cur,this.nextClass===CB_1)return new Break(this.lastPos);continue}switch(shouldBreak=!1,pairTable[this.curClass][this.nextClass]){case DI_BRK_1:shouldBreak=!0;break;case IN_BRK_1:shouldBreak=lastClass===SP_1;break;case CI_BRK_1:if(shouldBreak=lastClass===SP_1,!shouldBreak)continue;break;case CP_BRK_1:if(lastClass!==SP_1)continue;}if(this.curClass=this.nextClass,shouldBreak)return new Break(this.lastPos)}if(this.pos>=this.string.length)return this.lastPos<this.string.length?(this.lastPos=this.string.length,new Break(this.string.length)):null}}}.call(void 0),module.exports=LineBreaker;
  });

  var BR = "\n";
  var NBSP = "\xA0";
  var SHY = "\xAD";

  function monospace(string) {
    return string.length;
  }

  function getBreaks(string) {
    var breaker = new linebreak_es_min(string);
    var breaks = {};

    while (true) {
      var br = breaker.nextBreak();
      if (!br) break;
      breaks[br.position] = br;
    }

    return breaks;
  }

  var WrappableText = /*#__PURE__*/function () {
    function WrappableText(value, _temp) {
      var _ref = _temp === void 0 ? {} : _temp,
          _ref$measure = _ref.measure,
          measure = _ref$measure === void 0 ? monospace : _ref$measure,
          _ref$br = _ref.br,
          br = _ref$br === void 0 ? BR : _ref$br,
          _ref$nbsp = _ref.nbsp,
          nbsp = _ref$nbsp === void 0 ? NBSP : _ref$nbsp,
          _ref$shy = _ref.shy,
          shy = _ref$shy === void 0 ? SHY : _ref$shy;

      this.measure = measure;
      this.entities = {
        br: br,
        nbsp: nbsp,
        shy: shy
      };
      this.value = value.replace(new RegExp(this.entities.br, 'g'), BR).replace(new RegExp(this.entities.nbsp, 'g'), NBSP).replace(new RegExp(this.entities.shy, 'g'), SHY);
    }

    var _proto = WrappableText.prototype;

    _proto.wrap = function wrap(width) {
      var _this = this;

      if (width === void 0) {
        width = Number.POSITIVE_INFINITY;
      }

      if (!isFinite(width)) return this.nowrap();
      var breaks = getBreaks(this.value);
      var lines = [];
      var start = 0;

      var _loop = function _loop() {
        var curr = start;
        var lineWidth = 0;

        while (curr < _this.value.length) {
          // Handle required breaks
          if (breaks[curr] && breaks[curr].required && !breaks[curr].consumed) {
            breaks[curr].consumed = true;
            curr--;
            break;
          } // Build the line


          lineWidth += _this.measure(_this.value.charAt(curr)); // When the line starts overflowing, find the nearest break before the
          // cursor, break there and restart from this position

          if (lineWidth >= width) {
            var br = Object.values(breaks).reverse().find(function (_ref2) {
              var position = _ref2.position,
                  consumed = _ref2.consumed;
              return !consumed && curr > position;
            });

            if (br) {
              br.consumed = true;
              curr = br.position;
              break;
            }
          } // Advance one char


          curr++;
        } // Get the line value


        var value = _this.value.substring(start, curr).trim(); // Handle shy


        if (_this.value.charAt(curr - 1) === SHY) value += '-';
        value = value.replace(SHY, '');
        lines.push({
          value: value,
          width: _this.measure(value)
        });
        start = curr;
      };

      while (start < this.value.length) {
        _loop();
      }

      return {
        lines: lines,
        overflow: !!lines.find(function (line) {
          return line.width > width;
        })
      };
    };

    _proto.nowrap = function nowrap(width) {
      if (width === void 0) {
        width = Number.POSITIVE_INFINITY;
      }

      var lineWidth = this.measure(this.value); // We use the same object structure as WrappableText.wrap() so that both
      // methods can be used interchangeably

      return {
        lines: [{
          value: this.value,
          width: lineWidth
        }],
        overflow: lineWidth > width
      };
    };

    _createClass(WrappableText, [{
      key: "isEmpty",
      get: function get() {
        return !this.value.replace(new RegExp(BR, 'g'), '').replace(new RegExp(NBSP, 'g'), '').replace(new RegExp(SHY, 'g'), '');
      }
    }]);

    return WrappableText;
  }();

  var canvas = document.querySelector('canvas');
  var ctx = canvas.getContext('2d');
  var fontSize = 100;
  var text = new WrappableText("Hello world&nbsp;! Jean-Fran\xE7ois.<br><br>Psycho&shy;logie", {
    br: /<br\/?>/,
    nbsp: /&nbsp;/,
    shy: /&shy;/,
    measure: function measure(string) {
      ctx.font = fontSize + "px \"Helvetica\"";
      return ctx.measureText(string).width;
    }
  });
  console.log(text);
  render();
  window.addEventListener('resize', function () {
    return requestAnimationFrame(render);
  });

  function render() {
    var margin = 50;
    var dpi = window.devicePixelRatio || 1;
    canvas.style.setProperty('--margin', margin + 'px');
    canvas.width = (window.innerWidth - margin * 4) * dpi;
    canvas.height = (window.innerHeight - margin * 4) * dpi;
    canvas.style.width = canvas.width / dpi + 'px';
    canvas.style.height = canvas.height / dpi + 'px';
    ctx.font = fontSize + "px \"Helvetica\"";
    ctx.strokeStyle = '#9a1fff';
    ctx.scale(dpi, dpi); // Wrap text to canvas width

    var _text$wrap = text.wrap(canvas.width / dpi),
        lines = _text$wrap.lines,
        overflow = _text$wrap.overflow;

    console.log({
      lines: lines,
      overflow: overflow
    }); // Render lines

    ctx.fillStyle = overflow ? 'rgb(255, 75, 78)' : 'black';
    lines.forEach(function (line, index) {
      var baseline = (index + 1) * fontSize;
      ctx.beginPath();
      ctx.moveTo(0, baseline);
      ctx.lineTo(line.width, baseline);
      ctx.stroke();
      ctx.fillText(line.value, 0, baseline);
    });
  }

})));
//# sourceMappingURL=wrappable-text.umd.js.map
