import secp256k1 from 'secp256k1';
import createKeccakHash from 'keccak';
import randomBytes from 'randombytes';
import { Buffer } from 'buffer';

// Polyfill Buffer for the worker context
if (typeof self !== 'undefined') {
  (self as any).Buffer = Buffer;
}

const privateToAddress = (privateKey: Uint8Array): string => {
  const pub = secp256k1.publicKeyCreate(privateKey, false).slice(1);
  return createKeccakHash('keccak256').update(Buffer.from(pub)).digest().slice(-20).toString('hex');
};

const getRandomWallet = () => {
  const randbytes = randomBytes(32);
  return {
    address: privateToAddress(randbytes),
    privKey: Buffer.from(randbytes).toString('hex'),
  };
};

const isValidChecksum = (address: string, prefix: string, suffix: string): boolean => {
  const hash = createKeccakHash('keccak256').update(Buffer.from(address)).digest().toString('hex');
  
  for (let i = 0; i < prefix.length; i++) {
    if (prefix[i] !== (parseInt(hash[i], 16) >= 8 ? address[i].toUpperCase() : address[i])) {
      return false;
    }
  }

  for (let i = 0; i < suffix.length; i++) {
    const j = i + 40 - suffix.length;
    if (suffix[i] !== (parseInt(hash[j], 16) >= 8 ? address[j].toUpperCase() : address[j])) {
      return false;
    }
  }

  return true;
};

const isValidVanityAddress = (address: string, prefix: string, suffix: string, isChecksum: boolean): boolean => {
  const addressPrefix = address.substring(0, prefix.length);
  const addressSuffix = address.substring(40 - suffix.length);

  if (!isChecksum) {
    return prefix === addressPrefix && suffix === addressSuffix;
  }
  if (prefix.toLowerCase() !== addressPrefix || suffix.toLowerCase() !== addressSuffix) {
    return false;
  }

  return isValidChecksum(address, prefix, suffix);
};

const toChecksumAddress = (address: string): string => {
  const hash = createKeccakHash('keccak256').update(Buffer.from(address)).digest().toString('hex');
  let ret = '';
  for (let i = 0; i < address.length; i++) {
    ret += parseInt(hash[i], 16) >= 8 ? address[i].toUpperCase() : address[i];
  }
  return ret;
};

const step = 2000;

const getVanityWallet = (prefix: string, suffix: string, isChecksum: boolean, cb: (msg: any) => void) => {
  let wallet = getRandomWallet();
  let attempts = 1;

  const pre = isChecksum ? prefix : prefix.toLowerCase();
  const suf = isChecksum ? suffix : suffix.toLowerCase();

  while (!isValidVanityAddress(wallet.address, pre, suf, isChecksum)) {
    if (attempts >= step) {
      cb({ attempts });
      attempts = 0;
    }
    wallet = getRandomWallet();
    attempts++;
  }
  cb({ address: '0x' + toChecksumAddress(wallet.address), privKey: wallet.privKey, attempts });
};

self.onmessage = function (event: MessageEvent) {
  const input = event.data;
  try {
    getVanityWallet(input.prefix, input.suffix, input.checksum, (message: any) => {
      self.postMessage(message);
    });
  } catch (err: any) {
    self.postMessage({ error: err.toString() });
  }
};
