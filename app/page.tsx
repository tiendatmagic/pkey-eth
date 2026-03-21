"use client";

import { useState, useEffect, useRef } from "react";
import { Wallet } from "ethers";
import * as JSZipModule from "jszip";
import { translations, Language } from "./i18n";

const JSZip = (JSZipModule as any).default || JSZipModule;

const MAX_WALLETS = 1000000000;

const generateRandomHex = (length: number) => {
  if (length <= 0) return "";
  return Array.from({ length }, () => Math.floor(Math.random() * 16).toString(16)).join('');
};

const computeDifficulty = (prefix: string, suffix: string, isChecksum: boolean) => {
  const pattern = prefix + suffix;
  if (!pattern) return 1;
  const ret = Math.pow(16, pattern.length);
  return isChecksum ? ret * Math.pow(2, pattern.replace(/[^a-f]/gi, "").length) : ret;
};

const computeProbability = (difficulty: number, attempts: number) => {
  if (difficulty <= 1) return 1;
  return 1 - Math.pow(1 - 1 / difficulty, attempts);
};

const formatNum = (num: number | string) => {
  return num.toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ");
};

const humanizeDuration = (seconds: number) => {
  if (seconds > 200 * 365.25 * 24 * 3600 || seconds === -Infinity) {
    return "Thousands of years";
  }
  const d = Math.floor(seconds / (3600 * 24));
  const h = Math.floor((seconds % (3600 * 24)) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);

  if (d > 0) return `${d} days`;
  if (h > 0) return `${h} hours`;
  if (m > 0) return `${m} minutes`;
  return `${s} seconds`;
};

// Shuffles a string visually
const shuffleString = (str: string) => {
  return str.split('').sort(() => 0.5 - Math.random()).join('');
};

