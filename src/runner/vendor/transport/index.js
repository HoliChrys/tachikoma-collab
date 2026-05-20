"use strict";
var __create = Object.create;
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __getProtoOf = Object.getPrototypeOf;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __esm = (fn, res) => function __init() {
  return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
};
var __commonJS = (cb, mod) => function __require() {
  return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
};
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toESM = (mod, isNodeMode, target) => (target = mod != null ? __create(__getProtoOf(mod)) : {}, __copyProps(
  // If the importer is in node compatibility mode or this is not an ESM
  // file that has been converted to a CommonJS file using a Babel-
  // compatible transform (i.e. "__esModule" has not been set), then set
  // "default" to the CommonJS "module.exports" for node compatibility.
  isNodeMode || !mod || !mod.__esModule ? __defProp(target, "default", { value: mod, enumerable: true }) : target,
  mod
));
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/utils/utf8.cjs
var require_utf8 = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/utils/utf8.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.utf8Count = utf8Count;
    exports2.utf8EncodeJs = utf8EncodeJs;
    exports2.utf8EncodeTE = utf8EncodeTE;
    exports2.utf8Encode = utf8Encode;
    exports2.utf8DecodeJs = utf8DecodeJs;
    exports2.utf8DecodeTD = utf8DecodeTD;
    exports2.utf8Decode = utf8Decode;
    function utf8Count(str) {
      const strLength = str.length;
      let byteLength = 0;
      let pos = 0;
      while (pos < strLength) {
        let value = str.charCodeAt(pos++);
        if ((value & 4294967168) === 0) {
          byteLength++;
          continue;
        } else if ((value & 4294965248) === 0) {
          byteLength += 2;
        } else {
          if (value >= 55296 && value <= 56319) {
            if (pos < strLength) {
              const extra = str.charCodeAt(pos);
              if ((extra & 64512) === 56320) {
                ++pos;
                value = ((value & 1023) << 10) + (extra & 1023) + 65536;
              }
            }
          }
          if ((value & 4294901760) === 0) {
            byteLength += 3;
          } else {
            byteLength += 4;
          }
        }
      }
      return byteLength;
    }
    function utf8EncodeJs(str, output, outputOffset) {
      const strLength = str.length;
      let offset = outputOffset;
      let pos = 0;
      while (pos < strLength) {
        let value = str.charCodeAt(pos++);
        if ((value & 4294967168) === 0) {
          output[offset++] = value;
          continue;
        } else if ((value & 4294965248) === 0) {
          output[offset++] = value >> 6 & 31 | 192;
        } else {
          if (value >= 55296 && value <= 56319) {
            if (pos < strLength) {
              const extra = str.charCodeAt(pos);
              if ((extra & 64512) === 56320) {
                ++pos;
                value = ((value & 1023) << 10) + (extra & 1023) + 65536;
              }
            }
          }
          if ((value & 4294901760) === 0) {
            output[offset++] = value >> 12 & 15 | 224;
            output[offset++] = value >> 6 & 63 | 128;
          } else {
            output[offset++] = value >> 18 & 7 | 240;
            output[offset++] = value >> 12 & 63 | 128;
            output[offset++] = value >> 6 & 63 | 128;
          }
        }
        output[offset++] = value & 63 | 128;
      }
    }
    var sharedTextEncoder = new TextEncoder();
    var TEXT_ENCODER_THRESHOLD = 50;
    function utf8EncodeTE(str, output, outputOffset) {
      sharedTextEncoder.encodeInto(str, output.subarray(outputOffset));
    }
    function utf8Encode(str, output, outputOffset) {
      if (str.length > TEXT_ENCODER_THRESHOLD) {
        utf8EncodeTE(str, output, outputOffset);
      } else {
        utf8EncodeJs(str, output, outputOffset);
      }
    }
    var CHUNK_SIZE = 4096;
    function utf8DecodeJs(bytes, inputOffset, byteLength) {
      let offset = inputOffset;
      const end = offset + byteLength;
      const units = [];
      let result = "";
      while (offset < end) {
        const byte1 = bytes[offset++];
        if ((byte1 & 128) === 0) {
          units.push(byte1);
        } else if ((byte1 & 224) === 192) {
          const byte2 = bytes[offset++] & 63;
          units.push((byte1 & 31) << 6 | byte2);
        } else if ((byte1 & 240) === 224) {
          const byte2 = bytes[offset++] & 63;
          const byte3 = bytes[offset++] & 63;
          units.push((byte1 & 31) << 12 | byte2 << 6 | byte3);
        } else if ((byte1 & 248) === 240) {
          const byte2 = bytes[offset++] & 63;
          const byte3 = bytes[offset++] & 63;
          const byte4 = bytes[offset++] & 63;
          let unit = (byte1 & 7) << 18 | byte2 << 12 | byte3 << 6 | byte4;
          if (unit > 65535) {
            unit -= 65536;
            units.push(unit >>> 10 & 1023 | 55296);
            unit = 56320 | unit & 1023;
          }
          units.push(unit);
        } else {
          units.push(byte1);
        }
        if (units.length >= CHUNK_SIZE) {
          result += String.fromCharCode(...units);
          units.length = 0;
        }
      }
      if (units.length > 0) {
        result += String.fromCharCode(...units);
      }
      return result;
    }
    var sharedTextDecoder = new TextDecoder();
    var TEXT_DECODER_THRESHOLD = 200;
    function utf8DecodeTD(bytes, inputOffset, byteLength) {
      const stringBytes = bytes.subarray(inputOffset, inputOffset + byteLength);
      return sharedTextDecoder.decode(stringBytes);
    }
    function utf8Decode(bytes, inputOffset, byteLength) {
      if (byteLength > TEXT_DECODER_THRESHOLD) {
        return utf8DecodeTD(bytes, inputOffset, byteLength);
      } else {
        return utf8DecodeJs(bytes, inputOffset, byteLength);
      }
    }
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/ExtData.cjs
var require_ExtData = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/ExtData.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ExtData = void 0;
    var ExtData = class {
      type;
      data;
      constructor(type, data) {
        this.type = type;
        this.data = data;
      }
    };
    exports2.ExtData = ExtData;
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/DecodeError.cjs
var require_DecodeError = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/DecodeError.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.DecodeError = void 0;
    var DecodeError = class _DecodeError extends Error {
      constructor(message) {
        super(message);
        const proto = Object.create(_DecodeError.prototype);
        Object.setPrototypeOf(this, proto);
        Object.defineProperty(this, "name", {
          configurable: true,
          enumerable: false,
          value: _DecodeError.name
        });
      }
    };
    exports2.DecodeError = DecodeError;
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/utils/int.cjs
var require_int = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/utils/int.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.UINT32_MAX = void 0;
    exports2.setUint64 = setUint64;
    exports2.setInt64 = setInt64;
    exports2.getInt64 = getInt64;
    exports2.getUint64 = getUint64;
    exports2.UINT32_MAX = 4294967295;
    function setUint64(view, offset, value) {
      const high = value / 4294967296;
      const low = value;
      view.setUint32(offset, high);
      view.setUint32(offset + 4, low);
    }
    function setInt64(view, offset, value) {
      const high = Math.floor(value / 4294967296);
      const low = value;
      view.setUint32(offset, high);
      view.setUint32(offset + 4, low);
    }
    function getInt64(view, offset) {
      const high = view.getInt32(offset);
      const low = view.getUint32(offset + 4);
      return high * 4294967296 + low;
    }
    function getUint64(view, offset) {
      const high = view.getUint32(offset);
      const low = view.getUint32(offset + 4);
      return high * 4294967296 + low;
    }
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/timestamp.cjs
var require_timestamp = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/timestamp.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.timestampExtension = exports2.EXT_TIMESTAMP = void 0;
    exports2.encodeTimeSpecToTimestamp = encodeTimeSpecToTimestamp;
    exports2.encodeDateToTimeSpec = encodeDateToTimeSpec;
    exports2.encodeTimestampExtension = encodeTimestampExtension;
    exports2.decodeTimestampToTimeSpec = decodeTimestampToTimeSpec;
    exports2.decodeTimestampExtension = decodeTimestampExtension;
    var DecodeError_ts_1 = require_DecodeError();
    var int_ts_1 = require_int();
    exports2.EXT_TIMESTAMP = -1;
    var TIMESTAMP32_MAX_SEC = 4294967296 - 1;
    var TIMESTAMP64_MAX_SEC = 17179869184 - 1;
    function encodeTimeSpecToTimestamp({ sec, nsec }) {
      if (sec >= 0 && nsec >= 0 && sec <= TIMESTAMP64_MAX_SEC) {
        if (nsec === 0 && sec <= TIMESTAMP32_MAX_SEC) {
          const rv = new Uint8Array(4);
          const view = new DataView(rv.buffer);
          view.setUint32(0, sec);
          return rv;
        } else {
          const secHigh = sec / 4294967296;
          const secLow = sec & 4294967295;
          const rv = new Uint8Array(8);
          const view = new DataView(rv.buffer);
          view.setUint32(0, nsec << 2 | secHigh & 3);
          view.setUint32(4, secLow);
          return rv;
        }
      } else {
        const rv = new Uint8Array(12);
        const view = new DataView(rv.buffer);
        view.setUint32(0, nsec);
        (0, int_ts_1.setInt64)(view, 4, sec);
        return rv;
      }
    }
    function encodeDateToTimeSpec(date) {
      const msec = date.getTime();
      const sec = Math.floor(msec / 1e3);
      const nsec = (msec - sec * 1e3) * 1e6;
      const nsecInSec = Math.floor(nsec / 1e9);
      return {
        sec: sec + nsecInSec,
        nsec: nsec - nsecInSec * 1e9
      };
    }
    function encodeTimestampExtension(object) {
      if (object instanceof Date) {
        const timeSpec = encodeDateToTimeSpec(object);
        return encodeTimeSpecToTimestamp(timeSpec);
      } else {
        return null;
      }
    }
    function decodeTimestampToTimeSpec(data) {
      const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
      switch (data.byteLength) {
        case 4: {
          const sec = view.getUint32(0);
          const nsec = 0;
          return { sec, nsec };
        }
        case 8: {
          const nsec30AndSecHigh2 = view.getUint32(0);
          const secLow32 = view.getUint32(4);
          const sec = (nsec30AndSecHigh2 & 3) * 4294967296 + secLow32;
          const nsec = nsec30AndSecHigh2 >>> 2;
          return { sec, nsec };
        }
        case 12: {
          const sec = (0, int_ts_1.getInt64)(view, 4);
          const nsec = view.getUint32(0);
          return { sec, nsec };
        }
        default:
          throw new DecodeError_ts_1.DecodeError(`Unrecognized data size for timestamp (expected 4, 8, or 12): ${data.length}`);
      }
    }
    function decodeTimestampExtension(data) {
      const timeSpec = decodeTimestampToTimeSpec(data);
      return new Date(timeSpec.sec * 1e3 + timeSpec.nsec / 1e6);
    }
    exports2.timestampExtension = {
      type: exports2.EXT_TIMESTAMP,
      encode: encodeTimestampExtension,
      decode: decodeTimestampExtension
    };
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/ExtensionCodec.cjs
var require_ExtensionCodec = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/ExtensionCodec.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ExtensionCodec = void 0;
    var ExtData_ts_1 = require_ExtData();
    var timestamp_ts_1 = require_timestamp();
    var ExtensionCodec = class _ExtensionCodec {
      static defaultCodec = new _ExtensionCodec();
      // ensures ExtensionCodecType<X> matches ExtensionCodec<X>
      // this will make type errors a lot more clear
      // eslint-disable-next-line @typescript-eslint/naming-convention
      __brand;
      // built-in extensions
      builtInEncoders = [];
      builtInDecoders = [];
      // custom extensions
      encoders = [];
      decoders = [];
      constructor() {
        this.register(timestamp_ts_1.timestampExtension);
      }
      register({ type, encode: encode2, decode: decode2 }) {
        if (type >= 0) {
          this.encoders[type] = encode2;
          this.decoders[type] = decode2;
        } else {
          const index = -1 - type;
          this.builtInEncoders[index] = encode2;
          this.builtInDecoders[index] = decode2;
        }
      }
      tryToEncode(object, context) {
        for (let i = 0; i < this.builtInEncoders.length; i++) {
          const encodeExt = this.builtInEncoders[i];
          if (encodeExt != null) {
            const data = encodeExt(object, context);
            if (data != null) {
              const type = -1 - i;
              return new ExtData_ts_1.ExtData(type, data);
            }
          }
        }
        for (let i = 0; i < this.encoders.length; i++) {
          const encodeExt = this.encoders[i];
          if (encodeExt != null) {
            const data = encodeExt(object, context);
            if (data != null) {
              const type = i;
              return new ExtData_ts_1.ExtData(type, data);
            }
          }
        }
        if (object instanceof ExtData_ts_1.ExtData) {
          return object;
        }
        return null;
      }
      decode(data, type, context) {
        const decodeExt = type < 0 ? this.builtInDecoders[-1 - type] : this.decoders[type];
        if (decodeExt) {
          return decodeExt(data, type, context);
        } else {
          return new ExtData_ts_1.ExtData(type, data);
        }
      }
    };
    exports2.ExtensionCodec = ExtensionCodec;
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/utils/typedArrays.cjs
var require_typedArrays = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/utils/typedArrays.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.ensureUint8Array = ensureUint8Array;
    function isArrayBufferLike(buffer) {
      return buffer instanceof ArrayBuffer || typeof SharedArrayBuffer !== "undefined" && buffer instanceof SharedArrayBuffer;
    }
    function ensureUint8Array(buffer) {
      if (buffer instanceof Uint8Array) {
        return buffer;
      } else if (ArrayBuffer.isView(buffer)) {
        return new Uint8Array(buffer.buffer, buffer.byteOffset, buffer.byteLength);
      } else if (isArrayBufferLike(buffer)) {
        return new Uint8Array(buffer);
      } else {
        return Uint8Array.from(buffer);
      }
    }
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/Encoder.cjs
var require_Encoder = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/Encoder.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.Encoder = exports2.DEFAULT_INITIAL_BUFFER_SIZE = exports2.DEFAULT_MAX_DEPTH = void 0;
    var utf8_ts_1 = require_utf8();
    var ExtensionCodec_ts_1 = require_ExtensionCodec();
    var int_ts_1 = require_int();
    var typedArrays_ts_1 = require_typedArrays();
    exports2.DEFAULT_MAX_DEPTH = 100;
    exports2.DEFAULT_INITIAL_BUFFER_SIZE = 2048;
    var Encoder = class _Encoder {
      extensionCodec;
      context;
      useBigInt64;
      maxDepth;
      initialBufferSize;
      sortKeys;
      forceFloat32;
      ignoreUndefined;
      forceIntegerToFloat;
      pos;
      view;
      bytes;
      entered = false;
      constructor(options) {
        this.extensionCodec = options?.extensionCodec ?? ExtensionCodec_ts_1.ExtensionCodec.defaultCodec;
        this.context = options?.context;
        this.useBigInt64 = options?.useBigInt64 ?? false;
        this.maxDepth = options?.maxDepth ?? exports2.DEFAULT_MAX_DEPTH;
        this.initialBufferSize = options?.initialBufferSize ?? exports2.DEFAULT_INITIAL_BUFFER_SIZE;
        this.sortKeys = options?.sortKeys ?? false;
        this.forceFloat32 = options?.forceFloat32 ?? false;
        this.ignoreUndefined = options?.ignoreUndefined ?? false;
        this.forceIntegerToFloat = options?.forceIntegerToFloat ?? false;
        this.pos = 0;
        this.view = new DataView(new ArrayBuffer(this.initialBufferSize));
        this.bytes = new Uint8Array(this.view.buffer);
      }
      clone() {
        return new _Encoder({
          extensionCodec: this.extensionCodec,
          context: this.context,
          useBigInt64: this.useBigInt64,
          maxDepth: this.maxDepth,
          initialBufferSize: this.initialBufferSize,
          sortKeys: this.sortKeys,
          forceFloat32: this.forceFloat32,
          ignoreUndefined: this.ignoreUndefined,
          forceIntegerToFloat: this.forceIntegerToFloat
        });
      }
      reinitializeState() {
        this.pos = 0;
      }
      /**
       * This is almost equivalent to {@link Encoder#encode}, but it returns an reference of the encoder's internal buffer and thus much faster than {@link Encoder#encode}.
       *
       * @returns Encodes the object and returns a shared reference the encoder's internal buffer.
       */
      encodeSharedRef(object) {
        if (this.entered) {
          const instance = this.clone();
          return instance.encodeSharedRef(object);
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.doEncode(object, 1);
          return this.bytes.subarray(0, this.pos);
        } finally {
          this.entered = false;
        }
      }
      /**
       * @returns Encodes the object and returns a copy of the encoder's internal buffer.
       */
      encode(object) {
        if (this.entered) {
          const instance = this.clone();
          return instance.encode(object);
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.doEncode(object, 1);
          return this.bytes.slice(0, this.pos);
        } finally {
          this.entered = false;
        }
      }
      doEncode(object, depth) {
        if (depth > this.maxDepth) {
          throw new Error(`Too deep objects in depth ${depth}`);
        }
        if (object == null) {
          this.encodeNil();
        } else if (typeof object === "boolean") {
          this.encodeBoolean(object);
        } else if (typeof object === "number") {
          if (!this.forceIntegerToFloat) {
            this.encodeNumber(object);
          } else {
            this.encodeNumberAsFloat(object);
          }
        } else if (typeof object === "string") {
          this.encodeString(object);
        } else if (this.useBigInt64 && typeof object === "bigint") {
          this.encodeBigInt64(object);
        } else {
          this.encodeObject(object, depth);
        }
      }
      ensureBufferSizeToWrite(sizeToWrite) {
        const requiredSize = this.pos + sizeToWrite;
        if (this.view.byteLength < requiredSize) {
          this.resizeBuffer(requiredSize * 2);
        }
      }
      resizeBuffer(newSize) {
        const newBuffer = new ArrayBuffer(newSize);
        const newBytes = new Uint8Array(newBuffer);
        const newView = new DataView(newBuffer);
        newBytes.set(this.bytes);
        this.view = newView;
        this.bytes = newBytes;
      }
      encodeNil() {
        this.writeU8(192);
      }
      encodeBoolean(object) {
        if (object === false) {
          this.writeU8(194);
        } else {
          this.writeU8(195);
        }
      }
      encodeNumber(object) {
        if (!this.forceIntegerToFloat && Number.isSafeInteger(object)) {
          if (object >= 0) {
            if (object < 128) {
              this.writeU8(object);
            } else if (object < 256) {
              this.writeU8(204);
              this.writeU8(object);
            } else if (object < 65536) {
              this.writeU8(205);
              this.writeU16(object);
            } else if (object < 4294967296) {
              this.writeU8(206);
              this.writeU32(object);
            } else if (!this.useBigInt64) {
              this.writeU8(207);
              this.writeU64(object);
            } else {
              this.encodeNumberAsFloat(object);
            }
          } else {
            if (object >= -32) {
              this.writeU8(224 | object + 32);
            } else if (object >= -128) {
              this.writeU8(208);
              this.writeI8(object);
            } else if (object >= -32768) {
              this.writeU8(209);
              this.writeI16(object);
            } else if (object >= -2147483648) {
              this.writeU8(210);
              this.writeI32(object);
            } else if (!this.useBigInt64) {
              this.writeU8(211);
              this.writeI64(object);
            } else {
              this.encodeNumberAsFloat(object);
            }
          }
        } else {
          this.encodeNumberAsFloat(object);
        }
      }
      encodeNumberAsFloat(object) {
        if (this.forceFloat32) {
          this.writeU8(202);
          this.writeF32(object);
        } else {
          this.writeU8(203);
          this.writeF64(object);
        }
      }
      encodeBigInt64(object) {
        if (object >= BigInt(0)) {
          this.writeU8(207);
          this.writeBigUint64(object);
        } else {
          this.writeU8(211);
          this.writeBigInt64(object);
        }
      }
      writeStringHeader(byteLength) {
        if (byteLength < 32) {
          this.writeU8(160 + byteLength);
        } else if (byteLength < 256) {
          this.writeU8(217);
          this.writeU8(byteLength);
        } else if (byteLength < 65536) {
          this.writeU8(218);
          this.writeU16(byteLength);
        } else if (byteLength < 4294967296) {
          this.writeU8(219);
          this.writeU32(byteLength);
        } else {
          throw new Error(`Too long string: ${byteLength} bytes in UTF-8`);
        }
      }
      encodeString(object) {
        const maxHeaderSize = 1 + 4;
        const byteLength = (0, utf8_ts_1.utf8Count)(object);
        this.ensureBufferSizeToWrite(maxHeaderSize + byteLength);
        this.writeStringHeader(byteLength);
        (0, utf8_ts_1.utf8Encode)(object, this.bytes, this.pos);
        this.pos += byteLength;
      }
      encodeObject(object, depth) {
        const ext = this.extensionCodec.tryToEncode(object, this.context);
        if (ext != null) {
          this.encodeExtension(ext);
        } else if (Array.isArray(object)) {
          this.encodeArray(object, depth);
        } else if (ArrayBuffer.isView(object)) {
          this.encodeBinary(object);
        } else if (typeof object === "object") {
          this.encodeMap(object, depth);
        } else {
          throw new Error(`Unrecognized object: ${Object.prototype.toString.apply(object)}`);
        }
      }
      encodeBinary(object) {
        const size = object.byteLength;
        if (size < 256) {
          this.writeU8(196);
          this.writeU8(size);
        } else if (size < 65536) {
          this.writeU8(197);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(198);
          this.writeU32(size);
        } else {
          throw new Error(`Too large binary: ${size}`);
        }
        const bytes = (0, typedArrays_ts_1.ensureUint8Array)(object);
        this.writeU8a(bytes);
      }
      encodeArray(object, depth) {
        const size = object.length;
        if (size < 16) {
          this.writeU8(144 + size);
        } else if (size < 65536) {
          this.writeU8(220);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(221);
          this.writeU32(size);
        } else {
          throw new Error(`Too large array: ${size}`);
        }
        for (const item of object) {
          this.doEncode(item, depth + 1);
        }
      }
      countWithoutUndefined(object, keys) {
        let count = 0;
        for (const key of keys) {
          if (object[key] !== void 0) {
            count++;
          }
        }
        return count;
      }
      encodeMap(object, depth) {
        const keys = Object.keys(object);
        if (this.sortKeys) {
          keys.sort();
        }
        const size = this.ignoreUndefined ? this.countWithoutUndefined(object, keys) : keys.length;
        if (size < 16) {
          this.writeU8(128 + size);
        } else if (size < 65536) {
          this.writeU8(222);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(223);
          this.writeU32(size);
        } else {
          throw new Error(`Too large map object: ${size}`);
        }
        for (const key of keys) {
          const value = object[key];
          if (!(this.ignoreUndefined && value === void 0)) {
            this.encodeString(key);
            this.doEncode(value, depth + 1);
          }
        }
      }
      encodeExtension(ext) {
        if (typeof ext.data === "function") {
          const data = ext.data(this.pos + 6);
          const size2 = data.length;
          if (size2 >= 4294967296) {
            throw new Error(`Too large extension object: ${size2}`);
          }
          this.writeU8(201);
          this.writeU32(size2);
          this.writeI8(ext.type);
          this.writeU8a(data);
          return;
        }
        const size = ext.data.length;
        if (size === 1) {
          this.writeU8(212);
        } else if (size === 2) {
          this.writeU8(213);
        } else if (size === 4) {
          this.writeU8(214);
        } else if (size === 8) {
          this.writeU8(215);
        } else if (size === 16) {
          this.writeU8(216);
        } else if (size < 256) {
          this.writeU8(199);
          this.writeU8(size);
        } else if (size < 65536) {
          this.writeU8(200);
          this.writeU16(size);
        } else if (size < 4294967296) {
          this.writeU8(201);
          this.writeU32(size);
        } else {
          throw new Error(`Too large extension object: ${size}`);
        }
        this.writeI8(ext.type);
        this.writeU8a(ext.data);
      }
      writeU8(value) {
        this.ensureBufferSizeToWrite(1);
        this.view.setUint8(this.pos, value);
        this.pos++;
      }
      writeU8a(values) {
        const size = values.length;
        this.ensureBufferSizeToWrite(size);
        this.bytes.set(values, this.pos);
        this.pos += size;
      }
      writeI8(value) {
        this.ensureBufferSizeToWrite(1);
        this.view.setInt8(this.pos, value);
        this.pos++;
      }
      writeU16(value) {
        this.ensureBufferSizeToWrite(2);
        this.view.setUint16(this.pos, value);
        this.pos += 2;
      }
      writeI16(value) {
        this.ensureBufferSizeToWrite(2);
        this.view.setInt16(this.pos, value);
        this.pos += 2;
      }
      writeU32(value) {
        this.ensureBufferSizeToWrite(4);
        this.view.setUint32(this.pos, value);
        this.pos += 4;
      }
      writeI32(value) {
        this.ensureBufferSizeToWrite(4);
        this.view.setInt32(this.pos, value);
        this.pos += 4;
      }
      writeF32(value) {
        this.ensureBufferSizeToWrite(4);
        this.view.setFloat32(this.pos, value);
        this.pos += 4;
      }
      writeF64(value) {
        this.ensureBufferSizeToWrite(8);
        this.view.setFloat64(this.pos, value);
        this.pos += 8;
      }
      writeU64(value) {
        this.ensureBufferSizeToWrite(8);
        (0, int_ts_1.setUint64)(this.view, this.pos, value);
        this.pos += 8;
      }
      writeI64(value) {
        this.ensureBufferSizeToWrite(8);
        (0, int_ts_1.setInt64)(this.view, this.pos, value);
        this.pos += 8;
      }
      writeBigUint64(value) {
        this.ensureBufferSizeToWrite(8);
        this.view.setBigUint64(this.pos, value);
        this.pos += 8;
      }
      writeBigInt64(value) {
        this.ensureBufferSizeToWrite(8);
        this.view.setBigInt64(this.pos, value);
        this.pos += 8;
      }
    };
    exports2.Encoder = Encoder;
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/encode.cjs
var require_encode = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/encode.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.encode = encode2;
    var Encoder_ts_1 = require_Encoder();
    function encode2(value, options) {
      const encoder = new Encoder_ts_1.Encoder(options);
      return encoder.encodeSharedRef(value);
    }
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/utils/prettyByte.cjs
var require_prettyByte = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/utils/prettyByte.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.prettyByte = prettyByte;
    function prettyByte(byte) {
      return `${byte < 0 ? "-" : ""}0x${Math.abs(byte).toString(16).padStart(2, "0")}`;
    }
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/CachedKeyDecoder.cjs
var require_CachedKeyDecoder = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/CachedKeyDecoder.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.CachedKeyDecoder = void 0;
    var utf8_ts_1 = require_utf8();
    var DEFAULT_MAX_KEY_LENGTH = 16;
    var DEFAULT_MAX_LENGTH_PER_KEY = 16;
    var CachedKeyDecoder = class {
      hit = 0;
      miss = 0;
      caches;
      maxKeyLength;
      maxLengthPerKey;
      constructor(maxKeyLength = DEFAULT_MAX_KEY_LENGTH, maxLengthPerKey = DEFAULT_MAX_LENGTH_PER_KEY) {
        this.maxKeyLength = maxKeyLength;
        this.maxLengthPerKey = maxLengthPerKey;
        this.caches = [];
        for (let i = 0; i < this.maxKeyLength; i++) {
          this.caches.push([]);
        }
      }
      canBeCached(byteLength) {
        return byteLength > 0 && byteLength <= this.maxKeyLength;
      }
      find(bytes, inputOffset, byteLength) {
        const records = this.caches[byteLength - 1];
        FIND_CHUNK: for (const record of records) {
          const recordBytes = record.bytes;
          for (let j = 0; j < byteLength; j++) {
            if (recordBytes[j] !== bytes[inputOffset + j]) {
              continue FIND_CHUNK;
            }
          }
          return record.str;
        }
        return null;
      }
      store(bytes, value) {
        const records = this.caches[bytes.length - 1];
        const record = { bytes, str: value };
        if (records.length >= this.maxLengthPerKey) {
          records[Math.random() * records.length | 0] = record;
        } else {
          records.push(record);
        }
      }
      decode(bytes, inputOffset, byteLength) {
        const cachedValue = this.find(bytes, inputOffset, byteLength);
        if (cachedValue != null) {
          this.hit++;
          return cachedValue;
        }
        this.miss++;
        const str = (0, utf8_ts_1.utf8DecodeJs)(bytes, inputOffset, byteLength);
        const slicedCopyOfBytes = Uint8Array.prototype.slice.call(bytes, inputOffset, inputOffset + byteLength);
        this.store(slicedCopyOfBytes, str);
        return str;
      }
    };
    exports2.CachedKeyDecoder = CachedKeyDecoder;
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/Decoder.cjs
var require_Decoder = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/Decoder.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.Decoder = void 0;
    var prettyByte_ts_1 = require_prettyByte();
    var ExtensionCodec_ts_1 = require_ExtensionCodec();
    var int_ts_1 = require_int();
    var utf8_ts_1 = require_utf8();
    var typedArrays_ts_1 = require_typedArrays();
    var CachedKeyDecoder_ts_1 = require_CachedKeyDecoder();
    var DecodeError_ts_1 = require_DecodeError();
    var STATE_ARRAY = "array";
    var STATE_MAP_KEY = "map_key";
    var STATE_MAP_VALUE = "map_value";
    var mapKeyConverter = (key) => {
      if (typeof key === "string" || typeof key === "number") {
        return key;
      }
      throw new DecodeError_ts_1.DecodeError("The type of key must be string or number but " + typeof key);
    };
    var StackPool = class {
      stack = [];
      stackHeadPosition = -1;
      get length() {
        return this.stackHeadPosition + 1;
      }
      top() {
        return this.stack[this.stackHeadPosition];
      }
      pushArrayState(size) {
        const state = this.getUninitializedStateFromPool();
        state.type = STATE_ARRAY;
        state.position = 0;
        state.size = size;
        state.array = new Array(size);
      }
      pushMapState(size) {
        const state = this.getUninitializedStateFromPool();
        state.type = STATE_MAP_KEY;
        state.readCount = 0;
        state.size = size;
        state.map = {};
      }
      getUninitializedStateFromPool() {
        this.stackHeadPosition++;
        if (this.stackHeadPosition === this.stack.length) {
          const partialState = {
            type: void 0,
            size: 0,
            array: void 0,
            position: 0,
            readCount: 0,
            map: void 0,
            key: null
          };
          this.stack.push(partialState);
        }
        return this.stack[this.stackHeadPosition];
      }
      release(state) {
        const topStackState = this.stack[this.stackHeadPosition];
        if (topStackState !== state) {
          throw new Error("Invalid stack state. Released state is not on top of the stack.");
        }
        if (state.type === STATE_ARRAY) {
          const partialState = state;
          partialState.size = 0;
          partialState.array = void 0;
          partialState.position = 0;
          partialState.type = void 0;
        }
        if (state.type === STATE_MAP_KEY || state.type === STATE_MAP_VALUE) {
          const partialState = state;
          partialState.size = 0;
          partialState.map = void 0;
          partialState.readCount = 0;
          partialState.type = void 0;
        }
        this.stackHeadPosition--;
      }
      reset() {
        this.stack.length = 0;
        this.stackHeadPosition = -1;
      }
    };
    var HEAD_BYTE_REQUIRED = -1;
    var EMPTY_VIEW = new DataView(new ArrayBuffer(0));
    var EMPTY_BYTES = new Uint8Array(EMPTY_VIEW.buffer);
    try {
      EMPTY_VIEW.getInt8(0);
    } catch (e) {
      if (!(e instanceof RangeError)) {
        throw new Error("This module is not supported in the current JavaScript engine because DataView does not throw RangeError on out-of-bounds access");
      }
    }
    var MORE_DATA = new RangeError("Insufficient data");
    var sharedCachedKeyDecoder = new CachedKeyDecoder_ts_1.CachedKeyDecoder();
    var Decoder = class _Decoder {
      extensionCodec;
      context;
      useBigInt64;
      rawStrings;
      maxStrLength;
      maxBinLength;
      maxArrayLength;
      maxMapLength;
      maxExtLength;
      keyDecoder;
      mapKeyConverter;
      totalPos = 0;
      pos = 0;
      view = EMPTY_VIEW;
      bytes = EMPTY_BYTES;
      headByte = HEAD_BYTE_REQUIRED;
      stack = new StackPool();
      entered = false;
      constructor(options) {
        this.extensionCodec = options?.extensionCodec ?? ExtensionCodec_ts_1.ExtensionCodec.defaultCodec;
        this.context = options?.context;
        this.useBigInt64 = options?.useBigInt64 ?? false;
        this.rawStrings = options?.rawStrings ?? false;
        this.maxStrLength = options?.maxStrLength ?? int_ts_1.UINT32_MAX;
        this.maxBinLength = options?.maxBinLength ?? int_ts_1.UINT32_MAX;
        this.maxArrayLength = options?.maxArrayLength ?? int_ts_1.UINT32_MAX;
        this.maxMapLength = options?.maxMapLength ?? int_ts_1.UINT32_MAX;
        this.maxExtLength = options?.maxExtLength ?? int_ts_1.UINT32_MAX;
        this.keyDecoder = options?.keyDecoder !== void 0 ? options.keyDecoder : sharedCachedKeyDecoder;
        this.mapKeyConverter = options?.mapKeyConverter ?? mapKeyConverter;
      }
      clone() {
        return new _Decoder({
          extensionCodec: this.extensionCodec,
          context: this.context,
          useBigInt64: this.useBigInt64,
          rawStrings: this.rawStrings,
          maxStrLength: this.maxStrLength,
          maxBinLength: this.maxBinLength,
          maxArrayLength: this.maxArrayLength,
          maxMapLength: this.maxMapLength,
          maxExtLength: this.maxExtLength,
          keyDecoder: this.keyDecoder
        });
      }
      reinitializeState() {
        this.totalPos = 0;
        this.headByte = HEAD_BYTE_REQUIRED;
        this.stack.reset();
      }
      setBuffer(buffer) {
        const bytes = (0, typedArrays_ts_1.ensureUint8Array)(buffer);
        this.bytes = bytes;
        this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        this.pos = 0;
      }
      appendBuffer(buffer) {
        if (this.headByte === HEAD_BYTE_REQUIRED && !this.hasRemaining(1)) {
          this.setBuffer(buffer);
        } else {
          const remainingData = this.bytes.subarray(this.pos);
          const newData = (0, typedArrays_ts_1.ensureUint8Array)(buffer);
          const newBuffer = new Uint8Array(remainingData.length + newData.length);
          newBuffer.set(remainingData);
          newBuffer.set(newData, remainingData.length);
          this.setBuffer(newBuffer);
        }
      }
      hasRemaining(size) {
        return this.view.byteLength - this.pos >= size;
      }
      createExtraByteError(posToShow) {
        const { view, pos } = this;
        return new RangeError(`Extra ${view.byteLength - pos} of ${view.byteLength} byte(s) found at buffer[${posToShow}]`);
      }
      /**
       * @throws {@link DecodeError}
       * @throws {@link RangeError}
       */
      decode(buffer) {
        if (this.entered) {
          const instance = this.clone();
          return instance.decode(buffer);
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.setBuffer(buffer);
          const object = this.doDecodeSync();
          if (this.hasRemaining(1)) {
            throw this.createExtraByteError(this.pos);
          }
          return object;
        } finally {
          this.entered = false;
        }
      }
      *decodeMulti(buffer) {
        if (this.entered) {
          const instance = this.clone();
          yield* instance.decodeMulti(buffer);
          return;
        }
        try {
          this.entered = true;
          this.reinitializeState();
          this.setBuffer(buffer);
          while (this.hasRemaining(1)) {
            yield this.doDecodeSync();
          }
        } finally {
          this.entered = false;
        }
      }
      async decodeAsync(stream) {
        if (this.entered) {
          const instance = this.clone();
          return instance.decodeAsync(stream);
        }
        try {
          this.entered = true;
          let decoded = false;
          let object;
          for await (const buffer of stream) {
            if (decoded) {
              this.entered = false;
              throw this.createExtraByteError(this.totalPos);
            }
            this.appendBuffer(buffer);
            try {
              object = this.doDecodeSync();
              decoded = true;
            } catch (e) {
              if (!(e instanceof RangeError)) {
                throw e;
              }
            }
            this.totalPos += this.pos;
          }
          if (decoded) {
            if (this.hasRemaining(1)) {
              throw this.createExtraByteError(this.totalPos);
            }
            return object;
          }
          const { headByte, pos, totalPos } = this;
          throw new RangeError(`Insufficient data in parsing ${(0, prettyByte_ts_1.prettyByte)(headByte)} at ${totalPos} (${pos} in the current buffer)`);
        } finally {
          this.entered = false;
        }
      }
      decodeArrayStream(stream) {
        return this.decodeMultiAsync(stream, true);
      }
      decodeStream(stream) {
        return this.decodeMultiAsync(stream, false);
      }
      async *decodeMultiAsync(stream, isArray) {
        if (this.entered) {
          const instance = this.clone();
          yield* instance.decodeMultiAsync(stream, isArray);
          return;
        }
        try {
          this.entered = true;
          let isArrayHeaderRequired = isArray;
          let arrayItemsLeft = -1;
          for await (const buffer of stream) {
            if (isArray && arrayItemsLeft === 0) {
              throw this.createExtraByteError(this.totalPos);
            }
            this.appendBuffer(buffer);
            if (isArrayHeaderRequired) {
              arrayItemsLeft = this.readArraySize();
              isArrayHeaderRequired = false;
              this.complete();
            }
            try {
              while (true) {
                yield this.doDecodeSync();
                if (--arrayItemsLeft === 0) {
                  break;
                }
              }
            } catch (e) {
              if (!(e instanceof RangeError)) {
                throw e;
              }
            }
            this.totalPos += this.pos;
          }
        } finally {
          this.entered = false;
        }
      }
      doDecodeSync() {
        DECODE: while (true) {
          const headByte = this.readHeadByte();
          let object;
          if (headByte >= 224) {
            object = headByte - 256;
          } else if (headByte < 192) {
            if (headByte < 128) {
              object = headByte;
            } else if (headByte < 144) {
              const size = headByte - 128;
              if (size !== 0) {
                this.pushMapState(size);
                this.complete();
                continue DECODE;
              } else {
                object = {};
              }
            } else if (headByte < 160) {
              const size = headByte - 144;
              if (size !== 0) {
                this.pushArrayState(size);
                this.complete();
                continue DECODE;
              } else {
                object = [];
              }
            } else {
              const byteLength = headByte - 160;
              object = this.decodeString(byteLength, 0);
            }
          } else if (headByte === 192) {
            object = null;
          } else if (headByte === 194) {
            object = false;
          } else if (headByte === 195) {
            object = true;
          } else if (headByte === 202) {
            object = this.readF32();
          } else if (headByte === 203) {
            object = this.readF64();
          } else if (headByte === 204) {
            object = this.readU8();
          } else if (headByte === 205) {
            object = this.readU16();
          } else if (headByte === 206) {
            object = this.readU32();
          } else if (headByte === 207) {
            if (this.useBigInt64) {
              object = this.readU64AsBigInt();
            } else {
              object = this.readU64();
            }
          } else if (headByte === 208) {
            object = this.readI8();
          } else if (headByte === 209) {
            object = this.readI16();
          } else if (headByte === 210) {
            object = this.readI32();
          } else if (headByte === 211) {
            if (this.useBigInt64) {
              object = this.readI64AsBigInt();
            } else {
              object = this.readI64();
            }
          } else if (headByte === 217) {
            const byteLength = this.lookU8();
            object = this.decodeString(byteLength, 1);
          } else if (headByte === 218) {
            const byteLength = this.lookU16();
            object = this.decodeString(byteLength, 2);
          } else if (headByte === 219) {
            const byteLength = this.lookU32();
            object = this.decodeString(byteLength, 4);
          } else if (headByte === 220) {
            const size = this.readU16();
            if (size !== 0) {
              this.pushArrayState(size);
              this.complete();
              continue DECODE;
            } else {
              object = [];
            }
          } else if (headByte === 221) {
            const size = this.readU32();
            if (size !== 0) {
              this.pushArrayState(size);
              this.complete();
              continue DECODE;
            } else {
              object = [];
            }
          } else if (headByte === 222) {
            const size = this.readU16();
            if (size !== 0) {
              this.pushMapState(size);
              this.complete();
              continue DECODE;
            } else {
              object = {};
            }
          } else if (headByte === 223) {
            const size = this.readU32();
            if (size !== 0) {
              this.pushMapState(size);
              this.complete();
              continue DECODE;
            } else {
              object = {};
            }
          } else if (headByte === 196) {
            const size = this.lookU8();
            object = this.decodeBinary(size, 1);
          } else if (headByte === 197) {
            const size = this.lookU16();
            object = this.decodeBinary(size, 2);
          } else if (headByte === 198) {
            const size = this.lookU32();
            object = this.decodeBinary(size, 4);
          } else if (headByte === 212) {
            object = this.decodeExtension(1, 0);
          } else if (headByte === 213) {
            object = this.decodeExtension(2, 0);
          } else if (headByte === 214) {
            object = this.decodeExtension(4, 0);
          } else if (headByte === 215) {
            object = this.decodeExtension(8, 0);
          } else if (headByte === 216) {
            object = this.decodeExtension(16, 0);
          } else if (headByte === 199) {
            const size = this.lookU8();
            object = this.decodeExtension(size, 1);
          } else if (headByte === 200) {
            const size = this.lookU16();
            object = this.decodeExtension(size, 2);
          } else if (headByte === 201) {
            const size = this.lookU32();
            object = this.decodeExtension(size, 4);
          } else {
            throw new DecodeError_ts_1.DecodeError(`Unrecognized type byte: ${(0, prettyByte_ts_1.prettyByte)(headByte)}`);
          }
          this.complete();
          const stack = this.stack;
          while (stack.length > 0) {
            const state = stack.top();
            if (state.type === STATE_ARRAY) {
              state.array[state.position] = object;
              state.position++;
              if (state.position === state.size) {
                object = state.array;
                stack.release(state);
              } else {
                continue DECODE;
              }
            } else if (state.type === STATE_MAP_KEY) {
              if (object === "__proto__") {
                throw new DecodeError_ts_1.DecodeError("The key __proto__ is not allowed");
              }
              state.key = this.mapKeyConverter(object);
              state.type = STATE_MAP_VALUE;
              continue DECODE;
            } else {
              state.map[state.key] = object;
              state.readCount++;
              if (state.readCount === state.size) {
                object = state.map;
                stack.release(state);
              } else {
                state.key = null;
                state.type = STATE_MAP_KEY;
                continue DECODE;
              }
            }
          }
          return object;
        }
      }
      readHeadByte() {
        if (this.headByte === HEAD_BYTE_REQUIRED) {
          this.headByte = this.readU8();
        }
        return this.headByte;
      }
      complete() {
        this.headByte = HEAD_BYTE_REQUIRED;
      }
      readArraySize() {
        const headByte = this.readHeadByte();
        switch (headByte) {
          case 220:
            return this.readU16();
          case 221:
            return this.readU32();
          default: {
            if (headByte < 160) {
              return headByte - 144;
            } else {
              throw new DecodeError_ts_1.DecodeError(`Unrecognized array type byte: ${(0, prettyByte_ts_1.prettyByte)(headByte)}`);
            }
          }
        }
      }
      pushMapState(size) {
        if (size > this.maxMapLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: map length (${size}) > maxMapLengthLength (${this.maxMapLength})`);
        }
        this.stack.pushMapState(size);
      }
      pushArrayState(size) {
        if (size > this.maxArrayLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: array length (${size}) > maxArrayLength (${this.maxArrayLength})`);
        }
        this.stack.pushArrayState(size);
      }
      decodeString(byteLength, headerOffset) {
        if (!this.rawStrings || this.stateIsMapKey()) {
          return this.decodeUtf8String(byteLength, headerOffset);
        }
        return this.decodeBinary(byteLength, headerOffset);
      }
      /**
       * @throws {@link RangeError}
       */
      decodeUtf8String(byteLength, headerOffset) {
        if (byteLength > this.maxStrLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: UTF-8 byte length (${byteLength}) > maxStrLength (${this.maxStrLength})`);
        }
        if (this.bytes.byteLength < this.pos + headerOffset + byteLength) {
          throw MORE_DATA;
        }
        const offset = this.pos + headerOffset;
        let object;
        if (this.stateIsMapKey() && this.keyDecoder?.canBeCached(byteLength)) {
          object = this.keyDecoder.decode(this.bytes, offset, byteLength);
        } else {
          object = (0, utf8_ts_1.utf8Decode)(this.bytes, offset, byteLength);
        }
        this.pos += headerOffset + byteLength;
        return object;
      }
      stateIsMapKey() {
        if (this.stack.length > 0) {
          const state = this.stack.top();
          return state.type === STATE_MAP_KEY;
        }
        return false;
      }
      /**
       * @throws {@link RangeError}
       */
      decodeBinary(byteLength, headOffset) {
        if (byteLength > this.maxBinLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: bin length (${byteLength}) > maxBinLength (${this.maxBinLength})`);
        }
        if (!this.hasRemaining(byteLength + headOffset)) {
          throw MORE_DATA;
        }
        const offset = this.pos + headOffset;
        const object = this.bytes.subarray(offset, offset + byteLength);
        this.pos += headOffset + byteLength;
        return object;
      }
      decodeExtension(size, headOffset) {
        if (size > this.maxExtLength) {
          throw new DecodeError_ts_1.DecodeError(`Max length exceeded: ext length (${size}) > maxExtLength (${this.maxExtLength})`);
        }
        const extType = this.view.getInt8(this.pos + headOffset);
        const data = this.decodeBinary(
          size,
          headOffset + 1
          /* extType */
        );
        return this.extensionCodec.decode(data, extType, this.context);
      }
      lookU8() {
        return this.view.getUint8(this.pos);
      }
      lookU16() {
        return this.view.getUint16(this.pos);
      }
      lookU32() {
        return this.view.getUint32(this.pos);
      }
      readU8() {
        const value = this.view.getUint8(this.pos);
        this.pos++;
        return value;
      }
      readI8() {
        const value = this.view.getInt8(this.pos);
        this.pos++;
        return value;
      }
      readU16() {
        const value = this.view.getUint16(this.pos);
        this.pos += 2;
        return value;
      }
      readI16() {
        const value = this.view.getInt16(this.pos);
        this.pos += 2;
        return value;
      }
      readU32() {
        const value = this.view.getUint32(this.pos);
        this.pos += 4;
        return value;
      }
      readI32() {
        const value = this.view.getInt32(this.pos);
        this.pos += 4;
        return value;
      }
      readU64() {
        const value = (0, int_ts_1.getUint64)(this.view, this.pos);
        this.pos += 8;
        return value;
      }
      readI64() {
        const value = (0, int_ts_1.getInt64)(this.view, this.pos);
        this.pos += 8;
        return value;
      }
      readU64AsBigInt() {
        const value = this.view.getBigUint64(this.pos);
        this.pos += 8;
        return value;
      }
      readI64AsBigInt() {
        const value = this.view.getBigInt64(this.pos);
        this.pos += 8;
        return value;
      }
      readF32() {
        const value = this.view.getFloat32(this.pos);
        this.pos += 4;
        return value;
      }
      readF64() {
        const value = this.view.getFloat64(this.pos);
        this.pos += 8;
        return value;
      }
    };
    exports2.Decoder = Decoder;
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/decode.cjs
var require_decode = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/decode.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.decode = decode2;
    exports2.decodeMulti = decodeMulti;
    var Decoder_ts_1 = require_Decoder();
    function decode2(buffer, options) {
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decode(buffer);
    }
    function decodeMulti(buffer, options) {
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeMulti(buffer);
    }
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/utils/stream.cjs
var require_stream = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/utils/stream.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.isAsyncIterable = isAsyncIterable;
    exports2.asyncIterableFromStream = asyncIterableFromStream;
    exports2.ensureAsyncIterable = ensureAsyncIterable;
    function isAsyncIterable(object) {
      return object[Symbol.asyncIterator] != null;
    }
    async function* asyncIterableFromStream(stream) {
      const reader = stream.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            return;
          }
          yield value;
        }
      } finally {
        reader.releaseLock();
      }
    }
    function ensureAsyncIterable(streamLike) {
      if (isAsyncIterable(streamLike)) {
        return streamLike;
      } else {
        return asyncIterableFromStream(streamLike);
      }
    }
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/decodeAsync.cjs
var require_decodeAsync = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/decodeAsync.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.decodeAsync = decodeAsync;
    exports2.decodeArrayStream = decodeArrayStream;
    exports2.decodeMultiStream = decodeMultiStream;
    var Decoder_ts_1 = require_Decoder();
    var stream_ts_1 = require_stream();
    async function decodeAsync(streamLike, options) {
      const stream = (0, stream_ts_1.ensureAsyncIterable)(streamLike);
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeAsync(stream);
    }
    function decodeArrayStream(streamLike, options) {
      const stream = (0, stream_ts_1.ensureAsyncIterable)(streamLike);
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeArrayStream(stream);
    }
    function decodeMultiStream(streamLike, options) {
      const stream = (0, stream_ts_1.ensureAsyncIterable)(streamLike);
      const decoder = new Decoder_ts_1.Decoder(options);
      return decoder.decodeStream(stream);
    }
  }
});

// sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/index.cjs
var require_dist = __commonJS({
  "sandbox/webtransport/packages/transport/node_modules/@msgpack/msgpack/dist.cjs/index.cjs"(exports2) {
    "use strict";
    Object.defineProperty(exports2, "__esModule", { value: true });
    exports2.decodeTimestampExtension = exports2.encodeTimestampExtension = exports2.decodeTimestampToTimeSpec = exports2.encodeTimeSpecToTimestamp = exports2.encodeDateToTimeSpec = exports2.EXT_TIMESTAMP = exports2.ExtData = exports2.ExtensionCodec = exports2.Encoder = exports2.DecodeError = exports2.Decoder = exports2.decodeMultiStream = exports2.decodeArrayStream = exports2.decodeAsync = exports2.decodeMulti = exports2.decode = exports2.encode = void 0;
    var encode_ts_1 = require_encode();
    Object.defineProperty(exports2, "encode", { enumerable: true, get: function() {
      return encode_ts_1.encode;
    } });
    var decode_ts_1 = require_decode();
    Object.defineProperty(exports2, "decode", { enumerable: true, get: function() {
      return decode_ts_1.decode;
    } });
    Object.defineProperty(exports2, "decodeMulti", { enumerable: true, get: function() {
      return decode_ts_1.decodeMulti;
    } });
    var decodeAsync_ts_1 = require_decodeAsync();
    Object.defineProperty(exports2, "decodeAsync", { enumerable: true, get: function() {
      return decodeAsync_ts_1.decodeAsync;
    } });
    Object.defineProperty(exports2, "decodeArrayStream", { enumerable: true, get: function() {
      return decodeAsync_ts_1.decodeArrayStream;
    } });
    Object.defineProperty(exports2, "decodeMultiStream", { enumerable: true, get: function() {
      return decodeAsync_ts_1.decodeMultiStream;
    } });
    var Decoder_ts_1 = require_Decoder();
    Object.defineProperty(exports2, "Decoder", { enumerable: true, get: function() {
      return Decoder_ts_1.Decoder;
    } });
    var DecodeError_ts_1 = require_DecodeError();
    Object.defineProperty(exports2, "DecodeError", { enumerable: true, get: function() {
      return DecodeError_ts_1.DecodeError;
    } });
    var Encoder_ts_1 = require_Encoder();
    Object.defineProperty(exports2, "Encoder", { enumerable: true, get: function() {
      return Encoder_ts_1.Encoder;
    } });
    var ExtensionCodec_ts_1 = require_ExtensionCodec();
    Object.defineProperty(exports2, "ExtensionCodec", { enumerable: true, get: function() {
      return ExtensionCodec_ts_1.ExtensionCodec;
    } });
    var ExtData_ts_1 = require_ExtData();
    Object.defineProperty(exports2, "ExtData", { enumerable: true, get: function() {
      return ExtData_ts_1.ExtData;
    } });
    var timestamp_ts_1 = require_timestamp();
    Object.defineProperty(exports2, "EXT_TIMESTAMP", { enumerable: true, get: function() {
      return timestamp_ts_1.EXT_TIMESTAMP;
    } });
    Object.defineProperty(exports2, "encodeDateToTimeSpec", { enumerable: true, get: function() {
      return timestamp_ts_1.encodeDateToTimeSpec;
    } });
    Object.defineProperty(exports2, "encodeTimeSpecToTimestamp", { enumerable: true, get: function() {
      return timestamp_ts_1.encodeTimeSpecToTimestamp;
    } });
    Object.defineProperty(exports2, "decodeTimestampToTimeSpec", { enumerable: true, get: function() {
      return timestamp_ts_1.decodeTimestampToTimeSpec;
    } });
    Object.defineProperty(exports2, "encodeTimestampExtension", { enumerable: true, get: function() {
      return timestamp_ts_1.encodeTimestampExtension;
    } });
    Object.defineProperty(exports2, "decodeTimestampExtension", { enumerable: true, get: function() {
      return timestamp_ts_1.decodeTimestampExtension;
    } });
  }
});

