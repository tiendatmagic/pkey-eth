# PKey ETH - Vanity Ethereum Address & Mnemonic Generator

A high-performance, **100% client-side** Ethereum vanity address and mnemonic generator built with Next.js, TypeScript, and Tailwind CSS. Generate customized Ethereum addresses and seed phrases securely within your browser using multi-core CPU acceleration.

## Key Features

- **Vanity Address Generation**: Find addresses with specific prefixes or suffixes (e.g., `0x777...` or `...ABC`).
- **Mnemonic (Seed Phrase) Support**: Generate full 12, 15, 18, 21, or 24-word mnemonics that derive your vanity address.
- **Passphrase Security**: Optionally add a BIP-39 passphrase to your mnemonic for an extra layer of security.
- **Multi-Wallet Generation**: Generate a single wallet or a batch of wallets (even infinite loop) automatically.
- **High Speed**: Utilizes **Web Workers** for multi-threaded parallel generation, maximizing your CPU's performance.
- **Privacy First**: All cryptographic operations (`secp256k1`, `keccak256`, `scrypt`) happen entirely in your browser. No data ever leaves your machine.
- **Bulk Keystore Export**: Encrypt your generated wallets with a password and download them as individual JSON (Web3) files or a consolidated **ZIP archive**.
- **i18n Support**: Full support for **English** and **Vietnamese (Tiếng Việt)**.
- **Modern UI**: responsive dashboard with Dark/Light mode, real-time probability tracking, and interactive +/- controls.

## Tech Stack

- **Framework**: [Next.js 16+](https://nextjs.org/) (App Router)
- **Styling**: [Tailwind CSS 4](https://tailwindcss.com/)
- **Libraries**:
  - `ethers.js` (Wallet management & Keystore encryption)
  - `jszip` (Bulk export compression)
  - `noble-secp256k1` (High-speed EC math)
  - `js-sha3` (Keccak-256)

## Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v20 or later)
- npm, yarn, or pnpm

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com/tiendatmagic/pkey-eth.git
   cd pkey-eth
   ```
2. Install dependencies:
   ```bash
   npm install
   ```
3. Start development:
   ```bash
   npm run dev
   ```

## Security & Privacy

PKey ETH is designed for users who prioritize security:
- **Zero-Backend**: No API calls are made. It works perfectly in Aeroplane Mode.
- **No Storage**: Keys are never saved to local storage or cookies. Refreshing the page wipes all found data.
- **Open Source**: The entire generation logic is transparent and auditable.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request or open an issue.

## Support

If you find this tool useful, please give the repository a **Star**!

## License

Distributed under the MIT License. See `LICENSE` for more information.