export default function Home() {
  const [conditions, setConditions] = useState<{ prefix: string; suffix: string; id: number }[]>([
    { prefix: "", suffix: "", id: Date.now() }
  ]);
  const [checksum, setChecksum] = useState(true);

  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState("Waiting");
  const [attempts, setAttempts] = useState(0);

  const [threads, setThreads] = useState(1);
  const [keysPerSec, setKeysPerSec] = useState(0);
  const [error, setError] = useState("");

  const [toasts, setToasts] = useState<{ id: number; message: string }[]>([]);
  const [isDark, setIsDark] = useState(true);

  const [lang, setLang] = useState<Language>('en');
  const [exampleHex, setExampleHex] = useState("fa5ccC7a0E1C9b2d8f9B1a4C9A28D90FB2A28D90FB".slice(0, 40));

  const [genMode, setGenMode] = useState<'privateKey' | 'seedPhrase'>('privateKey');
  const [mnemonicLength, setMnemonicLength] = useState<number>(12);
  const [timeElapsed, setTimeElapsed] = useState(0);

  const [usePassphrase, setUsePassphrase] = useState(false);
  const [passphrase, setPassphrase] = useState("");
  const [walletCount, setWalletCount] = useState<number | "">(1);
  const [foundWallets, setFoundWallets] = useState<any[]>([]);

  const [maxCores, setMaxCores] = useState(1);
  const [showKeystoreModal, setShowKeystoreModal] = useState(false);
  const [keystoreMode, setKeystoreMode] = useState<'single' | 'all'>('single');
  const [encryptProgressText, setEncryptProgressText] = useState("");
  const [keystorePassword, setKeystorePassword] = useState("");
  const [isEncrypting, setIsEncrypting] = useState(false);
  const [showInfiniteWarning, setShowInfiniteWarning] = useState(false);
  const [persistentSkipWarning, setPersistentSkipWarning] = useState(false);
  const [modalCheckbox, setModalCheckbox] = useState(true);
  const [selectedWallet, setSelectedWallet] = useState<any>(null);
  const [displayCount, setDisplayCount] = useState(100);

  const t = translations[lang];

  const workersRef = useRef<Worker[]>([]);
  const startTickRef = useRef<number>(0);
  const attemptsRef = useRef<number>(0);
  const toastIdRef = useRef<number>(0);
  const foundCountRef = useRef<number>(0);
  const foundWalletsBufferRef = useRef<any[]>([]);
  const abortEncryptRef = useRef<boolean>(false);

  const showToast = (message: string) => {
    const id = toastIdRef.current++;
    setToasts((prev) => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 3000);
  };

  useEffect(() => {
    let cores = 1;
    try {
      if (navigator.hardwareConcurrency) {
        cores = navigator.hardwareConcurrency;
      }
    } catch (err) {}
    setMaxCores(cores);
    setThreads(cores);

    const savedLang = localStorage.getItem("lang") as Language;
    if (savedLang && (savedLang === 'en' || savedLang === 'vi')) {
      setLang(savedLang);
    }

    const savedSkip = localStorage.getItem("skipInfiniteWarning");
    if (savedSkip === "true") {
      setPersistentSkipWarning(true);
    }
  }, []);

  const changeLanguage = (newLang: Language) => {
    setLang(newLang);
    localStorage.setItem("lang", newLang);
  };

  useEffect(() => {
    const firstCond = conditions[0] || { prefix: "", suffix: "" };
    const len = Math.max(0, 40 - (firstCond.prefix.length + firstCond.suffix.length));
    setExampleHex(generateRandomHex(len));
  }, [conditions]);

  useEffect(() => {
    let animationFrameId: number;
    let lastRenderTick = performance.now();

    const uiRenderLoop = () => {
      const now = performance.now();

      // Ensure buffer is flushed even if searching has stopped so we don't lose the last found wallets
      if (foundWalletsBufferRef.current.length > 0 && (now - lastRenderTick > 500 || !running)) {
        lastRenderTick = now;
        const batch = [...foundWalletsBufferRef.current];
        foundWalletsBufferRef.current = [];
        setFoundWallets((prev) => [...prev, ...batch]);
      }

      if (running) {
        if (now - lastRenderTick > 500) {
          lastRenderTick = now;
          setAttempts(attemptsRef.current);

          const duration = (now - startTickRef.current) / 1000;
          if (duration > 0) {
            setKeysPerSec(Math.round(attemptsRef.current / duration));
            setTimeElapsed(duration);
          }
        }
      }
      animationFrameId = requestAnimationFrame(uiRenderLoop);
    };

    uiRenderLoop();

    return () => cancelAnimationFrame(animationFrameId);
  }, [running]);

  const terminateWorkers = () => {
    if (workersRef.current.length > 0) {
      workersRef.current.forEach((worker) => worker.terminate());
      workersRef.current = [];
    }
  };

  const initWorkers = () => {
    terminateWorkers();
    try {
      const newWorkers = [];
      for (let i = 0; i < threads; i++) {
        const worker = new Worker(new URL("./worker.ts", import.meta.url), {
          type: "module",
        });

        worker.onmessage = (e) => {
          handleWorkerMessage(e.data);
        };
        newWorkers.push(worker);
      }
      workersRef.current = newWorkers;
    } catch (err: any) {
      setError("Failed to initialize workers: " + err.message);
    }
  };

  const toggleWalletVisibility = (id: number, type: 'key' | 'mnemonic') => {
    setFoundWallets((prev) => prev.map((w) => {
      if (w.id === id) {
        if (type === 'key') return { ...w, isKeyVisible: !w.isKeyVisible };
        if (type === 'mnemonic') return { ...w, isMnemonicVisible: !w.isMnemonicVisible };
      }
      return w;
    }));
  };

  const handleWorkerMessage = (data: any) => {
    if (data.error) {
      stopGen();
      setError(data.error);
      setStatus("Error");
      return;
    }

    if (data.address) {
      const target = walletCount === "" ? MAX_WALLETS : Math.min(Number(walletCount), MAX_WALLETS);
      if (foundCountRef.current >= target) return;
      foundCountRef.current++;

      const newAttempts = attemptsRef.current + data.attempts;
      attemptsRef.current = newAttempts;
      setAttempts(newAttempts);

      const newWallet = {
        address: data.address,
        privKey: data.privKey,
        mnemonic: data.mnemonic,
        publicKey: data.publicKey,
        id: Date.now() + Math.random(),
        isKeyVisible: false,
        isMnemonicVisible: false,
        blurredPrivKey: shuffleString(data.privKey),
        blurredMnemonic: data.mnemonic ? shuffleString(data.mnemonic) : ""
      };
      foundWalletsBufferRef.current.push(newWallet);

      if (foundCountRef.current >= target) {
        stopGen();
        setStatus("Address Found");
        showToast(`${t.addressFound} (${foundCountRef.current})`);
      }
      return;
    }

    if (data.attempts) {
      attemptsRef.current += data.attempts;
    }
  };

  const startGen = () => {
    if (!window.Worker) {
      setError("Web Workers are not supported in your browser.");
      return;
    }

    const cleanConditions = conditions.map(c => ({
      prefix: c.prefix.trim(),
      suffix: c.suffix.trim()
    })).filter(c => c.prefix || c.suffix);

    if (cleanConditions.length === 0) {
      setError("Please enter at least one prefix or suffix.");
      return;
    }

    terminateWorkers();

    setError("");
    setFoundWallets([]);
    setSelectedWallet(null);
    setRunning(true);
    setStatus("Running");
    setAttempts(0);
    setKeysPerSec(0);
    setTimeElapsed(0);
    attemptsRef.current = 0;
    startTickRef.current = performance.now();
    foundCountRef.current = 0;
    foundWalletsBufferRef.current = [];
    setDisplayCount(100);

    initWorkers();

    const inputMsg = {
      conditions: cleanConditions,
      checksum,
      mode: genMode,
      mnemonicLength,
      passphrase: usePassphrase ? passphrase : "",
    };

    workersRef.current.forEach((worker) => {
      worker.postMessage(inputMsg);
    });
  };

  const stopGen = () => {
    terminateWorkers();
    setRunning(false);
    setStatus((prev) => (prev === "Running" ? "Stopped" : prev));

    // Final flush of the buffer
    if (foundWalletsBufferRef.current.length > 0) {
      const batch = [...foundWalletsBufferRef.current];
      foundWalletsBufferRef.current = [];
      setFoundWallets((prev) => [...prev, ...batch]);
    }
  };

  const copyToClipboard = (text: string, successMessage: string) => {
    navigator.clipboard.writeText(text);
    showToast(successMessage);
  };

  const handleDownloadKeystore = async () => {
    if (!keystorePassword || isEncrypting || (keystoreMode === 'single' && !selectedWallet)) return;
    setIsEncrypting(true);
    abortEncryptRef.current = false;
    setEncryptProgressText(keystoreMode === 'single' ? t.encrypting : `${t.encrypting} 0/${foundWallets.length}`);

    setTimeout(async () => {
      try {
        if (keystoreMode === 'single' && selectedWallet) {
          const wallet = new Wallet("0x" + selectedWallet.privKey);
          const json = await wallet.encrypt(keystorePassword);

          const blob = new Blob([json], { type: "application/json" });
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          const addressPart = wallet.address.toLowerCase().replace("0x", "");
          a.download = `UTC--${new Date().toISOString().replace(/:/g, '-')}--${addressPart}.json`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast("JSON Keystore Downloaded!");
        } else if (keystoreMode === 'all') {
          const zip = new (JSZip as any)();

          for (let i = 0; i < foundWallets.length; i++) {
            if (abortEncryptRef.current) {
              setIsEncrypting(false);
              setEncryptProgressText("");
              return;
            }
            setEncryptProgressText(`${t.encrypting} ${i + 1}/${foundWallets.length} (Heavy CPU)`);
            await new Promise((resolve) => setTimeout(resolve, 10));

            const w = foundWallets[i];
            const wallet = new Wallet("0x" + w.privKey);
            const json = await wallet.encrypt(keystorePassword);
            const addressPart = wallet.address.toLowerCase().replace("0x", "");
            zip.file(`UTC--${new Date().toISOString().replace(/:/g, '-')}--${addressPart}.json`, json);
          }

          if (abortEncryptRef.current) {
            setIsEncrypting(false);
            setEncryptProgressText("");
            return;
          }

          setEncryptProgressText("Compressing...");
          await new Promise((resolve) => setTimeout(resolve, 10));
          const zipContent = await zip.generateAsync({ type: "blob" });
          const url = URL.createObjectURL(zipContent);
          const a = document.createElement("a");
          a.href = url;
          a.download = `keystores-${new Date().toISOString().replace(/:/g, "-")}.zip`;
          document.body.appendChild(a);
          a.click();
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
          showToast(`Downloaded ${foundWallets.length} Keystores (ZIP)!`);
        }

        setShowKeystoreModal(false);
        setKeystorePassword("");
      } catch (err: any) {
        showToast("Encryption failed: " + err.message);
      } finally {
        setIsEncrypting(false);
        setEncryptProgressText("");
      }
    }, 50);
  };

  const handleDownloadSeed = (wallet: any) => {
    let content = "";
    content += `Your Ethereum wallet address: ${wallet.address}\n`;
    if (wallet.mnemonic) content += `Your mnemonic phrase: ${wallet.mnemonic}\n`;
    content += `Private Key: ${wallet.privKey}\n`;
    content += `Public Key: ${wallet.publicKey}\n`;

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eth-wallet-${wallet.address}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("Seed Phrase Downloaded!");
  };

  const handleDownloadAllSeed = () => {
    if (foundWallets.length === 0) return;
    const content = foundWallets.map(w => {
      let text = "";
      text += `Your Ethereum wallet address: ${w.address}\n`;
      if (w.mnemonic) text += `Your mnemonic phrase: ${w.mnemonic}\n`;
      text += `Private Key: ${w.privKey}\n`;
      text += `Public Key: ${w.publicKey}\n`;
      return text;
    }).join("\n---\n");

    const blob = new Blob([content], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `eth-wallets-export-${Date.now()}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`${foundWallets.length} Wallets Downloaded!`);
  };

  const addCondition = () => {
    if (conditions.length >= 10) return; // Limit to 10 conditions for stability
    setConditions([...conditions, { prefix: "", suffix: "", id: Date.now() + Math.random() }]);
  };

  const removeCondition = (id: number) => {
    if (conditions.length <= 1) return;
    setConditions(conditions.filter(c => c.id !== id));
  };

  const updateCondition = (id: number, field: 'prefix' | 'suffix', value: string) => {
    setConditions(conditions.map(c => {
      if (c.id === id) {
        const otherField = field === 'prefix' ? 'suffix' : 'prefix';
        const maxLength = 40 - c[otherField].length;
        const cleanedValue = value.replace(/[^0-9a-fA-F]/g, '').slice(0, maxLength);
        return { ...c, [field]: cleanedValue };
      }
      return c;
    }));
  };

  const isInputValid = conditions.every(c => 
    (!c.prefix || c.prefix.match(/^[0-9a-fA-F]*$/)) && 
    (!c.suffix || c.suffix.match(/^[0-9a-fA-F]*$/)) && 
    (c.prefix.length + c.suffix.length <= 40)
  ) && conditions.some(c => c.prefix || c.suffix);

  const computeConditionsDifficulty = () => {
    let totalInvDifficulty = 0;
    for (const c of conditions) {
      if (!c.prefix && !c.suffix) continue;
      const d = computeDifficulty(c.prefix, c.suffix, checksum);
      totalInvDifficulty += (1 / d);
    }
    return totalInvDifficulty > 0 ? 1 / totalInvDifficulty : 1;
  };

  const difficulty = isInputValid ? computeConditionsDifficulty() : 1;
  const prob50Addresses = difficulty > 1 ? Math.floor(Math.log(0.5) / Math.log(1 - 1 / difficulty)) : 0;
  const time50 = keysPerSec > 0 && prob50Addresses > 0 ? humanizeDuration(prob50Addresses / keysPerSec) : "N/A";
  const currentProbability = isInputValid && difficulty > 1 ? Math.round(10000 * computeProbability(difficulty, attempts)) / 100 : 100;

  const displayDifficulty = !isInputValid ? "N/A" : difficulty === 1 ? 1 : formatNum(difficulty);
  const displayAdresses50 = !isInputValid || difficulty === 1
    ? "N/A"
    : prob50Addresses === -Infinity
    ? "Nearly impossible"
    : formatNum(prob50Addresses) + " addresses";
  const displayTime50 = (!isInputValid || difficulty === 1) ? "N/A" : keysPerSec ? time50 : displayAdresses50;

  // Theme configuration overrides
  const bgMain = isDark ? "bg-slate-900" : "bg-slate-50";
  const textMain = isDark ? "text-slate-200" : "text-slate-800";
  const textMuted = isDark ? "text-slate-400" : "text-slate-500";
  const cardBg = isDark ? "bg-slate-800/80" : "bg-white/90";
  const cardBorder = isDark ? "border-slate-700/50" : "border-slate-200";
  const cardShadow = isDark ? "shadow-xl" : "shadow-lg shadow-slate-200/50";
  const inputBg = isDark ? "bg-slate-900/80" : "bg-slate-100/50";
  const inputBorder = isDark ? "border-slate-600" : "border-slate-300";
  const inputActive = "focus:ring-2 focus:ring-emerald-500 focus:border-transparent outline-none";
  const codeBox = isDark ? "bg-slate-900 border-emerald-900/50 text-emerald-300" : "bg-slate-100 border-emerald-200 text-emerald-700";
  const subtleBorder = isDark ? "border-slate-700/50" : "border-slate-200";
  const btnIconBg = isDark ? "bg-slate-800 hover:bg-slate-700 border-slate-700" : "bg-slate-100 hover:bg-slate-200 border-slate-200";
  const stopBg = isDark ? "bg-slate-700 hover:bg-rose-600 text-white" : "bg-slate-300 hover:bg-rose-500 text-slate-800 hover:text-white";
  const successBox = isDark ? "bg-slate-900/80 border-slate-700/50" : "bg-slate-50 border-slate-200";
  const addressText = isDark ? "text-emerald-300" : "text-emerald-700";
  const privKeyText = isDark ? "text-rose-300" : "text-rose-600";
  const displayStatus = status === "Running" ? t.running : status === "Waiting" ? t.waiting : status === "Stopped" ? t.stopped : status === "Error" ? t.error : status === "Address Found" ? t.addressFound : status;

  return (
    <div className={`min-h-screen ${bgMain} ${textMain} font-sans flex flex-col items-center transition-colors duration-300 relative`}>
      {/* Floating Buttons: Lang & Theme */}
      <div className="absolute top-6 right-6 flex items-center gap-3 z-20">
        <button
          onClick={() => changeLanguage(lang === 'en' ? 'vi' : 'en')}
          className={`p-3 rounded-full shadow-lg backdrop-blur border cursor-pointer ${isDark ? 'bg-slate-800/50 border-slate-600 text-slate-200' : 'bg-white/80 border-slate-200 text-slate-600'} hover:scale-110 transition-all font-bold text-sm tracking-widest`}
          aria-label="Toggle Language"
          title="Toggle Language"
        >
          {lang === 'en' ? 'EN' : 'VI'}
        </button>

        <button
          onClick={() => setIsDark(!isDark)}
          className={`p-3 rounded-full shadow-lg backdrop-blur border cursor-pointer ${isDark ? 'bg-slate-800/50 border-slate-600 text-amber-300' : 'bg-white/80 border-slate-200 text-slate-600'} hover:scale-110 transition-all`}
          aria-label="Toggle Dark Mode"
        >
          {isDark ? (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
            </svg>
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
            </svg>
          )}
        </button>
      </div>

      <div className="max-w-7xl w-full px-4">
        <div className="text-center mb-6 md:mb-10 pt-4 flex flex-col items-center">
          <div className="mb-3 md:mb-4 p-2 md:p-3 rounded-2xl border border-slate-700/30 backdrop-blur-sm">
            <img src="/logo.png" alt="PKey ETH Logo" className="h-20 w-auto rounded-lg" />
          </div>
          <h1 className={`text-3xl md:text-4xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r ${isDark ? "from-emerald-400 to-teal-300" : "from-emerald-600 to-teal-500"} mb-3 transition-transform duration-300 inline-block pointer-events-none`}>
            {t.title}
          </h1>
          <p className={`${textMuted} max-w-2xl mx-auto text-lg leading-relaxed`}>
            {t.subtitle} <strong className={`${isDark ? 'text-emerald-400' : 'text-emerald-600'} font-semibold`}>{t.securely}</strong>.
            <br />
            <span className="text-sm font-light mt-1 inline-block">
              {t.hwAcc}
            </span>
          </p>
        </div>

        {error && (
          <div className="bg-red-500/10 text-red-500 font-medium border border-red-500/30 rounded-lg p-4 mb-6 text-center animate-[pulse_2s_ease-in-out_infinite]">
            {error}
          </div>
        )}

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
          {/* User Input Panel */}
          <div className={`${cardBg} rounded-2xl ${cardShadow} p-4 md:p-8 border ${cardBorder} backdrop-blur-md relative overflow-hidden group transition-colors duration-300`}>
            <div className={`absolute top-0 left-0 w-full h-1 bg-gradient-to-r ${isDark ? "from-emerald-500 to-teal-400 opacity-60" : "from-emerald-400 to-teal-300 opacity-80"} group-hover:opacity-100 transition-opacity`}></div>

            <form onSubmit={(e) => e.preventDefault()}>
              {/* Generation Mode Selection */}
              <div className="mb-6">
                <label className={`block text-xs font-bold ${textMuted} uppercase tracking-widest mb-3`}>{t.genMode}</label>
                <div className="grid grid-cols-2 gap-3">
                  <button
                    type="button"
                    onClick={() => setGenMode('privateKey')}
                    disabled={running}
                    className={`py-2.5 px-4 rounded-lg font-bold border transition-all ${genMode === 'privateKey' ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : `${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'} hover:border-slate-500`}`}
                  >
                    {t.privateKeyMode}
                  </button>
                  <button
                    type="button"
                    onClick={() => setGenMode('seedPhrase')}
                    disabled={running}
                    className={`py-2.5 px-4 rounded-lg font-bold border transition-all ${genMode === 'seedPhrase' ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : `${isDark ? 'border-slate-700 text-slate-400' : 'border-slate-200 text-slate-500'} hover:border-slate-500`}`}
                  >
                    {t.seedPhraseMode}
                  </button>
                </div>
              </div>

              {genMode === 'seedPhrase' && (
                <div className="mb-6 animate-[fadeIn_0.3s_ease-out]">
                  <label className={`block text-xs font-bold ${textMuted} uppercase tracking-widest mb-3`}>{t.mnemonicLength}</label>
                  <div className="grid grid-cols-3 sm:grid-cols-5 gap-2 mb-4">
                    {[12, 15, 18, 21, 24].map((len) => (
                      <button
                        key={len}
                        type="button"
                        onClick={() => setMnemonicLength(len)}
                        disabled={running}
                        className={`flex-1 min-w-[60px] py-2 rounded-lg font-mono font-bold border transition-all ${mnemonicLength === len ? 'bg-indigo-500/10 border-indigo-500 text-indigo-400 shadow-[0_0_10px_rgba(99,102,241,0.1)]' : `${isDark ? 'border-slate-700 text-slate-500' : 'border-slate-200 text-slate-500'} hover:border-slate-500`}`}
                      >
                        {len}
                      </button>
                    ))}
                  </div>

                  <div className="space-y-3">
                    <label className="flex items-center cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={usePassphrase}
                        onChange={(e) => setUsePassphrase(e.target.checked)}
                        disabled={running}
                        className={`w-5 h-5 text-indigo-500 ${isDark ? 'bg-slate-900 border-slate-600' : 'bg-white border-slate-300'} rounded focus:ring-indigo-500 focus:ring-offset-0`}
                      />
                      <span className={`ml-3 font-medium ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{t.usePassphrase}</span>
                    </label>

                    {usePassphrase && (
                      <input
                        type="text"
                        value={passphrase}
                        onChange={(e) => setPassphrase(e.target.value)}
                        disabled={running}
                        placeholder={t.passphrasePlaceholder}
                        className={`w-full px-4 py-2.5 ${inputBg} border ${inputBorder} rounded-lg ${inputActive} ${textMain} disabled:opacity-50 text-base transition-all shadow-sm animate-[fadeIn_0.2s_ease-out]`}
                      />
                    )}
                  </div>
                </div>
              )}

              <div className="mb-6">
                <label className={`block text-xs font-bold ${textMuted} uppercase tracking-widest mb-3`}>{t.walletCount}</label>
                <div className="flex flex-wrap items-center gap-4 flex-col sm:flex-row">
                  <div className={`flex w-auto items-center ${isDark ? 'bg-slate-900/80 shadow-inner' : 'bg-slate-50 shadow-sm'} rounded-xl p-1.5 border ${subtleBorder} select-none h-[52px]`}>
                    <button
                      type="button"
                      onClick={() => setWalletCount(walletCount === "" ? 1 : Math.max(1, Number(walletCount) - 1))}
                      disabled={running || walletCount === ""}
                      className={`w-10 h-10 flex items-center justify-center rounded-lg ${btnIconBg} text-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100 shadow-sm`}
                    >
                      -
                    </button>
                    <div className="px-4 text-center min-w-[120px]">
                      {walletCount === "" ? (
                        <span className={`text-2xl font-black ${isDark ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]' : 'text-emerald-600'}`}>∞</span>
                      ) : (
                        <input
                          type="number"
                          min="1"
                          max={MAX_WALLETS}
                          value={walletCount}
                          onChange={(e) => {
                            const val = e.target.value === "" ? "" : parseInt(e.target.value);
                            const cappedVal = val === "" ? 1 : Math.min(val, MAX_WALLETS);
                            setWalletCount(cappedVal);
                          }}
                          disabled={running}
                          className={`w-20 text-center text-2xl font-black bg-transparent border-none outline-none ${isDark ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]' : 'text-emerald-600'} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
                        />
                      )}
                      <span className={`text-[11px] ${textMuted} block -mt-1 font-extrabold uppercase tracking-widest`}>{t.wallets}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setWalletCount(walletCount === "" ? 1 : Number(walletCount) + 1)}
                      disabled={running || walletCount === ""}
                      className={`w-10 h-10 flex items-center justify-center rounded-lg ${btnIconBg} text-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100 shadow-sm`}
                    >
                      +
                    </button>
                  </div>
                  <label className={`flex flex-1 sm:flex-none justify-center items-center cursor-pointer ${isDark ? 'bg-slate-800/80 border-slate-700 hover:border-slate-500' : 'bg-white border-slate-300 hover:border-slate-400'} px-5 py-2.5 rounded-lg border transition-all h-[52px] shadow-sm`}>
                    <input
                      type="checkbox"
                      checked={walletCount === ""}
                      onChange={(e) => {
                        if (e.target.checked) {
                          if (persistentSkipWarning) {
                            setWalletCount("");
                          } else {
                            setModalCheckbox(true);
                            setShowInfiniteWarning(true);
                          }
                        } else {
                          setWalletCount(1);
                        }
                      }}
                      disabled={running}
                      className={`w-5 h-5 text-emerald-500 ${isDark ? 'bg-slate-900 border-slate-600' : 'bg-white border-slate-300'} rounded focus:ring-emerald-500 focus:ring-offset-0`}
                    />
                    <span className={`ml-3 text-base font-bold ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{t.infinite}</span>
                  </label>
                </div>
              </div>

              <div className="space-y-4 mb-6">
                <label className={`block text-xs font-bold ${textMuted} uppercase tracking-widest`}>{t.conditions}</label>
                {conditions.map((condition, index) => (
                  <div key={condition.id} className="flex gap-3 items-center group/item">
                    <div className="grid grid-cols-2 gap-3 flex-1">
                      <input
                        type="text"
                        value={condition.prefix}
                        onChange={(e) => updateCondition(condition.id, 'prefix', e.target.value)}
                        disabled={running}
                        placeholder={t.prefixPlaceholder}
                        className={`w-full px-4 py-2.5 ${inputBg} border ${inputBorder} rounded-lg ${inputActive} ${textMain} disabled:opacity-50 text-base transition-all shadow-sm`}
                      />
                      <input
                        type="text"
                        value={condition.suffix}
                        onChange={(e) => updateCondition(condition.id, 'suffix', e.target.value)}
                        disabled={running}
                        placeholder={t.suffixPlaceholder}
                        className={`w-full px-4 py-2.5 ${inputBg} border ${inputBorder} rounded-lg ${inputActive} ${textMain} disabled:opacity-50 text-base transition-all shadow-sm`}
                      />
                    </div>
                    {conditions.length > 1 && (
                      <button
                        type="button"
                        onClick={() => removeCondition(condition.id)}
                        disabled={running}
                        className={`p-2.5 rounded-lg border ${isDark ? 'border-rose-900/30 bg-rose-900/10 text-rose-400 hover:bg-rose-900/20' : 'border-rose-200 bg-rose-50 text-rose-600 hover:bg-rose-100'} transition-all opacity-0 group-hover/item:opacity-100 disabled:opacity-30`}
                        title={t.removeCondition}
                      >
                        <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
                          <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
                        </svg>
                      </button>
                    )}
                  </div>
                ))}
                
                {conditions.length < 10 && (
                  <button
                    type="button"
                    onClick={addCondition}
                    disabled={running}
                    className={`w-full py-2 border-2 border-dashed ${isDark ? 'border-slate-700 text-slate-500 hover:border-emerald-500/50 hover:text-emerald-400 hover:bg-emerald-500/5' : 'border-slate-200 text-slate-400 hover:border-emerald-400 hover:text-emerald-600 hover:bg-emerald-50'} rounded-lg transition-all font-bold flex items-center justify-center gap-2 group`}
                  >
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5 group-hover:scale-110 transition-transform" viewBox="0 0 20 20" fill="currentColor">
                      <path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd" />
                    </svg>
                    {t.addCondition}
                  </button>
                )}
              </div>

              <div className={`text-center ${textMuted} mb-6 ${isDark ? "bg-slate-900/50" : "bg-slate-100"} py-3 px-2 rounded-lg border ${subtleBorder} w-full overflow-hidden flex flex-col items-center justify-center`}>
                <span className="mb-1 text-sm font-semibold">{t.eg}</span>
                <span className={`font-mono px-3 py-1.5 rounded border ${codeBox} break-all word-break text-[0.95rem] tracking-wide inline-block max-w-full leading-relaxed`}>
                  0x{conditions[0]?.prefix || ""}<span className="opacity-50">{exampleHex}</span>{conditions[0]?.suffix || ""}
                </span>
              </div>

              <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
                <label className={`flex items-center cursor-pointer group-hover:${isDark ? 'text-amber-200' : 'text-amber-600'} transition-colors`}>
                  <input
                    type="checkbox"
                    checked={checksum}
                    onChange={(e) => setChecksum(e.target.checked)}
                    disabled={running}
                    className={`w-5 h-5 text-emerald-500 ${isDark ? 'bg-slate-900 border-slate-600' : 'bg-white border-slate-300'} rounded focus:ring-emerald-500 focus:ring-offset-0`}
                  />
                  <span className={`ml-3 font-medium ${isDark ? 'text-slate-300' : 'text-slate-600'}`}>{t.caseSensitive}</span>
                </label>

                <div className="flex flex-col items-end gap-2">
                  <div className={`flex w-full sm:w-auto items-center ${isDark ? 'bg-slate-900/80 shadow-inner' : 'bg-slate-50 shadow-sm'} rounded-xl p-1.5 border ${subtleBorder} select-none h-[52px]`}>
                    <button
                      type="button"
                      onClick={() => setThreads(Math.max(1, threads - 1))}
                      disabled={running}
                      className={`w-10 h-10 flex items-center justify-center rounded-lg ${btnIconBg} text-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100 shadow-sm`}
                    >
                      -
                    </button>
                    <div className="px-8 text-center min-w-[120px]">
                      <span className={`text-2xl font-black ${isDark ? 'text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.3)]' : 'text-emerald-600'}`}>{threads}</span>
                      <span className={`text-[11px] ${textMuted} block -mt-1 font-extrabold uppercase tracking-widest`}>{t.threads}</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => setThreads(Math.min(maxCores, threads + 1))}
                      disabled={running || threads >= maxCores}
                      className={`w-10 h-10 flex items-center justify-center rounded-lg ${btnIconBg} text-xl transition-all hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100 shadow-sm`}
                    >
                      +
                    </button>
                  </div>
                  <div className="flex gap-2.5 w-full justify-center items-center">
                    <button type="button" disabled={running} onClick={() => setThreads(Math.max(1, Math.floor(maxCores / 3)))} className={`text-[12px] uppercase tracking-widest font-black px-3 py-2 rounded-lg border ${isDark ? 'border-slate-700 bg-slate-800/50 hover:bg-slate-700 text-slate-400' : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-500 shadow-sm'} transition-all hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100`}>Low</button>
                    <button type="button" disabled={running} onClick={() => setThreads(Math.max(1, Math.floor(maxCores / 2)))} className={`text-[12px] uppercase tracking-widest font-black px-3 py-2 rounded-lg border ${isDark ? 'border-slate-700 bg-slate-800/50 hover:bg-slate-700 text-slate-400' : 'border-slate-300 bg-white hover:bg-slate-100 text-slate-500 shadow-sm'} transition-all hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100`}>Medium</button>
                    <button type="button" disabled={running} onClick={() => setThreads(maxCores)} className={`text-[12px] uppercase tracking-widest font-black px-3 py-2 rounded-lg border ${isDark ? 'border-emerald-700/50 bg-emerald-900/20 hover:bg-emerald-800/40 text-emerald-400' : 'border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 shadow-sm'} transition-all hover:scale-105 active:scale-95 disabled:opacity-30 disabled:hover:scale-100`}>High</button>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-8">
                <button
                  onClick={startGen}
                  disabled={running || !isInputValid}
                  className="w-full bg-gradient-to-r from-emerald-600 to-teal-500 hover:from-emerald-500 hover:to-teal-400 text-white font-bold h-[52px] px-4 rounded-lg shadow-lg hover:shadow-emerald-500/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5 active:translate-y-0 active:shadow-none"
                >
                  {t.generate}
                </button>
                <button
                  onClick={stopGen}
                  disabled={!running}
                  className={`w-full ${stopBg} font-bold h-[52px] px-4 rounded-lg shadow-lg transition-all disabled:opacity-50 disabled:cursor-not-allowed transform hover:-translate-y-0.5 active:translate-y-0 active:shadow-none`}
                >
                  {t.stop}
                </button>
              </div>
            </form>
          </div>

          {/* Statistics Panel */}
          <div className={`${cardBg} rounded-2xl ${cardShadow} p-4 md:p-8 border ${cardBorder} backdrop-blur-md relative overflow-hidden group flex flex-col justify-between transition-colors duration-300`}>
            <div className={`absolute top-0 right-0 w-full h-1 bg-gradient-to-l ${isDark ? "from-emerald-500 to-teal-400 opacity-60" : "from-emerald-400 to-teal-300 opacity-80"} group-hover:opacity-100 transition-opacity`}></div>

            <div className={`space-y-4 ${textMain}`}>
              <div className={`flex justify-between items-end border-b ${subtleBorder} pb-3`}>
                <span className={`${textMuted} text-sm uppercase tracking-wider font-bold`}>{t.difficulty}</span>
                <span className={`font-mono ${isDark ? "text-emerald-400" : "text-emerald-600"} truncate max-w-[60%] text-right font-medium`}>{displayDifficulty}</span>
              </div>

              <div className={`flex justify-between items-end border-b ${subtleBorder} pb-3`}>
                <span className={`${textMuted} text-sm uppercase tracking-wider font-bold`}>{t.generated}</span>
                <span className={`font-mono ${textMain} font-medium`}>
                  {formatNum(attempts)}{" "}
                  <span className={`${textMuted} text-sm font-sans tracking-normal lowercase`}>{t.addresses}</span>
                </span>
              </div>

              <div className={`flex justify-between items-end border-b ${subtleBorder} pb-3`}>
                <span className={`${textMuted} text-sm uppercase tracking-wider font-bold`}>{t.prob50}</span>
                <span className={`font-mono ${isDark ? "text-amber-400" : "text-amber-600"} font-medium`}>{displayTime50}</span>
              </div>

              <div className={`flex justify-between items-end border-b ${subtleBorder} pb-3`}>
                <span className={`${textMuted} text-sm uppercase tracking-wider font-bold`}>{t.timeElapsed}</span>
                <span className={`font-mono ${isDark ? "text-indigo-400" : "text-indigo-600"} font-medium`}>{timeElapsed.toFixed(1)}s</span>
              </div>

              <div className={`flex justify-between items-end border-b ${subtleBorder} pb-3`}>
                <span className={`${textMuted} text-sm uppercase tracking-wider font-bold`}>{t.speed}</span>
                <span className={`font-mono ${isDark ? "text-emerald-400" : "text-emerald-600"} font-medium`}>
                  {formatNum(keysPerSec)}{" "}
                  <span className={`${textMuted} text-sm font-sans tracking-normal lowercase`}>{t.addrSec}</span>
                </span>
              </div>

              <div className="flex justify-between items-end">
                <span className={`${textMuted} text-sm uppercase tracking-wider font-bold`}>{t.status}</span>
                <span
                  className={`font-mono font-medium ${
                    running
                      ? (isDark ? "text-amber-400 animate-pulse" : "text-amber-600 animate-pulse")
                      : status === "Address Found"
                      ? `text-emerald-500 font-bold ${isDark ? 'drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]' : ''}`
                      : textMuted
                  }`}
                >
                  {displayStatus}
                </span>
              </div>
            </div>

            {/* Probability Block */}
            <div className="mt-8 flex justify-between items-end">
              <div className="w-full mr-4 relative">
                <div className={`w-full ${isDark ? 'bg-slate-900' : 'bg-slate-200'} rounded-lg h-5 overflow-hidden border ${isDark ? 'border-slate-700/80 shadow-inner' : 'border-slate-300 shadow-inner'}`}>
                  <div
                    className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-lg transition-all duration-700 ease-out relative"
                    style={{ width: `${Math.min(100, currentProbability)}%` }}
                  >
                    <div className="absolute inset-0 bg-[linear-gradient(45deg,rgba(255,255,255,.15)_25%,transparent_25%,transparent_50%,rgba(255,255,255,.15)_50%,rgba(255,255,255,.15)_75%,transparent_75%,transparent)] bg-[length:1.5rem_1.5rem] animate-[stripes_1.5s_linear_infinite]"></div>
                  </div>
                </div>
              </div>

              <div className="text-right whitespace-nowrap hidden sm:block">
                <span className={`block text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r ${isDark ? "from-emerald-400 to-teal-300" : "from-emerald-600 to-teal-500"} leading-none pb-1`}>
                  {currentProbability.toFixed(2)}%
                </span>
                <span className={`block text-xs ${textMuted} font-bold uppercase tracking-widest mt-0.5`}>{t.probability}</span>
              </div>
            </div>

            <div className="text-center sm:hidden mt-3">
              <span className={`text-xl font-bold text-transparent bg-clip-text bg-gradient-to-r ${isDark ? "from-emerald-400 to-teal-300" : "from-emerald-600 to-teal-500"}`}>
                {currentProbability.toFixed(2)}%
              </span>
              <span className={`ml-2 text-xs ${textMuted} font-bold uppercase tracking-widest`}>{t.probability}</span>
            </div>
          </div>
        </div>

        {/* Result Panel */}
        {foundWallets.length > 0 && (
          <div className={`mt-8 ${cardBg} rounded-2xl ${isDark ? "shadow-[0_0_40px_rgba(16,185,129,0.15)]" : "shadow-xl border-emerald-300"} p-4 md:p-8 border ${isDark ? "border-emerald-500/50" : "border-emerald-400"} backdrop-blur-sm animate-[fadeIn_0.5s_ease-out] transition-colors duration-300`}>
            <div className="flex flex-col sm:flex-row justify-between items-center mb-6 gap-4">
              <h2 className={`text-2xl font-extrabold text-transparent bg-clip-text bg-gradient-to-r ${isDark ? "from-emerald-400 to-teal-300" : "from-emerald-600 to-teal-500"} flex items-center gap-3`}>
                {t.success} ({foundWallets.length})
              </h2>
              <div className="flex flex-wrap items-center gap-3">
                 <button
                  onClick={() => {
                    setKeystoreMode('all');
                    setKeystorePassword("");
                    setShowKeystoreModal(true);
                  }}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 ${isDark ? 'border-amber-500/50 hover:bg-amber-500/20 text-amber-300' : 'border-amber-400 hover:bg-amber-50 text-amber-700'} font-bold transition-all text-sm`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {t.zipKeystores}
                </button>
                <button
                  onClick={handleDownloadAllSeed}
                  className={`flex items-center gap-2 px-4 py-2 rounded-lg border-2 ${isDark ? 'border-emerald-500/50 hover:bg-emerald-500/20 text-emerald-300' : 'border-emerald-400 hover:bg-emerald-50 text-emerald-700'} font-bold transition-all text-sm`}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  {t.downloadAll}
                </button>

              </div>
            </div>

            <div className="max-h-[600px] overflow-y-auto py-2 pr-2 custom-scrollbar space-y-3 sm:space-y-6">
              {foundWallets.slice(0, displayCount).map((w, idx) => (
                <div key={w.id} className={`p-4 md:p-6 rounded-2xl border ${isDark ? 'border-slate-700/50 bg-slate-900/40' : 'border-slate-200 bg-slate-50/50'} relative group/item`}>
                  <div className={`absolute -top-2 left-3 min-w-9 h-9 p-2 rounded-full ${isDark ? 'bg-emerald-600' : 'bg-emerald-500'} text-white flex items-center justify-center font-bold text-sm shadow-lg`}>
                    {idx + 1}
                  </div>

                  <div className="grid gap-4">
                    <div className={`${successBox} p-3 md:p-5 rounded-xl shadow-inner group transition-colors ${isDark ? 'hover:border-emerald-500/30' : 'hover:border-emerald-400'}`}>
                      <div className="flex justify-between items-center mb-2">
                        <label className={`text-xs font-bold ${isDark ? 'text-emerald-400' : 'text-emerald-600'} uppercase tracking-widest`}>{idx === 0 ? t.ethAddress : `${t.ethAddress} #${idx+1}`}</label>
                        <button
                          onClick={() => copyToClipboard(w.address, t.copiedAddress)}
                          className={`text-slate-400 ${isDark ? 'btnIconBg p-2 rounded-lg border' : `hover:text-emerald-600 ${btnIconBg} p-2 rounded-lg border`}`}
                        >
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                      <div className={`font-mono ${addressText} text-base sm:text-lg break-all select-all font-medium`}>{w.address}</div>
                    </div>

                    <div className={`${successBox} p-3 md:p-5 rounded-xl shadow-inner group transition-colors ${isDark ? 'hover:border-rose-500/30' : 'hover:border-rose-400'} relative overflow-hidden`}>
                      <div className="flex justify-between items-center mb-2 relative z-10">
                        <label className={`text-xs font-bold ${isDark ? 'text-rose-400' : 'text-rose-600'} uppercase tracking-widest flex items-center gap-2`}>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                          </svg>
                          {t.privateKey}
                        </label>
                        <div className="flex gap-2">
                          <button
                            onClick={() => copyToClipboard(w.privKey, t.copiedPrivKey)}
                            className={`text-slate-400 ${isDark ? 'hover:text-rose-400 bg-slate-800 hover:bg-slate-700 border-slate-700/50' : 'hover:text-rose-600 bg-slate-100 hover:bg-slate-200 border-slate-200'} transition-colors p-1.5 rounded-lg border`}
                            title="Copy Private Key"
                          >
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                            </svg>
                          </button>
                          <button
                            onClick={() => toggleWalletVisibility(w.id, 'key')}
                            className={`text-slate-400 ${isDark ? 'hover:text-amber-400 bg-slate-800 hover:bg-slate-700 border-slate-700/50' : 'hover:text-amber-500 bg-slate-100 hover:bg-slate-200 border-slate-200'} transition-colors p-1.5 rounded-lg border`}
                          >
                            {w.isKeyVisible ? (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268-2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                              </svg>
                            ) : (
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                              </svg>
                            )}
                          </button>
                        </div>
                      </div>
                      <div className={`font-mono text-sm sm:text-base break-all transition-all duration-300 relative font-medium z-10 ${
                        w.isKeyVisible ? `${privKeyText} select-all` : `${isDark ? "text-rose-500/50" : "text-rose-400/50"} blur-sm select-none`
                      }`}>
                        {w.isKeyVisible ? w.privKey : w.blurredPrivKey}
                      </div>
                    </div>

                    {w.mnemonic && (
                      <div className={`${successBox} p-3 md:p-5 rounded-xl shadow-inner group transition-colors ${isDark ? 'hover:border-indigo-500/30' : 'hover:border-indigo-400'} relative overflow-hidden`}>
                        <div className="flex justify-between items-center mb-2 relative z-10">
                          <label className={`text-xs font-bold ${isDark ? 'text-indigo-400' : 'text-indigo-600'} uppercase tracking-widest flex items-center gap-2`}>
                            <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor">
                              <path fillRule="evenodd" d="M5 9V7a5 5 0 0110 0v2a2 2 0 012 2v5a2 2 0 01-2 2H5a2 2 0 01-2-2v-5a2 2 0 012-2zm8-2v2H7V7a3 3 0 016 0z" clipRule="evenodd" />
                            </svg>
                            {t.seedPhraseMode}
                          </label>
                          <div className="flex gap-2">
                            <button
                              onClick={() => copyToClipboard(w.mnemonic, "Copied Seed Phrase to clipboard!")}
                              className={`text-slate-400 ${isDark ? 'hover:text-indigo-400 bg-slate-800 hover:bg-slate-700 border-slate-700/50' : 'hover:text-indigo-600 bg-slate-100 hover:bg-slate-200 border-slate-200'} transition-colors p-1.5 rounded-lg border`}
                              title="Copy Seed Phrase"
                            >
                              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            </button>
                            <button
                              onClick={() => toggleWalletVisibility(w.id, 'mnemonic')}
                              className={`text-slate-400 ${isDark ? 'hover:text-amber-400 bg-slate-800 hover:bg-slate-700 border-slate-700/50' : 'hover:text-amber-500 bg-slate-100 hover:bg-slate-200 border-slate-200'} transition-colors p-1.5 rounded-lg border`}
                            >
                              {w.isMnemonicVisible ? (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268-2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                                </svg>
                              ) : (
                                <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                                </svg>
                              )}
                            </button>
                          </div>
                        </div>
                        <div className={`font-mono text-sm sm:text-base break-all transition-all duration-300 relative font-medium z-10 ${
                          w.isMnemonicVisible ? `text-indigo-400 select-all` : `${isDark ? "text-indigo-500/50" : "text-indigo-400/50"} blur-sm select-none`
                        }`}>
                          {w.isMnemonicVisible ? w.mnemonic : w.blurredMnemonic}
                        </div>
                      </div>
                    )}
                  </div>

                  <div className="mt-4 flex gap-3 flex-col sm:flex-row">
                     <button
                      onClick={() => {
                        setSelectedWallet(w);
                        setKeystoreMode('single');
                        setKeystorePassword("");
                        setShowKeystoreModal(true);
                      }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border ${isDark ? 'border-slate-700 hover:bg-slate-800 text-amber-400' : 'border-slate-300 hover:bg-slate-100 text-amber-600'} text-xs font-bold transition-all`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                      </svg>
                      {t.createKeystore}
                    </button>
                    <button
                      onClick={() => handleDownloadSeed(w)}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 rounded-lg border ${isDark ? 'border-slate-700 hover:bg-slate-800 text-indigo-400' : 'border-slate-300 hover:bg-slate-100 text-indigo-600'} text-xs font-bold transition-all`}
                    >
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                      </svg>
                      {t.downloadSeed}
                    </button>
                  </div>
                </div>
              ))}

              {foundWallets.length > displayCount && (
                <div className="pt-3 flex justify-center">
                  <button
                    onClick={() => setDisplayCount(prev => prev + 100)}
                    className={`px-8 py-3 rounded-xl font-bold border-2 transition-all transform hover:scale-105 active:scale-95 shadow-lg ${isDark ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20' : 'border-emerald-400 bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
                  >
                    {t.seeMore}
                  </button>
                </div>
              )}
            </div>

            <p className={`text-rose-500/90 text-sm font-semibold text-center mt-4`}>{t.securityWarning}</p>
          </div>
        )}

        <style dangerouslySetInnerHTML={{ __html: `
          .custom-scrollbar::-webkit-scrollbar {
            width: 6px;
          }
          .custom-scrollbar::-webkit-scrollbar-track {
            background: transparent;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb {
            background: ${isDark ? '#334155' : '#cbd5e1'};
            border-radius: 10px;
          }
          .custom-scrollbar::-webkit-scrollbar-thumb:hover {
            background: ${isDark ? '#475569' : '#94a3b8'};
          }
        `}} />


        {/* Disclaimer */}
        <div className={`mt-8 md:mt-12 ${isDark ? 'bg-slate-900/60 border-amber-900/40 shadow-xl' : 'bg-amber-50/80 border-amber-200 shadow-md'} rounded-xl flex flex-col sm:flex-row p-4 md:p-6 border mx-auto backdrop-blur-sm transition-colors duration-300`}>
          <div className="text-amber-500 mb-4 sm:mb-0 sm:mr-6 flex-shrink-0 flex items-center justify-center bg-amber-500/10 w-14 h-14 rounded-full">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <div>
            <h3 className="font-bold text-amber-500 mb-2 uppercase tracking-wide">{t.securityNoticeTitle}</h3>
            <p className={`text-sm ${isDark ? 'text-slate-400' : 'text-slate-600'} leading-relaxed font-medium`}>
              {t.securityNoticeDesc}
            </p>
          </div>
        </div>

        {/* Footer */}
        <footer className={`mt-10 md:mt-16 py-4 md:py-6 border-t ${isDark ? 'border-slate-800' : 'border-slate-200'} flex flex-col md:flex-row justify-between items-center gap-6 mx-auto w-full transition-colors duration-300`}>
          <div className="flex flex-wrap items-center gap-2 text-sm font-medium">
            <span className={isDark ? 'text-slate-400' : 'text-slate-500'}>{t.donate}</span>
            <button
              onClick={() => copyToClipboard("0x42863a74164440f3384cA82394e891bDb9888888", t.copiedDonate)}
              className={`font-mono text-sm tracking-wide transition-colors focus:outline-none break-all ${isDark ? 'text-emerald-400 hover:text-emerald-300' : 'text-emerald-600 hover:text-emerald-500'}`}
              title="Click to copy donate address"
            >
              0x42863a74164440f3384cA82394e891bDb9888888
            </button>
          </div>

          <div className={`flex items-center gap-6 text-sm font-bold ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>
            <a
              href="https://github.com/tiendatmagic/pkey-eth/wiki"
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1.5 transition-colors ${isDark ? 'hover:text-emerald-400' : 'hover:text-emerald-600'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
              </svg>
              {t.starMe}
            </a>
            <a
              href="https://github.com/tiendatmagic/pkey-eth"
              target="_blank"
              rel="noopener noreferrer"
              className={`flex items-center gap-1.5 transition-colors ${isDark ? 'hover:text-emerald-400' : 'hover:text-emerald-600'}`}
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.379.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z" />
              </svg>
              {t.sourceCode}
            </a>
          </div>
        </footer>

      </div>

      {/* Copy Toast Notifications Container */}
      <div className="fixed bottom-6 right-6 flex flex-col gap-3 z-50">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`bg-slate-800 text-emerald-400 border border-emerald-500/50 shadow-2xl px-5 py-3 rounded-xl flex items-center gap-3 animate-[fadeInUp_0.3s_ease-out]`}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
              <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
            </svg>
            <span className="font-bold tracking-wide">{toast.message}</span>
          </div>
        ))}
      </div>

      {/* Keystore Modal Overlay */}
      {showKeystoreModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]">
          <div className={`${isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-800'} border rounded-2xl shadow-2xl p-6 md:p-8 w-full max-w-md relative`}>
            <button
              onClick={() => !isEncrypting && setShowKeystoreModal(false)}
              className="absolute top-4 right-4 text-slate-400 hover:text-rose-500 transition-colors"
            >
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
            <h3 className={`text-xl font-bold mb-2 ${isDark ? 'text-indigo-400' : 'text-indigo-600'} flex items-center gap-2`}>
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
              {t.encryptKeystore}
            </h3>
            <p className={`text-sm mb-5 ${isDark ? 'text-slate-400' : 'text-slate-500'}`}>{t.encryptDesc}</p>

            <form onSubmit={(e) => { e.preventDefault(); handleDownloadKeystore(); }}>
              <input
                type="password"
                required
                minLength={6}
                value={keystorePassword}
                onChange={(e) => setKeystorePassword(e.target.value)}
                placeholder={t.enterPass}
                disabled={isEncrypting}
                autoFocus
                className={`w-full px-4 py-3 mb-4 rounded-lg border outline-none transition-all focus:ring-2 focus:ring-indigo-500 ${isDark ? 'bg-slate-900 border-slate-600 text-slate-100' : 'bg-slate-50 border-slate-300 text-slate-800'}`}
              />
              {isEncrypting ? (
                <div className={`w-full py-6 rounded-2xl border transition-all flex flex-col items-center justify-center gap-4 ${isDark ? 'bg-slate-800/50 border-slate-700' : 'bg-slate-50 border-slate-200'}`}>
                  <div className="flex flex-col items-center gap-3 px-4 text-center">
                    <div className={`p-3 rounded-full ${isDark ? 'bg-indigo-500/20 text-indigo-400' : 'bg-indigo-100 text-indigo-600'}`}>
                      <svg className="animate-spin h-6 w-6" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    </div>
                    <div className="space-y-1">
                      <p className={`text-sm font-bold ${isDark ? 'text-slate-200' : 'text-slate-700'}`}>
                        {encryptProgressText || t.encrypting}
                      </p>
                      <p className="text-[10px] text-slate-500 font-medium uppercase tracking-wider">
                        {t.dontCloseTab}
                      </p>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      abortEncryptRef.current = true;
                    }}
                    className="px-6 py-2 rounded-full text-[10px] font-black bg-rose-500/10 text-rose-500 hover:bg-rose-500 hover:text-white transition-all uppercase tracking-[0.2em] border border-rose-500/20"
                  >
                    {t.stopEncrypt}
                  </button>
                </div>
              ) : (
                <button
                  type="submit"
                  disabled={!keystorePassword || keystorePassword.length < 6}
                  className={`w-full py-3 rounded-lg font-bold shadow-md transition-all flex items-center justify-center gap-2 ${isDark ? 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-slate-700 disabled:text-slate-500' : 'bg-indigo-600 hover:bg-indigo-500 text-white disabled:bg-slate-300 disabled:text-slate-500'}`}
                >
                  {t.createDownload}
                </button>
              )}
            </form>
          </div>
        </div>
      )}

      {/* Infinite Warning Modal */}
      {showInfiniteWarning && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-[fadeIn_0.2s_ease-out]"
          onClick={() => setShowInfiniteWarning(false)}
        >
          <div
            className={`${isDark ? 'bg-slate-800 border-slate-700 text-slate-200' : 'bg-white border-slate-200 text-slate-800'} border rounded-2xl shadow-2xl p-6 md:p-8 w-full max-w-lg relative animate-[scaleIn_0.2s_ease-out]`}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-amber-500 mb-6 flex justify-center">
              <svg xmlns="http://www.w3.org/2000/svg" className="h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
            </div>
            <h3 className="text-2xl font-bold mb-4 text-center">{t.infiniteWarningTitle}</h3>
            <p className={`text-center mb-6 ${isDark ? 'text-slate-400' : 'text-slate-600'} leading-relaxed`}>
              {t.infiniteWarningDesc}
            </p>

            <label className="flex items-center justify-center mb-8 cursor-pointer group">
              <input
                type="checkbox"
                checked={modalCheckbox}
                onChange={(e) => setModalCheckbox(e.target.checked)}
                className={`w-5 h-5 text-emerald-500 ${isDark ? 'bg-slate-900 border-slate-600' : 'bg-white border-slate-300'} rounded focus:ring-emerald-500 focus:ring-offset-0`}
              />
              <span className={`ml-3 font-medium ${isDark ? 'text-slate-300' : 'text-slate-600'} group-hover:text-emerald-500 transition-colors`}>
                {t.dontShowAgain}
              </span>
            </label>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => setShowInfiniteWarning(false)}
                className={`py-3 px-4 rounded-xl font-bold border ${isDark ? 'border-slate-700 hover:bg-slate-700 text-slate-400' : 'border-slate-200 hover:bg-slate-100 text-slate-500'} transition-all`}
              >
                {t.cancel}
              </button>
              <button
                onClick={() => {
                  if (modalCheckbox) {
                    setPersistentSkipWarning(true);
                    localStorage.setItem("skipInfiniteWarning", "true");
                  }
                  setWalletCount("");
                  setShowInfiniteWarning(false);
                }}
                className="py-3 px-4 rounded-xl font-bold bg-emerald-600 hover:bg-emerald-500 text-white shadow-lg shadow-emerald-900/20 transition-all"
              >
                {t.confirmProceed}
              </button>
            </div>
          </div>
        </div>
      )}

      <style dangerouslySetInnerHTML={{ __html: `
        @keyframes stripes {
          from { background-position: 1.5rem 0; }
          to { background-position: 0 0; }
        }
        @keyframes fadeIn {
          from { opacity: 0; transform: translateY(10px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeInUp {
          from { opacity: 0; transform: translateY(20px); }
          to { opacity: 1; transform: translateY(0); }
        }
      `}} />
    </div>
  );
}