// sandbox/webtransport/packages/transport/src/codec.ts
function encode(type, payload) {
  const msgpackBytes = (0, import_msgpack.encode)(payload);
  const result = new Uint8Array(1 + msgpackBytes.length);
  result[0] = type;
  result.set(msgpackBytes, 1);
  return result;
}
function decode(data) {
  if (data.length === 0) throw new Error("empty message");
  const type = data[0];
  const payload = data.length > 1 ? (0, import_msgpack.decode)(data.slice(1)) : {};
  return [type, payload];
}
function encodeEvent(channel, eventType, eventId, data, offset) {
  const payload = {
    ch: channel,
    t: eventType,
    id: eventId,
    d: data
  };
  if (offset) payload.o = offset;
  return encode(16 /* EVENT */, payload);
}
function encodeDatagram(type, componentId, userData) {
  const cidBytes = new TextEncoder().encode(componentId);
  const result = new Uint8Array(1 + 1 + cidBytes.length + userData.length);
  result[0] = type;
  result[1] = cidBytes.length;
  result.set(cidBytes, 2);
  result.set(userData, 2 + cidBytes.length);
  return result;
}
var import_msgpack, MessageType;
var init_codec = __esm({
  "sandbox/webtransport/packages/transport/src/codec.ts"() {
    "use strict";
    import_msgpack = __toESM(require_dist(), 1);
    MessageType = /* @__PURE__ */ ((MessageType2) => {
      MessageType2[MessageType2["SUBSCRIBE"] = 1] = "SUBSCRIBE";
      MessageType2[MessageType2["UNSUBSCRIBE"] = 2] = "UNSUBSCRIBE";
      MessageType2[MessageType2["SUBSCRIBED"] = 3] = "SUBSCRIBED";
      MessageType2[MessageType2["RESUME"] = 4] = "RESUME";
      MessageType2[MessageType2["RESET"] = 5] = "RESET";
      MessageType2[MessageType2["PING"] = 6] = "PING";
      MessageType2[MessageType2["PONG"] = 7] = "PONG";
      MessageType2[MessageType2["ERROR"] = 8] = "ERROR";
      MessageType2[MessageType2["WELCOME"] = 9] = "WELCOME";
      MessageType2[MessageType2["EVENT"] = 16] = "EVENT";
      MessageType2[MessageType2["EVENT_BATCH"] = 17] = "EVENT_BATCH";
      MessageType2[MessageType2["CRDT_JOIN"] = 32] = "CRDT_JOIN";
      MessageType2[MessageType2["CRDT_UPDATE"] = 33] = "CRDT_UPDATE";
      MessageType2[MessageType2["CRDT_STATE"] = 34] = "CRDT_STATE";
      MessageType2[MessageType2["CRDT_LEAVE"] = 35] = "CRDT_LEAVE";
      MessageType2[MessageType2["DATAGRAM_CURSOR"] = 48] = "DATAGRAM_CURSOR";
      MessageType2[MessageType2["DATAGRAM_TYPING"] = 49] = "DATAGRAM_TYPING";
      MessageType2[MessageType2["DATAGRAM_PRESENCE"] = 50] = "DATAGRAM_PRESENCE";
      return MessageType2;
    })(MessageType || {});
  }
});

