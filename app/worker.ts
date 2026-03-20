import secp256k1 from 'secp256k1';
import createKeccakHash from 'keccak';
import randomBytes from 'randombytes';
import { Buffer } from 'buffer';
import { Mnemonic, HDNodeWallet } from 'ethers';

// Polyfill Buffer for the worker context
if (typeof self !== 'undefined') {
  (self as any).Buffer = Buffer;
}

const privateToAddress = (privateKey: Uint8Array): string => {
  const pub = secp256k1.publicKeyCreate(privateKey, false).slice(1);
  return createKeccakHash('keccak256').update(Buffer.from(pub)).digest().slice(-20).toString('hex');
};

const getRandomWallet = (mode: string, mnemonicLength: number, passphrase?: string) => {
  if (mode === 'seedPhrase') {
    const entropySize = mnemonicLength === 12 ? 16 : mnemonicLength === 15 ? 20 : mnemonicLength === 18 ? 24 : mnemonicLength === 21 ? 28 : 32;
    const entropy = randomBytes(entropySize);
    const mnemonic = Mnemonic.fromEntropy(entropy);
    const wallet = HDNodeWallet.fromMnemonic(mnemonic, passphrase);
    return {
      address: wallet.address.substring(2).toLowerCase(),
      privKey: wallet.privateKey.substring(2).toLowerCase(),
      mnemonic: mnemonic.phrase,
      publicKey: wallet.publicKey.substring(2)
    };
  }
  const randbytes = randomBytes(32);
  const pub = secp256k1.publicKeyCreate(randbytes, false);
  return {
    address: privateToAddress(randbytes),
    privKey: Buffer.from(randbytes).toString('hex'),
    publicKey: Buffer.from(pub).toString('hex')
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

const getVanityWallet = (prefix: string, suffix: string, isChecksum: boolean, mode: string, mnemonicLength: number, passphrase: string, cb: (msg: any) => void) => {
  const pre = isChecksum ? prefix : prefix.toLowerCase();
  const suf = isChecksum ? suffix : suffix.toLowerCase();
  const currentStep = mode === 'seedPhrase' ? 25 : 2000;

  while (true) {
    let wallet = getRandomWallet(mode, mnemonicLength, passphrase);
    let attempts = 1;

    while (!isValidVanityAddress(wallet.address, pre, suf, isChecksum)) {
      if (attempts >= currentStep) {
        cb({ attempts });
        attempts = 0;
      }
      wallet = getRandomWallet(mode, mnemonicLength, passphrase);
      attempts++;
    }
    cb({ address: '0x' + toChecksumAddress(wallet.address), privKey: wallet.privKey, mnemonic: wallet.mnemonic, publicKey: wallet.publicKey, attempts });
    // Keep loop running to find more wallets until terminated
  }
};

self.onmessage = function (event: MessageEvent) {
  const input = event.data;
  try {
    getVanityWallet(input.prefix, input.suffix, input.checksum, input.mode, input.mnemonicLength, input.passphrase, (message: any) => {
      self.postMessage(message);
    });
  } catch (err: any) {
    self.postMessage({ error: err.toString() });
  }
};