// sandbox/webtransport/packages/transport/src/webtransport-client.ts
var webtransport_client_exports = {};
__export(webtransport_client_exports, {
  WebTransportClient: () => WebTransportClient
});
var WebTransportClient;
var init_webtransport_client = __esm({
  "sandbox/webtransport/packages/transport/src/webtransport-client.ts"() {
    "use strict";
    init_codec();
    WebTransportClient = class {
      wt = null;
      controlWriter = null;
      config;
      eventHandlers = /* @__PURE__ */ new Set();
      crdtHandlers = /* @__PURE__ */ new Map();
      datagramHandlers = /* @__PURE__ */ new Set();
      _connected = false;
      reconnectTimer = null;
      lastOffsets = /* @__PURE__ */ new Map();
      constructor(config) {
        this.config = config;
      }
      get connected() {
        return this._connected;
      }
      get transport() {
        return "webtransport";
      }
      async connect() {
        const url = this.config.webtransportUrl || `${this.config.baseUrl}:4433/wt/live?token=${this.config.token}`;
        this.wt = new WebTransport(url);
        await this.wt.ready;
        this._connected = true;
        this.startReceiving();
        this.startDatagramReceiving();
        this.wt.closed.then(() => {
          this._connected = false;
          if (this.config.autoReconnect !== false) {
            this.scheduleReconnect();
          }
        });
      }
      disconnect() {
        if (this.reconnectTimer) {
          clearTimeout(this.reconnectTimer);
          this.reconnectTimer = null;
        }
        this.wt?.close();
        this.wt = null;
        this._connected = false;
      }
      async subscribe(options) {
        await this.sendControl(1 /* SUBSCRIBE */, {
          channels: options.channels,
          filter: {
            event_types: options.eventTypes,
            exclude_types: options.excludeTypes,
            entities: options.entities
          }
        });
      }
      unsubscribe(channels) {
        this.sendControl(2 /* UNSUBSCRIBE */, { channels });
      }
      onEvent(handler) {
        this.eventHandlers.add(handler);
        return () => this.eventHandlers.delete(handler);
      }
      onCRDT(componentId, handler) {
        if (!this.crdtHandlers.has(componentId)) {
          this.crdtHandlers.set(componentId, /* @__PURE__ */ new Set());
        }
        this.crdtHandlers.get(componentId).add(handler);
        return () => this.crdtHandlers.get(componentId)?.delete(handler);
      }
      onDatagram(handler) {
        this.datagramHandlers.add(handler);
        return () => this.datagramHandlers.delete(handler);
      }
      async joinComponent(componentId) {
        await this.sendControl(32 /* CRDT_JOIN */, { component_id: componentId });
      }
      sendCRDTUpdate(componentId, delta) {
        const payload = encode(33 /* CRDT_UPDATE */, {
          component_id: componentId,
          delta
        });
        this.sendOnStream(payload);
      }
      leaveComponent(componentId) {
        this.sendControl(35 /* CRDT_LEAVE */, { component_id: componentId });
      }
      sendCursor(componentId, x, y) {
        const encoder = new TextEncoder();
        const userData = new Float32Array([x, y]);
        const dg = encodeDatagram(
          48 /* DATAGRAM_CURSOR */,
          componentId,
          new Uint8Array(userData.buffer)
        );
        this.wt?.datagrams.writable.getWriter().write(dg).catch(() => {
        });
      }
      sendTyping(componentId, isTyping) {
        const userData = new Uint8Array([isTyping ? 1 : 0]);
        const dg = encodeDatagram(49 /* DATAGRAM_TYPING */, componentId, userData);
        this.wt?.datagrams.writable.getWriter().write(dg).catch(() => {
        });
      }
      async sendControl(type, payload) {
        const data = encode(type, payload);
        await this.sendOnStream(data);
      }
      async sendOnStream(data) {
        if (!this.wt) return;
        const stream = await this.wt.createBidirectionalStream();
        const writer = stream.writable.getWriter();
        await writer.write(data);
        writer.releaseLock();
      }
      async startReceiving() {
        if (!this.wt) return;
        const reader = this.wt.incomingUnidirectionalStreams.getReader();
        while (true) {
          const { value: stream, done } = await reader.read();
          if (done) break;
          this.readStream(stream);
        }
      }
      async readStream(stream) {
        const reader = stream.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value) this.handleMessage(value);
        }
      }
      async startDatagramReceiving() {
        if (!this.wt) return;
        const reader = this.wt.datagrams.readable.getReader();
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          if (value && value.length >= 2) {
            const type = value[0] === 48 /* DATAGRAM_CURSOR */ ? "cursor" : value[0] === 49 /* DATAGRAM_TYPING */ ? "typing" : "presence";
            this.datagramHandlers.forEach((h) => h(type, value.slice(1)));
          }
        }
      }
      handleMessage(data) {
        try {
          const [type, payload] = decode(data);
          if (type === 16 /* EVENT */) {
            const event = {
              channel: payload.ch,
              eventType: payload.t,
              eventId: payload.id,
              data: payload.d,
              offset: payload.o
            };
            if (event.offset) {
              this.lastOffsets.set(event.channel, event.offset);
            }
            this.eventHandlers.forEach((h) => h(event));
          } else if (type === 33 /* CRDT_UPDATE */ || type === 34 /* CRDT_STATE */) {
            const componentId = payload.component_id;
            const delta = payload.delta;
            const handlers = this.crdtHandlers.get(componentId);
            if (handlers) {
              handlers.forEach((h) => h({ componentId, delta }));
            }
          }
        } catch {
        }
      }
      scheduleReconnect() {
        const delay = this.config.reconnectDelay || 2e3;
        this.reconnectTimer = setTimeout(async () => {
          try {
            await this.connect();
            if (this.lastOffsets.size > 0) {
              await this.sendControl(4 /* RESUME */, {
                channels: [...this.lastOffsets.keys()],
                offsets: Object.fromEntries(this.lastOffsets)
              });
            }
          } catch {
            this.scheduleReconnect();
          }
        }, delay);
      }
    };
  }
});

// sandbox/webtransport/packages/transport/src/sse-client.ts
var sse_client_exports = {};
__export(sse_client_exports, {
  SSEClient: () => SSEClient
});
var SSEClient;
var init_sse_client = __esm({
  "sandbox/webtransport/packages/transport/src/sse-client.ts"() {
    "use strict";
    SSEClient = class {
      source = null;
      config;
      eventHandlers = /* @__PURE__ */ new Set();
      crdtHandlers = /* @__PURE__ */ new Map();
      datagramHandlers = /* @__PURE__ */ new Set();
      _connected = false;
      currentChannels = [];
      constructor(config) {
        this.config = config;
      }
      get connected() {
        return this._connected;
      }
      get transport() {
        return "sse";
      }
      async connect() {
        this._connected = true;
      }
      disconnect() {
        this.source?.close();
        this.source = null;
        this._connected = false;
      }
      async subscribe(options) {
        this.currentChannels = options.channels;
        this.reconnectSSE(options);
      }
      unsubscribe(channels) {
        this.currentChannels = this.currentChannels.filter(
          (c) => !channels.includes(c)
        );
        if (this.currentChannels.length === 0) {
          this.source?.close();
          this.source = null;
        } else {
          this.reconnectSSE({ channels: this.currentChannels });
        }
      }
      onEvent(handler) {
        this.eventHandlers.add(handler);
        return () => this.eventHandlers.delete(handler);
      }
      onCRDT(componentId, handler) {
        if (!this.crdtHandlers.has(componentId)) {
          this.crdtHandlers.set(componentId, /* @__PURE__ */ new Set());
        }
        this.crdtHandlers.get(componentId).add(handler);
        return () => this.crdtHandlers.get(componentId)?.delete(handler);
      }
      onDatagram(_handler) {
        return () => {
        };
      }
      async joinComponent(componentId) {
        await fetch(`${this.config.baseUrl}/api/components/${componentId}/join`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.config.token}` }
        });
      }
      sendCRDTUpdate(componentId, delta) {
        const base64 = btoa(String.fromCharCode(...delta));
        fetch(`${this.config.baseUrl}/api/components/${componentId}/update`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.token}`,
            "Content-Type": "application/json"
          },
          body: JSON.stringify({ delta: base64 })
        }).catch(() => {
        });
      }
      leaveComponent(componentId) {
        fetch(`${this.config.baseUrl}/api/components/${componentId}/leave`, {
          method: "POST",
          headers: { Authorization: `Bearer ${this.config.token}` }
        }).catch(() => {
        });
      }
      sendCursor() {
      }
      sendTyping() {
      }
      reconnectSSE(options) {
        this.source?.close();
        const params = new URLSearchParams();
        params.set("token", this.config.token);
        params.set("channels", options.channels.join(","));
        if (options.eventTypes) params.set("event_types", options.eventTypes.join(","));
        if (options.excludeTypes) params.set("exclude_types", options.excludeTypes.join(","));
        const sseUrl = this.config.sseUrl || `${this.config.baseUrl}/api/events/stream`;
        const url = `${sseUrl}?${params.toString()}`;
        this.source = new EventSource(url);
        this.source.onopen = () => {
          this._connected = true;
        };
        this.source.onerror = () => {
          this._connected = false;
        };
        this.source.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            const event = {
              channel: data.channel || "",
              eventType: data.event_type || data.type || "",
              eventId: data.event_id || e.lastEventId || "",
              data
            };
            this.eventHandlers.forEach((h) => h(event));
          } catch {
          }
        };
        this.source.addEventListener("component.updated", (e) => {
          try {
            const data = JSON.parse(e.data);
            const componentId = data.component_id;
            const deltaBase64 = data.delta;
            if (componentId && deltaBase64) {
              const delta = Uint8Array.from(atob(deltaBase64), (c) => c.charCodeAt(0));
              const handlers = this.crdtHandlers.get(componentId);
              if (handlers) {
                handlers.forEach((h) => h({ componentId, delta }));
              }
            }
          } catch {
          }
        });
      }
    };
  }
});

// sandbox/webtransport/packages/transport/src/index.ts
var index_exports = {};
__export(index_exports, {
  MessageType: () => MessageType,
  SSEClient: () => SSEClient,
  WebTransportClient: () => WebTransportClient,
  createTransport: () => createTransport,
  decode: () => decode,
  encode: () => encode,
  encodeEvent: () => encodeEvent
});
module.exports = __toCommonJS(index_exports);

// sandbox/webtransport/packages/transport/src/transport.ts
async function createTransport(config) {
  const negotiateUrl = `${config.baseUrl}/api/transport/negotiate`;
  let serverPreference = "webtransport";
  try {
    const resp = await fetch(negotiateUrl, {
      headers: { Authorization: `Bearer ${config.token}` }
    });
    if (resp.ok) {
      const neg = await resp.json();
      if (neg.mode === "sse_only" || !neg.webtransport?.enabled) {
        serverPreference = "sse";
      }
      if (neg.webtransport?.url) {
        config.webtransportUrl = neg.webtransport.url;
      }
    }
  } catch {
  }
  const hasWebTransport = typeof globalThis.WebTransport !== "undefined";
  if (hasWebTransport && serverPreference === "webtransport") {
    const { WebTransportClient: WebTransportClient2 } = await Promise.resolve().then(() => (init_webtransport_client(), webtransport_client_exports));
    const client2 = new WebTransportClient2(config);
    try {
      await client2.connect();
      return client2;
    } catch {
    }
  }
  const { SSEClient: SSEClient2 } = await Promise.resolve().then(() => (init_sse_client(), sse_client_exports));
  const client = new SSEClient2(config);
  await client.connect();
  return client;
}

// sandbox/webtransport/packages/transport/src/index.ts
init_webtransport_client();
init_sse_client();
init_codec();
// Annotate the CommonJS export names for ESM import in node:
0 && (module.exports = {
  MessageType,
  SSEClient,
  WebTransportClient,
  createTransport,
  decode,
  encode,
  encodeEvent
});
